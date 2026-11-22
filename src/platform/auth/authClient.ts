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

export interface AuthMeResponse {
  readonly ok: boolean;
  readonly authenticated: boolean;
  readonly user: AuthUserSummary | null;
  readonly session: AuthSessionMeta | null;
}

export interface AuthMutationResponse {
  readonly ok: boolean;
  readonly authenticated?: boolean;
  readonly verificationRequired?: boolean;
  readonly verified?: boolean;
  readonly passwordReset?: boolean;
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

