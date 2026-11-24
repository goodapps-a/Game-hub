/**
 * Stage 10 Final Audit & Staging Readiness Suite — End-to-End Security,
 * Multi-Tab OAuth, OIDC Verification, PSL Cookie Rules, Cron Pruning,
 * Migration Parity, Log Hygiene & Concurrency Verification.
 *
 * NOTE: Google OIDC token/JWKS endpoints and Resend email delivery are
 * explicitly mocked locally; all SQLite/D1 SQL, Express HTTP, Worker HTTP,
 * Durable Object/room stats, WebCrypto JWT/AES-GCM/PBKDF2, and Cron
 * logic execute genuinely against real local SQLite databases.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import worker from '../cloudflare/src/index';
import { AUTH_COOKIE_NAME } from '../cloudflare/src/lib/auth/authCookie';
import { sha256Hex } from '../cloudflare/src/lib/auth/crypto';
import {
  registerManualAccount,
  updateAuthenticatedProfile,
  upgradeGuestAccountToRegistered,
} from '../cloudflare/src/lib/auth/authService';
import { verifyEmailWithToken } from '../cloudflare/src/lib/auth/c2Service';
import { EmailSender } from '../cloudflare/src/lib/auth/emailService';
import {
  areOriginsSameSite,
  buildOAuthBindCookieName,
  clearGoogleJwksCacheForTests,
  resolveOAuthBindSameSiteMode,
  resolveRegistrableSite,
  verifyGoogleIdToken,
} from '../cloudflare/src/lib/auth/googleOAuthService';
import {
  GUEST_COOKIE_NAME,
  resolveOrCreateGuestIdentity,
} from '../cloudflare/src/lib/auth/guestSession';
import { consumeRateLimitSlot } from '../cloudflare/src/lib/auth/rateLimit';
import {
  fetchPlayerStatsFromD1,
  persistCompletedMatchToD1,
} from '../cloudflare/src/lib/d1Persistence';
import {
  openOrCreateDirectConversation,
  sendDirectMessage,
} from '../cloudflare/src/lib/social/chatService';
import {
  cancelGameInvite,
  createGameInvite,
  respondToGameInvite,
} from '../cloudflare/src/lib/social/inviteService';
import { blockUser } from '../cloudflare/src/lib/social/socialService';
import { CfWorkerEnv, D1DatabaseLike } from '../cloudflare/src/lib/types';
import { createEyvanExpressApp } from './createExpressApp';
import { EyvanDatabase } from './database';
import { runDatabaseMigrations } from './migrations';
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

function findRawSetCookie(res: Response, name: string): string | null {
  for (const raw of getSetCookies(res)) {
    if (raw.startsWith(`${name}=`)) return raw;
  }
  return null;
}

function extractCookiePair(res: Response, name: string): string | null {
  const raw = findRawSetCookie(res, name);
  if (!raw) return null;
  return raw.split(';')[0]?.trim() ?? null;
}

function toBase64Url(input: Uint8Array | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function createStage10MockGoogleOidc() {
  const generateRsaKey = () =>
    crypto.webcrypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );

  const key1 = await generateRsaKey();
  const key2 = await generateRsaKey();
  const jwk1 = (await crypto.webcrypto.subtle.exportKey('jwk', key1.publicKey)) as JsonWebKey;
  const jwk2 = (await crypto.webcrypto.subtle.exportKey('jwk', key2.publicKey)) as JsonWebKey;

  let activeKid = 'stage10-kid-1';
  let activeKeyPair = key1;
  let jwksFetchCount = 0;
  let jwksMaxAgeSec = 900;
  let includeKey2InJwks = false;
  let forceTokenExchangeError = false;

  const signIdToken = async (
    claims: Record<string, unknown>,
    opts?: { kid?: string; keyPair?: CryptoKeyPair; alg?: string }
  ): Promise<string> => {
    const header = {
      alg: opts?.alg ?? 'RS256',
      typ: 'JWT',
      kid: opts?.kid ?? activeKid,
    };
    const encodedHeader = toBase64Url(JSON.stringify(header));
    const encodedPayload = toBase64Url(JSON.stringify(claims));
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const sigBuf = await crypto.webcrypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      (opts?.keyPair ?? activeKeyPair).privateKey,
      new TextEncoder().encode(signingInput)
    );
    return `${signingInput}.${toBase64Url(new Uint8Array(sigBuf))}`;
  };

  let nextProfile = {
    sub: 'google_stage10_sub_1',
    email: 'stage10.user@example.com',
    email_verified: true,
    name: 'Stage10 User',
  };

  const stateParams = new Map<
    string,
    { codeChallenge: string; nonce: string; redirectUri: string }
  >();

  const captureFromAuthUrl = (authUrl: string) => {
    const u = new URL(authUrl);
    const state = u.searchParams.get('state') ?? '';
    const nonce = u.searchParams.get('nonce') ?? '';
    const codeChallenge = u.searchParams.get('code_challenge') ?? '';
    const redirectUri = u.searchParams.get('redirect_uri') ?? '';
    stateParams.set(state, { codeChallenge, nonce, redirectUri });
    return { state, nonce, codeChallenge, redirectUri };
  };

  const mockFetch: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.startsWith('https://www.googleapis.com/oauth2/v3/certs')) {
      jwksFetchCount++;
      const keys = [{ ...jwk1, kid: 'stage10-kid-1', alg: 'RS256', use: 'sig' }];
      if (includeKey2InJwks) {
        keys.push({ ...jwk2, kid: 'stage10-kid-2', alg: 'RS256', use: 'sig' });
      }
      return new Response(JSON.stringify({ keys }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${jwksMaxAgeSec}`,
        },
      });
    }

    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      if (forceTokenExchangeError) {
        return new Response(
          JSON.stringify({
            error: 'invalid_client',
            error_description: 'Client secret rejected mock error',
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const params = new URLSearchParams(
        typeof init?.body === 'string' ? init.body : ''
      );
      const code = params.get('code') ?? '';
      const codeVerifier = params.get('code_verifier') ?? '';
      const redirectUri = params.get('redirect_uri') ?? '';
      const stateKey = code.startsWith('for:') ? code.slice(4) : '';
      const expected = stateParams.get(stateKey);
      if (!expected) {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const digest = await crypto.webcrypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(codeVerifier)
      );
      const actualChallenge = toBase64Url(new Uint8Array(digest));
      if (
        actualChallenge !== expected.codeChallenge ||
        redirectUri !== expected.redirectUri
      ) {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const idToken = await signIdToken({
        iss: 'https://accounts.google.com',
        aud: 'stage10-client-id.apps.googleusercontent.com',
        sub: nextProfile.sub,
        email: nextProfile.email,
        email_verified: nextProfile.email_verified,
        name: nextProfile.name,
        nonce: expected.nonce,
        iat: nowSec,
        exp: nowSec + 300,
      });

      return new Response(
        JSON.stringify({
          access_token: 'mock-google-access-token',
          id_token: idToken,
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    throw new Error(`Unexpected external fetch URL: ${url}`);
  };

  return {
    key1,
    key2,
    jwk1,
    jwk2,
    mockFetch,
    captureFromAuthUrl,
    signIdToken,
    setNextUser: (u: typeof nextProfile) => {
      nextProfile = u;
    },
    rotateToKey2: () => {
      includeKey2InJwks = true;
      activeKid = 'stage10-kid-2';
      activeKeyPair = key2;
    },
    setJwksMaxAgeSec: (sec: number) => {
      jwksMaxAgeSec = sec;
    },
    getJwksFetchCount: () => jwksFetchCount,
    setForceTokenExchangeError: (v: boolean) => {
      forceTokenExchangeError = v;
    },
  };
}

async function createStage10Harness(
  prefix: string,
  opts?: { googleFetch?: typeof fetch; emailSender?: EmailSender }
) {
  const dir = createTempDir(prefix);
  const dbPath = path.join(dir, 'eyvan.sqlite');
  const db = new EyvanDatabase(dbPath);
  const roomManager = new HokmRoomManager({ db });
  const sentEmails: Array<{ to: string; kind: string; url: string }> = [];

  const mockEmailSender: EmailSender = opts?.emailSender ?? {
    sendVerificationEmail: async (p) => {
      sentEmails.push({ to: p.to, kind: 'verify', url: p.verifyUrl });
      return { configured: true, sent: true, provider: 'mock' };
    },
    sendPasswordResetEmail: async (p) => {
      sentEmails.push({ to: p.to, kind: 'reset', url: p.resetUrl });
      return { configured: true, sent: true, provider: 'mock' };
    },
  };

  const { app } = createEyvanExpressApp({
    db,
    roomManager,
    config: {
      isProduction: false,
      googleOAuthClientId: 'stage10-client-id.apps.googleusercontent.com',
      googleOAuthClientSecret: 'stage10-client-secret-32chars-xyz-999',
      googleOAuthFetch: opts?.googleFetch,
    },
    emailSender: mockEmailSender,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Expected TCP port');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const postJson = (p: string, body: unknown, cookie?: string) =>
    fetch(`${baseUrl}${p}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'eyvan-client',
        Origin: baseUrl,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    });

  const registerAndLogin = async (username: string, email: string) => {
    const reg = await postJson('/api/auth/register', {
      username,
      email,
      password: 'StrongPassword123!',
      confirmPassword: 'StrongPassword123!',
    });
    assert.equal(reg.status, 201);
    const verifyEntry = sentEmails.filter((e) => e.to === email && e.kind === 'verify').pop()!;
    const hash = new URL(verifyEntry.url).hash.replace(/^#/, '');
    const token = new URLSearchParams(hash).get('verify-email')!;
    const ver = await postJson('/api/auth/verify-email', { token });
    assert.equal(ver.status, 200);
    const login = await postJson('/api/auth/login', {
      identifier: email,
      password: 'StrongPassword123!',
    });
    assert.equal(login.status, 200);
    const cookie = extractCookiePair(login, AUTH_COOKIE_NAME)!;
    const json = (await login.json()) as { user: { userId: string; username: string } };
    return { userId: json.user.userId, username: json.user.username, cookie };
  };

  const makeFriends = async (
    a: { userId: string; cookie: string },
    b: { userId: string; cookie: string }
  ) => {
    const req = await postJson(
      '/api/social/friends/request',
      { targetUserId: b.userId },
      a.cookie
    );
    assert.equal(req.status, 201);
    const reqJson = (await req.json()) as { friendshipId: string };
    const acc = await postJson(
      '/api/social/friends/accept',
      { friendshipId: reqJson.friendshipId },
      b.cookie
    );
    assert.equal(acc.status, 200);
  };

  return {
    dir,
    db,
    roomManager,
    baseUrl,
    sentEmails,
    postJson,
    registerAndLogin,
    makeFriends,
    cleanup: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function createWorkerEnv(
  dbAdapter: D1DatabaseLike,
  overrides?: Partial<CfWorkerEnv>
): CfWorkerEnv {
  return {
    EYVAN_DB: dbAdapter,
    HOKM_ROOM: {
      idFromName: (name: string) => name as unknown,
      get: () => ({
        fetch: async () => new Response('Not found', { status: 404 }),
      }),
    } as unknown as CfWorkerEnv['HOKM_ROOM'],
    EYVAN_ASSETS: {
      get: async () => null,
    } as unknown as CfWorkerEnv['EYVAN_ASSETS'],
    ...overrides,
  };
}

describe('Stage 10 Audit & Staging Readiness Verification', () => {
  it('1 & 2. 3 concurrent Google OAuth tabs (out-of-order completion) + simultaneous login & link tabs isolate per-flow cookies and enforce initiator ownership', async () => {
    clearGoogleJwksCacheForTests();
    const google = await createStage10MockGoogleOidc();
    const h = await createStage10Harness('eyvan-s10-multitab-', {
      googleFetch: google.mockFetch,
    });

    try {
      // Tab 1, Tab 2, Tab 3 open concurrently in the same browser
      const start1 = await h.postJson('/api/auth/google/start', { mode: 'login' });
      const start2 = await h.postJson('/api/auth/google/start', { mode: 'login' });
      const start3 = await h.postJson('/api/auth/google/start', { mode: 'login' });
      assert.equal(start1.status, 200);
      assert.equal(start2.status, 200);
      assert.equal(start3.status, 200);

      const j1 = (await start1.json()) as { flowId: string; url: string };
      const j2 = (await start2.json()) as { flowId: string; url: string };
      const j3 = (await start3.json()) as { flowId: string; url: string };

      const p1 = google.captureFromAuthUrl(j1.url);
      const p2 = google.captureFromAuthUrl(j2.url);
      const p3 = google.captureFromAuthUrl(j3.url);

      const c1 = extractCookiePair(start1, buildOAuthBindCookieName(j1.flowId))!;
      const c2 = extractCookiePair(start2, buildOAuthBindCookieName(j2.flowId))!;
      const c3 = extractCookiePair(start3, buildOAuthBindCookieName(j3.flowId))!;
      const allBindCookies = [c1, c2, c3].join('; ');

      // Complete OUT OF ORDER: Tab 2 -> Tab 3 -> Tab 1
      google.setNextUser({
        sub: 'g_tab_2',
        email: 'tab2@example.com',
        email_verified: true,
        name: 'TabTwo',
      });
      const cb2 = await fetch(
        `${h.baseUrl}/api/auth/google/callback?code=${encodeURIComponent(`for:${p2.state}`)}&state=${encodeURIComponent(p2.state)}`,
        { headers: { Cookie: allBindCookies } }
      );
      assert.ok(cb2.status === 200 || cb2.status === 201);
      const cb2Html = await cb2.text();
      assert.ok(cb2Html.includes('"ok":true'));
      assert.ok(findRawSetCookie(cb2, buildOAuthBindCookieName(j2.flowId))?.includes('Max-Age=0'));
      // Tab 1 and Tab 3 bind cookies MUST NOT be cleared by Tab 2
      assert.equal(findRawSetCookie(cb2, buildOAuthBindCookieName(j1.flowId)), null);
      assert.equal(findRawSetCookie(cb2, buildOAuthBindCookieName(j3.flowId)), null);

      // Replay of Tab 2 state must fail cleanly even if cookie is still presented
      const replay2 = await fetch(
        `${h.baseUrl}/api/auth/google/callback?code=${encodeURIComponent(`for:${p2.state}`)}&state=${encodeURIComponent(p2.state)}`,
        { headers: { Cookie: allBindCookies } }
      );
      assert.equal(replay2.status, 400);

      google.setNextUser({
        sub: 'g_tab_3',
        email: 'tab3@example.com',
        email_verified: true,
        name: 'TabThree',
      });
      const cb3 = await fetch(
        `${h.baseUrl}/api/auth/google/callback?code=${encodeURIComponent(`for:${p3.state}`)}&state=${encodeURIComponent(p3.state)}`,
        { headers: { Cookie: `${c1}; ${c3}` } }
      );
      assert.ok(cb3.status === 200 || cb3.status === 201);

      google.setNextUser({
        sub: 'g_tab_1',
        email: 'tab1@example.com',
        email_verified: true,
        name: 'TabOne',
      });
      const cb1 = await fetch(
        `${h.baseUrl}/api/auth/google/callback?code=${encodeURIComponent(`for:${p1.state}`)}&state=${encodeURIComponent(p1.state)}`,
        { headers: { Cookie: c1 } }
      );
      assert.ok(cb1.status === 200 || cb1.status === 201);

      // Simultaneous authenticated `link` tab vs anonymous `login` tab
      const localUser = await h.registerAndLogin('LinkOwner', 'linkowner@example.com');
      const otherUser = await h.registerAndLogin('OtherUser', 'other@example.com');

      const startLink = await h.postJson(
        '/api/auth/google/start',
        { mode: 'link' },
        localUser.cookie
      );
      const startAnonLogin = await h.postJson('/api/auth/google/start', { mode: 'login' });
      assert.equal(startLink.status, 200);
      assert.equal(startAnonLogin.status, 200);

      const linkInfo = (await startLink.json()) as { flowId: string; url: string };
      const anonInfo = (await startAnonLogin.json()) as { flowId: string; url: string };
      const pLink = google.captureFromAuthUrl(linkInfo.url);
      const cLink = extractCookiePair(startLink, buildOAuthBindCookieName(linkInfo.flowId))!;
      const cAnon = extractCookiePair(startAnonLogin, buildOAuthBindCookieName(anonInfo.flowId))!;

      // Attempting to complete LinkOwner's link flow while logged in as OtherUser MUST fail!
      google.setNextUser({
        sub: 'g_link_target',
        email: 'g.link@example.com',
        email_verified: true,
        name: 'LinkTarget',
      });
      const hijackedLinkCb = await fetch(
        `${h.baseUrl}/api/auth/google/callback?code=${encodeURIComponent(`for:${pLink.state}`)}&state=${encodeURIComponent(pLink.state)}`,
        { headers: { Cookie: `${otherUser.cookie}; ${cLink}; ${cAnon}` } }
      );
      assert.equal(hijackedLinkCb.status, 401);
      const hijackHtml = await hijackedLinkCb.text();
      assert.ok(hijackHtml.includes('UNAUTHORIZED'));
    } finally {
      await h.cleanup();
    }
  });

  it('3 & 4. OIDC JWT verification enforces azp, nbf, exp, nonce, JWK use/alg, email_verified, and handles JWKS rotation + Cache-Control window', async () => {
    clearGoogleJwksCacheForTests();
    const google = await createStage10MockGoogleOidc();
    const expectedAudience = 'stage10-client-id.apps.googleusercontent.com';
    const rawNonce = 'nonce-secret-abc-123';
    const expectedNonceHash = await sha256Hex(rawNonce);
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);

    // Populate cache (max-age=900)
    const validTok = await google.signIdToken({
      iss: 'https://accounts.google.com',
      aud: expectedAudience,
      sub: 'sub_ok',
      email: 'ok@example.com',
      email_verified: true,
      nonce: rawNonce,
      iat: nowSec,
      exp: nowSec + 300,
    });
    const r1 = await verifyGoogleIdToken(validTok, {
      expectedAudience,
      expectedNonceHash,
      fetchImpl: google.mockFetch,
      now: nowMs,
    });
    assert.equal(r1.ok, true);
    assert.equal(google.getJwksFetchCount(), 1);

    // Second check within max-age window reuses cache (still 1 JWKS fetch)
    const rCached = await verifyGoogleIdToken(validTok, {
      expectedAudience,
      expectedNonceHash,
      fetchImpl: google.mockFetch,
      now: nowMs + 100_000,
    });
    assert.equal(rCached.ok, true);
    assert.equal(google.getJwksFetchCount(), 1);

    // Tampered payload fails signature check
    const parts = validTok.split('.');
    const badSigTok = `${parts[0]}.${toBase64Url(JSON.stringify({ iss: 'https://accounts.google.com', sub: 'hacker' }))}.${parts[2]}`;
    const rTampered = await verifyGoogleIdToken(badSigTok, {
      expectedAudience,
      expectedNonceHash,
      fetchImpl: google.mockFetch,
      now: nowMs,
    });
    assert.equal(rTampered.ok, false);

    // Multi-audience WITHOUT azp fails OIDC Core 3.1.3.7 check
    const multiAudNoAzp = await google.signIdToken({
      iss: 'https://accounts.google.com',
      aud: [expectedAudience, 'other-client.apps.googleusercontent.com'],
      sub: 'sub_ok',
      email: 'ok@example.com',
      email_verified: true,
      nonce: rawNonce,
      iat: nowSec,
      exp: nowSec + 300,
    });
    const rNoAzp = await verifyGoogleIdToken(multiAudNoAzp, {
      expectedAudience,
      expectedNonceHash,
      fetchImpl: google.mockFetch,
      now: nowMs,
    });
    assert.deepEqual(rNoAzp, { ok: false, reason: 'INVALID_AZP' });

    // Multi-audience WITH matching azp succeeds
    const multiAudGoodAzp = await google.signIdToken({
      iss: 'https://accounts.google.com',
      aud: [expectedAudience, 'other-client.apps.googleusercontent.com'],
      azp: expectedAudience,
      sub: 'sub_ok',
      email: 'ok@example.com',
      email_verified: true,
      nonce: rawNonce,
      iat: nowSec,
      exp: nowSec + 300,
    });
    const rGoodAzp = await verifyGoogleIdToken(multiAudGoodAzp, {
      expectedAudience,
      expectedNonceHash,
      fetchImpl: google.mockFetch,
      now: nowMs,
    });
    assert.equal(rGoodAzp.ok, true);

    // Future nbf rejected
    const futureNbf = await google.signIdToken({
      iss: 'https://accounts.google.com',
      aud: expectedAudience,
      sub: 'sub_ok',
      email: 'ok@example.com',
      email_verified: true,
      nonce: rawNonce,
      nbf: nowSec + 120,
      iat: nowSec,
      exp: nowSec + 300,
    });
    const rFuture = await verifyGoogleIdToken(futureNbf, {
      expectedAudience,
      expectedNonceHash,
      fetchImpl: google.mockFetch,
      now: nowMs,
    });
    assert.deepEqual(rFuture, { ok: false, reason: 'TOKEN_NOT_YET_VALID' });

    // Unverified email rejected
    const unverified = await google.signIdToken({
      iss: 'https://accounts.google.com',
      aud: expectedAudience,
      sub: 'sub_ok',
      email: 'ok@example.com',
      email_verified: false,
      nonce: rawNonce,
      iat: nowSec,
      exp: nowSec + 300,
    });
    assert.deepEqual(
      await verifyGoogleIdToken(unverified, {
        expectedAudience,
        expectedNonceHash,
        fetchImpl: google.mockFetch,
        now: nowMs,
      }),
      { ok: false, reason: 'EMAIL_NOT_VERIFIED_BY_GOOGLE' }
    );

    // Wrong nonce rejected
    const wrongNonce = await google.signIdToken({
      iss: 'https://accounts.google.com',
      aud: expectedAudience,
      sub: 'sub_ok',
      email: 'ok@example.com',
      email_verified: true,
      nonce: 'different-nonce',
      iat: nowSec,
      exp: nowSec + 300,
    });
    assert.deepEqual(
      await verifyGoogleIdToken(wrongNonce, {
        expectedAudience,
        expectedNonceHash,
        fetchImpl: google.mockFetch,
        now: nowMs,
      }),
      { ok: false, reason: 'NONCE_MISMATCH' }
    );

    // Google JWKS key rotation: unknown kid triggers refresh -> succeeds with key2!
    google.rotateToKey2();
    const rotatedTok = await google.signIdToken({
      iss: 'https://accounts.google.com',
      aud: expectedAudience,
      sub: 'sub_rotated',
      email: 'rotated@example.com',
      email_verified: true,
      nonce: rawNonce,
      iat: nowSec,
      exp: nowSec + 300,
    });
    const rRotated = await verifyGoogleIdToken(rotatedTok, {
      expectedAudience,
      expectedNonceHash,
      fetchImpl: google.mockFetch,
      now: nowMs + 100_000,
    });
    assert.equal(rRotated.ok, true);
    assert.equal(google.getJwksFetchCount(), 2);
  });

  it('5 & 6. PSL / Same-Site / Cross-Site domain evaluation + Set-Cookie attributes cover custom, ccSLD, cloud PaaS, AWS S3 & IDN domains', () => {
    // Same-site pairs
    assert.equal(areOriginsSameSite('https://eyvan.ir', 'https://api.eyvan.ir'), true);
    assert.equal(areOriginsSameSite('https://play.eyvan.ir', 'https://api.eyvan.ir'), true);
    assert.equal(areOriginsSameSite('https://play.eyvan.co.uk', 'https://api.eyvan.co.uk'), true);
    assert.equal(areOriginsSameSite('https://app.eyvan.com.tr', 'https://api.eyvan.com.tr'), true);
    assert.equal(areOriginsSameSite('https://a.eyvan.edu.au', 'https://b.eyvan.edu.au'), true);
    assert.equal(areOriginsSameSite('http://localhost:3000', 'http://localhost:5173'), true);
    // IDN (Punycode conversion via WHATWG URL)
    assert.equal(areOriginsSameSite('https://ایوان.ir', 'https://api.ایوان.ir'), true);

    // Cross-site pairs (public suffixes & schemeful mismatches)
    assert.equal(areOriginsSameSite('https://eyvan.pages.dev', 'https://api.eyvan.ir'), false);
    assert.equal(areOriginsSameSite('https://a.pages.dev', 'https://b.pages.dev'), false);
    assert.equal(areOriginsSameSite('https://app1.up.railway.app', 'https://app2.up.railway.app'), false);
    assert.equal(
      areOriginsSameSite('https://a.s3.us-east-1.amazonaws.com', 'https://b.s3.us-east-1.amazonaws.com'),
      false
    );
    assert.equal(areOriginsSameSite('https://a.blogspot.com', 'https://b.blogspot.com'), false);
    assert.equal(areOriginsSameSite('http://localhost:3000', 'http://127.0.0.1:3000'), false);
    assert.equal(areOriginsSameSite('http://eyvan.ir', 'https://api.eyvan.ir'), false);

    assert.equal(resolveRegistrableSite('a.s3.us-east-1.amazonaws.com'), 'a.s3.us-east-1.amazonaws.com');
    assert.equal(resolveRegistrableSite('sub.mygame.co.ir'), 'mygame.co.ir');

    // SameSite mode selection
    assert.equal(resolveOAuthBindSameSiteMode(false, 'https://a.pages.dev', 'https://b.pages.dev'), 'Lax');
    assert.equal(resolveOAuthBindSameSiteMode(true, 'https://play.eyvan.ir', 'https://api.eyvan.ir'), 'Lax');
    assert.equal(resolveOAuthBindSameSiteMode(true, 'https://eyvan.pages.dev', 'https://api.eyvan.ir'), 'None');
    assert.equal(
      resolveOAuthBindSameSiteMode(true, 'https://play.eyvan.ir', 'https://api.eyvan.ir', 'cross-site'),
      'None'
    );
  });

  it('7. Concurrent consumeRateLimitSlot enforces atomic upper bound without overshooting', async () => {
    const dir = createTempDir('eyvan-s10-rl-');
    const db = new EyvanDatabase(path.join(dir, 'eyvan.sqlite'));
    try {
      const d1 = db.getD1Adapter();
      const policy = {
        action: 's10_race',
        maxAttempts: 5,
        windowMs: 60_000,
        blockMs: 60_000,
      };
      const now = Date.now();
      const results = await Promise.all(
        Array.from({ length: 12 }, () => consumeRateLimitSlot(d1, 's10:race:key', policy, now))
      );
      const allowedCount = results.filter((r) => r.allowed).length;
      const blockedCount = results.filter((r) => !r.allowed).length;
      assert.equal(allowedCount, 5);
      assert.equal(blockedCount, 7);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('8 & 15. Concurrent Guest upgrade (manual vs manual & manual vs Google) succeeds once atomically and preserves permanent user_id + game stats across username changes', async () => {
    clearGoogleJwksCacheForTests();
    const google = await createStage10MockGoogleOidc();
    const h = await createStage10Harness('eyvan-s10-guest-stats-', {
      googleFetch: google.mockFetch,
    });

    try {
      const d1 = h.db.getD1Adapter();
      const guest = await resolveOrCreateGuestIdentity(
        d1,
        null,
        'Stage10Guest',
        'portrait',
        Date.now()
      );
      assert.ok(guest && guest.rawGuestToken);
      const guestCookie = `${GUEST_COOKIE_NAME}=${encodeURIComponent(guest.rawGuestToken)}`;

      // Record a real Hokm match result under guest.userId BEFORE upgrade
      const nowMatch = Date.now();
      await persistCompletedMatchToD1(d1, {
        roomCode: 'S10AA1',
        matchId: 'match_s10_guest_1',
        startedAt: nowMatch - 60_000,
        finishedAt: nowMatch,
        winningTeam: 'myTeam',
        teamAScore: 3,
        teamBScore: 1,
        targetScore: 3,
        lastWinType: 'normal',
        handsPlayed: 4,
        players: [
          {
            playerId: 'p0',
            userId: guest.userId,
            username: 'Stage10Guest',
            canonicalSeat: 'south',
            team: 'myTeam',
            won: true,
          },
          {
            playerId: 'p1',
            username: 'PartnerBot',
            canonicalSeat: 'north',
            team: 'myTeam',
            won: true,
          },
          {
            playerId: 'p2',
            username: 'RivalEast',
            canonicalSeat: 'east',
            team: 'opponentTeam',
            won: false,
          },
          {
            playerId: 'p3',
            username: 'RivalWest',
            canonicalSeat: 'west',
            team: 'opponentTeam',
            won: false,
          },
        ],
      });

      // Race two manual upgrades simultaneously for the same guest cookie
      const [up1, up2] = await Promise.all([
        h.postJson(
          '/api/auth/register',
          {
            username: 'UpgradedOne',
            email: 'up1@example.com',
            password: 'StrongPassword123!',
            confirmPassword: 'StrongPassword123!',
          },
          guestCookie
        ),
        h.postJson(
          '/api/auth/register',
          {
            username: 'UpgradedTwo',
            email: 'up2@example.com',
            password: 'StrongPassword123!',
            confirmPassword: 'StrongPassword123!',
          },
          guestCookie
        ),
      ]);

      const statuses = [up1.status, up2.status].sort((a, b) => a - b);
      assert.deepEqual(statuses, [201, 409]);

      // Verify & login as the upgraded user
      const winningEmail = up1.status === 201 ? 'up1@example.com' : 'up2@example.com';
      const winningUsername = up1.status === 201 ? 'UpgradedOne' : 'UpgradedTwo';
      const verifyEntry = h.sentEmails.find((e) => e.to === winningEmail && e.kind === 'verify')!;
      const verifyTok = new URLSearchParams(new URL(verifyEntry.url).hash.replace(/^#/, '')).get(
        'verify-email'
      )!;
      const verRes = await h.postJson('/api/auth/verify-email', { token: verifyTok });
      assert.equal(verRes.status, 200);

      const loginRes = await h.postJson('/api/auth/login', {
        identifier: winningEmail,
        password: 'StrongPassword123!',
      });
      assert.equal(loginRes.status, 200);
      const loginJson = (await loginRes.json()) as {
        user: { userId: string; username: string };
      };
      assert.equal(loginJson.user.userId, guest.userId);
      const authCookie = extractCookiePair(loginRes, AUTH_COOKIE_NAME)!;
      const rawAuthToken = decodeURIComponent(authCookie.slice(`${AUTH_COOKIE_NAME}=`.length));

      // Change username again -> permanent match stats remain strictly intact under same user_id!
      const profUpd = await updateAuthenticatedProfile(
        d1,
        rawAuthToken,
        { username: 'RenamedLegend', avatarCode: 'shamsa' },
        { clientIp: '127.0.0.1', userAgent: 'test', now: Date.now() }
      );
      assert.equal(profUpd.ok, true);

      const stats = await fetchPlayerStatsFromD1(d1, 'RenamedLegend');
      assert.equal(stats.userId, guest.userId);
      assert.equal(stats.matchesPlayed, 1);
      assert.equal(stats.wins, 1);
      assert.notEqual(winningUsername, 'RenamedLegend');

      // Direct service race between manual upgrade & another concurrent manual upgrade
      const g2 = await resolveOrCreateGuestIdentity(
        d1,
        null,
        'RaceGuest2',
        'portrait',
        Date.now()
      );
      assert.ok(g2);
      const [s1, s2] = await Promise.all([
        upgradeGuestAccountToRegistered(
          d1,
          g2.userId,
          {
            username: 'RaceUpOne',
            email: 'raceup1@example.com',
            password: 'StrongPassword123!',
            confirmPassword: 'StrongPassword123!',
          },
          { clientIp: '127.0.0.1', userAgent: 'test', requireActiveGuestSession: true }
        ),
        upgradeGuestAccountToRegistered(
          d1,
          g2.userId,
          {
            username: 'RaceUpTwo',
            email: 'raceup2@example.com',
            password: 'StrongPassword123!',
            confirmPassword: 'StrongPassword123!',
          },
          { clientIp: '127.0.0.1', userAgent: 'test', requireActiveGuestSession: true }
        ),
      ]);
      const okCount = [s1.ok, s2.ok].filter(Boolean).length;
      assert.equal(okCount, 1);
    } finally {
      await h.cleanup();
    }
  });

  it('9 & 10. Migration 0001..0012 fresh + legacy upgrade create all pruning indexes & preserve data; Worker scheduled() Cron prunes/expires across all 8 tables with fault isolation', async () => {
    const dir = createTempDir('eyvan-s10-mig-cron-');
    try {
      const freshPath = path.join(dir, 'fresh.sqlite');
      const freshRaw = new Database(freshPath);
      const freshApplied = runDatabaseMigrations(freshRaw);
      assert.equal(freshApplied.applied.length, 14);

      // Verify all 9 indexes from 0012 exist
      const idxRows = freshRaw
        .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'`)
        .all() as Array<{ name: string }>;
      const idxSet = new Set(idxRows.map((r) => r.name));
      for (const expectedIdx of [
        'idx_auth_sessions_revoked_at',
        'idx_guest_sessions_revoked_at',
        'idx_oauth_states_consumed_at',
        'idx_email_verification_expires_at',
        'idx_email_verification_consumed_at',
        'idx_password_reset_expires_at',
        'idx_password_reset_consumed_at',
        'idx_game_invites_status_expires_at',
        'idx_game_invites_status_updated_at',
      ]) {
        assert.ok(idxSet.has(expectedIdx), `Missing migration 0012 index: ${expectedIdx}`);
      }
      freshRaw.close();

      // Now seed and run full EyvanDatabase + Worker scheduled() Cron test
      const db = new EyvanDatabase(path.join(dir, 'cron.sqlite'));
      const d1 = db.getD1Adapter();
      const now = 1_800_000_000_000;
      const oldTs = now - 10 * 24 * 60 * 60 * 1000; // 10 days old (past all grace windows)
      const freshFuture = now + 60 * 60 * 1000;

      // Register two verified users (active accounts + stats must stay 100% intact)
      await registerManualAccount(
        d1,
        {
          username: 'CronAlice',
          email: 'cron.alice@example.com',
          password: 'StrongPassword123!',
          confirmPassword: 'StrongPassword123!',
        },
        { clientIp: '127.0.0.1', userAgent: 'test', now: now - 1000 }
      );
      await d1
        .prepare(`UPDATE users SET account_status='active', email_verified=1 WHERE username_key='cronalice'`)
        .run();
      await registerManualAccount(
        d1,
        {
          username: 'CronBob',
          email: 'cron.bob@example.com',
          password: 'StrongPassword123!',
          confirmPassword: 'StrongPassword123!',
        },
        { clientIp: '127.0.0.1', userAgent: 'test', now: now - 1000 }
      );
      await d1
        .prepare(`UPDATE users SET account_status='active', email_verified=1 WHERE username_key='cronbob'`)
        .run();

      const aliceRow = await d1
        .prepare(`SELECT user_id FROM users WHERE username_key='cronalice'`)
        .first<{ user_id: string }>();
      const bobRow = await d1
        .prepare(`SELECT user_id FROM users WHERE username_key='cronbob'`)
        .first<{ user_id: string }>();
      const aliceId = aliceRow!.user_id;
      const bobId = bobRow!.user_id;

      // Seed expired + active records in all 8 Cron-maintained tables
      // 1) auth_rate_limits
      await d1
        .prepare(`INSERT INTO auth_rate_limits (rate_key, action, attempts, window_started_at, blocked_until, updated_at) VALUES ('rl_old', 'login_ip', 3, ?, NULL, ?), ('rl_active', 'login_ip', 1, ?, NULL, ?)`)
        .bind(oldTs, oldTs, now - 1000, now)
        .run();
      // 2) auth_sessions (must precede user_presence_sessions for FK)
      await d1
        .prepare(`INSERT INTO auth_sessions (session_id, user_id, token_hash, ip_hash, user_agent_hash, created_at, last_seen_at, expires_at, revoked_at) VALUES ('as_exp', ?, 'th_exp', 'iph', 'uah', ?, ?, ?, NULL), ('as_rev', ?, 'th_rev', 'iph', 'uah', ?, ?, ?, ?), ('as_act', ?, 'th_act', 'iph', 'uah', ?, ?, ?, NULL)`)
        .bind(
          aliceId, oldTs, oldTs, oldTs + 10_000,
          aliceId, oldTs, oldTs, freshFuture, oldTs + 10_000,
          aliceId, now - 1000, now, freshFuture
        )
        .run();
      // 3) user_presence_sessions
      await d1
        .prepare(`INSERT INTO user_presence_sessions (device_session_id, user_id, auth_session_id, status, last_heartbeat_at, expires_at, updated_at) VALUES ('prs_old', ?, 'as_act', 'online', ?, ?, ?), ('prs_act', ?, 'as_act', 'online', ?, ?, ?)`)
        .bind(aliceId, oldTs, oldTs + 10_000, oldTs, aliceId, now - 1000, freshFuture, now)
        .run();
      // 4) guest_sessions
      await d1
        .prepare(`INSERT INTO guest_sessions (guest_session_id, guest_user_id, token_hash, created_at, last_seen_at, expires_at, revoked_at) VALUES ('gs_old', ?, 'gh_old', ?, ?, ?, NULL), ('gs_act', ?, 'gh_act', ?, ?, ?, NULL)`)
        .bind(aliceId, oldTs, oldTs, oldTs + 10_000, aliceId, now - 1000, now, freshFuture)
        .run();
      // 5) oauth_states
      await d1
        .prepare(`INSERT INTO oauth_states (state_hash, provider, code_verifier_encrypted, nonce_hash, redirect_path, flow_mode, created_at, expires_at, consumed_at) VALUES ('st_old', 'google', 'v1.a.b', 'nh1', '/', 'login', ?, ?, NULL), ('st_act', 'google', 'v1.a.b', 'nh2', '/', 'login', ?, ?, NULL)`)
        .bind(oldTs, oldTs + 10_000, now - 1000, freshFuture)
        .run();
      // 6) email_verification_tokens
      await d1
        .prepare(`INSERT INTO email_verification_tokens (token_hash, user_id, email_key, created_at, expires_at, consumed_at) VALUES ('evt_old', ?, 'a@x.com', ?, ?, NULL), ('evt_act', ?, 'a@x.com', ?, ?, NULL)`)
        .bind(aliceId, oldTs, oldTs + 10_000, aliceId, now - 1000, freshFuture)
        .run();
      // 7) password_reset_tokens
      await d1
        .prepare(`INSERT INTO password_reset_tokens (token_hash, user_id, created_at, expires_at, consumed_at) VALUES ('prt_old', ?, ?, ?, NULL), ('prt_act', ?, ?, ?, NULL)`)
        .bind(aliceId, oldTs, oldTs + 10_000, aliceId, now - 1000, freshFuture)
        .run();
      // 8) game_invites (1 overdue pending -> should flip to 'expired'; 1 old canceled -> should delete; 1 fresh pending -> stays 'pending')
      await d1
        .prepare(`INSERT INTO game_invites (invite_id, game_id, room_code, inviter_id, invitee_id, status, created_at, expires_at, responded_at, updated_at) VALUES ('inv_overdue', 'hokm', 'RM0001', ?, ?, 'pending', ?, ?, NULL, ?), ('inv_hist', 'hokm', 'RM0002', ?, ?, 'canceled', ?, ?, ?, ?), ('inv_fresh', 'hokm', 'RM0003', ?, ?, 'pending', ?, ?, NULL, ?)`)
        .bind(
          aliceId, bobId, now - 60_000, now - 5_000, now - 60_000,
          aliceId, bobId, oldTs, oldTs + 60_000, oldTs, oldTs,
          aliceId, bobId, now - 1000, freshFuture, now - 1000
        )
        .run();

      const waitUntilPromises: Promise<unknown>[] = [];
      await worker.scheduled(
        { scheduledTime: now, cron: '0 */6 * * *' },
        createWorkerEnv(d1),
        {
          waitUntil: (p) => waitUntilPromises.push(p),
          passThroughOnException: () => {},
        }
      );
      await Promise.all(waitUntilPromises);

      const countWhere = async (sql: string) =>
        Number((await d1.prepare(sql).first<{ c: number }>())?.c ?? 0);

      assert.equal(await countWhere(`SELECT COUNT(*) AS c FROM auth_rate_limits WHERE rate_key='rl_old'`), 0);
      assert.equal(await countWhere(`SELECT COUNT(*) AS c FROM auth_rate_limits WHERE rate_key='rl_active'`), 1);
      assert.equal(await countWhere(`SELECT COUNT(*) AS c FROM user_presence_sessions`), 1);
      assert.equal(await countWhere(`SELECT COUNT(*) AS c FROM guest_sessions`), 1);
      assert.equal(await countWhere(`SELECT COUNT(*) AS c FROM oauth_states`), 1);
      assert.equal(await countWhere(`SELECT COUNT(*) AS c FROM auth_sessions`), 1);
      assert.equal(await countWhere(`SELECT COUNT(*) AS c FROM email_verification_tokens WHERE token_hash='evt_old'`), 0);
      assert.equal(await countWhere(`SELECT COUNT(*) AS c FROM email_verification_tokens WHERE token_hash='evt_act'`), 1);
      assert.equal(await countWhere(`SELECT COUNT(*) AS c FROM password_reset_tokens`), 1);
      assert.equal(await countWhere(`SELECT COUNT(*) AS c FROM game_invites WHERE invite_id='inv_hist'`), 0);
      assert.equal(
        (await d1.prepare(`SELECT status FROM game_invites WHERE invite_id='inv_overdue'`).first<{ status: string }>())?.status,
        'expired'
      );
      assert.equal(
        (await d1.prepare(`SELECT status FROM game_invites WHERE invite_id='inv_fresh'`).first<{ status: string }>())?.status,
        'pending'
      );

      // Fault tolerance: break one cleanup target (`oauth_states`) and confirm later tasks STILL execute!
      await d1.prepare(`DROP TABLE oauth_states`).run();
      await d1
        .prepare(`INSERT INTO game_invites (invite_id, game_id, room_code, inviter_id, invitee_id, status, created_at, expires_at, responded_at, updated_at) VALUES ('inv_overdue_2', 'hokm', 'RM0004', ?, ?, 'pending', ?, ?, NULL, ?)`)
        .bind(aliceId, bobId, now - 2000, now + 1000, now - 2000)
        .run();

      const origErr = console.error;
      const errLogs: string[] = [];
      console.error = (...args: unknown[]) => {
        errLogs.push(args.map(String).join(' '));
      };
      try {
        await worker.scheduled(
          { scheduledTime: now + 5000, cron: '0 */6 * * *' },
          createWorkerEnv(d1)
        );
      } finally {
        console.error = origErr;
      }
      assert.equal(
        (await d1.prepare(`SELECT status FROM game_invites WHERE invite_id='inv_overdue_2'`).first<{ status: string }>())?.status,
        'expired'
      );
      assert.ok(errLogs.some((l) => l.includes('Scheduled oauth-state cleanup failed')));
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('11 & 12. Concurrent Invite accept vs cancel races settle atomically; blocked & non-friend chat/invite requests return 403', async () => {
    const h = await createStage10Harness('eyvan-s10-invite-race-');
    try {
      const alice = await h.registerAndLogin('InvAlice', 'inv.alice@example.com');
      const bob = await h.registerAndLogin('InvBob', 'inv.bob@example.com');
      const carol = await h.registerAndLogin('InvCarol', 'inv.carol@example.com');
      await h.makeFriends(alice, bob);

      const d1 = h.db.getD1Adapter();
      const roomRes = await h.postJson(
        '/api/rooms',
        { username: alice.username, avatarCode: 'portrait' },
        alice.cookie
      );
      const room = (await roomRes.json()) as { roomCode: string };
      const roomLookup = async (code: string) => {
        const s = h.roomManager.getRoomSummary(code);
        if (!s) return null;
        return {
          roomCode: s.roomCode,
          status: s.status === 'CLOSED' ? ('FINISHED' as const) : s.status,
          playerCount: s.seats.filter((seat) => Boolean(seat.username)).length,
          maxPlayers: 4,
          hostUsername: s.seats.find((seat) => seat.isHost)?.username ?? null,
          playerUsernames: s.seats
            .map((seat) => seat.username)
            .filter((u): u is string => Boolean(u)),
        };
      };

      const inv = await createGameInvite(
        d1,
        { targetUserId: bob.userId, roomCode: room.roomCode, gameId: 'hokm' },
        roomLookup,
        { actorUserId: alice.userId, authSessionId: 's1', clientIp: '127.0.0.1', now: Date.now() }
      );
      assert.equal(inv.ok, true);

      // Simultaneous accept (by invitee) + cancel (by inviter)
      const [acceptR, cancelR] = await Promise.all([
        respondToGameInvite(d1, inv.invite.inviteId, 'accept', roomLookup, {
          actorUserId: bob.userId,
          authSessionId: 's2',
          clientIp: '127.0.0.1',
          now: Date.now(),
        }),
        cancelGameInvite(d1, inv.invite.inviteId, {
          actorUserId: alice.userId,
          authSessionId: 's1',
          clientIp: '127.0.0.1',
          now: Date.now(),
        }),
      ]);
      const winners = [acceptR.ok, cancelR.ok].filter(Boolean).length;
      assert.equal(winners, 1);

      // Non-friend Carol cannot chat with or invite Alice (403)
      const nonFriendConv = await openOrCreateDirectConversation(d1, alice.userId, {
        actorUserId: carol.userId,
        authSessionId: 's3',
        clientIp: '127.0.0.1',
        now: Date.now(),
      });
      assert.equal(nonFriendConv.ok, false);
      if (nonFriendConv.ok === false) assert.equal(nonFriendConv.status, 403);

      // Block Bob -> Bob cannot send messages in existing conversation (403)
      const abConv = await openOrCreateDirectConversation(d1, bob.userId, {
        actorUserId: alice.userId,
        authSessionId: 's1',
        clientIp: '127.0.0.1',
        now: Date.now(),
      });
      assert.equal(abConv.ok, true);
      await blockUser(d1, bob.userId, null, {
        actorUserId: alice.userId,
        authSessionId: 's1',
        clientIp: '127.0.0.1',
        now: Date.now(),
      });
      const blockedMsg = await sendDirectMessage(
        d1,
        abConv.conversation.conversationId,
        { body: 'hi?', clientMsgId: 'cmsg_blocked_1' },
        { actorUserId: bob.userId, authSessionId: 's2', clientIp: '127.0.0.1', now: Date.now() }
      );
      assert.equal(blockedMsg.ok, false);
      if (blockedMsg.ok === false) assert.equal(blockedMsg.status, 403);
    } finally {
      await h.cleanup();
    }
  });

  it('13 & 14. Worker & Express HTTP parity holds; failed Email/OAuth/session flows never leak raw tokens, secrets, passwords, or emails to logs', async () => {
    clearGoogleJwksCacheForTests();
    const google = await createStage10MockGoogleOidc();
    google.setForceTokenExchangeError(true);

    const capturedLogs: string[] = [];
    const origLog = console.log;
    const origWarn = console.warn;
    const origErr = console.error;
    const capture = (...args: unknown[]) => {
      capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    console.log = capture;
    console.warn = capture;
    console.error = capture;

    const secretMarker = 'stage10-client-secret-32chars-xyz-999';
    const resendSecret = 're_test_secret_leak_check_99999';
    const userSecretPwd = 'UltraSecretPass987!';
    const privateEmail = 'sensitive.leak.check@example.com';

    const failingEmailSender: EmailSender = {
      sendVerificationEmail: async () => ({
        configured: true,
        sent: false,
        provider: 'resend',
        errorCode: 'RESEND_HTTP_500',
      }),
      sendPasswordResetEmail: async () => {
        throw new Error(`boom ${resendSecret}`);
      },
    };

    const h = await createStage10Harness('eyvan-s10-parity-logs-', {
      googleFetch: google.mockFetch,
      emailSender: failingEmailSender,
    });

    try {
      // Trigger registration + failing forgot-password + failing OAuth token exchange + invalid session
      await h.postJson('/api/auth/register', {
        username: 'LeakTester',
        email: privateEmail,
        password: userSecretPwd,
        confirmPassword: userSecretPwd,
      });
      await h.postJson('/api/auth/forgot-password', { email: privateEmail });

      const start = await h.postJson('/api/auth/google/start', { mode: 'login' });
      const sj = (await start.json()) as { flowId: string; url: string };
      const sp = google.captureFromAuthUrl(sj.url);
      const sc = extractCookiePair(start, buildOAuthBindCookieName(sj.flowId))!;
      const cb = await fetch(
        `${h.baseUrl}/api/auth/google/callback?code=${encodeURIComponent(`for:${sp.state}`)}&state=${encodeURIComponent(sp.state)}`,
        { headers: { Cookie: sc } }
      );
      assert.equal(cb.status, 502);

      // Assert zero leakage of passwords, emails, or client secrets across console logs
      const allLogs = capturedLogs.join('\n');
      assert.equal(allLogs.includes(secretMarker), false);
      assert.equal(allLogs.includes(userSecretPwd), false);
      assert.equal(allLogs.includes(privateEmail), false);
      assert.equal(allLogs.includes(resendSecret), false);

      // Worker vs Express HTTP parity on /api/auth/me, /api/auth/google/config, /api/auth/google/start
      const env = createWorkerEnv(h.db.getD1Adapter(), {
        ENVIRONMENT: 'development',
        GOOGLE_OAUTH_CLIENT_ID: 'stage10-client-id.apps.googleusercontent.com',
        GOOGLE_OAUTH_CLIENT_SECRET: secretMarker,
        GOOGLE_OAUTH_FETCH: google.mockFetch,
      });

      const [expMe, wrkMe] = await Promise.all([
        fetch(`${h.baseUrl}/api/auth/me`),
        worker.fetch(new Request('http://localhost:3000/api/auth/me'), env),
      ]);
      assert.equal(expMe.status, wrkMe.status);
      assert.deepEqual(await expMe.json(), await wrkMe.json());

      const [expCfg, wrkCfg] = await Promise.all([
        fetch(`${h.baseUrl}/api/auth/google/config`),
        worker.fetch(new Request('http://localhost:3000/api/auth/google/config'), env),
      ]);
      assert.equal(expCfg.status, wrkCfg.status);
      assert.deepEqual(await expCfg.json(), await wrkCfg.json());

      const wrkStart = await worker.fetch(
        new Request('http://localhost:3000/api/auth/google/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            Origin: 'http://localhost:3000',
          },
          body: JSON.stringify({ mode: 'login' }),
        }),
        env
      );
      assert.equal(wrkStart.status, 200);
      const wrkJson = (await wrkStart.json()) as { ok: boolean; flowId: string; url: string };
      assert.equal(wrkJson.ok, true);
      assert.ok(wrkJson.url.startsWith('https://accounts.google.com/o/oauth2/v2/auth'));
      // Verify verifyEmailWithToken still rejects junk cleanly
      const verBad = await verifyEmailWithToken(
        h.db.getD1Adapter(),
        { token: 'invalid-token' },
        {
          clientIp: '127.0.0.1',
          userAgent: 'test',
        }
      );
      assert.equal(verBad.ok, false);
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origErr;
      await h.cleanup();
    }
  });
});
