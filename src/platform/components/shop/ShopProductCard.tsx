import React from 'react';
import { Check } from 'lucide-react';
import { DeckRegistry } from '../../decks';
import {
  getItemCategoryLabel,
  resolveCatalogItemDefinition,
} from '../../items/itemCatalog';
import { toPersianDigits } from '../../theme/tokens';
import { ShopItem } from '../../types/platform';
import {
  SHOP_RARITY_META,
  getEffectiveShopPriceBreakdown,
} from '../../utils/shopHelpers';
import { GoldCoinSvg, PurpleGemSvg } from '../TopBar';
import { ShopItemArtwork } from './ShopItemArtwork';

interface ShopProductCardProps {
  item: ShopItem;
  onSelect: (item: ShopItem) => void;
  isOwned?: boolean;
  isEquipped?: boolean;
  shopTestMode?: boolean;
}

/**
 * Uniform product card sized cleanly for 2-col mobile and 3-4-col desktop grids.
 * Restrained visual styling: neutral structural borders, clear artwork stage,
 * explicit item type label, honest status & price baseline alignment.
 */
export const ShopProductCard: React.FC<ShopProductCardProps> = ({
  item,
  onSelect,
  isOwned = false,
  isEquipped = false,
  shopTestMode = false,
}) => {
  const rarity = SHOP_RARITY_META[item.rarity];
  const def = resolveCatalogItemDefinition(
    item.id,
    DeckRegistry.getAllCatalogEntries(false)
  );
  const categoryLabel = getItemCategoryLabel(def?.kind, item.section);
  const owned = Boolean(isOwned || item.isDefaultOwned);
  const priceBreakdown = getEffectiveShopPriceBreakdown(item, shopTestMode);

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      data-shop-item={item.id}
      data-owned={owned ? 'true' : 'false'}
      data-equipped={isEquipped ? 'true' : 'false'}
      className={`group eyvan-card eyvan-card-hover rounded-2xl p-3 flex flex-col justify-between text-right h-full cursor-pointer transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--eyvan-teal)] ${
        isEquipped ? 'border-[#19A2A2]/75 ring-1 ring-[#19A2A2]/35' : ''
      }`}
    >
      <div className="w-full space-y-2.5">
        <div className="relative">
          <ShopItemArtwork item={item} variant="card" />
          {item.badge && (
            <span className="absolute top-2 right-2 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-[#0B1528]/88 text-[#F3D179] border border-[#D4AE58]/45">
              {item.badge}
            </span>
          )}
        </div>

        <div className="space-y-1 min-w-0">
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[10px] font-extrabold theme-accent-teal truncate">
              {categoryLabel}
              <span className={`font-bold ${rarity.textAccent}`}> · {rarity.label}</span>
            </span>
            {isEquipped ? (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-extrabold theme-accent-teal shrink-0">
                <Check className="w-3 h-3" />
                <span>فعال</span>
              </span>
            ) : owned ? (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold theme-win shrink-0">
                <Check className="w-3 h-3" />
                <span>{item.isDefaultOwned ? 'پیش‌فرض' : 'در اختیار'}</span>
              </span>
            ) : null}
          </div>

          <h3 className="text-xs sm:text-sm font-extrabold theme-heading line-clamp-1 leading-snug">
            {item.name}
          </h3>
          <p className="text-[11px] theme-muted line-clamp-2 leading-relaxed min-h-[2.2em]">
            {item.subtitle}
          </p>
        </div>
      </div>

      {/* Consistent Aligned Bottom Price / Status Footer */}
      <div className="w-full mt-3 pt-2.5 border-t border-[var(--eyvan-line)] flex items-center justify-between gap-2">
        {isEquipped ? (
          <span className="inline-flex items-center gap-1 text-xs font-extrabold theme-accent-teal">
            <Check className="w-3.5 h-3.5 shrink-0" />
            <span>فعال در حساب</span>
          </span>
        ) : owned ? (
          <>
            <span className="inline-flex items-center gap-1 text-xs font-extrabold theme-win">
              <Check className="w-3.5 h-3.5 shrink-0" />
              <span>در اختیار شما</span>
            </span>
            <span className="text-[11px] font-bold theme-accent-teal group-hover:underline">
              جزئیات
            </span>
          </>
        ) : priceBreakdown.isTestModeFree ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-xs font-extrabold tabular-nums">
              <span className="line-through opacity-55 theme-muted text-[11px]">
                {toPersianDigits(priceBreakdown.realPrice.toLocaleString())}
              </span>
              <span className="theme-accent-teal font-black">رایگان (تست)</span>
            </span>
            <span className="text-[11px] font-bold theme-accent-teal group-hover:underline">
              دریافت
            </span>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-extrabold theme-heading tabular-nums">
              {item.currency === 'gems' ? (
                <PurpleGemSvg size={15} />
              ) : (
                <GoldCoinSvg size={15} />
              )}
              <span>
                {priceBreakdown.realPrice === 0
                  ? 'رایگان'
                  : toPersianDigits(priceBreakdown.realPrice.toLocaleString())}
              </span>
              {priceBreakdown.realPrice > 0 && (
                <span className="text-[10px] font-semibold theme-muted">
                  {item.currency === 'gems' ? 'الماس' : 'سکه'}
                </span>
              )}
            </span>
            <span className="text-[11px] font-bold theme-accent-teal group-hover:underline">
              جزئیات
            </span>
          </>
        )}
      </div>
    </button>
  );
};
