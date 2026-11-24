/**
 * Backend Security & Concurrency Hardening Verification Suite (مرحله Hardening).
 *
 * Covers every real vulnerability and race condition addressed across Parts 1–4
 * on BOTH Express/SQLite and Cloudflare Worker entrypoints:
 * - Part 1: Google OAuth browser-binding cookie, cross-browser Login-CSRF rejection,
 *   exact postMessage targetOrigin (never '*'), popup message listener validation,
 *   replay/expired/wrong-user-link/cancel cookie clearing.
 * - Part 2: Migration 0010 partial UNIQUE index & legacy duplicate reconciliation,
 *   5x concurrent pending invites (Promise.all), expired invite re-send, multi-room &
 *   multi-friend invites, Worker parity, rate-limit preservation.
 * - Part 3: Guest account upgrade atomicity (manual + Google), preserved user_id & stats,
 *   concurrent manual+manual and manual+Google upgrade races, simulated mid-batch DB
 *   rollback proof, post-upgrade guest token revocation, IP rate-limit parity.
 * - Part 4: Chat & Social security audit regressions — conversation IDOR, cross-conversation
 *   lastReadMessageId, blocked markConversationRead, ex-friend presence privacy & invite
 *   rejection, concurrent clientMsgId idempotency, chat rate-limit, oversized payload bounds,
 *   Sec-Fetch-Site CSRF parity, and zero PII leaks.
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
  OAUTH_BIND_COOKIE_NAME,
  buildOAuthBindCookieName,
  clearGoogleJwksCacheForTests,
  completeGoogleOAuthCallback,
  startGoogleOAuthFlow,
} from '../cloudflare/src/lib/auth/googleOAuthService';
import {
  GUEST_COOKIE_NAME,
  verifyGuestSession,
} from '../cloudflare/src/lib/auth/guestSession';
import { createGameInvite } from '../cloudflare/src/lib/social/inviteService';
import { CfWorkerEnv } from '../cloudflare/src/lib/types';
import { CompletedMatchRecord } from '../src/games/hokm/online/protocol';
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
  const kid = 'eyvan-hardening-kid-1';

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
    name?: string;
    picture?: string;
  }

  let nextProfile: NextGoogleUser = {
    sub: 'hardening_google_sub_1',
    email: 'hardening.google@example.com',
    name: 'Hardening Player',
  };
  let lastExpectedChallenge: string | null = null;
  let lastNonce: string | null = null;
  const tokenExchangeCalls: Array<{ code: string; codeVerifier: string }> = [];

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
    };
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
      const code = params.get('code') ?? '';
      const codeVerifier = params.get('code_verifier') ?? '';
      const clientId = params.get('client_id') ?? '';
      tokenExchangeCalls.push({ code, codeVerifier });

      if (lastExpectedChallenge) {
        const computed = toBase64Url(
          crypto.createHash('sha256').update(codeVerifier).digest()
        );
        if (computed !== lastExpectedChallenge) {
          return new Response(JSON.stringify({ error: 'invalid_grant' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const idToken = await signIdToken({
        iss: 'https://accounts.google.com',
        aud: clientId,
        sub: nextProfile.sub,
        email: nextProfile.email,
        email_verified: true,
        name: nextProfile.name ?? 'Hardening Player',
        picture: nextProfile.picture ?? 'https://lh3.googleusercontent.com/hardening',
        nonce: lastNonce ?? '',
        iat: nowSec - 5,
        exp: nowSec + 3600,
      });

      return new Response(
        JSON.stringify({
          access_token: 'ya29.hardening_token',
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: idToken,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    throw new Error(`Unexpected external fetch URL: ${url}`);
  };

  return { mockFetch, setNextUser, captureFromAuthUrl, tokenExchangeCalls };
}

async function createHardeningHarness(
  prefix: string,
  options?: { googleFetch?: typeof fetch }
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

  const { app } = createEyvanExpressApp({
    db,
    roomManager,
    config: {
      isProduction: false,
      googleOAuthClientId: 'hardening-client-id.apps.googleusercontent.com',
      googleOAuthClientSecret: 'hardening-client-secret-32chars-abc',
      googleOAuthFetch: options?.googleFetch,
    },
    emailSender: mockEmailSender,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const postJson = (
    p: string,
    body: Record<string, unknown>,
    cookie?: string,
    extraHeaders?: Record<string, string>
  ) =>
    fetch(`${baseUrl}${p}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'eyvan-client',
        Origin: baseUrl,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(extraHeaders ?? {}),
      },
      body: JSON.stringify(body),
    });

  const getJson = (p: string, cookie?: string) =>
    fetch(`${baseUrl}${p}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });

  const registerAndLogin = async (
    username: string,
    email: string,
    password = 'EyvanStrong#2026',
    extraCookie?: string
  ) => {
    const regRes = await postJson(
      '/api/auth/register',
      { email, username, password, confirmPassword: password },
      extraCookie
    );
    assert.equal(regRes.status, 201, `register ${username} must succeed`);
    const regJson = (await regRes.json()) as {
      user: { userId: string; username: string };
    };
    const token = verifyTokens.pop();
    assert.ok(token);
    const verifyRes = await postJson('/api/auth/verify-email', { token });
    assert.equal(verifyRes.status, 200);
    const loginRes = await postJson('/api/auth/login', {
      identifier: email,
      password,
    });
    assert.equal(loginRes.status, 200);
    const cookie = extractCookiePair(loginRes, AUTH_COOKIE_NAME);
    assert.ok(cookie);
    return {
      userId: regJson.user.userId,
      username: regJson.user.username,
      email,
      password,
      cookie,
    };
  };

  const makeFriends = async (
    a: { userId: string; cookie: string },
    b: { userId: string; cookie: string }
  ) => {
    const reqRes = await postJson(
      '/api/social/friends/request',
      { targetUserId: b.userId },
      a.cookie
    );
    assert.equal(reqRes.status, 201);
    const reqJson = (await reqRes.json()) as { friendshipId: string };
    const accRes = await postJson(
      '/api/social/friends/accept',
      { friendshipId: reqJson.friendshipId },
      b.cookie
    );
    assert.equal(accRes.status, 200);
  };

  return {
    db,
    dbPath,
    roomManager,
    baseUrl,
    postJson,
    getJson,
    registerAndLogin,
    makeFriends,
    cleanup: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

describe('Eyvan Hardening — Parts 1–4 Security & Concurrency Verification', () => {
  it('Part 1 (OAuth): Browser-binding cookie blocks cross-browser Login-CSRF before token exchange, clears on all exit paths, and enforces exact postMessage targetOrigin on Express & Worker', async () => {
    clearGoogleJwksCacheForTests();
    const google = await createMockGoogleOidcProvider();
    const h = await createHardeningHarness('eyvan-hard-oauth-', {
      googleFetch: google.mockFetch,
    });

    try {
      // 1) Browser A initiates OAuth login -> receives HttpOnly per-flow eyvan_oauth_bind_<flowId> cookie scoped to /api/auth/google
      const startA = await h.postJson('/api/auth/google/start', { mode: 'login' });
      assert.equal(startA.status, 200);
      const startAJson = (await startA.json()) as { flowId: string; url: string };
      assert.ok(startAJson.flowId, 'Must return per-flow flowId');
      const bindNameA = buildOAuthBindCookieName(startAJson.flowId);
      const rawBindSetA = findRawSetCookie(startA, bindNameA);
      assert.ok(rawBindSetA, 'Must emit Set-Cookie for per-flow eyvan_oauth_bind_<flowId>');
      assert.ok(rawBindSetA.includes('HttpOnly'));
      assert.ok(rawBindSetA.includes('Path=/api/auth/google'));
      assert.ok(rawBindSetA.includes('Max-Age=600'));
      assert.ok(rawBindSetA.includes('SameSite=Lax'));
      const bindCookieA = extractCookiePair(startA, bindNameA)!;

      const paramsA = google.captureFromAuthUrl(startAJson.url);

      // Verify DB stores ONLY SHA-256 hash (64 hex chars), never raw cookie value
      const d1 = h.db.getD1Adapter();
      const rawBindValA = decodeURIComponent(bindCookieA.split('=')[1]);
      const stateDbRow = await d1
        .prepare(
          `SELECT browser_binding_hash, opener_origin, flow_id FROM oauth_states ORDER BY created_at DESC LIMIT 1`
        )
        .first<{ browser_binding_hash: string; opener_origin: string; flow_id: string }>();
      assert.ok(stateDbRow);
      assert.equal(stateDbRow.flow_id, startAJson.flowId);
      assert.equal(stateDbRow.browser_binding_hash.length, 64);
      assert.notEqual(stateDbRow.browser_binding_hash, rawBindValA);
      assert.equal(stateDbRow.opener_origin, h.baseUrl);

      // 2) Attack: Browser B replays Browser A's callback URL WITHOUT bind cookie -> rejected BEFORE token exchange!
      const crossNoCookie = await fetch(
        `${h.baseUrl}/api/auth/google/callback?code=attack_code&state=${encodeURIComponent(paramsA.state)}`,
        { headers: { Accept: 'application/json' } }
      );
      assert.equal(crossNoCookie.status, 400);
      const crossNoCookieJson = (await crossNoCookie.json()) as { code: string };
      assert.equal(crossNoCookieJson.code, 'OAUTH_INVALID_STATE');
      assert.equal(
        google.tokenExchangeCalls.length,
        0,
        'Cross-browser callback without bind cookie must NEVER reach Google token endpoint'
      );

      // 3) Attack: Browser B starts its own OAuth (gets bindCookieB) and tries to complete Browser A's state
      const startB = await h.postJson('/api/auth/google/start', { mode: 'login' });
      assert.equal(startB.status, 200);
      const startBJson = (await startB.json()) as { flowId: string; url: string };
      const bindNameB = buildOAuthBindCookieName(startBJson.flowId);
      const bindCookieB = extractCookiePair(startB, bindNameB)!;
      assert.notEqual(bindCookieA, bindCookieB);

      const crossWrongCookie = await fetch(
        `${h.baseUrl}/api/auth/google/callback?code=attack_code_b&state=${encodeURIComponent(paramsA.state)}`,
        { headers: { Accept: 'text/html', Cookie: bindCookieB } }
      );
      assert.equal(crossWrongCookie.status, 400);
      assert.equal(
        google.tokenExchangeCalls.length,
        0,
        'Cross-browser callback with wrong bind cookie must NEVER reach Google token endpoint'
      );
      const failHtml = await crossWrongCookie.text();
      assert.equal(
        failHtml.includes("'*'"),
        false,
        'Error popup HTML must NEVER use wildcard targetOrigin'
      );
      // Mismatched callback must NOT clear Browser B's own valid per-flow cookie
      assert.equal(
        findRawSetCookie(crossWrongCookie, bindNameB),
        null,
        'Mismatched state callback must not clear unrelated flow cookies'
      );

      // 4) Legitimate Browser A completes callback with bindCookieA (proves attacker did not even DoS/consume A's state!)
      google.setNextUser({
        sub: 'google_sub_browser_a',
        email: 'browser.a@example.com',
        name: 'Browser A',
      });
      // Re-capture A's challenge/nonce since startB overwrote mock helper's convenience variables
      google.captureFromAuthUrl(startAJson.url);
      const okA = await fetch(
        `${h.baseUrl}/api/auth/google/callback?code=legit_code_a&state=${encodeURIComponent(paramsA.state)}`,
        { headers: { Accept: 'text/html', Cookie: bindCookieA } }
      );
      assert.equal(okA.status, 201);
      assert.equal(google.tokenExchangeCalls.length, 1);
      assert.ok(extractCookiePair(okA, AUTH_COOKIE_NAME));
      assert.ok(
        findRawSetCookie(okA, bindNameA)?.includes('Max-Age=0'),
        'Success callback must clear ONLY its own per-flow eyvan_oauth_bind_<flowId> cookie'
      );
      const okHtml = await okA.text();
      assert.ok(okHtml.includes('window.opener.postMessage(data, targetOrigin)'));
      assert.ok(okHtml.includes(`var targetOrigin = ${JSON.stringify(h.baseUrl)};`));
      assert.equal(okHtml.includes("'*'"), false);

      // 5) Replay with original bindCookieA must fail AND clear bind cookie
      const replayA = await fetch(
        `${h.baseUrl}/api/auth/google/callback?code=legit_code_a&state=${encodeURIComponent(paramsA.state)}`,
        { headers: { Accept: 'application/json', Cookie: bindCookieA } }
      );
      assert.equal(replayA.status, 400);
      assert.equal(google.tokenExchangeCalls.length, 1);
      assert.ok(findRawSetCookie(replayA, bindNameA)?.includes('Max-Age=0'));

      // 6) Expired OAuth state rejected & clears bind cookie
      const startExp = await h.postJson('/api/auth/google/start', { mode: 'login' });
      const startExpJson = (await startExp.json()) as { flowId: string; url: string };
      const bindNameExp = buildOAuthBindCookieName(startExpJson.flowId);
      const bindExp = extractCookiePair(startExp, bindNameExp)!;
      const paramsExp = google.captureFromAuthUrl(startExpJson.url);
      await d1
        .prepare(`UPDATE oauth_states SET created_at = ?, expires_at = ?`)
        .bind(Date.now() - 10_000, Date.now() - 1000)
        .run();
      const cbExp = await fetch(
        `${h.baseUrl}/api/auth/google/callback?code=exp_code&state=${encodeURIComponent(paramsExp.state)}`,
        { headers: { Accept: 'application/json', Cookie: bindExp } }
      );
      assert.equal(cbExp.status, 400);
      assert.equal(((await cbExp.json()) as { code: string }).code, 'OAUTH_INVALID_STATE');
      assert.ok(findRawSetCookie(cbExp, bindNameExp)?.includes('Max-Age=0'));

      // 7) Cancel flow (`?error=access_denied`) consumes state, emits exact targetOrigin, and clears bind cookie
      const startCancel = await h.postJson('/api/auth/google/start', { mode: 'login' });
      const startCancelJson = (await startCancel.json()) as { flowId: string; url: string };
      const bindNameCancel = buildOAuthBindCookieName(startCancelJson.flowId);
      const bindCancel = extractCookiePair(startCancel, bindNameCancel)!;
      const paramsCancel = google.captureFromAuthUrl(startCancelJson.url);
      const cbCancel = await fetch(
        `${h.baseUrl}/api/auth/google/callback?error=access_denied&state=${encodeURIComponent(paramsCancel.state)}`,
        { headers: { Accept: 'text/html', Cookie: bindCancel } }
      );
      assert.equal(cbCancel.status, 400);
      assert.ok(findRawSetCookie(cbCancel, bindNameCancel)?.includes('Max-Age=0'));
      const cancelHtml = await cbCancel.text();
      assert.ok(cancelHtml.includes(`var targetOrigin = ${JSON.stringify(h.baseUrl)};`));
      assert.equal(cancelHtml.includes("'*'"), false);

      // 8) Cloudflare Worker HTTPS parity: Secure; SameSite=None (cross-site) + exact SPA targetOrigin
      const workerEnv = {
        EYVAN_DB: d1,
        ALLOWED_ORIGINS: 'https://eyvan.pages.dev',
        ENVIRONMENT: 'production',
        PUBLIC_APP_URL: 'https://eyvan.pages.dev',
        GOOGLE_OAUTH_CLIENT_ID: 'hardening-client-id.apps.googleusercontent.com',
        GOOGLE_OAUTH_CLIENT_SECRET: 'hardening-client-secret-32chars-abc',
        GOOGLE_OAUTH_FETCH: google.mockFetch,
      } as unknown as CfWorkerEnv;

      const wStart = await worker.fetch(
        new Request('https://api.eyvan.ir/api/auth/google/start', {
          method: 'POST',
          headers: {
            Origin: 'https://eyvan.pages.dev',
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
            'CF-Connecting-IP': '198.51.100.88',
          },
          body: JSON.stringify({ mode: 'login' }),
        }),
        workerEnv
      );
      assert.equal(wStart.status, 200);
      const wStartJson = (await wStart.json()) as { flowId: string; url: string };
      const wBindName = buildOAuthBindCookieName(wStartJson.flowId);
      const wRawBind = findRawSetCookie(wStart, wBindName);
      assert.ok(wRawBind);
      assert.ok(wRawBind.includes('HttpOnly'));
      assert.ok(wRawBind.includes('Secure'));
      assert.ok(wRawBind.includes('SameSite=None'));
      assert.equal(
        wRawBind.includes('Partitioned'),
        false,
        'OAuth bind cookie must NOT be Partitioned so top-level Google redirect carries it reliably'
      );
      const wBindPair = extractCookiePair(wStart, wBindName)!;
      const wp = google.captureFromAuthUrl(wStartJson.url);

      // Worker cross-browser without bind cookie rejected
      const wCross = await worker.fetch(
        new Request(
          `https://api.eyvan.ir/api/auth/google/callback?code=w_bad&state=${encodeURIComponent(wp.state)}`,
          { method: 'GET', headers: { Accept: 'application/json', 'CF-Connecting-IP': '198.51.100.88' } }
        ),
        workerEnv
      );
      assert.equal(wCross.status, 400);

      // Worker legitimate callback in HTML mode emits exact https://eyvan.pages.dev targetOrigin & clears bind cookie
      google.setNextUser({
        sub: 'google_sub_worker_hardened',
        email: 'worker.hardened@example.com',
        name: 'Worker Hardened',
      });
      const wCbHtml = await worker.fetch(
        new Request(
          `https://api.eyvan.ir/api/auth/google/callback?code=w_ok&state=${encodeURIComponent(wp.state)}`,
          {
            method: 'GET',
            headers: {
              Accept: 'text/html',
              Cookie: wBindPair,
              'CF-Connecting-IP': '198.51.100.88',
            },
          }
        ),
        workerEnv
      );
      assert.equal(wCbHtml.status, 201);
      assert.ok(findRawSetCookie(wCbHtml, wBindName)?.includes('Max-Age=0'));
      const wHtml = await wCbHtml.text();
      assert.ok(wHtml.includes('var targetOrigin = "https://eyvan.pages.dev";'));
      assert.equal(wHtml.includes("'*'"), false);
    } finally {
      await h.cleanup();
    }
  });

  it('Part 1 (Client postMessage listener): openGoogleOAuthPopup rejects forged origin, forged event.source, mismatched flowMode, and malformed payloads', async () => {
    const listeners: Array<(event: MessageEvent) => void> = [];
    const fakePopup = {
      closed: false,
      close() {
        this.closed = true;
      },
    };
    const otherWindow = { closed: false };

    const origWindow = (globalThis as Record<string, unknown>).window;
    const origFetch = globalThis.fetch;

    try {
      (globalThis as Record<string, unknown>).window = {
        location: { origin: 'https://eyvan.pages.dev' },
        screenX: 0,
        screenY: 0,
        outerWidth: 1200,
        outerHeight: 800,
        open: () => fakePopup,
        addEventListener: (type: string, fn: (event: MessageEvent) => void) => {
          if (type === 'message') listeners.push(fn);
        },
        removeEventListener: (type: string, fn: (event: MessageEvent) => void) => {
          if (type === 'message') {
            const idx = listeners.indexOf(fn);
            if (idx >= 0) listeners.splice(idx, 1);
          }
        },
        setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
        clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
        setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
        clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
      };

      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            ok: true,
            url: 'https://accounts.google.com/o/oauth2/v2/auth?state=fake',
            mode: 'link',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )) as typeof fetch;

      let resolved = false;
      const promise = openGoogleOAuthPopup('link').then((res) => {
        resolved = true;
        return res;
      });

      // Wait a microtask so startGoogleOAuthFlowRequest resolves and listener registers
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(listeners.length, 1);
      const dispatch = (ev: Partial<MessageEvent>) =>
        listeners[0](ev as MessageEvent);

      // 1) Wrong origin -> ignored
      dispatch({
        origin: 'https://evil.example',
        source: fakePopup as unknown as MessageEventSource,
        data: { type: 'EYVAN_OAUTH_RESULT', ok: true, flowMode: 'link', code: null, message: 'evil' },
      });
      // 2) Right origin, WRONG event.source (e.g. another tab/iframe) -> ignored!
      dispatch({
        origin: 'https://eyvan.pages.dev',
        source: otherWindow as unknown as MessageEventSource,
        data: { type: 'EYVAN_OAUTH_RESULT', ok: true, flowMode: 'link', code: null, message: 'spoofed source' },
      });
      // 3) Right source + origin, WRONG flowMode ('login' instead of 'link') -> ignored!
      dispatch({
        origin: 'https://eyvan.pages.dev',
        source: fakePopup as unknown as MessageEventSource,
        data: { type: 'EYVAN_OAUTH_RESULT', ok: true, flowMode: 'login', code: null, message: 'wrong mode' },
      });
      // 4) Non-boolean `ok` -> ignored!
      dispatch({
        origin: 'https://eyvan.pages.dev',
        source: fakePopup as unknown as MessageEventSource,
        data: { type: 'EYVAN_OAUTH_RESULT', ok: 'yes', flowMode: 'link', code: null, message: 'bad ok' },
      });

      await new Promise((r) => setTimeout(r, 20));
      assert.equal(resolved, false, 'All spoofed/invalid postMessage events must be ignored');

      // 5) Exact popup source + allowed origin + exact flowMode + boolean ok -> accepted!
      dispatch({
        origin: 'https://eyvan.pages.dev',
        source: fakePopup as unknown as MessageEventSource,
        data: {
          type: 'EYVAN_OAUTH_RESULT',
          ok: true,
          flowMode: 'link',
          code: null,
          message: 'حساب گوگل متصل شد.',
        },
      });

      const finalResult = await promise;
      assert.equal(finalResult.ok, true);
      assert.equal(finalResult.flowMode, 'link');
      assert.equal(finalResult.message, 'حساب گوگل متصل شد.');
    } finally {
      (globalThis as Record<string, unknown>).window = origWindow;
      globalThis.fetch = origFetch;
    }
  });

  it('Part 2 (Invites): Migration 0010 reconciles legacy duplicates & enforces partial UNIQUE index; 5x concurrent invites never 500, expired re-invite works, multi-room & multi-friend work on Express & Worker', async () => {
    // 2A) Verify Migration 0010 reconciles pre-existing duplicate pending rows cleanly on an existing DB
    const legacyDir = createTempDir('eyvan-hard-mig10-');
    try {
      const legacyDbPath = path.join(legacyDir, 'legacy.sqlite');
      const rawDb = new Database(legacyDbPath);
      runDatabaseMigrations(rawDb, {
        upTo: '0009_guest_identity_and_game_invites.sql',
      });
      const now = Date.now();
      rawDb
        .prepare(
          `INSERT INTO users (user_id, username, username_key, display_name, email, email_key, email_verified, avatar_code, auth_provider, account_status, created_at, last_seen_at, updated_at)
           VALUES ('usr_leg_1', 'LegA', 'lega', 'LegA', 'lega@example.com', 'lega@example.com', 1, 'portrait', 'password', 'active', ?, ?, ?),
                  ('usr_leg_2', 'LegB', 'legb', 'LegB', 'legb@example.com', 'legb@example.com', 1, 'portrait', 'password', 'active', ?, ?, ?)`
        )
        .run(now, now, now, now, now, now);
      rawDb
        .prepare(
          `INSERT INTO game_invites (invite_id, game_id, room_code, inviter_id, invitee_id, status, created_at, updated_at, expires_at)
           VALUES ('inv_dup_old_1', 'hokm', 'ROOM01', 'usr_leg_1', 'usr_leg_2', 'pending', ?, ?, ?),
                  ('inv_dup_new_2', 'hokm', 'ROOM01', 'usr_leg_1', 'usr_leg_2', 'pending', ?, ?, ?)`
        )
        .run(now - 1000, now - 1000, now + 60_000, now, now, now + 60_000);

      // Run remaining migrations (0010 .. latest) via runDatabaseMigrations
      const migResult = runDatabaseMigrations(rawDb);
      assert.deepEqual(migResult.applied, [
        '0010_hardening_oauth_and_invites.sql',
        '0011_oauth_multitab_and_invite_order.sql',
        '0012_cron_pruning_indexes.sql',
        '0013_items_inventory_equip.sql',
        '0014_account_code_gifts_toman_groups.sql',
      ]);

      const rows = rawDb
        .prepare(`SELECT invite_id, status FROM game_invites ORDER BY invite_id ASC`)
        .all() as Array<{ invite_id: string; status: string }>;
      assert.deepEqual(rows, [
        { invite_id: 'inv_dup_new_2', status: 'pending' },
        { invite_id: 'inv_dup_old_1', status: 'canceled' },
      ]);
      // Confirm partial UNIQUE index actually blocks a second live pending insert
      assert.throws(() => {
        rawDb
          .prepare(
            `INSERT INTO game_invites (invite_id, game_id, room_code, inviter_id, invitee_id, status, created_at, updated_at, expires_at)
             VALUES ('inv_dup_third_3', 'hokm', 'ROOM01', 'usr_leg_1', 'usr_leg_2', 'pending', ?, ?, ?)`
          )
          .run(now + 100, now + 100, now + 60_000);
      }, /UNIQUE/i);
      rawDb.close();
    } finally {
      fs.rmSync(legacyDir, { recursive: true, force: true });
    }

    // 2B) Live Express + Worker concurrency & deduplication tests
    const h = await createHardeningHarness('eyvan-hard-invites-');
    try {
      const host = await h.registerAndLogin('InvHost', 'inv.host@example.com');
      const friend1 = await h.registerAndLogin('InvFriend1', 'inv.f1@example.com');
      const friend2 = await h.registerAndLogin('InvFriend2', 'inv.f2@example.com');
      await h.makeFriends(host, friend1);
      await h.makeFriends(host, friend2);

      // Create 2 real WAITING Hokm rooms owned by host
      const r1Res = await h.postJson(
        '/api/rooms',
        { username: host.username, avatarCode: 'portrait' },
        host.cookie
      );
      assert.equal(r1Res.status, 201);
      const room1 = ((await r1Res.json()) as { roomCode: string }).roomCode;

      const r2Res = await h.postJson(
        '/api/rooms',
        { username: host.username, avatarCode: 'portrait' },
        host.cookie
      );
      assert.equal(r2Res.status, 201);
      const room2 = ((await r2Res.json()) as { roomCode: string }).roomCode;

      // 5x concurrent invites for the exact same (room1, host, friend1) via Promise.all
      const burstResponses = await Promise.all(
        Array.from({ length: 5 }, () =>
          h.postJson(
            '/api/social/invites',
            { targetUserId: friend1.userId, roomCode: room1, gameId: 'hokm' },
            host.cookie
          )
        )
      );

      const statuses = burstResponses.map((r) => r.status);
      for (const s of statuses) {
        assert.ok(s === 200 || s === 201, `Concurrent invite must never return 500 (got ${s})`);
      }
      const payloads = (await Promise.all(
        burstResponses.map((r) => r.json())
      )) as Array<{ ok: boolean; deduplicated: boolean; invite: { inviteId: string } }>;
      const uniqueIds = new Set(payloads.map((p) => p.invite.inviteId));
      assert.equal(uniqueIds.size, 1, 'All 5 concurrent invites must resolve to ONE canonical inviteId');
      assert.equal(
        payloads.filter((p) => !p.deduplicated).length,
        1,
        'Exactly 1 request creates the row (deduplicated: false)'
      );
      assert.equal(
        payloads.filter((p) => p.deduplicated).length,
        4,
        'Remaining 4 requests must cleanly return deduplicated: true'
      );

      const d1 = h.db.getD1Adapter();
      const pendingCount = await d1
        .prepare(
          `SELECT COUNT(*) AS cnt FROM game_invites WHERE room_code = ? AND inviter_id = ? AND invitee_id = ? AND status = 'pending'`
        )
        .bind(room1, host.userId, friend1.userId)
        .first<{ cnt: number }>();
      assert.equal(pendingCount?.cnt, 1, 'DB must contain strictly 1 pending row');

      // Direct DB-level UNIQUE enforcement check (proves race protection is DB-atomic, not just JS check)
      await assert.rejects(
        () =>
          d1
            .prepare(
              `INSERT INTO game_invites (invite_id, game_id, room_code, inviter_id, invitee_id, status, created_at, updated_at, expires_at)
               VALUES ('inv_raw_dup_test', 'hokm', ?, ?, ?, 'pending', ?, ?, ?)`
            )
            .bind(room1, host.userId, friend1.userId, Date.now(), Date.now(), Date.now() + 60_000)
            .run(),
        /UNIQUE constraint failed/i
      );

      // Concurrent service-level race simulation where pre-check sees nothing -> UNIQUE error caught & deduplicated
      const baseLookup = async (code: string) => ({
        roomCode: code,
        status: 'WAITING' as const,
        playerCount: 1,
        maxPlayers: 4,
        hostUsername: host.username,
        playerUsernames: [host.username],
      });
      const r3Res = await h.postJson(
        '/api/rooms',
        { username: host.username, avatarCode: 'portrait' },
        host.cookie
      );
      const room3 = ((await r3Res.json()) as { roomCode: string }).roomCode;
      const raceResults = await Promise.all(
        Array.from({ length: 5 }, () =>
          createGameInvite(
            d1,
            { targetUserId: friend1.userId, roomCode: room3, gameId: 'hokm' },
            baseLookup,
            { actorUserId: host.userId, authSessionId: 'ses_race', clientIp: '127.0.0.1' }
          )
        )
      );
      assert.ok(raceResults.every((r) => r.ok === true));
      const raceIds = new Set(raceResults.map((r) => (r.ok ? r.invite.inviteId : '')));
      assert.equal(raceIds.size, 1);

      // Invite to 2nd room (same friend) & 2nd friend (same room1) BOTH succeed independently
      const [secondRoomRes, secondFriendRes] = await Promise.all([
        h.postJson(
          '/api/social/invites',
          { targetUserId: friend1.userId, roomCode: room2, gameId: 'hokm' },
          host.cookie
        ),
        h.postJson(
          '/api/social/invites',
          { targetUserId: friend2.userId, roomCode: room1, gameId: 'hokm' },
          host.cookie
        ),
      ]);
      assert.equal(secondRoomRes.status, 201);
      assert.equal(secondFriendRes.status, 201);

      // Expired pending invite -> sending again expires old row cleanly and creates new pending invite (201)
      const oldInviteId = [...uniqueIds][0];
      await d1
        .prepare(`UPDATE game_invites SET created_at = ?, expires_at = ? WHERE invite_id = ?`)
        .bind(Date.now() - 15_000, Date.now() - 5000, oldInviteId)
        .run();

      const freshAfterExpiry = await h.postJson(
        '/api/social/invites',
        { targetUserId: friend1.userId, roomCode: room1, gameId: 'hokm' },
        host.cookie
      );
      assert.equal(freshAfterExpiry.status, 201);
      const freshJson = (await freshAfterExpiry.json()) as {
        deduplicated: boolean;
        invite: { inviteId: string };
      };
      assert.equal(freshJson.deduplicated, false);
      assert.notEqual(freshJson.invite.inviteId, oldInviteId);

      const oldRowStatus = await d1
        .prepare(`SELECT status FROM game_invites WHERE invite_id = ?`)
        .bind(oldInviteId)
        .first<{ status: string }>();
      assert.equal(oldRowStatus?.status, 'expired');

      // Cloudflare Worker parity for concurrent invites (same room2, host -> friend2)
      const mockRoomDo = {
        idFromName: () => ({ toString: () => 'do_room' }),
        get: () => ({
          fetch: async () =>
            new Response(
              JSON.stringify({
                roomCode: room2,
                status: 'WAITING',
                playerCount: 1,
                maxPlayers: 4,
                seats: [{ seat: 'south', username: host.username, isHost: true }],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            ),
        }),
      };
      const workerEnv = {
        EYVAN_DB: d1,
        HOKM_ROOM: mockRoomDo,
        ALLOWED_ORIGINS: 'https://eyvan.pages.dev',
        ENVIRONMENT: 'production',
      } as unknown as CfWorkerEnv;

      const workerBurst = await Promise.all(
        Array.from({ length: 5 }, () =>
          worker.fetch(
            new Request('https://api.eyvan.ir/api/social/invites', {
              method: 'POST',
              headers: {
                Origin: 'https://eyvan.pages.dev',
                'Content-Type': 'application/json',
                'X-Requested-With': 'eyvan-client',
                Cookie: host.cookie,
                'CF-Connecting-IP': '198.51.100.22',
              },
              body: JSON.stringify({
                targetUserId: friend2.userId,
                roomCode: room2,
                gameId: 'hokm',
              }),
            }),
            workerEnv
          )
        )
      );
      for (const wr of workerBurst) {
        assert.ok(wr.status === 200 || wr.status === 201);
      }
      const wPayloads = (await Promise.all(
        workerBurst.map((r) => r.json())
      )) as Array<{ ok: boolean; invite: { inviteId: string } }>;
      assert.equal(new Set(wPayloads.map((p) => p.invite.inviteId)).size, 1);
    } finally {
      await h.cleanup();
    }
  });

  it('Part 3 (Guest Upgrade Atomicity): Concurrent manual+manual and manual+Google races produce 1 canonical identity, mid-batch failure rolls back 100%, old guest token is rejected, and IP rate limit holds', async () => {
    clearGoogleJwksCacheForTests();
    const google = await createMockGoogleOidcProvider();
    const h = await createHardeningHarness('eyvan-hard-guest-race-', {
      googleFetch: google.mockFetch,
    });

    try {
      const d1 = h.db.getD1Adapter();

      // Helper to spawn a fresh guest with a recorded Hokm match
      const spawnGuestWithMatch = async (matchId: string, name: string) => {
        const res = await h.postJson('/api/rooms', {
          username: name,
          avatarCode: 'turquoise',
        });
        assert.equal(res.status, 201);
        const guestCookie = extractCookiePair(res, GUEST_COOKIE_NAME)!;
        assert.ok(guestCookie);
        const rawGuestToken = decodeURIComponent(guestCookie.split('=')[1]);
        const verified = await verifyGuestSession(d1, rawGuestToken);
        assert.ok(verified);

        const match: CompletedMatchRecord = {
          matchId,
          roomCode: 'GUP001',
          startedAt: Date.now() - 4000,
          finishedAt: Date.now(),
          winningTeam: 'myTeam',
          teamAScore: 3,
          teamBScore: 0,
          targetScore: 3,
          lastWinType: 'hakem_kot',
          handsPlayed: 3,
          players: [
            {
              playerId: 'p1',
              userId: verified.guestUserId,
              username: name,
              canonicalSeat: 'south',
              team: 'myTeam',
              won: true,
            },
            { playerId: 'p2', username: 'BotN', canonicalSeat: 'north', team: 'myTeam', won: true },
            { playerId: 'p3', username: 'BotE', canonicalSeat: 'east', team: 'opponentTeam', won: false },
            { playerId: 'p4', username: 'BotW', canonicalSeat: 'west', team: 'opponentTeam', won: false },
          ],
        };
        h.db.recordCompletedMatch(match);
        return { guestUserId: verified.guestUserId, guestCookie, rawGuestToken };
      };

      // 3A) Concurrent Manual + Manual upgrade race on the SAME guest account
      const g1 = await spawnGuestWithMatch('m_race_manual_1', 'RaceManualGuest');
      const [m1, m2] = await Promise.all([
        upgradeGuestAccountToRegistered(
          d1,
          g1.guestUserId,
          {
            email: 'race.manual.1@example.com',
            username: 'RaceManOne',
            password: 'EyvanStrong#2026',
            confirmPassword: 'EyvanStrong#2026',
          },
          { clientIp: '10.0.0.1', userAgent: 'test-1' }
        ),
        upgradeGuestAccountToRegistered(
          d1,
          g1.guestUserId,
          {
            email: 'race.manual.2@example.com',
            username: 'RaceManTwo',
            password: 'EyvanStrong#2026',
            confirmPassword: 'EyvanStrong#2026',
          },
          { clientIp: '10.0.0.2', userAgent: 'test-2' }
        ),
      ]);
      const manualWinners = [m1, m2].filter((r) => r.ok);
      const manualLosers = [m1, m2].filter((r) => !r.ok);
      assert.equal(manualWinners.length, 1, 'Exactly 1 concurrent manual upgrade must succeed');
      assert.equal(manualLosers.length, 1, 'Second concurrent manual upgrade must fail cleanly');
      if (manualLosers[0].ok === false) {
        assert.equal(manualLosers[0].status, 409);
        assert.equal(manualLosers[0].code, 'ACCOUNT_CONFLICT');
      }

      const g1Identities = await d1
        .prepare(`SELECT provider FROM auth_identities WHERE user_id = ?`)
        .bind(g1.guestUserId)
        .all<{ provider: string }>();
      assert.deepEqual(
        g1Identities.results.map((r) => r.provider),
        ['password']
      );
      // Old guest token MUST be rejected after upgrade
      assert.equal(await verifyGuestSession(d1, g1.rawGuestToken), null);

      // 3B) Concurrent Manual + Google OAuth cross-path upgrade race on the SAME guest account
      const g2 = await spawnGuestWithMatch('m_race_cross_1', 'RaceCrossGuest');
      const gConfig = {
        clientId: 'hardening-client-id.apps.googleusercontent.com',
        clientSecret: 'hardening-client-secret-32chars-abc',
        fetchImpl: google.mockFetch,
      };
      const startedG2 = await startGoogleOAuthFlow(d1, gConfig, {
        mode: 'login',
        redirectUri: `${h.baseUrl}/api/auth/google/callback`,
        openerOrigin: h.baseUrl,
        guestUserId: g2.guestUserId,
      });
      assert.equal(startedG2.ok, true);
      const g2Params = google.captureFromAuthUrl(startedG2.url);
      google.setNextUser({
        sub: 'google_sub_cross_race_1',
        email: 'cross.google@example.com',
        name: 'Cross Google',
      });

      const usersBeforeCross = await d1
        .prepare(`SELECT COUNT(*) AS cnt FROM users`)
        .first<{ cnt: number }>();

      const [crossManual, crossGoogle] = await Promise.all([
        upgradeGuestAccountToRegistered(
          d1,
          g2.guestUserId,
          {
            email: 'cross.manual@example.com',
            username: 'CrossManUser',
            password: 'EyvanStrong#2026',
            confirmPassword: 'EyvanStrong#2026',
          },
          { clientIp: '10.0.0.3', userAgent: 'test-3' }
        ),
        completeGoogleOAuthCallback(d1, gConfig, {
          code: 'cross_code',
          state: g2Params.state,
          error: null,
          rawBrowserBinding: startedG2.rawBrowserBinding,
          currentAuthenticatedUserId: null,
          clientIp: '10.0.0.4',
          userAgent: 'test-4',
        }),
      ]);

      const crossWinners = [crossManual, crossGoogle].filter((r) => r.ok);
      const crossLosers = [crossManual, crossGoogle].filter((r) => !r.ok);
      assert.equal(crossWinners.length, 1, 'Exactly ONE of manual/Google upgrade must win');
      assert.equal(crossLosers.length, 1, 'Losing cross-path upgrade must return 409 conflict');
      if (crossLosers[0].ok === false) {
        assert.equal(crossLosers[0].status, 409);
        assert.equal(crossLosers[0].code, 'ACCOUNT_CONFLICT');
      }

      // CRITICAL: zero duplicate user account created & zero dual-provider corruption!
      const usersAfterCross = await d1
        .prepare(`SELECT COUNT(*) AS cnt FROM users`)
        .first<{ cnt: number }>();
      assert.equal(
        usersAfterCross?.cnt,
        usersBeforeCross?.cnt,
        'Concurrent cross-path upgrade MUST NEVER create a duplicate user row'
      );

      const g2UserRow = await d1
        .prepare(`SELECT auth_provider, account_status FROM users WHERE user_id = ?`)
        .bind(g2.guestUserId)
        .first<{ auth_provider: string; account_status: string }>();
      const g2Ids = await d1
        .prepare(`SELECT provider FROM auth_identities WHERE user_id = ?`)
        .bind(g2.guestUserId)
        .all<{ provider: string }>();
      assert.equal(g2Ids.results.length, 1, 'Must have strictly ONE auth_identity');
      assert.equal(
        g2Ids.results[0].provider,
        g2UserRow?.auth_provider,
        'auth_identities.provider must strictly match users.auth_provider'
      );
      assert.equal(await verifyGuestSession(d1, g2.rawGuestToken), null);

      // Verify match stats remained intact on g2.guestUserId
      const g2Stats = await d1
        .prepare(`SELECT matches_played, wins, hakem_kot_wins FROM user_game_stats WHERE user_id = ?`)
        .bind(g2.guestUserId)
        .first<{ matches_played: number; wins: number; hakem_kot_wins: number }>();
      assert.equal(g2Stats?.matches_played, 1);
      assert.equal(g2Stats?.wins, 1);
      assert.equal(g2Stats?.hakem_kot_wins, 1);

      // 3C) Simulated mid-batch DB failure rollback proof (BOTH manual & Google guest upgrade)
      // Install a temporary SQLite trigger on `guest_sessions` UPDATE (statement #4 of the 4-statement batch)
      // that aborts mid-transaction -> verify statements #1, #2, #3 roll back completely!
      const g3 = await spawnGuestWithMatch('m_rollback_1', 'RollbackGuest');
      await d1
        .prepare(
          `CREATE TEMP TRIGGER trg_fail_guest_revoke
           BEFORE UPDATE ON guest_sessions
           BEGIN
             SELECT RAISE(ABORT, 'SIMULATED_MID_BATCH_FAILURE');
           END`
        )
        .run();

      try {
        // Manual upgrade aborts on statement #4 -> full rollback
        await assert.rejects(
          () =>
            upgradeGuestAccountToRegistered(
              d1,
              g3.guestUserId,
              {
                email: 'rollback.manual@example.com',
                username: 'RollbackMan',
                password: 'EyvanStrong#2026',
                confirmPassword: 'EyvanStrong#2026',
              },
              { clientIp: '10.0.0.5', userAgent: 'test-5' }
            ),
          /SIMULATED_MID_BATCH_FAILURE/
        );

        // Verify 100% rollback: still guest/guest, email NULL, 0 auth_identities, 0 verification tokens, guest session STILL valid
        const g3AfterManualFail = await d1
          .prepare(`SELECT account_status, auth_provider, email FROM users WHERE user_id = ?`)
          .bind(g3.guestUserId)
          .first<{ account_status: string; auth_provider: string; email: string | null }>();
        assert.equal(g3AfterManualFail?.account_status, 'guest');
        assert.equal(g3AfterManualFail?.auth_provider, 'guest');
        assert.equal(g3AfterManualFail?.email, null);

        const g3IdCnt = await d1
          .prepare(`SELECT COUNT(*) AS cnt FROM auth_identities WHERE user_id = ?`)
          .bind(g3.guestUserId)
          .first<{ cnt: number }>();
        assert.equal(g3IdCnt?.cnt, 0);
        const g3TokCnt = await d1
          .prepare(`SELECT COUNT(*) AS cnt FROM email_verification_tokens WHERE user_id = ?`)
          .bind(g3.guestUserId)
          .first<{ cnt: number }>();
        assert.equal(g3TokCnt?.cnt, 0);
        assert.ok(
          await verifyGuestSession(d1, g3.rawGuestToken),
          'Guest session must remain intact after rolled-back upgrade'
        );

        // Google upgrade aborts on statement #4 -> full rollback
        const startedG3 = await startGoogleOAuthFlow(d1, gConfig, {
          mode: 'login',
          redirectUri: `${h.baseUrl}/api/auth/google/callback`,
          openerOrigin: h.baseUrl,
          guestUserId: g3.guestUserId,
        });
        assert.equal(startedG3.ok, true);
        const p3 = google.captureFromAuthUrl(startedG3.url);
        google.setNextUser({
          sub: 'google_sub_rollback_g3',
          email: 'rollback.google@example.com',
        });

        await assert.rejects(
          () =>
            completeGoogleOAuthCallback(d1, gConfig, {
              code: 'rollback_code',
              state: p3.state,
              error: null,
              rawBrowserBinding: startedG3.rawBrowserBinding,
              currentAuthenticatedUserId: null,
              clientIp: '10.0.0.6',
              userAgent: 'test-6',
            }),
          /SIMULATED_MID_BATCH_FAILURE/
        );

        const g3AfterGoogleFail = await d1
          .prepare(`SELECT account_status, auth_provider, email FROM users WHERE user_id = ?`)
          .bind(g3.guestUserId)
          .first<{ account_status: string; auth_provider: string; email: string | null }>();
        assert.equal(g3AfterGoogleFail?.account_status, 'guest');
        assert.equal(g3AfterGoogleFail?.auth_provider, 'guest');
        assert.equal(g3AfterGoogleFail?.email, null);
        const g3AuthSessCnt = await d1
          .prepare(`SELECT COUNT(*) AS cnt FROM auth_sessions WHERE user_id = ?`)
          .bind(g3.guestUserId)
          .first<{ cnt: number }>();
        assert.equal(g3AuthSessCnt?.cnt, 0);
        assert.ok(await verifyGuestSession(d1, g3.rawGuestToken));
      } finally {
        await d1.prepare(`DROP TRIGGER IF EXISTS temp.trg_fail_guest_revoke`).run();
      }

      // 3D) Guest upgrade enforces IP registration rate limit (10 attempts / 15 min)
      const gRate = await spawnGuestWithMatch('m_rate_1', 'RateGuest');
      let rateLimitedHit = false;
      for (let i = 0; i < 12; i++) {
        const res = await upgradeGuestAccountToRegistered(
          d1,
          gRate.guestUserId,
          { email: 'bad-email', username: 'x', password: '123', confirmPassword: '123' },
          { clientIp: '198.51.100.250', userAgent: 'rate-agent' }
        );
        if (!res.ok && res.status === 429 && res.code === 'RATE_LIMITED') {
          rateLimitedHit = true;
          break;
        }
      }
      assert.equal(rateLimitedHit, true, 'Guest upgrade must enforce REGISTER_IP_RATE_LIMIT');
    } finally {
      await h.cleanup();
    }
  });

  it('Part 4 (Chat & Social Security): Conversation IDOR, cross-conversation read IDs, blocked markRead, ex-friend presence & invite rejection, concurrent clientMsgId, rate-limit, size caps, CSRF & zero PII leaks', async () => {
    const h = await createHardeningHarness('eyvan-hard-social-');
    try {
      const alice = await h.registerAndLogin('AliceSec', 'alice.sec@example.com');
      const bob = await h.registerAndLogin('BobSec', 'bob.sec@example.com');
      const charlie = await h.registerAndLogin('CharlieSec', 'charlie.sec@example.com');

      await h.makeFriends(alice, bob);
      await h.makeFriends(alice, charlie);

      // Open direct conversations AB and AC
      const openAB = await h.postJson(
        '/api/social/chat/conversations/direct',
        { targetUserId: bob.userId },
        alice.cookie
      );
      assert.equal(openAB.status, 200);
      const convAB = ((await openAB.json()) as { conversation: { conversationId: string } })
        .conversation.conversationId;

      const openAC = await h.postJson(
        '/api/social/chat/conversations/direct',
        { targetUserId: charlie.userId },
        alice.cookie
      );
      assert.equal(openAC.status, 200);
      const convAC = ((await openAC.json()) as { conversation: { conversationId: string } })
        .conversation.conversationId;

      // Send a message in convAC so we have a real valid message_id from ANOTHER conversation
      const msgACRes = await h.postJson(
        `/api/social/chat/conversations/${convAC}/messages`,
        { body: 'Secret message in AC', clientMsgId: 'ac-msg-1' },
        alice.cookie
      );
      assert.equal(msgACRes.status, 201);
      const msgACId = ((await msgACRes.json()) as { message: { messageId: string } }).message
        .messageId;

      // 1) Conversation IDOR: Charlie (non-member of convAB) cannot list, send, or mark-read convAB
      assert.equal(
        (await h.getJson(`/api/social/chat/conversations/${convAB}/messages`, charlie.cookie))
          .status,
        403
      );
      assert.equal(
        (
          await h.postJson(
            `/api/social/chat/conversations/${convAB}/messages`,
            { body: 'IDOR injection attempt' },
            charlie.cookie
          )
        ).status,
        403
      );
      assert.equal(
        (
          await h.postJson(
            `/api/social/chat/conversations/${convAB}/read`,
            {},
            charlie.cookie
          )
        ).status,
        403
      );

      // 2) Cross-conversation lastReadMessageId attack -> strictly rejected with 404 NOT_FOUND
      const crossRead = await h.postJson(
        `/api/social/chat/conversations/${convAB}/read`,
        { lastReadMessageId: msgACId },
        bob.cookie
      );
      assert.equal(crossRead.status, 404);
      assert.equal(((await crossRead.json()) as { code: string }).code, 'NOT_FOUND');

      // 3) Concurrent clientMsgId idempotency (5x Promise.all) -> 1 DB row, zero 500
      const msgBurst = await Promise.all(
        Array.from({ length: 5 }, () =>
          h.postJson(
            `/api/social/chat/conversations/${convAB}/messages`,
            { body: 'سلام همزمان', clientMsgId: 'concurrent-msg-001' },
            alice.cookie
          )
        )
      );
      for (const mr of msgBurst) {
        assert.ok(mr.status === 200 || mr.status === 201);
      }
      const msgPayloads = (await Promise.all(msgBurst.map((r) => r.json()))) as Array<{
        message: { messageId: string };
      }>;
      assert.equal(new Set(msgPayloads.map((m) => m.message.messageId)).size, 1);

      // 4) Message size bounds (>2000 chars -> 400; >12KB payload -> 413)
      const tooLongChars = await h.postJson(
        `/api/social/chat/conversations/${convAB}/messages`,
        { body: 'a'.repeat(2001) },
        alice.cookie
      );
      assert.equal(tooLongChars.status, 400);

      const tooLargeBytes = await h.postJson(
        `/api/social/chat/conversations/${convAB}/messages`,
        { body: 'ب'.repeat(7000) }, // >14KB UTF-8
        alice.cookie
      );
      assert.equal(tooLargeBytes.status, 413);

      // 5) Ex-friend presence privacy & invite rejection
      // Bob sends live presence heartbeat
      const hbBob = await h.postJson(
        '/api/social/presence/heartbeat',
        { deviceId: 'dev_bob_1', state: 'active' },
        bob.cookie
      );
      assert.equal(hbBob.status, 200);

      // While friends, Alice sees Bob online in conversations list
      const convsBeforeUnfriend = (await (
        await h.getJson('/api/social/chat/conversations', alice.cookie)
      ).json()) as {
        conversations: Array<{ conversationId: string; partner: { onlineStatus: string } }>;
      };
      const abBefore = convsBeforeUnfriend.conversations.find((c) => c.conversationId === convAB);
      assert.equal(abBefore?.partner.onlineStatus, 'online');

      // Alice creates a room and invites Bob, then removes Bob from friends BEFORE Bob accepts
      const roomRes = await h.postJson(
        '/api/rooms',
        { username: alice.username, avatarCode: 'portrait' },
        alice.cookie
      );
      const roomCode = ((await roomRes.json()) as { roomCode: string }).roomCode;
      const invRes = await h.postJson(
        '/api/social/invites',
        { targetUserId: bob.userId, roomCode, gameId: 'hokm' },
        alice.cookie
      );
      assert.equal(invRes.status, 201);
      const inviteId = ((await invRes.json()) as { invite: { inviteId: string } }).invite
        .inviteId;

      const removeRes = await h.postJson(
        '/api/social/friends/remove',
        { targetUserId: bob.userId },
        alice.cookie
      );
      assert.equal(removeRes.status, 200);

      // Ex-friend presence privacy: Alice's conversations list MUST now show Bob as 'offline'
      const convsAfterUnfriend = (await (
        await h.getJson('/api/social/chat/conversations', alice.cookie)
      ).json()) as {
        conversations: Array<{ conversationId: string; partner: { onlineStatus: string } }>;
      };
      const abAfter = convsAfterUnfriend.conversations.find((c) => c.conversationId === convAB);
      assert.equal(
        abAfter?.partner.onlineStatus,
        'offline',
        'Ex-friend live online presence MUST NEVER leak in direct conversation list'
      );

      // Bob cannot accept the pending invite after friendship removal
      const acceptExFriend = await h.postJson(
        '/api/social/invites/accept',
        { inviteId },
        bob.cookie
      );
      assert.ok(
        acceptExFriend.status === 403 || acceptExFriend.status === 409,
        `Ex-friend must not accept invite (got ${acceptExFriend.status})`
      );

      // 6) Bidirectional block enforcement on markConversationRead
      const blockCharlie = await h.postJson(
        '/api/social/blocks',
        { targetUserId: charlie.userId },
        alice.cookie
      );
      assert.equal(blockCharlie.status, 200);

      const blockedReadByCharlie = await h.postJson(
        `/api/social/chat/conversations/${convAC}/read`,
        {},
        charlie.cookie
      );
      assert.equal(blockedReadByCharlie.status, 403);
      assert.equal(((await blockedReadByCharlie.json()) as { code: string }).code, 'USER_BLOCKED');

      const blockedReadByAlice = await h.postJson(
        `/api/social/chat/conversations/${convAC}/read`,
        {},
        alice.cookie
      );
      assert.equal(blockedReadByAlice.status, 403);

      // 7) Sec-Fetch-Site: cross-site without Origin header rejected by social CSRF guard
      const secFetchAttack = await fetch(`${h.baseUrl}/api/social/privacy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          'Sec-Fetch-Site': 'cross-site',
          Cookie: alice.cookie,
        },
        body: JSON.stringify({ showOnlineStatus: false }),
      });
      assert.equal(secFetchAttack.status, 403);
      assert.equal(((await secFetchAttack.json()) as { code: string }).code, 'FORBIDDEN_ORIGIN');

      // 8) Chat rate limit enforcement (30 messages/min -> 31st gets 429)
      await h.makeFriends(alice, bob); // Re-friend for fresh messaging
      let chatRateLimited = false;
      for (let i = 0; i < 32; i++) {
        const res = await h.postJson(
          `/api/social/chat/conversations/${convAB}/messages`,
          { body: `msg-${i}`, clientMsgId: `rl-msg-${i}` },
          bob.cookie
        );
        if (res.status === 429) {
          chatRateLimited = true;
          assert.ok(res.headers.get('Retry-After'));
          break;
        }
        assert.equal(res.status, 201);
      }
      assert.equal(chatRateLimited, true, 'Chat send must enforce CHAT_SEND_USER_RATE_LIMIT');

      // 9) Zero PII leaks across social responses
      const [searchBody, friendsBody, convsBody, msgsBody, pubBody] = await Promise.all([
        (await h.getJson('/api/social/users/search?q=BobSec', alice.cookie)).text(),
        (await h.getJson('/api/social/friends', alice.cookie)).text(),
        (await h.getJson('/api/social/chat/conversations', alice.cookie)).text(),
        (await h.getJson(`/api/social/chat/conversations/${convAB}/messages`, alice.cookie)).text(),
        (await h.getJson(`/api/social/users/${bob.userId}`, alice.cookie)).text(),
      ]);
      const combined = searchBody + friendsBody + convsBody + msgsBody + pubBody;
      for (const forbidden of [
        'bob.sec@example.com',
        'alice.sec@example.com',
        'password_hash',
        'token_hash',
        'browser_binding_hash',
        'ip_hash',
      ]) {
        assert.equal(
          combined.includes(forbidden),
          false,
          `Social responses must NEVER leak sensitive field or PII: ${forbidden}`
        );
      }
    } finally {
      await h.cleanup();
    }
  });
});
