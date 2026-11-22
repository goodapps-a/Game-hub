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
  ActiveAuthSessionItem,
  AuthProvider,
  AuthRegisterResult,
  AuthRequestContext,
  AuthSessionResult,
  LinkedAuthProvider,
  PublicAuthUser,
  VerifySessionResult,
} from './types';
import {
  EmailDeliveryResult,
  EmailSender,
  buildVerificationLink,
  createEmailSender,
  deliverEmailSafely,
} from './emailService';
import { EMAIL_VERIFICATION_TTL_MS } from './c2Service';
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
  PROFILE_UPDATE_USER_RATE_LIMIT,
  REGISTER_IP_RATE_LIMIT,
  USERNAME_CHECK_IP_RATE_LIMIT,
  clearRateLimit,
  consumeRateLimitSlot,
  releaseRateLimitSlot,
} from './rateLimit';
import {
  validateAuthUsername,
  validateLoginPayload,
  validateProfileUpdatePayload,
  validateRegisterPayload,
} from './validation';

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

function isAccountActiveAndVerified(
  status: AccountStatus,
  emailVerified: number
): boolean {
  return status === 'active' && emailVerified === 1;
}

function isUniqueConstraintError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /UNIQUE constraint failed|NOT NULL constraint failed|SQLITE_CONSTRAINT_UNIQUE|SQLITE_CONSTRAINT_NOTNULL/i.test(
    msg
  );
}

/**
 * Registers a new manual password-based central account in `pending_verification` state,
 * creates a single-use SHA-256 hashed email verification token (24h TTL), and sends the
 * verification email. Does NOT issue a privileged account session until email is verified.
 */
export async function registerManualAccount(
  db: D1DatabaseLike,
  body: Record<string, unknown>,
  ctx: AuthRequestContext,
  emailSender?: EmailSender
): Promise<AuthRegisterResult> {
  const now = ctx.now ?? Date.now();
  const sender = emailSender ?? createEmailSender({ provider: 'disabled' });

  const ipHash = await sha256Hex(`ip:${ctx.clientIp || 'unknown'}`);
  const regRateKey = `register:ip:${ipHash}`;

  // Atomic check-and-increment prevents concurrent bursts from exceeding 10 attempts / 15 min
  const rlSlot = await consumeRateLimitSlot(
    db,
    regRateKey,
    REGISTER_IP_RATE_LIMIT,
    now
  );
  if (!rlSlot.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message:
        'تعداد تلاش‌های ثبت‌نام بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.',
      retryAfterSec: rlSlot.retryAfterSec,
    };
  }

  const validated = validateRegisterPayload(body);
  if (validated.ok === false) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: validated.message,
    };
  }

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
  const rawVerifyToken = generateOpaqueToken(32);
  const verifyTokenHash = await sha256Hex(rawVerifyToken);
  const verifyExpiresAt = now + EMAIL_VERIFICATION_TTL_MS;
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
           ) VALUES (?, ?, ?, ?, ?, ?, 0, 'portrait', NULL, 'password', 'pending_verification', ?, ?, ?)`
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
          `INSERT INTO email_verification_tokens (
             token_hash, user_id, email_key, created_at, expires_at, consumed_at
           ) VALUES (?, ?, ?, ?, ?, NULL)`
        )
        .bind(
          verifyTokenHash,
          userId,
          validated.emailKey,
          now,
          verifyExpiresAt
        ),
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

  let delivery: EmailDeliveryResult;
  if (ctx.isProduction && !ctx.publicAppBaseUrl) {
    delivery = {
      configured: false,
      sent: false,
      provider: 'unconfigured',
      errorCode: 'PUBLIC_APP_URL_UNCONFIGURED',
    };
  } else {
    const baseUrl = ctx.publicAppBaseUrl ?? 'http://localhost:3000';
    const verifyUrl = buildVerificationLink(baseUrl, rawVerifyToken);
    delivery = await deliverEmailSafely(() =>
      sender.sendVerificationEmail({
        to: validated.email,
        username: validated.username,
        verifyUrl,
        expiresInHours: Math.round(EMAIL_VERIFICATION_TTL_MS / (60 * 60 * 1000)),
      })
    );
  }

  if (!delivery.sent) {
    console.error(
      `[AuthEmail] Delivery did not complete action=register provider=${delivery.provider} configured=${delivery.configured} code=${delivery.errorCode ?? 'EMAIL_DELIVERY_FAILED'}`
    );
  }

  const message = delivery.sent
    ? 'حساب کاربری شما ساخته شد. لطفاً لینک تأیید ارسال‌شده به ایمیل خود را باز کنید تا حساب فعال شود.'
    : delivery.configured
    ? 'حساب کاربری شما ساخته شد اما ارسال ایمیل تأیید با خطا مواجه شد. لطفاً از گزینه «ارسال مجدد ایمیل تأیید» استفاده کنید.'
    : 'حساب کاربری شما در وضعیت در انتظار تأیید ایمیل ثبت شد. سرویس ارسال ایمیل روی سرور پیکربندی نشده است.';

  return {
    ok: true,
    status: 201,
    verificationRequired: true,
    emailDelivery: {
      configured: delivery.configured,
      sent: delivery.sent,
    },
    internalDelivery: delivery,
    message,
    user: {
      userId,
      username: validated.username,
      displayName: validated.username,
      email: validated.email,
      emailVerified: false,
      avatarCode: 'portrait',
      avatarUrl: null,
      authProvider: 'password',
      accountStatus: 'pending_verification',
      createdAt: now,
      lastSeenAt: now,
    },
  };
}

/**
 * Authenticates a user by email or username + password, enforcing atomic rate limits
 * (reserve-before-hash, release-on-success), timing-safe verification, and account status checks.
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

  // Atomically reserve 1 IP slot BEFORE password verification (released on success)
  const ipSlot = await consumeRateLimitSlot(
    db,
    ipRateKey,
    LOGIN_IP_RATE_LIMIT,
    now
  );
  if (!ipSlot.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message:
        'تعداد تلاش‌های ورود بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.',
      retryAfterSec: ipSlot.retryAfterSec,
    };
  }

  const validated = validateLoginPayload(body);
  if (validated.ok === false) {
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

  // Atomically reserve 1 IP+identifier slot BEFORE password verification (cleared on success)
  const idSlot = await consumeRateLimitSlot(
    db,
    idRateKey,
    LOGIN_ID_RATE_LIMIT,
    now
  );
  if (!idSlot.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message:
        'تعداد تلاش‌های ناموفق ورود بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.',
      retryAfterSec: idSlot.retryAfterSec,
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
    return {
      ok: false,
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'ایمیل/نام کاربری یا رمز عبور نادرست است.',
    };
  }

  // Only reveal account status AFTER verifying the caller knows the valid password
  if (row.account_status === 'suspended' || row.account_status === 'deleted' || row.account_status === 'guest') {
    return {
      ok: false,
      status: 403,
      code: 'ACCOUNT_DISABLED',
      message: 'این حساب کاربری مسدود یا غیرفعال شده است.',
    };
  }

  if (row.account_status === 'pending_verification' || row.email_verified !== 1) {
    // Password was valid; do not penalize rate-limit failure counter, but block login until email verified
    await clearRateLimit(db, idRateKey);
    await releaseRateLimitSlot(db, ipRateKey, LOGIN_IP_RATE_LIMIT, now);
    return {
      ok: false,
      status: 403,
      code: 'EMAIL_NOT_VERIFIED',
      verificationRequired: true,
      message:
        'ایمیل این حساب هنوز تأیید نشده است. لطفاً ابتدا لینک تأیید ارسال‌شده به ایمیل خود را باز کنید.',
    };
  }

  // Valid login: clear per-identifier counter and release the reserved IP slot
  await clearRateLimit(db, idRateKey);
  await releaseRateLimitSlot(db, ipRateKey, LOGIN_IP_RATE_LIMIT, now);

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
    !isAccountActiveAndVerified(row.account_status, row.email_verified)
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
 * Revokes a single session on the server by its opaque cookie token
 * and immediately removes any online presence leases tied to that session.
 */
export async function revokeAuthSessionByToken(
  db: D1DatabaseLike,
  rawToken: string | null,
  now = Date.now()
): Promise<boolean> {
  if (!rawToken) return false;
  const tokenHash = await sha256Hex(rawToken);

  // Look up session_id first so we can clear its presence leases immediately on logout
  const sessionRow = await db
    .prepare(
      `SELECT session_id FROM auth_sessions WHERE token_hash = ? LIMIT 1`
    )
    .bind(tokenHash)
    .first<{ session_id: string }>();

  const res = await db
    .prepare(
      `UPDATE auth_sessions
       SET revoked_at = ?
       WHERE token_hash = ? AND revoked_at IS NULL`
    )
    .bind(now, tokenHash)
    .run();

  if (sessionRow?.session_id) {
    try {
      await db
        .prepare(`DELETE FROM user_presence_sessions WHERE auth_session_id = ?`)
        .bind(sessionRow.session_id)
        .run();
    } catch {
      // Non-fatal on pre-0007 databases
    }
  }

  return Number(res.meta?.changes ?? 0) > 0;
}

/**
 * Revokes ALL active sessions for a user on the server (used by logout-all and C2 password reset)
 * and immediately clears all online presence leases for that user.
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

  try {
    await db
      .prepare(`DELETE FROM user_presence_sessions WHERE user_id = ?`)
      .bind(userId)
      .run();
  } catch {
    // Non-fatal on pre-0007 databases
  }

  return Number(res.meta?.changes ?? 0);
}

/**
 * Revokes a specific session owned by `userId` and clears its presence leases.
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

  try {
    await db
      .prepare(`DELETE FROM user_presence_sessions WHERE auth_session_id = ?`)
      .bind(sessionId)
      .run();
  } catch {
    // Non-fatal on pre-0007 databases
  }

  return Number(res.meta?.changes ?? 0) > 0;
}

/**
 * Lists non-revoked, non-expired sessions for `userId` (safe metadata only — never exposes token hashes).
 */
export async function listActiveAuthSessions(
  db: D1DatabaseLike,
  userId: string,
  currentSessionId: string | null,
  now = Date.now()
): Promise<ActiveAuthSessionItem[]> {
  const res = await db
    .prepare(
      `SELECT session_id, created_at, last_seen_at, expires_at
       FROM auth_sessions
       WHERE user_id = ?
         AND revoked_at IS NULL
         AND expires_at > ?
       ORDER BY last_seen_at DESC, created_at DESC
       LIMIT 25`
    )
    .bind(userId, now)
    .all<{
      session_id: string;
      created_at: number;
      last_seen_at: number;
      expires_at: number;
    }>();

  return (res.results ?? []).map((row) => ({
    sessionId: row.session_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    isCurrent: currentSessionId !== null && row.session_id === currentSessionId,
  }));
}

/**
 * Lists linked authentication providers (`password`, `google`) for `userId`.
 */
export async function listLinkedAuthProviders(
  db: D1DatabaseLike,
  userId: string
): Promise<LinkedAuthProvider[]> {
  const res = await db
    .prepare(
      `SELECT provider
       FROM auth_identities
       WHERE user_id = ?
       ORDER BY provider ASC`
    )
    .bind(userId)
    .all<{ provider: string }>();

  const out: LinkedAuthProvider[] = [];
  for (const row of res.results ?? []) {
    if (row.provider === 'password' || row.provider === 'google') {
      out.push(row.provider);
    }
  }
  return out;
}

export interface UsernameAvailabilityResult {
  readonly ok: true;
  readonly status: number;
  readonly valid: boolean;
  readonly available: boolean;
  readonly reason: 'invalid' | 'available' | 'current_user' | 'taken';
  readonly message: string;
}

export type UsernameAvailabilityResponseResult =
  | UsernameAvailabilityResult
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: 'RATE_LIMITED';
      readonly message: string;
      readonly retryAfterSec?: number;
    };

/**
 * Checks case-insensitive username uniqueness against `users.username_key` on the server.
 * If `currentUserId` owns the matching row, returns `available: true` (`current_user`).
 */
export async function checkUsernameAvailability(
  db: D1DatabaseLike,
  rawUsername: unknown,
  currentUserId: string | null,
  ctx: AuthRequestContext
): Promise<UsernameAvailabilityResponseResult> {
  const now = ctx.now ?? Date.now();
  const ipHash = await sha256Hex(`ip:${ctx.clientIp || 'unknown'}`);
  const rl = await consumeRateLimitSlot(
    db,
    `username_check:ip:${ipHash}`,
    USERNAME_CHECK_IP_RATE_LIMIT,
    now
  );
  if (!rl.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'تعداد بررسی نام کاربری بیش از حد مجاز است. لطفاً کمی صبر کنید.',
      retryAfterSec: rl.retryAfterSec,
    };
  }

  const validated = validateAuthUsername(rawUsername);
  if (validated.ok === false) {
    return {
      ok: true,
      status: 200,
      valid: false,
      available: false,
      reason: 'invalid',
      message: validated.message,
    };
  }

  const existing = await db
    .prepare(
      `SELECT user_id
       FROM users
       WHERE username_key = ?
       LIMIT 1`
    )
    .bind(validated.usernameKey)
    .first<{ user_id: string }>();

  if (!existing) {
    return {
      ok: true,
      status: 200,
      valid: true,
      available: true,
      reason: 'available',
      message: 'تایید سرور: این نام کاربری آزاد و قابل انتخاب است.',
    };
  }

  if (currentUserId && existing.user_id === currentUserId) {
    return {
      ok: true,
      status: 200,
      valid: true,
      available: true,
      reason: 'current_user',
      message: 'این نام کاربری فعلی حساب شماست.',
    };
  }

  return {
    ok: true,
    status: 200,
    valid: true,
    available: false,
    reason: 'taken',
    message: 'این نام کاربری قبلاً در سرور ثبت شده است.',
  };
}

export type ProfileUpdateResult =
  | {
      readonly ok: true;
      readonly status: number;
      readonly user: PublicAuthUser;
      readonly message: string;
    }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code:
        | 'UNAUTHORIZED'
        | 'INVALID_INPUT'
        | 'ACCOUNT_CONFLICT'
        | 'RATE_LIMITED';
      readonly message: string;
      readonly shouldClearCookie?: boolean;
      readonly retryAfterSec?: number;
    };

/**
 * Updates `username`, `username_key`, `display_name`, and `avatar_code` for an
 * authenticated central user (`eyvan_auth_sess`). Permanent `user_id` is strictly immutable.
 */
export async function updateAuthenticatedProfile(
  db: D1DatabaseLike,
  rawSessionToken: string | null,
  body: Record<string, unknown>,
  ctx: AuthRequestContext
): Promise<ProfileUpdateResult> {
  const now = ctx.now ?? Date.now();
  const verified = await verifyAuthSession(db, rawSessionToken, now);
  if (!verified.authenticated || !verified.user) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'برای ذخیره پروفایل مرکزی باید وارد حساب کاربری شوید.',
      shouldClearCookie: verified.shouldClearCookie,
    };
  }

  const rl = await consumeRateLimitSlot(
    db,
    `profile_update:user:${verified.user.userId}`,
    PROFILE_UPDATE_USER_RATE_LIMIT,
    now
  );
  if (!rl.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'تعداد تغییرات پروفایل بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.',
      retryAfterSec: rl.retryAfterSec,
    };
  }

  const validated = validateProfileUpdatePayload(body);
  if (validated.ok === false) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: validated.message,
    };
  }

  const conflict = await db
    .prepare(
      `SELECT 1 AS hit
       FROM users
       WHERE username_key = ? AND user_id != ?
       LIMIT 1`
    )
    .bind(validated.usernameKey, verified.user.userId)
    .first<{ hit: number }>();

  if (conflict) {
    return {
      ok: false,
      status: 409,
      code: 'ACCOUNT_CONFLICT',
      message: 'این نام کاربری قبلاً توسط کاربر دیگری ثبت شده است.',
    };
  }

  try {
    await db
      .prepare(
        `UPDATE users
         SET username = ?,
             username_key = ?,
             display_name = ?,
             avatar_code = ?,
             username_changed_at = CASE
               WHEN username_key != ? THEN ?
               ELSE username_changed_at
             END,
             updated_at = ?
         WHERE user_id = ?`
      )
      .bind(
        validated.username,
        validated.usernameKey,
        validated.username,
        validated.avatarCode,
        validated.usernameKey,
        now,
        now,
        verified.user.userId
      )
      .run();
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return {
        ok: false,
        status: 409,
        code: 'ACCOUNT_CONFLICT',
        message: 'این نام کاربری قبلاً توسط کاربر دیگری ثبت شده است.',
      };
    }
    throw err;
  }

  const updatedRow = await db
    .prepare(
      `SELECT
         user_id, username, username_key, display_name,
         email, email_key, email_verified,
         avatar_code, avatar_url, auth_provider, account_status,
         created_at, last_seen_at
       FROM users
       WHERE user_id = ?
       LIMIT 1`
    )
    .bind(verified.user.userId)
    .first<UserDbRow>();

  if (!updatedRow) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'حساب کاربری یافت نشد.',
      shouldClearCookie: true,
    };
  }

  return {
    ok: true,
    status: 200,
    user: mapUserRowToPublic(updatedRow),
    message: 'تغییرات پروفایل با موفقیت ذخیره شد.',
  };
}

/**
 * Safely upgrades a server-verified guest `users` row (`account_status = 'guest'`)
 * into a registered central account IN-PLACE so the permanent `user_id`, all
 * `user_game_stats`, and all `match_players.user_id` records remain 100% preserved.
 *
 * Security invariant:
 * - Only upgrades rows whose current `account_status === 'guest'` and `auth_provider === 'guest'`.
 * - Enforces global uniqueness for `email_key` and `username_key` excluding `guestUserId`.
 * - Enters `pending_verification` and issues a single-use SHA-256 verification token.
 */
export async function upgradeGuestAccountToRegistered(
  db: D1DatabaseLike,
  guestUserId: string,
  body: Record<string, unknown>,
  ctx: AuthRequestContext,
  emailSender?: EmailSender
): Promise<AuthRegisterResult> {
  const now = ctx.now ?? Date.now();
  const sender = emailSender ?? createEmailSender({ provider: 'disabled' });

  // Enforce the exact same IP rate limit as manual registration so guest sessions cannot bypass it
  const ipHash = await sha256Hex(`ip:${ctx.clientIp || 'unknown'}`);
  const regRateKey = `register:ip:${ipHash}`;
  const rlSlot = await consumeRateLimitSlot(
    db,
    regRateKey,
    REGISTER_IP_RATE_LIMIT,
    now
  );
  if (!rlSlot.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message:
        'تعداد تلاش‌های ثبت‌نام بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.',
      retryAfterSec: rlSlot.retryAfterSec,
    };
  }

  const validated = validateRegisterPayload(body);
  if (validated.ok === false) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: validated.message,
    };
  }

  const [guestRow, guestSessSummary] = await Promise.all([
    db
      .prepare(
        `SELECT
           user_id, username, username_key, display_name,
           email, email_key, email_verified,
           avatar_code, avatar_url, auth_provider, account_status,
           created_at, last_seen_at
         FROM users
         WHERE user_id = ?
         LIMIT 1`
      )
      .bind(guestUserId)
      .first<UserDbRow>(),
    db
      .prepare(
        `SELECT
           COUNT(*) AS total_cnt,
           COALESCE(SUM(CASE WHEN revoked_at IS NULL AND expires_at > ? THEN 1 ELSE 0 END), 0) AS active_cnt
         FROM guest_sessions
         WHERE guest_user_id = ?`
      )
      .bind(now, guestUserId)
      .first<{ total_cnt: number; active_cnt: number }>(),
  ]);

  if (
    !guestRow ||
    guestRow.account_status !== 'guest' ||
    guestRow.auth_provider !== 'guest'
  ) {
    return {
      ok: false,
      status: 409,
      code: 'ACCOUNT_CONFLICT',
      message: 'حساب مهمان معتبر برای ارتقا یافت نشد.',
    };
  }

  const totalGuestSess = Number(guestSessSummary?.total_cnt ?? 0);
  const activeGuestSess = Number(guestSessSummary?.active_cnt ?? 0);
  const mustRequireActiveSess = Boolean(ctx.requireActiveGuestSession) || totalGuestSess > 0;
  if (mustRequireActiveSess && activeGuestSess === 0) {
    return {
      ok: false,
      status: 401,
      code: 'INVALID_OR_EXPIRED_TOKEN',
      message: 'نشست مهمان منقضی یا لغو شده است. لطفاً دوباره اقدام کنید.',
    };
  }

  const conflict = await db
    .prepare(
      `SELECT 1 AS hit
       FROM users
       WHERE (email_key = ? OR username_key = ?)
         AND user_id != ?
       LIMIT 1`
    )
    .bind(validated.emailKey, validated.usernameKey, guestUserId)
    .first<{ hit: number }>();

  if (conflict) {
    return {
      ok: false,
      status: 409,
      code: 'ACCOUNT_CONFLICT',
      message:
        'امکان ثبت‌نام با این مشخصات وجود ندارد. لطفاً ایمیل یا نام کاربری دیگری انتخاب کنید.',
    };
  }

  const identityId = generatePrefixedId('idn', 12);
  const rawVerifyToken = generateOpaqueToken(32);
  const verifyTokenHash = await sha256Hex(rawVerifyToken);
  const verifyExpiresAt = now + EMAIL_VERIFICATION_TTL_MS;
  const pwdRecord = await hashPassword(validated.password);

  // Atomic single-transaction upgrade:
  // 1) Conditional CAS UPDATE users (only while still guest/guest)
  // 2) INSERT auth_identities guarded by NOT NULL subquery requiring exact upgraded state,
  //    zero existing identities, AND an active non-expired guest_sessions row
  //    (rolls back entire batch on concurrent manual/Google race or mid-operation guest expiry!)
  // 3) INSERT email_verification_tokens
  // 4) Revoke all guest_sessions inside the SAME atomic batch transaction
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE users
           SET username = ?,
               username_key = ?,
               display_name = ?,
               email = ?,
               email_key = ?,
               email_verified = 0,
               auth_provider = 'password',
               account_status = 'pending_verification',
               last_seen_at = ?,
               updated_at = ?
           WHERE user_id = ?
             AND account_status = 'guest'
             AND auth_provider = 'guest'`
        )
        .bind(
          validated.username,
          validated.usernameKey,
          validated.username,
          validated.email,
          validated.emailKey,
          now,
          now,
          guestUserId
        ),
      db
        .prepare(
          `INSERT INTO auth_identities (
             identity_id, user_id, provider, provider_subject,
             password_hash, password_salt, password_algo,
             created_at, updated_at
           ) VALUES (
             ?,
             (
               SELECT u.user_id
               FROM users u
               WHERE u.user_id = ?
                 AND u.account_status = 'pending_verification'
                 AND u.auth_provider = 'password'
                 AND u.email_key = ?
                 AND NOT EXISTS (
                   SELECT 1 FROM auth_identities ai WHERE ai.user_id = u.user_id
                 )
                 AND (
                   EXISTS (
                     SELECT 1 FROM guest_sessions gs
                     WHERE gs.guest_user_id = u.user_id
                       AND gs.revoked_at IS NULL
                       AND gs.expires_at > ?
                   )
                   OR (
                     ? = 0
                     AND NOT EXISTS (
                       SELECT 1 FROM guest_sessions gs_any
                       WHERE gs_any.guest_user_id = u.user_id
                     )
                   )
                 )
             ),
             'password', ?, ?, ?, ?, ?, ?
           )`
        )
        .bind(
          identityId,
          guestUserId,
          validated.emailKey,
          now,
          ctx.requireActiveGuestSession ? 1 : 0,
          guestUserId,
          pwdRecord.hash,
          pwdRecord.salt,
          pwdRecord.algo,
          now,
          now
        ),
      db
        .prepare(
          `INSERT INTO email_verification_tokens (
             token_hash, user_id, email_key, created_at, expires_at, consumed_at
           ) VALUES (?, ?, ?, ?, ?, NULL)`
        )
        .bind(
          verifyTokenHash,
          guestUserId,
          validated.emailKey,
          now,
          verifyExpiresAt
        ),
      db
        .prepare(
          `UPDATE guest_sessions
           SET revoked_at = ?
           WHERE guest_user_id = ? AND revoked_at IS NULL`
        )
        .bind(now, guestUserId),
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

  let delivery: EmailDeliveryResult;
  if (ctx.isProduction && !ctx.publicAppBaseUrl) {
    delivery = {
      configured: false,
      sent: false,
      provider: 'unconfigured',
      errorCode: 'PUBLIC_APP_URL_UNCONFIGURED',
    };
  } else {
    const baseUrl = ctx.publicAppBaseUrl ?? 'http://localhost:3000';
    const verifyUrl = buildVerificationLink(baseUrl, rawVerifyToken);
    delivery = await deliverEmailSafely(() =>
      sender.sendVerificationEmail({
        to: validated.email,
        username: validated.username,
        verifyUrl,
        expiresInHours: Math.round(EMAIL_VERIFICATION_TTL_MS / (60 * 60 * 1000)),
      })
    );
  }

  return {
    ok: true,
    status: 201,
    verificationRequired: true,
    emailDelivery: {
      configured: delivery.configured,
      sent: delivery.sent,
    },
    internalDelivery: delivery,
    message: delivery.sent
      ? 'حساب مهمان با حفظ شناسه و سوابق به حساب مرکزی ارتقا یافت. لطفاً ایمیل خود را تأیید کنید.'
      : 'حساب مهمان با حفظ شناسه و سوابق در انتظار تأیید ایمیل ثبت شد.',
    user: {
      userId: guestUserId,
      username: validated.username,
      displayName: validated.username,
      email: validated.email,
      emailVerified: false,
      avatarCode: guestRow.avatar_code,
      avatarUrl: guestRow.avatar_url,
      authProvider: 'password',
      accountStatus: 'pending_verification',
      createdAt: guestRow.created_at,
      lastSeenAt: now,
    },
  };
}


