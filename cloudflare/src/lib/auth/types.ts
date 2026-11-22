/**
 * Shared central authentication types for Eyvan Platform (Cloudflare Workers + Express/SQLite).
 * Strictly separates internal DB/secret structures from public API user payloads.
 */

export type AuthProvider = 'guest' | 'password' | 'google' | 'hybrid';

export type AccountStatus =
  | 'guest'
  | 'pending_verification'
  | 'active'
  | 'suspended'
  | 'deleted';

/**
 * Public, safe user representation returned by `/api/auth/*` endpoints.
 * NEVER contains password hashes, salts, session tokens, or internal security metadata.
 */
export interface PublicAuthUser {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly avatarCode: string;
  readonly avatarUrl: string | null;
  readonly authProvider: AuthProvider;
  readonly accountStatus: AccountStatus;
  readonly createdAt: number;
  readonly lastSeenAt: number;
}

export interface PublicAuthSessionInfo {
  readonly sessionId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface ActiveAuthSessionItem {
  readonly sessionId: string;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly expiresAt: number;
  readonly isCurrent: boolean;
}

export type LinkedAuthProvider = 'password' | 'google';

export interface PublicEmailDeliveryInfo {
  readonly configured: boolean;
  readonly sent: boolean;
}

export type AuthErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_CONFLICT'
  | 'ACCOUNT_LINK_REQUIRED'
  | 'ACCOUNT_DISABLED'
  | 'EMAIL_NOT_VERIFIED'
  | 'INVALID_OR_EXPIRED_TOKEN'
  | 'OAUTH_NOT_CONFIGURED'
  | 'OAUTH_CANCELLED'
  | 'OAUTH_INVALID_STATE'
  | 'OAUTH_FAILED'
  | 'UNAUTHORIZED'
  | 'CSRF_REJECTED'
  | 'FORBIDDEN_ORIGIN'
  | 'RATE_LIMITED'
  | 'DATABASE_ERROR';

export interface InternalEmailDeliveryDiagnostic {
  readonly configured: boolean;
  readonly sent: boolean;
  readonly provider: string;
  readonly errorCode?: string;
}

export interface AuthRequestContext {
  readonly clientIp: string;
  readonly userAgent: string;
  readonly now?: number;
  readonly sessionTtlSec?: number;
  readonly publicAppBaseUrl?: string;
  readonly isProduction?: boolean;
  readonly requireActiveGuestSession?: boolean;
}

export interface AuthSuccessWithSession {
  readonly ok: true;
  readonly status: number;
  readonly user: PublicAuthUser;
  readonly session: PublicAuthSessionInfo;
  /** Raw opaque token to be placed ONLY inside `Set-Cookie: eyvan_auth_sess=...; HttpOnly`. */
  readonly rawSessionToken: string;
  readonly sessionTtlSec: number;
}

export interface AuthRegisterPendingVerification {
  readonly ok: true;
  readonly status: number;
  readonly verificationRequired: true;
  readonly user: PublicAuthUser;
  readonly emailDelivery: PublicEmailDeliveryInfo;
  /** Server-side operational diagnostic only; never expose internal error codes in public JSON. */
  readonly internalDelivery?: InternalEmailDeliveryDiagnostic;
  readonly message: string;
}

export interface AuthActionSuccess {
  readonly ok: true;
  readonly status: number;
  readonly message: string;
  readonly verified?: boolean;
  readonly passwordReset?: boolean;
  readonly emailDelivery?: PublicEmailDeliveryInfo;
  /** Server-side operational diagnostic only; MUST NOT be serialized on non-enumerating endpoints. */
  readonly internalDelivery?: InternalEmailDeliveryDiagnostic;
}

export interface AuthFailure {
  readonly ok: false;
  readonly status: number;
  readonly code: AuthErrorCode;
  readonly message: string;
  readonly retryAfterSec?: number;
  readonly verificationRequired?: boolean;
}

export type AuthSessionResult = AuthSuccessWithSession | AuthFailure;
export type AuthRegisterResult = AuthRegisterPendingVerification | AuthFailure;
export type AuthActionResult = AuthActionSuccess | AuthFailure;

export interface VerifySessionResult {
  readonly authenticated: boolean;
  readonly user: PublicAuthUser | null;
  readonly session: PublicAuthSessionInfo | null;
  readonly shouldClearCookie: boolean;
}
