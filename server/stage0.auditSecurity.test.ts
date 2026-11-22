import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import worker, { HokmRoomDO } from '../cloudflare/src/index';
import {
  fetchPlayerStatsByUserIdFromD1,
  persistCompletedMatchToD1,
  upsertUserInD1,
} from '../cloudflare/src/lib/d1Persistence';
import {
  loginWithCredentials,
  registerManualAccount,
  updateAuthenticatedProfile,
  upgradeGuestAccountToRegistered,
} from '../cloudflare/src/lib/auth/authService';
import { verifyEmailWithToken } from '../cloudflare/src/lib/auth/c2Service';
import { EmailSender } from '../cloudflare/src/lib/auth/emailService';
import {
  acceptFriendRequest,
  getFriendsPresence,
  heartbeatPresence,
  listFriendRequests,
  listFriends,
  removeFriend,
  searchSocialUsers,
  sendFriendRequest,
} from '../cloudflare/src/lib/social/socialService';
import {
  CfWorkerEnv,
  DurableObjectNamespaceLike,
  DurableObjectStateLike,
  DurableObjectStorageLike,
  HibernatableWebSocket,
} from '../cloudflare/src/lib/types';
import { CompletedMatchRecord } from '../src/games/hokm/online/protocol';
import { createEyvanExpressApp } from './createExpressApp';
import { EyvanDatabase } from './database';
import { DEFAULT_MIGRATIONS_DIR, runDatabaseMigrations } from './migrations';
import { HokmRoomManager } from './roomManager';

const TEST_ORIGIN = 'http://localhost:3000';

class InMemoryDOStorage implements DurableObjectStorageLike {
  private readonly store = new Map<string, unknown>();
  private alarmTime: number | null = null;

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.store.get(key) as T | undefined;
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
    this.alarmTime = null;
  }

  async setAlarm(scheduledTime: number | Date): Promise<void> {
    this.alarmTime =
      typeof scheduledTime === 'number' ? scheduledTime : scheduledTime.getTime();
  }

  async deleteAlarm(): Promise<void> {
    this.alarmTime = null;
  }

  async getAlarm(): Promise<number | null> {
    return this.alarmTime;
  }
}

class MockDOState implements DurableObjectStateLike {
  public readonly storage = new InMemoryDOStorage();
  private readonly sockets: Array<{ ws: HibernatableWebSocket; tags: string[] }> = [];

  acceptWebSocket(ws: HibernatableWebSocket, tags: string[] = []): void {
    this.sockets.push({ ws, tags });
  }

  getWebSockets(tag?: string): HibernatableWebSocket[] {
    if (!tag) return this.sockets.map((s) => s.ws);
    return this.sockets.filter((s) => s.tags.includes(tag)).map((s) => s.ws);
  }

  async blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    return callback();
  }
}

function createWorkerHarness(db: EyvanDatabase): {
  env: CfWorkerEnv;
  rooms: Map<string, HokmRoomDO>;
} {
  const rooms = new Map<string, HokmRoomDO>();

  const env: CfWorkerEnv = {
    EYVAN_DB: db.getD1Adapter(),
    EYVAN_ASSETS: {
      async get() {
        return null;
      },
    },
    ALLOWED_ORIGINS: TEST_ORIGIN,
    HOKM_ROOM: {
      idFromName(name: string): string {
        return name;
      },
      get(id: unknown) {
        const key = String(id);
        let instance = rooms.get(key);
        if (!instance) {
          instance = new HokmRoomDO(new MockDOState(), env);
          rooms.set(key, instance);
        }
        return {
          fetch: (req: Request) => instance!.fetch(req),
        };
      },
    } satisfies DurableObjectNamespaceLike,
  };

  return { env, rooms };
}

function createTempDb(): { tmpDir: string; dbPath: string; db: EyvanDatabase } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyvan-stage0-'));
  const dbPath = path.join(tmpDir, 'stage0.sqlite');
  const db = new EyvanDatabase(dbPath);
  return { tmpDir, dbPath, db };
}

async function createRegisteredVerifiedUser(
  db: EyvanDatabase,
  params: {
    username: string;
    email: string;
    password?: string;
    avatarCode?: string;
    now?: number;
  }
): Promise<{
  userId: string;
  sessionId: string;
  sessionToken: string;
  username: string;
  cookieHeader: string;
}> {
  const now = params.now ?? Date.now();
  const password = params.password ?? 'StrongPass#2026!';
  let capturedVerifyToken = '';
  const emailSender: EmailSender = {
    async sendVerificationEmail(payload) {
      const m = payload.verifyUrl.match(/#verify-email=([A-Za-z0-9_-]+)/);
      if (m) capturedVerifyToken = m[1];
      return { configured: true, sent: true, provider: 'test' };
    },
    async sendPasswordResetEmail() {
      return { configured: true, sent: true, provider: 'test' };
    },
  };

  const reg = await registerManualAccount(
    db.getD1Adapter(),
    {
      username: params.username,
      email: params.email,
      password,
      confirmPassword: password,
      avatarCode: params.avatarCode ?? 'portrait',
    },
    {
      clientIp: '127.0.0.1',
      userAgent: 'stage0-test',
      publicAppBaseUrl: TEST_ORIGIN,
      now,
    },
    emailSender
  );
  assert.equal(reg.ok, true, `register failed for ${params.username}: ${JSON.stringify(reg)}`);
  if (!reg.ok) throw new Error('register failed');
  assert.ok(capturedVerifyToken, 'expected verification token to be captured');

  const ver = await verifyEmailWithToken(
    db.getD1Adapter(),
    { token: capturedVerifyToken },
    { clientIp: '127.0.0.1', userAgent: 'stage0-test', now: now + 10 }
  );
  assert.equal(ver.ok, true, `verify failed for ${params.username}`);

  // If a custom avatarCode was requested, apply it via authenticated profile update or direct login
  const login = await loginWithCredentials(
    db.getD1Adapter(),
    { identifier: params.email, password },
    { clientIp: '127.0.0.1', userAgent: 'stage0-test', now: now + 20 }
  );
  assert.equal(login.ok, true, `login failed for ${params.username}`);
  if (!login.ok) throw new Error('login failed');

  if (params.avatarCode && params.avatarCode !== login.user.avatarCode) {
    const upd = await updateAuthenticatedProfile(
      db.getD1Adapter(),
      login.rawSessionToken,
      { username: params.username, avatarCode: params.avatarCode },
      { clientIp: '127.0.0.1', userAgent: 'stage0-test', now: now + 25 }
    );
    assert.equal(upd.ok, true);
  }

  return {
    userId: login.user.userId,
    sessionId: login.session.sessionId,
    sessionToken: login.rawSessionToken,
    username: login.user.username,
    cookieHeader: `eyvan_auth_sess=${login.rawSessionToken}`,
  };
}

function makeCompletedMatch(
  matchId: string,
  players: Array<{
    playerId: string;
    userId?: string | null;
    username: string;
    canonicalSeat: 'south' | 'east' | 'north' | 'west';
    team: 'myTeam' | 'opponentTeam';
    won: boolean;
  }>,
  finishedAt = Date.now(),
  lastWinType: 'normal' | 'kot' | 'hakem_kot' = 'normal'
): CompletedMatchRecord {
  return {
    matchId,
    roomCode: 'STG0RM',
    startedAt: finishedAt - 60_000,
    finishedAt,
    winningTeam: 'myTeam',
    teamAScore: 3,
    teamBScore: 1,
    targetScore: 3,
    lastWinType,
    handsPlayed: 4,
    players,
  };
}

async function startExpressServer(db: EyvanDatabase): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const roomManager = new HokmRoomManager({ db });
  const { app } = createEyvanExpressApp({
    db,
    roomManager,
    config: {
      isProduction: false,
      allowedOrigins: TEST_ORIGIN,
      authSessionTtlSec: 3600,
      emailProvider: 'console',
      emailFrom: 'no-reply@eyvan.test',
      publicAppUrl: TEST_ORIGIN,
      defaultPort: 0,
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to bind ephemeral Express port');
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    close: async () => {
      roomManager.dispose();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
    },
  };
}

describe('Stage 0 — Security, Identity Isolation, Blocking Privacy & Migration Audit', () => {
  it('1. Guest entering a room with a registered account username never mutates or binds to the registered account (Express & Worker)', async () => {
    const { tmpDir, dbPath, db } = createTempDb();
    const server = await startExpressServer(db);
    try {
      const t0 = 1_730_000_000_000;
      const reg = await createRegisteredVerifiedUser(db, {
        username: 'RegisteredAce',
        email: 'ace@example.com',
        avatarCode: 'shamsa',
        now: t0,
      });

      const rawBefore = new Database(dbPath, { readonly: true });
      const beforeUser = rawBefore
        .prepare(
          `SELECT user_id, username, avatar_code, account_status, auth_provider, last_seen_at, updated_at
           FROM users WHERE user_id = ?`
        )
        .get(reg.userId) as Record<string, unknown>;
      rawBefore.close();

      // A) Express: unauthenticated guest creates a room using the registered username
      const expRes = await fetch(`${server.baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: TEST_ORIGIN,
        },
        body: JSON.stringify({
          username: 'RegisteredAce',
          avatarCode: 'jade',
          targetMatchScore: 3,
        }),
      });
      assert.equal(expRes.status, 201);

      // B) Cloudflare Worker + DO: unauthenticated guest creates a room using the registered username
      const { env } = createWorkerHarness(db);
      const workerRes = await worker.fetch(
        new Request('https://api.eyvan.ir/api/rooms', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: TEST_ORIGIN,
          },
          body: JSON.stringify({
            username: 'RegisteredAce',
            avatarCode: 'jade',
            targetMatchScore: 3,
          }),
        }),
        env
      );
      assert.equal(workerRes.status, 201);

      // C) Direct guest upsert helpers must return null and never touch the registered row
      assert.equal(db.upsertUser('RegisteredAce', 'jade', t0 + 999_999), null);
      assert.equal(
        await upsertUserInD1(db.getD1Adapter(), 'registeredace', 'jade', t0 + 999_999),
        null
      );

      const rawAfter = new Database(dbPath, { readonly: true });
      const afterUser = rawAfter
        .prepare(
          `SELECT user_id, username, avatar_code, account_status, auth_provider, last_seen_at, updated_at
           FROM users WHERE user_id = ?`
        )
        .get(reg.userId) as Record<string, unknown>;
      rawAfter.close();

      assert.deepEqual(afterUser, beforeUser);
    } finally {
      await server.close();
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('2. Guest completed match using a registered username NEVER attaches to registered user_id, user_game_stats, or player_stats (SQLite & D1)', async () => {
    const { tmpDir, dbPath, db } = createTempDb();
    try {
      const t0 = 1_730_001_000_000;
      const reg = await createRegisteredVerifiedUser(db, {
        username: 'ProtectedHero',
        email: 'protected@example.com',
        now: t0,
      });

      // First: registered user plays 1 genuine authenticated match and loses (0 wins, 1 loss)
      const genuineMatch = makeCompletedMatch(
        'match_genuine_1',
        [
          {
            playerId: 'p_auth',
            userId: reg.userId,
            username: 'ProtectedHero',
            canonicalSeat: 'south',
            team: 'opponentTeam',
            won: false,
          },
          { playerId: 'p2', username: 'GuestBotA', canonicalSeat: 'east', team: 'myTeam', won: true },
          { playerId: 'p3', username: 'GuestBotB', canonicalSeat: 'north', team: 'opponentTeam', won: false },
          { playerId: 'p4', username: 'GuestBotC', canonicalSeat: 'west', team: 'myTeam', won: true },
        ],
        t0 + 10_000
      );
      db.recordCompletedMatch(genuineMatch);

      // Second: unauthenticated guest (`userId: undefined`) plays & wins with 'ProtectedHero' in SQLite
      const guestImpersonationSqlite = makeCompletedMatch(
        'match_guest_impersonate_sqlite',
        [
          {
            playerId: 'p_guest_sq',
            username: 'ProtectedHero',
            canonicalSeat: 'south',
            team: 'myTeam',
            won: true,
          },
          { playerId: 'p2', username: 'GuestX1', canonicalSeat: 'east', team: 'opponentTeam', won: false },
          { playerId: 'p3', username: 'GuestX2', canonicalSeat: 'north', team: 'myTeam', won: true },
          { playerId: 'p4', username: 'GuestX3', canonicalSeat: 'west', team: 'opponentTeam', won: false },
        ],
        t0 + 20_000,
        'kot'
      );
      db.recordCompletedMatch(guestImpersonationSqlite);

      // Third: unauthenticated guest plays & wins with 'protectedhero' via D1 persistence
      const guestImpersonationD1 = makeCompletedMatch(
        'match_guest_impersonate_d1',
        [
          {
            playerId: 'p_guest_d1',
            username: 'protectedhero',
            canonicalSeat: 'south',
            team: 'myTeam',
            won: true,
          },
          { playerId: 'p2', username: 'GuestY1', canonicalSeat: 'east', team: 'opponentTeam', won: false },
          { playerId: 'p3', username: 'GuestY2', canonicalSeat: 'north', team: 'myTeam', won: true },
          { playerId: 'p4', username: 'GuestY3', canonicalSeat: 'west', team: 'opponentTeam', won: false },
        ],
        t0 + 30_000,
        'hakem_kot'
      );
      const d1Res = await persistCompletedMatchToD1(db.getD1Adapter(), guestImpersonationD1);
      assert.equal(d1Res.persisted, true);

      // Verify registered user's authoritative stats remained STRICTLY 1 match, 0 wins, 1 loss!
      const statsSqlite = db.getPlayerStatsByUserId(reg.userId);
      assert.ok(statsSqlite);
      assert.equal(statsSqlite.matchesPlayed, 1);
      assert.equal(statsSqlite.wins, 0);
      assert.equal(statsSqlite.losses, 1);
      assert.equal(statsSqlite.kotWins, 0);
      assert.equal(statsSqlite.hakemKotWins, 0);

      const statsD1 = await fetchPlayerStatsByUserIdFromD1(db.getD1Adapter(), reg.userId);
      assert.ok(statsD1);
      assert.equal(statsD1.matchesPlayed, 1);
      assert.equal(statsD1.wins, 0);
      assert.equal(statsD1.losses, 1);

      // Verify registered user's match history contains ONLY the 1 genuine match
      const history = db.getPlayerMatchHistoryByUserId(reg.userId, 20);
      assert.equal(history.length, 1);
      assert.equal(history[0].matchId, 'match_genuine_1');

      // Verify both guest matches were preserved in `match_players` with `user_id IS NULL`
      // AND legacy `player_stats` for 'protectedhero' was NOT incremented by guest wins!
      const raw = new Database(dbPath, { readonly: true });
      const mpSqlite = raw
        .prepare(
          `SELECT user_id, username FROM match_players WHERE match_id = 'match_guest_impersonate_sqlite' AND player_id = 'p_guest_sq'`
        )
        .get() as { user_id: string | null; username: string };
      const mpD1 = raw
        .prepare(
          `SELECT user_id, username FROM match_players WHERE match_id = 'match_guest_impersonate_d1' AND player_id = 'p_guest_d1'`
        )
        .get() as { user_id: string | null; username: string };
      const legacyRow = raw
        .prepare(`SELECT user_id, matches_played, wins, losses FROM player_stats WHERE username = 'protectedhero'`)
        .get() as { user_id: string | null; matches_played: number; wins: number; losses: number };
      raw.close();

      assert.equal(mpSqlite.user_id, null);
      assert.equal(mpSqlite.username, 'ProtectedHero');
      assert.equal(mpD1.user_id, null);
      assert.equal(mpD1.username, 'protectedhero');
      assert.equal(legacyRow.user_id, reg.userId);
      assert.equal(legacyRow.matches_played, 1);
      assert.equal(legacyRow.wins, 0);
      assert.equal(legacyRow.losses, 1);
    } finally {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('3. Logged-in user creating or joining a room gets authoritative server user_id, username, and avatarCode (ignoring spoofed body fields) in Express & Worker', async () => {
    const { tmpDir, db } = createTempDb();
    const server = await startExpressServer(db);
    try {
      const userA = await createRegisteredVerifiedUser(db, {
        username: 'TrueHostUser',
        email: 'truehost@example.com',
        avatarCode: 'shamsa',
      });
      const userB = await createRegisteredVerifiedUser(db, {
        username: 'TrueJoinUser',
        email: 'truejoin@example.com',
        avatarCode: 'jade',
      });

      // A) Express: userA tries to spoof username/avatarCode/userId in body
      const expCreate = await fetch(`${server.baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: TEST_ORIGIN,
          Cookie: userA.cookieHeader,
        },
        body: JSON.stringify({
          username: 'SpoofedHostName',
          avatarCode: 'portrait',
          userId: userB.userId,
          targetMatchScore: 3,
        }),
      });
      assert.equal(expCreate.status, 201);
      const expCreated = (await expCreate.json()) as { roomCode: string };

      const expJoin = await fetch(`${server.baseUrl}/api/rooms/${expCreated.roomCode}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: TEST_ORIGIN,
          Cookie: userB.cookieHeader,
        },
        body: JSON.stringify({
          username: 'SpoofedJoinName',
          avatarCode: 'portrait',
          userId: userA.userId,
        }),
      });
      assert.equal(expJoin.status, 200);

      const expSummaryRes = await fetch(`${server.baseUrl}/api/rooms/${expCreated.roomCode}`, {
        headers: { Origin: TEST_ORIGIN },
      });
      const expSummary = (await expSummaryRes.json()) as {
        seats: Array<{ canonicalSeat: string; username: string | null }>;
      };
      const southSeat = expSummary.seats.find((s) => s.canonicalSeat === 'south');
      const joinedSeat = expSummary.seats.find(
        (s) => s.canonicalSeat !== 'south' && Boolean(s.username)
      );
      assert.equal(southSeat?.username, 'TrueHostUser');
      assert.equal(joinedSeat?.username, 'TrueJoinUser');

      // B) Cloudflare Worker + DO: same spoof attempt
      const { env } = createWorkerHarness(db);
      const wCreate = await worker.fetch(
        new Request('https://api.eyvan.ir/api/rooms', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: TEST_ORIGIN,
            Cookie: userA.cookieHeader,
          },
          body: JSON.stringify({
            username: 'SpoofedWorkerHost',
            avatarCode: 'portrait',
            userId: userB.userId,
          }),
        }),
        env
      );
      assert.equal(wCreate.status, 201);
      const wCreated = (await wCreate.json()) as { roomCode: string };

      const wJoin = await worker.fetch(
        new Request(`https://api.eyvan.ir/api/rooms/${wCreated.roomCode}/join`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: TEST_ORIGIN,
            Cookie: userB.cookieHeader,
          },
          body: JSON.stringify({
            username: 'SpoofedWorkerJoin',
            avatarCode: 'portrait',
            userId: userA.userId,
          }),
        }),
        env
      );
      assert.equal(wJoin.status, 200);

      const wSummaryRes = await worker.fetch(
        new Request(`https://api.eyvan.ir/api/rooms/${wCreated.roomCode}`, {
          method: 'GET',
          headers: { Origin: TEST_ORIGIN },
        }),
        env
      );
      const wSummary = (await wSummaryRes.json()) as {
        seats: Array<{ canonicalSeat: string; username: string | null }>;
      };
      const wSouth = wSummary.seats.find((s) => s.canonicalSeat === 'south');
      const wJoined = wSummary.seats.find(
        (s) => s.canonicalSeat !== 'south' && Boolean(s.username)
      );
      assert.equal(wSouth?.username, 'TrueHostUser');
      assert.equal(wJoined?.username, 'TrueJoinUser');
    } finally {
      await server.close();
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('4. Renaming username preserves immutable user_id, records username_changed_at, and keeps cumulative stats intact', async () => {
    const { tmpDir, dbPath, db } = createTempDb();
    try {
      const t0 = 1_730_002_000_000;
      const user = await createRegisteredVerifiedUser(db, {
        username: 'BeforeRename',
        email: 'rename@example.com',
        now: t0,
      });

      db.recordCompletedMatch(
        makeCompletedMatch(
          'm_before_rename',
          [
            { playerId: 'p1', userId: user.userId, username: 'BeforeRename', canonicalSeat: 'south', team: 'myTeam', won: true },
            { playerId: 'p2', username: 'G1', canonicalSeat: 'east', team: 'opponentTeam', won: false },
            { playerId: 'p3', username: 'G2', canonicalSeat: 'north', team: 'myTeam', won: true },
            { playerId: 'p4', username: 'G3', canonicalSeat: 'west', team: 'opponentTeam', won: false },
          ],
          t0 + 5_000
        )
      );

      const renameTime = t0 + 15_000;
      const upd = await updateAuthenticatedProfile(
        db.getD1Adapter(),
        user.sessionToken,
        { username: 'AfterRename', avatarCode: 'jade' },
        { clientIp: '127.0.0.1', userAgent: 'stage0-test', now: renameTime }
      );
      assert.equal(upd.ok, true);
      if (upd.ok) {
        assert.equal(upd.user.userId, user.userId);
        assert.equal(upd.user.username, 'AfterRename');
      }

      const raw = new Database(dbPath, { readonly: true });
      const row = raw
        .prepare(`SELECT user_id, username, username_changed_at FROM users WHERE user_id = ?`)
        .get(user.userId) as { user_id: string; username: string; username_changed_at: number | null };
      raw.close();
      assert.equal(row.user_id, user.userId);
      assert.equal(row.username, 'AfterRename');
      assert.equal(row.username_changed_at, renameTime);

      db.recordCompletedMatch(
        makeCompletedMatch(
          'm_after_rename',
          [
            { playerId: 'p1', userId: user.userId, username: 'AfterRename', canonicalSeat: 'south', team: 'myTeam', won: true },
            { playerId: 'p2', username: 'G4', canonicalSeat: 'east', team: 'opponentTeam', won: false },
            { playerId: 'p3', username: 'G5', canonicalSeat: 'north', team: 'myTeam', won: true },
            { playerId: 'p4', username: 'G6', canonicalSeat: 'west', team: 'opponentTeam', won: false },
          ],
          t0 + 25_000
        )
      );

      const stats = db.getPlayerStatsByUserId(user.userId);
      assert.equal(stats?.matchesPlayed, 2);
      assert.equal(stats?.wins, 2);
      assert.equal(db.getPlayerMatchHistoryByUserId(user.userId, 10).length, 2);
    } finally {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('5. Recycling a freed username to a new registered account NEVER transfers old stats or match history', async () => {
    const { tmpDir, db } = createTempDb();
    try {
      const t0 = 1_730_003_000_000;
      const userA = await createRegisteredVerifiedUser(db, {
        username: 'SharedAlias',
        email: 'usera@example.com',
        now: t0,
      });

      db.recordCompletedMatch(
        makeCompletedMatch(
          'm_userA_under_old_name',
          [
            { playerId: 'p1', userId: userA.userId, username: 'SharedAlias', canonicalSeat: 'south', team: 'myTeam', won: true },
            { playerId: 'p2', username: 'GA1', canonicalSeat: 'east', team: 'opponentTeam', won: false },
            { playerId: 'p3', username: 'GA2', canonicalSeat: 'north', team: 'myTeam', won: true },
            { playerId: 'p4', username: 'GA3', canonicalSeat: 'west', team: 'opponentTeam', won: false },
          ],
          t0 + 5_000
        )
      );

      // User A releases 'SharedAlias' by renaming
      const renamed = await updateAuthenticatedProfile(
        db.getD1Adapter(),
        userA.sessionToken,
        { username: 'UserA_New', avatarCode: 'portrait' },
        { clientIp: '127.0.0.1', userAgent: 'stage0-test', now: t0 + 10_000 }
      );
      assert.equal(renamed.ok, true);

      // User B claims 'SharedAlias'
      const userB = await createRegisteredVerifiedUser(db, {
        username: 'SharedAlias',
        email: 'userb@example.com',
        now: t0 + 20_000,
      });
      assert.notEqual(userB.userId, userA.userId);

      // User B MUST start with 0 stats and 0 match history
      const statsBZero = db.getPlayerStatsByUserId(userB.userId);
      assert.equal(statsBZero?.matchesPlayed ?? 0, 0);
      assert.equal(db.getPlayerMatchHistoryByUserId(userB.userId, 10).length, 0);

      // User A still keeps their 1 win
      const statsA = db.getPlayerStatsByUserId(userA.userId);
      assert.equal(statsA?.matchesPlayed, 1);
      assert.equal(statsA?.wins, 1);
    } finally {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('6. Upgrading a guest account preserves guest stats and match history without corrupting other accounts', async () => {
    const { tmpDir, db } = createTempDb();
    try {
      const t0 = 1_730_004_000_000;
      const bystander = await createRegisteredVerifiedUser(db, {
        username: 'BystanderAcc',
        email: 'bystander@example.com',
        now: t0,
      });

      const guestId = db.upsertUser('RisingGuest', 'jade', t0 + 1000);
      assert.ok(guestId);

      db.recordCompletedMatch(
        makeCompletedMatch(
          'm_guest_upgrade_1',
          [
            { playerId: 'pg1', username: 'RisingGuest', canonicalSeat: 'south', team: 'myTeam', won: true },
            { playerId: 'p2', username: 'OG1', canonicalSeat: 'east', team: 'opponentTeam', won: false },
            { playerId: 'p3', username: 'OG2', canonicalSeat: 'north', team: 'myTeam', won: true },
            { playerId: 'p4', username: 'OG3', canonicalSeat: 'west', team: 'opponentTeam', won: false },
          ],
          t0 + 2_000
        )
      );
      db.recordCompletedMatch(
        makeCompletedMatch(
          'm_guest_upgrade_2',
          [
            { playerId: 'pg2', username: 'RisingGuest', canonicalSeat: 'south', team: 'opponentTeam', won: false },
            { playerId: 'p2', username: 'OG4', canonicalSeat: 'east', team: 'myTeam', won: true },
            { playerId: 'p3', username: 'OG5', canonicalSeat: 'north', team: 'opponentTeam', won: false },
            { playerId: 'p4', username: 'OG6', canonicalSeat: 'west', team: 'myTeam', won: true },
          ],
          t0 + 3_000
        )
      );

      const upgraded = await upgradeGuestAccountToRegistered(
        db.getD1Adapter(),
        guestId!,
        {
          username: 'RisingGuestPro',
          email: 'rising@example.com',
          password: 'StrongPass#2026!',
          confirmPassword: 'StrongPass#2026!',
          avatarCode: 'shamsa',
        },
        {
          clientIp: '127.0.0.1',
          userAgent: 'stage0-test',
          publicAppBaseUrl: TEST_ORIGIN,
          now: t0 + 4_000,
        },
        {
          async sendVerificationEmail() {
            return { configured: true, sent: true, provider: 'test' };
          },
          async sendPasswordResetEmail() {
            return { configured: true, sent: true, provider: 'test' };
          },
        }
      );
      assert.equal(upgraded.ok, true);
      if (upgraded.ok) {
        assert.equal(upgraded.user.userId, guestId);
      }

      const upgradedStats = db.getPlayerStatsByUserId(guestId!);
      assert.equal(upgradedStats?.matchesPlayed, 2);
      assert.equal(upgradedStats?.wins, 1);
      assert.equal(upgradedStats?.losses, 1);
      assert.equal(db.getPlayerMatchHistoryByUserId(guestId!, 10).length, 2);

      // Bystander remains completely untouched
      assert.equal(db.getPlayerStatsByUserId(bystander.userId)?.matchesPlayed ?? 0, 0);
    } finally {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('7. Blocked user (in either direction) is hidden from search, friends, requests, sendFriendRequest, and cannot accept pending requests', async () => {
    const { tmpDir, dbPath, db } = createTempDb();
    try {
      const t0 = 1_730_005_000_000;
      const userA = await createRegisteredVerifiedUser(db, {
        username: 'AlphaBlock',
        email: 'alpha@example.com',
        now: t0,
      });
      const userB = await createRegisteredVerifiedUser(db, {
        username: 'BetaBlock',
        email: 'beta@example.com',
        now: t0 + 100,
      });

      // A sends friend request to B
      const reqRes = await sendFriendRequest(db.getD1Adapter(), userB.userId, {
        actorUserId: userA.userId,
        authSessionId: userA.sessionId,
        clientIp: '127.0.0.1',
        now: t0 + 1_000,
      });
      assert.equal(reqRes.ok, true);
      if (!reqRes.ok) throw new Error('sendFriendRequest failed');

      // Suppose a block exists in `user_blocks` even if the pending friendship row remained (defense-in-depth check)
      const raw = new Database(dbPath);
      raw
        .prepare(
          `INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`
        )
        .run(userA.userId, userB.userId, t0 + 2_000);
      raw.close();

      // B MUST NOT be able to accept the pending request while blocked!
      const acceptAttempt = await acceptFriendRequest(db.getD1Adapter(), reqRes.friendshipId, {
        actorUserId: userB.userId,
        authSessionId: userB.sessionId,
        clientIp: '127.0.0.1',
        now: t0 + 3_000,
      });
      assert.equal(acceptAttempt.ok, false);

      // Neither A nor B sees the other in search, friends, or requests
      const searchFromA = await searchSocialUsers(db.getD1Adapter(), 'BetaBlock', 10, 0, {
        actorUserId: userA.userId,
        authSessionId: userA.sessionId,
        clientIp: '127.0.0.1',
        now: t0 + 3_100,
      });
      assert.equal(searchFromA.ok, true);
      if (searchFromA.ok) assert.equal(searchFromA.users.length, 0);

      const searchFromB = await searchSocialUsers(db.getD1Adapter(), 'AlphaBlock', 10, 0, {
        actorUserId: userB.userId,
        authSessionId: userB.sessionId,
        clientIp: '127.0.0.1',
        now: t0 + 3_200,
      });
      assert.equal(searchFromB.ok, true);
      if (searchFromB.ok) assert.equal(searchFromB.users.length, 0);

      const reqsA = await listFriendRequests(db.getD1Adapter(), {
        actorUserId: userA.userId,
        authSessionId: userA.sessionId,
        clientIp: '127.0.0.1',
        now: t0 + 3_300,
      });
      const reqsB = await listFriendRequests(db.getD1Adapter(), {
        actorUserId: userB.userId,
        authSessionId: userB.sessionId,
        clientIp: '127.0.0.1',
        now: t0 + 3_300,
      });
      assert.equal(reqsA.incoming.length + reqsA.outgoing.length, 0);
      assert.equal(reqsB.incoming.length + reqsB.outgoing.length, 0);

      // Sending a new friend request in either direction MUST be rejected with USER_BLOCKED
      const blockedSend = await sendFriendRequest(db.getD1Adapter(), userA.userId, {
        actorUserId: userB.userId,
        authSessionId: userB.sessionId,
        clientIp: '127.0.0.1',
        now: t0 + 3_400,
      });
      assert.equal(blockedSend.ok, false);
      if (!blockedSend.ok) assert.equal(blockedSend.code, 'USER_BLOCKED');
    } finally {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('8. Blocked friend presence is NEVER leaked by GET /api/social/presence/friends (Express & Worker), and unfriend stays distinct from block', async () => {
    const { tmpDir, dbPath, db } = createTempDb();
    const server = await startExpressServer(db);
    try {
      const now = Date.now();
      const userA = await createRegisteredVerifiedUser(db, {
        username: 'PresenceA',
        email: 'presA@example.com',
        now,
      });
      const userB = await createRegisteredVerifiedUser(db, {
        username: 'PresenceB',
        email: 'presB@example.com',
        now: now + 10,
      });
      const userC = await createRegisteredVerifiedUser(db, {
        username: 'PresenceC',
        email: 'presC@example.com',
        now: now + 20,
      });

      // Establish A <-> B and A <-> C friendships
      const abReq = await sendFriendRequest(db.getD1Adapter(), userB.userId, {
        actorUserId: userA.userId,
        authSessionId: userA.sessionId,
        clientIp: '127.0.0.1',
        now: now + 100,
      });
      assert.equal(abReq.ok, true);
      if (!abReq.ok) throw new Error('abReq failed');
      await acceptFriendRequest(db.getD1Adapter(), abReq.friendshipId, {
        actorUserId: userB.userId,
        authSessionId: userB.sessionId,
        clientIp: '127.0.0.1',
        now: now + 110,
      });

      const acReq = await sendFriendRequest(db.getD1Adapter(), userC.userId, {
        actorUserId: userA.userId,
        authSessionId: userA.sessionId,
        clientIp: '127.0.0.1',
        now: now + 120,
      });
      assert.equal(acReq.ok, true);
      if (!acReq.ok) throw new Error('acReq failed');
      await acceptFriendRequest(db.getD1Adapter(), acReq.friendshipId, {
        actorUserId: userC.userId,
        authSessionId: userC.sessionId,
        clientIp: '127.0.0.1',
        now: now + 130,
      });

      // All three users send live presence heartbeats
      const hbA = await heartbeatPresence(db.getD1Adapter(), 'device_stage0_a', 'online', {
        actorUserId: userA.userId,
        authSessionId: userA.sessionId,
        clientIp: '127.0.0.1',
        now,
      });
      const hbB = await heartbeatPresence(db.getD1Adapter(), 'device_stage0_b', 'online', {
        actorUserId: userB.userId,
        authSessionId: userB.sessionId,
        clientIp: '127.0.0.1',
        now,
      });
      const hbC = await heartbeatPresence(db.getD1Adapter(), 'device_stage0_c', 'online', {
        actorUserId: userC.userId,
        authSessionId: userC.sessionId,
        clientIp: '127.0.0.1',
        now,
      });
      assert.equal(hbA.ok, true);
      assert.equal(hbB.ok, true);
      assert.equal(hbC.ok, true);

      // Before block: both B and C are online in A's presence poll
      const prePresA = await getFriendsPresence(db.getD1Adapter(), {
        actorUserId: userA.userId,
        authSessionId: userA.sessionId,
        clientIp: '127.0.0.1',
        now: now + 200,
      });
      assert.equal(prePresA.length, 2);

      // Insert a `user_blocks` row directly while keeping the accepted friendship row intact
      // to specifically verify `getFriendsPresence` enforces `user_blocks` bidirectionally!
      const raw = new Database(dbPath);
      raw
        .prepare(`INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`)
        .run(userA.userId, userB.userId, now + 300);
      raw.close();

      // A) Direct service check (both directions: blocker A and blocked B)
      const postPresA = await getFriendsPresence(db.getD1Adapter(), {
        actorUserId: userA.userId,
        authSessionId: userA.sessionId,
        clientIp: '127.0.0.1',
        now: now + 400,
      });
      const postPresB = await getFriendsPresence(db.getD1Adapter(), {
        actorUserId: userB.userId,
        authSessionId: userB.sessionId,
        clientIp: '127.0.0.1',
        now: now + 400,
      });
      assert.equal(postPresA.some((p) => p.userId === userB.userId), false);
      assert.equal(postPresA.some((p) => p.userId === userC.userId && p.onlineStatus === 'online'), true);
      assert.equal(postPresB.some((p) => p.userId === userA.userId), false);

      // B) Express HTTP endpoint check
      const expPresA = await fetch(`${server.baseUrl}/api/social/presence/friends`, {
        headers: { Origin: TEST_ORIGIN, Cookie: userA.cookieHeader },
      });
      assert.equal(expPresA.status, 200);
      const expBodyA = (await expPresA.json()) as {
        presence: Array<{ userId: string; onlineStatus: string }>;
      };
      assert.equal(expBodyA.presence.some((p) => p.userId === userB.userId), false);
      assert.equal(expBodyA.presence.some((p) => p.userId === userC.userId), true);

      // C) Cloudflare Worker HTTP endpoint check (from blocked user B's side too!)
      const { env } = createWorkerHarness(db);
      const wPresB = await worker.fetch(
        new Request('https://api.eyvan.ir/api/social/presence/friends', {
          method: 'GET',
          headers: { Origin: TEST_ORIGIN, Cookie: userB.cookieHeader },
        }),
        env
      );
      assert.equal(wPresB.status, 200);
      const wBodyB = (await wPresB.json()) as {
        presence: Array<{ userId: string; onlineStatus: string }>;
      };
      assert.equal(wBodyB.presence.some((p) => p.userId === userA.userId), false);

      // D) Unfriend C (NOT block!): removes friendship & presence, does NOT create user_blocks, allows re-adding
      const unfriendRes = await removeFriend(
        db.getD1Adapter(),
        { friendshipId: acReq.friendshipId },
        {
          actorUserId: userA.userId,
          authSessionId: userA.sessionId,
          clientIp: '127.0.0.1',
          now: now + 500,
        }
      );
      assert.equal(unfriendRes.ok, true);

      const rawCheck = new Database(dbPath, { readonly: true });
      const blockAC = rawCheck
        .prepare(`SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?`)
        .get(userA.userId, userC.userId);
      rawCheck.close();
      assert.equal(blockAC, undefined);

      // Re-sending friend request to unfriended C succeeds (unlike blocked B!)
      const reAddC = await sendFriendRequest(db.getD1Adapter(), userC.userId, {
        actorUserId: userA.userId,
        authSessionId: userA.sessionId,
        clientIp: '127.0.0.1',
        now: now + 600,
      });
      assert.equal(reAddC.ok, true);

      // Also verify listFriends hides blocked B in both directions while keeping unblocked relationships cleanly separated
      const friendsA = await listFriends(db.getD1Adapter(), {
        actorUserId: userA.userId,
        authSessionId: userA.sessionId,
        clientIp: '127.0.0.1',
        now: now + 800,
      });
      const friendsB = await listFriends(db.getD1Adapter(), {
        actorUserId: userB.userId,
        authSessionId: userB.sessionId,
        clientIp: '127.0.0.1',
        now: now + 800,
      });
      assert.equal(friendsA.length, 0);
      assert.equal(friendsB.length, 0);
    } finally {
      await server.close();
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('9. Renaming a friend username preserves the friendship and immediately shows the new username', async () => {
    const { tmpDir, db } = createTempDb();
    try {
      const t0 = 1_730_006_000_000;
      const userA = await createRegisteredVerifiedUser(db, {
        username: 'BestieOne',
        email: 'bestie1@example.com',
        now: t0,
      });
      const userB = await createRegisteredVerifiedUser(db, {
        username: 'BestieOldName',
        email: 'bestie2@example.com',
        now: t0 + 50,
      });

      const req = await sendFriendRequest(db.getD1Adapter(), userB.userId, {
        actorUserId: userA.userId,
        authSessionId: userA.sessionId,
        clientIp: '127.0.0.1',
        now: t0 + 100,
      });
      assert.equal(req.ok, true);
      if (!req.ok) throw new Error('req failed');
      await acceptFriendRequest(db.getD1Adapter(), req.friendshipId, {
        actorUserId: userB.userId,
        authSessionId: userB.sessionId,
        clientIp: '127.0.0.1',
        now: t0 + 150,
      });

      const renamed = await updateAuthenticatedProfile(
        db.getD1Adapter(),
        userB.sessionToken,
        { username: 'BestieNewName', avatarCode: 'shamsa' },
        { clientIp: '127.0.0.1', userAgent: 'stage0-test', now: t0 + 500 }
      );
      assert.equal(renamed.ok, true);

      const friendsOfA = await listFriends(db.getD1Adapter(), {
        actorUserId: userA.userId,
        authSessionId: userA.sessionId,
        clientIp: '127.0.0.1',
        now: t0 + 600,
      });
      assert.equal(friendsOfA.length, 1);
      assert.equal(friendsOfA[0].userId, userB.userId);
      assert.equal(friendsOfA[0].friendshipId, req.friendshipId);
      assert.equal(friendsOfA[0].username, 'BestieNewName');
    } finally {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('10. Migration 0008 quarantines provably invalid recycled-username links without deleting data, rebuilds only affected user_game_stats, and is 100% idempotent', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    try {
      // Apply migrations 0001..0007 ONLY (simulating pre-Stage-0 database)
      const pre0008 = runDatabaseMigrations(db, {
        migrationsDir: DEFAULT_MIGRATIONS_DIR,
        upTo: '0007_social_presence_d1.sql',
      });
      assert.ok(pre0008.applied.includes('0007_social_presence_d1.sql'));

      const T1 = 1_700_000_000_000;
      const T2 = 1_700_001_000_000; // Legacy match BEFORE User B existed!
      const T3 = 1_700_002_000_000;
      const T4 = 1_700_005_000_000; // User B registered at T4
      const T5 = 1_700_006_000_000; // User B's legitimate match AFTER T4

      // User B (created at T4) who wrongly inherited a T2 match from recycled username 'LegacyRecycle'
      db.prepare(
        `INSERT INTO users (
           user_id, username, username_key, display_name, email, email_key, email_verified,
           avatar_code, auth_provider, account_status, created_at, last_seen_at, updated_at
         ) VALUES ('usr_b_recycled', 'LegacyRecycle', 'legacyrecycle', 'LegacyRecycle', 'b@example.com', 'b@example.com', 1, 'portrait', 'password', 'active', ?, ?, ?)`
      ).run(T4, T5, T5);

      // User C (created at T1) with 2 completely valid matches at T2 and T3
      db.prepare(
        `INSERT INTO users (
           user_id, username, username_key, display_name, email, email_key, email_verified,
           avatar_code, auth_provider, account_status, created_at, last_seen_at, updated_at
         ) VALUES ('usr_c_clean', 'CleanPlayer', 'cleanplayer', 'CleanPlayer', 'c@example.com', 'c@example.com', 1, 'portrait', 'password', 'active', ?, ?, ?)`
      ).run(T1, T3, T3);

      // Match 1 (finished at T2 < T4): invalidly attributed to usr_b_recycled + valid for usr_c_clean + 1 unlinked guest
      db.prepare(
        `INSERT INTO matches (match_id, room_code, started_at, finished_at, winning_team, team_a_score, team_b_score, target_score, last_win_type, hands_played)
         VALUES ('m_old_t2', 'OLDT2', ?, ?, 'myTeam', 3, 0, 3, 'kot', 3)`
      ).run(T2 - 5000, T2);
      db.prepare(
        `INSERT INTO match_players (match_id, player_id, username, username_key, user_id, canonical_seat, team, won)
         VALUES ('m_old_t2', 'p1', 'LegacyRecycle', 'legacyrecycle', 'usr_b_recycled', 'south', 'myTeam', 1)`
      ).run();
      db.prepare(
        `INSERT INTO match_players (match_id, player_id, username, username_key, user_id, canonical_seat, team, won)
         VALUES ('m_old_t2', 'p2', 'CleanPlayer', 'cleanplayer', 'usr_c_clean', 'north', 'myTeam', 1)`
      ).run();
      db.prepare(
        `INSERT INTO match_players (match_id, player_id, username, username_key, user_id, canonical_seat, team, won)
         VALUES ('m_old_t2', 'p3', 'OrphanLegacy', 'orphanlegacy', NULL, 'east', 'opponentTeam', 0)`
      ).run();

      // Match 2 (finished at T3): valid for usr_c_clean
      db.prepare(
        `INSERT INTO matches (match_id, room_code, started_at, finished_at, winning_team, team_a_score, team_b_score, target_score, last_win_type, hands_played)
         VALUES ('m_clean_t3', 'CLNT3', ?, ?, 'opponentTeam', 1, 3, 3, 'normal', 4)`
      ).run(T3 - 5000, T3);
      db.prepare(
        `INSERT INTO match_players (match_id, player_id, username, username_key, user_id, canonical_seat, team, won)
         VALUES ('m_clean_t3', 'p1', 'CleanPlayer', 'cleanplayer', 'usr_c_clean', 'south', 'myTeam', 0)`
      ).run();

      // Match 3 (finished at T5 > T4): legitimate match for usr_b_recycled
      db.prepare(
        `INSERT INTO matches (match_id, room_code, started_at, finished_at, winning_team, team_a_score, team_b_score, target_score, last_win_type, hands_played)
         VALUES ('m_valid_t5', 'VALT5', ?, ?, 'myTeam', 3, 2, 3, 'normal', 5)`
      ).run(T5 - 5000, T5);
      db.prepare(
        `INSERT INTO match_players (match_id, player_id, username, username_key, user_id, canonical_seat, team, won)
         VALUES ('m_valid_t5', 'p1', 'LegacyRecycle', 'legacyrecycle', 'usr_b_recycled', 'south', 'myTeam', 1)`
      ).run();

      // Pre-0008 polluted user_game_stats for usr_b_recycled (counted BOTH T2 and T5 = 2 matches, 1 kot)
      db.prepare(
        `INSERT INTO user_game_stats (user_id, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at, updated_at)
         VALUES ('usr_b_recycled', 2, 2, 0, 1, 0, ?, ?)`
      ).run(T5, T5);
      db.prepare(
        `INSERT INTO user_game_stats (user_id, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at, updated_at)
         VALUES ('usr_c_clean', 2, 1, 1, 1, 0, ?, ?)`
      ).run(T3, T3);

      // Pre-0008 polluted legacy player_stats row (last_played_at = T2 < T4) + unlinked row
      db.prepare(
        `INSERT INTO player_stats (username, display_username, user_id, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at)
         VALUES ('legacyrecycle', 'LegacyRecycle', 'usr_b_recycled', 4, 4, 0, 1, 0, ?)`
      ).run(T2);
      db.prepare(
        `INSERT INTO player_stats (username, display_username, user_id, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at)
         VALUES ('orphanlegacy', 'OrphanLegacy', NULL, 2, 0, 2, 0, 0, ?)`
      ).run(T2);

      const beforeCounts = {
        users: (db.prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number }).c,
        matches: (db.prepare(`SELECT COUNT(*) AS c FROM matches`).get() as { c: number }).c,
        matchPlayers: (db.prepare(`SELECT COUNT(*) AS c FROM match_players`).get() as { c: number }).c,
        playerStats: (db.prepare(`SELECT COUNT(*) AS c FROM player_stats`).get() as { c: number }).c,
      };

      // Apply Stage 0 migration 0008
      const res0008 = runDatabaseMigrations(db, {
        migrationsDir: DEFAULT_MIGRATIONS_DIR,
        upTo: '0008_stage0_identity_audit_and_guards.sql',
      });
      assert.deepEqual(res0008.applied, ['0008_stage0_identity_audit_and_guards.sql']);

      // ZERO rows deleted across all historical tables!
      const afterCounts = {
        users: (db.prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number }).c,
        matches: (db.prepare(`SELECT COUNT(*) AS c FROM matches`).get() as { c: number }).c,
        matchPlayers: (db.prepare(`SELECT COUNT(*) AS c FROM match_players`).get() as { c: number }).c,
        playerStats: (db.prepare(`SELECT COUNT(*) AS c FROM player_stats`).get() as { c: number }).c,
      };
      assert.deepEqual(afterCounts, beforeCounts);

      // Provably invalid match_players link detached (`user_id = NULL`), historical username kept
      const mpInvalid = db
        .prepare(`SELECT user_id, username FROM match_players WHERE match_id = 'm_old_t2' AND player_id = 'p1'`)
        .get() as { user_id: string | null; username: string };
      assert.equal(mpInvalid.user_id, null);
      assert.equal(mpInvalid.username, 'LegacyRecycle');

      // Provably invalid player_stats link detached (`user_id = NULL`), numbers preserved
      const psInvalid = db
        .prepare(`SELECT user_id, matches_played FROM player_stats WHERE username = 'legacyrecycle'`)
        .get() as { user_id: string | null; matches_played: number };
      assert.equal(psInvalid.user_id, null);
      assert.equal(psInvalid.matches_played, 4);

      // User B's `user_game_stats` rebuilt cleanly to ONLY their 1 valid match (T5: 1 match, 1 win, 0 kot)
      const statsB = db
        .prepare(`SELECT matches_played, wins, losses, kot_wins FROM user_game_stats WHERE user_id = 'usr_b_recycled'`)
        .get() as { matches_played: number; wins: number; losses: number; kot_wins: number };
      assert.deepEqual(statsB, { matches_played: 1, wins: 1, losses: 0, kot_wins: 0 });

      // User C's `user_game_stats` remained 100% untouched!
      const statsC = db
        .prepare(`SELECT matches_played, wins, losses, kot_wins FROM user_game_stats WHERE user_id = 'usr_c_clean'`)
        .get() as { matches_played: number; wins: number; losses: number; kot_wins: number };
      assert.deepEqual(statsC, { matches_played: 2, wins: 1, losses: 1, kot_wins: 1 });

      // Audit log captured BOTH provably invalid records AND unlinked legacy rows
      const auditRows = db
        .prepare(`SELECT audit_id, source_table, previous_user_id, reason FROM stats_identity_audit_log ORDER BY audit_id ASC`)
        .all() as Array<{
        audit_id: string;
        source_table: string;
        previous_user_id: string | null;
        reason: string;
      }>;
      assert.ok(
        auditRows.some(
          (r) =>
            r.audit_id === 'mp:m_old_t2:p1' &&
            r.previous_user_id === 'usr_b_recycled' &&
            r.reason === 'match_finished_before_user_created'
        )
      );
      assert.ok(
        auditRows.some(
          (r) =>
            r.audit_id === 'ps:legacyrecycle' &&
            r.previous_user_id === 'usr_b_recycled' &&
            r.reason === 'stats_played_before_user_created'
        )
      );
      assert.ok(
        auditRows.some(
          (r) =>
            r.audit_id === 'mp:m_old_t2:p3' &&
            r.previous_user_id === null &&
            r.reason === 'unlinked_legacy_match_player'
        )
      );
      assert.ok(
        auditRows.some(
          (r) =>
            r.audit_id === 'ps:orphanlegacy' &&
            r.previous_user_id === null &&
            r.reason === 'unlinked_legacy_player_stats'
        )
      );

      // Re-running migrations is 100% idempotent
      const repeat = runDatabaseMigrations(db, {
        migrationsDir: DEFAULT_MIGRATIONS_DIR,
        upTo: '0008_stage0_identity_audit_and_guards.sql',
      });
      assert.equal(repeat.applied.length, 0);
      assert.ok(repeat.skipped.includes('0008_stage0_identity_audit_and_guards.sql'));
    } finally {
      db.close();
    }
  });

  it('11. Re-persisting the same match_id NEVER double-increments stats (SQLite & D1)', async () => {
    const { tmpDir, db } = createTempDb();
    try {
      const t0 = 1_730_007_000_000;
      const user = await createRegisteredVerifiedUser(db, {
        username: 'IdempotentAce',
        email: 'idem@example.com',
        now: t0,
      });

      const matchSqlite = makeCompletedMatch(
        'match_idem_sqlite',
        [
          { playerId: 'p1', userId: user.userId, username: 'IdempotentAce', canonicalSeat: 'south', team: 'myTeam', won: true },
          { playerId: 'p2', username: 'IG1', canonicalSeat: 'east', team: 'opponentTeam', won: false },
          { playerId: 'p3', username: 'IG2', canonicalSeat: 'north', team: 'myTeam', won: true },
          { playerId: 'p4', username: 'IG3', canonicalSeat: 'west', team: 'opponentTeam', won: false },
        ],
        t0 + 1_000
      );

      db.recordCompletedMatch(matchSqlite);
      db.recordCompletedMatch(matchSqlite);

      const matchD1 = makeCompletedMatch(
        'match_idem_d1',
        [
          { playerId: 'p1', userId: user.userId, username: 'IdempotentAce', canonicalSeat: 'south', team: 'myTeam', won: true },
          { playerId: 'p2', username: 'IG4', canonicalSeat: 'east', team: 'opponentTeam', won: false },
          { playerId: 'p3', username: 'IG5', canonicalSeat: 'north', team: 'myTeam', won: true },
          { playerId: 'p4', username: 'IG6', canonicalSeat: 'west', team: 'opponentTeam', won: false },
        ],
        t0 + 2_000
      );

      const firstD1 = await persistCompletedMatchToD1(db.getD1Adapter(), matchD1);
      const secondD1 = await persistCompletedMatchToD1(db.getD1Adapter(), matchD1);
      assert.equal(firstD1.alreadyExisted, false);
      assert.equal(secondD1.alreadyExisted, true);

      // Total across both unique matches = strictly 2 (never 4!)
      const stats = db.getPlayerStatsByUserId(user.userId);
      assert.equal(stats?.matchesPlayed, 2);
      assert.equal(stats?.wins, 2);
    } finally {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('12. Spoofing userId, actorUserId, or X-Eyvan-Verified-* headers is rejected/ignored across rooms, stats, and social APIs (Express & Worker)', async () => {
    const { tmpDir, db } = createTempDb();
    const server = await startExpressServer(db);
    try {
      const victim = await createRegisteredVerifiedUser(db, {
        username: 'VictimPlayer',
        email: 'victim@example.com',
      });
      const { env } = createWorkerHarness(db);

      const spoofHeaders = {
        'Content-Type': 'application/json',
        Origin: TEST_ORIGIN,
        'X-Eyvan-Verified-User-Id': victim.userId,
        'X-Eyvan-Verified-Username': victim.username,
        'X-Eyvan-Verified-Avatar': 'shamsa',
      };

      // A) Unauthenticated /api/stats/me MUST return 401 on both Express & Worker
      const expStatsMe = await fetch(`${server.baseUrl}/api/stats/me?userId=${victim.userId}`, {
        headers: spoofHeaders,
      });
      assert.equal(expStatsMe.status, 401);

      const wStatsMe = await worker.fetch(
        new Request(`https://api.eyvan.ir/api/stats/me?userId=${victim.userId}`, {
          method: 'GET',
          headers: spoofHeaders,
        }),
        env
      );
      assert.equal(wStatsMe.status, 401);

      // B) Unauthenticated /api/social/* endpoints MUST return 401 even with spoofed headers/body
      const expFriends = await fetch(`${server.baseUrl}/api/social/friends`, {
        headers: spoofHeaders,
      });
      assert.equal(expFriends.status, 401);

      const expPresence = await fetch(`${server.baseUrl}/api/social/presence/friends`, {
        headers: spoofHeaders,
      });
      assert.equal(expPresence.status, 401);

      const expHeartbeat = await fetch(`${server.baseUrl}/api/social/presence/heartbeat`, {
        method: 'POST',
        headers: {
          ...spoofHeaders,
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({ actorUserId: victim.userId, userId: victim.userId }),
      });
      assert.equal(expHeartbeat.status, 401);

      const wFriends = await worker.fetch(
        new Request('https://api.eyvan.ir/api/social/friends', {
          method: 'GET',
          headers: spoofHeaders,
        }),
        env
      );
      assert.equal(wFriends.status, 401);

      const wPresence = await worker.fetch(
        new Request('https://api.eyvan.ir/api/social/presence/friends', {
          method: 'GET',
          headers: spoofHeaders,
        }),
        env
      );
      assert.equal(wPresence.status, 401);

      // C) Unauthenticated /api/rooms with spoofed X-Eyvan-Verified-* headers & body.userId
      //    MUST NOT impersonate victim's username or bind victim's userId!
      const wRoomRes = await worker.fetch(
        new Request('https://api.eyvan.ir/api/rooms', {
          method: 'POST',
          headers: spoofHeaders,
          body: JSON.stringify({
            username: 'AttackerGuest',
            userId: victim.userId,
            actorUserId: victim.userId,
          }),
        }),
        env
      );
      assert.equal(wRoomRes.status, 201);
      const wRoom = (await wRoomRes.json()) as { roomCode: string };

      const wRoomSummaryRes = await worker.fetch(
        new Request(`https://api.eyvan.ir/api/rooms/${wRoom.roomCode}`, {
          method: 'GET',
          headers: { Origin: TEST_ORIGIN },
        }),
        env
      );
      const wRoomSummary = (await wRoomSummaryRes.json()) as {
        seats: Array<{ canonicalSeat: string; username: string | null }>;
      };
      // Seat username stayed 'AttackerGuest', proving spoofed X-Eyvan-Verified-Username header was stripped!
      assert.equal(
        wRoomSummary.seats.find((s) => s.canonicalSeat === 'south')?.username,
        'AttackerGuest'
      );
    } finally {
      await server.close();
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
