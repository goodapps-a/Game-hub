/**
 * Unified HTTP handler for Eyvan Central Auth (`/api/auth/*`, C1 + C2).
 * Shared 1:1 by Cloudflare Worker (`cloudflare/src/index.ts`) and Express (`server/createExpressApp.ts`)
 * so security checks, CSRF guards, cookie flags, status codes, and response shapes are identical.
 *
 * Routes:
 * - POST /api/auth/register
 * - POST /api/auth/login
 * - POST /api/auth/logout
 * - POST /api/auth/logout-all
 * - GET  /api/auth/me
 * - POST /api/auth/verify-email
 * - POST /api/auth/resend-verification
 * - POST /api/auth/forgot-password
 * - POST /api/auth/reset-password
 */

import { readBoundedUtf8Body } from '../httpBounds';
import { CookieHeaderOptions } from '../sessionCookie';
import { D1DatabaseLike } from '../types';
import {
  buildClearAuthCookieHeader,
  buildSetAuthCookieHeader,
  hasAuthCookieInHeader,
  parseAuthCookieFromHeader,
} from './authCookie';
import {
  loginWithCredentials,
  registerManualAccount,
  revokeAllAuthSessionsForUser,
  revokeAuthSessionByToken,
  verifyAuthSession,
} from './authService';
import {
  requestPasswordReset,
  resendVerificationEmail,
  resetPasswordWithToken,
  verifyEmailWithToken,
} from './c2Service';
import { EmailSender, createEmailSender } from './emailService';

const MAX_AUTH_BODY_BYTES = 8 * 1024; // 8KB strict cap for auth payloads
export const CSRF_CLIENT_HEADER_NAME = 'X-Requested-With';
export const CSRF_CLIENT_HEADER_VALUE = 'eyvan-client';

export interface AuthHttpEnv {
  readonly db: D1DatabaseLike;
  readonly corsHeaders: Record<string, string>;
  readonly secureCookie: boolean;
  readonly cookieOptions?: CookieHeaderOptions;
  readonly originAllowed: boolean;
  readonly clientIp: string;
  readonly userAgent: string;
  readonly sessionTtlSec?: string | number;
  readonly now?: number;
  readonly publicAppBaseUrl?: string;
  readonly isProduction?: boolean;
  readonly emailSender?: EmailSender;
}

function buildAuthResponse(
  payload: unknown,
  status: number,
  corsHeaders: Record<string, string>,
  extraHeaders?: Record<string, string>
): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private',
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    ...corsHeaders,
  });
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers.set(k, v);
    }
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

function verifyMutatingCsrf(
  request: Request,
  env: AuthHttpEnv,
  requireJsonContentType: boolean
): Response | null {
  if (!env.originAllowed) {
    return buildAuthResponse(
      {
        ok: false,
        code: 'FORBIDDEN_ORIGIN',
        message: 'مبدا درخواست مجاز نیست.',
      },
      403,
      env.corsHeaders
    );
  }

  // Require custom non-simple header so cross-site HTML forms & simple requests cannot forge state changes
  const xrw = request.headers.get(CSRF_CLIENT_HEADER_NAME);
  if (xrw !== CSRF_CLIENT_HEADER_VALUE) {
    return buildAuthResponse(
      {
        ok: false,
        code: 'CSRF_REJECTED',
        message: 'درخواست فاقد هدر امنیتی معتبر است.',
      },
      403,
      env.corsHeaders
    );
  }

  // Reject cross-site Sec-Fetch-Site when browser sends it alongside untrusted context
  const secFetchSite = request.headers.get('Sec-Fetch-Site')?.toLowerCase();
  const hasOrigin = Boolean(request.headers.get('Origin'));
  if (secFetchSite === 'cross-site' && !hasOrigin) {
    return buildAuthResponse(
      {
        ok: false,
        code: 'CSRF_REJECTED',
        message: 'درخواست بین‌سایتی بدون مبدا مجاز رد شد.',
      },
      403,
      env.corsHeaders
    );
  }

  if (requireJsonContentType) {
    const contentType = (request.headers.get('Content-Type') ?? '').toLowerCase();
    if (!contentType.includes('application/json')) {
      return buildAuthResponse(
        {
          ok: false,
          code: 'INVALID_INPUT',
          message: 'نوع محتوای درخواست باید application/json باشد.',
        },
        415,
        env.corsHeaders
      );
    }
  }

  return null;
}

async function parseJsonObjectBody(
  request: Request,
  corsHeaders: Record<string, string>
): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  const bodyRead = await readBoundedUtf8Body(request, MAX_AUTH_BODY_BYTES);
  if (bodyRead.ok === false) {
    return {
      ok: false,
      response: buildAuthResponse(
        {
          ok: false,
          code: 'INVALID_INPUT',
          message:
            bodyRead.status === 413
              ? 'حجم درخواست بیش از حد مجاز است.'
              : 'خطا در خواندن بدنه درخواست.',
        },
        bodyRead.status,
        corsHeaders
      ),
    };
  }

  try {
    const parsed: unknown = JSON.parse(bodyRead.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        response: buildAuthResponse(
          {
            ok: false,
            code: 'INVALID_INPUT',
            message: 'ساختار بدنه درخواست نامعتبر است.',
          },
          400,
          corsHeaders
        ),
      };
    }
    return { ok: true, data: parsed as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      response: buildAuthResponse(
        {
          ok: false,
          code: 'INVALID_INPUT',
          message: 'فرمت JSON درخواست نامعتبر است.',
        },
        400,
        corsHeaders
      ),
    };
  }
}

export async function handleAuthHttpRequest(
  request: Request,
  pathname: string,
  env: AuthHttpEnv
): Promise<Response | null> {
  const method = request.method.toUpperCase();
  const now = env.now ?? Date.now();
  const ttlSec =
    env.sessionTtlSec !== undefined ? Number(env.sessionTtlSec) : undefined;
  const emailSender = env.emailSender ?? createEmailSender({ provider: 'disabled' });

  // 1) GET /api/auth/me — Verify central account session via `eyvan_auth_sess`
  if (pathname === '/api/auth/me' && method === 'GET') {
    try {
      const rawCookieHeader = request.headers.get('Cookie');
      const rawToken = parseAuthCookieFromHeader(rawCookieHeader);
      const hadCookie = hasAuthCookieInHeader(rawCookieHeader);

      if (!rawToken) {
        const extra = hadCookie
          ? {
              'Set-Cookie': buildClearAuthCookieHeader(
                env.secureCookie,
                env.cookieOptions
              ),
            }
          : undefined;
        return buildAuthResponse(
          { ok: true, authenticated: false, user: null, session: null },
          200,
          env.corsHeaders,
          extra
        );
      }

      const verified = await verifyAuthSession(env.db, rawToken, now);
      if (!verified.authenticated) {
        const extra = verified.shouldClearCookie
          ? {
              'Set-Cookie': buildClearAuthCookieHeader(
                env.secureCookie,
                env.cookieOptions
              ),
            }
          : undefined;
        return buildAuthResponse(
          { ok: true, authenticated: false, user: null, session: null },
          200,
          env.corsHeaders,
          extra
        );
      }

      return buildAuthResponse(
        {
          ok: true,
          authenticated: true,
          user: verified.user,
          session: verified.session,
        },
        200,
        env.corsHeaders
      );
    } catch (err) {
      console.error(
        '[Auth] /api/auth/me error:',
        err instanceof Error ? err.message : 'unknown'
      );
      return buildAuthResponse(
        {
          ok: false,
          code: 'DATABASE_ERROR',
          message: 'خطا در بررسی وضعیت حساب کاربری.',
        },
        503,
        env.corsHeaders
      );
    }
  }

  // 2) POST /api/auth/register — Manual registration in pending_verification state + verification email
  if (pathname === '/api/auth/register' && method === 'POST') {
    const csrfErr = verifyMutatingCsrf(request, env, true);
    if (csrfErr) return csrfErr;

    const parsedBody = await parseJsonObjectBody(request, env.corsHeaders);
    if (parsedBody.ok === false) return parsedBody.response;

    try {
      const result = await registerManualAccount(
        env.db,
        parsedBody.data,
        {
          clientIp: env.clientIp,
          userAgent: env.userAgent,
          now,
          sessionTtlSec: ttlSec,
          publicAppBaseUrl: env.publicAppBaseUrl,
          isProduction: env.isProduction,
        },
        emailSender
      );

      if (result.ok === false) {
        const extra =
          result.retryAfterSec !== undefined
            ? { 'Retry-After': String(result.retryAfterSec) }
            : undefined;
        return buildAuthResponse(
          {
            ok: false,
            code: result.code,
            message: result.message,
          },
          result.status,
          env.corsHeaders,
          extra
        );
      }

      // No privileged eyvan_auth_sess cookie until email is verified
      return buildAuthResponse(
        {
          ok: true,
          authenticated: false,
          verificationRequired: true,
          emailDelivery: result.emailDelivery,
          message: result.message,
          user: result.user,
        },
        result.status,
        env.corsHeaders
      );
    } catch (err) {
      console.error(
        '[Auth] /api/auth/register error:',
        err instanceof Error ? err.message : 'unknown'
      );
      return buildAuthResponse(
        {
          ok: false,
          code: 'DATABASE_ERROR',
          message: 'خطای داخلی در ثبت‌نام رخ داد. لطفاً دوباره تلاش کنید.',
        },
        500,
        env.corsHeaders
      );
    }
  }

  // 3) POST /api/auth/login — Login by email or username + password (requires verified active account)
  if (pathname === '/api/auth/login' && method === 'POST') {
    const csrfErr = verifyMutatingCsrf(request, env, true);
    if (csrfErr) return csrfErr;

    const parsedBody = await parseJsonObjectBody(request, env.corsHeaders);
    if (parsedBody.ok === false) return parsedBody.response;

    try {
      const result = await loginWithCredentials(env.db, parsedBody.data, {
        clientIp: env.clientIp,
        userAgent: env.userAgent,
        now,
        sessionTtlSec: ttlSec,
      });

      if (result.ok === false) {
        const extra =
          result.retryAfterSec !== undefined
            ? { 'Retry-After': String(result.retryAfterSec) }
            : undefined;
        return buildAuthResponse(
          {
            ok: false,
            code: result.code,
            message: result.message,
            ...(result.verificationRequired ? { verificationRequired: true } : {}),
          },
          result.status,
          env.corsHeaders,
          extra
        );
      }

      const setCookie = buildSetAuthCookieHeader(
        result.rawSessionToken,
        env.secureCookie,
        result.sessionTtlSec,
        env.cookieOptions
      );

      return buildAuthResponse(
        {
          ok: true,
          authenticated: true,
          user: result.user,
          session: result.session,
        },
        result.status,
        env.corsHeaders,
        { 'Set-Cookie': setCookie }
      );
    } catch (err) {
      console.error(
        '[Auth] /api/auth/login error:',
        err instanceof Error ? err.message : 'unknown'
      );
      return buildAuthResponse(
        {
          ok: false,
          code: 'DATABASE_ERROR',
          message: 'خطای داخلی در ورود رخ داد. لطفاً دوباره تلاش کنید.',
        },
        500,
        env.corsHeaders
      );
    }
  }

  // 4) POST /api/auth/logout — Revoke current account session & clear ONLY `eyvan_auth_sess`
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const csrfErr = verifyMutatingCsrf(request, env, false);
    if (csrfErr) return csrfErr;

    try {
      const rawToken = parseAuthCookieFromHeader(request.headers.get('Cookie'));
      if (rawToken) {
        await revokeAuthSessionByToken(env.db, rawToken, now);
      }
      return buildAuthResponse(
        { ok: true, authenticated: false },
        200,
        env.corsHeaders,
        {
          'Set-Cookie': buildClearAuthCookieHeader(
            env.secureCookie,
            env.cookieOptions
          ),
        }
      );
    } catch (err) {
      console.error(
        '[Auth] /api/auth/logout error:',
        err instanceof Error ? err.message : 'unknown'
      );
      return buildAuthResponse(
        {
          ok: false,
          code: 'DATABASE_ERROR',
          message: 'خطا در خروج از حساب کاربری.',
        },
        500,
        env.corsHeaders
      );
    }
  }

  // 5) POST /api/auth/logout-all — Revoke ALL server sessions for the authenticated user
  if (pathname === '/api/auth/logout-all' && method === 'POST') {
    const csrfErr = verifyMutatingCsrf(request, env, false);
    if (csrfErr) return csrfErr;

    try {
      const rawToken = parseAuthCookieFromHeader(request.headers.get('Cookie'));
      const verified = await verifyAuthSession(env.db, rawToken, now);
      if (!verified.authenticated || !verified.user) {
        return buildAuthResponse(
          {
            ok: false,
            code: 'UNAUTHORIZED',
            message: 'نشست کاربری معتبری یافت نشد.',
          },
          401,
          env.corsHeaders,
          {
            'Set-Cookie': buildClearAuthCookieHeader(
              env.secureCookie,
              env.cookieOptions
            ),
          }
        );
      }

      const revokedCount = await revokeAllAuthSessionsForUser(
        env.db,
        verified.user.userId,
        now
      );

      return buildAuthResponse(
        { ok: true, authenticated: false, revokedCount },
        200,
        env.corsHeaders,
        {
          'Set-Cookie': buildClearAuthCookieHeader(
            env.secureCookie,
            env.cookieOptions
          ),
        }
      );
    } catch (err) {
      console.error(
        '[Auth] /api/auth/logout-all error:',
        err instanceof Error ? err.message : 'unknown'
      );
      return buildAuthResponse(
        {
          ok: false,
          code: 'DATABASE_ERROR',
          message: 'خطا در لغو نشست‌های فعال.',
        },
        500,
        env.corsHeaders
      );
    }
  }

  // 6) POST /api/auth/verify-email — Single-use email verification token activation
  if (pathname === '/api/auth/verify-email' && method === 'POST') {
    const csrfErr = verifyMutatingCsrf(request, env, true);
    if (csrfErr) return csrfErr;

    const parsedBody = await parseJsonObjectBody(request, env.corsHeaders);
    if (parsedBody.ok === false) return parsedBody.response;

    try {
      const result = await verifyEmailWithToken(env.db, parsedBody.data, {
        clientIp: env.clientIp,
        userAgent: env.userAgent,
        now,
      });

      if (result.ok === false) {
        const extra =
          result.retryAfterSec !== undefined
            ? { 'Retry-After': String(result.retryAfterSec) }
            : undefined;
        return buildAuthResponse(
          {
            ok: false,
            code: result.code,
            message: result.message,
          },
          result.status,
          env.corsHeaders,
          extra
        );
      }

      return buildAuthResponse(
        {
          ok: true,
          verified: true,
          message: result.message,
        },
        result.status,
        env.corsHeaders
      );
    } catch (err) {
      console.error(
        '[Auth] /api/auth/verify-email error:',
        err instanceof Error ? err.message : 'unknown'
      );
      return buildAuthResponse(
        {
          ok: false,
          code: 'DATABASE_ERROR',
          message: 'خطای داخلی در تأیید ایمیل رخ داد.',
        },
        500,
        env.corsHeaders
      );
    }
  }

  // 7) POST /api/auth/resend-verification — Non-enumerating resend with rate limit & prior token invalidation
  if (pathname === '/api/auth/resend-verification' && method === 'POST') {
    const csrfErr = verifyMutatingCsrf(request, env, true);
    if (csrfErr) return csrfErr;

    const parsedBody = await parseJsonObjectBody(request, env.corsHeaders);
    if (parsedBody.ok === false) return parsedBody.response;

    try {
      const result = await resendVerificationEmail(
        env.db,
        parsedBody.data,
        {
          clientIp: env.clientIp,
          userAgent: env.userAgent,
          now,
          publicAppBaseUrl: env.publicAppBaseUrl,
          isProduction: env.isProduction,
        },
        emailSender
      );

      if (result.ok === false) {
        const extra =
          result.retryAfterSec !== undefined
            ? { 'Retry-After': String(result.retryAfterSec) }
            : undefined;
        return buildAuthResponse(
          {
            ok: false,
            code: result.code,
            message: result.message,
          },
          result.status,
          env.corsHeaders,
          extra
        );
      }

      return buildAuthResponse(
        {
          ok: true,
          message: result.message,
        },
        result.status,
        env.corsHeaders
      );
    } catch (err) {
      console.error(
        '[Auth] /api/auth/resend-verification error:',
        err instanceof Error ? err.message : 'unknown'
      );
      return buildAuthResponse(
        {
          ok: false,
          code: 'DATABASE_ERROR',
          message: 'خطای داخلی در ارسال مجدد ایمیل تأیید رخ داد.',
        },
        500,
        env.corsHeaders
      );
    }
  }

  // 8) POST /api/auth/forgot-password — Non-enumerating password reset request with rate limit
  if (pathname === '/api/auth/forgot-password' && method === 'POST') {
    const csrfErr = verifyMutatingCsrf(request, env, true);
    if (csrfErr) return csrfErr;

    const parsedBody = await parseJsonObjectBody(request, env.corsHeaders);
    if (parsedBody.ok === false) return parsedBody.response;

    try {
      const result = await requestPasswordReset(
        env.db,
        parsedBody.data,
        {
          clientIp: env.clientIp,
          userAgent: env.userAgent,
          now,
          publicAppBaseUrl: env.publicAppBaseUrl,
          isProduction: env.isProduction,
        },
        emailSender
      );

      if (result.ok === false) {
        const extra =
          result.retryAfterSec !== undefined
            ? { 'Retry-After': String(result.retryAfterSec) }
            : undefined;
        return buildAuthResponse(
          {
            ok: false,
            code: result.code,
            message: result.message,
          },
          result.status,
          env.corsHeaders,
          extra
        );
      }

      return buildAuthResponse(
        {
          ok: true,
          message: result.message,
        },
        result.status,
        env.corsHeaders
      );
    } catch (err) {
      console.error(
        '[Auth] /api/auth/forgot-password error:',
        err instanceof Error ? err.message : 'unknown'
      );
      return buildAuthResponse(
        {
          ok: false,
          code: 'DATABASE_ERROR',
          message: 'خطای داخلی در ثبت درخواست بازیابی رمز عبور رخ داد.',
        },
        500,
        env.corsHeaders
      );
    }
  }

  // 9) POST /api/auth/reset-password — Atomic single-use reset + revoke all sessions + clear auth cookie
  if (pathname === '/api/auth/reset-password' && method === 'POST') {
    const csrfErr = verifyMutatingCsrf(request, env, true);
    if (csrfErr) return csrfErr;

    const parsedBody = await parseJsonObjectBody(request, env.corsHeaders);
    if (parsedBody.ok === false) return parsedBody.response;

    try {
      const result = await resetPasswordWithToken(env.db, parsedBody.data, {
        clientIp: env.clientIp,
        userAgent: env.userAgent,
        now,
      });

      if (result.ok === false) {
        const extra =
          result.retryAfterSec !== undefined
            ? { 'Retry-After': String(result.retryAfterSec) }
            : undefined;
        return buildAuthResponse(
          {
            ok: false,
            code: result.code,
            message: result.message,
          },
          result.status,
          env.corsHeaders,
          extra
        );
      }

      const hadAuthCookie = hasAuthCookieInHeader(request.headers.get('Cookie'));
      const extra = hadAuthCookie
        ? {
            'Set-Cookie': buildClearAuthCookieHeader(
              env.secureCookie,
              env.cookieOptions
            ),
          }
        : undefined;

      return buildAuthResponse(
        {
          ok: true,
          passwordReset: true,
          message: result.message,
        },
        result.status,
        env.corsHeaders,
        extra
      );
    } catch (err) {
      console.error(
        '[Auth] /api/auth/reset-password error:',
        err instanceof Error ? err.message : 'unknown'
      );
      return buildAuthResponse(
        {
          ok: false,
          code: 'DATABASE_ERROR',
          message: 'خطای داخلی در تغییر رمز عبور رخ داد.',
        },
        500,
        env.corsHeaders
      );
    }
  }

  return null;
}
