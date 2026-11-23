/**
 * Cloudflare Durable Object: Hibernation-Enabled Real-Time Private Chat Room (`ChatConversationDO`)
 *
 * Architecture & Resource Efficiency Guarantees (Cloudflare Free Tier Friendly):
 * 1. Dedicated per-conversation instance (`CHAT_CONVERSATION.idFromName(conversationId)`),
 *    completely independent from `HokmRoomDO` and game rooms.
 * 2. Official Cloudflare WebSocket Hibernation API ONLY:
 *    - `ctx.acceptWebSocket(server, tags)` (NEVER `ws.accept()`)
 *    - `ws.serializeAttachment(...)` / `ws.deserializeAttachment()` as the sole source of
 *      socket identity across hibernation wake-ups (ZERO in-memory Maps for socket state!)
 *    - `ctx.getWebSockets(tag?)` for fan-out and targeted session/user eviction
 *    - `webSocketMessage`, `webSocketClose`, `webSocketError` hibernation handlers
 * 3. ZERO background timers (`setInterval` / `setTimeout`) inside the Durable Object so
 *    idle conversations hibernate cleanly at zero active compute cost.
 * 4. D1 Remains Single Source of Truth:
 *    - This DO does NOT persist messages or perform D1 queries on fan-out.
 *    - The Worker calls internal `/broadcast/message` and `/broadcast/read` ONLY AFTER
 *      D1 commits succeed, passing the committed payload directly for zero-read fan-out.
 * 5. Multi-Tab Support & Bounded Fan-out:
 *    - A user may hold multiple open tabs for the same conversation (bounded to
 *      MAX_SOCKETS_PER_USER_PER_CONV = 8 to prevent socket-exhaustion DoS).
 *    - Revocation endpoints (`/disconnect/session`, `/disconnect/user`,
 *      `/disconnect/conversation`) immediately terminate sockets on logout, block, or unfriend.
 */

import {
  CHAT_WS_CLOSE_FORBIDDEN,
  CHAT_WS_CLOSE_SUPERSEDED,
  CHAT_WS_CLOSE_UNAUTHORIZED,
  ChatWireMessage,
  ChatWsServerEvent,
  MAX_CHAT_WS_CLIENT_PAYLOAD_BYTES,
} from '../../src/platform/social/chatRealtimeProtocol';
import { getPayloadUtf8Bytes, readBoundedUtf8Body } from './lib/httpBounds';
import {
  CfWorkerEnv,
  DurableObjectStateLike,
  HibernatableWebSocket,
} from './lib/types';

export const CHAT_INTERNAL_ACTION_HEADER = 'X-Eyvan-Chat-Internal-Action';
export const CHAT_VERIFIED_USER_HEADER = 'X-Eyvan-Verified-User-Id';
export const CHAT_VERIFIED_SESSION_HEADER = 'X-Eyvan-Verified-Session-Id';
export const CHAT_VERIFIED_CONVERSATION_HEADER = 'X-Eyvan-Conversation-Id';

const MAX_INTERNAL_BODY_BYTES = 16 * 1024;
const MAX_SOCKETS_PER_USER_PER_CONV = 8;
const WS_PING_RATE_WINDOW_MS = 10_000;
const WS_PING_RATE_MAX = 20;

export interface ChatSocketAttachment {
  readonly userId: string;
  readonly authSessionId: string;
  readonly conversationId: string;
  readonly connectedAt: number;
}

interface TransientRateWindow {
  windowStart: number;
  count: number;
}

export interface ChatConversationDOHooks {
  now?: () => number;
}

function readChatAttachment(ws: HibernatableWebSocket): ChatSocketAttachment | null {
  try {
    const raw = ws.deserializeAttachment() as Partial<ChatSocketAttachment> | null;
    if (
      !raw ||
      typeof raw !== 'object' ||
      typeof raw.userId !== 'string' ||
      typeof raw.authSessionId !== 'string' ||
      typeof raw.conversationId !== 'string' ||
      typeof raw.connectedAt !== 'number'
    ) {
      return null;
    }
    return {
      userId: raw.userId,
      authSessionId: raw.authSessionId,
      conversationId: raw.conversationId,
      connectedAt: raw.connectedAt,
    };
  } catch {
    return null;
  }
}

export class ChatConversationDO {
  private readonly ctx: DurableObjectStateLike;
  private readonly nowFn: () => number;
  /** Transient per-socket rate window (safely rebuilt lazily after hibernation) */
  private readonly rateLimits = new WeakMap<HibernatableWebSocket, TransientRateWindow>();

  constructor(
    ctx: DurableObjectStateLike,
    _env: CfWorkerEnv,
    hooks?: ChatConversationDOHooks
  ) {
    this.ctx = ctx;
    this.nowFn = hooks?.now ?? (() => Date.now());
  }

  public async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 1) WebSocket Upgrade (strictly pre-authenticated & pre-authorized by Worker)
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const userId = request.headers.get(CHAT_VERIFIED_USER_HEADER)?.trim() ?? '';
      const authSessionId =
        request.headers.get(CHAT_VERIFIED_SESSION_HEADER)?.trim() ?? '';
      const conversationId =
        request.headers.get(CHAT_VERIFIED_CONVERSATION_HEADER)?.trim() ?? '';

      if (!userId || !authSessionId || !conversationId) {
        return Response.json(
          { ok: false, code: 'UNAUTHORIZED', message: 'نشست چت معتبر نیست.' },
          { status: 401 }
        );
      }

      const PairCtor = (
        globalThis as unknown as {
          WebSocketPair: new () => {
            0: HibernatableWebSocket;
            1: HibernatableWebSocket;
          };
        }
      ).WebSocketPair;

      const pair = new PairCtor();
      const client = pair[0];
      const server = pair[1];
      const now = this.nowFn();

      // Cap per-user sockets in this conversation to prevent connection flooding while supporting multi-tab
      const userTag = `user:${userId}`;
      const existingUserSockets = this.ctx.getWebSockets(userTag);
      if (existingUserSockets.length >= MAX_SOCKETS_PER_USER_PER_CONV) {
        const sortedOldest = [...existingUserSockets].sort((a, b) => {
          const attA = readChatAttachment(a);
          const attB = readChatAttachment(b);
          return (attA?.connectedAt ?? 0) - (attB?.connectedAt ?? 0);
        });
        const excess = existingUserSockets.length - MAX_SOCKETS_PER_USER_PER_CONV + 1;
        for (let i = 0; i < excess; i++) {
          this.safeClose(sortedOldest[i], CHAT_WS_CLOSE_SUPERSEDED, 'too_many_tabs');
        }
      }

      this.ctx.acceptWebSocket(server, [
        userTag,
        `sess:${authSessionId}`,
        `conv:${conversationId}`,
      ]);
      server.serializeAttachment({
        userId,
        authSessionId,
        conversationId,
        connectedAt: now,
      } satisfies ChatSocketAttachment);

      this.sendEvent(server, {
        type: 'connected',
        conversationId,
        serverTime: now,
      });

      return new Response(null, {
        status: 101,
        webSocket: client,
      } as ResponseInit & { webSocket: HibernatableWebSocket });
    }

    // 2) Internal Worker-only POST actions (never exposed directly on public Worker routes)
    if (request.method !== 'POST') {
      return Response.json(
        { ok: false, code: 'NOT_FOUND', message: 'مسیر یافت نشد.' },
        { status: 404 }
      );
    }

    const internalAction = request.headers.get(CHAT_INTERNAL_ACTION_HEADER)?.trim();
    if (!internalAction) {
      return Response.json(
        { ok: false, code: 'FORBIDDEN', message: 'درخواست داخلی نامعتبر است.' },
        { status: 403 }
      );
    }

    const bodyRead = await readBoundedUtf8Body(request, MAX_INTERNAL_BODY_BYTES);
    if (bodyRead.ok === false) {
      return Response.json(
        { ok: false, code: 'INVALID_INPUT', message: 'بدنه درخواست نامعتبر است.' },
        { status: bodyRead.status }
      );
    }

    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(bodyRead.text) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return Response.json(
          { ok: false, code: 'INVALID_INPUT', message: 'فرمت JSON نامعتبر است.' },
          { status: 400 }
        );
      }
      payload = parsed as Record<string, unknown>;
    } catch {
      return Response.json(
        { ok: false, code: 'INVALID_INPUT', message: 'فرمت JSON نامعتبر است.' },
        { status: 400 }
      );
    }

    // 2a) Broadcast newly committed D1 message
    if (url.pathname === '/broadcast/message' && internalAction === 'broadcast_message') {
      const conversationId =
        typeof payload.conversationId === 'string' ? payload.conversationId : '';
      const message = payload.message as ChatWireMessage | undefined;
      if (
        !conversationId ||
        !message ||
        typeof message.messageId !== 'string' ||
        message.conversationId !== conversationId
      ) {
        return Response.json(
          { ok: false, code: 'INVALID_INPUT', message: 'پیام نامعتبر است.' },
          { status: 400 }
        );
      }

      const delivered = this.broadcastToConversation(conversationId, {
        type: 'message:new',
        conversationId,
        message,
      });
      return Response.json({ ok: true, delivered });
    }

    // 2b) Broadcast committed D1 read cursor update
    if (url.pathname === '/broadcast/read' && internalAction === 'broadcast_read') {
      const conversationId =
        typeof payload.conversationId === 'string' ? payload.conversationId : '';
      const readerUserId =
        typeof payload.readerUserId === 'string' ? payload.readerUserId : '';
      const lastReadAt =
        typeof payload.lastReadAt === 'number' ? payload.lastReadAt : 0;
      const lastReadMessageId =
        typeof payload.lastReadMessageId === 'string'
          ? payload.lastReadMessageId
          : null;

      if (!conversationId || !readerUserId || lastReadAt <= 0) {
        return Response.json(
          { ok: false, code: 'INVALID_INPUT', message: 'اطلاعات خوانده‌شدن نامعتبر است.' },
          { status: 400 }
        );
      }

      const delivered = this.broadcastToConversation(conversationId, {
        type: 'read:updated',
        conversationId,
        readerUserId,
        lastReadMessageId,
        lastReadAt,
      });
      return Response.json({ ok: true, delivered });
    }

    // 2c) Disconnect all sockets in conversation (e.g. block or unfriend)
    if (
      url.pathname === '/disconnect/conversation' &&
      internalAction === 'disconnect_conversation'
    ) {
      const conversationId =
        typeof payload.conversationId === 'string' ? payload.conversationId : '';
      const rawReason = payload.reason;
      const reason =
        rawReason === 'blocked' || rawReason === 'unfriended'
          ? rawReason
          : 'forbidden';

      const sockets = conversationId
        ? this.ctx.getWebSockets(`conv:${conversationId}`)
        : this.ctx.getWebSockets();
      let closed = 0;
      for (const ws of sockets) {
        const att = readChatAttachment(ws);
        if (conversationId && att && att.conversationId !== conversationId) continue;
        this.sendEvent(ws, {
          type: 'conversation:revoked',
          conversationId: conversationId || att?.conversationId || '',
          reason,
        });
        this.safeClose(ws, CHAT_WS_CLOSE_FORBIDDEN, reason);
        closed += 1;
      }
      return Response.json({ ok: true, closed });
    }

    // 2d) Disconnect sockets bound to a revoked auth session (logout / session revoke)
    if (
      url.pathname === '/disconnect/session' &&
      internalAction === 'disconnect_session'
    ) {
      const authSessionId =
        typeof payload.authSessionId === 'string' ? payload.authSessionId : '';
      if (!authSessionId) {
        return Response.json(
          { ok: false, code: 'INVALID_INPUT', message: 'شناسه نشست نامعتبر است.' },
          { status: 400 }
        );
      }

      const sockets = this.ctx.getWebSockets(`sess:${authSessionId}`);
      let closed = 0;
      for (const ws of sockets) {
        const att = readChatAttachment(ws);
        this.sendEvent(ws, {
          type: 'conversation:revoked',
          conversationId: att?.conversationId ?? '',
          reason: 'session_revoked',
        });
        this.safeClose(ws, CHAT_WS_CLOSE_UNAUTHORIZED, 'session_revoked');
        closed += 1;
      }
      return Response.json({ ok: true, closed });
    }

    // 2e) Disconnect all sockets of a specific user (logout-all / account suspension)
    if (url.pathname === '/disconnect/user' && internalAction === 'disconnect_user') {
      const userId = typeof payload.userId === 'string' ? payload.userId : '';
      if (!userId) {
        return Response.json(
          { ok: false, code: 'INVALID_INPUT', message: 'شناسه کاربر نامعتبر است.' },
          { status: 400 }
        );
      }

      const sockets = this.ctx.getWebSockets(`user:${userId}`);
      let closed = 0;
      for (const ws of sockets) {
        const att = readChatAttachment(ws);
        this.sendEvent(ws, {
          type: 'conversation:revoked',
          conversationId: att?.conversationId ?? '',
          reason: 'session_revoked',
        });
        this.safeClose(ws, CHAT_WS_CLOSE_UNAUTHORIZED, 'session_revoked');
        closed += 1;
      }
      return Response.json({ ok: true, closed });
    }

    return Response.json(
      { ok: false, code: 'NOT_FOUND', message: 'مسیر داخلی یافت نشد.' },
      { status: 404 }
    );
  }

  // -------------------------------------------------------------------------
  // Official Cloudflare WebSocket Hibernation Handlers
  // -------------------------------------------------------------------------

  public async webSocketMessage(
    ws: HibernatableWebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
    const att = readChatAttachment(ws);
    if (!att) {
      this.safeClose(ws, CHAT_WS_CLOSE_UNAUTHORIZED, 'invalid_attachment');
      return;
    }

    const now = this.nowFn();
    let rate = this.rateLimits.get(ws);
    if (!rate || now - rate.windowStart > WS_PING_RATE_WINDOW_MS) {
      rate = { windowStart: now, count: 0 };
      this.rateLimits.set(ws, rate);
    }
    rate.count += 1;
    if (rate.count > WS_PING_RATE_MAX) {
      this.sendEvent(ws, {
        type: 'error',
        code: 'RATE_LIMITED',
        message: 'تعداد درخواست‌ها بیش از حد مجاز است.',
      });
      return;
    }

    if (getPayloadUtf8Bytes(message) > MAX_CHAT_WS_CLIENT_PAYLOAD_BYTES) {
      this.sendEvent(ws, {
        type: 'error',
        code: 'INVALID_MESSAGE',
        message: 'حجم پیام سوکت بیش از حد مجاز است.',
      });
      return;
    }

    if (typeof message !== 'string') {
      this.sendEvent(ws, {
        type: 'error',
        code: 'INVALID_MESSAGE',
        message: 'فقط پیام‌های متنی JSON مجاز هستند.',
      });
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      const raw = JSON.parse(message) as unknown;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        this.sendEvent(ws, {
          type: 'error',
          code: 'INVALID_MESSAGE',
          message: 'فرمت پیام نامعتبر است.',
        });
        return;
      }
      parsed = raw as Record<string, unknown>;
    } catch {
      this.sendEvent(ws, {
        type: 'error',
        code: 'INVALID_MESSAGE',
        message: 'فرمت JSON پیام نامعتبر است.',
      });
      return;
    }

    // Only lightweight client ping is accepted over WS; all writes commit to D1 via HTTP first
    if (parsed.type === 'ping') {
      this.sendEvent(ws, {
        type: 'pong',
        clientTime:
          typeof parsed.clientTime === 'number' ? parsed.clientTime : undefined,
        serverTime: now,
      });
      return;
    }

    this.sendEvent(ws, {
      type: 'error',
      code: 'UNSUPPORTED_MESSAGE',
      message: 'ارسال این نوع پیام از طریق وب‌سوکت مجاز نیست.',
    });
  }

  public async webSocketClose(
    ws: HibernatableWebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean
  ): Promise<void> {
    this.rateLimits.delete(ws);
  }

  public async webSocketError(
    ws: HibernatableWebSocket,
    _error: unknown
  ): Promise<void> {
    this.rateLimits.delete(ws);
    this.safeClose(ws, 1011, 'socket_error');
  }

  // -------------------------------------------------------------------------
  // Fan-out Helpers (Strictly Reconstructed from Hibernation API)
  // -------------------------------------------------------------------------

  private broadcastToConversation(
    conversationId: string,
    event: ChatWsServerEvent
  ): number {
    const sockets = this.ctx.getWebSockets(`conv:${conversationId}`);
    const encoded = JSON.stringify(event);
    let delivered = 0;
    for (const ws of sockets) {
      const att = readChatAttachment(ws);
      if (!att || att.conversationId !== conversationId) continue;
      try {
        ws.send(encoded);
        delivered += 1;
      } catch {
        this.safeClose(ws, 1011, 'send_failed');
      }
    }
    return delivered;
  }

  private sendEvent(ws: HibernatableWebSocket, event: ChatWsServerEvent): void {
    try {
      ws.send(JSON.stringify(event));
    } catch {
      this.safeClose(ws, 1011, 'send_failed');
    }
  }

  private safeClose(
    ws: HibernatableWebSocket,
    code: number,
    reason: string
  ): void {
    try {
      ws.close(code, reason);
    } catch {
      // Socket already closed
    }
  }
}
