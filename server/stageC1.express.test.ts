import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import worker from '../cloudflare/src/index';
import { CfWorkerEnv } from '../cloudflare/src/lib/types';
import { AUTH_COOKIE_NAME } from '../cloudflare/src/lib/auth/authCookie';
import { EmailSender } from '../cloudflare/src/lib/auth/emailService';
import { REGISTER_IP_RATE_LIMIT } from '../cloudflare/src/lib/auth/rateLimit';
import { SESSION_COOKIE_NAME } from '../cloudflare/src/lib/sessionCookie';
import {
  ExpressAppConfig,
  createEyvanExpressApp,
} from './createExpressApp';
import { EyvanDatabase } from './database';
import { HokmRoomManager } from './roomManager';

interface ExpressTestHarness {
  baseUrl: string;
  db: EyvanDatabase;
  roomManager: HokmRoomManager;
  verifyTokens: string[];
  close: () => Promise<void>;
}

async function startExpressHarness(
  configOverrides?: Partial<ExpressAppConfig>
): Promise<ExpressTestHarness> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyvan-c1-express-'));
  const dbPath = path.join(tmpDir, 'express.sqlite');
  const db = new EyvanDatabase(dbPath);
  const roomManager = new HokmRoomManager({ db });
  const verifyTokens: string[] = [];

  const mockEmailSender: EmailSender = {
    async sendVerificationEmail(payload) {
      const hash = new URL(payload.verifyUrl).hash.replace(/^#/, '');
      const tok = new URLSearchParams(hash).get('verify-email');
      if (tok) verifyTokens.push(tok);
      return { configured: true, sent: true, provider: 'mock' };
    },
    async sendPasswordResetEmail() {
      return { configured: true, sent: true, provider: 'mock' };
    },
  };

  const { app } = createEyvanExpressApp({
    db,
    roomManager,
    emailSender: mockEmailSender,
    config: {
      isProduction: false,
      allowedOrigins: '',
      appUrl: '',
      trustedProxyIps: '',
      ...configOverrides,
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    db,
    roomManager,
    verifyTokens,
    close: async () => {
      roomManager.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

function extractCookiePair(setCookie: string | null, name: string): string | null {
  if (!setCookie) return null;
  const first = setCookie.split(';')[0]?.trim() ?? '';
  return first.startsWith(`${name}=`) ? first : null;
}

describe('Stage C1 Security Hardening — Direct Express HTTP, Worker Parity, Proxy IP & Atomic Rate Limit', () => {
  it('1. Express strictly blocks *.run.app wildcard, unauthorized Origins, null Origin, and cross-site Sec-Fetch-Site', async () => {
    const h = await startExpressHarness({
      isProduction: false,
      appUrl: 'https://eyvan-app-official.run.app',
    });
    try {
      // Malicious sibling Cloud Run domain MUST be rejected (no *.run.app suffix wildcard)
      const evilRunApp = await fetch(`${h.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          Origin: 'https://evil-tenant.run.app',
          'X-Requested-With': 'eyvan-client',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identifier: 'nobody', password: 'Password123' }),
      });
      assert.equal(evilRunApp.status, 403);
      assert.equal(evilRunApp.headers.get('access-control-allow-origin'), null);

      // OPTIONS preflight from unauthorized *.run.app domain MUST be rejected with 403
      const evilPreflight = await fetch(`${h.baseUrl}/api/auth/login`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil-tenant.run.app' },
      });
      assert.equal(evilPreflight.status, 403);

      // Sandboxed iframe `Origin: null` MUST be rejected
      const nullOrigin = await fetch(`${h.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          Origin: 'null',
          'X-Requested-With': 'eyvan-client',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identifier: 'nobody', password: 'Password123' }),
      });
      assert.equal(nullOrigin.status, 403);

      // Missing Origin + cross-site Sec-Fetch-Site MUST be rejected
      const crossSiteNoOrigin = await fetch(`${h.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Sec-Fetch-Site': 'cross-site',
          'X-Requested-With': 'eyvan-client',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identifier: 'nobody', password: 'Password123' }),
      });
      assert.equal(crossSiteNoOrigin.status, 403);

      // Missing Origin + untrusted Referer MUST be rejected
      const badReferer = await fetch(`${h.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          Referer: 'https://evil-phisher.example/steal',
          'X-Requested-With': 'eyvan-client',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identifier: 'nobody', password: 'Password123' }),
      });
      assert.equal(badReferer.status, 403);

      // Exact APP_URL is allowed and reflected cleanly (never `*`)
      const officialPreflight = await fetch(`${h.baseUrl}/api/auth/login`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://eyvan-app-official.run.app' },
      });
      assert.equal(officialPreflight.status, 204);
      assert.equal(
        officialPreflight.headers.get('access-control-allow-origin'),
        'https://eyvan-app-official.run.app'
      );
      assert.equal(
        officialPreflight.headers.get('access-control-allow-credentials'),
        'true'
      );
    } finally {
      await h.close();
    }
  });

  it('2. Production mode with empty ALLOWED_ORIGINS rejects localhost cross-origin in BOTH Express and Cloudflare Worker', async () => {
    const h = await startExpressHarness({
      isProduction: true,
      allowedOrigins: '',
      appUrl: '',
    });
    try {
      // Express in Production: external localhost port MUST be rejected, exact Same-Origin allowed
      const extLocalhost = await fetch(`${h.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          'X-Requested-With': 'eyvan-client',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identifier: 'x', password: 'Password123' }),
      });
      assert.equal(extLocalhost.status, 403);

      const sameOrigin = await fetch(`${h.baseUrl}/api/health`, {
        method: 'GET',
        headers: { Origin: h.baseUrl },
      });
      assert.equal(sameOrigin.status, 200);
      assert.equal(sameOrigin.headers.get('access-control-allow-origin'), h.baseUrl);

      // Cloudflare Worker in Production with empty ALLOWED_ORIGINS:
      const workerEnv: CfWorkerEnv = {
        EYVAN_DB: h.db.getD1Adapter(),
        EYVAN_ASSETS: { get: async () => null },
        ENVIRONMENT: 'production',
        ALLOWED_ORIGINS: '',
        HOKM_ROOM: {
          idFromName: (name: string) => name,
          get: () => ({ fetch: async () => new Response('{}') }),
        },
      };

      const workerEvilRun = await worker.fetch(
        new Request('https://api.eyvan.ir/api/auth/login', {
          method: 'POST',
          headers: {
            Origin: 'https://evil.run.app',
            'X-Requested-With': 'eyvan-client',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ identifier: 'x', password: 'Password123' }),
        }),
        workerEnv
      );
      assert.equal(workerEvilRun.status, 403);

      const workerLocalhostProd = await worker.fetch(
        new Request('https://api.eyvan.ir/api/auth/login', {
          method: 'POST',
          headers: {
            Origin: 'http://localhost:5173',
            'X-Requested-With': 'eyvan-client',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ identifier: 'x', password: 'Password123' }),
        }),
        workerEnv
      );
      assert.equal(workerLocalhostProd.status, 403);

      const workerSameOrigin = await worker.fetch(
        new Request('https://api.eyvan.ir/api/health', {
          method: 'GET',
          headers: { Origin: 'https://api.eyvan.ir' },
        }),
        workerEnv
      );
      assert.equal(workerSameOrigin.status, 200);
      assert.equal(
        workerSameOrigin.headers.get('access-control-allow-origin'),
        'https://api.eyvan.ir'
      );
    } finally {
      await h.close();
    }
  });

  it('3. Express ignores spoofed X-Forwarded-For by default and uses right-to-left parsing ONLY for TRUSTED_PROXY_IPS', async () => {
    const limit = REGISTER_IP_RATE_LIMIT.maxAttempts;

    // Part A: TRUSTED_PROXY_IPS unset -> attacker rotating X-Forwarded-For CANNOT bypass IP rate limit
    const hUntrusted = await startExpressHarness({
      isProduction: false,
      trustedProxyIps: '',
    });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < limit + 1; i += 1) {
        const res = await fetch(`${hUntrusted.baseUrl}/api/auth/register`, {
          method: 'POST',
          headers: {
            Origin: hUntrusted.baseUrl,
            'X-Requested-With': 'eyvan-client',
            'Content-Type': 'application/json',
            'X-Forwarded-For': `203.0.113.${i + 1}`,
          },
          body: JSON.stringify({
            email: `spoof${i}@example.com`,
            username: `spoof_user_${i}`,
            password: 'short', // triggers validation error after consuming IP slot
            confirmPassword: 'short',
          }),
        });
        statuses.push(res.status);
      }
      assert.deepEqual(
        statuses.slice(0, limit),
        Array.from({ length: limit }, () => 400)
      );
      assert.equal(
        statuses[limit],
        429,
        'Spoofed X-Forwarded-For must NOT bypass IP rate limit when TRUSTED_PROXY_IPS is empty'
      );
    } finally {
      await hUntrusted.close();
    }

    // Part B: TRUSTED_PROXY_IPS includes 127.0.0.1 -> right-to-left real client IP extraction
    const hTrusted = await startExpressHarness({
      isProduction: false,
      trustedProxyIps: '127.0.0.1, ::1',
    });
    try {
      // Attacker sends `forged-left, 198.51.100.44` repeatedly with changing leftmost forged IP
      const statusesA: number[] = [];
      for (let i = 0; i < limit + 1; i += 1) {
        const res = await fetch(`${hTrusted.baseUrl}/api/auth/register`, {
          method: 'POST',
          headers: {
            Origin: hTrusted.baseUrl,
            'X-Requested-With': 'eyvan-client',
            'Content-Type': 'application/json',
            // Rightmost non-trusted IP is always 198.51.100.44 despite forged leftmost IP rotating!
            'X-Forwarded-For': `10.0.0.${i + 1}, 198.51.100.44`,
          },
          body: JSON.stringify({
            email: `prox${i}@example.com`,
            username: `prox_user_${i}`,
            password: 'short',
            confirmPassword: 'short',
          }),
        });
        statusesA.push(res.status);
      }
      assert.deepEqual(
        statusesA.slice(0, limit),
        Array.from({ length: limit }, () => 400)
      );
      assert.equal(
        statusesA[limit],
        429,
        'Right-to-left XFF parsing must pin real client IP even when attacker rotates leftmost entry'
      );

      // A genuinely different client IP behind the same trusted proxy is NOT blocked
      const otherClient = await fetch(`${hTrusted.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          Origin: hTrusted.baseUrl,
          'X-Requested-With': 'eyvan-client',
          'Content-Type': 'application/json',
          'X-Forwarded-For': '198.51.100.99',
        },
        body: JSON.stringify({
          email: 'clean_client@example.com',
          username: 'clean_client_99',
          password: 'ValidPassword123',
          confirmPassword: 'ValidPassword123',
        }),
      });
      assert.equal(otherClient.status, 201);
    } finally {
      await hTrusted.close();
    }
  });

  it('4. Atomic Rate Limiting enforces strict cap under concurrent burst (10 parallel failed logins -> 5x401, 5x429) without penalizing valid logins', async () => {
    const h = await startExpressHarness({
      isProduction: false,
      trustedProxyIps: '127.0.0.1',
    });
    try {
      const regRes = await fetch(`${h.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          Origin: h.baseUrl,
          'X-Requested-With': 'eyvan-client',
          'Content-Type': 'application/json',
          'X-Forwarded-For': '198.51.100.10',
        },
        body: JSON.stringify({
          email: 'burst@example.com',
          username: 'burst_user',
          password: 'CorrectPassword123',
          confirmPassword: 'CorrectPassword123',
        }),
      });
      assert.equal(regRes.status, 201);
      const vTok = h.verifyTokens[h.verifyTokens.length - 1];
      assert.ok(vTok);
      const vRes = await fetch(`${h.baseUrl}/api/auth/verify-email`, {
        method: 'POST',
        headers: {
          Origin: h.baseUrl,
          'X-Requested-With': 'eyvan-client',
          'Content-Type': 'application/json',
          'X-Forwarded-For': '198.51.100.10',
        },
        body: JSON.stringify({ token: vTok }),
      });
      assert.equal(vRes.status, 200);

      // Verify 6 sequential VALID logins from the same IP do NOT trigger rate limit (slots released on success)
      for (let i = 0; i < 6; i += 1) {
        const okLogin = await fetch(`${h.baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: {
            Origin: h.baseUrl,
            'X-Requested-With': 'eyvan-client',
            'Content-Type': 'application/json',
            'X-Forwarded-For': '198.51.100.11',
          },
          body: JSON.stringify({
            identifier: 'burst_user',
            password: 'CorrectPassword123',
          }),
        });
        assert.equal(okLogin.status, 200, `Valid login #${i + 1} must succeed`);
      }

      // Launch 10 concurrent wrong-password attempts against the same account & IP
      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          fetch(`${h.baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: {
              Origin: h.baseUrl,
              'X-Requested-With': 'eyvan-client',
              'Content-Type': 'application/json',
              'X-Forwarded-For': '198.51.100.12',
            },
            body: JSON.stringify({
              identifier: 'burst_user',
              password: 'WrongPassword999',
            }),
          })
        )
      );

      const statuses = responses.map((r) => r.status).sort((a, b) => a - b);
      const count401 = statuses.filter((s) => s === 401).length;
      const count429 = statuses.filter((s) => s === 429).length;
      assert.equal(count401, 5, `Expected strictly 5 401s under concurrency, got ${JSON.stringify(statuses)}`);
      assert.equal(count429, 5, `Expected strictly 5 429s under concurrency, got ${JSON.stringify(statuses)}`);

      const firstBlocked = responses.find((r) => r.status === 429);
      assert.ok(firstBlocked);
      assert.ok(Number(firstBlocked.headers.get('retry-after')) >= 1);
    } finally {
      await h.close();
    }
  });

  it('5. Full Express auth lifecycle matches Worker parity and keeps guest Hokm room session completely independent', async () => {
    const h = await startExpressHarness({ isProduction: false });
    try {
      // Guest Hokm room creation still works with zero account
      const roomRes = await fetch(`${h.baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          Origin: h.baseUrl,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: 'GuestHokm', avatarCode: 'av_1' }),
      });
      assert.equal(roomRes.status, 201);
      const hokmCookie = extractCookiePair(roomRes.headers.get('set-cookie'), SESSION_COOKIE_NAME);
      assert.ok(hokmCookie);

      // Register, verify email, and log into central account over Express
      const regRes = await fetch(`${h.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          Origin: h.baseUrl,
          'X-Requested-With': 'eyvan-client',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'parity@example.com',
          username: 'Parity_Player',
          password: 'ParityPassword99',
          confirmPassword: 'ParityPassword99',
        }),
      });
      assert.equal(regRes.status, 201);
      assert.equal(regRes.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(regRes.headers.get('cache-control'), 'no-store, private');
      assert.equal(regRes.headers.get('set-cookie'), null);

      const verifyRes = await fetch(`${h.baseUrl}/api/auth/verify-email`, {
        method: 'POST',
        headers: {
          Origin: h.baseUrl,
          'X-Requested-With': 'eyvan-client',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: h.verifyTokens[0] }),
      });
      assert.equal(verifyRes.status, 200);

      const loginRes = await fetch(`${h.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          Origin: h.baseUrl,
          'X-Requested-With': 'eyvan-client',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          identifier: 'parity@example.com',
          password: 'ParityPassword99',
        }),
      });
      assert.equal(loginRes.status, 200);
      const setCookie = loginRes.headers.get('set-cookie');
      assert.ok(setCookie && /HttpOnly/i.test(setCookie));
      const authCookie = extractCookiePair(setCookie, AUTH_COOKIE_NAME);
      assert.ok(authCookie);

      // /api/auth/me authenticates using eyvan_auth_sess
      const meRes = await fetch(`${h.baseUrl}/api/auth/me`, {
        headers: { Cookie: `${hokmCookie}; ${authCookie}` },
      });
      assert.equal(meRes.status, 200);
      const meJson = (await meRes.json()) as { authenticated: boolean; user?: { username: string } };
      assert.equal(meJson.authenticated, true);
      assert.equal(meJson.user?.username, 'Parity_Player');

      // Logout clears ONLY eyvan_auth_sess — Hokm session still resumes!
      const logoutRes = await fetch(`${h.baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: {
          Origin: h.baseUrl,
          'X-Requested-With': 'eyvan-client',
          Cookie: `${hokmCookie}; ${authCookie}`,
        },
      });
      assert.equal(logoutRes.status, 200);
      const clearHeader = logoutRes.headers.get('set-cookie') ?? '';
      assert.ok(clearHeader.startsWith(`${AUTH_COOKIE_NAME}=`));
      assert.equal(clearHeader.includes(SESSION_COOKIE_NAME), false);

      const hokmResume = await fetch(`${h.baseUrl}/api/session/resume`, {
        method: 'POST',
        headers: {
          Origin: h.baseUrl,
          'X-Requested-With': 'eyvan-client',
          'Content-Type': 'application/json',
          Cookie: hokmCookie,
        },
        body: JSON.stringify({}),
      });
      assert.equal(hokmResume.status, 200);
    } finally {
      await h.close();
    }
  });
});
