import React from 'react';
import { Store } from 'lucide-react';
import { toPersianDigits } from '../../theme/tokens';
import { GoldCoinSvg, PurpleGemSvg } from '../TopBar';

interface ShopHeaderProps {
  userCoins: number;
  userGems: number;
  activeCategoryTitle?: string | null;
  activeCategorySubtitle?: string | null;
}

export const ShopHeader: React.FC<ShopHeaderProps> = ({
  userCoins,
  userGems,
  activeCategoryTitle,
  activeCategorySubtitle,
}) => {
  return (
    <header
      className="eyvan-card rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3"
      data-testid="shop-header"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-[var(--eyvan-surface-muted)] border border-[var(--eyvan-line)] flex items-center justify-center shrink-0">
          <Store className="w-5 h-5 theme-accent-teal" />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg sm:text-2xl font-extrabold theme-heading truncate">
            {activeCategoryTitle ?? 'فروشگاه ایوان'}
          </h1>
          <p className="text-xs sm:text-sm theme-muted truncate mt-0.5">
            {activeCategorySubtitle ??
              'طرح‌های پشت کارت، پوسته‌های میز حکم، آواتارها و بسته‌های گنجینه'}
          </p>
        </div>
      </div>

      {/* Wallet Balances */}
      <div
        className="flex items-center gap-2 shrink-0"
        aria-label="موجودی سکه و الماس شما"
      >
        <div className="min-h-[38px] px-3 py-1.5 rounded-xl theme-subcard border flex items-center gap-1.5 text-xs sm:text-sm font-extrabold theme-heading tabular-nums">
          <GoldCoinSvg size={16} />
          <span>{toPersianDigits(userCoins.toLocaleString())}</span>
          <span className="text-[11px] font-semibold theme-muted">سکه</span>
        </div>
        <div className="min-h-[38px] px-3 py-1.5 rounded-xl theme-subcard border flex items-center gap-1.5 text-xs sm:text-sm font-extrabold theme-heading tabular-nums">
          <PurpleGemSvg size={16} />
          <span>{toPersianDigits(userGems.toLocaleString())}</span>
          <span className="text-[11px] font-semibold theme-muted">الماس</span>
        </div>
      </div>
    </header>
  );
};
