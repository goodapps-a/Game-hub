/**
 * Core Central Authentication Service for Eyvan Platform (C1).
 * Shared 1:1 between Cloudflare Workers (D1) and Express (SQLite via SqliteD1Adapter).
 *
 * Security Guarantees:
 * - Permanent `user_id` (`usr_...`) is the canonical platform identity.
 * - `username_key` and `email_key` enforce case-insensitive uniqueness in DB.
 * - Passwords are salted & stretched via PBKDF2-HMAC-SHA256 (100k iterations, Web Crypto).
 * - Session tokens are 256-bit random opaque tokens; ONLY SHA-256 `token_hash` is persisted.
 * - Failed logins run equal-cost dummy PBKDF2 verification to prevent account enumeration.
 * - Registration errors never reveal whether an email or username belongs to an existing account.
 * - Persistent D1/SQLite rate limiting protects registration & login endpoints.
 */

import { D1DatabaseLike } from '../types';
import {
  AccountStatus,
  AuthProvider,
  AuthRequestContext,
  AuthSessionResult,
  PublicAuthUser,
  VerifySessionResult,
} from './types';
import {
  dummyVerifyPassword,
  generateOpaqueToken,
  generatePrefixedId,
  hashPassword,
  sha256Hex,
  verifyPassword,
} from './crypto';
import { resolveAuthSessionTtlSec } from './authCookie';
import {
  LOGIN_ID_RATE_LIMIT,
  LOGIN_IP_RATE_LIMIT,
  REGISTER_IP_RATE_LIMIT,
  checkRateLimit,
  clearRateLimit,
  recordRateLimitAttempt,
} from './rateLimit';
import { validateLoginPayload, validateRegisterPayload } from './validation';

const SESSION_LAST_SEEN_TOUCH_MS = 5 * 60 * 1000; // Throttle D1 writes to once per 5 min

interface UserDbRow {
  user_id: string;
  username: string;
  username_key: string;
  display_name: string;
  email: string | null;
  email_key: string | null;
  email_verified: number;
  avatar_code: string;
  avatar_url: string | null;
  auth_provider: AuthProvider;
  account_status: AccountStatus;
  created_at: number;
  last_seen_at: number;
}

interface LoginLookupRow extends UserDbRow {
  identity_id: string | null;
  password_hash: string | null;
  password_salt: string | null;
  password_algo: string | null;
}

interface SessionLookupRow extends UserDbRow {
  session_id: string;
  session_created_at: number;
  session_last_seen_at: number;
  session_expires_at: number;
  session_revoked_at: number | null;
}

function mapUserRowToPublic(row: UserDbRow): PublicAuthUser {
  return {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    emailVerified: row.email_verified === 1,
    avatarCode: row.avatar_code,
    avatarUrl: row.avatar_url,
    authProvider: row.auth_provider,
    accountStatus: row.account_status,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

function isAccountAllowedToSignIn(status: AccountStatus): boolean {
  return status === 'active' || status === 'pending_verification';
}

function isUniqueConstraintError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE|SQLITE_CONSTRAINT/i.test(
    msg
  );
}

/**
 * Registers a new manual password-based central account and issues a server-side session.
 */
export async function registerManualAccount(
  db: D1DatabaseLike,
  body: Record<string, unknown>,
  ctx: AuthRequestContext
): Promise<AuthSessionResult> {
  const now = ctx.now ?? Date.now();
  const ttlSec = resolveAuthSessionTtlSec(ctx.sessionTtlSec);

  const ipHash = await sha256Hex(`ip:${ctx.clientIp || 'unknown'}`);
  const uaHash = await sha256Hex(`ua:${ctx.userAgent || 'unknown'}`);
  const regRateKey = `register:ip:${ipHash}`;

  const rlCheck = await checkRateLimit(db, regRateKey, REGISTER_IP_RATE_LIMIT, now);
  if (!rlCheck.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'تعداد تلاش‌های ثبت‌نام بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.',
      retryAfterSec: rlCheck.retryAfterSec,
    };
  }

  const validated = validateRegisterPayload(body);
  if (validated.ok === false) {
    await recordRateLimitAttempt(db, regRateKey, REGISTER_IP_RATE_LIMIT, now);
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: validated.message,
    };
  }

  // Record attempt before uniqueness check to throttle account probing
  await recordRateLimitAttempt(db, regRateKey, REGISTER_IP_RATE_LIMIT, now);

  // Check case-insensitive uniqueness across BOTH `email_key` and `username_key`
  // without leaking which field matched or any details about existing accounts.
  const existing = await db
    .prepare(
      `SELECT 1 AS hit
       FROM users
       WHERE email_key = ? OR username_key = ?
       LIMIT 1`
    )
    .bind(validated.emailKey, validated.usernameKey)
    .first<{ hit: number }>();

  if (existing) {
    return {
      ok: false,
      status: 409,
      code: 'ACCOUNT_CONFLICT',
      message:
        'امکان ثبت‌نام با این مشخصات وجود ندارد. لطفاً ایمیل یا نام کاربری دیگری انتخاب کنید.',
    };
  }

  const userId = generatePrefixedId('usr', 12);
  const identityId = generatePrefixedId('idn', 12);
  const sessionId = generatePrefixedId('ses', 12);
  const rawSessionToken = generateOpaqueToken(32);
  const tokenHash = await sha256Hex(rawSessionToken);
  const expiresAt = now + ttlSec * 1000;
  const pwdRecord = await hashPassword(validated.password);

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO users (
             user_id, username, username_key, display_name,
             email, email_key, email_verified,
             avatar_code, avatar_url,
             auth_provider, account_status,
             created_at, last_seen_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 0, 'portrait', NULL, 'password', 'active', ?, ?, ?)`
        )
        .bind(
          userId,
          validated.username,
          validated.usernameKey,
          validated.username,
          validated.email,
          validated.emailKey,
          now,
          now,
          now
        ),
      db
        .prepare(
          `INSERT INTO auth_identities (
             identity_id, user_id, provider, provider_subject,
             password_hash, password_salt, password_algo,
             created_at, updated_at
           ) VALUES (?, ?, 'password', ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          identityId,
          userId,
          userId,
          pwdRecord.hash,
          pwdRecord.salt,
          pwdRecord.algo,
          now,
          now
        ),
      db
        .prepare(
          `INSERT INTO auth_sessions (
             session_id, user_id, token_hash, ip_hash, user_agent_hash,
             created_at, last_seen_at, expires_at, revoked_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`
        )
        .bind(sessionId, userId, tokenHash, ipHash, uaHash, now, now, expiresAt),
    ]);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return {
        ok: false,
        status: 409,
        code: 'ACCOUNT_CONFLICT',
        message:
          'امکان ثبت‌نام با این مشخصات وجود ندارد. لطفاً ایمیل یا نام کاربری دیگری انتخاب کنید.',
      };
    }
    throw err;
  }

  return {
    ok: true,
    status: 201,
    user: {
      userId,
      username: validated.username,
      displayName: validated.username,
      email: validated.email,
      emailVerified: false,
      avatarCode: 'portrait',
      avatarUrl: null,
      authProvider: 'password',
      accountStatus: 'active',
      createdAt: now,
      lastSeenAt: now,
    },
    session: {
      sessionId,
      createdAt: now,
      expiresAt,
    },
    rawSessionToken,
    sessionTtlSec: ttlSec,
  };
}

/**
 * Authenticates a user by email or username + password, enforcing rate limits,
 * timing-safe verification, and account status checks.
 */
export async function loginWithCredentials(
  db: D1DatabaseLike,
  body: Record<string, unknown>,
  ctx: AuthRequestContext
): Promise<AuthSessionResult> {
  const now = ctx.now ?? Date.now();
  const ttlSec = resolveAuthSessionTtlSec(ctx.sessionTtlSec);

  const ipHash = await sha256Hex(`ip:${ctx.clientIp || 'unknown'}`);
  const uaHash = await sha256Hex(`ua:${ctx.userAgent || 'unknown'}`);
  const ipRateKey = `login:ip:${ipHash}`;

  const ipLimit = await checkRateLimit(db, ipRateKey, LOGIN_IP_RATE_LIMIT, now);
  if (!ipLimit.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'تعداد تلاش‌های ورود بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.',
      retryAfterSec: ipLimit.retryAfterSec,
    };
  }

  const validated = validateLoginPayload(body);
  if (validated.ok === false) {
    await recordRateLimitAttempt(db, ipRateKey, LOGIN_IP_RATE_LIMIT, now);
    return {
      ok: false,
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'ایمیل/نام کاربری یا رمز عبور نادرست است.',
    };
  }

  const idHash = await sha256Hex(
    `login:${validated.identifierType}:${validated.identifierKey}:${ipHash}`
  );
  const idRateKey = `login:id:${idHash}`;

  const idLimit = await checkRateLimit(db, idRateKey, LOGIN_ID_RATE_LIMIT, now);
  if (!idLimit.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'تعداد تلاش‌های ناموفق ورود بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.',
      retryAfterSec: idLimit.retryAfterSec,
    };
  }

  const whereClause =
    validated.identifierType === 'email'
      ? `u.email_key = ?`
      : `u.username_key = ?`;

  const row = await db
    .prepare(
      `SELECT
         u.user_id, u.username, u.username_key, u.display_name,
         u.email, u.email_key, u.email_verified,
         u.avatar_code, u.avatar_url, u.auth_provider, u.account_status,
         u.created_at, u.last_seen_at,
         ai.identity_id, ai.password_hash, ai.password_salt, ai.password_algo
       FROM users u
       LEFT JOIN auth_identities ai
         ON ai.user_id = u.user_id AND ai.provider = 'password'
       WHERE ${whereClause}
       LIMIT 1`
    )
    .bind(validated.identifierKey)
    .first<LoginLookupRow>();

  if (
    !row ||
    !row.password_hash ||
    !row.password_salt ||
    !row.password_algo
  ) {
    // Always run equal-cost PBKDF2 to prevent timing-based account existence leaks
    await dummyVerifyPassword(validated.password);
    await recordRateLimitAttempt(db, ipRateKey, LOGIN_IP_RATE_LIMIT, now);
    await recordRateLimitAttempt(db, idRateKey, LOGIN_ID_RATE_LIMIT, now);
    return {
      ok: false,
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'ایمیل/نام کاربری یا رمز عبور نادرست است.',
    };
  }

  const pwdCheck = await verifyPassword(validated.password, {
    hash: row.password_hash,
    salt: row.password_salt,
    algo: row.password_algo,
  });

  if (!pwdCheck.valid) {
    await recordRateLimitAttempt(db, ipRateKey, LOGIN_IP_RATE_LIMIT, now);
    await recordRateLimitAttempt(db, idRateKey, LOGIN_ID_RATE_LIMIT, now);
    return {
      ok: false,
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'ایمیل/نام کاربری یا رمز عبور نادرست است.',
    };
  }

  // Only reveal disabled/suspended state AFTER verifying the caller knows the valid password
  if (!isAccountAllowedToSignIn(row.account_status)) {
    return {
      ok: false,
      status: 403,
      code: 'ACCOUNT_DISABLED',
      message: 'این حساب کاربری مسدود یا غیرفعال شده است.',
    };
  }

  // Reset per-identifier rate limit upon valid login
  await clearRateLimit(db, idRateKey);

  const sessionId = generatePrefixedId('ses', 12);
  const rawSessionToken = generateOpaqueToken(32);
  const tokenHash = await sha256Hex(rawSessionToken);
  const expiresAt = now + ttlSec * 1000;

  const stmts = [
    db
      .prepare(
        `INSERT INTO auth_sessions (
           session_id, user_id, token_hash, ip_hash, user_agent_hash,
           created_at, last_seen_at, expires_at, revoked_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .bind(sessionId, row.user_id, tokenHash, ipHash, uaHash, now, now, expiresAt),
    db
      .prepare(
        `UPDATE users SET last_seen_at = ?, updated_at = ? WHERE user_id = ?`
      )
      .bind(now, now, row.user_id),
  ];

  // Transparently upgrade password hash if algorithm parameters were upgraded
  if (pwdCheck.needsRehash && row.identity_id) {
    const upgraded = await hashPassword(validated.password);
    stmts.push(
      db
        .prepare(
          `UPDATE auth_identities
           SET password_hash = ?, password_salt = ?, password_algo = ?, updated_at = ?
           WHERE identity_id = ?`
        )
        .bind(upgraded.hash, upgraded.salt, upgraded.algo, now, row.identity_id)
    );
  }

  await db.batch(stmts);

  const publicUser = mapUserRowToPublic({
    ...row,
    last_seen_at: now,
  });

  return {
    ok: true,
    status: 200,
    user: publicUser,
    session: {
      sessionId,
      createdAt: now,
      expiresAt,
    },
    rawSessionToken,
    sessionTtlSec: ttlSec,
  };
}

/**
 * Verifies an opaque `eyvan_auth_sess` token strictly against `auth_sessions` + `users`.
 * Rejects revoked, expired, missing, or suspended/deleted sessions cleanly.
 */
export async function verifyAuthSession(
  db: D1DatabaseLike,
  rawToken: string | null,
  now = Date.now()
): Promise<VerifySessionResult> {
  if (!rawToken) {
    return {
      authenticated: false,
      user: null,
      session: null,
      shouldClearCookie: false,
    };
  }

  const tokenHash = await sha256Hex(rawToken);
  const row = await db
    .prepare(
      `SELECT
         s.session_id,
         s.created_at AS session_created_at,
         s.last_seen_at AS session_last_seen_at,
         s.expires_at AS session_expires_at,
         s.revoked_at AS session_revoked_at,
         u.user_id, u.username, u.username_key, u.display_name,
         u.email, u.email_key, u.email_verified,
         u.avatar_code, u.avatar_url, u.auth_provider, u.account_status,
         u.created_at, u.last_seen_at
       FROM auth_sessions s
       INNER JOIN users u ON u.user_id = s.user_id
       WHERE s.token_hash = ?
       LIMIT 1`
    )
    .bind(tokenHash)
    .first<SessionLookupRow>();

  if (
    !row ||
    row.session_revoked_at !== null ||
    row.session_expires_at <= now ||
    !isAccountAllowedToSignIn(row.account_status)
  ) {
    return {
      authenticated: false,
      user: null,
      session: null,
      shouldClearCookie: true,
    };
  }

  if (now - row.session_last_seen_at >= SESSION_LAST_SEEN_TOUCH_MS) {
    try {
      await db
        .prepare(`UPDATE auth_sessions SET last_seen_at = ? WHERE session_id = ?`)
        .bind(now, row.session_id)
        .run();
    } catch {
      // Non-fatal touch failure
    }
  }

  return {
    authenticated: true,
    user: mapUserRowToPublic(row),
    session: {
      sessionId: row.session_id,
      createdAt: row.session_created_at,
      expiresAt: row.session_expires_at,
    },
    shouldClearCookie: false,
  };
}

/**
 * Revokes a single session on the server by its opaque cookie token.
 */
export async function revokeAuthSessionByToken(
  db: D1DatabaseLike,
  rawToken: string | null,
  now = Date.now()
): Promise<boolean> {
  if (!rawToken) return false;
  const tokenHash = await sha256Hex(rawToken);
  const res = await db
    .prepare(
      `UPDATE auth_sessions
       SET revoked_at = ?
       WHERE token_hash = ? AND revoked_at IS NULL`
    )
    .bind(now, tokenHash)
    .run();
  return Number(res.meta?.changes ?? 0) > 0;
}

/**
 * Revokes ALL active sessions for a user on the server (used by logout-all and C2 password reset).
 */
export async function revokeAllAuthSessionsForUser(
  db: D1DatabaseLike,
  userId: string,
  now = Date.now()
): Promise<number> {
  const res = await db
    .prepare(
      `UPDATE auth_sessions
       SET revoked_at = ?
       WHERE user_id = ? AND revoked_at IS NULL`
    )
    .bind(now, userId)
    .run();
  return Number(res.meta?.changes ?? 0);
}

/**
 * Revokes a specific session owned by `userId`.
 */
export async function revokeAuthSessionById(
  db: D1DatabaseLike,
  userId: string,
  sessionId: string,
  now = Date.now()
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE auth_sessions
       SET revoked_at = ?
       WHERE session_id = ? AND user_id = ? AND revoked_at IS NULL`
    )
    .bind(now, sessionId, userId)
    .run();
  return Number(res.meta?.changes ?? 0) > 0;
}
