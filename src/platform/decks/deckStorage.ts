import { getDeckAssetsBaseUrl, isSafeRelativeDeckPath, resolveDeckUrl } from './deckHosting';
import {
  computeSha256Hex,
  validateAssetBuffer,
  validateDeckManifest,
} from './deckValidator';
import {
  DeckAssetEntry,
  DeckCatalogEntry,
  DeckDownloadProgress,
  DeckInstallRecord,
  DeckManifest,
  DeckSystemError,
  EYVAN_CLASSIC_DECK_ID,
} from './types';

export interface StoredDeckAsset {
  readonly key: string;
  readonly deckId: string;
  readonly assetKey: string;
  readonly hash: string;
  readonly bytes: number;
  readonly mimeType: DeckAssetEntry['mimeType'];
  readonly blob: Blob;
  readonly updatedAt: number;
}

export interface DeckBlobStore {
  getManifest(deckId: string): Promise<DeckInstallRecord | null>;
  putManifest(record: DeckInstallRecord): Promise<void>;
  deleteManifest(deckId: string): Promise<void>;
  getAllManifests(): Promise<DeckInstallRecord[]>;
  getAsset(deckId: string, assetKey: string): Promise<StoredDeckAsset | null>;
  getAllAssetsForDeck(deckId: string): Promise<StoredDeckAsset[]>;
  putAsset(asset: StoredDeckAsset): Promise<void>;
  putAssetsBatch(assets: readonly StoredDeckAsset[]): Promise<void>;
  deleteAssetsForDeck(deckId: string, onlyKeys?: readonly string[]): Promise<void>;
  listAssetKeysForDeck(deckId: string): Promise<string[]>;
  clearAll(): Promise<void>;
}

const DB_NAME = 'eyvan-decks-db';
const DB_VERSION = 1;
const STORE_MANIFESTS = 'manifests';
const STORE_ASSETS = 'assets';

export function makeAssetCompositeKey(deckId: string, assetKey: string): string {
  return `${deckId}::${assetKey}`;
}

export class IndexedDBDeckBlobStore implements DeckBlobStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDb(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(
        new DeckSystemError(
          'STORAGE_UNAVAILABLE',
          'حافظه IndexedDB در این مرورگر در دسترس نیست.'
        )
      );
    }
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_MANIFESTS)) {
          db.createObjectStore(STORE_MANIFESTS, { keyPath: 'deckId' });
        }
        if (!db.objectStoreNames.contains(STORE_ASSETS)) {
          const assetsStore = db.createObjectStore(STORE_ASSETS, {
            keyPath: 'key',
          });
          assetsStore.createIndex('byDeck', 'deckId', { unique: false });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        this.dbPromise = null;
        reject(
          new DeckSystemError(
            'STORAGE_UNAVAILABLE',
            'خطا در باز کردن پایگاه‌داده آفلاین مجموعه‌ها.'
          )
        );
      };
    });

    return this.dbPromise;
  }

  private async runTx<T>(
    storeName: string,
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    const db = await this.openDb();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const req = fn(store);
      let settled = false;
      let reqResult: T | undefined;
      let hasResult = false;

      const fail = () => {
        if (settled) return;
        settled = true;
        reject(
          new DeckSystemError(
            'STORAGE_UNAVAILABLE',
            'عملیات خواندن یا نوشتن حافظه آفلاین ناموفق بود.'
          )
        );
      };

      req.onsuccess = () => {
        reqResult = req.result;
        hasResult = true;
      };
      req.onerror = fail;
      tx.onabort = fail;
      tx.onerror = fail;
      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve((hasResult ? reqResult : req.result) as T);
      };
    });
  }

  async getManifest(deckId: string): Promise<DeckInstallRecord | null> {
    const res = await this.runTx<DeckInstallRecord | undefined>(
      STORE_MANIFESTS,
      'readonly',
      (s) => s.get(deckId)
    );
    return res ?? null;
  }

  async putManifest(record: DeckInstallRecord): Promise<void> {
    await this.runTx(STORE_MANIFESTS, 'readwrite', (s) => s.put(record));
  }

  async deleteManifest(deckId: string): Promise<void> {
    await this.runTx(STORE_MANIFESTS, 'readwrite', (s) => s.delete(deckId));
  }

  async getAllManifests(): Promise<DeckInstallRecord[]> {
    const rows = await this.runTx<DeckInstallRecord[]>(
      STORE_MANIFESTS,
      'readonly',
      (s) => s.getAll()
    );
    return Array.isArray(rows) ? rows : [];
  }

  async getAsset(
    deckId: string,
    assetKey: string
  ): Promise<StoredDeckAsset | null> {
    const res = await this.runTx<StoredDeckAsset | undefined>(
      STORE_ASSETS,
      'readonly',
      (s) => s.get(makeAssetCompositeKey(deckId, assetKey))
    );
    return res ?? null;
  }

  async getAllAssetsForDeck(deckId: string): Promise<StoredDeckAsset[]> {
    const db = await this.openDb();
    return new Promise<StoredDeckAsset[]>((resolve, reject) => {
      const tx = db.transaction(STORE_ASSETS, 'readonly');
      const store = tx.objectStore(STORE_ASSETS);
      const index = store.index('byDeck');
      const req = index.getAll(deckId);
      req.onsuccess = () => {
        resolve((req.result as StoredDeckAsset[] | undefined) ?? []);
      };
      req.onerror = () =>
        reject(
          new DeckSystemError(
            'STORAGE_UNAVAILABLE',
            'خطا در خواندن فایل‌های مجموعه.'
          )
        );
    });
  }

  async putAsset(asset: StoredDeckAsset): Promise<void> {
    await this.runTx(STORE_ASSETS, 'readwrite', (s) => s.put(asset));
  }

  async putAssetsBatch(assets: readonly StoredDeckAsset[]): Promise<void> {
    if (assets.length === 0) return;
    const db = await this.openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_ASSETS, 'readwrite');
      const store = tx.objectStore(STORE_ASSETS);
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        reject(
          new DeckSystemError(
            'STORAGE_QUOTA_EXCEEDED',
            'ذخیره‌سازی فایل‌های مجموعه در حافظه دستگاه با خطا مواجه شد.'
          )
        );
      };
      for (const asset of assets) {
        store.put(asset);
      }
      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      tx.onabort = fail;
      tx.onerror = fail;
    });
  }

  async listAssetKeysForDeck(deckId: string): Promise<string[]> {
    const rows = await this.getAllAssetsForDeck(deckId);
    return rows.map((r) => r.assetKey);
  }

  async deleteAssetsForDeck(
    deckId: string,
    onlyKeys?: readonly string[]
  ): Promise<void> {
    const keysToDelete =
      onlyKeys ?? (await this.listAssetKeysForDeck(deckId));
    if (keysToDelete.length === 0) return;

    const db = await this.openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_ASSETS, 'readwrite');
      const store = tx.objectStore(STORE_ASSETS);
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        reject(
          new DeckSystemError(
            'STORAGE_UNAVAILABLE',
            'خطا در حذف فایل‌های مجموعه.'
          )
        );
      };
      for (const ak of keysToDelete) {
        store.delete(makeAssetCompositeKey(deckId, ak));
      }
      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      tx.onabort = fail;
      tx.onerror = fail;
    });
  }

  async clearAll(): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_MANIFESTS, STORE_ASSETS], 'readwrite');
      tx.objectStore(STORE_MANIFESTS).clear();
      tx.objectStore(STORE_ASSETS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export class InMemoryDeckBlobStore implements DeckBlobStore {
  private manifests = new Map<string, DeckInstallRecord>();
  private assets = new Map<string, StoredDeckAsset>();

  async getManifest(deckId: string): Promise<DeckInstallRecord | null> {
    return this.manifests.get(deckId) ?? null;
  }
  async putManifest(record: DeckInstallRecord): Promise<void> {
    this.manifests.set(record.deckId, record);
  }
  async deleteManifest(deckId: string): Promise<void> {
    this.manifests.delete(deckId);
  }
  async getAllManifests(): Promise<DeckInstallRecord[]> {
    return Array.from(this.manifests.values());
  }
  async getAsset(
    deckId: string,
    assetKey: string
  ): Promise<StoredDeckAsset | null> {
    return this.assets.get(makeAssetCompositeKey(deckId, assetKey)) ?? null;
  }
  async getAllAssetsForDeck(deckId: string): Promise<StoredDeckAsset[]> {
    const out: StoredDeckAsset[] = [];
    for (const val of this.assets.values()) {
      if (val.deckId === deckId) out.push(val);
    }
    return out;
  }
  async putAsset(asset: StoredDeckAsset): Promise<void> {
    this.assets.set(asset.key, asset);
  }
  async putAssetsBatch(assets: readonly StoredDeckAsset[]): Promise<void> {
    for (const asset of assets) {
      this.assets.set(asset.key, asset);
    }
  }
  async listAssetKeysForDeck(deckId: string): Promise<string[]> {
    const out: string[] = [];
    for (const val of this.assets.values()) {
      if (val.deckId === deckId) out.push(val.assetKey);
    }
    return out;
  }
  async deleteAssetsForDeck(
    deckId: string,
    onlyKeys?: readonly string[]
  ): Promise<void> {
    const targets = onlyKeys ?? (await this.listAssetKeysForDeck(deckId));
    for (const ak of targets) {
      this.assets.delete(makeAssetCompositeKey(deckId, ak));
    }
  }
  async clearAll(): Promise<void> {
    this.manifests.clear();
    this.assets.clear();
  }
}

export interface ManifestAssetItem {
  readonly assetKey: string;
  readonly entry: DeckAssetEntry;
}

export function collectManifestAssets(
  manifest: DeckManifest
): ManifestAssetItem[] {
  const items: ManifestAssetItem[] = [];
  if (manifest.preview) {
    items.push({ assetKey: 'preview', entry: manifest.preview });
  }
  if (manifest.back) {
    items.push({ assetKey: 'back', entry: manifest.back });
  }
  for (const [cardId, entry] of Object.entries(manifest.cards)) {
    if (entry) {
      items.push({ assetKey: `card:${cardId}`, entry });
    }
  }
  if (manifest.jokers?.red) {
    items.push({ assetKey: 'joker:red', entry: manifest.jokers.red });
  }
  if (manifest.jokers?.black) {
    items.push({ assetKey: 'joker:black', entry: manifest.jokers.black });
  }
  return items;
}

function getDeckRootFromManifestPath(manifestPath: string): string {
  const idx = manifestPath.lastIndexOf('/');
  return idx > 0 ? manifestPath.slice(0, idx) : '';
}

function joinDeckPath(rootDir: string, relativePath: string): string {
  if (!isSafeRelativeDeckPath(relativePath)) {
    throw new DeckSystemError(
      'INVALID_MANIFEST',
      `مسیر فایل در Manifest امن نیست: ${relativePath}`
    );
  }
  return rootDir ? `${rootDir}/${relativePath}` : relativePath;
}

export async function requestPersistentStorageBestEffort(): Promise<boolean> {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.persist === 'function'
    ) {
      return await navigator.storage.persist();
    }
  } catch {
    // Non-fatal in unsupported webviews
  }
  return false;
}

export interface StorageSpaceCheck {
  readonly ok: boolean;
  readonly availableBytes: number | null;
}

export async function checkStorageSpace(
  requiredBytes: number
): Promise<StorageSpaceCheck> {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.estimate === 'function'
    ) {
      const est = await navigator.storage.estimate();
      if (
        typeof est.quota === 'number' &&
        typeof est.usage === 'number'
      ) {
        const available = Math.max(0, est.quota - est.usage);
        // Leave a 4MB safety headroom for app shell & gameplay state
        return {
          ok: available >= requiredBytes + 4 * 1024 * 1024,
          availableBytes: available,
        };
      }
    }
  } catch {
    // Estimate unavailable -> proceed optimistically and catch write errors cleanly
  }
  return { ok: true, availableBytes: null };
}

export interface InstallDeckOptions {
  readonly entry: DeckCatalogEntry;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: DeckDownloadProgress) => void;
}

export class DeckStorageManager {
  private readonly store: DeckBlobStore;
  private activeDownloads = new Map<string, Promise<DeckInstallRecord>>();

  constructor(store?: DeckBlobStore) {
    this.store = store ?? new IndexedDBDeckBlobStore();
  }

  getStore(): DeckBlobStore {
    return this.store;
  }

  async listInstalledRecords(): Promise<DeckInstallRecord[]> {
    try {
      return await this.store.getAllManifests();
    } catch {
      return [];
    }
  }

  async getInstalledRecord(deckId: string): Promise<DeckInstallRecord | null> {
    if (deckId === EYVAN_CLASSIC_DECK_ID) return null;
    try {
      return await this.store.getManifest(deckId);
    } catch {
      return null;
    }
  }

  /**
   * Verifies that an installed deck record still has ALL required blobs in IndexedDB.
   * Detects OS IndexedDB eviction or incomplete/corrupted blobs and self-heals cleanly.
   */
  async verifyDeckIntegrity(deckId: string): Promise<{
    ok: boolean;
    record: DeckInstallRecord | null;
    missingKeys: string[];
  }> {
    if (deckId === EYVAN_CLASSIC_DECK_ID) {
      return { ok: true, record: null, missingKeys: [] };
    }
    const record = await this.getInstalledRecord(deckId);
    if (!record || !record.complete) {
      if (record && !record.complete) {
        await this.cleanupBrokenInstall(deckId);
      }
      return { ok: false, record: null, missingKeys: ['manifest'] };
    }

    const expectedAssets = collectManifestAssets(record.manifest);
    const storedRows = await this.store.getAllAssetsForDeck(deckId);
    const storedMap = new Map<string, StoredDeckAsset>();
    for (const row of storedRows) {
      storedMap.set(row.assetKey, row);
    }
    const missingKeys: string[] = [];

    for (const item of expectedAssets) {
      const stored = storedMap.get(item.assetKey);
      if (
        !stored ||
        !(stored.blob instanceof Blob) ||
        stored.blob.size === 0 ||
        stored.hash !== item.entry.hash
      ) {
        missingKeys.push(item.assetKey);
      }
    }

    if (missingKeys.length > 0) {
      await this.cleanupBrokenInstall(deckId);
      return { ok: false, record: null, missingKeys };
    }

    return { ok: true, record, missingKeys: [] };
  }

  private async cleanupBrokenInstall(deckId: string): Promise<void> {
    try {
      await this.store.deleteAssetsForDeck(deckId);
      await this.store.deleteManifest(deckId);
    } catch {
      // Non-fatal cleanup
    }
  }

  /**
   * Downloads or updates a deck incrementally using content hashes (Delta Update).
   * Prevents duplicate concurrent downloads and NEVER activates incomplete/corrupted sets.
   */
  async installOrUpdateDeck(
    options: InstallDeckOptions
  ): Promise<DeckInstallRecord> {
    const { entry } = options;
    if (entry.id === EYVAN_CLASSIC_DECK_ID) {
      throw new DeckSystemError(
        'INVALID_MANIFEST',
        'مجموعه پیش‌فرض نیازی به دریافت ندارد.'
      );
    }

    const inflight = this.activeDownloads.get(entry.id);
    if (inflight) {
      return inflight;
    }

    const job = this.runInstallOrUpdate(options).finally(() => {
      this.activeDownloads.delete(entry.id);
    });
    this.activeDownloads.set(entry.id, job);
    return job;
  }

  private async runInstallOrUpdate(
    options: InstallDeckOptions
  ): Promise<DeckInstallRecord> {
    const {
      entry,
      baseUrl = getDeckAssetsBaseUrl(),
      fetchImpl = globalThis.fetch,
      signal,
      onProgress,
    } = options;

    if (
      typeof navigator !== 'undefined' &&
      navigator.onLine === false &&
      typeof fetchImpl !== 'function'
    ) {
      throw new DeckSystemError('OFFLINE', 'اتصال اینترنت برقرار نیست.');
    }

    if (typeof fetchImpl !== 'function') {
      throw new DeckSystemError(
        'NETWORK_ERROR',
        'ابزار دریافت شبکه در دسترس نیست.'
      );
    }

    onProgress?.({
      deckId: entry.id,
      phase: 'manifest',
      loadedBytes: 0,
      totalBytes: entry.totalBytes || 1,
      completedFiles: 0,
      totalFiles: entry.cardCount + 1,
    });

    // 1. Fetch & validate manifest.json
    const manifestUrl = resolveDeckUrl(entry.manifestPath, baseUrl);
    let manifestJson: unknown;
    try {
      const res = await fetchImpl(manifestUrl, {
        method: 'GET',
        cache: 'no-store',
        signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        throw new DeckSystemError(
          'NETWORK_ERROR',
          `دریافت اطلاعات مجموعه ناموفق بود (کد ${res.status}).`
        );
      }
      manifestJson = (await res.json()) as unknown;
    } catch (err) {
      if (err instanceof DeckSystemError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new DeckSystemError('ABORTED', 'دریافت مجموعه لغو شد.');
      }
      throw new DeckSystemError(
        typeof navigator !== 'undefined' && navigator.onLine === false
          ? 'OFFLINE'
          : 'NETWORK_ERROR',
        'امکان دریافت اطلاعات مجموعه وجود ندارد. اتصال اینترنت را بررسی کنید.'
      );
    }

    const manifest = validateDeckManifest(manifestJson);
    if (manifest.id !== entry.id) {
      throw new DeckSystemError(
        'INVALID_MANIFEST',
        'شناسه Manifest با کاتالوگ فروشگاه مطابقت ندارد.'
      );
    }

    const manifestAssets = collectManifestAssets(manifest);
    const existingRecord = await this.getInstalledRecord(manifest.id);

    // 2. Delta calculation: skip files whose hash matches a verified existing blob!
    const assetsToDownload: ManifestAssetItem[] = [];
    const verifiedHashes: Record<string, string> = {};

    for (const item of manifestAssets) {
      const prevHash = existingRecord?.assetHashes?.[item.assetKey];
      if (prevHash === item.entry.hash && existingRecord?.complete) {
        const existingBlob = await this.store.getAsset(
          manifest.id,
          item.assetKey
        );
        if (
          existingBlob &&
          existingBlob.blob.size > 0 &&
          existingBlob.hash === item.entry.hash
        ) {
          verifiedHashes[item.assetKey] = item.entry.hash;
          continue;
        }
      }
      assetsToDownload.push(item);
    }

    const deltaBytes = assetsToDownload.reduce(
      (sum, item) => sum + item.entry.bytes,
      0
    );

    // 3. Request persistent storage & check available quota for the delta
    await requestPersistentStorageBestEffort();
    const spaceCheck = await checkStorageSpace(deltaBytes);
    if (!spaceCheck.ok) {
      throw new DeckSystemError(
        'STORAGE_QUOTA_EXCEEDED',
        'فضای ذخیره‌سازی دستگاه برای دریافت این مجموعه کافی نیست.'
      );
    }

    const deckRootDir = getDeckRootFromManifestPath(entry.manifestPath);
    const totalFiles = manifestAssets.length;
    const totalBytes = Math.max(
      1,
      manifestAssets.reduce((s, x) => s + x.entry.bytes, 0)
    );
    let completedFiles = manifestAssets.length - assetsToDownload.length;
    let loadedBytes = manifestAssets
      .filter((x) => verifiedHashes[x.assetKey])
      .reduce((s, x) => s + x.entry.bytes, 0);

    onProgress?.({
      deckId: manifest.id,
      phase: 'assets',
      loadedBytes,
      totalBytes,
      completedFiles,
      totalFiles,
    });

    // 4. Download & verify ONLY missing/changed files with bounded concurrency
    const stagedAssets: StoredDeckAsset[] = [];
    const CONCURRENCY = 6;
    let cursor = 0;

    const downloadNext = async (): Promise<void> => {
      while (cursor < assetsToDownload.length) {
        if (signal?.aborted) {
          throw new DeckSystemError('ABORTED', 'دریافت مجموعه لغو شد.');
        }
        const item = assetsToDownload[cursor++];
        const relPath = joinDeckPath(deckRootDir, item.entry.path);
        const url = resolveDeckUrl(relPath, baseUrl);

        let buffer: ArrayBuffer;
        try {
          const res = await fetchImpl(url, {
            method: 'GET',
            cache: 'no-store',
            signal,
          });
          if (!res.ok) {
            throw new DeckSystemError(
              'NETWORK_ERROR',
              `خطا در دریافت فایل «${item.assetKey}» (کد ${res.status}).`
            );
          }
          buffer = await res.arrayBuffer();
        } catch (err) {
          if (err instanceof DeckSystemError) throw err;
          if (err instanceof Error && err.name === 'AbortError') {
            throw new DeckSystemError('ABORTED', 'دریافت مجموعه لغو شد.');
          }
          throw new DeckSystemError(
            typeof navigator !== 'undefined' && navigator.onLine === false
              ? 'OFFLINE'
              : 'NETWORK_ERROR',
            `دریافت فایل «${item.assetKey}» به دلیل قطعی شبکه متوقف شد.`
          );
        }

        // Verify binary format / SVG safety + exact SHA-256 hash
        validateAssetBuffer(buffer, item.entry.mimeType, item.assetKey);
        const actualHash = await computeSha256Hex(buffer);
        if (actualHash !== item.entry.hash) {
          throw new DeckSystemError(
            'HASH_MISMATCH',
            `فایل «${item.assetKey}» ناقص یا تغییریافته است (عدم تطابق Hash).`
          );
        }

        const blob = new Blob([buffer], { type: item.entry.mimeType });
        stagedAssets.push({
          key: makeAssetCompositeKey(manifest.id, item.assetKey),
          deckId: manifest.id,
          assetKey: item.assetKey,
          hash: actualHash,
          bytes: buffer.byteLength,
          mimeType: item.entry.mimeType,
          blob,
          updatedAt: Date.now(),
        });

        verifiedHashes[item.assetKey] = actualHash;
        completedFiles += 1;
        loadedBytes += item.entry.bytes;

        onProgress?.({
          deckId: manifest.id,
          phase: 'assets',
          loadedBytes,
          totalBytes,
          completedFiles,
          totalFiles,
        });
      }
    };

    const workers = Array.from(
      { length: Math.min(CONCURRENCY, Math.max(1, assetsToDownload.length)) },
      () => downloadNext()
    );
    await Promise.all(workers);

    onProgress?.({
      deckId: manifest.id,
      phase: 'verifying',
      loadedBytes: totalBytes,
      totalBytes,
      completedFiles: totalFiles,
      totalFiles,
    });

    // 5. Commit newly downloaded blobs + complete manifest safely, preserving any valid prior version on write failure
    let rollbackSnapshot: {
      record: DeckInstallRecord;
      assets: StoredDeckAsset[];
    } | null = null;
    if (existingRecord?.complete) {
      try {
        const prevAssets = await this.store.getAllAssetsForDeck(manifest.id);
        rollbackSnapshot = { record: existingRecord, assets: prevAssets };
      } catch {
        rollbackSnapshot = null;
      }
    }

    try {
      await this.store.putAssetsBatch(stagedAssets);

      // Prune obsolete asset keys no longer referenced in the updated manifest
      const wantedKeys = new Set(manifestAssets.map((a) => a.assetKey));
      const existingKeys = await this.store.listAssetKeysForDeck(manifest.id);
      const obsoleteKeys = existingKeys.filter((k) => !wantedKeys.has(k));
      if (obsoleteKeys.length > 0) {
        await this.store.deleteAssetsForDeck(manifest.id, obsoleteKeys);
      }

      const now = Date.now();
      const record: DeckInstallRecord = {
        deckId: manifest.id,
        installedVersion: manifest.version,
        manifest,
        assetHashes: verifiedHashes,
        complete: true,
        installedAt: existingRecord?.installedAt ?? now,
        updatedAt: now,
      };
      await this.store.putManifest(record);
      return record;
    } catch (err) {
      if (rollbackSnapshot) {
        try {
          await this.store.putAssetsBatch(rollbackSnapshot.assets);
          await this.store.putManifest(rollbackSnapshot.record);
        } catch {
          // Best-effort rollback
        }
      }
      if (err instanceof DeckSystemError) throw err;
      throw new DeckSystemError(
        'STORAGE_QUOTA_EXCEEDED',
        'ذخیره‌سازی فایل‌های مجموعه در حافظه دستگاه با خطا مواجه شد.'
      );
    }
  }

  /**
   * Loads all stored blobs for an installed, verified deck in a single DB pass.
   */
  async loadDeckBlobs(deckId: string): Promise<{
    manifest: DeckManifest;
    blobs: Map<string, Blob>;
  } | null> {
    if (deckId === EYVAN_CLASSIC_DECK_ID) return null;
    const record = await this.getInstalledRecord(deckId);
    if (!record || !record.complete) {
      if (record && !record.complete) {
        await this.cleanupBrokenInstall(deckId);
      }
      return null;
    }
    const { manifest } = record;
    const expectedAssets = collectManifestAssets(manifest);
    const storedRows = await this.store.getAllAssetsForDeck(deckId);
    const storedMap = new Map<string, StoredDeckAsset>();
    for (const row of storedRows) {
      storedMap.set(row.assetKey, row);
    }

    const blobs = new Map<string, Blob>();
    for (const item of expectedAssets) {
      const stored = storedMap.get(item.assetKey);
      if (
        !stored ||
        !(stored.blob instanceof Blob) ||
        stored.blob.size === 0 ||
        stored.hash !== item.entry.hash
      ) {
        await this.cleanupBrokenInstall(deckId);
        return null;
      }
      blobs.set(item.assetKey, stored.blob);
    }
    return { manifest, blobs };
  }

  /**
   * Safely deletes an inactive downloaded deck. Strictly blocks removing the built-in
   * default deck or the currently equipped active deck without a replacement switch.
   */
  async deleteDeck(deckId: string, activeDeckId: string): Promise<void> {
    if (deckId === EYVAN_CLASSIC_DECK_ID) {
      throw new DeckSystemError(
        'CANNOT_DELETE_BUILTIN',
        'مجموعه پیش‌فرض ایوان قابل حذف نیست.'
      );
    }
    if (deckId === activeDeckId) {
      throw new DeckSystemError(
        'CANNOT_DELETE_ACTIVE',
        'ابتدا مجموعه دیگری را انتخاب کنید؛ مجموعه فعال قابل حذف نیست.'
      );
    }
    await this.store.deleteAssetsForDeck(deckId);
    await this.store.deleteManifest(deckId);
  }
}

export const defaultDeckStorageManager = new DeckStorageManager();
