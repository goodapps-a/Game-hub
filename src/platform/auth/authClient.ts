/**
 * Client-side API wrapper for Eyvan Central Auth (`/api/auth/*`, C1 + C2).
 *
 * Security boundaries:
 * - Zero token/password/credential persistence in `localStorage` or `sessionStorage`.
 * - Relies strictly on server-issued `HttpOnly` cookie (`eyvan_auth_sess`) via `credentials: 'include'`.
 * - Sends `X-Requested-With: eyvan-client` on every mutating auth request for CSRF protection.
 * - Immediately scrubs email verification & password reset tokens from URL hash/query via `history.replaceState`.
 */

import { buildOnlineHttpUrl } from '../../games/hokm/online/client';

export interface AuthUserSummary {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly avatarCode: string;
  readonly avatarUrl: string | null;
  readonly authProvider: 'guest' | 'password' | 'google' | 'hybrid';
  readonly accountStatus:
    | 'guest'
    | 'pending_verification'
    | 'active'
    | 'suspended'
    | 'deleted';
  readonly createdAt: number;
  readonly lastSeenAt: number;
}

export interface AuthSessionMeta {
  readonly sessionId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface AuthEmailDeliveryStatus {
  readonly configured: boolean;
  readonly sent: boolean;
}

export type LinkedAuthProvider = 'password' | 'google';

export interface ActiveAuthSessionItem {
  readonly sessionId: string;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly expiresAt: number;
  readonly isCurrent: boolean;
}

export interface AuthMeResponse {
  readonly ok: boolean;
  readonly authenticated: boolean;
  readonly user: AuthUserSummary | null;
  readonly session: AuthSessionMeta | null;
  readonly providers?: LinkedAuthProvider[];
}

export interface AuthSessionsListResponse {
  readonly ok: boolean;
  readonly sessions?: ActiveAuthSessionItem[];
  readonly providers?: LinkedAuthProvider[];
  readonly code?: string;
  readonly message?: string;
}

export interface AuthRevokeSessionResponse {
  readonly ok: boolean;
  readonly revokedSessionId?: string;
  readonly revokedCurrentSession?: boolean;
  readonly code?: string;
  readonly message?: string;
}

export interface GoogleOAuthConfigResponse {
  readonly ok: boolean;
  readonly configured: boolean;
}

export interface GoogleOAuthStartResponse {
  readonly ok: boolean;
  readonly url?: string;
  readonly mode?: 'login' | 'link';
  readonly code?: string;
  readonly message?: string;
}

export interface GoogleOAuthPopupResult {
  readonly ok: boolean;
  readonly flowMode: 'login' | 'link';
  readonly code: string | null;
  readonly message: string;
}

export interface AuthMutationResponse {
  readonly ok: boolean;
  readonly authenticated?: boolean;
  readonly verificationRequired?: boolean;
  readonly verified?: boolean;
  readonly passwordReset?: boolean;
  readonly upgradedFromGuest?: boolean;
  readonly emailDelivery?: AuthEmailDeliveryStatus;
  readonly user?: AuthUserSummary;
  readonly session?: AuthSessionMeta;
  readonly revokedCount?: number;
  readonly code?: string;
  readonly message?: string;
}

export type PendingAuthUrlAction =
  | { readonly type: 'verify-email'; readonly token: string }
  | { readonly type: 'reset-password'; readonly token: string };

/**
 * Extracts a verification or password-reset token from URL hash (`#verify-email=...`, `#reset-password=...`)
 * or fallback query params, then IMMEDIATELY scrubs the token from browser URL & history so it never
 * leaks to third-party scripts, Referer headers, or browser screenshots.
 */
export function consumeAuthActionFromUrlHash(): PendingAuthUrlAction | null {
  if (typeof window === 'undefined') return null;

  let found: PendingAuthUrlAction | null = null;
  let shouldScrub = false;

  const rawHash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;

  if (rawHash) {
    const hashParams = new URLSearchParams(rawHash);
    const verifyTok = hashParams.get('verify-email')?.trim();
    const resetTok = hashParams.get('reset-password')?.trim();
    if (verifyTok) {
      found = { type: 'verify-email', token: verifyTok };
      shouldScrub = true;
    } else if (resetTok) {
      found = { type: 'reset-password', token: resetTok };
      shouldScrub = true;
    }
  }

  // Fallback support if an email client converted hash to query params; still immediately scrubbed
  const searchParams = new URLSearchParams(window.location.search);
  if (!found) {
    const verifyQ = searchParams.get('verify-email')?.trim() || searchParams.get('verify_email')?.trim();
    const resetQ = searchParams.get('reset-password')?.trim() || searchParams.get('reset_password')?.trim();
    if (verifyQ) {
      found = { type: 'verify-email', token: verifyQ };
      shouldScrub = true;
    } else if (resetQ) {
      found = { type: 'reset-password', token: resetQ };
      shouldScrub = true;
    }
  }

  if (shouldScrub) {
    searchParams.delete('verify-email');
    searchParams.delete('verify_email');
    searchParams.delete('reset-password');
    searchParams.delete('reset_password');
    const cleanQuery = searchParams.toString();
    const cleanUrl = `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}`;
    try {
      window.history.replaceState(null, '', cleanUrl);
    } catch {
      // Ignore restricted history API in sandboxed environments
    }
  }

  return found;
}

async function parseAuthJson<T>(res: Response, fallbackMsg: string): Promise<T> {
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.toLowerCase().includes('application/json')) {
    throw new Error(fallbackMsg);
  }
  return (await res.json()) as T;
}

export async function fetchCurrentAuthSession(): Promise<AuthMeResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/auth/me'), {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  return parseAuthJson<AuthMeResponse>(res, 'خطا در بررسی وضعیت حساب کاربری.');
}

export async function registerAccount(input: {
  email: string;
  username: string;
  password: string;
  confirmPassword: string;
}): Promise<AuthMutationResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/auth/register'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify(input),
  });
  return parseAuthJson<AuthMutationResponse>(
    res,
    'خطا در ارتباط با سرور هنگام ثبت‌نام.'
  );
}

export async function loginAccount(input: {
  identifier: string;
  password: string;
}): Promise<AuthMutationResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/auth/login'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify(input),
  });
  return parseAuthJson<AuthMutationResponse>(
    res,
    'خطا در ارتباط با سرور هنگام ورود.'
  );
}

export async function logoutAccount(): Promise<AuthMutationResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/auth/logout'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'X-Requested-With': 'eyvan-client',
    },
  });
  return parseAuthJson<AuthMutationResponse>(
    res,
    'خطا در خروج از حساب کاربری.'
  );
}

export async function logoutAllAccountSessions(): Promise<AuthMutationResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/auth/logout-all'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'X-Requested-With': 'eyvan-client',
    },
  });
  return parseAuthJson<AuthMutationResponse>(
    res,
    'خطا در لغو تمام نشست‌های فعال.'
  );
}

export async function verifyEmailWithTokenRequest(
  token: string
): Promise<AuthMutationResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/auth/verify-email'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify({ token }),
  });
  return parseAuthJson<AuthMutationResponse>(
    res,
    'خطا در ارتباط با سرور هنگام تأیید ایمیل.'
  );
}

export async function resendVerificationRequest(
  email: string
): Promise<AuthMutationResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/auth/resend-verification'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify({ email }),
  });
  return parseAuthJson<AuthMutationResponse>(
    res,
    'خطا در ارسال مجدد ایمیل تأیید.'
  );
}

export async function forgotPasswordRequest(
  email: string
): Promise<AuthMutationResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/auth/forgot-password'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify({ email }),
  });
  return parseAuthJson<AuthMutationResponse>(
    res,
    'خطا در ثبت درخواست بازیابی رمز عبور.'
  );
}

export async function resetPasswordRequest(input: {
  token: string;
  password: string;
  confirmPassword: string;
}): Promise<AuthMutationResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/auth/reset-password'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify(input),
  });
  return parseAuthJson<AuthMutationResponse>(
    res,
    'خطا در ارتباط با سرور هنگام تغییر رمز عبور.'
  );
}

export interface UsernameAvailabilityResponse {
  readonly ok: boolean;
  readonly valid?: boolean;
  readonly available?: boolean;
  readonly reason?: 'invalid' | 'available' | 'current_user' | 'taken';
  readonly code?: string;
  readonly message: string;
}

export async function checkUsernameAvailabilityRequest(
  username: string,
  signal?: AbortSignal
): Promise<UsernameAvailabilityResponse> {
  const url = buildOnlineHttpUrl(
    `/api/auth/username-availability?username=${encodeURIComponent(username)}`
  );
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  });
  return parseAuthJson<UsernameAvailabilityResponse>(
    res,
    'خطا در بررسی نام کاربری روی سرور.'
  );
}

export async function updateAccountProfileRequest(input: {
  username: string;
  avatarCode: string;
}): Promise<AuthMutationResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/auth/profile'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify(input),
  });
  return parseAuthJson<AuthMutationResponse>(
    res,
    'خطا در ذخیره تغییرات پروفایل روی سرور.'
  );
}

export async function fetchActiveAuthSessions(): Promise<AuthSessionsListResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/auth/sessions'), {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  return parseAuthJson<AuthSessionsListResponse>(
    res,
    'خطا در دریافت لیست نشست‌های فعال.'
  );
}

export async function revokeAuthSessionByIdRequest(
  sessionId: string
): Promise<AuthRevokeSessionResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/auth/sessions/revoke'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify({ sessionId }),
  });
  return parseAuthJson<AuthRevokeSessionResponse>(
    res,
    'خطا در لغو نشست انتخاب‌شده.'
  );
}

export async function fetchGoogleOAuthConfig(): Promise<GoogleOAuthConfigResponse> {
  try {
    const res = await fetch(buildOnlineHttpUrl('/api/auth/google/config'), {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    return await parseAuthJson<GoogleOAuthConfigResponse>(
      res,
      'خطا در بررسی وضعیت ورود با گوگل.'
    );
  } catch {
    return { ok: false, configured: false };
  }
}

export async function startGoogleOAuthFlowRequest(
  mode: 'login' | 'link' = 'login'
): Promise<GoogleOAuthStartResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/auth/google/start'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify({ mode }),
  });
  return parseAuthJson<GoogleOAuthStartResponse>(
    res,
    'خطا در شروع فرایند ورود با گوگل.'
  );
}

function getAllowedOAuthPopupOrigins(): Set<string> {
  const allowed = new Set<string>();
  if (typeof window !== 'undefined' && window.location?.origin) {
    allowed.add(window.location.origin);
  }
  try {
    const apiUrl = new URL(
      buildOnlineHttpUrl('/api/auth/google/callback'),
      typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'
    );
    allowed.add(apiUrl.origin);
  } catch {
    // Ignore invalid URL fallback
  }
  return allowed;
}

/**
 * Initiates the user-triggered Google OAuth popup flow (Authorization Code + PKCE S256).
 * Opens the server-generated Google authorization URL in a popup window and resolves when
 * the server callback posts `EYVAN_OAUTH_RESULT` back to `window.opener` or the popup closes.
 */
export async function openGoogleOAuthPopup(
  mode: 'login' | 'link' = 'login'
): Promise<GoogleOAuthPopupResult> {
  if (typeof window === 'undefined') {
    return {
      ok: false,
      flowMode: mode,
      code: 'OAUTH_FAILED',
      message: 'ورود با گوگل فقط در مرورگر پشتیبانی می‌شود.',
    };
  }

  let startRes: GoogleOAuthStartResponse;
  try {
    startRes = await startGoogleOAuthFlowRequest(mode);
  } catch (err) {
    return {
      ok: false,
      flowMode: mode,
      code: 'OAUTH_FAILED',
      message:
        err instanceof Error ? err.message : 'خطا در شروع فرایند ورود با گوگل.',
    };
  }

  if (!startRes.ok || !startRes.url) {
    return {
      ok: false,
      flowMode: mode,
      code: startRes.code ?? 'OAUTH_FAILED',
      message: startRes.message ?? 'امکان شروع ورود با گوگل وجود ندارد.',
    };
  }

  const width = 500;
  const height = 640;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  const popup = window.open(
    startRes.url,
    'eyvan_google_oauth',
    `width=${width},height=${height},left=${left},top=${top},popup=yes,noopener=no`
  );

  if (!popup) {
    return {
      ok: false,
      flowMode: mode,
      code: 'OAUTH_POPUP_BLOCKED',
      message:
        'پنجره ورود گوگل توسط مرورگر مسدود شد. لطفاً نمایش پنجره بازشو (Popup) را مجاز کنید.',
    };
  }

  const allowedOrigins = getAllowedOAuthPopupOrigins();

  return new Promise<GoogleOAuthPopupResult>((resolve) => {
    let settled = false;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(closedPollTimer);
      window.clearTimeout(timeoutTimer);
    };

    const finish = (result: GoogleOAuthPopupResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (!popup.closed) popup.close();
      } catch {
        // Ignore cross-origin window close errors
      }
      resolve(result);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== popup) return;
      if (!allowedOrigins.has(event.origin)) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object' || data.type !== 'EYVAN_OAUTH_RESULT') {
        return;
      }
      if (typeof data.ok !== 'boolean') return;
      if (data.flowMode !== 'login' && data.flowMode !== 'link') return;
      if (data.flowMode !== mode) return;
      if (
        data.code !== null &&
        data.code !== undefined &&
        typeof data.code !== 'string'
      ) {
        return;
      }

      finish({
        ok: data.ok,
        flowMode: data.flowMode,
        code: typeof data.code === 'string' ? data.code : null,
        message:
          typeof data.message === 'string' && data.message.trim().length > 0
            ? data.message
            : data.ok
              ? 'ورود با گوگل با موفقیت انجام شد.'
              : 'ورود با گوگل انجام نشد.',
      });
    };

    const closedPollTimer = window.setInterval(() => {
      try {
        if (popup.closed) {
          finish({
            ok: false,
            flowMode: mode,
            code: 'OAUTH_CANCELLED',
            message: 'پنجره ورود با گوگل بسته شد.',
          });
        }
      } catch {
        // Cross-origin frame check ignored until accessible or closed
      }
    }, 500);

    const timeoutTimer = window.setTimeout(() => {
      finish({
        ok: false,
        flowMode: mode,
        code: 'OAUTH_TIMEOUT',
        message: 'زمان انتظار برای ورود با گوگل به پایان رسید. لطفاً دوباره تلاش کنید.',
      });
    }, 5 * 60 * 1000);

    window.addEventListener('message', onMessage);
  });
}


