/**
 * Stage C2 Authentication Flows for Eyvan Platform:
 * - Email verification (256-bit opaque token, SHA-256 hash at rest, 24h TTL, atomic single-use)
 * - Resend verification email (non-enumerating, rate-limited per IP & email, invalidates previous tokens)
 * - Forgot password (non-enumerating, rate-limited per IP & email, 1h TTL, invalidates previous tokens)
 * - Reset password (atomic single-use consume, PBKDF2-SHA256 100k re-hash, revokes ALL active sessions)
 *
 * Runs identically on Cloudflare D1 (Workers) and local SQLite (Express via SqliteD1Adapter).
 */

import { D1DatabaseLike } from '../types';
import { AuthActionResult, AuthRequestContext, AccountStatus } from './types';
import {
  generateOpaqueToken,
  generatePrefixedId,
  hashPassword,
  sha256Hex,
} from './crypto';
import {
  EmailSender,
  buildPasswordResetLink,
  buildVerificationLink,
} from './emailService';
import {
  FORGOT_PASSWORD_EMAIL_RATE_LIMIT,
  FORGOT_PASSWORD_IP_RATE_LIMIT,
  RESEND_VERIFY_RATE_LIMIT,
  RESET_PASSWORD_IP_RATE_LIMIT,
  VERIFY_EMAIL_IP_RATE_LIMIT,
  consumeRateLimitSlot,
} from './rateLimit';
import {
  validateEmail,
  validateOpaqueActionToken,
  validateResetPasswordPayload,
} from './validation';

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

interface VerificationTokenLookupRow {
  token_hash: string;
  user_id: string;
  email_key: string;
  expires_at: number;
  consumed_at: number | null;
  account_status: AccountStatus;
  user_email_key: string | null;
}

interface ResetTokenLookupRow {
  token_hash: string;
  user_id: string;
  expires_at: number;
  consumed_at: number | null;
  account_status: AccountStatus;
  identity_id: string | null;
}

interface EmailUserLookupRow {
  user_id: string;
  username: string;
  email: string;
  email_key: string;
  email_verified: number;
  account_status: AccountStatus;
}

/**
 * Verifies a user's email address using an opaque single-use token.
 * Atomically consumes the token (guarding against concurrent replay), marks `email_verified = 1`
 * and transitions `account_status` from `pending_verification` -> `active`.
 */
export async function verifyEmailWithToken(
  db: D1DatabaseLike,
  body: Record<string, unknown>,
  ctx: AuthRequestContext
): Promise<AuthActionResult> {
  const now = ctx.now ?? Date.now();
  const ipHash = await sha256Hex(`ip:${ctx.clientIp || 'unknown'}`);
  const ipRateKey = `verify_email:ip:${ipHash}`;

  const ipSlot = await consumeRateLimitSlot(
    db,
    ipRateKey,
    VERIFY_EMAIL_IP_RATE_LIMIT,
    now
  );
  if (!ipSlot.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message:
        'تعداد تلاش‌های تأیید ایمیل بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.',
      retryAfterSec: ipSlot.retryAfterSec,
    };
  }

  const tokenCheck = validateOpaqueActionToken(body.token);
  if (tokenCheck.ok === false) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_OR_EXPIRED_TOKEN',
      message: 'لینک تأیید ایمیل نامعتبر، استفاده‌شده یا منقضی شده است.',
    };
  }

  const tokenHash = await sha256Hex(tokenCheck.token);
  const row = await db
    .prepare(
      `SELECT
         t.token_hash,
         t.user_id,
         t.email_key,
         t.expires_at,
         t.consumed_at,
         u.account_status,
         u.email_key AS user_email_key
       FROM email_verification_tokens t
       INNER JOIN users u ON u.user_id = t.user_id
       WHERE t.token_hash = ?
       LIMIT 1`
    )
    .bind(tokenHash)
    .first<VerificationTokenLookupRow>();

  if (
    !row ||
    row.consumed_at !== null ||
    row.expires_at <= now ||
    row.user_email_key !== row.email_key ||
    (row.account_status !== 'pending_verification' && row.account_status !== 'active')
  ) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_OR_EXPIRED_TOKEN',
      message: 'لینک تأیید ایمیل نامعتبر، استفاده‌شده یا منقضی شده است.',
    };
  }

  // Atomic conditional consume prevents concurrent double-use of the same verification token
  const consumeRes = await db
    .prepare(
      `UPDATE email_verification_tokens
       SET consumed_at = ?
       WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?`
    )
    .bind(now, tokenHash, now)
    .run();

  if (Number(consumeRes.meta?.changes ?? 0) !== 1) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_OR_EXPIRED_TOKEN',
      message: 'لینک تأیید ایمیل نامعتبر، استفاده‌شده یا منقضی شده است.',
    };
  }

  await db.batch([
    db
      .prepare(
        `UPDATE users
         SET email_verified = 1, account_status = 'active', updated_at = ?
         WHERE user_id = ? AND account_status IN ('pending_verification', 'active')`
      )
      .bind(now, row.user_id),
    db
      .prepare(
        `UPDATE email_verification_tokens
         SET consumed_at = ?
         WHERE user_id = ? AND consumed_at IS NULL`
      )
      .bind(now, row.user_id),
  ]);

  return {
    ok: true,
    status: 200,
    verified: true,
    message:
      'ایمیل شما با موفقیت تأیید شد و حساب کاربری فعال گردید. اکنون می‌توانید وارد حساب خود شوید.',
  };
}

/**
 * Resends a fresh email verification link for a pending-verification account.
 * Invalidates all prior unconsumed verification tokens for that user.
 * Always returns a uniform non-enumerating 200 response for valid email syntax.
 */
export async function resendVerificationEmail(
  db: D1DatabaseLike,
  body: Record<string, unknown>,
  ctx: AuthRequestContext,
  emailSender: EmailSender
): Promise<AuthActionResult> {
  const now = ctx.now ?? Date.now();
  const ipHash = await sha256Hex(`ip:${ctx.clientIp || 'unknown'}`);
  const ipRateKey = `resend_verify:ip:${ipHash}`;

  const ipSlot = await consumeRateLimitSlot(
    db,
    ipRateKey,
    RESEND_VERIFY_RATE_LIMIT,
    now
  );
  if (!ipSlot.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message:
        'تعداد درخواست‌های ارسال مجدد ایمیل تأیید بیش از حد مجاز است. لطفاً کمی بعد تلاش کنید.',
      retryAfterSec: ipSlot.retryAfterSec,
    };
  }

  const emailCheck = validateEmail(body.email);
  if (emailCheck.ok === false) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: emailCheck.message,
    };
  }

  const emailRateHash = await sha256Hex(`resend_verify:${emailCheck.emailKey}`);
  const emailRateKey = `resend_verify:email:${emailRateHash}`;
  const emailSlot = await consumeRateLimitSlot(
    db,
    emailRateKey,
    RESEND_VERIFY_RATE_LIMIT,
    now
  );
  if (!emailSlot.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message:
        'تعداد درخواست‌های ارسال مجدد برای این ایمیل بیش از حد مجاز است. لطفاً کمی بعد تلاش کنید.',
      retryAfterSec: emailSlot.retryAfterSec,
    };
  }

  const uniformMessage =
    'در صورت وجود حساب تأییدنشده با این ایمیل، لینک تأیید جدید ارسال خواهد شد.';

  const user = await db
    .prepare(
      `SELECT user_id, username, email, email_key, email_verified, account_status
       FROM users
       WHERE email_key = ?
       LIMIT 1`
    )
    .bind(emailCheck.emailKey)
    .first<EmailUserLookupRow>();

  if (
    !user ||
    user.account_status !== 'pending_verification' ||
    user.email_verified === 1
  ) {
    return {
      ok: true,
      status: 200,
      message: uniformMessage,
    };
  }

  const rawToken = generateOpaqueToken(32);
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = now + EMAIL_VERIFICATION_TTL_MS;

  await db.batch([
    db
      .prepare(
        `UPDATE email_verification_tokens
         SET consumed_at = ?
         WHERE user_id = ? AND consumed_at IS NULL`
      )
      .bind(now, user.user_id),
    db
      .prepare(
        `INSERT INTO email_verification_tokens (
           token_hash, user_id, email_key, created_at, expires_at, consumed_at
         ) VALUES (?, ?, ?, ?, ?, NULL)`
      )
      .bind(tokenHash, user.user_id, user.email_key, now, expiresAt),
  ]);

  const baseUrl = ctx.publicAppBaseUrl ?? 'http://localhost:3000';
  const verifyUrl = buildVerificationLink(baseUrl, rawToken);
  await emailSender.sendVerificationEmail({
    to: user.email,
    username: user.username,
    verifyUrl,
    expiresInHours: Math.round(EMAIL_VERIFICATION_TTL_MS / (60 * 60 * 1000)),
  });

  // Never leak whether email exists or delivery matched a specific user
  return {
    ok: true,
    status: 200,
    message: uniformMessage,
  };
}

/**
 * Initiates password recovery by generating a short-lived (1h), single-use, SHA-256 hashed
 * reset token and emailing the link. Invalidates prior unconsumed reset tokens for the account.
 * Always returns a uniform non-enumerating 200 response for valid email syntax.
 */
export async function requestPasswordReset(
  db: D1DatabaseLike,
  body: Record<string, unknown>,
  ctx: AuthRequestContext,
  emailSender: EmailSender
): Promise<AuthActionResult> {
  const now = ctx.now ?? Date.now();
  const ipHash = await sha256Hex(`ip:${ctx.clientIp || 'unknown'}`);
  const ipRateKey = `forgot_password:ip:${ipHash}`;

  const ipSlot = await consumeRateLimitSlot(
    db,
    ipRateKey,
    FORGOT_PASSWORD_IP_RATE_LIMIT,
    now
  );
  if (!ipSlot.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message:
        'تعداد درخواست‌های بازیابی رمز عبور بیش از حد مجاز است. لطفاً کمی بعد تلاش کنید.',
      retryAfterSec: ipSlot.retryAfterSec,
    };
  }

  const emailCheck = validateEmail(body.email);
  if (emailCheck.ok === false) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: emailCheck.message,
    };
  }

  const emailRateHash = await sha256Hex(`forgot_password:${emailCheck.emailKey}`);
  const emailRateKey = `forgot_password:email:${emailRateHash}`;
  const emailSlot = await consumeRateLimitSlot(
    db,
    emailRateKey,
    FORGOT_PASSWORD_EMAIL_RATE_LIMIT,
    now
  );
  if (!emailSlot.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message:
        'تعداد درخواست‌های بازیابی برای این ایمیل بیش از حد مجاز است. لطفاً کمی بعد تلاش کنید.',
      retryAfterSec: emailSlot.retryAfterSec,
    };
  }

  const uniformMessage =
    'اگر حساب کاربری با این ایمیل ثبت شده باشد، لینک بازیابی رمز عبور ارسال خواهد شد.';

  const user = await db
    .prepare(
      `SELECT user_id, username, email, email_key, email_verified, account_status
       FROM users
       WHERE email_key = ?
       LIMIT 1`
    )
    .bind(emailCheck.emailKey)
    .first<EmailUserLookupRow>();

  if (
    !user ||
    (user.account_status !== 'active' &&
      user.account_status !== 'pending_verification')
  ) {
    return {
      ok: true,
      status: 200,
      message: uniformMessage,
    };
  }

  const rawToken = generateOpaqueToken(32);
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = now + PASSWORD_RESET_TTL_MS;

  await db.batch([
    db
      .prepare(
        `UPDATE password_reset_tokens
         SET consumed_at = ?
         WHERE user_id = ? AND consumed_at IS NULL`
      )
      .bind(now, user.user_id),
    db
      .prepare(
        `INSERT INTO password_reset_tokens (
           token_hash, user_id, created_at, expires_at, consumed_at
         ) VALUES (?, ?, ?, ?, NULL)`
      )
      .bind(tokenHash, user.user_id, now, expiresAt),
  ]);

  const baseUrl = ctx.publicAppBaseUrl ?? 'http://localhost:3000';
  const resetUrl = buildPasswordResetLink(baseUrl, rawToken);
  await emailSender.sendPasswordResetEmail({
    to: user.email,
    username: user.username,
    resetUrl,
    expiresInMinutes: Math.round(PASSWORD_RESET_TTL_MS / (60 * 1000)),
  });

  return {
    ok: true,
    status: 200,
    message: uniformMessage,
  };
}

/**
 * Resets a user's password using a single-use opaque reset token:
 * - Validates password strength & confirmPassword match.
 * - Atomically consumes the token (prevents concurrent replay).
 * - Hashes new password with fresh random salt (PBKDF2-HMAC-SHA256, 100k iterations).
 * - Invalidates any other open reset tokens for that user.
 * - Revokes ALL active `auth_sessions` for that user so compromised sessions are immediately terminated.
 */
export async function resetPasswordWithToken(
  db: D1DatabaseLike,
  body: Record<string, unknown>,
  ctx: AuthRequestContext
): Promise<AuthActionResult> {
  const now = ctx.now ?? Date.now();
  const ipHash = await sha256Hex(`ip:${ctx.clientIp || 'unknown'}`);
  const ipRateKey = `reset_password:ip:${ipHash}`;

  const ipSlot = await consumeRateLimitSlot(
    db,
    ipRateKey,
    RESET_PASSWORD_IP_RATE_LIMIT,
    now
  );
  if (!ipSlot.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message:
        'تعداد تلاش‌های تغییر رمز عبور بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.',
      retryAfterSec: ipSlot.retryAfterSec,
    };
  }

  const validated = validateResetPasswordPayload(body);
  if (validated.ok === false) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: validated.message,
    };
  }

  const tokenHash = await sha256Hex(validated.token);
  const row = await db
    .prepare(
      `SELECT
         t.token_hash,
         t.user_id,
         t.expires_at,
         t.consumed_at,
         u.account_status,
         ai.identity_id
       FROM password_reset_tokens t
       INNER JOIN users u ON u.user_id = t.user_id
       LEFT JOIN auth_identities ai
         ON ai.user_id = u.user_id AND ai.provider = 'password'
       WHERE t.token_hash = ?
       LIMIT 1`
    )
    .bind(tokenHash)
    .first<ResetTokenLookupRow>();

  if (
    !row ||
    row.consumed_at !== null ||
    row.expires_at <= now ||
    (row.account_status !== 'active' &&
      row.account_status !== 'pending_verification')
  ) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_OR_EXPIRED_TOKEN',
      message: 'لینک بازیابی رمز عبور نامعتبر، استفاده‌شده یا منقضی شده است.',
    };
  }

  // Atomic conditional consume prevents concurrent double-use of the same reset token
  const consumeRes = await db
    .prepare(
      `UPDATE password_reset_tokens
       SET consumed_at = ?
       WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?`
    )
    .bind(now, tokenHash, now)
    .run();

  if (Number(consumeRes.meta?.changes ?? 0) !== 1) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_OR_EXPIRED_TOKEN',
      message: 'لینک بازیابی رمز عبور نامعتبر، استفاده‌شده یا منقضی شده است.',
    };
  }

  const newPwd = await hashPassword(validated.password);
  const identityStmt = row.identity_id
    ? db
        .prepare(
          `UPDATE auth_identities
           SET password_hash = ?, password_salt = ?, password_algo = ?, updated_at = ?
           WHERE identity_id = ?`
        )
        .bind(newPwd.hash, newPwd.salt, newPwd.algo, now, row.identity_id)
    : db
        .prepare(
          `INSERT INTO auth_identities (
             identity_id, user_id, provider, provider_subject,
             password_hash, password_salt, password_algo,
             created_at, updated_at
           ) VALUES (?, ?, 'password', ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          generatePrefixedId('idn', 12),
          row.user_id,
          row.user_id,
          newPwd.hash,
          newPwd.salt,
          newPwd.algo,
          now,
          now
        );

  await db.batch([
    identityStmt,
    db
      .prepare(
        `UPDATE password_reset_tokens
         SET consumed_at = ?
         WHERE user_id = ? AND consumed_at IS NULL`
      )
      .bind(now, row.user_id),
    db
      .prepare(
        `UPDATE auth_sessions
         SET revoked_at = ?
         WHERE user_id = ? AND revoked_at IS NULL`
      )
      .bind(now, row.user_id),
    db
      .prepare(`UPDATE users SET updated_at = ? WHERE user_id = ?`)
      .bind(now, row.user_id),
  ]);

  return {
    ok: true,
    status: 200,
    passwordReset: true,
    message:
      'رمز عبور شما با موفقیت تغییر یافت و تمام نشست‌های قبلی لغو شدند. اکنون با رمز جدید وارد شوید.',
  };
}
