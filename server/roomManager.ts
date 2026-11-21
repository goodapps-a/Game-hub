import crypto from 'node:crypto';
import type { WebSocket, RawData } from 'ws';
import {
  CreateRoomResponse,
  DEFAULT_DISCONNECT_GRACE_MS,
  JoinRoomResponse,
  MAX_WS_PAYLOAD_BYTES,
  OnlineErrorCode,
  PROTOCOL_VERSION,
  PublicRoomSummary,
  RoomEventNotice,
  ServerMessage,
  parseClientMessage,
  sanitizeAvatarCode,
  sanitizeRoomCode,
  sanitizeUsername,
} from '../src/games/hokm/online/protocol';
import {
  HokmRoomController,
  RoomActionOutcome,
} from '../src/games/hokm/online/roomController';
import { Seat } from '../src/games/hokm/engine/types';
import { EyvanDatabase } from './database';

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;

const AUTH_HANDSHAKE_TIMEOUT_MS = 8_000;
const RATE_WINDOW_MS = 2_000;
const RATE_MAX_MESSAGES = 45;
const CLOSED_ROOM_TTL_MS = 5 * 60_000;

interface ManagedRoom {
  controller: HokmRoomController;
  /** Active authenticated WebSocket keyed by playerId (strictly 1 socket per seat!) */
  socketsByPlayer: Map<string, WebSocket>;
  trickTimer: ReturnType<typeof setTimeout> | null;
  nextHandTimer: ReturnType<typeof setTimeout> | null;
  closedAt: number | null;
  createdAt: number;
}

interface SocketRateState {
  windowStart: number;
  count: number;
}

export interface RoomManagerOptions {
  db: EyvanDatabase;
  disconnectGraceMs?: number;
  trickCollectDelayMs?: number;
  nextHandDelayMs?: number;
}

function generateRoomCode(): string {
  const bytes = crypto.randomBytes(ROOM_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
  }
  return out;
}

function rawDataToString(data: RawData): string | null {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) {
    if (data.byteLength > MAX_WS_PAYLOAD_BYTES) return null;
    return data.toString('utf8');
  }
  if (Array.isArray(data)) {
    const total = data.reduce((sum, b) => sum + b.byteLength, 0);
    if (total > MAX_WS_PAYLOAD_BYTES) return null;
    return Buffer.concat(data).toString('utf8');
  }
  if (data instanceof ArrayBuffer) {
    if (data.byteLength > MAX_WS_PAYLOAD_BYTES) return null;
    return Buffer.from(data).toString('utf8');
  }
  return null;
}

/**
 * Node.js Room Manager orchestrating live HokmRoomController rooms over `ws`.
 * Mirrors the exact semantics of `cloudflare/src/HokmRoomDO.ts` so both
 * runtimes share identical gameplay, privacy, reconnection, and D1/SQLite persistence.
 */
export class HokmRoomManager {
  private readonly db: EyvanDatabase;
  private readonly disconnectGraceMs: number;
  private readonly trickCollectDelayMs: number;
  private readonly nextHandDelayMs: number;

  private readonly rooms = new Map<string, ManagedRoom>();
  private readonly sweepInterval: ReturnType<typeof setInterval>;

  constructor(options: RoomManagerOptions) {
    this.db = options.db;
    this.disconnectGraceMs =
      options.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS;
    this.trickCollectDelayMs = options.trickCollectDelayMs ?? 1250;
    this.nextHandDelayMs = options.nextHandDelayMs ?? 1150;

    // Periodic grace sweep & closed-room eviction
    this.sweepInterval = setInterval(() => {
      this.sweepAllRooms();
    }, 4_000);
    if (typeof this.sweepInterval.unref === 'function') {
      this.sweepInterval.unref();
    }
  }

  public dispose(): void {
    clearInterval(this.sweepInterval);
    for (const room of this.rooms.values()) {
      this.clearRoomTimers(room);
      for (const ws of room.socketsByPlayer.values()) {
        try {
          ws.close(1001, 'server_shutdown');
        } catch {
          // Ignore close errors
        }
      }
    }
    this.rooms.clear();
  }

  public getActiveRoomCount(): number {
    return this.rooms.size;
  }

  private clearRoomTimers(room: ManagedRoom): void {
    if (room.trickTimer) {
      clearTimeout(room.trickTimer);
      room.trickTimer = null;
    }
    if (room.nextHandTimer) {
      clearTimeout(room.nextHandTimer);
      room.nextHandTimer = null;
    }
  }

  private sendJson(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState !== 1 /* OPEN */) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Ignore broken pipe; close event handles disconnect
    }
  }

  private sendError(
    ws: WebSocket,
    code: OnlineErrorCode,
    message: string,
    actionId?: string
  ): void {
    this.sendJson(ws, {
      protocolVersion: PROTOCOL_VERSION,
      type: 'error',
      code,
      message,
      actionId,
    });
  }

  private broadcastState(room: ManagedRoom, event?: RoomEventNotice): void {
    for (const [playerId, ws] of room.socketsByPlayer.entries()) {
      const snapshot = room.controller.getSnapshotForPlayer(playerId);
      if (!snapshot) continue;
      this.sendJson(ws, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'state_sync',
        snapshot,
        event,
      });
    }
  }

  private handleOutcome(room: ManagedRoom, outcome: RoomActionOutcome): void {
    if (outcome.completedMatch) {
      try {
        this.db.recordCompletedMatch(outcome.completedMatch);
        room.controller.markMatchPersisted(outcome.completedMatch.matchId);
      } catch (err) {
        console.error('[HokmRoomManager] Failed to persist match:', err);
      }
    }

    if (room.controller.getStatus() === 'CLOSED' && room.closedAt === null) {
      room.closedAt = Date.now();
      this.clearRoomTimers(room);
    }

    if (outcome.shouldBroadcast) {
      this.broadcastState(room, outcome.event);
    }

    if (outcome.scheduleTrickCollectMs !== undefined) {
      if (room.trickTimer) clearTimeout(room.trickTimer);
      room.trickTimer = setTimeout(() => {
        room.trickTimer = null;
        const next = room.controller.resolveCompletedTrick();
        this.handleOutcome(room, next);
      }, outcome.scheduleTrickCollectMs);
    }

    if (outcome.scheduleNextHandMs !== undefined) {
      if (room.nextHandTimer) clearTimeout(room.nextHandTimer);
      room.nextHandTimer = setTimeout(() => {
        room.nextHandTimer = null;
        const next = room.controller.advanceToNextHand();
        this.handleOutcome(room, next);
      }, outcome.scheduleNextHandMs);
    }
  }

  private sweepAllRooms(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms.entries()) {
      const outcome = room.controller.sweepExpiredDisconnects();
      if (outcome.shouldBroadcast || outcome.event?.type === 'ROOM_CLOSED') {
        this.handleOutcome(room, outcome);
      }
      if (room.controller.getStatus() === 'CLOSED') {
        if (room.closedAt === null) room.closedAt = now;
        if (now - room.closedAt > CLOSED_ROOM_TTL_MS && room.socketsByPlayer.size === 0) {
          this.clearRoomTimers(room);
          this.rooms.delete(code);
        }
      } else if (
        room.controller.getStatus() === 'WAITING' &&
        room.socketsByPlayer.size === 0 &&
        now - room.createdAt > Math.max(this.disconnectGraceMs * 2, 180_000)
      ) {
        // Evict abandoned lobby where creator never connected
        this.clearRoomTimers(room);
        this.rooms.delete(code);
      }
    }
  }

  // -------------------------------------------------------------------------
  // HTTP Room Lifecycle Methods
  // -------------------------------------------------------------------------

  public createRoom(input: {
    username: unknown;
    avatarCode?: unknown;
    targetMatchScore?: unknown;
  }):
    | { ok: true; response: CreateRoomResponse; sessionToken: string }
    | { ok: false; status: number; code: OnlineErrorCode; message: string } {
    const username = sanitizeUsername(input.username);
    if (!username) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_MESSAGE',
        message: 'نام کاربری نامعتبر است (۳ تا ۲۰ کاراکتر انگلیسی، عدد یا _).',
      };
    }

    const avatarCode = sanitizeAvatarCode(input.avatarCode);
    const rawTarget =
      typeof input.targetMatchScore === 'number' &&
      Number.isInteger(input.targetMatchScore) &&
      input.targetMatchScore >= 1 &&
      input.targetMatchScore <= 7
        ? input.targetMatchScore
        : 3;

    // Generate collision-free short room code
    let roomCode = generateRoomCode();
    let attempts = 0;
    while (this.rooms.has(roomCode) && attempts < 15) {
      roomCode = generateRoomCode();
      attempts += 1;
    }

    const roomId = `room_${crypto.randomUUID()}`;
    const controller = new HokmRoomController({
      roomId,
      roomCode,
      targetMatchScore: rawTarget,
      disconnectGraceMs: this.disconnectGraceMs,
      trickCollectDelayMs: this.trickCollectDelayMs,
      nextHandDelayMs: this.nextHandDelayMs,
    });

    const joinRes = controller.joinPlayer({
      username,
      avatarCode,
      preferredSeat: 'south',
    });
    if (joinRes.ok === false) {
      return {
        ok: false,
        status: 400,
        code: joinRes.code,
        message: joinRes.message,
      };
    }

    const managed: ManagedRoom = {
      controller,
      socketsByPlayer: new Map(),
      trickTimer: null,
      nextHandTimer: null,
      closedAt: null,
      createdAt: Date.now(),
    };
    this.rooms.set(roomCode, managed);

    try {
      this.db.upsertUser(username, avatarCode);
    } catch (err) {
      console.error('[HokmRoomManager] Failed to upsert user:', err);
    }

    return {
      ok: true,
      sessionToken: joinRes.member.sessionToken,
      response: {
        roomId,
        roomCode,
        playerId: joinRes.member.playerId,
        canonicalSeat: joinRes.member.canonicalSeat,
        wsPath: `/ws/rooms/${roomCode}`,
      },
    };
  }

  public joinRoom(
    rawRoomCode: string,
    input: {
      username: unknown;
      avatarCode?: unknown;
      preferredSeat?: Seat;
    }
  ):
    | { ok: true; response: JoinRoomResponse; sessionToken: string }
    | { ok: false; status: number; code: OnlineErrorCode; message: string } {
    const roomCode = sanitizeRoomCode(rawRoomCode);
    if (!roomCode) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_MESSAGE',
        message: 'کد اتاق نامعتبر است.',
      };
    }

    const room = this.rooms.get(roomCode);
    if (!room) {
      return {
        ok: false,
        status: 404,
        code: 'ROOM_NOT_FOUND',
        message: 'اتاقی با این کد پیدا نشد.',
      };
    }

    const username = sanitizeUsername(input.username);
    if (!username) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_MESSAGE',
        message: 'نام کاربری نامعتبر است (۳ تا ۲۰ کاراکتر انگلیسی، عدد یا _).',
      };
    }
    const avatarCode = sanitizeAvatarCode(input.avatarCode);

    const joinRes = room.controller.joinPlayer({
      username,
      avatarCode,
      preferredSeat: input.preferredSeat,
    });
    if (joinRes.ok === false) {
      const status =
        joinRes.code === 'ROOM_FULL' ||
        joinRes.code === 'SEAT_TAKEN' ||
        joinRes.code === 'DUPLICATE_PLAYER'
          ? 409
          : joinRes.code === 'ROOM_CLOSED'
            ? 410
            : 400;
      return {
        ok: false,
        status,
        code: joinRes.code,
        message: joinRes.message,
      };
    }

    try {
      this.db.upsertUser(username, avatarCode);
    } catch (err) {
      console.error('[HokmRoomManager] Failed to upsert user:', err);
    }

    // Notify existing connected players right away that a seat was claimed
    this.broadcastState(room, {
      type: 'PLAYER_JOINED',
      actorSeat: joinRes.member.canonicalSeat,
      detail: joinRes.member.username,
    });

    return {
      ok: true,
      sessionToken: joinRes.member.sessionToken,
      response: {
        roomId: room.controller.roomId,
        roomCode: room.controller.roomCode,
        playerId: joinRes.member.playerId,
        canonicalSeat: joinRes.member.canonicalSeat,
        wsPath: `/ws/rooms/${room.controller.roomCode}`,
      },
    };
  }

  public getRoomSummary(rawRoomCode: string): PublicRoomSummary | null {
    const roomCode = sanitizeRoomCode(rawRoomCode);
    if (!roomCode) return null;
    const room = this.rooms.get(roomCode);
    if (!room) return null;
    return room.controller.getPublicSummary();
  }

  public resumeSession(
    rawRoomCode: string,
    playerId: string,
    sessionToken: string
  ):
    | { ok: true; response: JoinRoomResponse }
    | { ok: false; status: number; code: OnlineErrorCode; message: string } {
    const roomCode = sanitizeRoomCode(rawRoomCode);
    if (!roomCode) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_MESSAGE',
        message: 'کد اتاق نامعتبر است.',
      };
    }

    const room = this.rooms.get(roomCode);
    if (!room) {
      return {
        ok: false,
        status: 404,
        code: 'ROOM_NOT_FOUND',
        message: 'اتاقی با این کد یافت نشد.',
      };
    }

    const verified = room.controller.verifySessionForResume(
      playerId,
      sessionToken
    );
    if (verified.ok === false) {
      return {
        ok: false,
        status: verified.code === 'ROOM_CLOSED' ? 404 : 401,
        code: verified.code,
        message: verified.message,
      };
    }

    return {
      ok: true,
      response: {
        roomId: room.controller.roomId,
        roomCode: room.controller.roomCode,
        playerId: verified.member.playerId,
        canonicalSeat: verified.member.canonicalSeat,
        wsPath: `/ws/rooms/${room.controller.roomCode}`,
      },
    };
  }

  // -------------------------------------------------------------------------
  // WebSocket Session Attachment & Message Dispatch (Cookie-Authenticated)
  // -------------------------------------------------------------------------

  public attachAuthenticatedWebSocket(
    rawRoomCode: string,
    playerId: string,
    sessionToken: string,
    ws: WebSocket
  ): void {
    const roomCode = sanitizeRoomCode(rawRoomCode);
    const room = roomCode ? this.rooms.get(roomCode) : undefined;
    if (!room) {
      this.sendError(ws, 'ROOM_NOT_FOUND', 'اتاقی با این کد یافت نشد.');
      ws.close(4004, 'room_not_found');
      return;
    }

    const connectionId = crypto.randomUUID();
    const auth = room.controller.authenticateConnection(
      playerId,
      sessionToken,
      connectionId
    );
    if (auth.ok === false) {
      this.sendError(ws, auth.code, auth.message);
      ws.close(4003, 'unauthorized');
      return;
    }

    const authedPlayerId = auth.member.playerId;
    const rate: SocketRateState = { windowStart: Date.now(), count: 0 };

    // Enforce 1 active socket per player (supersede stale socket cleanly!)
    const existingSocket = room.socketsByPlayer.get(authedPlayerId);
    if (existingSocket && existingSocket !== ws) {
      this.sendError(
        existingSocket,
        'SUPERSEDED_CONNECTION',
        'اتصال جدیدی جایگزین این نشست شد.'
      );
      try {
        existingSocket.close(4001, 'superseded');
      } catch {
        // Ignore
      }
    }
    room.socketsByPlayer.set(authedPlayerId, ws);

    const viewerSnap = room.controller.getSnapshotForPlayer(authedPlayerId);
    if (viewerSnap) {
      this.sendJson(ws, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'auth_ok',
        snapshot: viewerSnap,
      });
    }

    // Notify other players of join / reconnect
    for (const [otherId, otherWs] of room.socketsByPlayer.entries()) {
      if (otherId === authedPlayerId) continue;
      const otherSnap = room.controller.getSnapshotForPlayer(otherId);
      if (otherSnap) {
        this.sendJson(otherWs, {
          protocolVersion: PROTOCOL_VERSION,
          type: 'state_sync',
          snapshot: otherSnap,
          event: auth.event,
        });
      }
    }

    ws.on('message', (rawData: RawData) => {
      // Rate limit per socket
      const now = Date.now();
      if (now - rate.windowStart > RATE_WINDOW_MS) {
        rate.windowStart = now;
        rate.count = 0;
      }
      rate.count += 1;
      if (rate.count > RATE_MAX_MESSAGES) {
        this.sendError(ws, 'RATE_LIMITED', 'تعداد درخواست‌ها بیش از حد مجاز است.');
        return;
      }

      const text = rawDataToString(rawData);
      if (text === null) {
        this.sendError(ws, 'INVALID_MESSAGE', 'حجم پیام بیش از حد مجاز است.');
        return;
      }

      const parsed = parseClientMessage(text);
      if (parsed.ok === false) {
        this.sendError(ws, parsed.code, parsed.reason);
        return;
      }

      const msg = parsed.message;

      // Heartbeat
      if (msg.type === 'ping') {
        this.sendJson(ws, {
          protocolVersion: PROTOCOL_VERSION,
          type: 'pong',
          clientTime: msg.clientTime,
          serverTime: Date.now(),
        });
        return;
      }

      // Guard against messages arriving on a superseded socket before TCP close settles
      if (!room.controller.isActiveConnection(authedPlayerId, connectionId)) {
        this.sendError(
          ws,
          'SUPERSEDED_CONNECTION',
          'اتصال جدیدی جایگزین این نشست شده است.'
        );
        try {
          ws.close(4001, 'superseded');
        } catch {
          // Ignore
        }
        return;
      }

      if (msg.type === 'request_sync') {
        const snap = room.controller.getSnapshotForPlayer(authedPlayerId);
        if (snap) {
          this.sendJson(ws, {
            protocolVersion: PROTOCOL_VERSION,
            type: 'state_sync',
            snapshot: snap,
          });
        }
        return;
      }

      let outcome: RoomActionOutcome;
      switch (msg.type) {
        case 'set_ready':
          outcome = room.controller.setReady(
            authedPlayerId,
            msg.ready,
            msg.actionId
          );
          break;
        case 'select_seat':
          outcome = room.controller.selectSeat(
            authedPlayerId,
            msg.canonicalSeat,
            msg.actionId
          );
          break;
        case 'start_match':
          outcome = room.controller.startMatch(authedPlayerId, msg.actionId);
          break;
        case 'choose_trump':
          outcome = room.controller.chooseTrump(
            authedPlayerId,
            msg.suit,
            msg.actionId
          );
          break;
        case 'play_card':
          outcome = room.controller.playCardMove(
            authedPlayerId,
            msg.cardId,
            msg.actionId
          );
          break;
        case 'rematch':
          outcome = room.controller.startRematch(authedPlayerId, msg.actionId);
          break;
        case 'leave_room':
          outcome = room.controller.leaveRoom(authedPlayerId, msg.actionId);
          if (outcome.ok && !outcome.duplicate) {
            room.socketsByPlayer.delete(authedPlayerId);
          }
          break;
      }

      if (!outcome.ok) {
        this.sendError(
          ws,
          outcome.errorCode ?? 'ACTION_REJECTED',
          outcome.errorMessage ?? 'حرکت مجاز نیست.',
          msg.actionId
        );
        return;
      }

      this.sendJson(ws, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'action_ack',
        actionId: msg.actionId,
        duplicate: outcome.duplicate,
      });

      this.handleOutcome(room, outcome);

      if (msg.type === 'leave_room' && !outcome.duplicate) {
        try {
          ws.close(1000, 'left_room');
        } catch {
          // Ignore
        }
      }
    });

    ws.on('close', () => {
      // Only mark disconnected if THIS socket is still the active socket for the player
      const current = room.socketsByPlayer.get(authedPlayerId);
      if (current === ws) {
        room.socketsByPlayer.delete(authedPlayerId);
      }
      // Controller checks activeConnectionId so stale sockets NEVER clobber a newer connection
      if (room.controller.getPlayerById(authedPlayerId)) {
        const disc = room.controller.markPlayerDisconnected(
          authedPlayerId,
          connectionId
        );
        this.handleOutcome(room, disc);
      }
    });

    ws.on('error', () => {
      // Handled by 'close'
    });
  }
}
