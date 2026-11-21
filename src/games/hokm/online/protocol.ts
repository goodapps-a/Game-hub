import {
  Card,
  CompletedTrick,
  HandOutcome,
  HokmPhase,
  Seat,
  Suit,
  TeamId,
} from '../engine/types';

export const PROTOCOL_VERSION = 1 as const;

export const MAX_ROOM_PLAYERS = 4 as const;
export const DEFAULT_DISCONNECT_GRACE_MS = 90_000;
export const MAX_WS_PAYLOAD_BYTES = 8 * 1024;

export type RoomStatus = 'WAITING' | 'PLAYING' | 'FINISHED' | 'CLOSED';

export type OnlineErrorCode =
  | 'INVALID_MESSAGE'
  | 'UNSUPPORTED_PROTOCOL'
  | 'UNAUTHORIZED'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_CLOSED'
  | 'SEAT_TAKEN'
  | 'DUPLICATE_PLAYER'
  | 'NOT_HOST'
  | 'NOT_ALL_READY'
  | 'NOT_ENOUGH_PLAYERS'
  | 'INVALID_PHASE'
  | 'NOT_HAKEM'
  | 'NOT_YOUR_TURN'
  | 'CARD_NOT_IN_HAND'
  | 'MUST_FOLLOW_SUIT'
  | 'ACTION_REJECTED'
  | 'RATE_LIMITED'
  | 'SUPERSEDED_CONNECTION';

export interface RoomSeatView {
  /** Visual seat on the receiving player's screen ('south' is ALWAYS the receiving player) */
  readonly visualSeat: Seat;
  /** Canonical server seat ('south' | 'east' | 'north' | 'west') */
  readonly canonicalSeat: Seat;
  readonly playerId: string | null;
  readonly username: string | null;
  readonly avatarCode: string;
  readonly isHost: boolean;
  readonly isReady: boolean;
  readonly connected: boolean;
  readonly disconnectedAt: number | null;
  readonly disconnectDeadline: number | null;
  readonly team: TeamId;
}

/**
 * Strictly sanitized game state projected for a single authenticated viewer.
 * SECURITY INVARIANT:
 * - Contains ONLY `myHand` (cards of the viewer's own seat).
 * - Never includes other players' cards or the undealt deck.
 * - All seats and teams are rotated into the viewer's perspective (viewer = 'south', team = 'myTeam').
 */
export interface ProjectedHokmState {
  readonly phase: HokmPhase;
  readonly handNumber: number;
  readonly targetMatchScore: number;
  readonly matchScores: Record<TeamId, number>;
  readonly trickCounts: Record<TeamId, number>;
  readonly wonTricksBySeat: Record<Seat, number>;
  readonly hakem: Seat;
  readonly trumpSuit: Suit | null;
  readonly deckCount: number;
  readonly myHand: readonly Card[];
  readonly handCounts: Record<Seat, number>;
  readonly currentTurn: Seat;
  readonly trickLeadSeat: Seat;
  readonly currentTrick: readonly { seat: Seat; card: Card }[];
  readonly lastCompletedTrick: CompletedTrick | null;
  readonly completedTricksCount: number;
  readonly handOutcome: HandOutcome | null;
  readonly matchWinner: TeamId | null;
}

export interface RoomSnapshot {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly roomId: string;
  readonly roomCode: string;
  readonly matchId: string | null;
  readonly status: RoomStatus;
  readonly stateVersion: number;
  readonly serverTime: number;
  readonly disconnectGraceMs: number;
  readonly viewerPlayerId: string;
  readonly viewerCanonicalSeat: Seat;
  readonly hostPlayerId: string | null;
  readonly seats: readonly RoomSeatView[];
  readonly game: ProjectedHokmState | null;
}

export type GameEventType =
  | 'MATCH_STARTED'
  | 'DEALT_INITIAL_5'
  | 'TRUMP_CHOSEN'
  | 'DEALT_REMAINING_8'
  | 'CARD_PLAYED'
  | 'TRICK_COMPLETED'
  | 'TRICK_COLLECTED'
  | 'HAND_COMPLETED'
  | 'MATCH_COMPLETED'
  | 'PLAYER_JOINED'
  | 'PLAYER_LEFT'
  | 'PLAYER_DISCONNECTED'
  | 'PLAYER_RECONNECTED'
  | 'SEAT_UPDATED'
  | 'ROOM_CLOSED';

export interface RoomEventNotice {
  readonly type: GameEventType;
  readonly actorSeat?: Seat;
  readonly detail?: string;
}

// ---------------------------------------------------------------------------
// Client -> Server WebSocket Messages (Versioned + Action-Idempotent)
// ---------------------------------------------------------------------------
export type ClientMessage =
  | {
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly type: 'auth';
      readonly roomCode: string;
      readonly playerId: string;
      readonly sessionToken: string;
    }
  | {
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly type: 'ping';
      readonly clientTime: number;
    }
  | {
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly type: 'set_ready';
      readonly actionId: string;
      readonly ready: boolean;
    }
  | {
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly type: 'select_seat';
      readonly actionId: string;
      readonly canonicalSeat: Seat;
    }
  | {
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly type: 'start_match';
      readonly actionId: string;
    }
  | {
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly type: 'choose_trump';
      readonly actionId: string;
      readonly suit: Suit;
    }
  | {
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly type: 'play_card';
      readonly actionId: string;
      readonly cardId: string;
    }
  | {
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly type: 'leave_room';
      readonly actionId: string;
    }
  | {
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly type: 'rematch';
      readonly actionId: string;
    }
  | {
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly type: 'request_sync';
    };

// ---------------------------------------------------------------------------
// Server -> Client WebSocket Messages
// ---------------------------------------------------------------------------
export type ServerMessage =
  | {
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly type: 'auth_ok';
      readonly snapshot: RoomSnapshot;
    }
  | {
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly type: 'state_sync';
      readonly snapshot: RoomSnapshot;
      readonly event?: RoomEventNotice;
    }
  | {
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly type: 'action_ack';
      readonly actionId: string;
      readonly duplicate?: boolean;
    }
  | {
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly type: 'error';
      readonly code: OnlineErrorCode;
      readonly message: string;
      readonly actionId?: string;
    }
  | {
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly type: 'pong';
      readonly clientTime: number;
      readonly serverTime: number;
    };

// ---------------------------------------------------------------------------
// HTTP REST DTOs
// ---------------------------------------------------------------------------
export interface CreateRoomResponse {
  readonly roomId: string;
  readonly roomCode: string;
  readonly playerId: string;
  readonly canonicalSeat: Seat;
  readonly sessionToken: string;
  readonly wsPath: string;
}

export interface JoinRoomResponse {
  readonly roomId: string;
  readonly roomCode: string;
  readonly playerId: string;
  readonly canonicalSeat: Seat;
  readonly sessionToken: string;
  readonly wsPath: string;
}

export interface PublicRoomSummary {
  readonly roomId: string;
  readonly roomCode: string;
  readonly status: RoomStatus;
  readonly playerCount: number;
  readonly maxPlayers: typeof MAX_ROOM_PLAYERS;
  readonly seats: readonly {
    canonicalSeat: Seat;
    username: string | null;
    isHost: boolean;
    isReady: boolean;
    connected: boolean;
  }[];
}

export interface CompletedMatchRecord {
  readonly matchId: string;
  readonly roomCode: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly winningTeam: TeamId;
  readonly teamAScore: number;
  readonly teamBScore: number;
  readonly targetScore: number;
  readonly lastWinType: 'normal' | 'kot' | 'hakem_kot';
  readonly handsPlayed: number;
  readonly players: readonly {
    playerId: string;
    username: string;
    canonicalSeat: Seat;
    team: TeamId;
    won: boolean;
  }[];
}

export interface PlayerOnlineStats {
  readonly username: string;
  readonly matchesPlayed: number;
  readonly wins: number;
  readonly losses: number;
  readonly kotWins: number;
  readonly hakemKotWins: number;
  readonly lastPlayedAt: number | null;
}

// ---------------------------------------------------------------------------
// Strict Input Validators (shared between Client, Express Server & CF Worker)
// ---------------------------------------------------------------------------
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const ROOM_CODE_RE = /^[A-Z2-9]{4,8}$/;
const ACTION_ID_RE = /^[a-zA-Z0-9_-]{8,80}$/;
const CARD_ID_RE = /^(hearts|diamonds|clubs|spades)-(2|3|4|5|6|7|8|9|10|J|Q|K|A)$/;
const VALID_SEATS = new Set<Seat>(['south', 'east', 'north', 'west']);
const VALID_SUITS = new Set<Suit>(['hearts', 'diamonds', 'clubs', 'spades']);
const VALID_AVATARS = new Set(['portrait', 'shamsa', 'turquoise', 'jade']);

const UTF8_ENCODER = new TextEncoder();

export function getUtf8ByteLength(input: string): number {
  return UTF8_ENCODER.encode(input).byteLength;
}

export function sanitizeUsername(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  return USERNAME_RE.test(trimmed) ? trimmed : null;
}

/**
 * Canonical case-insensitive username key for D1/SQLite primary keys & lookups
 * (prevents duplicate stats/accounts for `Amir` vs `amir`).
 */
export function normalizeUsernameKey(username: string): string {
  return username.trim().toLowerCase();
}

export function sanitizeRoomCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.trim().toUpperCase();
  return ROOM_CODE_RE.test(cleaned) ? cleaned : null;
}

export function sanitizeAvatarCode(input: unknown): string {
  if (typeof input === 'string' && VALID_AVATARS.has(input)) {
    return input;
  }
  return 'portrait';
}

export function isValidSeat(input: unknown): input is Seat {
  return typeof input === 'string' && VALID_SEATS.has(input as Seat);
}

export function isValidSuit(input: unknown): input is Suit {
  return typeof input === 'string' && VALID_SUITS.has(input as Suit);
}

export function isValidActionId(input: unknown): input is string {
  return typeof input === 'string' && ACTION_ID_RE.test(input);
}

export function isValidCardId(input: unknown): input is string {
  return typeof input === 'string' && CARD_ID_RE.test(input);
}

export function parseClientMessage(raw: string):
  | { ok: true; message: ClientMessage }
  | { ok: false; code: OnlineErrorCode; reason: string } {
  if (getUtf8ByteLength(raw) > MAX_WS_PAYLOAD_BYTES) {
    return {
      ok: false,
      code: 'INVALID_MESSAGE',
      reason: 'Payload exceeds maximum allowed size.',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'INVALID_MESSAGE', reason: 'Malformed JSON.' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, code: 'INVALID_MESSAGE', reason: 'Expected JSON object.' };
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.protocolVersion !== PROTOCOL_VERSION) {
    return {
      ok: false,
      code: 'UNSUPPORTED_PROTOCOL',
      reason: `Expected protocolVersion ${PROTOCOL_VERSION}.`,
    };
  }

  switch (obj.type) {
    case 'auth': {
      const roomCode = sanitizeRoomCode(obj.roomCode);
      if (
        !roomCode ||
        typeof obj.playerId !== 'string' ||
        obj.playerId.length < 4 ||
        obj.playerId.length > 80 ||
        typeof obj.sessionToken !== 'string' ||
        obj.sessionToken.length < 16 ||
        obj.sessionToken.length > 160
      ) {
        return {
          ok: false,
          code: 'UNAUTHORIZED',
          reason: 'Invalid auth credentials format.',
        };
      }
      return {
        ok: true,
        message: {
          protocolVersion: PROTOCOL_VERSION,
          type: 'auth',
          roomCode,
          playerId: obj.playerId,
          sessionToken: obj.sessionToken,
        },
      };
    }

    case 'ping': {
      const clientTime =
        typeof obj.clientTime === 'number' && Number.isFinite(obj.clientTime)
          ? obj.clientTime
          : Date.now();
      return {
        ok: true,
        message: {
          protocolVersion: PROTOCOL_VERSION,
          type: 'ping',
          clientTime,
        },
      };
    }

    case 'request_sync':
      return {
        ok: true,
        message: { protocolVersion: PROTOCOL_VERSION, type: 'request_sync' },
      };

    case 'set_ready':
      if (!isValidActionId(obj.actionId) || typeof obj.ready !== 'boolean') {
        return {
          ok: false,
          code: 'INVALID_MESSAGE',
          reason: 'Invalid set_ready payload.',
        };
      }
      return {
        ok: true,
        message: {
          protocolVersion: PROTOCOL_VERSION,
          type: 'set_ready',
          actionId: obj.actionId,
          ready: obj.ready,
        },
      };

    case 'select_seat':
      if (!isValidActionId(obj.actionId) || !isValidSeat(obj.canonicalSeat)) {
        return {
          ok: false,
          code: 'INVALID_MESSAGE',
          reason: 'Invalid select_seat payload.',
        };
      }
      return {
        ok: true,
        message: {
          protocolVersion: PROTOCOL_VERSION,
          type: 'select_seat',
          actionId: obj.actionId,
          canonicalSeat: obj.canonicalSeat,
        },
      };

    case 'start_match':
    case 'leave_room':
    case 'rematch':
      if (!isValidActionId(obj.actionId)) {
        return {
          ok: false,
          code: 'INVALID_MESSAGE',
          reason: `Missing valid actionId for ${obj.type}.`,
        };
      }
      return {
        ok: true,
        message: {
          protocolVersion: PROTOCOL_VERSION,
          type: obj.type,
          actionId: obj.actionId,
        },
      };

    case 'choose_trump':
      if (!isValidActionId(obj.actionId) || !isValidSuit(obj.suit)) {
        return {
          ok: false,
          code: 'INVALID_MESSAGE',
          reason: 'Invalid choose_trump payload.',
        };
      }
      return {
        ok: true,
        message: {
          protocolVersion: PROTOCOL_VERSION,
          type: 'choose_trump',
          actionId: obj.actionId,
          suit: obj.suit,
        },
      };

    case 'play_card':
      if (!isValidActionId(obj.actionId) || !isValidCardId(obj.cardId)) {
        return {
          ok: false,
          code: 'INVALID_MESSAGE',
          reason: 'Invalid play_card payload.',
        };
      }
      return {
        ok: true,
        message: {
          protocolVersion: PROTOCOL_VERSION,
          type: 'play_card',
          actionId: obj.actionId,
          cardId: obj.cardId,
        },
      };

    default:
      return {
        ok: false,
        code: 'INVALID_MESSAGE',
        reason: 'Unknown message type.',
      };
  }
}
