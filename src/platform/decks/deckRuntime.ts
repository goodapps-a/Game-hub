import { useSyncExternalStore } from 'react';
import { EYVAN_CLASSIC_DECK_MANIFEST } from './deckCatalog';
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
  readonly loadedDeckCount: number;
  readonly totalCreatedBlobUrls: number;
  readonly totalRevokedBlobUrls: number;
  readonly pendingRevocationCount: number;
  readonly lastPrepareMs: number;
  readonly failedDecodeCount: number;
}

export type DeckLoadReason = 'equipped' | 'room_seat' | 'preview';

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
  private loadedDecks = new Map<string, ActiveDeckRuntimeState>([
    [EYVAN_CLASSIC_DECK_ID, DEFAULT_RUNTIME_STATE],
  ]);
  private deckReasons = new Map<string, Set<DeckLoadReason>>([
    [EYVAN_CLASSIC_DECK_ID, new Set(['equipped'])],
  ]);
  private listeners = new Set<() => void>();
  private decodedImageCache = new Map<string, HTMLImageElement[]>();
  private activationSeq = 0;
  private inflightLoads = new Map<
    string,
    Promise<{
      activatedDeckId: string;
      fallbackUsed: boolean;
      prepareMs: number;
    }>
  >();
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

  /**
   * Returns runtime state for a specific deckId (supports concurrent multi-player
   * rendering in online Hokm rooms), falling back cleanly to `eyvan-classic` if not loaded.
   */
  getDeckState(deckId?: string): ActiveDeckRuntimeState {
    if (!deckId) return this.state;
    const found = this.loadedDecks.get(deckId);
    if (found && found.isReady) {
      return found;
    }
    if (this.state.deckId === deckId && this.state.isReady) {
      return this.state;
    }
    return DEFAULT_RUNTIME_STATE;
  }

  isDeckLoaded(deckId: string): boolean {
    if (!deckId || deckId === EYVAN_CLASSIC_DECK_ID) return true;
    const found = this.loadedDecks.get(deckId);
    return Boolean(found?.isReady);
  }

  getMetrics(): DeckRuntimeMetrics {
    let activeBlobUrlCount = 0;
    for (const st of this.loadedDecks.values()) {
      activeBlobUrlCount += st.assetUrls.size;
    }
    return {
      activeBlobUrlCount,
      loadedDeckCount: this.loadedDecks.size,
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
   * Schedules revocation of old Blob URLs only AFTER transitions have safely finished.
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

  private addDeckReason(deckId: string, reason: DeckLoadReason): void {
    const existing = this.deckReasons.get(deckId) ?? new Set<DeckLoadReason>();
    existing.add(reason);
    this.deckReasons.set(deckId, existing);
  }

  /**
   * Loads a deck into concurrent runtime cache (`this.loadedDecks`) without replacing
   * or revoking other loaded decks. Used for opponent decks in multiplayer matches!
   */
  async loadDeck(
    deckId: string,
    reason: DeckLoadReason = 'room_seat'
  ): Promise<{
    activatedDeckId: string;
    fallbackUsed: boolean;
    prepareMs: number;
  }> {
    if (!deckId || deckId === EYVAN_CLASSIC_DECK_ID) {
      this.addDeckReason(EYVAN_CLASSIC_DECK_ID, reason);
      return {
        activatedDeckId: EYVAN_CLASSIC_DECK_ID,
        fallbackUsed: false,
        prepareMs: 0,
      };
    }

    const inflight = this.inflightLoads.get(deckId);
    if (inflight) {
      const res = await inflight;
      if (!res.fallbackUsed) {
        this.addDeckReason(res.activatedDeckId, reason);
      }
      return res;
    }

    const job = this.runLoadDeck(deckId, reason).finally(() => {
      this.inflightLoads.delete(deckId);
    });
    this.inflightLoads.set(deckId, job);
    return job;
  }

  private async runLoadDeck(
    deckId: string,
    reason: DeckLoadReason
  ): Promise<{
    activatedDeckId: string;
    fallbackUsed: boolean;
    prepareMs: number;
  }> {
    const t0 =
      typeof performance !== 'undefined' ? performance.now() : Date.now();

    const loaded = await this.storage.loadDeckBlobs(deckId);
    if (!loaded) {
      return {
        activatedDeckId: EYVAN_CLASSIC_DECK_ID,
        fallbackUsed: true,
        prepareMs: 0,
      };
    }

    const existing = this.loadedDecks.get(loaded.manifest.id);
    if (
      existing &&
      existing.version === loaded.manifest.version &&
      existing.isReady &&
      existing.assetUrls.size > 0
    ) {
      this.addDeckReason(loaded.manifest.id, reason);
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

    const urlsToWarm = Array.from(nextUrlMap.entries())
      .filter(([k]) => k !== 'preview')
      .map(([, u]) => u);
    const { failedUrls, decodedImages } = await this.preloadUrls(urlsToWarm);

    const brokenKeys = new Set<string>();
    for (const [k, u] of nextUrlMap.entries()) {
      if (failedUrls.has(u)) {
        brokenKeys.add(k);
      }
    }

    const oldUrls = existing ? Array.from(existing.assetUrls.values()) : [];
    const nextState: ActiveDeckRuntimeState = {
      deckId: loaded.manifest.id,
      manifest: loaded.manifest,
      version: loaded.manifest.version,
      isReady: true,
      assetUrls: nextUrlMap,
      brokenAssetKeys: brokenKeys,
    };

    this.decodedImageCache.set(loaded.manifest.id, decodedImages);
    this.loadedDecks.set(loaded.manifest.id, nextState);
    this.addDeckReason(loaded.manifest.id, reason);

    const prepareMs =
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    this.metrics.lastPrepareMs = Math.round(prepareMs * 100) / 100;

    if (oldUrls.length > 0) {
      this.scheduleRevokeUrls(oldUrls);
    }

    this.emit();
    return {
      activatedDeckId: loaded.manifest.id,
      fallbackUsed: false,
      prepareMs: this.metrics.lastPrepareMs,
    };
  }

  /**
   * Prepares and activates the primary user-equipped deck (`this.getSnapshot()`).
   * Preserves decks currently referenced by `'room_seat'` while evicting stale `'equipped'` decks.
   */
  async activateDeck(deckId: string): Promise<{
    activatedDeckId: string;
    fallbackUsed: boolean;
    prepareMs: number;
  }> {
    const seq = ++this.activationSeq;
    const prevPrimaryId = this.state.deckId;

    if (!deckId || deckId === EYVAN_CLASSIC_DECK_ID) {
      this.state = DEFAULT_RUNTIME_STATE;
      this.releaseReasonForNonActive(prevPrimaryId, EYVAN_CLASSIC_DECK_ID, 'equipped');
      this.emit();
      return {
        activatedDeckId: EYVAN_CLASSIC_DECK_ID,
        fallbackUsed: false,
        prepareMs: 0,
      };
    }

    const res = await this.loadDeck(deckId, 'equipped');
    if (seq !== this.activationSeq) {
      return {
        activatedDeckId: this.state.deckId,
        fallbackUsed: false,
        prepareMs: 0,
      };
    }

    if (res.fallbackUsed) {
      this.state = DEFAULT_RUNTIME_STATE;
      this.releaseReasonForNonActive(prevPrimaryId, EYVAN_CLASSIC_DECK_ID, 'equipped');
      this.emit();
      return res;
    }

    const loadedState = this.loadedDecks.get(res.activatedDeckId) ?? DEFAULT_RUNTIME_STATE;
    this.state = loadedState;
    this.releaseReasonForNonActive(prevPrimaryId, loadedState.deckId, 'equipped');
    this.emit();
    return res;
  }

  private releaseReasonForNonActive(
    oldDeckId: string,
    newDeckId: string,
    reason: DeckLoadReason
  ): void {
    if (!oldDeckId || oldDeckId === newDeckId || oldDeckId === EYVAN_CLASSIC_DECK_ID) {
      return;
    }
    const reasons = this.deckReasons.get(oldDeckId);
    if (!reasons) return;
    reasons.delete(reason);
    if (reasons.size === 0 && this.state.deckId !== oldDeckId) {
      const existing = this.loadedDecks.get(oldDeckId);
      this.deckReasons.delete(oldDeckId);
      this.loadedDecks.delete(oldDeckId);
      this.decodedImageCache.delete(oldDeckId);
      if (existing) {
        this.scheduleRevokeUrls(Array.from(existing.assetUrls.values()));
      }
    }
  }

  /**
   * Releases temporary `'room_seat'` display decks once players leave a room or change decks,
   * while preserving the local user's own `'equipped'` deck.
   */
  releaseRoomDecks(keepDeckIds: ReadonlySet<string> = new Set()): void {
    let changed = false;
    for (const [id, reasons] of Array.from(this.deckReasons.entries())) {
      if (id === EYVAN_CLASSIC_DECK_ID || keepDeckIds.has(id)) continue;
      if (reasons.has('room_seat')) {
        reasons.delete('room_seat');
        if (reasons.size === 0 && this.state.deckId !== id) {
          const existing = this.loadedDecks.get(id);
          this.deckReasons.delete(id);
          this.loadedDecks.delete(id);
          this.decodedImageCache.delete(id);
          if (existing) {
            this.scheduleRevokeUrls(Array.from(existing.assetUrls.values()));
          }
          changed = true;
        }
      }
    }
    if (changed) {
      this.emit();
    }
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
    const target = this.loadedDecks.get(deckId);
    if (!target) return;
    if (target.brokenAssetKeys.has(assetKey)) return;
    const nextBroken = new Set(target.brokenAssetKeys);
    nextBroken.add(assetKey);
    this.metrics.failedDecodeCount += 1;
    const updated: ActiveDeckRuntimeState = {
      ...target,
      brokenAssetKeys: nextBroken,
    };
    this.loadedDecks.set(deckId, updated);
    if (this.state.deckId === deckId) {
      this.state = updated;
    }
    this.emit();
  }

  /**
   * Flushes all pending delayed revocations and releases all active URLs (used on teardown/tests).
   */
  disposeAll(): void {
    const activeUrls: string[] = [];
    for (const st of this.loadedDecks.values()) {
      activeUrls.push(...st.assetUrls.values());
    }
    const pendingUrls = Array.from(this.pendingRevokeTimers.keys());
    this.decodedImageCache.clear();
    this.loadedDecks = new Map([[EYVAN_CLASSIC_DECK_ID, DEFAULT_RUNTIME_STATE]]);
    this.deckReasons = new Map([[EYVAN_CLASSIC_DECK_ID, new Set(['equipped'])]]);
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

export function useDeckRuntimeState(deckId?: string): ActiveDeckRuntimeState {
  return useSyncExternalStore(
    deckRuntime.subscribe,
    () => (deckId ? deckRuntime.getDeckState(deckId) : deckRuntime.getSnapshot()),
    () => (deckId ? deckRuntime.getDeckState(deckId) : deckRuntime.getSnapshot())
  );
}
