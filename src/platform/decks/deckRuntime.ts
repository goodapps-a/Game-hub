import { useSyncExternalStore } from 'react';
import {
  EYVAN_CLASSIC_DECK_MANIFEST,
} from './deckCatalog';
import {
  DeckStorageManager,
  defaultDeckStorageManager,
} from './deckStorage';
import {
  CardAssetKey,
  DeckManifest,
  EYVAN_CLASSIC_DECK_ID,
} from './types';

export interface ActiveDeckRuntimeState {
  readonly deckId: string;
  readonly manifest: DeckManifest;
  readonly version: string;
  readonly isReady: boolean;
  readonly assetUrls: ReadonlyMap<string, string>;
  readonly brokenAssetKeys: ReadonlySet<string>;
}

export interface DeckRuntimeMetrics {
  readonly activeBlobUrlCount: number;
  readonly totalCreatedBlobUrls: number;
  readonly totalRevokedBlobUrls: number;
  readonly pendingRevocationCount: number;
  readonly lastPrepareMs: number;
  readonly failedDecodeCount: number;
}

const DEFAULT_RUNTIME_STATE: ActiveDeckRuntimeState = {
  deckId: EYVAN_CLASSIC_DECK_ID,
  manifest: EYVAN_CLASSIC_DECK_MANIFEST,
  version: EYVAN_CLASSIC_DECK_MANIFEST.version,
  isReady: true,
  assetUrls: new Map(),
  brokenAssetKeys: new Set(),
};

const REVOKE_GRACE_MS = 1400;

export class DeckRuntimeManager {
  private readonly storage: DeckStorageManager;
  private state: ActiveDeckRuntimeState = DEFAULT_RUNTIME_STATE;
  private listeners = new Set<() => void>();
  private decodedImageCache: HTMLImageElement[] = [];
  private activationSeq = 0;
  private inflightDeckId: string | null = null;
  private inflightPromise: Promise<{
    activatedDeckId: string;
    fallbackUsed: boolean;
    prepareMs: number;
  }> | null = null;
  private pendingRevokeTimers = new Map<string, number>();
  private metrics = {
    totalCreatedBlobUrls: 0,
    totalRevokedBlobUrls: 0,
    lastPrepareMs: 0,
    failedDecodeCount: 0,
  };

  constructor(storage?: DeckStorageManager) {
    this.storage = storage ?? defaultDeckStorageManager;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ActiveDeckRuntimeState => {
    return this.state;
  };

  getMetrics(): DeckRuntimeMetrics {
    return {
      activeBlobUrlCount: this.state.assetUrls.size,
      totalCreatedBlobUrls: this.metrics.totalCreatedBlobUrls,
      totalRevokedBlobUrls: this.metrics.totalRevokedBlobUrls,
      pendingRevocationCount: this.pendingRevokeTimers.size,
      lastPrepareMs: this.metrics.lastPrepareMs,
      failedDecodeCount: this.metrics.failedDecodeCount,
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private createBlobUrl(blob: Blob): string {
    if (
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function'
    ) {
      this.metrics.totalCreatedBlobUrls += 1;
      return URL.createObjectURL(blob);
    }
    return '';
  }

  private revokeUrlNow(url: string): void {
    if (!url) return;
    const timer = this.pendingRevokeTimers.get(url);
    if (timer !== undefined && typeof window !== 'undefined') {
      window.clearTimeout(timer);
      this.pendingRevokeTimers.delete(url);
    }
    if (
      typeof URL !== 'undefined' &&
      typeof URL.revokeObjectURL === 'function'
    ) {
      try {
        URL.revokeObjectURL(url);
        this.metrics.totalRevokedBlobUrls += 1;
      } catch {
        // Ignore already-revoked URL
      }
    }
  }

  /**
   * Schedules revocation of old Blob URLs only AFTER the newly activated deck is live
   * and any active card transition/exit animations have safely finished.
   */
  private scheduleRevokeUrls(urls: readonly string[]): void {
    if (urls.length === 0) return;
    if (typeof window === 'undefined') {
      for (const u of urls) this.revokeUrlNow(u);
      return;
    }
    for (const url of urls) {
      if (!url || this.pendingRevokeTimers.has(url)) continue;
      const timerId = window.setTimeout(() => {
        this.pendingRevokeTimers.delete(url);
        this.revokeUrlNow(url);
      }, REVOKE_GRACE_MS);
      this.pendingRevokeTimers.set(url, timerId);
    }
  }

  private async preloadUrls(
    urls: readonly string[]
  ): Promise<{ failedUrls: Set<string>; decodedImages: HTMLImageElement[] }> {
    const failedUrls = new Set<string>();
    const decodedImages: HTMLImageElement[] = [];

    if (typeof Image === 'undefined') {
      return { failedUrls, decodedImages };
    }

    await Promise.all(
      urls.map(
        (url) =>
          new Promise<void>((resolve) => {
            if (!url) {
              resolve();
              return;
            }
            const img = new Image();
            img.decoding = 'async';
            let settled = false;
            const done = (ok: boolean) => {
              if (settled) return;
              settled = true;
              if (!ok) {
                failedUrls.add(url);
                this.metrics.failedDecodeCount += 1;
              } else {
                decodedImages.push(img);
              }
              resolve();
            };
            img.onload = () => {
              if (typeof img.decode === 'function') {
                img
                  .decode()
                  .then(() => done(true))
                  .catch(() => done(true));
              } else {
                done(true);
              }
            };
            img.onerror = () => done(false);
            img.src = url;
          })
      )
    );

    return { failedUrls, decodedImages };
  }

  /**
   * Prepares and activates a deck by ID. If the deck is missing, corrupted, or evicted
   * from IndexedDB, safely falls back to `eyvan-classic` and returns `{ fallbackUsed: true }`.
   */
  async activateDeck(deckId: string): Promise<{
    activatedDeckId: string;
    fallbackUsed: boolean;
    prepareMs: number;
  }> {
    if (this.inflightPromise && this.inflightDeckId === deckId) {
      return this.inflightPromise;
    }
    const job = this.runActivateDeck(deckId).finally(() => {
      if (this.inflightDeckId === deckId) {
        this.inflightDeckId = null;
        this.inflightPromise = null;
      }
    });
    this.inflightDeckId = deckId;
    this.inflightPromise = job;
    return job;
  }

  private async runActivateDeck(deckId: string): Promise<{
    activatedDeckId: string;
    fallbackUsed: boolean;
    prepareMs: number;
  }> {
    const seq = ++this.activationSeq;
    const t0 =
      typeof performance !== 'undefined' ? performance.now() : Date.now();

    if (!deckId || deckId === EYVAN_CLASSIC_DECK_ID) {
      const oldUrls = Array.from(this.state.assetUrls.values());
      this.state = DEFAULT_RUNTIME_STATE;
      this.decodedImageCache = [];
      const prepareMs =
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
        t0;
      this.metrics.lastPrepareMs = Math.round(prepareMs * 100) / 100;
      this.emit();
      this.scheduleRevokeUrls(oldUrls);
      return {
        activatedDeckId: EYVAN_CLASSIC_DECK_ID,
        fallbackUsed: false,
        prepareMs: this.metrics.lastPrepareMs,
      };
    }

    const loaded = await this.storage.loadDeckBlobs(deckId);
    if (seq !== this.activationSeq) {
      return {
        activatedDeckId: this.state.deckId,
        fallbackUsed: false,
        prepareMs: 0,
      };
    }

    if (!loaded) {
      const oldUrls = Array.from(this.state.assetUrls.values());
      this.state = DEFAULT_RUNTIME_STATE;
      this.decodedImageCache = [];
      this.emit();
      this.scheduleRevokeUrls(oldUrls);
      return {
        activatedDeckId: EYVAN_CLASSIC_DECK_ID,
        fallbackUsed: true,
        prepareMs: 0,
      };
    }

    // Reuse existing active URLs if exact same deckId + version is already loaded & ready
    if (
      this.state.deckId === loaded.manifest.id &&
      this.state.version === loaded.manifest.version &&
      this.state.isReady &&
      this.state.assetUrls.size > 0
    ) {
      return {
        activatedDeckId: loaded.manifest.id,
        fallbackUsed: false,
        prepareMs: 0,
      };
    }

    const nextUrlMap = new Map<string, string>();
    for (const [assetKey, blob] of loaded.blobs.entries()) {
      const blobUrl = this.createBlobUrl(blob);
      if (blobUrl) {
        nextUrlMap.set(assetKey, blobUrl);
      }
    }

    // Preload & decode images BEFORE swapping active state to prevent frame flicker
    const urlsToWarm = Array.from(nextUrlMap.entries())
      .filter(([k]) => k !== 'preview')
      .map(([, u]) => u);
    const { failedUrls, decodedImages } = await this.preloadUrls(urlsToWarm);

    if (seq !== this.activationSeq) {
      // Cancelled by a newer activation -> revoke newly allocated unused URLs immediately
      for (const u of nextUrlMap.values()) {
        this.revokeUrlNow(u);
      }
      return {
        activatedDeckId: this.state.deckId,
        fallbackUsed: false,
        prepareMs: 0,
      };
    }

    const brokenKeys = new Set<string>();
    for (const [k, u] of nextUrlMap.entries()) {
      if (failedUrls.has(u)) {
        brokenKeys.add(k);
      }
    }

    const oldUrls = Array.from(this.state.assetUrls.values());
    this.decodedImageCache = decodedImages;
    this.state = {
      deckId: loaded.manifest.id,
      manifest: loaded.manifest,
      version: loaded.manifest.version,
      isReady: true,
      assetUrls: nextUrlMap,
      brokenAssetKeys: brokenKeys,
    };

    const prepareMs =
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
      t0;
    this.metrics.lastPrepareMs = Math.round(prepareMs * 100) / 100;
    this.emit();
    this.scheduleRevokeUrls(oldUrls);

    return {
      activatedDeckId: loaded.manifest.id,
      fallbackUsed: false,
      prepareMs: this.metrics.lastPrepareMs,
    };
  }

  /**
   * Ensures a deck is ready before entering gameplay.
   */
  async ensureDeckReady(deckId?: string): Promise<void> {
    const target = deckId ?? this.state.deckId ?? EYVAN_CLASSIC_DECK_ID;
    if (this.state.deckId === target && this.state.isReady) {
      return;
    }
    await this.activateDeck(target);
  }

  /**
   * Marks a single runtime asset broken (e.g. from `<img>` `onError`) so that specific
   * card or card back falls back seamlessly to `eyvan-classic` without crashing.
   */
  markAssetBroken(deckId: string, assetKey: string): void {
    if (this.state.deckId !== deckId) return;
    if (this.state.brokenAssetKeys.has(assetKey)) return;
    const nextBroken = new Set(this.state.brokenAssetKeys);
    nextBroken.add(assetKey);
    this.metrics.failedDecodeCount += 1;
    this.state = {
      ...this.state,
      brokenAssetKeys: nextBroken,
    };
    this.emit();
  }

  /**
   * Flushes all pending delayed revocations and releases all active URLs (used on teardown/tests).
   */
  disposeAll(): void {
    const activeUrls = Array.from(this.state.assetUrls.values());
    const pendingUrls = Array.from(this.pendingRevokeTimers.keys());
    this.decodedImageCache = [];
    this.state = DEFAULT_RUNTIME_STATE;
    for (const url of [...activeUrls, ...pendingUrls]) {
      this.revokeUrlNow(url);
    }
    this.emit();
  }

  getCardAssetKey(cardId: CardAssetKey): string {
    return `card:${cardId}`;
  }
}

export const deckRuntime = new DeckRuntimeManager();

export function useDeckRuntimeState(): ActiveDeckRuntimeState {
  return useSyncExternalStore(
    deckRuntime.subscribe,
    deckRuntime.getSnapshot,
    deckRuntime.getSnapshot
  );
}
