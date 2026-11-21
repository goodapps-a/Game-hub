/**
 * Client-side API wrapper for Eyvan Central Auth (`/api/auth/*`, C1).
 *
 * Security boundaries:
 * - Zero token/password/credential persistence in `localStorage` or `sessionStorage`.
 * - Relies strictly on server-issued `HttpOnly` cookie (`eyvan_auth_sess`) via `credentials: 'include'`.
 * - Sends `X-Requested-With: eyvan-client` on every mutating auth request for CSRF protection.
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

export interface AuthMeResponse {
  readonly ok: boolean;
  readonly authenticated: boolean;
  readonly user: AuthUserSummary | null;
  readonly session: AuthSessionMeta | null;
}

export interface AuthMutationResponse {
  readonly ok: boolean;
  readonly authenticated?: boolean;
  readonly user?: AuthUserSummary;
  readonly session?: AuthSessionMeta;
  readonly revokedCount?: number;
  readonly code?: string;
  readonly message?: string;
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
