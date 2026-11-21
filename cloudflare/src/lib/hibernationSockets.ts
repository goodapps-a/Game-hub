import { DurableObjectStateLike, HibernatableWebSocket } from './types';

/**
 * Compact metadata persisted inside Cloudflare's WebSocket Attachment API
 * (`ws.serializeAttachment` / `ws.deserializeAttachment`).
 *
 * SECURITY: Never store `sessionToken` or private cards in socket attachments!
 * Only store minimal identity & connection correlation metadata needed after hibernation.
 */
export interface WebSocketSessionAttachment {
  readonly connectionId: string;
  readonly roomCode: string;
  readonly playerId: string | null;
  readonly acceptedAt: number;
  readonly authenticatedAt: number | null;
}

export function createConnectionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ws_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function readSocketAttachment(
  ws: HibernatableWebSocket
): WebSocketSessionAttachment | null {
  try {
    const raw = ws.deserializeAttachment();
    if (!raw || typeof raw !== 'object') return null;
    const att = raw as Partial<WebSocketSessionAttachment>;
    if (
      typeof att.connectionId !== 'string' ||
      typeof att.roomCode !== 'string' ||
      typeof att.acceptedAt !== 'number'
    ) {
      return null;
    }
    return {
      connectionId: att.connectionId,
      roomCode: att.roomCode,
      playerId: typeof att.playerId === 'string' ? att.playerId : null,
      acceptedAt: att.acceptedAt,
      authenticatedAt:
        typeof att.authenticatedAt === 'number' ? att.authenticatedAt : null,
    };
  } catch {
    return null;
  }
}

export function writeSocketAttachment(
  ws: HibernatableWebSocket,
  attachment: WebSocketSessionAttachment
): void {
  ws.serializeAttachment(attachment);
}

/**
 * Safely closes every older socket belonging to `playerId` whose `connectionId`
 * differs from `activeConnectionId`, detaching its `playerId` first so its
 * asynchronous close event cannot race with the active session.
 */
export function supersedeOlderPlayerSockets(
  ctx: DurableObjectStateLike,
  playerId: string,
  activeConnectionId: string,
  notifyBeforeClose?: (ws: HibernatableWebSocket) => void
): number {
  let closed = 0;
  for (const ws of ctx.getWebSockets()) {
    const att = readSocketAttachment(ws);
    if (!att) continue;
    if (att.playerId === playerId && att.connectionId !== activeConnectionId) {
      notifyBeforeClose?.(ws);
      // Mark attachment unauthenticated so its close event is guaranteed no-op
      try {
        writeSocketAttachment(ws, {
          ...att,
          playerId: null,
        });
      } catch {
        // Ignore if socket already closing
      }
      try {
        ws.close(4001, 'superseded');
      } catch {
        // Ignore
      }
      closed += 1;
    }
  }
  return closed;
}

/**
 * Computes the earliest independent handshake expiration timestamp across ALL
 * currently-open unauthenticated sockets. Ensures a newly opened socket can NEVER
 * delay or push back the expiration deadline of an earlier unauthenticated socket.
 */
export function getEarliestUnauthenticatedExpiry(
  ctx: DurableObjectStateLike,
  timeoutMs: number
): number | null {
  let earliest: number | null = null;
  for (const ws of ctx.getWebSockets()) {
    const att = readSocketAttachment(ws);
    if (!att || att.playerId !== null) continue;
    const expiry = att.acceptedAt + timeoutMs;
    if (earliest === null || expiry < earliest) {
      earliest = expiry;
    }
  }
  return earliest;
}

/**
 * Closes ALL unauthenticated WebSockets whose independent handshake deadline
 * (`acceptedAt + timeoutMs`) has expired, and returns the earliest remaining
 * unauthenticated socket deadline so the caller can immediately reschedule `auth_prune`.
 * Authenticated sockets (`att.playerId !== null`) are NEVER touched.
 */
export function pruneUnauthenticatedSockets(
  ctx: DurableObjectStateLike,
  now: number,
  timeoutMs: number,
  notifyBeforeClose?: (ws: HibernatableWebSocket) => void
): { pruned: number; nextExpiryAt: number | null } {
  let pruned = 0;
  let nextExpiryAt: number | null = null;

  for (const ws of ctx.getWebSockets()) {
    const att = readSocketAttachment(ws);
    if (!att || att.playerId !== null) continue;

    const expiry = att.acceptedAt + timeoutMs;
    if (now >= expiry) {
      notifyBeforeClose?.(ws);
      try {
        ws.close(4003, 'auth_timeout');
      } catch {
        // Ignore
      }
      pruned += 1;
    } else if (nextExpiryAt === null || expiry < nextExpiryAt) {
      nextExpiryAt = expiry;
    }
  }

  return { pruned, nextExpiryAt };
}

/**
 * Returns all currently connected authenticated sockets along with their `playerId`
 * and `connectionId`, reconstructed straight from Cloudflare's Hibernation API
 * (`ctx.getWebSockets()`) — works identically after hibernation wake-up!
 */
export function getAuthenticatedSockets(
  ctx: DurableObjectStateLike
): Array<{
  ws: HibernatableWebSocket;
  playerId: string;
  connectionId: string;
}> {
  const result: Array<{
    ws: HibernatableWebSocket;
    playerId: string;
    connectionId: string;
  }> = [];
  for (const ws of ctx.getWebSockets()) {
    const att = readSocketAttachment(ws);
    if (att && att.playerId) {
      result.push({
        ws,
        playerId: att.playerId,
        connectionId: att.connectionId,
      });
    }
  }
  return result;
}
