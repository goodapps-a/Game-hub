/**
 * Cloudflare Worker Entrypoint:
 * - HTTP REST API:
 *   /api/health, /api/rooms, /api/rooms/:code, /api/rooms/:code/join,
 *   /api/session/resume, /api/session/clear, /api/matches, /api/stats/:username
 * - WebSocket Upgrade Forwarding: /ws/rooms/:code -> Durable Object HOKM_ROOM (Hibernation-enabled)
 * - R2 Asset Delivery: /r2/* -> EYVAN_ASSETS bucket with immutable caching
 * - Strict Origin / CORS enforcement (never wildcard `*`) + Streaming UTF-8 byte limits
 * - HttpOnly session cookie issuance & server-verified resume for page refresh recovery
 */

import {
  CreateRoomResponse,
  JoinRoomResponse,
  sanitizeAvatarCode,
  sanitizeRoomCode,
  sanitizeUsername,
} from '../../src/games/hokm/online/protocol';
import { CfWorkerEnv } from './lib/types';
import { HokmRoomDO, INTERNAL_SESSION_TOKEN_HEADER } from './HokmRoomDO';
import {
  fetchPlayerStatsFromD1,
  fetchRecentMatchesFromD1,
  upsertUserInD1,
} from './lib/d1Persistence';
import { readBoundedUtf8Body } from './lib/httpBounds';
import {
  CookieHeaderOptions,
  buildClearSessionCookieHeader,
  buildSetSessionCookieHeader,
  isHttpsRequest,
  parseSessionCookieFromHeader,
} from './lib/sessionCookie';
import { handleAuthHttpRequest } from './lib/auth/httpHandler';

export { HokmRoomDO };

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_HTTP_BODY_BYTES = 16 * 1024;
const MAX_ROOM_CREATE_RETRIES = 5;

function generateShortRoomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

function parseAllowedOrigins(env: CfWorkerEnv): string[] {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Checks whether the request's Origin is permitted:
 * - No Origin header (same-origin navigation / non-browser client): allowed.
 * - Origin matches request's own origin: allowed.
 * - If `ALLOWED_ORIGINS` is configured: Origin MUST be in the allowlist.
 * - If `ALLOWED_ORIGINS` is empty (local dev): allow localhost/127.0.0.1 only.
 * Never returns wildcard `*`.
 */
export function isOriginAllowed(request: Request, env: CfWorkerEnv): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true;

  let parsedOrigin: URL;
  let reqUrl: URL;
  try {
    parsedOrigin = new URL(origin);
    reqUrl = new URL(request.url);
  } catch {
    return false;
  }

  if (parsedOrigin.origin === reqUrl.origin) return true;

  const allowed = parseAllowedOrigins(env);
  if (allowed.length > 0) {
    return allowed.includes(parsedOrigin.origin);
  }

  return (
    parsedOrigin.hostname === 'localhost' ||
    parsedOrigin.hostname === '127.0.0.1'
  );
}

function buildCorsHeaders(request: Request, env: CfWorkerEnv): Record<string, string> {
  const origin = request.headers.get('Origin');
  const base: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
  };

  if (origin && isOriginAllowed(request, env)) {
    return {
      ...base,
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
      Vary: 'Origin',
    };
  }
  return base;
}

function tryExtractUserForUpsert(
  rawJson: string
): { username: string; avatarCode: string } | null {
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    const username = sanitizeUsername(parsed?.username);
    if (!username) return null;
    return {
      username,
      avatarCode: sanitizeAvatarCode(parsed?.avatarCode),
    };
  } catch {
    return null;
  }
}

function buildJsonResponse(
  body: string,
  status: number,
  cors: Record<string, string>,
  setCookie?: string
): Response {
  const headers = new Headers({
    'Content-Type': 'application/json',
    ...cors,
  });
  if (setCookie) {
    headers.set('Set-Cookie', setCookie);
  }
  return new Response(body, { status, headers });
}

export default {
  async fetch(request: Request, env: CfWorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const cors = buildCorsHeaders(request, env);
    const secureCookie = isHttpsRequest(request);
    const cookieOpts: CookieHeaderOptions | undefined = env.COOKIE_DOMAIN
      ? { domain: env.COOKIE_DOMAIN }
      : undefined;

    if (request.method === 'OPTIONS') {
      if (!isOriginAllowed(request, env)) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: cors });
    }

    // Enforce Origin check on mutating API routes & WebSocket upgrades
    const isMutatingApi =
      url.pathname.startsWith('/api/') && request.method !== 'GET';
    const isWsUpgrade = url.pathname.startsWith('/ws/rooms/');
    if ((isMutatingApi || isWsUpgrade) && !isOriginAllowed(request, env)) {
      return Response.json(
        { code: 'FORBIDDEN_ORIGIN', message: 'مبدا درخواست مجاز نیست.' },
        { status: 403 }
      );
    }

    // 1) Health check
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return Response.json(
        {
          ok: true,
          service: 'eyvan-hokm-online',
          runtime: 'cloudflare-workers',
          serverTime: Date.now(),
        },
        { headers: cors }
      );
    }

    // 1b) Central Platform Authentication (`/api/auth/*` — independent of Hokm room sessions)
    if (url.pathname.startsWith('/api/auth/')) {
      const clientIp =
        request.headers.get('CF-Connecting-IP') ??
        request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
        'unknown';
      const authRes = await handleAuthHttpRequest(request, url.pathname, {
        db: env.EYVAN_DB,
        corsHeaders: cors,
        secureCookie,
        cookieOptions: cookieOpts,
        originAllowed: isOriginAllowed(request, env),
        clientIp,
        userAgent: request.headers.get('User-Agent') ?? 'unknown',
        sessionTtlSec: env.AUTH_SESSION_TTL_SEC,
      });
      if (authRes) return authRes;
    }

    // 2) R2 asset serving (card artwork, audio, avatars)
    if (url.pathname.startsWith('/r2/') && request.method === 'GET') {
      const key = url.pathname.slice(4);
      if (!key || key.includes('..') || key.startsWith('/')) {
        return new Response('Invalid key', { status: 400 });
      }
      const object = await env.EYVAN_ASSETS.get(key);
      if (!object) return new Response('Not Found', { status: 404 });
      const headers = new Headers();
      object.writeHttpMetadata?.(headers);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(object.body, { headers });
    }

    // 3) Cookie-Authenticated WebSocket upgrade -> verify session, then forward to room DO
    const wsMatch = url.pathname.match(/^\/ws\/rooms\/([A-Za-z0-9]{4,8})$/);
    if (wsMatch) {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }
      const code = sanitizeRoomCode(wsMatch[1]);
      if (!code) return new Response('Invalid room code', { status: 400 });

      const rawCookie = request.headers.get('Cookie');
      const parsedCookie = parseSessionCookieFromHeader(rawCookie);
      if (!parsedCookie || parsedCookie.roomCode !== code) {
        const hasMalformedCookie = Boolean(
          rawCookie && rawCookie.includes('eyvan_hokm_sess=') && !parsedCookie
        );
        return buildJsonResponse(
          JSON.stringify({
            code: 'UNAUTHORIZED',
            message: 'نشست معتبری برای اتصال به این اتاق یافت نشد.',
          }),
          401,
          cors,
          hasMalformedCookie
            ? buildClearSessionCookieHeader(secureCookie, cookieOpts)
            : undefined
        );
      }

      const id = env.HOKM_ROOM.idFromName(code);
      const stub = env.HOKM_ROOM.get(id);

      // Verify session directly against authoritative DO BEFORE accepting WebSocket
      const verifyRes = await stub.fetch(
        new Request(`https://room.internal/resume?code=${code}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerId: parsedCookie.playerId,
            sessionToken: parsedCookie.sessionToken,
          }),
        })
      );
      if (!verifyRes.ok) {
        const errText = await verifyRes.text();
        return buildJsonResponse(
          errText,
          verifyRes.status,
          cors,
          buildClearSessionCookieHeader(secureCookie, cookieOpts)
        );
      }

      // Forward sanitized upgrade request cleanly to DO (strip untrusted internal headers)
      const forwardHeaders = new Headers();
      request.headers.forEach((value, key) => {
        if (!key.toLowerCase().startsWith('x-eyvan-')) {
          forwardHeaders.set(key, value);
        }
      });
      forwardHeaders.set('X-Eyvan-Verified-Player', parsedCookie.playerId);

      const doUrl = new URL(request.url);
      doUrl.searchParams.set('code', code);
      return stub.fetch(
        new Request(doUrl.toString(), {
          method: request.method,
          headers: forwardHeaders,
        })
      );
    }

    // 4) Server-verified HttpOnly session resume (CSRF-protected via Origin + X-Requested-With)
    if (url.pathname === '/api/session/resume' && request.method === 'POST') {
      if (request.headers.get('X-Requested-With') !== 'eyvan-client') {
        return Response.json(
          { code: 'UNAUTHORIZED', message: 'درخواست نامعتبر است.' },
          { status: 403, headers: cors }
        );
      }

      const rawCookieHeader = request.headers.get('Cookie');
      const hasSessionCookie = Boolean(
        rawCookieHeader && rawCookieHeader.includes('eyvan_hokm_sess=')
      );
      if (!hasSessionCookie) {
        return Response.json({ active: false }, { status: 200, headers: cors });
      }

      const parsedCookie = parseSessionCookieFromHeader(rawCookieHeader);
      if (!parsedCookie) {
        const headers = new Headers(cors);
        headers.set(
          'Set-Cookie',
          buildClearSessionCookieHeader(secureCookie, cookieOpts)
        );
        return Response.json(
          { code: 'UNAUTHORIZED', message: 'نشست فعالی یافت نشد.' },
          { status: 401, headers }
        );
      }

      // Optional roomCode hint check: if caller provided a specific roomCode, must match cookie
      const bodyRead = await readBoundedUtf8Body(request, 2048);
      if (bodyRead.ok && bodyRead.text.trim().length > 0) {
        try {
          const bodyObj = JSON.parse(bodyRead.text) as Record<string, unknown>;
          const requestedCode = sanitizeRoomCode(bodyObj?.roomCode);
          if (requestedCode && requestedCode !== parsedCookie.roomCode) {
            return Response.json(
              { code: 'UNAUTHORIZED', message: 'نشست متعلق به این اتاق نیست.' },
              { status: 401, headers: cors }
            );
          }
        } catch {
          return Response.json(
            { code: 'INVALID_MESSAGE', message: 'فرمت JSON نامعتبر است.' },
            { status: 400, headers: cors }
          );
        }
      }

      const id = env.HOKM_ROOM.idFromName(parsedCookie.roomCode);
      const stub = env.HOKM_ROOM.get(id);
      const res = await stub.fetch(
        new Request(
          `https://room.internal/resume?code=${parsedCookie.roomCode}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              playerId: parsedCookie.playerId,
              sessionToken: parsedCookie.sessionToken,
            }),
          }
        )
      );

      const text = await res.text();
      if (!res.ok) {
        // Clear dead/expired session cookie immediately so it cannot be replayed
        return buildJsonResponse(
          text,
          res.status,
          cors,
          buildClearSessionCookieHeader(secureCookie, cookieOpts)
        );
      }

      return buildJsonResponse(text, 200, cors);
    }

    // 5) Clear HttpOnly session cookie on intentional leave
    if (url.pathname === '/api/session/clear' && request.method === 'POST') {
      if (request.headers.get('X-Requested-With') !== 'eyvan-client') {
        return Response.json(
          { code: 'UNAUTHORIZED', message: 'درخواست نامعتبر است.' },
          { status: 403, headers: cors }
        );
      }
      return buildJsonResponse(
        JSON.stringify({ ok: true }),
        200,
        cors,
        buildClearSessionCookieHeader(secureCookie, cookieOpts)
      );
    }

    // 6) Create room (streaming UTF-8 byte bound + room-code collision retries + HttpOnly session cookie)
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      const bodyRead = await readBoundedUtf8Body(request, MAX_HTTP_BODY_BYTES);
      if (bodyRead.ok === false) {
        return Response.json(
          {
            code: 'INVALID_MESSAGE',
            message:
              bodyRead.status === 413
                ? 'حجم درخواست بیش از حد مجاز است.'
                : 'خطا در خواندن بدنه درخواست.',
          },
          { status: bodyRead.status, headers: cors }
        );
      }

      let lastRes: Response | null = null;
      for (let attempt = 0; attempt < MAX_ROOM_CREATE_RETRIES; attempt++) {
        const code = generateShortRoomCode();
        const id = env.HOKM_ROOM.idFromName(code);
        const stub = env.HOKM_ROOM.get(id);
        const res = await stub.fetch(
          new Request(`https://room.internal/create?code=${code}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: bodyRead.text,
          })
        );
        lastRes = res;
        if (res.status !== 409) {
          const text = await res.text();
          const internalToken = res.headers.get(INTERNAL_SESSION_TOKEN_HEADER);
          let setCookie: string | undefined;
          if (res.ok) {
            const user = tryExtractUserForUpsert(bodyRead.text);
            if (user) {
              try {
                await upsertUserInD1(env.EYVAN_DB, user.username, user.avatarCode);
              } catch (err) {
                console.error('[Worker] Non-fatal D1 user upsert error:', err);
              }
            }
            try {
              const created = JSON.parse(text) as CreateRoomResponse;
              if (created.roomCode && created.playerId && internalToken) {
                setCookie = buildSetSessionCookieHeader(
                  {
                    roomCode: created.roomCode,
                    playerId: created.playerId,
                    sessionToken: internalToken,
                  },
                  secureCookie,
                  cookieOpts
                );
              }
            } catch {
              // Ignore
            }
          }
          return buildJsonResponse(text, res.status, cors, setCookie);
        }
      }

      return new Response(lastRes?.body ?? '{"code":"ROOM_EXISTS"}', {
        status: lastRes?.status ?? 503,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    // 7) Room summary & join
    const roomMatch = url.pathname.match(
      /^\/api\/rooms\/([A-Za-z0-9]{4,8})(\/join)?$/
    );
    if (roomMatch) {
      const code = sanitizeRoomCode(roomMatch[1]);
      if (!code) {
        return Response.json(
          { code: 'INVALID_MESSAGE', message: 'کد اتاق نامعتبر است.' },
          { status: 400, headers: cors }
        );
      }
      const isJoin = Boolean(roomMatch[2]);
      const id = env.HOKM_ROOM.idFromName(code);
      const stub = env.HOKM_ROOM.get(id);

      if (isJoin && request.method === 'POST') {
        const bodyRead = await readBoundedUtf8Body(request, MAX_HTTP_BODY_BYTES);
        if (bodyRead.ok === false) {
          return Response.json(
            {
              code: 'INVALID_MESSAGE',
              message:
                bodyRead.status === 413
                  ? 'حجم درخواست بیش از حد مجاز است.'
                  : 'خطا در خواندن بدنه درخواست.',
            },
            { status: bodyRead.status, headers: cors }
          );
        }

        const res = await stub.fetch(
          new Request(`https://room.internal/join?code=${code}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: bodyRead.text,
          })
        );

        const text = await res.text();
        const internalToken = res.headers.get(INTERNAL_SESSION_TOKEN_HEADER);
        let setCookie: string | undefined;
        if (res.ok) {
          const user = tryExtractUserForUpsert(bodyRead.text);
          if (user) {
            try {
              await upsertUserInD1(env.EYVAN_DB, user.username, user.avatarCode);
            } catch (err) {
              console.error('[Worker] Non-fatal D1 user upsert error:', err);
            }
          }
          try {
            const joined = JSON.parse(text) as JoinRoomResponse;
            if (joined.roomCode && joined.playerId && internalToken) {
              setCookie = buildSetSessionCookieHeader(
                {
                  roomCode: joined.roomCode,
                  playerId: joined.playerId,
                  sessionToken: internalToken,
                },
                secureCookie,
                cookieOpts
              );
            }
          } catch {
            // Ignore
          }
        }

        return buildJsonResponse(text, res.status, cors, setCookie);
      }

      if (!isJoin && request.method === 'GET') {
        const res = await stub.fetch(
          new Request(`https://room.internal/summary?code=${code}`)
        );
        return new Response(res.body, {
          status: res.status,
          headers: { 'Content-Type': 'application/json', ...cors },
        });
      }
    }

    // 8) D1 Recent Matches (camelCase + 4-player roster, error-resilient)
    if (url.pathname === '/api/matches' && request.method === 'GET') {
      const limit = Number(url.searchParams.get('limit')) || 10;
      try {
        const matches = await fetchRecentMatchesFromD1(env.EYVAN_DB, limit);
        return Response.json({ matches }, { headers: cors });
      } catch (err) {
        console.error('[Worker] D1 /api/matches query failed:', err);
        return Response.json(
          {
            code: 'DATABASE_ERROR',
            message: 'خطا در خواندن تاریخچه مسابقات.',
            matches: [],
          },
          { status: 503, headers: cors }
        );
      }
    }

    // 9) D1 Player Stats (canonical case-insensitive camelCase, error-resilient)
    const statsMatch = url.pathname.match(/^\/api\/stats\/([A-Za-z0-9_]{3,20})$/);
    if (statsMatch && request.method === 'GET') {
      const username = sanitizeUsername(statsMatch[1]);
      if (!username) {
        return Response.json(
          { code: 'INVALID_MESSAGE', message: 'نام کاربری نامعتبر است.' },
          { status: 400, headers: cors }
        );
      }
      try {
        const stats = await fetchPlayerStatsFromD1(env.EYVAN_DB, username);
        return Response.json(stats, { headers: cors });
      } catch (err) {
        console.error('[Worker] D1 /api/stats query failed:', err);
        return Response.json(
          { code: 'DATABASE_ERROR', message: 'خطا در خواندن آمار بازیکن.' },
          { status: 503, headers: cors }
        );
      }
    }

    return new Response('Not Found', { status: 404, headers: cors });
  },
};
