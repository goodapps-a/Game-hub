/**
 * Cloudflare Worker Entrypoint:
 * - HTTP REST API: /api/health, /api/rooms, /api/rooms/:code, /api/rooms/:code/join, /api/matches, /api/stats/:username
 * - WebSocket Upgrade Forwarding: /ws/rooms/:code -> Durable Object HOKM_ROOM
 * - R2 Asset Delivery: /r2/* -> EYVAN_ASSETS bucket with immutable caching
 */

import {
  sanitizeRoomCode,
  sanitizeUsername,
} from '../../src/games/hokm/online/protocol';
import { CfWorkerEnv, HokmRoomDO } from './HokmRoomDO';

export { HokmRoomDO };

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateShortRoomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

function buildCorsHeaders(request: Request, env: CfWorkerEnv): HeadersInit {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (origin && allowed.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      Vary: 'Origin',
    };
  }
  return {};
}

export default {
  async fetch(request: Request, env: CfWorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const cors = buildCorsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // 1) Health check
    if (url.pathname === '/api/health') {
      return Response.json(
        { ok: true, runtime: 'cloudflare-workers', ts: Date.now() },
        { headers: cors }
      );
    }

    // 2) R2 asset serving (card artwork, audio, avatars)
    if (url.pathname.startsWith('/r2/') && request.method === 'GET') {
      const key = url.pathname.slice(4);
      if (!key || key.includes('..')) {
        return new Response('Invalid key', { status: 400 });
      }
      const object = await env.EYVAN_ASSETS.get(key);
      if (!object) return new Response('Not Found', { status: 404 });
      const headers = new Headers();
      object.writeHttpMetadata?.(headers);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      return new Response(object.body, { headers });
    }

    // 3) WebSocket upgrade -> forward to room Durable Object
    const wsMatch = url.pathname.match(/^\/ws\/rooms\/([A-Za-z0-9]{4,8})$/);
    if (wsMatch) {
      const code = sanitizeRoomCode(wsMatch[1]);
      if (!code) return new Response('Invalid room code', { status: 400 });
      const id = env.HOKM_ROOM.idFromName(code);
      const stub = env.HOKM_ROOM.get(id);
      const doUrl = new URL(request.url);
      doUrl.searchParams.set('code', code);
      return stub.fetch(new Request(doUrl.toString(), request));
    }

    // 4) Create room
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      const code = generateShortRoomCode();
      const id = env.HOKM_ROOM.idFromName(code);
      const stub = env.HOKM_ROOM.get(id);
      const res = await stub.fetch(
        new Request(`https://room.internal/create?code=${code}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: await request.text(),
        })
      );
      return new Response(res.body, {
        status: res.status,
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
        const res = await stub.fetch(
          new Request(`https://room.internal/join?code=${code}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: await request.text(),
          })
        );
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

    // 6) D1 Recent Matches
    if (url.pathname === '/api/matches' && request.method === 'GET') {
      const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit')) || 10));
      const matchesRes = await env.EYVAN_DB.prepare(
        `SELECT * FROM matches ORDER BY finished_at DESC LIMIT ?`
      )
        .bind(limit)
        .all<Record<string, unknown>>();
      return Response.json(
        { matches: matchesRes.results ?? [] },
        { headers: cors }
      );
    }

    // 7) D1 Player Stats
    const statsMatch = url.pathname.match(/^\/api\/stats\/([A-Za-z0-9_]{3,20})$/);
    if (statsMatch && request.method === 'GET') {
      const username = sanitizeUsername(statsMatch[1]);
      if (!username) {
        return Response.json({ error: 'Invalid username' }, { status: 400, headers: cors });
      }
      const row = await env.EYVAN_DB.prepare(
        `SELECT * FROM player_stats WHERE username = ?`
      )
        .bind(username)
        .first<Record<string, unknown>>();
      return Response.json(
        row ?? {
          username,
          matches_played: 0,
          wins: 0,
          losses: 0,
          kot_wins: 0,
          hakem_kot_wins: 0,
          last_played_at: null,
        },
        { headers: cors }
      );
    }

    return new Response('Not Found', { status: 404, headers: cors });
  },
};
