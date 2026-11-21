import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import worker from '../cloudflare/src/index';
import { HokmRoomDO } from '../cloudflare/src/HokmRoomDO';
import {
  CfWorkerEnv,
  DurableObjectStateLike,
  DurableObjectStorageLike,
  HibernatableWebSocket,
} from '../cloudflare/src/lib/types';
import { sha256Hex } from '../cloudflare/src/lib/auth/crypto';
import { AUTH_COOKIE_NAME } from '../cloudflare/src/lib/auth/authCookie';
import {
  EmailSender,
  PasswordResetEmailPayload,
  VerificationEmailPayload,
  createEmailSender,
} from '../cloudflare/src/lib/auth/emailService';
import { handleAuthHttpRequest } from '../cloudflare/src/lib/auth/httpHandler';
import { SESSION_COOKIE_NAME } from '../cloudflare/src/lib/sessionCookie';
import { createEyvanExpressApp } from './createExpressApp';
import { EyvanDatabase } from './database';
import { HokmRoomManager } from './roomManager';

interface CapturedEmail {
  readonly kind: 'verify' | 'reset';
  readonly to: string;
  readonly username: string;
  readonly url: string;
  readonly token: string;
}

function extractTokenFromHashUrl(urlStr: string, key: 'verify-email' | 'reset-password'): string {
  const parsed = new URL(urlStr);
  assert.equal(parsed.search, '', 'Token MUST NOT be placed in query string');
  const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const token = hashParams.get(key);
  assert.ok(token && token.length >= 32, `Expected opaque token in #${key}=...`);
  return token;
}

function createMockEmailRecorder(): {
  sender: EmailSender;
  emails: CapturedEmail[];
} {
  const emails: CapturedEmail[] = [];
  const sender: EmailSender = {
    async sendVerificationEmail(payload: VerificationEmailPayload) {
      emails.push({
        kind: 'verify',
        to: payload.to,
        username: payload.username,
        url: payload.verifyUrl,
        token: extractTokenFromHashUrl(payload.verifyUrl, 'verify-email'),
      });
      return { configured: true, sent: true, provider: 'mock' };
    },
    async sendPasswordResetEmail(payload: PasswordResetEmailPayload) {
      emails.push({
        kind: 'reset',
        to: payload.to,
        username: payload.username,
        url: payload.resetUrl,
        token: extractTokenFromHashUrl(payload.resetUrl, 'reset-password'),
      });
      return { configured: true, sent: true, provider: 'mock' };
    },
  };
  return { sender, emails };
}

class MemStorage implements DurableObjectStorageLike {
  private readonly map = new Map<string, unknown>();
  private alarm: number | null = null;
  async get<T = unknown>(k: string): Promise<T | undefined> {
    return this.map.has(k) ? (structuredClone(this.map.get(k)) as T) : undefined;
  }
  async put<T = unknown>(k: string, v: T): Promise<void> {
    this.map.set(k, structuredClone(v));
  }
  async delete(k: string | string[]): Promise<boolean | number> {
    if (Array.isArray(k)) return k.filter((x) => this.map.delete(x)).length;
    return this.map.delete(k);
  }
  async deleteAll(): Promise<void> {
    this.map.clear();
  }
  async setAlarm(t: number | Date): Promise<void> {
    this.alarm = t instanceof Date ? t.getTime() : t;
  }
  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }
  async deleteAlarm(): Promise<void> {
    this.alarm = null;
  }
}

class MemDoState implements DurableObjectStateLike {
  public readonly storage = new MemStorage();
  private gate: Promise<unknown> = Promise.resolve();
  acceptWebSocket(_ws: HibernatableWebSocket): void {}
  getWebSockets(): HibernatableWebSocket[] {
    return [];
  }
  async blockConcurrencyWhile<T>(cb: () => Promise<T>): Promise<T> {
    const prev = this.gate;
    let release!: () => void;
    this.gate = new Promise<void>((r) => {
      release = r;
    });
    await prev;
    try {
      return await cb();
    } finally {
      release();
    }
  }
}

function createWorkerC2Harness() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyvan-c2-worker-'));
  const dbPath = path.join(tmpDir, 'c2.sqlite');
  const eyvanDb = new EyvanDatabase(dbPath);
  const rawDb = new Database(dbPath);
  const dos = new Map<string, HokmRoomDO>();
  const recorder = createMockEmailRecorder();

  const env: CfWorkerEnv = {
    EYVAN_DB: eyvanDb.getD1Adapter(),
    EYVAN_ASSETS: { get: async () => null },
    ALLOWED_ORIGINS: 'https://eyvan.test',
    PUBLIC_APP_URL: 'https://eyvan.test',
    ENVIRONMENT: 'production',
    EMAIL_SENDER: recorder.sender,
    HOKM_ROOM: {
      idFromName: (name: string) => name,
      get(id: unknown) {
        const key = String(id);
        let inst = dos.get(key);
        if (!inst) {
          inst = new HokmRoomDO(new MemDoState(), env);
          dos.set(key, inst);
        }
        return { fetch: (req: Request) => inst!.fetch(req) };
      },
    },
  };

  return {
    env,
    rawDb,
    emails: recorder.emails,
    cleanup: () => {
      rawDb.close();
      eyvanDb.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

function makeWorkerPost(
  pathname: string,
  body: unknown,
  opts?: { ip?: string; cookie?: string; origin?: string | null; xrw?: string | null }
): Request {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'CF-Connecting-IP': opts?.ip ?? '198.51.100.20',
    'User-Agent': 'EyvanC2Test/1.0',
  });
  if (opts?.origin !== null) {
    headers.set('Origin', opts?.origin ?? 'https://eyvan.test');
  }
  if (opts?.xrw !== null) {
    headers.set('X-Requested-With', opts?.xrw ?? 'eyvan-client');
  }
  if (opts?.cookie) {
    headers.set('Cookie', opts.cookie);
  }
  return new Request(`https://api.eyvan.test${pathname}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function extractCookiePair(setCookie: string | null, name: string): string | null {
  if (!setCookie) return null;
  const first = setCookie.split(';')[0]?.trim() ?? '';
  return first.startsWith(`${name}=`) ? first : null;
}

describe('Stage C2 — Email Verification, Resend & Password Reset (Worker + Express)', () => {
  it('1. Registers in pending_verification, blocks unverified login, stores only SHA-256 verification hash, and activates on verify-email', async () => {
    const h = createWorkerC2Harness();
    try {
      const regRes = await worker.fetch(
        makeWorkerPost('/api/auth/register', {
          email: 'Nima.Test@Example.com',
          username: 'Nima_C2',
          password: 'StrongPassword22',
          confirmPassword: 'StrongPassword22',
        }),
        h.env
      );

      assert.equal(regRes.status, 201);
      assert.equal(regRes.headers.get('Set-Cookie'), null, 'Unverified registration MUST NOT issue session cookie');
      assert.equal(regRes.headers.get('Referrer-Policy'), 'no-referrer');
      assert.equal(regRes.headers.get('Cache-Control'), 'no-store, private');

      const regBodyText = await regRes.text();
      assert.equal(h.emails.length, 1);
      const verifyMail = h.emails[0];
      assert.equal(verifyMail.kind, 'verify');
      assert.equal(verifyMail.to, 'Nima.Test@Example.com');
      assert.equal(regBodyText.includes(verifyMail.token), false, 'Raw verification token MUST NEVER appear in API JSON');

      const regJson = JSON.parse(regBodyText) as {
        ok: boolean;
        authenticated: boolean;
        verificationRequired: boolean;
        emailDelivery: { configured: boolean; sent: boolean };
        user: { userId: string; emailVerified: boolean; accountStatus: string };
      };
      assert.equal(regJson.ok, true);
      assert.equal(regJson.authenticated, false);
      assert.equal(regJson.verificationRequired, true);
      assert.equal(regJson.emailDelivery.configured, true);
      assert.equal(regJson.emailDelivery.sent, true);
      assert.equal(regJson.user.emailVerified, false);
      assert.equal(regJson.user.accountStatus, 'pending_verification');

      // Verify DB stores ONLY SHA-256 hash of verification token
      const expectedHash = await sha256Hex(verifyMail.token);
      const tokenRow = h.rawDb
        .prepare(`SELECT token_hash, consumed_at FROM email_verification_tokens WHERE user_id = ?`)
        .get(regJson.user.userId) as { token_hash: string; consumed_at: number | null };
      assert.equal(tokenRow.token_hash, expectedHash);
      assert.notEqual(tokenRow.token_hash, verifyMail.token);
      assert.equal(tokenRow.consumed_at, null);

      // Login BEFORE verification -> 403 EMAIL_NOT_VERIFIED, zero cookie
      const preLogin = await worker.fetch(
        makeWorkerPost('/api/auth/login', {
          identifier: 'nima_c2',
          password: 'StrongPassword22',
        }),
        h.env
      );
      assert.equal(preLogin.status, 403);
      assert.equal(preLogin.headers.get('Set-Cookie'), null);
      const preLoginJson = (await preLogin.json()) as { code: string; verificationRequired?: boolean };
      assert.equal(preLoginJson.code, 'EMAIL_NOT_VERIFIED');
      assert.equal(preLoginJson.verificationRequired, true);

      // Verify email with valid token -> 200 & activates account
      const verifyRes = await worker.fetch(
        makeWorkerPost('/api/auth/verify-email', { token: verifyMail.token }),
        h.env
      );
      assert.equal(verifyRes.status, 200);
      const verifyJson = (await verifyRes.json()) as { ok: boolean; verified: boolean };
      assert.equal(verifyJson.ok, true);
      assert.equal(verifyJson.verified, true);

      // Token must be marked consumed & user active
      const postUser = h.rawDb
        .prepare(`SELECT email_verified, account_status FROM users WHERE user_id = ?`)
        .get(regJson.user.userId) as { email_verified: number; account_status: string };
      assert.equal(postUser.email_verified, 1);
      assert.equal(postUser.account_status, 'active');

      // Login AFTER verification -> 200 + HttpOnly cookie + /api/auth/me works
      const postLogin = await worker.fetch(
        makeWorkerPost('/api/auth/login', {
          identifier: 'nima.test@example.com',
          password: 'StrongPassword22',
        }),
        h.env
      );
      assert.equal(postLogin.status, 200);
      const authCookie = extractCookiePair(postLogin.headers.get('Set-Cookie'), AUTH_COOKIE_NAME);
      assert.ok(authCookie);

      const meRes = await worker.fetch(
        new Request('https://api.eyvan.test/api/auth/me', {
          method: 'GET',
          headers: { Cookie: authCookie },
        }),
        h.env
      );
      const meJson = (await meRes.json()) as { authenticated: boolean; user: { emailVerified: boolean; accountStatus: string } };
      assert.equal(meJson.authenticated, true);
      assert.equal(meJson.user.emailVerified, true);
      assert.equal(meJson.user.accountStatus, 'active');
    } finally {
      h.cleanup();
    }
  });

  it('2. Rejects invalid, expired, replayed, and concurrent double-use email verification tokens', async () => {
    const h = createWorkerC2Harness();
    try {
      // Register user A for invalid/replay/concurrency tests
      const regA = await worker.fetch(
        makeWorkerPost('/api/auth/register', {
          email: 'race@example.com',
          username: 'Race_Verify',
          password: 'ValidPassword123',
          confirmPassword: 'ValidPassword123',
        }),
        h.env
      );
      assert.equal(regA.status, 201);
      const tokenA = h.emails[0].token;

      // Invalid token rejected
      const badTok = await worker.fetch(
        makeWorkerPost('/api/auth/verify-email', { token: 'A'.repeat(43) }, { ip: '198.51.100.31' }),
        h.env
      );
      assert.equal(badTok.status, 400);
      assert.equal(((await badTok.json()) as { code: string }).code, 'INVALID_OR_EXPIRED_TOKEN');

      // Concurrent 5 parallel attempts with the exact same valid token -> strictly 1 succeeds, 4 fail!
      const parallel = await Promise.all(
        Array.from({ length: 5 }, (_, idx) =>
          worker.fetch(
            makeWorkerPost(
              '/api/auth/verify-email',
              { token: tokenA },
              { ip: `198.51.100.${40 + idx}` }
            ),
            h.env
          )
        )
      );
      const statuses = parallel.map((r) => r.status).sort((a, b) => a - b);
      assert.deepEqual(statuses, [200, 400, 400, 400, 400]);

      // Subsequent replay fails
      const replay = await worker.fetch(
        makeWorkerPost('/api/auth/verify-email', { token: tokenA }, { ip: '198.51.100.50' }),
        h.env
      );
      assert.equal(replay.status, 400);

      // Register user B and verify with future clock past 24h TTL -> rejected as expired
      const regB = await worker.fetch(
        makeWorkerPost(
          '/api/auth/register',
          {
            email: 'expired@example.com',
            username: 'Expired_Verify',
            password: 'ValidPassword123',
            confirmPassword: 'ValidPassword123',
          },
          { ip: '198.51.100.51' }
        ),
        h.env
      );
      assert.equal(regB.status, 201);
      const tokenB = h.emails[1].token;

      const expiredRes = await handleAuthHttpRequest(
        makeWorkerPost('/api/auth/verify-email', { token: tokenB }, { ip: '198.51.100.52' }),
        '/api/auth/verify-email',
        {
          db: h.env.EYVAN_DB,
          corsHeaders: {},
          secureCookie: true,
          originAllowed: true,
          clientIp: '198.51.100.52',
          userAgent: 'Test',
          now: Date.now() + 25 * 60 * 60 * 1000, // 25h later
        }
      );
      assert.ok(expiredRes);
      assert.equal(expiredRes.status, 400);
      assert.equal(((await expiredRes.json()) as { code: string }).code, 'INVALID_OR_EXPIRED_TOKEN');
    } finally {
      h.cleanup();
    }
  });

  it('3. Resend verification invalidates old tokens, avoids account enumeration, and enforces rate limits', async () => {
    const h = createWorkerC2Harness();
    try {
      await worker.fetch(
        makeWorkerPost('/api/auth/register', {
          email: 'resend@example.com',
          username: 'Resend_User',
          password: 'ValidPassword123',
          confirmPassword: 'ValidPassword123',
        }),
        h.env
      );
      assert.equal(h.emails.length, 1);
      const firstToken = h.emails[0].token;

      // Resend for non-existent email -> uniform 200, ZERO emails dispatched
      const ghostRes = await worker.fetch(
        makeWorkerPost(
          '/api/auth/resend-verification',
          { email: 'nobody@example.com' },
          { ip: '198.51.100.61' }
        ),
        h.env
      );
      assert.equal(ghostRes.status, 200);
      const ghostJson = (await ghostRes.json()) as { ok: boolean; message: string };
      assert.equal(h.emails.length, 1, 'No email should be sent for non-existent email');

      // Resend for existing unverified email -> identical uniform 200 + fresh token + old token invalidated
      const realRes = await worker.fetch(
        makeWorkerPost(
          '/api/auth/resend-verification',
          { email: 'RESEND@EXAMPLE.COM' },
          { ip: '198.51.100.62' }
        ),
        h.env
      );
      assert.equal(realRes.status, 200);
      const realJson = (await realRes.json()) as { ok: boolean; message: string };
      assert.equal(realJson.message, ghostJson.message, 'Resend response must not enumerate existing emails');
      assert.equal(h.emails.length, 2);
      const secondToken = h.emails[1].token;
      assert.notEqual(secondToken, firstToken);

      // Old token MUST now fail!
      const oldVerify = await worker.fetch(
        makeWorkerPost('/api/auth/verify-email', { token: firstToken }, { ip: '198.51.100.63' }),
        h.env
      );
      assert.equal(oldVerify.status, 400);

      // Rate-limit check on resend-verification (max 3 per 15 min per email -> 4th gets 429)
      for (let i = 0; i < 2; i += 1) {
        const okRes = await worker.fetch(
          makeWorkerPost(
            '/api/auth/resend-verification',
            { email: 'resend@example.com' },
            { ip: `198.51.100.${70 + i}` }
          ),
          h.env
        );
        assert.equal(okRes.status, 200);
      }
      const blockedRes = await worker.fetch(
        makeWorkerPost(
          '/api/auth/resend-verification',
          { email: 'resend@example.com' },
          { ip: '198.51.100.75' }
        ),
        h.env
      );
      assert.equal(blockedRes.status, 429);
      assert.ok(Number(blockedRes.headers.get('Retry-After')) >= 1);

      // Latest issued token succeeds!
      const latestToken = h.emails[h.emails.length - 1].token;
      const newVerify = await worker.fetch(
        makeWorkerPost('/api/auth/verify-email', { token: latestToken }, { ip: '198.51.100.76' }),
        h.env
      );
      assert.equal(newVerify.status, 200);
    } finally {
      h.cleanup();
    }
  });

  it('4. Forgot & Reset Password: non-enumerating, hashed single-use token, concurrent-safe, revokes ALL active sessions, keeps Hokm session intact', async () => {
    const h = createWorkerC2Harness();
    try {
      // Guest Hokm room session created independently
      const roomRes = await worker.fetch(
        new Request('https://api.eyvan.test/api/rooms', {
          method: 'POST',
          headers: {
            Origin: 'https://eyvan.test',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username: 'GuestHokmC2', avatarCode: 'portrait' }),
        }),
        h.env
      );
      assert.equal(roomRes.status, 201);
      const hokmCookie = extractCookiePair(roomRes.headers.get('Set-Cookie'), SESSION_COOKIE_NAME)!;

      // Register, verify, and log in on TWO devices (sessA, sessB)
      await worker.fetch(
        makeWorkerPost('/api/auth/register', {
          email: 'resetme@example.com',
          username: 'Reset_Player',
          password: 'OldPassword123',
          confirmPassword: 'OldPassword123',
        }),
        h.env
      );
      await worker.fetch(
        makeWorkerPost('/api/auth/verify-email', { token: h.emails[0].token }),
        h.env
      );

      const loginA = await worker.fetch(
        makeWorkerPost('/api/auth/login', {
          identifier: 'resetme@example.com',
          password: 'OldPassword123',
        }),
        h.env
      );
      const loginB = await worker.fetch(
        makeWorkerPost('/api/auth/login', {
          identifier: 'reset_player',
          password: 'OldPassword123',
        }),
        h.env
      );
      const cookieA = extractCookiePair(loginA.headers.get('Set-Cookie'), AUTH_COOKIE_NAME)!;
      const cookieB = extractCookiePair(loginB.headers.get('Set-Cookie'), AUTH_COOKIE_NAME)!;
      assert.ok(cookieA && cookieB);

      // Forgot password for unknown vs real email -> identical non-enumerating 200 response
      const unknownForgot = await worker.fetch(
        makeWorkerPost('/api/auth/forgot-password', { email: 'doesnotexist@example.com' }, { ip: '198.51.100.80' }),
        h.env
      );
      assert.equal(unknownForgot.status, 200);
      const unknownMsg = ((await unknownForgot.json()) as { message: string }).message;
      assert.equal(h.emails.length, 1);

      const realForgot1 = await worker.fetch(
        makeWorkerPost('/api/auth/forgot-password', { email: 'RESETME@EXAMPLE.COM' }, { ip: '198.51.100.81' }),
        h.env
      );
      assert.equal(realForgot1.status, 200);
      assert.equal(((await realForgot1.json()) as { message: string }).message, unknownMsg);
      assert.equal(h.emails.length, 2);
      const resetToken1 = h.emails[1].token;

      // Verify ONLY SHA-256 hash is persisted in password_reset_tokens
      const hash1 = await sha256Hex(resetToken1);
      const prRow = h.rawDb
        .prepare(`SELECT token_hash, consumed_at FROM password_reset_tokens WHERE token_hash = ?`)
        .get(hash1) as { token_hash: string; consumed_at: number | null };
      assert.equal(prRow.token_hash, hash1);
      assert.equal(prRow.consumed_at, null);

      // Second forgot-password request invalidates first token
      const realForgot2 = await worker.fetch(
        makeWorkerPost('/api/auth/forgot-password', { email: 'resetme@example.com' }, { ip: '198.51.100.82' }),
        h.env
      );
      assert.equal(realForgot2.status, 200);
      const resetToken2 = h.emails[2].token;
      assert.notEqual(resetToken2, resetToken1);

      // Old invalidated reset token fails
      const tryOldTok = await worker.fetch(
        makeWorkerPost(
          '/api/auth/reset-password',
          { token: resetToken1, password: 'NewPassword456', confirmPassword: 'NewPassword456' },
          { ip: '198.51.100.83' }
        ),
        h.env
      );
      assert.equal(tryOldTok.status, 400);

      // Weak password fails WITHOUT consuming valid resetToken2
      const weakReset = await worker.fetch(
        makeWorkerPost(
          '/api/auth/reset-password',
          { token: resetToken2, password: 'short', confirmPassword: 'short' },
          { ip: '198.51.100.84' }
        ),
        h.env
      );
      assert.equal(weakReset.status, 400);

      // Expired reset token (>1h) rejected
      const expiredReset = await handleAuthHttpRequest(
        makeWorkerPost(
          '/api/auth/reset-password',
          { token: resetToken2, password: 'NewPassword456', confirmPassword: 'NewPassword456' },
          { ip: '198.51.100.85' }
        ),
        '/api/auth/reset-password',
        {
          db: h.env.EYVAN_DB,
          corsHeaders: {},
          secureCookie: true,
          originAllowed: true,
          clientIp: '198.51.100.85',
          userAgent: 'Test',
          now: Date.now() + 2 * 60 * 60 * 1000,
        }
      );
      assert.ok(expiredReset);
      assert.equal(expiredReset.status, 400);

      // Concurrent 4 parallel reset-password attempts with valid resetToken2 -> strictly 1 succeeds, 3 fail!
      const parallelResets = await Promise.all(
        Array.from({ length: 4 }, (_, idx) =>
          worker.fetch(
            makeWorkerPost(
              '/api/auth/reset-password',
              {
                token: resetToken2,
                password: 'NewPassword456',
                confirmPassword: 'NewPassword456',
              },
              { ip: `198.51.100.${90 + idx}`, cookie: `${cookieA}; ${hokmCookie}` }
            ),
            h.env
          )
        )
      );
      const resetStatuses = parallelResets.map((r) => r.status).sort((a, b) => a - b);
      assert.deepEqual(resetStatuses, [200, 400, 400, 400]);

      // BOTH prior active auth sessions (cookieA and cookieB) MUST be revoked!
      for (const oldCookie of [cookieA, cookieB]) {
        const meAfter = await worker.fetch(
          new Request('https://api.eyvan.test/api/auth/me', {
            method: 'GET',
            headers: { Cookie: oldCookie },
          }),
          h.env
        );
        const meJson = (await meAfter.json()) as { authenticated: boolean };
        assert.equal(meJson.authenticated, false, 'All prior auth_sessions must be revoked after password reset');
      }

      // Old password MUST fail, new password MUST succeed!
      const oldPwdLogin = await worker.fetch(
        makeWorkerPost('/api/auth/login', {
          identifier: 'resetme@example.com',
          password: 'OldPassword123',
        }),
        h.env
      );
      assert.equal(oldPwdLogin.status, 401);

      const newPwdLogin = await worker.fetch(
        makeWorkerPost('/api/auth/login', {
          identifier: 'resetme@example.com',
          password: 'NewPassword456',
        }),
        h.env
      );
      assert.equal(newPwdLogin.status, 200);

      // Guest Hokm session cookie MUST still be completely intact!
      const hokmResume = await worker.fetch(
        new Request('https://api.eyvan.test/api/session/resume', {
          method: 'POST',
          headers: {
            Origin: 'https://eyvan.test',
            'X-Requested-With': 'eyvan-client',
            'Content-Type': 'application/json',
            Cookie: hokmCookie,
          },
          body: JSON.stringify({}),
        }),
        h.env
      );
      assert.equal(hokmResume.status, 200);
    } finally {
      h.cleanup();
    }
  });

  it('5. Direct Express HTTP server executes full C2 parity lifecycle with CSRF/Origin checks and session revocation', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyvan-c2-express-'));
    const dbPath = path.join(tmpDir, 'c2-express.sqlite');
    const db = new EyvanDatabase(dbPath);
    const roomManager = new HokmRoomManager({ db });
    const recorder = createMockEmailRecorder();

    const { app } = createEyvanExpressApp({
      db,
      roomManager,
      emailSender: recorder.sender,
      config: {
        isProduction: false,
        publicAppUrl: 'http://127.0.0.1:3000',
      },
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      // CSRF/Origin enforcement on C2 endpoints
      const badOriginVerify = await fetch(`${baseUrl}/api/auth/verify-email`, {
        method: 'POST',
        headers: {
          Origin: 'https://evil-tenant.run.app',
          'X-Requested-With': 'eyvan-client',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: 'A'.repeat(43) }),
      });
      assert.equal(badOriginVerify.status, 403);

      const noCsrfForgot = await fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'exp@example.com' }),
      });
      assert.equal(noCsrfForgot.status, 403);

      // Register -> unverified 403 -> verify -> login -> forgot -> reset -> old session revoked -> login with new password
      const reg = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Requested-With': 'eyvan-client',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'express_c2@example.com',
          username: 'Express_C2',
          password: 'InitialPassword1',
          confirmPassword: 'InitialPassword1',
        }),
      });
      assert.equal(reg.status, 201);
      assert.equal(reg.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(reg.headers.get('set-cookie'), null);

      const preLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Requested-With': 'eyvan-client',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          identifier: 'express_c2@example.com',
          password: 'InitialPassword1',
        }),
      });
      assert.equal(preLogin.status, 403);

      const verify = await fetch(`${baseUrl}/api/auth/verify-email`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Requested-With': 'eyvan-client',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: recorder.emails[0].token }),
      });
      assert.equal(verify.status, 200);

      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Requested-With': 'eyvan-client',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          identifier: 'express_c2',
          password: 'InitialPassword1',
        }),
      });
      assert.equal(login.status, 200);
      const authCookie = extractCookiePair(login.headers.get('set-cookie'), AUTH_COOKIE_NAME)!;
      assert.ok(authCookie);

      const forgot = await fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Requested-With': 'eyvan-client',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'express_c2@example.com' }),
      });
      assert.equal(forgot.status, 200);
      assert.equal(recorder.emails.length, 2);

      const reset = await fetch(`${baseUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Requested-With': 'eyvan-client',
          'Content-Type': 'application/json',
          Cookie: authCookie,
        },
        body: JSON.stringify({
          token: recorder.emails[1].token,
          password: 'UpdatedPassword9',
          confirmPassword: 'UpdatedPassword9',
        }),
      });
      assert.equal(reset.status, 200);

      const meRevoked = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: authCookie },
      });
      assert.equal(((await meRevoked.json()) as { authenticated: boolean }).authenticated, false);

      const newLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Requested-With': 'eyvan-client',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          identifier: 'express_c2@example.com',
          password: 'UpdatedPassword9',
        }),
      });
      assert.equal(newLogin.status, 200);
    } finally {
      roomManager.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('6. EmailSender sends via Resend HTTP API when configured and truthfully reports unconfigured when API key is missing', async () => {
    // Unconfigured sender never fabricates delivery
    const unconfigured = createEmailSender({
      provider: 'resend',
      resendApiKey: '',
      emailFrom: 'Eyvan <no-reply@example.com>',
    });
    const unconfRes = await unconfigured.sendVerificationEmail({
      to: 'user@example.com',
      username: 'TestUser',
      verifyUrl: 'https://eyvan.test/#verify-email=SECRET_TOKEN_123456789012345678901234',
      expiresInHours: 24,
    });
    assert.equal(unconfRes.configured, false);
    assert.equal(unconfRes.sent, false);

    // Configured Resend sender issues proper HTTP POST without touching real network
    let capturedUrl = '';
    let capturedAuth = '';
    let capturedBody = '';
    const mockFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      const headers = new Headers(init?.headers);
      capturedAuth = headers.get('Authorization') ?? '';
      capturedBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ id: 're_test_123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const resendSender = createEmailSender({
      provider: 'resend',
      resendApiKey: 're_test_dummy_key',
      emailFrom: 'Eyvan <no-reply@eyvan.test>',
      fetchImpl: mockFetch,
    });
    const sentRes = await resendSender.sendPasswordResetEmail({
      to: 'player@example.com',
      username: 'PlayerOne',
      resetUrl: 'https://eyvan.test/#reset-password=TOKEN_ABC_123456789012345678901234',
      expiresInMinutes: 60,
    });
    assert.equal(sentRes.configured, true);
    assert.equal(sentRes.sent, true);
    assert.equal(capturedUrl, 'https://api.resend.com/emails');
    assert.equal(capturedAuth, 'Bearer re_test_dummy_key');
    assert.ok(capturedBody.includes('player@example.com'));
    assert.ok(capturedBody.includes('#reset-password=TOKEN_ABC_123456789012345678901234'));
  });
});
