import React, { useEffect, useState } from 'react';
import {
  Check,
  Download,
  Gift,
  Lock,
  RefreshCw,
  Sparkles,
  Trash2,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react';
import {
  DeckCatalogEntry,
  DeckDownloadProgress,
  DeckInstallRecord,
  DeckLifecycleStatus,
  DeckManifest,
  EYVAN_CLASSIC_DECK_ID,
  defaultDeckStorageManager,
  resolveDeckUrl,
} from '../../decks';
import { toDeckItemId } from '../../items/catalogData';
import { ServerInventoryState } from '../../items/itemTypes';
import { toPersianDigits } from '../../theme/tokens';
import { SHOP_RARITY_META } from '../../utils/shopHelpers';
import { GoldCoinSvg, PurpleGemSvg } from '../TopBar';
import { ShopGiftPanel } from './ShopGiftPanel';

export function formatDeckBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return 'داخلی';
  }
  if (bytes < 1024 * 1024) {
    const kb = Math.max(1, Math.round(bytes / 1024));
    return `${toPersianDigits(kb.toLocaleString())} کیلوبایت`;
  }
  const mb = (bytes / (1024 * 1024)).toFixed(2);
  return `${toPersianDigits(mb)} مگابایت`;
}

export interface DeckFanUrls {
  readonly back: string;
  readonly spadesA: string;
  readonly heartsK: string;
}

const manifestFanUrlCache = new Map<string, DeckFanUrls>();

function useDeckFanPreviewUrls(
  entry: DeckCatalogEntry
): DeckFanUrls | null {
  const [fanUrls, setFanUrls] = useState<DeckFanUrls | null>(() =>
    entry.id === EYVAN_CLASSIC_DECK_ID
      ? null
      : manifestFanUrlCache.get(entry.id) ?? null
  );

  useEffect(() => {
    if (entry.id === EYVAN_CLASSIC_DECK_ID) {
      setFanUrls(null);
      return;
    }

    let cancelled = false;
    const createdBlobUrls: string[] = [];

    const resolveFan = async () => {
      // 1. Prefer crisp blobs already cached locally in IndexedDB
      try {
        const store = defaultDeckStorageManager.getStore();
        const [backRec, aceRec, kingRec] = await Promise.all([
          store.getAsset(entry.id, 'back'),
          store.getAsset(entry.id, 'card:spades-A'),
          store.getAsset(entry.id, 'card:hearts-K'),
        ]);
        if (
          !cancelled &&
          backRec?.blob instanceof Blob &&
          backRec.blob.size > 0 &&
          aceRec?.blob instanceof Blob &&
          aceRec.blob.size > 0 &&
          kingRec?.blob instanceof Blob &&
          kingRec.blob.size > 0 &&
          typeof URL !== 'undefined' &&
          typeof URL.createObjectURL === 'function'
        ) {
          const backUrl = URL.createObjectURL(backRec.blob);
          const aceUrl = URL.createObjectURL(aceRec.blob);
          const kingUrl = URL.createObjectURL(kingRec.blob);
          createdBlobUrls.push(backUrl, aceUrl, kingUrl);
          setFanUrls({ back: backUrl, spadesA: aceUrl, heartsK: kingUrl });
          return;
        }
      } catch {
        // Fall through to lightweight manifest asset URL resolution
      }

      // 2. Fallback: fetch the lightweight manifest JSON once to resolve crisp individual SVG/asset URLs
      const cachedManifestUrls = manifestFanUrlCache.get(entry.id);
      if (cachedManifestUrls) {
        if (!cancelled) setFanUrls(cachedManifestUrls);
        return;
      }

      try {
        const manifestUrl = resolveDeckUrl(entry.manifestPath);
        const res = await fetch(manifestUrl);
        if (!res.ok) return;
        const manifest = (await res.json()) as Partial<DeckManifest>;
        const backPath = manifest.back?.path;
        const acePath = manifest.cards?.['spades-A']?.path;
        const kingPath = manifest.cards?.['hearts-K']?.path;
        if (backPath && acePath && kingPath && !cancelled) {
          const resolved: DeckFanUrls = {
            back: resolveDeckUrl(backPath),
            spadesA: resolveDeckUrl(acePath),
            heartsK: resolveDeckUrl(kingPath),
          };
          manifestFanUrlCache.set(entry.id, resolved);
          setFanUrls(resolved);
        }
      } catch {
        // Offline before download: card fan renders clean crisp fallback silhouettes
      }
    };

    void resolveFan();

    return () => {
      cancelled = true;
      for (const u of createdBlobUrls) {
        if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
          URL.revokeObjectURL(u);
        }
      }
    };
  }, [entry.id, entry.manifestPath]);

  return fanUrls;
}

/**
 * Crisp 3-card fan preview rendered identically across ALL card_deck items:
 * Left = Card Back, Center = Ace of Spades (spades-A), Right = King of Hearts (hearts-K).
 */
export const DeckPreviewArtwork: React.FC<{
  entry: DeckCatalogEntry;
  cachedPreviewUrl?: string | null;
  className?: string;
}> = ({ entry, className = '' }) => {
  const fanUrls = useDeckFanPreviewUrls(entry);

  if (entry.id === EYVAN_CLASSIC_DECK_ID) {
    return (
      <div
        data-testid={`deck-fan-preview-${entry.id}`}
        className={`relative w-full h-full overflow-hidden bg-gradient-to-br from-[#0E223D] via-[#133554] to-[#0B3B3B] flex items-center justify-center ${className}`}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              'radial-gradient(circle at 24% 20%, rgba(243,209,121,0.5), transparent 54%), radial-gradient(circle at 80% 80%, rgba(25,162,162,0.5), transparent 52%)',
          }}
        />
        <div className="relative flex items-center justify-center" dir="ltr">
          {/* Left: Card Back */}
          <div className="w-[60px] h-[88px] rounded-[7px] bg-[#FAF7F0] border border-[#D0CBC0] p-1 shadow-xl -rotate-12 -mr-4 flex items-center justify-center">
            <div className="w-full h-full rounded-[5px] bg-gradient-to-br from-[#13294B] to-[#0B4F55] border border-[#D4AE58]/65 flex items-center justify-center">
              <span className="text-[#F3D179] text-base font-black">۞</span>
            </div>
          </div>
          {/* Center: Ace of Spades */}
          <div className="w-[68px] h-[98px] rounded-[7px] bg-[#FAF7F0] border border-[#CFCBC2] shadow-2xl z-10 flex flex-col justify-between p-1.5 text-[#111827]">
            <div className="text-left leading-none font-black text-[11px]">
              <div>A</div>
              <div className="text-[10px]">♠</div>
            </div>
            <div className="text-center text-2xl leading-none">♠</div>
            <div className="text-right leading-none font-black text-[11px] rotate-180">
              <div>A</div>
            </div>
          </div>
          {/* Right: King of Hearts */}
          <div className="w-[60px] h-[88px] rounded-[7px] bg-[#FAF7F0] border border-[#CFCBC2] shadow-xl rotate-12 -ml-4 flex flex-col justify-between p-1.5 text-[#B83232]">
            <div className="text-left leading-none font-black text-[11px]">
              <div>K</div>
              <div className="text-[10px]">♥</div>
            </div>
            <div className="text-center text-xl leading-none">♥</div>
            <div className="text-right leading-none font-black text-[11px] rotate-180">
              <div>K</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid={`deck-fan-preview-${entry.id}`}
      className={`relative w-full h-full overflow-hidden bg-gradient-to-br from-[#102036] via-[#152B46] to-[#0D2B38] flex items-center justify-center ${className}`}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-25"
        style={{
          backgroundImage:
            'radial-gradient(circle at 24% 20%, rgba(243,209,121,0.45), transparent 54%), radial-gradient(circle at 80% 80%, rgba(25,162,162,0.45), transparent 52%)',
        }}
      />
      {fanUrls ? (
        <div className="relative flex items-center justify-center" dir="ltr">
          {/* Left: Card Back */}
          <div className="w-[60px] h-[88px] rounded-[7px] bg-[#FAF7F0] border border-[#D0CBC0] p-0.5 shadow-xl -rotate-12 -mr-4 overflow-hidden">
            <img
              src={fanUrls.back}
              alt={`${entry.name} - پشت کارت`}
              loading="eager"
              decoding="sync"
              className="w-full h-full object-contain rounded-[5px]"
            />
          </div>
          {/* Center: Ace of Spades */}
          <div className="w-[68px] h-[98px] rounded-[7px] bg-[#FAF7F0] border border-[#CFCBC2] p-0.5 shadow-2xl z-10 overflow-hidden">
            <img
              src={fanUrls.spadesA}
              alt={`${entry.name} - تک پیک`}
              loading="eager"
              decoding="sync"
              className="w-full h-full object-contain rounded-[5px]"
            />
          </div>
          {/* Right: King of Hearts */}
          <div className="w-[60px] h-[88px] rounded-[7px] bg-[#FAF7F0] border border-[#CFCBC2] p-0.5 shadow-xl rotate-12 -ml-4 overflow-hidden">
            <img
              src={fanUrls.heartsK}
              alt={`${entry.name} - شاه دل`}
              loading="eager"
              decoding="sync"
              className="w-full h-full object-contain rounded-[5px]"
            />
          </div>
        </div>
      ) : (
        <div className="relative flex items-center justify-center" dir="ltr">
          <div className="w-[58px] h-[84px] rounded-[7px] bg-[#FAF7F0]/15 border border-white/25 -rotate-12 -mr-4" />
          <div className="w-[66px] h-[94px] rounded-[7px] bg-[#FAF7F0]/22 border border-white/35 z-10" />
          <div className="w-[58px] h-[84px] rounded-[7px] bg-[#FAF7F0]/15 border border-white/25 rotate-12 -ml-4" />
        </div>
      )}
    </div>
  );
};

interface DeckDetailsModalProps {
  entry: DeckCatalogEntry;
  status: DeckLifecycleStatus;
  installedRecord: DeckInstallRecord | null;
  progress: DeckDownloadProgress | null;
  busyDeckId: string | null;
  errorMessage: string | null;
  cachedPreviewUrl?: string | null;
  userCoins?: number;
  userGems?: number;
  shopTestMode?: boolean;
  isAuthenticated?: boolean;
  onDownload: (entry: DeckCatalogEntry) => void;
  onClaimAndDownload?: (entry: DeckCatalogEntry) => void;
  onCancelDownload: () => void;
  onActivate: (deckId: string) => void;
  onDelete: (deckId: string) => void;
  onSwitchToClassic: () => void;
  onRequireAuth?: () => void;
  onOpenTopUpShop?: () => void;
  onInventorySync?: (inventory: ServerInventoryState) => void;
  onClose: () => void;
}

export const DeckDetailsModal: React.FC<DeckDetailsModalProps> = ({
  entry,
  status,
  progress,
  busyDeckId,
  errorMessage,
  cachedPreviewUrl,
  userCoins = 0,
  userGems = 0,
  shopTestMode = false,
  isAuthenticated = false,
  onDownload,
  onClaimAndDownload,
  onCancelDownload,
  onActivate,
  onDelete,
  onSwitchToClassic,
  onRequireAuth,
  onOpenTopUpShop,
  onInventorySync,
  onClose,
}) => {
  const [giftOpen, setGiftOpen] = useState(false);

  const rarity = SHOP_RARITY_META[entry.pricing.rarity];
  const isBuiltin = entry.id === EYVAN_CLASSIC_DECK_ID;
  const isEquipped = status === 'equipped';
  const isDownloading = status === 'downloading';
  const isBusy = busyDeckId === entry.id;
  const progressPct =
    progress && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.loadedBytes / progress.totalBytes) * 100))
      : 0;

  const isPaidDeck = entry.pricing.access === 'paid' && entry.pricing.price > 0;
  const currencyLabel = entry.pricing.currency === 'gems' ? 'الماس' : 'سکه';
  const balance = entry.pricing.currency === 'gems' ? userGems : userCoins;
  const effectivePrice = shopTestMode ? 0 : entry.pricing.price;
  const canAfford = shopTestMode || !isPaidDeck || balance >= effectivePrice;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const canDelete =
    !isBuiltin &&
    !isEquipped &&
    (status === 'downloaded' || status === 'update_available');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`جزئیات دست کارت ${entry.name}`}
      data-testid={`deck-details-modal-${entry.id}`}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/68 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[408px] my-auto rounded-[24px] theme-drawer border border-[var(--eyvan-gold-border)] shadow-[0_24px_64px_rgba(0,0,0,0.58)] overflow-hidden"
      >
        <div className="relative h-[188px] w-full overflow-hidden">
          <DeckPreviewArtwork entry={entry} cachedPreviewUrl={cachedPreviewUrl} />

          <button
            type="button"
            onClick={onClose}
            data-testid="deck-detail-close-btn"
            aria-label="بستن جزئیات دست کارت"
            className="absolute top-3 left-3 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 text-white border border-white/15 flex items-center justify-center backdrop-blur-xs cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          <span
            className={`absolute top-3 right-3 px-2.5 py-0.5 rounded-lg text-[11px] font-extrabold border backdrop-blur-xs bg-black/60 ${rarity.accentBorder} text-white`}
          >
            {entry.pricing.badge ?? rarity.label}
          </span>
        </div>

        <div className="p-4 sm:p-5 space-y-3.5">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <h2
                data-testid="deck-detail-title"
                className="text-base sm:text-lg font-black theme-heading leading-snug truncate"
              >
                {entry.name}
              </h2>
              <span
                data-testid="deck-detail-category-label"
                className="text-[11px] font-extrabold theme-accent-teal shrink-0"
              >
                دسته کارت
              </span>
            </div>
            <p className="text-xs theme-muted leading-relaxed">
              {entry.description}
            </p>
          </div>

          {isPaidDeck && (
            <div className="rounded-xl theme-subcard border px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
              <span className="theme-muted font-bold">قیمت</span>
              {shopTestMode ? (
                <span className="inline-flex items-center gap-1.5 font-black tabular-nums">
                  <span className="line-through opacity-55 theme-muted text-[11px]">
                    {toPersianDigits(entry.pricing.price.toLocaleString())} {currencyLabel}
                  </span>
                  <span className="theme-accent-teal">رایگان در حالت تست</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-black theme-heading tabular-nums">
                  {entry.pricing.currency === 'gems' ? (
                    <PurpleGemSvg size={16} />
                  ) : (
                    <GoldCoinSvg size={16} />
                  )}
                  <span>
                    {toPersianDigits(entry.pricing.price.toLocaleString())} {currencyLabel}
                  </span>
                </span>
              )}
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              data-testid="deck-detail-error"
              className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-bold text-red-400 leading-relaxed"
            >
              {errorMessage}
            </div>
          )}

          {isDownloading && (
            <div
              data-testid="deck-download-progress"
              className="rounded-xl theme-subcard border p-3 space-y-2"
            >
              <div className="flex items-center justify-between text-[11px] font-extrabold">
                <span className="theme-accent-teal">در حال آماده‌سازی مجموعه...</span>
                <span className="tabular-nums theme-heading">
                  {toPersianDigits(progressPct)}٪
                </span>
              </div>
              <div className="h-2 rounded-full bg-black/25 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-l from-[#2DD4BF] to-[#0D8A8A] transition-all duration-150"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] theme-muted">
                <span>
                  {progress
                    ? `${toPersianDigits(progress.completedFiles)} از ${toPersianDigits(progress.totalFiles)} مورد`
                    : 'آماده‌سازی...'}
                </span>
                <button
                  type="button"
                  onClick={onCancelDownload}
                  data-testid="deck-cancel-download-btn"
                  className="text-red-400 hover:underline font-extrabold cursor-pointer"
                >
                  توقف
                </button>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2 pt-0.5">
            {status === 'equipped' && (
              <>
                <div
                  data-testid="deck-status-equipped"
                  className="w-full min-h-[44px] px-4 rounded-xl bg-[#0D8A8A]/15 border border-[#0D8A8A]/45 theme-win text-xs sm:text-sm font-black flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4 shrink-0" />
                  <span>فعال روی میز حکم</span>
                </div>
                {!isBuiltin && (
                  <button
                    type="button"
                    data-testid="deck-switch-classic-btn"
                    onClick={onSwitchToClassic}
                    className="w-full min-h-[40px] px-4 rounded-xl theme-btn-secondary border text-xs font-extrabold cursor-pointer transition-colors"
                  >
                    بازگشت به مجموعه پیش‌فرض ایوان
                  </button>
                )}
              </>
            )}

            {status === 'downloaded' && (
              <button
                type="button"
                disabled={isBusy}
                data-testid="deck-activate-btn"
                onClick={() => onActivate(entry.id)}
                className="w-full min-h-[44px] px-4 rounded-xl bg-gradient-to-b from-[#19A2A2] to-[#0D7A7A] hover:brightness-105 text-white text-xs sm:text-sm font-black flex items-center justify-center gap-2 cursor-pointer transition-all shadow-xs disabled:opacity-60"
              >
                <Sparkles className="w-4 h-4 shrink-0" />
                <span>{isBusy ? 'در حال آماده‌سازی...' : 'انتخاب و فعال‌سازی در بازی'}</span>
              </button>
            )}

            {status === 'free_available' && (
              <button
                type="button"
                disabled={isBusy}
                data-testid="deck-download-btn"
                onClick={() => onDownload(entry)}
                className="w-full min-h-[44px] px-4 rounded-xl bg-gradient-to-b from-[#F5D98E] via-[#DDA942] to-[#B77E1E] hover:brightness-105 text-[#0B1628] text-xs sm:text-sm font-black flex items-center justify-center gap-2 cursor-pointer transition-all shadow-xs disabled:opacity-60"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>دریافت رایگان</span>
              </button>
            )}

            {status === 'update_available' && (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={isBusy}
                  data-testid="deck-update-btn"
                  onClick={() => onDownload(entry)}
                  className="w-full min-h-[44px] px-4 rounded-xl bg-gradient-to-b from-[#F5D98E] via-[#DDA942] to-[#B77E1E] hover:brightness-105 text-[#0B1628] text-xs sm:text-sm font-black flex items-center justify-center gap-2 cursor-pointer transition-all shadow-xs"
                >
                  <RefreshCw className="w-4 h-4 shrink-0" />
                  <span>به‌روزرسانی مجموعه</span>
                </button>
                {!isEquipped && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onActivate(entry.id)}
                    className="w-full min-h-[38px] px-3 rounded-xl theme-btn-secondary border text-xs font-extrabold cursor-pointer"
                  >
                    استفاده از نسخه فعلی
                  </button>
                )}
              </div>
            )}

            {status === 'paid_locked' && (
              !isAuthenticated && onRequireAuth ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onRequireAuth();
                  }}
                  data-testid="deck-guest-auth-btn"
                  className="w-full min-h-[44px] px-4 rounded-xl bg-gradient-to-b from-[#F5D98E] via-[#DDA942] to-[#B77E1E] text-[#0B1628] text-xs sm:text-sm font-black flex items-center justify-center gap-2 cursor-pointer"
                >
                  <UserPlus className="w-4 h-4 shrink-0" />
                  <span>ورود برای خرید مجموعه</span>
                </button>
              ) : canAfford ? (
                <button
                  type="button"
                  disabled={isBusy}
                  data-testid="deck-test-claim-download-btn"
                  onClick={() =>
                    onClaimAndDownload
                      ? onClaimAndDownload(entry)
                      : onDownload(entry)
                  }
                  className="w-full min-h-[44px] px-4 rounded-xl bg-gradient-to-b from-[#F5D98E] via-[#DDA942] to-[#B77E1E] hover:brightness-105 text-[#0B1628] text-xs sm:text-sm font-black flex items-center justify-center gap-2 cursor-pointer transition-all shadow-xs disabled:opacity-60"
                >
                  <Download className="w-4 h-4 shrink-0" />
                  <span>
                    {shopTestMode
                      ? 'دریافت رایگان (حالت تست)'
                      : 'خرید و دریافت مجموعه'}
                  </span>
                </button>
              ) : (
                <div className="space-y-2">
                  <div
                    data-testid="deck-paid-locked"
                    className="w-full min-h-[40px] px-3.5 rounded-xl bg-[var(--eyvan-surface-muted)] border border-[var(--eyvan-line)] theme-muted text-xs font-extrabold flex items-center justify-center gap-2"
                  >
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      موجودی کافی نیست ({toPersianDigits(balance.toLocaleString())} {currencyLabel})
                    </span>
                  </div>
                  {onOpenTopUpShop && (
                    <button
                      type="button"
                      data-testid="deck-insufficient-topup-btn"
                      onClick={() => {
                        onClose();
                        onOpenTopUpShop();
                      }}
                      className="w-full min-h-[44px] px-4 rounded-xl bg-gradient-to-b from-[#22C55E] to-[#15803D] hover:brightness-105 text-white text-xs sm:text-sm font-black flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Wallet className="w-4 h-4 shrink-0" />
                      <span>شارژ سکه و الماس (تومانی)</span>
                    </button>
                  )}
                </div>
              )
            )}

            {canDelete && (
              <button
                type="button"
                disabled={isBusy}
                data-testid="deck-delete-btn"
                onClick={() => onDelete(entry.id)}
                className="w-full min-h-[38px] px-4 rounded-xl border border-red-500/35 text-red-400 hover:bg-red-500/10 text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span>حذف از دستگاه</span>
              </button>
            )}

            {/* Gift to Friend for non-default card decks */}
            {!isBuiltin && !giftOpen && (
              <button
                type="button"
                data-testid="deck-gift-toggle-btn"
                onClick={() => {
                  if (!isAuthenticated && onRequireAuth) {
                    onClose();
                    onRequireAuth();
                    return;
                  }
                  setGiftOpen(true);
                }}
                className="w-full min-h-[40px] px-4 rounded-xl theme-btn-secondary border text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer hover:border-[var(--eyvan-gold-border)] transition-colors"
              >
                <Gift className="w-3.5 h-3.5 theme-accent-gold shrink-0" />
                <span>هدیه به دوست</span>
              </button>
            )}

            {!isBuiltin && giftOpen && (
              <ShopGiftPanel
                itemId={toDeckItemId(entry.id)}
                itemName={entry.name}
                price={entry.pricing.price}
                currency={entry.pricing.currency}
                userCoins={userCoins}
                userGems={userGems}
                shopTestMode={shopTestMode}
                isAuthenticated={isAuthenticated}
                onRequireAuth={() => {
                  onClose();
                  onRequireAuth?.();
                }}
                onOpenTopUpShop={() => {
                  onClose();
                  onOpenTopUpShop?.();
                }}
                onInventorySync={onInventorySync}
                onClosePanel={() => setGiftOpen(false)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
