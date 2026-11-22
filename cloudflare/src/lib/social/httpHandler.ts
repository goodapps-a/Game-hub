/**
 * Unified HTTP Handler for Eyvan Stage D1 Social APIs (`/api/social/*`).
 * Shared 1:1 between Cloudflare Workers (`cloudflare/src/index.ts`) and Express (`server/createExpressApp.ts`).
 *
 * Security Guarantees:
 * - EVERY route requires a valid server-verified `eyvan_auth_sess` HttpOnly session cookie.
 * - Actor `userId` and `authSessionId` are ALWAYS extracted strictly from the server session —
 *   client-supplied user IDs are NEVER trusted as actor identity.
 * - All mutating `POST` routes enforce strict Origin + CSRF (`X-Requested-With: eyvan-client`) + JSON Content-Type.
 * - All responses send `Cache-Control: no-store, private`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.
 *
 * Routes (Stage D1 ONLY — zero D2/D3 chat/group/invite routes):
 * - GET  /api/social/users/search?q=...&limit=...&offset=...
 * - GET  /api/social/friends
 * - GET  /api/social/friends/requests
 * - POST /api/social/friends/request
 * - POST /api/social/friends/accept
 * - POST /api/social/friends/reject
 * - POST /api/social/friends/cancel
 * - POST /api/social/friends/remove
 * - POST /api/social/presence/heartbeat
 * - POST /api/social/presence/offline
 * - GET  /api/social/presence/friends
 * - GET  /api/social/privacy
 * - POST /api/social/privacy
 */

import { readBoundedUtf8Body } from '../httpBounds';
import { CookieHeaderOptions } from '../sessionCookie';
import { D1DatabaseLike } from '../types';
import {
  buildClearAuthCookieHeader,
  parseAuthCookieFromHeader,
} from '../auth/authCookie';
import { verifyAuthSession } from '../auth/authService';
import {
  CSRF_CLIENT_HEADER_NAME,
  CSRF_CLIENT_HEADER_VALUE,
} from '../auth/httpHandler';
import {
  acceptFriendRequest,
  blockUser,
  cancelFriendRequest,
  getFriendsPresence,
  getPublicSocialProfile,
  getSocialPrivacySettings,
  heartbeatPresence,
  listBlockedUsers,
  listFriendRequests,
  listFriends,
  markPresenceOffline,
  rejectFriendRequest,
  removeFriend,
  searchSocialUsers,
  sendFriendRequest,
  unblockUser,
  updateSocialPrivacySettings,
} from './socialService';
import {
  listConversationMessages,
  listDirectConversations,
  markConversationRead,
  openOrCreateDirectConversation,
  sendDirectMessage,
} from './chatService';
import {
  cancelGameInvite,
  createGameInvite,
  listGameInvites,
  respondToGameInvite,
} from './inviteService';
import { GameRoomLookupFn, SocialRequestContext } from './types';

const MAX_SOCIAL_BODY_BYTES = 12 * 1024; // 12KB strict cap (supports 2000-char Persian UTF-8 messages)

export interface SocialHttpEnv {
  readonly db: D1DatabaseLike;
  readonly corsHeaders: Record<string, string>;
  readonly secureCookie: boolean;
  readonly cookieOptions?: CookieHeaderOptions;
  readonly originAllowed: boolean;
  readonly clientIp: string;
  readonly now?: number;
  readonly roomLookup?: GameRoomLookupFn;
}

function buildSocialResponse(
  payload: unknown,
  status: number,
  corsHeaders: Record<string, string>,
  extraHeaders?: Record<string, string>
): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private',
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    ...corsHeaders,
  });
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers.set(k, v);
    }
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

function verifyMutatingCsrf(
  request: Request,
  env: SocialHttpEnv
): Response | null {
  if (!env.originAllowed) {
    return buildSocialResponse(
      { ok: false, code: 'FORBIDDEN_ORIGIN', message: 'مبدا درخواست مجاز نیست.' },
      403,
      env.corsHeaders
    );
  }

  const xrw = request.headers.get(CSRF_CLIENT_HEADER_NAME);
  if (xrw !== CSRF_CLIENT_HEADER_VALUE) {
    return buildSocialResponse(
      {
        ok: false,
        code: 'CSRF_REJECTED',
        message: 'درخواست فاقد هدر امنیتی معتبر است.',
      },
      403,
      env.corsHeaders
    );
  }

  const secFetchSite = request.headers.get('Sec-Fetch-Site')?.toLowerCase();
  const hasOrigin = Boolean(request.headers.get('Origin'));
  if (secFetchSite === 'cross-site' && !hasOrigin) {
    return buildSocialResponse(
      {
        ok: false,
        code: 'CSRF_REJECTED',
        message: 'درخواست بین‌سایتی بدون مبدا مجاز رد شد.',
      },
      403,
      env.corsHeaders
    );
  }

  const contentType = (request.headers.get('Content-Type') ?? '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return buildSocialResponse(
      {
        ok: false,
        code: 'INVALID_INPUT',
        message: 'نوع محتوای درخواست باید application/json باشد.',
      },
      415,
      env.corsHeaders
    );
  }

  return null;
}

async function parseJsonObjectBody(
  request: Request,
  corsHeaders: Record<string, string>
): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  const bodyRead = await readBoundedUtf8Body(request, MAX_SOCIAL_BODY_BYTES);
  if (bodyRead.ok === false) {
    return {
      ok: false,
      response: buildSocialResponse(
        {
          ok: false,
          code: 'INVALID_INPUT',
          message:
            bodyRead.status === 413
              ? 'حجم درخواست بیش از حد مجاز است.'
              : 'خطا در خواندن بدنه درخواست.',
        },
        bodyRead.status,
        corsHeaders
      ),
    };
  }

  try {
    const parsed: unknown = JSON.parse(bodyRead.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        response: buildSocialResponse(
          {
            ok: false,
            code: 'INVALID_INPUT',
            message: 'ساختار بدنه درخواست نامعتبر است.',
          },
          400,
          corsHeaders
        ),
      };
    }
    return { ok: true, data: parsed as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      response: buildSocialResponse(
        {
          ok: false,
          code: 'INVALID_INPUT',
          message: 'فرمت JSON درخواست نامعتبر است.',
        },
        400,
        corsHeaders
      ),
    };
  }
}

async function requireAuthenticatedSocialContext(
  request: Request,
  env: SocialHttpEnv,
  now: number
): Promise<
  | { ok: true; ctx: SocialRequestContext }
  | { ok: false; response: Response }
> {
  const rawToken = parseAuthCookieFromHeader(request.headers.get('Cookie'));
  if (!rawToken) {
    return {
      ok: false,
      response: buildSocialResponse(
        {
          ok: false,
          code: 'UNAUTHORIZED',
          message: 'برای استفاده از بخش دوستان باید وارد حساب کاربری شوید.',
        },
        401,
        env.corsHeaders
      ),
    };
  }

  const verified = await verifyAuthSession(env.db, rawToken, now);
  if (!verified.authenticated || !verified.user || !verified.session) {
    const extra = verified.shouldClearCookie
      ? {
          'Set-Cookie': buildClearAuthCookieHeader(
            env.secureCookie,
            env.cookieOptions
          ),
        }
      : undefined;
    return {
      ok: false,
      response: buildSocialResponse(
        {
          ok: false,
          code: 'UNAUTHORIZED',
          message: 'نشست کاربری شما معتبر نیست یا منقضی شده است.',
        },
        401,
        env.corsHeaders,
        extra
      ),
    };
  }

  return {
    ok: true,
    ctx: {
      actorUserId: verified.user.userId,
      authSessionId: verified.session.sessionId,
      clientIp: env.clientIp,
      now,
    },
  };
}

export async function handleSocialHttpRequest(
  request: Request,
  pathname: string,
  env: SocialHttpEnv
): Promise<Response | null> {
  const method = request.method.toUpperCase();
  const now = env.now ?? Date.now();

  if (!pathname.startsWith('/api/social/')) {
    return null;
  }

  // Enforce CSRF on all mutating social endpoints BEFORE touching DB
  if (method !== 'GET') {
    const csrfErr = verifyMutatingCsrf(request, env);
    if (csrfErr) return csrfErr;
  }

  try {
    const authRes = await requireAuthenticatedSocialContext(request, env, now);
    if (authRes.ok === false) return authRes.response;
    const { ctx } = authRes;

    // 1) GET /api/social/users/search
    if (pathname === '/api/social/users/search' && method === 'GET') {
      const reqUrl = new URL(request.url);
      const q = reqUrl.searchParams.get('q') ?? '';
      const limit = reqUrl.searchParams.get('limit') ?? undefined;
      const offset = reqUrl.searchParams.get('offset') ?? undefined;
      const result = await searchSocialUsers(env.db, q, limit, offset, ctx);
      if (result.ok === false) {
        const extra =
          result.retryAfterSec !== undefined
            ? { 'Retry-After': String(result.retryAfterSec) }
            : undefined;
        return buildSocialResponse(
          { ok: false, code: result.code, message: result.message },
          result.status,
          env.corsHeaders,
          extra
        );
      }
      return buildSocialResponse(
        {
          ok: true,
          users: result.users,
          limit: result.limit,
          offset: result.offset,
          hasMore: result.hasMore,
        },
        200,
        env.corsHeaders
      );
    }

    // 2) GET /api/social/friends
    if (pathname === '/api/social/friends' && method === 'GET') {
      const friends = await listFriends(env.db, ctx);
      return buildSocialResponse({ ok: true, friends }, 200, env.corsHeaders);
    }

    // 3) GET /api/social/friends/requests
    if (pathname === '/api/social/friends/requests' && method === 'GET') {
      const { incoming, outgoing } = await listFriendRequests(env.db, ctx);
      return buildSocialResponse(
        { ok: true, incoming, outgoing },
        200,
        env.corsHeaders
      );
    }

    // 4) POST /api/social/friends/request
    if (pathname === '/api/social/friends/request' && method === 'POST') {
      const body = await parseJsonObjectBody(request, env.corsHeaders);
      if (body.ok === false) return body.response;
      const result = await sendFriendRequest(env.db, body.data.targetUserId, ctx);
      if (result.ok === false) {
        const extra =
          result.retryAfterSec !== undefined
            ? { 'Retry-After': String(result.retryAfterSec) }
            : undefined;
        return buildSocialResponse(
          { ok: false, code: result.code, message: result.message },
          result.status,
          env.corsHeaders,
          extra
        );
      }
      return buildSocialResponse(
        {
          ok: true,
          outcome: result.outcome,
          friendshipId: result.friendshipId,
          relationshipStatus: result.relationshipStatus,
          message: result.message,
        },
        result.status,
        env.corsHeaders
      );
    }

    // 5) POST /api/social/friends/accept
    if (pathname === '/api/social/friends/accept' && method === 'POST') {
      const body = await parseJsonObjectBody(request, env.corsHeaders);
      if (body.ok === false) return body.response;
      const result = await acceptFriendRequest(
        env.db,
        body.data.friendshipId,
        ctx
      );
      if (result.ok === false) {
        const extra =
          result.retryAfterSec !== undefined
            ? { 'Retry-After': String(result.retryAfterSec) }
            : undefined;
        return buildSocialResponse(
          { ok: false, code: result.code, message: result.message },
          result.status,
          env.corsHeaders,
          extra
        );
      }
      return buildSocialResponse(
        {
          ok: true,
          friendshipId: result.friendshipId,
          message: result.message,
        },
        200,
        env.corsHeaders
      );
    }

    // 6) POST /api/social/friends/reject
    if (pathname === '/api/social/friends/reject' && method === 'POST') {
      const body = await parseJsonObjectBody(request, env.corsHeaders);
      if (body.ok === false) return body.response;
      const result = await rejectFriendRequest(
        env.db,
        body.data.friendshipId,
        ctx
      );
      if (result.ok === false) {
        const extra =
          result.retryAfterSec !== undefined
            ? { 'Retry-After': String(result.retryAfterSec) }
            : undefined;
        return buildSocialResponse(
          { ok: false, code: result.code, message: result.message },
          result.status,
          env.corsHeaders,
          extra
        );
      }
      return buildSocialResponse(
        {
          ok: true,
          friendshipId: result.friendshipId,
          message: result.message,
        },
        200,
        env.corsHeaders
      );
    }

    // 7) POST /api/social/friends/cancel
    if (pathname === '/api/social/friends/cancel' && method === 'POST') {
      const body = await parseJsonObjectBody(request, env.corsHeaders);
      if (body.ok === false) return body.response;
      const result = await cancelFriendRequest(
        env.db,
        body.data.friendshipId,
        ctx
      );
      if (result.ok === false) {
        const extra =
          result.retryAfterSec !== undefined
            ? { 'Retry-After': String(result.retryAfterSec) }
            : undefined;
        return buildSocialResponse(
          { ok: false, code: result.code, message: result.message },
          result.status,
          env.corsHeaders,
          extra
        );
      }
      return buildSocialResponse(
        {
          ok: true,
          friendshipId: result.friendshipId,
          message: result.message,
        },
        200,
        env.corsHeaders
      );
    }

    // 8) POST /api/social/friends/remove
    if (pathname === '/api/social/friends/remove' && method === 'POST') {
      const body = await parseJsonObjectBody(request, env.corsHeaders);
      if (body.ok === false) return body.response;
      const result = await removeFriend(env.db, body.data, ctx);
      if (result.ok === false) {
        const extra =
          result.retryAfterSec !== undefined
            ? { 'Retry-After': String(result.retryAfterSec) }
            : undefined;
        return buildSocialResponse(
          { ok: false, code: result.code, message: result.message },
          result.status,
          env.corsHeaders,
          extra
        );
      }
      return buildSocialResponse(
        {
          ok: true,
          friendshipId: result.friendshipId,
          message: result.message,
        },
        200,
        env.corsHeaders
      );
    }

    // 9) POST /api/social/presence/heartbeat
    if (pathname === '/api/social/presence/heartbeat' && method === 'POST') {
      const body = await parseJsonObjectBody(request, env.corsHeaders);
      if (body.ok === false) return body.response;
      const result = await heartbeatPresence(
        env.db,
        body.data.deviceId,
        body.data.state,
        ctx
      );
      if (result.ok === false) {
        const extra =
          result.retryAfterSec !== undefined
            ? { 'Retry-After': String(result.retryAfterSec) }
            : undefined;
        return buildSocialResponse(
          { ok: false, code: result.code, message: result.message },
          result.status,
          env.corsHeaders,
          extra
        );
      }
      return buildSocialResponse(
        {
          ok: true,
          onlineStatus: result.onlineStatus,
          deviceState: result.deviceState,
          expiresAt: result.expiresAt,
          ttlMs: result.ttlMs,
        },
        200,
        env.corsHeaders
      );
    }

    // 10) POST /api/social/presence/offline
    if (pathname === '/api/social/presence/offline' && method === 'POST') {
      const body = await parseJsonObjectBody(request, env.corsHeaders);
      if (body.ok === false) return body.response;
      const result = await markPresenceOffline(env.db, body.data.deviceId, ctx);
      if (result.ok === false) {
        return buildSocialResponse(
          { ok: false, code: result.code, message: result.message },
          result.status,
          env.corsHeaders
        );
      }
      return buildSocialResponse({ ok: true }, 200, env.corsHeaders);
    }

    // 11) GET /api/social/presence/friends
    if (pathname === '/api/social/presence/friends' && method === 'GET') {
      const presence = await getFriendsPresence(env.db, ctx);
      return buildSocialResponse(
        { ok: true, presence, serverTime: now },
        200,
        env.corsHeaders
      );
    }

    // 12) GET /api/social/privacy
    if (pathname === '/api/social/privacy' && method === 'GET') {
      const privacy = await getSocialPrivacySettings(env.db, ctx.actorUserId);
      if (!privacy) {
        return buildSocialResponse(
          { ok: false, code: 'NOT_FOUND', message: 'حساب کاربری یافت نشد.' },
          404,
          env.corsHeaders
        );
      }
      return buildSocialResponse({ ok: true, privacy }, 200, env.corsHeaders);
    }

    // 13) POST /api/social/privacy
    if (pathname === '/api/social/privacy' && method === 'POST') {
      const body = await parseJsonObjectBody(request, env.corsHeaders);
      if (body.ok === false) return body.response;
      const result = await updateSocialPrivacySettings(env.db, body.data, ctx);
      if (result.ok === false) {
        const extra =
          result.retryAfterSec !== undefined
            ? { 'Retry-After': String(result.retryAfterSec) }
            : undefined;
        return buildSocialResponse(
          { ok: false, code: result.code, message: result.message },
          result.status,
          env.corsHeaders,
          extra
        );
      }
      return buildSocialResponse(
        { ok: true, privacy: result.privacy, message: result.message },
        200,
        env.corsHeaders
      );
    }

    // 14) GET /api/social/blocks — List users blocked by actor
    if (pathname === '/api/social/blocks' && method === 'GET') {
      const blocked = await listBlockedUsers(env.db, ctx);
      return buildSocialResponse({ ok: true, blocked }, 200, env.corsHeaders);
    }

    // 15) POST /api/social/blocks — Block a user (severs friendship & pending invites)
    if (pathname === '/api/social/blocks' && method === 'POST') {
      const body = await parseJsonObjectBody(request, env.corsHeaders);
      if (body.ok === false) return body.response;
      const result = await blockUser(
        env.db,
        body.data.targetUserId,
        body.data.reason,
        ctx
      );
      if (result.ok === false) {
        const extra =
          result.retryAfterSec !== undefined
            ? { 'Retry-After': String(result.retryAfterSec) }
            : undefined;
        return buildSocialResponse(
          { ok: false, code: result.code, message: result.message },
          result.status,
          env.corsHeaders,
          extra
        );
      }
      return buildSocialResponse(
        {
          ok: true,
          targetUserId: result.targetUserId,
          blocked: result.blocked,
          message: result.message,
        },
        result.status,
        env.corsHeaders
      );
    }

    // 16) POST /api/social/blocks/remove — Unblock a user strictly owned by actor
    if (pathname === '/api/social/blocks/remove' && method === 'POST') {
      const body = await parseJsonObjectBody(request, env.corsHeaders);
      if (body.ok === false) return body.response;
      const result = await unblockUser(env.db, body.data.targetUserId, ctx);
      if (result.ok === false) {
        const extra =
          result.retryAfterSec !== undefined
            ? { 'Retry-After': String(result.retryAfterSec) }
            : undefined;
        return buildSocialResponse(
          { ok: false, code: result.code, message: result.message },
          result.status,
          env.corsHeaders,
          extra
        );
      }
      return buildSocialResponse(
        {
          ok: true,
          targetUserId: result.targetUserId,
          blocked: result.blocked,
          message: result.message,
        },
        result.status,
        env.corsHeaders
      );
    }

    // 17) GET /api/social/users/:userId — Safe public profile lookup (zero PII)
    const publicUserMatch = pathname.match(
      /^\/api\/social\/users\/(usr_[a-zA-Z0-9_-]{8,64})$/
    );
    if (publicUserMatch && method === 'GET') {
      const result = await getPublicSocialProfile(
        env.db,
        publicUserMatch[1],
        ctx
      );
      if (result.ok === false) {
        return buildSocialResponse(
          { ok: false, code: result.code, message: result.message },
          result.status,
          env.corsHeaders
        );
      }
      return buildSocialResponse(
        { ok: true, profile: result.profile },
        200,
        env.corsHeaders
      );
    }

    // 18) GET /api/social/chat/conversations — List direct conversations with unread counts
    if (pathname === '/api/social/chat/conversations' && method === 'GET') {
      const conversations = await listDirectConversations(env.db, ctx);
      return buildSocialResponse(
        { ok: true, conversations, serverTime: now },
        200,
        env.corsHeaders
      );
    }

    // 19) POST /api/social/chat/conversations/direct — Open or create 1-on-1 friend conversation
    if (
      pathname === '/api/social/chat/conversations/direct' &&
      method === 'POST'
    ) {
      const body = await parseJsonObjectBody(request, env.corsHeaders);
      if (body.ok === false) return body.response;
      const result = await openOrCreateDirectConversation(
        env.db,
        body.data.targetUserId,
        ctx
      );
      if (result.ok === false) {
        return buildSocialResponse(
          { ok: false, code: result.code, message: result.message },
          result.status,
          env.corsHeaders
        );
      }
      return buildSocialResponse(
        { ok: true, conversation: result.conversation },
        result.status,
        env.corsHeaders
      );
    }

    // 20) GET/POST /api/social/chat/conversations/:id/messages
    const chatMessagesMatch = pathname.match(
      /^\/api\/social\/chat\/conversations\/(cnv_[a-zA-Z0-9_-]{8,64})\/messages$/
    );
    if (chatMessagesMatch) {
      const conversationId = chatMessagesMatch[1];
      if (method === 'GET') {
        const reqUrl = new URL(request.url);
        const result = await listConversationMessages(
          env.db,
          conversationId,
          reqUrl.searchParams.get('before'),
          reqUrl.searchParams.get('limit'),
          ctx
        );
        if (result.ok === false) {
          return buildSocialResponse(
            { ok: false, code: result.code, message: result.message },
            result.status,
            env.corsHeaders
          );
        }
        return buildSocialResponse(
          {
            ok: true,
            conversationId: result.conversationId,
            messages: result.messages,
            hasMore: result.hasMore,
            nextBefore: result.nextBefore,
            partnerLastReadAt: result.partnerLastReadAt,
          },
          200,
          env.corsHeaders
        );
      }

      if (method === 'POST') {
        const body = await parseJsonObjectBody(request, env.corsHeaders);
        if (body.ok === false) return body.response;
        const result = await sendDirectMessage(
          env.db,
          conversationId,
          body.data,
          ctx
        );
        if (result.ok === false) {
          const extra =
            result.retryAfterSec !== undefined
              ? { 'Retry-After': String(result.retryAfterSec) }
              : undefined;
          return buildSocialResponse(
            { ok: false, code: result.code, message: result.message },
            result.status,
            env.corsHeaders,
            extra
          );
        }
        return buildSocialResponse(
          {
            ok: true,
            message: result.message,
            deduplicated: result.deduplicated,
          },
          result.status,
          env.corsHeaders
        );
      }
    }

    // 21) POST /api/social/chat/conversations/:id/read — Mark conversation read
    const chatReadMatch = pathname.match(
      /^\/api\/social\/chat\/conversations\/(cnv_[a-zA-Z0-9_-]{8,64})\/read$/
    );
    if (chatReadMatch && method === 'POST') {
      const body = await parseJsonObjectBody(request, env.corsHeaders);
      if (body.ok === false) return body.response;
      const result = await markConversationRead(
        env.db,
        chatReadMatch[1],
        body.data,
        ctx
      );
      if (result.ok === false) {
        return buildSocialResponse(
          { ok: false, code: result.code, message: result.message },
          result.status,
          env.corsHeaders
        );
      }
      return buildSocialResponse(
        {
          ok: true,
          conversationId: result.conversationId,
          lastReadAt: result.lastReadAt,
        },
        200,
        env.corsHeaders
      );
    }

    // 22) GET /api/social/invites — List active incoming & outgoing real-room invites
    if (pathname === '/api/social/invites' && method === 'GET') {
      const invites = await listGameInvites(env.db, ctx);
      return buildSocialResponse(
        {
          ok: true,
          incoming: invites.incoming,
          outgoing: invites.outgoing,
          serverTime: now,
        },
        200,
        env.corsHeaders
      );
    }

    // 23) POST /api/social/invites — Send real-room game invite to an accepted friend
    if (pathname === '/api/social/invites' && method === 'POST') {
      const body = await parseJsonObjectBody(request, env.corsHeaders);
      if (body.ok === false) return body.response;
      const lookup: GameRoomLookupFn =
        env.roomLookup ?? (async () => null);
      const result = await createGameInvite(env.db, body.data, lookup, ctx);
      if (result.ok === false) {
        const extra =
          result.retryAfterSec !== undefined
            ? { 'Retry-After': String(result.retryAfterSec) }
            : undefined;
        return buildSocialResponse(
          { ok: false, code: result.code, message: result.message },
          result.status,
          env.corsHeaders,
          extra
        );
      }
      return buildSocialResponse(
        {
          ok: true,
          invite: result.invite,
          deduplicated: result.deduplicated,
          message: result.message,
        },
        result.status,
        env.corsHeaders
      );
    }

    // 24) POST /api/social/invites/accept | /decline — Respond to incoming invite
    if (
      (pathname === '/api/social/invites/accept' ||
        pathname === '/api/social/invites/decline') &&
      method === 'POST'
    ) {
      const body = await parseJsonObjectBody(request, env.corsHeaders);
      if (body.ok === false) return body.response;
      const decision =
        pathname === '/api/social/invites/accept' ? 'accept' : 'decline';
      const lookup: GameRoomLookupFn =
        env.roomLookup ?? (async () => null);
      const result = await respondToGameInvite(
        env.db,
        body.data.inviteId,
        decision,
        lookup,
        ctx
      );
      if (result.ok === false) {
        return buildSocialResponse(
          { ok: false, code: result.code, message: result.message },
          result.status,
          env.corsHeaders
        );
      }
      return buildSocialResponse(
        {
          ok: true,
          inviteId: result.inviteId,
          decision: result.decision,
          roomCode: result.roomCode,
          gameId: result.gameId,
          message: result.message,
        },
        200,
        env.corsHeaders
      );
    }

    // 25) POST /api/social/invites/cancel — Cancel an outgoing pending invite
    if (pathname === '/api/social/invites/cancel' && method === 'POST') {
      const body = await parseJsonObjectBody(request, env.corsHeaders);
      if (body.ok === false) return body.response;
      const result = await cancelGameInvite(env.db, body.data.inviteId, ctx);
      if (result.ok === false) {
        return buildSocialResponse(
          { ok: false, code: result.code, message: result.message },
          result.status,
          env.corsHeaders
        );
      }
      return buildSocialResponse(
        {
          ok: true,
          inviteId: result.inviteId,
          message: result.message,
        },
        200,
        env.corsHeaders
      );
    }

    return buildSocialResponse(
      { ok: false, code: 'NOT_FOUND', message: 'مسیر اجتماعی یافت نشد.' },
      404,
      env.corsHeaders
    );
  } catch (err) {
    console.error(
      '[Social] HTTP handler error:',
      err instanceof Error ? err.message : 'unknown'
    );
    return buildSocialResponse(
      {
        ok: false,
        code: 'DATABASE_ERROR',
        message: 'خطای داخلی در پردازش درخواست اجتماعی رخ داد.',
      },
      500,
      env.corsHeaders
    );
  }
}
