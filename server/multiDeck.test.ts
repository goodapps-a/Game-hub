import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  ALL_CARD_ASSET_KEYS,
  DeckCatalogEntry,
  DeckManifest,
  DeckRegistry,
  DeckRuntimeManager,
  DeckStorageManager,
  DeckSystemError,
  EYVAN_CLASSIC_DECK_ID,
  InMemoryDeckBlobStore,
  computeDeckLifecycleStatus,
  computeSha256Hex,
  getDeckAssetsBaseUrl,
  getDeckCatalogUrl,
  isSafeRelativeDeckPath,
  resolveCardBackVisual,
  resolveCardFaceVisual,
  resolveDeckUrl,
  setDeckAssetsBaseUrl,
  validateAssetBuffer,
  validateDeckCatalog,
  validateDeckManifest,
} from '../src/platform/decks';
import { collectManifestAssets } from '../src/platform/decks/deckStorage';
import { createStandardDeck } from '../src/games/hokm/engine/deck';

// Minimal valid binary headers for PNG, WebP (RIFF....WEBP), JPEG, and safe SVG
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52,
]);
const TINY_WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x18, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x20,
]);
const TINY_SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140"><rect width="100" height="140" fill="#fff"/></svg>'
);
const TINY_SVG_ALT = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140"><circle cx="50" cy="70" r="30" fill="#e11d48"/></svg>'
);

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy.buffer;
}

describe('Multi-Deck Core, Validation, Storage, Fallback & Extensibility', () => {
  it('1. DeckHosting resolves base URLs (/decks, /r2/decks, external CDN) and blocks path traversal', () => {
    setDeckAssetsBaseUrl(null);
    assert.equal(getDeckAssetsBaseUrl(), '/decks');
    assert.equal(getDeckCatalogUrl(), '/decks/catalog.json');
    assert.equal(
      resolveDeckUrl('public-domain-cc0/manifest.json'),
      '/decks/public-domain-cc0/manifest.json'
    );

    setDeckAssetsBaseUrl('/r2/decks/');
    assert.equal(getDeckAssetsBaseUrl(), '/r2/decks');
    assert.equal(
      resolveDeckUrl('royal-gold/cards/ace.webp'),
      '/r2/decks/royal-gold/cards/ace.webp'
    );

    setDeckAssetsBaseUrl('https://assets.eyvan.example/decks/');
    assert.equal(
      getDeckCatalogUrl(),
      'https://assets.eyvan.example/decks/catalog.json'
    );
    setDeckAssetsBaseUrl(null);

    assert.equal(isSafeRelativeDeckPath('../etc/passwd'), false);
    assert.equal(isSafeRelativeDeckPath('/abs/path.svg'), false);
    assert.equal(isSafeRelativeDeckPath('https://evil.com/x.svg'), false);
    assert.equal(isSafeRelativeDeckPath('cards/spades-A.webp'), true);
  });

  it('2. Validator rejects corrupt manifests, XSS SVGs, fake HTML 404 responses, and invalid binary signatures', () => {
    assert.throws(
      () =>
        validateDeckManifest({
          id: 'bad id with spaces!',
          version: '1.0.0',
          schemaVersion: 1,
          name: 'Bad',
        }),
      (e: unknown) => e instanceof DeckSystemError && e.code === 'INVALID_MANIFEST'
    );

    // Reject HTML 404 masquerading as SVG or WebP
    const html404 = new TextEncoder().encode('<!DOCTYPE html><html>404</html>');
    assert.throws(
      () => validateAssetBuffer(toArrayBuffer(html404), 'image/webp', 'card:spades-A'),
      (e: unknown) => e instanceof DeckSystemError && e.code === 'INVALID_ASSET'
    );
    assert.throws(
      () => validateAssetBuffer(toArrayBuffer(html404), 'image/svg+xml', 'card:hearts-2'),
      (e: unknown) => e instanceof DeckSystemError && e.code === 'INVALID_ASSET'
    );

    // Reject SVG containing <script>, event handlers, or <foreignObject>
    const xssSvg1 = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    );
    assert.throws(
      () => validateAssetBuffer(toArrayBuffer(xssSvg1), 'image/svg+xml', 'card:hearts-3'),
      (e: unknown) => e instanceof DeckSystemError && e.code === 'INVALID_ASSET'
    );

    const xssSvg2 = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="fetch(1)"><rect width="10" height="10"/></svg>'
    );
    assert.throws(
      () => validateAssetBuffer(toArrayBuffer(xssSvg2), 'image/svg+xml', 'card:hearts-4'),
      (e: unknown) => e instanceof DeckSystemError && e.code === 'INVALID_ASSET'
    );

    // Valid SVG / PNG / WebP pass cleanly
    validateAssetBuffer(toArrayBuffer(TINY_SVG), 'image/svg+xml', 'card:hearts-2');
    validateAssetBuffer(toArrayBuffer(TINY_PNG), 'image/png', 'back');
    validateAssetBuffer(toArrayBuffer(TINY_WEBP), 'image/webp', 'card:spades-A');
  });

  it('3. Stage F: Second experimental multi-format deck (SVG+WebP+PNG, partial_override, custom tokens) works with ZERO engine/component changes and stays hidden from real shop', async () => {
    const store = new InMemoryDeckBlobStore();
    const storage = new DeckStorageManager(store);
    const runtime = new DeckRuntimeManager(storage);

    const hTwoHearts = await computeSha256Hex(toArrayBuffer(TINY_SVG));
    const hAceSpades = await computeSha256Hex(toArrayBuffer(TINY_WEBP));
    const hBack = await computeSha256Hex(toArrayBuffer(TINY_PNG));

    const testManifest: DeckManifest = {
      id: 'synth-night-override',
      version: '1.0.0',
      schemaVersion: 1,
      name: 'تم آزمایشی شبانه',
      description: 'مجموعه آزمایشی چندفرمتی (غیرفروشگاهی)',
      author: 'Eyvan QA',
      sourceUrl: '',
      license: 'Test',
      aspectRatio: 0.71,
      renderMode: 'partial_override',
      format: 'mixed',
      styleTokens: {
        cardBackground: '#0E172A',
        cardBorderColor: '#F59E0B',
        cardInnerFrame: false,
        imageFit: 'contain',
        imagePaddingPx: 4,
        backBackground: '#1E293B',
        backBorderColor: '#38BDF8',
        backPaddingPx: 3,
      },
      back: {
        path: 'art/midnight-back.png',
        hash: hBack,
        bytes: TINY_PNG.byteLength,
        mimeType: 'image/png',
      },
      cards: {
        // Non-standard file paths & mixed formats (SVG + WebP) in partial override
        'hearts-2': {
          path: 'art/two-of-hearts-vector.svg',
          hash: hTwoHearts,
          bytes: TINY_SVG.byteLength,
          mimeType: 'image/svg+xml',
        },
        'spades-A': {
          path: 'art/custom-ace-spade.webp',
          hash: hAceSpades,
          bytes: TINY_WEBP.byteLength,
          mimeType: 'image/webp',
        },
      },
      totalBytes: TINY_PNG.byteLength + TINY_SVG.byteLength + TINY_WEBP.byteLength,
    };

    const catalogEntry: DeckCatalogEntry = {
      id: testManifest.id,
      version: testManifest.version,
      schemaVersion: 1,
      name: testManifest.name,
      subtitle: 'تست چندفرمتی',
      description: testManifest.description,
      author: testManifest.author,
      sourceUrl: '',
      license: 'Test',
      manifestPath: 'synth-night-override/manifest.json',
      previewPath: '',
      previewMimeType: 'image/png',
      aspectRatio: 0.71,
      renderMode: 'partial_override',
      format: 'mixed',
      totalBytes: testManifest.totalBytes,
      cardCount: 2,
      pricing: {
        access: 'free',
        price: 0,
        currency: 'coins',
        rarity: 'common',
      },
      isExperimental: true,
    };

    // Must remain hidden from real consumer Shop catalog!
    DeckRegistry.resetToBuiltin();
    DeckRegistry.registerEntries([catalogEntry]);
    const consumerEntries = DeckRegistry.getAllCatalogEntries(false);
    assert.equal(consumerEntries.some((e) => e.id === 'synth-night-override'), false);
    const experimentalEntries = DeckRegistry.getAllCatalogEntries(true);
    assert.equal(experimentalEntries.some((e) => e.id === 'synth-night-override'), true);
    DeckRegistry.resetToBuiltin();

    const files = new Map<string, Uint8Array>([
      ['/decks/synth-night-override/manifest.json', new TextEncoder().encode(JSON.stringify(testManifest))],
      ['/decks/synth-night-override/art/midnight-back.png', TINY_PNG],
      ['/decks/synth-night-override/art/two-of-hearts-vector.svg', TINY_SVG],
      ['/decks/synth-night-override/art/custom-ace-spade.webp', TINY_WEBP],
    ]);

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      const payload = files.get(url);
      if (!payload) return new Response('Not found', { status: 404 });
      return new Response(toArrayBuffer(payload), { status: 200 });
    };

    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;
    let urlCounter = 0;
    const createdUrls = new Set<string>();
    const revokedUrls = new Set<string>();
    URL.createObjectURL = () => {
      const u = `blob:eyvan-test/${++urlCounter}`;
      createdUrls.add(u);
      return u;
    };
    URL.revokeObjectURL = (u: string) => {
      revokedUrls.add(u);
    };

    try {
      await storage.installOrUpdateDeck({
        entry: catalogEntry,
        baseUrl: '/decks',
        fetchImpl: mockFetch,
      });

      const act = await runtime.activateDeck('synth-night-override');
      assert.equal(act.activatedDeckId, 'synth-night-override');
      assert.equal(act.fallbackUsed, false);

      const state = runtime.getSnapshot();
      // Provided cards & back resolve to the custom deck's Blob URLs & custom styleTokens
      const hearts2Visual = resolveCardFaceVisual('hearts-2', state);
      assert.equal(hearts2Visual.mode, 'image');
      assert.equal(hearts2Visual.styleTokens.cardBackground, '#0E172A');
      assert.equal(hearts2Visual.styleTokens.imageFit, 'contain');

      const spadesAVisual = resolveCardFaceVisual('spades-A', state);
      assert.equal(spadesAVisual.mode, 'image');

      const backVisual = resolveCardBackVisual(state);
      assert.equal(backVisual.mode, 'image');
      assert.equal(backVisual.styleTokens.backBackground, '#1E293B');

      // Unprovided cards in partial_override fall back seamlessly to Eyvan Classic!
      const clubs7Visual = resolveCardFaceVisual('clubs-7', state);
      assert.equal(clubs7Visual.mode, 'builtin_classic');
      assert.equal(clubs7Visual.deckId, EYVAN_CLASSIC_DECK_ID);

      // Runtime decode failure on one card triggers instant per-card Classic fallback
      runtime.markAssetBroken('synth-night-override', 'card:spades-A');
      const brokenSpadesA = resolveCardFaceVisual('spades-A', runtime.getSnapshot());
      assert.equal(brokenSpadesA.mode, 'builtin_classic');
      // Hearts-2 stays unaffected!
      assert.equal(resolveCardFaceVisual('hearts-2', runtime.getSnapshot()).mode, 'image');

      // Blob URL cleanup / no leaks on disposeAll()
      runtime.disposeAll();
      assert.equal(revokedUrls.size, createdUrls.size);
    } finally {
      URL.createObjectURL = origCreateObjectURL;
      URL.revokeObjectURL = origRevokeObjectURL;
    }
  });

  it('4. Download rejects hash mismatch & partial/aborted downloads without overwriting active state', async () => {
    const store = new InMemoryDeckBlobStore();
    const storage = new DeckStorageManager(store);
    const runtime = new DeckRuntimeManager(storage);

    const hSvg = await computeSha256Hex(toArrayBuffer(TINY_SVG));
    const hPng = await computeSha256Hex(toArrayBuffer(TINY_PNG));

    const manifestBadHash: DeckManifest = {
      id: 'corrupt-deck',
      version: '1.0.0',
      schemaVersion: 1,
      name: 'Corrupt',
      description: 'Test',
      author: 'QA',
      sourceUrl: '',
      license: 'CC0',
      aspectRatio: 0.71,
      renderMode: 'full_card',
      format: 'mixed',
      styleTokens: {
        cardBackground: '#FFFFFF',
        cardBorderColor: '#CCCCCC',
        imageFit: 'cover',
      },
      back: {
        path: 'back.png',
        hash: hPng,
        bytes: TINY_PNG.byteLength,
        mimeType: 'image/png',
      },
      cards: {
        'hearts-2': {
          path: '2h.svg',
          hash: 'f'.repeat(64), // deliberate wrong hash
          bytes: TINY_SVG.byteLength,
          mimeType: 'image/svg+xml',
        },
      },
      totalBytes: TINY_PNG.byteLength + TINY_SVG.byteLength,
    };

    const entry: DeckCatalogEntry = {
      id: 'corrupt-deck',
      version: '1.0.0',
      schemaVersion: 1,
      name: 'Corrupt',
      subtitle: 'Test',
      description: 'Test',
      author: 'QA',
      sourceUrl: '',
      license: 'CC0',
      manifestPath: 'corrupt-deck/manifest.json',
      previewPath: '',
      previewMimeType: 'image/png',
      aspectRatio: 0.71,
      renderMode: 'full_card',
      format: 'mixed',
      totalBytes: manifestBadHash.totalBytes,
      cardCount: 1,
      pricing: { access: 'free', price: 0, currency: 'coins', rarity: 'common' },
    };

    const mockFetch: typeof fetch = async (input) => {
      const u = String(input);
      if (u.endsWith('manifest.json')) {
        return new Response(JSON.stringify(manifestBadHash), { status: 200 });
      }
      if (u.endsWith('back.png')) return new Response(toArrayBuffer(TINY_PNG), { status: 200 });
      if (u.endsWith('2h.svg')) return new Response(toArrayBuffer(TINY_SVG), { status: 200 });
      return new Response('404', { status: 404 });
    };

    await assert.rejects(
      () => storage.installOrUpdateDeck({ entry, baseUrl: '/decks', fetchImpl: mockFetch }),
      (e: unknown) => e instanceof DeckSystemError && e.code === 'HASH_MISMATCH'
    );

    // Must NOT be stored as a completed install and activating it falls back cleanly
    assert.equal(await storage.getInstalledRecord('corrupt-deck'), null);
    const act = await runtime.activateDeck('corrupt-deck');
    assert.equal(act.activatedDeckId, EYVAN_CLASSIC_DECK_ID);
    assert.equal(act.fallbackUsed, true);

    // Test AbortSignal mid-download leaves clean state
    const validManifest: DeckManifest = {
      ...manifestBadHash,
      id: 'abort-deck',
      cards: {
        'hearts-2': {
          path: '2h.svg',
          hash: hSvg,
          bytes: TINY_SVG.byteLength,
          mimeType: 'image/svg+xml',
        },
      },
    };
    const ac = new AbortController();
    const abortFetch: typeof fetch = async (input) => {
      const u = String(input);
      if (u.endsWith('manifest.json')) {
        ac.abort();
        return new Response(JSON.stringify(validManifest), { status: 200 });
      }
      return new Response(toArrayBuffer(TINY_PNG), { status: 200 });
    };
    await assert.rejects(
      () =>
        storage.installOrUpdateDeck({
          entry: { ...entry, id: 'abort-deck', manifestPath: 'abort-deck/manifest.json' },
          baseUrl: '/decks',
          fetchImpl: abortFetch,
          signal: ac.signal,
        }),
      (e: unknown) => e instanceof DeckSystemError && e.code === 'ABORTED'
    );
    assert.equal(await storage.getInstalledRecord('abort-deck'), null);
  });

  it('5. Delta Update only fetches changed hashes, prunes removed assets, detects eviction, and protects active/builtin delete', async () => {
    const store = new InMemoryDeckBlobStore();
    const storage = new DeckStorageManager(store);

    const hSvg1 = await computeSha256Hex(toArrayBuffer(TINY_SVG));
    const hSvg2 = await computeSha256Hex(toArrayBuffer(TINY_SVG_ALT));
    const hPng = await computeSha256Hex(toArrayBuffer(TINY_PNG));

    const manifestV1: DeckManifest = {
      id: 'delta-deck',
      version: '1.0.0',
      schemaVersion: 1,
      name: 'Delta',
      description: 'Delta test',
      author: 'QA',
      sourceUrl: '',
      license: 'CC0',
      aspectRatio: 0.71,
      renderMode: 'partial_override',
      format: 'mixed',
      styleTokens: {
        cardBackground: '#FFFFFF',
        cardBorderColor: '#CCCCCC',
        imageFit: 'cover',
      },
      back: {
        path: 'back.png',
        hash: hPng,
        bytes: TINY_PNG.byteLength,
        mimeType: 'image/png',
      },
      cards: {
        'hearts-2': {
          path: '2h.svg',
          hash: hSvg1,
          bytes: TINY_SVG.byteLength,
          mimeType: 'image/svg+xml',
        },
        'hearts-3': {
          path: '3h.svg',
          hash: hSvg1,
          bytes: TINY_SVG.byteLength,
          mimeType: 'image/svg+xml',
        },
      },
      totalBytes: TINY_PNG.byteLength + TINY_SVG.byteLength * 2,
    };

    const manifestV2: DeckManifest = {
      ...manifestV1,
      version: '1.0.1',
      cards: {
        'hearts-2': {
          path: '2h.svg',
          hash: hSvg1, // UNCHANGED -> MUST NOT BE RE-DOWNLOADED
          bytes: TINY_SVG.byteLength,
          mimeType: 'image/svg+xml',
        },
        'hearts-3': {
          path: '3h.svg',
          hash: hSvg2, // CHANGED -> MUST BE DOWNLOADED
          bytes: TINY_SVG_ALT.byteLength,
          mimeType: 'image/svg+xml',
        },
      },
    };

    const entryV1: DeckCatalogEntry = {
      id: 'delta-deck',
      version: '1.0.0',
      schemaVersion: 1,
      name: 'Delta',
      subtitle: 'Delta test',
      description: 'Delta test',
      author: 'QA',
      sourceUrl: '',
      license: 'CC0',
      manifestPath: 'delta-deck/manifest.json',
      previewPath: '',
      previewMimeType: 'image/png',
      aspectRatio: 0.71,
      renderMode: 'partial_override',
      format: 'mixed',
      totalBytes: manifestV1.totalBytes,
      cardCount: 2,
      pricing: { access: 'free', price: 0, currency: 'coins', rarity: 'common' },
    };

    const fetchedPathsV1: string[] = [];
    await storage.installOrUpdateDeck({
      entry: entryV1,
      baseUrl: '/decks',
      fetchImpl: async (input) => {
        const u = String(input);
        fetchedPathsV1.push(u);
        if (u.endsWith('manifest.json')) return new Response(JSON.stringify(manifestV1));
        if (u.endsWith('back.png')) return new Response(toArrayBuffer(TINY_PNG));
        return new Response(toArrayBuffer(TINY_SVG));
      },
    });
    assert.equal(fetchedPathsV1.length, 4); // manifest + back + 2h + 3h

    // Delta update to v1.0.1: ONLY manifest + changed 3h.svg should be fetched!
    const fetchedPathsV2: string[] = [];
    await storage.installOrUpdateDeck({
      entry: { ...entryV1, version: '1.0.1' },
      baseUrl: '/decks',
      fetchImpl: async (input) => {
        const u = String(input);
        fetchedPathsV2.push(u);
        if (u.endsWith('manifest.json')) return new Response(JSON.stringify(manifestV2));
        if (u.endsWith('3h.svg')) return new Response(toArrayBuffer(TINY_SVG_ALT));
        throw new Error(`Unexpected fetch of unchanged asset: ${u}`);
      },
    });
    assert.deepEqual(fetchedPathsV2, [
      '/decks/delta-deck/manifest.json',
      '/decks/delta-deck/3h.svg',
    ]);

    // Protection against deleting built-in or active deck
    await assert.rejects(
      () => storage.deleteDeck(EYVAN_CLASSIC_DECK_ID, EYVAN_CLASSIC_DECK_ID),
      (e: unknown) => e instanceof DeckSystemError && e.code === 'CANNOT_DELETE_BUILTIN'
    );
    await assert.rejects(
      () => storage.deleteDeck('delta-deck', 'delta-deck'),
      (e: unknown) => e instanceof DeckSystemError && e.code === 'CANNOT_DELETE_ACTIVE'
    );

    // Deleting inactive deck succeeds cleanly
    await storage.deleteDeck('delta-deck', EYVAN_CLASSIC_DECK_ID);
    assert.equal(await storage.getInstalledRecord('delta-deck'), null);

    // Simulate OS partial eviction after reinstall
    await storage.installOrUpdateDeck({
      entry: entryV1,
      baseUrl: '/decks',
      fetchImpl: async (input) => {
        const u = String(input);
        if (u.endsWith('manifest.json')) return new Response(JSON.stringify(manifestV1));
        if (u.endsWith('back.png')) return new Response(toArrayBuffer(TINY_PNG));
        return new Response(toArrayBuffer(TINY_SVG));
      },
    });
    await store.deleteAssetsForDeck('delta-deck', ['card:hearts-3']);
    const check = await storage.verifyDeckIntegrity('delta-deck');
    assert.equal(check.ok, false);
    assert.deepEqual(check.missingKeys, ['card:hearts-3']);
    // Self-heals corrupt install record
    assert.equal(await storage.getInstalledRecord('delta-deck'), null);
  });

  it('6. Lifecycle computes all 6 shop states & verifies real public/decks/public-domain-cc0 assets and Hokm deck immutability', async () => {
    const catalogRaw = JSON.parse(
      fs.readFileSync(path.resolve('public/decks/catalog.json'), 'utf8')
    );
    const catalog = validateDeckCatalog(catalogRaw);
    assert.equal(catalog.length, 1);
    const pdEntry = catalog[0];
    assert.equal(pdEntry.id, 'public-domain-cc0');

    // Verify all 6 lifecycle states cleanly
    assert.equal(
      computeDeckLifecycleStatus({
        entry: pdEntry,
        equippedDeckId: EYVAN_CLASSIC_DECK_ID,
      }),
      'free_available'
    );
    assert.equal(
      computeDeckLifecycleStatus({
        entry: {
          ...pdEntry,
          id: 'paid-gold',
          pricing: { access: 'paid', price: 1500, currency: 'coins', rarity: 'epic' },
        },
        equippedDeckId: EYVAN_CLASSIC_DECK_ID,
        ownedDeckIds: new Set(),
      }),
      'paid_locked'
    );
    assert.equal(
      computeDeckLifecycleStatus({
        entry: pdEntry,
        equippedDeckId: EYVAN_CLASSIC_DECK_ID,
        downloadingDeckId: pdEntry.id,
      }),
      'downloading'
    );
    assert.equal(
      computeDeckLifecycleStatus({
        entry: pdEntry,
        equippedDeckId: EYVAN_CLASSIC_DECK_ID,
        installedVersion: '1.0.0',
        installComplete: true,
      }),
      'downloaded'
    );
    assert.equal(
      computeDeckLifecycleStatus({
        entry: pdEntry,
        equippedDeckId: 'public-domain-cc0',
        installedVersion: '1.0.0',
        installComplete: true,
      }),
      'equipped'
    );
    assert.equal(
      computeDeckLifecycleStatus({
        entry: { ...pdEntry, version: '1.1.0' },
        equippedDeckId: 'public-domain-cc0',
        installedVersion: '1.0.0',
        installComplete: true,
      }),
      'update_available'
    );

    // Validate real on-disk public-domain-cc0 manifest + all 52 card keys + back + preview + hashes
    const deckDir = path.resolve('public/decks/public-domain-cc0');
    const manifestJson = JSON.parse(
      fs.readFileSync(path.join(deckDir, 'manifest.json'), 'utf8')
    );
    const manifest = validateDeckManifest(manifestJson);
    for (const key of ALL_CARD_ASSET_KEYS) {
      assert.ok(manifest.cards[key], `Missing card key in public-domain-cc0 manifest: ${key}`);
    }
    const assets = collectManifestAssets(manifest);
    assert.equal(assets.length, 56);
    for (const item of assets) {
      const buf = fs.readFileSync(path.join(deckDir, item.entry.path));
      const ab = toArrayBuffer(buf);
      validateAssetBuffer(ab, item.entry.mimeType, item.assetKey);
      const actualHash = await computeSha256Hex(ab);
      assert.equal(actualHash, item.entry.hash);
    }

    // Verify Hokm game engine deck remains completely unchanged (52 unique card IDs matching ALL_CARD_ASSET_KEYS)
    const engineDeckIds = new Set(createStandardDeck().map((c) => c.id));
    assert.equal(engineDeckIds.size, 52);
    for (const key of ALL_CARD_ASSET_KEYS) {
      assert.ok(engineDeckIds.has(key));
    }
  });
});
