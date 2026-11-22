import {
  ShopItem,
  ShopRarity,
  ShopSectionId,
} from '../types/platform';

export type ShopCategoryFilter = ShopSectionId | 'all';

export interface ShopRarityStyleMeta {
  readonly label: string;
  readonly accentBorder: string;
  readonly textAccent: string;
  readonly softBg: string;
}

export const SHOP_RARITY_META: Record<ShopRarity, ShopRarityStyleMeta> = {
  common: {
    label: 'معمولی',
    accentBorder: 'border-[var(--eyvan-line)]',
    textAccent: 'theme-muted',
    softBg: 'bg-[var(--eyvan-surface-muted)]',
  },
  rare: {
    label: 'کمیاب',
    accentBorder: 'border-[#148A8A]/45',
    textAccent: 'theme-accent-teal',
    softBg: 'bg-[#148A8A]/10',
  },
  epic: {
    label: 'حماسی',
    accentBorder: 'border-[#7E3AF2]/45',
    textAccent: 'text-[#9D6BFF]',
    softBg: 'bg-[#7E3AF2]/10',
  },
  legendary: {
    label: 'افسانه‌ای',
    accentBorder: 'border-[#D4AE58]/60',
    textAccent: 'theme-accent-gold',
    softBg: 'bg-[#D4AE58]/12',
  },
};

export function getShopItemsByCategory(
  items: readonly ShopItem[],
  category: ShopCategoryFilter
): ShopItem[] {
  if (category === 'all') {
    return [...items];
  }
  return items.filter((item) => item.section === category);
}

export function getFeaturedShopItems(items: readonly ShopItem[]): ShopItem[] {
  return items.filter((item) => item.section === 'daily_deals');
}

export type ShopAvailabilityStatus =
  | 'owned_default'
  | 'preview_affordable'
  | 'preview_insufficient';

export interface ShopItemAvailability {
  readonly status: ShopAvailabilityStatus;
  readonly purchaseSupported: boolean;
  readonly hasEnoughBalance: boolean;
  readonly shortfall: number;
  readonly currencyLabel: string;
  readonly statusLabel: string;
  readonly detailNotice: string;
  readonly actionLabel: string;
}

/**
 * Evaluates an item's honest state against user currency and current server capability.
 * Never simulates fake purchases or client-only currency deductions when backend
 * inventory/commerce APIs are not active.
 */
export function getShopItemAvailability(
  item: ShopItem,
  userCoins: number,
  userGems: number,
  backendShopEnabled = false
): ShopItemAvailability {
  const safeCoins = Number.isFinite(userCoins) && userCoins > 0 ? userCoins : 0;
  const safeGems = Number.isFinite(userGems) && userGems > 0 ? userGems : 0;
  const balance = item.currency === 'gems' ? safeGems : safeCoins;
  const currencyLabel = item.currency === 'gems' ? 'الماس' : 'سکه';

  if (item.isDefaultOwned) {
    return {
      status: 'owned_default',
      purchaseSupported: false,
      hasEnoughBalance: true,
      shortfall: 0,
      currencyLabel,
      statusLabel: 'فعال در حساب',
      detailNotice: 'این مورد به‌صورت پیش‌فرض در حساب شما فعال و آماده استفاده است.',
      actionLabel: 'فعال در حساب شما',
    };
  }

  const shortfall = Math.max(0, item.price - balance);
  const hasEnoughBalance = shortfall === 0;

  if (!backendShopEnabled) {
    return {
      status: hasEnoughBalance ? 'preview_affordable' : 'preview_insufficient',
      purchaseSupported: false,
      hasEnoughBalance,
      shortfall,
      currencyLabel,
      statusLabel: hasEnoughBalance ? 'قابل پیش‌نمایش' : 'نیاز به موجودی بیشتر',
      detailNotice: hasEnoughBalance
        ? 'خرید آنلاین از طریق سرور در به‌روزرسانی بعدی فروشگاه فعال می‌شود. فعلاً می‌توانید پیش‌نمایش و جزئیات کامل آیتم را بررسی کنید.'
        : `موجودی فعلی شما برای تهیه این آیتم کافی نیست (نیاز به ${shortfall.toLocaleString('fa-IR')} ${currencyLabel} بیشتر). همچنین خرید سروری فروشگاه در نسخه بعدی فعال می‌شود.`,
      actionLabel: 'خرید از طریق سرور به‌زودی فعال می‌شود',
    };
  }

  return {
    status: hasEnoughBalance ? 'preview_affordable' : 'preview_insufficient',
    purchaseSupported: true,
    hasEnoughBalance,
    shortfall,
    currencyLabel,
    statusLabel: hasEnoughBalance ? 'آماده خرید' : 'موجودی ناکافی',
    detailNotice: hasEnoughBalance
      ? 'با تایید خرید، آیتم به موجودی حساب شما اضافه می‌شود.'
      : `برای تهیه این آیتم به ${shortfall.toLocaleString('fa-IR')} ${currencyLabel} بیشتر نیاز دارید.`,
    actionLabel: hasEnoughBalance ? 'تایید و خرید' : 'موجودی ناکافی',
  };
}
