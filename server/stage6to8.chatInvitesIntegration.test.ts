import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import worker from '../cloudflare/src/index';
import { AUTH_COOKIE_NAME } from '../cloudflare/src/lib/auth/authCookie';
import { EmailSender } from '../cloudflare/src/lib/auth/emailService';
import { GUEST_COOKIE_NAME } from '../cloudflare/src/lib/auth/guestSession';
import { CfWorkerEnv } from '../cloudflare/src/lib/types';
import { createEyvanExpressApp } from './createExpressApp';
import { EyvanDatabase } from './database';
import { HokmRoomManager } from './roomManager';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function getSetCookies(res: Response): string[] {
  const headersObj = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headersObj.getSetCookie === 'function') {
    return headersObj.getSetCookie();
  }
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

async function createSocialIntegrationHarness(prefix: string) {
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

  const registerAndLogin = async (username: string, email: string) => {
    const password = 'EyvanStrong#2026';
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'eyvan-client',
        Origin: baseUrl,
      },
      body: JSON.stringify({ email, username, password, confirmPassword: password }),
    });
    assert.equal(regRes.status, 201);
    const regJson = (await regRes.json()) as {
      user: { userId: string; username: string };
    };
    const token = verifyTokens.pop();
    assert.ok(token);

    await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'eyvan-client',
        Origin: baseUrl,
      },
      body: JSON.stringify({ token }),
    });

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
    const cookie = extractCookie(loginRes, AUTH_COOKIE_NAME);
    assert.ok(cookie);
    return {
      userId: regJson.user.userId,
      username: regJson.user.username,
      cookie,
    };
  };

  const makeFriends = async (
    a: { userId: string; cookie: string },
    b: { userId: string; cookie: string }
  ) => {
    const reqRes = await fetch(`${baseUrl}/api/social/friends/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'eyvan-client',
        Origin: baseUrl,
        Cookie: a.cookie,
      },
      body: JSON.stringify({ targetUserId: b.userId }),
    });
    assert.equal(reqRes.status, 201);
    const reqJson = (await reqRes.json()) as { friendshipId: string };
    const accRes = await fetch(`${baseUrl}/api/social/friends/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'eyvan-client',
        Origin: baseUrl,
        Cookie: b.cookie,
      },
      body: JSON.stringify({ friendshipId: reqJson.friendshipId }),
    });
    assert.equal(accRes.status, 200);
  };

  return {
    db,
    roomManager,
    baseUrl,
    registerAndLogin,
    makeFriends,
    cleanup: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

describe('Stages 6–8 — Private 1-on-1 Chat (D2), Real-Room Game Invites (D3) & Worker Parity', () => {
  it('Stage 6 (D2): Private 1-on-1 chat enforces friendship, membership, idempotency, pagination, read states, XSS plain-text safety, block isolation & rate limiting', async () => {
    const h = await createSocialIntegrationHarness('eyvan-d2-chat-');
    try {
      const alice = await h.registerAndLogin('AliceChat', 'alice.chat@example.com');
      const bob = await h.registerAndLogin('BobChat', 'bob.chat@example.com');
      const charlie = await h.registerAndLogin('CharlieChat', 'charlie.chat@example.com');

      // Non-friends cannot open a direct chat
      const nonFriendOpen = await fetch(`${h.baseUrl}/api/social/chat/conversations/direct`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: alice.cookie,
        },
        body: JSON.stringify({ targetUserId: bob.userId }),
      });
      assert.equal(nonFriendOpen.status, 403);
      assert.equal(((await nonFriendOpen.json()) as { code: string }).code, 'NOT_FRIENDS');

      // Become friends and open direct conversation
      await h.makeFriends(alice, bob);

      const openRes = await fetch(`${h.baseUrl}/api/social/chat/conversations/direct`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: alice.cookie,
        },
        body: JSON.stringify({ targetUserId: bob.userId }),
      });
      assert.equal(openRes.status, 200);
      const openJson = (await openRes.json()) as {
        ok: boolean;
        conversation: { conversationId: string };
      };
      const convId = openJson.conversation.conversationId;
      assert.ok(convId.startsWith('cnv_'));

      // Opening from Bob's side returns the exact same conversationId (idempotent pair key)
      const bobOpenJson = (await (
        await fetch(`${h.baseUrl}/api/social/chat/conversations/direct`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Origin: h.baseUrl,
            Cookie: bob.cookie,
          },
          body: JSON.stringify({ targetUserId: alice.userId }),
        })
      ).json()) as { conversation: { conversationId: string } };
      assert.equal(bobOpenJson.conversation.conversationId, convId);

      // Unauthorized 3rd user (Charlie) CANNOT read, send, or mark-read
      const charlieRead = await fetch(
        `${h.baseUrl}/api/social/chat/conversations/${convId}/messages`,
        { headers: { Cookie: charlie.cookie } }
      );
      assert.equal(charlieRead.status, 403);

      const charlieSend = await fetch(
        `${h.baseUrl}/api/social/chat/conversations/${convId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Origin: h.baseUrl,
            Cookie: charlie.cookie,
          },
          body: JSON.stringify({ body: 'Intruder message' }),
        }
      );
      assert.equal(charlieSend.status, 403);

      // Send message with clientMsgId + XSS payload (stored as plain text) + idempotent retry
      const xssPayload = '<script>alert("xss")</script> سلام حکم!';
      const send1 = await fetch(
        `${h.baseUrl}/api/social/chat/conversations/${convId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Origin: h.baseUrl,
            Cookie: alice.cookie,
          },
          body: JSON.stringify({ body: xssPayload, clientMsgId: 'cmsg_idem_001' }),
        }
      );
      assert.equal(send1.status, 201);
      const send1Json = (await send1.json()) as {
        deduplicated: boolean;
        message: { messageId: string; body: string };
      };
      assert.equal(send1Json.deduplicated, false);
      assert.equal(send1Json.message.body, xssPayload);

      // Duplicate clientMsgId retry must NOT insert a second row
      const sendRetry = await fetch(
        `${h.baseUrl}/api/social/chat/conversations/${convId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Origin: h.baseUrl,
            Cookie: alice.cookie,
          },
          body: JSON.stringify({ body: xssPayload, clientMsgId: 'cmsg_idem_001' }),
        }
      );
      assert.equal(sendRetry.status, 200);
      const retryJson = (await sendRetry.json()) as {
        deduplicated: boolean;
        message: { messageId: string };
      };
      assert.equal(retryJson.deduplicated, true);
      assert.equal(retryJson.message.messageId, send1Json.message.messageId);

      // Send 3 more messages to verify chronological pagination (`limit=2`)
      for (let i = 2; i <= 4; i++) {
        await new Promise((r) => setTimeout(r, 5));
        const r = await fetch(
          `${h.baseUrl}/api/social/chat/conversations/${convId}/messages`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Requested-With': 'eyvan-client',
              Origin: h.baseUrl,
              Cookie: alice.cookie,
            },
            body: JSON.stringify({ body: `Message #${i}` }),
          }
        );
        assert.equal(r.status, 201);
      }

      // Bob sees unreadCount === 4 before reading
      const bobConvsBefore = (await (
        await fetch(`${h.baseUrl}/api/social/chat/conversations`, {
          headers: { Cookie: bob.cookie },
        })
      ).json()) as { conversations: Array<{ conversationId: string; unreadCount: number }> };
      assert.equal(bobConvsBefore.conversations.length, 1);
      assert.equal(bobConvsBefore.conversations[0].unreadCount, 4);

      // Paginated fetch: page 1 (latest 2 messages) -> hasMore: true
      const page1 = (await (
        await fetch(
          `${h.baseUrl}/api/social/chat/conversations/${convId}/messages?limit=2`,
          { headers: { Cookie: bob.cookie } }
        )
      ).json()) as {
        messages: Array<{ messageId: string; body: string; createdAt: number }>;
        hasMore: boolean;
        nextBefore: number | null;
      };
      assert.equal(page1.messages.length, 2);
      assert.equal(page1.hasMore, true);
      assert.ok(page1.nextBefore !== null);
      assert.equal(page1.messages[1].body, 'Message #4');

      // Page 2 using `before=nextBefore` returns the older 2 messages
      const page2 = (await (
        await fetch(
          `${h.baseUrl}/api/social/chat/conversations/${convId}/messages?limit=2&before=${page1.nextBefore}`,
          { headers: { Cookie: bob.cookie } }
        )
      ).json()) as {
        messages: Array<{ body: string }>;
        hasMore: boolean;
      };
      assert.equal(page2.messages.length, 2);
      assert.equal(page2.hasMore, false);
      assert.equal(page2.messages[0].body, xssPayload);

      // Bob marks conversation read -> unreadCount becomes 0 and Alice sees partnerLastReadAt
      const markReadRes = await fetch(
        `${h.baseUrl}/api/social/chat/conversations/${convId}/read`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Origin: h.baseUrl,
            Cookie: bob.cookie,
          },
          body: JSON.stringify({
            lastReadMessageId: page1.messages[page1.messages.length - 1].messageId,
          }),
        }
      );
      assert.equal(markReadRes.status, 200);

      const bobConvsAfter = (await (
        await fetch(`${h.baseUrl}/api/social/chat/conversations`, {
          headers: { Cookie: bob.cookie },
        })
      ).json()) as { conversations: Array<{ unreadCount: number }> };
      assert.equal(bobConvsAfter.conversations[0].unreadCount, 0);

      const aliceReadReceipt = (await (
        await fetch(`${h.baseUrl}/api/social/chat/conversations/${convId}/messages`, {
          headers: { Cookie: alice.cookie },
        })
      ).json()) as { partnerLastReadAt: number | null };
      assert.ok(
        typeof aliceReadReceipt.partnerLastReadAt === 'number' &&
          aliceReadReceipt.partnerLastReadAt > 0
      );

      // Block immediately forbids sending/reading in the conversation
      await fetch(`${h.baseUrl}/api/social/blocks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: alice.cookie,
        },
        body: JSON.stringify({ targetUserId: bob.userId }),
      });

      const sendAfterBlock = await fetch(
        `${h.baseUrl}/api/social/chat/conversations/${convId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Origin: h.baseUrl,
            Cookie: bob.cookie,
          },
          body: JSON.stringify({ body: 'Blocked message' }),
        }
      );
      assert.equal(sendAfterBlock.status, 403);
    } finally {
      await h.cleanup();
    }
  });

  it('Stage 7 (D3): Real-room Hokm game invites validate live room, deduplicate, support accept -> real room join, decline, cancel, expiry & full-room rejection', async () => {
    const h = await createSocialIntegrationHarness('eyvan-d3-invites-');
    try {
      const host = await h.registerAndLogin('HostInv', 'host.inv@example.com');
      const friend = await h.registerAndLogin('FriendInv', 'friend.inv@example.com');
      const friend2 = await h.registerAndLogin('FriendInv2', 'friend2.inv@example.com');
      const stranger = await h.registerAndLogin('StrangerInv', 'stranger.inv@example.com');

      await h.makeFriends(host, friend);
      await h.makeFriends(host, friend2);

      // 1. Invite to nonexistent room MUST fail (404 ROOM_NOT_AVAILABLE)
      const ghostRoomInv = await fetch(`${h.baseUrl}/api/social/invites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: host.cookie,
        },
        body: JSON.stringify({ targetUserId: friend.userId, roomCode: 'NOPE99' }),
      });
      assert.equal(ghostRoomInv.status, 404);

      // 2. Host creates a REAL Hokm room (authenticated -> server locks username to HostInv)
      const createRoomRes = await fetch(`${h.baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: host.cookie,
        },
        body: JSON.stringify({ username: 'SpoofedName', avatarCode: 'portrait' }),
      });
      assert.equal(createRoomRes.status, 201);
      const roomBody = (await createRoomRes.json()) as {
        roomCode: string;
        roomId: string;
        playerId: string;
      };
      const initialSummary = h.roomManager.getRoomSummary(roomBody.roomCode);
      assert.equal(
        initialSummary?.seats.find((s) => s.canonicalSeat === 'south')?.username,
        'HostInv',
        'Stage 4 C4: Authenticated room creation must enforce verified central username'
      );

      // Non-friend cannot be invited (403 NOT_FRIENDS)
      const strangerInv = await fetch(`${h.baseUrl}/api/social/invites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: host.cookie,
        },
        body: JSON.stringify({
          targetUserId: stranger.userId,
          roomCode: roomBody.roomCode,
        }),
      });
      assert.equal(strangerInv.status, 403);

      // User NOT seated in the room cannot send an invite for that room (403 FORBIDDEN)
      const nonSeatedInv = await fetch(`${h.baseUrl}/api/social/invites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: friend.cookie,
        },
        body: JSON.stringify({
          targetUserId: host.userId,
          roomCode: roomBody.roomCode,
        }),
      });
      assert.equal(nonSeatedInv.status, 403);

      // 3. Host invites Friend -> 201; duplicate invite deduplicates (200 deduplicated: true)
      const inv1 = await fetch(`${h.baseUrl}/api/social/invites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: host.cookie,
        },
        body: JSON.stringify({
          targetUserId: friend.userId,
          roomCode: roomBody.roomCode,
        }),
      });
      assert.equal(inv1.status, 201);
      const inv1Json = (await inv1.json()) as {
        deduplicated: boolean;
        invite: { inviteId: string; roomCode: string };
      };
      assert.equal(inv1Json.deduplicated, false);

      const invDup = await fetch(`${h.baseUrl}/api/social/invites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: host.cookie,
        },
        body: JSON.stringify({
          targetUserId: friend.userId,
          roomCode: roomBody.roomCode,
        }),
      });
      assert.equal(invDup.status, 200);
      assert.equal(((await invDup.json()) as { deduplicated: boolean }).deduplicated, true);

      // 4. Friend lists invites, accepts, and joins the REAL Hokm room!
      const friendInvList = (await (
        await fetch(`${h.baseUrl}/api/social/invites`, {
          headers: { Cookie: friend.cookie },
        })
      ).json()) as { incoming: Array<{ inviteId: string; roomCode: string }> };
      assert.equal(friendInvList.incoming.length, 1);
      assert.equal(friendInvList.incoming[0].roomCode, roomBody.roomCode);

      const acceptRes = await fetch(`${h.baseUrl}/api/social/invites/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: friend.cookie,
        },
        body: JSON.stringify({ inviteId: inv1Json.invite.inviteId }),
      });
      assert.equal(acceptRes.status, 200);
      const acceptJson = (await acceptRes.json()) as { ok: boolean; roomCode: string };
      assert.equal(acceptJson.ok, true);
      assert.equal(acceptJson.roomCode, roomBody.roomCode);

      // Re-accepting already-accepted invite MUST fail (409)
      const reAccept = await fetch(`${h.baseUrl}/api/social/invites/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: friend.cookie,
        },
        body: JSON.stringify({ inviteId: inv1Json.invite.inviteId }),
      });
      assert.equal(reAccept.status, 409);

      // Friend joins the real room using the accepted roomCode!
      const joinRealRes = await fetch(
        `${h.baseUrl}/api/rooms/${acceptJson.roomCode}/join`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Origin: h.baseUrl,
            Cookie: friend.cookie,
          },
          body: JSON.stringify({ username: 'Ignored', avatarCode: 'portrait' }),
        }
      );
      assert.equal(joinRealRes.status, 200);
      const joinRealJson = (await joinRealRes.json()) as {
        roomCode: string;
        playerId: string;
      };
      assert.equal(joinRealJson.roomCode, roomBody.roomCode);

      const summary = h.roomManager.getRoomSummary(roomBody.roomCode);
      assert.equal(summary?.playerCount, 2);
      assert.ok(
        summary?.seats.some((s) => s.username === 'FriendInv'),
        'Joined friend must appear in live room seats with verified central username'
      );

      // 5. Invite Friend2 -> Host cancels -> Friend2 cannot accept canceled invite
      const inv2 = (await (
        await fetch(`${h.baseUrl}/api/social/invites`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Origin: h.baseUrl,
            Cookie: host.cookie,
          },
          body: JSON.stringify({
            targetUserId: friend2.userId,
            roomCode: roomBody.roomCode,
          }),
        })
      ).json()) as { invite: { inviteId: string } };

      const cancelRes = await fetch(`${h.baseUrl}/api/social/invites/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: host.cookie,
        },
        body: JSON.stringify({ inviteId: inv2.invite.inviteId }),
      });
      assert.equal(cancelRes.status, 200);

      const acceptCanceled = await fetch(`${h.baseUrl}/api/social/invites/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: friend2.cookie,
        },
        body: JSON.stringify({ inviteId: inv2.invite.inviteId }),
      });
      assert.equal(acceptCanceled.status, 409);

      // 6. Expired invite returns 410 INVITE_EXPIRED
      const invExp = (await (
        await fetch(`${h.baseUrl}/api/social/invites`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Origin: h.baseUrl,
            Cookie: host.cookie,
          },
          body: JSON.stringify({
            targetUserId: friend2.userId,
            roomCode: roomBody.roomCode,
          }),
        })
      ).json()) as { invite: { inviteId: string } };

      const expiredNow = Date.now();
      await h.db
        .getD1Adapter()
        .prepare(`UPDATE game_invites SET created_at = ?, expires_at = ? WHERE invite_id = ?`)
        .bind(expiredNow - 5000, expiredNow - 1000, invExp.invite.inviteId)
        .run();

      const acceptExp = await fetch(`${h.baseUrl}/api/social/invites/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: friend2.cookie,
        },
        body: JSON.stringify({ inviteId: invExp.invite.inviteId }),
      });
      assert.equal(acceptExp.status, 410);
      assert.equal(((await acceptExp.json()) as { code: string }).code, 'INVITE_EXPIRED');

      // 7. Decline invite works cleanly
      const invDec = (await (
        await fetch(`${h.baseUrl}/api/social/invites`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Origin: h.baseUrl,
            Cookie: host.cookie,
          },
          body: JSON.stringify({
            targetUserId: friend2.userId,
            roomCode: roomBody.roomCode,
          }),
        })
      ).json()) as { invite: { inviteId: string } };

      const decRes = await fetch(`${h.baseUrl}/api/social/invites/decline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: friend2.cookie,
        },
        body: JSON.stringify({ inviteId: invDec.invite.inviteId }),
      });
      assert.equal(decRes.status, 200);
    } finally {
      await h.cleanup();
    }
  });

  it('Stage 8: Cloudflare Worker parity for Private Chat, DO-backed Game Invites, Guest Cookie Issuance & Cron pruning', async () => {
    const h = await createSocialIntegrationHarness('eyvan-stage8-worker-');
    try {
      const alice = await h.registerAndLogin('WorkerAlice', 'w.alice@example.com');
      const bob = await h.registerAndLogin('WorkerBob', 'w.bob@example.com');
      await h.makeFriends(alice, bob);

      // Mock HOKM_ROOM Durable Object namespace for Worker invite & guest room tests
      const mockRoomSummary = {
        exists: true,
        roomId: 'room_w_1',
        roomCode: 'WRKR99',
        status: 'WAITING',
        playerCount: 1,
        maxPlayers: 4,
        seats: [
          {
            canonicalSeat: 'south',
            username: 'WorkerAlice',
            isHost: true,
            isReady: false,
            connected: true,
          },
        ],
      };

      const workerEnv = {
        EYVAN_DB: h.db.getD1Adapter(),
        ALLOWED_ORIGINS: 'https://eyvan.pages.dev',
        ENVIRONMENT: 'production',
        HOKM_ROOM: {
          idFromName: (name: string) => ({ name }),
          get: () => ({
            fetch: async (req: Request) => {
              const u = new URL(req.url);
              if (u.pathname === '/summary') {
                return new Response(JSON.stringify(mockRoomSummary), {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                });
              }
              if (u.pathname === '/create') {
                return new Response(
                  JSON.stringify({
                    roomCode: 'WRKR99',
                    roomId: 'room_w_1',
                    playerId: 'p_w_1',
                    sessionToken: 'tok_w_1',
                    username: 'GuestW',
                    avatarCode: 'portrait',
                    canonicalSeat: 'south',
                  }),
                  {
                    status: 201,
                    headers: { 'Content-Type': 'application/json' },
                  }
                );
              }
              return new Response('not found', { status: 404 });
            },
          }),
        },
      } as unknown as CfWorkerEnv;

      // 1. Worker private chat end-to-end
      const wOpen = await worker.fetch(
        new Request('https://api.eyvan.ir/api/social/chat/conversations/direct', {
          method: 'POST',
          headers: {
            Origin: 'https://eyvan.pages.dev',
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Cookie: alice.cookie,
            'CF-Connecting-IP': '198.51.100.51',
          },
          body: JSON.stringify({ targetUserId: bob.userId }),
        }),
        workerEnv
      );
      assert.equal(wOpen.status, 200);
      const wConv = (await wOpen.json()) as {
        conversation: { conversationId: string };
      };

      const wMsg = await worker.fetch(
        new Request(
          `https://api.eyvan.ir/api/social/chat/conversations/${wConv.conversation.conversationId}/messages`,
          {
            method: 'POST',
            headers: {
              Origin: 'https://eyvan.pages.dev',
              'Content-Type': 'application/json',
              'X-Requested-With': 'eyvan-client',
              Cookie: alice.cookie,
              'CF-Connecting-IP': '198.51.100.51',
            },
            body: JSON.stringify({ body: 'Hello from Worker!' }),
          }
        ),
        workerEnv
      );
      assert.equal(wMsg.status, 201);

      // 2. Worker DO-verified real-room game invite
      const wInv = await worker.fetch(
        new Request('https://api.eyvan.ir/api/social/invites', {
          method: 'POST',
          headers: {
            Origin: 'https://eyvan.pages.dev',
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Cookie: alice.cookie,
            'CF-Connecting-IP': '198.51.100.51',
          },
          body: JSON.stringify({ targetUserId: bob.userId, roomCode: 'WRKR99' }),
        }),
        workerEnv
      );
      assert.equal(wInv.status, 201);

      // 3. Worker guest room creation issues both eyvan_hokm_sess and eyvan_guest_sess cookies
      const wGuestRoom = await worker.fetch(
        new Request('https://api.eyvan.ir/api/rooms', {
          method: 'POST',
          headers: {
            Origin: 'https://eyvan.pages.dev',
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            'CF-Connecting-IP': '198.51.100.52',
          },
          body: JSON.stringify({ username: 'GuestW', avatarCode: 'portrait' }),
        }),
        workerEnv
      );
      assert.equal(wGuestRoom.status, 201);
      assert.ok(
        extractCookie(wGuestRoom, GUEST_COOKIE_NAME),
        'Worker guest room creation must set eyvan_guest_sess cookie'
      );

      // 4. Cron scheduled() prunes expired guest_sessions cleanly
      const d1 = h.db.getD1Adapter();
      const now = Date.now();
      await d1
        .prepare(`UPDATE guest_sessions SET created_at = ?, expires_at = ?`)
        .bind(now - 20_000, now - 10_000)
        .run();

      await worker.scheduled({ scheduledTime: now, cron: '0 */6 * * *' }, workerEnv);

      const remainingGuests = await d1
        .prepare(`SELECT COUNT(*) AS cnt FROM guest_sessions`)
        .first<{ cnt: number }>();
      assert.equal(remainingGuests?.cnt, 0);
    } finally {
      await h.cleanup();
    }
  });
});
