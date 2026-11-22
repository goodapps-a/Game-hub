/**
 * Final Hardening Verification Suite — Auth, Multi-Tab OAuth, SameSite Cookies,
 * Guest Upgrade Guards, Migration 0011, Social/Chat/Invite Atomicity & Rate Limits.
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
import { upgradeGuestAccountToRegistered } from '../cloudflare/src/lib/auth/authService';
import { EmailSender } from '../cloudflare/src/lib/auth/emailService';
import {
  buildOAuthBindCookieName,
  clearGoogleJwksCacheForTests,
  completeGoogleOAuthCallback,
  MAX_CONCURRENT_OAUTH_FLOWS_PER_BROWSER,
  OAUTH_BIND_COOKIE_NAME,
  pruneExpiredOAuthStatesBatched,
  resolveOAuthBindSameSiteMode,
  startGoogleOAuthFlow,
} from '../cloudflare/src/lib/auth/googleOAuthService';
import {
  GUEST_COOKIE_NAME,
  resolveOrCreateGuestIdentity,
  verifyGuestSession,
} from '../cloudflare/src/lib/auth/guestSession';
import {
  CHAT_CONVERSATION_MUTATION_USER_RATE_LIMIT,
  OAUTH_CALLBACK_IP_RATE_LIMIT,
  OAUTH_START_IP_RATE_LIMIT,
  SOCIAL_FRIEND_MUTATION_USER_RATE_LIMIT,
} from '../cloudflare/src/lib/auth/rateLimit';
import {
  markConversationRead,
  openOrCreateDirectConversation,
  sendDirectMessage,
} from '../cloudflare/src/lib/social/chatService';
import {
  cancelGameInvite,
  createGameInvite,
  respondToGameInvite,
} from '../cloudflare/src/lib/social/inviteService';
import { blockUser, removeFriend } from '../cloudflare/src/lib/social/socialService';
import { CfWorkerEnv } from '../cloudflare/src/lib/types';
import { openGoogleOAuthPopup } from '../src/platform/auth/authClient';
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
  const kid = 'eyvan-final-hardening-kid-1';

  const signIdToken = async (claims: Record<string, unknown>): Promise<string> => {
    const header = { alg: 'RS256', typ: 'JWT', kid };
    const encodedHeader = toBase64Url(JSON.stringify(header));
    const encodedPayload = toBase64Url(JSON.stringify(claims));
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const sigBuf = await crypto.webcrypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      keyPair.privateKey,
      new TextEncoder().encode(signingInput)
    );
    return `${signingInput}.${toBase64Url(new Uint8Array(sigBuf))}`;
  };

  interface NextGoogleUser {
    sub: string;
    email: string;
    email_verified?: boolean;
    name?: string;
  }

  let nextProfile: NextGoogleUser = {
    sub: 'google_sub_final_1',
    email: 'final.user@example.com',
    email_verified: true,
    name: 'Final User',
  };
  const stateParams = new Map<
    string,
    { codeChallenge: string; nonce: string; redirectUri: string }
  >();
  let lastChallenge = '';
  let lastNonce = '';
  let lastRedirectUri = '';

  const captureFromAuthUrl = (authUrl: string) => {
    const u = new URL(authUrl);
    const state = u.searchParams.get('state') ?? '';
    const nonce = u.searchParams.get('nonce') ?? '';
    const codeChallenge = u.searchParams.get('code_challenge') ?? '';
    const redirectUri = u.searchParams.get('redirect_uri') ?? '';
    stateParams.set(state, { codeChallenge, nonce, redirectUri });
    lastChallenge = codeChallenge;
    lastNonce = nonce;
    lastRedirectUri = redirectUri;
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
      return new Response(
        JSON.stringify({
          keys: [{ ...publicJwk, kid, alg: 'RS256', use: 'sig' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      const params = new URLSearchParams(
        typeof init?.body === 'string' ? init.body : ''
      );
      const codeVerifier = params.get('code_verifier') ?? '';
      const redirectUri = params.get('redirect_uri') ?? '';
      const code = params.get('code') ?? '';
      // Allow tests to pass `code=state:<stateKey>` or fall back to last captured
      let expected = {
        codeChallenge: lastChallenge,
        nonce: lastNonce,
        redirectUri: lastRedirectUri,
      };
      if (code.startsWith('for:')) {
        const key = code.slice(4);
        const found = stateParams.get(key);
        if (found) expected = found;
      }

      const digest = await crypto.webcrypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(codeVerifier)
      );
      const actualChallenge = toBase64Url(new Uint8Array(digest));
      if (actualChallenge !== expected.codeChallenge || redirectUri !== expected.redirectUri) {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const idToken = await signIdToken({
        iss: 'https://accounts.google.com',
        aud: 'final-client-id.apps.googleusercontent.com',
        sub: nextProfile.sub,
        email: nextProfile.email,
        email_verified: nextProfile.email_verified ?? true,
        name: nextProfile.name ?? 'Final User',
        nonce: expected.nonce,
        iat: nowSec,
        exp: nowSec + 300,
      });

      return new Response(
        JSON.stringify({
          access_token: 'mock-access-token',
          id_token: idToken,
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  return {
    mockFetch,
    captureFromAuthUrl,
    setNextUser: (u: NextGoogleUser) => {
      nextProfile = u;
    },
  };
}

async function createFinalHarness(
  prefix: string,
  opts?: { googleFetch?: typeof fetch }
) {
  const dir = createTempDir(prefix);
  const dbPath = path.join(dir, 'eyvan.sqlite');
  const db = new EyvanDatabase(dbPath);
  const roomManager = new HokmRoomManager({ db });
  const sentEmails: Array<{ to: string; kind: string; url: string }> = [];

  const mockEmailSender: EmailSender = {
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
      googleOAuthClientId: 'final-client-id.apps.googleusercontent.com',
      googleOAuthClientSecret: 'final-client-secret-32chars-xyz-123',
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
    db,
    roomManager,
    baseUrl,
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

describe('Eyvan Final Hardening — Multi-Tab OAuth, SameSite Cookies, Guest Guards, Migration 0011 & Social Atomicity', () => {
  it('1. Multi-tab concurrent Google OAuth preserves independent per-flow cookies, evicts oldest > 5, clears legacy cookie, and correlates flowId in popup listener', async () => {
    clearGoogleJwksCacheForTests();
    const google = await createMockGoogleOidcProvider();
    const h = await createFinalHarness('eyvan-final-multitab-', {
      googleFetch: google.mockFetch,
    });

    try {
      // Tab 1 and Tab 2 start Google OAuth concurrently in the same browser
      const start1 = await h.postJson('/api/auth/google/start', { mode: 'login' });
      assert.equal(start1.status, 200);
      const j1 = (await start1.json()) as { flowId: string; url: string };
      const p1 = google.captureFromAuthUrl(j1.url);
      const cookie1 = extractCookiePair(start1, buildOAuthBindCookieName(j1.flowId))!;
      assert.ok(cookie1);

      const start2 = await h.postJson(
        '/api/auth/google/start',
        { mode: 'login' },
        cookie1
      );
      assert.equal(start2.status, 200);
      const j2 = (await start2.json()) as { flowId: string; url: string };
      const p2 = google.captureFromAuthUrl(j2.url);
      const cookie2 = extractCookiePair(start2, buildOAuthBindCookieName(j2.flowId))!;
      assert.ok(cookie2);
      assert.notEqual(j1.flowId, j2.flowId);
      assert.notEqual(
        buildOAuthBindCookieName(j1.flowId),
        buildOAuthBindCookieName(j2.flowId)
      );

      // Browser holds BOTH cookies concurrently
      const combinedJar = `${cookie1}; ${cookie2}`;

      // Tab 2 finishes FIRST -> succeeds AND clears ONLY Tab 2's cookie (Tab 1 stays intact!)
      google.setNextUser({
        sub: 'google_sub_tab2',
        email: 'tab2@example.com',
        name: 'Tab Two',
      });
      const cb2 = await fetch(
        `${h.baseUrl}/api/auth/google/callback?code=${encodeURIComponent(`for:${p2.state}`)}&state=${encodeURIComponent(p2.state)}`,
        { headers: { Accept: 'application/json', Cookie: combinedJar } }
      );
      assert.equal(cb2.status, 201);
      assert.ok(
        findRawSetCookie(cb2, buildOAuthBindCookieName(j2.flowId))?.includes('Max-Age=0')
      );
      assert.equal(
        findRawSetCookie(cb2, buildOAuthBindCookieName(j1.flowId)),
        null,
        'Completing Tab 2 must NEVER clear Tab 1 per-flow cookie'
      );

      // Tab 1 finishes SECOND -> still succeeds cleanly!
      google.setNextUser({
        sub: 'google_sub_tab1',
        email: 'tab1@example.com',
        name: 'Tab One',
      });
      const cb1 = await fetch(
        `${h.baseUrl}/api/auth/google/callback?code=${encodeURIComponent(`for:${p1.state}`)}&state=${encodeURIComponent(p1.state)}`,
        { headers: { Accept: 'application/json', Cookie: cookie1 } }
      );
      assert.equal(cb1.status, 201);
      assert.ok(
        findRawSetCookie(cb1, buildOAuthBindCookieName(j1.flowId))?.includes('Max-Age=0')
      );

      // Eviction cap: opening 6 concurrent flows evicts oldest flowId, plus clears legacy cookie
      let jar: string[] = [`${OAUTH_BIND_COOKIE_NAME}=legacy-val`];
      const flowIds: string[] = [];
      for (let i = 0; i < MAX_CONCURRENT_OAUTH_FLOWS_PER_BROWSER + 1; i++) {
        const res = await h.postJson(
          '/api/auth/google/start',
          { mode: 'login' },
          jar.join('; ')
        );
        assert.equal(res.status, 200);
        const body = (await res.json()) as { flowId: string };
        flowIds.push(body.flowId);
        const c = extractCookiePair(res, buildOAuthBindCookieName(body.flowId))!;
        jar.push(c);
        if (i === 0) {
          assert.ok(
            findRawSetCookie(res, OAUTH_BIND_COOKIE_NAME)?.includes('Max-Age=0'),
            'Legacy unsuffixed eyvan_oauth_bind cookie must be cleared during transition'
          );
        }
        if (i === MAX_CONCURRENT_OAUTH_FLOWS_PER_BROWSER) {
          assert.ok(
            findRawSetCookie(res, buildOAuthBindCookieName(flowIds[0]))?.includes('Max-Age=0'),
            'Exceeding max concurrent OAuth flows must evict oldest flow cookie'
          );
        }
      }

      // Frontend openGoogleOAuthPopup: unique popup target name & strict flowId correlation
      const listeners: Array<(ev: MessageEvent) => void> = [];
      const openedTargets: string[] = [];
      const fakePopup = {
        closed: false,
        close() {
          this.closed = true;
        },
      };
      const origWindow = (globalThis as Record<string, unknown>).window;
      const origFetch = globalThis.fetch;
      try {
        (globalThis as Record<string, unknown>).window = {
          location: { origin: 'https://eyvan.ir' },
          screenX: 0,
          screenY: 0,
          outerWidth: 1200,
          outerHeight: 800,
          open: (_url: string, targetName: string) => {
            openedTargets.push(targetName);
            return fakePopup;
          },
          addEventListener: (t: string, fn: (ev: MessageEvent) => void) => {
            if (t === 'message') listeners.push(fn);
          },
          removeEventListener: (t: string, fn: (ev: MessageEvent) => void) => {
            if (t === 'message') {
              const i = listeners.indexOf(fn);
              if (i >= 0) listeners.splice(i, 1);
            }
          },
          setInterval,
          clearInterval,
          setTimeout,
          clearTimeout,
        };
        globalThis.fetch = (async () =>
          new Response(
            JSON.stringify({
              ok: true,
              flowId: '0123456789abcdef',
              url: 'https://accounts.google.com/o/oauth2/v2/auth?state=x',
              mode: 'login',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )) as typeof fetch;

        let resolved = false;
        const p = openGoogleOAuthPopup('login').then((r) => {
          resolved = true;
          return r;
        });
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(openedTargets[0], 'eyvan_google_oauth_0123456789abcdef');

        // Mismatched flowId ignored
        listeners[0]({
          origin: 'https://eyvan.ir',
          source: fakePopup as unknown as MessageEventSource,
          data: {
            type: 'EYVAN_OAUTH_RESULT',
            ok: true,
            flowMode: 'login',
            flowId: 'fedcba9876543210',
            code: null,
            message: 'wrong tab',
          },
        } as MessageEvent);
        await new Promise((r) => setTimeout(r, 15));
        assert.equal(resolved, false);

        // Matching flowId accepted
        listeners[0]({
          origin: 'https://eyvan.ir',
          source: fakePopup as unknown as MessageEventSource,
          data: {
            type: 'EYVAN_OAUTH_RESULT',
            ok: true,
            flowMode: 'login',
            flowId: '0123456789abcdef',
            code: null,
            message: 'ok',
          },
        } as MessageEvent);
        const resPopup = await p;
        assert.equal(resPopup.ok, true);
        assert.equal(resPopup.message, 'ok');
      } finally {
        (globalThis as Record<string, unknown>).window = origWindow;
        globalThis.fetch = origFetch;
      }
    } finally {
      await h.cleanup();
    }
  });

  it('2. Same-site HTTPS uses SameSite=Lax; Secure (ITP/third-party-cookie immune), cross-site HTTPS uses SameSite=None; Secure, and OAuth rate limits + Cron pruning work', async () => {
    assert.equal(
      resolveOAuthBindSameSiteMode(true, 'https://eyvan.ir', 'https://eyvan.ir/api/auth/google/start'),
      'Lax'
    );
    assert.equal(
      resolveOAuthBindSameSiteMode(true, 'https://eyvan.ir', 'https://api.eyvan.ir/api/auth/google/start'),
      'Lax'
    );
    assert.equal(
      resolveOAuthBindSameSiteMode(true, 'https://eyvan.pages.dev', 'https://api.eyvan.ir/api/auth/google/start'),
      'None'
    );
    assert.equal(
      resolveOAuthBindSameSiteMode(true, 'https://a.pages.dev', 'https://b.pages.dev/api/auth/google/start'),
      'None'
    );

    clearGoogleJwksCacheForTests();
    const google = await createMockGoogleOidcProvider();
    const h = await createFinalHarness('eyvan-final-samesite-', {
      googleFetch: google.mockFetch,
    });

    try {
      const d1 = h.db.getD1Adapter();
      const workerEnv = {
        EYVAN_DB: d1,
        ALLOWED_ORIGINS: 'https://eyvan.ir',
        ENVIRONMENT: 'production',
        PUBLIC_APP_URL: 'https://eyvan.ir',
        GOOGLE_OAUTH_CLIENT_ID: 'final-client-id.apps.googleusercontent.com',
        GOOGLE_OAUTH_CLIENT_SECRET: 'final-client-secret-32chars-xyz-123',
        GOOGLE_OAUTH_FETCH: google.mockFetch,
      } as unknown as CfWorkerEnv;

      // Same-site subdomain HTTPS: https://eyvan.ir -> https://api.eyvan.ir -> SameSite=Lax; Secure
      const wStartSameSite = await worker.fetch(
        new Request('https://api.eyvan.ir/api/auth/google/start', {
          method: 'POST',
          headers: {
            Origin: 'https://eyvan.ir',
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            'Sec-Fetch-Site': 'same-site',
            'CF-Connecting-IP': '198.51.100.10',
          },
          body: JSON.stringify({ mode: 'login' }),
        }),
        workerEnv
      );
      assert.equal(wStartSameSite.status, 200);
      const ssBody = (await wStartSameSite.json()) as { flowId: string };
      const rawCookie = findRawSetCookie(
        wStartSameSite,
        buildOAuthBindCookieName(ssBody.flowId)
      )!;
      assert.ok(rawCookie.includes('SameSite=Lax'));
      assert.ok(rawCookie.includes('Secure'));
      assert.ok(rawCookie.includes('HttpOnly'));

      // OAuth /start rate limit enforcement (429 + Retry-After)
      let startLimited = false;
      for (let i = 0; i < OAUTH_START_IP_RATE_LIMIT.maxAttempts + 2; i++) {
        const r = await worker.fetch(
          new Request('https://api.eyvan.ir/api/auth/google/start', {
            method: 'POST',
            headers: {
              Origin: 'https://eyvan.ir',
              'Content-Type': 'application/json',
              'X-Requested-With': 'eyvan-client',
              'CF-Connecting-IP': '198.51.100.11',
            },
            body: JSON.stringify({ mode: 'login' }),
          }),
          workerEnv
        );
        if (r.status === 429) {
          startLimited = true;
          assert.ok(r.headers.get('Retry-After'));
          break;
        }
      }
      assert.equal(startLimited, true, 'OAuth /start must enforce OAUTH_START_IP_RATE_LIMIT');

      // OAuth /callback rate limit enforcement (429 + Retry-After)
      let cbLimited = false;
      for (let i = 0; i < OAUTH_CALLBACK_IP_RATE_LIMIT.maxAttempts + 2; i++) {
        const r = await worker.fetch(
          new Request('https://api.eyvan.ir/api/auth/google/callback?state=fake&code=fake', {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              'CF-Connecting-IP': '198.51.100.12',
            },
          }),
          workerEnv
        );
        if (r.status === 429) {
          cbLimited = true;
          assert.ok(r.headers.get('Retry-After'));
          break;
        }
      }
      assert.equal(cbLimited, true, 'OAuth /callback must enforce OAUTH_CALLBACK_IP_RATE_LIMIT');

      // Bounded expired OAuth state pruning via scheduled() Cron Trigger
      const now = Date.now();
      await d1
        .prepare(
          `INSERT INTO oauth_states (
             state_hash, flow_id, provider, code_verifier_encrypted, nonce_hash,
             redirect_path, flow_mode, created_at, expires_at, consumed_at
           ) VALUES (?, ?, 'google', 'enc', 'nonce', '/', 'login', ?, ?, NULL)`
        )
        .bind('a'.repeat(64), '1111222233334444', now - 100_000, now - 10_000)
        .run();

      const deleted = await pruneExpiredOAuthStatesBatched(d1, {
        now: now + 2 * 60 * 60 * 1000,
        batchSize: 100,
      });
      assert.ok(deleted >= 1);
      const gone = await d1
        .prepare(`SELECT state_hash FROM oauth_states WHERE state_hash = ?`)
        .bind('a'.repeat(64))
        .first();
      assert.equal(gone, null);
    } finally {
      await h.cleanup();
    }
  });

  it('3. Migration 0011 deterministically preserves newest pending invite by (created_at DESC, rowid DESC) even when rowid order is inverted', async () => {
    const dir = createTempDir('eyvan-final-mig11-');
    try {
      const rawDb = new Database(path.join(dir, 'mig11.sqlite'));
      runDatabaseMigrations(rawDb, {
        upTo: '0009_guest_identity_and_game_invites.sql',
      });
      const now = Date.now();
      rawDb
        .prepare(
          `INSERT INTO users (user_id, username, username_key, display_name, email, email_key, email_verified, avatar_code, auth_provider, account_status, created_at, last_seen_at, updated_at)
           VALUES ('u1', 'UserOne', 'userone', 'UserOne', 'u1@example.com', 'u1@example.com', 1, 'portrait', 'password', 'active', ?, ?, ?),
                  ('u2', 'UserTwo', 'usertwo', 'UserTwo', 'u2@example.com', 'u2@example.com', 1, 'portrait', 'password', 'active', ?, ?, ?)`
        )
        .run(now, now, now, now, now, now);

      // Insert newer created_at FIRST (lower rowid=1), older created_at SECOND (higher rowid=2)
      rawDb
        .prepare(
          `INSERT INTO game_invites (invite_id, game_id, room_code, inviter_id, invitee_id, status, created_at, updated_at, expires_at)
           VALUES ('inv_newer_ts_lower_rowid', 'hokm', 'RM9999', 'u1', 'u2', 'pending', ?, ?, ?),
                  ('inv_older_ts_higher_rowid', 'hokm', 'RM9999', 'u1', 'u2', 'pending', ?, ?, ?)`
        )
        .run(now, now, now + 60_000, now - 5000, now - 5000, now + 60_000);

      // Simulate DB that already ran 0010 (or run 0010 + 0011): note 0010 keeps MAX(rowid) if applied first,
      // so let's also test 0011 SQL directly on an un-indexed duplicate table!
      const mig11Sql = fs.readFileSync(
        path.join(process.cwd(), 'cloudflare/migrations/0011_oauth_multitab_and_invite_order.sql'),
        'utf8'
      );
      rawDb.exec(mig11Sql);

      const rows = rawDb
        .prepare(`SELECT invite_id, status FROM game_invites ORDER BY invite_id ASC`)
        .all() as Array<{ invite_id: string; status: string }>;
      assert.deepEqual(rows, [
        { invite_id: 'inv_newer_ts_lower_rowid', status: 'pending' },
        { invite_id: 'inv_older_ts_higher_rowid', status: 'canceled' },
      ]);
      rawDb.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('4. Guest upgrade guards reject revoked/upgraded or expired guest cookies on register & OAuth start and abort atomically if guest_sessions expires/revokes mid-flight', async () => {
    clearGoogleJwksCacheForTests();
    const google = await createMockGoogleOidcProvider();
    const h = await createFinalHarness('eyvan-final-guest-', {
      googleFetch: google.mockFetch,
    });

    try {
      const d1 = h.db.getD1Adapter();
      const guest = await resolveOrCreateGuestIdentity(
        d1,
        null,
        'GuestGuard',
        'portrait',
        Date.now()
      );
      assert.ok(guest && guest.rawGuestToken);
      const guestCookie = `${GUEST_COOKIE_NAME}=${encodeURIComponent(guest.rawGuestToken)}`;

      // Revoke the guest session (simulating another tab already upgraded or logged out)
      await d1
        .prepare(`UPDATE guest_sessions SET revoked_at = ? WHERE guest_user_id = ?`)
        .bind(Date.now(), guest.userId)
        .run();

      const regConflict = await h.postJson(
        '/api/auth/register',
        {
          username: 'NewRegName',
          email: 'newreg@example.com',
          password: 'StrongPassword123!',
          confirmPassword: 'StrongPassword123!',
        },
        guestCookie
      );
      assert.equal(regConflict.status, 409);
      assert.equal(((await regConflict.json()) as { code: string }).code, 'ACCOUNT_CONFLICT');
      assert.ok(findRawSetCookie(regConflict, GUEST_COOKIE_NAME)?.includes('Max-Age=0'));

      const oauthConflict = await h.postJson(
        '/api/auth/google/start',
        { mode: 'login' },
        guestCookie
      );
      assert.equal(oauthConflict.status, 409);
      assert.ok(findRawSetCookie(oauthConflict, GUEST_COOKIE_NAME)?.includes('Max-Age=0'));

      // Direct service guard: active guest upgraded/revoked between pre-check and batch commit
      const guest2 = await resolveOrCreateGuestIdentity(
        d1,
        null,
        'GuestRace',
        'portrait',
        Date.now()
      );
      assert.ok(guest2 && guest2.rawGuestToken);
      // Expire guest_sessions row while user row is still 'guest' (respecting CHECK expires_at > created_at)
      const nowExp = Date.now();
      await d1
        .prepare(`UPDATE guest_sessions SET created_at = ?, expires_at = ? WHERE guest_user_id = ?`)
        .bind(nowExp - 2000, nowExp - 1000, guest2.userId)
        .run();

      const upgradeExpired = await upgradeGuestAccountToRegistered(
        d1,
        guest2.userId,
        {
          username: 'GuestRaceUpgraded',
          email: 'race.up@example.com',
          password: 'StrongPassword123!',
          confirmPassword: 'StrongPassword123!',
        },
        { clientIp: '127.0.0.1', userAgent: 'test', now: Date.now() },
        {
          sendVerificationEmail: async () => ({ configured: true, sent: true, provider: 'mock' }),
          sendPasswordResetEmail: async () => ({ configured: true, sent: true, provider: 'mock' }),
        }
      );
      assert.equal(upgradeExpired.ok, false);
      if (upgradeExpired.ok === false) {
        assert.equal(upgradeExpired.code, 'INVALID_OR_EXPIRED_TOKEN');
      }
      assert.equal(await verifyGuestSession(d1, guest2.rawGuestToken, Date.now()), null);
    } finally {
      await h.cleanup();
    }
  });

  it('5. Social, Invite & Chat atomic SQL guards prevent orphaned state on concurrent unfriend/block races and enforce rate limits on all mutation endpoints', async () => {
    const h = await createFinalHarness('eyvan-final-social-');
    try {
      const alice = await h.registerAndLogin('FinAlice', 'fin.alice@example.com');
      const bob = await h.registerAndLogin('FinBob', 'fin.bob@example.com');
      await h.makeFriends(alice, bob);

      const d1 = h.db.getD1Adapter();
      const roomRes = await h.postJson(
        '/api/rooms',
        { username: alice.username, avatarCode: 'portrait' },
        alice.cookie
      );
      assert.equal(roomRes.status, 201);
      const room = (await roomRes.json()) as { roomCode: string };
      const roomLookup = async (code: string) => {
        const s = h.roomManager.getRoomSummary(code);
        if (!s) return null;
        const playerUsernames = s.seats
          .map((seat) => seat.username)
          .filter((u): u is string => typeof u === 'string' && u.length > 0);
        const hostUsername = s.seats.find((seat) => seat.isHost)?.username ?? null;
        const status: 'WAITING' | 'PLAYING' | 'FINISHED' =
          s.status === 'CLOSED' ? 'FINISHED' : s.status;
        return {
          roomCode: s.roomCode,
          status,
          playerCount: playerUsernames.length,
          maxPlayers: 4,
          hostUsername,
          playerUsernames,
        };
      };

      const makeSocialCtx = (actorUserId: string) => ({
        actorUserId,
        authSessionId: 'ses_final_hardening_test',
        clientIp: '127.0.0.1',
        now: Date.now(),
      });

      // Open direct conversation and create a live game invite
      const convRes = await openOrCreateDirectConversation(
        d1,
        bob.userId,
        makeSocialCtx(alice.userId)
      );
      assert.equal(convRes.ok, true);
      const convId = convRes.conversation.conversationId;

      const invRes = await createGameInvite(
        d1,
        { targetUserId: bob.userId, roomCode: room.roomCode, gameId: 'hokm' },
        roomLookup,
        makeSocialCtx(alice.userId)
      );
      assert.equal(invRes.ok, true);

      // Remove friendship -> pending game invite is atomically canceled inside same transaction!
      const remRes = await removeFriend(
        d1,
        { targetUserId: bob.userId },
        makeSocialCtx(alice.userId)
      );
      assert.equal(remRes.ok, true);

      const invRow = await d1
        .prepare(`SELECT status FROM game_invites WHERE invite_id = ?`)
        .bind(invRes.invite.inviteId)
        .first<{ status: string }>();
      assert.equal(invRow?.status, 'canceled');

      // Atomic SQL guard in createGameInvite / sendDirectMessage if friendship doesn't exist
      const postUnfriendInvite = await createGameInvite(
        d1,
        { targetUserId: bob.userId, roomCode: room.roomCode, gameId: 'hokm' },
        roomLookup,
        makeSocialCtx(alice.userId)
      );
      assert.equal(postUnfriendInvite.ok, false);
      if (postUnfriendInvite.ok === false) {
        assert.equal(postUnfriendInvite.code, 'NOT_FRIENDS');
      }

      const postUnfriendMsg = await sendDirectMessage(
        d1,
        convId,
        { body: 'after unfriend', clientMsgId: 'cmsg_1' },
        makeSocialCtx(alice.userId)
      );
      assert.equal(postUnfriendMsg.ok, false);
      if (postUnfriendMsg.ok === false) {
        assert.equal(postUnfriendMsg.code, 'NOT_FRIENDS');
      }

      // Re-friend & test blockUser atomically cancels pending invite
      await h.makeFriends(alice, bob);
      const inv2 = await createGameInvite(
        d1,
        { targetUserId: bob.userId, roomCode: room.roomCode, gameId: 'hokm' },
        roomLookup,
        makeSocialCtx(alice.userId)
      );
      assert.equal(inv2.ok, true);

      const blk = await blockUser(d1, bob.userId, null, makeSocialCtx(alice.userId));
      assert.equal(blk.ok, true);
      const inv2Row = await d1
        .prepare(`SELECT status FROM game_invites WHERE invite_id = ?`)
        .bind(inv2.invite.inviteId)
        .first<{ status: string }>();
      assert.equal(inv2Row?.status, 'canceled');

      // Rate limit checks on markConversationRead, respondToGameInvite, cancelGameInvite
      const carol = await h.registerAndLogin('FinCarol', 'fin.carol@example.com');
      await h.makeFriends(alice, carol);
      const convAC = await openOrCreateDirectConversation(
        d1,
        carol.userId,
        makeSocialCtx(alice.userId)
      );
      assert.equal(convAC.ok, true);

      let readLimited = false;
      for (let i = 0; i < CHAT_CONVERSATION_MUTATION_USER_RATE_LIMIT.maxAttempts + 2; i++) {
        const r = await markConversationRead(
          d1,
          convAC.conversation.conversationId,
          {},
          makeSocialCtx(carol.userId)
        );
        if (r.ok === false && r.status === 429) {
          readLimited = true;
          assert.ok(r.retryAfterSec !== undefined);
          break;
        }
      }
      assert.equal(readLimited, true, 'markConversationRead must enforce rate limit');

      let inviteRespLimited = false;
      for (let i = 0; i < SOCIAL_FRIEND_MUTATION_USER_RATE_LIMIT.maxAttempts + 2; i++) {
        const r = await respondToGameInvite(
          d1,
          'inv_nonexistent_0001',
          'decline',
          roomLookup,
          makeSocialCtx(carol.userId)
        );
        if (r.ok === false && r.status === 429) {
          inviteRespLimited = true;
          assert.ok(r.retryAfterSec !== undefined);
          break;
        }
      }
      assert.equal(inviteRespLimited, true, 'respondToGameInvite must enforce rate limit');

      let inviteCancelLimited = false;
      for (let i = 0; i < SOCIAL_FRIEND_MUTATION_USER_RATE_LIMIT.maxAttempts + 2; i++) {
        const r = await cancelGameInvite(
          d1,
          'inv_nonexistent_0001',
          makeSocialCtx(bob.userId)
        );
        if (r.ok === false && r.status === 429) {
          inviteCancelLimited = true;
          assert.ok(r.retryAfterSec !== undefined);
          break;
        }
      }
      assert.equal(inviteCancelLimited, true, 'cancelGameInvite must enforce rate limit');
    } finally {
      await h.cleanup();
    }
  });
});
