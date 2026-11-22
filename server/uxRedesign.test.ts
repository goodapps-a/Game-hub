import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { AUTH_COOKIE_NAME } from '../cloudflare/src/lib/auth/authCookie';
import { EmailSender } from '../cloudflare/src/lib/auth/emailService';
import {
  applyLocalProfileEdit,
  applyServerProfileUpdate,
  computeWinRateSummary,
  computeXpProgress,
} from '../src/platform/utils/profileMetrics';
import {
  getFeaturedShopItems,
  getShopItemAvailability,
  getShopItemsByCategory,
} from '../src/platform/utils/shopHelpers';
import { ShopItem, UserProfile } from '../src/platform/types/platform';
import { createInitialGuestProfile } from '../src/platform/data/guestDefaults';
import { createEyvanExpressApp } from './createExpressApp';
import { EyvanDatabase } from './database';
import { HokmRoomManager } from './roomManager';

const SAMPLE_ITEMS: readonly ShopItem[] = [
  {
    id: 'item-deal',
    section: 'daily_deals',
    name: 'صندوق ویژه',
    subtitle: 'پیشنهاد روز',
    description: 'توضیح آزمایشی',
    price: 120,
    currency: 'gems',
    rarity: 'legendary',
    palette: ['#13294B', '#148A8A', '#F3D179'],
    motif: 'chest',
  },
  {
    id: 'item-default',
    section: 'card_backs',
    name: 'شمسه لاجوردی',
    subtitle: 'طرح پیش‌فرض',
    description: 'توضیح آزمایشی',
    price: 0,
    currency: 'coins',
    rarity: 'common',
    palette: ['#13294B', '#148A8A', '#D6B46A'],
    motif: 'shamsa',
    isDefaultOwned: true,
  },
  {
    id: 'item-coins',
    section: 'table_themes',
    name: 'شبستان لاجوردی',
    subtitle: 'پوسته میز',
    description: 'توضیح آزمایشی',
    price: 1800,
    currency: 'coins',
    rarity: 'rare',
    palette: ['#13294B', '#0B1A33', '#19A2A2'],
    motif: 'arch',
  },
];

function extractCookiePair(setCookie: string | null, name: string): string | null {
  if (!setCookie) return null;
  const first = setCookie.split(';')[0]?.trim() ?? '';
  return first.startsWith(`${name}=`) ? first : null;
}

describe('UX Redesign — Pure Profile & Shop Logic + Real Server Profile Endpoints', () => {
  it('1. Profile XP & Stats handle 0 games without fake 0% win rate and clamp edge denominators safely', () => {
    const xpZero = computeXpProgress(0, 100);
    assert.equal(xpZero.percent, 0);
    assert.equal(xpZero.remainingXp, 100);

    const xpBadDenom = computeXpProgress(45, 0);
    assert.equal(Number.isNaN(xpBadDenom.percent), false);
    assert.equal(xpBadDenom.percent, 45);

    const xpOverflow = computeXpProgress(240, 100);
    assert.equal(xpOverflow.percent, 100);
    assert.equal(xpOverflow.remainingXp, 0);

    const zeroStats = computeWinRateSummary({
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      rating: 1000,
    });
    assert.equal(zeroStats.hasGames, false);
    assert.equal(zeroStats.winRatePct, null);
    assert.equal(zeroStats.emptyLabel, 'هنوز بازی‌ای ثبت نشده');

    const realStats = computeWinRateSummary({
      gamesPlayed: 10,
      wins: 7,
      losses: 3,
      rating: 1180,
    });
    assert.equal(realStats.hasGames, true);
    assert.equal(realStats.winRatePct, 70);
    assert.equal(realStats.emptyLabel, null);
  });

  it('2. Editing username NEVER overwrites persistent user ID for guest or central accounts', () => {
    const guest: UserProfile = createInitialGuestProfile('dark');
    assert.equal(guest.id, 'guest_player');

    const editedGuest = applyLocalProfileEdit(guest, 'reza_hokm', 'turquoise');
    assert.equal(editedGuest.username, 'reza_hokm');
    assert.equal(editedGuest.avatarCode, 'turquoise');
    assert.equal(editedGuest.id, 'guest_player', 'Guest persistent ID must remain invariant');

    const serverSynced = applyServerProfileUpdate(editedGuest, {
      userId: 'usr_abc123def456',
      username: 'Sohrab_Pro',
      displayName: 'Sohrab_Pro',
      email: 'sohrab@example.com',
      emailVerified: true,
      avatarCode: 'jade',
      avatarUrl: null,
      authProvider: 'password',
      accountStatus: 'active',
      createdAt: 1000,
      lastSeenAt: 2000,
    });
    assert.equal(serverSynced.id, 'usr_abc123def456');
    assert.equal(serverSynced.username, 'Sohrab_Pro');
    assert.equal(serverSynced.avatarCode, 'jade');
  });

  it('3. Shop filtering & availability never fake purchases or hide insufficient balance', () => {
    assert.equal(getShopItemsByCategory(SAMPLE_ITEMS, 'all').length, 3);
    assert.equal(getShopItemsByCategory(SAMPLE_ITEMS, 'card_backs').length, 1);
    assert.equal(getShopItemsByCategory(SAMPLE_ITEMS, 'chests').length, 0);
    assert.equal(getFeaturedShopItems(SAMPLE_ITEMS).map((i) => i.id).join(','), 'item-deal');

    const ownedState = getShopItemAvailability(SAMPLE_ITEMS[1], 0, 0, false);
    assert.equal(ownedState.status, 'owned_default');
    assert.equal(ownedState.purchaseSupported, false);

    const poorState = getShopItemAvailability(SAMPLE_ITEMS[2], 500, 0, false);
    assert.equal(poorState.status, 'preview_insufficient');
    assert.equal(poorState.hasEnoughBalance, false);
    assert.equal(poorState.shortfall, 1300);
    assert.equal(poorState.purchaseSupported, false);

    const richPreviewState = getShopItemAvailability(SAMPLE_ITEMS[2], 3000, 200, false);
    assert.equal(richPreviewState.status, 'preview_affordable');
    assert.equal(richPreviewState.hasEnoughBalance, true);
    assert.equal(richPreviewState.purchaseSupported, false);
  });

  it('4. Server checks real DB username uniqueness & updates central profile preserving immutable userId', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyvan-ux-profile-'));
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
      config: { isProduction: false },
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      // Register user A & user B
      const regA = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({
          email: 'alpha@example.com',
          username: 'AlphaPlayer',
          password: 'Password123',
          confirmPassword: 'Password123',
        }),
      });
      assert.equal(regA.status, 201);

      const regB = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({
          email: 'beta@example.com',
          username: 'BetaPlayer',
          password: 'Password123',
          confirmPassword: 'Password123',
        }),
      });
      assert.equal(regB.status, 201);
      assert.equal(verifyTokens.length, 2);

      // Verify & login AlphaPlayer
      const verA = await fetch(`${baseUrl}/api/auth/verify-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({ token: verifyTokens[0] }),
      });
      assert.equal(verA.status, 200);

      const loginA = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({
          identifier: 'AlphaPlayer',
          password: 'Password123',
        }),
      });
      assert.equal(loginA.status, 200);
      const loginData = (await loginA.json()) as {
        ok: boolean;
        user: { userId: string; username: string };
      };
      const originalUserId = loginData.user.userId;
      const cookieA = extractCookiePair(loginA.headers.get('set-cookie'), AUTH_COOKIE_NAME);
      assert.ok(cookieA);

      // Unauthenticated availability check reports BetaPlayer as taken (case-insensitive)
      const anonTaken = await fetch(
        `${baseUrl}/api/auth/username-availability?username=betaplayer`
      );
      const anonTakenJson = (await anonTaken.json()) as {
        ok: boolean;
        valid: boolean;
        available: boolean;
        reason: string;
      };
      assert.equal(anonTakenJson.valid, true);
      assert.equal(anonTakenJson.available, false);
      assert.equal(anonTakenJson.reason, 'taken');

      // Reserved username rejected as invalid
      const reservedRes = await fetch(
        `${baseUrl}/api/auth/username-availability?username=admin`
      );
      const reservedJson = (await reservedRes.json()) as {
        valid: boolean;
        available: boolean;
        reason: string;
      };
      assert.equal(reservedJson.valid, false);
      assert.equal(reservedJson.available, false);

      // Authenticated user checking their OWN current username -> available ('current_user')
      const selfRes = await fetch(
        `${baseUrl}/api/auth/username-availability?username=AlphaPlayer`,
        { headers: { Cookie: cookieA } }
      );
      const selfJson = (await selfRes.json()) as {
        valid: boolean;
        available: boolean;
        reason: string;
      };
      assert.equal(selfJson.valid, true);
      assert.equal(selfJson.available, true);
      assert.equal(selfJson.reason, 'current_user');

      // Free username -> available
      const freeRes = await fetch(
        `${baseUrl}/api/auth/username-availability?username=Alpha_Updated`
      );
      const freeJson = (await freeRes.json()) as {
        valid: boolean;
        available: boolean;
        reason: string;
      };
      assert.equal(freeJson.valid, true);
      assert.equal(freeJson.available, true);
      assert.equal(freeJson.reason, 'available');

      // Profile update without CSRF header MUST fail 403
      const noCsrf = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieA },
        body: JSON.stringify({ username: 'Alpha_Updated', avatarCode: 'turquoise' }),
      });
      assert.equal(noCsrf.status, 403);

      // Profile update colliding with BetaPlayer MUST fail 409 & preserve AlphaPlayer
      const conflictRes = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Cookie: cookieA,
        },
        body: JSON.stringify({ username: 'betaplayer', avatarCode: 'turquoise' }),
      });
      assert.equal(conflictRes.status, 409);

      // Valid profile update persists to DB & keeps permanent userId unchanged
      const updateRes = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Cookie: cookieA,
        },
        body: JSON.stringify({ username: 'Alpha_Updated', avatarCode: 'turquoise' }),
      });
      assert.equal(updateRes.status, 200);
      const updatedJson = (await updateRes.json()) as {
        ok: boolean;
        user: { userId: string; username: string; avatarCode: string };
      };
      assert.equal(updatedJson.user.userId, originalUserId);
      assert.equal(updatedJson.user.username, 'Alpha_Updated');
      assert.equal(updatedJson.user.avatarCode, 'turquoise');

      // `/api/auth/me` returns updated username & avatar with SAME userId
      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: cookieA },
      });
      const meJson = (await meRes.json()) as {
        authenticated: boolean;
        user: { userId: string; username: string; avatarCode: string };
      };
      assert.equal(meJson.authenticated, true);
      assert.equal(meJson.user.userId, originalUserId);
      assert.equal(meJson.user.username, 'Alpha_Updated');
      assert.equal(meJson.user.avatarCode, 'turquoise');
    } finally {
      roomManager.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
