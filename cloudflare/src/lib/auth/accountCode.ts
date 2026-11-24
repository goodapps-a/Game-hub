import type { D1DatabaseLike } from '../types';

const ACCOUNT_CODE_RE = /^[1-9]\d{5}$/;

export function isValidAccountCode(value: unknown): value is string {
  return typeof value === 'string' && ACCOUNT_CODE_RE.test(value.trim());
}

/**
 * Generates an unbiased uniform random 6-digit numeric ID between 100000 and 999999.
 */
export function generateRandom6DigitCode(): string {
  const range = 900000;
  const maxValid = Math.floor(0x100000000 / range) * range;
  const buf = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(buf);
    const val = buf[0]!;
    if (val < maxValid) {
      return String(100000 + (val % range));
    }
  }
}

/**
 * Allocates a random 6-digit account code that does not currently exist in `users.account_code`.
 */
export async function allocateUniqueAccountCode(
  db: D1DatabaseLike
): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = generateRandom6DigitCode();
    const existing = await db
      .prepare(`SELECT 1 AS hit FROM users WHERE account_code = ? LIMIT 1`)
      .bind(candidate)
      .first<{ hit: number }>();
    if (!existing) {
      return candidate;
    }
  }
  throw new Error('ACCOUNT_CODE_ALLOCATION_EXHAUSTED');
}

/**
 * Ensures an active or pending-verification user has a unique 6-digit `account_code`
 * (lazy backfill for pre-0014 accounts). Guests never receive a permanent account code
 * until upgraded/registered.
 */
export async function ensureUserAccountCode(
  db: D1DatabaseLike,
  userId: string,
  now = Date.now()
): Promise<string | null> {
  try {
    const row = await db
      .prepare(
        `SELECT account_code, account_status
         FROM users
         WHERE user_id = ?
         LIMIT 1`
      )
      .bind(userId)
      .first<{ account_code: string | null; account_status: string }>();

    if (!row) return null;
    if (row.account_code && isValidAccountCode(row.account_code)) {
      return row.account_code;
    }
    if (row.account_status !== 'active' && row.account_status !== 'pending_verification') {
      return null;
    }

    for (let attempt = 0; attempt < 25; attempt++) {
      const candidate = generateRandom6DigitCode();
      try {
        const res = await db
          .prepare(
            `UPDATE users
             SET account_code = ?, updated_at = ?
             WHERE user_id = ? AND account_code IS NULL`
          )
          .bind(candidate, now, userId)
          .run();

        if (Number(res.meta?.changes ?? 0) > 0) {
          return candidate;
        }
        // Concurrent backfill beat us — read the winner value
        const fresh = await db
          .prepare(`SELECT account_code FROM users WHERE user_id = ? LIMIT 1`)
          .bind(userId)
          .first<{ account_code: string | null }>();
        if (fresh?.account_code && isValidAccountCode(fresh.account_code)) {
          return fresh.account_code;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (/UNIQUE/i.test(msg)) {
          continue;
        }
        throw err;
      }
    }
  } catch {
    return null;
  }
  return null;
}
