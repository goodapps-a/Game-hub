import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Download,
  Lock,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  DeckCatalogEntry,
  DeckDownloadProgress,
  DeckInstallRecord,
  DeckLifecycleStatus,
  DeckRegistry,
  DeckSystemError,
  EYVAN_CLASSIC_DECK_ID,
  computeDeckLifecycleStatus,
  deckRuntime,
  defaultDeckStorageManager,
} from '../../decks';
import { ServerInventoryState } from '../../items/itemTypes';
import { toPersianDigits } from '../../theme/tokens';
import { SHOP_RARITY_META } from '../../utils/shopHelpers';
import {
  DeckDetailsModal,
  DeckPreviewArtwork,
} from './DeckDetailsModal';

interface DeckCatalogSectionProps {
  equippedDeckId: string;
  ownedItemIds?: readonly string[];
  userCoins?: number;
  userGems?: number;
  shopTestMode?: boolean;
  isAuthenticated?: boolean;
  onSelectDeck: (deckId: string) => void | Promise<void>;
  onClaimDeckItem?: (deckId: string) => void | Promise<void>;
  onRequireAuth?: () => void;
  onOpenTopUpShop?: () => void;
  onInventorySync?: (inventory: ServerInventoryState) => void;
  compactHeader?: boolean;
}

const STATUS_BADGE_MAP: Record<
  DeckLifecycleStatus,
  { label: string; className: string }
> = {
  equipped: {
    label: 'فعال روی میز',
    className: 'bg-[#0D8A8A] text-white border-[#2DD4BF]/50',
  },
  downloaded: {
    label: 'دریافت‌شده',
    className: 'bg-[#10B981]/18 text-[#34D399] border-[#10B981]/45',
  },
  free_available: {
    label: 'رایگان · قابل دریافت',
    className: 'bg-[#F3D179]/18 text-[#F3D179] border-[#D4AE58]/45',
  },
  paid_locked: {
    label: 'نیاز به خرید',
    className: 'bg-[#64748B]/20 text-[#CBD5E1] border-white/20',
  },
  downloading: {
    label: 'در حال دریافت...',
    className: 'bg-[#0284C7]/22 text-[#38BDF8] border-[#38BDF8]/45',
  },
  update_available: {
    label: 'به‌روزرسانی جدید',
    className: 'bg-[#F59E0B]/20 text-[#FBBF24] border-[#F59E0B]/45',
  },
};

export const DeckCatalogSection: React.FC<DeckCatalogSectionProps> = ({
  equippedDeckId,
  ownedItemIds = [],
  userCoins = 0,
  userGems = 0,
  shopTestMode = false,
  isAuthenticated = false,
  onSelectDeck,
  onClaimDeckItem,
  onRequireAuth,
  onOpenTopUpShop,
  onInventorySync,
  compactHeader = false,
}) => {
  const [entries, setEntries] = useState<DeckCatalogEntry[]>(() =>
    DeckRegistry.getAllCatalogEntries(false)
  );
  const [installedMap, setInstalledMap] = useState<
    Record<string, DeckInstallRecord>
  >({});
  const [cachedPreviews, setCachedPreviews] = useState<Record<string, string>>(
    {}
  );
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] =
    useState<DeckDownloadProgress | null>(null);
  const [busyDeckId, setBusyDeckId] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<{
    deckId?: string;
    message: string;
  } | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<DeckCatalogEntry | null>(
    null
  );

  const abortRef = useRef<AbortController | null>(null);
  const cachedPreviewUrlsRef = useRef<Record<string, string>>({});

  const refreshInstalled = useCallback(async () => {
    const list = await defaultDeckStorageManager.listInstalledRecords();
    const map: Record<string, DeckInstallRecord> = {};
    const previewUrls: Record<string, string> = {};

    for (const rec of list) {
      if (!rec.complete) continue;
      map[rec.deckId] = rec;
      const previewAsset = await defaultDeckStorageManager
        .getStore()
        .getAsset(rec.deckId, 'preview');
      if (
        previewAsset &&
        previewAsset.blob instanceof Blob &&
        previewAsset.blob.size > 0 &&
        typeof URL !== 'undefined' &&
        typeof URL.createObjectURL === 'function'
      ) {
        const existing = cachedPreviewUrlsRef.current[rec.deckId];
        previewUrls[rec.deckId] =
          existing || URL.createObjectURL(previewAsset.blob);
      }
    }

    // Revoke any stale preview URLs no longer installed
    for (const [id, oldUrl] of Object.entries(cachedPreviewUrlsRef.current)) {
      if (!previewUrls[id] && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(oldUrl);
      }
    }
    cachedPreviewUrlsRef.current = previewUrls;
    setInstalledMap(map);
    setCachedPreviews(previewUrls);
  }, []);

  useEffect(() => {
    let active = true;
    void DeckRegistry.fetchCatalog().then((fetched) => {
      if (active) setEntries(fetched);
    });
    void refreshInstalled();
    return () => {
      active = false;
      for (const u of Object.values(cachedPreviewUrlsRef.current)) {
        if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
          URL.revokeObjectURL(u);
        }
      }
      cachedPreviewUrlsRef.current = {};
    };
  }, [refreshInstalled]);

  const ownedSet = useMemo(() => new Set(ownedItemIds), [ownedItemIds]);

  const getStatusForEntry = useCallback(
    (entry: DeckCatalogEntry): DeckLifecycleStatus => {
      const rec = installedMap[entry.id];
      return computeDeckLifecycleStatus({
        entry,
        equippedDeckId,
        ownedDeckIds: ownedSet,
        installedVersion: rec?.installedVersion ?? null,
        installComplete: Boolean(rec?.complete),
        downloadingDeckId: downloadingId,
      });
    },
    [downloadingId, equippedDeckId, installedMap, ownedSet]
  );

  const handleDownload = useCallback(
    async (entry: DeckCatalogEntry) => {
      if (downloadingId) return;
      setErrorBanner(null);
      setDownloadingId(entry.id);
      setDownloadProgress({
        deckId: entry.id,
        phase: 'manifest',
        loadedBytes: 0,
        totalBytes: entry.totalBytes || 1,
        completedFiles: 0,
        totalFiles: entry.cardCount + 1,
      });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await defaultDeckStorageManager.installOrUpdateDeck({
          entry,
          signal: controller.signal,
          onProgress: (p) => setDownloadProgress(p),
        });
        await refreshInstalled();
        // If this deck was already equipped during an update, reload runtime URLs cleanly
        if (equippedDeckId === entry.id) {
          await deckRuntime.activateDeck(entry.id);
        }
      } catch (err) {
        const message =
          err instanceof DeckSystemError
            ? err.message
            : 'خطا در دریافت فایل‌های مجموعه کارت.';
        setErrorBanner({ deckId: entry.id, message });
      } finally {
        abortRef.current = null;
        setDownloadingId(null);
        setDownloadProgress(null);
      }
    },
    [downloadingId, equippedDeckId, refreshInstalled]
  );

  const handleClaimAndDownload = useCallback(
    async (entry: DeckCatalogEntry) => {
      if (onClaimDeckItem) {
        await onClaimDeckItem(entry.id);
      }
      await handleDownload(entry);
    },
    [handleDownload, onClaimDeckItem]
  );

  const handleCancelDownload = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleActivate = useCallback(
    async (deckId: string) => {
      setErrorBanner(null);
      setBusyDeckId(deckId);
      try {
        const res = await deckRuntime.activateDeck(deckId);
        if (res.fallbackUsed && deckId !== EYVAN_CLASSIC_DECK_ID) {
          await refreshInstalled();
          setErrorBanner({
            deckId,
            message:
              'فایل‌های این مجموعه کامل نیست یا حذف شده است؛ مجموعه پیش‌فرض ایوان فعال ماند.',
          });
          await onSelectDeck(EYVAN_CLASSIC_DECK_ID);
          return;
        }
        await onSelectDeck(res.activatedDeckId);
        setSelectedEntry(null);
      } catch (err) {
        setErrorBanner({
          deckId,
          message:
            err instanceof Error
              ? err.message
              : 'فعال‌سازی مجموعه کارت با خطا مواجه شد.',
        });
      } finally {
        setBusyDeckId(null);
      }
    },
    [onSelectDeck, refreshInstalled]
  );

  const handleDelete = useCallback(
    async (deckId: string) => {
      setErrorBanner(null);
      setBusyDeckId(deckId);
      try {
        await defaultDeckStorageManager.deleteDeck(deckId, equippedDeckId);
        await refreshInstalled();
        setSelectedEntry(null);
      } catch (err) {
        setErrorBanner({
          deckId,
          message:
            err instanceof DeckSystemError
              ? err.message
              : 'حذف فایل‌های مجموعه ناموفق بود.',
        });
      } finally {
        setBusyDeckId(null);
      }
    },
    [equippedDeckId, refreshInstalled]
  );

  const selectedStatus = selectedEntry
    ? getStatusForEntry(selectedEntry)
    : null;

  return (
    <section
      data-testid="shop-card-decks-section"
      aria-label="دست‌های کارت"
      className="space-y-3"
    >
      {!compactHeader && (
        <div className="flex items-center justify-between gap-2 px-0.5">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-extrabold theme-heading truncate">
              دست‌های کارت
            </h2>
            <p className="text-[11px] sm:text-xs theme-muted truncate mt-0.5">
              مجموعه‌های ۵۲ برگ قابل استفاده روی میز حکم
            </p>
          </div>
          <span className="text-[11px] font-extrabold theme-accent-teal shrink-0">
            {toPersianDigits(entries.length)} مجموعه
          </span>
        </div>
      )}

      {errorBanner && !selectedEntry && (
        <div
          role="alert"
          data-testid="deck-catalog-error"
          className="rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs font-bold text-red-400"
        >
          {errorBanner.message}
        </div>
      )}

      {selectedEntry && selectedStatus && (
        <DeckDetailsModal
          entry={selectedEntry}
          status={selectedStatus}
          installedRecord={installedMap[selectedEntry.id] ?? null}
          progress={
            downloadingId === selectedEntry.id ? downloadProgress : null
          }
          busyDeckId={busyDeckId}
          errorMessage={
            errorBanner?.deckId === selectedEntry.id ? errorBanner.message : null
          }
          cachedPreviewUrl={cachedPreviews[selectedEntry.id]}
          userCoins={userCoins}
          userGems={userGems}
          shopTestMode={shopTestMode}
          isAuthenticated={isAuthenticated}
          onDownload={handleDownload}
          onClaimAndDownload={handleClaimAndDownload}
          onCancelDownload={handleCancelDownload}
          onActivate={handleActivate}
          onDelete={handleDelete}
          onSwitchToClassic={() => handleActivate(EYVAN_CLASSIC_DECK_ID)}
          onRequireAuth={onRequireAuth}
          onOpenTopUpShop={onOpenTopUpShop}
          onInventorySync={onInventorySync}
          onClose={() => setSelectedEntry(null)}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {entries.map((entry) => {
          const status = getStatusForEntry(entry);
          const badge = STATUS_BADGE_MAP[status];
          const rarity = SHOP_RARITY_META[entry.pricing.rarity];
          const isBuiltin = entry.id === EYVAN_CLASSIC_DECK_ID;
          const isDownloadingThis = status === 'downloading';
          const isBusyThis = busyDeckId === entry.id;
          const pct =
            isDownloadingThis &&
            downloadProgress &&
            downloadProgress.totalBytes > 0
              ? Math.min(
                  100,
                  Math.round(
                    (downloadProgress.loadedBytes /
                      downloadProgress.totalBytes) *
                      100
                  )
                )
              : 0;
          const canDelete =
            !isBuiltin &&
            status !== 'equipped' &&
            (status === 'downloaded' || status === 'update_available');

          return (
            <div
              key={entry.id}
              data-testid={`deck-card-${entry.id}`}
              data-deck-status={status}
              className={`eyvan-card rounded-2xl p-3 flex flex-col justify-between gap-3 transition-all ${
                status === 'equipped'
                  ? 'border-[#19A2A2]/70 ring-1 ring-[#19A2A2]/35'
                  : ''
              }`}
            >
              {/* Clickable Card Preview + Meta */}
              <button
                type="button"
                onClick={() => setSelectedEntry(entry)}
                data-testid={`deck-open-details-${entry.id}`}
                className="text-right space-y-2.5 cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--eyvan-teal)] rounded-xl"
              >
                <div className="relative h-36 rounded-xl overflow-hidden border border-white/10">
                  <DeckPreviewArtwork
                    entry={entry}
                    cachedPreviewUrl={cachedPreviews[entry.id]}
                  />
                  <span
                    className={`absolute top-2 right-2 px-2 py-0.5 rounded-md text-[10px] font-extrabold border backdrop-blur-xs ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                </div>

                <div className="space-y-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-extrabold theme-accent-teal">
                      دسته کارت
                      <span className={`font-bold ${rarity.textAccent}`}>
                        {' · '}{rarity.label}
                      </span>
                    </span>
                    <span className="text-[10px] font-bold theme-muted">
                      {entry.pricing.access === 'builtin'
                        ? 'پیش‌فرض'
                        : entry.pricing.access === 'free'
                          ? 'رایگان'
                          : `${toPersianDigits(entry.pricing.price.toLocaleString())} ${
                              entry.pricing.currency === 'gems' ? 'الماس' : 'سکه'
                            }`}
                    </span>
                  </div>

                  <h3 className="text-sm font-black theme-heading line-clamp-1 group-hover:text-[var(--eyvan-gold)] transition-colors">
                    {entry.name}
                  </h3>
                  <p className="text-[11px] theme-muted line-clamp-2 leading-relaxed min-h-[2.2em]">
                    {entry.subtitle}
                  </p>
                </div>
              </button>

              {/* Progress bar when downloading */}
              {isDownloadingThis && (
                <div className="space-y-1">
                  <div className="h-1.5 rounded-full bg-black/25 overflow-hidden">
                    <div
                      className="h-full bg-[#2DD4BF] transition-all duration-150"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] theme-muted">
                    <span>{toPersianDigits(pct)}٪</span>
                    <button
                      type="button"
                      onClick={handleCancelDownload}
                      className="text-red-400 font-bold cursor-pointer hover:underline"
                    >
                      انصراف
                    </button>
                  </div>
                </div>
              )}

              {/* Direct Footer Actions */}
              <div className="pt-2 border-t border-[var(--eyvan-line)] flex items-center gap-2">
                {status === 'equipped' && (
                  <div className="flex-1 min-h-[36px] px-3 rounded-xl bg-[#0D8A8A]/14 border border-[#0D8A8A]/40 theme-win text-xs font-black flex items-center justify-center gap-1.5">
                    <Check className="w-3.5 h-3.5 shrink-0" />
                    <span>فعال در بازی</span>
                  </div>
                )}

                {status === 'downloaded' && (
                  <button
                    type="button"
                    disabled={isBusyThis}
                    data-testid={`deck-card-activate-${entry.id}`}
                    onClick={() => void handleActivate(entry.id)}
                    className="flex-1 min-h-[36px] px-3 rounded-xl bg-[#0D8A8A] hover:bg-[#11A3A3] text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer transition-colors disabled:opacity-60"
                  >
                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                    <span>{isBusyThis ? 'صبر کنید...' : 'فعال‌سازی'}</span>
                  </button>
                )}

                {status === 'free_available' && (
                  <button
                    type="button"
                    disabled={isBusyThis || Boolean(downloadingId)}
                    data-testid={`deck-card-download-${entry.id}`}
                    onClick={() => void handleDownload(entry)}
                    className="flex-1 min-h-[36px] px-3 rounded-xl bg-gradient-to-b from-[#F5D98E] to-[#C89634] text-[#0B1628] text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-60"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>دریافت رایگان</span>
                  </button>
                )}

                {status === 'update_available' && (
                  <button
                    type="button"
                    disabled={isBusyThis || Boolean(downloadingId)}
                    data-testid={`deck-card-update-${entry.id}`}
                    onClick={() => void handleDownload(entry)}
                    className="flex-1 min-h-[36px] px-3 rounded-xl bg-[#F59E0B] text-[#0B1628] text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer transition-colors disabled:opacity-60"
                  >
                    <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                    <span>به‌روزرسانی</span>
                  </button>
                )}

                {status === 'paid_locked' && (
                  <button
                    type="button"
                    onClick={() => setSelectedEntry(entry)}
                    className="flex-1 min-h-[36px] px-3 rounded-xl theme-subcard border theme-muted text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    <span>جزئیات</span>
                  </button>
                )}

                {canDelete && (
                  <button
                    type="button"
                    disabled={isBusyThis}
                    title="حذف مجموعه از دستگاه"
                    aria-label={`حذف ${entry.name}`}
                    data-testid={`deck-card-delete-${entry.id}`}
                    onClick={() => void handleDelete(entry.id)}
                    className="w-9 h-9 rounded-xl border border-red-500/35 text-red-400 hover:bg-red-500/10 flex items-center justify-center shrink-0 cursor-pointer transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
