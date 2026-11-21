/**
 * Central platform account session cookie utilities (`eyvan_auth_sess`).
 *
 * Strictly independent of Hokm room session cookie (`eyvan_hokm_sess`):
 * - Setting or clearing `eyvan_auth_sess` NEVER touches `eyvan_hokm_sess`.
 * - Cookie stores ONLY the raw high-entropy opaque token (`HttpOnly`), while the
 *   database stores ONLY its SHA-256 hash (`auth_sessions.token_hash`).
 * - Over HTTPS: `HttpOnly; Secure; SameSite=None; Partitioned` (supports AI Studio iframe
 *   and cross-subdomain Cloudflare Pages <-> Worker deployments).
 * - Over plain HTTP (localhost dev): `HttpOnly; SameSite=Lax`.
 */

import { CookieHeaderOptions } from '../sessionCookie';

export const AUTH_COOKIE_NAME = 'eyvan_auth_sess';
export const DEFAULT_AUTH_SESSION_TTL_SEC = 7 * 24 * 60 * 60; // 7 days
const MIN_AUTH_SESSION_TTL_SEC = 5 * 60; // 5 minutes
const MAX_AUTH_SESSION_TTL_SEC = 30 * 24 * 60 * 60; // 30 days

const OPAQUE_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const COOKIE_DOMAIN_RE =
  /^\.?[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;

function sanitizeCookieDomain(domain?: string): string | null {
  if (!domain) return null;
  const trimmed = domain.trim().toLowerCase();
  if (!trimmed || !COOKIE_DOMAIN_RE.test(trimmed)) return null;
  return trimmed;
}

export function resolveAuthSessionTtlSec(raw?: string | number): number {
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num) || num <= 0) return DEFAULT_AUTH_SESSION_TTL_SEC;
  return Math.min(
    MAX_AUTH_SESSION_TTL_SEC,
    Math.max(MIN_AUTH_SESSION_TTL_SEC, Math.floor(num))
  );
}

export function parseAuthCookieFromHeader(
  cookieHeader: string | null | undefined
): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key !== AUTH_COOKIE_NAME) continue;
    const rawVal = part.slice(eqIdx + 1).trim();
    if (!rawVal) return null;
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawVal);
    } catch {
      return null;
    }
    if (!OPAQUE_TOKEN_RE.test(decoded)) return null;
    return decoded;
  }
  return null;
}

export function hasAuthCookieInHeader(
  cookieHeader: string | null | undefined
): boolean {
  if (!cookieHeader) return false;
  return cookieHeader
    .split(';')
    .some((part) => part.trim().startsWith(`${AUTH_COOKIE_NAME}=`));
}

export function buildSetAuthCookieHeader(
  rawToken: string,
  secure: boolean,
  ttlSec = DEFAULT_AUTH_SESSION_TTL_SEC,
  options?: CookieHeaderOptions
): string {
  const safeTtl = resolveAuthSessionTtlSec(ttlSec);
  const attrs = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    `Max-Age=${safeTtl}`,
    'HttpOnly',
  ];
  const domain = sanitizeCookieDomain(options?.domain);
  if (domain) {
    attrs.push(`Domain=${domain}`);
  }
  if (secure) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  return attrs.join('; ');
}

export function buildClearAuthCookieHeader(
  secure: boolean,
  options?: CookieHeaderOptions
): string {
  const attrs = [
    `${AUTH_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
  ];
  const domain = sanitizeCookieDomain(options?.domain);
  if (domain) {
    attrs.push(`Domain=${domain}`);
  }
  if (secure) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  return attrs.join('; ');
}
