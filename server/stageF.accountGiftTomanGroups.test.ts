import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { AUTH_COOKIE_NAME } from '../cloudflare/src/lib/auth/authCookie';
import { EmailSender } from '../cloudflare/src/lib/auth/emailService';
import { ensureUserAccountCode } from '../cloudflare/src/lib/auth/accountCode';
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

async function createStageFHarness(shopTestMode = false) {
  const tmpDir = createTempDir('eyvan-stagef-');
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
    config: {
      isProduction: false,
      shopTestMode,
    },
    emailSender: mockEmailSender,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const registerAndLogin = async (username: string, email: string) => {
    const tokenIdx = verifyTokens.length;
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'eyvan-client',
      },
      body: JSON.stringify({
        username,
        email,
        password: 'EyvanStrong#2026',
        confirmPassword: 'EyvanStrong#2026',
      }),
    });
    assert.equal(regRes.status, 201);
    const verifyToken = verifyTokens[tokenIdx];
    assert.ok(verifyToken, 'Expected verification token');

    const verRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'eyvan-client',
      },
      body: JSON.stringify({ token: verifyToken }),
    });
    assert.equal(verRes.status, 200);
    const cookie = extractCookiePair(verRes.headers.get('set-cookie'), AUTH_COOKIE_NAME);
    assert.ok(cookie, 'Expected auth cookie');

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: cookie },
    });
    const meJson = (await meRes.json()) as {
      ok: boolean;
      user: { userId: string; username: string; accountCode: string | null };
    };
    assert.equal(meJson.ok, true);
    return { cookie, user: meJson.user };
  };

  const cleanup = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };

  return { db, baseUrl, registerAndLogin, cleanup };
}

describe('Stage F: 6-Digit Account ID, Shop Gift, Toman Top-Up, Friend Groups & Hokm DM Guard', () => {
  it('assigns unique 6-digit accountCode on registration & backfills legacy NULL accounts cleanly', async () => {
    const { db, registerAndLogin, cleanup } = await createStageFHarness(false);
    try {
      const a = await registerAndLogin('AccountAlpha', 'alpha@eyvan.test');
      const b = await registerAndLogin('AccountBeta', 'beta@eyvan.test');

      assert.match(String(a.user.accountCode ?? ''), /^[1-9]\d{5}$/);
      assert.match(String(b.user.accountCode ?? ''), /^[1-9]\d{5}$/);
      assert.notEqual(a.user.accountCode, b.user.accountCode);

      // Simulate legacy account without account_code
      const d1 = db.getD1Adapter();
      await d1
        .prepare(
          `INSERT INTO users (user_id, username, username_key, display_name, email, email_key, email_verified, avatar_code, auth_provider, account_status, created_at, last_seen_at, updated_at)
           VALUES ('legacy_user_1', 'LegacyUser', 'legacyuser', 'LegacyUser', 'legacy@eyvan.test', 'legacy@eyvan.test', 1, 'portrait', 'password', 'active', 1000, 1000, 1000)`
        )
        .run();

      const backfilledCode = await ensureUserAccountCode(d1, 'legacy_user_1', 2000);
      assert.match(String(backfilledCode), /^[1-9]\d{5}$/);
      assert.notEqual(backfilledCode, a.user.accountCode);
    } finally {
      await cleanup();
    }
  });

  it('looks up users by username or 6-digit accountCode with zero PII and enforces block filtering', async () => {
    const { baseUrl, registerAndLogin, cleanup } = await createStageFHarness(false);
    try {
      const sender = await registerAndLogin('GiftSender', 'sender@eyvan.test');
      const target = await registerAndLogin('GiftTarget', 'target@eyvan.test');

      // Lookup by 6-digit code
      const byCodeRes = await fetch(
        `${baseUrl}/api/users/lookup?q=${encodeURIComponent(String(target.user.accountCode))}`,
        { headers: { Cookie: sender.cookie } }
      );
      assert.equal(byCodeRes.status, 200);
      const byCodeJson = (await byCodeRes.json()) as {
        ok: boolean;
        users: Array<Record<string, unknown>>;
      };
      assert.equal(byCodeJson.ok, true);
      assert.equal(byCodeJson.users.length, 1);
      assert.equal(byCodeJson.users[0]?.username, 'GiftTarget');
      assert.equal(byCodeJson.users[0]?.accountCode, target.user.accountCode);
      assert.equal('email' in (byCodeJson.users[0] ?? {}), false);

      // Lookup by partial username
      const byNameRes = await fetch(`${baseUrl}/api/users/lookup?q=GiftTar`, {
        headers: { Cookie: sender.cookie },
      });
      const byNameJson = (await byNameRes.json()) as {
        ok: boolean;
        users: Array<{ username: string }>;
      };
      assert.ok(byNameJson.users.some((u) => u.username === 'GiftTarget'));

      // Block hides user from lookup
      const blkRes = await fetch(`${baseUrl}/api/social/blocks`, {
        method: 'POST',
        headers: {
          Cookie: sender.cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({ targetUserId: target.user.userId }),
      });
      assert.equal(blkRes.status, 200);

      const afterBlockRes = await fetch(
        `${baseUrl}/api/users/lookup?q=${encodeURIComponent(String(target.user.accountCode))}`,
        { headers: { Cookie: sender.cookie } }
      );
      const afterBlockJson = (await afterBlockRes.json()) as {
        ok: boolean;
        users: unknown[];
      };
      assert.equal(afterBlockJson.users.length, 0);
    } finally {
      await cleanup();
    }
  });

  it('processes Toman top-up initiate -> sandbox verify idempotently and powers gifting with debit/ownership checks', async () => {
    const { baseUrl, registerAndLogin, cleanup } = await createStageFHarness(false);
    try {
      const alice = await registerAndLogin('TomanAlice', 'alice@eyvan.test');
      const bob = await registerAndLogin('GiftBob', 'bob@eyvan.test');

      // Insufficient funds before top-up for paid shop gift
      const failGiftRes = await fetch(`${baseUrl}/api/shop/gift`, {
        method: 'POST',
        headers: {
          Cookie: alice.cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({
          itemId: 'af-frame-gold',
          recipientAccountCode: bob.user.accountCode,
          requestId: 'gift_fail_1',
        }),
      });
      assert.equal(failGiftRes.status, 402);

      // Initiate Toman coin bundle purchase ('tp-coins-md': 10,000 coins)
      const initRes = await fetch(`${baseUrl}/api/payments/toman/initiate`, {
        method: 'POST',
        headers: {
          Cookie: alice.cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({ packageId: 'tp-coins-md' }),
      });
      assert.equal(initRes.status, 200);
      const initJson = (await initRes.json()) as {
        ok: boolean;
        order: { orderId: string; amountToman: number };
      };
      assert.equal(initJson.ok, true);
      assert.ok(initJson.order.orderId);

      // Verify sandbox order -> credits Alice's wallet
      const verRes = await fetch(`${baseUrl}/api/payments/toman/verify`, {
        method: 'POST',
        headers: {
          Cookie: alice.cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({ orderId: initJson.order.orderId }),
      });
      assert.equal(verRes.status, 200);
      const verJson = (await verRes.json()) as {
        ok: boolean;
        inventory: { coins: number };
      };
      assert.equal(verJson.ok, true);
      const creditedCoins = verJson.inventory.coins;
      assert.ok(creditedCoins >= 10_000);

      // Idempotent second verify must NOT double credit
      const verRes2 = await fetch(`${baseUrl}/api/payments/toman/verify`, {
        method: 'POST',
        headers: {
          Cookie: alice.cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({ orderId: initJson.order.orderId }),
      });
      assert.equal(verRes2.status, 200);
      const verJson2 = (await verRes2.json()) as {
        ok: boolean;
        deduplicated?: boolean;
        inventory: { coins: number };
      };
      assert.equal(verJson2.deduplicated, true);
      assert.equal(verJson2.inventory.coins, creditedCoins);

      // Self-gift must fail (400)
      const selfGiftRes = await fetch(`${baseUrl}/api/shop/gift`, {
        method: 'POST',
        headers: {
          Cookie: alice.cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({
          itemId: 'af-frame-gold',
          recipientAccountCode: alice.user.accountCode,
          requestId: 'gift_self_1',
        }),
      });
      assert.equal(selfGiftRes.status, 400);

      // Gift 'af-frame-gold' (price 600 coins) to Bob by 6-digit accountCode
      const giftRes = await fetch(`${baseUrl}/api/shop/gift`, {
        method: 'POST',
        headers: {
          Cookie: alice.cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({
          itemId: 'af-frame-gold',
          recipientAccountCode: bob.user.accountCode,
          requestId: 'gift_req_1',
        }),
      });
      assert.equal(giftRes.status, 200);
      const giftJson = (await giftRes.json()) as {
        ok: boolean;
        inventory: { coins: number };
        recipient: { username: string };
      };
      assert.equal(giftJson.ok, true);
      assert.equal(giftJson.recipient.username, 'GiftBob');
      assert.equal(giftJson.inventory.coins, creditedCoins - 600);

      // Idempotent replay with same requestId must not deduct again
      const replayGiftRes = await fetch(`${baseUrl}/api/shop/gift`, {
        method: 'POST',
        headers: {
          Cookie: alice.cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({
          itemId: 'af-frame-gold',
          recipientAccountCode: bob.user.accountCode,
          requestId: 'gift_req_1',
        }),
      });
      assert.equal(replayGiftRes.status, 200);
      const replayJson = (await replayGiftRes.json()) as {
        deduplicated?: boolean;
        inventory: { coins: number };
      };
      assert.equal(replayJson.deduplicated, true);
      assert.equal(replayJson.inventory.coins, creditedCoins - 600);

      // Bob now owns af-frame-gold; another distinct gift request returns 409 already owned
      const bobInvRes = await fetch(`${baseUrl}/api/inventory/me`, {
        headers: { Cookie: bob.cookie },
      });
      const bobInvJson = (await bobInvRes.json()) as {
        ok: boolean;
        ownedItemIds: string[];
      };
      assert.ok(bobInvJson.ownedItemIds.includes('af-frame-gold'));

      const dupGiftRes = await fetch(`${baseUrl}/api/shop/gift`, {
        method: 'POST',
        headers: {
          Cookie: alice.cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({
          itemId: 'af-frame-gold',
          recipientAccountCode: bob.user.accountCode,
          requestId: 'gift_req_2',
        }),
      });
      assert.equal(dupGiftRes.status, 409);
    } finally {
      await cleanup();
    }
  });

  it('manages Friend Groups with Hokm 4-player room invites and blocks Hokm invites in 1-on-1 PV DM', async () => {
    const { baseUrl, registerAndLogin, cleanup } = await createStageFHarness(false);
    try {
      const host = await registerAndLogin('GroupHost', 'host@eyvan.test');
      const mate = await registerAndLogin('GroupMate', 'mate@eyvan.test');
      const stranger = await registerAndLogin('StrangerUser', 'stranger@eyvan.test');

      // Establish friendship between host and mate
      const reqRes = await fetch(`${baseUrl}/api/social/friends/request`, {
        method: 'POST',
        headers: {
          Cookie: host.cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({ targetUserId: mate.user.userId }),
      });
      const reqJson = (await reqRes.json()) as { friendshipId: string };
      await fetch(`${baseUrl}/api/social/friends/accept`, {
        method: 'POST',
        headers: {
          Cookie: mate.cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({ friendshipId: reqJson.friendshipId }),
      });

      // Open 1-on-1 PV chat
      const convRes = await fetch(`${baseUrl}/api/social/chat/conversations/direct`, {
        method: 'POST',
        headers: {
          Cookie: host.cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({ targetUserId: mate.user.userId }),
      });
      const convJson = (await convRes.json()) as {
        conversation: { conversationId: string };
      };
      const convId = convJson.conversation.conversationId;

      // DM chat MUST reject Hokm 4-player invite
      const dmHokmRes = await fetch(
        `${baseUrl}/api/social/chat/conversations/${convId}/messages`,
        {
          method: 'POST',
          headers: {
            Cookie: host.cookie,
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
          },
          body: JSON.stringify({
            kind: 'game_invite',
            gameId: 'hokm',
            body: 'دعوت به حکم',
          }),
        }
      );
      assert.equal(dmHokmRes.status, 400);

      // DM chat MUST allow 2-player game invite (e.g. chess)
      const dmChessRes = await fetch(
        `${baseUrl}/api/social/chat/conversations/${convId}/messages`,
        {
          method: 'POST',
          headers: {
            Cookie: host.cookie,
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
          },
          body: JSON.stringify({
            kind: 'game_invite',
            gameId: 'chess',
            body: 'دعوت به شطرنج دونفره',
          }),
        }
      );
      assert.equal(dmChessRes.status, 200);

      // Create group
      const grpRes = await fetch(`${baseUrl}/api/social/groups`, {
        method: 'POST',
        headers: {
          Cookie: host.cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({
          name: 'تیم حکم ایوان',
          memberIds: [mate.user.userId],
        }),
      });
      assert.equal(grpRes.status, 201);
      const grpJson = (await grpRes.json()) as {
        ok: boolean;
        group: { groupId: string; memberCount: number };
      };
      assert.equal(grpJson.group.memberCount, 2);

      // Non-friend cannot be added to group
      const addStrangerRes = await fetch(
        `${baseUrl}/api/social/groups/${grpJson.group.groupId}/members`,
        {
          method: 'POST',
          headers: {
            Cookie: host.cookie,
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
          },
          body: JSON.stringify({ targetUserId: stranger.user.userId }),
        }
      );
      assert.equal(addStrangerRes.status, 403);

      // Create a real open Hokm room as host & post group game_invite
      const roomRes = await fetch(`${baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          Cookie: host.cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({
          username: host.user.username,
          avatarCode: 'portrait',
          isPublic: false,
          targetMatchScore: 3,
        }),
      });
      assert.equal(roomRes.status, 201);
      const roomJson = (await roomRes.json()) as { roomCode: string };

      const grpInvRes = await fetch(
        `${baseUrl}/api/social/groups/${grpJson.group.groupId}/messages`,
        {
          method: 'POST',
          headers: {
            Cookie: host.cookie,
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
          },
          body: JSON.stringify({
            kind: 'game_invite',
            gameId: 'hokm',
            roomCode: roomJson.roomCode,
            body: `میز حکم ۴ نفره ${roomJson.roomCode}`,
          }),
        }
      );
      assert.equal(grpInvRes.status, 200);

      // Mate lists messages and sees roomCode
      const msgsRes = await fetch(
        `${baseUrl}/api/social/groups/${grpJson.group.groupId}/messages`,
        { headers: { Cookie: mate.cookie } }
      );
      assert.equal(msgsRes.status, 200);
      const msgsJson = (await msgsRes.json()) as {
        ok: boolean;
        messages: Array<{ kind: string; roomCode: string | null }>;
      };
      assert.ok(
        msgsJson.messages.some(
          (m) => m.kind === 'game_invite' && m.roomCode === roomJson.roomCode
        )
      );
    } finally {
      await cleanup();
    }
  });
});
