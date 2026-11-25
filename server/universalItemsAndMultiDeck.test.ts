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
import {
  BASE_UNIVERSAL_ITEMS,
  buildPublicAppearanceFromSlots,
  getDefaultPublicAppearance,
} from '../src/platform/items/catalogData';
import type { UniversalItemDefinition } from '../src/platform/items/itemTypes';
import { claimShopItemForUser } from '../cloudflare/src/lib/items/inventoryService';
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1RunResult,
} from '../cloudflare/src/lib/types';
import {
  filterCatalogItems,
  paginateCatalogItems,
} from '../src/platform/utils/shopHelpers';
import { HokmRoomController } from '../src/games/hokm/online/roomController';
import {
  DeckCatalogEntry,
  DeckManifest,
  DeckRuntimeManager,
  DeckStorageManager,
  DeckSystemError,
  EYVAN_CLASSIC_DECK_ID,
  InMemoryDeckBlobStore,
  IndexedDBDeckBlobStore,
  StoredDeckAsset,
  computeSha256Hex,
  makeAssetCompositeKey,
  validateDeckManifest,
} from '../src/platform/decks';
import { createInitialGuestProfile } from '../src/platform/data/guestDefaults';
import { applyServiceWorkerUpdateWhenSafe } from '../src/platform/pwa/registerSw';
import { createStandardDeck } from '../src/games/hokm/engine/deck';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function extractCookiePair(setCookie: string | null, name: string): string | null {
  if (!setCookie) return null;
  const first = setCookie.split(';')[0]?.trim() ?? '';
  return first.startsWith(`${name}=`) ? first : null;
}

const TINY_SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140"><rect width="100" height="140" fill="#13294B"/></svg>'
);

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy.buffer;
}

async function createItemsTestHarness(prefix: string, shopTestMode: boolean) {
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
      shopTestMode,
    },
    emailSender: mockEmailSender,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const registerAndVerify = async (username: string, email: string) => {
    const tokenCountBefore = verifyTokens.length;
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
    const verifyToken = verifyTokens[tokenCountBefore];
    assert.ok(verifyToken, 'Expected email verification token');
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
        identifier: username,
        password: 'EyvanStrong#2026',
      }),
    });
    assert.equal(loginRes.status, 200);
    const loginData = (await loginRes.json()) as {
      ok: boolean;
      user?: { userId: string; username: string };
    };
    const cookie = extractCookiePair(loginRes.headers.get('set-cookie'), AUTH_COOKIE_NAME);
    assert.ok(cookie, 'Expected session cookie from login');
    assert.ok(loginData.user, 'Expected user object from login');

    return {
      userId: loginData.user.userId,
      username: loginData.user.username,
      cookie,
    };
  };

  const cleanup = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };

  return { db, roomManager, baseUrl, registerAndVerify, cleanup };
}

describe('Universal Items, Ownership, Multi-Deck Concurrency, Test Mode & PWA', () => {
  it('1. Ownership & Security: zero starting balance, server-authoritative claim/equip/unequip, idempotency, and owner_only privacy', async () => {
    const guest = createInitialGuestProfile('dark');
    assert.equal(guest.coins, 0);
    assert.equal(guest.gems, 0);

    const h = await createItemsTestHarness('eyvan-items-sec-', true);
    try {
      const alice = await h.registerAndVerify('AliceDeck', 'alice.deck@example.com');
      const bob = await h.registerAndVerify('BobDeck', 'bob.deck@example.com');

      // Initial server wallet is strictly 0 coins & 0 gems
      const invRes0 = await fetch(`${h.baseUrl}/api/inventory`, {
        headers: { Cookie: alice.cookie },
      });
      const inv0 = (await invRes0.json()) as {
        ok: boolean;
        coins: number;
        gems: number;
        ownedItemIds: string[];
        equippedSlots: Record<string, string>;
      };
      assert.equal(invRes0.status, 200);
      assert.equal(inv0.coins, 0);
      assert.equal(inv0.gems, 0);
      assert.ok(inv0.ownedItemIds.includes('deck-eyvan-classic'));
      assert.ok(inv0.ownedItemIds.includes('tt-traditional'));

      // Unowned equip is rejected (403)
      const unownedEquip = await fetch(`${h.baseUrl}/api/inventory/equip`, {
        method: 'POST',
        headers: {
          Cookie: alice.cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({ itemId: 'tt-tabriz', slot: 'table_skin' }),
      });
      assert.equal(unownedEquip.status, 403);

      // Idempotent chest claim grants coins strictly once per requestId even under forged payload price/coins
      const chestReqId = 'req_chest_once_123';
      const chestClaim1 = await fetch(`${h.baseUrl}/api/shop/claim`, {
        method: 'POST',
        headers: {
          Cookie: alice.cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({
          itemId: 'dd-gold-chest',
          requestId: chestReqId,
          coins: 9999999,
          price: -500,
        }),
      });
      const c1Json = (await chestClaim1.json()) as {
        ok: boolean;
        effectivePrice: number;
        grantedCoins: number;
        inventory: { coins: number };
      };
      assert.equal(chestClaim1.status, 200);
      assert.equal(c1Json.effectivePrice, 0);
      assert.equal(c1Json.grantedCoins, 5000);
      assert.equal(c1Json.inventory.coins, 5000);

      const chestClaim2 = await fetch(`${h.baseUrl}/api/shop/claim`, {
        method: 'POST',
        headers: {
          Cookie: alice.cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({
          itemId: 'dd-gold-chest',
          requestId: chestReqId,
        }),
      });
      const c2Json = (await chestClaim2.json()) as {
        ok: boolean;
        deduplicated: boolean;
        inventory: { coins: number };
      };
      assert.equal(c2Json.deduplicated, true);
      assert.equal(c2Json.inventory.coins, 5000);

      // Claim & equip BOTH owner_only (table_skin) and public_profile/gameplay items
      for (const [itemId, slot] of [
        ['tt-tabriz', 'table_skin'],
        ['af-crown-frame', 'avatar_frame'],
        ['af-cypress-seal', 'profile_badge'],
        ['cb-royal-peacock', 'card_back'],
        ['deck-public-domain-cc0', 'card_deck'],
      ] as const) {
        const cr = await fetch(`${h.baseUrl}/api/shop/claim`, {
          method: 'POST',
          headers: {
            Cookie: alice.cookie,
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
          },
          body: JSON.stringify({ itemId, requestId: `req_${itemId}` }),
        });
        assert.equal(cr.status, 200);
        const er = await fetch(`${h.baseUrl}/api/inventory/equip`, {
          method: 'POST',
          headers: {
            Cookie: alice.cookie,
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
          },
          body: JSON.stringify({ itemId, slot }),
        });
        assert.equal(er.status, 200);
      }

      // Public profile strictly strips owner_only fields (table_skin, table_background), email, wallet, ownedItemIds
      const pubRes = await fetch(
        `${h.baseUrl}/api/users/${encodeURIComponent(alice.userId)}/public-profile`,
        { headers: { Cookie: bob.cookie } }
      );
      const pubJson = (await pubRes.json()) as {
        ok: boolean;
        profile: Record<string, unknown> & { appearance: Record<string, unknown> };
      };
      assert.equal(pubRes.status, 200);
      assert.equal(pubJson.profile.appearance.avatarFrameId, 'af-crown-frame');
      assert.equal(pubJson.profile.appearance.badgeId, 'af-cypress-seal');
      assert.equal(pubJson.profile.appearance.cardBackId, 'cb-royal-peacock');
      assert.equal(pubJson.profile.appearance.deckId, 'public-domain-cc0');
      const serializedPub = JSON.stringify(pubJson);
      assert.equal(serializedPub.includes('tt-tabriz'), false);
      assert.equal(serializedPub.includes('tableSkin'), false);
      assert.equal(serializedPub.includes('table_skin'), false);
      assert.equal(serializedPub.includes('alice.deck@example.com'), false);
      assert.equal(serializedPub.includes('"coins"'), false);
      assert.equal(serializedPub.includes('"ownedItemIds"'), false);

      // BuildPublicAppearance helper strips table_skin too
      const publicOnly = buildPublicAppearanceFromSlots({
        table_skin: 'tt-tabriz',
        card_deck: 'deck-public-domain-cc0',
        avatar_frame: 'af-crown-frame',
      });
      assert.equal(JSON.stringify(publicOnly).includes('tt-tabriz'), false);

      // Unequip nullable slot removes it; unequip mandatory slot falls back to default
      const unqFrame = await fetch(`${h.baseUrl}/api/inventory/unequip`, {
        method: 'POST',
        headers: {
          Cookie: alice.cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({ slot: 'avatar_frame' }),
      });
      const unqFrameJson = (await unqFrame.json()) as {
        ok: boolean;
        inventory: { equippedSlots: Record<string, string | undefined> };
      };
      assert.equal(unqFrame.status, 200);
      assert.equal(unqFrameJson.inventory.equippedSlots.avatar_frame, undefined);

      const unqTable = await fetch(`${h.baseUrl}/api/inventory/unequip`, {
        method: 'POST',
        headers: {
          Cookie: alice.cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({ slot: 'table_skin' }),
      });
      const unqTableJson = (await unqTable.json()) as {
        ok: boolean;
        inventory: { equippedSlots: Record<string, string | undefined> };
      };
      assert.equal(unqTableJson.inventory.equippedSlots.table_skin, 'tt-traditional');
    } finally {
      await h.cleanup();
    }
  });

  it('2. Real-Economy Pricing Enforcement when SHOP_TEST_MODE=false (rejects insufficient funds 402, deducts exact price)', async () => {
    const h = await createItemsTestHarness('eyvan-items-prod-', false);
    try {
      const user = await h.registerAndVerify('ProdBuyer', 'prod.buyer@example.com');

      // With 0 balance, purchasing 1,800-coin table skin must fail with 402 INSUFFICIENT_FUNDS
      const failBuy = await fetch(`${h.baseUrl}/api/shop/claim`, {
        method: 'POST',
        headers: {
          Cookie: user.cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({ itemId: 'tt-lapis', requestId: 'req_fail_1' }),
      });
      const failJson = (await failBuy.json()) as { ok: boolean; code: string };
      assert.equal(failBuy.status, 402);
      assert.equal(failJson.code, 'INSUFFICIENT_FUNDS');

      // Grant server-side coins directly in DB to simulate earned currency & purchase tt-lapis (1800)
      h.db
        .getD1Adapter()
        .prepare(`UPDATE user_wallets SET coins = 2500 WHERE user_id = ?`)
        .bind(user.userId)
        .run();

      const okBuy = await fetch(`${h.baseUrl}/api/shop/claim`, {
        method: 'POST',
        headers: {
          Cookie: user.cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({ itemId: 'tt-lapis', requestId: 'req_ok_1' }),
      });
      const okJson = (await okBuy.json()) as {
        ok: boolean;
        effectivePrice: number;
        inventory: { coins: number; ownedItemIds: string[] };
      };
      assert.equal(okBuy.status, 200);
      assert.equal(okJson.effectivePrice, 1800);
      assert.equal(okJson.inventory.coins, 700);
      assert.ok(okJson.inventory.ownedItemIds.includes('tt-lapis'));
    } finally {
      await h.cleanup();
    }
  });

  it('3. Concurrent Per-Player Multi-Deck in HokmRoomController & DeckRuntimeManager + Seat Appearance Privacy', async () => {
    const ctrl = new HokmRoomController({
      roomId: 'room_multi4',
      roomCode: 'MULTI4',
      targetMatchScore: 3,
    });
    ctrl.joinPlayer({
      playerId: 'p_south',
      username: 'SouthPlayer',
      avatarCode: 'portrait',
      appearance: {
        deckId: 'deck-alpha',
        cardBackId: 'cb-shamsa',
        avatarFrameId: 'af-gold-arch',
      },
    });
    ctrl.joinPlayer({
      playerId: 'p_east',
      username: 'EastPlayer',
      avatarCode: 'turquoise',
      appearance: {
        deckId: 'deck-beta',
        cardBackId: 'cb-kashan',
        badgeId: 'af-cypress-seal',
      },
    });
    ctrl.joinPlayer({
      playerId: 'p_north',
      username: 'NorthPlayer',
      avatarCode: 'lapis',
      appearance: {
        deckId: 'deck-gamma',
        cardBackId: 'cb-isfahan-gold',
      },
    });
    ctrl.joinPlayer({
      playerId: 'p_west',
      username: 'WestPlayer',
      avatarCode: 'jade',
      appearance: {
        deckId: 'deck-delta',
        cardBackId: 'cb-royal-peacock',
      },
    });

    const snapForSouth = ctrl.getSnapshotForPlayer('p_south');
    assert.ok(snapForSouth);
    const byName = new Map(snapForSouth.seats.map((s) => [s.username, s.appearance]));
    assert.equal(byName.get('SouthPlayer')?.deckId, 'deck-alpha');
    assert.equal(byName.get('EastPlayer')?.deckId, 'deck-beta');
    assert.equal(byName.get('NorthPlayer')?.deckId, 'deck-gamma');
    assert.equal(byName.get('WestPlayer')?.deckId, 'deck-delta');
    assert.equal(byName.get('SouthPlayer')?.avatarFrameId, 'af-gold-arch');
    assert.equal(byName.get('EastPlayer')?.badgeId, 'af-cypress-seal');
    // Zero table_skin leak
    assert.equal(JSON.stringify(snapForSouth).includes('tableSkin'), false);

    // Verify DeckRuntimeManager holds 4 distinct decks concurrently & releases non-equipped room decks cleanly
    const store = new InMemoryDeckBlobStore();
    const storage = new DeckStorageManager(store);
    const runtime = new DeckRuntimeManager(storage);
    const hSvg = await computeSha256Hex(toArrayBuffer(TINY_SVG));

    const makeDeck = (id: string) => {
      const manifest: DeckManifest = {
        id,
        version: '1.0.0',
        schemaVersion: 1,
        name: id,
        description: id,
        author: 'QA',
        sourceUrl: '',
        license: 'CC0',
        aspectRatio: 0.71,
        renderMode: 'partial_override',
        format: 'svg',
        styleTokens: {
          cardBackground: '#FFFFFF',
          cardBorderColor: '#CCCCCC',
          imageFit: 'contain',
        },
        back: {
          path: 'back.svg',
          hash: hSvg,
          bytes: TINY_SVG.byteLength,
          mimeType: 'image/svg+xml',
        },
        cards: {
          'spades-A': {
            path: 'spades-A.svg',
            hash: hSvg,
            bytes: TINY_SVG.byteLength,
            mimeType: 'image/svg+xml',
          },
        },
        totalBytes: TINY_SVG.byteLength * 2,
      };
      const entry: DeckCatalogEntry = {
        id,
        version: '1.0.0',
        schemaVersion: 1,
        name: id,
        subtitle: id,
        description: id,
        author: 'QA',
        sourceUrl: '',
        license: 'CC0',
        manifestPath: `${id}/manifest.json`,
        previewPath: '',
        previewMimeType: 'image/svg+xml',
        aspectRatio: 0.71,
        renderMode: 'partial_override',
        format: 'svg',
        totalBytes: TINY_SVG.byteLength * 2,
        cardCount: 1,
        pricing: { access: 'free', price: 0, currency: 'coins', rarity: 'common' },
      };
      return { manifest, entry };
    };

    const decks = ['deck-alpha', 'deck-beta', 'deck-gamma', 'deck-delta'].map(makeDeck);
    const files = new Map<string, Uint8Array>();
    for (const d of decks) {
      files.set(`/decks/${d.manifest.id}/manifest.json`, new TextEncoder().encode(JSON.stringify(d.manifest)));
      files.set(`/decks/${d.manifest.id}/back.svg`, TINY_SVG);
      files.set(`/decks/${d.manifest.id}/spades-A.svg`, TINY_SVG);
    }
    const mockFetch: typeof fetch = async (url) => {
      const payload = files.get(String(url));
      return payload
        ? new Response(toArrayBuffer(payload), { status: 200 })
        : new Response('Not found', { status: 404 });
    };

    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;
    let urlSeq = 0;
    URL.createObjectURL = () => `blob:multi/${++urlSeq}`;
    URL.revokeObjectURL = () => {};

    try {
      for (const d of decks) {
        await storage.installOrUpdateDeck({
          entry: d.entry,
          baseUrl: '/decks',
          fetchImpl: mockFetch,
        });
      }

      await runtime.activateDeck('deck-alpha');
      await Promise.all([
        runtime.loadDeck('deck-beta', 'room_seat'),
        runtime.loadDeck('deck-gamma', 'room_seat'),
        runtime.loadDeck('deck-delta', 'room_seat'),
      ]);

      assert.equal(runtime.isDeckLoaded('deck-alpha'), true);
      assert.equal(runtime.isDeckLoaded('deck-beta'), true);
      assert.equal(runtime.isDeckLoaded('deck-gamma'), true);
      assert.equal(runtime.isDeckLoaded('deck-delta'), true);
      assert.equal(runtime.getDeckState('deck-beta').deckId, 'deck-beta');
      assert.equal(runtime.getDeckState('deck-gamma').deckId, 'deck-gamma');

      runtime.releaseRoomDecks(new Set(['deck-alpha']));
      assert.equal(runtime.isDeckLoaded('deck-alpha'), true);
      assert.equal(runtime.isDeckLoaded('deck-beta'), false);
      assert.equal(runtime.isDeckLoaded('deck-gamma'), false);
      assert.equal(runtime.isDeckLoaded('deck-delta'), false);
    } finally {
      runtime.disposeAll();
      URL.createObjectURL = origCreateObjectURL;
      URL.revokeObjectURL = origRevokeObjectURL;
    }
  });

  it('4. Shop Catalog Scalability (1,200+ items search/filter/paginate), Strict Full-Card Validation, Rollback & Safe SW Deferral', async () => {
    // 4A) 1,200+ item scale test
    const massiveCatalog: UniversalItemDefinition[] = [...BASE_UNIVERSAL_ITEMS];
    for (let i = 0; i < 1200; i++) {
      massiveCatalog.push({
        id: `scale-item-${i}`,
        kind: i % 2 === 0 ? 'card_back' : 'avatar_frame',
        slot: i % 2 === 0 ? 'card_back' : 'avatar_frame',
        visibilityScope: 'public_profile',
        section: i % 2 === 0 ? 'card_backs' : 'avatars_frames',
        name: `آیتم آزمایشی شماره ${i}`,
        subtitle: `زیرعنوان شماره ${i}`,
        description: `توضیحات کامل کلکسیون ${i}`,
        price: 100 + i,
        currency: 'coins',
        rarity: i % 4 === 0 ? 'legendary' : i % 3 === 0 ? 'epic' : 'rare',
        palette: ['#13294B', '#148A8A', '#F3D179'],
        motif: 'shamsa',
        isEquippable: true,
        isClaimable: true,
        tags: ['scale', i % 5 === 0 ? 'special_tag' : 'standard'],
      });
    }

    const t0 = performance.now();
    const filtered = filterCatalogItems({
      items: massiveCatalog,
      searchQuery: 'special_tag',
      rarity: 'legendary',
      ownershipFilter: 'unowned',
      ownedItemIds: ['scale-item-0'],
    });
    const page1 = paginateCatalogItems(filtered, 1, 24);
    const elapsedMs = performance.now() - t0;

    assert.ok(elapsedMs < 100, `Expected 1200-item filter+paginate < 100ms, got ${elapsedMs}ms`);
    assert.equal(page1.visibleItems.length, 24);
    assert.equal(page1.hasMore, true);
    assert.ok(page1.totalCount >= 50);

    // 4B) Validator rejects missing cards in full_card mode and duplicate card paths
    const fullCards = createStandardDeck();
    const partialMap: Record<string, { path: string; hash: string; bytes: number; mimeType: 'image/svg+xml' }> = {};
    for (const card of fullCards.slice(0, 51)) {
      const k = `${card.suit}-${card.rank}`;
      partialMap[k] = {
        path: `cards/${k}.svg`,
        hash: 'a'.repeat(64),
        bytes: 64,
        mimeType: 'image/svg+xml',
      };
    }
    assert.throws(
      () =>
        validateDeckManifest({
          id: 'missing-one-card',
          version: '1.0.0',
          schemaVersion: 1,
          name: 'Incomplete',
          description: 'Incomplete full deck',
          author: 'QA',
          sourceUrl: '',
          license: 'CC0',
          aspectRatio: 0.71,
          renderMode: 'full_card',
          format: 'svg',
          styleTokens: {
            cardBackground: '#FFF',
            cardBorderColor: '#CCC',
            imageFit: 'contain',
          },
          back: { path: 'back.svg', hash: 'b'.repeat(64), bytes: 64, mimeType: 'image/svg+xml' },
          cards: partialMap,
          totalBytes: 1000,
        }),
      (e: unknown) => e instanceof DeckSystemError && e.code === 'INVALID_MANIFEST'
    );

    const dupCardsMap = { ...partialMap };
    dupCardsMap['spades-A'] = {
      path: 'cards/hearts-2.svg', // duplicate path!
      hash: 'a'.repeat(64),
      bytes: 64,
      mimeType: 'image/svg+xml',
    };
    assert.throws(
      () =>
        validateDeckManifest({
          id: 'dup-paths',
          version: '1.0.0',
          schemaVersion: 1,
          name: 'Dup Paths',
          description: 'Duplicate asset path test',
          author: 'QA',
          sourceUrl: '',
          license: 'CC0',
          aspectRatio: 0.71,
          renderMode: 'full_card',
          format: 'svg',
          styleTokens: {
            cardBackground: '#FFF',
            cardBorderColor: '#CCC',
            imageFit: 'contain',
          },
          back: { path: 'back.svg', hash: 'b'.repeat(64), bytes: 64, mimeType: 'image/svg+xml' },
          cards: dupCardsMap,
          totalBytes: 1000,
        }),
      (e: unknown) => e instanceof DeckSystemError && e.code === 'INVALID_MANIFEST'
    );

    // 4C) Atomic install/update rollback keeps existing v1 intact on v2 failure
    const store = new InMemoryDeckBlobStore();
    const storage = new DeckStorageManager(store);
    const hSvg = await computeSha256Hex(toArrayBuffer(TINY_SVG));
    const v1Manifest: DeckManifest = {
      id: 'rollback-deck',
      version: '1.0.0',
      schemaVersion: 1,
      name: 'Rollback Deck',
      description: 'v1',
      author: 'QA',
      sourceUrl: '',
      license: 'CC0',
      aspectRatio: 0.71,
      renderMode: 'partial_override',
      format: 'svg',
      styleTokens: { cardBackground: '#FFFFFF', cardBorderColor: '#CCCCCC', imageFit: 'contain' },
      back: { path: 'back.svg', hash: hSvg, bytes: TINY_SVG.byteLength, mimeType: 'image/svg+xml' },
      cards: {
        'spades-A': { path: 'spades-A.svg', hash: hSvg, bytes: TINY_SVG.byteLength, mimeType: 'image/svg+xml' },
      },
      totalBytes: TINY_SVG.byteLength * 2,
    };
    const v1Entry: DeckCatalogEntry = {
      id: 'rollback-deck',
      version: '1.0.0',
      schemaVersion: 1,
      name: 'Rollback Deck',
      subtitle: 'v1',
      description: 'v1',
      author: 'QA',
      sourceUrl: '',
      license: 'CC0',
      manifestPath: 'rollback-deck/manifest.json',
      previewPath: '',
      previewMimeType: 'image/svg+xml',
      aspectRatio: 0.71,
      renderMode: 'partial_override',
      format: 'svg',
      totalBytes: TINY_SVG.byteLength * 2,
      cardCount: 1,
      pricing: { access: 'free', price: 0, currency: 'coins', rarity: 'common' },
    };

    const files = new Map<string, Uint8Array>([
      ['/decks/rollback-deck/manifest.json', new TextEncoder().encode(JSON.stringify(v1Manifest))],
      ['/decks/rollback-deck/back.svg', TINY_SVG],
      ['/decks/rollback-deck/spades-A.svg', TINY_SVG],
    ]);
    await storage.installOrUpdateDeck({
      entry: v1Entry,
      baseUrl: '/decks',
      fetchImpl: async (url) => {
        const buf = files.get(String(url));
        return buf ? new Response(toArrayBuffer(buf), { status: 200 }) : new Response('404', { status: 404 });
      },
    });

    // Attempt failing v2 upgrade (404 asset)
    await assert.rejects(() =>
      storage.installOrUpdateDeck({
        entry: { ...v1Entry, version: '2.0.0' },
        baseUrl: '/decks',
        fetchImpl: async () => new Response('Missing v2 manifest', { status: 404 }),
      })
    );

    const intactV1 = await storage.loadDeckBlobs('rollback-deck');
    assert.ok(intactV1);
    assert.equal(intactV1.manifest.version, '1.0.0');
    assert.equal(intactV1.blobs.has('back'), true);

    // 4D) Service worker SKIP_WAITING deferred during gameplay and applied only when safe
    const messages: unknown[] = [];
    let playing = true;
    let triggerSafe: (() => void) | null = null;
    const worker = { postMessage: (msg: unknown) => messages.push(msg) };

    const res = applyServiceWorkerUpdateWhenSafe(worker, {
      isPlaying: () => playing,
      observePlayStateChange: (onSafe) => {
        triggerSafe = onSafe;
        return () => {};
      },
    });
    assert.equal(res.appliedImmediately, false);
    assert.equal(messages.length, 0);

    playing = false;
    assert.ok(triggerSafe);
    (triggerSafe as () => void)();
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0], { type: 'SKIP_WAITING' });

    assert.equal(EYVAN_CLASSIC_DECK_ID, 'eyvan-classic');
  });

  it('5. Atomic Claim Rollback: mid-batch failure at any stage leaves ZERO partial DB mutations (wallets, claims, inventory)', async () => {
    const h = await createItemsTestHarness('eyvan-items-atomic-', false);
    try {
      const buyer = await h.registerAndVerify('AtomicBuyer', 'atomic.buyer@example.com');
      const rawAdapter = h.db.getD1Adapter();

      // Seed exact starting wallet: 2500 coins, 200 gems
      await rawAdapter
        .prepare(
          `INSERT INTO user_wallets (user_id, coins, gems, updated_at)
           VALUES (?, 2500, 200, ?)
           ON CONFLICT(user_id) DO UPDATE SET coins = 2500, gems = 200`
        )
        .bind(buyer.userId, Date.now())
        .run();

      // Fault-injecting D1 wrapper that runs statements inside a REAL SQLite transaction
      // and throws at a configurable statement index inside batch() to prove full rollback!
      const makeFaultyBatchDb = (failAtStatementIndex: number): D1DatabaseLike => {
        const sqlite = (
          rawAdapter as unknown as {
            sqlite: {
              prepare: (sql: string) => { run: (...p: unknown[]) => { changes: number; lastInsertRowid: number | bigint } };
              transaction: <T>(fn: () => T) => () => T;
            };
          }
        ).sqlite;

        const wrapStmt = (
          query: string,
          params: unknown[]
        ): D1PreparedStatementLike & { __q: string; __p: unknown[] } => ({
          __q: query,
          __p: params,
          bind(...values: unknown[]) {
            return wrapStmt(query, values);
          },
          run: () => rawAdapter.prepare(query).bind(...params).run(),
          all: <T = unknown>() => rawAdapter.prepare(query).bind(...params).all<T>(),
          first: <T = unknown>() => rawAdapter.prepare(query).bind(...params).first<T>(),
        });

        return {
          prepare(query: string) {
            return wrapStmt(query, []);
          },
          async batch(statements: D1PreparedStatementLike[]): Promise<D1RunResult[]> {
            const isClaimBatch = statements.some((st) =>
              ((st as D1PreparedStatementLike & { __q?: string }).__q ?? '').includes(
                'user_wallet_claims'
              )
            );
            const tx = sqlite.transaction(() => {
              const out: D1RunResult[] = [];
              for (let i = 0; i < statements.length; i++) {
                if (isClaimBatch && i === failAtStatementIndex) {
                  throw new Error(`Simulated DB fault at batch statement #${i}`);
                }
                const s = statements[i] as D1PreparedStatementLike & {
                  __q: string;
                  __p: unknown[];
                };
                const info = sqlite.prepare(s.__q).run(...s.__p);
                out.push({
                  success: true,
                  meta: {
                    changes: info.changes,
                    last_row_id: Number(info.lastInsertRowid ?? 0),
                  },
                });
              }
              return out;
            });
            return tx();
          },
        };
      };

      const readSnapshot = async () => {
        const wallet = await rawAdapter
          .prepare(`SELECT coins, gems FROM user_wallets WHERE user_id = ?`)
          .bind(buyer.userId)
          .first<{ coins: number; gems: number }>();
        const claims = await rawAdapter
          .prepare(`SELECT request_id, item_id FROM user_wallet_claims WHERE user_id = ?`)
          .bind(buyer.userId)
          .all<{ request_id: string; item_id: string }>();
        const owned = await rawAdapter
          .prepare(`SELECT item_id FROM user_inventory WHERE user_id = ?`)
          .bind(buyer.userId)
          .all<{ item_id: string }>();
        return {
          coins: Number(wallet?.coins ?? 0),
          gems: Number(wallet?.gems ?? 0),
          claims: claims.results ?? [],
          ownedIds: (owned.results ?? []).map((r) => r.item_id),
        };
      };

      // A) Permanent item purchase (`tt-lapis`, 1800 coins -> 3 statements: deduct, claim, inventory)
      // Fail at statement 0 (deduct), 1 (claim insert), and 2 (inventory insert)
      for (const failIdx of [0, 1, 2]) {
        const res = await claimShopItemForUser(makeFaultyBatchDb(failIdx), buyer.userId, {
          itemId: 'tt-lapis',
          requestId: `req_atomic_perm_${failIdx}`,
          shopTestMode: false,
        });
        assert.equal(res.ok, false);
        if (res.ok === false) {
          assert.equal(res.status, 503);
          assert.equal(res.code, 'DATABASE_ERROR');
        }
        const snap = await readSnapshot();
        assert.equal(snap.coins, 2500, `Coins must stay untouched on failure at stmt ${failIdx}`);
        assert.equal(snap.gems, 200);
        assert.equal(snap.claims.length, 0, `No orphan claim row allowed on failure at stmt ${failIdx}`);
        assert.equal(snap.ownedIds.includes('tt-lapis'), false);
      }

      // B) Chest purchase (`dd-gold-chest`, 120 gems -> 5000 coins -> 3 statements: deduct gems, claim, credit coins)
      for (const failIdx of [0, 1, 2]) {
        const res = await claimShopItemForUser(makeFaultyBatchDb(failIdx), buyer.userId, {
          itemId: 'dd-gold-chest',
          requestId: `req_atomic_chest_${failIdx}`,
          shopTestMode: false,
        });
        assert.equal(res.ok, false);
        if (res.ok === false) {
          assert.equal(res.status, 503);
          assert.equal(res.code, 'DATABASE_ERROR');
        }
        const snap = await readSnapshot();
        assert.equal(snap.coins, 2500);
        assert.equal(snap.gems, 200);
        assert.equal(snap.claims.length, 0);
      }

      // C) Retry with the SAME requestId once DB recovers -> commits cleanly once!
      const okChest = await claimShopItemForUser(rawAdapter, buyer.userId, {
        itemId: 'dd-gold-chest',
        requestId: 'req_atomic_chest_2',
        shopTestMode: false,
      });
      assert.equal(okChest.ok, true);
      if (okChest.ok) {
        assert.equal(okChest.deduplicated, false);
        assert.equal(okChest.effectivePrice, 120);
        assert.equal(okChest.grantedCoins, 5000);
      }
      const afterSnap = await readSnapshot();
      assert.equal(afterSnap.gems, 80);
      assert.equal(afterSnap.coins, 7500);
      assert.equal(afterSnap.claims.length, 1);
    } finally {
      await h.cleanup();
    }
  });

  it('6. Idempotency Conflict & Concurrency: rejects requestId reuse for different itemId, prevents double-charge and double chest rewards under concurrent requests', async () => {
    const h = await createItemsTestHarness('eyvan-items-idem-', false);
    try {
      const user = await h.registerAndVerify('RaceBuyer', 'race.buyer@example.com');
      const d1 = h.db.getD1Adapter();

      await d1
        .prepare(
          `INSERT INTO user_wallets (user_id, coins, gems, updated_at)
           VALUES (?, 5000, 500, ?)
           ON CONFLICT(user_id) DO UPDATE SET coins = 5000, gems = 500`
        )
        .bind(user.userId, Date.now())
        .run();

      // 6A) Concurrent duplicate purchase of permanent item with SAME requestId (5x parallel)
      const sameReqResults = await Promise.all(
        Array.from({ length: 5 }, () =>
          claimShopItemForUser(d1, user.userId, {
            itemId: 'tt-lapis', // 1800 coins
            requestId: 'req_concurrent_same_01',
            shopTestMode: false,
          })
        )
      );
      assert.equal(sameReqResults.every((r) => r.ok), true);
      const nonDedupCount = sameReqResults.filter((r) => r.ok && !r.deduplicated).length;
      assert.equal(nonDedupCount, 1, 'Exactly one request must execute the primary charge');

      const walletAfterSame = await d1
        .prepare(`SELECT coins, gems FROM user_wallets WHERE user_id = ?`)
        .bind(user.userId)
        .first<{ coins: number; gems: number }>();
      assert.equal(walletAfterSame?.coins, 3200, 'Must deduct 1800 coins strictly once');

      // 6B) Reusing the SAME requestId for a DIFFERENT itemId MUST be rejected (409 IDEMPOTENCY_CONFLICT)
      const conflictRes = await claimShopItemForUser(d1, user.userId, {
        itemId: 'af-gold-arch', // different item!
        requestId: 'req_concurrent_same_01',
        shopTestMode: false,
      });
      assert.equal(conflictRes.ok, false);
      if (conflictRes.ok === false) {
        assert.equal(conflictRes.status, 409);
        assert.equal(conflictRes.code, 'IDEMPOTENCY_CONFLICT');
      }
      const ownedConflict = await d1
        .prepare(`SELECT 1 FROM user_inventory WHERE user_id = ? AND item_id = 'af-gold-arch'`)
        .bind(user.userId)
        .first();
      assert.equal(ownedConflict, null, 'Conflicting item must NOT be granted');
      const walletAfterConflict = await d1
        .prepare(`SELECT coins FROM user_wallets WHERE user_id = ?`)
        .bind(user.userId)
        .first<{ coins: number }>();
      assert.equal(walletAfterConflict?.coins, 3200, 'Conflicting reuse must NOT charge wallet');

      // 6C) Concurrent purchase of the SAME permanent item with DIFFERENT requestIds (5x parallel)
      //     Must charge strictly once and never double-deduct!
      const diffReqResults = await Promise.all(
        Array.from({ length: 5 }, (_, idx) =>
          claimShopItemForUser(d1, user.userId, {
            itemId: 'af-gold-arch', // 750 coins
            requestId: `req_concurrent_diff_${idx}`,
            shopTestMode: false,
          })
        )
      );
      assert.equal(diffReqResults.every((r) => r.ok), true);
      const walletAfterDiff = await d1
        .prepare(`SELECT coins FROM user_wallets WHERE user_id = ?`)
        .bind(user.userId)
        .first<{ coins: number }>();
      assert.equal(
        walletAfterDiff?.coins,
        3200 - 750,
        'Concurrent purchases with different requestIds must deduct 750 coins strictly once'
      );

      // 6D) Concurrent duplicate chest reward claim (5x parallel with same requestId) -> strictly 1 charge & 1 reward!
      const chestResults = await Promise.all(
        Array.from({ length: 5 }, () =>
          claimShopItemForUser(d1, user.userId, {
            itemId: 'dd-gold-chest', // costs 120 gems, grants 5000 coins
            requestId: 'req_chest_race_99',
            shopTestMode: false,
          })
        )
      );
      assert.equal(chestResults.every((r) => r.ok), true);
      const walletAfterChest = await d1
        .prepare(`SELECT coins, gems FROM user_wallets WHERE user_id = ?`)
        .bind(user.userId)
        .first<{ coins: number; gems: number }>();
      assert.equal(walletAfterChest?.gems, 500 - 120, 'Chest cost must be deducted strictly once');
      assert.equal(
        walletAfterChest?.coins,
        3200 - 750 + 5000,
        'Chest reward (+5000 coins) must be granted strictly once'
      );

      // Reusing chest requestId for a different chest/item must also fail with 409 IDEMPOTENCY_CONFLICT
      const chestReuseErr = await claimShopItemForUser(d1, user.userId, {
        itemId: 'dd-gem-coffer',
        requestId: 'req_chest_race_99',
        shopTestMode: false,
      });
      assert.equal(chestReuseErr.ok, false);
      if (chestReuseErr.ok === false) {
        assert.equal(chestReuseErr.status, 409);
        assert.equal(chestReuseErr.code, 'IDEMPOTENCY_CONFLICT');
      }
    } finally {
      await h.cleanup();
    }
  });

  it('7. Online Room Appearance Trust Boundaries: blocks authenticated/guest spoofing, falls back to safe default on DB error, strips owner_only table_skin, and preserves independent decks', async () => {
    const h = await createItemsTestHarness('eyvan-room-trust-', true);
    try {
      const alice = await h.registerAndVerify('AliceTrust', 'alice.trust@example.com');
      const carol = await h.registerAndVerify('CarolTrust', 'carol.trust@example.com');

      // Alice legitimately owns & equips deck-public-domain-cc0, cb-royal-peacock, and owner_only tt-tabriz
      for (const [itemId, slot] of [
        ['deck-public-domain-cc0', 'card_deck'],
        ['cb-royal-peacock', 'card_back'],
        ['tt-tabriz', 'table_skin'],
      ] as const) {
        const cr = await fetch(`${h.baseUrl}/api/shop/claim`, {
          method: 'POST',
          headers: {
            Cookie: alice.cookie,
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
          },
          body: JSON.stringify({ itemId, requestId: `req_trust_${itemId}` }),
        });
        assert.equal(cr.status, 200);
        const er = await fetch(`${h.baseUrl}/api/inventory/equip`, {
          method: 'POST',
          headers: {
            Cookie: alice.cookie,
            'Content-Type': 'application/json',
            'X-Requested-With': 'eyvan-client',
          },
          body: JSON.stringify({ itemId, slot }),
        });
        assert.equal(er.status, 200);
      }

      // 7A) Authenticated Alice attempts to spoof unowned legendary items + inject owner_only tableSkinId on room creation
      const createRes = await fetch(`${h.baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          Cookie: alice.cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'FakeNameIgnored',
          appearance: {
            deckId: 'spoofed-vip-deck',
            cardBackId: 'cb-isfahan-gold',
            avatarFrameId: 'af-crown-frame',
            badgeId: 'af-hakem-seal',
            bannerItemId: 'af-banner-ruby',
            bannerCode: 'ruby',
            gameEffectId: 've-turquoise-trump',
            tableSkinId: 'tt-tabriz',
            table_skin: 'tt-tabriz',
          },
        }),
      });
      assert.equal(createRes.status, 201);
      const created = (await createRes.json()) as {
        roomCode: string;
        playerId: string;
      };

      // 7B) Guest user Bob attempts to spoof unowned premium items on join -> must be restricted to default-owned guest items
      const guestJoinRes = await fetch(`${h.baseUrl}/api/rooms/${created.roomCode}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'GuestBob',
          appearance: {
            deckId: 'public-domain-cc0',
            cardBackId: 'cb-royal-peacock',
            avatarFrameId: 'af-crown-frame',
            badgeId: 'af-hakem-seal',
            bannerItemId: 'af-banner-ruby',
            bannerCode: 'ruby',
            gameEffectId: 've-turquoise-trump',
            tableSkinId: 'tt-tabriz',
          },
        }),
      });
      assert.equal(guestJoinRes.status, 200);
      const guestJoined = (await guestJoinRes.json()) as { playerId: string };

      // 7C) Authenticated Carol joins while DB lookup for user_equipped_items fails ->
      //     MUST fall back to safe default public appearance (NEVER client-supplied forged JSON)!
      const origGetD1Adapter = h.db.getD1Adapter.bind(h.db);
      (h.db as unknown as { getD1Adapter: typeof h.db.getD1Adapter }).getD1Adapter = () => {
        const real = origGetD1Adapter();
        return {
          prepare(query: string) {
            if (query.includes('FROM user_equipped_items')) {
              const failingStmt: D1PreparedStatementLike = {
                bind() {
                  return failingStmt;
                },
                async run() {
                  throw new Error('Simulated DB appearance lookup outage');
                },
                async all() {
                  throw new Error('Simulated DB appearance lookup outage');
                },
                async first() {
                  throw new Error('Simulated DB appearance lookup outage');
                },
              };
              return failingStmt;
            }
            return real.prepare(query);
          },
          batch: (stmts) => real.batch(stmts),
        };
      };

      let carolJoined: { playerId: string };
      try {
        const carolJoinRes = await fetch(
          `${h.baseUrl}/api/rooms/${created.roomCode}/join`,
          {
            method: 'POST',
            headers: {
              Cookie: carol.cookie,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              appearance: {
                deckId: 'public-domain-cc0',
                cardBackId: 'cb-royal-peacock',
                avatarFrameId: 'af-crown-frame',
                badgeId: 'af-hakem-seal',
                bannerCode: 'ruby',
              },
            }),
          }
        );
        assert.equal(carolJoinRes.status, 200);
        carolJoined = (await carolJoinRes.json()) as { playerId: string };
      } finally {
        (h.db as unknown as { getD1Adapter: typeof h.db.getD1Adapter }).getD1Adapter =
          origGetD1Adapter;
      }

      // Inspect authoritative snapshots sent to EVERY client in the room
      const roomEntry = (
        h.roomManager as unknown as {
          rooms: Map<string, { controller: HokmRoomController }>;
        }
      ).rooms.get(created.roomCode);
      assert.ok(roomEntry);
      const room = roomEntry.controller;
      const defaults = getDefaultPublicAppearance();

      for (const viewerId of [created.playerId, guestJoined.playerId, carolJoined.playerId]) {
        const snap = room.getSnapshotForPlayer(viewerId);
        assert.ok(snap);

        // Zero owner_only leakage anywhere in room snapshot
        const rawJson = JSON.stringify(snap);
        assert.equal(rawJson.includes('tt-tabriz'), false);
        assert.equal(rawJson.includes('tableSkin'), false);
        assert.equal(rawJson.includes('table_skin'), false);

        const byUser = new Map(snap.seats.map((s) => [s.username, s.appearance]));

        // Alice: strictly DB-verified deck & card back, ZERO spoofed items
        const aliceApp = byUser.get('AliceTrust');
        assert.equal(aliceApp?.deckId, 'public-domain-cc0');
        assert.equal(aliceApp?.cardBackId, 'cb-royal-peacock');
        assert.equal(aliceApp?.avatarFrameId, null);
        assert.equal(aliceApp?.badgeId, null);
        assert.equal(aliceApp?.bannerCode, 'royal');
        assert.equal(aliceApp?.gameEffectId, null);

        // GuestBob: strictly default-owned guest appearance, ZERO spoofed paid items
        const bobApp = byUser.get('GuestBob');
        assert.equal(bobApp?.deckId, defaults.deckId);
        assert.equal(bobApp?.cardBackId, defaults.cardBackId);
        assert.equal(bobApp?.avatarFrameId, null);
        assert.equal(bobApp?.badgeId, null);
        assert.equal(bobApp?.bannerCode, 'royal');
        assert.equal(bobApp?.gameEffectId, null);

        // Carol (DB lookup failed): strictly safe default appearance, ZERO spoofed JSON fallback
        const carolApp = byUser.get('CarolTrust');
        assert.equal(carolApp?.deckId, defaults.deckId);
        assert.equal(carolApp?.cardBackId, defaults.cardBackId);
        assert.equal(carolApp?.avatarFrameId, null);
        assert.equal(carolApp?.badgeId, null);
        assert.equal(carolApp?.bannerCode, 'royal');
      }
    } finally {
      await h.cleanup();
    }
  });

  it('8. IndexedDBDeckBlobStore Transaction Safety: waits strictly for tx.oncomplete and rejects cleanly on tx.onabort / tx.onerror without hanging', async () => {
    type FakeTxBehavior = 'complete' | 'abort_after_req_success' | 'tx_error' | 'req_error';
    let nextBehavior: FakeTxBehavior = 'complete';
    let holdCompleteQueue: Array<() => void> = [];
    const manifestRows = new Map<string, unknown>();
    const assetRows = new Map<string, StoredDeckAsset>();

    const createFakeDb = () => ({
      objectStoreNames: { contains: () => true },
      onversionchange: null as null | (() => void),
      close() {},
      transaction(_storeNames: string | string[], _mode: IDBTransactionMode) {
        const behavior = nextBehavior;
        const tx: {
          oncomplete: null | (() => void);
          onerror: null | (() => void);
          onabort: null | (() => void);
          error: Error | null;
          objectStore: (name: string) => unknown;
        } = {
          oncomplete: null,
          onerror: null,
          onabort: null,
          error: null,
          objectStore(name: string) {
            const makeReq = <T>(exec: () => T) => {
              const req: {
                result?: T;
                onsuccess: null | (() => void);
                onerror: null | (() => void);
              } = {
                onsuccess: null,
                onerror: null,
              };
              queueMicrotask(() => {
                if (behavior === 'req_error') {
                  req.onerror?.();
                  return;
                }
                req.result = exec();
                req.onsuccess?.();
              });
              return req;
            };
            return {
              get: (k: string) => makeReq(() => (name === 'manifests' ? manifestRows.get(k) : assetRows.get(k))),
              getAll: () => makeReq(() => Array.from((name === 'manifests' ? manifestRows : assetRows).values())),
              put: (val: Record<string, unknown>) =>
                makeReq(() => {
                  if (name === 'manifests') manifestRows.set(String(val.deckId), val);
                  else assetRows.set(String(val.key), val as unknown as StoredDeckAsset);
                  return undefined;
                }),
              delete: (k: string) =>
                makeReq(() => {
                  if (name === 'manifests') manifestRows.delete(k);
                  else assetRows.delete(k);
                  return undefined;
                }),
              clear: () =>
                makeReq(() => {
                  if (name === 'manifests') manifestRows.clear();
                  else assetRows.clear();
                  return undefined;
                }),
              index: () => ({
                getAll: (deckId: string) =>
                  makeReq(() =>
                    Array.from(assetRows.values()).filter((a) => a.deckId === deckId)
                  ),
              }),
            };
          },
        };

        // Schedule transaction completion/error/abort strictly AFTER request callbacks
        const triggerTxFinish = () => {
          if (behavior === 'abort_after_req_success') {
            tx.onabort?.();
          } else if (behavior === 'tx_error') {
            tx.error = new Error('Simulated IDB tx error');
            tx.onerror?.();
          } else if (behavior === 'complete') {
            tx.oncomplete?.();
          }
        };
        holdCompleteQueue.push(triggerTxFinish);
        return tx;
      },
    });

    const flushTx = async () => {
      // Allow request microtasks to run first
      await Promise.resolve();
      await Promise.resolve();
      const pending = holdCompleteQueue;
      holdCompleteQueue = [];
      for (const fn of pending) fn();
    };

    const origIndexedDb = (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
    (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
      open() {
        const req: {
          result?: unknown;
          onsuccess: null | (() => void);
          onerror: null | (() => void);
          onupgradeneeded: null | (() => void);
        } = {
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
        };
        queueMicrotask(() => {
          req.result = createFakeDb();
          req.onsuccess?.();
        });
        return req;
      },
    };

    try {
      const idbStore = new IndexedDBDeckBlobStore();
      const sampleAsset: StoredDeckAsset = {
        key: makeAssetCompositeKey('idb-test-deck', 'back'),
        deckId: 'idb-test-deck',
        assetKey: 'back',
        hash: 'a'.repeat(64),
        bytes: 4,
        mimeType: 'image/svg+xml',
        blob: new Blob(['test'], { type: 'image/svg+xml' }),
        updatedAt: Date.now(),
      };

      // 8A) putAssetsBatch & getAllAssetsForDeck must NOT resolve before tx.oncomplete!
      nextBehavior = 'complete';
      let putDone = false;
      const putP = idbStore.putAssetsBatch([sampleAsset]).then(() => {
        putDone = true;
      });
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(putDone, false, 'putAssetsBatch must wait for tx.oncomplete');
      await flushTx();
      await putP;
      assert.equal(putDone, true);

      let getAllDone = false;
      const getAllP = idbStore.getAllAssetsForDeck('idb-test-deck').then((rows) => {
        getAllDone = true;
        return rows;
      });
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(
        getAllDone,
        false,
        'getAllAssetsForDeck must NOT resolve on req.onsuccess before tx.oncomplete'
      );
      await flushTx();
      const fetched = await getAllP;
      assert.equal(fetched.length, 1);
      assert.equal(fetched[0].assetKey, 'back');

      // 8B) If tx.onabort fires AFTER req.onsuccess, getAllAssetsForDeck MUST reject cleanly (no hang / no false resolve)
      nextBehavior = 'abort_after_req_success';
      const abortedRead = idbStore.getAllAssetsForDeck('idb-test-deck');
      await flushTx();
      await assert.rejects(
        () => abortedRead,
        (err: unknown) => err instanceof DeckSystemError && err.code === 'STORAGE_UNAVAILABLE'
      );

      // 8C) clearAll rejects cleanly on tx.onabort instead of hanging forever
      nextBehavior = 'abort_after_req_success';
      const abortedClear = idbStore.clearAll();
      await flushTx();
      await assert.rejects(
        () => abortedClear,
        (err: unknown) => err instanceof DeckSystemError && err.code === 'STORAGE_UNAVAILABLE'
      );

      // 8D) deleteAssetsForDeck rejects cleanly on req.onerror
      nextBehavior = 'req_error';
      const erroredDelete = idbStore.deleteAssetsForDeck('idb-test-deck', ['back']);
      await flushTx();
      await assert.rejects(
        () => erroredDelete,
        (err: unknown) => err instanceof DeckSystemError && err.code === 'STORAGE_UNAVAILABLE'
      );
    } finally {
      if (origIndexedDb === undefined) {
        delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
      } else {
        (globalThis as unknown as { indexedDB: unknown }).indexedDB = origIndexedDb;
      }
    }
  });
});
