import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import worker from './index';
import { HokmRoomDO } from './HokmRoomDO';
import { persistCompletedMatchToD1 } from './lib/d1Persistence';
import {
  CfWorkerEnv,
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1RunResult,
  DurableObjectStateLike,
  DurableObjectStorageLike,
  HibernatableWebSocket,
  R2BucketLike,
} from './lib/types';
import {
  CompletedMatchRecord,
  PROTOCOL_VERSION,
  ServerMessage,
} from '../../src/games/hokm/online/protocol';
import { Suit } from '../../src/games/hokm/engine/types';
import { getLegalCards } from '../../src/games/hokm/engine/rules';

// ---------------------------------------------------------------------------
// Authentic Cloudflare Workers + DO Hibernation + Storage + Alarm + D1 Harness
// ---------------------------------------------------------------------------

function makeSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * Simulates Cloudflare Durable Object Storage with deep structuredClone isolation
 * (catches any accidental non-serializable values like functions/sockets/Maps).
 */
class FakeDurableObjectStorage implements DurableObjectStorageLike {
  public readonly store = new Map<string, unknown>();
  public alarmAt: number | null = null;

  async get<T = unknown>(key: string): Promise<T | undefined> {
    if (!this.store.has(key)) return undefined;
    return structuredClone(this.store.get(key)) as T;
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    this.store.set(key, structuredClone(value));
  }

  async delete(key: string | string[]): Promise<boolean | number> {
    if (Array.isArray(key)) {
      let count = 0;
      for (const k of key) {
        if (this.store.delete(k)) count += 1;
      }
      return count;
    }
    return this.store.delete(key);
  }

  async deleteAll(): Promise<void> {
    this.store.clear();
  }

  async setAlarm(scheduledTime: number | Date): Promise<void> {
    this.alarmAt =
      scheduledTime instanceof Date ? scheduledTime.getTime() : scheduledTime;
  }

  async getAlarm(): Promise<number | null> {
    return this.alarmAt;
  }

  async deleteAlarm(): Promise<void> {
    this.alarmAt = null;
  }
}

/**
 * Simulates Cloudflare Hibernatable WebSocket endpoint with serialized attachments
 * that survive DO instance eviction & cold restart.
 */
class FakeHibernatableWebSocket implements HibernatableWebSocket {
  public readyState = 1; // OPEN
  public peer: FakeHibernatableWebSocket | null = null;
  public readonly received: string[] = [];
  public closedCode: number | null = null;
  public closedReason: string | null = null;
  public onServerClose?: (code: number, reason: string) => void;
  private attachment: unknown = null;

  send(message: string | ArrayBuffer): void {
    if (this.readyState !== 1) {
      throw new Error('WebSocket is not open');
    }
    if (this.peer && this.peer.readyState === 1) {
      this.peer.received.push(
        typeof message === 'string'
          ? message
          : new TextDecoder().decode(message)
      );
    }
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closedCode = code;
    this.closedReason = reason;
    if (this.peer && this.peer.readyState !== 3) {
      this.peer.readyState = 3;
      this.peer.closedCode = code;
      this.peer.closedReason = reason;
    }
    this.onServerClose?.(code, reason);
  }

  serializeAttachment(attachment: unknown): void {
    this.attachment = structuredClone(attachment);
  }

  deserializeAttachment(): unknown {
    return structuredClone(this.attachment);
  }

  parsedMessages(): ServerMessage[] {
    return this.received.map((raw) => JSON.parse(raw) as ServerMessage);
  }

  drainMessages(): ServerMessage[] {
    const out = this.parsedMessages();
    this.received.length = 0;
    return out;
  }
}

class FakeWebSocketPair {
  0: FakeHibernatableWebSocket;
  1: FakeHibernatableWebSocket;

  constructor() {
    const client = new FakeHibernatableWebSocket();
    const server = new FakeHibernatableWebSocket();
    client.peer = server;
    server.peer = client;
    this[0] = client;
    this[1] = server;
  }
}

/**
 * Simulates DurableObjectState persisting BOTH storage AND accepted hibernated
 * WebSockets across DO instance destruction/reconstruction.
 */
class FakeDurableObjectState implements DurableObjectStateLike {
  public readonly storage = new FakeDurableObjectStorage();
  private readonly accepted: Array<{
    ws: FakeHibernatableWebSocket;
    tags: string[];
  }> = [];
  private gate: Promise<unknown> = Promise.resolve();

  acceptWebSocket(ws: HibernatableWebSocket, tags: string[] = []): void {
    const sock = ws as FakeHibernatableWebSocket;
    this.accepted.push({ ws: sock, tags: [...tags] });
  }

  getWebSockets(tag?: string): HibernatableWebSocket[] {
    return this.accepted
      .filter(
        (entry) =>
          entry.ws.readyState === 1 && (!tag || entry.tags.includes(tag))
      )
      .map((entry) => entry.ws);
  }

  async blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    const prev = this.gate;
    let release!: () => void;
    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await callback();
    } finally {
      release();
    }
  }
}

/**
 * Real SQLite-backed D1 simulator running the ACTUAL Cloudflare D1 migrations
 * (`0001_init.sql` + `0002_indexes.sql`), with fault injection for outage testing.
 */
class SqliteBackedD1 implements D1DatabaseLike {
  public readonly sqlite: Database.Database;
  public failNextBatchCount = 0;
  public failNextQueryCount = 0;

  constructor() {
    this.sqlite = new Database(':memory:');
    this.sqlite.pragma('foreign_keys = ON');

    const initSql = fs.readFileSync(
      path.resolve(process.cwd(), 'cloudflare/migrations/0001_init.sql'),
      'utf8'
    );
    const idxSql = fs.readFileSync(
      path.resolve(process.cwd(), 'cloudflare/migrations/0002_indexes.sql'),
      'utf8'
    );
    const canonSql = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'cloudflare/migrations/0003_username_canonical_key.sql'
      ),
      'utf8'
    );
    this.sqlite.exec(initSql);
    this.sqlite.exec(idxSql);
    this.sqlite.exec(canonSql);
  }

  prepare(query: string): D1PreparedStatementLike {
    return this.makeBoundStmt(query, []);
  }

  private makeBoundStmt(
    query: string,
    params: unknown[]
  ): D1PreparedStatementLike & { __query: string; __params: unknown[] } {
    const self = this;
    return {
      __query: query,
      __params: params,
      bind(...values: unknown[]) {
        return self.makeBoundStmt(query, values);
      },
      async run(): Promise<D1RunResult> {
        if (self.failNextQueryCount > 0) {
          self.failNextQueryCount -= 1;
          throw new Error('Simulated D1 query outage');
        }
        const info = self.sqlite.prepare(query).run(...params);
        return {
          success: true,
          meta: {
            changes: info.changes,
            last_row_id: Number(info.lastInsertRowid ?? 0),
          },
        };
      },
      async all<T = unknown>(): Promise<{ results: T[]; success?: boolean }> {
        if (self.failNextQueryCount > 0) {
          self.failNextQueryCount -= 1;
          throw new Error('Simulated D1 query outage');
        }
        const results = self.sqlite.prepare(query).all(...params) as T[];
        return { results, success: true };
      },
      async first<T = unknown>(): Promise<T | null> {
        if (self.failNextQueryCount > 0) {
          self.failNextQueryCount -= 1;
          throw new Error('Simulated D1 query outage');
        }
        const row = self.sqlite.prepare(query).get(...params) as T | undefined;
        return row ?? null;
      },
    };
  }

  async batch(statements: D1PreparedStatementLike[]): Promise<D1RunResult[]> {
    if (this.failNextBatchCount > 0) {
      this.failNextBatchCount -= 1;
      throw new Error('Simulated D1 transient batch failure');
    }
    const tx = this.sqlite.transaction(
      (
        stmts: Array<
          D1PreparedStatementLike & { __query?: string; __params?: unknown[] }
        >
      ) => {
        const out: D1RunResult[] = [];
        for (const s of stmts) {
          const info = this.sqlite
            .prepare(s.__query!)
            .run(...(s.__params ?? []));
          out.push({
            success: true,
            meta: {
              changes: info.changes,
              last_row_id: Number(info.lastInsertRowid ?? 0),
            },
          });
        }
        return out;
      }
    );
    return tx(statements);
  }

  close(): void {
    this.sqlite.close();
  }
}

interface RoomSlot {
  state: FakeDurableObjectState;
  instance: HokmRoomDO;
}

/**
 * Full simulated Cloudflare Worker + Durable Object cluster.
 * Supports true `simulateColdRestart(roomCode)` which destroys the in-memory
 * `HokmRoomDO` JS object completely while preserving `DurableObjectStorage`
 * and Hibernated WebSockets + attachments.
 */
class CloudflareClusterHarness {
  public clock = 1_730_000_000_000;
  public readonly d1 = new SqliteBackedD1();
  public readonly rooms = new Map<string, RoomSlot>();
  public readonly env: CfWorkerEnv;
  private readonly rng: () => number;

  constructor(options?: {
    seed?: number;
    allowedOrigins?: string;
    disconnectGraceMs?: number;
    roomCleanupTtlMs?: number;
  }) {
    this.rng = makeSeededRng(options?.seed ?? 2026);
    const self = this;

    const r2: R2BucketLike = {
      async get() {
        return null;
      },
    };

    this.env = {
      EYVAN_DB: this.d1,
      EYVAN_ASSETS: r2,
      ALLOWED_ORIGINS: options?.allowedOrigins ?? 'https://eyvan.example',
      DISCONNECT_GRACE_MS: String(options?.disconnectGraceMs ?? 60_000),
      ROOM_CLEANUP_TTL_MS: String(options?.roomCleanupTtlMs ?? 300_000),
      HOKM_ROOM: {
        idFromName(name: string) {
          return name;
        },
        get(id: unknown) {
          const roomKey = String(id);
          return {
            async fetch(req: Request) {
              const slot = self.getOrCreateSlot(roomKey);
              return slot.instance.fetch(req);
            },
          };
        },
      },
    };
  }

  public getOrCreateSlot(roomCode: string): RoomSlot {
    let slot = this.rooms.get(roomCode);
    if (!slot) {
      const state = new FakeDurableObjectState();
      const instance = this.buildDOInstance(state);
      slot = { state, instance };
      this.rooms.set(roomCode, slot);
    }
    return slot;
  }

  private buildDOInstance(state: FakeDurableObjectState): HokmRoomDO {
    return new HokmRoomDO(state, this.env, {
      now: () => this.clock,
      rng: this.rng,
      trickCollectDelayMs: 900,
      nextHandDelayMs: 1_400,
    });
  }

  /**
   * Simulates Cloudflare Hibernation Eviction / Cold Restart:
   * Discards the entire JS `HokmRoomDO` instance and constructs a brand-new one
   * wired to the same `FakeDurableObjectStorage` + Hibernated WebSockets!
   */
  public simulateColdRestart(roomCode: string): HokmRoomDO {
    const slot = this.rooms.get(roomCode);
    assert.ok(slot, `Expected room slot for ${roomCode}`);
    slot.instance = this.buildDOInstance(slot.state);
    return slot.instance;
  }

  public async fetch(
    pathname: string,
    init?: RequestInit & { origin?: string }
  ): Promise<Response> {
    const headers = new Headers(init?.headers ?? {});
    if (init?.origin) {
      headers.set('Origin', init.origin);
    }
    const req = new Request(`https://api.eyvan.example${pathname}`, {
      ...init,
      headers,
    });
    return worker.fetch(req, this.env);
  }

  public async connectWebSocket(
    roomCode: string,
    origin = 'https://eyvan.example',
    cookie?: string
  ): Promise<{
    client: FakeHibernatableWebSocket;
    server: FakeHibernatableWebSocket;
    response: Response;
  }> {
    const reqHeaders: Record<string, string> = { Upgrade: 'websocket' };
    if (cookie) {
      reqHeaders['Cookie'] = cookie;
    }
    const response = await this.fetch(`/ws/rooms/${roomCode}`, {
      method: 'GET',
      headers: reqHeaders,
      origin,
    });
    const client = (
      response as Response & { webSocket?: FakeHibernatableWebSocket }
    ).webSocket!;
    const server = client?.peer ?? null;
    return {
      client,
      server: server!,
      response,
    };
  }

  public async sendWs(
    roomCode: string,
    serverWs: FakeHibernatableWebSocket,
    payload: unknown
  ): Promise<void> {
    const slot = this.getOrCreateSlot(roomCode);
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    await slot.instance.webSocketMessage(serverWs, raw);
  }

  public async closeWs(
    roomCode: string,
    serverWs: FakeHibernatableWebSocket,
    code = 1006,
    reason = 'network_drop'
  ): Promise<void> {
    const slot = this.getOrCreateSlot(roomCode);
    serverWs.close(code, reason);
    await slot.instance.webSocketClose(serverWs, code, reason, code === 1000);
  }

  public async triggerAlarm(roomCode: string): Promise<void> {
    const slot = this.getOrCreateSlot(roomCode);
    await slot.instance.alarm();
  }

  public close(): void {
    this.d1.close();
  }
}

// Install Cloudflare workerd shims (`WebSocketPair` + `status: 101` Response) for test run
const OriginalResponse = globalThis.Response;
const OriginalWebSocketPair = (
  globalThis as unknown as { WebSocketPair?: unknown }
).WebSocketPair;

before(() => {
  (globalThis as unknown as { WebSocketPair: unknown }).WebSocketPair =
    FakeWebSocketPair;

  const CfResponse = class extends OriginalResponse {
    public readonly webSocket?: HibernatableWebSocket;
    constructor(
      body?: BodyInit | null,
      init?: ResponseInit & { webSocket?: HibernatableWebSocket }
    ) {
      if (init?.status === 101 && init.webSocket) {
        super(null, { status: 200 });
        Object.defineProperty(this, 'status', { value: 101 });
        this.webSocket = init.webSocket;
      } else {
        super(body, init);
      }
    }
  };
  (globalThis as unknown as { Response: typeof Response }).Response =
    CfResponse as unknown as typeof Response;
});

after(() => {
  (globalThis as unknown as { Response: typeof Response }).Response =
    OriginalResponse;
  if (OriginalWebSocketPair === undefined) {
    delete (globalThis as unknown as { WebSocketPair?: unknown }).WebSocketPair;
  } else {
    (globalThis as unknown as { WebSocketPair: unknown }).WebSocketPair =
      OriginalWebSocketPair;
  }
});

// ---------------------------------------------------------------------------
// Helper to create & authenticate a 4-player online room through Worker + DO
// ---------------------------------------------------------------------------

interface JoinedPlayer {
  username: string;
  playerId: string;
  canonicalSeat: 'south' | 'east' | 'north' | 'west';
  cookiePair: string;
  cookieTokenSecret: string;
  client: FakeHibernatableWebSocket;
  server: FakeHibernatableWebSocket;
}

function extractSessionSecretFromCookiePair(cookiePair: string): string {
  const raw = decodeURIComponent(cookiePair.split('=').slice(1).join('='));
  const segments = raw.split('.');
  return segments[2] ?? '';
}

async function createFourPlayerAuthenticatedRoom(
  cluster: CloudflareClusterHarness,
  targetMatchScore = 3
): Promise<{ roomCode: string; players: JoinedPlayer[] }> {
  const names = ['amir_pro', 'sara_hokm', 'reza_ace', 'neda_king'];

  // 1) Host creates room via Worker POST /api/rooms (token stays strictly in HttpOnly Set-Cookie)
  const createRes = await cluster.fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    origin: 'https://eyvan.example',
    body: JSON.stringify({
      username: names[0],
      avatarCode: 'portrait',
      targetMatchScore,
    }),
  });
  assert.equal(createRes.status, 201);
  const createSetCookie = createRes.headers.get('Set-Cookie');
  assert.ok(createSetCookie && createSetCookie.includes('eyvan_hokm_sess='));
  const createCookiePair = createSetCookie.split(';')[0];
  const createRawText = await createRes.text();
  assert.equal(
    createRawText.includes('sessionToken'),
    false,
    'POST /api/rooms JSON must NEVER contain sessionToken'
  );
  const created = JSON.parse(createRawText) as {
    roomCode: string;
    playerId: string;
    canonicalSeat: 'south' | 'east' | 'north' | 'west';
  };
  const roomCode = created.roomCode;

  const joinedList: Array<{
    username: string;
    playerId: string;
    canonicalSeat: 'south' | 'east' | 'north' | 'west';
    cookiePair: string;
    cookieTokenSecret: string;
  }> = [
    {
      username: names[0],
      playerId: created.playerId,
      canonicalSeat: created.canonicalSeat,
      cookiePair: createCookiePair,
      cookieTokenSecret: extractSessionSecretFromCookiePair(createCookiePair),
    },
  ];

  // 2) Remaining 3 players join via Worker POST /api/rooms/:code/join
  for (let i = 1; i < names.length; i++) {
    const joinRes = await cluster.fetch(`/api/rooms/${roomCode}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      origin: 'https://eyvan.example',
      body: JSON.stringify({
        username: names[i],
        avatarCode: 'avatar_' + i,
      }),
    });
    assert.equal(joinRes.status, 200);
    const joinSetCookie = joinRes.headers.get('Set-Cookie');
    assert.ok(joinSetCookie && joinSetCookie.includes('eyvan_hokm_sess='));
    const joinCookiePair = joinSetCookie.split(';')[0];
    const joinRawText = await joinRes.text();
    assert.equal(
      joinRawText.includes('sessionToken'),
      false,
      'POST /api/rooms/:code/join JSON must NEVER contain sessionToken'
    );
    const j = JSON.parse(joinRawText) as {
      playerId: string;
      canonicalSeat: 'south' | 'east' | 'north' | 'west';
    };
    joinedList.push({
      username: names[i],
      playerId: j.playerId,
      canonicalSeat: j.canonicalSeat,
      cookiePair: joinCookiePair,
      cookieTokenSecret: extractSessionSecretFromCookiePair(joinCookiePair),
    });
  }

  // 3) All 4 open Hibernatable WebSockets authenticated via HttpOnly Cookie -> immediate `auth_ok` -> `set_ready`
  const players: JoinedPlayer[] = [];
  for (let i = 0; i < joinedList.length; i++) {
    const p = joinedList[i];
    const conn = await cluster.connectWebSocket(
      roomCode,
      'https://eyvan.example',
      p.cookiePair
    );
    assert.equal(conn.response.status, 101);
    const msgs = conn.client.drainMessages();
    assert.equal(msgs[0]?.type, 'auth_ok');

    await cluster.sendWs(roomCode, conn.server, {
      protocolVersion: PROTOCOL_VERSION,
      type: 'set_ready',
      actionId: `ready_p${i}_12345678`,
      ready: true,
    });

    players.push({
      ...p,
      client: conn.client,
      server: conn.server,
    });
  }

  // Clear setup traffic
  for (const p of players) p.client.drainMessages();
  return { roomCode, players };
}

// ---------------------------------------------------------------------------
// Test Suite Covering All 12 Mandatory Backend Reliability Scenarios
// ---------------------------------------------------------------------------

describe('Cloudflare HokmRoomDO + Worker + D1 Reliability Suite', () => {
  it('Scenario 1 & 5 (Security/HTTP): creates room, joins 4 players, blocks 5th, enforces Origin/CORS, malformed JSON & room-code collision guard', async () => {
    const cluster = new CloudflareClusterHarness();
    try {
      // Disallowed Origin blocked with 403 on POST and WS upgrade
      const evilPost = await cluster.fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        origin: 'https://evil-attacker.invalid',
        body: JSON.stringify({ username: 'hacker01' }),
      });
      assert.equal(evilPost.status, 403);
      assert.equal(evilPost.headers.get('Access-Control-Allow-Origin'), null);

      const evilWs = await cluster.fetch('/ws/rooms/ABC123', {
        method: 'GET',
        headers: { Upgrade: 'websocket' },
        origin: 'https://evil-attacker.invalid',
      });
      assert.equal(evilWs.status, 403);

      // Malformed JSON -> 400 (never 500)
      const badJson = await cluster.fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        origin: 'https://eyvan.example',
        body: '{invalid-json',
      });
      assert.equal(badJson.status, 400);

      // Oversized payload > 16KB -> 413
      const hugePayload = await cluster.fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        origin: 'https://eyvan.example',
        body: JSON.stringify({ username: 'amir_pro', padding: 'x'.repeat(20_000) }),
      });
      assert.equal(hugePayload.status, 413);

      // Valid 4-player creation & join
      const { roomCode } = await createFourPlayerAuthenticatedRoom(cluster);

      // 5th player strictly blocked with 409 ROOM_FULL
      const fifth = await cluster.fetch(`/api/rooms/${roomCode}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        origin: 'https://eyvan.example',
        body: JSON.stringify({ username: 'fifth_user' }),
      });
      assert.equal(fifth.status, 409);
      const fifthBody = (await fifth.json()) as { code: string };
      assert.equal(fifthBody.code, 'ROOM_FULL');

      // Direct DO collision guard: attempting /create on an active room returns 409 ROOM_EXISTS
      const slot = cluster.getOrCreateSlot(roomCode);
      const collisionRes = await slot.instance.fetch(
        new Request(`https://room.internal/create?code=${roomCode}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'other_host' }),
        })
      );
      assert.equal(collisionRes.status, 409);
      const collBody = (await collisionRes.json()) as { code: string };
      assert.equal(collBody.code, 'ROOM_EXISTS');

      // Public summary never exposes tokens
      const sumRes = await cluster.fetch(`/api/rooms/${roomCode}`, {
        method: 'GET',
        origin: 'https://eyvan.example',
      });
      assert.equal(sumRes.status, 200);
      assert.equal(
        sumRes.headers.get('Access-Control-Allow-Origin'),
        'https://eyvan.example'
      );
      const summaryText = await sumRes.text();
      assert.equal(summaryText.includes('sessionToken'), false);
    } finally {
      cluster.close();
    }
  });

  it('Scenario 2, 3 & 6: survives DO hibernation/cold restart mid-match AND executes trick_collect + next_hand alarms accurately after restart (including duplicate alarm delivery)', async () => {
    const cluster = new CloudflareClusterHarness({ seed: 777 });
    try {
      const { roomCode, players } = await createFourPlayerAuthenticatedRoom(
        cluster,
        3
      );

      // Start match (host)
      await cluster.sendWs(roomCode, players[0].server, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'start_match',
        actionId: 'start_match_0001',
      });

      const getLatestSnap = (p: JoinedPlayer) => {
        const msgs = p.client.parsedMessages();
        const syncs = msgs.filter(
          (m) => m.type === 'state_sync' || m.type === 'auth_ok'
        );
        const last = syncs[syncs.length - 1];
        assert.ok(last && 'snapshot' in last);
        return last.snapshot;
      };

      const snap0 = getLatestSnap(players[0]);
      assert.equal(snap0.status, 'PLAYING');
      assert.equal(snap0.game?.phase, 'CHOOSING_TRUMP');

      // Find Hakem and choose trump
      const hakemSeat = snap0.game!.hakem;
      const hakem = players.find((p) => p.canonicalSeat === hakemSeat)!;
      await cluster.sendWs(roomCode, hakem.server, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'choose_trump',
        actionId: 'choose_trump_0001',
        suit: 'hearts',
      });

      // Play 2 cards of Trick 1, then SIMULATE FULL COLD RESTART mid-trick!
      for (let i = 0; i < 2; i++) {
        const curSnap = getLatestSnap(players[0]);
        const turnSeat = curSnap.game!.currentTurn;
        const actor = players.find((p) => p.canonicalSeat === turnSeat)!;
        const actorSnap = getLatestSnap(actor);
        const legal = getLegalCards(
          actorSnap.game!.myHand,
          actorSnap.game!.currentTrick
        );
        await cluster.sendWs(roomCode, actor.server, {
          protocolVersion: PROTOCOL_VERSION,
          type: 'play_card',
          actionId: `trick1_card_${i}_1234`,
          cardId: legal[0].id,
        });
      }

      const preRestartSnap = getLatestSnap(players[0]);
      assert.equal(preRestartSnap.game?.currentTrick.length, 2);
      assert.equal(preRestartSnap.game?.trumpSuit, 'hearts');

      // *** SIMULATE CLOUDFLARE DO EVICTION / HIBERNATION COLD RESTART ***
      cluster.simulateColdRestart(roomCode);

      // Existing hibernated WebSocket requests sync directly from brand-new DO instance!
      players[0].client.drainMessages();
      await cluster.sendWs(roomCode, players[0].server, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'request_sync',
      });
      const postRestartSnap = getLatestSnap(players[0]);
      assert.equal(postRestartSnap.status, 'PLAYING');
      assert.equal(postRestartSnap.game?.trumpSuit, 'hearts');
      assert.equal(postRestartSnap.game?.currentTrick.length, 2);
      assert.equal(
        postRestartSnap.game?.currentTurn,
        preRestartSnap.game?.currentTurn
      );
      assert.deepEqual(
        postRestartSnap.game?.myHand.map((c) => c.id),
        preRestartSnap.game?.myHand.map((c) => c.id)
      );

      // Play remaining 2 cards of Trick 1 so phase becomes TRICK_COMPLETE & alarm is scheduled
      for (let i = 2; i < 4; i++) {
        const curSnap = getLatestSnap(players[0]);
        const turnSeat = curSnap.game!.currentTurn;
        const actor = players.find((p) => p.canonicalSeat === turnSeat)!;
        const actorSnap = getLatestSnap(actor);
        const legal = getLegalCards(
          actorSnap.game!.myHand,
          actorSnap.game!.currentTrick
        );
        await cluster.sendWs(roomCode, actor.server, {
          protocolVersion: PROTOCOL_VERSION,
          type: 'play_card',
          actionId: `trick1_card_${i}_1234`,
          cardId: legal[0].id,
        });
      }

      const trickDoneSnap = getLatestSnap(players[0]);
      assert.equal(trickDoneSnap.game?.phase, 'TRICK_COMPLETE');
      const slot = cluster.getOrCreateSlot(roomCode);
      assert.ok(slot.state.storage.alarmAt !== null, 'Alarm must be persisted');

      // *** SIMULATE SECOND COLD RESTART BEFORE TRICK_COLLECT ALARM FIRES ***
      cluster.simulateColdRestart(roomCode);

      // Advance clock past trickCollectDelayMs and fire alarm on the fresh DO instance
      cluster.clock += 1_000;
      await cluster.triggerAlarm(roomCode);

      const afterCollectSnap = getLatestSnap(players[0]);
      assert.equal(afterCollectSnap.game?.phase, 'PLAYING_TRICK');
      assert.equal(afterCollectSnap.game?.completedTricksCount, 1);
      assert.equal(afterCollectSnap.game?.currentTrick.length, 0);
      const versionAfterCollect = afterCollectSnap.stateVersion;

      // Duplicate alarm delivery MUST be an idempotent no-op
      await cluster.triggerAlarm(roomCode);
      players[0].client.drainMessages();
      await cluster.sendWs(roomCode, players[0].server, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'request_sync',
      });
      assert.equal(
        getLatestSnap(players[0]).stateVersion,
        versionAfterCollect
      );

      // Finish rest of Hand 1 until HAND_COMPLETE, then cold-restart BEFORE next_hand alarm!
      let seq = 10;
      while (getLatestSnap(players[0]).game?.phase !== 'HAND_COMPLETE') {
        const cur = getLatestSnap(players[0]);
        if (cur.game?.phase === 'TRICK_COMPLETE') {
          cluster.clock += 1_000;
          await cluster.triggerAlarm(roomCode);
          continue;
        }
        const actor = players.find(
          (p) => p.canonicalSeat === cur.game!.currentTurn
        )!;
        const actorSnap = getLatestSnap(actor);
        const legal = getLegalCards(
          actorSnap.game!.myHand,
          actorSnap.game!.currentTrick
        );
        await cluster.sendWs(roomCode, actor.server, {
          protocolVersion: PROTOCOL_VERSION,
          type: 'play_card',
          actionId: `hand1_play_${++seq}_1234`,
          cardId: legal[0].id,
        });
      }

      assert.equal(getLatestSnap(players[0]).game?.phase, 'HAND_COMPLETE');
      assert.equal(getLatestSnap(players[0]).game?.handNumber, 1);

      // *** COLD RESTART BEFORE next_hand ALARM ***
      cluster.simulateColdRestart(roomCode);
      cluster.clock += 1_500;
      await cluster.triggerAlarm(roomCode);

      const hand2Snap = getLatestSnap(players[0]);
      assert.equal(hand2Snap.game?.handNumber, 2);
      assert.equal(hand2Snap.game?.phase, 'CHOOSING_TRUMP');
      assert.equal(hand2Snap.game?.myHand.length, 5);
    } finally {
      cluster.close();
    }
  });

  it('Scenario 4 & 5: disconnect/reconnect recovery, cookie-upgrade token/seat rejection, AND concurrent reconnect immunity against stale socket close/messages', async () => {
    const cluster = new CloudflareClusterHarness({ seed: 303 });
    try {
      const { roomCode, players } = await createFourPlayerAuthenticatedRoom(
        cluster
      );
      await cluster.sendWs(roomCode, players[0].server, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'start_match',
        actionId: 'start_reconn_001',
      });

      const target = players[1];
      const oldServer = target.server;
      const oldClient = target.client;

      // 1a) Missing cookie on WS upgrade rejected with 401 BEFORE opening WS
      const missingCookieWs = await cluster.connectWebSocket(
        roomCode,
        'https://eyvan.example'
      );
      assert.equal(missingCookieWs.response.status, 401);
      assert.equal(missingCookieWs.client, undefined);

      // 1b) Wrong session token in cookie rejected at WS upgrade with 401 + cleared cookie
      const badTokenCookie = `eyvan_hokm_sess=${encodeURIComponent(
        `${roomCode}.${target.playerId}.deadbeefdeadbeefdeadbeefdeadbeef`
      )}`;
      const intruder = await cluster.connectWebSocket(
        roomCode,
        'https://eyvan.example',
        badTokenCookie
      );
      assert.equal(intruder.response.status, 401);
      assert.ok(intruder.response.headers.get('Set-Cookie')?.includes('Max-Age=0'));

      // 2a) Wrong roomCode cookie rejected with 401
      const wrongRoomCookie = `eyvan_hokm_sess=${encodeURIComponent(
        `ZZZZZZ.${target.playerId}.${target.cookieTokenSecret}`
      )}`;
      const wrongRoomConn = await cluster.connectWebSocket(
        roomCode,
        'https://eyvan.example',
        wrongRoomCookie
      );
      assert.equal(wrongRoomConn.response.status, 401);

      // 2b) Cross-seat tampering: Player 0's token paired with target.playerId rejected with 401
      const crossSeatCookie = `eyvan_hokm_sess=${encodeURIComponent(
        `${roomCode}.${target.playerId}.${players[0].cookieTokenSecret}`
      )}`;
      const crossSeatConn = await cluster.connectWebSocket(
        roomCode,
        'https://eyvan.example',
        crossSeatCookie
      );
      assert.equal(crossSeatConn.response.status, 401);

      // 2c) Legacy WS `{ type: 'auth' }` message rejected as INVALID_MESSAGE
      target.client.drainMessages();
      await cluster.sendWs(roomCode, target.server, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'auth',
        roomCode,
        playerId: target.playerId,
        sessionToken: target.cookieTokenSecret,
      });
      const legacyAuthErr = target.client.drainMessages()[0];
      assert.equal(legacyAuthErr?.type, 'error');
      if (legacyAuthErr?.type === 'error') {
        assert.equal(legacyAuthErr.code, 'INVALID_MESSAGE');
      }

      // 3) CONCURRENT RECONNECT via valid HttpOnly cookie: target opens ws2 BEFORE ws1 closes!
      const newConn = await cluster.connectWebSocket(
        roomCode,
        'https://eyvan.example',
        target.cookiePair
      );
      assert.equal(newConn.response.status, 101);

      // Old socket MUST be notified SUPERSEDED_CONNECTION and closed with 4001
      assert.equal(oldServer.closedCode, 4001);
      const oldMsgs = oldClient.drainMessages();
      assert.ok(
        oldMsgs.some(
          (m) => m.type === 'error' && m.code === 'SUPERSEDED_CONNECTION'
        )
      );

      // New socket MUST receive auth_ok with player's exact 5-card hand immediately upon upgrade
      const newMsgs = newConn.client.drainMessages();
      assert.equal(newMsgs[0]?.type, 'auth_ok');
      if (newMsgs[0]?.type === 'auth_ok') {
        assert.equal(newMsgs[0].snapshot.game?.myHand.length, 5);
      }

      // 4) RACE SIMULATION: delayed webSocketClose AND stray message arrive from STALE oldServer!
      const slot = cluster.getOrCreateSlot(roomCode);
      await slot.instance.webSocketClose(oldServer, 4001, 'superseded', true);
      await slot.instance.webSocketMessage(
        oldServer,
        JSON.stringify({
          protocolVersion: PROTOCOL_VERSION,
          type: 'leave_room',
          actionId: 'stale_leave_1234',
        })
      );

      // Target player MUST STILL be connected & active on newConn!
      players[0].client.drainMessages();
      await cluster.sendWs(roomCode, players[0].server, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'request_sync',
      });
      const hostView = players[0].client.drainMessages()[0];
      assert.equal(hostView?.type, 'state_sync');
      if (hostView?.type === 'state_sync') {
        const targetSeatView = hostView.snapshot.seats.find(
          (s) => s.canonicalSeat === target.canonicalSeat
        );
        assert.equal(targetSeatView?.connected, true);
        assert.equal(targetSeatView?.disconnectDeadline, null);
      }

      // 5) Genuine disconnect of active newConn -> notifies others, then reconnects cleanly across DO cold restart
      await cluster.closeWs(roomCode, newConn.server, 1006, 'mobile_drop');
      const discNotice = players[0].client
        .drainMessages()
        .find(
          (m) =>
            m.type === 'state_sync' && m.event?.type === 'PLAYER_DISCONNECTED'
        );
      assert.ok(discNotice, 'Host should receive PLAYER_DISCONNECTED notice');

      // Advance 20s (within 60s grace), cold restart DO, then reconnect via cookie
      cluster.clock += 20_000;
      cluster.simulateColdRestart(roomCode);
      const recoveredConn = await cluster.connectWebSocket(
        roomCode,
        'https://eyvan.example',
        target.cookiePair
      );
      assert.equal(recoveredConn.response.status, 101);
      const recAuth = recoveredConn.client.drainMessages()[0];
      assert.equal(recAuth?.type, 'auth_ok');
      if (recAuth?.type === 'auth_ok') {
        assert.equal(recAuth.snapshot.game?.myHand.length, 5);
        const me = recAuth.snapshot.seats.find(
          (s) => s.canonicalSeat === target.canonicalSeat
        );
        assert.equal(me?.connected, true);
      }
    } finally {
      cluster.close();
    }
  });

  it('Scenario 7, 8 & 9: idempotent actions across DO restart, illegal move rejection, oversized WS payload guard, and ZERO card/token privacy leaks', async () => {
    const cluster = new CloudflareClusterHarness({ seed: 909 });
    try {
      const { roomCode, players } = await createFourPlayerAuthenticatedRoom(
        cluster
      );
      await cluster.sendWs(roomCode, players[0].server, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'start_match',
        actionId: 'start_sec_0001',
      });

      const getSnap = (p: JoinedPlayer) => {
        const msgs = p.client.parsedMessages();
        const sync = [...msgs]
          .reverse()
          .find((m) => m.type === 'state_sync' || m.type === 'auth_ok');
        assert.ok(sync && 'snapshot' in sync);
        return sync.snapshot;
      };

      const snap0 = getSnap(players[0]);
      const hakem = players.find(
        (p) => p.canonicalSeat === snap0.game!.hakem
      )!;
      const nonHakem = players.find(
        (p) => p.canonicalSeat !== snap0.game!.hakem
      )!;

      // Oversized WS message > 8KB rejected gracefully
      nonHakem.client.drainMessages();
      await cluster.sendWs(roomCode, nonHakem.server, 'a'.repeat(9_000));
      const sizeErr = nonHakem.client.drainMessages()[0];
      assert.equal(sizeErr?.type, 'error');
      if (sizeErr?.type === 'error') {
        assert.equal(sizeErr.code, 'INVALID_MESSAGE');
      }

      // Non-Hakem trump choice rejected
      await cluster.sendWs(roomCode, nonHakem.server, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'choose_trump',
        actionId: 'non_hakem_trump_1',
        suit: 'clubs',
      });
      const trumpErr = nonHakem.client.drainMessages()[0];
      assert.equal(trumpErr?.type, 'error');
      if (trumpErr?.type === 'error') {
        assert.equal(trumpErr.code, 'NOT_HAKEM');
      }

      // Hakem chooses trump
      await cluster.sendWs(roomCode, hakem.server, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'choose_trump',
        actionId: 'hakem_trump_0001',
        suit: 'spades',
      });

      // Strictly audit card & token secrecy across ALL 4 players' received WS frames
      const cardSets = players.map((p) => {
        const s = getSnap(p);
        assert.equal(s.game?.myHand.length, 13);
        return new Set(s.game!.myHand.map((c) => c.id));
      });
      for (let i = 0; i < players.length; i++) {
        const allRawTraffic = players[i].client.received.join('\n');
        assert.equal(
          allRawTraffic.includes('sessionToken'),
          false,
          'sessionToken key must NEVER appear in WS traffic'
        );
        for (let j = 0; j < players.length; j++) {
          assert.equal(
            allRawTraffic.includes(players[j].cookieTokenSecret),
            false,
            'Session token secret must NEVER appear in WS traffic'
          );
          if (i !== j) {
            for (const otherCardId of cardSets[j]) {
              assert.equal(
                allRawTraffic.includes(`"${otherCardId}"`),
                false,
                `Player ${i} received opponent ${j}'s hidden card ${otherCardId}!`
              );
            }
          }
        }
      }

      // Out-of-turn card play rejected
      const turnSeat = getSnap(players[0]).game!.currentTurn;
      const actor = players.find((p) => p.canonicalSeat === turnSeat)!;
      const bystander = players.find((p) => p.canonicalSeat !== turnSeat)!;
      const bystanderCard = getSnap(bystander).game!.myHand[0].id;
      bystander.client.drainMessages();
      await cluster.sendWs(roomCode, bystander.server, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'play_card',
        actionId: 'out_of_turn_0001',
        cardId: bystanderCard,
      });
      const ootErr = bystander.client.drainMessages()[0];
      assert.equal(ootErr?.type, 'error');
      if (ootErr?.type === 'error') {
        assert.equal(ootErr.code, 'NOT_YOUR_TURN');
      }

      // Capture actor's current hand BEFORE draining actor's message buffer
      const actorSnap = getSnap(actor);
      const leadCard = actorSnap.game!.myHand[0];

      // Playing a card NOT in own hand rejected
      actor.client.drainMessages();
      await cluster.sendWs(roomCode, actor.server, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'play_card',
        actionId: 'stolen_card_0001',
        cardId: bystanderCard,
      });
      const notInHandErr = actor.client.drainMessages()[0];
      assert.equal(notInHandErr?.type, 'error');
      if (notInHandErr?.type === 'error') {
        assert.equal(notInHandErr.code, 'CARD_NOT_IN_HAND');
      }

      // Valid lead play + idempotent replay EVEN AFTER A COLD RESTART!
      const leadActionId = 'idempotent_play_01';
      actor.client.drainMessages();
      await cluster.sendWs(roomCode, actor.server, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'play_card',
        actionId: leadActionId,
        cardId: leadCard.id,
      });
      const firstAck = actor.client
        .drainMessages()
        .find((m) => m.type === 'action_ack');
      assert.ok(firstAck && firstAck.type === 'action_ack');
      assert.equal(Boolean(firstAck.duplicate), false);

      // Cold restart DO, then replay exact same actionId!
      cluster.simulateColdRestart(roomCode);
      actor.client.drainMessages();
      await cluster.sendWs(roomCode, actor.server, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'play_card',
        actionId: leadActionId,
        cardId: leadCard.id,
      });
      const replayAck = actor.client
        .drainMessages()
        .find((m) => m.type === 'action_ack');
      assert.ok(replayAck && replayAck.type === 'action_ack');
      assert.equal(replayAck.duplicate, true);

      // Sync actor's view after drain, then test follow-suit violation on next player
      await cluster.sendWs(roomCode, players[0].server, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'request_sync',
      });
      const nextTurnSeat = getSnap(players[0]).game!.currentTurn;
      const nextActor = players.find((p) => p.canonicalSeat === nextTurnSeat)!;
      await cluster.sendWs(roomCode, nextActor.server, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'request_sync',
      });
      const nextSnap = getSnap(nextActor);
      const legal = getLegalCards(
        nextSnap.game!.myHand,
        nextSnap.game!.currentTrick
      );
      if (legal.length < nextSnap.game!.myHand.length) {
        const legalIds = new Set(legal.map((c) => c.id));
        const illegalCard = nextSnap.game!.myHand.find(
          (c) => !legalIds.has(c.id)
        )!;
        nextActor.client.drainMessages();
        await cluster.sendWs(roomCode, nextActor.server, {
          protocolVersion: PROTOCOL_VERSION,
          type: 'play_card',
          actionId: 'follow_suit_viol_1',
          cardId: illegalCard.id,
        });
        const suitErr = nextActor.client.drainMessages()[0];
        assert.equal(suitErr?.type, 'error');
        if (suitErr?.type === 'error') {
          assert.equal(suitErr.code, 'MUST_FOLLOW_SUIT');
        }
      }
    } finally {
      cluster.close();
    }
  });

  it('Scenario 10 & 12: completes full match, recovers from transient D1 outage across DO restart, persists strictly ONCE (zero double stats), and serves /api/matches & /api/stats cleanly', async () => {
    const cluster = new CloudflareClusterHarness({ seed: 2025 });
    try {
      // Target match score = 1 so full match completes swiftly while exercising all phases
      const { roomCode, players } = await createFourPlayerAuthenticatedRoom(
        cluster,
        1
      );
      await cluster.sendWs(roomCode, players[0].server, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'start_match',
        actionId: 'start_d1_test_001',
      });

      const getSnap = (p: JoinedPlayer) => {
        const msgs = p.client.parsedMessages();
        const sync = [...msgs]
          .reverse()
          .find((m) => m.type === 'state_sync' || m.type === 'auth_ok');
        assert.ok(sync && 'snapshot' in sync);
        return sync.snapshot;
      };

      // Inject a transient D1 batch failure on the very first match-completion write!
      cluster.d1.failNextBatchCount = 1;

      let seq = 0;
      let guard = 0;
      while (getSnap(players[0]).status === 'PLAYING' && guard < 250) {
        guard += 1;
        const cur = getSnap(players[0]);
        const phase = cur.game?.phase;
        if (phase === 'CHOOSING_TRUMP') {
          const hakem = players.find(
            (p) => p.canonicalSeat === cur.game!.hakem
          )!;
          await cluster.sendWs(roomCode, hakem.server, {
            protocolVersion: PROTOCOL_VERSION,
            type: 'choose_trump',
            actionId: `trump_d1_${++seq}_1234`,
            suit: 'diamonds' as Suit,
          });
        } else if (phase === 'PLAYING_TRICK') {
          const actor = players.find(
            (p) => p.canonicalSeat === cur.game!.currentTurn
          )!;
          const actorSnap = getSnap(actor);
          const legal = getLegalCards(
            actorSnap.game!.myHand,
            actorSnap.game!.currentTrick
          );
          await cluster.sendWs(roomCode, actor.server, {
            protocolVersion: PROTOCOL_VERSION,
            type: 'play_card',
            actionId: `play_d1_${++seq}_1234`,
            cardId: legal[0].id,
          });
        } else if (phase === 'TRICK_COMPLETE') {
          cluster.clock += 1_000;
          await cluster.triggerAlarm(roomCode);
        } else if (phase === 'HAND_COMPLETE') {
          cluster.clock += 1_500;
          await cluster.triggerAlarm(roomCode);
        }
      }

      assert.equal(getSnap(players[0]).status, 'FINISHED');

      // Because D1 failed once, match table is still empty AND retry alarm is durably scheduled!
      const matchesBeforeRetryRes = await cluster.fetch('/api/matches', {
        method: 'GET',
        origin: 'https://eyvan.example',
      });
      const matchesBeforeRetry = (await matchesBeforeRetryRes.json()) as {
        matches: unknown[];
      };
      assert.equal(matchesBeforeRetry.matches.length, 0);

      // *** COLD RESTART DO BEFORE D1 RETRY ALARM FIRES ***
      cluster.simulateColdRestart(roomCode);
      cluster.clock += 6_000;
      await cluster.triggerAlarm(roomCode);

      // Now D1 succeeded! Verify camelCase /api/matches response + 4-player roster
      const matchesRes = await cluster.fetch('/api/matches?limit=5', {
        method: 'GET',
        origin: 'https://eyvan.example',
      });
      assert.equal(matchesRes.status, 200);
      const { matches } = (await matchesRes.json()) as {
        matches: CompletedMatchRecord[];
      };
      assert.equal(matches.length, 1);
      assert.equal(matches[0].roomCode, roomCode);
      assert.equal(matches[0].players.length, 4);

      // Re-invoking persistCompletedMatchToD1 with the exact same match MUST NOT double-count stats!
      const dupWrite = await persistCompletedMatchToD1(cluster.d1, matches[0]);
      assert.equal(dupWrite.alreadyExisted, true);

      // Verify case-insensitive /api/stats/:username returns matchesPlayed === 1 (NOT 2!)
      const statsRes = await cluster.fetch('/api/stats/AMIR_PRO', {
        method: 'GET',
        origin: 'https://eyvan.example',
      });
      assert.equal(statsRes.status, 200);
      const stats = (await statsRes.json()) as {
        username: string;
        matchesPlayed: number;
        wins: number;
        losses: number;
      };
      assert.equal(stats.username, 'amir_pro');
      assert.equal(stats.matchesPlayed, 1);
      assert.equal(stats.wins + stats.losses, 1);

      // Verify graceful 503 DATABASE_ERROR on /api/matches when D1 throws
      cluster.d1.failNextQueryCount = 1;
      const errRes = await cluster.fetch('/api/matches', {
        method: 'GET',
        origin: 'https://eyvan.example',
      });
      assert.equal(errRes.status, 503);
      const errBody = (await errRes.json()) as { code: string };
      assert.equal(errBody.code, 'DATABASE_ERROR');
    } finally {
      cluster.close();
    }
  });

  it('Scenario 11: cleans up DO storage after all players leave AND never writes fake match to D1 on disconnect-timeout close', async () => {
    const cluster = new CloudflareClusterHarness({
      seed: 404,
      disconnectGraceMs: 5_000,
      roomCleanupTtlMs: 10_000,
    });
    try {
      // Part A: All players leave a waiting room -> CLOSED -> room_cleanup alarm purges DO storage
      const { roomCode: roomA, players: playersA } =
        await createFourPlayerAuthenticatedRoom(cluster);

      for (let i = 0; i < playersA.length; i++) {
        await cluster.sendWs(roomA, playersA[i].server, {
          protocolVersion: PROTOCOL_VERSION,
          type: 'leave_room',
          actionId: `leave_all_${i}_1234`,
        });
      }

      const slotA = cluster.getOrCreateSlot(roomA);
      assert.ok(
        slotA.state.storage.store.has('room:state'),
        'State retained until cleanup TTL'
      );

      // Survive cold restart, advance past cleanup TTL, fire alarm -> storage purged!
      cluster.simulateColdRestart(roomA);
      cluster.clock += 11_000;
      await cluster.triggerAlarm(roomA);

      assert.equal(
        slotA.state.storage.store.has('room:state'),
        false,
        'room:state MUST be deleted by room_cleanup alarm'
      );
      assert.equal(
        slotA.state.storage.store.has('sys:alarms'),
        false,
        'sys:alarms MUST be deleted by room_cleanup alarm'
      );

      // Part B: Mid-game disconnect grace expiry closes room cleanly WITHOUT writing a fake match to D1
      const { roomCode: roomB, players: playersB } =
        await createFourPlayerAuthenticatedRoom(cluster);
      await cluster.sendWs(roomB, playersB[0].server, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'start_match',
        actionId: 'start_timeout_001',
      });

      await cluster.closeWs(roomB, playersB[2].server, 1006, 'offline');
      cluster.simulateColdRestart(roomB);
      cluster.clock += 6_000; // past 5s disconnectGraceMs
      await cluster.triggerAlarm(roomB);

      // Room B is now CLOSED (GET summary returns 404)
      const sumB = await cluster.fetch(`/api/rooms/${roomB}`, {
        method: 'GET',
        origin: 'https://eyvan.example',
      });
      assert.equal(sumB.status, 404);

      // Zero fake matches written to D1!
      const matchesRes = await cluster.fetch('/api/matches', {
        method: 'GET',
        origin: 'https://eyvan.example',
      });
      const { matches } = (await matchesRes.json()) as { matches: unknown[] };
      assert.equal(matches.length, 0);
    } finally {
      cluster.close();
    }
  });

  it('Stage 2.1 (Cookie Pre-Upgrade Gate & Independent auth_prune): rejects unauthenticated HTTP WS upgrade with 401 AND preserves independent pruning deadlines on hibernationSockets', async () => {
    const cluster = new CloudflareClusterHarness({ seed: 515 });
    try {
      const { roomCode } = await createFourPlayerAuthenticatedRoom(cluster);

      // 1) Unauthenticated WS upgrade MUST be rejected at HTTP level (401) without opening a socket
      const slot = cluster.getOrCreateSlot(roomCode);
      const openCountBefore = slot.state.getWebSockets().length;
      const unauthUpgrade = await cluster.connectWebSocket(roomCode);
      assert.equal(unauthUpgrade.response.status, 401);
      assert.equal(unauthUpgrade.client, undefined);
      assert.equal(slot.state.getWebSockets().length, openCountBefore);

      // 2) Independent unauthenticated-socket deadline pruning unit verification
      const {
        pruneUnauthenticatedSockets,
        getEarliestUnauthenticatedExpiry,
        writeSocketAttachment,
      } = await import('./lib/hibernationSockets');

      const fakeState = new FakeDurableObjectState();
      const sockA = new FakeWebSocketPair()[1];
      const sockB = new FakeWebSocketPair()[1];
      const sockAuth = new FakeWebSocketPair()[1];
      fakeState.acceptWebSocket(sockA, [`room:${roomCode}`]);
      fakeState.acceptWebSocket(sockB, [`room:${roomCode}`]);
      fakeState.acceptWebSocket(sockAuth, [`room:${roomCode}`]);

      writeSocketAttachment(sockA, {
        connectionId: 'unauth_a',
        roomCode,
        playerId: null,
        acceptedAt: 10_000,
        authenticatedAt: null,
      });
      writeSocketAttachment(sockB, {
        connectionId: 'unauth_b',
        roomCode,
        playerId: null,
        acceptedAt: 16_000,
        authenticatedAt: null,
      });
      writeSocketAttachment(sockAuth, {
        connectionId: 'auth_c',
        roomCode,
        playerId: 'player_1',
        acceptedAt: 10_000,
        authenticatedAt: 10_000,
      });

      assert.equal(getEarliestUnauthenticatedExpiry(fakeState, 10_000), 20_000);

      // At T=20_200, A (accepted at 10s) expires while B (accepted at 16s) has 5.8s left
      const pass1 = pruneUnauthenticatedSockets(fakeState, 20_200, 10_000);
      assert.equal(pass1.pruned, 1);
      assert.equal(pass1.nextExpiryAt, 26_000);
      assert.equal(sockA.closedCode, 4003);
      assert.equal(sockB.readyState, 1);
      assert.equal(sockAuth.readyState, 1);

      // At T=26_500, B expires while authenticated socket remains open
      const pass2 = pruneUnauthenticatedSockets(fakeState, 26_500, 10_000);
      assert.equal(pass2.pruned, 1);
      assert.equal(pass2.nextExpiryAt, null);
      assert.equal(sockB.closedCode, 4003);
      assert.equal(sockAuth.readyState, 1);
    } finally {
      cluster.close();
    }
  });

  it('Stage 2.2 (Safe Peek-Ack Alarm Scheduler): preserves failed task on exception, retries with backoff across restart, and removes only completed taskId', async () => {
    const { DurableAlarmScheduler } = await import('./lib/alarmScheduler');
    const storage = new FakeDurableObjectStorage();
    const sched = new DurableAlarmScheduler<'job'>(storage);

    const t1 = await sched.schedule({
      type: 'job',
      dedupeKey: 'k:1',
      dueAt: 1000,
    });

    // Peek does NOT delete before handler succeeds!
    const due = await sched.peekDueTasks(1000);
    assert.equal(due.length, 1);
    assert.equal(due[0].id, t1.id);
    assert.equal(sched.getPendingTasks().length, 1);

    // Simulate handler failure -> rescheduleFailedTask backs off & persists across cold restart
    const rescheduled = await sched.rescheduleFailedTask(t1.id, 1000, {
      baseDelayMs: 2_000,
      maxDelayMs: 60_000,
      maxAttempts: 3,
    });
    assert.equal(rescheduled, true);

    // Hydrate brand-new scheduler instance from storage (simulating DO cold restart)
    const schedAfterRestart = new DurableAlarmScheduler<'job'>(storage);
    await schedAfterRestart.hydrate();
    assert.equal(schedAfterRestart.getPendingTasks().length, 1);
    assert.equal(schedAfterRestart.getPendingTasks()[0].attempts, 1);
    assert.equal(schedAfterRestart.getPendingTasks()[0].dueAt, 3000);

    // If handler schedules a replacement with same dedupeKey, completing old taskId does NOT erase new task!
    const t2 = await schedAfterRestart.schedule({
      type: 'job',
      dedupeKey: 'k:1',
      dueAt: 9000,
    });
    await schedAfterRestart.completeTask(t1.id);
    assert.equal(schedAfterRestart.getPendingTasks().length, 1);
    assert.equal(schedAfterRestart.getPendingTasks()[0].id, t2.id);

    // Completing t2 clears queue & alarm cleanly
    await schedAfterRestart.completeTask(t2.id);
    assert.equal(schedAfterRestart.getPendingTasks().length, 0);
    assert.equal(storage.alarmAt, null);
  });

  it('Stage 3 (Lossless Match Queue): preserves unpersisted Match #1 across Rematch AND prolonged D1 outage (>5 failures) + DO restart, committing BOTH matches strictly once', async () => {
    const cluster = new CloudflareClusterHarness({ seed: 616 });
    try {
      const { roomCode, players } = await createFourPlayerAuthenticatedRoom(
        cluster,
        1
      );

      const getSnap = (p: JoinedPlayer) => {
        const msgs = p.client.parsedMessages();
        const sync = [...msgs]
          .reverse()
          .find((m) => m.type === 'state_sync' || m.type === 'auth_ok');
        assert.ok(sync && 'snapshot' in sync);
        return sync.snapshot;
      };

      const playUntilFinished = async (prefix: string) => {
        let seq = 0;
        let guard = 0;
        while (getSnap(players[0]).status === 'PLAYING' && guard < 250) {
          guard += 1;
          const cur = getSnap(players[0]);
          const phase = cur.game?.phase;
          if (phase === 'CHOOSING_TRUMP') {
            const hakem = players.find(
              (p) => p.canonicalSeat === cur.game!.hakem
            )!;
            await cluster.sendWs(roomCode, hakem.server, {
              protocolVersion: PROTOCOL_VERSION,
              type: 'choose_trump',
              actionId: `${prefix}_t_${++seq}_1234`,
              suit: 'spades' as Suit,
            });
          } else if (phase === 'PLAYING_TRICK') {
            const actor = players.find(
              (p) => p.canonicalSeat === cur.game!.currentTurn
            )!;
            const actorSnap = getSnap(actor);
            const legal = getLegalCards(
              actorSnap.game!.myHand,
              actorSnap.game!.currentTrick
            );
            await cluster.sendWs(roomCode, actor.server, {
              protocolVersion: PROTOCOL_VERSION,
              type: 'play_card',
              actionId: `${prefix}_p_${++seq}_1234`,
              cardId: legal[0].id,
            });
          } else if (phase === 'TRICK_COMPLETE') {
            cluster.clock += 1_000;
            await cluster.triggerAlarm(roomCode);
          } else if (phase === 'HAND_COMPLETE') {
            cluster.clock += 1_500;
            await cluster.triggerAlarm(roomCode);
          }
        }
        assert.equal(getSnap(players[0]).status, 'FINISHED');
      };

      // Inject 7 consecutive D1 batch failures (proves retry NEVER drops after 5 attempts!)
      cluster.d1.failNextBatchCount = 7;

      // Play Match #1 -> finishes while D1 is down
      await cluster.sendWs(roomCode, players[0].server, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'start_match',
        actionId: 'start_m1_lossless',
      });
      await playUntilFinished('m1');

      // Immediately start REMATCH while Match #1 is STILL unpersisted!
      await cluster.sendWs(roomCode, players[0].server, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'rematch',
        actionId: 'rematch_m2_lossless',
      });
      assert.equal(getSnap(players[0]).status, 'PLAYING');

      // Play Match #2 -> finishes while D1 is STILL failing
      await playUntilFinished('m2');

      // Simulate 5 failed retry alarms across DO cold restarts (> 5 total attempts!)
      for (let retry = 0; retry < 5; retry++) {
        cluster.simulateColdRestart(roomCode);
        cluster.clock += 16 * 60_000; // jump past capped backoff
        await cluster.triggerAlarm(roomCode);
      }

      // Now D1 recovers -> next retry alarm commits BOTH Match #1 AND Match #2!
      cluster.simulateColdRestart(roomCode);
      cluster.clock += 16 * 60_000;
      await cluster.triggerAlarm(roomCode);

      const matchesRes = await cluster.fetch('/api/matches?limit=10', {
        method: 'GET',
        origin: 'https://eyvan.example',
      });
      const { matches } = (await matchesRes.json()) as {
        matches: CompletedMatchRecord[];
      };
      assert.equal(
        matches.length,
        2,
        'BOTH Match #1 and Match #2 MUST survive rematch and >5 D1 retries!'
      );
      assert.notEqual(matches[0].matchId, matches[1].matchId);

      const statsRes = await cluster.fetch('/api/stats/amir_pro', {
        method: 'GET',
        origin: 'https://eyvan.example',
      });
      const stats = (await statsRes.json()) as { matchesPlayed: number };
      assert.equal(stats.matchesPlayed, 2);
    } finally {
      cluster.close();
    }
  });

  it('Stage 4 (True UTF-8 Byte Limits): rejects multi-byte Persian payloads exceeding 16KB HTTP / 8KB WS bytes even when string.length is smaller, while accepting valid Unicode payloads', async () => {
    const cluster = new CloudflareClusterHarness({ seed: 414 });
    try {
      // 9,000 Persian characters = string.length 9,000 (< 16,384) BUT ~18,000 UTF-8 bytes (> 16KB)!
      const persianOversize = 'آ'.repeat(9_000);
      const httpOver = await cluster.fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        origin: 'https://eyvan.example',
        body: JSON.stringify({ username: 'amir_pro', note: persianOversize }),
      });
      assert.equal(
        httpOver.status,
        413,
        'Multi-byte UTF-8 HTTP body > 16KB MUST return 413'
      );

      // Valid small Unicode payload (< 16KB) passes cleanly
      const validCreate = await cluster.fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        origin: 'https://eyvan.example',
        body: JSON.stringify({ username: 'amir_pro', note: 'سلام ایوان' }),
      });
      assert.equal(validCreate.status, 201);
      const validCookie = validCreate.headers.get('Set-Cookie')!.split(';')[0];
      const created = (await validCreate.json()) as {
        roomCode: string;
        playerId: string;
      };

      const conn = await cluster.connectWebSocket(
        created.roomCode,
        'https://eyvan.example',
        validCookie
      );
      assert.equal(conn.response.status, 101);
      conn.client.drainMessages(); // clear initial auth_ok

      // 5,000 Persian chars = string.length 5,000 (< 8,192) BUT ~10,000 UTF-8 bytes (> 8KB)!
      await cluster.sendWs(
        created.roomCode,
        conn.server,
        JSON.stringify({
          protocolVersion: PROTOCOL_VERSION,
          type: 'ping',
          note: 'ح'.repeat(5_000),
        })
      );
      const wsErr = conn.client.drainMessages()[0];
      assert.equal(wsErr?.type, 'error');
      if (wsErr?.type === 'error') {
        assert.equal(wsErr.code, 'INVALID_MESSAGE');
      }
    } finally {
      cluster.close();
    }
  });

  it('Stage 5 (Canonical Username Consolidation): merges mixed-case usernames (Amir_Case vs amir_case) into single stats row without losing data', async () => {
    const cluster = new CloudflareClusterHarness({ seed: 525 });
    try {
      const m1: CompletedMatchRecord = {
        matchId: 'match_case_1',
        roomCode: 'AAA111',
        startedAt: 1000,
        finishedAt: 2000,
        winningTeam: 'myTeam',
        teamAScore: 3,
        teamBScore: 1,
        targetScore: 3,
        lastWinType: 'normal',
        handsPlayed: 4,
        players: [
          { playerId: 'p1', username: 'Amir_Case', canonicalSeat: 'south', team: 'myTeam', won: true },
          { playerId: 'p2', username: 'Sara_B', canonicalSeat: 'east', team: 'opponentTeam', won: false },
          { playerId: 'p3', username: 'Reza_C', canonicalSeat: 'north', team: 'myTeam', won: true },
          { playerId: 'p4', username: 'Neda_D', canonicalSeat: 'west', team: 'opponentTeam', won: false },
        ],
      };
      const m2: CompletedMatchRecord = {
        ...m1,
        matchId: 'match_case_2',
        finishedAt: 3000,
        players: [
          { playerId: 'p1b', username: 'amir_case', canonicalSeat: 'south', team: 'myTeam', won: true },
          { playerId: 'p2b', username: 'sara_b', canonicalSeat: 'east', team: 'opponentTeam', won: false },
          { playerId: 'p3b', username: 'reza_c', canonicalSeat: 'north', team: 'myTeam', won: true },
          { playerId: 'p4b', username: 'neda_d', canonicalSeat: 'west', team: 'opponentTeam', won: false },
        ],
      };

      await persistCompletedMatchToD1(cluster.d1, m1);
      await persistCompletedMatchToD1(cluster.d1, m2);

      // Must have ONLY ONE row for `amir_case` in player_stats with matches_played === 2!
      const countRow = cluster.d1.sqlite
        .prepare(`SELECT COUNT(*) AS cnt FROM player_stats WHERE lower(username) = 'amir_case'`)
        .get() as { cnt: number };
      assert.equal(countRow.cnt, 1);

      const statsRes = await cluster.fetch('/api/stats/AMIR_CASE', {
        method: 'GET',
        origin: 'https://eyvan.example',
      });
      const stats = (await statsRes.json()) as {
        username: string;
        matchesPlayed: number;
        wins: number;
      };
      assert.equal(stats.matchesPlayed, 2);
      assert.equal(stats.wins, 2);
    } finally {
      cluster.close();
    }
  });

  it('Stage 6 (Zero-Token HttpOnly Cookie Security Suite): covers all 11 regression checks (JSON zero-token, HttpOnly cookie attributes, refresh recovery, WS cookie auth, tampered/expired/cross-seat rejection, logout clear + Domain consistency, disallowed Origin block)', async () => {
    const cluster = new CloudflareClusterHarness({ seed: 636 });
    cluster.env.COOKIE_DOMAIN = '.eyvan.example';
    try {
      // [Check 1] Create room JSON NEVER returns sessionToken; sets HttpOnly/Secure/SameSite/Path/Domain cookie
      const createRes = await cluster.fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        origin: 'https://eyvan.example',
        body: JSON.stringify({ username: 'amir_cookie', avatarCode: 'portrait' }),
      });
      assert.equal(createRes.status, 201);
      const createSetCookie = createRes.headers.get('Set-Cookie')!;
      assert.ok(createSetCookie.includes('eyvan_hokm_sess='));
      assert.ok(createSetCookie.includes('HttpOnly'));
      assert.ok(createSetCookie.includes('Secure'));
      assert.ok(createSetCookie.includes('Path=/'));
      assert.ok(createSetCookie.includes('Domain=.eyvan.example'));
      assert.ok(createSetCookie.includes('SameSite=None'));
      const cookiePair1 = createSetCookie.split(';')[0];
      const createText = await createRes.text();
      assert.equal(createText.includes('sessionToken'), false);
      const created = JSON.parse(createText) as {
        roomId: string;
        roomCode: string;
        playerId: string;
        canonicalSeat: string;
        wsPath: string;
      };

      // [Check 2] Join room JSON NEVER returns sessionToken either
      const joinRes = await cluster.fetch(`/api/rooms/${created.roomCode}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        origin: 'https://eyvan.example',
        body: JSON.stringify({ username: 'sara_cookie', avatarCode: 'shamsa' }),
      });
      assert.equal(joinRes.status, 200);
      const joinSetCookie = joinRes.headers.get('Set-Cookie')!;
      assert.ok(joinSetCookie.includes('HttpOnly'));
      assert.ok(joinSetCookie.includes('Domain=.eyvan.example'));
      const cookiePair2 = joinSetCookie.split(';')[0];
      const joinText = await joinRes.text();
      assert.equal(joinText.includes('sessionToken'), false);
      const joined = JSON.parse(joinText) as {
        roomCode: string;
        playerId: string;
      };

      // [Check 3 & 4] Refresh recovery (/api/session/resume) succeeds via cookie across DO cold restart & JSON has ZERO sessionToken
      const noHeaderRes = await cluster.fetch('/api/session/resume', {
        method: 'POST',
        headers: { Cookie: cookiePair1 },
        origin: 'https://eyvan.example',
      });
      assert.equal(noHeaderRes.status, 403);

      // Absent cookie returns 200 { active: false } quietly without console errors
      const absentRes = await cluster.fetch('/api/session/resume', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        origin: 'https://eyvan.example',
        body: JSON.stringify({}),
      });
      assert.equal(absentRes.status, 200);
      assert.deepEqual(await absentRes.json(), { active: false });

      cluster.simulateColdRestart(created.roomCode);
      const resumeRes = await cluster.fetch('/api/session/resume', {
        method: 'POST',
        headers: {
          Cookie: cookiePair1,
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        origin: 'https://eyvan.example',
        body: JSON.stringify({ roomCode: created.roomCode }),
      });
      assert.equal(resumeRes.status, 200);
      const resumeText = await resumeRes.text();
      assert.equal(resumeText.includes('sessionToken'), false);
      const resumed = JSON.parse(resumeText) as {
        roomId: string;
        roomCode: string;
        playerId: string;
        canonicalSeat: string;
        wsPath: string;
      };
      assert.equal(resumed.roomId, created.roomId);
      assert.equal(resumed.roomCode, created.roomCode);
      assert.equal(resumed.playerId, created.playerId);
      assert.equal(resumed.canonicalSeat, 'south');
      assert.equal(resumed.wsPath, `/ws/rooms/${created.roomCode}`);

      // [Check 5 & 11] Cookie WS upgrade succeeds immediately with `auth_ok` & zero secret token in WS frames
      const conn1 = await cluster.connectWebSocket(
        created.roomCode,
        'https://eyvan.example',
        cookiePair1
      );
      assert.equal(conn1.response.status, 101);
      const rawWsLog = conn1.client.received.join('\n');
      assert.equal(rawWsLog.includes('sessionToken'), false);
      assert.equal(
        rawWsLog.includes(extractSessionSecretFromCookiePair(cookiePair1)),
        false
      );
      const authMsgs = conn1.client.drainMessages();
      assert.equal(authMsgs[0]?.type, 'auth_ok');

      // [Check 6] Missing or invalid/tampered cookie on WS upgrade fails 401
      const noCookieWs = await cluster.connectWebSocket(
        created.roomCode,
        'https://eyvan.example'
      );
      assert.equal(noCookieWs.response.status, 401);

      const badCookie = `eyvan_hokm_sess=${encodeURIComponent(
        `${created.roomCode}.${created.playerId}.ffffffffffffffffffffffffffffffff`
      )}`;
      const tamperedResume = await cluster.fetch('/api/session/resume', {
        method: 'POST',
        headers: {
          Cookie: badCookie,
          'X-Requested-With': 'eyvan-client',
        },
        origin: 'https://eyvan.example',
      });
      assert.equal(tamperedResume.status, 401);
      assert.ok(tamperedResume.headers.get('Set-Cookie')?.includes('Max-Age=0'));
      assert.ok(
        tamperedResume.headers.get('Set-Cookie')?.includes('Domain=.eyvan.example')
      );

      const tamperedWs = await cluster.connectWebSocket(
        created.roomCode,
        'https://eyvan.example',
        badCookie
      );
      assert.equal(tamperedWs.response.status, 401);

      // [Check 8] Cross-seat & cross-room isolation
      const crossSeatCookie = `eyvan_hokm_sess=${encodeURIComponent(
        `${created.roomCode}.${created.playerId}.${extractSessionSecretFromCookiePair(
          cookiePair2
        )}`
      )}`;
      const crossSeatWs = await cluster.connectWebSocket(
        created.roomCode,
        'https://eyvan.example',
        crossSeatCookie
      );
      assert.equal(crossSeatWs.response.status, 401);
      assert.notEqual(joined.playerId, created.playerId);

      // [Check 10] Disallowed Origin blocked on HTTP + WS Upgrade (403)
      const evilResume = await cluster.fetch('/api/session/resume', {
        method: 'POST',
        headers: {
          Cookie: cookiePair1,
          'X-Requested-With': 'eyvan-client',
        },
        origin: 'https://evil-site.invalid',
      });
      assert.equal(evilResume.status, 403);

      const evilWs = await cluster.connectWebSocket(
        created.roomCode,
        'https://evil-site.invalid',
        cookiePair1
      );
      assert.equal(evilWs.response.status, 403);

      // [Check 9] Explicit session clear returns matching Domain + Path=/ + Max-Age=0
      const clearRes = await cluster.fetch('/api/session/clear', {
        method: 'POST',
        headers: { 'X-Requested-With': 'eyvan-client' },
        origin: 'https://eyvan.example',
      });
      assert.equal(clearRes.status, 200);
      const clearHeader = clearRes.headers.get('Set-Cookie')!;
      assert.ok(clearHeader.includes('Max-Age=0'));
      assert.ok(clearHeader.includes('Path=/'));
      assert.ok(clearHeader.includes('Domain=.eyvan.example'));
      assert.ok(clearHeader.includes('HttpOnly'));

      // [Check 7] After players leave & room closes, old cookie fails on BOTH /resume AND /ws/rooms/:code
      await cluster.sendWs(created.roomCode, conn1.server, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'leave_room',
        actionId: 'leave_cookie_1234',
      });
      const conn2 = await cluster.connectWebSocket(
        created.roomCode,
        'https://eyvan.example',
        cookiePair2
      );
      assert.equal(conn2.response.status, 101);
      await cluster.sendWs(created.roomCode, conn2.server, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'leave_room',
        actionId: 'leave_cookie_5678',
      });

      const afterCloseResume = await cluster.fetch('/api/session/resume', {
        method: 'POST',
        headers: {
          Cookie: cookiePair1,
          'X-Requested-With': 'eyvan-client',
        },
        origin: 'https://eyvan.example',
      });
      assert.equal(afterCloseResume.status, 404);
      assert.ok(afterCloseResume.headers.get('Set-Cookie')?.includes('Max-Age=0'));

      const afterCloseWs = await cluster.connectWebSocket(
        created.roomCode,
        'https://eyvan.example',
        cookiePair1
      );
      assert.equal(afterCloseWs.response.status, 404);
      assert.ok(
        afterCloseWs.response.headers.get('Set-Cookie')?.includes('Max-Age=0')
      );
    } finally {
      cluster.close();
    }
  });
});


