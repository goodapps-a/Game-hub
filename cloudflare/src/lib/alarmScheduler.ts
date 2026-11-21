import { DurableObjectStorageLike } from './types';

export const ALARMS_STORAGE_KEY = 'sys:alarms';

export interface ScheduledAlarmTask<TType extends string = string> {
  readonly id: string;
  readonly type: TType;
  /** Unique slot key so scheduling the same alarm kind replaces any stale duplicate */
  readonly dedupeKey: string;
  readonly dueAt: number;
  readonly expectedVersion?: number;
  readonly metadata?: Record<string, string | number | boolean>;
}

/**
 * Game-agnostic Durable Object Alarm Scheduler.
 *
 * Guarantees:
 * - Persists the full pending alarm queue in Durable Object Storage (`sys:alarms`).
 * - Survives DO hibernation, eviction, and cold restarts seamlessly.
 * - Deduplicates tasks by `dedupeKey` so repeated scheduling never piles up stale alarms.
 * - Always keeps the underlying single Cloudflare DO alarm synced to the earliest `dueAt`.
 * - Safe under Cloudflare's at-least-once alarm delivery when paired with idempotent handlers.
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
   * Pops all tasks due at or before `now + skewMs`, persists the remaining queue
   * immediately (so a crash or re-delivery never replays already-popped tasks),
   * and schedules the next earliest DO alarm if any remain.
   */
  public async popDueTasks(
    now: number,
    skewMs = 50
  ): Promise<ScheduledAlarmTask<TType>[]> {
    await this.hydrate();
    const cutoff = now + skewMs;
    const due: ScheduledAlarmTask<TType>[] = [];
    const remaining: ScheduledAlarmTask<TType>[] = [];

    for (const t of this.tasks) {
      if (t.dueAt <= cutoff) {
        due.push(t);
      } else {
        remaining.push(t);
      }
    }

    if (due.length > 0) {
      this.tasks = remaining;
      await this.persistAndSyncAlarm();
    } else if (this.tasks.length > 0) {
      // Re-sync underlying DO alarm in case Cloudflare woke us early
      await this.storage.setAlarm(this.tasks[0].dueAt);
    }

    return due;
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
