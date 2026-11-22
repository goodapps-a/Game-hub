/**
 * Stage C3 — Production-Grade Google OAuth 2.0 / OpenID Connect Service for Eyvan.
 * Shared 1:1 between Cloudflare Workers (D1) and Express/SQLite via Web Crypto API.
 *
 * Security Guarantees:
 * - Standard Authorization Code Flow + PKCE (S256) + CSRF `state` + OIDC `nonce`.
 * - `oauth_states` stores ONLY `SHA-256(state)`, `SHA-256(nonce)`, and AES-256-GCM
 *   encrypted `code_verifier` (key derived from server `GOOGLE_OAUTH_CLIENT_SECRET`).
 * - Atomic single-use state consumption (`UPDATE ... WHERE consumed_at IS NULL AND expires_at > ?`)
 *   prevents CSRF and callback replay attacks.
 * - Real cryptographic RS256 verification of Google `id_token` JWT against Google JWKS
 *   (`https://www.googleapis.com/oauth2/v3/certs`) using `crypto.subtle` with key-rotation retry.
 * - Strictly validates `iss`, `aud`, `exp`, `iat`, `nonce`, `sub`, `email`, `email_verified === true`.
 * - Permanent identity lookup is strictly by immutable Google `sub` (`auth_identities.provider_subject`),
 *   NEVER by mutable email alone.
 * - Anti-Account-Takeover Linking:
 *   * `mode: 'login'` NEVER auto-merges onto an existing password account — requires explicit
 *     authenticated linking (`mode: 'link'`) to prevent pre-hijacking/takeover.
 *   * `mode: 'link'` verifies that the active `eyvan_auth_sess` cookie at callback matches the
 *     exact `initiator_user_id` bound into `oauth_states` (prevents login-CSRF link attacks).
 * - Guest upgrade: if a verified `eyvan_guest_sess` initiates Google login and no conflicting
 *   registered account exists, the guest account upgrades IN-PLACE preserving `user_id` & match stats.
 */

import { D1DatabaseLike } from '../types';
import { resolveAuthSessionTtlSec } from './authCookie';
import {
  constantTimeEqualHex,
  generateOpaqueToken,
  generatePrefixedId,
  sha256Hex,
} from './crypto';
import { revokeGuestSessionsForUser } from './guestSession';
import {
  AccountStatus,
  AuthErrorCode,
  AuthProvider,
  PublicAuthSessionInfo,
  PublicAuthUser,
} from './types';
import { validateAuthUsername, validateEmail } from './validation';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const DEFAULT_GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DEFAULT_GOOGLE_JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const JWKS_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const VALID_GOOGLE_ISSUERS = new Set([
  'https://accounts.google.com',
  'accounts.google.com',
]);

export type OAuthFetchFn = typeof fetch;

export interface GoogleOAuthConfig {
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly redirectUri?: string;
  readonly tokenEndpoint?: string;
  readonly jwksEndpoint?: string;
  readonly fetchImpl?: OAuthFetchFn;
}

export interface GoogleOAuthStartInput {
  readonly mode: 'login' | 'link';
  readonly redirectUri: string;
  readonly initiatorUserId?: string | null;
  readonly guestUserId?: string | null;
  readonly now?: number;
}

export type GoogleOAuthStartResult =
  | {
      readonly ok: true;
      readonly url: string;
      readonly stateExpiresAt: number;
    }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: AuthErrorCode;
      readonly message: string;
    };

export interface GoogleOAuthCallbackInput {
  readonly code: string | null;
  readonly state: string | null;
  readonly error: string | null;
  readonly currentAuthenticatedUserId: string | null;
  readonly clientIp: string;
  readonly userAgent: string;
  readonly sessionTtlSec?: number;
  readonly now?: number;
}

export type GoogleOAuthCallbackResult =
  | {
      readonly ok: true;
      readonly status: number;
      readonly flowMode: 'login' | 'link';
      readonly user: PublicAuthUser;
      readonly session?: PublicAuthSessionInfo;
      readonly rawSessionToken?: string;
      readonly sessionTtlSec?: number;
      readonly clearedGuestCookie: boolean;
      readonly alreadyLinked?: boolean;
      readonly message: string;
    }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: AuthErrorCode;
      readonly message: string;
    };

interface OAuthStateRow {
  state_hash: string;
  provider: string;
  code_verifier_encrypted: string;
  nonce_hash: string;
  redirect_path: string;
  flow_mode: string;
  initiator_user_id: string | null;
  guest_user_id: string | null;
  redirect_uri: string | null;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
}

interface UserRow {
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

interface GoogleJwk extends JsonWebKey {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
}

interface CachedJwks {
  keys: GoogleJwk[];
  fetchedAt: number;
}

const jwksCache = new Map<string, CachedJwks>();

export function clearGoogleJwksCacheForTests(): void {
  jwksCache.clear();
}

export function isGoogleOAuthConfigured(config?: GoogleOAuthConfig): boolean {
  const id = config?.clientId?.trim() ?? '';
  const secret = config?.clientSecret?.trim() ?? '';
  return id.length >= 8 && secret.length >= 8;
}

export function resolveGoogleCallbackRedirectUri(
  requestUrl: string,
  config?: GoogleOAuthConfig,
  publicAppBaseUrl?: string
): string | null {
  const explicit = config?.redirectUri?.trim();
  if (explicit) {
    try {
      const parsed = new URL(explicit);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.toString();
      }
    } catch {
      return null;
    }
  }

  const baseCandidate = publicAppBaseUrl?.trim() || requestUrl;
  try {
    const parsed = new URL(baseCandidate);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return `${parsed.origin}/api/auth/google/callback`;
  } catch {
    return null;
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(b64u: string): Uint8Array {
  const normalized = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLen);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function computePkceS256Challenge(codeVerifier: string): Promise<string> {
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToBase64Url(new Uint8Array(digest));
}

async function derivePkceAesKey(clientSecret: string): Promise<CryptoKey> {
  const material = new TextEncoder().encode(`eyvan-pkce-v1:${clientSecret}`);
  const hash = await crypto.subtle.digest('SHA-256', material);
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

async function encryptCodeVerifier(
  codeVerifier: string,
  clientSecret: string
): Promise<string> {
  const key = await derivePkceAesKey(clientSecret);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(codeVerifier)
  );
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

async function decryptCodeVerifier(
  encoded: string,
  clientSecret: string
): Promise<string | null> {
  const parts = encoded.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  try {
    const iv = base64UrlToBytes(parts[1]);
    const ciphertext = base64UrlToBytes(parts[2]);
    const key = await derivePkceAesKey(clientSecret);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(ciphertext)
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

export interface VerifiedGoogleIdTokenClaims {
  readonly sub: string;
  readonly email: string;
  readonly emailKey: string;
  readonly emailVerified: true;
  readonly name: string | null;
  readonly picture: string | null;
}

async function fetchGoogleJwks(
  jwksEndpoint: string,
  fetchImpl: OAuthFetchFn,
  now: number,
  forceRefresh = false
): Promise<GoogleJwk[]> {
  const cached = jwksCache.get(jwksEndpoint);
  if (!forceRefresh && cached && now - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cached.keys;
  }

  const res = await fetchImpl(jwksEndpoint, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`JWKS_HTTP_${res.status}`);
  }
  const data = (await res.json()) as { keys?: GoogleJwk[] };
  const keys = Array.isArray(data?.keys) ? data.keys : [];
  jwksCache.set(jwksEndpoint, { keys, fetchedAt: now });
  return keys;
}

/**
 * Cryptographically verifies a Google OpenID Connect `id_token` JWT (RS256)
 * against Google's JWKS keys and enforces all OIDC security claims.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  opts: {
    readonly expectedAudience: string;
    readonly expectedNonceHash: string;
    readonly jwksEndpoint?: string;
    readonly fetchImpl?: OAuthFetchFn;
    readonly now?: number;
  }
): Promise<
  | { readonly ok: true; readonly claims: VerifiedGoogleIdTokenClaims }
  | { readonly ok: false; readonly reason: string }
> {
  const now = opts.now ?? Date.now();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const jwksEndpoint = opts.jwksEndpoint ?? DEFAULT_GOOGLE_JWKS_ENDPOINT;

  const segments = idToken.split('.');
  if (segments.length !== 3) {
    return { ok: false, reason: 'MALFORMED_JWT' };
  }

  const [headerB64, payloadB64, sigB64] = segments;
  let header: { alg?: string; kid?: string; typ?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerB64)));
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)));
  } catch {
    return { ok: false, reason: 'INVALID_JWT_JSON' };
  }

  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    return { ok: false, reason: 'UNSUPPORTED_ALG_OR_MISSING_KID' };
  }

  let keys: GoogleJwk[];
  try {
    keys = await fetchGoogleJwks(jwksEndpoint, fetchImpl, now, false);
  } catch {
    return { ok: false, reason: 'JWKS_FETCH_FAILED' };
  }

  let matchingJwk = keys.find(
    (k) => k.kid === header.kid && k.kty === 'RSA' && k.n && k.e
  );
  if (!matchingJwk) {
    // Handle Google key rotation with one forced refresh
    try {
      keys = await fetchGoogleJwks(jwksEndpoint, fetchImpl, now, true);
      matchingJwk = keys.find(
        (k) => k.kid === header.kid && k.kty === 'RSA' && k.n && k.e
      );
    } catch {
      return { ok: false, reason: 'JWKS_REFRESH_FAILED' };
    }
  }

  if (!matchingJwk) {
    return { ok: false, reason: 'JWK_NOT_FOUND' };
  }

  try {
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      matchingJwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signature = base64UrlToBytes(sigB64);
    const sigValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      toArrayBuffer(signature),
      toArrayBuffer(signingInput)
    );
    if (!sigValid) {
      return { ok: false, reason: 'INVALID_SIGNATURE' };
    }
  } catch {
    return { ok: false, reason: 'SIGNATURE_VERIFY_ERROR' };
  }

  const iss = typeof payload.iss === 'string' ? payload.iss : '';
  if (!VALID_GOOGLE_ISSUERS.has(iss)) {
    return { ok: false, reason: 'INVALID_ISSUER' };
  }

  const aud = payload.aud;
  const audMatches =
    aud === opts.expectedAudience ||
    (Array.isArray(aud) && aud.includes(opts.expectedAudience));
  if (!audMatches) {
    return { ok: false, reason: 'INVALID_AUDIENCE' };
  }

  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  if (!Number.isFinite(exp) || exp * 1000 <= now - 30_000) {
    return { ok: false, reason: 'TOKEN_EXPIRED' };
  }

  const iat = typeof payload.iat === 'number' ? payload.iat : 0;
  if (!Number.isFinite(iat) || iat * 1000 > now + 60_000) {
    return { ok: false, reason: 'INVALID_IAT' };
  }

  const rawNonce = typeof payload.nonce === 'string' ? payload.nonce : '';
  if (!rawNonce) {
    return { ok: false, reason: 'MISSING_NONCE' };
  }
  const actualNonceHash = await sha256Hex(rawNonce);
  if (!constantTimeEqualHex(actualNonceHash, opts.expectedNonceHash)) {
    return { ok: false, reason: 'NONCE_MISMATCH' };
  }

  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!sub || sub.length > 255) {
    return { ok: false, reason: 'INVALID_SUB' };
  }

  if (payload.email_verified !== true) {
    return { ok: false, reason: 'EMAIL_NOT_VERIFIED_BY_GOOGLE' };
  }

  const validatedEmail = validateEmail(payload.email);
  if (validatedEmail.ok === false) {
    return { ok: false, reason: 'INVALID_EMAIL' };
  }

  const name =
    typeof payload.name === 'string' && payload.name.trim().length > 0
      ? payload.name.trim().slice(0, 64)
      : null;

  let picture: string | null = null;
  if (typeof payload.picture === 'string') {
    try {
      const picUrl = new URL(payload.picture.trim());
      if (picUrl.protocol === 'https:') {
        picture = picUrl.toString().slice(0, 512);
      }
    } catch {
      picture = null;
    }
  }

  return {
    ok: true,
    claims: {
      sub,
      email: validatedEmail.email,
      emailKey: validatedEmail.emailKey,
      emailVerified: true,
      name,
      picture,
    },
  };
}

function mapUserRowToPublic(row: UserRow): PublicAuthUser {
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

async function allocateUniqueUsernameForGoogle(
  db: D1DatabaseLike,
  preferredCandidates: Array<string | null | undefined>,
  excludeUserId?: string
): Promise<{ username: string; usernameKey: string }> {
  const candidates: string[] = [];

  for (const raw of preferredCandidates) {
    if (!raw) continue;
    const cleaned = raw
      .split('@')[0]
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[_.]|[_.]$/g, '')
      .slice(0, 16);
    if (cleaned.length >= 3) {
      candidates.push(cleaned);
    }
  }

  const baseStem = candidates[0]?.slice(0, 13) || 'player';
  for (let i = 0; i < 8; i++) {
    const suffix = generateOpaqueToken(3)
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase()
      .slice(0, 4);
    candidates.push(`${baseStem}_${suffix || String(1000 + i)}`);
  }

  for (const candidate of candidates) {
    const valid = validateAuthUsername(candidate);
    if (valid.ok === false) continue;
    const existing = excludeUserId
      ? await db
          .prepare(
            `SELECT 1 AS hit FROM users WHERE username_key = ? AND user_id != ? LIMIT 1`
          )
          .bind(valid.usernameKey, excludeUserId)
          .first<{ hit: number }>()
      : await db
          .prepare(`SELECT 1 AS hit FROM users WHERE username_key = ? LIMIT 1`)
          .bind(valid.usernameKey)
          .first<{ hit: number }>();
    if (!existing) {
      return { username: valid.username, usernameKey: valid.usernameKey };
    }
  }

  // Final deterministic-entropy fallback guaranteed to satisfy username regex
  const fallback = `usr_${generateOpaqueToken(8)
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
    .slice(0, 12)}`;
  return { username: fallback, usernameKey: fallback.toLowerCase() };
}

/**
 * Initiates Google OAuth Authorization Code + PKCE flow.
 * Persists hashed state, hashed nonce, and AES-GCM encrypted PKCE verifier in `oauth_states`.
 */
export async function startGoogleOAuthFlow(
  db: D1DatabaseLike,
  config: GoogleOAuthConfig,
  input: GoogleOAuthStartInput
): Promise<GoogleOAuthStartResult> {
  if (!isGoogleOAuthConfigured(config)) {
    return {
      ok: false,
      status: 503,
      code: 'OAUTH_NOT_CONFIGURED',
      message:
        'ورود با گوگل هنوز روی سرور پیکربندی نشده است (کلیدهای Google OAuth تنظیم نشده‌اند).',
    };
  }

  if (input.mode === 'link' && !input.initiatorUserId) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'برای اتصال حساب گوگل ابتدا باید وارد حساب کاربری خود شوید.',
    };
  }

  const now = input.now ?? Date.now();
  const expiresAt = now + OAUTH_STATE_TTL_MS;
  const rawState = generateOpaqueToken(32);
  const rawNonce = generateOpaqueToken(32);
  const codeVerifier = generateOpaqueToken(48);

  const [stateHash, nonceHash, codeChallenge, encryptedVerifier] =
    await Promise.all([
      sha256Hex(rawState),
      sha256Hex(rawNonce),
      computePkceS256Challenge(codeVerifier),
      encryptCodeVerifier(codeVerifier, config.clientSecret!.trim()),
    ]);

  await db
    .prepare(
      `INSERT INTO oauth_states (
         state_hash, provider, code_verifier_encrypted, nonce_hash,
         redirect_path, flow_mode, initiator_user_id, guest_user_id, redirect_uri,
         created_at, expires_at, consumed_at
       ) VALUES (?, 'google', ?, ?, '/', ?, ?, ?, ?, ?, ?, NULL)`
    )
    .bind(
      stateHash,
      encryptedVerifier,
      nonceHash,
      input.mode,
      input.mode === 'link' ? input.initiatorUserId ?? null : null,
      input.mode === 'login' ? input.guestUserId ?? null : null,
      input.redirectUri,
      now,
      expiresAt
    )
    .run();

  const authUrl = new URL(GOOGLE_AUTH_ENDPOINT);
  authUrl.searchParams.set('client_id', config.clientId!.trim());
  authUrl.searchParams.set('redirect_uri', input.redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', rawState);
  authUrl.searchParams.set('nonce', rawNonce);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('prompt', 'select_account');

  return {
    ok: true,
    url: authUrl.toString(),
    stateExpiresAt: expiresAt,
  };
}

/**
 * Completes the Google OAuth callback:
 * 1) Atomically consumes one-time `state` (anti-CSRF & anti-replay).
 * 2) Exchanges authorization code + decrypted PKCE `code_verifier` at Google's token endpoint.
 * 3) Cryptographically verifies Google's RS256 `id_token` JWT against JWKS & validates `nonce`.
 * 4) Resolves identity strictly by immutable Google `sub` with anti-takeover linking rules.
 */
export async function completeGoogleOAuthCallback(
  db: D1DatabaseLike,
  config: GoogleOAuthConfig,
  input: GoogleOAuthCallbackInput
): Promise<GoogleOAuthCallbackResult> {
  if (!isGoogleOAuthConfigured(config)) {
    return {
      ok: false,
      status: 503,
      code: 'OAUTH_NOT_CONFIGURED',
      message: 'ورود با گوگل روی سرور پیکربندی نشده است.',
    };
  }

  if (input.error) {
    const isCancel = input.error === 'access_denied';
    return {
      ok: false,
      status: 400,
      code: isCancel ? 'OAUTH_CANCELLED' : 'OAUTH_FAILED',
      message: isCancel
        ? 'فرآیند ورود با گوگل توسط کاربر لغو شد.'
        : 'احراز هویت با گوگل تکمیل نشد.',
    };
  }

  const rawCode = input.code?.trim() ?? '';
  const rawState = input.state?.trim() ?? '';
  if (!rawCode || !rawState) {
    return {
      ok: false,
      status: 400,
      code: 'OAUTH_INVALID_STATE',
      message: 'پارامترهای بازگشت از گوگل ناقص یا نامعتبر هستند.',
    };
  }

  const now = input.now ?? Date.now();
  const stateHash = await sha256Hex(rawState);

  const stateRow = await db
    .prepare(
      `SELECT
         state_hash, provider, code_verifier_encrypted, nonce_hash,
         redirect_path, flow_mode, initiator_user_id, guest_user_id, redirect_uri,
         created_at, expires_at, consumed_at
       FROM oauth_states
       WHERE state_hash = ? AND provider = 'google'
       LIMIT 1`
    )
    .bind(stateHash)
    .first<OAuthStateRow>();

  if (!stateRow || stateRow.consumed_at !== null || stateRow.expires_at <= now) {
    return {
      ok: false,
      status: 400,
      code: 'OAUTH_INVALID_STATE',
      message: 'نشست ورود با گوگل منقضی شده یا قبلاً استفاده شده است. لطفاً دوباره تلاش کنید.',
    };
  }

  // Atomic one-time consumption to prevent concurrent replay
  const consumeRes = await db
    .prepare(
      `UPDATE oauth_states
       SET consumed_at = ?
       WHERE state_hash = ? AND provider = 'google' AND consumed_at IS NULL AND expires_at > ?`
    )
    .bind(now, stateHash, now)
    .run();

  if (Number(consumeRes.meta?.changes ?? 0) !== 1) {
    return {
      ok: false,
      status: 400,
      code: 'OAUTH_INVALID_STATE',
      message: 'نشست ورود با گوگل قبلاً مصرف شده است. لطفاً مجدداً اقدام کنید.',
    };
  }

  const flowMode: 'login' | 'link' =
    stateRow.flow_mode === 'link' ? 'link' : 'login';

  // Anti-login-CSRF check for explicit link mode: current active session MUST match initiator
  if (flowMode === 'link') {
    if (
      !stateRow.initiator_user_id ||
      !input.currentAuthenticatedUserId ||
      stateRow.initiator_user_id !== input.currentAuthenticatedUserId
    ) {
      return {
        ok: false,
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'برای اتصال حساب گوگل، نشست فعال شما با درخواست اولیه مطابقت ندارد.',
      };
    }
  }

  const codeVerifier = await decryptCodeVerifier(
    stateRow.code_verifier_encrypted,
    config.clientSecret!.trim()
  );
  if (!codeVerifier || !stateRow.redirect_uri) {
    return {
      ok: false,
      status: 400,
      code: 'OAUTH_INVALID_STATE',
      message: 'اطلاعات امنیتی درخواست گوگل معتبر نیست.',
    };
  }

  const fetchImpl = config.fetchImpl ?? fetch;
  const tokenEndpoint = config.tokenEndpoint ?? DEFAULT_GOOGLE_TOKEN_ENDPOINT;

  let tokenPayload: { id_token?: string; error?: string };
  try {
    const tokenBody = new URLSearchParams({
      code: rawCode,
      client_id: config.clientId!.trim(),
      client_secret: config.clientSecret!.trim(),
      redirect_uri: stateRow.redirect_uri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    });
    const tokenRes = await fetchImpl(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: tokenBody.toString(),
    });
    if (!tokenRes.ok) {
      return {
        ok: false,
        status: 502,
        code: 'OAUTH_FAILED',
        message: 'تبادل کد احراز هویت با سرور گوگل ناموفق بود.',
      };
    }
    tokenPayload = (await tokenRes.json()) as { id_token?: string; error?: string };
  } catch {
    return {
      ok: false,
      status: 502,
      code: 'OAUTH_FAILED',
      message: 'خطا در برقراری ارتباط با سرویس گوگل.',
    };
  }

  if (!tokenPayload?.id_token || typeof tokenPayload.id_token !== 'string') {
    return {
      ok: false,
      status: 401,
      code: 'OAUTH_FAILED',
      message: 'توکن هویت معتبر از گوگل دریافت نشد.',
    };
  }

  const verifiedToken = await verifyGoogleIdToken(tokenPayload.id_token, {
    expectedAudience: config.clientId!.trim(),
    expectedNonceHash: stateRow.nonce_hash,
    jwksEndpoint: config.jwksEndpoint,
    fetchImpl,
    now,
  });

  if (verifiedToken.ok === false) {
    return {
      ok: false,
      status: 401,
      code: 'OAUTH_FAILED',
      message: 'اعتبارسنجی امنیتی توکن گوگل ناموفق بود.',
    };
  }

  const claims = verifiedToken.claims;

  // Lookup strictly by immutable Google `sub` FIRST
  const existingIdentity = await db
    .prepare(
      `SELECT identity_id, user_id
       FROM auth_identities
       WHERE provider = 'google' AND provider_subject = ?
       LIMIT 1`
    )
    .bind(claims.sub)
    .first<{ identity_id: string; user_id: string }>();

  // -------------------------------------------------------------------------
  // FLOW A: Explicit Authenticated Account Linking (`mode === 'link'`)
  // -------------------------------------------------------------------------
  if (flowMode === 'link') {
    const targetUserId = stateRow.initiator_user_id!;
    const targetUser = await db
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
      .bind(targetUserId)
      .first<UserRow>();

    if (!targetUser || targetUser.account_status !== 'active') {
      return {
        ok: false,
        status: 403,
        code: 'ACCOUNT_DISABLED',
        message: 'حساب کاربری فعلی شما فعال نیست.',
      };
    }

    if (existingIdentity) {
      if (existingIdentity.user_id === targetUserId) {
        return {
          ok: true,
          status: 200,
          flowMode: 'link',
          user: mapUserRowToPublic(targetUser),
          clearedGuestCookie: false,
          alreadyLinked: true,
          message: 'این حساب گوگل از قبل به حساب کاربری شما متصل است.',
        };
      }
      return {
        ok: false,
        status: 409,
        code: 'ACCOUNT_CONFLICT',
        message: 'این حساب گوگل قبلاً به حساب کاربری دیگری متصل شده است.',
      };
    }

    // Ensure this user doesn't already have another Google identity linked
    const existingUserGoogle = await db
      .prepare(
        `SELECT identity_id
         FROM auth_identities
         WHERE user_id = ? AND provider = 'google'
         LIMIT 1`
      )
      .bind(targetUserId)
      .first<{ identity_id: string }>();

    if (existingUserGoogle) {
      return {
        ok: false,
        status: 409,
        code: 'ACCOUNT_CONFLICT',
        message: 'حساب شما قبلاً به یک حساب گوگل دیگر متصل شده است.',
      };
    }

    const hasPasswordIdentity = await db
      .prepare(
        `SELECT 1 AS hit FROM auth_identities WHERE user_id = ? AND provider = 'password' LIMIT 1`
      )
      .bind(targetUserId)
      .first<{ hit: number }>();

    const nextProvider: AuthProvider = hasPasswordIdentity ? 'hybrid' : 'google';
    const nextAvatarUrl = targetUser.avatar_url ?? claims.picture;
    const identityId = generatePrefixedId('idn', 12);

    await db.batch([
      db
        .prepare(
          `INSERT INTO auth_identities (
             identity_id, user_id, provider, provider_subject,
             password_hash, password_salt, password_algo,
             created_at, updated_at
           ) VALUES (?, ?, 'google', ?, NULL, NULL, NULL, ?, ?)`
        )
        .bind(identityId, targetUserId, claims.sub, now, now),
      db
        .prepare(
          `UPDATE users
           SET auth_provider = ?,
               avatar_url = COALESCE(avatar_url, ?),
               updated_at = ?
           WHERE user_id = ?`
        )
        .bind(nextProvider, nextAvatarUrl, now, targetUserId),
    ]);

    return {
      ok: true,
      status: 200,
      flowMode: 'link',
      user: {
        ...mapUserRowToPublic(targetUser),
        authProvider: nextProvider,
        avatarUrl: nextAvatarUrl,
      },
      clearedGuestCookie: false,
      message: 'حساب گوگل شما با موفقیت به حساب مرکزی ایوان متصل شد.',
    };
  }

  // -------------------------------------------------------------------------
  // FLOW B: Google Login / Registration (`mode === 'login'`)
  // -------------------------------------------------------------------------
  const sessionTtlSec = resolveAuthSessionTtlSec(input.sessionTtlSec);
  const rawSessionToken = generateOpaqueToken(32);
  const [sessionTokenHash, ipHash, uaHash] = await Promise.all([
    sha256Hex(rawSessionToken),
    sha256Hex(`ip:${input.clientIp || 'unknown'}`),
    sha256Hex(`ua:${input.userAgent || 'unknown'}`),
  ]);
  const sessionId = generatePrefixedId('ses', 12);
  const sessionExpiresAt = now + sessionTtlSec * 1000;

  // B1) Returning Google user (identified strictly by immutable `sub`)
  if (existingIdentity) {
    const userRow = await db
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
      .bind(existingIdentity.user_id)
      .first<UserRow>();

    if (!userRow) {
      return {
        ok: false,
        status: 404,
        code: 'ACCOUNT_DISABLED',
        message: 'حساب کاربری متصل به این شناسه گوگل یافت نشد.',
      };
    }

    if (
      userRow.account_status === 'suspended' ||
      userRow.account_status === 'deleted'
    ) {
      return {
        ok: false,
        status: 403,
        code: 'ACCOUNT_DISABLED',
        message: 'این حساب کاربری غیرفعال یا مسدود شده است.',
      };
    }

    await db.batch([
      db
        .prepare(
          `INSERT INTO auth_sessions (
             session_id, user_id, token_hash, ip_hash, user_agent_hash,
             created_at, last_seen_at, expires_at, revoked_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`
        )
        .bind(
          sessionId,
          userRow.user_id,
          sessionTokenHash,
          ipHash,
          uaHash,
          now,
          now,
          sessionExpiresAt
        ),
      db
        .prepare(
          `UPDATE users
           SET last_seen_at = ?,
               avatar_url = COALESCE(avatar_url, ?),
               updated_at = ?
           WHERE user_id = ?`
        )
        .bind(now, claims.picture, now, userRow.user_id),
    ]);

    return {
      ok: true,
      status: 200,
      flowMode: 'login',
      user: {
        ...mapUserRowToPublic(userRow),
        avatarUrl: userRow.avatar_url ?? claims.picture,
        lastSeenAt: now,
      },
      session: {
        sessionId,
        createdAt: now,
        expiresAt: sessionExpiresAt,
      },
      rawSessionToken,
      sessionTtlSec,
      clearedGuestCookie: false,
      message: 'با موفقیت از طریق گوگل وارد حساب کاربری شدید.',
    };
  }

  // B2) Brand-new Google `sub`: Anti-Takeover check against existing email_key
  const emailOwner = await db
    .prepare(
      `SELECT user_id, account_status
       FROM users
       WHERE email_key = ?
       LIMIT 1`
    )
    .bind(claims.emailKey)
    .first<{ user_id: string; account_status: AccountStatus }>();

  if (emailOwner) {
    return {
      ok: false,
      status: 409,
      code: 'ACCOUNT_LINK_REQUIRED',
      message:
        'حسابی با این ایمیل از قبل ثبت شده است. برای امنیت حساب، ابتدا با رمز عبور وارد شوید و سپس از بخش «پروفایل ← امنیت و حساب کاربری» اتصال گوگل را فعال کنید.',
    };
  }

  // B3) Upgrade verified guest account in-place if this flow started from an active guest session
  let upgradedGuest: UserRow | null = null;
  if (stateRow.guest_user_id) {
    const candidateGuest = await db
      .prepare(
        `SELECT
           user_id, username, username_key, display_name,
           email, email_key, email_verified,
           avatar_code, avatar_url, auth_provider, account_status,
           created_at, last_seen_at
         FROM users
         WHERE user_id = ? AND account_status = 'guest' AND auth_provider = 'guest'
         LIMIT 1`
      )
      .bind(stateRow.guest_user_id)
      .first<UserRow>();
    if (candidateGuest) {
      upgradedGuest = candidateGuest;
    }
  }

  const identityId = generatePrefixedId('idn', 12);

  if (upgradedGuest) {
    const allocated = await allocateUniqueUsernameForGoogle(
      db,
      [upgradedGuest.username, claims.email, claims.name],
      upgradedGuest.user_id
    );

    await db.batch([
      db
        .prepare(
          `UPDATE users
           SET username = ?,
               username_key = ?,
               display_name = ?,
               email = ?,
               email_key = ?,
               email_verified = 1,
               avatar_url = COALESCE(avatar_url, ?),
               auth_provider = 'google',
               account_status = 'active',
               last_seen_at = ?,
               updated_at = ?
           WHERE user_id = ? AND account_status = 'guest'`
        )
        .bind(
          allocated.username,
          allocated.usernameKey,
          claims.name ?? allocated.username,
          claims.email,
          claims.emailKey,
          claims.picture,
          now,
          now,
          upgradedGuest.user_id
        ),
      db
        .prepare(
          `INSERT INTO auth_identities (
             identity_id, user_id, provider, provider_subject,
             password_hash, password_salt, password_algo,
             created_at, updated_at
           ) VALUES (?, ?, 'google', ?, NULL, NULL, NULL, ?, ?)`
        )
        .bind(identityId, upgradedGuest.user_id, claims.sub, now, now),
      db
        .prepare(
          `INSERT INTO auth_sessions (
             session_id, user_id, token_hash, ip_hash, user_agent_hash,
             created_at, last_seen_at, expires_at, revoked_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`
        )
        .bind(
          sessionId,
          upgradedGuest.user_id,
          sessionTokenHash,
          ipHash,
          uaHash,
          now,
          now,
          sessionExpiresAt
        ),
    ]);

    await revokeGuestSessionsForUser(db, upgradedGuest.user_id, now);

    return {
      ok: true,
      status: 200,
      flowMode: 'login',
      user: {
        userId: upgradedGuest.user_id,
        username: allocated.username,
        displayName: claims.name ?? allocated.username,
        email: claims.email,
        emailVerified: true,
        avatarCode: upgradedGuest.avatar_code,
        avatarUrl: upgradedGuest.avatar_url ?? claims.picture,
        authProvider: 'google',
        accountStatus: 'active',
        createdAt: upgradedGuest.created_at,
        lastSeenAt: now,
      },
      session: {
        sessionId,
        createdAt: now,
        expiresAt: sessionExpiresAt,
      },
      rawSessionToken,
      sessionTtlSec,
      clearedGuestCookie: true,
      message: 'حساب مهمان شما با حفظ سوابق به حساب گوگل ارتقا یافت.',
    };
  }

  // B4) Create brand-new active Google user
  const newUserId = generatePrefixedId('usr', 12);
  const allocated = await allocateUniqueUsernameForGoogle(db, [
    claims.email,
    claims.name,
  ]);

  await db.batch([
    db
      .prepare(
        `INSERT INTO users (
           user_id, username, username_key, display_name,
           email, email_key, email_verified,
           avatar_code, avatar_url, auth_provider, account_status,
           created_at, last_seen_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 1, 'portrait', ?, 'google', 'active', ?, ?, ?)`
      )
      .bind(
        newUserId,
        allocated.username,
        allocated.usernameKey,
        claims.name ?? allocated.username,
        claims.email,
        claims.emailKey,
        claims.picture,
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
         ) VALUES (?, ?, 'google', ?, NULL, NULL, NULL, ?, ?)`
      )
      .bind(identityId, newUserId, claims.sub, now, now),
    db
      .prepare(
        `INSERT INTO auth_sessions (
           session_id, user_id, token_hash, ip_hash, user_agent_hash,
           created_at, last_seen_at, expires_at, revoked_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .bind(
        sessionId,
        newUserId,
        sessionTokenHash,
        ipHash,
        uaHash,
        now,
        now,
        sessionExpiresAt
      ),
  ]);

  return {
    ok: true,
    status: 201,
    flowMode: 'login',
    user: {
      userId: newUserId,
      username: allocated.username,
      displayName: claims.name ?? allocated.username,
      email: claims.email,
      emailVerified: true,
      avatarCode: 'portrait',
      avatarUrl: claims.picture,
      authProvider: 'google',
      accountStatus: 'active',
      createdAt: now,
      lastSeenAt: now,
    },
    session: {
      sessionId,
      createdAt: now,
      expiresAt: sessionExpiresAt,
    },
    rawSessionToken,
    sessionTtlSec,
    clearedGuestCookie: false,
    message: 'حساب کاربری شما با گوگل ساخته و فعال شد.',
  };
}
