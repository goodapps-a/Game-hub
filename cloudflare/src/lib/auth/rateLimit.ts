/**
 * Persistent brute-force & abuse rate limiter backed by `auth_rate_limits`
 * (works identically on Cloudflare D1 and local SQLite).
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

interface RateLimitRow {
  rate_key: string;
  attempts: number;
  window_started_at: number;
  blocked_until: number | null;
}

export interface RateLimitCheckResult {
  readonly allowed: boolean;
  readonly retryAfterSec: number;
}

export async function checkRateLimit(
  db: D1DatabaseLike,
  rateKey: string,
  policy: RateLimitPolicy,
  now = Date.now()
): Promise<RateLimitCheckResult> {
  const row = await db
    .prepare(
      `SELECT rate_key, attempts, window_started_at, blocked_until
       FROM auth_rate_limits
       WHERE rate_key = ?
       LIMIT 1`
    )
    .bind(rateKey)
    .first<RateLimitRow>();

  if (!row) {
    return { allowed: true, retryAfterSec: 0 };
  }

  if (row.blocked_until !== null && row.blocked_until > now) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((row.blocked_until - now) / 1000)),
    };
  }

  if (now - row.window_started_at < policy.windowMs && row.attempts >= policy.maxAttempts) {
    const remainingMs = Math.max(1000, policy.windowMs - (now - row.window_started_at));
    return {
      allowed: false,
      retryAfterSec: Math.ceil(remainingMs / 1000),
    };
  }

  return { allowed: true, retryAfterSec: 0 };
}

export async function recordRateLimitAttempt(
  db: D1DatabaseLike,
  rateKey: string,
  policy: RateLimitPolicy,
  now = Date.now()
): Promise<RateLimitCheckResult> {
  const row = await db
    .prepare(
      `SELECT rate_key, attempts, window_started_at, blocked_until
       FROM auth_rate_limits
       WHERE rate_key = ?
       LIMIT 1`
    )
    .bind(rateKey)
    .first<RateLimitRow>();

  let nextAttempts = 1;
  let nextWindowStart = now;
  let nextBlockedUntil: number | null = null;

  if (row && now - row.window_started_at < policy.windowMs) {
    nextAttempts = row.attempts + 1;
    nextWindowStart = row.window_started_at;
  }

  if (nextAttempts >= policy.maxAttempts) {
    nextBlockedUntil = now + policy.blockMs;
  }

  await db
    .prepare(
      `INSERT INTO auth_rate_limits (
         rate_key, action, attempts, window_started_at, blocked_until, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(rate_key) DO UPDATE SET
         action = excluded.action,
         attempts = excluded.attempts,
         window_started_at = excluded.window_started_at,
         blocked_until = excluded.blocked_until,
         updated_at = excluded.updated_at`
    )
    .bind(rateKey, policy.action, nextAttempts, nextWindowStart, nextBlockedUntil, now)
    .run();

  if (nextBlockedUntil !== null) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((nextBlockedUntil - now) / 1000)),
    };
  }

  return { allowed: true, retryAfterSec: 0 };
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
