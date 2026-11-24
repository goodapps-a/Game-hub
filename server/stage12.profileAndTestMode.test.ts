import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { AUTH_COOKIE_NAME } from '../cloudflare/src/lib/auth/authCookie';
import { EmailSender } from '../cloudflare/src/lib/auth/emailService';
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

async function createStage12Harness(shopTestMode: boolean) {
  const tmpDir = createTempDir('eyvan-stage12-');
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

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'eyvan-client',
      },
      body: JSON.stringify({
        identifier: email,
        password: 'EyvanStrong#2026',
      }),
    });
    assert.equal(loginRes.status, 200);
    const cookie = extractCookiePair(loginRes.headers.get('set-cookie'), AUTH_COOKIE_NAME);
    assert.ok(cookie, 'Expected auth cookie');

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: cookie },
    });
    const meJson = (await meRes.json()) as {
      ok: boolean;
      user: { userId: string; username: string; accountCode: string | null; bio?: string };
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

describe('Stage 12: Zero-Reg Test Mode, Profile Bio & Enriched Public Profile API', () => {
  it('blocks POST /api/auth/test-session with 403 FORBIDDEN_IN_LIVE_MODE when shopTestMode=false', async () => {
    const { baseUrl, cleanup } = await createStage12Harness(false);
    try {
      const res = await fetch(`${baseUrl}/api/auth/test-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 403);
      const body = (await res.json()) as { ok: boolean; code?: string };
      assert.equal(body.ok, false);
      assert.equal(body.code, 'FORBIDDEN_IN_LIVE_MODE');
    } finally {
      await cleanup();
    }
  });

  it('provisions a verified Test Mode account with 6-digit accountCode & HttpOnly cookie when shopTestMode=true', async () => {
    const { baseUrl, cleanup } = await createStage12Harness(true);
    try {
      const res = await fetch(`${baseUrl}/api/auth/test-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({}),
      });
      assert.ok(res.status === 200 || res.status === 201);
      const setCookie = res.headers.get('set-cookie');
      const cookie = extractCookiePair(setCookie, AUTH_COOKIE_NAME);
      assert.ok(cookie, 'Expected HttpOnly session cookie');
      assert.match(String(setCookie ?? ''), /HttpOnly/i);

      const body = (await res.json()) as {
        ok: boolean;
        user: {
          userId: string;
          username: string;
          accountCode: string | null;
          emailVerified: boolean;
          bio: string;
        };
      };
      assert.equal(body.ok, true);
      assert.equal(body.user.emailVerified, true);
      assert.match(String(body.user.accountCode ?? ''), /^[1-9]\d{5}$/);
      assert.equal(typeof body.user.bio, 'string');

      // Re-calling /api/auth/me with the cookie stays authenticated
      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: cookie },
      });
      assert.equal(meRes.status, 200);
      const meJson = (await meRes.json()) as {
        ok: boolean;
        authenticated: boolean;
        user?: { userId: string; accountCode: string | null };
      };
      assert.equal(meJson.authenticated, true);
      assert.equal(meJson.user?.userId, body.user.userId);
      assert.equal(meJson.user?.accountCode, body.user.accountCode);
    } finally {
      await cleanup();
    }
  });

  it('persists bio via PATCH /api/auth/profile, rejects >160 chars, and exposes enriched public profile without owner-only table skins', async () => {
    const { baseUrl, registerAndLogin, cleanup } = await createStage12Harness(true);
    try {
      const alice = await registerAndLogin('BioAlice', 'bio.alice@eyvan.test');
      const bob = await registerAndLogin('BioBob', 'bio.bob@eyvan.test');

      // Reject >160 char bio
      const tooLongRes = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Cookie: alice.cookie,
        },
        body: JSON.stringify({
          username: alice.user.username,
          avatarCode: 'portrait',
          bio: 'الف'.repeat(165),
        }),
      });
      assert.equal(tooLongRes.status, 400);

      // Save valid bio
      const bioText = 'حکم‌باز حرفه‌ای · طرفدار بازی تیمی منظم';
      const saveRes = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Cookie: alice.cookie,
        },
        body: JSON.stringify({
          username: alice.user.username,
          avatarCode: 'portrait',
          bio: bioText,
        }),
      });
      assert.equal(saveRes.status, 200);
      const saveJson = (await saveRes.json()) as {
        ok: boolean;
        user: { bio?: string };
      };
      assert.equal(saveJson.ok, true);
      assert.equal(saveJson.user.bio, bioText);

      // Claim a public cosmetic (badge) and an owner-only cosmetic (table skin)
      await fetch(`${baseUrl}/api/shop/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Cookie: alice.cookie,
        },
        body: JSON.stringify({ itemId: 'tt-turquoise' }),
      });

      // Bob inspects Alice's public profile
      const pubRes = await fetch(
        `${baseUrl}/api/users/${encodeURIComponent(alice.user.userId)}/public-profile`,
        { headers: { Cookie: bob.cookie } }
      );
      assert.equal(pubRes.status, 200);
      const pubJson = (await pubRes.json()) as {
        ok: boolean;
        profile: {
          userId: string;
          username: string;
          accountCode: string | null;
          bio: string;
          createdAt: number;
          collection: Array<{ itemId: string; kind: string }>;
          gameStats: Array<{ gameId: string; matchesPlayed: number; wins: number; losses: number }>;
          viewerRelationship: string;
        };
      };
      assert.equal(pubJson.ok, true);
      assert.equal(pubJson.profile.bio, bioText);
      assert.ok(pubJson.profile.createdAt > 0);
      assert.equal(pubJson.profile.viewerRelationship, 'none');
      assert.ok(Array.isArray(pubJson.profile.gameStats));
      assert.ok(pubJson.profile.gameStats.some((g) => g.gameId === 'hokm'));
      // Owner-only table_skin/table_background items must NOT leak into public collection
      assert.equal(
        pubJson.profile.collection.some(
          (item) => item.kind === 'table_skin' || item.kind === 'table_background'
        ),
        false
      );
    } finally {
      await cleanup();
    }
  });
});
