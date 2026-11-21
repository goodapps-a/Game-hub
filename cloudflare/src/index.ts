/**
 * Cloudflare Worker Entrypoint:
 * - HTTP REST API: /api/health, /api/rooms, /api/rooms/:code, /api/rooms/:code/join, /api/matches, /api/stats/:username
 * - WebSocket Upgrade Forwarding: /ws/rooms/:code -> Durable Object HOKM_ROOM (Hibernation-enabled)
 * - R2 Asset Delivery: /r2/* -> EYVAN_ASSETS bucket with immutable caching
 * - Strict Origin / CORS enforcement (never wildcard `*` on mutating or WebSocket routes)
 */

import {
  sanitizeAvatarCode,
  sanitizeRoomCode,
  sanitizeUsername,
} from '../../src/games/hokm/online/protocol';
import { CfWorkerEnv } from './lib/types';
import { HokmRoomDO } from './HokmRoomDO';
import {
  fetchPlayerStatsFromD1,
  fetchRecentMatchesFromD1,
  upsertUserInD1,
} from './lib/d1Persistence';

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

function buildCorsHeaders(request: Request, env: CfWorkerEnv): HeadersInit {
  const origin = request.headers.get('Origin');
  const base: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
  };

  if (origin && isOriginAllowed(request, env)) {
    return {
      ...base,
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
      Vary: 'Origin',
    };
  }
  return base;
}

async function readBoundedBody(
  request: Request
): Promise<{ ok: true; text: string } | { ok: false }> {
  const text = await request.text();
  if (text.length > MAX_HTTP_BODY_BYTES) {
    return { ok: false };
  }
  return { ok: true, text };
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

export default {
  async fetch(request: Request, env: CfWorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const cors = buildCorsHeaders(request, env);

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

    // 3) WebSocket upgrade -> forward to room Durable Object
    const wsMatch = url.pathname.match(/^\/ws\/rooms\/([A-Za-z0-9]{4,8})$/);
    if (wsMatch) {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }
      const code = sanitizeRoomCode(wsMatch[1]);
      if (!code) return new Response('Invalid room code', { status: 400 });
      const id = env.HOKM_ROOM.idFromName(code);
      const stub = env.HOKM_ROOM.get(id);
      const doUrl = new URL(request.url);
      doUrl.searchParams.set('code', code);
      return stub.fetch(new Request(doUrl.toString(), request));
    }

    // 4) Create room (retries on unlikely room-code collision with active room)
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      const bodyRead = await readBoundedBody(request);
      if (bodyRead.ok === false) {
        return Response.json(
          { code: 'INVALID_MESSAGE', message: 'حجم درخواست بیش از حد مجاز است.' },
          { status: 413, headers: cors }
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
          if (res.ok) {
            const user = tryExtractUserForUpsert(bodyRead.text);
            if (user) {
              try {
                await upsertUserInD1(env.EYVAN_DB, user.username, user.avatarCode);
              } catch (err) {
                console.error('[Worker] Non-fatal D1 user upsert error:', err);
              }
            }
          }
          return new Response(res.body, {
            status: res.status,
            headers: { 'Content-Type': 'application/json', ...cors },
          });
        }
      }

      return new Response(lastRes?.body ?? '{"code":"ROOM_EXISTS"}', {
        status: lastRes?.status ?? 503,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    // 5) Room summary & join
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
        const bodyRead = await readBoundedBody(request);
        if (bodyRead.ok === false) {
          return Response.json(
            { code: 'INVALID_MESSAGE', message: 'حجم درخواست بیش از حد مجاز است.' },
            { status: 413, headers: cors }
          );
        }

        const res = await stub.fetch(
          new Request(`https://room.internal/join?code=${code}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: bodyRead.text,
          })
        );

        if (res.ok) {
          const user = tryExtractUserForUpsert(bodyRead.text);
          if (user) {
            try {
              await upsertUserInD1(env.EYVAN_DB, user.username, user.avatarCode);
            } catch (err) {
              console.error('[Worker] Non-fatal D1 user upsert error:', err);
            }
          }
        }

        return new Response(res.body, {
          status: res.status,
          headers: { 'Content-Type': 'application/json', ...cors },
        });
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

    // 6) D1 Recent Matches (camelCase + 4-player roster, error-resilient)
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

    // 7) D1 Player Stats (case-insensitive camelCase, error-resilient)
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
