import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
import {
  CURRENT_PASSWORD_ALGO,
  hashPassword,
  sha256Hex,
  verifyPassword,
} from '../cloudflare/src/lib/auth/crypto';
import {
  AUTH_COOKIE_NAME,
  parseAuthCookieFromHeader,
} from '../cloudflare/src/lib/auth/authCookie';
import { EmailSender } from '../cloudflare/src/lib/auth/emailService';
import { handleAuthHttpRequest } from '../cloudflare/src/lib/auth/httpHandler';
import { SESSION_COOKIE_NAME } from '../cloudflare/src/lib/sessionCookie';
import { EyvanDatabase } from './database';

// ---------------------------------------------------------------------------
// Minimal real-DO + SQLite-backed Worker harness for C1 end-to-end tests
// ---------------------------------------------------------------------------

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

interface TestWorkerContext {
  env: CfWorkerEnv;
  eyvanDb: EyvanDatabase;
  rawDb: Database.Database;
  capturedVerifyTokens: string[];
  cleanup: () => void;
}

function createWorkerTestContext(overrides?: Partial<CfWorkerEnv>): TestWorkerContext {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyvan-c1-auth-'));
  const dbPath = path.join(tmpDir, 'auth.sqlite');
  const eyvanDb = new EyvanDatabase(dbPath);
  const rawDb = new Database(dbPath);
  const dos = new Map<string, HokmRoomDO>();
  const capturedVerifyTokens: string[] = [];

  const mockEmailSender: EmailSender = {
    async sendVerificationEmail(payload) {
      const hash = new URL(payload.verifyUrl).hash.replace(/^#/, '');
      const tok = new URLSearchParams(hash).get('verify-email');
      if (tok) capturedVerifyTokens.push(tok);
      return { configured: true, sent: true, provider: 'mock' };
    },
    async sendPasswordResetEmail() {
      return { configured: true, sent: true, provider: 'mock' };
    },
  };

  const env: CfWorkerEnv = {
    EYVAN_DB: eyvanDb.getD1Adapter(),
    EYVAN_ASSETS: { get: async () => null },
    ALLOWED_ORIGINS: 'https://eyvan.test',
    PUBLIC_APP_URL: 'https://eyvan.test',
    EMAIL_SENDER: mockEmailSender,
    HOKM_ROOM: {
      idFromName(name: string) {
        return name;
      },
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
    ...overrides,
  };

  return {
    env,
    eyvanDb,
    rawDb,
    capturedVerifyTokens,
    cleanup: () => {
      rawDb.close();
      eyvanDb.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

async function verifyLatestRegisteredEmail(ctx: TestWorkerContext): Promise<void> {
  const token = ctx.capturedVerifyTokens[ctx.capturedVerifyTokens.length - 1];
  assert.ok(token, 'Expected verification token to be dispatched on registration');
  const res = await worker.fetch(
    makeAuthPost('/api/auth/verify-email', { token }),
    ctx.env
  );
  assert.equal(res.status, 200);
}

function extractCookiePair(setCookie: string | null, name: string): string | null {
  if (!setCookie) return null;
  const firstPart = setCookie.split(';')[0]?.trim() ?? '';
  return firstPart.startsWith(`${name}=`) ? firstPart : null;
}

function makeAuthPost(
  pathname: string,
  body?: unknown,
  opts?: {
    origin?: string | null;
    xrw?: string | null;
    contentType?: string | null;
    cookie?: string;
    ip?: string;
    https?: boolean;
  }
): Request {
  const proto = opts?.https === false ? 'http' : 'https';
  const headers = new Headers();
  if (opts?.origin !== null) {
    headers.set('Origin', opts?.origin ?? 'https://eyvan.test');
  }
  if (opts?.xrw !== null) {
    headers.set('X-Requested-With', opts?.xrw ?? 'eyvan-client');
  }
  if (body !== undefined && opts?.contentType !== null) {
    headers.set('Content-Type', opts?.contentType ?? 'application/json');
  }
  if (opts?.cookie) {
    headers.set('Cookie', opts.cookie);
  }
  headers.set('CF-Connecting-IP', opts?.ip ?? '198.51.100.10');
  headers.set('User-Agent', 'EyvanTestAgent/1.0');

  return new Request(`${proto}://api.eyvan.test${pathname}`, {
    method: 'POST',
    headers,
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}

describe('Stage C1 — Central Account Registration, Login, Logout & Secure Sessions', () => {
  it('1. Password hashing uses PBKDF2-SHA256 (100k iterations), unique random salts, and versioned upgrade detection', async () => {
    const h1 = await hashPassword('SecretPass123');
    const h2 = await hashPassword('SecretPass123');

    assert.equal(h1.algo, CURRENT_PASSWORD_ALGO);
    assert.notEqual(h1.salt, h2.salt, 'Each password must get a fresh random salt');
    assert.notEqual(h1.hash, h2.hash);
    assert.equal(h1.hash.includes('SecretPass123'), false);

    const ok = await verifyPassword('SecretPass123', h1);
    assert.equal(ok.valid, true);
    assert.equal(ok.needsRehash, false);

    const wrong = await verifyPassword('WrongPass123', h1);
    assert.equal(wrong.valid, false);

    // Older iteration spec should still verify and flag `needsRehash = true`
    const legacy = await hashPassword('SecretPass123', 50_000);
    assert.equal(legacy.algo, 'pbkdf2_sha256:v1:50000');
    const legacyVerify = await verifyPassword('SecretPass123', legacy);
    assert.equal(legacyVerify.valid, true);
    assert.equal(legacyVerify.needsRehash, true);
  });

  it('2. Registers, verifies email, logs in with HttpOnly eyvan_auth_sess cookie, and never exposes raw token in JSON or DB', async () => {
    const ctx = createWorkerTestContext({ COOKIE_DOMAIN: '.eyvan.test' });
    try {
      const regRes = await worker.fetch(
        makeAuthPost('/api/auth/register', {
          email: 'Amir.Player@Example.com',
          username: 'Amir_Hero',
          password: 'StrongPassword99',
          confirmPassword: 'StrongPassword99',
        }),
        ctx.env
      );

      assert.equal(regRes.status, 201);
      assert.equal(regRes.headers.get('Cache-Control'), 'no-store, private');
      assert.equal(regRes.headers.get('Referrer-Policy'), 'no-referrer');
      assert.equal(regRes.headers.get('Set-Cookie'), null);

      const regBodyText = await regRes.text();
      assert.equal(regBodyText.includes('StrongPassword99'), false, 'Raw password must NEVER appear in API JSON');
      assert.equal(regBodyText.includes('password_hash'), false);

      const regJson = JSON.parse(regBodyText) as {
        ok: boolean;
        authenticated: boolean;
        verificationRequired: boolean;
        user: {
          userId: string;
          username: string;
          email: string;
          emailVerified: boolean;
          authProvider: string;
          accountStatus: string;
        };
      };
      assert.equal(regJson.ok, true);
      assert.equal(regJson.authenticated, false);
      assert.equal(regJson.verificationRequired, true);
      assert.ok(regJson.user.userId.startsWith('usr_'));
      assert.equal(regJson.user.username, 'Amir_Hero');
      assert.equal(regJson.user.email, 'Amir.Player@Example.com');
      assert.equal(regJson.user.emailVerified, false);
      assert.equal(regJson.user.authProvider, 'password');
      assert.equal(regJson.user.accountStatus, 'pending_verification');

      // Verify email, then sign in and check HttpOnly session cookie flags
      await verifyLatestRegisteredEmail(ctx);

      const loginRes = await worker.fetch(
        makeAuthPost('/api/auth/login', {
          identifier: 'Amir_Hero',
          password: 'StrongPassword99',
        }),
        ctx.env
      );
      assert.equal(loginRes.status, 200);
      assert.equal(loginRes.headers.get('Cache-Control'), 'no-store, private');

      const setCookie = loginRes.headers.get('Set-Cookie');
      assert.ok(setCookie, 'Login must emit Set-Cookie');
      assert.match(setCookie, /^eyvan_auth_sess=/);
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /Path=\//);
      assert.match(setCookie, /Domain=\.eyvan\.test/);
      assert.match(setCookie, /Secure/i);
      assert.match(setCookie, /SameSite=None/i);
      assert.match(setCookie, /Partitioned/i);
      assert.match(setCookie, /Max-Age=\d+/);

      const rawToken = parseAuthCookieFromHeader(setCookie);
      assert.ok(rawToken && rawToken.length >= 32);

      const loginBodyText = await loginRes.text();
      assert.equal(loginBodyText.includes(rawToken), false, 'Raw session token must NEVER appear in API JSON');
      assert.equal(loginBodyText.includes('StrongPassword99'), false);

      // Verify DB stores ONLY SHA-256 hash of session token (never raw token)
      const expectedHash = await sha256Hex(rawToken);
      const sessRow = ctx.rawDb
        .prepare(`SELECT session_id, user_id, token_hash, revoked_at FROM auth_sessions WHERE user_id = ?`)
        .get(regJson.user.userId) as {
        session_id: string;
        user_id: string;
        token_hash: string;
        revoked_at: number | null;
      };
      assert.equal(sessRow.token_hash, expectedHash);
      assert.notEqual(sessRow.token_hash, rawToken);
      assert.equal(sessRow.revoked_at, null);

      // Verify GET /api/auth/me validates cookie server-side
      const cookiePair = extractCookiePair(setCookie, AUTH_COOKIE_NAME)!;
      const meRes = await worker.fetch(
        new Request('https://api.eyvan.test/api/auth/me', {
          method: 'GET',
          headers: {
            Origin: 'https://eyvan.test',
            Cookie: cookiePair,
          },
        }),
        ctx.env
      );
      assert.equal(meRes.status, 200);
      const meJson = (await meRes.json()) as {
        authenticated: boolean;
        user: { userId: string; username: string };
      };
      assert.equal(meJson.authenticated, true);
      assert.equal(meJson.user.userId, regJson.user.userId);
      assert.equal(meJson.user.username, 'Amir_Hero');
    } finally {
      ctx.cleanup();
    }
  });

  it('3. Blocks duplicate email/username (case-insensitive) without leaking existing account details and rejects forbidden inputs', async () => {
    const ctx = createWorkerTestContext();
    try {
      const first = await worker.fetch(
        makeAuthPost('/api/auth/register', {
          email: 'sara@example.com',
          username: 'Sara_Game',
          password: 'ValidPassword1',
          confirmPassword: 'ValidPassword1',
        }),
        ctx.env
      );
      assert.equal(first.status, 201);

      // Duplicate email with different case
      const dupEmail = await worker.fetch(
        makeAuthPost('/api/auth/register', {
          email: 'SARA@EXAMPLE.COM',
          username: 'NewUser_99',
          password: 'ValidPassword1',
          confirmPassword: 'ValidPassword1',
        }),
        ctx.env
      );
      assert.equal(dupEmail.status, 409);
      const dupEmailJson = (await dupEmail.json()) as { code: string; message: string };
      assert.equal(dupEmailJson.code, 'ACCOUNT_CONFLICT');
      assert.equal(dupEmailJson.message.includes('sara@example.com'), false);

      // Duplicate username with different case -> must return identical non-enumerating code/message
      const dupUser = await worker.fetch(
        makeAuthPost('/api/auth/register', {
          email: 'other@example.com',
          username: 'sara_game',
          password: 'ValidPassword1',
          confirmPassword: 'ValidPassword1',
        }),
        ctx.env
      );
      assert.equal(dupUser.status, 409);
      const dupUserJson = (await dupUser.json()) as { code: string; message: string };
      assert.equal(dupUserJson.code, dupEmailJson.code);
      assert.equal(dupUserJson.message, dupEmailJson.message);

      // Reserved username & mismatched confirmPassword & weak password
      const reserved = await worker.fetch(
        makeAuthPost('/api/auth/register', {
          email: 'x@example.com',
          username: 'admin',
          password: 'ValidPassword1',
          confirmPassword: 'ValidPassword1',
        }),
        ctx.env
      );
      assert.equal(reserved.status, 400);

      const mismatch = await worker.fetch(
        makeAuthPost('/api/auth/register', {
          email: 'x2@example.com',
          username: 'GoodUser12',
          password: 'ValidPassword1',
          confirmPassword: 'OtherPassword2',
        }),
        ctx.env
      );
      assert.equal(mismatch.status, 400);

      const weak = await worker.fetch(
        makeAuthPost('/api/auth/register', {
          email: 'x3@example.com',
          username: 'GoodUser13',
          password: 'short',
          confirmPassword: 'short',
        }),
        ctx.env
      );
      assert.equal(weak.status, 400);
    } finally {
      ctx.cleanup();
    }
  });

  it('4. Logs in with email or username, rejects wrong password without enumeration, and enforces login rate limits', async () => {
    const ctx = createWorkerTestContext();
    try {
      const reg = await worker.fetch(
        makeAuthPost('/api/auth/register', {
          email: 'Kaveh@Example.com',
          username: 'Kaveh_77',
          password: 'MyPassword77',
          confirmPassword: 'MyPassword77',
        }),
        ctx.env
      );
      assert.equal(reg.status, 201);
      await verifyLatestRegisteredEmail(ctx);

      // Login with email (different case)
      const byEmail = await worker.fetch(
        makeAuthPost('/api/auth/login', {
          identifier: 'kaveh@example.com',
          password: 'MyPassword77',
        }),
        ctx.env
      );
      assert.equal(byEmail.status, 200);
      assert.ok(parseAuthCookieFromHeader(byEmail.headers.get('Set-Cookie')));

      // Login with username (different case)
      const byUsername = await worker.fetch(
        makeAuthPost('/api/auth/login', {
          identifier: 'KAVEH_77',
          password: 'MyPassword77',
        }),
        ctx.env
      );
      assert.equal(byUsername.status, 200);
      assert.ok(parseAuthCookieFromHeader(byUsername.headers.get('Set-Cookie')));

      // Unknown account vs wrong password must return identical status/code/message
      const unknownRes = await worker.fetch(
        makeAuthPost('/api/auth/login', {
          identifier: 'ghost_user@example.com',
          password: 'SomePassword99',
        }),
        ctx.env
      );
      assert.equal(unknownRes.status, 401);
      const unknownJson = (await unknownRes.json()) as { code: string; message: string };

      const wrongRes = await worker.fetch(
        makeAuthPost(
          '/api/auth/login',
          {
            identifier: 'kaveh_77',
            password: 'WrongPassword99',
          },
          { ip: '198.51.100.55' }
        ),
        ctx.env
      );
      assert.equal(wrongRes.status, 401);
      const wrongJson = (await wrongRes.json()) as { code: string; message: string };
      assert.equal(wrongJson.code, unknownJson.code);
      assert.equal(wrongJson.message, unknownJson.message);

      // 4 more failed attempts -> 5th triggers lockout, 6th gets 429 RATE_LIMITED with Retry-After
      for (let i = 0; i < 4; i += 1) {
        const failRes = await worker.fetch(
          makeAuthPost(
            '/api/auth/login',
            { identifier: 'kaveh_77', password: 'WrongPassword99' },
            { ip: '198.51.100.55' }
          ),
          ctx.env
        );
        assert.equal(failRes.status, 401);
      }

      const blockedRes = await worker.fetch(
        makeAuthPost(
          '/api/auth/login',
          { identifier: 'kaveh_77', password: 'MyPassword77' },
          { ip: '198.51.100.55' }
        ),
        ctx.env
      );
      assert.equal(blockedRes.status, 429);
      assert.ok(Number(blockedRes.headers.get('Retry-After')) > 0);
    } finally {
      ctx.cleanup();
    }
  });

  it('5. Rejects suspended/disabled accounts on login and immediately invalidates their active sessions', async () => {
    const ctx = createWorkerTestContext();
    try {
      const reg = await worker.fetch(
        makeAuthPost('/api/auth/register', {
          email: 'banned@example.com',
          username: 'Banned_One',
          password: 'Password123',
          confirmPassword: 'Password123',
        }),
        ctx.env
      );
      assert.equal(reg.status, 201);
      const regJson = (await reg.json()) as { user: { userId: string } };
      await verifyLatestRegisteredEmail(ctx);

      const initLogin = await worker.fetch(
        makeAuthPost('/api/auth/login', {
          identifier: 'banned@example.com',
          password: 'Password123',
        }),
        ctx.env
      );
      assert.equal(initLogin.status, 200);
      const cookiePair = extractCookiePair(initLogin.headers.get('Set-Cookie'), AUTH_COOKIE_NAME)!;

      // Suspend user in DB
      ctx.rawDb
        .prepare(`UPDATE users SET account_status = 'suspended' WHERE user_id = ?`)
        .run(regJson.user.userId);

      // Existing session must immediately be rejected & cleared on /api/auth/me
      const meRes = await worker.fetch(
        new Request('https://api.eyvan.test/api/auth/me', {
          method: 'GET',
          headers: { Cookie: cookiePair },
        }),
        ctx.env
      );
      assert.equal(meRes.status, 200);
      const meJson = (await meRes.json()) as { authenticated: boolean };
      assert.equal(meJson.authenticated, false);
      assert.match(meRes.headers.get('Set-Cookie') ?? '', /Max-Age=0/);

      // Login with valid password -> 403 ACCOUNT_DISABLED
      const loginRes = await worker.fetch(
        makeAuthPost('/api/auth/login', {
          identifier: 'banned@example.com',
          password: 'Password123',
        }),
        ctx.env
      );
      assert.equal(loginRes.status, 403);
      const loginJson = (await loginRes.json()) as { code: string };
      assert.equal(loginJson.code, 'ACCOUNT_DISABLED');

      // Login with wrong password -> still 401 INVALID_CREDENTIALS (no status probe)
      const badPwdRes = await worker.fetch(
        makeAuthPost('/api/auth/login', {
          identifier: 'banned@example.com',
          password: 'WrongPassword99',
        }),
        ctx.env
      );
      assert.equal(badPwdRes.status, 401);
    } finally {
      ctx.cleanup();
    }
  });

  it('6. Supports logout, server-side logout-all revocation, and session expiration', async () => {
    const ctx = createWorkerTestContext();
    try {
      const reg = await worker.fetch(
        makeAuthPost('/api/auth/register', {
          email: 'dara@example.com',
          username: 'Dara_Play',
          password: 'Password123',
          confirmPassword: 'Password123',
        }),
        ctx.env
      );
      assert.equal(reg.status, 201);
      await verifyLatestRegisteredEmail(ctx);

      const loginA = await worker.fetch(
        makeAuthPost('/api/auth/login', {
          identifier: 'dara@example.com',
          password: 'Password123',
        }),
        ctx.env
      );
      assert.equal(loginA.status, 200);
      const cookieA = extractCookiePair(loginA.headers.get('Set-Cookie'), AUTH_COOKIE_NAME)!;

      // Second login (device B)
      const loginB = await worker.fetch(
        makeAuthPost('/api/auth/login', {
          identifier: 'dara_play',
          password: 'Password123',
        }),
        ctx.env
      );
      assert.equal(loginB.status, 200);
      const cookieB = extractCookiePair(loginB.headers.get('Set-Cookie'), AUTH_COOKIE_NAME)!;

      // Logout device A -> revokes A only, B still works
      const logoutA = await worker.fetch(
        makeAuthPost('/api/auth/logout', undefined, { cookie: cookieA }),
        ctx.env
      );
      assert.equal(logoutA.status, 200);
      assert.match(logoutA.headers.get('Set-Cookie') ?? '', /eyvan_auth_sess=.*Max-Age=0/);

      const replayA = await worker.fetch(
        new Request('https://api.eyvan.test/api/auth/me', {
          method: 'GET',
          headers: { Cookie: cookieA },
        }),
        ctx.env
      );
      assert.equal(((await replayA.json()) as { authenticated: boolean }).authenticated, false);

      const stillValidB = await worker.fetch(
        new Request('https://api.eyvan.test/api/auth/me', {
          method: 'GET',
          headers: { Cookie: cookieB },
        }),
        ctx.env
      );
      assert.equal(((await stillValidB.json()) as { authenticated: boolean }).authenticated, true);

      // Login device C, then call logout-all from device B -> revokes BOTH B & C
      const loginC = await worker.fetch(
        makeAuthPost('/api/auth/login', {
          identifier: 'dara@example.com',
          password: 'Password123',
        }),
        ctx.env
      );
      const cookieC = extractCookiePair(loginC.headers.get('Set-Cookie'), AUTH_COOKIE_NAME)!;

      const logoutAll = await worker.fetch(
        makeAuthPost('/api/auth/logout-all', undefined, { cookie: cookieB }),
        ctx.env
      );
      assert.equal(logoutAll.status, 200);
      const logoutAllJson = (await logoutAll.json()) as { revokedCount: number };
      assert.equal(logoutAllJson.revokedCount, 2);

      const replayC = await worker.fetch(
        new Request('https://api.eyvan.test/api/auth/me', {
          method: 'GET',
          headers: { Cookie: cookieC },
        }),
        ctx.env
      );
      assert.equal(((await replayC.json()) as { authenticated: boolean }).authenticated, false);

      // Expiration check using explicit future clock on handleAuthHttpRequest
      const loginD = await worker.fetch(
        makeAuthPost('/api/auth/login', {
          identifier: 'dara@example.com',
          password: 'Password123',
        }),
        ctx.env
      );
      const cookieD = extractCookiePair(loginD.headers.get('Set-Cookie'), AUTH_COOKIE_NAME)!;
      const farFutureMs = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const expiredRes = await handleAuthHttpRequest(
        new Request('https://api.eyvan.test/api/auth/me', {
          method: 'GET',
          headers: { Cookie: cookieD },
        }),
        '/api/auth/me',
        {
          db: ctx.env.EYVAN_DB,
          corsHeaders: {},
          secureCookie: true,
          originAllowed: true,
          clientIp: '198.51.100.10',
          userAgent: 'Test',
          now: farFutureMs,
        }
      );
      assert.ok(expiredRes);
      assert.equal(((await expiredRes.json()) as { authenticated: boolean }).authenticated, false);
      assert.match(expiredRes.headers.get('Set-Cookie') ?? '', /Max-Age=0/);
    } finally {
      ctx.cleanup();
    }
  });

  it('7. Enforces CSRF headers, strict Origin allowlist, and JSON Content-Type on mutating auth endpoints', async () => {
    const ctx = createWorkerTestContext();
    try {
      // Missing X-Requested-With -> 403 CSRF_REJECTED
      const noXrw = await worker.fetch(
        makeAuthPost(
          '/api/auth/login',
          { identifier: 'a@b.com', password: 'Password123' },
          { xrw: null }
        ),
        ctx.env
      );
      assert.equal(noXrw.status, 403);
      assert.equal(((await noXrw.json()) as { code: string }).code, 'CSRF_REJECTED');

      // Disallowed Origin -> 403 FORBIDDEN_ORIGIN
      const badOrigin = await worker.fetch(
        makeAuthPost(
          '/api/auth/login',
          { identifier: 'a@b.com', password: 'Password123' },
          { origin: 'https://evil-attacker.example' }
        ),
        ctx.env
      );
      assert.equal(badOrigin.status, 403);
      assert.equal(((await badOrigin.json()) as { code: string }).code, 'FORBIDDEN_ORIGIN');

      // Non-JSON Content-Type -> 415
      const badCt = await worker.fetch(
        makeAuthPost(
          '/api/auth/register',
          'email=a@b.com',
          { contentType: 'application/x-www-form-urlencoded' }
        ),
        ctx.env
      );
      assert.equal(badCt.status, 415);

      // Logout without X-Requested-With -> 403 CSRF_REJECTED
      const logoutNoXrw = await worker.fetch(
        makeAuthPost('/api/auth/logout', undefined, { xrw: null }),
        ctx.env
      );
      assert.equal(logoutNoXrw.status, 403);
    } finally {
      ctx.cleanup();
    }
  });

  it('8. Keeps eyvan_auth_sess 100% independent of eyvan_hokm_sess and preserves Guest Hokm play without registration', async () => {
    const ctx = createWorkerTestContext();
    try {
      // A) Guest creates a Hokm room WITHOUT any central auth account/cookie
      const createRoomRes = await worker.fetch(
        new Request('https://api.eyvan.test/api/rooms', {
          method: 'POST',
          headers: {
            Origin: 'https://eyvan.test',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username: 'Guest_Hokm',
            avatarCode: 'portrait',
            targetMatchScore: 3,
          }),
        }),
        ctx.env
      );
      assert.equal(createRoomRes.status, 201);
      const hokmCookie = extractCookiePair(
        createRoomRes.headers.get('Set-Cookie'),
        SESSION_COOKIE_NAME
      );
      assert.ok(hokmCookie, 'Guest Hokm room must issue eyvan_hokm_sess without auth');

      // B) User registers, verifies email, and logs into central account -> gets eyvan_auth_sess
      const regRes = await worker.fetch(
        makeAuthPost('/api/auth/register', {
          email: 'independent@example.com',
          username: 'Indep_User',
          password: 'Password123',
          confirmPassword: 'Password123',
        }),
        ctx.env
      );
      assert.equal(regRes.status, 201);
      await verifyLatestRegisteredEmail(ctx);

      const loginRes = await worker.fetch(
        makeAuthPost('/api/auth/login', {
          identifier: 'independent@example.com',
          password: 'Password123',
        }),
        ctx.env
      );
      assert.equal(loginRes.status, 200);
      const authCookie = extractCookiePair(
        loginRes.headers.get('Set-Cookie'),
        AUTH_COOKIE_NAME
      )!;
      assert.ok(authCookie);

      // C) Logout central account while holding BOTH cookies -> clears ONLY eyvan_auth_sess
      const logoutAuthRes = await worker.fetch(
        makeAuthPost('/api/auth/logout', undefined, {
          cookie: `${authCookie}; ${hokmCookie}`,
        }),
        ctx.env
      );
      assert.equal(logoutAuthRes.status, 200);
      const logoutSetCookie = logoutAuthRes.headers.get('Set-Cookie') ?? '';
      assert.match(logoutSetCookie, /^eyvan_auth_sess=/);
      assert.equal(logoutSetCookie.includes(SESSION_COOKIE_NAME), false);

      // Hokm room session MUST STILL resume cleanly!
      const resumeHokmRes = await worker.fetch(
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
        ctx.env
      );
      assert.equal(resumeHokmRes.status, 200);

      // D) Re-login central account, then clear Hokm room cookie -> central auth session MUST STILL be valid!
      const reloginRes = await worker.fetch(
        makeAuthPost('/api/auth/login', {
          identifier: 'independent@example.com',
          password: 'Password123',
        }),
        ctx.env
      );
      const freshAuthCookie = extractCookiePair(
        reloginRes.headers.get('Set-Cookie'),
        AUTH_COOKIE_NAME
      )!;

      const clearHokmRes = await worker.fetch(
        new Request('https://api.eyvan.test/api/session/clear', {
          method: 'POST',
          headers: {
            Origin: 'https://eyvan.test',
            'X-Requested-With': 'eyvan-client',
            Cookie: `${freshAuthCookie}; ${hokmCookie}`,
          },
        }),
        ctx.env
      );
      assert.equal(clearHokmRes.status, 200);
      assert.equal(
        (clearHokmRes.headers.get('Set-Cookie') ?? '').includes(AUTH_COOKIE_NAME),
        false
      );

      const stillAuthed = await worker.fetch(
        new Request('https://api.eyvan.test/api/auth/me', {
          method: 'GET',
          headers: { Cookie: freshAuthCookie },
        }),
        ctx.env
      );
      assert.equal(((await stillAuthed.json()) as { authenticated: boolean }).authenticated, true);
    } finally {
      ctx.cleanup();
    }
  });
});
