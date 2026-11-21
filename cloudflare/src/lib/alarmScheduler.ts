import { DurableObjectStorageLike } from './types';

export const ALARMS_STORAGE_KEY = 'sys:alarms';

export interface ScheduledAlarmTask<TType extends string = string> {
  readonly id: string;
  readonly type: TType;
  /** Unique slot key so scheduling the same alarm kind replaces any stale duplicate */
  readonly dedupeKey: string;
  readonly dueAt: number;
  readonly attempts?: number;
  readonly expectedVersion?: number;
  readonly metadata?: Record<string, string | number | boolean>;
}

export interface RetryBackoffOptions {
  /** Base delay (ms) for attempt #1 failure (default: 2000ms) */
  baseDelayMs?: number;
  /** Cap delay (ms) so retries never grow unbounded (default: 15 minutes) */
  maxDelayMs?: number;
  /** Optional hard retry cap; omit or set undefined for durable infinite capped retries */
  maxAttempts?: number;
}

/**
 * Game-agnostic Durable Object Alarm Scheduler with At-Least-Once Acknowledge Semantics.
 *
 * Reliability Guarantees:
 * - Persists the full pending alarm queue in Durable Object Storage (`sys:alarms`).
 * - NEVER deletes a task before its handler succeeds (`peekDueTasks` -> execute -> `completeTask`).
 * - Removes completed tasks strictly by `task.id` so a handler that reschedules a newer
 *   task under the same `dedupeKey` is NEVER overwritten by completion of the old task.
 * - On handler exception, `rescheduleFailedTask` persists an incremented attempt count with
 *   bounded exponential backoff so failed tasks are retried reliably even after DO restart.
 * - Always keeps Cloudflare's single underlying DO alarm synced to the earliest `dueAt`.
 */
export class DurableAlarmScheduler<TType extends string = string> {
  private readonly storage: DurableObjectStorageLike;
  private tasks: ScheduledAlarmTask<TType>[] = [];
  private hydrated = false;

  constructor(storage: DurableObjectStorageLike) {
    this.storage = storage;
  }

  public async hydrate(): Promise<void> {
    if (this.hydrated) return;
    const saved = await this.storage.get<ScheduledAlarmTask<TType>[]>(
      ALARMS_STORAGE_KEY
    );
    this.tasks = Array.isArray(saved)
      ? [...saved].sort((a, b) => a.dueAt - b.dueAt)
      : [];
    this.hydrated = true;
  }

  public getPendingTasks(): readonly ScheduledAlarmTask<TType>[] {
    return this.tasks;
  }

  public async schedule(input: {
    type: TType;
    dedupeKey: string;
    dueAt: number;
    expectedVersion?: number;
    metadata?: Record<string, string | number | boolean>;
  }): Promise<ScheduledAlarmTask<TType>> {
    await this.hydrate();
    const task: ScheduledAlarmTask<TType> = {
      id:
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `alm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: input.type,
      dedupeKey: input.dedupeKey,
      dueAt: Math.max(0, Math.floor(input.dueAt)),
      attempts: 0,
      expectedVersion: input.expectedVersion,
      metadata: input.metadata,
    };

    this.tasks = this.tasks.filter((t) => t.dedupeKey !== input.dedupeKey);
    this.tasks.push(task);
    this.tasks.sort((a, b) => a.dueAt - b.dueAt);

    await this.persistAndSyncAlarm();
    return task;
  }

  public async cancelByDedupeKey(dedupeKey: string): Promise<void> {
    await this.hydrate();
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((t) => t.dedupeKey !== dedupeKey);
    if (this.tasks.length !== before) {
      await this.persistAndSyncAlarm();
    }
  }

  public async cancelAll(): Promise<void> {
    this.tasks = [];
    this.hydrated = true;
    await this.storage.delete(ALARMS_STORAGE_KEY);
    await this.storage.deleteAlarm();
  }

  /**
   * Returns all tasks due at or before `now + skewMs` WITHOUT deleting them yet.
   * Callers MUST call `completeTask(task.id)` after successful execution or
   * `rescheduleFailedTask(task.id, now)` if execution throws.
   */
  public async peekDueTasks(
    now: number,
    skewMs = 50
  ): Promise<ScheduledAlarmTask<TType>[]> {
    await this.hydrate();
    const cutoff = now + skewMs;
    const due = this.tasks.filter((t) => t.dueAt <= cutoff);

    if (due.length === 0 && this.tasks.length > 0) {
      // Re-sync underlying DO alarm in case Cloudflare woke us slightly early
      await this.storage.setAlarm(this.tasks[0].dueAt);
    }

    return [...due];
  }

  /**
   * Acknowledges and deletes a completed task strictly by its unique `taskId`.
   * If the handler already replaced this `dedupeKey` with a newer task, the newer task stays intact.
   */
  public async completeTask(taskId: string): Promise<void> {
    await this.hydrate();
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((t) => t.id !== taskId);
    if (this.tasks.length !== before) {
      await this.persistAndSyncAlarm();
    } else if (this.tasks.length > 0) {
      await this.storage.setAlarm(this.tasks[0].dueAt);
    }
  }

  /**
   * Reschedules a task whose handler threw an exception using bounded exponential backoff.
   * Returns `true` if rescheduled, or `false` if `maxAttempts` was exceeded and task was dropped.
   */
  public async rescheduleFailedTask(
    taskId: string,
    now: number,
    options?: RetryBackoffOptions
  ): Promise<boolean> {
    await this.hydrate();
    const idx = this.tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) {
      return false;
    }

    const existing = this.tasks[idx];
    const nextAttempts = (existing.attempts ?? 0) + 1;
    if (
      options?.maxAttempts !== undefined &&
      nextAttempts > options.maxAttempts
    ) {
      this.tasks.splice(idx, 1);
      await this.persistAndSyncAlarm();
      return false;
    }

    const baseDelayMs = options?.baseDelayMs ?? 2_000;
    const maxDelayMs = options?.maxDelayMs ?? 15 * 60_000;
    const expDelay = Math.min(
      maxDelayMs,
      baseDelayMs * Math.pow(2, Math.min(10, nextAttempts - 1))
    );

    const updated: ScheduledAlarmTask<TType> = {
      ...existing,
      attempts: nextAttempts,
      dueAt: Math.floor(now + expDelay),
    };
    this.tasks[idx] = updated;
    this.tasks.sort((a, b) => a.dueAt - b.dueAt);

    await this.persistAndSyncAlarm();
    return true;
  }

  private async persistAndSyncAlarm(): Promise<void> {
    if (this.tasks.length === 0) {
      await this.storage.delete(ALARMS_STORAGE_KEY);
      await this.storage.deleteAlarm();
      return;
    }
    await this.storage.put(ALARMS_STORAGE_KEY, this.tasks);
    await this.storage.setAlarm(this.tasks[0].dueAt);
  }
}
