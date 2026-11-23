/**
 * Express / Node.js in-process real-time chat WebSocket hub.
 *
 * Mirrors the exact wire protocol and revocation semantics of Cloudflare's
 * `ChatConversationDO` so local dev (`npm run dev`), Express integration tests,
 * and browser verification exercise identical real-time WebSocket behavior.
 * When this hub is not attached, Express transparently falls back to HTTP.
 */

import type WebSocket from 'ws';
import {
  CHAT_WS_CLOSE_FORBIDDEN,
  CHAT_WS_CLOSE_SUPERSEDED,
  CHAT_WS_CLOSE_UNAUTHORIZED,
  ChatRealtimePublisher,
  ChatWireMessage,
  ChatWsServerEvent,
  MAX_CHAT_WS_CLIENT_PAYLOAD_BYTES,
} from '../src/platform/social/chatRealtimeProtocol';

interface AttachedChatClient {
  readonly ws: WebSocket;
  readonly userId: string;
  readonly authSessionId: string;
  readonly conversationId: string;
  readonly connectedAt: number;
}

const MAX_SOCKETS_PER_USER_PER_CONV = 8;

export class ExpressChatRealtimeHub implements ChatRealtimePublisher {
  private readonly conversations = new Map<string, Set<AttachedChatClient>>();

  public attachSocket(params: {
    readonly ws: WebSocket;
    readonly userId: string;
    readonly authSessionId: string;
    readonly conversationId: string;
  }): void {
    const { ws, userId, authSessionId, conversationId } = params;
    let bucket = this.conversations.get(conversationId);
    if (!bucket) {
      bucket = new Set();
      this.conversations.set(conversationId, bucket);
    }

    // Cap per-user tabs in this conversation
    const sameUser = Array.from(bucket)
      .filter((c) => c.userId === userId)
      .sort((a, b) => a.connectedAt - b.connectedAt);
    if (sameUser.length >= MAX_SOCKETS_PER_USER_PER_CONV) {
      const excess = sameUser.length - MAX_SOCKETS_PER_USER_PER_CONV + 1;
      for (let i = 0; i < excess; i++) {
        this.closeClient(sameUser[i], CHAT_WS_CLOSE_SUPERSEDED, 'too_many_tabs');
      }
    }

    const client: AttachedChatClient = {
      ws,
      userId,
      authSessionId,
      conversationId,
      connectedAt: Date.now(),
    };
    bucket.add(client);

    ws.on('message', (data) => {
      const rawText =
        typeof data === 'string'
          ? data
          : Buffer.isBuffer(data)
            ? data.toString('utf8')
            : Array.isArray(data)
              ? Buffer.concat(data).toString('utf8')
              : Buffer.from(data as ArrayBuffer).toString('utf8');

      if (Buffer.byteLength(rawText, 'utf8') > MAX_CHAT_WS_CLIENT_PAYLOAD_BYTES) {
        this.sendEvent(ws, {
          type: 'error',
          code: 'INVALID_MESSAGE',
          message: 'حجم پیام سوکت بیش از حد مجاز است.',
        });
        return;
      }

      try {
        const parsed = JSON.parse(rawText) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object' && parsed.type === 'ping') {
          this.sendEvent(ws, {
            type: 'pong',
            clientTime:
              typeof parsed.clientTime === 'number' ? parsed.clientTime : undefined,
            serverTime: Date.now(),
          });
          return;
        }
      } catch {
        // Fall through to error
      }

      this.sendEvent(ws, {
        type: 'error',
        code: 'UNSUPPORTED_MESSAGE',
        message: 'ارسال این نوع پیام از طریق وب‌سوکت مجاز نیست.',
      });
    });

    const cleanup = () => {
      const set = this.conversations.get(conversationId);
      if (set) {
        set.delete(client);
        if (set.size === 0) {
          this.conversations.delete(conversationId);
        }
      }
    };

    ws.on('close', cleanup);
    ws.on('error', cleanup);

    this.sendEvent(ws, {
      type: 'connected',
      conversationId,
      serverTime: Date.now(),
    });
  }

  public async publishMessage(
    conversationId: string,
    message: ChatWireMessage
  ): Promise<void> {
    this.broadcast(conversationId, {
      type: 'message:new',
      conversationId,
      message,
    });
  }

  public async publishRead(payload: {
    readonly conversationId: string;
    readonly readerUserId: string;
    readonly lastReadMessageId: string | null;
    readonly lastReadAt: number;
  }): Promise<void> {
    this.broadcast(payload.conversationId, {
      type: 'read:updated',
      conversationId: payload.conversationId,
      readerUserId: payload.readerUserId,
      lastReadMessageId: payload.lastReadMessageId,
      lastReadAt: payload.lastReadAt,
    });
  }

  public async revokeConversation(
    conversationId: string,
    reason: 'blocked' | 'unfriended' | 'forbidden'
  ): Promise<void> {
    const bucket = this.conversations.get(conversationId);
    if (!bucket) return;
    for (const client of Array.from(bucket)) {
      this.sendEvent(client.ws, {
        type: 'conversation:revoked',
        conversationId,
        reason,
      });
      this.closeClient(client, CHAT_WS_CLOSE_FORBIDDEN, reason);
    }
    this.conversations.delete(conversationId);
  }

  public async disconnectSession(
    conversationIds: readonly string[],
    authSessionId: string
  ): Promise<void> {
    const targets =
      conversationIds.length > 0
        ? conversationIds
        : Array.from(this.conversations.keys());
    for (const convId of targets) {
      const bucket = this.conversations.get(convId);
      if (!bucket) continue;
      for (const client of Array.from(bucket)) {
        if (client.authSessionId !== authSessionId) continue;
        this.sendEvent(client.ws, {
          type: 'conversation:revoked',
          conversationId: convId,
          reason: 'session_revoked',
        });
        this.closeClient(client, CHAT_WS_CLOSE_UNAUTHORIZED, 'session_revoked');
      }
    }
  }

  public async disconnectUser(
    conversationIds: readonly string[],
    userId: string
  ): Promise<void> {
    const targets =
      conversationIds.length > 0
        ? conversationIds
        : Array.from(this.conversations.keys());
    for (const convId of targets) {
      const bucket = this.conversations.get(convId);
      if (!bucket) continue;
      for (const client of Array.from(bucket)) {
        if (client.userId !== userId) continue;
        this.sendEvent(client.ws, {
          type: 'conversation:revoked',
          conversationId: convId,
          reason: 'session_revoked',
        });
        this.closeClient(client, CHAT_WS_CLOSE_UNAUTHORIZED, 'session_revoked');
      }
    }
  }

  public getActiveSocketCount(conversationId?: string): number {
    if (conversationId) {
      return this.conversations.get(conversationId)?.size ?? 0;
    }
    let total = 0;
    for (const bucket of this.conversations.values()) {
      total += bucket.size;
    }
    return total;
  }

  public dispose(): void {
    for (const bucket of this.conversations.values()) {
      for (const client of Array.from(bucket)) {
        this.closeClient(client, 1001, 'server_shutdown');
      }
    }
    this.conversations.clear();
  }

  private broadcast(conversationId: string, event: ChatWsServerEvent): void {
    const bucket = this.conversations.get(conversationId);
    if (!bucket || bucket.size === 0) return;
    const encoded = JSON.stringify(event);
    for (const client of Array.from(bucket)) {
      if (client.ws.readyState !== 1) continue;
      try {
        client.ws.send(encoded);
      } catch {
        this.closeClient(client, 1011, 'send_failed');
      }
    }
  }

  private sendEvent(ws: WebSocket, event: ChatWsServerEvent): void {
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(event));
    } catch {
      try {
        ws.close(1011, 'send_failed');
      } catch {
        // Ignore
      }
    }
  }

  private closeClient(
    client: AttachedChatClient,
    code: number,
    reason: string
  ): void {
    const bucket = this.conversations.get(client.conversationId);
    bucket?.delete(client);
    if (bucket && bucket.size === 0) {
      this.conversations.delete(client.conversationId);
    }
    try {
      client.ws.close(code, reason);
    } catch {
      // Ignore already closed
    }
  }
}
