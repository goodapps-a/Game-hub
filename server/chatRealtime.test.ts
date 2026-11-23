import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import WebSocket, { WebSocketServer } from 'ws';

import worker from '../cloudflare/src/index';
import { ChatConversationDO } from '../cloudflare/src/ChatConversationDO';
import { AUTH_COOKIE_NAME, parseAuthCookieFromHeader } from '../cloudflare/src/lib/auth/authCookie';
import { verifyAuthSession } from '../cloudflare/src/lib/auth/authService';
import { EmailSender } from '../cloudflare/src/lib/auth/emailService';
import { authorizeConversationRealtimeAccess } from '../cloudflare/src/lib/social/chatService';
import {
  CfWorkerEnv,
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1RunResult,
  DurableObjectStateLike,
  DurableObjectStorageLike,
  HibernatableWebSocket,
  R2BucketLike,
} from '../cloudflare/src/lib/types';
import {
  CHAT_RECONNECT_MAX_MS,
  CHAT_WS_CLOSE_FORBIDDEN,
  CHAT_WS_CLOSE_UNAUTHORIZED,
  ChatUiMessage,
  ChatWsServerEvent,
  advanceReadCursorMonotonic,
  compareMessageCursor,
  computeReconnectDelayMs,
  isMessageReadByPartner,
  mergeChatMessages,
  parseChatWsServerEvent,
  toConfirmedUiMessage,
} from '../src/platform/social/chatRealtimeProtocol';
import { ExpressChatRealtimeHub } from './chatRealtimeHub';
import { createEyvanExpressApp } from './createExpressApp';
import { EyvanDatabase } from './database';
import { HokmRoomManager } from './roomManager';

// ---------------------------------------------------------------------------
// Simulated Cloudflare Workers + Hibernation ChatConversationDO + Real SQLite D1
// ---------------------------------------------------------------------------

class FakeDoStorage implements DurableObjectStorageLike {
  private readonly store = new Map<string, unknown>();
  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.store.has(key) ? (structuredClone(this.store.get(key)) as T) : undefined;
  }
  async put<T = unknown>(key: string, value: T): Promise<void> {
    this.store.set(key, structuredClone(value));
  }
  async delete(key: string | string[]): Promise<boolean | number> {
    if (Array.isArray(key)) {
      let n = 0;
      for (const k of key) if (this.store.delete(k)) n += 1;
      return n;
    }
    return this.store.delete(key);
  }
  async deleteAll(): Promise<void> {
    this.store.clear();
  }
  async setAlarm(): Promise<void> {}
  async getAlarm(): Promise<number | null> {
    return null;
  }
  async deleteAlarm(): Promise<void> {}
}

class FakeChatWebSocket implements HibernatableWebSocket {
  public readyState = 1;
  public peer: FakeChatWebSocket | null = null;
  public readonly received: string[] = [];
  public closedCode: number | null = null;
  public closedReason: string | null = null;
  private attachment: unknown = null;

  send(message: string | ArrayBuffer): void {
    if (this.readyState !== 1) throw new Error('Socket not open');
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
  }

  serializeAttachment(attachment: unknown): void {
    this.attachment = structuredClone(attachment);
  }

  deserializeAttachment(): unknown {
    return structuredClone(this.attachment);
  }

  drainEvents(): ChatWsServerEvent[] {
    const out = this.received
      .map((raw) => parseChatWsServerEvent(raw))
      .filter((e): e is ChatWsServerEvent => e !== null);
    this.received.length = 0;
    return out;
  }
}

class FakeChatWebSocketPair {
  0: FakeChatWebSocket;
  1: FakeChatWebSocket;
  constructor() {
    const client = new FakeChatWebSocket();
    const server = new FakeChatWebSocket();
    client.peer = server;
    server.peer = client;
    this[0] = client;
    this[1] = server;
  }
}

class FakeChatDoState implements DurableObjectStateLike {
  public readonly storage = new FakeDoStorage();
  private readonly accepted: Array<{ ws: FakeChatWebSocket; tags: string[] }> = [];

  acceptWebSocket(ws: HibernatableWebSocket, tags: string[] = []): void {
    this.accepted.push({ ws: ws as FakeChatWebSocket, tags: [...tags] });
  }

  getWebSockets(tag?: string): HibernatableWebSocket[] {
    return this.accepted
      .filter(
        (entry) =>
          entry.ws.readyState === 1 && (!tag || entry.tags.includes(tag))
      )
      .map((entry) => entry.ws);
  }

  async blockConcurrencyWhile<T>(cb: () => Promise<T>): Promise<T> {
    return cb();
  }
}

class SqliteD1Harness implements D1DatabaseLike {
  public readonly sqlite: Database.Database;
  constructor() {
    this.sqlite = new Database(':memory:');
    this.sqlite.pragma('foreign_keys = ON');
    const migrationsDir = path.resolve(process.cwd(), 'cloudflare/migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => /^\d+_.*\.sql$/i.test(f))
      .sort((a, b) => a.localeCompare(b));
    for (const file of files) {
      this.sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
    }
  }

  prepare(query: string): D1PreparedStatementLike {
    return this.makeStmt(query, []);
  }

  private makeStmt(
    query: string,
    params: unknown[]
  ): D1PreparedStatementLike & { __q: string; __p: unknown[] } {
    const self = this;
    return {
      __q: query,
      __p: params,
      bind(...values: unknown[]) {
        return self.makeStmt(query, values);
      },
      async run(): Promise<D1RunResult> {
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
        const results = self.sqlite.prepare(query).all(...params) as T[];
        return { results, success: true };
      },
      async first<T = unknown>(): Promise<T | null> {
        const row = self.sqlite.prepare(query).get(...params) as T | undefined;
        return row ?? null;
      },
    };
  }

  async batch(statements: D1PreparedStatementLike[]): Promise<D1RunResult[]> {
    const tx = this.sqlite.transaction(
      (
        stmts: Array<
          D1PreparedStatementLike & { __q?: string; __p?: unknown[] }
        >
      ) => {
        const out: D1RunResult[] = [];
        for (const s of stmts) {
          const info = this.sqlite.prepare(s.__q!).run(...(s.__p ?? []));
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

function getSetCookies(res: Response): string[] {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === 'function') return h.getSetCookie();
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

function extractCookie(res: Response, name: string): string | null {
  for (const raw of getSetCookies(res)) {
    const first = raw.split(';')[0]?.trim() ?? '';
    if (first.startsWith(`${name}=`)) return first;
  }
  return null;
}

class WorkerChatCluster {
  public readonly d1 = new SqliteD1Harness();
  public readonly chatSlots = new Map<
    string,
    { state: FakeChatDoState; instance: ChatConversationDO }
  >();
  public readonly verifyTokens: string[] = [];
  public readonly env: CfWorkerEnv;
  public clock = 1_750_000_000_000;

  constructor() {
    const self = this;
    const r2: R2BucketLike = { async get() { return null; } };
    const emailSender: EmailSender = {
      async sendVerificationEmail(payload) {
        const hash = new URL(payload.verifyUrl).hash.replace(/^#/, '');
        const token = new URLSearchParams(hash).get('verify-email');
        if (token) self.verifyTokens.push(token);
        return { configured: true, sent: true, provider: 'mock' };
      },
      async sendPasswordResetEmail() {
        return { configured: true, sent: true, provider: 'mock' };
      },
    };

    this.env = {
      EYVAN_DB: this.d1,
      EYVAN_ASSETS: r2,
      ALLOWED_ORIGINS: 'https://eyvan.example',
      ENVIRONMENT: 'production',
      PUBLIC_APP_URL: 'https://eyvan.example',
      EMAIL_SENDER: emailSender,
      HOKM_ROOM: {
        idFromName: (name) => name,
        get: () => ({
          fetch: async () => new Response('not used', { status: 404 }),
        }),
      },
      CHAT_CONVERSATION: {
        idFromName: (name) => name,
        get: (id) => {
          const key = String(id);
          return {
            fetch: async (req: Request) => {
              const slot = self.getOrCreateChatSlot(key);
              return slot.instance.fetch(req);
            },
          };
        },
      },
    };
  }

  public getOrCreateChatSlot(conversationId: string) {
    let slot = this.chatSlots.get(conversationId);
    if (!slot) {
      const state = new FakeChatDoState();
      const instance = new ChatConversationDO(state, this.env, {
        now: () => this.clock,
      });
      slot = { state, instance };
      this.chatSlots.set(conversationId, slot);
    }
    return slot;
  }

  /**
   * Simulates Cloudflare Durable Object Hibernation Eviction / Cold Restart:
   * Destroys the in-memory JS `ChatConversationDO` instance completely while
   * keeping hibernated sockets & serialized attachments inside `FakeChatDoState`.
   */
  public simulateHibernationRestart(conversationId: string): ChatConversationDO {
    const slot = this.chatSlots.get(conversationId);
    assert.ok(slot, `Expected chat DO slot for ${conversationId}`);
    slot.instance = new ChatConversationDO(slot.state, this.env, {
      now: () => this.clock,
    });
    return slot.instance;
  }

  public async fetch(
    pathname: string,
    init?: RequestInit & { origin?: string; cookie?: string; ip?: string }
  ): Promise<Response> {
    const headers = new Headers(init?.headers ?? {});
    headers.set('Origin', init?.origin ?? 'https://eyvan.example');
    headers.set('CF-Connecting-IP', init?.ip ?? '198.51.100.77');
    if (init?.cookie) headers.set('Cookie', init.cookie);
    const req = new Request(`https://api.eyvan.example${pathname}`, {
      ...init,
      headers,
    });
    return worker.fetch(req, this.env);
  }

  public async registerAndLogin(username: string, email: string) {
    const password = 'EyvanStrong#2026';
    const reg = await this.fetch('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'eyvan-client',
      },
      body: JSON.stringify({ email, username, password, confirmPassword: password }),
    });
    assert.equal(reg.status, 201);
    const regJson = (await reg.json()) as {
      user: { userId: string; username: string };
    };
    const token = this.verifyTokens.pop();
    assert.ok(token);

    const ver = await this.fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'eyvan-client',
      },
      body: JSON.stringify({ token }),
    });
    assert.equal(ver.status, 200);

    const login = await this.fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'eyvan-client',
      },
      body: JSON.stringify({ identifier: email, password }),
    });
    assert.equal(login.status, 200);
    const cookie = extractCookie(login, AUTH_COOKIE_NAME);
    assert.ok(cookie);
    return { userId: regJson.user.userId, username: regJson.user.username, cookie };
  }

  public async makeFriends(
    a: { userId: string; cookie: string },
    b: { userId: string; cookie: string }
  ) {
    const reqRes = await this.fetch('/api/social/friends/request', {
      method: 'POST',
      cookie: a.cookie,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'eyvan-client',
      },
      body: JSON.stringify({ targetUserId: b.userId }),
    });
    assert.equal(reqRes.status, 201);
    const reqJson = (await reqRes.json()) as { friendshipId: string };
    const accRes = await this.fetch('/api/social/friends/accept', {
      method: 'POST',
      cookie: b.cookie,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'eyvan-client',
      },
      body: JSON.stringify({ friendshipId: reqJson.friendshipId }),
    });
    assert.equal(accRes.status, 200);
  }

  public async openDirectChat(
    actor: { cookie: string },
    targetUserId: string
  ): Promise<string> {
    const res = await this.fetch('/api/social/chat/conversations/direct', {
      method: 'POST',
      cookie: actor.cookie,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'eyvan-client',
      },
      body: JSON.stringify({ targetUserId }),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      conversation: { conversationId: string };
    };
    return json.conversation.conversationId;
  }

  public async connectChatWs(
    conversationId: string,
    opts?: {
      cookie?: string;
      origin?: string;
      extraHeaders?: Record<string, string>;
      query?: string;
    }
  ): Promise<{
    response: Response;
    client?: FakeChatWebSocket;
    server?: FakeChatWebSocket;
  }> {
    const headers: Record<string, string> = {
      Upgrade: 'websocket',
      ...(opts?.extraHeaders ?? {}),
    };
    const qs = opts?.query ? `?${opts.query}` : '';
    const response = await this.fetch(`/ws/social/chat/${conversationId}${qs}`, {
      method: 'GET',
      headers,
      origin: opts?.origin ?? 'https://eyvan.example',
      cookie: opts?.cookie,
    });
    const client = (
      response as Response & { webSocket?: FakeChatWebSocket }
    ).webSocket;
    return { response, client, server: client?.peer ?? undefined };
  }

  public close(): void {
    this.d1.close();
  }
}

const OriginalResponse = globalThis.Response;
const OriginalWebSocketPair = (
  globalThis as unknown as { WebSocketPair?: unknown }
).WebSocketPair;

before(() => {
  (globalThis as unknown as { WebSocketPair: unknown }).WebSocketPair =
    FakeChatWebSocketPair;

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
// 1. Pure Protocol, Read Cursor, Reconciliation & Backoff Unit Tests
// ---------------------------------------------------------------------------

describe('Real-Time Private Chat — Pure Protocol, Read Cursor & Reconciliation', () => {
  it('enforces exact 1-tick vs 2-tick read cursor semantics (including same-millisecond tie-breaks and never ticking optimistic/failed)', () => {
    const m1: ChatUiMessage = {
      messageId: 'msg_001',
      conversationId: 'cnv_test1234',
      senderId: 'usr_a',
      kind: 'text',
      body: 'اول',
      clientMsgId: 'c1',
      createdAt: 1_000,
      localStatus: 'sent',
    };
    const m2: ChatUiMessage = {
      messageId: 'msg_002',
      conversationId: 'cnv_test1234',
      senderId: 'usr_a',
      kind: 'text',
      body: 'دوم',
      clientMsgId: 'c2',
      createdAt: 1_000,
      localStatus: 'sent',
    };
    const sendingMsg: ChatUiMessage = {
      ...m1,
      messageId: 'opt_c3',
      localStatus: 'sending',
    };
    const failedMsg: ChatUiMessage = {
      ...m1,
      messageId: 'opt_c4',
      localStatus: 'failed',
    };

    // No read cursor -> 1 tick (not read)
    assert.equal(isMessageReadByPartner(m1, null), false);

    // Cursor anchored strictly at (1000, msg_001): m1 = 2 ticks, m2 (same ms, larger ID) = STILL 1 tick!
    const cursorM1 = { lastReadAt: 1_000, lastReadMessageId: 'msg_001' };
    assert.equal(isMessageReadByPartner(m1, cursorM1), true);
    assert.equal(isMessageReadByPartner(m2, cursorM1), false);
    // Sending & failed messages NEVER show read ticks
    assert.equal(isMessageReadByPartner(sendingMsg, cursorM1), false);
    assert.equal(isMessageReadByPartner(failedMsg, cursorM1), false);

    // Advancing monotonically to (1000, msg_002) marks both read; attempting to regress to msg_001 is ignored
    const cursorM2 = advanceReadCursorMonotonic(cursorM1, {
      lastReadAt: 1_000,
      lastReadMessageId: 'msg_002',
    });
    assert.equal(cursorM2?.lastReadMessageId, 'msg_002');
    assert.equal(isMessageReadByPartner(m2, cursorM2), true);

    const regressed = advanceReadCursorMonotonic(cursorM2, cursorM1);
    assert.equal(regressed?.lastReadMessageId, 'msg_002');
    assert.ok(
      compareMessageCursor(
        { createdAt: 1_000, messageId: 'msg_001' },
        { createdAt: 1_000, messageId: 'msg_002' }
      ) < 0
    );
  });

  it('reconciles optimistic messages with server confirmations (HTTP-first OR WS-first) with zero duplicates', () => {
    const optimistic: ChatUiMessage = {
      messageId: 'opt_cmsg_abc',
      conversationId: 'cnv_test1234',
      senderId: 'usr_a',
      kind: 'text',
      body: 'سلام لحظه‌ای',
      clientMsgId: 'cmsg_abc',
      createdAt: 10_000,
      localStatus: 'sending',
    };
    const confirmed = toConfirmedUiMessage({
      messageId: 'msg_server_01',
      conversationId: 'cnv_test1234',
      senderId: 'usr_a',
      kind: 'text',
      body: 'سلام لحظه‌ای',
      clientMsgId: 'cmsg_abc',
      createdAt: 10_005,
    });

    // Order A: Optimistic -> WS push arrives -> HTTP response arrives later
    const afterWs = mergeChatMessages([optimistic], [confirmed]);
    assert.equal(afterWs.length, 1);
    assert.equal(afterWs[0].messageId, 'msg_server_01');
    assert.equal(afterWs[0].localStatus, 'sent');

    const afterHttp = mergeChatMessages(afterWs, [confirmed]);
    assert.equal(afterHttp.length, 1);

    // Order B: Stale optimistic/failed update after confirmation NEVER downgrades confirmed message
    const staleFailed: ChatUiMessage = { ...optimistic, localStatus: 'failed' };
    const stillConfirmed = mergeChatMessages(afterHttp, [staleFailed]);
    assert.equal(stillConfirmed.length, 1);
    assert.equal(stillConfirmed[0].localStatus, 'sent');
    assert.equal(stillConfirmed[0].messageId, 'msg_server_01');
  });

  it('caps exponential reconnect backoff cleanly and validates WS server frames', () => {
    const d0 = computeReconnectDelayMs(0, () => 0);
    const d1 = computeReconnectDelayMs(1, () => 0);
    const d2 = computeReconnectDelayMs(2, () => 0);
    const d8 = computeReconnectDelayMs(8, () => 1);
    assert.equal(d0, 1_000);
    assert.equal(d1, 2_000);
    assert.equal(d2, 4_000);
    assert.equal(d8, CHAT_RECONNECT_MAX_MS);

    assert.equal(parseChatWsServerEvent('not-json'), null);
    assert.equal(parseChatWsServerEvent(JSON.stringify({ type: 'unknown' })), null);
    const valid = parseChatWsServerEvent(
      JSON.stringify({
        type: 'read:updated',
        conversationId: 'cnv_12345678',
        readerUserId: 'usr_12345678',
        lastReadMessageId: 'msg_12345678',
        lastReadAt: 123456,
      })
    );
    assert.equal(valid?.type, 'read:updated');
  });
});

// ---------------------------------------------------------------------------
// 2. Cloudflare Worker + ChatConversationDO (Hibernation) Full Integration Suite
// ---------------------------------------------------------------------------

describe('Real-Time Private Chat — Cloudflare Worker + ChatConversationDO (Hibernation)', () => {
  it('delivers messages & exact 1-tick -> 2-tick read receipts live over WebSocket, persists across reload, and prevents false reads on newer messages', async () => {
    const cluster = new WorkerChatCluster();
    try {
      const alice = await cluster.registerAndLogin('RtAlice', 'rt.alice@example.com');
      const bob = await cluster.registerAndLogin('RtBob', 'rt.bob@example.com');
      await cluster.makeFriends(alice, bob);
      const convId = await cluster.openDirectChat(alice, bob.userId);

      // Both Alice and Bob connect via authenticated WebSocket
      const aliceWs = await cluster.connectChatWs(convId, { cookie: alice.cookie });
      const bobWs = await cluster.connectChatWs(convId, { cookie: bob.cookie });
      assert.equal(aliceWs.response.status, 101);
      assert.equal(bobWs.response.status, 101);

      assert.equal(aliceWs.client!.drainEvents()[0]?.type, 'connected');
      assert.equal(bobWs.client!.drainEvents()[0]?.type, 'connected');

      // 1) Alice sends M1 via HTTP -> committed to D1 -> pushed immediately to Bob (and Alice) over WS
      const send1 = await cluster.fetch(
        `/api/social/chat/conversations/${convId}/messages`,
        {
          method: 'POST',
          cookie: alice.cookie,
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
          },
          body: JSON.stringify({ body: 'سلام باب، حکم میای؟', clientMsgId: 'cmsg_rt_1' }),
        }
      );
      assert.equal(send1.status, 201);
      const send1Json = (await send1.json()) as {
        message: { messageId: string; createdAt: number; body: string };
      };
      const m1 = send1Json.message;

      // Bob receives message:new instantly without any HTTP polling!
      const bobEvents1 = bobWs.client!.drainEvents();
      assert.equal(bobEvents1.length, 1);
      assert.equal(bobEvents1[0].type, 'message:new');
      if (bobEvents1[0].type === 'message:new') {
        assert.equal(bobEvents1[0].message.messageId, m1.messageId);
        assert.equal(bobEvents1[0].message.body, 'سلام باب، حکم میای؟');
      }

      // Alice's M1 is STILL 1 tick (partnerLastReadAt is null because Bob hasn't read yet)
      aliceWs.client!.drainEvents();
      const aliceCheckBeforeRead = (await (
        await cluster.fetch(`/api/social/chat/conversations/${convId}/messages`, {
          method: 'GET',
          cookie: alice.cookie,
        })
      ).json()) as {
        partnerLastReadAt: number | null;
        partnerLastReadMessageId: string | null;
      };
      assert.equal(aliceCheckBeforeRead.partnerLastReadAt, null);
      assert.equal(aliceCheckBeforeRead.partnerLastReadMessageId, null);

      // 2) Alice sends M2 slightly later BEFORE Bob reads M1
      await new Promise((r) => setTimeout(r, 15));
      const send2 = await cluster.fetch(
        `/api/social/chat/conversations/${convId}/messages`,
        {
          method: 'POST',
          cookie: alice.cookie,
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
          },
          body: JSON.stringify({ body: 'پیام دوم که هنوز خوانده نشده', clientMsgId: 'cmsg_rt_2' }),
        }
      );
      assert.equal(send2.status, 201);
      const m2 = ((await send2.json()) as {
        message: { messageId: string; createdAt: number };
      }).message;
      assert.ok(m2.createdAt > m1.createdAt);
      aliceWs.client!.drainEvents();
      bobWs.client!.drainEvents();

      // 3) Bob marks ONLY M1 as read (at a later wall-clock time!)
      await new Promise((r) => setTimeout(r, 15));
      const read1Res = await cluster.fetch(
        `/api/social/chat/conversations/${convId}/read`,
        {
          method: 'POST',
          cookie: bob.cookie,
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
          },
          body: JSON.stringify({ lastReadMessageId: m1.messageId }),
        }
      );
      assert.equal(read1Res.status, 200);
      const read1Json = (await read1Res.json()) as {
        lastReadMessageId: string;
        lastReadAt: number;
      };
      // CRITICAL INVARIANT: Stored lastReadAt MUST equal m1.createdAt, NOT wall-clock `now`!
      assert.equal(read1Json.lastReadMessageId, m1.messageId);
      assert.equal(read1Json.lastReadAt, m1.createdAt);

      // Alice receives `read:updated` live over WebSocket!
      const aliceReadEvts = aliceWs.client!.drainEvents();
      assert.equal(aliceReadEvts.length, 1);
      assert.equal(aliceReadEvts[0].type, 'read:updated');
      if (aliceReadEvts[0].type === 'read:updated') {
        assert.equal(aliceReadEvts[0].readerUserId, bob.userId);
        assert.equal(aliceReadEvts[0].lastReadMessageId, m1.messageId);
        assert.equal(aliceReadEvts[0].lastReadAt, m1.createdAt);

        const liveCursor = {
          lastReadAt: aliceReadEvts[0].lastReadAt,
          lastReadMessageId: aliceReadEvts[0].lastReadMessageId,
        };
        // M1 -> 2 ticks; M2 -> STILL 1 tick (never falsely marked read!)
        assert.equal(
          isMessageReadByPartner({ ...m1, localStatus: 'sent' }, liveCursor),
          true
        );
        assert.equal(
          isMessageReadByPartner({ ...m2, localStatus: 'sent' }, liveCursor),
          false
        );
      }

      // Bob's unreadCount MUST still be 1 (for M2)
      const bobConvsMid = (await (
        await cluster.fetch('/api/social/chat/conversations', {
          method: 'GET',
          cookie: bob.cookie,
        })
      ).json()) as { conversations: Array<{ unreadCount: number }> };
      assert.equal(bobConvsMid.conversations[0].unreadCount, 1);

      // 4) Bob now marks M2 as read -> Alice gets live 2 ticks for M2 -> persists after reload
      const read2Res = await cluster.fetch(
        `/api/social/chat/conversations/${convId}/read`,
        {
          method: 'POST',
          cookie: bob.cookie,
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
          },
          body: JSON.stringify({ lastReadMessageId: m2.messageId }),
        }
      );
      assert.equal(read2Res.status, 200);
      const aliceRead2Evts = aliceWs.client!.drainEvents();
      assert.equal(aliceRead2Evts[0]?.type, 'read:updated');

      // Out-of-order stale read for M1 MUST NOT regress cursor or broadcast redundant WS event
      const staleReadRes = await cluster.fetch(
        `/api/social/chat/conversations/${convId}/read`,
        {
          method: 'POST',
          cookie: bob.cookie,
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
          },
          body: JSON.stringify({ lastReadMessageId: m1.messageId }),
        }
      );
      assert.equal(staleReadRes.status, 200);
      const staleJson = (await staleReadRes.json()) as { lastReadMessageId: string };
      assert.equal(staleJson.lastReadMessageId, m2.messageId);
      assert.equal(
        aliceWs.client!.drainEvents().length,
        0,
        'Non-advancing stale read must not waste DO broadcasts'
      );

      // Reload check (GET /messages) restores exact partner read cursor
      const reloadRes = (await (
        await cluster.fetch(`/api/social/chat/conversations/${convId}/messages`, {
          method: 'GET',
          cookie: alice.cookie,
        })
      ).json()) as {
        partnerLastReadAt: number | null;
        partnerLastReadMessageId: string | null;
      };
      assert.equal(reloadRes.partnerLastReadMessageId, m2.messageId);
      assert.equal(reloadRes.partnerLastReadAt, m2.createdAt);
    } finally {
      cluster.close();
    }
  });

  it('survives Durable Object Hibernation cold restart, supports multi-tab delivery, incremental delta sync, and idempotent retry without duplicate broadcasts', async () => {
    const cluster = new WorkerChatCluster();
    try {
      const alice = await cluster.registerAndLogin('HibAlice', 'hib.alice@example.com');
      const bob = await cluster.registerAndLogin('HibBob', 'hib.bob@example.com');
      await cluster.makeFriends(alice, bob);
      const convId = await cluster.openDirectChat(alice, bob.userId);

      // Bob opens 2 tabs on the same conversation
      const bobTab1 = await cluster.connectChatWs(convId, { cookie: bob.cookie });
      const bobTab2 = await cluster.connectChatWs(convId, { cookie: bob.cookie });
      assert.equal(bobTab1.response.status, 101);
      assert.equal(bobTab2.response.status, 101);
      bobTab1.client!.drainEvents();
      bobTab2.client!.drainEvents();

      // *** SIMULATE CLOUDFLARE HIBERNATION EVICTION / COLD RESTART ***
      cluster.simulateHibernationRestart(convId);

      // Send message AFTER cold restart -> BOTH hibernated tabs receive it with zero in-memory Map!
      const sendRes = await cluster.fetch(
        `/api/social/chat/conversations/${convId}/messages`,
        {
          method: 'POST',
          cookie: alice.cookie,
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
          },
          body: JSON.stringify({ body: 'بعد از Hibernate!', clientMsgId: 'cmsg_hib_01' }),
        }
      );
      assert.equal(sendRes.status, 201);
      const firstMsg = ((await sendRes.json()) as {
        message: { messageId: string; createdAt: number };
      }).message;

      assert.equal(bobTab1.client!.drainEvents()[0]?.type, 'message:new');
      assert.equal(bobTab2.client!.drainEvents()[0]?.type, 'message:new');

      // Hibernated socket ping -> fresh DO responds with pong
      const slot = cluster.getOrCreateChatSlot(convId);
      await slot.instance.webSocketMessage(
        bobTab1.server!,
        JSON.stringify({ type: 'ping', clientTime: 42 })
      );
      const pongEvt = bobTab1.client!.drainEvents()[0];
      assert.equal(pongEvt?.type, 'pong');

      // Duplicate clientMsgId retry -> 200 deduplicated: true, ZERO duplicate WS broadcast
      const retryRes = await cluster.fetch(
        `/api/social/chat/conversations/${convId}/messages`,
        {
          method: 'POST',
          cookie: alice.cookie,
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
          },
          body: JSON.stringify({ body: 'بعد از Hibernate!', clientMsgId: 'cmsg_hib_01' }),
        }
      );
      assert.equal(retryRes.status, 200);
      assert.equal(((await retryRes.json()) as { deduplicated: boolean }).deduplicated, true);
      assert.equal(bobTab1.client!.drainEvents().length, 0);

      // Closing Tab 1 keeps Tab 2 alive and receiving messages
      bobTab1.server!.close(1000, 'tab_closed');
      await slot.instance.webSocketClose(bobTab1.server!, 1000, 'tab_closed', true);

      await new Promise((r) => setTimeout(r, 10));
      const send2 = await cluster.fetch(
        `/api/social/chat/conversations/${convId}/messages`,
        {
          method: 'POST',
          cookie: alice.cookie,
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
          },
          body: JSON.stringify({ body: 'فقط تب دوم آنلاین است', clientMsgId: 'cmsg_hib_02' }),
        }
      );
      assert.equal(send2.status, 201);
      const secondMsg = ((await send2.json()) as {
        message: { messageId: string; createdAt: number };
      }).message;
      assert.equal(bobTab1.client!.drainEvents().length, 0);
      assert.equal(bobTab2.client!.drainEvents()[0]?.type, 'message:new');

      // Incremental HTTP delta sync (`after` + `afterMessageId`) returns ONLY secondMsg (not firstMsg!)
      const deltaRes = await cluster.fetch(
        `/api/social/chat/conversations/${convId}/messages?after=${firstMsg.createdAt}&afterMessageId=${encodeURIComponent(firstMsg.messageId)}`,
        { method: 'GET', cookie: bob.cookie }
      );
      assert.equal(deltaRes.status, 200);
      const deltaJson = (await deltaRes.json()) as {
        messages: Array<{ messageId: string; body: string }>;
      };
      assert.equal(deltaJson.messages.length, 1);
      assert.equal(deltaJson.messages[0].messageId, secondMsg.messageId);
    } finally {
      cluster.close();
    }
  });

  it('strictly enforces security: Origin, auth cookie, non-member, forged headers, cross-conversation isolation, block/unfriend eviction, logout eviction, and hidden internal DO routes', async () => {
    const cluster = new WorkerChatCluster();
    try {
      const alice = await cluster.registerAndLogin('SecAlice', 'sec.alice@example.com');
      const bob = await cluster.registerAndLogin('SecBob', 'sec.bob@example.com');
      const charlie = await cluster.registerAndLogin('SecCharlie', 'sec.charlie@example.com');
      const dave = await cluster.registerAndLogin('SecDave', 'sec.dave@example.com');

      await cluster.makeFriends(alice, bob);
      await cluster.makeFriends(charlie, dave);

      const convAB = await cluster.openDirectChat(alice, bob.userId);
      const convCD = await cluster.openDirectChat(charlie, dave.userId);

      // 1) Disallowed Origin -> 403
      const evilOrigin = await cluster.connectChatWs(convAB, {
        cookie: alice.cookie,
        origin: 'https://evil-attacker.invalid',
      });
      assert.equal(evilOrigin.response.status, 403);

      // 2) Unauthenticated (no cookie) -> 401
      const noAuth = await cluster.connectChatWs(convAB);
      assert.equal(noAuth.response.status, 401);

      // 3) Non-member (Charlie) even with forged X-Eyvan-Verified-User-Id & query param -> 403
      const forged = await cluster.connectChatWs(convAB, {
        cookie: charlie.cookie,
        query: `userId=${alice.userId}`,
        extraHeaders: {
          'X-Eyvan-Verified-User-Id': alice.userId,
          'X-Eyvan-Verified-Session-Id': 'sess_fake',
        },
      });
      assert.equal(forged.response.status, 403);

      // 4) Public calls to internal DO paths -> 404
      const pubInternal = await cluster.fetch('/broadcast/message', {
        method: 'POST',
        cookie: alice.cookie,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: convAB }),
      });
      assert.equal(pubInternal.status, 404);

      // 5) Cross-conversation isolation: convCD receives ZERO events from convAB
      const aliceConn = await cluster.connectChatWs(convAB, { cookie: alice.cookie });
      const bobConn = await cluster.connectChatWs(convAB, { cookie: bob.cookie });
      const charlieConn = await cluster.connectChatWs(convCD, { cookie: charlie.cookie });
      assert.equal(aliceConn.response.status, 101);
      assert.equal(bobConn.response.status, 101);
      assert.equal(charlieConn.response.status, 101);
      aliceConn.client!.drainEvents();
      bobConn.client!.drainEvents();
      charlieConn.client!.drainEvents();

      await cluster.fetch(`/api/social/chat/conversations/${convAB}/messages`, {
        method: 'POST',
        cookie: alice.cookie,
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({ body: 'محرمانه بین آلیس و باب' }),
      });
      assert.equal(bobConn.client!.drainEvents().length, 1);
      assert.equal(charlieConn.client!.drainEvents().length, 0);

      // 6) Oversized WS frame & unsupported WS mutation message rejected safely
      const slotAB = cluster.getOrCreateChatSlot(convAB);
      await slotAB.instance.webSocketMessage(bobConn.server!, 'x'.repeat(2048));
      const sizeErr = bobConn.client!.drainEvents()[0];
      assert.equal(sizeErr?.type, 'error');
      await slotAB.instance.webSocketMessage(
        bobConn.server!,
        JSON.stringify({ type: 'message:new', body: 'forged' })
      );
      const unsupErr = bobConn.client!.drainEvents()[0];
      assert.equal(unsupErr?.type, 'error');

      // 7) Logout immediately evicts ONLY the logged-out user's active WS socket with 4401
      const logoutRes = await cluster.fetch('/api/auth/logout', {
        method: 'POST',
        cookie: charlie.cookie,
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
      });
      assert.equal(logoutRes.status, 200);
      assert.equal(charlieConn.server!.closedCode, CHAT_WS_CLOSE_UNAUTHORIZED);
      const charlieEvts = charlieConn.client!.drainEvents();
      assert.equal(charlieEvts[0]?.type, 'conversation:revoked');

      // Reconnecting with the revoked cookie is strictly rejected (401)
      const reconnectRevoked = await cluster.connectChatWs(convCD, {
        cookie: charlie.cookie,
      });
      assert.equal(reconnectRevoked.response.status, 401);

      // 8) Blocking immediately disconnects active sockets in convAB with 4403 and blocks future upgrades
      const blockRes = await cluster.fetch('/api/social/blocks', {
        method: 'POST',
        cookie: alice.cookie,
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({ targetUserId: bob.userId }),
      });
      assert.equal(blockRes.status, 200);
      assert.equal(bobConn.server!.closedCode, CHAT_WS_CLOSE_FORBIDDEN);
      assert.equal(aliceConn.server!.closedCode, CHAT_WS_CLOSE_FORBIDDEN);
      const bobBlockEvts = bobConn.client!.drainEvents();
      assert.equal(bobBlockEvts[0]?.type, 'conversation:revoked');
      if (bobBlockEvts[0]?.type === 'conversation:revoked') {
        assert.equal(bobBlockEvts[0].reason, 'blocked');
      }

      const blockedReconnect = await cluster.connectChatWs(convAB, {
        cookie: bob.cookie,
      });
      assert.equal(blockedReconnect.response.status, 403);
    } finally {
      cluster.close();
    }
  });

  it('enforces Cloudflare Free Tier Hibernation discipline inside ChatConversationDO source (zero timers, zero ws.accept)', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'cloudflare/src/ChatConversationDO.ts'),
      'utf8'
    );
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    assert.equal(/\bsetInterval\s*\(/.test(codeOnly), false, 'ChatConversationDO must NEVER use setInterval');
    assert.equal(/\bsetTimeout\s*\(/.test(codeOnly), false, 'ChatConversationDO must NEVER use setTimeout');
    assert.equal(/\.\s*accept\s*\(\s*\)/.test(codeOnly), false, 'ChatConversationDO must use ctx.acceptWebSocket, never ws.accept()');
    assert.ok(codeOnly.includes('ctx.acceptWebSocket('));
    assert.ok(codeOnly.includes('serializeAttachment('));
    assert.ok(codeOnly.includes('deserializeAttachment('));
  });
});

// ---------------------------------------------------------------------------
// 3. Express + Real TCP WebSocket (`ws`) & Pure HTTP Fallback Parity Test
// ---------------------------------------------------------------------------

describe('Real-Time Private Chat — Express Live WebSocket & HTTP Fallback Parity', () => {
  it('streams real-time messages and 2-tick read receipts over real TCP WebSocket in Express and preserves pure HTTP delta fallback', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyvan-express-chat-ws-'));
    const db = new EyvanDatabase(path.join(tmpDir, 'eyvan.sqlite'));
    const roomManager = new HokmRoomManager({ db });
    const hub = new ExpressChatRealtimeHub();
    const verifyTokens: string[] = [];

    const emailSender: EmailSender = {
      async sendVerificationEmail(payload) {
        const hash = new URL(payload.verifyUrl).hash.replace(/^#/, '');
        const token = new URLSearchParams(hash).get('verify-email');
        if (token) verifyTokens.push(token);
        return { configured: true, sent: true, provider: 'mock' };
      },
      async sendPasswordResetEmail() {
        return { configured: true, sent: true, provider: 'mock' };
      },
    };

    const { app, isRequestOriginAllowed } = createEyvanExpressApp({
      db,
      roomManager,
      chatRealtimePublisher: hub,
      config: { isProduction: false },
      emailSender,
    });

    const server = http.createServer(app);
    const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
    const chatRe = /^\/ws\/social\/chat\/(cnv_[a-zA-Z0-9_-]{8,64})$/;

    server.on('upgrade', (req, socket, head) => {
      const u = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      const m = chatRe.exec(u.pathname);
      if (!m || !isRequestOriginAllowed(req)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      const rawTok = parseAuthCookieFromHeader(req.headers.cookie);
      if (!rawTok) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      void (async () => {
        const d1 = db.getD1Adapter();
        const verified = await verifyAuthSession(d1, rawTok);
        if (!verified.authenticated || !verified.user || !verified.session) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        const access = await authorizeConversationRealtimeAccess(
          d1,
          m[1],
          verified.user.userId
        );
        if (access.ok === false) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          hub.attachSocket({
            ws,
            userId: verified.user!.userId,
            authSessionId: verified.session!.sessionId,
            conversationId: m[1],
          });
        });
      })();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    const wsBase = `ws://127.0.0.1:${addr.port}`;

    try {
      const registerLogin = async (username: string, email: string) => {
        const pw = 'EyvanStrong#2026';
        const r = await fetch(`${baseUrl}/api/auth/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Origin: baseUrl,
          },
          body: JSON.stringify({ email, username, password: pw, confirmPassword: pw }),
        });
        assert.equal(r.status, 201);
        const uid = ((await r.json()) as { user: { userId: string } }).user.userId;
        const tok = verifyTokens.pop()!;
        await fetch(`${baseUrl}/api/auth/verify-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Origin: baseUrl,
          },
          body: JSON.stringify({ token: tok }),
        });
        const l = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Origin: baseUrl,
          },
          body: JSON.stringify({ identifier: email, password: pw }),
        });
        const cookie = extractCookie(l, AUTH_COOKIE_NAME)!;
        return { userId: uid, cookie };
      };

      const alice = await registerLogin('ExpAlice', 'exp.alice@example.com');
      const bob = await registerLogin('ExpBob', 'exp.bob@example.com');

      const fr = await fetch(`${baseUrl}/api/social/friends/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: baseUrl,
          Cookie: alice.cookie,
        },
        body: JSON.stringify({ targetUserId: bob.userId }),
      });
      const fid = ((await fr.json()) as { friendshipId: string }).friendshipId;
      await fetch(`${baseUrl}/api/social/friends/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: baseUrl,
          Cookie: bob.cookie,
        },
        body: JSON.stringify({ friendshipId: fid }),
      });

      const openRes = await fetch(`${baseUrl}/api/social/chat/conversations/direct`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: baseUrl,
          Cookie: alice.cookie,
        },
        body: JSON.stringify({ targetUserId: bob.userId }),
      });
      const convId = ((await openRes.json()) as {
        conversation: { conversationId: string };
      }).conversation.conversationId;

      const connectClient = (cookie: string) =>
        new Promise<{ ws: WebSocket; events: ChatWsServerEvent[] }>((resolve, reject) => {
          const events: ChatWsServerEvent[] = [];
          const ws = new WebSocket(`${wsBase}/ws/social/chat/${convId}`, {
            headers: { Cookie: cookie, Origin: baseUrl },
          });
          ws.on('message', (data) => {
            const evt = parseChatWsServerEvent(String(data));
            if (evt) events.push(evt);
          });
          ws.once('open', () => resolve({ ws, events }));
          ws.once('error', reject);
        });

      const waitForEvent = async (
        events: ChatWsServerEvent[],
        type: ChatWsServerEvent['type']
      ) => {
        for (let i = 0; i < 40; i++) {
          const found = events.find((e) => e.type === type);
          if (found) return found;
          await new Promise((r) => setTimeout(r, 25));
        }
        throw new Error(`Timed out waiting for WS event ${type}`);
      };

      const aliceSock = await connectClient(alice.cookie);
      const bobSock = await connectClient(bob.cookie);
      await waitForEvent(aliceSock.events, 'connected');
      await waitForEvent(bobSock.events, 'connected');
      assert.equal(hub.getActiveSocketCount(convId), 2);

      // Alice sends via HTTP -> Bob receives over live TCP WebSocket
      const sendRes = await fetch(
        `${baseUrl}/api/social/chat/conversations/${convId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Origin: baseUrl,
            Cookie: alice.cookie,
          },
          body: JSON.stringify({ body: 'تست زنده وب‌سوکت Express!', clientMsgId: 'cmsg_exp_1' }),
        }
      );
      assert.equal(sendRes.status, 201);
      const sentMsg = ((await sendRes.json()) as {
        message: { messageId: string; createdAt: number };
      }).message;

      const bobMsgEvt = await waitForEvent(bobSock.events, 'message:new');
      if (bobMsgEvt.type === 'message:new') {
        assert.equal(bobMsgEvt.message.messageId, sentMsg.messageId);
      }

      // Bob marks read -> Alice receives `read:updated` live over TCP WebSocket
      const readRes = await fetch(
        `${baseUrl}/api/social/chat/conversations/${convId}/read`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Origin: baseUrl,
            Cookie: bob.cookie,
          },
          body: JSON.stringify({ lastReadMessageId: sentMsg.messageId }),
        }
      );
      assert.equal(readRes.status, 200);

      const aliceReadEvt = await waitForEvent(aliceSock.events, 'read:updated');
      if (aliceReadEvt.type === 'read:updated') {
        assert.equal(aliceReadEvt.lastReadMessageId, sentMsg.messageId);
        assert.equal(aliceReadEvt.lastReadAt, sentMsg.createdAt);
      }

      // Close WebSockets and verify HTTP incremental delta fallback still works cleanly
      aliceSock.ws.close(1000);
      bobSock.ws.close(1000);
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(hub.getActiveSocketCount(convId), 0);

      await new Promise((r) => setTimeout(r, 10));
      const sendFallback = await fetch(
        `${baseUrl}/api/social/chat/conversations/${convId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Origin: baseUrl,
            Cookie: bob.cookie,
          },
          body: JSON.stringify({ body: 'پیام در حالت Fallback', clientMsgId: 'cmsg_exp_2' }),
        }
      );
      assert.equal(sendFallback.status, 201);
      const fallbackMsg = ((await sendFallback.json()) as {
        message: { messageId: string };
      }).message;

      const deltaRes = await fetch(
        `${baseUrl}/api/social/chat/conversations/${convId}/messages?after=${sentMsg.createdAt}&afterMessageId=${encodeURIComponent(sentMsg.messageId)}`,
        { headers: { Cookie: alice.cookie } }
      );
      assert.equal(deltaRes.status, 200);
      const deltaJson = (await deltaRes.json()) as {
        messages: Array<{ messageId: string }>;
        partnerLastReadMessageId: string | null;
      };
      assert.equal(deltaJson.messages.length, 1);
      assert.equal(deltaJson.messages[0].messageId, fallbackMsg.messageId);
    } finally {
      hub.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
