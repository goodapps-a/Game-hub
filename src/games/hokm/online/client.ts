import { Seat, Suit } from '../engine/types';
import {
  ClientMessage,
  CompletedMatchRecord,
  CreateRoomResponse,
  JoinRoomResponse,
  OnlineErrorCode,
  PlayerOnlineStats,
  PROTOCOL_VERSION,
  PublicRoomSessionInfo,
  PublicRoomSummary,
  RoomEventNotice,
  RoomSnapshot,
  SeatPublicAppearance,
  ServerMessage,
} from './protocol';

export type OnlineSessionCredentials = PublicRoomSessionInfo;

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

export interface OnlineClientCallbacks {
  onConnectionChange?: (state: ConnectionState) => void;
  onSnapshot?: (snapshot: RoomSnapshot, event?: RoomEventNotice) => void;
  onError?: (code: OnlineErrorCode, message: string) => void;
  onRttUpdate?: (rttMs: number) => void;
  onClosedByServer?: (reason: string) => void;
}

type EnvRecord = Record<string, string | boolean | undefined>;

function readViteEnv(): EnvRecord {
  return (
    ((import.meta as unknown as { env?: EnvRecord }).env) ?? {}
  );
}

/**
 * Resolves and validates `VITE_ONLINE_API_BASE`.
 * - Empty/unset -> '' (same-origin fallback for local Express dev & same-origin Worker routes).
 * - Non-empty -> trimmed, validated http(s) URL with trailing slashes stripped.
 */
export function resolveOnlineApiBase(envOverride?: EnvRecord): string {
  const env = envOverride ?? readViteEnv();
  const raw = env.VITE_ONLINE_API_BASE;
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `نشانی اتصال به سرور بازی (VITE_ONLINE_API_BASE) نامعتبر است: "${trimmed}"`
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `پروتکل VITE_ONLINE_API_BASE باید http یا https باشد (مقدار فعلی: ${parsed.protocol}).`
    );
  }
  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${cleanPath === '/' ? '' : cleanPath}`;
}

export function buildOnlineHttpUrl(
  apiPath: string,
  envOverride?: EnvRecord
): string {
  const normalizedPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const base = resolveOnlineApiBase(envOverride);
  if (!base) return normalizedPath;
  return `${base}${normalizedPath}`;
}

export function buildOnlineWsUrl(
  wsPath: string,
  envOverride?: EnvRecord,
  locationLike?: { protocol: string; host: string }
): string {
  const normalizedPath = wsPath.startsWith('/') ? wsPath : `/${wsPath}`;
  const base = resolveOnlineApiBase(envOverride);
  if (base) {
    const u = new URL(base);
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    const basePath = u.pathname.replace(/\/+$/, '');
    const prefix = basePath === '/' ? '' : basePath;
    return `${proto}//${u.host}${prefix}${normalizedPath}`;
  }
  const loc = locationLike ?? window.location;
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}${normalizedPath}`;
}

async function parseApiJson<T>(
  res: Response,
  fallbackMessage: string,
  envOverride?: EnvRecord
): Promise<T> {
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    const env = envOverride ?? readViteEnv();
    const isProd = env.PROD === true || env.NODE_ENV === 'production';
    const hasConfiguredBase = Boolean(resolveOnlineApiBase(env));
    if (isProd && !hasConfiguredBase) {
      throw new Error(
        'اتصال به سرور آنلاین برقرار نشد. در تنظیمات انتشار (Cloudflare Pages) متغیر VITE_ONLINE_API_BASE را به نشانی Worker تنظیم کنید یا مسیر /api/* را به Worker متصل نمایید.'
      );
    }
    throw new Error(fallbackMessage);
  }
  return (await res.json()) as T;
}

export function createActionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `act_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// HTTP Room & Stats API Calls
// ---------------------------------------------------------------------------

export async function createOnlineRoom(params: {
  username: string;
  avatarCode: string;
  appearance?: SeatPublicAppearance;
  targetMatchScore?: number;
  isPublic?: boolean;
}): Promise<CreateRoomResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/rooms'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify(params),
  });
  const data = await parseApiJson<
    CreateRoomResponse & { error?: string; message?: string }
  >(res, 'ساخت اتاق ناموفق بود.');
  if (!res.ok) {
    throw new Error(data.message ?? data.error ?? 'ساخت اتاق ناموفق بود.');
  }
  return data;
}

export async function quickMatchOnlineRoom(params: {
  username: string;
  avatarCode: string;
  appearance?: SeatPublicAppearance;
  targetMatchScore?: number;
}): Promise<CreateRoomResponse & { matchedExisting?: boolean }> {
  const res = await fetch(buildOnlineHttpUrl('/api/rooms/quick-match'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify(params),
  });
  const data = await parseApiJson<
    CreateRoomResponse & {
      matchedExisting?: boolean;
      error?: string;
      message?: string;
    }
  >(res, 'جستجوی میز تصادفی ناموفق بود.');
  if (!res.ok) {
    throw new Error(
      data.message ?? data.error ?? 'جستجوی میز تصادفی ناموفق بود.'
    );
  }
  return data;
}

export async function joinOnlineRoom(params: {
  roomCode: string;
  username: string;
  avatarCode: string;
  appearance?: SeatPublicAppearance;
  preferredSeat?: Seat;
}): Promise<JoinRoomResponse> {
  const code = encodeURIComponent(params.roomCode.trim().toUpperCase());
  const res = await fetch(buildOnlineHttpUrl(`/api/rooms/${code}/join`), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify({
      username: params.username,
      avatarCode: params.avatarCode,
      appearance: params.appearance,
      preferredSeat: params.preferredSeat,
    }),
  });
  const data = await parseApiJson<
    JoinRoomResponse & { error?: string; message?: string }
  >(res, 'ورود به اتاق ناموفق بود.');
  if (!res.ok) {
    throw new Error(data.message ?? data.error ?? 'ورود به اتاق ناموفق بود.');
  }
  return data;
}

/**
 * Attempts server-verified session recovery via the HttpOnly cookie after page refresh.
 * Never reads, stores, or receives `sessionToken` in JavaScript.
 */
export async function resumeOnlineSession(
  expectedRoomCode?: string
): Promise<OnlineSessionCredentials | null> {
  try {
    const res = await fetch(buildOnlineHttpUrl('/api/session/resume'), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'eyvan-client',
      },
      body: JSON.stringify(
        expectedRoomCode ? { roomCode: expectedRoomCode } : {}
      ),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) return null;
    const data = (await res.json()) as Partial<OnlineSessionCredentials> & {
      active?: boolean;
    };
    if (
      data.active === false ||
      !data.roomId ||
      !data.roomCode ||
      !data.playerId ||
      !data.canonicalSeat ||
      !data.wsPath
    ) {
      return null;
    }
    return {
      roomId: data.roomId,
      roomCode: data.roomCode,
      playerId: data.playerId,
      canonicalSeat: data.canonicalSeat,
      wsPath: data.wsPath,
    };
  } catch {
    return null;
  }
}

async function isSessionInvalidatedOnServer(roomCode: string): Promise<boolean> {
  try {
    const res = await fetch(buildOnlineHttpUrl('/api/session/resume'), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'eyvan-client',
      },
      body: JSON.stringify({ roomCode }),
    });
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      return true;
    }
    if (res.ok) {
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.toLowerCase().includes('application/json')) {
        const data = (await res.json()) as { active?: boolean };
        if (data.active === false) return true;
      }
    }
    return false;
  } catch {
    // Network offline / transient failure -> allow reconnect loop to keep retrying
    return false;
  }
}

export async function clearOnlineSession(): Promise<void> {
  try {
    await fetch(buildOnlineHttpUrl('/api/session/clear'), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-Requested-With': 'eyvan-client',
      },
    });
  } catch {
    // Best-effort clear
  }
}

export async function fetchRoomSummary(
  roomCode: string
): Promise<PublicRoomSummary | null> {
  const code = encodeURIComponent(roomCode.trim().toUpperCase());
  const res = await fetch(buildOnlineHttpUrl(`/api/rooms/${code}`));
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return (await res.json()) as PublicRoomSummary;
}

export async function fetchRecentOnlineMatches(): Promise<
  CompletedMatchRecord[]
> {
  try {
    const res = await fetch(buildOnlineHttpUrl('/api/matches?limit=8'));
    if (!res.ok) return [];
    const data = (await res.json()) as { matches?: CompletedMatchRecord[] };
    return data.matches ?? [];
  } catch {
    return [];
  }
}

export async function fetchPlayerOnlineStats(
  username: string
): Promise<PlayerOnlineStats | null> {
  try {
    const res = await fetch(
      buildOnlineHttpUrl(`/api/stats/${encodeURIComponent(username)}`)
    );
    if (!res.ok) return null;
    return (await res.json()) as PlayerOnlineStats;
  } catch {
    return null;
  }
}

export async function fetchMyOnlineStats(): Promise<PlayerOnlineStats | null> {
  try {
    const res = await fetch(buildOnlineHttpUrl('/api/stats/me'), {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok?: boolean;
      stats?: PlayerOnlineStats;
    };
    return data.stats ?? null;
  } catch {
    return null;
  }
}

export interface HokmLeaderboardRow {
  readonly userId: string;
  readonly username: string;
  readonly avatarCode: string;
  readonly matchesPlayed: number;
  readonly wins: number;
  readonly losses: number;
  readonly kotWins: number;
  readonly hakemKotWins: number;
  readonly lastPlayedAt: number | null;
}

export async function fetchHokmLeaderboard(
  limit = 20
): Promise<HokmLeaderboardRow[]> {
  try {
    const res = await fetch(
      buildOnlineHttpUrl(`/api/leaderboard/hokm?limit=${Math.max(1, Math.min(50, limit))}`)
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      ok?: boolean;
      entries?: HokmLeaderboardRow[];
    };
    return Array.isArray(data.entries) ? data.entries : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Resilient WebSocket Client (Heartbeat + Stale Detection + Jittered Reconnect)
// ---------------------------------------------------------------------------

export class HokmOnlineClient {
  private ws: WebSocket | null = null;
  private creds: OnlineSessionCredentials;
  private callbacks: OnlineClientCallbacks;

  private intentionallyClosed = false;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private pongTimeoutTimer: number | null = null;
  private isAuthenticated = false;
  private pendingMessages: ClientMessage[] = [];

  private static readonly PING_INTERVAL_MS = 10_000;
  private static readonly PONG_TIMEOUT_MS = 6_000;
  private static readonly MAX_RECONNECT_DELAY_MS = 10_000;

  constructor(
    creds: OnlineSessionCredentials,
    callbacks: OnlineClientCallbacks
  ) {
    this.creds = creds;
    this.callbacks = callbacks;
  }

  public connect(): void {
    this.intentionallyClosed = false;
    this.openSocket(false);
  }

  public disconnect(): void {
    this.intentionallyClosed = true;
    this.clearTimers();
    if (this.ws) {
      try {
        this.ws.close(1000, 'client_disconnect');
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
    this.isAuthenticated = false;
    this.callbacks.onConnectionChange?.('disconnected');
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pongTimeoutTimer !== null) {
      window.clearTimeout(this.pongTimeoutTimer);
      this.pongTimeoutTimer = null;
    }
  }

  private openSocket(isReconnect: boolean): void {
    this.clearTimers();
    this.isAuthenticated = false;
    this.callbacks.onConnectionChange?.(
      isReconnect ? 'reconnecting' : 'connecting'
    );

    const url = buildOnlineWsUrl(this.creds.wsPath);
    const socket = new WebSocket(url);
    this.ws = socket;

    socket.onopen = () => {
      if (this.ws !== socket) return;
      // HttpOnly cookie authenticates the WebSocket upgrade on the server;
      // server sends `auth_ok` immediately upon upgrade (no token ever in JS).
    };

    socket.onmessage = (ev) => {
      if (this.ws !== socket || typeof ev.data !== 'string') return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'auth_ok':
          this.isAuthenticated = true;
          this.reconnectAttempts = 0;
          this.callbacks.onConnectionChange?.('connected');
          this.callbacks.onSnapshot?.(msg.snapshot);
          this.startHeartbeat();
          this.flushPendingQueue();
          break;

        case 'state_sync':
          this.callbacks.onSnapshot?.(msg.snapshot, msg.event);
          break;

        case 'pong': {
          if (this.pongTimeoutTimer !== null) {
            window.clearTimeout(this.pongTimeoutTimer);
            this.pongTimeoutTimer = null;
          }
          const rtt = Math.max(1, Math.round(Date.now() - msg.clientTime));
          this.callbacks.onRttUpdate?.(rtt);
          break;
        }

        case 'error':
          if (
            msg.code === 'UNAUTHORIZED' ||
            msg.code === 'ROOM_CLOSED' ||
            msg.code === 'ROOM_NOT_FOUND'
          ) {
            this.intentionallyClosed = true;
            this.callbacks.onClosedByServer?.(msg.message);
          }
          this.callbacks.onError?.(msg.code, msg.message);
          break;

        case 'action_ack':
          break;
      }
    };

    socket.onclose = (ev) => {
      if (this.ws !== socket) return;
      this.ws = null;
      const hadAuthed = this.isAuthenticated;
      this.isAuthenticated = false;
      this.clearTimers();

      if (ev.code === 4001) {
        // Superseded by a newer connection for this same session
        this.intentionallyClosed = true;
        this.callbacks.onConnectionChange?.('disconnected');
        this.callbacks.onClosedByServer?.('اتصال جدیدی با این حساب برقرار شد.');
        return;
      }

      if (ev.code === 4003 || ev.code === 4004) {
        this.intentionallyClosed = true;
        this.callbacks.onConnectionChange?.('disconnected');
        return;
      }

      if (this.intentionallyClosed) {
        this.callbacks.onConnectionChange?.('disconnected');
        return;
      }

      // If handshake was rejected before auth_ok (e.g. 401/404 -> 1006), verify whether
      // session expired / room closed so we don't spin reconnect loops on a dead cookie.
      if (!hadAuthed) {
        void isSessionInvalidatedOnServer(this.creds.roomCode).then((dead) => {
          if (this.intentionallyClosed) return;
          if (dead) {
            this.intentionallyClosed = true;
            this.callbacks.onConnectionChange?.('disconnected');
            this.callbacks.onClosedByServer?.(
              'نشست بازی منقضی شده یا اتاق بسته شده است.'
            );
            return;
          }
          this.scheduleReconnect();
        });
        return;
      }

      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose handles reconnect cleanly
    };
  }

  private startHeartbeat(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    // Send an immediate initial ping so RTT displays right away
    this.sendPing();
    this.pingTimer = window.setInterval(() => {
      this.sendPing();
    }, HokmOnlineClient.PING_INTERVAL_MS);
  }

  private sendPing(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const pingMsg: ClientMessage = {
      protocolVersion: PROTOCOL_VERSION,
      type: 'ping',
      clientTime: Date.now(),
    };
    try {
      this.ws.send(JSON.stringify(pingMsg));
    } catch {
      return;
    }

    // Stale-socket watchdog (vital for Iran NAT/DPI drops where TCP never sends FIN)
    if (this.pongTimeoutTimer !== null) {
      window.clearTimeout(this.pongTimeoutTimer);
    }
    this.pongTimeoutTimer = window.setTimeout(() => {
      if (this.ws && !this.intentionallyClosed) {
        try {
          this.ws.close(4000, 'heartbeat_timeout');
        } catch {
          // Ignore
        }
      }
    }, HokmOnlineClient.PONG_TIMEOUT_MS);
  }

  private scheduleReconnect(): void {
    this.callbacks.onConnectionChange?.('reconnecting');
    const exp = Math.min(
      HokmOnlineClient.MAX_RECONNECT_DELAY_MS,
      600 * Math.pow(1.8, this.reconnectAttempts)
    );
    const jitter = Math.round(Math.random() * 450);
    const delay = exp + jitter;
    this.reconnectAttempts += 1;

    this.reconnectTimer = window.setTimeout(() => {
      if (!this.intentionallyClosed) {
        this.openSocket(true);
      }
    }, delay);
  }

  private sendOrQueue(msg: ClientMessage): void {
    if (
      this.ws &&
      this.ws.readyState === WebSocket.OPEN &&
      this.isAuthenticated
    ) {
      this.ws.send(JSON.stringify(msg));
      return;
    }
    // Queue idempotent gameplay action so brief drops don't lose the player's click
    if (msg.type !== 'ping') {
      this.pendingMessages.push(msg);
      if (this.pendingMessages.length > 10) {
        this.pendingMessages.shift();
      }
    }
  }

  private flushPendingQueue(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isAuthenticated) {
      return;
    }
    while (this.pendingMessages.length > 0) {
      const next = this.pendingMessages.shift()!;
      this.ws.send(JSON.stringify(next));
    }
  }

  // -------------------------------------------------------------------------
  // High-Level Idempotent Actions
  // -------------------------------------------------------------------------

  public setReady(ready: boolean): string {
    const actionId = createActionId();
    this.sendOrQueue({
      protocolVersion: PROTOCOL_VERSION,
      type: 'set_ready',
      actionId,
      ready,
    });
    return actionId;
  }

  public selectSeat(canonicalSeat: Seat): string {
    const actionId = createActionId();
    this.sendOrQueue({
      protocolVersion: PROTOCOL_VERSION,
      type: 'select_seat',
      actionId,
      canonicalSeat,
    });
    return actionId;
  }

  public startMatch(): string {
    const actionId = createActionId();
    this.sendOrQueue({
      protocolVersion: PROTOCOL_VERSION,
      type: 'start_match',
      actionId,
    });
    return actionId;
  }

  public chooseTrump(suit: Suit): string {
    const actionId = createActionId();
    this.sendOrQueue({
      protocolVersion: PROTOCOL_VERSION,
      type: 'choose_trump',
      actionId,
      suit,
    });
    return actionId;
  }

  public playCard(cardId: string): string {
    const actionId = createActionId();
    this.sendOrQueue({
      protocolVersion: PROTOCOL_VERSION,
      type: 'play_card',
      actionId,
      cardId,
    });
    return actionId;
  }

  public leaveRoom(): string {
    const actionId = createActionId();
    this.sendOrQueue({
      protocolVersion: PROTOCOL_VERSION,
      type: 'leave_room',
      actionId,
    });
    return actionId;
  }

  public requestRematch(): string {
    const actionId = createActionId();
    this.sendOrQueue({
      protocolVersion: PROTOCOL_VERSION,
      type: 'rematch',
      actionId,
    });
    return actionId;
  }

  public requestSync(): void {
    this.sendOrQueue({
      protocolVersion: PROTOCOL_VERSION,
      type: 'request_sync',
    });
  }
}
