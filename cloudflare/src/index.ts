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
  PublicRoomSummary,
  sanitizeAvatarCode,
  sanitizeRoomCode,
  sanitizeUsername,
} from '../../src/games/hokm/online/protocol';
import {
  CfWorkerEnv,
  DurableObjectNamespaceLike,
  ExecutionContextLike,
  ScheduledControllerLike,
} from './lib/types';
import {
  HokmRoomDO,
  INTERNAL_SESSION_TOKEN_HEADER,
  INTERNAL_VERIFIED_APPEARANCE_HEADER,
} from './HokmRoomDO';
import {
  CHAT_INTERNAL_ACTION_HEADER,
  CHAT_VERIFIED_CONVERSATION_HEADER,
  CHAT_VERIFIED_SESSION_HEADER,
  CHAT_VERIFIED_USER_HEADER,
  ChatConversationDO,
} from './ChatConversationDO';
import {
  ChatRealtimePublisher,
  ChatWireMessage,
} from '../../src/platform/social/chatRealtimeProtocol';
import {
  fetchHokmLeaderboardFromD1,
  fetchPlayerStatsByUserIdFromD1,
  fetchPlayerStatsFromD1,
  fetchRecentMatchesFromD1,
  touchVerifiedUserLastSeenInD1,
} from './lib/d1Persistence';
import { readBoundedUtf8Body } from './lib/httpBounds';
import {
  CookieHeaderOptions,
  buildClearSessionCookieHeader,
  buildSetSessionCookieHeader,
  isHttpsRequest,
  parseSessionCookieFromHeader,
} from './lib/sessionCookie';
import {
  buildClearAuthCookieHeader,
  parseAuthCookieFromHeader,
} from './lib/auth/authCookie';
import {
  pruneExpiredAuthSessionsBatched,
  verifyAuthSession,
} from './lib/auth/authService';
import { pruneExpiredAuthTokensBatched } from './lib/auth/c2Service';
import {
  buildSetGuestCookieHeader,
  parseGuestCookieFromHeader,
  pruneExpiredGuestSessionsBatched,
  resolveOrCreateGuestIdentity,
} from './lib/auth/guestSession';
import { pruneExpiredOAuthStatesBatched } from './lib/auth/googleOAuthService';
import { handleAuthHttpRequest } from './lib/auth/httpHandler';
import {
  createEmailSender,
  resolvePublicAppBaseUrl,
} from './lib/auth/emailService';
import { pruneExpiredRateLimitsBatched } from './lib/auth/rateLimit';
import {
  evaluateOriginPolicy,
  resolveClientIp,
} from './lib/auth/securityPolicy';
import {
  authorizeConversationRealtimeAccess,
  listUserActiveDirectConversationIds,
} from './lib/social/chatService';
import { handleSocialHttpRequest } from './lib/social/httpHandler';
import { handleItemsHttpRequest } from './lib/items/httpHandler';
import { getPublicAppearanceForUser } from './lib/items/inventoryService';
import { handlePaymentsHttpRequest } from './lib/payments/httpHandler';
import { pruneExpiredGameInvitesBatched } from './lib/social/inviteService';
import { pruneExpiredPresenceSessionsBatched } from './lib/social/socialService';
import { RoomInviteCheckSummary } from './lib/social/types';

export { HokmRoomDO, ChatConversationDO };

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

function isWorkerProduction(request: Request, env: CfWorkerEnv): boolean {
  const envName = env.ENVIRONMENT?.trim().toLowerCase();
  if (envName === 'production') return true;
  if (envName === 'development' || envName === 'test') return false;
  try {
    const reqUrl = new URL(request.url);
    return reqUrl.hostname !== 'localhost' && reqUrl.hostname !== '127.0.0.1';
  } catch {
    return true;
  }
}

/**
 * Evaluates Origin / Referer / Sec-Fetch-Site using the shared strict security policy:
 * - Zero wildcards (`*` or `*.run.app`).
 * - Exact Same-Origin or explicitly configured `ALLOWED_ORIGINS` / `APP_URL` only.
 * - In Production, missing `ALLOWED_ORIGINS` never falls back to localhost or wildcard access.
 */
export function isOriginAllowed(request: Request, env: CfWorkerEnv): boolean {
  let requestOrigin = '';
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    return false;
  }

  return evaluateOriginPolicy({
    originHeader: request.headers.get('Origin'),
    refererHeader: request.headers.get('Referer'),
    secFetchSite: request.headers.get('Sec-Fetch-Site'),
    requestOrigin,
    method: request.method,
    config: {
      allowedOriginsRaw: env.ALLOWED_ORIGINS,
      appUrlRaw: env.APP_URL ?? env.PUBLIC_APP_URL,
      isProduction: isWorkerProduction(request, env),
    },
  }).allowed;
}

function buildCorsHeaders(request: Request, env: CfWorkerEnv): Record<string, string> {
  const base: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
  };

  let requestOrigin = '';
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    return base;
  }

  const evaluation = evaluateOriginPolicy({
    originHeader: request.headers.get('Origin'),
    refererHeader: request.headers.get('Referer'),
    secFetchSite: request.headers.get('Sec-Fetch-Site'),
    requestOrigin,
    method: request.method,
    config: {
      allowedOriginsRaw: env.ALLOWED_ORIGINS,
      appUrlRaw: env.APP_URL ?? env.PUBLIC_APP_URL,
      isProduction: isWorkerProduction(request, env),
    },
  });

  if (evaluation.allowed && evaluation.corsOrigin) {
    return {
      ...base,
      'Access-Control-Allow-Origin': evaluation.corsOrigin,
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
  setCookie?: string | string[]
): Response {
  const headers = new Headers({
    'Content-Type': 'application/json',
    ...cors,
  });
  if (typeof setCookie === 'string' && setCookie) {
    headers.append('Set-Cookie', setCookie);
  } else if (Array.isArray(setCookie)) {
    for (const c of setCookie) {
      if (c) headers.append('Set-Cookie', c);
    }
  }
  return new Response(body, { status, headers });
}

function mapPublicSummaryToInviteCheck(
  summary: PublicRoomSummary
): RoomInviteCheckSummary {
  const playerUsernames = summary.seats
    .map((s) => s.username)
    .filter((u): u is string => typeof u === 'string' && u.length > 0);
  const host = summary.seats.find((s) => s.isHost)?.username ?? null;
  const status =
    summary.status === 'WAITING'
      ? 'WAITING'
      : summary.status === 'PLAYING'
        ? 'PLAYING'
        : 'FINISHED';
  return {
    roomCode: summary.roomCode,
    status,
    playerCount: summary.playerCount,
    maxPlayers: summary.maxPlayers,
    hostUsername: host,
    playerUsernames,
  };
}

function createWorkerChatRealtimePublisher(
  ns: DurableObjectNamespaceLike | undefined
): ChatRealtimePublisher | undefined {
  if (!ns) return undefined;

  const postToConversation = async (
    conversationId: string,
    path: string,
    action: string,
    body: Record<string, unknown>
  ): Promise<void> => {
    const id = ns.idFromName(conversationId);
    const stub = ns.get(id);
    await stub.fetch(
      new Request(`https://chat.internal${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [CHAT_INTERNAL_ACTION_HEADER]: action,
        },
        body: JSON.stringify(body),
      })
    );
  };

  return {
    async publishMessage(conversationId: string, message: ChatWireMessage) {
      await postToConversation(
        conversationId,
        '/broadcast/message',
        'broadcast_message',
        { conversationId, message }
      );
    },
    async publishRead(payload) {
      await postToConversation(
        payload.conversationId,
        '/broadcast/read',
        'broadcast_read',
        payload
      );
    },
    async revokeConversation(conversationId, reason) {
      await postToConversation(
        conversationId,
        '/disconnect/conversation',
        'disconnect_conversation',
        { conversationId, reason }
      );
    },
    async disconnectSession(conversationIds, authSessionId) {
      await Promise.allSettled(
        conversationIds.map((conversationId) =>
          postToConversation(
            conversationId,
            '/disconnect/session',
            'disconnect_session',
            { authSessionId }
          )
        )
      );
    },
    async disconnectUser(conversationIds, userId) {
      await Promise.allSettled(
        conversationIds.map((conversationId) =>
          postToConversation(
            conversationId,
            '/disconnect/user',
            'disconnect_user',
            { userId }
          )
        )
      );
    },
  };
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
    const isWsUpgrade =
      url.pathname.startsWith('/ws/rooms/') ||
      url.pathname.startsWith('/ws/social/chat/');
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
      const isProd = isWorkerProduction(request, env);
      // On Cloudflare Workers, trust ONLY edge-injected CF-Connecting-IP (never raw X-Forwarded-For)
      const clientIp = resolveClientIp({
        cfConnectingIp: request.headers.get('CF-Connecting-IP'),
      });
      const emailSender =
        env.EMAIL_SENDER ??
        createEmailSender({
          provider: env.EMAIL_PROVIDER,
          resendApiKey: env.RESEND_API_KEY,
          emailFrom: env.EMAIL_FROM,
          isProduction: isProd,
        });
      const publicAppBaseUrl = resolvePublicAppBaseUrl(
        [env.PUBLIC_APP_URL, env.APP_URL, env.ALLOWED_ORIGINS],
        request.url,
        { isProduction: isProd }
      );
      // Capture authenticated session before logout/revocation so active chat WebSockets disconnect immediately
      const isAuthRevokePath =
        request.method === 'POST' &&
        (url.pathname === '/api/auth/logout' ||
          url.pathname === '/api/auth/logout-all' ||
          url.pathname === '/api/auth/sessions/revoke');
      let preRevokeSession: { userId: string; sessionId: string } | null = null;
      let revokedTargetSessionId: string | null = null;
      let requestForAuth = request;
      if (isAuthRevokePath && env.CHAT_CONVERSATION) {
        const rawAuthTok = parseAuthCookieFromHeader(request.headers.get('Cookie'));
        if (rawAuthTok) {
          try {
            const v = await verifyAuthSession(env.EYVAN_DB, rawAuthTok);
            if (v.authenticated && v.user && v.session) {
              preRevokeSession = {
                userId: v.user.userId,
                sessionId: v.session.sessionId,
              };
            }
          } catch {
            // Non-fatal
          }
        }
        if (url.pathname === '/api/auth/sessions/revoke') {
          try {
            const cloned = request.clone();
            const parsed = (await cloned.json()) as Record<string, unknown>;
            if (typeof parsed?.sessionId === 'string' && parsed.sessionId.trim()) {
              revokedTargetSessionId = parsed.sessionId.trim();
            }
          } catch {
            // Ignore malformed JSON; auth handler will validate and respond cleanly
          }
        }
      }

      const authRes = await handleAuthHttpRequest(requestForAuth, url.pathname, {
        db: env.EYVAN_DB,
        corsHeaders: cors,
        secureCookie,
        cookieOptions: cookieOpts,
        originAllowed: isOriginAllowed(request, env),
        clientIp,
        userAgent: request.headers.get('User-Agent') ?? 'unknown',
        sessionTtlSec: env.AUTH_SESSION_TTL_SEC,
        publicAppBaseUrl: publicAppBaseUrl ?? undefined,
        isProduction: isProd,
        emailSender,
        googleOAuth: {
          clientId: env.GOOGLE_OAUTH_CLIENT_ID,
          clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
          redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
          fetchImpl: env.GOOGLE_OAUTH_FETCH,
        },
      });
      if (authRes) {
        if (authRes.ok && preRevokeSession && env.CHAT_CONVERSATION) {
          const chatPublisher = createWorkerChatRealtimePublisher(
            env.CHAT_CONVERSATION
          );
          if (chatPublisher) {
            try {
              const convIds = await listUserActiveDirectConversationIds(
                env.EYVAN_DB,
                preRevokeSession.userId
              );
              if (convIds.length > 0) {
                if (url.pathname === '/api/auth/logout-all') {
                  await chatPublisher.disconnectUser?.(
                    convIds,
                    preRevokeSession.userId
                  );
                } else {
                  const sidToDrop =
                    url.pathname === '/api/auth/sessions/revoke' &&
                    revokedTargetSessionId
                      ? revokedTargetSessionId
                      : preRevokeSession.sessionId;
                  await chatPublisher.disconnectSession?.(convIds, sidToDrop);
                }
              }
            } catch {
              // Best-effort realtime eviction
            }
          }
        }
        return authRes;
      }
    }

    // 1c) Social, Online Presence, Private Chat (D2) & Real-Room Game Invites (D3) (`/api/social/*`)
    if (url.pathname.startsWith('/api/social/')) {
      const clientIp = resolveClientIp({
        cfConnectingIp: request.headers.get('CF-Connecting-IP'),
      });
      const chatRealtimePublisher = createWorkerChatRealtimePublisher(
        env.CHAT_CONVERSATION
      );
      const socialRes = await handleSocialHttpRequest(request, url.pathname, {
        db: env.EYVAN_DB,
        corsHeaders: cors,
        secureCookie,
        cookieOptions: cookieOpts,
        originAllowed: isOriginAllowed(request, env),
        clientIp,
        chatRealtimePublisher,
        roomLookup: async (roomCode: string) => {
          try {
            const id = env.HOKM_ROOM.idFromName(roomCode);
            const stub = env.HOKM_ROOM.get(id);
            const res = await stub.fetch(
              new Request(`https://room.internal/summary?code=${roomCode}`)
            );
            if (!res.ok) return null;
            const summary = (await res.json()) as PublicRoomSummary;
            return mapPublicSummaryToInviteCheck(summary);
          } catch {
            return null;
          }
        },
      });
      if (socialRes) return socialRes;
    }

    // 1d) Universal Shop Catalog, Inventory, Equip, Gift Lookup & Public Profile
    if (
      url.pathname.startsWith('/api/shop/') ||
      url.pathname === '/api/inventory' ||
      url.pathname.startsWith('/api/inventory/') ||
      url.pathname === '/api/users/lookup' ||
      /^\/api\/users\/[^/]+\/public-profile$/.test(url.pathname)
    ) {
      const itemsRes = await handleItemsHttpRequest(request, url.pathname, {
        db: env.EYVAN_DB,
        corsHeaders: cors,
        originAllowed: isOriginAllowed(request, env),
        shopTestMode: env.SHOP_TEST_MODE,
      });
      if (itemsRes) return itemsRes;
    }

    // 1e) Toman Coin/Gem Top-Up Payments (`/api/payments/*`)
    if (url.pathname.startsWith('/api/payments/')) {
      const publicAppBaseUrl = resolvePublicAppBaseUrl(
        [env.PUBLIC_APP_URL, env.APP_URL, env.ALLOWED_ORIGINS],
        request.url,
        { isProduction: isWorkerProduction(request, env) }
      );
      const payRes = await handlePaymentsHttpRequest(request, url.pathname, {
        db: env.EYVAN_DB,
        corsHeaders: cors,
        originAllowed: isOriginAllowed(request, env),
        zarinpalMerchantId: env.ZARINPAL_MERCHANT_ID,
        publicAppBaseUrl: publicAppBaseUrl ?? undefined,
        shopTestMode: env.SHOP_TEST_MODE,
      });
      if (payRes) return payRes;
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

    // 3b) Cookie-Authenticated Private Chat WebSocket upgrade -> verify auth + membership + friendship + non-blocked, then forward to ChatConversationDO
    const chatWsMatch = url.pathname.match(
      /^\/ws\/social\/chat\/(cnv_[a-zA-Z0-9_-]{8,64})$/
    );
    if (chatWsMatch) {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }
      if (!env.CHAT_CONVERSATION) {
        return buildJsonResponse(
          JSON.stringify({
            ok: false,
            code: 'REALTIME_UNAVAILABLE',
            message: 'سرویس لحظه‌ای چت در این محیط فعال نیست.',
          }),
          503,
          cors
        );
      }

      const conversationId = chatWsMatch[1];
      const rawAuthToken = parseAuthCookieFromHeader(request.headers.get('Cookie'));
      if (!rawAuthToken) {
        return buildJsonResponse(
          JSON.stringify({
            ok: false,
            code: 'UNAUTHORIZED',
            message: 'برای اتصال لحظه‌ای چت ابتدا وارد حساب کاربری شوید.',
          }),
          401,
          cors
        );
      }

      let verified: Awaited<ReturnType<typeof verifyAuthSession>>;
      try {
        verified = await verifyAuthSession(env.EYVAN_DB, rawAuthToken);
      } catch {
        return buildJsonResponse(
          JSON.stringify({
            ok: false,
            code: 'DATABASE_ERROR',
            message: 'خطا در بررسی نشست کاربری.',
          }),
          503,
          cors
        );
      }

      if (!verified.authenticated || !verified.user || !verified.session) {
        return buildJsonResponse(
          JSON.stringify({
            ok: false,
            code: 'UNAUTHORIZED',
            message: 'نشست کاربری معتبر نیست یا منقضی شده است.',
          }),
          401,
          cors,
          buildClearAuthCookieHeader(secureCookie, cookieOpts)
        );
      }

      const access = await authorizeConversationRealtimeAccess(
        env.EYVAN_DB,
        conversationId,
        verified.user.userId
      );
      if (access.ok === false) {
        return buildJsonResponse(
          JSON.stringify({
            ok: false,
            code: access.code,
            message: access.message,
          }),
          access.status,
          cors
        );
      }

      // Strip ALL untrusted client X-Eyvan-* headers and inject strictly server-verified identity
      const forwardHeaders = new Headers();
      request.headers.forEach((value, key) => {
        if (!key.toLowerCase().startsWith('x-eyvan-')) {
          forwardHeaders.set(key, value);
        }
      });
      forwardHeaders.set(CHAT_VERIFIED_USER_HEADER, verified.user.userId);
      forwardHeaders.set(CHAT_VERIFIED_SESSION_HEADER, verified.session.sessionId);
      forwardHeaders.set(CHAT_VERIFIED_CONVERSATION_HEADER, conversationId);

      const id = env.CHAT_CONVERSATION.idFromName(conversationId);
      const stub = env.CHAT_CONVERSATION.get(id);
      return stub.fetch(
        new Request('https://chat.internal/connect', {
          method: 'GET',
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

    // 6) Create room or Quick-Match open room (streaming UTF-8 byte bound + room-code collision retries + HttpOnly session cookie)
    if (
      (url.pathname === '/api/rooms' ||
        url.pathname === '/api/rooms/quick-match') &&
      request.method === 'POST'
    ) {
      const isQuickMatch = url.pathname === '/api/rooms/quick-match';
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

      // Resolve verified central user OR independent server-issued guest identity (never trust spoofed userId)
      let verifiedUser: {
        userId: string;
        username: string;
        avatarCode: string;
      } | null = null;
      let guestSetCookie: string | undefined;
      const cookieHeader = request.headers.get('Cookie');
      const rawAuthToken = parseAuthCookieFromHeader(cookieHeader);
      if (rawAuthToken && env.EYVAN_DB) {
        try {
          const verifiedAuth = await verifyAuthSession(env.EYVAN_DB, rawAuthToken);
          if (verifiedAuth.authenticated && verifiedAuth.user) {
            verifiedUser = {
              userId: verifiedAuth.user.userId,
              username: verifiedAuth.user.username,
              avatarCode: verifiedAuth.user.avatarCode,
            };
          }
        } catch {
          // Non-fatal: fall through to independent guest session
        }
      }

      let guestUserId: string | null = null;
      if (!verifiedUser && env.EYVAN_DB) {
        const extractedGuest = tryExtractUserForUpsert(bodyRead.text);
        if (extractedGuest) {
          try {
            const guestResolved = await resolveOrCreateGuestIdentity(
              env.EYVAN_DB,
              parseGuestCookieFromHeader(cookieHeader),
              extractedGuest.username,
              extractedGuest.avatarCode
            );
            if (guestResolved) {
              guestUserId = guestResolved.userId;
              if (guestResolved.issuedNewCookie && guestResolved.rawGuestToken) {
                guestSetCookie = buildSetGuestCookieHeader(
                  guestResolved.rawGuestToken,
                  secureCookie,
                  guestResolved.ttlSec,
                  cookieOpts
                );
              }
            }
          } catch (err) {
            console.error('[Worker] Non-fatal D1 guest session error:', err);
          }
        }
      }

      let verifiedAppearanceHeader: string | null = null;
      if (verifiedUser && env.EYVAN_DB) {
        try {
          const pubApp = await getPublicAppearanceForUser(
            env.EYVAN_DB,
            verifiedUser.userId
          );
          verifiedAppearanceHeader = JSON.stringify(pubApp);
        } catch {
          verifiedAppearanceHeader = null;
        }
      }

      let lastRes: Response | null = null;
      for (let attempt = 0; attempt < MAX_ROOM_CREATE_RETRIES; attempt++) {
        const code = generateShortRoomCode();
        const id = env.HOKM_ROOM.idFromName(code);
        const stub = env.HOKM_ROOM.get(id);
        const forwardHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (verifiedUser) {
          forwardHeaders['X-Eyvan-Verified-User-Id'] = verifiedUser.userId;
          forwardHeaders['X-Eyvan-Verified-Username'] = verifiedUser.username;
          forwardHeaders['X-Eyvan-Verified-Avatar'] = verifiedUser.avatarCode;
          if (verifiedAppearanceHeader) {
            forwardHeaders[INTERNAL_VERIFIED_APPEARANCE_HEADER] =
              verifiedAppearanceHeader;
          }
        } else if (guestUserId) {
          forwardHeaders['X-Eyvan-Verified-User-Id'] = guestUserId;
        }
        const res = await stub.fetch(
          new Request(`https://room.internal/create?code=${code}`, {
            method: 'POST',
            headers: forwardHeaders,
            body: bodyRead.text,
          })
        );
        lastRes = res;
        if (res.status !== 409) {
          const text = await res.text();
          const internalToken = res.headers.get(INTERNAL_SESSION_TOKEN_HEADER);
          const setCookies: string[] = [];
          if (res.ok) {
            if (verifiedUser) {
              try {
                await touchVerifiedUserLastSeenInD1(env.EYVAN_DB, verifiedUser.userId);
              } catch (err) {
                console.error('[Worker] Non-fatal D1 last_seen update error:', err);
              }
            }
            try {
              const created = JSON.parse(text) as CreateRoomResponse;
              if (created.roomCode && created.playerId && internalToken) {
                setCookies.push(
                  buildSetSessionCookieHeader(
                    {
                      roomCode: created.roomCode,
                      playerId: created.playerId,
                      sessionToken: internalToken,
                    },
                    secureCookie,
                    cookieOpts
                  )
                );
              }
            } catch {
              // Ignore
            }
            if (!verifiedUser && guestSetCookie) {
              setCookies.push(guestSetCookie);
            }
          }
          if (isQuickMatch && res.ok) {
            try {
              const parsed = JSON.parse(text) as Record<string, unknown>;
              return buildJsonResponse(
                JSON.stringify({ ...parsed, matchedExisting: false }),
                res.status,
                cors,
                setCookies
              );
            } catch {
              // Fall through to raw response
            }
          }
          return buildJsonResponse(text, res.status, cors, setCookies);
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

        let verifiedUser: {
          userId: string;
          username: string;
          avatarCode: string;
        } | null = null;
        let guestSetCookie: string | undefined;
        const cookieHeader = request.headers.get('Cookie');
        const rawAuthToken = parseAuthCookieFromHeader(cookieHeader);
        if (rawAuthToken && env.EYVAN_DB) {
          try {
            const verifiedAuth = await verifyAuthSession(env.EYVAN_DB, rawAuthToken);
            if (verifiedAuth.authenticated && verifiedAuth.user) {
              verifiedUser = {
                userId: verifiedAuth.user.userId,
                username: verifiedAuth.user.username,
                avatarCode: verifiedAuth.user.avatarCode,
              };
            }
          } catch {
            // Non-fatal: fall through to independent guest session
          }
        }

        let guestUserId: string | null = null;
        if (!verifiedUser && env.EYVAN_DB) {
          const extractedGuest = tryExtractUserForUpsert(bodyRead.text);
          if (extractedGuest) {
            try {
              const guestResolved = await resolveOrCreateGuestIdentity(
                env.EYVAN_DB,
                parseGuestCookieFromHeader(cookieHeader),
                extractedGuest.username,
                extractedGuest.avatarCode
              );
              if (guestResolved) {
                guestUserId = guestResolved.userId;
                if (guestResolved.issuedNewCookie && guestResolved.rawGuestToken) {
                  guestSetCookie = buildSetGuestCookieHeader(
                    guestResolved.rawGuestToken,
                    secureCookie,
                    guestResolved.ttlSec,
                    cookieOpts
                  );
                }
              }
            } catch (err) {
              console.error('[Worker] Non-fatal D1 guest session error:', err);
            }
          }
        }

        let verifiedAppearanceHeader: string | null = null;
        if (verifiedUser && env.EYVAN_DB) {
          try {
            const pubApp = await getPublicAppearanceForUser(
              env.EYVAN_DB,
              verifiedUser.userId
            );
            verifiedAppearanceHeader = JSON.stringify(pubApp);
          } catch {
            verifiedAppearanceHeader = null;
          }
        }

        const forwardHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (verifiedUser) {
          forwardHeaders['X-Eyvan-Verified-User-Id'] = verifiedUser.userId;
          forwardHeaders['X-Eyvan-Verified-Username'] = verifiedUser.username;
          forwardHeaders['X-Eyvan-Verified-Avatar'] = verifiedUser.avatarCode;
          if (verifiedAppearanceHeader) {
            forwardHeaders[INTERNAL_VERIFIED_APPEARANCE_HEADER] =
              verifiedAppearanceHeader;
          }
        } else if (guestUserId) {
          forwardHeaders['X-Eyvan-Verified-User-Id'] = guestUserId;
        }
        const res = await stub.fetch(
          new Request(`https://room.internal/join?code=${code}`, {
            method: 'POST',
            headers: forwardHeaders,
            body: bodyRead.text,
          })
        );

        const text = await res.text();
        const internalToken = res.headers.get(INTERNAL_SESSION_TOKEN_HEADER);
        const setCookies: string[] = [];
        if (res.ok) {
          if (verifiedUser) {
            try {
              await touchVerifiedUserLastSeenInD1(env.EYVAN_DB, verifiedUser.userId);
            } catch (err) {
              console.error('[Worker] Non-fatal D1 last_seen update error:', err);
            }
          }
          try {
            const joined = JSON.parse(text) as JoinRoomResponse;
            if (joined.roomCode && joined.playerId && internalToken) {
              setCookies.push(
                buildSetSessionCookieHeader(
                  {
                    roomCode: joined.roomCode,
                    playerId: joined.playerId,
                    sessionToken: internalToken,
                  },
                  secureCookie,
                  cookieOpts
                )
              );
            }
          } catch {
            // Ignore
          }
          if (!verifiedUser && guestSetCookie) {
            setCookies.push(guestSetCookie);
          }
        }

        return buildJsonResponse(text, res.status, cors, setCookies);
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

    // 8b) D1 Hokm Leaderboard
    if (url.pathname === '/api/leaderboard/hokm' && request.method === 'GET') {
      const limit = Number(url.searchParams.get('limit')) || 20;
      try {
        const entries = await fetchHokmLeaderboardFromD1(env.EYVAN_DB, limit);
        return Response.json(
          { ok: true, gameId: 'hokm', entries },
          { headers: cors }
        );
      } catch (err) {
        console.error('[Worker] D1 /api/leaderboard/hokm query failed:', err);
        return Response.json(
          {
            ok: false,
            code: 'DATABASE_ERROR',
            message: 'خطا در خواندن جدول برترین‌ها.',
            entries: [],
          },
          { status: 503, headers: cors }
        );
      }
    }

    // 9a) Authenticated Permanent Stats (`GET /api/stats/me` — strictly bound to server-verified user_id)
    if (url.pathname === '/api/stats/me' && request.method === 'GET') {
      const rawAuthToken = parseAuthCookieFromHeader(request.headers.get('Cookie'));
      if (!rawAuthToken) {
        return Response.json(
          { ok: false, code: 'UNAUTHORIZED', message: 'برای مشاهده آمار حساب خود ابتدا وارد شوید.' },
          {
            status: 401,
            headers: { 'Cache-Control': 'no-store, private', ...cors },
          }
        );
      }
      try {
        const verified = await verifyAuthSession(env.EYVAN_DB, rawAuthToken);
        if (!verified.authenticated || !verified.user) {
          return Response.json(
            { ok: false, code: 'UNAUTHORIZED', message: 'نشست کاربری معتبر نیست.' },
            {
              status: 401,
              headers: { 'Cache-Control': 'no-store, private', ...cors },
            }
          );
        }
        const stats = await fetchPlayerStatsByUserIdFromD1(
          env.EYVAN_DB,
          verified.user.userId
        );
        return Response.json(
          {
            ok: true,
            stats: stats ?? {
              userId: verified.user.userId,
              username: verified.user.username,
              matchesPlayed: 0,
              wins: 0,
              losses: 0,
              kotWins: 0,
              hakemKotWins: 0,
              lastPlayedAt: null,
            },
          },
          {
            headers: { 'Cache-Control': 'no-store, private', ...cors },
          }
        );
      } catch (err) {
        console.error('[Worker] D1 /api/stats/me query failed:', err);
        return Response.json(
          { ok: false, code: 'DATABASE_ERROR', message: 'خطا در خواندن آمار حساب کاربری.' },
          { status: 503, headers: cors }
        );
      }
    }

    // 9b) D1 Player Stats (resolved via users.username_key -> user_id -> user_game_stats)
    const statsMatch = url.pathname.match(/^\/api\/stats\/([A-Za-z0-9_.]{3,20})$/);
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

  /**
   * Cloudflare Cron Trigger handler (`[triggers] crons = ["0 *\/6 * * *"]`).
   * Periodically prunes expired, unblocked `auth_rate_limits` rows in bounded batches
   * without adding any cleanup overhead to user-facing HTTP requests.
   */
  async scheduled(
    controller: ScheduledControllerLike,
    env: CfWorkerEnv,
    ctx?: ExecutionContextLike
  ): Promise<void> {
    const task = (async () => {
      const now =
        typeof controller?.scheduledTime === 'number' &&
        Number.isFinite(controller.scheduledTime) &&
        controller.scheduledTime > 0
          ? controller.scheduledTime
          : Date.now();

      try {
        await pruneExpiredRateLimitsBatched(env.EYVAN_DB, { now });
      } catch (err) {
        console.error(
          '[Worker] Scheduled rate-limit cleanup failed:',
          err instanceof Error ? err.message : 'unknown'
        );
      }

      try {
        await pruneExpiredPresenceSessionsBatched(env.EYVAN_DB, { now });
      } catch (err) {
        console.error(
          '[Worker] Scheduled presence cleanup failed:',
          err instanceof Error ? err.message : 'unknown'
        );
      }

      try {
        await pruneExpiredGuestSessionsBatched(env.EYVAN_DB, { now });
      } catch (err) {
        console.error(
          '[Worker] Scheduled guest-session cleanup failed:',
          err instanceof Error ? err.message : 'unknown'
        );
      }

      try {
        await pruneExpiredOAuthStatesBatched(env.EYVAN_DB, { now });
      } catch (err) {
        console.error(
          '[Worker] Scheduled oauth-state cleanup failed:',
          err instanceof Error ? err.message : 'unknown'
        );
      }

      try {
        await pruneExpiredAuthSessionsBatched(env.EYVAN_DB, { now });
      } catch (err) {
        console.error(
          '[Worker] Scheduled auth-session cleanup failed:',
          err instanceof Error ? err.message : 'unknown'
        );
      }

      try {
        await pruneExpiredAuthTokensBatched(env.EYVAN_DB, { now });
      } catch (err) {
        console.error(
          '[Worker] Scheduled auth-token cleanup failed:',
          err instanceof Error ? err.message : 'unknown'
        );
      }

      try {
        await pruneExpiredGameInvitesBatched(env.EYVAN_DB, { now });
      } catch (err) {
        console.error(
          '[Worker] Scheduled game-invite cleanup failed:',
          err instanceof Error ? err.message : 'unknown'
        );
      }
    })();

    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(task);
    }
    await task;
  },
};
