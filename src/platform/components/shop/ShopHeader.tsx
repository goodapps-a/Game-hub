import React from 'react';
import { ArrowLeft, Store } from 'lucide-react';
import { CurrencyCapsule } from '../CurrencyBadges';

interface ShopHeaderProps {
  userCoins: number;
  userGems: number;
  activeCategoryTitle?: string | null;
  activeCategorySubtitle?: string | null;
  onBack?: () => void;
}

export const ShopHeader: React.FC<ShopHeaderProps> = ({
  userCoins,
  userGems,
  activeCategoryTitle,
  activeCategorySubtitle,
  onBack,
}) => {
  return (
    <header
      className="eyvan-card rounded-2xl p-4 sm:p-5 space-y-3"
      data-testid="shop-header"
    >
      <div className="flex items-center justify-between gap-3">
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
                'طرح‌های پشت کارت، پوسته‌های میز حکم، بنر پروفایل و بسته‌های گنجینه'}
            </p>
          </div>
        </div>

        {/* Physical LEFT Back Arrow */}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            data-testid="shop-back-btn"
            aria-label="بازگشت به بازی‌ها"
            className="min-h-[40px] px-3.5 rounded-xl theme-btn-secondary border text-xs sm:text-sm font-extrabold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
          >
            <span>بازگشت</span>
            <ArrowLeft className="w-4 h-4 shrink-0" />
          </button>
        )}
      </div>

      {/* Luminous Wallet Balances */}
      <div
        className="flex items-center gap-3.5 pt-2.5 border-t border-[var(--eyvan-line)]"
        aria-label="موجودی سکه و الماس شما"
      >
        <CurrencyCapsule
          kind="coins"
          amount={userCoins}
          size="md"
          ariaLabel="موجودی سکه"
        />
        <CurrencyCapsule
          kind="gems"
          amount={userGems}
          size="md"
          ariaLabel="موجودی الماس"
        />
      </div>
    </header>
  );
};
