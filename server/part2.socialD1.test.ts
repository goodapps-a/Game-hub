import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import worker from '../cloudflare/src/index';
import { AUTH_COOKIE_NAME } from '../cloudflare/src/lib/auth/authCookie';
import { EmailSender } from '../cloudflare/src/lib/auth/emailService';
import {
  PRESENCE_LEASE_TTL_MS,
  getFriendsPresence,
  heartbeatPresence,
  pruneExpiredPresenceSessionsBatched,
  sendFriendRequest,
} from '../cloudflare/src/lib/social/socialService';
import { CfWorkerEnv } from '../cloudflare/src/lib/types';
import { createEyvanExpressApp } from './createExpressApp';
import { EyvanDatabase } from './database';
import { HokmRoomManager } from './roomManager';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function extractCookiePair(setCookie: string | null, name: string): string | null {
  if (!setCookie) return null;
  const first = setCookie.split(';')[0]?.trim() ?? '';
  return first.startsWith(`${name}=`) ? first : null;
}

const FORBIDDEN_PRIVATE_FIELDS = [
  'email',
  'email_key',
  'password_hash',
  'password_salt',
  'password_algo',
  'token_hash',
  'ip_hash',
  'user_agent_hash',
  'session_id',
];

function assertNoPrivateFields(obj: unknown, contextLabel: string): void {
  const serialized = JSON.stringify(obj);
  for (const field of FORBIDDEN_PRIVATE_FIELDS) {
    assert.equal(
      serialized.includes(`"${field}":`),
      false,
      `${contextLabel} must NEVER expose private field "${field}"`
    );
  }
}

interface TestUser {
  userId: string;
  username: string;
  email: string;
  password: string;
  cookie: string;
}

async function createTestHarness(prefix: string) {
  const tmpDir = createTempDir(prefix);
  const dbPath = path.join(tmpDir, 'eyvan.sqlite');
  const db = new EyvanDatabase(dbPath);
  const roomManager = new HokmRoomManager({ db });
  const verifyTokens: string[] = [];

  const mockEmailSender: EmailSender = {
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

  const { app } = createEyvanExpressApp({
    db,
    roomManager,
    config: { isProduction: false },
    emailSender: mockEmailSender,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const registerAndLogin = async (
    username: string,
    email: string,
    password = 'EyvanStrong#2026'
  ): Promise<TestUser> => {
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'eyvan-client',
        Origin: baseUrl,
      },
      body: JSON.stringify({
        email,
        username,
        password,
        confirmPassword: password,
      }),
    });
    assert.equal(regRes.status, 201, `register ${username} must succeed`);
    const regJson = (await regRes.json()) as {
      ok: boolean;
      user: { userId: string; username: string };
    };
    const token = verifyTokens.pop();
    assert.ok(token, `verification token must be issued for ${username}`);

    const verifyRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'eyvan-client',
        Origin: baseUrl,
      },
      body: JSON.stringify({ token }),
    });
    assert.equal(verifyRes.status, 200);

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'eyvan-client',
        Origin: baseUrl,
      },
      body: JSON.stringify({ identifier: email, password }),
    });
    assert.equal(loginRes.status, 200);
    const cookie = extractCookiePair(
      loginRes.headers.get('set-cookie'),
      AUTH_COOKIE_NAME
    );
    assert.ok(cookie, `auth cookie must be issued for ${username}`);

    return {
      userId: regJson.user.userId,
      username: regJson.user.username,
      email,
      password,
      cookie,
    };
  };

  const loginAdditionalDevice = async (user: TestUser): Promise<string> => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'eyvan-client',
        Origin: baseUrl,
      },
      body: JSON.stringify({
        identifier: user.email,
        password: user.password,
      }),
    });
    assert.equal(loginRes.status, 200);
    const cookie = extractCookiePair(
      loginRes.headers.get('set-cookie'),
      AUTH_COOKIE_NAME
    );
    assert.ok(cookie);
    return cookie;
  };

  const cleanup = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    roomManager.dispose();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };

  return {
    db,
    baseUrl,
    registerAndLogin,
    loginAdditionalDevice,
    cleanup,
  };
}

describe('Part 2 (Stage D1) — Friends System & Online Presence', () => {
  it('1. Search: case-insensitive match, missing user, invalid/wildcard query rejection, pagination, blocked exclusion, zero private data leak', async () => {
    const h = await createTestHarness('eyvan-d1-search-');
    try {
      const alice = await h.registerAndLogin('Alice_Host', 'alice@eyvan.test');
      const bob = await h.registerAndLogin('Bob_Player', 'bob@eyvan.test');
      const bobby = await h.registerAndLogin('Bobby_Pro', 'bobby@eyvan.test');
      const bobbi = await h.registerAndLogin('Bobbi_Ace', 'bobbi@eyvan.test');
      const blockedUser = await h.registerAndLogin('Bob_Blocked', 'blocked@eyvan.test');

      // Also register an unverified user (must NEVER appear in search)
      const unverifiedRes = await fetch(`${h.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
        },
        body: JSON.stringify({
          email: 'unverified@eyvan.test',
          username: 'Bob_Unverified',
          password: 'EyvanStrong#2026',
          confirmPassword: 'EyvanStrong#2026',
        }),
      });
      assert.equal(unverifiedRes.status, 201);

      // Block `blockedUser` from Alice's perspective in user_blocks
      await h.db
        .getD1Adapter()
        .prepare(
          `INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`
        )
        .bind(alice.userId, blockedUser.userId, Date.now())
        .run();

      // Case-insensitive search for "BOB"
      const s1 = await fetch(`${h.baseUrl}/api/social/users/search?q=BOB`, {
        headers: { Cookie: alice.cookie },
      });
      assert.equal(s1.status, 200);
      const s1Body = (await s1.json()) as {
        ok: boolean;
        users: Array<{ userId: string; username: string; relationshipStatus: string }>;
        hasMore: boolean;
      };
      assert.equal(s1Body.ok, true);
      assertNoPrivateFields(s1Body, 'search response');
      const foundIds = s1Body.users.map((u) => u.userId);
      assert.equal(foundIds.includes(bob.userId), true);
      assert.equal(foundIds.includes(bobby.userId), true);
      assert.equal(foundIds.includes(bobbi.userId), true);
      assert.equal(foundIds.includes(alice.userId), false, 'must exclude self');
      assert.equal(foundIds.includes(blockedUser.userId), false, 'must exclude blocked user');
      assert.equal(
        s1Body.users.some((u) => u.username === 'Bob_Unverified'),
        false,
        'must exclude pending_verification users'
      );

      // Pagination: limit=2, offset=0 -> hasMore=true; offset=2 -> remaining
      const page1 = await fetch(
        `${h.baseUrl}/api/social/users/search?q=bob&limit=2&offset=0`,
        { headers: { Cookie: alice.cookie } }
      );
      const page1Json = (await page1.json()) as {
        users: Array<{ userId: string }>;
        hasMore: boolean;
      };
      assert.equal(page1Json.users.length, 2);
      assert.equal(page1Json.hasMore, true);

      const page2 = await fetch(
        `${h.baseUrl}/api/social/users/search?q=bob&limit=2&offset=2`,
        { headers: { Cookie: alice.cookie } }
      );
      const page2Json = (await page2.json()) as {
        users: Array<{ userId: string }>;
        hasMore: boolean;
      };
      assert.equal(page2Json.users.length, 1);
      assert.equal(page2Json.hasMore, false);

      // Search non-existent user -> empty list
      const missingRes = await fetch(
        `${h.baseUrl}/api/social/users/search?q=NoSuchPlayer99`,
        { headers: { Cookie: alice.cookie } }
      );
      assert.equal(missingRes.status, 200);
      const missingJson = (await missingRes.json()) as { users: unknown[] };
      assert.equal(missingJson.users.length, 0);

      // Invalid / too short / wildcard-only queries -> 400
      for (const bad of ['a', '%%%', '___', 'a;DROP', '']) {
        const badRes = await fetch(
          `${h.baseUrl}/api/social/users/search?q=${encodeURIComponent(bad)}`,
          { headers: { Cookie: alice.cookie } }
        );
        assert.equal(badRes.status, 400, `query "${bad}" must return 400`);
      }

      // Literal underscore inside valid query must NOT act as SQL wildcard matching non-underscore
      const underRes = await fetch(
        `${h.baseUrl}/api/social/users/search?q=Bob_P`,
        { headers: { Cookie: alice.cookie } }
      );
      const underJson = (await underRes.json()) as {
        users: Array<{ username: string }>;
      };
      assert.deepEqual(
        underJson.users.map((u) => u.username),
        ['Bob_Player']
      );

      // Blocked user cannot receive friend request
      const blockReq = await fetch(`${h.baseUrl}/api/social/friends/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: alice.cookie,
        },
        body: JSON.stringify({ targetUserId: blockedUser.userId }),
      });
      assert.equal(blockReq.status, 403);
    } finally {
      await h.cleanup();
    }
  });

  it('2. Friendships lifecycle: send, duplicate block, self block, role authorization, reject, cancel, accept, remove, mutual race, username rename preservation', async () => {
    const h = await createTestHarness('eyvan-d1-friends-');
    try {
      const alice = await h.registerAndLogin('Alice_One', 'alice1@eyvan.test');
      const bob = await h.registerAndLogin('Bob_Two', 'bob2@eyvan.test');
      const charlie = await h.registerAndLogin('Charlie_Three', 'charlie3@eyvan.test');

      const postSocial = (cookie: string, endpoint: string, body: Record<string, unknown>) =>
        fetch(`${h.baseUrl}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Origin: h.baseUrl,
            Cookie: cookie,
          },
          body: JSON.stringify(body),
        });

      // Self-request forbidden
      const selfRes = await postSocial(alice.cookie, '/api/social/friends/request', {
        targetUserId: alice.userId,
      });
      assert.equal(selfRes.status, 400);

      // Send A -> B
      const req1 = await postSocial(alice.cookie, '/api/social/friends/request', {
        targetUserId: bob.userId,
      });
      assert.equal(req1.status, 201);
      const req1Json = (await req1.json()) as {
        ok: boolean;
        outcome: string;
        friendshipId: string;
      };
      assert.equal(req1Json.outcome, 'request_sent');

      // Duplicate A -> B rejected
      const dupRes = await postSocial(alice.cookie, '/api/social/friends/request', {
        targetUserId: bob.userId,
      });
      assert.equal(dupRes.status, 409);

      // Authorization checks:
      // Alice (requester) cannot accept her own outgoing request
      assert.equal(
        (
          await postSocial(alice.cookie, '/api/social/friends/accept', {
            friendshipId: req1Json.friendshipId,
          })
        ).status,
        404
      );
      // Charlie (unrelated third party) cannot accept or reject
      assert.equal(
        (
          await postSocial(charlie.cookie, '/api/social/friends/accept', {
            friendshipId: req1Json.friendshipId,
          })
        ).status,
        404
      );
      // Bob (addressee) cannot cancel Alice's outgoing request
      assert.equal(
        (
          await postSocial(bob.cookie, '/api/social/friends/cancel', {
            friendshipId: req1Json.friendshipId,
          })
        ).status,
        404
      );

      // Cancel by Alice works -> disappears from both lists
      const cancelRes = await postSocial(alice.cookie, '/api/social/friends/cancel', {
        friendshipId: req1Json.friendshipId,
      });
      assert.equal(cancelRes.status, 200);

      const bobReqsAfterCancel = (await (
        await fetch(`${h.baseUrl}/api/social/friends/requests`, {
          headers: { Cookie: bob.cookie },
        })
      ).json()) as { incoming: unknown[]; outgoing: unknown[] };
      assert.equal(bobReqsAfterCancel.incoming.length, 0);

      // Re-send A -> B then Bob rejects
      const req2 = await postSocial(alice.cookie, '/api/social/friends/request', {
        targetUserId: bob.userId,
      });
      assert.equal(req2.status, 201);
      const req2Json = (await req2.json()) as { friendshipId: string };

      const rejRes = await postSocial(bob.cookie, '/api/social/friends/reject', {
        friendshipId: req2Json.friendshipId,
      });
      assert.equal(rejRes.status, 200);

      // Re-send A -> B then Bob accepts -> both are friends!
      const req3 = await postSocial(alice.cookie, '/api/social/friends/request', {
        targetUserId: bob.userId,
      });
      assert.equal(req3.status, 201);
      const req3Json = (await req3.json()) as { friendshipId: string };

      const accRes = await postSocial(bob.cookie, '/api/social/friends/accept', {
        friendshipId: req3Json.friendshipId,
      });
      assert.equal(accRes.status, 200);

      // Duplicate request when already friends -> 409
      assert.equal(
        (
          await postSocial(alice.cookie, '/api/social/friends/request', {
            targetUserId: bob.userId,
          })
        ).status,
        409
      );

      // Both sides see each other in `/api/social/friends` with zero private data
      const aliceFriends1 = (await (
        await fetch(`${h.baseUrl}/api/social/friends`, {
          headers: { Cookie: alice.cookie },
        })
      ).json()) as { friends: Array<{ userId: string; username: string; friendshipId: string }> };
      assertNoPrivateFields(aliceFriends1, 'friends list');
      assert.equal(aliceFriends1.friends.length, 1);
      assert.equal(aliceFriends1.friends[0].userId, bob.userId);
      assert.equal(aliceFriends1.friends[0].username, 'Bob_Two');

      // Username rename preserves friendship & reflects new username immediately!
      const renameRes = await postSocial(bob.cookie, '/api/auth/profile', {
        username: 'Bob_Renamed',
        avatarCode: 'turquoise',
      });
      assert.equal(renameRes.status, 200);

      const aliceFriendsAfterRename = (await (
        await fetch(`${h.baseUrl}/api/social/friends`, {
          headers: { Cookie: alice.cookie },
        })
      ).json()) as { friends: Array<{ userId: string; username: string; friendshipId: string }> };
      assert.equal(aliceFriendsAfterRename.friends.length, 1);
      assert.equal(aliceFriendsAfterRename.friends[0].userId, bob.userId);
      assert.equal(aliceFriendsAfterRename.friends[0].username, 'Bob_Renamed');
      assert.equal(
        aliceFriendsAfterRename.friends[0].friendshipId,
        aliceFriends1.friends[0].friendshipId
      );

      // Remove friend -> removed from BOTH sides
      const remRes = await postSocial(alice.cookie, '/api/social/friends/remove', {
        targetUserId: bob.userId,
      });
      assert.equal(remRes.status, 200);

      const aliceAfterRem = (await (
        await fetch(`${h.baseUrl}/api/social/friends`, {
          headers: { Cookie: alice.cookie },
        })
      ).json()) as { friends: unknown[] };
      const bobAfterRem = (await (
        await fetch(`${h.baseUrl}/api/social/friends`, {
          headers: { Cookie: bob.cookie },
        })
      ).json()) as { friends: unknown[] };
      assert.equal(aliceAfterRem.friends.length, 0);
      assert.equal(bobAfterRem.friends.length, 0);

      // Simultaneous mutual friend requests (Alice <-> Charlie fired concurrently) -> strictly 1 accepted row!
      const [m1, m2] = await Promise.all([
        postSocial(alice.cookie, '/api/social/friends/request', {
          targetUserId: charlie.userId,
        }),
        postSocial(charlie.cookie, '/api/social/friends/request', {
          targetUserId: alice.userId,
        }),
      ]);
      assert.equal(m1.ok && m2.ok, true, 'both mutual requests must resolve cleanly without 500');

      const d1 = h.db.getD1Adapter();
      const pairKey =
        alice.userId < charlie.userId
          ? `${alice.userId}:${charlie.userId}`
          : `${charlie.userId}:${alice.userId}`;
      const rows = await d1
        .prepare(`SELECT friendship_id, status FROM friendships WHERE pair_key = ?`)
        .bind(pairKey)
        .all<{ friendship_id: string; status: string }>();
      assert.equal(rows.results.length, 1, 'must have strictly 1 canonical friendship row');
      assert.equal(rows.results[0].status, 'accepted', 'mutual simultaneous requests must auto-accept');

      // Direct service-level check for sequential reverse request auto-accept (Bob -> Charlie then Charlie -> Bob)
      const rA = await sendFriendRequest(d1, charlie.userId, {
        actorUserId: bob.userId,
        authSessionId: 'ses_test_b',
        clientIp: '127.0.0.1',
      });
      assert.equal(rA.ok && rA.outcome === 'request_sent', true);
      const rB = await sendFriendRequest(d1, bob.userId, {
        actorUserId: charlie.userId,
        authSessionId: 'ses_test_c',
        clientIp: '127.0.0.1',
      });
      assert.equal(rB.ok && rB.outcome === 'auto_accepted', true);
    } finally {
      await h.cleanup();
    }
  });

  it('3. Online presence: friend visibility only, TTL expiry -> offline, reconnect -> online, multi-device accuracy, logout & logout-all immediate offline, privacy settings', async () => {
    const h = await createTestHarness('eyvan-d1-presence-');
    try {
      const alice = await h.registerAndLogin('Alice_Live', 'alice_live@eyvan.test');
      const bob = await h.registerAndLogin('Bob_Live', 'bob_live@eyvan.test');
      const stranger = await h.registerAndLogin('Stranger_Out', 'stranger@eyvan.test');

      const postSocial = (cookie: string, endpoint: string, body: Record<string, unknown> = {}) =>
        fetch(`${h.baseUrl}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Origin: h.baseUrl,
            Cookie: cookie,
          },
          body: JSON.stringify(body),
        });

      // Make Alice and Bob friends
      const fReq = await postSocial(alice.cookie, '/api/social/friends/request', {
        targetUserId: bob.userId,
      });
      const { friendshipId } = (await fReq.json()) as { friendshipId: string };
      await postSocial(bob.cookie, '/api/social/friends/accept', { friendshipId });

      // Initially Bob is offline (no heartbeat yet)
      const p0 = (await (
        await fetch(`${h.baseUrl}/api/social/presence/friends`, {
          headers: { Cookie: alice.cookie },
        })
      ).json()) as { presence: Array<{ userId: string; onlineStatus: string }> };
      assert.equal(p0.presence[0].onlineStatus, 'offline');

      // Bob sends heartbeat on Device 1
      const hb1 = await postSocial(bob.cookie, '/api/social/presence/heartbeat', {
        deviceId: 'dev_bob_phone_01',
        state: 'online',
      });
      assert.equal(hb1.status, 200);

      // Alice (accepted friend) sees Bob online
      const p1 = (await (
        await fetch(`${h.baseUrl}/api/social/presence/friends`, {
          headers: { Cookie: alice.cookie },
        })
      ).json()) as { presence: Array<{ userId: string; onlineStatus: string }> };
      assert.equal(p1.presence[0].onlineStatus, 'online');

      // Stranger (NOT a friend) searches Bob -> MUST see `offline` (never leak real presence to non-friends)
      const strangerSearch = (await (
        await fetch(`${h.baseUrl}/api/social/users/search?q=Bob_Live`, {
          headers: { Cookie: stranger.cookie },
        })
      ).json()) as { users: Array<{ userId: string; onlineStatus: string }> };
      assert.equal(strangerSearch.users.length, 1);
      assert.equal(
        strangerSearch.users[0].onlineStatus,
        'offline',
        'non-friends must NEVER see real online status'
      );

      // Multi-device test: Bob logs in on Device 2 and heartbeats
      const bobDevice2Cookie = await h.loginAdditionalDevice(bob);
      const hb2 = await postSocial(bobDevice2Cookie, '/api/social/presence/heartbeat', {
        deviceId: 'dev_bob_laptop_02',
        state: 'online',
      });
      assert.equal(hb2.status, 200);

      // Device 1 logs out (`/api/auth/logout`) -> Device 1 presence cleared, but Device 2 is STILL active!
      const logoutDev1 = await fetch(`${h.baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: bob.cookie,
        },
      });
      assert.equal(logoutDev1.status, 200);

      const pStillOnline = (await (
        await fetch(`${h.baseUrl}/api/social/presence/friends`, {
          headers: { Cookie: alice.cookie },
        })
      ).json()) as { presence: Array<{ userId: string; onlineStatus: string }> };
      assert.equal(
        pStillOnline.presence[0].onlineStatus,
        'online',
        'closing/logging out Device 1 must keep user online while Device 2 is active'
      );

      // Device 2 explicitly signals offline -> NOW Bob is offline!
      const offDev2 = await postSocial(bobDevice2Cookie, '/api/social/presence/offline', {
        deviceId: 'dev_bob_laptop_02',
      });
      assert.equal(offDev2.status, 200);

      const pNowOffline = (await (
        await fetch(`${h.baseUrl}/api/social/presence/friends`, {
          headers: { Cookie: alice.cookie },
        })
      ).json()) as { presence: Array<{ userId: string; onlineStatus: string }> };
      assert.equal(pNowOffline.presence[0].onlineStatus, 'offline');

      // Reconnect on Device 2 -> online again, then test logout-all immediately clears presence
      await postSocial(bobDevice2Cookie, '/api/social/presence/heartbeat', {
        deviceId: 'dev_bob_laptop_02',
        state: 'online',
      });
      const bobDevice3Cookie = await h.loginAdditionalDevice(bob);
      await postSocial(bobDevice3Cookie, '/api/social/presence/heartbeat', {
        deviceId: 'dev_bob_tablet_03',
        state: 'online',
      });
      const logoutAllRes = await fetch(`${h.baseUrl}/api/auth/logout-all`, {
        method: 'POST',
        headers: {
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: bobDevice2Cookie,
        },
      });
      assert.equal(logoutAllRes.status, 200);

      const pAfterLogoutAll = (await (
        await fetch(`${h.baseUrl}/api/social/presence/friends`, {
          headers: { Cookie: alice.cookie },
        })
      ).json()) as { presence: Array<{ userId: string; onlineStatus: string }> };
      assert.equal(
        pAfterLogoutAll.presence[0].onlineStatus,
        'offline',
        'logout-all must immediately clear presence across all devices'
      );

      // Sudden disconnect TTL expiry & reconnect test (deterministic clock via service layer)
      const bobFreshCookie = await h.loginAdditionalDevice(bob);
      const bobMe = (await (
        await fetch(`${h.baseUrl}/api/auth/me`, { headers: { Cookie: bobFreshCookie } })
      ).json()) as { session: { sessionId: string } };
      const d1 = h.db.getD1Adapter();
      const t0 = Date.now() + 100_000;

      await heartbeatPresence(d1, 'dev_ttl_check_01', 'online', {
        actorUserId: bob.userId,
        authSessionId: bobMe.session.sessionId,
        clientIp: '127.0.0.1',
        now: t0,
      });

      // Within TTL (t0 + 60s) -> online
      const checkWithin = await getFriendsPresence(d1, {
        actorUserId: alice.userId,
        authSessionId: 'ses_a',
        clientIp: '127.0.0.1',
        now: t0 + 60_000,
      });
      assert.equal(checkWithin[0].onlineStatus, 'online');

      // After TTL expiry (t0 + PRESENCE_LEASE_TTL_MS + 1000ms) -> automatically offline!
      const checkExpired = await getFriendsPresence(d1, {
        actorUserId: alice.userId,
        authSessionId: 'ses_a',
        clientIp: '127.0.0.1',
        now: t0 + PRESENCE_LEASE_TTL_MS + 1_000,
      });
      assert.equal(
        checkExpired[0].onlineStatus,
        'offline',
        'sudden disconnect without heartbeat must expire to offline after TTL'
      );

      // Reconnect heartbeat -> immediately online again!
      const tReconnect = t0 + PRESENCE_LEASE_TTL_MS + 5_000;
      await heartbeatPresence(d1, 'dev_ttl_check_01', 'online', {
        actorUserId: bob.userId,
        authSessionId: bobMe.session.sessionId,
        clientIp: '127.0.0.1',
        now: tReconnect,
      });
      const checkReconnected = await getFriendsPresence(d1, {
        actorUserId: alice.userId,
        authSessionId: 'ses_a',
        clientIp: '127.0.0.1',
        now: tReconnect + 1_000,
      });
      assert.equal(checkReconnected[0].onlineStatus, 'online');

      // Privacy Controls: hide online status & disable incoming friend requests
      const privHide = await postSocial(bobFreshCookie, '/api/social/privacy', {
        showOnlineStatus: false,
        allowFriendRequests: false,
      });
      assert.equal(privHide.status, 200);

      // Even with active lease, Bob appears offline to Alice when privacy_show_online = 0
      const checkHidden = await getFriendsPresence(d1, {
        actorUserId: alice.userId,
        authSessionId: 'ses_a',
        clientIp: '127.0.0.1',
        now: tReconnect + 2_000,
      });
      assert.equal(checkHidden[0].onlineStatus, 'offline');

      // Stranger cannot send friend request to Bob when allowFriendRequests = false -> 403 PRIVACY_RESTRICTED
      const blockedByPrivacy = await postSocial(
        stranger.cookie,
        '/api/social/friends/request',
        { targetUserId: bob.userId }
      );
      assert.equal(blockedByPrivacy.status, 403);
      const privErr = (await blockedByPrivacy.json()) as { code: string };
      assert.equal(privErr.code, 'PRIVACY_RESTRICTED');
    } finally {
      await h.cleanup();
    }
  });

  it('4. Security (401/403 CSRF/Origin/anti-spoofing/rate-limit) & Cloudflare Worker fetch + Cron pruning parity', async () => {
    const h = await createTestHarness('eyvan-d1-security-');
    try {
      const alice = await h.registerAndLogin('Alice_Sec', 'alice_sec@eyvan.test');
      const bob = await h.registerAndLogin('Bob_Sec', 'bob_sec@eyvan.test');

      // Unauthenticated -> 401
      const unauthGet = await fetch(`${h.baseUrl}/api/social/friends`);
      assert.equal(unauthGet.status, 401);

      // Missing CSRF header on mutating POST -> 403
      const noCsrf = await fetch(`${h.baseUrl}/api/social/friends/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: h.baseUrl,
          Cookie: alice.cookie,
        },
        body: JSON.stringify({ targetUserId: bob.userId }),
      });
      assert.equal(noCsrf.status, 403);

      // Disallowed Origin -> 403
      const badOrigin = await fetch(`${h.baseUrl}/api/social/friends/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: 'https://evil-attacker.example',
          Cookie: alice.cookie,
        },
        body: JSON.stringify({ targetUserId: bob.userId }),
      });
      assert.equal(badOrigin.status, 403);

      // Anti-spoofing: Alice sends body with spoofed actorUserId = bob.userId; server must ignore it and use Alice!
      const spoofReq = await fetch(`${h.baseUrl}/api/social/friends/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: alice.cookie,
        },
        body: JSON.stringify({
          actorUserId: bob.userId,
          requesterUserId: bob.userId,
          targetUserId: bob.userId,
        }),
      });
      assert.equal(spoofReq.status, 201);
      const bobIncoming = (await (
        await fetch(`${h.baseUrl}/api/social/friends/requests`, {
          headers: { Cookie: bob.cookie },
        })
      ).json()) as { incoming: Array<{ user: { userId: string } }> };
      assert.equal(bobIncoming.incoming.length, 1);
      assert.equal(
        bobIncoming.incoming[0].user.userId,
        alice.userId,
        'server must strictly bind requester to authenticated session cookie'
      );

      // Rate-limiting on search burst (limit = 40 / 5m) -> 41st triggers 429 + Retry-After
      let got429 = false;
      for (let i = 0; i < 42; i++) {
        const r = await fetch(`${h.baseUrl}/api/social/users/search?q=Bob_Sec`, {
          headers: { Cookie: alice.cookie },
        });
        if (r.status === 429) {
          got429 = true;
          assert.ok(r.headers.get('retry-after'), '429 must include Retry-After header');
          break;
        }
        assert.equal(r.status, 200);
      }
      assert.equal(got429, true, 'search burst must trigger 429 rate limit');

      // Cloudflare Worker fetch parity + forbidden D2/D3 routes return 404 + Cron scheduled() pruning
      const workerEnv = {
        EYVAN_DB: h.db.getD1Adapter(),
        ALLOWED_ORIGINS: 'https://eyvan.pages.dev',
        ENVIRONMENT: 'production',
      } as unknown as CfWorkerEnv;

      const workerFriendsRes = await worker.fetch(
        new Request('https://api.eyvan.ir/api/social/friends/requests', {
          method: 'GET',
          headers: {
            Origin: 'https://eyvan.pages.dev',
            Cookie: bob.cookie,
            'CF-Connecting-IP': '198.51.100.10',
          },
        }),
        workerEnv
      );
      assert.equal(workerFriendsRes.status, 200);
      const wfJson = (await workerFriendsRes.json()) as {
        ok: boolean;
        incoming: Array<{ friendshipId: string }>;
      };
      assert.equal(wfJson.ok, true);
      assert.equal(wfJson.incoming.length, 1);

      // Unimplemented legacy/out-of-scope routes must return 404
      for (const forbiddenPath of [
        '/api/social/messages',
        '/api/social/unknown-route',
      ]) {
        const res404 = await worker.fetch(
          new Request(`https://api.eyvan.ir${forbiddenPath}`, {
            method: 'GET',
            headers: {
              Origin: 'https://eyvan.pages.dev',
              Cookie: bob.cookie,
              'CF-Connecting-IP': '198.51.100.10',
            },
          }),
          workerEnv
        );
        assert.equal(res404.status, 404, `${forbiddenPath} must not exist`);
      }

      // Worker Cron `scheduled()` prunes expired presence sessions while preserving active ones
      const bobMe = (await (
        await fetch(`${h.baseUrl}/api/auth/me`, { headers: { Cookie: bob.cookie } })
      ).json()) as { session: { sessionId: string } };
      const now = Date.now();
      const d1 = h.db.getD1Adapter();
      await d1
        .prepare(
          `INSERT INTO user_presence_sessions (
             device_session_id, user_id, auth_session_id, status, last_heartbeat_at, expires_at, updated_at
           ) VALUES (?, ?, ?, 'online', ?, ?, ?)`
        )
        .bind(
          `${bobMe.session.sessionId}:dev_expired_old`,
          bob.userId,
          bobMe.session.sessionId,
          now - 200_000,
          now - 100_000,
          now - 200_000
        )
        .run();
      await d1
        .prepare(
          `INSERT INTO user_presence_sessions (
             device_session_id, user_id, auth_session_id, status, last_heartbeat_at, expires_at, updated_at
           ) VALUES (?, ?, ?, 'online', ?, ?, ?)`
        )
        .bind(
          `${bobMe.session.sessionId}:dev_active_fresh`,
          bob.userId,
          bobMe.session.sessionId,
          now,
          now + 60_000,
          now
        )
        .run();

      await worker.scheduled({ scheduledTime: now, cron: '0 */6 * * *' }, workerEnv);

      const remaining = await d1
        .prepare(`SELECT device_session_id FROM user_presence_sessions WHERE user_id = ?`)
        .bind(bob.userId)
        .all<{ device_session_id: string }>();
      assert.deepEqual(
        remaining.results.map((r) => r.device_session_id),
        [`${bobMe.session.sessionId}:dev_active_fresh`],
        'Cron pruning must delete expired leases and keep active leases untouched'
      );

      // Direct batched pruning helper returns 0 when nothing expired remains
      const secondPrune = await pruneExpiredPresenceSessionsBatched(d1, { now });
      assert.equal(secondPrune.deleted, 0);
    } finally {
      await h.cleanup();
    }
  });
});
