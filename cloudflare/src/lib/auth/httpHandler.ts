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
  checkEmailExists,
  checkUsernameAvailability,
  listActiveAuthSessions,
  listLinkedAuthProviders,
  loginWithCredentials,
  registerManualAccount,
  revokeAllAuthSessionsForUser,
  revokeAuthSessionById,
  revokeAuthSessionByToken,
  updateAuthenticatedProfile,
  upgradeGuestAccountToRegistered,
  verifyAuthSession,
} from './authService';
import {
  requestPasswordReset,
  resendVerificationEmail,
  resetPasswordWithToken,
  verifyEmailWithToken,
} from './c2Service';
import { sha256Hex } from './crypto';
import { EmailSender, createEmailSender } from './emailService';
import {
  GoogleOAuthConfig,
  buildClearLegacyOAuthBindCookieHeader,
  buildClearOAuthBindCookieHeader,
  buildSetOAuthBindCookieHeader,
  completeGoogleOAuthCallback,
  isGoogleOAuthConfigured,
  parseAllOAuthBindCookiesFromHeader,
  resolveGoogleCallbackRedirectUri,
  resolveOAuthBindSameSiteMode,
  startGoogleOAuthFlow,
} from './googleOAuthService';
import {
  buildClearGuestCookieHeader,
  inspectGuestSession,
  parseGuestCookieFromHeader,
} from './guestSession';
import {
  OAUTH_CALLBACK_IP_RATE_LIMIT,
  OAUTH_START_IP_RATE_LIMIT,
  consumeRateLimitSlot,
} from './rateLimit';

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
  readonly googleOAuth?: GoogleOAuthConfig;
}

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveValidatedHttpOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function buildOAuthPopupHtmlResponse(
  payload: {
    readonly ok: boolean;
    readonly flowMode: 'login' | 'link';
    readonly flowId?: string | null;
    readonly code?: string;
    readonly message: string;
  },
  targetOrigin: string,
  status: number,
  setCookies: string[],
  extraHeaders?: Record<string, string>
): Response {
  const safeTargetOrigin = resolveValidatedHttpOrigin(targetOrigin);
  const safeJson = JSON.stringify({
    type: 'EYVAN_OAUTH_RESULT',
    ok: payload.ok,
    flowMode: payload.flowMode,
    flowId: payload.flowId ?? null,
    code: payload.code ?? null,
    message: payload.message,
  }).replace(/</g, '\\u003c');
  const safeTargetOriginJs = safeTargetOrigin
    ? JSON.stringify(safeTargetOrigin).replace(/</g, '\\u003c')
    : 'null';

  const safeTitle = payload.ok
    ? 'احراز هویت با گوگل انجام شد'
    : 'خطا در احراز هویت با گوگل';
  const safeMsg = escapeHtmlText(payload.message);

  const html = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    body { margin:0; font-family: system-ui, sans-serif; background:#091124; color:#F8FAFC; display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px; text-align:center; }
    .card { max-width:360px; background:#111E3A; border:1px solid rgba(212,174,88,0.35); border-radius:16px; padding:24px; }
    h1 { font-size:16px; margin:0 0 10px; color:#F3D179; }
    p { font-size:13px; line-height:1.7; margin:0; color:#CBD5E1; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${safeTitle}</h1>
    <p>${safeMsg}</p>
  </div>
  <script>
    (function () {
      var data = ${safeJson};
      var targetOrigin = ${safeTargetOriginJs};
      try {
        if (targetOrigin && window.opener && !window.opener.closed) {
          window.opener.postMessage(data, targetOrigin);
          window.close();
          return;
        }
      } catch (e) {}
      setTimeout(function () { window.location.replace(targetOrigin ? targetOrigin + '/' : '/'); }, 1200);
    })();
  </script>
</body>
</html>`;

  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, private',
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers.set(k, v);
    }
  }
  for (const cookie of setCookies) {
    headers.append('Set-Cookie', cookie);
  }
  return new Response(html, { status, headers });
}

function buildAuthResponse(
  payload: unknown,
  status: number,
  corsHeaders: Record<string, string>,
  extraHeaders?: Record<string, string>,
  extraSetCookies?: readonly string[]
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
  if (extraSetCookies) {
    for (const cookie of extraSetCookies) {
      headers.append('Set-Cookie', cookie);
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

      const providers = verified.user
        ? await listLinkedAuthProviders(env.db, verified.user.userId)
        : [];

      return buildAuthResponse(
        {
          ok: true,
          authenticated: true,
          user: verified.user,
          session: verified.session,
          providers,
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
      const rawGuestToken = parseGuestCookieFromHeader(
        request.headers.get('Cookie')
      );
      const guestInspection = rawGuestToken
        ? await inspectGuestSession(env.db, rawGuestToken, now)
        : null;

      if (guestInspection?.status === 'revoked_or_upgraded') {
        return buildAuthResponse(
          {
            ok: false,
            code: 'ACCOUNT_CONFLICT',
            message:
              'حساب مهمان شما قبلاً ارتقا یافته یا دیگر معتبر نیست. لطفاً وارد حساب کاربری خود شوید.',
          },
          409,
          env.corsHeaders,
          {
            'Set-Cookie': buildClearGuestCookieHeader(
              env.secureCookie,
              env.cookieOptions
            ),
          }
        );
      }

      if (guestInspection?.status === 'expired') {
        return buildAuthResponse(
          {
            ok: false,
            code: 'INVALID_OR_EXPIRED_TOKEN',
            message:
              'نشست مهمان شما منقضی شده است. لطفاً دوباره برای ثبت‌نام اقدام کنید.',
          },
          401,
          env.corsHeaders,
          {
            'Set-Cookie': buildClearGuestCookieHeader(
              env.secureCookie,
              env.cookieOptions
            ),
          }
        );
      }

      const verifiedGuest =
        guestInspection?.status === 'valid' ? guestInspection.session : null;

      const reqCtx = {
        clientIp: env.clientIp,
        userAgent: env.userAgent,
        now,
        sessionTtlSec: ttlSec,
        publicAppBaseUrl: env.publicAppBaseUrl,
        isProduction: env.isProduction,
        requireActiveGuestSession: Boolean(verifiedGuest),
      };

      const result = verifiedGuest
        ? await upgradeGuestAccountToRegistered(
            env.db,
            verifiedGuest.guestUserId,
            parsedBody.data,
            reqCtx,
            emailSender
          )
        : await registerManualAccount(
            env.db,
            parsedBody.data,
            reqCtx,
            emailSender
          );

      if (result.ok === false) {
        const extra: Record<string, string> = {};
        if (result.retryAfterSec !== undefined) {
          extra['Retry-After'] = String(result.retryAfterSec);
        }
        // If a guest upgrade failed because the guest session expired or was concurrently upgraded,
        // clear the stale guest cookie (but keep it intact for simple username/email conflicts).
        if (verifiedGuest) {
          const postCheck =
            result.code === 'INVALID_OR_EXPIRED_TOKEN'
              ? { status: 'expired' as const }
              : result.code === 'ACCOUNT_CONFLICT'
                ? await inspectGuestSession(env.db, rawGuestToken, now)
                : null;
          if (
            postCheck &&
            (postCheck.status === 'expired' ||
              postCheck.status === 'revoked_or_upgraded')
          ) {
            extra['Set-Cookie'] = buildClearGuestCookieHeader(
              env.secureCookie,
              env.cookieOptions
            );
          }
        }
        return buildAuthResponse(
          {
            ok: false,
            code: result.code,
            message: result.message,
          },
          result.status,
          env.corsHeaders,
          Object.keys(extra).length > 0 ? extra : undefined
        );
      }

      const extra = verifiedGuest
        ? {
            'Set-Cookie': buildClearGuestCookieHeader(
              env.secureCookie,
              env.cookieOptions
            ),
          }
        : undefined;

      // No privileged eyvan_auth_sess cookie until email is verified
      return buildAuthResponse(
        {
          ok: true,
          authenticated: false,
          verificationRequired: true,
          upgradedFromGuest: Boolean(verifiedGuest),
          emailDelivery: result.emailDelivery,
          message: result.message,
          user: result.user,
        },
        result.status,
        env.corsHeaders,
        extra
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

  // 10) GET /api/auth/username-availability — Server DB uniqueness check for username editing
  if (pathname === '/api/auth/username-availability' && method === 'GET') {
    try {
      const reqUrl = new URL(request.url);
      const rawUsername = reqUrl.searchParams.get('username') ?? '';
      const rawToken = parseAuthCookieFromHeader(request.headers.get('Cookie'));
      const verified = rawToken
        ? await verifyAuthSession(env.db, rawToken, now)
        : null;
      const currentUserId =
        verified && verified.authenticated && verified.user
          ? verified.user.userId
          : null;

      const result = await checkUsernameAvailability(
        env.db,
        rawUsername,
        currentUserId,
        {
          clientIp: env.clientIp,
          userAgent: env.userAgent,
          now,
        }
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
          valid: result.valid,
          available: result.available,
          reason: result.reason,
          message: result.message,
        },
        result.status,
        env.corsHeaders
      );
    } catch (err) {
      console.error(
        '[Auth] /api/auth/username-availability error:',
        err instanceof Error ? err.message : 'unknown'
      );
      return buildAuthResponse(
        {
          ok: false,
          code: 'DATABASE_ERROR',
          message: 'خطا در بررسی نام کاربری روی سرور.',
        },
        503,
        env.corsHeaders
      );
    }
  }

  // 10b) POST /api/auth/check-email — Unified Email-First flow lookup (login vs register)
  if (pathname === '/api/auth/check-email' && method === 'POST') {
    const csrfErr = verifyMutatingCsrf(request, env, true);
    if (csrfErr) return csrfErr;

    const parsedBody = await parseJsonObjectBody(request, env.corsHeaders);
    if (parsedBody.ok === false) return parsedBody.response;

    try {
      const result = await checkEmailExists(env.db, parsedBody.data.email, {
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
          exists: result.exists,
          email: result.email,
        },
        result.status,
        env.corsHeaders
      );
    } catch (err) {
      console.error(
        '[Auth] /api/auth/check-email error:',
        err instanceof Error ? err.message : 'unknown'
      );
      return buildAuthResponse(
        {
          ok: false,
          code: 'DATABASE_ERROR',
          message: 'خطا در بررسی ایمیل روی سرور.',
        },
        503,
        env.corsHeaders
      );
    }
  }

  // 11) POST /api/auth/profile — Persist username/avatar changes for authenticated central user
  if (pathname === '/api/auth/profile' && method === 'POST') {
    const csrfErr = verifyMutatingCsrf(request, env, true);
    if (csrfErr) return csrfErr;

    const parsedBody = await parseJsonObjectBody(request, env.corsHeaders);
    if (parsedBody.ok === false) return parsedBody.response;

    try {
      const rawToken = parseAuthCookieFromHeader(request.headers.get('Cookie'));
      const result = await updateAuthenticatedProfile(
        env.db,
        rawToken,
        parsedBody.data,
        {
          clientIp: env.clientIp,
          userAgent: env.userAgent,
          now,
        }
      );

      if (result.ok === false) {
        const extra: Record<string, string> = {};
        if (result.retryAfterSec !== undefined) {
          extra['Retry-After'] = String(result.retryAfterSec);
        }
        if (result.shouldClearCookie) {
          extra['Set-Cookie'] = buildClearAuthCookieHeader(
            env.secureCookie,
            env.cookieOptions
          );
        }
        return buildAuthResponse(
          {
            ok: false,
            code: result.code,
            message: result.message,
          },
          result.status,
          env.corsHeaders,
          Object.keys(extra).length > 0 ? extra : undefined
        );
      }

      return buildAuthResponse(
        {
          ok: true,
          user: result.user,
          message: result.message,
        },
        result.status,
        env.corsHeaders
      );
    } catch (err) {
      console.error(
        '[Auth] /api/auth/profile error:',
        err instanceof Error ? err.message : 'unknown'
      );
      return buildAuthResponse(
        {
          ok: false,
          code: 'DATABASE_ERROR',
          message: 'خطای داخلی در ذخیره تغییرات پروفایل رخ داد.',
        },
        500,
        env.corsHeaders
      );
    }
  }

  // 12) GET /api/auth/sessions — List active sessions for the currently authenticated user
  if (pathname === '/api/auth/sessions' && method === 'GET') {
    try {
      const rawToken = parseAuthCookieFromHeader(request.headers.get('Cookie'));
      const verified = rawToken
        ? await verifyAuthSession(env.db, rawToken, now)
        : null;
      if (!verified || !verified.authenticated || !verified.user || !verified.session) {
        return buildAuthResponse(
          {
            ok: false,
            code: 'UNAUTHORIZED',
            message: 'برای مشاهده نشست‌های فعال ابتدا وارد شوید.',
          },
          401,
          env.corsHeaders
        );
      }

      const [sessions, providers] = await Promise.all([
        listActiveAuthSessions(
          env.db,
          verified.user.userId,
          verified.session.sessionId,
          now
        ),
        listLinkedAuthProviders(env.db, verified.user.userId),
      ]);

      return buildAuthResponse(
        {
          ok: true,
          sessions,
          providers,
        },
        200,
        env.corsHeaders
      );
    } catch (err) {
      console.error(
        '[Auth] /api/auth/sessions error:',
        err instanceof Error ? err.message : 'unknown'
      );
      return buildAuthResponse(
        {
          ok: false,
          code: 'DATABASE_ERROR',
          message: 'خطا در خواندن فهرست نشست‌های فعال.',
        },
        503,
        env.corsHeaders
      );
    }
  }

  // 13) POST /api/auth/sessions/revoke — Revoke a specific session strictly owned by current user
  if (pathname === '/api/auth/sessions/revoke' && method === 'POST') {
    const csrfErr = verifyMutatingCsrf(request, env, true);
    if (csrfErr) return csrfErr;

    const parsedBody = await parseJsonObjectBody(request, env.corsHeaders);
    if (parsedBody.ok === false) return parsedBody.response;

    try {
      const rawToken = parseAuthCookieFromHeader(request.headers.get('Cookie'));
      const verified = rawToken
        ? await verifyAuthSession(env.db, rawToken, now)
        : null;
      if (!verified || !verified.authenticated || !verified.user || !verified.session) {
        return buildAuthResponse(
          {
            ok: false,
            code: 'UNAUTHORIZED',
            message: 'برای لغو نشست ابتدا باید وارد حساب کاربری شوید.',
          },
          401,
          env.corsHeaders
        );
      }

      const targetSessionId =
        typeof parsedBody.data.sessionId === 'string'
          ? parsedBody.data.sessionId.trim()
          : '';
      if (!targetSessionId || !/^ses_[a-zA-Z0-9_-]{8,64}$/.test(targetSessionId)) {
        return buildAuthResponse(
          {
            ok: false,
            code: 'INVALID_INPUT',
            message: 'شناسه نشست نامعتبر است.',
          },
          400,
          env.corsHeaders
        );
      }

      const revoked = await revokeAuthSessionById(
        env.db,
        verified.user.userId,
        targetSessionId,
        now
      );
      if (!revoked) {
        return buildAuthResponse(
          {
            ok: false,
            code: 'INVALID_OR_EXPIRED_TOKEN',
            message: 'نشست مورد نظر یافت نشد یا قبلاً لغو شده است.',
          },
          404,
          env.corsHeaders
        );
      }

      const isCurrent = targetSessionId === verified.session.sessionId;
      const extra = isCurrent
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
          revokedSessionId: targetSessionId,
          revokedCurrentSession: isCurrent,
          message: 'نشست انتخاب‌شده با موفقیت لغو شد.',
        },
        200,
        env.corsHeaders,
        extra
      );
    } catch (err) {
      console.error(
        '[Auth] /api/auth/sessions/revoke error:',
        err instanceof Error ? err.message : 'unknown'
      );
      return buildAuthResponse(
        {
          ok: false,
          code: 'DATABASE_ERROR',
          message: 'خطای داخلی در لغو نشست رخ داد.',
        },
        500,
        env.corsHeaders
      );
    }
  }

  // 14) GET /api/auth/google/config — Public capability probe (never exposes secrets)
  if (pathname === '/api/auth/google/config' && method === 'GET') {
    return buildAuthResponse(
      {
        ok: true,
        configured: isGoogleOAuthConfigured(env.googleOAuth),
      },
      200,
      env.corsHeaders
    );
  }

  // 15) POST /api/auth/google/start — Initiate Authorization Code + PKCE + state + nonce flow
  if (pathname === '/api/auth/google/start' && method === 'POST') {
    const csrfErr = verifyMutatingCsrf(request, env, false);
    if (csrfErr) return csrfErr;

    let mode: 'login' | 'link' = 'login';
    const contentType = (request.headers.get('Content-Type') ?? '').toLowerCase();
    if (contentType.includes('application/json')) {
      const parsedBody = await parseJsonObjectBody(request, env.corsHeaders);
      if (parsedBody.ok === false) return parsedBody.response;
      if (parsedBody.data.mode === 'link') {
        mode = 'link';
      } else if (
        parsedBody.data.mode !== undefined &&
        parsedBody.data.mode !== 'login'
      ) {
        return buildAuthResponse(
          {
            ok: false,
            code: 'INVALID_INPUT',
            message: 'حالت احراز هویت گوگل نامعتبر است.',
          },
          400,
          env.corsHeaders
        );
      }
    }

    try {
      const ipHash = await sha256Hex(`ip:${env.clientIp || 'unknown'}`);
      const startRl = await consumeRateLimitSlot(
        env.db,
        `oauth_start:ip:${ipHash}`,
        OAUTH_START_IP_RATE_LIMIT,
        now
      );
      if (!startRl.allowed) {
        return buildAuthResponse(
          {
            ok: false,
            code: 'RATE_LIMITED',
            message:
              'تعداد درخواست‌های شروع ورود با گوگل بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.',
          },
          429,
          env.corsHeaders,
          { 'Retry-After': String(startRl.retryAfterSec) }
        );
      }

      const rawCookieHeader = request.headers.get('Cookie');
      let initiatorUserId: string | null = null;
      let guestUserId: string | null = null;

      if (mode === 'link') {
        const rawAuthToken = parseAuthCookieFromHeader(rawCookieHeader);
        const verified = rawAuthToken
          ? await verifyAuthSession(env.db, rawAuthToken, now)
          : null;
        if (!verified || !verified.authenticated || !verified.user) {
          return buildAuthResponse(
            {
              ok: false,
              code: 'UNAUTHORIZED',
              message: 'برای اتصال حساب گوگل ابتدا باید وارد حساب کاربری خود شوید.',
            },
            401,
            env.corsHeaders
          );
        }
        initiatorUserId = verified.user.userId;
      } else {
        const rawGuestToken = parseGuestCookieFromHeader(rawCookieHeader);
        const guestInspection = rawGuestToken
          ? await inspectGuestSession(env.db, rawGuestToken, now)
          : null;
        if (guestInspection?.status === 'revoked_or_upgraded') {
          return buildAuthResponse(
            {
              ok: false,
              code: 'ACCOUNT_CONFLICT',
              message:
                'حساب مهمان شما قبلاً ارتقا یافته است. لطفاً دوباره با حساب کاربری خود وارد شوید.',
            },
            409,
            env.corsHeaders,
            {
              'Set-Cookie': buildClearGuestCookieHeader(
                env.secureCookie,
                env.cookieOptions
              ),
            }
          );
        }
        if (guestInspection?.status === 'expired') {
          return buildAuthResponse(
            {
              ok: false,
              code: 'INVALID_OR_EXPIRED_TOKEN',
              message:
                'نشست مهمان شما منقضی شده است. لطفاً دوباره ورود با گوگل را آغاز کنید.',
            },
            401,
            env.corsHeaders,
            {
              'Set-Cookie': buildClearGuestCookieHeader(
                env.secureCookie,
                env.cookieOptions
              ),
            }
          );
        }
        guestUserId =
          guestInspection?.status === 'valid'
            ? guestInspection.session.guestUserId
            : null;
      }

      const redirectUri = resolveGoogleCallbackRedirectUri(
        request.url,
        env.googleOAuth,
        env.publicAppBaseUrl
      );
      if (!redirectUri) {
        return buildAuthResponse(
          {
            ok: false,
            code: 'OAUTH_NOT_CONFIGURED',
            message: 'آدرس بازگشت Google OAuth روی سرور معتبر نیست.',
          },
          503,
          env.corsHeaders
        );
      }

      const openerOrigin =
        resolveValidatedHttpOrigin(request.headers.get('Origin')) ??
        resolveValidatedHttpOrigin(env.publicAppBaseUrl) ??
        resolveValidatedHttpOrigin(request.url);

      const existingBindCookies = parseAllOAuthBindCookiesFromHeader(rawCookieHeader);
      const started = await startGoogleOAuthFlow(
        env.db,
        env.googleOAuth ?? {},
        {
          mode,
          redirectUri,
          openerOrigin,
          initiatorUserId,
          guestUserId,
          existingFlowIds: Array.from(existingBindCookies.flowCookies.keys()),
          now,
        }
      );

      if (started.ok === false) {
        return buildAuthResponse(
          {
            ok: false,
            code: started.code,
            message: started.message,
          },
          started.status,
          env.corsHeaders
        );
      }

      const sameSiteMode = resolveOAuthBindSameSiteMode(
        env.secureCookie,
        openerOrigin,
        request.url,
        request.headers.get('Sec-Fetch-Site')
      );

      const setCookies: string[] = [
        buildSetOAuthBindCookieHeader(
          started.flowId,
          started.rawBrowserBinding,
          env.secureCookie,
          sameSiteMode,
          env.cookieOptions
        ),
      ];
      for (const evictFlowId of started.evictFlowIds) {
        setCookies.push(
          buildClearOAuthBindCookieHeader(
            evictFlowId,
            env.secureCookie,
            sameSiteMode,
            env.cookieOptions
          )
        );
      }
      if (existingBindCookies.hasLegacyCookie) {
        setCookies.push(
          buildClearLegacyOAuthBindCookieHeader(
            env.secureCookie,
            sameSiteMode,
            env.cookieOptions
          )
        );
      }

      return buildAuthResponse(
        {
          ok: true,
          flowId: started.flowId,
          url: started.url,
          mode,
          stateExpiresAt: started.stateExpiresAt,
        },
        200,
        env.corsHeaders,
        undefined,
        setCookies
      );
    } catch (err) {
      console.error(
        '[Auth] /api/auth/google/start error:',
        err instanceof Error ? err.message : 'unknown'
      );
      return buildAuthResponse(
        {
          ok: false,
          code: 'DATABASE_ERROR',
          message: 'خطای داخلی در آغاز ورود با گوگل رخ داد.',
        },
        500,
        env.corsHeaders
      );
    }
  }

  // 16) GET /api/auth/google/callback (and trailing slash) — Complete OAuth popup callback
  if (
    (pathname === '/api/auth/google/callback' ||
      pathname === '/api/auth/google/callback/') &&
    method === 'GET'
  ) {
    const reqUrl = new URL(request.url);
    const code = reqUrl.searchParams.get('code');
    const state = reqUrl.searchParams.get('state');
    const oauthError = reqUrl.searchParams.get('error');
    const wantsJson = (request.headers.get('Accept') ?? '')
      .toLowerCase()
      .includes('application/json');

    const fallbackTargetOrigin =
      resolveValidatedHttpOrigin(env.publicAppBaseUrl) ??
      resolveValidatedHttpOrigin(request.url) ??
      reqUrl.origin;

    try {
      const ipHash = await sha256Hex(`ip:${env.clientIp || 'unknown'}`);
      const cbRl = await consumeRateLimitSlot(
        env.db,
        `oauth_callback:ip:${ipHash}`,
        OAUTH_CALLBACK_IP_RATE_LIMIT,
        now
      );
      if (!cbRl.allowed) {
        const retryHeader = { 'Retry-After': String(cbRl.retryAfterSec) };
        if (wantsJson) {
          return buildAuthResponse(
            {
              ok: false,
              code: 'RATE_LIMITED',
              message:
                'تعداد درخواست‌های بازگشت احراز هویت گوگل بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.',
            },
            429,
            env.corsHeaders,
            retryHeader
          );
        }
        return buildOAuthPopupHtmlResponse(
          {
            ok: false,
            flowMode: 'login',
            flowId: null,
            code: 'RATE_LIMITED',
            message:
              'تعداد درخواست‌های بازگشت احراز هویت گوگل بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.',
          },
          fallbackTargetOrigin,
          429,
          [],
          retryHeader
        );
      }

      const rawCookieHeader = request.headers.get('Cookie');
      const rawAuthToken = parseAuthCookieFromHeader(rawCookieHeader);
      const parsedBindCookies = parseAllOAuthBindCookiesFromHeader(rawCookieHeader);
      const currentAuth = rawAuthToken
        ? await verifyAuthSession(env.db, rawAuthToken, now)
        : null;
      const currentUserId =
        currentAuth && currentAuth.authenticated && currentAuth.user
          ? currentAuth.user.userId
          : null;

      const result = await completeGoogleOAuthCallback(
        env.db,
        env.googleOAuth ?? {},
        {
          code,
          state,
          error: oauthError,
          rawBrowserBindings: parsedBindCookies.flowCookies,
          rawBrowserBinding: parsedBindCookies.legacyToken,
          currentAuthenticatedUserId: currentUserId,
          clientIp: env.clientIp,
          userAgent: env.userAgent,
          sessionTtlSec: ttlSec,
          now,
        }
      );

      const targetOrigin =
        resolveValidatedHttpOrigin(result.openerOrigin) ?? fallbackTargetOrigin;
      const clearSameSiteMode = resolveOAuthBindSameSiteMode(
        env.secureCookie,
        targetOrigin,
        request.url
      );

      // Clear ONLY this flow's binding cookie so concurrent OAuth tabs in the same browser stay intact.
      const setCookies: string[] = [];
      if (result.clearFlowCookieId) {
        setCookies.push(
          buildClearOAuthBindCookieHeader(
            result.clearFlowCookieId,
            env.secureCookie,
            clearSameSiteMode,
            env.cookieOptions
          )
        );
      } else if (parsedBindCookies.hasLegacyCookie) {
        setCookies.push(
          buildClearLegacyOAuthBindCookieHeader(
            env.secureCookie,
            clearSameSiteMode,
            env.cookieOptions
          )
        );
      }

      if (result.ok === false) {
        if (result.clearedGuestCookie) {
          setCookies.push(
            buildClearGuestCookieHeader(env.secureCookie, env.cookieOptions)
          );
        }
        if (wantsJson) {
          return buildAuthResponse(
            {
              ok: false,
              code: result.code,
              flowId: result.flowId ?? null,
              message: result.message,
            },
            result.status,
            env.corsHeaders,
            undefined,
            setCookies
          );
        }
        return buildOAuthPopupHtmlResponse(
          {
            ok: false,
            flowMode: result.flowMode ?? 'login',
            flowId: result.flowId ?? null,
            code: result.code,
            message: result.message,
          },
          targetOrigin,
          result.status,
          setCookies
        );
      }

      if (result.rawSessionToken) {
        setCookies.push(
          buildSetAuthCookieHeader(
            result.rawSessionToken,
            env.secureCookie,
            result.sessionTtlSec,
            env.cookieOptions
          )
        );
      }
      if (result.clearedGuestCookie) {
        setCookies.push(
          buildClearGuestCookieHeader(env.secureCookie, env.cookieOptions)
        );
      }

      if (wantsJson) {
        return buildAuthResponse(
          {
            ok: true,
            authenticated: true,
            flowId: result.flowId,
            flowMode: result.flowMode,
            alreadyLinked: result.alreadyLinked ?? false,
            user: result.user,
            session: result.session ?? null,
            message: result.message,
          },
          result.status,
          env.corsHeaders,
          undefined,
          setCookies
        );
      }

      return buildOAuthPopupHtmlResponse(
        {
          ok: true,
          flowMode: result.flowMode,
          flowId: result.flowId,
          message: result.message,
        },
        targetOrigin,
        result.status,
        setCookies
      );
    } catch (err) {
      console.error(
        '[Auth] /api/auth/google/callback error:',
        err instanceof Error ? err.message : 'unknown'
      );
      if (wantsJson) {
        return buildAuthResponse(
          {
            ok: false,
            code: 'DATABASE_ERROR',
            message: 'خطای داخلی در تکمیل احراز هویت گوگل رخ داد.',
          },
          500,
          env.corsHeaders
        );
      }
      return buildOAuthPopupHtmlResponse(
        {
          ok: false,
          flowMode: 'login',
          flowId: null,
          code: 'DATABASE_ERROR',
          message: 'خطای داخلی در تکمیل احراز هویت گوگل رخ داد.',
        },
        fallbackTargetOrigin,
        500,
        []
      );
    }
  }

  return null;
}
