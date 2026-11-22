import React, { useEffect } from 'react';
import { ArrowRight, Check, Info, Lock } from 'lucide-react';
import { toPersianDigits } from '../../theme/tokens';
import { ShopItem, ShopSectionMeta } from '../../types/platform';
import { SHOP_RARITY_META, getShopItemAvailability } from '../../utils/shopHelpers';
import { GoldCoinSvg, PurpleGemSvg } from '../TopBar';
import { ShopItemArtwork } from './ShopItemArtwork';

interface ShopProductDetailsProps {
  item: ShopItem;
  sectionMeta: ShopSectionMeta | undefined;
  userCoins: number;
  userGems: number;
  onBack: () => void;
}

/**
 * Full Product Detail View (PDP): shows large artwork, description, rarity,
 * real wallet comparison, honest server availability notice (zero fake purchase),
 * and predictable Back action that preserves category & scroll position.
 */
export const ShopProductDetails: React.FC<ShopProductDetailsProps> = ({
  item,
  sectionMeta,
  userCoins,
  userGems,
  onBack,
}) => {
  const rarity = SHOP_RARITY_META[item.rarity];
  const availability = getShopItemAvailability(item, userCoins, userGems, false);
  const currentBalance = item.currency === 'gems' ? userGems : userCoins;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onBack();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onBack]);

  return (
    <section
      aria-label={`جزئیات ${item.name}`}
      data-testid="shop-product-details"
      className="space-y-4"
    >
      {/* Top Return Bar */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          data-testid="shop-detail-back-btn"
          className="min-h-[44px] px-3.5 py-2 rounded-xl theme-btn-secondary border text-xs sm:text-sm font-extrabold inline-flex items-center gap-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--eyvan-teal)]"
        >
          <ArrowRight className="w-4 h-4 shrink-0" />
          <span>بازگشت به فروشگاه</span>
        </button>

        {sectionMeta && (
          <span className="text-xs font-bold theme-muted truncate">
            {sectionMeta.title}
          </span>
        )}
      </div>

      {/* Main Split PDP Card */}
      <div className="eyvan-card rounded-2xl p-4 sm:p-6 grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6 items-start">
        <div className="md:col-span-5 relative">
          <ShopItemArtwork item={item} variant="detail" />
          {item.badge && (
            <span className="absolute top-3 right-3 px-2.5 py-1 rounded-lg text-xs font-extrabold bg-[#0B1528]/90 text-[#F3D179] border border-[#D4AE58]/45">
              {item.badge}
            </span>
          )}
        </div>

        <div className="md:col-span-7 space-y-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`px-2.5 py-0.5 rounded-md text-xs font-extrabold border ${rarity.accentBorder} ${rarity.softBg} ${rarity.textAccent}`}
              >
                سطح کمیابی: {rarity.label}
              </span>
              {sectionMeta && (
                <span className="text-xs font-semibold theme-muted">
                  دسته: {sectionMeta.title}
                </span>
              )}
            </div>

            <h2
              data-testid="shop-detail-title"
              className="text-xl sm:text-2xl font-extrabold theme-heading leading-snug"
            >
              {item.name}
            </h2>
            <p className="text-xs sm:text-sm font-semibold theme-accent-teal">
              {item.subtitle}
            </p>
            <p className="text-xs sm:text-sm theme-muted leading-relaxed pt-1">
              {item.description}
            </p>
          </div>

          {/* Pricing & Balance Breakdown */}
          <div className="rounded-xl theme-subcard border p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 text-xs sm:text-sm">
              <span className="theme-muted font-semibold">وضعیت آیتم:</span>
              <span
                data-testid="shop-detail-status"
                className={`font-extrabold ${
                  availability.status === 'owned_default'
                    ? 'theme-win'
                    : availability.status === 'preview_insufficient'
                      ? 'theme-loss'
                      : 'theme-heading'
                }`}
              >
                {availability.statusLabel}
              </span>
            </div>

            {!item.isDefaultOwned && (
              <>
                <div className="flex items-center justify-between gap-2 text-xs sm:text-sm pt-2 border-t border-[var(--eyvan-line)]">
                  <span className="theme-muted font-semibold">ارزش کاتالوگ:</span>
                  <span className="inline-flex items-center gap-1.5 font-extrabold theme-heading tabular-nums">
                    {item.currency === 'gems' ? (
                      <PurpleGemSvg size={16} />
                    ) : (
                      <GoldCoinSvg size={16} />
                    )}
                    <span>
                      {toPersianDigits(item.price.toLocaleString())}{' '}
                      {availability.currencyLabel}
                    </span>
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 text-xs sm:text-sm pt-2 border-t border-[var(--eyvan-line)]">
                  <span className="theme-muted font-semibold">
                    موجودی فعلی شما:
                  </span>
                  <span className="font-bold theme-heading tabular-nums">
                    {toPersianDigits(currentBalance.toLocaleString())}{' '}
                    {availability.currencyLabel}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Honest System Status Notice */}
          <div
            data-testid="shop-detail-notice"
            className={`p-3.5 rounded-xl border flex items-start gap-2.5 text-xs leading-relaxed ${
              availability.status === 'owned_default'
                ? 'bg-[#0D8A8A]/10 border-[#0D8A8A]/35 theme-win font-semibold'
                : 'bg-[var(--eyvan-surface-muted)] border-[var(--eyvan-line)] theme-muted font-medium'
            }`}
          >
            {availability.status === 'owned_default' ? (
              <Check className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <Info className="w-4 h-4 theme-accent-teal shrink-0 mt-0.5" />
            )}
            <span>{availability.detailNotice}</span>
          </div>

          {/* Action Row (honest non-fake state) */}
          <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
            {availability.status === 'owned_default' ? (
              <div className="flex-1 min-h-[46px] px-4 rounded-xl bg-[#0D8A8A]/14 border border-[#0D8A8A]/40 theme-win text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2">
                <Check className="w-4 h-4 shrink-0" />
                <span>{availability.actionLabel}</span>
              </div>
            ) : (
              <button
                type="button"
                disabled
                data-testid="shop-detail-action-disabled"
                className="flex-1 min-h-[46px] px-4 rounded-xl bg-[var(--eyvan-surface-muted)] border border-[var(--eyvan-line)] theme-muted text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 opacity-80 cursor-not-allowed"
              >
                <Lock className="w-4 h-4 shrink-0" />
                <span>{availability.actionLabel}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
