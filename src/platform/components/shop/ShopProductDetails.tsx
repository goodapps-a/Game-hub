import React, { useEffect } from 'react';
import { Check, Lock, Sparkles, UserPlus, X } from 'lucide-react';
import { toPersianDigits } from '../../theme/tokens';
import { ShopItem, ShopSectionMeta } from '../../types/platform';
import { SHOP_RARITY_META } from '../../utils/shopHelpers';
import { GoldCoinSvg, PurpleGemSvg } from '../TopBar';
import { ShopItemArtwork } from './ShopItemArtwork';

interface ShopProductDetailsProps {
  item: ShopItem;
  sectionMeta: ShopSectionMeta | undefined;
  userCoins: number;
  userGems: number;
  isAuthenticated?: boolean;
  ownedItemIds?: readonly string[];
  equippedTableSkinId?: string;
  equippedBannerCode?: string;
  onPurchaseItem?: (item: ShopItem) => void;
  onEquipItem?: (item: ShopItem) => void;
  onRequireAuth?: () => void;
  onBack: () => void;
}

const BANNER_ID_TO_CODE: Record<string, 'royal' | 'garden' | 'ruby'> = {
  'af-banner-royal': 'royal',
  'af-banner-garden': 'garden',
  'af-banner-ruby': 'ruby',
};

/**
 * Compact Floating Shop Product Modal (NOT full-screen).
 * Displays concise artwork, rarity, brief description, price, and instant Buy / Equip actions.
 */
export const ShopProductDetails: React.FC<ShopProductDetailsProps> = ({
  item,
  sectionMeta,
  userCoins,
  userGems,
  isAuthenticated = false,
  ownedItemIds = [],
  equippedTableSkinId = 'tt-traditional',
  equippedBannerCode = 'royal',
  onPurchaseItem,
  onEquipItem,
  onRequireAuth,
  onBack,
}) => {
  const rarity = SHOP_RARITY_META[item.rarity];
  const isOwned = Boolean(item.isDefaultOwned || ownedItemIds.includes(item.id));
  const currentBalance = item.currency === 'gems' ? userGems : userCoins;
  const canAfford = currentBalance >= item.price;
  const currencyLabel = item.currency === 'gems' ? 'الماس' : 'سکه';

  const isTableTheme = item.section === 'table_themes';
  const bannerCodeForItem = BANNER_ID_TO_CODE[item.id];
  const isEquipped = isTableTheme
    ? equippedTableSkinId === item.id
    : bannerCodeForItem
      ? equippedBannerCode === bannerCodeForItem
      : false;

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
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`جزئیات ${item.name}`}
      data-testid="shop-product-details"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/68 backdrop-blur-sm"
      onClick={onBack}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[388px] rounded-[24px] theme-drawer border border-[var(--eyvan-gold-border)] shadow-[0_24px_64px_rgba(0,0,0,0.58)] overflow-hidden"
      >
        {/* Top Compact Artwork Header */}
        <div className="relative">
          <div className="h-[184px] w-full overflow-hidden">
            <ShopItemArtwork item={item} variant="card" />
          </div>

          <button
            type="button"
            onClick={onBack}
            data-testid="shop-detail-back-btn"
            aria-label="بستن جزئیات محصول"
            className="absolute top-3 left-3 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 text-white border border-white/15 flex items-center justify-center backdrop-blur-xs cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          <span
            className={`absolute top-3 right-3 px-2.5 py-0.5 rounded-lg text-[11px] font-extrabold border backdrop-blur-xs bg-black/60 ${rarity.accentBorder} text-white`}
          >
            {rarity.label}
          </span>
        </div>

        {/* Concise Product Info Body */}
        <div className="p-4 sm:p-5 space-y-3.5">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <h2
                data-testid="shop-detail-title"
                className="text-base sm:text-lg font-black theme-heading leading-snug truncate"
              >
                {item.name}
              </h2>
              {sectionMeta && (
                <span className="text-[11px] font-bold theme-muted shrink-0">
                  {sectionMeta.title}
                </span>
              )}
            </div>
            <p className="text-xs theme-muted leading-relaxed line-clamp-2">
              {item.description}
            </p>
          </div>

          {/* Compact Price / Balance Row */}
          {!isOwned && (
            <div className="rounded-xl theme-subcard border px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
              <span className="font-bold theme-muted">قیمت</span>
              <span className="inline-flex items-center gap-1.5 font-black theme-heading tabular-nums text-sm">
                {item.currency === 'gems' ? (
                  <PurpleGemSvg size={18} />
                ) : (
                  <GoldCoinSvg size={18} />
                )}
                <span>
                  {toPersianDigits(item.price.toLocaleString())} {currencyLabel}
                </span>
              </span>
            </div>
          )}

          {/* Direct Action CTA */}
          <div className="pt-0.5">
            {isOwned ? (
              isTableTheme || bannerCodeForItem ? (
                isEquipped ? (
                  <div
                    data-testid="shop-item-equipped-badge"
                    className="w-full min-h-[44px] px-4 rounded-xl bg-[#0D8A8A]/15 border border-[#0D8A8A]/45 theme-win text-xs sm:text-sm font-black flex items-center justify-center gap-2"
                  >
                    <Check className="w-4 h-4 shrink-0" />
                    <span>
                      {isTableTheme ? 'فعال روی میز حکم' : 'فعال روی پروفایل'}
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid="shop-equip-btn"
                    onClick={() => {
                      onEquipItem?.(item);
                      onBack();
                    }}
                    className="w-full min-h-[44px] px-4 rounded-xl bg-gradient-to-b from-[#19A2A2] to-[#0D7A7A] hover:brightness-105 text-white text-xs sm:text-sm font-black flex items-center justify-center gap-2 cursor-pointer transition-all shadow-xs"
                  >
                    <Sparkles className="w-4 h-4 shrink-0" />
                    <span>
                      {isTableTheme
                        ? 'فعال‌سازی روی میز حکم'
                        : 'انتخاب به‌عنوان بنر پروفایل'}
                    </span>
                  </button>
                )
              ) : (
                <div className="w-full min-h-[44px] px-4 rounded-xl bg-[#0D8A8A]/14 border border-[#0D8A8A]/40 theme-win text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2">
                  <Check className="w-4 h-4 shrink-0" />
                  <span>در مجموعه شما فعال است</span>
                </div>
              )
            ) : !isAuthenticated && onRequireAuth ? (
              <button
                type="button"
                onClick={() => {
                  onBack();
                  onRequireAuth();
                }}
                data-testid="shop-guest-auth-btn"
                className="w-full min-h-[44px] px-4 rounded-xl bg-gradient-to-b from-[#F5D98E] via-[#DDA942] to-[#B77E1E] hover:brightness-105 text-[#0B1628] text-xs sm:text-sm font-black flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                <UserPlus className="w-4 h-4 shrink-0" />
                <span>ورود برای خرید</span>
              </button>
            ) : canAfford && onPurchaseItem ? (
              <button
                type="button"
                data-testid="shop-buy-btn"
                onClick={() => {
                  onPurchaseItem(item);
                  onBack();
                }}
                className="w-full min-h-[44px] px-4 rounded-xl bg-gradient-to-b from-[#F5D98E] via-[#DDA942] to-[#B77E1E] hover:brightness-105 text-[#0B1628] text-xs sm:text-sm font-black flex items-center justify-center gap-2 cursor-pointer transition-all shadow-xs"
              >
                <Sparkles className="w-4 h-4 shrink-0" />
                <span>
                  {isTableTheme || bannerCodeForItem
                    ? 'خرید و فعال‌سازی'
                    : 'خرید آیتم'}
                </span>
              </button>
            ) : (
              <button
                type="button"
                disabled
                data-testid="shop-detail-action-disabled"
                className="w-full min-h-[44px] px-4 rounded-xl bg-[var(--eyvan-surface-muted)] border border-[var(--eyvan-line)] theme-muted text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 opacity-80 cursor-not-allowed"
              >
                <Lock className="w-4 h-4 shrink-0" />
                <span>
                  موجودی کافی نیست ({toPersianDigits(currentBalance.toLocaleString())}{' '}
                  {currencyLabel})
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
