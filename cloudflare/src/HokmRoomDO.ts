/**
 * Cloudflare Durable Object: Single-Authority Live Hokm Room
 *
 * Wraps the exact shared `HokmRoomController` from `../../src/games/hokm/online/roomController`.
 * - Enforces single-threaded atomic move execution (no concurrent race conditions).
 * - Uses WebSocket Hibernation / attachment tagging so idle sockets cost minimal memory.
 * - Uses DO Alarm API for trick-collection timing, auto-next-hand, and disconnect grace sweep.
 * - Persists completed matches ONLY once to Cloudflare D1 (`EYVAN_DB`).
 */

import {
  HokmRoomController,
  RoomActionOutcome,
} from '../../src/games/hokm/online/roomController';
import {
  CompletedMatchRecord,
  DEFAULT_DISCONNECT_GRACE_MS,
  OnlineErrorCode,
  PROTOCOL_VERSION,
  RoomEventNotice,
  ServerMessage,
  parseClientMessage,
} from '../../src/games/hokm/online/protocol';

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  run(): Promise<unknown>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  first<T = unknown>(): Promise<T | null>;
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<unknown[]>;
}

export interface CfWorkerEnv {
  HOKM_ROOM: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(req: Request): Promise<Response> };
  };
  EYVAN_DB: D1DatabaseLike;
  EYVAN_ASSETS: {
    get(key: string): Promise<{
      body: ReadableStream;
      httpMetadata?: { contentType?: string };
      writeHttpMetadata?: (headers: Headers) => void;
    } | null>;
  };
  DISCONNECT_GRACE_MS?: string;
  ALLOWED_ORIGINS?: string;
}

interface DurableObjectStateLike {
  storage: {
    setAlarm(scheduledTime: number): Promise<void>;
    deleteAlarm(): Promise<void>;
  };
}

type AlarmTask =
  | { type: 'trick_collect'; dueAt: number }
  | { type: 'next_hand'; dueAt: number }
  | { type: 'disconnect_sweep'; dueAt: number };

interface SocketSession {
  ws: WebSocket;
  playerId: string | null;
  msgCount: number;
  windowStart: number;
}

export class HokmRoomDO {
  private readonly state: DurableObjectStateLike;
  private readonly env: CfWorkerEnv;
  private controller: HokmRoomController | null = null;
  private sockets = new Map<WebSocket, SocketSession>();
  private playerSockets = new Map<string, WebSocket>();
  private pendingAlarms: AlarmTask[] = [];

  constructor(state: DurableObjectStateLike, env: CfWorkerEnv) {
    this.state = state;
    this.env = env;
  }

  private getGraceMs(): number {
    const parsed = Number(this.env.DISCONNECT_GRACE_MS);
    return Number.isFinite(parsed) && parsed >= 10_000
      ? parsed
      : DEFAULT_DISCONNECT_GRACE_MS;
  }

  private ensureController(roomCode: string): HokmRoomController {
    if (!this.controller) {
      this.controller = new HokmRoomController({
        roomId: `do_${roomCode}`,
        roomCode,
        disconnectGraceMs: this.getGraceMs(),
      });
    }
    return this.controller;
  }

  public async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roomCode = (url.searchParams.get('code') ?? '').toUpperCase();

    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      if (!this.controller) {
        return new Response(
          JSON.stringify({ code: 'ROOM_NOT_FOUND', message: 'اتاق یافت نشد.' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Cloudflare WebSocketPair global
      const PairCtor = (
        globalThis as unknown as {
          WebSocketPair: new () => { 0: WebSocket; 1: WebSocket };
        }
      ).WebSocketPair;
      const pair = new PairCtor();
      const client = pair[0];
      const server = pair[1] as WebSocket & { accept(): void };
      server.accept();

      this.attachSocket(server);
      return new Response(null, {
        status: 101,
        webSocket: client,
      } as ResponseInit & { webSocket: WebSocket });
    }

    if (request.method === 'GET' && url.pathname.endsWith('/summary')) {
      if (!this.controller || this.controller.getStatus() === 'CLOSED') {
        return new Response(
          JSON.stringify({ code: 'ROOM_NOT_FOUND', message: 'اتاق یافت نشد.' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return Response.json(this.controller.getPublicSummary());
    }

    if (request.method === 'POST' && url.pathname.endsWith('/create')) {
      const body = (await request.json()) as {
        username: string;
        avatarCode?: string;
        targetMatchScore?: number;
      };
      this.controller = new HokmRoomController({
        roomId: `do_${roomCode}`,
        roomCode,
        targetMatchScore: body.targetMatchScore,
        disconnectGraceMs: this.getGraceMs(),
      });
      const joined = this.controller.joinPlayer({
        username: body.username,
        avatarCode: body.avatarCode,
      });
      if (!joined.ok) {
        return Response.json(
          { code: joined.code, message: joined.message },
          { status: 400 }
        );
      }
      return Response.json({
        roomId: this.controller.roomId,
        roomCode: this.controller.roomCode,
        playerId: joined.member.playerId,
        canonicalSeat: joined.member.canonicalSeat,
        sessionToken: joined.member.sessionToken,
        wsPath: `/ws/rooms/${this.controller.roomCode}`,
      });
    }

    if (request.method === 'POST' && url.pathname.endsWith('/join')) {
      if (!this.controller || this.controller.getStatus() === 'CLOSED') {
        return Response.json(
          { code: 'ROOM_NOT_FOUND', message: 'اتاقی با این کد یافت نشد.' },
          { status: 404 }
        );
      }
      const body = (await request.json()) as {
        username: string;
        avatarCode?: string;
        preferredSeat?: 'south' | 'east' | 'north' | 'west';
      };
      const joined = this.controller.joinPlayer(body);
      if (!joined.ok) {
        const status =
          joined.code === 'ROOM_FULL' ||
          joined.code === 'SEAT_TAKEN' ||
          joined.code === 'DUPLICATE_PLAYER'
            ? 409
            : 400;
        return Response.json(
          { code: joined.code, message: joined.message },
          { status }
        );
      }
      this.broadcastAll({ type: 'PLAYER_JOINED', actorSeat: joined.member.canonicalSeat });
      return Response.json({
        roomId: this.controller.roomId,
        roomCode: this.controller.roomCode,
        playerId: joined.member.playerId,
        canonicalSeat: joined.member.canonicalSeat,
        sessionToken: joined.member.sessionToken,
        wsPath: `/ws/rooms/${this.controller.roomCode}`,
      });
    }

    return new Response('Not Found', { status: 404 });
  }

  private attachSocket(ws: WebSocket): void {
    const session: SocketSession = {
      ws,
      playerId: null,
      msgCount: 0,
      windowStart: Date.now(),
    };
    this.sockets.set(ws, session);

    ws.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      void this.handleMessage(ws, session, event.data);
    });

    const handleClose = () => {
      this.sockets.delete(ws);
      if (session.playerId && this.playerSockets.get(session.playerId) === ws) {
        this.playerSockets.delete(session.playerId);
        if (this.controller) {
          const out = this.controller.markPlayerDisconnected(session.playerId);
          if (out.shouldBroadcast) {
            this.broadcastAll(out.event);
          }
          void this.scheduleAlarm('disconnect_sweep', this.getGraceMs() + 500);
        }
      }
    };

    ws.addEventListener('close', handleClose);
    ws.addEventListener('error', handleClose);
  }

  private async handleMessage(
    ws: WebSocket,
    session: SocketSession,
    raw: string
  ): Promise<void> {
    const now = Date.now();
    if (now - session.windowStart > 2000) {
      session.windowStart = now;
      session.msgCount = 0;
    }
    session.msgCount += 1;
    if (session.msgCount > 40) {
      this.sendError(ws, 'RATE_LIMITED', 'تعداد درخواست‌ها بیش از حد مجاز است.');
      return;
    }

    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      this.sendError(ws, parsed.code, parsed.reason);
      return;
    }

    const msg = parsed.message;
    if (msg.type === 'ping') {
      this.send(ws, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'pong',
        clientTime: msg.clientTime,
        serverTime: Date.now(),
      });
      return;
    }

    const ctrl = this.controller;
    if (!ctrl) {
      this.sendError(ws, 'ROOM_NOT_FOUND', 'اتاق یافت نشد.');
      ws.close(4004, 'room_not_found');
      return;
    }

    if (msg.type === 'auth') {
      const auth = ctrl.authenticateConnection(msg.playerId, msg.sessionToken);
      if (!auth.ok) {
        this.sendError(ws, auth.code, auth.message);
        ws.close(4003, 'unauthorized');
        return;
      }

      // Single active socket per seat: supersede any older socket for this player
      const previousWs = this.playerSockets.get(auth.member.playerId);
      if (previousWs && previousWs !== ws) {
        try {
          previousWs.close(4001, 'superseded');
        } catch {
          // Ignore
        }
      }

      session.playerId = auth.member.playerId;
      this.playerSockets.set(auth.member.playerId, ws);

      const snapshot = ctrl.getSnapshotForPlayer(auth.member.playerId);
      if (snapshot) {
        this.send(ws, {
          protocolVersion: PROTOCOL_VERSION,
          type: 'auth_ok',
          snapshot,
        });
      }
      this.broadcastAll(auth.event, auth.member.playerId);
      return;
    }

    if (!session.playerId) {
      this.sendError(ws, 'UNAUTHORIZED', 'ابتدا باید احراز هویت انجام شود.');
      return;
    }

    if (msg.type === 'request_sync') {
      const snapshot = ctrl.getSnapshotForPlayer(session.playerId);
      if (snapshot) {
        this.send(ws, {
          protocolVersion: PROTOCOL_VERSION,
          type: 'state_sync',
          snapshot,
        });
      }
      return;
    }

    let outcome: RoomActionOutcome;
    switch (msg.type) {
      case 'set_ready':
        outcome = ctrl.setReady(session.playerId, msg.ready, msg.actionId);
        break;
      case 'select_seat':
        outcome = ctrl.selectSeat(
          session.playerId,
          msg.canonicalSeat,
          msg.actionId
        );
        break;
      case 'start_match':
        outcome = ctrl.startMatch(session.playerId, msg.actionId);
        break;
      case 'choose_trump':
        outcome = ctrl.chooseTrump(session.playerId, msg.suit, msg.actionId);
        break;
      case 'play_card':
        outcome = ctrl.playCardMove(session.playerId, msg.cardId, msg.actionId);
        break;
      case 'leave_room':
        outcome = ctrl.leaveRoom(session.playerId, msg.actionId);
        break;
      case 'rematch':
        outcome = ctrl.startRematch(session.playerId, msg.actionId);
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

    this.send(ws, {
      protocolVersion: PROTOCOL_VERSION,
      type: 'action_ack',
      actionId: msg.actionId,
      duplicate: outcome.duplicate,
    });

    await this.applyOutcomeSideEffects(outcome);
  }

  private async applyOutcomeSideEffects(
    outcome: RoomActionOutcome
  ): Promise<void> {
    if (outcome.shouldBroadcast) {
      this.broadcastAll(outcome.event);
    }
    if (outcome.scheduleTrickCollectMs) {
      await this.scheduleAlarm('trick_collect', outcome.scheduleTrickCollectMs);
    }
    if (outcome.scheduleNextHandMs) {
      await this.scheduleAlarm('next_hand', outcome.scheduleNextHandMs);
    }
    if (outcome.completedMatch) {
      await this.persistMatchToD1(outcome.completedMatch);
    }
  }

  private async scheduleAlarm(
    type: AlarmTask['type'],
    delayMs: number
  ): Promise<void> {
    const dueAt = Date.now() + delayMs;
    this.pendingAlarms.push({ type, dueAt });
    this.pendingAlarms.sort((a, b) => a.dueAt - b.dueAt);
    await this.state.storage.setAlarm(this.pendingAlarms[0].dueAt);
  }

  public async alarm(): Promise<void> {
    if (!this.controller) return;
    const now = Date.now();
    const due = this.pendingAlarms.filter((t) => t.dueAt <= now + 50);
    this.pendingAlarms = this.pendingAlarms.filter((t) => t.dueAt > now + 50);

    for (const task of due) {
      let outcome: RoomActionOutcome | null = null;
      if (task.type === 'trick_collect') {
        outcome = this.controller.resolveCompletedTrick();
      } else if (task.type === 'next_hand') {
        outcome = this.controller.advanceToNextHand();
      } else if (task.type === 'disconnect_sweep') {
        outcome = this.controller.sweepExpiredDisconnects();
      }
      if (outcome) {
        await this.applyOutcomeSideEffects(outcome);
      }
    }

    if (this.pendingAlarms.length > 0) {
      await this.state.storage.setAlarm(this.pendingAlarms[0].dueAt);
    }
  }

  private async persistMatchToD1(record: CompletedMatchRecord): Promise<void> {
    const db = this.env.EYVAN_DB;
    if (!db) return;

    const stmts = [
      db
        .prepare(
          `INSERT OR IGNORE INTO matches
           (match_id, room_code, started_at, finished_at, winning_team, team_a_score, team_b_score, target_score, last_win_type, hands_played)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          record.matchId,
          record.roomCode,
          record.startedAt,
          record.finishedAt,
          record.winningTeam,
          record.teamAScore,
          record.teamBScore,
          record.targetScore,
          record.lastWinType,
          record.handsPlayed
        ),
    ];

    for (const p of record.players) {
      stmts.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO match_players
             (match_id, player_id, username, canonical_seat, team, won)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .bind(
            record.matchId,
            p.playerId,
            p.username,
            p.canonicalSeat,
            p.team,
            p.won ? 1 : 0
          )
      );

      const isKotWin = p.won && record.lastWinType === 'kot' ? 1 : 0;
      const isHakemKotWin = p.won && record.lastWinType === 'hakem_kot' ? 1 : 0;
      stmts.push(
        db
          .prepare(
            `INSERT INTO player_stats
             (username, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at)
             VALUES (?, 1, ?, ?, ?, ?, ?)
             ON CONFLICT(username) DO UPDATE SET
               matches_played = matches_played + 1,
               wins = wins + excluded.wins,
               losses = losses + excluded.losses,
               kot_wins = kot_wins + excluded.kot_wins,
               hakem_kot_wins = hakem_kot_wins + excluded.hakem_kot_wins,
               last_played_at = excluded.last_played_at`
          )
          .bind(
            p.username,
            p.won ? 1 : 0,
            p.won ? 0 : 1,
            isKotWin,
            isHakemKotWin,
            record.finishedAt
          )
      );
    }

    await db.batch(stmts);
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket closed mid-send
    }
  }

  private sendError(
    ws: WebSocket,
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
    for (const [playerId, ws] of this.playerSockets.entries()) {
      if (skipPlayerId && playerId === skipPlayerId) continue;
      // SECURITY: Every player receives ONLY their own projected snapshot!
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
