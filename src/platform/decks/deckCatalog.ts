import { getDeckCatalogUrl } from './deckHosting';
import { validateDeckCatalog } from './deckValidator';
import {
  DECK_SCHEMA_VERSION,
  DeckCatalogEntry,
  DeckLifecycleStatus,
  DeckManifest,
  DeckSystemError,
  EYVAN_CLASSIC_DECK_ID,
} from './types';

export const EYVAN_CLASSIC_DECK_MANIFEST: DeckManifest = {
  id: EYVAN_CLASSIC_DECK_ID,
  version: '1.0.0',
  schemaVersion: DECK_SCHEMA_VERSION,
  name: 'ایوان کلاسیک (اصیل)',
  description:
    'مجموعه استاندارد و سبک ایوان با کارت‌های چهره حکاکی‌شده و پشت کارت شمسه و گره‌چینی لاجوردی.',
  author: 'تیم طراحی ایوان',
  sourceUrl: '',
  license: 'Proprietary / Built-in Eyvan',
  aspectRatio: 92 / 130,
  renderMode: 'builtin_classic',
  format: 'mixed',
  styleTokens: {
    cardBackground: '#FFFFFF',
    cardBorderColor: '#CFCBC2',
    cardInnerFrame: true,
    imageFit: 'cover',
    imagePaddingPx: 0,
    backBackground: '#FFFFFF',
    backBorderColor: '#D4CFC5',
    backPaddingPx: 2,
  },
  cards: {},
  totalBytes: 0,
};

export const EYVAN_CLASSIC_CATALOG_ENTRY: DeckCatalogEntry = {
  id: EYVAN_CLASSIC_DECK_ID,
  version: '1.0.0',
  schemaVersion: DECK_SCHEMA_VERSION,
  name: EYVAN_CLASSIC_DECK_MANIFEST.name,
  subtitle: 'مجموعه پیش‌فرض و همیشه آماده آفلاین',
  description: EYVAN_CLASSIC_DECK_MANIFEST.description,
  author: EYVAN_CLASSIC_DECK_MANIFEST.author,
  sourceUrl: '',
  license: EYVAN_CLASSIC_DECK_MANIFEST.license,
  manifestPath: '',
  previewPath: '',
  previewMimeType: 'image/jpeg',
  aspectRatio: EYVAN_CLASSIC_DECK_MANIFEST.aspectRatio,
  renderMode: 'builtin_classic',
  format: 'mixed',
  totalBytes: 0,
  cardCount: 52,
  pricing: {
    access: 'builtin',
    price: 0,
    currency: 'coins',
    rarity: 'common',
    badge: 'پیش‌فرض',
  },
};

export interface ComputeStatusInput {
  readonly entry: DeckCatalogEntry;
  readonly equippedDeckId: string;
  readonly ownedDeckIds?: ReadonlySet<string>;
  readonly installedVersion?: string | null;
  readonly installComplete?: boolean;
  readonly downloadingDeckId?: string | null;
}

export function computeDeckLifecycleStatus({
  entry,
  equippedDeckId,
  ownedDeckIds,
  installedVersion,
  installComplete = false,
  downloadingDeckId,
}: ComputeStatusInput): DeckLifecycleStatus {
  if (entry.id === EYVAN_CLASSIC_DECK_ID) {
    return equippedDeckId === EYVAN_CLASSIC_DECK_ID ? 'equipped' : 'downloaded';
  }
  if (downloadingDeckId === entry.id) {
    return 'downloading';
  }
  const hasCompleteInstall = Boolean(installComplete && installedVersion);
  if (equippedDeckId === entry.id && hasCompleteInstall) {
    if (installedVersion !== entry.version) {
      return 'update_available';
    }
    return 'equipped';
  }
  if (hasCompleteInstall) {
    if (installedVersion !== entry.version) {
      return 'update_available';
    }
    return 'downloaded';
  }
  if (entry.pricing.access === 'paid') {
    const owned =
      ownedDeckIds?.has(entry.id) ||
      (entry.pricing.shopItemId ? ownedDeckIds?.has(entry.pricing.shopItemId) : false);
    if (!owned) {
      return 'paid_locked';
    }
  }
  return 'free_available';
}

const CATALOG_CACHE_KEY = 'eyvan_deck_catalog_cache_v1';

class DeckRegistryImpl {
  private entries = new Map<string, DeckCatalogEntry>([
    [EYVAN_CLASSIC_DECK_ID, EYVAN_CLASSIC_CATALOG_ENTRY],
  ]);
  private loadedFromRemote = false;

  getBuiltinManifest(): DeckManifest {
    return EYVAN_CLASSIC_DECK_MANIFEST;
  }

  getAllCatalogEntries(includeExperimental = false): DeckCatalogEntry[] {
    const list = Array.from(this.entries.values());
    return includeExperimental
      ? list
      : list.filter((entry) => !entry.isExperimental);
  }

  getCatalogEntry(deckId: string): DeckCatalogEntry | undefined {
    return this.entries.get(deckId);
  }

  registerEntries(newEntries: readonly DeckCatalogEntry[]): void {
    for (const entry of newEntries) {
      if (entry.id === EYVAN_CLASSIC_DECK_ID) continue;
      this.entries.set(entry.id, entry);
    }
  }

  resetToBuiltin(): void {
    this.entries = new Map([[EYVAN_CLASSIC_DECK_ID, EYVAN_CLASSIC_CATALOG_ENTRY]]);
    this.loadedFromRemote = false;
  }

  hydrateFromLocalCache(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(CATALOG_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      const valid = validateDeckCatalog(parsed);
      this.registerEntries(valid);
    } catch {
      // Ignore corrupt cache metadata safely
    }
  }

  private persistLocalCache(entries: readonly DeckCatalogEntry[]): void {
    if (typeof window === 'undefined') return;
    try {
      const externalOnly = entries.filter(
        (e) => e.id !== EYVAN_CLASSIC_DECK_ID && !e.isExperimental
      );
      window.localStorage.setItem(
        CATALOG_CACHE_KEY,
        JSON.stringify(externalOnly)
      );
    } catch {
      // Non-fatal
    }
  }

  async fetchCatalog(options?: {
    baseUrl?: string;
    forceRefresh?: boolean;
    fetchImpl?: typeof fetch;
    includeExperimental?: boolean;
  }): Promise<DeckCatalogEntry[]> {
    if (this.loadedFromRemote && !options?.forceRefresh && !options?.baseUrl) {
      return this.getAllCatalogEntries(options?.includeExperimental);
    }

    this.hydrateFromLocalCache();
    const fetchFn = options?.fetchImpl ?? globalThis.fetch;
    if (typeof fetchFn !== 'function') {
      return this.getAllCatalogEntries(options?.includeExperimental);
    }

    try {
      const url = getDeckCatalogUrl(options?.baseUrl);
      const res = await fetchFn(url, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        throw new DeckSystemError(
          'NETWORK_ERROR',
          `دریافت فهرست مجموعه‌ها ناموفق بود (${res.status}).`
        );
      }
      const json = (await res.json()) as unknown;
      const validated = validateDeckCatalog(json);
      // Replace external entries cleanly with fresh catalog while preserving built-in
      const nextMap = new Map<string, DeckCatalogEntry>([
        [EYVAN_CLASSIC_DECK_ID, EYVAN_CLASSIC_CATALOG_ENTRY],
      ]);
      for (const entry of validated) {
        nextMap.set(entry.id, entry);
      }
      this.entries = nextMap;
      this.loadedFromRemote = true;
      this.persistLocalCache(validated);
    } catch {
      // Offline or unavailable: silently keep built-in + previously cached metadata
    }

    return this.getAllCatalogEntries(options?.includeExperimental);
  }
}

export const DeckRegistry = new DeckRegistryImpl();
