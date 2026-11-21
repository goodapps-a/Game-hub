import {
  HOKM_CONFIG,
  HokmState,
  Seat,
  Suit,
} from '../engine/types';
import { COUNTER_CLOCKWISE_ORDER, getNextSeat, getTeamForSeat } from '../engine/turns';
import { RandomFn } from '../engine/deck';
import {
  chooseTrumpSuit,
  collectCompletedTrick,
  createInitialMatchState,
  dealInitialFive,
  dealRemainingEight,
  playCard,
  resetMatch,
  startNextHand,
  startShufflingHand,
} from '../engine/gameEngine';
import { validateCardPlay } from '../engine/rules';
import {
  CompletedMatchRecord,
  DEFAULT_DISCONNECT_GRACE_MS,
  MAX_ROOM_PLAYERS,
  OnlineErrorCode,
  PROTOCOL_VERSION,
  PublicRoomSummary,
  RoomEventNotice,
  RoomSeatView,
  RoomSnapshot,
  RoomStatus,
  sanitizeAvatarCode,
  sanitizeUsername,
} from './protocol';
import {
  projectStateForViewer,
  rotateSeatForViewer,
  rotateTeamForViewer,
} from './perspective';

export interface SeatMember {
  playerId: string;
  username: string;
  avatarCode: string;
  canonicalSeat: Seat;
  sessionToken: string;
  isReady: boolean;
  connected: boolean;
  disconnectedAt: number | null;
  disconnectDeadline: number | null;
  joinedAt: number;
}

export interface RoomActionOutcome {
  readonly ok: boolean;
  readonly duplicate?: boolean;
  readonly errorCode?: OnlineErrorCode;
  readonly errorMessage?: string;
  readonly event?: RoomEventNotice;
  readonly shouldBroadcast?: boolean;
  readonly scheduleTrickCollectMs?: number;
  readonly scheduleNextHandMs?: number;
  readonly completedMatch?: CompletedMatchRecord;
}

export interface RoomControllerOptions {
  roomId: string;
  roomCode: string;
  targetMatchScore?: number;
  disconnectGraceMs?: number;
  trickCollectDelayMs?: number;
  nextHandDelayMs?: number;
  rng?: RandomFn;
  now?: () => number;
  generateId?: () => string;
}

function defaultGenerateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultGenerateToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${defaultGenerateId()}-${defaultGenerateId()}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Pure, runtime-agnostic, single-authority Hokm multiplayer Room Controller.
 *
 * Works identically inside:
 * - Node.js Express + `ws` server (`server/roomManager.ts`)
 * - Cloudflare Durable Objects (`cloudflare/src/HokmRoomDO.ts`)
 *
 * Enforces:
 * - Max 4 seats, 1 seat per player, 1 active connection per seat
 * - Strict server-authoritative Phase 1 Hokm rules (zero rules compromised)
 * - Strict card secrecy (clients only ever receive `getSnapshotForPlayer`)
 * - Action idempotency (`processedActionIds` prevents double execution on retries)
 * - Disconnect grace period with seat reservation & seamless reconnect sync
 */
export class HokmRoomController {
  public readonly roomId: string;
  public readonly roomCode: string;
  public readonly targetMatchScore: number;
  public readonly disconnectGraceMs: number;
  public readonly trickCollectDelayMs: number;
  public readonly nextHandDelayMs: number;

  private readonly rng: RandomFn;
  private readonly now: () => number;
  private readonly generateId: () => string;

  private status: RoomStatus = 'WAITING';
  private stateVersion = 1;
  private hostPlayerId: string | null = null;
  private seats: Record<Seat, SeatMember | null> = {
    south: null,
    east: null,
    north: null,
    west: null,
  };

  private gameState: HokmState | null = null;
  private currentMatchId: string | null = null;
  private matchStartedAt: number | null = null;
  private matchPersisted = false;

  /** Tracks processed client actionIds for strict idempotency (bounded LRU-like cap) */
  private processedActions = new Map<string, { ok: boolean; errorCode?: OnlineErrorCode }>();
  private static readonly MAX_ACTION_CACHE = 400;

  constructor(options: RoomControllerOptions) {
    this.roomId = options.roomId;
    this.roomCode = options.roomCode;
    this.targetMatchScore =
      options.targetMatchScore ?? HOKM_CONFIG.DEFAULT_MATCH_TARGET_SCORE;
    this.disconnectGraceMs =
      options.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS;
    this.trickCollectDelayMs = options.trickCollectDelayMs ?? 1250;
    this.nextHandDelayMs = options.nextHandDelayMs ?? 1150;
    this.rng = options.rng ?? Math.random;
    this.now = options.now ?? (() => Date.now());
    this.generateId = options.generateId ?? defaultGenerateId;
  }

  public getStatus(): RoomStatus {
    return this.status;
  }

  public getStateVersion(): number {
    return this.stateVersion;
  }

  public getPlayerCount(): number {
    return COUNTER_CLOCKWISE_ORDER.filter((s) => this.seats[s] !== null).length;
  }

  public isEmpty(): boolean {
    return this.getPlayerCount() === 0;
  }

  public getPlayerById(playerId: string): SeatMember | null {
    for (const s of COUNTER_CLOCKWISE_ORDER) {
      const m = this.seats[s];
      if (m && m.playerId === playerId) return m;
    }
    return null;
  }

  public getAllMembers(): SeatMember[] {
    return COUNTER_CLOCKWISE_ORDER.map((s) => this.seats[s]).filter(
      (m): m is SeatMember => m !== null
    );
  }

  /** Exposed strictly for internal unit tests / server inspection — never send to clients! */
  public getAuthoritativeGameState(): HokmState | null {
    return this.gameState;
  }

  public getPublicSummary(): PublicRoomSummary {
    return {
      roomId: this.roomId,
      roomCode: this.roomCode,
      status: this.status,
      playerCount: this.getPlayerCount(),
      maxPlayers: MAX_ROOM_PLAYERS,
      seats: COUNTER_CLOCKWISE_ORDER.map((s) => {
        const m = this.seats[s];
        return {
          canonicalSeat: s,
          username: m?.username ?? null,
          isHost: Boolean(m && m.playerId === this.hostPlayerId),
          isReady: m?.isReady ?? false,
          connected: m?.connected ?? false,
        };
      }),
    };
  }

  private bumpVersion(): void {
    this.stateVersion += 1;
  }

  private recordAction(
    actionId: string,
    result: { ok: boolean; errorCode?: OnlineErrorCode }
  ): void {
    if (this.processedActions.size >= HokmRoomController.MAX_ACTION_CACHE) {
      const oldestKey = this.processedActions.keys().next().value;
      if (oldestKey) this.processedActions.delete(oldestKey);
    }
    this.processedActions.set(actionId, result);
  }

  private checkDuplicateAction(actionId: string): RoomActionOutcome | null {
    const existing = this.processedActions.get(actionId);
    if (!existing) return null;
    return {
      ok: existing.ok,
      duplicate: true,
      errorCode: existing.errorCode,
      shouldBroadcast: false,
    };
  }

  // -------------------------------------------------------------------------
  // Room Membership & Authentication
  // -------------------------------------------------------------------------

  public joinPlayer(input: {
    username: string;
    avatarCode?: string;
    preferredSeat?: Seat;
    playerId?: string;
  }):
    | { ok: true; member: SeatMember }
    | { ok: false; code: OnlineErrorCode; message: string } {
    if (this.status === 'CLOSED') {
      return {
        ok: false,
        code: 'ROOM_CLOSED',
        message: 'این اتاق بسته شده است.',
      };
    }

    const cleanName = sanitizeUsername(input.username);
    if (!cleanName) {
      return {
        ok: false,
        code: 'INVALID_MESSAGE',
        message: 'نام کاربری نامعتبر است (۳ تا ۲۰ کاراکتر انگلیسی).',
      };
    }

    if (this.status !== 'WAITING') {
      return {
        ok: false,
        code: 'ROOM_FULL',
        message: 'مسابقه در این اتاق آغاز شده و امکان ورود بازیکن جدید نیست.',
      };
    }

    // Block duplicate username in the same room
    const existingByName = this.getAllMembers().find(
      (m) => m.username.toLowerCase() === cleanName.toLowerCase()
    );
    if (existingByName) {
      return {
        ok: false,
        code: 'DUPLICATE_PLAYER',
        message: 'بازیکنی با این نام کاربری هم‌اکنون در اتاق حضور دارد.',
      };
    }

    // Determine seat
    let targetSeat: Seat | null = null;
    if (input.preferredSeat) {
      if (this.seats[input.preferredSeat] !== null) {
        return {
          ok: false,
          code: 'SEAT_TAKEN',
          message: 'این صندلی هم‌اکنون اشغال شده است.',
        };
      }
      targetSeat = input.preferredSeat;
    } else {
      targetSeat =
        COUNTER_CLOCKWISE_ORDER.find((s) => this.seats[s] === null) ?? null;
    }

    if (!targetSeat) {
      return {
        ok: false,
        code: 'ROOM_FULL',
        message: 'ظرفیت اتاق (۴ بازیکن) تکمیل است.',
      };
    }

    const playerId = input.playerId ?? `p_${this.generateId()}`;
    const member: SeatMember = {
      playerId,
      username: cleanName,
      avatarCode: sanitizeAvatarCode(input.avatarCode),
      canonicalSeat: targetSeat,
      sessionToken: defaultGenerateToken(),
      isReady: false,
      connected: false,
      disconnectedAt: null,
      disconnectDeadline: null,
      joinedAt: this.now(),
    };

    this.seats[targetSeat] = member;
    if (!this.hostPlayerId) {
      this.hostPlayerId = playerId;
    }
    this.bumpVersion();

    return { ok: true, member };
  }

  public authenticateConnection(
    playerId: string,
    sessionToken: string
  ):
    | {
        ok: true;
        member: SeatMember;
        wasReconnect: boolean;
        event: RoomEventNotice;
      }
    | { ok: false; code: OnlineErrorCode; message: string } {
    if (this.status === 'CLOSED') {
      return { ok: false, code: 'ROOM_CLOSED', message: 'اتاق بسته شده است.' };
    }

    const member = this.getPlayerById(playerId);
    if (!member || !constantTimeEqual(member.sessionToken, sessionToken)) {
      return {
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'احراز هویت یا مالکیت صندلی نامعتبر است.',
      };
    }

    const wasReconnect = member.disconnectedAt !== null;
    member.connected = true;
    member.disconnectedAt = null;
    member.disconnectDeadline = null;
    this.bumpVersion();

    return {
      ok: true,
      member,
      wasReconnect,
      event: {
        type: wasReconnect ? 'PLAYER_RECONNECTED' : 'PLAYER_JOINED',
        actorSeat: member.canonicalSeat,
        detail: member.username,
      },
    };
  }

  public markPlayerDisconnected(playerId: string): RoomActionOutcome {
    const member = this.getPlayerById(playerId);
    if (!member) return { ok: false, shouldBroadcast: false };

    const ts = this.now();
    member.connected = false;
    member.disconnectedAt = ts;
    member.disconnectDeadline = ts + this.disconnectGraceMs;
    this.bumpVersion();

    return {
      ok: true,
      shouldBroadcast: true,
      event: {
        type: 'PLAYER_DISCONNECTED',
        actorSeat: member.canonicalSeat,
        detail: member.username,
      },
    };
  }

  /**
   * Periodic / alarm check for expired disconnect grace timers.
   * - In WAITING rooms: removes players who stay disconnected past grace period and migrates host / closes empty room.
   * - In PLAYING rooms: preserves game state during grace window; once grace expires, marks room closed cleanly.
   */
  public sweepExpiredDisconnects(): RoomActionOutcome {
    const ts = this.now();
    let changed = false;

    if (this.status === 'WAITING') {
      for (const seat of COUNTER_CLOCKWISE_ORDER) {
        const m = this.seats[seat];
        if (m && !m.connected && m.disconnectDeadline !== null && ts >= m.disconnectDeadline) {
          this.seats[seat] = null;
          if (this.hostPlayerId === m.playerId) {
            this.reassignHost();
          }
          changed = true;
        }
      }
      if (this.isEmpty()) {
        this.status = 'CLOSED';
        this.bumpVersion();
        return {
          ok: true,
          shouldBroadcast: false,
          event: { type: 'ROOM_CLOSED', detail: 'empty_room' },
        };
      }
      if (changed) {
        this.bumpVersion();
        return {
          ok: true,
          shouldBroadcast: true,
          event: { type: 'PLAYER_LEFT' },
        };
      }
      return { ok: true, shouldBroadcast: false };
    }

    if (this.status === 'PLAYING') {
      const expired = this.getAllMembers().find(
        (m) => !m.connected && m.disconnectDeadline !== null && ts >= m.disconnectDeadline
      );
      if (expired) {
        this.status = 'CLOSED';
        this.bumpVersion();
        return {
          ok: true,
          shouldBroadcast: true,
          event: {
            type: 'ROOM_CLOSED',
            actorSeat: expired.canonicalSeat,
            detail: `disconnect_timeout:${expired.username}`,
          },
        };
      }
    }

    return { ok: true, shouldBroadcast: false };
  }

  private reassignHost(): void {
    const remaining = this.getAllMembers().sort((a, b) => a.joinedAt - b.joinedAt);
    this.hostPlayerId = remaining.length > 0 ? remaining[0].playerId : null;
  }

  // -------------------------------------------------------------------------
  // Lobby Actions (Seat Change, Ready, Leave, Start Match)
  // -------------------------------------------------------------------------

  public selectSeat(
    playerId: string,
    targetSeat: Seat,
    actionId: string
  ): RoomActionOutcome {
    const dup = this.checkDuplicateAction(actionId);
    if (dup) return dup;

    const member = this.getPlayerById(playerId);
    if (!member) {
      return { ok: false, errorCode: 'UNAUTHORIZED', errorMessage: 'بازیکن در اتاق یافت نشد.' };
    }
    if (this.status !== 'WAITING') {
      const res = {
        ok: false,
        errorCode: 'INVALID_PHASE' as const,
        errorMessage: 'پس از شروع بازی امکان تغییر صندلی وجود ندارد.',
      };
      this.recordAction(actionId, res);
      return res;
    }
    if (member.canonicalSeat === targetSeat) {
      this.recordAction(actionId, { ok: true });
      return { ok: true, shouldBroadcast: false };
    }
    if (this.seats[targetSeat] !== null) {
      const res = {
        ok: false,
        errorCode: 'SEAT_TAKEN' as const,
        errorMessage: 'این صندلی اشغال شده است.',
      };
      this.recordAction(actionId, res);
      return res;
    }

    this.seats[member.canonicalSeat] = null;
    member.canonicalSeat = targetSeat;
    member.isReady = false;
    this.seats[targetSeat] = member;
    this.bumpVersion();
    this.recordAction(actionId, { ok: true });

    return {
      ok: true,
      shouldBroadcast: true,
      event: { type: 'SEAT_UPDATED', actorSeat: targetSeat, detail: member.username },
    };
  }

  public setReady(
    playerId: string,
    ready: boolean,
    actionId: string
  ): RoomActionOutcome {
    const dup = this.checkDuplicateAction(actionId);
    if (dup) return dup;

    const member = this.getPlayerById(playerId);
    if (!member) {
      return { ok: false, errorCode: 'UNAUTHORIZED', errorMessage: 'بازیکن در اتاق یافت نشد.' };
    }
    if (this.status !== 'WAITING') {
      const res = {
        ok: false,
        errorCode: 'INVALID_PHASE' as const,
        errorMessage: 'تغییر وضعیت آمادگی فقط قبل از شروع بازی مجاز است.',
      };
      this.recordAction(actionId, res);
      return res;
    }

    member.isReady = ready;
    this.bumpVersion();
    this.recordAction(actionId, { ok: true });

    return {
      ok: true,
      shouldBroadcast: true,
      event: { type: 'SEAT_UPDATED', actorSeat: member.canonicalSeat },
    };
  }

  public leaveRoom(playerId: string, actionId: string): RoomActionOutcome {
    const dup = this.checkDuplicateAction(actionId);
    if (dup) return dup;

    const member = this.getPlayerById(playerId);
    if (!member) {
      return { ok: false, errorCode: 'UNAUTHORIZED', errorMessage: 'بازیکن در اتاق یافت نشد.' };
    }

    const leftSeat = member.canonicalSeat;
    const leftName = member.username;

    if (this.status === 'WAITING' || this.status === 'FINISHED') {
      this.seats[leftSeat] = null;
      if (this.hostPlayerId === playerId) {
        this.reassignHost();
      }
      if (this.isEmpty() || this.status === 'FINISHED') {
        if (this.isEmpty()) {
          this.status = 'CLOSED';
        }
      }
      this.bumpVersion();
      this.recordAction(actionId, { ok: true });
      return {
        ok: true,
        shouldBroadcast: true,
        event: {
          type: this.status === 'CLOSED' ? 'ROOM_CLOSED' : 'PLAYER_LEFT',
          actorSeat: leftSeat,
          detail: leftName,
        },
      };
    }

    // Leaving intentionally mid-game closes the match cleanly for remaining players
    this.seats[leftSeat] = null;
    this.status = 'CLOSED';
    this.bumpVersion();
    this.recordAction(actionId, { ok: true });
    return {
      ok: true,
      shouldBroadcast: true,
      event: {
        type: 'ROOM_CLOSED',
        actorSeat: leftSeat,
        detail: `forfeit:${leftName}`,
      },
    };
  }

  public startMatch(playerId: string, actionId: string): RoomActionOutcome {
    const dup = this.checkDuplicateAction(actionId);
    if (dup) return dup;

    if (this.status !== 'WAITING') {
      const res = {
        ok: false,
        errorCode: 'INVALID_PHASE' as const,
        errorMessage: 'مسابقه قبلاً شروع شده یا بسته شده است.',
      };
      this.recordAction(actionId, res);
      return res;
    }

    if (playerId !== this.hostPlayerId) {
      const res = {
        ok: false,
        errorCode: 'NOT_HOST' as const,
        errorMessage: 'فقط میزبان اتاق می‌تواند بازی را شروع کند.',
      };
      this.recordAction(actionId, res);
      return res;
    }

    const members = this.getAllMembers();
    if (members.length < MAX_ROOM_PLAYERS) {
      const res = {
        ok: false,
        errorCode: 'NOT_ENOUGH_PLAYERS' as const,
        errorMessage: 'برای شروع بازی حکم حضور ۴ بازیکن الزامی است.',
      };
      this.recordAction(actionId, res);
      return res;
    }

    const allReady = members.every((m) => m.isReady);
    if (!allReady) {
      const res = {
        ok: false,
        errorCode: 'NOT_ALL_READY' as const,
        errorMessage: 'همه بازیکنان باید ابتدا دکمه «آماده‌ام» را بزنند.',
      };
      this.recordAction(actionId, res);
      return res;
    }

    // Pick initial Hakem deterministically from RNG among the 4 seats (or host's seat if RNG < 0.25)
    const initialHakem =
      COUNTER_CLOCKWISE_ORDER[Math.floor(this.rng() * 4) % 4];

    let state = createInitialMatchState({
      initialHakem,
      targetMatchScore: this.targetMatchScore,
    });
    state = startShufflingHand(state, initialHakem, this.rng);
    const dealt5 = dealInitialFive(state);

    this.gameState = dealt5.state;
    this.status = 'PLAYING';
    this.currentMatchId = `m_${this.generateId()}`;
    this.matchStartedAt = this.now();
    this.matchPersisted = false;
    this.bumpVersion();
    this.recordAction(actionId, { ok: true });

    return {
      ok: true,
      shouldBroadcast: true,
      event: {
        type: 'DEALT_INITIAL_5',
        actorSeat: initialHakem,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Authoritative Hokm Gameplay Mutations
  // -------------------------------------------------------------------------

  public chooseTrump(
    playerId: string,
    suit: Suit,
    actionId: string
  ): RoomActionOutcome {
    const dup = this.checkDuplicateAction(actionId);
    if (dup) return dup;

    const member = this.getPlayerById(playerId);
    if (!member) {
      return { ok: false, errorCode: 'UNAUTHORIZED', errorMessage: 'بازیکن نامعتبر است.' };
    }
    if (this.status !== 'PLAYING' || !this.gameState) {
      const res = {
        ok: false,
        errorCode: 'INVALID_PHASE' as const,
        errorMessage: 'بازی در جریان نیست.',
      };
      this.recordAction(actionId, res);
      return res;
    }
    if (this.gameState.phase !== 'CHOOSING_TRUMP') {
      const res = {
        ok: false,
        errorCode: 'INVALID_PHASE' as const,
        errorMessage: 'اکنون زمان انتخاب حکم نیست.',
      };
      this.recordAction(actionId, res);
      return res;
    }
    if (member.canonicalSeat !== this.gameState.hakem) {
      const res = {
        ok: false,
        errorCode: 'NOT_HAKEM' as const,
        errorMessage: 'فقط حاکم می‌تواند خال حکم را انتخاب کند.',
      };
      this.recordAction(actionId, res);
      return res;
    }

    const afterTrump = chooseTrumpSuit(this.gameState, suit, member.canonicalSeat);
    const afterDeal8 = dealRemainingEight(afterTrump);
    this.gameState = afterDeal8.state;
    this.bumpVersion();
    this.recordAction(actionId, { ok: true });

    return {
      ok: true,
      shouldBroadcast: true,
      event: {
        type: 'DEALT_REMAINING_8',
        actorSeat: member.canonicalSeat,
        detail: suit,
      },
    };
  }

  public playCardMove(
    playerId: string,
    cardId: string,
    actionId: string
  ): RoomActionOutcome {
    const dup = this.checkDuplicateAction(actionId);
    if (dup) return dup;

    const member = this.getPlayerById(playerId);
    if (!member) {
      return { ok: false, errorCode: 'UNAUTHORIZED', errorMessage: 'بازیکن نامعتبر است.' };
    }
    if (this.status !== 'PLAYING' || !this.gameState) {
      const res = {
        ok: false,
        errorCode: 'INVALID_PHASE' as const,
        errorMessage: 'بازی در جریان نیست.',
      };
      this.recordAction(actionId, res);
      return res;
    }
    if (this.gameState.phase !== 'PLAYING_TRICK') {
      const res = {
        ok: false,
        errorCode: 'INVALID_PHASE' as const,
        errorMessage: 'در این مرحله امکان بازی کردن کارت نیست.',
      };
      this.recordAction(actionId, res);
      return res;
    }
    if (member.canonicalSeat !== this.gameState.currentTurn) {
      const res = {
        ok: false,
        errorCode: 'NOT_YOUR_TURN' as const,
        errorMessage: 'هنوز نوبت شما نیست.',
      };
      this.recordAction(actionId, res);
      return res;
    }

    const hand = this.gameState.hands[member.canonicalSeat];
    const check = validateCardPlay(hand, cardId, this.gameState.currentTrick);
    if (check.valid === false) {
      const hasCardInHand = hand.some((c) => c.id === cardId);
      const res = {
        ok: false,
        errorCode: (hasCardInHand
          ? 'MUST_FOLLOW_SUIT'
          : 'CARD_NOT_IN_HAND') as OnlineErrorCode,
        errorMessage: hasCardInHand
          ? 'باید از خال شروع‌شده پیروی کنید.'
          : 'این کارت در دست شما وجود ندارد.',
      };
      this.recordAction(actionId, res);
      return res;
    }

    const nextState = playCard(this.gameState, member.canonicalSeat, cardId);
    this.gameState = nextState;
    this.bumpVersion();
    this.recordAction(actionId, { ok: true });

    if (nextState.phase === 'TRICK_COMPLETE') {
      return {
        ok: true,
        shouldBroadcast: true,
        event: {
          type: 'TRICK_COMPLETED',
          actorSeat: nextState.lastCompletedTrick?.winnerSeat,
          detail: cardId,
        },
        scheduleTrickCollectMs: this.trickCollectDelayMs,
      };
    }

    return {
      ok: true,
      shouldBroadcast: true,
      event: {
        type: 'CARD_PLAYED',
        actorSeat: member.canonicalSeat,
        detail: cardId,
      },
    };
  }

  /**
   * Called by the room runtime timer (Node setTimeout or Durable Object Alarm)
   * after the brief trick-winner display pause.
   */
  public resolveCompletedTrick(): RoomActionOutcome {
    if (
      this.status !== 'PLAYING' ||
      !this.gameState ||
      this.gameState.phase !== 'TRICK_COMPLETE'
    ) {
      return { ok: false, shouldBroadcast: false };
    }

    const collected = collectCompletedTrick(this.gameState);
    this.gameState = collected;
    this.bumpVersion();

    if (collected.phase === 'MATCH_COMPLETE' && collected.handOutcome && collected.matchWinner) {
      this.status = 'FINISHED';
      const completedMatch = this.buildCompletedMatchRecord(collected);
      this.matchPersisted = true;
      return {
        ok: true,
        shouldBroadcast: true,
        event: {
          type: 'MATCH_COMPLETED',
          detail: collected.matchWinner,
        },
        completedMatch,
      };
    }

    if (collected.phase === 'HAND_COMPLETE') {
      return {
        ok: true,
        shouldBroadcast: true,
        event: {
          type: 'HAND_COMPLETED',
          detail: collected.handOutcome?.winningTeam,
        },
        scheduleNextHandMs: this.nextHandDelayMs,
      };
    }

    return {
      ok: true,
      shouldBroadcast: true,
      event: {
        type: 'TRICK_COLLECTED',
        actorSeat: collected.currentTurn,
      },
    };
  }

  /**
   * Automatically starts the next hand after HAND_COMPLETE (NO intermediate modal!).
   * Preserves Iranian Hokm Hakem continuity: if Hakem's team won the hand, Hakem stays;
   * if opponents won, Hakem rotates counter-clockwise to the next seat.
   */
  public advanceToNextHand(): RoomActionOutcome {
    if (
      this.status !== 'PLAYING' ||
      !this.gameState ||
      this.gameState.phase !== 'HAND_COMPLETE'
    ) {
      return { ok: false, shouldBroadcast: false };
    }

    const outcome = this.gameState.handOutcome;
    const hakemWon =
      outcome && outcome.winningTeam === getTeamForSeat(this.gameState.hakem);
    const nextHakem = hakemWon
      ? this.gameState.hakem
      : getNextSeat(this.gameState.hakem);

    const shuffled = startNextHand(this.gameState, nextHakem, this.rng);
    const dealt5 = dealInitialFive(shuffled);
    this.gameState = dealt5.state;
    this.bumpVersion();

    return {
      ok: true,
      shouldBroadcast: true,
      event: {
        type: 'DEALT_INITIAL_5',
        actorSeat: nextHakem,
      },
    };
  }

  /**
   * Starts a fresh match in the same 4-player room after MATCH_COMPLETE (host only).
   */
  public startRematch(playerId: string, actionId: string): RoomActionOutcome {
    const dup = this.checkDuplicateAction(actionId);
    if (dup) return dup;

    if (this.status !== 'FINISHED') {
      const res = {
        ok: false,
        errorCode: 'INVALID_PHASE' as const,
        errorMessage: 'مسابقه هنوز تمام نشده است.',
      };
      this.recordAction(actionId, res);
      return res;
    }
    if (playerId !== this.hostPlayerId) {
      const res = {
        ok: false,
        errorCode: 'NOT_HOST' as const,
        errorMessage: 'فقط میزبان می‌تواند مسابقه جدید شروع کند.',
      };
      this.recordAction(actionId, res);
      return res;
    }
    if (this.getPlayerCount() < MAX_ROOM_PLAYERS) {
      const res = {
        ok: false,
        errorCode: 'NOT_ENOUGH_PLAYERS' as const,
        errorMessage: 'همه ۴ بازیکن برای شروع مجدد در اتاق نیستند.',
      };
      this.recordAction(actionId, res);
      return res;
    }

    const nextHakem =
      COUNTER_CLOCKWISE_ORDER[Math.floor(this.rng() * 4) % 4];
    const fresh = resetMatch(this.targetMatchScore, nextHakem, this.rng);
    const dealt5 = dealInitialFive(fresh);

    this.gameState = dealt5.state;
    this.status = 'PLAYING';
    this.currentMatchId = `m_${this.generateId()}`;
    this.matchStartedAt = this.now();
    this.matchPersisted = false;
    this.bumpVersion();
    this.recordAction(actionId, { ok: true });

    return {
      ok: true,
      shouldBroadcast: true,
      event: {
        type: 'DEALT_INITIAL_5',
        actorSeat: nextHakem,
      },
    };
  }

  private buildCompletedMatchRecord(state: HokmState): CompletedMatchRecord {
    const winner = state.matchWinner!;
    const finishedAt = this.now();
    return {
      matchId: this.currentMatchId ?? `m_${this.generateId()}`,
      roomCode: this.roomCode,
      startedAt: this.matchStartedAt ?? finishedAt,
      finishedAt,
      winningTeam: winner,
      teamAScore: state.matchScores.myTeam,
      teamBScore: state.matchScores.opponentTeam,
      targetScore: state.targetMatchScore,
      lastWinType: state.handOutcome?.winType ?? 'normal',
      handsPlayed: state.handNumber,
      players: this.getAllMembers().map((m) => {
        const team = getTeamForSeat(m.canonicalSeat);
        return {
          playerId: m.playerId,
          username: m.username,
          canonicalSeat: m.canonicalSeat,
          team,
          won: team === winner,
        };
      }),
    };
  }

  public isMatchPersisted(): boolean {
    return this.matchPersisted;
  }

  // -------------------------------------------------------------------------
  // Strictly Sanitized Per-Viewer Snapshot Projection
  // -------------------------------------------------------------------------

  public getSnapshotForPlayer(playerId: string): RoomSnapshot | null {
    const viewer = this.getPlayerById(playerId);
    if (!viewer) return null;

    const viewerSeat = viewer.canonicalSeat;
    const seats: RoomSeatView[] = COUNTER_CLOCKWISE_ORDER.map((canonicalSeat) => {
      const m = this.seats[canonicalSeat];
      const visualSeat = rotateSeatForViewer(canonicalSeat, viewerSeat);
      const team = rotateTeamForViewer(getTeamForSeat(canonicalSeat), viewerSeat);

      return {
        visualSeat,
        canonicalSeat,
        playerId: m?.playerId ?? null,
        username: m?.username ?? null,
        avatarCode: m?.avatarCode ?? 'portrait',
        isHost: Boolean(m && m.playerId === this.hostPlayerId),
        isReady: m?.isReady ?? false,
        connected: m?.connected ?? false,
        disconnectedAt: m?.disconnectedAt ?? null,
        disconnectDeadline: m?.disconnectDeadline ?? null,
        team,
      };
    });

    return {
      protocolVersion: PROTOCOL_VERSION,
      roomId: this.roomId,
      roomCode: this.roomCode,
      matchId: this.currentMatchId,
      status: this.status,
      stateVersion: this.stateVersion,
      serverTime: this.now(),
      disconnectGraceMs: this.disconnectGraceMs,
      viewerPlayerId: viewer.playerId,
      viewerCanonicalSeat: viewerSeat,
      hostPlayerId: this.hostPlayerId,
      seats,
      game: this.gameState
        ? projectStateForViewer(this.gameState, viewerSeat)
        : null,
    };
  }
}
