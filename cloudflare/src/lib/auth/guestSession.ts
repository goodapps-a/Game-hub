/**
 * Server-Issued Independent Guest Identity (`eyvan_guest_sess`).
 *
 * Security & Isolation Guarantees:
 * - Every unauthenticated guest receives a dedicated, server-generated `user_id` (`usr_...`)
 *   and a 256-bit HttpOnly opaque cookie (`eyvan_guest_sess`), with ONLY its SHA-256 hash
 *   persisted in `guest_sessions`.
 * - Guest rows use `username_key = 'guest:' || user_id` so two independent guests choosing the
 *   same display nickname (e.g., `"Ali_123"`) NEVER collide with each other and NEVER collide
 *   with or pollute any registered user's `username_key`!
 * - Browser clients cannot forge, claim, or merge onto another guest's identity by typing a name.
 * - When a guest registers (manual or Google OAuth), `verifyGuestSession` proves ownership of
 *   that exact `guest_user_id` so their match history & stats upgrade cleanly in-place, and the
 *   guest session is immediately revoked and cleared.
 */

import {
  sanitizeAvatarCode,
  sanitizeUsername,
} from '../../../../src/games/hokm/online/protocol';
import { CookieHeaderOptions } from '../sessionCookie';
import { D1DatabaseLike } from '../types';
import { generateOpaqueToken, generatePrefixedId, sha256Hex } from './crypto';

export const GUEST_COOKIE_NAME = 'eyvan_guest_sess';
export const DEFAULT_GUEST_SESSION_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
const GUEST_LAST_SEEN_TOUCH_MS = 5 * 60 * 1000;
const OPAQUE_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const COOKIE_DOMAIN_RE =
  /^\.?[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;

function sanitizeCookieDomain(domain?: string): string | null {
  if (!domain) return null;
  const trimmed = domain.trim().toLowerCase();
  if (!trimmed || !COOKIE_DOMAIN_RE.test(trimmed)) return null;
  return trimmed;
}

export function parseGuestCookieFromHeader(
  cookieHeader: string | null | undefined
): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key !== GUEST_COOKIE_NAME) continue;
    const rawVal = part.slice(eqIdx + 1).trim();
    if (!rawVal) return null;
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawVal);
    } catch {
      return null;
    }
    if (!OPAQUE_TOKEN_RE.test(decoded)) return null;
    return decoded;
  }
  return null;
}

export function hasGuestCookieInHeader(
  cookieHeader: string | null | undefined
): boolean {
  if (!cookieHeader) return false;
  return cookieHeader
    .split(';')
    .some((part) => part.trim().startsWith(`${GUEST_COOKIE_NAME}=`));
}

export function buildSetGuestCookieHeader(
  rawToken: string,
  secure: boolean,
  ttlSec = DEFAULT_GUEST_SESSION_TTL_SEC,
  options?: CookieHeaderOptions
): string {
  const attrs = [
    `${GUEST_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    `Max-Age=${ttlSec}`,
    'HttpOnly',
  ];
  const domain = sanitizeCookieDomain(options?.domain);
  if (domain) {
    attrs.push(`Domain=${domain}`);
  }
  if (secure) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  return attrs.join('; ');
}

export function buildClearGuestCookieHeader(
  secure: boolean,
  options?: CookieHeaderOptions
): string {
  const attrs = [
    `${GUEST_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
  ];
  const domain = sanitizeCookieDomain(options?.domain);
  if (domain) {
    attrs.push(`Domain=${domain}`);
  }
  if (secure) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  return attrs.join('; ');
}

export interface VerifiedGuestSession {
  readonly guestSessionId: string;
  readonly guestUserId: string;
  readonly username: string;
  readonly avatarCode: string;
  readonly expiresAt: number;
}

interface GuestSessionLookupRow {
  guest_session_id: string;
  guest_user_id: string;
  last_seen_at: number;
  expires_at: number;
  revoked_at: number | null;
  username: string;
  avatar_code: string;
  account_status: string;
  auth_provider: string;
}

/**
 * Verifies an incoming `eyvan_guest_sess` token strictly against `guest_sessions` and `users`.
 * Returns `null` if missing, malformed, revoked, expired, or already upgraded to a registered account.
 */
export async function verifyGuestSession(
  db: D1DatabaseLike | undefined,
  rawGuestToken: string | null | undefined,
  now = Date.now()
): Promise<VerifiedGuestSession | null> {
  if (!db || !rawGuestToken || !OPAQUE_TOKEN_RE.test(rawGuestToken)) {
    return null;
  }

  const tokenHash = await sha256Hex(rawGuestToken);
  const row = await db
    .prepare(
      `SELECT
         gs.guest_session_id,
         gs.guest_user_id,
         gs.last_seen_at,
         gs.expires_at,
         gs.revoked_at,
         u.username,
         u.avatar_code,
         u.account_status,
         u.auth_provider
       FROM guest_sessions gs
       INNER JOIN users u ON u.user_id = gs.guest_user_id
       WHERE gs.token_hash = ?
       LIMIT 1`
    )
    .bind(tokenHash)
    .first<GuestSessionLookupRow>();

  if (!row) return null;
  if (row.revoked_at !== null) return null;
  if (row.expires_at <= now) return null;
  if (row.account_status !== 'guest' || row.auth_provider !== 'guest') {
    return null;
  }

  return {
    guestSessionId: row.guest_session_id,
    guestUserId: row.guest_user_id,
    username: row.username,
    avatarCode: row.avatar_code,
    expiresAt: row.expires_at,
  };
}

export interface ResolvedGuestIdentity {
  readonly userId: string;
  readonly username: string;
  readonly avatarCode: string;
  readonly rawGuestToken?: string;
  readonly ttlSec: number;
  readonly issuedNewCookie: boolean;
}

/**
 * Resolves an existing verified guest session OR provisions a brand-new, completely isolated
 * server-side guest identity (`username_key = 'guest:' || user_id`) + `guest_sessions` record.
 */
export async function resolveOrCreateGuestIdentity(
  db: D1DatabaseLike | undefined,
  rawGuestToken: string | null | undefined,
  rawDisplayName: unknown,
  rawAvatarCode: unknown,
  now = Date.now()
): Promise<ResolvedGuestIdentity | null> {
  if (!db) return null;

  const cleanUsername = sanitizeUsername(rawDisplayName) ?? 'GuestPlayer';
  const cleanAvatar = sanitizeAvatarCode(rawAvatarCode);

  const existing = await verifyGuestSession(db, rawGuestToken, now);
  if (existing) {
    // Update display name & avatar strictly for THIS guest's own `user_id`
    const stmts = [
      db
        .prepare(
          `UPDATE users
           SET username = ?,
               display_name = ?,
               avatar_code = ?,
               last_seen_at = ?,
               updated_at = ?
           WHERE user_id = ? AND account_status = 'guest'`
        )
        .bind(cleanUsername, cleanUsername, cleanAvatar, now, now, existing.guestUserId),
    ];

    if (now - (existing.expiresAt - DEFAULT_GUEST_SESSION_TTL_SEC * 1000) >= GUEST_LAST_SEEN_TOUCH_MS) {
      stmts.push(
        db
          .prepare(
            `UPDATE guest_sessions
             SET last_seen_at = ?
             WHERE guest_session_id = ?`
          )
          .bind(now, existing.guestSessionId)
      );
    }

    await db.batch(stmts);
    return {
      userId: existing.guestUserId,
      username: cleanUsername,
      avatarCode: cleanAvatar,
      ttlSec: DEFAULT_GUEST_SESSION_TTL_SEC,
      issuedNewCookie: false,
    };
  }

  // Brand-new independent guest identity: `username_key` is scoped to `guest:<userId>`
  // so it can NEVER collide with another guest or any registered user's username.
  const guestUserId = generatePrefixedId('usr', 12);
  const guestUsernameKey = `guest:${guestUserId.toLowerCase()}`;
  const guestSessionId = generatePrefixedId('gst', 12);
  const newRawToken = generateOpaqueToken(32);
  const tokenHash = await sha256Hex(newRawToken);
  const expiresAt = now + DEFAULT_GUEST_SESSION_TTL_SEC * 1000;

  await db.batch([
    db
      .prepare(
        `INSERT INTO users (
           user_id, username, username_key, display_name,
           email, email_key, email_verified,
           avatar_code, avatar_url, auth_provider, account_status,
           created_at, last_seen_at, updated_at
         ) VALUES (?, ?, ?, ?, NULL, NULL, 0, ?, NULL, 'guest', 'guest', ?, ?, ?)`
      )
      .bind(
        guestUserId,
        cleanUsername,
        guestUsernameKey,
        cleanUsername,
        cleanAvatar,
        now,
        now,
        now
      ),
    db
      .prepare(
        `INSERT INTO guest_sessions (
           guest_session_id, guest_user_id, token_hash,
           created_at, last_seen_at, expires_at, revoked_at
         ) VALUES (?, ?, ?, ?, ?, ?, NULL)`
      )
      .bind(guestSessionId, guestUserId, tokenHash, now, now, expiresAt),
  ]);

  return {
    userId: guestUserId,
    username: cleanUsername,
    avatarCode: cleanAvatar,
    rawGuestToken: newRawToken,
    ttlSec: DEFAULT_GUEST_SESSION_TTL_SEC,
    issuedNewCookie: true,
  };
}

/**
 * Revokes all guest session tokens belonging to `guestUserId` (called upon account upgrade).
 */
export async function revokeGuestSessionsForUser(
  db: D1DatabaseLike | undefined,
  guestUserId: string,
  now = Date.now()
): Promise<void> {
  if (!db || !guestUserId) return;
  try {
    await db
      .prepare(
        `UPDATE guest_sessions
         SET revoked_at = ?
         WHERE guest_user_id = ? AND revoked_at IS NULL`
      )
      .bind(now, guestUserId)
      .run();
  } catch {
    // Non-fatal on pre-0009 databases
  }
}

/**
 * Bounded periodic cleanup of expired/revoked `guest_sessions` rows for Cron / maintenance.
 */
export async function pruneExpiredGuestSessionsBatched(
  db: D1DatabaseLike | undefined,
  options?: { now?: number; batchSize?: number; maxBatches?: number }
): Promise<number> {
  if (!db) return 0;
  const now = options?.now ?? Date.now();
  const batchSize = Math.max(10, Math.min(500, options?.batchSize ?? 200));
  const maxBatches = Math.max(1, Math.min(20, options?.maxBatches ?? 5));
  const revokedGraceCutoff = now - 7 * 24 * 60 * 60 * 1000;
  let totalDeleted = 0;

  for (let i = 0; i < maxBatches; i++) {
    const res = await db
      .prepare(
        `DELETE FROM guest_sessions
         WHERE guest_session_id IN (
           SELECT guest_session_id
           FROM guest_sessions
           WHERE expires_at <= ?
              OR (revoked_at IS NOT NULL AND revoked_at <= ?)
           LIMIT ?
         )`
      )
      .bind(now, revokedGraceCutoff, batchSize)
      .run();

    const deleted = Number(res.meta?.changes ?? 0);
    totalDeleted += deleted;
    if (deleted < batchSize) break;
  }

  return totalDeleted;
}
