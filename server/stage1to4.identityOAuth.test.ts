import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import worker from '../cloudflare/src/index';
import { AUTH_COOKIE_NAME } from '../cloudflare/src/lib/auth/authCookie';
import { EmailSender } from '../cloudflare/src/lib/auth/emailService';
import {
  OAUTH_BIND_COOKIE_NAME,
  clearGoogleJwksCacheForTests,
} from '../cloudflare/src/lib/auth/googleOAuthService';
import { GUEST_COOKIE_NAME } from '../cloudflare/src/lib/auth/guestSession';
import { CfWorkerEnv } from '../cloudflare/src/lib/types';
import { CompletedMatchRecord } from '../src/games/hokm/online/protocol';
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

function extractCookieFromResponse(res: Response, name: string): string | null {
  for (const raw of getSetCookies(res)) {
    const first = raw.split(';')[0]?.trim() ?? '';
    if (first.startsWith(`${name}=`)) {
      return first;
    }
  }
  return null;
}

function toBase64Url(input: Uint8Array | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function createMockGoogleOidcProvider() {
  const keyPair = await crypto.webcrypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );

  const publicJwk = (await crypto.webcrypto.subtle.exportKey(
    'jwk',
    keyPair.publicKey
  )) as JsonWebKey;
  const kid = 'eyvan-test-google-key-1';

  const signIdToken = async (
    claims: Record<string, unknown>,
    opts?: { kid?: string; tamperSignature?: boolean }
  ): Promise<string> => {
    const header = {
      alg: 'RS256',
      typ: 'JWT',
      kid: opts?.kid ?? kid,
    };
    const encodedHeader = toBase64Url(JSON.stringify(header));
    const encodedPayload = toBase64Url(JSON.stringify(claims));
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const sigBuf = await crypto.webcrypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      keyPair.privateKey,
      new TextEncoder().encode(signingInput)
    );
    const sigBytes = new Uint8Array(sigBuf);
    if (opts?.tamperSignature) {
      sigBytes[0] = sigBytes[0] ^ 0xff;
    }
    return `${signingInput}.${toBase64Url(sigBytes)}`;
  };

  interface NextGoogleUser {
    sub: string;
    email: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
    aud?: string;
    iss?: string;
    nonceOverride?: string;
    tamperSignature?: boolean;
  }

  let nextProfile: NextGoogleUser = {
    sub: 'google_sub_default_1',
    email: 'google.user@example.com',
    email_verified: true,
    name: 'Google Player',
  };
  let lastExpectedChallenge: string | null = null;
  let lastNonce: string | null = null;
  const tokenExchangeCalls: Array<{
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }> = [];

  const setNextUser = (profile: NextGoogleUser) => {
    nextProfile = profile;
  };

  const captureFromAuthUrl = (authUrl: string) => {
    const u = new URL(authUrl);
    lastExpectedChallenge = u.searchParams.get('code_challenge');
    lastNonce = u.searchParams.get('nonce');
    return {
      state: u.searchParams.get('state') ?? '',
      nonce: u.searchParams.get('nonce') ?? '',
      codeChallenge: u.searchParams.get('code_challenge') ?? '',
      codeChallengeMethod: u.searchParams.get('code_challenge_method') ?? '',
      redirectUri: u.searchParams.get('redirect_uri') ?? '',
    };
  };

  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.startsWith('https://www.googleapis.com/oauth2/v3/certs')) {
      return new Response(
        JSON.stringify({
          keys: [
            {
              ...publicJwk,
              kid,
              alg: 'RS256',
              use: 'sig',
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300',
          },
        }
      );
    }

    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      const bodyStr = typeof init?.body === 'string' ? init.body : '';
      const params = new URLSearchParams(bodyStr);
      const code = params.get('code') ?? '';
      const codeVerifier = params.get('code_verifier') ?? '';
      const redirectUri = params.get('redirect_uri') ?? '';
      const clientId = params.get('client_id') ?? '';
      tokenExchangeCalls.push({ code, codeVerifier, redirectUri });

      // Verify PKCE S256 server-side just like real Google OAuth does!
      if (lastExpectedChallenge) {
        const computedChallenge = toBase64Url(
          crypto.createHash('sha256').update(codeVerifier).digest()
        );
        if (computedChallenge !== lastExpectedChallenge) {
          return new Response(JSON.stringify({ error: 'invalid_grant' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const idToken = await signIdToken(
        {
          iss: nextProfile.iss ?? 'https://accounts.google.com',
          aud: nextProfile.aud ?? clientId,
          sub: nextProfile.sub,
          email: nextProfile.email,
          email_verified:
            nextProfile.email_verified === undefined
              ? true
              : nextProfile.email_verified,
          name: nextProfile.name ?? 'Google Player',
          picture: nextProfile.picture ?? 'https://lh3.googleusercontent.com/test',
          nonce: nextProfile.nonceOverride ?? lastNonce ?? '',
          iat: nowSec - 5,
          exp: nowSec + 3600,
        },
        { tamperSignature: nextProfile.tamperSignature }
      );

      return new Response(
        JSON.stringify({
          access_token: 'ya29.mock_access_token',
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: idToken,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    throw new Error(`Unexpected external fetch URL in mock Google OAuth: ${url}`);
  };

  return {
    mockFetch,
    setNextUser,
    captureFromAuthUrl,
    tokenExchangeCalls,
  };
}

async function createIdentityHarness(
  prefix: string,
  options?: {
    googleEnabled?: boolean;
    googleFetch?: typeof fetch;
  }
) {
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

  const googleEnabled = options?.googleEnabled ?? true;

  const { app } = createEyvanExpressApp({
    db,
    roomManager,
    config: {
      isProduction: false,
      googleOAuthClientId: googleEnabled ? 'test-google-client-id.apps.googleusercontent.com' : undefined,
      googleOAuthClientSecret: googleEnabled ? 'test-google-client-secret-32chars-xyz' : undefined,
      googleOAuthFetch: options?.googleFetch,
    },
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
    password = 'EyvanStrong#2026',
    extraCookie?: string
  ) => {
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'eyvan-client',
        Origin: baseUrl,
        ...(extraCookie ? { Cookie: extraCookie } : {}),
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
      upgradedFromGuest?: boolean;
      user: { userId: string; username: string };
    };
    const token = verifyTokens.pop();
    assert.ok(token, 'verification token must be captured');

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
    const cookie = extractCookieFromResponse(loginRes, AUTH_COOKIE_NAME);
    assert.ok(cookie, 'auth cookie must be set');
    return {
      userId: regJson.user.userId,
      username: regJson.user.username,
      upgradedFromGuest: Boolean(regJson.upgradedFromGuest),
      clearedGuestCookie: getSetCookies(regRes).some((c) =>
        c.startsWith(`${GUEST_COOKIE_NAME}=;`)
      ),
      email,
      password,
      cookie,
    };
  };

  return {
    db,
    roomManager,
    baseUrl,
    registerAndLogin,
    cleanup: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

describe('Stages 1–4 — Guest Identity, Sessions, Blocks, Google OAuth (C3) & Safe Public Profiles', () => {
  it('Stage 1.1: Two guests with identical display names get independent guest identities with zero collision against each other or registered accounts', async () => {
    const h = await createIdentityHarness('eyvan-stage1-guest-');
    try {
      // Seed a registered account named "SharedName" first
      const registered = await h.registerAndLogin('SharedName', 'shared@example.com');

      // Guest 1 creates a room using the exact same typed name "SharedName"
      const g1Res = await fetch(`${h.baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
        },
        body: JSON.stringify({ username: 'SharedName', avatarCode: 'portrait' }),
      });
      assert.equal(g1Res.status, 201);
      const g1Cookie = extractCookieFromResponse(g1Res, GUEST_COOKIE_NAME);
      assert.ok(g1Cookie, 'Guest 1 must receive eyvan_guest_sess cookie');
      const g1Body = (await g1Res.json()) as { roomCode: string };

      // Guest 2 creates a separate room with the exact same typed name "SharedName" (no cookie yet)
      const g2Res = await fetch(`${h.baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
        },
        body: JSON.stringify({ username: 'SharedName', avatarCode: 'jade' }),
      });
      assert.equal(g2Res.status, 201);
      const g2Cookie = extractCookieFromResponse(g2Res, GUEST_COOKIE_NAME);
      assert.ok(g2Cookie, 'Guest 2 must receive eyvan_guest_sess cookie');
      assert.notEqual(g1Cookie, g2Cookie, 'Two guests must receive distinct guest sessions');

      // Verify DB has 3 separate rows: 1 registered + 2 independent guests with `guest:<user_id>` keys
      const d1 = h.db.getD1Adapter();
      const rows = await d1
        .prepare(`SELECT user_id, username_key, account_status FROM users ORDER BY created_at ASC`)
        .all<{ user_id: string; username_key: string; account_status: string }>();

      assert.equal(rows.results.length, 3);
      const regRow = rows.results.find((r) => r.user_id === registered.userId);
      assert.ok(regRow);
      assert.equal(regRow.username_key, 'sharedname');
      assert.equal(regRow.account_status, 'active');

      const guestRows = rows.results.filter((r) => r.account_status === 'guest');
      assert.equal(guestRows.length, 2);
      for (const gr of guestRows) {
        assert.equal(gr.username_key, `guest:${gr.user_id}`);
      }

      // Returning Guest 1 with its eyvan_guest_sess cookie reuses the exact same guest user_id
      const g1Again = await fetch(`${h.baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: g1Cookie,
        },
        body: JSON.stringify({ username: 'SharedName', avatarCode: 'portrait' }),
      });
      assert.equal(g1Again.status, 201);
      const afterRows = await d1
        .prepare(`SELECT COUNT(*) AS cnt FROM users WHERE account_status = 'guest'`)
        .first<{ cnt: number }>();
      assert.equal(afterRows?.cnt, 2, 'Returning guest must reuse existing guest user_id');
    } finally {
      await h.cleanup();
    }
  });

  it('Stage 1.1 + Stage 2: Guest playing a match then manually registering upgrades in-place preserving user_id & match stats', async () => {
    const h = await createIdentityHarness('eyvan-stage1-upgrade-');
    try {
      const gRes = await fetch(`${h.baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
        },
        body: JSON.stringify({ username: 'TempGuest', avatarCode: 'turquoise' }),
      });
      assert.equal(gRes.status, 201);
      const guestCookie = extractCookieFromResponse(gRes, GUEST_COOKIE_NAME);
      assert.ok(guestCookie);

      const d1 = h.db.getD1Adapter();
      const guestRow = await d1
        .prepare(`SELECT user_id FROM users WHERE account_status = 'guest'`)
        .first<{ user_id: string }>();
      assert.ok(guestRow);

      // Record a completed Hokm match for this guest user_id
      const match: CompletedMatchRecord = {
        matchId: 'match_guest_upgrade_1',
        roomCode: 'UPGR01',
        startedAt: Date.now() - 5000,
        finishedAt: Date.now(),
        winningTeam: 'myTeam',
        teamAScore: 3,
        teamBScore: 1,
        targetScore: 3,
        lastWinType: 'kot',
        handsPlayed: 4,
        players: [
          {
            playerId: 'p1',
            userId: guestRow.user_id,
            username: 'TempGuest',
            canonicalSeat: 'south',
            team: 'myTeam',
            won: true,
          },
          { playerId: 'p2', username: 'AllyBot', canonicalSeat: 'north', team: 'myTeam', won: true },
          { playerId: 'p3', username: 'OppOne', canonicalSeat: 'east', team: 'opponentTeam', won: false },
          { playerId: 'p4', username: 'OppTwo', canonicalSeat: 'west', team: 'opponentTeam', won: false },
        ],
      };
      h.db.recordCompletedMatch(match);

      // Now guest registers manually while sending their eyvan_guest_sess cookie
      const upgraded = await h.registerAndLogin(
        'PermanentHero',
        'hero@example.com',
        'EyvanStrong#2026',
        guestCookie
      );
      assert.equal(upgraded.upgradedFromGuest, true);
      assert.equal(upgraded.userId, guestRow.user_id, 'Upgraded account must preserve exact guest user_id');
      assert.equal(upgraded.clearedGuestCookie, true, 'Register upgrade must clear eyvan_guest_sess');

      // Guest session row must be revoked
      const activeGuestSess = await d1
        .prepare(`SELECT COUNT(*) AS cnt FROM guest_sessions WHERE guest_user_id = ? AND revoked_at IS NULL`)
        .bind(guestRow.user_id)
        .first<{ cnt: number }>();
      assert.equal(activeGuestSess?.cnt, 0);

      // Real match stats must seamlessly belong to the upgraded account
      const statsRes = await fetch(`${h.baseUrl}/api/stats/me`, {
        headers: { Cookie: upgraded.cookie },
      });
      assert.equal(statsRes.status, 200);
      const statsJson = (await statsRes.json()) as {
        stats: { matchesPlayed: number; wins: number; kotWins: number };
      };
      assert.equal(statsJson.stats.matchesPlayed, 1);
      assert.equal(statsJson.stats.wins, 1);
      assert.equal(statsJson.stats.kotWins, 1);
    } finally {
      await h.cleanup();
    }
  });

  it('Stage 2 Polish: Multi-device active sessions listing & per-session revocation with cross-user isolation', async () => {
    const h = await createIdentityHarness('eyvan-stage2-sessions-');
    try {
      const alice = await h.registerAndLogin('AliceSess', 'alice.sess@example.com');
      const bob = await h.registerAndLogin('BobSess', 'bob.sess@example.com');

      // Alice logs in from a second device
      const login2Res = await fetch(`${h.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
        },
        body: JSON.stringify({ identifier: alice.email, password: alice.password }),
      });
      assert.equal(login2Res.status, 200);
      const aliceDevice2Cookie = extractCookieFromResponse(login2Res, AUTH_COOKIE_NAME);
      assert.ok(aliceDevice2Cookie);

      // Device 1 lists active sessions -> 2 sessions, 1 current, providers: ['password']
      const listRes = await fetch(`${h.baseUrl}/api/auth/sessions`, {
        headers: { Cookie: alice.cookie },
      });
      assert.equal(listRes.status, 200);
      const listJson = (await listRes.json()) as {
        ok: boolean;
        sessions: Array<{ sessionId: string; isCurrent: boolean }>;
        providers: string[];
      };
      assert.equal(listJson.ok, true);
      assert.equal(listJson.sessions.length, 2);
      assert.deepEqual(listJson.providers, ['password']);

      const otherSession = listJson.sessions.find((s) => !s.isCurrent);
      assert.ok(otherSession);

      // Bob CANNOT revoke Alice's session (IDOR protection)
      const bobTryRes = await fetch(`${h.baseUrl}/api/auth/sessions/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: bob.cookie,
        },
        body: JSON.stringify({ sessionId: otherSession.sessionId }),
      });
      assert.equal(bobTryRes.status, 404);

      // Alice revokes Device 2 from Device 1
      const revokeRes = await fetch(`${h.baseUrl}/api/auth/sessions/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: alice.cookie,
        },
        body: JSON.stringify({ sessionId: otherSession.sessionId }),
      });
      assert.equal(revokeRes.status, 200);

      // Device 2 is now immediately unauthenticated while Device 1 remains valid
      const me2 = (await (
        await fetch(`${h.baseUrl}/api/auth/me`, { headers: { Cookie: aliceDevice2Cookie } })
      ).json()) as { authenticated: boolean };
      assert.equal(me2.authenticated, false);

      const me1 = (await (
        await fetch(`${h.baseUrl}/api/auth/me`, { headers: { Cookie: alice.cookie } })
      ).json()) as { authenticated: boolean; providers: string[] };
      assert.equal(me1.authenticated, true);
      assert.deepEqual(me1.providers, ['password']);
    } finally {
      await h.cleanup();
    }
  });

  it('Stage 1.3 + Stage 4: Block management severs friendship cleanly, hides presence/search/public profile, separates Remove Friend from Block, and supports Unblock', async () => {
    const h = await createIdentityHarness('eyvan-stage1-blocks-');
    try {
      const alice = await h.registerAndLogin('AliceBlk', 'alice.blk@example.com');
      const bob = await h.registerAndLogin('BobBlk', 'bob.blk@example.com');
      const charlie = await h.registerAndLogin('CharlieBlk', 'charlie.blk@example.com');

      // Alice & Bob become friends
      const reqRes = await fetch(`${h.baseUrl}/api/social/friends/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: alice.cookie,
        },
        body: JSON.stringify({ targetUserId: bob.userId }),
      });
      const reqJson = (await reqRes.json()) as { friendshipId: string };
      await fetch(`${h.baseUrl}/api/social/friends/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: bob.cookie,
        },
        body: JSON.stringify({ friendshipId: reqJson.friendshipId }),
      });

      // Safe Public Profile returns zero PII
      const pubRes = await fetch(`${h.baseUrl}/api/social/users/${bob.userId}`, {
        headers: { Cookie: alice.cookie },
      });
      assert.equal(pubRes.status, 200);
      const pubJson = (await pubRes.json()) as {
        ok: boolean;
        profile: Record<string, unknown>;
      };
      assert.equal(pubJson.ok, true);
      assert.equal(pubJson.profile.username, 'BobBlk');
      assert.equal(pubJson.profile.relationshipStatus, 'friend');
      const serialized = JSON.stringify(pubJson);
      for (const secretField of ['email', 'password_hash', 'token_hash', 'session_id']) {
        assert.equal(serialized.includes(`"${secretField}"`), false);
      }

      // Alice & Charlie become friends, then Alice removes Charlie (must NOT create a block!)
      const reqC = (await (
        await fetch(`${h.baseUrl}/api/social/friends/request`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Origin: h.baseUrl,
            Cookie: alice.cookie,
          },
          body: JSON.stringify({ targetUserId: charlie.userId }),
        })
      ).json()) as { friendshipId: string };
      await fetch(`${h.baseUrl}/api/social/friends/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: charlie.cookie,
        },
        body: JSON.stringify({ friendshipId: reqC.friendshipId }),
      });
      const remC = await fetch(`${h.baseUrl}/api/social/friends/remove`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: alice.cookie,
        },
        body: JSON.stringify({ targetUserId: charlie.userId }),
      });
      assert.equal(remC.status, 200);

      // Alice blocks Bob
      const blockRes = await fetch(`${h.baseUrl}/api/social/blocks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: alice.cookie,
        },
        body: JSON.stringify({ targetUserId: bob.userId }),
      });
      assert.equal(blockRes.status, 200);

      // Block list contains ONLY Bob (never Charlie!)
      const blocksList = (await (
        await fetch(`${h.baseUrl}/api/social/blocks`, { headers: { Cookie: alice.cookie } })
      ).json()) as { blocked: Array<{ userId: string }> };
      assert.deepEqual(
        blocksList.blocked.map((b) => b.userId),
        [bob.userId]
      );

      // Bob is removed from friends, hidden from search, denied public profile & friend request
      const aliceFriends = (await (
        await fetch(`${h.baseUrl}/api/social/friends`, { headers: { Cookie: alice.cookie } })
      ).json()) as { friends: Array<{ userId: string }> };
      assert.equal(aliceFriends.friends.length, 0);

      const bobSearch = (await (
        await fetch(`${h.baseUrl}/api/social/users/search?q=AliceBlk`, {
          headers: { Cookie: bob.cookie },
        })
      ).json()) as { users: Array<{ userId: string }> };
      assert.equal(bobSearch.users.length, 0);

      const blockedProfile = await fetch(`${h.baseUrl}/api/social/users/${alice.userId}`, {
        headers: { Cookie: bob.cookie },
      });
      assert.equal(blockedProfile.status, 404);

      const blockedReq = await fetch(`${h.baseUrl}/api/social/friends/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: bob.cookie,
        },
        body: JSON.stringify({ targetUserId: alice.userId }),
      });
      assert.equal(blockedReq.status, 403);

      // Alice unblocks Bob -> block lifted, friendship is NOT automatically restored
      const unblockRes = await fetch(`${h.baseUrl}/api/social/blocks/remove`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: alice.cookie,
        },
        body: JSON.stringify({ targetUserId: bob.userId }),
      });
      assert.equal(unblockRes.status, 200);

      const blocksAfter = (await (
        await fetch(`${h.baseUrl}/api/social/blocks`, { headers: { Cookie: alice.cookie } })
      ).json()) as { blocked: Array<{ userId: string }> };
      assert.equal(blocksAfter.blocked.length, 0);

      const bobSearchAfter = (await (
        await fetch(`${h.baseUrl}/api/social/users/search?q=AliceBlk`, {
          headers: { Cookie: bob.cookie },
        })
      ).json()) as { users: Array<{ userId: string; relationshipStatus: string }> };
      assert.equal(bobSearchAfter.users.length, 1);
      assert.equal(bobSearchAfter.users[0].relationshipStatus, 'none');
    } finally {
      await h.cleanup();
    }
  });

  it('Stage 3 (C3): Google OAuth 2.0/OIDC full lifecycle — PKCE S256, real RS256 JWKS verification, state replay protection, anti-takeover, explicit link, guest upgrade & Worker parity', async () => {
    clearGoogleJwksCacheForTests();
    const google = await createMockGoogleOidcProvider();

    // First verify graceful unconfigured behavior
    const unconf = await createIdentityHarness('eyvan-c3-unconf-', {
      googleEnabled: false,
    });
    try {
      const cfg = (await (
        await fetch(`${unconf.baseUrl}/api/auth/google/config`)
      ).json()) as { ok: boolean; configured: boolean };
      assert.equal(cfg.ok, true);
      assert.equal(cfg.configured, false);

      const start503 = await fetch(`${unconf.baseUrl}/api/auth/google/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: unconf.baseUrl,
        },
        body: JSON.stringify({ mode: 'login' }),
      });
      assert.equal(start503.status, 503);
    } finally {
      await unconf.cleanup();
    }

    // Full configured Google OAuth harness
    const h = await createIdentityHarness('eyvan-c3-oauth-', {
      googleEnabled: true,
      googleFetch: google.mockFetch,
    });
    try {
      const cfg = (await (
        await fetch(`${h.baseUrl}/api/auth/google/config`)
      ).json()) as { ok: boolean; configured: boolean };
      assert.equal(cfg.ok, true);
      assert.equal(cfg.configured, true);

      // 1. Fresh Google user login (with trailing slash callback path check too!)
      google.setNextUser({
        sub: 'google_sub_1001',
        email: 'sara.google@example.com',
        email_verified: true,
        name: 'Sara Google',
      });

      const start1 = await fetch(`${h.baseUrl}/api/auth/google/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
        },
        body: JSON.stringify({ mode: 'login' }),
      });
      assert.equal(start1.status, 200);
      const bind1 = extractCookieFromResponse(start1, OAUTH_BIND_COOKIE_NAME);
      assert.ok(bind1, 'OAuth /start must issue HttpOnly eyvan_oauth_bind cookie');
      const start1Json = (await start1.json()) as { ok: boolean; url: string };
      const params1 = google.captureFromAuthUrl(start1Json.url);
      assert.equal(params1.codeChallengeMethod, 'S256');
      assert.ok(params1.state.length >= 20);
      assert.ok(params1.nonce.length >= 20);

      // Callback with trailing slash `/api/auth/google/callback/` + JSON mode + browser bind cookie
      const cb1 = await fetch(
        `${h.baseUrl}/api/auth/google/callback/?code=mock_code_1&state=${encodeURIComponent(params1.state)}`,
        { headers: { Accept: 'application/json', Cookie: bind1 } }
      );
      assert.equal(cb1.status, 201);
      const saraCookie = extractCookieFromResponse(cb1, AUTH_COOKIE_NAME);
      assert.ok(saraCookie, 'Google login must issue HttpOnly eyvan_auth_sess cookie');
      const cb1Json = (await cb1.json()) as {
        ok: boolean;
        flowMode: string;
        user: { userId: string; authProvider: string; emailVerified: boolean };
      };
      assert.equal(cb1Json.ok, true);
      assert.equal(cb1Json.flowMode, 'login');
      assert.equal(cb1Json.user.authProvider, 'google');
      assert.equal(cb1Json.user.emailVerified, true);

      // 2. State replay MUST be rejected (even with original bind cookie)
      const replay = await fetch(
        `${h.baseUrl}/api/auth/google/callback?code=mock_code_1&state=${encodeURIComponent(params1.state)}`,
        { headers: { Accept: 'application/json', Cookie: bind1 } }
      );
      assert.equal(replay.status, 400);
      const replayJson = (await replay.json()) as { code: string };
      assert.equal(replayJson.code, 'OAUTH_INVALID_STATE');

      // 3. Returning Google login resolves strictly by immutable `sub` even if Google email changed!
      google.setNextUser({
        sub: 'google_sub_1001',
        email: 'sara.new.email@example.com',
        email_verified: true,
      });
      const start2Res = await fetch(`${h.baseUrl}/api/auth/google/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
        },
        body: JSON.stringify({ mode: 'login' }),
      });
      const bind2 = extractCookieFromResponse(start2Res, OAUTH_BIND_COOKIE_NAME)!;
      const start2 = (await start2Res.json()) as { url: string };
      const params2 = google.captureFromAuthUrl(start2.url);
      const cb2 = await fetch(
        `${h.baseUrl}/api/auth/google/callback?code=mock_code_2&state=${encodeURIComponent(params2.state)}`,
        { headers: { Accept: 'application/json', Cookie: bind2 } }
      );
      assert.equal(cb2.status, 200);
      const cb2Json = (await cb2.json()) as { user: { userId: string } };
      assert.equal(
        cb2Json.user.userId,
        cb1Json.user.userId,
        'Returning Google login must bind strictly by immutable sub'
      );

      // 4. Security checks: tampered JWT signature, wrong nonce, unverified email -> all rejected!
      for (const badCase of [
        { label: 'tampered_sig', tamperSignature: true },
        { label: 'bad_nonce', nonceOverride: 'wrong_nonce_value' },
        { label: 'unverified_email', email_verified: false },
        { label: 'wrong_aud', aud: 'evil-client-id' },
      ]) {
        google.setNextUser({
          sub: `google_sub_bad_${badCase.label}`,
          email: `${badCase.label}@example.com`,
          ...badCase,
        });
        const sBadRes = await fetch(`${h.baseUrl}/api/auth/google/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Origin: h.baseUrl,
          },
          body: JSON.stringify({ mode: 'login' }),
        });
        const bindBad = extractCookieFromResponse(sBadRes, OAUTH_BIND_COOKIE_NAME)!;
        const sBad = (await sBadRes.json()) as { url: string };
        const pBad = google.captureFromAuthUrl(sBad.url);
        const cbBad = await fetch(
          `${h.baseUrl}/api/auth/google/callback?code=bad_code&state=${encodeURIComponent(pBad.state)}`,
          { headers: { Accept: 'application/json', Cookie: bindBad } }
        );
        assert.equal(cbBad.status, 401, `${badCase.label} must be rejected with 401`);
      }

      // 5. Anti-takeover: manual password account owns manual@example.com -> unlinked Google login gets 409 ACCOUNT_LINK_REQUIRED
      const manualUser = await h.registerAndLogin('ManualOwner', 'manual@example.com');
      google.setNextUser({
        sub: 'google_sub_manual_link_1',
        email: 'manual@example.com',
        email_verified: true,
      });
      const sTakeoverRes = await fetch(`${h.baseUrl}/api/auth/google/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
        },
        body: JSON.stringify({ mode: 'login' }),
      });
      const bindTakeover = extractCookieFromResponse(sTakeoverRes, OAUTH_BIND_COOKIE_NAME)!;
      const sTakeover = (await sTakeoverRes.json()) as { url: string };
      const pTakeover = google.captureFromAuthUrl(sTakeover.url);
      const cbTakeover = await fetch(
        `${h.baseUrl}/api/auth/google/callback?code=takeover_code&state=${encodeURIComponent(pTakeover.state)}`,
        { headers: { Accept: 'application/json', Cookie: bindTakeover } }
      );
      assert.equal(cbTakeover.status, 409);
      const takeoverJson = (await cbTakeover.json()) as { code: string };
      assert.equal(takeoverJson.code, 'ACCOUNT_LINK_REQUIRED');

      // 6. Explicit authenticated account linking (`mode: 'link'`) + anti-login-CSRF check
      const sLinkRes = await fetch(`${h.baseUrl}/api/auth/google/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: manualUser.cookie,
        },
        body: JSON.stringify({ mode: 'link' }),
      });
      const bindLink = extractCookieFromResponse(sLinkRes, OAUTH_BIND_COOKIE_NAME)!;
      const sLink = (await sLinkRes.json()) as { url: string };
      const pLink = google.captureFromAuthUrl(sLink.url);

      // Linking callback with WRONG user cookie (even with matching browser bind) must fail (401)
      const cbLinkCsrf = await fetch(
        `${h.baseUrl}/api/auth/google/callback?code=link_code&state=${encodeURIComponent(pLink.state)}`,
        { headers: { Accept: 'application/json', Cookie: `${saraCookie}; ${bindLink}` } }
      );
      assert.equal(cbLinkCsrf.status, 401);

      // Retry fresh link with the rightful owner's cookie + bind cookie -> succeeds & becomes hybrid!
      const sLinkOkRes = await fetch(`${h.baseUrl}/api/auth/google/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: manualUser.cookie,
        },
        body: JSON.stringify({ mode: 'link' }),
      });
      const bindLinkOk = extractCookieFromResponse(sLinkOkRes, OAUTH_BIND_COOKIE_NAME)!;
      const sLinkOk = (await sLinkOkRes.json()) as { url: string };
      const pLinkOk = google.captureFromAuthUrl(sLinkOk.url);
      const cbLinkOk = await fetch(
        `${h.baseUrl}/api/auth/google/callback?code=link_ok_code&state=${encodeURIComponent(pLinkOk.state)}`,
        { headers: { Accept: 'application/json', Cookie: `${manualUser.cookie}; ${bindLinkOk}` } }
      );
      assert.equal(cbLinkOk.status, 200);
      const linkOkJson = (await cbLinkOk.json()) as {
        ok: boolean;
        flowMode: string;
        alreadyLinked: boolean;
        user: { userId: string; authProvider: string };
      };
      assert.equal(linkOkJson.ok, true);
      assert.equal(linkOkJson.flowMode, 'link');
      assert.equal(linkOkJson.alreadyLinked, false);
      assert.equal(linkOkJson.user.userId, manualUser.userId);
      assert.equal(linkOkJson.user.authProvider, 'hybrid');

      const manualMe = (await (
        await fetch(`${h.baseUrl}/api/auth/me`, { headers: { Cookie: manualUser.cookie } })
      ).json()) as { providers: string[] };
      assert.deepEqual(manualMe.providers.sort(), ['google', 'password']);

      // 7. Guest -> Google OAuth in-place upgrade preserves guest user_id & stats
      const guestRoomRes = await fetch(`${h.baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
        },
        body: JSON.stringify({ username: 'GuestForGoogle', avatarCode: 'portrait' }),
      });
      const guestCookie = extractCookieFromResponse(guestRoomRes, GUEST_COOKIE_NAME);
      assert.ok(guestCookie);

      const d1 = h.db.getD1Adapter();
      const guestRow = await d1
        .prepare(`SELECT user_id FROM users WHERE account_status = 'guest'`)
        .first<{ user_id: string }>();
      assert.ok(guestRow);

      google.setNextUser({
        sub: 'google_sub_guest_upgrade_99',
        email: 'guest.upgraded@example.com',
        email_verified: true,
        name: 'Upgraded Guest',
      });
      const sGuestRes = await fetch(`${h.baseUrl}/api/auth/google/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
          Cookie: guestCookie,
        },
        body: JSON.stringify({ mode: 'login' }),
      });
      const bindGuest = extractCookieFromResponse(sGuestRes, OAUTH_BIND_COOKIE_NAME)!;
      const sGuest = (await sGuestRes.json()) as { url: string };
      const pGuest = google.captureFromAuthUrl(sGuest.url);
      const cbGuest = await fetch(
        `${h.baseUrl}/api/auth/google/callback?code=guest_code&state=${encodeURIComponent(pGuest.state)}`,
        { headers: { Accept: 'application/json', Cookie: `${guestCookie}; ${bindGuest}` } }
      );
      assert.equal(cbGuest.status, 200);
      const cbGuestJson = (await cbGuest.json()) as {
        ok: boolean;
        user: { userId: string; authProvider: string };
      };
      assert.equal(cbGuestJson.ok, true);
      assert.equal(cbGuestJson.user.userId, guestRow.user_id);
      assert.equal(cbGuestJson.user.authProvider, 'google');
      assert.equal(
        getSetCookies(cbGuest).some((c) => c.startsWith(`${GUEST_COOKIE_NAME}=;`)),
        true,
        'Guest upgrade via Google OAuth must clear eyvan_guest_sess cookie'
      );

      // 8. Browser popup HTML mode returns postMessage bridge with exact targetOrigin (never '*')
      google.setNextUser({
        sub: 'google_sub_popup_html',
        email: 'popup.html@example.com',
        email_verified: true,
      });
      const sHtmlRes = await fetch(`${h.baseUrl}/api/auth/google/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Origin: h.baseUrl,
        },
        body: JSON.stringify({ mode: 'login' }),
      });
      const bindHtml = extractCookieFromResponse(sHtmlRes, OAUTH_BIND_COOKIE_NAME)!;
      const sHtml = (await sHtmlRes.json()) as { url: string };
      const pHtml = google.captureFromAuthUrl(sHtml.url);
      const cbHtml = await fetch(
        `${h.baseUrl}/api/auth/google/callback?code=html_code&state=${encodeURIComponent(pHtml.state)}`,
        { headers: { Accept: 'text/html', Cookie: bindHtml } }
      );
      assert.equal(cbHtml.status, 201);
      const htmlText = await cbHtml.text();
      assert.ok(htmlText.includes('EYVAN_OAUTH_RESULT'));
      assert.ok(htmlText.includes('window.opener.postMessage(data, targetOrigin)'));
      assert.ok(htmlText.includes(JSON.stringify(h.baseUrl)));
      assert.equal(htmlText.includes("'*'"), false, 'Popup HTML must NEVER use wildcard postMessage targetOrigin');

      // 9. Cloudflare Worker fetch parity for Google OAuth start + callback
      const workerEnv = {
        EYVAN_DB: h.db.getD1Adapter(),
        ALLOWED_ORIGINS: 'https://eyvan.pages.dev',
        ENVIRONMENT: 'production',
        GOOGLE_OAUTH_CLIENT_ID: 'test-google-client-id.apps.googleusercontent.com',
        GOOGLE_OAUTH_CLIENT_SECRET: 'test-google-client-secret-32chars-xyz',
        GOOGLE_OAUTH_FETCH: google.mockFetch,
      } as unknown as CfWorkerEnv;

      google.setNextUser({
        sub: 'google_sub_worker_1',
        email: 'worker.google@example.com',
        email_verified: true,
      });
      const wStart = await worker.fetch(
        new Request('https://api.eyvan.ir/api/auth/google/start', {
          method: 'POST',
          headers: {
            Origin: 'https://eyvan.pages.dev',
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            'CF-Connecting-IP': '198.51.100.77',
          },
          body: JSON.stringify({ mode: 'login' }),
        }),
        workerEnv
      );
      assert.equal(wStart.status, 200);
      const wBind = extractCookieFromResponse(wStart, OAUTH_BIND_COOKIE_NAME)!;
      assert.ok(wBind, 'Worker /start must issue eyvan_oauth_bind cookie');
      const wStartJson = (await wStart.json()) as { url: string };
      const wp = google.captureFromAuthUrl(wStartJson.url);
      const wCb = await worker.fetch(
        new Request(
          `https://api.eyvan.ir/api/auth/google/callback?code=w_code&state=${encodeURIComponent(wp.state)}`,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Cookie: wBind,
              'CF-Connecting-IP': '198.51.100.77',
            },
          }
        ),
        workerEnv
      );
      assert.equal(wCb.status, 201);
      assert.ok(extractCookieFromResponse(wCb, AUTH_COOKIE_NAME));
    } finally {
      await h.cleanup();
    }
  });
});
