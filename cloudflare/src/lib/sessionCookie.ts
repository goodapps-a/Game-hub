/**
 * Game-agnostic HttpOnly session cookie utilities for secure page-refresh recovery.
 *
 * Security Properties:
 * - Cookie is strictly `HttpOnly` (never readable by client JS; zero localStorage/sessionStorage).
 * - Value stores `<roomCode>.<playerId>.<sessionToken>` validated on the server in constant time
 *   against the authoritative room Durable Object (or Node RoomManager).
 * - Uses `SameSite=None; Secure; Partitioned` over HTTPS (works inside iframes and cross-site
 *   same-site setups) and `SameSite=Lax` for local plain HTTP development.
 * - Cleared immediately (`Max-Age=0`) on explicit leave or invalid/expired resume.
 */

import { sanitizeRoomCode } from '../../../src/games/hokm/online/protocol';

export const SESSION_COOKIE_NAME = 'eyvan_hokm_sess';
const SESSION_COOKIE_MAX_AGE_SEC = 2 * 60 * 60; // 2 hours

export interface ParsedSessionCookie {
  readonly roomCode: string;
  readonly playerId: string;
  readonly sessionToken: string;
}

const PLAYER_ID_RE = /^[A-Za-z0-9_-]{4,80}$/;
const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{16,160}$/;

export function parseSessionCookieFromHeader(
  cookieHeader: string | null | undefined
): ParsedSessionCookie | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key !== SESSION_COOKIE_NAME) continue;
    const rawVal = part.slice(eqIdx + 1).trim();
    if (!rawVal) return null;

    let decoded: string;
    try {
      decoded = decodeURIComponent(rawVal);
    } catch {
      return null;
    }

    const segments = decoded.split('.');
    if (segments.length !== 3) return null;

    const roomCode = sanitizeRoomCode(segments[0]);
    const playerId = segments[1];
    const sessionToken = segments[2];
    if (
      !roomCode ||
      !PLAYER_ID_RE.test(playerId) ||
      !SESSION_TOKEN_RE.test(sessionToken)
    ) {
      return null;
    }
    return { roomCode, playerId, sessionToken };
  }
  return null;
}

export function isHttpsRequest(request: Request): boolean {
  const forwardedProto = request.headers.get('X-Forwarded-Proto');
  if (forwardedProto) {
    return forwardedProto.split(',')[0].trim().toLowerCase() === 'https';
  }
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return true;
  }
}

export function buildSetSessionCookieHeader(
  session: ParsedSessionCookie,
  secure: boolean
): string {
  const value = encodeURIComponent(
    `${session.roomCode}.${session.playerId}.${session.sessionToken}`
  );
  const attrs = [
    `${SESSION_COOKIE_NAME}=${value}`,
    'Path=/',
    `Max-Age=${SESSION_COOKIE_MAX_AGE_SEC}`,
    'HttpOnly',
  ];
  if (secure) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  return attrs.join('; ');
}

export function buildClearSessionCookieHeader(secure: boolean): string {
  const attrs = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
  ];
  if (secure) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  return attrs.join('; ');
}
