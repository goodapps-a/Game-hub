import React, { useEffect, useState } from 'react';
import {
  Check,
  Coins,
  Gift,
  Lock,
  RotateCcw,
  Sparkles,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react';
import { DeckRegistry } from '../../decks';
import { SLOT_FALLBACK_ITEMS } from '../../items/catalogData';
import {
  getItemCategoryLabel,
  resolveCatalogItemDefinition,
} from '../../items/itemCatalog';
import {
  EquippedSlotsMap,
  ItemSlot,
  ServerInventoryState,
} from '../../items/itemTypes';
import { toPersianDigits } from '../../theme/tokens';
import { ShopItem, ShopSectionMeta } from '../../types/platform';
import {
  SHOP_RARITY_META,
  getEffectiveShopPriceBreakdown,
} from '../../utils/shopHelpers';
import { GoldCoinSvg, PurpleGemSvg } from '../TopBar';
import { ShopGiftPanel } from './ShopGiftPanel';
import { ShopItemArtwork } from './ShopItemArtwork';

interface ShopProductDetailsProps {
  item: ShopItem;
  sectionMeta: ShopSectionMeta | undefined;
  userCoins: number;
  userGems: number;
  isAuthenticated?: boolean;
  ownedItemIds?: readonly string[];
  equippedSlots?: EquippedSlotsMap;
  equippedTableSkinId?: string;
  equippedBannerCode?: string;
  shopTestMode?: boolean;
  onPurchaseItem?: (item: ShopItem) => void;
  onEquipItem?: (item: ShopItem) => void;
  onUnequipSlot?: (slot: ItemSlot) => void;
  onRequireAuth?: () => void;
  onOpenTopUpShop?: () => void;
  onInventorySync?: (inventory: ServerInventoryState) => void;
  onBack: () => void;
}

/**
 * Compact Floating Shop Product Modal (NOT full-screen).
 * Uses catalog item definitions so all item kinds (banners, frames, badges, card backs,
 * table skins, effects, decks, and chests) work cleanly without technical clutter.
 */
export const ShopProductDetails: React.FC<ShopProductDetailsProps> = ({
  item,
  userCoins,
  userGems,
  isAuthenticated = false,
  ownedItemIds = [],
  equippedSlots,
  equippedTableSkinId = 'tt-traditional',
  equippedBannerCode = 'royal',
  shopTestMode = false,
  onPurchaseItem,
  onEquipItem,
  onUnequipSlot,
  onRequireAuth,
  onOpenTopUpShop,
  onInventorySync,
  onBack,
}) => {
  const [giftOpen, setGiftOpen] = useState(false);

  const rarity = SHOP_RARITY_META[item.rarity];
  const def = resolveCatalogItemDefinition(
    item.id,
    DeckRegistry.getAllCatalogEntries(false)
  );
  const categoryLabel = getItemCategoryLabel(def?.kind, item.section);
  const slot = def?.slot ?? null;
  const isEquippable = Boolean(def?.isEquippable && slot);
  const isChest = def?.kind === 'chest' || def?.kind === 'bundle';
  const isGiftable = Boolean(!def?.isDefaultOwned && !item.isDefaultOwned && !isChest);

  const isOwned = Boolean(item.isDefaultOwned || ownedItemIds.includes(item.id));
  const currentBalance = item.currency === 'gems' ? userGems : userCoins;
  const priceBreakdown = getEffectiveShopPriceBreakdown(item, shopTestMode);
  const canAfford = shopTestMode || currentBalance >= priceBreakdown.effectivePrice;
  const currencyLabel = item.currency === 'gems' ? 'الماس' : 'سکه';

  let isEquipped = false;
  if (slot && isEquippable) {
    if (equippedSlots && slot in equippedSlots) {
      isEquipped = equippedSlots[slot] === item.id;
    } else if (slot === 'table_skin') {
      isEquipped = equippedTableSkinId === item.id;
    } else if (slot === 'banner' && def?.visualMeta?.bannerCode) {
      isEquipped = equippedBannerCode === def.visualMeta.bannerCode;
    }
  }

  const fallbackForSlot = slot ? SLOT_FALLBACK_ITEMS[slot] : undefined;
  const canUnequip = Boolean(
    isEquipped &&
      slot &&
      onUnequipSlot &&
      (!fallbackForSlot || fallbackForSlot !== item.id)
  );

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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/68 backdrop-blur-sm overflow-y-auto"
      onClick={onBack}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[396px] my-auto rounded-[24px] theme-drawer border border-[var(--eyvan-gold-border)] shadow-[0_24px_64px_rgba(0,0,0,0.58)] overflow-hidden"
      >
        {/* Top Compact Artwork Header */}
        <div className="relative">
          <div className="h-[184px] w-full overflow-hidden">
            <ShopItemArtwork item={item} variant="detail" />
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
              <span
                data-testid="shop-detail-category-label"
                className="text-[11px] font-extrabold theme-accent-teal shrink-0"
              >
                {categoryLabel}
              </span>
            </div>
            <p className="text-xs theme-muted leading-relaxed line-clamp-3">
              {item.description}
            </p>
          </div>

          {/* Chest Reward Summary */}
          {isChest && def?.rewardPayload && (
            <div className="rounded-xl theme-subcard border px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
              <span className="font-bold theme-muted inline-flex items-center gap-1.5">
                <Coins className="w-3.5 h-3.5 theme-accent-gold" />
                <span>پاداش دریافتی</span>
              </span>
              <span className="font-black theme-win tabular-nums">
                {def.rewardPayload.coins
                  ? `${toPersianDigits(def.rewardPayload.coins.toLocaleString())} سکه`
                  : ''}
                {def.rewardPayload.coins && def.rewardPayload.gems ? ' + ' : ''}
                {def.rewardPayload.gems
                  ? `${toPersianDigits(def.rewardPayload.gems.toLocaleString())} الماس`
                  : ''}
              </span>
            </div>
          )}

          {/* Compact Price / Test-Mode Row */}
          {(!isOwned || isChest) && (
            <div
              data-testid="shop-detail-price-row"
              className="rounded-xl theme-subcard border px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs"
            >
              <span className="font-bold theme-muted">قیمت</span>
              {priceBreakdown.isTestModeFree ? (
                <span
                  data-testid="shop-test-mode-price"
                  className="inline-flex items-center gap-2 font-black tabular-nums text-sm"
                >
                  <span className="line-through opacity-55 theme-muted text-xs">
                    {toPersianDigits(priceBreakdown.realPrice.toLocaleString())} {currencyLabel}
                  </span>
                  <span className="theme-accent-teal">رایگان در حالت تست</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-black theme-heading tabular-nums text-sm">
                  {item.currency === 'gems' ? (
                    <PurpleGemSvg size={18} />
                  ) : (
                    <GoldCoinSvg size={18} />
                  )}
                  <span>
                    {priceBreakdown.realPrice === 0
                      ? 'رایگان'
                      : `${toPersianDigits(priceBreakdown.realPrice.toLocaleString())} ${currencyLabel}`}
                  </span>
                </span>
              )}
            </div>
          )}

          {/* Direct Action CTA */}
          <div className="space-y-2 pt-0.5">
            {isOwned && !isChest ? (
              isEquippable ? (
                isEquipped ? (
                  <>
                    <div
                      data-testid="shop-item-equipped-badge"
                      className="w-full min-h-[44px] px-4 rounded-xl bg-[#0D8A8A]/15 border border-[#0D8A8A]/45 theme-win text-xs sm:text-sm font-black flex items-center justify-center gap-2"
                    >
                      <Check className="w-4 h-4 shrink-0" />
                      <span>هم‌اکنون فعال است</span>
                    </div>
                    {canUnequip && slot && (
                      <button
                        type="button"
                        data-testid="shop-unequip-btn"
                        onClick={() => {
                          onUnequipSlot?.(slot);
                          onBack();
                        }}
                        className="w-full min-h-[38px] px-4 rounded-xl theme-btn-secondary border text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                        <span>لغو انتخاب و بازگشت به پیش‌فرض</span>
                      </button>
                    )}
                  </>
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
                    <span>فعال‌سازی در حساب</span>
                  </button>
                )
              ) : (
                <div className="w-full min-h-[44px] px-4 rounded-xl bg-[#0D8A8A]/14 border border-[#0D8A8A]/40 theme-win text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2">
                  <Check className="w-4 h-4 shrink-0" />
                  <span>در مجموعه شما فعال است</span>
                </div>
              )
            ) : !isAuthenticated && !shopTestMode && onRequireAuth ? (
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
                <span>ورود برای دریافت آیتم</span>
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
                  {isChest
                    ? shopTestMode
                      ? 'باز کردن صندوق (رایگان در حالت تست)'
                      : 'دریافت صندوق گنج'
                    : shopTestMode && priceBreakdown.isTestModeFree
                      ? 'دریافت رایگان (حالت تست)'
                      : isEquippable
                        ? 'دریافت و فعال‌سازی'
                        : 'خرید آیتم'}
                </span>
              </button>
            ) : (
              <div className="space-y-2">
                <div
                  data-testid="shop-detail-action-disabled"
                  className="w-full min-h-[40px] px-3.5 rounded-xl bg-[var(--eyvan-surface-muted)] border border-[var(--eyvan-line)] theme-muted text-xs font-extrabold flex items-center justify-center gap-2"
                >
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    موجودی کافی نیست ({toPersianDigits(currentBalance.toLocaleString())}{' '}
                    {currencyLabel})
                  </span>
                </div>
                {onOpenTopUpShop && (
                  <button
                    type="button"
                    data-testid="shop-insufficient-topup-btn"
                    onClick={() => {
                      onBack();
                      onOpenTopUpShop();
                    }}
                    className="w-full min-h-[44px] px-4 rounded-xl bg-gradient-to-b from-[#22C55E] to-[#15803D] hover:brightness-105 text-white text-xs sm:text-sm font-black flex items-center justify-center gap-2 cursor-pointer transition-all shadow-xs"
                  >
                    <Wallet className="w-4 h-4 shrink-0" />
                    <span>شارژ سکه و الماس (تومانی)</span>
                  </button>
                )}
              </div>
            )}

            {/* Gift to Friend Button & Lookup Panel */}
            {isGiftable && !giftOpen && (
              <button
                type="button"
                data-testid="shop-gift-toggle-btn"
                onClick={() => {
                  if (!isAuthenticated && onRequireAuth) {
                    onBack();
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

            {isGiftable && giftOpen && (
              <ShopGiftPanel
                itemId={item.id}
                itemName={item.name}
                price={item.price}
                currency={item.currency}
                userCoins={userCoins}
                userGems={userGems}
                shopTestMode={shopTestMode}
                isAuthenticated={isAuthenticated}
                onRequireAuth={() => {
                  onBack();
                  onRequireAuth?.();
                }}
                onOpenTopUpShop={() => {
                  onBack();
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
