import { ItemKind } from '../items/itemTypes';
import {
  ShopItem,
  ShopRarity,
  ShopSectionId,
} from '../types/platform';

export type ShopCategoryFilter = ShopSectionId | 'all';
export type ShopItemTypeFilter = ItemKind | 'all';
export type ShopRarityFilter = ShopRarity | 'all';
export type ShopOwnershipFilter = 'all' | 'owned' | 'unowned';

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

export interface CatalogFilterableItem {
  readonly id: string;
  readonly name: string;
  readonly subtitle: string;
  readonly description: string;
  readonly section: ShopSectionId;
  readonly rarity: ShopRarity;
  readonly kind?: ItemKind;
  readonly isDefaultOwned?: boolean;
  readonly tags?: readonly string[];
}

export interface FilterCatalogItemsInput<T extends CatalogFilterableItem> {
  readonly items: readonly T[];
  readonly searchQuery?: string;
  readonly category?: ShopCategoryFilter;
  readonly itemType?: ShopItemTypeFilter;
  readonly rarity?: ShopRarityFilter;
  readonly ownershipFilter?: ShopOwnershipFilter;
  readonly ownedItemIds?: ReadonlySet<string> | readonly string[];
}

export function filterCatalogItems<T extends CatalogFilterableItem>(
  input: FilterCatalogItemsInput<T>
): T[] {
  const query = (input.searchQuery ?? '').trim().toLowerCase();
  const category = input.category ?? 'all';
  const itemType = input.itemType ?? 'all';
  const rarity = input.rarity ?? 'all';
  const ownershipFilter = input.ownershipFilter ?? 'all';
  const ownedSet =
    input.ownedItemIds instanceof Set
      ? input.ownedItemIds
      : new Set(input.ownedItemIds ?? []);

  return input.items.filter((item) => {
    if (category !== 'all' && item.section !== category) return false;
    if (itemType !== 'all' && item.kind !== itemType) return false;
    if (rarity !== 'all' && item.rarity !== rarity) return false;

    if (ownershipFilter !== 'all') {
      const isOwned = Boolean(item.isDefaultOwned || ownedSet.has(item.id));
      if (ownershipFilter === 'owned' && !isOwned) return false;
      if (ownershipFilter === 'unowned' && isOwned) return false;
    }

    if (query.length > 0) {
      const haystack = [
        item.name,
        item.subtitle,
        item.description,
        item.id,
        ...(item.tags ?? []),
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    return true;
  });
}

export interface PaginatedCatalogResult<T> {
  readonly visibleItems: T[];
  readonly hasMore: boolean;
  readonly totalCount: number;
  readonly pageCount: number;
}

export function paginateCatalogItems<T>(
  items: readonly T[],
  page: number,
  pageSize = 24
): PaginatedCatalogResult<T> {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const safePage = Math.max(1, Math.floor(page));
  const totalCount = items.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / safePageSize));
  const end = Math.min(totalCount, safePage * safePageSize);
  return {
    visibleItems: items.slice(0, end),
    hasMore: end < totalCount,
    totalCount,
    pageCount,
  };
}

export interface EffectiveShopPriceBreakdown {
  readonly realPrice: number;
  readonly effectivePrice: number;
  readonly isTestModeFree: boolean;
}

export function getEffectiveShopPriceBreakdown(
  item: {
    readonly price: number;
    readonly currency: 'coins' | 'gems';
    readonly isDefaultOwned?: boolean;
  },
  shopTestMode: boolean
): EffectiveShopPriceBreakdown {
  const realPrice = Number.isFinite(item.price) && item.price > 0 ? item.price : 0;
  if (shopTestMode && realPrice > 0 && !item.isDefaultOwned) {
    return {
      realPrice,
      effectivePrice: 0,
      isTestModeFree: true,
    };
  }
  return {
    realPrice,
    effectivePrice: realPrice,
    isTestModeFree: false,
  };
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
