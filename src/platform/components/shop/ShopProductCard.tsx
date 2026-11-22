import React from 'react';
import { Check } from 'lucide-react';
import { toPersianDigits } from '../../theme/tokens';
import { ShopItem } from '../../types/platform';
import { SHOP_RARITY_META } from '../../utils/shopHelpers';
import { GoldCoinSvg, PurpleGemSvg } from '../TopBar';
import { ShopItemArtwork } from './ShopItemArtwork';

interface ShopProductCardProps {
  item: ShopItem;
  onSelect: (item: ShopItem) => void;
}

/**
 * Uniform product card sized cleanly for 2-col mobile and 3-4-col desktop grids.
 * Restrained visual styling: neutral structural borders, clear artwork stage,
 * honest status & price baseline alignment, single subtle tag max.
 */
export const ShopProductCard: React.FC<ShopProductCardProps> = ({
  item,
  onSelect,
}) => {
  const rarity = SHOP_RARITY_META[item.rarity];

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      data-shop-item={item.id}
      className="group eyvan-card eyvan-card-hover rounded-2xl p-3 flex flex-col justify-between text-right h-full cursor-pointer transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--eyvan-teal)]"
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
            <span className={`text-[10px] font-extrabold ${rarity.textAccent}`}>
              {rarity.label}
            </span>
            {item.isDefaultOwned && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold theme-win">
                <Check className="w-3 h-3" />
                <span>پیش‌فرض</span>
              </span>
            )}
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
        {item.isDefaultOwned ? (
          <span className="inline-flex items-center gap-1 text-xs font-extrabold theme-win">
            <Check className="w-3.5 h-3.5 shrink-0" />
            <span>فعال در حساب</span>
          </span>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-extrabold theme-heading tabular-nums">
              {item.currency === 'gems' ? (
                <PurpleGemSvg size={15} />
              ) : (
                <GoldCoinSvg size={15} />
              )}
              <span>{toPersianDigits(item.price.toLocaleString())}</span>
              <span className="text-[10px] font-semibold theme-muted">
                {item.currency === 'gems' ? 'الماس' : 'سکه'}
              </span>
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
