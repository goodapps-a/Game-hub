/**
 * Cloudflare Durable Object: Single-Authority, Hibernatable Live Hokm Room
 *
 * Reliability Guarantees:
 * 1. Durable Storage Persistence (`room:state` + `sys:alarms`):
 *    Full room & Hokm match state is persisted to Durable Object Storage on every
 *    authoritative mutation and rehydrated atomically via `blockConcurrencyWhile`.
 * 2. Official WebSocket Hibernation API:
 *    Uses `ctx.acceptWebSocket`, `ws.serializeAttachment` / `ws.deserializeAttachment`,
 *    `ctx.getWebSockets()`, and class handlers `webSocketMessage`, `webSocketClose`,
 *    and `webSocketError` — zero reliance on volatile Maps for session identity.
 * 3. Safe Peek-Execute-Ack Durable Alarm Scheduler (`DurableAlarmScheduler`):
 *    Tasks are never deleted before successful execution; failures retry with bounded
 *    backoff. Unauthenticated socket pruning tracks each socket's independent deadline
 *    so new connections can never postpone pruning older unauthenticated sockets.
 * 4. Strict Reconnect & Concurrency Safety:
 *    Correlates every active session with a unique `connectionId` so stale/superseded
 *    socket close events can NEVER corrupt a newer active connection.
 * 5. Lossless, Strictly Idempotent D1 Persistence Queue:
 *    Maintains a durable FIFO queue of completed matches (`pendingMatchPersistences`)
 *    that survives rematches, DO restarts, closed rooms, and prolonged D1 outages with
 *    capped exponential retry — zero lost matches and zero double-counted stats.
 * 6. Streaming True UTF-8 Byte Limits & Server-Verified Session Resume (`/resume`).
 */

import {
  HokmRoomController,
  PersistedHokmRoomState,
  RoomActionOutcome,
} from '../../src/games/hokm/online/roomController';
import {
  DEFAULT_DISCONNECT_GRACE_MS,
  MAX_WS_PAYLOAD_BYTES,
  OnlineErrorCode,
  PROTOCOL_VERSION,
  RoomEventNotice,
  ServerMessage,
  isValidSeat,
  parseClientMessage,
  sanitizeAvatarCode,
  sanitizeRoomCode,
  sanitizeSeatAppearance,
  sanitizeUsername,
  SeatPublicAppearance,
} from '../../src/games/hokm/online/protocol';
import {
  CfWorkerEnv,
  DurableObjectStateLike,
  HibernatableWebSocket,
} from './lib/types';
import {
  DurableAlarmScheduler,
  ScheduledAlarmTask,
} from './lib/alarmScheduler';
import {
  createConnectionId,
  getAuthenticatedSockets,
  getEarliestUnauthenticatedExpiry,
  pruneUnauthenticatedSockets,
  readSocketAttachment,
  supersedeOlderPlayerSockets,
  writeSocketAttachment,
} from './lib/hibernationSockets';
import { persistCompletedMatchToD1 } from './lib/d1Persistence';
import { getPayloadUtf8Bytes, readBoundedUtf8Body } from './lib/httpBounds';
import { parseSessionCookieFromHeader } from './lib/sessionCookie';

export type { CfWorkerEnv };
export const INTERNAL_SESSION_TOKEN_HEADER = 'X-Eyvan-Internal-Session-Token';
export const INTERNAL_VERIFIED_APPEARANCE_HEADER = 'X-Eyvan-Verified-Appearance';

const ROOM_STATE_STORAGE_KEY = 'room:state';
const MAX_HTTP_BODY_BYTES = 16 * 1024;
const AUTH_HANDSHAKE_TIMEOUT_MS = 10_000;
const DEFAULT_ROOM_CLEANUP_TTL_MS = 5 * 60_000;
const RATE_WINDOW_MS = 2_000;
const RATE_MAX_MESSAGES = 45;
const D1_RETRY_BASE_MS = 5_000;
const D1_RETRY_MAX_MS = 15 * 60_000;

type HokmAlarmType =
  | 'trick_collect'
  | 'next_hand'
  | 'disconnect_sweep'
  | 'auth_prune'
  | 'd1_persist_retry'
  | 'room_cleanup';

interface RateWindow {
  windowStart: number;
  count: number;
}

export interface HokmRoomDORuntimeHooks {
  now?: () => number;
  rng?: () => number;
  trickCollectDelayMs?: number;
  nextHandDelayMs?: number;
}

export class HokmRoomDO {
  private readonly ctx: DurableObjectStateLike;
  private readonly env: CfWorkerEnv;
  private readonly alarms: DurableAlarmScheduler<HokmAlarmType>;
  private readonly nowFn: () => number;
  private readonly rngFn?: () => number;
  private readonly trickCollectDelayMsOverride?: number;
  private readonly nextHandDelayMsOverride?: number;

  private controller: HokmRoomController | null = null;
  private hydrated = false;
  /** Transient per-socket rate counters (lazily recreated after hibernation — never persisted) */
  private readonly rateLimits = new WeakMap<HibernatableWebSocket, RateWindow>();

  constructor(
    ctx: DurableObjectStateLike,
    env: CfWorkerEnv,
    hooks?: HokmRoomDORuntimeHooks
  ) {
    this.ctx = ctx;
    this.env = env;
    this.alarms = new DurableAlarmScheduler<HokmAlarmType>(ctx.storage);
    this.nowFn = hooks?.now ?? (() => Date.now());
    this.rngFn = hooks?.rng;
    this.trickCollectDelayMsOverride = hooks?.trickCollectDelayMs;
    this.nextHandDelayMsOverride = hooks?.nextHandDelayMs;

    void this.ctx.blockConcurrencyWhile(async () => {
      await this.hydrateFromStorage();
    });
  }

  private getGraceMs(): number {
    const parsed = Number(this.env.DISCONNECT_GRACE_MS);
    return Number.isFinite(parsed) && parsed >= 1_000
      ? parsed
      : DEFAULT_DISCONNECT_GRACE_MS;
  }

  private getCleanupTtlMs(): number {
    const parsed = Number(this.env.ROOM_CLEANUP_TTL_MS);
    return Number.isFinite(parsed) && parsed >= 1_000
      ? parsed
      : DEFAULT_ROOM_CLEANUP_TTL_MS;
  }

  private async hydrateFromStorage(): Promise<void> {
    if (this.hydrated) return;
    await this.alarms.hydrate();
    const saved = await this.ctx.storage.get<PersistedHokmRoomState>(
      ROOM_STATE_STORAGE_KEY
    );
    if (saved && saved.schemaVersion === 1) {
      this.controller = HokmRoomController.fromPersistedState(saved, {
        now: this.nowFn,
        rng: this.rngFn,
      });
    } else {
      this.controller = null;
    }
    this.hydrated = true;
  }

  private async ensureHydrated(): Promise<void> {
    if (!this.hydrated) {
      await this.hydrateFromStorage();
    }
  }

  private async persistControllerState(): Promise<void> {
    if (!this.controller) return;
    await this.ctx.storage.put(
      ROOM_STATE_STORAGE_KEY,
      this.controller.exportPersistedState()
    );
  }

  private async parseJsonBody(
    request: Request
  ): Promise<
    | { ok: true; data: Record<string, unknown> }
    | { ok: false; status: number; code: OnlineErrorCode; message: string }
  > {
    const bodyRead = await readBoundedUtf8Body(request, MAX_HTTP_BODY_BYTES);
    if (bodyRead.ok === false) {
      return {
        ok: false,
        status: bodyRead.status,
        code: 'INVALID_MESSAGE',
        message:
          bodyRead.status === 413
            ? 'حجم درخواست بیش از حد مجاز است.'
            : 'خطا در خواندن بدنه درخواست.',
      };
    }
    try {
      const parsed = JSON.parse(bodyRead.text) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
          ok: false,
          status: 400,
          code: 'INVALID_MESSAGE',
          message: 'بدنه درخواست JSON نامعتبر است.',
        };
      }
      return { ok: true, data: parsed as Record<string, unknown> };
    } catch {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_MESSAGE',
        message: 'فرمت JSON درخواست نامعتبر است.',
      };
    }
  }

  // -------------------------------------------------------------------------
  // HTTP & WebSocket Upgrade Entrypoint
  // -------------------------------------------------------------------------

  public async fetch(request: Request): Promise<Response> {
    await this.ensureHydrated();
    const url = new URL(request.url);
    const roomCode = sanitizeRoomCode(url.searchParams.get('code') ?? '');

    // 1) WebSocket Upgrade (Cookie-Authenticated BEFORE 101 + Official Hibernation API)
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      if (
        !this.controller ||
        !roomCode ||
        this.controller.roomCode !== roomCode ||
        this.controller.getStatus() === 'CLOSED'
      ) {
        return Response.json(
          { code: 'ROOM_NOT_FOUND', message: 'اتاق یافت نشد یا بسته شده است.' },
          { status: 404 }
        );
      }

      const parsedCookie = parseSessionCookieFromHeader(
        request.headers.get('Cookie')
      );
      if (!parsedCookie || parsedCookie.roomCode !== roomCode) {
        return Response.json(
          { code: 'UNAUTHORIZED', message: 'نشست معتبری برای اتصال یافت نشد.' },
          { status: 401 }
        );
      }

      const connectionId = createConnectionId();
      const auth = this.controller.authenticateConnection(
        parsedCookie.playerId,
        parsedCookie.sessionToken,
        connectionId
      );
      if (auth.ok === false) {
        return Response.json(
          { code: auth.code, message: auth.message },
          { status: auth.code === 'ROOM_CLOSED' ? 404 : 401 }
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

      const acceptedAt = this.nowFn();

      this.ctx.acceptWebSocket(server, [`room:${roomCode}`]);
      writeSocketAttachment(server, {
        connectionId,
        roomCode,
        playerId: auth.member.playerId,
        acceptedAt,
        authenticatedAt: acceptedAt,
      });

      supersedeOlderPlayerSockets(
        this.ctx,
        auth.member.playerId,
        connectionId,
        (oldWs) => {
          this.sendError(
            oldWs,
            'SUPERSEDED_CONNECTION',
            'اتصال جدیدی جایگزین این نشست شد.'
          );
        }
      );

      await this.persistControllerState();
      await this.syncDisconnectSweepAlarm();
      await this.syncAuthPruneAlarm();

      const snapshot = this.controller.getSnapshotForPlayer(
        auth.member.playerId
      );
      if (snapshot) {
        this.send(server, {
          protocolVersion: PROTOCOL_VERSION,
          type: 'auth_ok',
          snapshot,
        });
      }
      this.broadcastAll(auth.event, auth.member.playerId);

      return new Response(null, {
        status: 101,
        webSocket: client,
      } as ResponseInit & { webSocket: HibernatableWebSocket });
    }

    // 2) Public Room Summary (zero tokens, zero cards)
    if (request.method === 'GET' && url.pathname.endsWith('/summary')) {
      if (!this.controller || this.controller.getStatus() === 'CLOSED') {
        return Response.json(
          { code: 'ROOM_NOT_FOUND', message: 'اتاق یافت نشد.' },
          { status: 404 }
        );
      }
      return Response.json(this.controller.getPublicSummary());
    }

    // 3) Server-Verified Session Resume (called by Worker with HttpOnly cookie credentials)
    if (request.method === 'POST' && url.pathname.endsWith('/resume')) {
      if (
        !this.controller ||
        !roomCode ||
        this.controller.roomCode !== roomCode ||
        this.controller.getStatus() === 'CLOSED'
      ) {
        return Response.json(
          { code: 'ROOM_CLOSED', message: 'اتاق بسته شده یا یافت نشد.' },
          { status: 404 }
        );
      }

      const bodyRes = await this.parseJsonBody(request);
      if (bodyRes.ok === false) {
        return Response.json(
          { code: bodyRes.code, message: bodyRes.message },
          { status: bodyRes.status }
        );
      }

      const playerId =
        typeof bodyRes.data.playerId === 'string' ? bodyRes.data.playerId : '';
      const sessionToken =
        typeof bodyRes.data.sessionToken === 'string'
          ? bodyRes.data.sessionToken
          : '';

      const verified = this.controller.verifySessionForResume(
        playerId,
        sessionToken
      );
      if (verified.ok === false) {
        return Response.json(
          { code: verified.code, message: verified.message },
          { status: verified.code === 'ROOM_CLOSED' ? 404 : 401 }
        );
      }

      return Response.json({
        roomId: this.controller.roomId,
        roomCode: this.controller.roomCode,
        playerId: verified.member.playerId,
        canonicalSeat: verified.member.canonicalSeat,
        wsPath: `/ws/rooms/${this.controller.roomCode}`,
      });
    }

    // 4) Create Room (with collision guard against active non-closed rooms!)
    if (request.method === 'POST' && url.pathname.endsWith('/create')) {
      if (!roomCode) {
        return Response.json(
          { code: 'INVALID_MESSAGE', message: 'کد اتاق نامعتبر است.' },
          { status: 400 }
        );
      }

      if (this.controller && this.controller.getStatus() !== 'CLOSED') {
        return Response.json(
          {
            code: 'ROOM_EXISTS',
            message: 'این کد اتاق هم‌اکنون در حال استفاده است.',
          },
          { status: 409 }
        );
      }

      // Also guard against overwriting a CLOSED room that still has unpersisted D1 matches!
      if (this.controller && this.controller.hasPendingMatchPersistences()) {
        return Response.json(
          {
            code: 'ROOM_EXISTS',
            message: 'این کد اتاق در حال نهایی‌سازی ذخیره نتایج است.',
          },
          { status: 409 }
        );
      }

      const bodyRes = await this.parseJsonBody(request);
      if (bodyRes.ok === false) {
        return Response.json(
          { code: bodyRes.code, message: bodyRes.message },
          { status: bodyRes.status }
        );
      }

      const verifiedUserId =
        request.headers.get('X-Eyvan-Verified-User-Id')?.trim() || null;
      const verifiedUsername = verifiedUserId
        ? sanitizeUsername(request.headers.get('X-Eyvan-Verified-Username'))
        : null;
      const rawVerifiedAvatar = verifiedUserId
        ? request.headers.get('X-Eyvan-Verified-Avatar')
        : null;

      const username = verifiedUsername ?? sanitizeUsername(bodyRes.data.username);
      if (!username) {
        return Response.json(
          {
            code: 'INVALID_MESSAGE',
            message: 'نام کاربری نامعتبر است (۳ تا ۲۰ کاراکتر انگلیسی، عدد یا _).',
          },
          { status: 400 }
        );
      }

      const avatarCode = rawVerifiedAvatar
        ? sanitizeAvatarCode(rawVerifiedAvatar)
        : sanitizeAvatarCode(bodyRes.data.avatarCode);
      let verifiedAppearance: SeatPublicAppearance | undefined;
      const rawVerifiedAppearance = verifiedUserId
        ? request.headers.get(INTERNAL_VERIFIED_APPEARANCE_HEADER)
        : null;
      if (rawVerifiedAppearance) {
        try {
          verifiedAppearance = sanitizeSeatAppearance(
            JSON.parse(rawVerifiedAppearance)
          );
        } catch {
          verifiedAppearance = undefined;
        }
      }
      const appearance =
        verifiedAppearance ?? sanitizeSeatAppearance(bodyRes.data.appearance);
      const rawTarget = bodyRes.data.targetMatchScore;
      const targetMatchScore =
        typeof rawTarget === 'number' &&
        Number.isInteger(rawTarget) &&
        rawTarget >= 1 &&
        rawTarget <= 7
          ? rawTarget
          : 3;

      await this.alarms.cancelByDedupeKey('room:cleanup');

      const ctrl = new HokmRoomController({
        roomId: `do_${roomCode}_${this.nowFn()}`,
        roomCode,
        targetMatchScore,
        disconnectGraceMs: this.getGraceMs(),
        trickCollectDelayMs: this.trickCollectDelayMsOverride,
        nextHandDelayMs: this.nextHandDelayMsOverride,
        now: this.nowFn,
        rng: this.rngFn,
      });

      const joined = ctrl.joinPlayer({
        username,
        userId: verifiedUserId,
        avatarCode,
        appearance,
        preferredSeat: 'south',
      });
      if (joined.ok === false) {
        return Response.json(
          { code: joined.code, message: joined.message },
          { status: 400 }
        );
      }

      this.controller = ctrl;
      await this.persistControllerState();
      await this.syncDisconnectSweepAlarm();

      return Response.json(
        {
          roomId: ctrl.roomId,
          roomCode: ctrl.roomCode,
          playerId: joined.member.playerId,
          canonicalSeat: joined.member.canonicalSeat,
          wsPath: `/ws/rooms/${ctrl.roomCode}`,
        },
        {
          status: 201,
          headers: {
            [INTERNAL_SESSION_TOKEN_HEADER]: joined.member.sessionToken,
          },
        }
      );
    }

    // 5) Join Existing Room
    if (request.method === 'POST' && url.pathname.endsWith('/join')) {
      if (!this.controller || this.controller.getStatus() === 'CLOSED') {
        return Response.json(
          { code: 'ROOM_NOT_FOUND', message: 'اتاقی با این کد یافت نشد.' },
          { status: 404 }
        );
      }

      const bodyRes = await this.parseJsonBody(request);
      if (bodyRes.ok === false) {
        return Response.json(
          { code: bodyRes.code, message: bodyRes.message },
          { status: bodyRes.status }
        );
      }

      const verifiedUserId =
        request.headers.get('X-Eyvan-Verified-User-Id')?.trim() || null;
      const verifiedUsername = verifiedUserId
        ? sanitizeUsername(request.headers.get('X-Eyvan-Verified-Username'))
        : null;
      const rawVerifiedAvatar = verifiedUserId
        ? request.headers.get('X-Eyvan-Verified-Avatar')
        : null;

      const username = verifiedUsername ?? sanitizeUsername(bodyRes.data.username);
      if (!username) {
        return Response.json(
          {
            code: 'INVALID_MESSAGE',
            message: 'نام کاربری نامعتبر است (۳ تا ۲۰ کاراکتر انگلیسی، عدد یا _).',
          },
          { status: 400 }
        );
      }

      const avatarCode = rawVerifiedAvatar
        ? sanitizeAvatarCode(rawVerifiedAvatar)
        : sanitizeAvatarCode(bodyRes.data.avatarCode);
      let verifiedAppearance: SeatPublicAppearance | undefined;
      const rawVerifiedAppearance = verifiedUserId
        ? request.headers.get(INTERNAL_VERIFIED_APPEARANCE_HEADER)
        : null;
      if (rawVerifiedAppearance) {
        try {
          verifiedAppearance = sanitizeSeatAppearance(
            JSON.parse(rawVerifiedAppearance)
          );
        } catch {
          verifiedAppearance = undefined;
        }
      }
      const appearance =
        verifiedAppearance ?? sanitizeSeatAppearance(bodyRes.data.appearance);
      const preferredSeat = isValidSeat(bodyRes.data.preferredSeat)
        ? bodyRes.data.preferredSeat
        : undefined;

      const joined = this.controller.joinPlayer({
        username,
        userId: verifiedUserId,
        avatarCode,
        appearance,
        preferredSeat,
      });
      if (joined.ok === false) {
        const status =
          joined.code === 'ROOM_FULL' ||
          joined.code === 'SEAT_TAKEN' ||
          joined.code === 'DUPLICATE_PLAYER'
            ? 409
            : joined.code === 'ROOM_CLOSED'
              ? 410
              : 400;
        return Response.json(
          { code: joined.code, message: joined.message },
          { status }
        );
      }

      await this.persistControllerState();
      await this.syncDisconnectSweepAlarm();
      this.broadcastAll({
        type: 'PLAYER_JOINED',
        actorSeat: joined.member.canonicalSeat,
        detail: joined.member.username,
      });

      return Response.json(
        {
          roomId: this.controller.roomId,
          roomCode: this.controller.roomCode,
          playerId: joined.member.playerId,
          canonicalSeat: joined.member.canonicalSeat,
          wsPath: `/ws/rooms/${this.controller.roomCode}`,
        },
        {
          status: 200,
          headers: {
            [INTERNAL_SESSION_TOKEN_HEADER]: joined.member.sessionToken,
          },
        }
      );
    }

    return new Response('Not Found', { status: 404 });
  }

  // -------------------------------------------------------------------------
  // Official Cloudflare WebSocket Hibernation Handlers
  // -------------------------------------------------------------------------

  public async webSocketMessage(
    ws: HibernatableWebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
    await this.ensureHydrated();

    // Per-socket transient rate limit (lazily initialized on wake-up)
    const now = this.nowFn();
    let rate = this.rateLimits.get(ws);
    if (!rate || now - rate.windowStart > RATE_WINDOW_MS) {
      rate = { windowStart: now, count: 0 };
      this.rateLimits.set(ws, rate);
    }
    rate.count += 1;
    if (rate.count > RATE_MAX_MESSAGES) {
      this.sendError(ws, 'RATE_LIMITED', 'تعداد درخواست‌ها بیش از حد مجاز است.');
      return;
    }

    // True UTF-8 byte-size bound checked BEFORE parsing JSON!
    if (getPayloadUtf8Bytes(message) > MAX_WS_PAYLOAD_BYTES) {
      this.sendError(ws, 'INVALID_MESSAGE', 'حجم پیام بیش از حد مجاز است.');
      return;
    }

    if (typeof message !== 'string') {
      this.sendError(ws, 'INVALID_MESSAGE', 'فقط پیام‌های متنی JSON مجاز هستند.');
      return;
    }

    const parsed = parseClientMessage(message);
    if (parsed.ok === false) {
      this.sendError(ws, parsed.code, parsed.reason);
      return;
    }

    const msg = parsed.message;

    // Heartbeat always allowed
    if (msg.type === 'ping') {
      this.send(ws, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'pong',
        clientTime: msg.clientTime,
        serverTime: this.nowFn(),
      });
      return;
    }

    const ctrl = this.controller;
    if (!ctrl || ctrl.getStatus() === 'CLOSED') {
      this.sendError(ws, 'ROOM_CLOSED', 'اتاق بسته شده یا یافت نشد.');
      this.safeClose(ws, 4004, 'room_closed');
      return;
    }

    const att = readSocketAttachment(ws);
    if (!att) {
      this.sendError(ws, 'UNAUTHORIZED', 'اطلاعات نشست سوکت نامعتبر است.');
      this.safeClose(ws, 4003, 'invalid_attachment');
      return;
    }

    // All messages after upgrade require a cookie-authenticated, currently-active connectionId
    if (!att.playerId) {
      this.sendError(ws, 'UNAUTHORIZED', 'اتصال احراز هویت نشده است.');
      this.safeClose(ws, 4003, 'unauthorized');
      return;
    }

    if (!ctrl.isActiveConnection(att.playerId, att.connectionId)) {
      this.sendError(
        ws,
        'SUPERSEDED_CONNECTION',
        'اتصال جدیدی جایگزین این نشست شده است.'
      );
      this.safeClose(ws, 4001, 'superseded');
      return;
    }

    if (msg.type === 'request_sync') {
      const snapshot = ctrl.getSnapshotForPlayer(att.playerId);
      if (snapshot) {
        this.send(ws, {
          protocolVersion: PROTOCOL_VERSION,
          type: 'state_sync',
          snapshot,
        });
      }
      return;
    }

    // Authoritative gameplay / lobby actions (all carry client actionId for idempotency)
    let outcome: RoomActionOutcome;
    switch (msg.type) {
      case 'set_ready':
        outcome = ctrl.setReady(att.playerId, msg.ready, msg.actionId);
        break;
      case 'select_seat':
        outcome = ctrl.selectSeat(att.playerId, msg.canonicalSeat, msg.actionId);
        break;
      case 'start_match':
        outcome = ctrl.startMatch(att.playerId, msg.actionId);
        break;
      case 'choose_trump':
        outcome = ctrl.chooseTrump(att.playerId, msg.suit, msg.actionId);
        break;
      case 'play_card':
        outcome = ctrl.playCardMove(att.playerId, msg.cardId, msg.actionId);
        break;
      case 'leave_room':
        outcome = ctrl.leaveRoom(att.playerId, msg.actionId);
        break;
      case 'rematch':
        outcome = ctrl.startRematch(att.playerId, msg.actionId);
        break;
    }

    if (!outcome.ok) {
      this.sendError(
        ws,
        outcome.errorCode ?? 'ACTION_REJECTED',
        outcome.errorMessage ?? 'حرکت نامعتبر است.',
        msg.actionId
      );
      return;
    }

    if (msg.type === 'leave_room' && !outcome.duplicate) {
      writeSocketAttachment(ws, { ...att, playerId: null });
    }

    await this.persistControllerState();

    this.send(ws, {
      protocolVersion: PROTOCOL_VERSION,
      type: 'action_ack',
      actionId: msg.actionId,
      duplicate: outcome.duplicate,
    });

    await this.applyOutcomeSideEffects(outcome);

    if (msg.type === 'leave_room' && !outcome.duplicate) {
      this.safeClose(ws, 1000, 'left_room');
    }
  }

  public async webSocketClose(
    ws: HibernatableWebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean
  ): Promise<void> {
    await this.handleSocketClosed(ws);
  }

  public async webSocketError(
    ws: HibernatableWebSocket,
    _error: unknown
  ): Promise<void> {
    await this.handleSocketClosed(ws);
  }

  private async handleSocketClosed(ws: HibernatableWebSocket): Promise<void> {
    await this.ensureHydrated();
    const att = readSocketAttachment(ws);

    if (!att || !att.playerId || !this.controller) {
      await this.syncAuthPruneAlarm();
      return;
    }

    try {
      writeSocketAttachment(ws, { ...att, playerId: null });
    } catch {
      // Ignore if socket already disposed
    }

    const outcome = this.controller.markPlayerDisconnected(
      att.playerId,
      att.connectionId
    );
    if (outcome.shouldBroadcast) {
      await this.persistControllerState();
      await this.syncDisconnectSweepAlarm();
      this.broadcastAll(outcome.event);
    }
  }

  // -------------------------------------------------------------------------
  // Durable Alarm Handler (Peek -> Execute -> Acknowledge/Retry)
  // -------------------------------------------------------------------------

  public async alarm(): Promise<void> {
    await this.ensureHydrated();
    const now = this.nowFn();
    const dueTasks = await this.alarms.peekDueTasks(now);

    for (const task of dueTasks) {
      try {
        await this.executeAlarmTask(task);
        await this.alarms.completeTask(task.id);
      } catch (err) {
        console.error(
          `[HokmRoomDO] Alarm task "${task.type}" (${task.id}) failed; rescheduling with backoff:`,
          err
        );
        await this.alarms.rescheduleFailedTask(task.id, this.nowFn(), {
          baseDelayMs: 2_000,
          maxDelayMs: D1_RETRY_MAX_MS,
          maxAttempts: task.type === 'd1_persist_retry' ? undefined : 8,
        });
      }
    }
  }

  private async executeAlarmTask(
    task: ScheduledAlarmTask<HokmAlarmType>
  ): Promise<void> {
    if (task.type === 'auth_prune') {
      const { nextExpiryAt } = pruneUnauthenticatedSockets(
        this.ctx,
        this.nowFn(),
        AUTH_HANDSHAKE_TIMEOUT_MS,
        (staleWs) => {
          this.sendError(
            staleWs,
            'UNAUTHORIZED',
            'مهلت احراز هویت به پایان رسید.'
          );
        }
      );
      if (nextExpiryAt !== null) {
        await this.alarms.schedule({
          type: 'auth_prune',
          dedupeKey: 'sys:auth_prune',
          dueAt: Math.max(this.nowFn() + 50, nextExpiryAt + 50),
        });
      }
      return;
    }

    if (!this.controller) {
      return;
    }

    switch (task.type) {
      case 'trick_collect': {
        const gs = this.controller.getAuthoritativeGameState();
        if (
          this.controller.getStatus() !== 'PLAYING' ||
          !gs ||
          gs.phase !== 'TRICK_COMPLETE'
        ) {
          return;
        }
        if (
          task.metadata?.handNumber !== undefined &&
          gs.handNumber !== task.metadata.handNumber
        ) {
          return;
        }
        if (
          task.metadata?.completedTricksCount !== undefined &&
          gs.completedTricksCount !== task.metadata.completedTricksCount
        ) {
          return;
        }

        const outcome = this.controller.resolveCompletedTrick();
        if (outcome.ok && outcome.shouldBroadcast) {
          await this.persistControllerState();
          await this.applyOutcomeSideEffects(outcome);
        }
        break;
      }

      case 'next_hand': {
        const gs = this.controller.getAuthoritativeGameState();
        if (
          this.controller.getStatus() !== 'PLAYING' ||
          !gs ||
          gs.phase !== 'HAND_COMPLETE'
        ) {
          return;
        }
        if (
          task.metadata?.handNumber !== undefined &&
          gs.handNumber !== task.metadata.handNumber
        ) {
          return;
        }

        const outcome = this.controller.advanceToNextHand();
        if (outcome.ok && outcome.shouldBroadcast) {
          await this.persistControllerState();
          await this.applyOutcomeSideEffects(outcome);
        }
        break;
      }

      case 'disconnect_sweep': {
        const outcome = this.controller.sweepExpiredDisconnects();
        if (outcome.shouldBroadcast || outcome.event?.type === 'ROOM_CLOSED') {
          await this.persistControllerState();
          await this.applyOutcomeSideEffects(outcome);
        }
        await this.syncDisconnectSweepAlarm();
        break;
      }

      case 'd1_persist_retry': {
        if (!this.controller.hasPendingMatchPersistences()) return;
        const attempt = Number(task.metadata?.attempt ?? 1);
        await this.flushPendingMatchesToD1(attempt);
        break;
      }

      case 'room_cleanup': {
        if (this.controller.getStatus() !== 'CLOSED') return;

        // If any completed match is still awaiting D1 commit, attempt flush NOW
        // and NEVER delete `room:state` until all pending matches are committed!
        if (this.controller.hasPendingMatchPersistences()) {
          await this.flushPendingMatchesToD1(1);
          if (this.controller.hasPendingMatchPersistences()) {
            return;
          }
        }

        for (const ws of this.ctx.getWebSockets()) {
          this.safeClose(ws, 1000, 'room_expired');
        }
        this.controller = null;
        await this.alarms.cancelAll();
        await this.ctx.storage.delete(ROOM_STATE_STORAGE_KEY);
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Outcome Side Effects, Alarm Sync, & Lossless D1 Persistence Queue
  // -------------------------------------------------------------------------

  private async applyOutcomeSideEffects(
    outcome: RoomActionOutcome
  ): Promise<void> {
    if (!this.controller) return;

    if (outcome.shouldBroadcast) {
      this.broadcastAll(outcome.event);
    }

    const gs = this.controller.getAuthoritativeGameState();
    const now = this.nowFn();

    if (outcome.scheduleTrickCollectMs !== undefined && gs) {
      await this.alarms.schedule({
        type: 'trick_collect',
        dedupeKey: 'game:trick_collect',
        dueAt: now + outcome.scheduleTrickCollectMs,
        expectedVersion: this.controller.getStateVersion(),
        metadata: {
          handNumber: gs.handNumber,
          completedTricksCount: gs.completedTricksCount,
        },
      });
    }

    if (outcome.scheduleNextHandMs !== undefined && gs) {
      await this.alarms.schedule({
        type: 'next_hand',
        dedupeKey: 'game:next_hand',
        dueAt: now + outcome.scheduleNextHandMs,
        expectedVersion: this.controller.getStateVersion(),
        metadata: {
          handNumber: gs.handNumber,
        },
      });
    }

    if (outcome.completedMatch || this.controller.hasPendingMatchPersistences()) {
      await this.flushPendingMatchesToD1(1);
    }

    if (this.controller.getStatus() === 'CLOSED') {
      await this.alarms.cancelByDedupeKey('game:trick_collect');
      await this.alarms.cancelByDedupeKey('game:next_hand');
      await this.alarms.cancelByDedupeKey('room:disconnect_sweep');
      await this.alarms.schedule({
        type: 'room_cleanup',
        dedupeKey: 'room:cleanup',
        dueAt: now + this.getCleanupTtlMs(),
      });
    } else {
      await this.syncDisconnectSweepAlarm();
    }
  }

  private async syncAuthPruneAlarm(): Promise<void> {
    const earliestExpiry = getEarliestUnauthenticatedExpiry(
      this.ctx,
      AUTH_HANDSHAKE_TIMEOUT_MS
    );
    if (earliestExpiry === null) {
      await this.alarms.cancelByDedupeKey('sys:auth_prune');
      return;
    }

    const targetDueAt = Math.max(this.nowFn() + 50, earliestExpiry + 50);
    const existing = this.alarms
      .getPendingTasks()
      .find((t) => t.dedupeKey === 'sys:auth_prune');

    // Only update if no alarm exists OR the newly computed earliest deadline is strictly earlier
    if (!existing || targetDueAt < existing.dueAt) {
      await this.alarms.schedule({
        type: 'auth_prune',
        dedupeKey: 'sys:auth_prune',
        dueAt: targetDueAt,
      });
    }
  }

  private async syncDisconnectSweepAlarm(): Promise<void> {
    if (!this.controller || this.controller.getStatus() === 'CLOSED') {
      await this.alarms.cancelByDedupeKey('room:disconnect_sweep');
      return;
    }

    const earliest = this.controller.getEarliestDisconnectDeadline();
    if (earliest === null) {
      await this.alarms.cancelByDedupeKey('room:disconnect_sweep');
      return;
    }

    await this.alarms.schedule({
      type: 'disconnect_sweep',
      dedupeKey: 'room:disconnect_sweep',
      dueAt: Math.max(this.nowFn() + 50, earliest + 100),
    });
  }

  /**
   * Drains the durable FIFO `pendingMatchPersistences` queue to Cloudflare D1.
   *
   * - Strictly idempotent: `persistCompletedMatchToD1` checks `match_id` before updating stats.
   * - Survives rematches, DO cold restarts, room closures, and prolonged D1 outages:
   *   never drops a completed match after 5 retries — uses capped exponential backoff
   *   (5s -> 15s -> 45s -> 2m -> 5m -> 15m cap) until D1 confirms commit.
   * - If the room is already CLOSED once the queue drains, automatically schedules `room_cleanup`.
   */
  private async flushPendingMatchesToD1(attempt: number): Promise<void> {
    if (!this.controller) return;
    if (!this.env.EYVAN_DB) return;

    const queue = [...this.controller.getPendingMatchPersistences()];
    if (queue.length === 0) return;

    for (const record of queue) {
      try {
        await persistCompletedMatchToD1(this.env.EYVAN_DB, record);
        this.controller.markMatchPersisted(record.matchId);
        await this.persistControllerState();
      } catch (err) {
        const cappedExp = Math.min(6, Math.max(0, attempt - 1));
        const backoffMs = Math.min(
          D1_RETRY_MAX_MS,
          D1_RETRY_BASE_MS * Math.pow(3, cappedExp)
        );
        console.error(
          `[HokmRoomDO] D1 match persistence failed for ${record.matchId} (attempt ${attempt}; next retry in ${backoffMs}ms):`,
          err
        );
        await this.alarms.schedule({
          type: 'd1_persist_retry',
          dedupeKey: 'd1:persist_retry',
          dueAt: this.nowFn() + backoffMs,
          metadata: { attempt: attempt + 1, matchId: record.matchId },
        });
        return;
      }
    }

    // All queued matches committed cleanly!
    await this.alarms.cancelByDedupeKey('d1:persist_retry');

    if (this.controller.getStatus() === 'CLOSED') {
      await this.alarms.schedule({
        type: 'room_cleanup',
        dedupeKey: 'room:cleanup',
        dueAt: this.nowFn() + 1_000,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Socket Messaging Helpers (Reconstructed Live from Hibernation API)
  // -------------------------------------------------------------------------

  private send(ws: HibernatableWebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket closed mid-send
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
      // Already closed
    }
  }

  private sendError(
    ws: HibernatableWebSocket,
    code: OnlineErrorCode,
    message: string,
    actionId?: string
  ): void {
    this.send(ws, {
      protocolVersion: PROTOCOL_VERSION,
      type: 'error',
      code,
      message,
      actionId,
    });
  }

  private broadcastAll(event?: RoomEventNotice, skipPlayerId?: string): void {
    if (!this.controller) return;
    const sockets = getAuthenticatedSockets(this.ctx);
    for (const { ws, playerId, connectionId } of sockets) {
      if (skipPlayerId && playerId === skipPlayerId) continue;
      if (!this.controller.isActiveConnection(playerId, connectionId)) continue;
      const snapshot = this.controller.getSnapshotForPlayer(playerId);
      if (snapshot) {
        this.send(ws, {
          protocolVersion: PROTOCOL_VERSION,
          type: 'state_sync',
          snapshot,
          event,
        });
      }
    }
  }
}
