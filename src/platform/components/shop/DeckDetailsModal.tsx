import React, { useEffect } from 'react';
import {
  Check,
  Download,
  HardDrive,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  DeckCatalogEntry,
  DeckDownloadProgress,
  DeckInstallRecord,
  DeckLifecycleStatus,
  EYVAN_CLASSIC_DECK_ID,
  resolveDeckUrl,
} from '../../decks';
import { toPersianDigits } from '../../theme/tokens';
import { SHOP_RARITY_META } from '../../utils/shopHelpers';
import { GoldCoinSvg, PurpleGemSvg } from '../TopBar';

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

export const DeckPreviewArtwork: React.FC<{
  entry: DeckCatalogEntry;
  cachedPreviewUrl?: string | null;
  className?: string;
}> = ({ entry, cachedPreviewUrl, className = '' }) => {
  if (entry.id === EYVAN_CLASSIC_DECK_ID) {
    return (
      <div
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
        <div className="relative flex items-center justify-center">
          {/* Card Back Mini */}
          <div className="w-16 h-24 rounded-xl bg-white border border-[#D4CFC5] p-1 shadow-xl -rotate-12 -ml-4 flex items-center justify-center">
            <div className="w-full h-full rounded-lg bg-gradient-to-br from-[#13294B] to-[#0B4F55] border border-[#D4AE58]/65 flex items-center justify-center">
              <span className="text-[#F3D179] text-lg font-black">۞</span>
            </div>
          </div>
          {/* Ace of Spades Classic Mini */}
          <div className="w-18 h-26 rounded-xl bg-white border border-[#CFCBC2] shadow-2xl z-10 flex flex-col justify-between p-1.5 text-[#111827]">
            <div className="text-right leading-none font-black text-xs">
              <div>A</div>
              <div className="text-[11px]">♠</div>
            </div>
            <div className="text-center text-2xl leading-none">♠</div>
            <div className="text-left leading-none font-black text-xs rotate-180">
              <div>A</div>
            </div>
          </div>
          {/* Queen of Hearts Classic Mini */}
          <div className="w-16 h-24 rounded-xl bg-white border border-[#CFCBC2] shadow-xl rotate-12 -mr-4 flex flex-col justify-between p-1.5 text-[#B83232]">
            <div className="text-right leading-none font-black text-xs">
              <div>K</div>
              <div className="text-[11px]">♥</div>
            </div>
            <div className="text-center text-xl leading-none">♥</div>
            <div className="text-left leading-none font-black text-xs rotate-180">
              <div>K</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const previewSrc =
    cachedPreviewUrl ||
    (entry.previewPath ? resolveDeckUrl(entry.previewPath) : '');

  if (!previewSrc) {
    return (
      <div
        className={`w-full h-full bg-gradient-to-br from-[#13294B] to-[#0F4D53] flex items-center justify-center text-white/80 text-xs font-bold ${className}`}
      >
        پیش‌نمایش کارت‌ها
      </div>
    );
  }

  return (
    <div
      className={`relative w-full h-full overflow-hidden bg-gradient-to-br from-[#102036] via-[#152B46] to-[#0D2B38] flex items-center justify-center p-2 ${className}`}
    >
      <img
        src={previewSrc}
        alt={`پیش‌نمایش ${entry.name}`}
        loading="lazy"
        decoding="async"
        className="w-full h-full object-contain drop-shadow-[0_10px_22px_rgba(0,0,0,0.45)]"
      />
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
  onDownload: (entry: DeckCatalogEntry) => void;
  onCancelDownload: () => void;
  onActivate: (deckId: string) => void;
  onDelete: (deckId: string) => void;
  onSwitchToClassic: () => void;
  onClose: () => void;
}

export const DeckDetailsModal: React.FC<DeckDetailsModalProps> = ({
  entry,
  status,
  installedRecord,
  progress,
  busyDeckId,
  errorMessage,
  cachedPreviewUrl,
  onDownload,
  onCancelDownload,
  onActivate,
  onDelete,
  onSwitchToClassic,
  onClose,
}) => {
  const rarity = SHOP_RARITY_META[entry.pricing.rarity];
  const isBuiltin = entry.id === EYVAN_CLASSIC_DECK_ID;
  const isEquipped = status === 'equipped';
  const isDownloading = status === 'downloading';
  const isBusy = busyDeckId === entry.id;
  const progressPct =
    progress && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.loadedBytes / progress.totalBytes) * 100))
      : 0;

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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/68 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[408px] rounded-[24px] theme-drawer border border-[var(--eyvan-gold-border)] shadow-[0_24px_64px_rgba(0,0,0,0.58)] overflow-hidden"
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
              <span className="text-[11px] font-mono font-bold theme-muted shrink-0">
                v{entry.version}
              </span>
            </div>
            <p className="text-xs theme-muted leading-relaxed">
              {entry.description}
            </p>
          </div>

          <div className="rounded-xl theme-subcard border px-3.5 py-2.5 space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <span className="theme-muted font-bold">سازنده</span>
              <span className="theme-heading font-extrabold truncate">{entry.author}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="theme-muted font-bold">مجوز</span>
              <span className="theme-heading font-bold truncate" dir="ltr">
                {entry.license}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="theme-muted font-bold">حجم بسته</span>
              <span className="theme-heading font-extrabold inline-flex items-center gap-1">
                <HardDrive className="w-3.5 h-3.5 theme-accent-teal" />
                <span>
                  {isBuiltin
                    ? 'داخلی (بدون نیاز به دانلود)'
                    : formatDeckBytes(entry.totalBytes)}
                </span>
              </span>
            </div>
            {installedRecord && (
              <div className="flex items-center justify-between gap-2">
                <span className="theme-muted font-bold">ذخیره‌سازی آفلاین</span>
                <span className="theme-win font-extrabold inline-flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>ذخیره در IndexedDB (نسخه {installedRecord.installedVersion})</span>
                </span>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="theme-muted font-bold">وضعیت هزینه</span>
              {entry.pricing.access === 'paid' ? (
                <span className="inline-flex items-center gap-1 font-black theme-heading tabular-nums">
                  {entry.pricing.currency === 'gems' ? (
                    <PurpleGemSvg size={14} />
                  ) : (
                    <GoldCoinSvg size={14} />
                  )}
                  <span>{toPersianDigits(entry.pricing.price.toLocaleString())}</span>
                </span>
              ) : (
                <span className="font-extrabold theme-win">
                  {isBuiltin ? 'پیش‌فرض همیشه آماده' : 'رایگان'}
                </span>
              )}
            </div>
          </div>

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
                <span className="theme-accent-teal">در حال دریافت و تایید فایل‌ها...</span>
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
                    ? `${toPersianDigits(progress.completedFiles)} از ${toPersianDigits(progress.totalFiles)} فایل`
                    : 'آماده‌سازی...'}
                </span>
                <button
                  type="button"
                  onClick={onCancelDownload}
                  data-testid="deck-cancel-download-btn"
                  className="text-red-400 hover:underline font-extrabold cursor-pointer"
                >
                  توقف دریافت
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
                <span>دریافت رایگان و ذخیره آفلاین</span>
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
                  <span>به‌روزرسانی هوشمند (نسخه {entry.version})</span>
                </button>
                {!isEquipped && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onActivate(entry.id)}
                    className="w-full min-h-[38px] px-3 rounded-xl theme-btn-secondary border text-xs font-extrabold cursor-pointer"
                  >
                    استفاده از نسخه نصب‌شده فعلی
                  </button>
                )}
              </div>
            )}

            {status === 'paid_locked' && (
              <div
                data-testid="deck-paid-locked"
                className="w-full min-h-[44px] px-4 rounded-xl bg-[var(--eyvan-surface-muted)] border border-[var(--eyvan-line)] theme-muted text-xs font-extrabold flex items-center justify-center gap-2"
              >
                <Lock className="w-4 h-4 shrink-0" />
                <span>این مجموعه پولی است و نیاز به خرید سروری دارد</span>
              </div>
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
                <span>حذف فایل‌های این مجموعه از دستگاه</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
