/**
 * Shared real-time private chat protocol, read-cursor ordering, message
 * reconciliation (optimistic + server deduplication), and reconnect backoff helpers.
 *
 * Pure, dependency-free module shared across Cloudflare Worker/DO, Express,
 * React frontend, and Node unit tests.
 */

export interface ChatWireMessage {
  readonly messageId: string;
  readonly conversationId: string;
  readonly senderId: string;
  readonly kind: 'text' | 'system' | 'game_invite';
  readonly body: string;
  readonly clientMsgId: string | null;
  readonly createdAt: number;
}

export interface ChatReadCursor {
  readonly lastReadAt: number;
  readonly lastReadMessageId: string | null;
}

export type ChatUiMessageStatus = 'sending' | 'sent' | 'failed';

export interface ChatUiMessage extends ChatWireMessage {
  readonly localStatus: ChatUiMessageStatus;
  readonly errorText?: string;
}

export type ChatWsServerEvent =
  | {
      readonly type: 'connected';
      readonly conversationId: string;
      readonly serverTime: number;
    }
  | {
      readonly type: 'message:new';
      readonly conversationId: string;
      readonly message: ChatWireMessage;
    }
  | {
      readonly type: 'read:updated';
      readonly conversationId: string;
      readonly readerUserId: string;
      readonly lastReadMessageId: string | null;
      readonly lastReadAt: number;
    }
  | {
      readonly type: 'conversation:revoked';
      readonly conversationId: string;
      readonly reason: 'blocked' | 'unfriended' | 'session_revoked' | 'forbidden';
    }
  | {
      readonly type: 'pong';
      readonly clientTime?: number;
      readonly serverTime: number;
    }
  | {
      readonly type: 'error';
      readonly code: string;
      readonly message: string;
    };

export type ChatWsClientEvent = {
  readonly type: 'ping';
  readonly clientTime?: number;
};

export interface ChatRealtimePublisher {
  publishMessage(conversationId: string, message: ChatWireMessage): Promise<void>;
  publishRead(payload: {
    readonly conversationId: string;
    readonly readerUserId: string;
    readonly lastReadMessageId: string | null;
    readonly lastReadAt: number;
  }): Promise<void>;
  revokeConversation(
    conversationId: string,
    reason: 'blocked' | 'unfriended' | 'forbidden'
  ): Promise<void>;
  disconnectSession?(
    conversationIds: readonly string[],
    authSessionId: string
  ): Promise<void>;
  disconnectUser?(
    conversationIds: readonly string[],
    userId: string
  ): Promise<void>;
}

export const CHAT_WS_CLOSE_UNAUTHORIZED = 4401;
export const CHAT_WS_CLOSE_FORBIDDEN = 4403;
export const CHAT_WS_CLOSE_SUPERSEDED = 4409;

export const CHAT_RECONNECT_BASE_MS = 1_000;
export const CHAT_RECONNECT_MAX_MS = 30_000;
export const CHAT_FALLBACK_POLL_INTERVAL_MS = 5_000;
export const MAX_CHAT_WS_CLIENT_PAYLOAD_BYTES = 1024;

/**
 * Total ordering for two message cursors `(createdAt, messageId)`.
 * Returns `< 0` if `a < b`, `0` if equal, `> 0` if `a > b`.
 */
export function compareMessageCursor(
  a: { readonly createdAt: number; readonly messageId: string | null },
  b: { readonly createdAt: number; readonly messageId: string | null }
): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt - b.createdAt;
  }
  const idA = a.messageId ?? '';
  const idB = b.messageId ?? '';
  if (idA === idB) return 0;
  return idA < idB ? -1 : 1;
}

/**
 * Advances a read cursor strictly monotonically. Older or out-of-order updates
 * can NEVER move the cursor backward.
 */
export function advanceReadCursorMonotonic(
  current: ChatReadCursor | null,
  candidate: ChatReadCursor | null
): ChatReadCursor | null {
  if (!candidate) return current;
  if (!Number.isFinite(candidate.lastReadAt) || candidate.lastReadAt <= 0) {
    return current;
  }
  if (!current) {
    return {
      lastReadAt: Math.floor(candidate.lastReadAt),
      lastReadMessageId: candidate.lastReadMessageId ?? null,
    };
  }
  const cmp = compareMessageCursor(
    { createdAt: candidate.lastReadAt, messageId: candidate.lastReadMessageId },
    { createdAt: current.lastReadAt, messageId: current.lastReadMessageId }
  );
  if (cmp > 0) {
    return {
      lastReadAt: Math.floor(candidate.lastReadAt),
      lastReadMessageId: candidate.lastReadMessageId ?? null,
    };
  }
  // If same timestamp and current lacked a messageId while candidate provides one, enrich it
  if (
    cmp === 0 &&
    !current.lastReadMessageId &&
    candidate.lastReadMessageId
  ) {
    return {
      lastReadAt: current.lastReadAt,
      lastReadMessageId: candidate.lastReadMessageId,
    };
  }
  return current;
}

/**
 * Strictly determines whether a confirmed outgoing message should show 2 ticks (Read)
 * vs 1 tick (Sent & stored in D1).
 *
 * Invariants:
 * - Optimistic (`sending`) or `failed` messages are NEVER considered read.
 * - When `partnerCursor.lastReadMessageId` is present, compares the exact ordered
 *   cursor tuple `(createdAt, messageId)` so two messages in the same millisecond
 *   are distinguished accurately.
 * - When `partnerCursor.lastReadMessageId` is null (legacy rows), falls back to
 *   `msg.createdAt <= partnerCursor.lastReadAt`.
 */
export function isMessageReadByPartner(
  msg: Pick<ChatUiMessage, 'messageId' | 'createdAt' | 'localStatus'>,
  partnerCursor: ChatReadCursor | null
): boolean {
  if (msg.localStatus !== 'sent') return false;
  if (!partnerCursor) return false;
  if (!Number.isFinite(partnerCursor.lastReadAt) || partnerCursor.lastReadAt <= 0) {
    return false;
  }
  if (partnerCursor.lastReadMessageId) {
    return (
      compareMessageCursor(
        { createdAt: msg.createdAt, messageId: msg.messageId },
        {
          createdAt: partnerCursor.lastReadAt,
          messageId: partnerCursor.lastReadMessageId,
        }
      ) <= 0
    );
  }
  return msg.createdAt <= partnerCursor.lastReadAt;
}

/**
 * Converts confirmed wire messages into UI messages with `localStatus: 'sent'`.
 */
export function toConfirmedUiMessage(msg: ChatWireMessage): ChatUiMessage {
  return {
    ...msg,
    localStatus: 'sent',
  };
}

/**
 * Reconciles existing UI messages (including optimistic `sending`/`failed` items)
 * with incoming confirmed server messages (from HTTP or WebSocket).
 *
 * Guarantees:
 * - Zero duplicates by `messageId`.
 * - Zero duplicates when an optimistic message (`clientMsgId`) is confirmed either
 *   by the HTTP POST response OR an earlier WebSocket `message:new` push!
 * - Confirmed server messages always supersede local optimistic/failed copies.
 * - Deterministic chronological ordering by `(createdAt ASC, messageId ASC)`.
 */
export function mergeChatMessages(
  existing: readonly ChatUiMessage[],
  incoming: readonly ChatUiMessage[]
): ChatUiMessage[] {
  const byMessageId = new Map<string, ChatUiMessage>();
  const clientMsgIdToKey = new Map<string, string>();

  const upsert = (item: ChatUiMessage) => {
    // 1. Reconcile matching clientMsgId (optimistic <-> confirmed server message)
    if (item.clientMsgId) {
      const existingKey = clientMsgIdToKey.get(item.clientMsgId);
      if (existingKey && existingKey !== item.messageId) {
        const prev = byMessageId.get(existingKey);
        if (prev) {
          // If incoming is confirmed and prev was optimistic/failed, replace prev
          if (item.localStatus === 'sent' && prev.localStatus !== 'sent') {
            byMessageId.delete(existingKey);
            byMessageId.set(item.messageId, item);
            clientMsgIdToKey.set(item.clientMsgId, item.messageId);
            return;
          }
          // If prev is already confirmed and incoming is stale optimistic, keep prev
          if (prev.localStatus === 'sent' && item.localStatus !== 'sent') {
            return;
          }
        }
      }
    }

    const prevSameId = byMessageId.get(item.messageId);
    if (prevSameId) {
      // Never downgrade a confirmed server message back to sending/failed
      if (prevSameId.localStatus === 'sent' && item.localStatus !== 'sent') {
        return;
      }
      byMessageId.set(item.messageId, item);
    } else {
      byMessageId.set(item.messageId, item);
    }

    if (item.clientMsgId) {
      clientMsgIdToKey.set(item.clientMsgId, item.messageId);
    }
  };

  for (const m of existing) upsert(m);
  for (const m of incoming) upsert(m);

  return Array.from(byMessageId.values()).sort((a, b) =>
    compareMessageCursor(a, b)
  );
}

/**
 * Returns the latest confirmed server message cursor `(createdAt, messageId)` from a list.
 * Used for lightweight incremental HTTP delta sync (`after` + `afterMessageId`).
 */
export function getLatestConfirmedCursor(
  messages: readonly ChatUiMessage[]
): { readonly createdAt: number; readonly messageId: string } | null {
  let latest: { createdAt: number; messageId: string } | null = null;
  for (const m of messages) {
    if (m.localStatus !== 'sent') continue;
    if (
      !latest ||
      compareMessageCursor(
        { createdAt: m.createdAt, messageId: m.messageId },
        latest
      ) > 0
    ) {
      latest = { createdAt: m.createdAt, messageId: m.messageId };
    }
  }
  return latest;
}

/**
 * Returns the latest confirmed message sent by the partner (not `currentUserId`).
 * Used to accurately advance the user's read cursor only for real visible partner messages.
 */
export function getLatestPartnerConfirmedMessage(
  messages: readonly ChatUiMessage[],
  currentUserId: string
): ChatUiMessage | null {
  let latest: ChatUiMessage | null = null;
  for (const m of messages) {
    if (m.localStatus !== 'sent' || m.senderId === currentUserId) continue;
    if (!latest || compareMessageCursor(m, latest) > 0) {
      latest = m;
    }
  }
  return latest;
}

/**
 * Computes capped Exponential Backoff with bounded jitter to prevent reconnect storms.
 * Attempt 0 -> ~1s, 1 -> ~2s, 2 -> ~4s, 3 -> ~8s, 4 -> ~16s, 5+ -> ~30s cap.
 */
export function computeReconnectDelayMs(
  attempt: number,
  randomUnit: () => number = Math.random
): number {
  const safeAttempt = Math.max(0, Math.min(10, Math.floor(attempt)));
  const expDelay = Math.min(
    CHAT_RECONNECT_MAX_MS,
    CHAT_RECONNECT_BASE_MS * Math.pow(2, safeAttempt)
  );
  const jitterFraction = Math.max(0, Math.min(1, randomUnit())) * 0.25;
  return Math.min(
    CHAT_RECONNECT_MAX_MS,
    Math.round(expDelay * (1 + jitterFraction))
  );
}

/**
 * Safely validates and parses an incoming WebSocket server frame.
 */
export function parseChatWsServerEvent(raw: string): ChatWsServerEvent | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      return null;
    }

    switch (parsed.type) {
      case 'connected':
        if (
          typeof parsed.conversationId === 'string' &&
          typeof parsed.serverTime === 'number'
        ) {
          return {
            type: 'connected',
            conversationId: parsed.conversationId,
            serverTime: parsed.serverTime,
          };
        }
        return null;

      case 'message:new': {
        const msg = parsed.message as Record<string, unknown> | undefined;
        if (
          typeof parsed.conversationId !== 'string' ||
          !msg ||
          typeof msg !== 'object' ||
          typeof msg.messageId !== 'string' ||
          typeof msg.conversationId !== 'string' ||
          typeof msg.senderId !== 'string' ||
          typeof msg.body !== 'string' ||
          typeof msg.createdAt !== 'number'
        ) {
          return null;
        }
        const kind =
          msg.kind === 'system' || msg.kind === 'game_invite' ? msg.kind : 'text';
        return {
          type: 'message:new',
          conversationId: parsed.conversationId,
          message: {
            messageId: msg.messageId,
            conversationId: msg.conversationId,
            senderId: msg.senderId,
            kind,
            body: msg.body,
            clientMsgId:
              typeof msg.clientMsgId === 'string' ? msg.clientMsgId : null,
            createdAt: msg.createdAt,
          },
        };
      }

      case 'read:updated':
        if (
          typeof parsed.conversationId === 'string' &&
          typeof parsed.readerUserId === 'string' &&
          typeof parsed.lastReadAt === 'number'
        ) {
          return {
            type: 'read:updated',
            conversationId: parsed.conversationId,
            readerUserId: parsed.readerUserId,
            lastReadMessageId:
              typeof parsed.lastReadMessageId === 'string'
                ? parsed.lastReadMessageId
                : null,
            lastReadAt: parsed.lastReadAt,
          };
        }
        return null;

      case 'conversation:revoked': {
        const reason = parsed.reason;
        if (
          typeof parsed.conversationId === 'string' &&
          (reason === 'blocked' ||
            reason === 'unfriended' ||
            reason === 'session_revoked' ||
            reason === 'forbidden')
        ) {
          return {
            type: 'conversation:revoked',
            conversationId: parsed.conversationId,
            reason,
          };
        }
        return null;
      }

      case 'pong':
        if (typeof parsed.serverTime === 'number') {
          return {
            type: 'pong',
            clientTime:
              typeof parsed.clientTime === 'number' ? parsed.clientTime : undefined,
            serverTime: parsed.serverTime,
          };
        }
        return null;

      case 'error':
        if (
          typeof parsed.code === 'string' &&
          typeof parsed.message === 'string'
        ) {
          return {
            type: 'error',
            code: parsed.code,
            message: parsed.message,
          };
        }
        return null;

      default:
        return null;
    }
  } catch {
    return null;
  }
}
