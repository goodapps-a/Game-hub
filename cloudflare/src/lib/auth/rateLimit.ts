/**
 * Atomic, race-safe persistent rate limiter backed by `auth_rate_limits`
 * (works identically on Cloudflare D1 and local SQLite via single-statement UPSERT ... RETURNING).
 *
 * Concurrency guarantee:
 * - Both checking and incrementing happen atomically inside ONE SQL statement
 *   (`INSERT ... ON CONFLICT(rate_key) DO UPDATE ... RETURNING`), eliminating TOCTOU races
 *   when multiple concurrent requests arrive simultaneously.
 * - For login endpoints, `reserveRateLimitSlot` claims a slot atomically BEFORE password hashing;
 *   if login succeeds, `releaseRateLimitSlot` / `clearRateLimit` immediately returns the slot so
 *   successful logins are NEVER counted as failed attempts.
 */

import { D1DatabaseLike } from '../types';

export interface RateLimitPolicy {
  readonly action: string;
  readonly maxAttempts: number;
  readonly windowMs: number;
  readonly blockMs: number;
}

export const LOGIN_ID_RATE_LIMIT: RateLimitPolicy = {
  action: 'login_id',
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  blockMs: 15 * 60 * 1000,
};

export const LOGIN_IP_RATE_LIMIT: RateLimitPolicy = {
  action: 'login_ip',
  maxAttempts: 20,
  windowMs: 15 * 60 * 1000,
  blockMs: 15 * 60 * 1000,
};

export const REGISTER_IP_RATE_LIMIT: RateLimitPolicy = {
  action: 'register_ip',
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000,
  blockMs: 15 * 60 * 1000,
};

export const RESEND_VERIFY_IP_RATE_LIMIT: RateLimitPolicy = {
  action: 'resend_verify_ip',
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000,
  blockMs: 15 * 60 * 1000,
};

export const RESEND_VERIFY_EMAIL_RATE_LIMIT: RateLimitPolicy = {
  action: 'resend_verify_email',
  maxAttempts: 3,
  windowMs: 15 * 60 * 1000,
  blockMs: 15 * 60 * 1000,
};

/** Backwards-compatible alias for per-email resend verification rate limit. */
export const RESEND_VERIFY_RATE_LIMIT: RateLimitPolicy = RESEND_VERIFY_EMAIL_RATE_LIMIT;

export const FORGOT_PASSWORD_IP_RATE_LIMIT: RateLimitPolicy = {
  action: 'forgot_password_ip',
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000,
  blockMs: 15 * 60 * 1000,
};

export const FORGOT_PASSWORD_EMAIL_RATE_LIMIT: RateLimitPolicy = {
  action: 'forgot_password_email',
  maxAttempts: 3,
  windowMs: 15 * 60 * 1000,
  blockMs: 15 * 60 * 1000,
};

export const RESET_PASSWORD_IP_RATE_LIMIT: RateLimitPolicy = {
  action: 'reset_password_ip',
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000,
  blockMs: 15 * 60 * 1000,
};

export const VERIFY_EMAIL_IP_RATE_LIMIT: RateLimitPolicy = {
  action: 'verify_email_ip',
  maxAttempts: 15,
  windowMs: 15 * 60 * 1000,
  blockMs: 15 * 60 * 1000,
};

export const USERNAME_CHECK_IP_RATE_LIMIT: RateLimitPolicy = {
  action: 'username_check_ip',
  maxAttempts: 45,
  windowMs: 15 * 60 * 1000,
  blockMs: 5 * 60 * 1000,
};

export const PROFILE_UPDATE_USER_RATE_LIMIT: RateLimitPolicy = {
  action: 'profile_update_user',
  maxAttempts: 20,
  windowMs: 15 * 60 * 1000,
  blockMs: 15 * 60 * 1000,
};

const MAX_ACTIVE_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const DEFAULT_RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

interface RateLimitReturningRow {
  attempts: number;
  window_started_at: number;
  blocked_until: number | null;
}

export interface RateLimitCheckResult {
  readonly allowed: boolean;
  readonly retryAfterSec: number;
  readonly attempts: number;
}

/**
 * Atomically checks and consumes 1 attempt slot in a single SQL statement.
 *
 * Semantics:
 * - Attempts `1..maxAttempts` within `windowMs` are ALLOWED (`allowed: true`).
 * - Once `attempts > maxAttempts` (or while `blocked_until > now`), the request is
 *   REJECTED (`allowed: false`) with an accurate `retryAfterSec` and `blocked_until`
 *   locked for `blockMs`.
 * - Under N concurrent requests, SQLite/D1 serializes the row update so strictly at most
 *   `maxAttempts` requests proceed.
 */
export async function consumeRateLimitSlot(
  db: D1DatabaseLike,
  rateKey: string,
  policy: RateLimitPolicy,
  now = Date.now()
): Promise<RateLimitCheckResult> {
  const blockUntilIfExceeded = now + policy.blockMs;

  const row = await db
    .prepare(
      `INSERT INTO auth_rate_limits (
         rate_key, action, attempts, window_started_at, blocked_until, updated_at
       ) VALUES (?, ?, 1, ?, NULL, ?)
       ON CONFLICT(rate_key) DO UPDATE SET
         action = excluded.action,
         attempts = CASE
           WHEN auth_rate_limits.blocked_until IS NOT NULL AND auth_rate_limits.blocked_until > ?
             THEN auth_rate_limits.attempts + 1
           WHEN (? - auth_rate_limits.window_started_at) >= ?
             THEN 1
           ELSE auth_rate_limits.attempts + 1
         END,
         window_started_at = CASE
           WHEN auth_rate_limits.blocked_until IS NOT NULL AND auth_rate_limits.blocked_until > ?
             THEN auth_rate_limits.window_started_at
           WHEN (? - auth_rate_limits.window_started_at) >= ?
             THEN ?
           ELSE auth_rate_limits.window_started_at
         END,
         blocked_until = CASE
           WHEN auth_rate_limits.blocked_until IS NOT NULL AND auth_rate_limits.blocked_until > ?
             THEN auth_rate_limits.blocked_until
           WHEN (? - auth_rate_limits.window_started_at) >= ?
             THEN NULL
           WHEN (auth_rate_limits.attempts + 1) > ?
             THEN ?
           ELSE NULL
         END,
         updated_at = ?
       RETURNING attempts, window_started_at, blocked_until`
    )
    .bind(
      rateKey,
      policy.action,
      now,
      now,
      // attempts CASE
      now,
      now,
      policy.windowMs,
      // window_started_at CASE
      now,
      now,
      policy.windowMs,
      now,
      // blocked_until CASE
      now,
      now,
      policy.windowMs,
      policy.maxAttempts,
      blockUntilIfExceeded,
      // updated_at
      now
    )
    .first<RateLimitReturningRow>();

  if (!row) {
    return { allowed: true, retryAfterSec: 0, attempts: 1 };
  }

  const isBlocked =
    (row.blocked_until !== null && row.blocked_until > now) ||
    row.attempts > policy.maxAttempts;

  if (isBlocked) {
    const targetUntil =
      row.blocked_until && row.blocked_until > now
        ? row.blocked_until
        : now + policy.blockMs;
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((targetUntil - now) / 1000)),
      attempts: row.attempts,
    };
  }

  return {
    allowed: true,
    retryAfterSec: 0,
    attempts: row.attempts,
  };
}

/**
 * Atomically releases 1 previously reserved slot when a login succeeds,
 * ensuring valid logins are NEVER penalized as failed attempts.
 */
export async function releaseRateLimitSlot(
  db: D1DatabaseLike,
  rateKey: string,
  policy: RateLimitPolicy,
  now = Date.now()
): Promise<void> {
  await db
    .prepare(
      `UPDATE auth_rate_limits
       SET
         attempts = CASE WHEN attempts > 0 THEN attempts - 1 ELSE 0 END,
         blocked_until = CASE WHEN (attempts - 1) <= ? THEN NULL ELSE blocked_until END,
         updated_at = ?
       WHERE rate_key = ?`
    )
    .bind(policy.maxAttempts, now, rateKey)
    .run();
}

export async function clearRateLimit(
  db: D1DatabaseLike,
  rateKey: string
): Promise<void> {
  await db
    .prepare(`DELETE FROM auth_rate_limits WHERE rate_key = ?`)
    .bind(rateKey)
    .run();
}

export const DEFAULT_RATE_LIMIT_PRUNE_BATCH_SIZE = 500;
export const MAX_RATE_LIMIT_PRUNE_BATCH_SIZE = 5000;
export const DEFAULT_RATE_LIMIT_PRUNE_MAX_BATCHES = 5;
export const MAX_RATE_LIMIT_PRUNE_MAX_BATCHES = 20;

export interface RateLimitPruneBatchOptions {
  readonly now?: number;
  readonly retentionMs?: number;
  readonly batchSize?: number;
  readonly maxBatches?: number;
}

export interface RateLimitPruneBatchResult {
  readonly deleted: number;
  readonly batchesRun: number;
  readonly reachedBatchCap: boolean;
}

/**
 * Safely prunes up to `batchLimit` expired, unblocked rate-limit rows in a single
 * bounded query to prevent unbounded table growth and heavy D1 locks.
 *
 * Uses standard SQLite/D1 subquery `WHERE rate_key IN (SELECT ... ORDER BY updated_at ASC LIMIT ?)`
 * backed by `idx_auth_rate_limits_updated_at` (works without `SQLITE_ENABLE_UPDATE_DELETE_LIMIT`).
 *
 * Safety invariant:
 * - Enforces a minimum retention floor >= `MAX_ACTIVE_RATE_LIMIT_WINDOW_MS` (15m) so active
 *   sliding windows are NEVER deleted.
 * - Requires BOTH `updated_at < cutoff` AND `window_started_at < cutoff` AND
 *   `(blocked_until IS NULL OR blocked_until <= now)` so active blocks are NEVER deleted.
 */
export async function pruneExpiredRateLimits(
  db: D1DatabaseLike,
  now = Date.now(),
  retentionMs = DEFAULT_RATE_LIMIT_RETENTION_MS,
  batchLimit = DEFAULT_RATE_LIMIT_PRUNE_BATCH_SIZE
): Promise<number> {
  const safeRetentionMs = Math.max(retentionMs, MAX_ACTIVE_RATE_LIMIT_WINDOW_MS);
  const safeBatchLimit = Math.max(
    1,
    Math.min(MAX_RATE_LIMIT_PRUNE_BATCH_SIZE, Math.floor(batchLimit))
  );
  const cutoff = now - safeRetentionMs;
  const res = await db
    .prepare(
      `DELETE FROM auth_rate_limits
       WHERE rate_key IN (
         SELECT rate_key
         FROM auth_rate_limits
         WHERE updated_at < ?
           AND window_started_at < ?
           AND (blocked_until IS NULL OR blocked_until <= ?)
         ORDER BY updated_at ASC
         LIMIT ?
       )`
    )
    .bind(cutoff, cutoff, now, safeBatchLimit)
    .run();
  return Number(res.meta?.changes ?? 0);
}

/**
 * Runs up to `maxBatches` bounded delete chunks (default: up to 5 x 500 = 2,500 rows per scheduled tick)
 * and stops immediately once a batch deletes fewer than `batchSize` rows.
 * Designed for Cloudflare Workers Cron Triggers (`scheduled`) and periodic server maintenance.
 */
export async function pruneExpiredRateLimitsBatched(
  db: D1DatabaseLike,
  options?: RateLimitPruneBatchOptions
): Promise<RateLimitPruneBatchResult> {
  const now = options?.now ?? Date.now();
  const retentionMs = options?.retentionMs ?? DEFAULT_RATE_LIMIT_RETENTION_MS;
  const batchSize = Math.max(
    1,
    Math.min(
      MAX_RATE_LIMIT_PRUNE_BATCH_SIZE,
      Math.floor(options?.batchSize ?? DEFAULT_RATE_LIMIT_PRUNE_BATCH_SIZE)
    )
  );
  const maxBatches = Math.max(
    1,
    Math.min(
      MAX_RATE_LIMIT_PRUNE_MAX_BATCHES,
      Math.floor(options?.maxBatches ?? DEFAULT_RATE_LIMIT_PRUNE_MAX_BATCHES)
    )
  );

  let totalDeleted = 0;
  let batchesRun = 0;
  let reachedBatchCap = false;

  for (let i = 0; i < maxBatches; i += 1) {
    const deleted = await pruneExpiredRateLimits(db, now, retentionMs, batchSize);
    batchesRun += 1;
    totalDeleted += deleted;
    if (deleted < batchSize) {
      break;
    }
    if (i === maxBatches - 1) {
      reachedBatchCap = true;
    }
  }

  return {
    deleted: totalDeleted,
    batchesRun,
    reachedBatchCap,
  };
}
