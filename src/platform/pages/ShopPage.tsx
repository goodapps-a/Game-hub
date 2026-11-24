import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  FlaskConical,
  Lock,
  PackageOpen,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { SHOP_SECTIONS } from '../data/shopCatalog';
import { EYVAN_CLASSIC_DECK_ID } from '../decks';
import {
  ClientUniversalItem,
  buildUnifiedUniversalCatalog,
  toDeckItemId,
  toShopItem,
} from '../items/itemCatalog';
import { EquippedSlotsMap, ItemSlot, ServerInventoryState } from '../items/itemTypes';
import { toPersianDigits } from '../theme/tokens';
import { ShopItem } from '../types/platform';
import {
  ShopCategoryFilter,
  ShopOwnershipFilter,
  ShopRarityFilter,
  filterCatalogItems,
  getFeaturedShopItems,
  getShopItemsByCategory,
  paginateCatalogItems,
} from '../utils/shopHelpers';
import { ShopCategories } from '../components/shop/ShopCategories';
import { ShopHeader } from '../components/shop/ShopHeader';
import { ShopProductCard } from '../components/shop/ShopProductCard';
import { ShopProductDetails } from '../components/shop/ShopProductDetails';
import { DeckCatalogSection } from '../components/shop/DeckCatalogSection';
import { TomanTopUpSection } from '../components/shop/TomanTopUpSection';

interface ShopPageProps {
  userCoins: number;
  userGems: number;
  isAuthenticated?: boolean;
  ownedItemIds?: readonly string[];
  equippedSlots?: EquippedSlotsMap;
  equippedTableSkinId?: string;
  equippedBannerCode?: string;
  equippedDeckId?: string;
  shopTestMode?: boolean;
  shopNotice?: string | null;
  onPurchaseItem?: (item: ShopItem) => void;
  onEquipItem?: (item: ShopItem) => void;
  onUnequipSlot?: (slot: ItemSlot) => void;
  onSelectDeck?: (deckId: string) => void | Promise<void>;
  onRequireAuth?: () => void;
  onOpenTopUpShop?: () => void;
  onInventorySync?: (inventory: ServerInventoryState) => void;
  pendingTomanOrderId?: string | null;
  onClearPendingTomanOrder?: () => void;
  initialCategory?: ShopCategoryFilter;
  onBack?: () => void;
}

const ITEMS_PER_PAGE = 24;

export const ShopPage: React.FC<ShopPageProps> = ({
  userCoins,
  userGems,
  isAuthenticated = false,
  ownedItemIds = [],
  equippedSlots,
  equippedTableSkinId = 'tt-traditional',
  equippedBannerCode = 'royal',
  equippedDeckId = EYVAN_CLASSIC_DECK_ID,
  shopTestMode = false,
  shopNotice = null,
  onPurchaseItem,
  onEquipItem,
  onUnequipSlot,
  onSelectDeck,
  onRequireAuth,
  onOpenTopUpShop,
  onInventorySync,
  pendingTomanOrderId = null,
  onClearPendingOrderId,
  onClearPendingTomanOrder,
  initialCategory = 'all',
  onBack,
}: ShopPageProps & { onClearPendingOrderId?: () => void }) => {
  const [activeCategory, setActiveCategory] =
    useState<ShopCategoryFilter>(initialCategory);
  const [searchQuery, setSearchQuery] = useState('');
  const [ownershipFilter, setOwnershipFilter] =
    useState<ShopOwnershipFilter>('all');
  const [rarityFilter, setRarityFilter] = useState<ShopRarityFilter>('all');
  const [page, setPage] = useState(1);
  const [selectedItem, setSelectedItem] = useState<ShopItem | null>(null);

  useEffect(() => {
    setActiveCategory(initialCategory);
    setSelectedItem(null);
    setPage(1);
    if (initialCategory === 'toman_topup') {
      setSearchQuery('');
      setOwnershipFilter('all');
      setRarityFilter('all');
    }
  }, [initialCategory]);

  useEffect(() => {
    setPage(1);
  }, [activeCategory, searchQuery, ownershipFilter, rarityFilter]);

  const handleOpenTopUp = () => {
    setSelectedItem(null);
    setSearchQuery('');
    setOwnershipFilter('all');
    setRarityFilter('all');
    setActiveCategory('toman_topup');
    onOpenTopUpShop?.();
  };

  const clearPendingOrder = onClearPendingTomanOrder ?? onClearPendingOrderId;

  const universalCatalog = useMemo<ClientUniversalItem[]>(
    () => buildUnifiedUniversalCatalog(),
    []
  );

  const universalShopItems = useMemo<ShopItem[]>(
    () => universalCatalog.map(toShopItem),
    [universalCatalog]
  );

  const universalById = useMemo(
    () => new Map(universalCatalog.map((u) => [u.id, u])),
    [universalCatalog]
  );

  const ownedSet = useMemo(() => new Set(ownedItemIds), [ownedItemIds]);

  const isItemEquipped = (itemId: string): boolean => {
    const def = universalById.get(itemId);
    if (!def?.slot || !def.isEquippable) return false;
    if (equippedSlots && def.slot in equippedSlots) {
      return equippedSlots[def.slot] === itemId;
    }
    if (def.slot === 'table_skin') return equippedTableSkinId === itemId;
    if (def.slot === 'card_deck') {
      return toDeckItemId(equippedDeckId) === itemId;
    }
    if (def.slot === 'banner' && def.visualMeta?.bannerCode) {
      return equippedBannerCode === def.visualMeta.bannerCode;
    }
    return false;
  };

  const activeSectionMeta = useMemo(
    () =>
      activeCategory === 'all'
        ? null
        : SHOP_SECTIONS.find((s) => s.id === activeCategory) ?? null,
    [activeCategory]
  );

  const hasActiveSearchOrFilters =
    searchQuery.trim().length > 0 ||
    ownershipFilter !== 'all' ||
    rarityFilter !== 'all';

  const featuredItems = useMemo(
    () => getFeaturedShopItems(universalShopItems),
    [universalShopItems]
  );

  const filteredCatalogDefs = useMemo(
    () =>
      filterCatalogItems({
        items: universalCatalog,
        searchQuery,
        category: activeCategory,
        rarity: rarityFilter,
        ownershipFilter,
        ownedItemIds: ownedSet,
      }),
    [universalCatalog, searchQuery, activeCategory, rarityFilter, ownershipFilter, ownedSet]
  );

  const paginatedFiltered = useMemo(
    () => paginateCatalogItems(filteredCatalogDefs, page, ITEMS_PER_PAGE),
    [filteredCatalogDefs, page]
  );

  const categoryItems = useMemo(
    () => getShopItemsByCategory(universalShopItems, activeCategory),
    [universalShopItems, activeCategory]
  );

  const handleOpenProduct = (item: ShopItem) => {
    setSelectedItem(item);
  };

  const handleCloseProduct = () => {
    setSelectedItem(null);
  };

  const selectedItemSection = selectedItem
    ? SHOP_SECTIONS.find((s) => s.id === selectedItem.section)
    : undefined;

  return (
    <div
      className="space-y-4 sm:space-y-5 max-w-5xl mx-auto"
      data-testid="shop-page"
    >
      <ShopHeader
        userCoins={userCoins}
        userGems={userGems}
        activeCategoryTitle={activeSectionMeta?.title ?? null}
        activeCategorySubtitle={activeSectionMeta?.subtitle ?? null}
        onBack={onBack}
      />

      {/* Active Shop Test Mode Indicator */}
      {shopTestMode && (
        <div
          data-testid="shop-test-mode-banner"
          className="eyvan-card rounded-2xl px-4 py-2.5 border-[#19A2A2]/50 bg-[#0D8A8A]/10 flex items-center gap-2.5 text-xs"
        >
          <FlaskConical className="w-4 h-4 theme-accent-teal shrink-0" />
          <span className="font-extrabold theme-heading">
            حالت تست فروشگاه فعال است · دریافت همه آیتم‌ها و صندوق‌ها رایگان و بدون کسر موجودی انجام می‌شود.
          </span>
        </div>
      )}

      {/* Action Feedback Banner */}
      {shopNotice && (
        <div
          role="status"
          data-testid="shop-notice-banner"
          className="eyvan-card rounded-2xl px-4 py-2.5 border-[var(--eyvan-gold-border)] text-xs font-extrabold theme-accent-teal"
        >
          {shopNotice}
        </div>
      )}

      {/* Guest Purchase Info Bar */}
      {!isAuthenticated && onRequireAuth && (
        <div
          data-testid="shop-guest-banner"
          className="eyvan-card rounded-2xl px-4 py-3 border-[var(--eyvan-gold-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-[var(--eyvan-gold)]/15 border border-[var(--eyvan-gold-border)] flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4 theme-accent-gold" />
            </span>
            <p className="text-xs font-bold theme-heading leading-relaxed">
              برای خرید آیتم‌ها، پوسته‌های میز حکم و بنرهای پروفایل وارد حساب خود شوید.
            </p>
          </div>
          <button
            type="button"
            onClick={onRequireAuth}
            data-testid="shop-banner-auth-btn"
            className="min-h-[38px] px-4 rounded-xl bg-gradient-to-b from-[#F5D98E] to-[#C89634] hover:brightness-105 text-[#0B1628] text-xs font-black whitespace-nowrap shrink-0 cursor-pointer transition-all"
          >
            ورود
          </button>
        </div>
      )}

      {/* Floating Compact Product Modal Overlay */}
      {selectedItem && (
        <ShopProductDetails
          item={selectedItem}
          sectionMeta={selectedItemSection}
          userCoins={userCoins}
          userGems={userGems}
          isAuthenticated={isAuthenticated}
          ownedItemIds={ownedItemIds}
          equippedSlots={equippedSlots}
          equippedTableSkinId={equippedTableSkinId}
          equippedBannerCode={equippedBannerCode}
          shopTestMode={shopTestMode}
          onPurchaseItem={onPurchaseItem}
          onEquipItem={onEquipItem}
          onUnequipSlot={onUnequipSlot}
          onRequireAuth={onRequireAuth}
          onOpenTopUpShop={handleOpenTopUp}
          onInventorySync={onInventorySync}
          onBack={handleCloseProduct}
        />
      )}

      {/* 1-Tap Category Switcher */}
      <ShopCategories
        sections={SHOP_SECTIONS}
        activeCategory={activeCategory}
        onSelectCategory={(cat) => {
          setActiveCategory(cat);
          if (cat === 'toman_topup') {
            setSearchQuery('');
            setOwnershipFilter('all');
            setRarityFilter('all');
          }
        }}
      />

      {/* Scalable Search & Filter Toolbar */}
      {activeCategory !== 'toman_topup' && (
      <div
        data-testid="shop-filter-toolbar"
        className="eyvan-card rounded-2xl p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5"
      >
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 theme-muted absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="جستجوی نام، نوع یا ویژگی آیتم..."
            aria-label="جستجو در فروشگاه"
            data-testid="shop-search-input"
            className="w-full min-h-[38px] pr-9 pl-8 rounded-xl theme-subcard border text-xs font-bold theme-heading placeholder:theme-muted focus:outline-none focus:ring-2 focus:ring-[var(--eyvan-teal)]"
          />
          {searchQuery.length > 0 && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="پاک کردن جستجو"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center theme-muted hover:theme-heading cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            aria-label="فیلتر وضعیت مالکیت"
            data-testid="shop-ownership-filter"
            value={ownershipFilter}
            onChange={(e) =>
              setOwnershipFilter(e.target.value as ShopOwnershipFilter)
            }
            className="min-h-[38px] px-2.5 rounded-xl theme-subcard border text-xs font-bold theme-heading cursor-pointer"
          >
            <option value="all">همه وضعیت‌ها</option>
            <option value="owned">در اختیار من</option>
            <option value="unowned">تهیه‌نشده</option>
          </select>

          <select
            aria-label="فیلتر کمیابی"
            data-testid="shop-rarity-filter"
            value={rarityFilter}
            onChange={(e) =>
              setRarityFilter(e.target.value as ShopRarityFilter)
            }
            className="min-h-[38px] px-2.5 rounded-xl theme-subcard border text-xs font-bold theme-heading cursor-pointer"
          >
            <option value="all">همه کمیابی‌ها</option>
            <option value="common">معمولی</option>
            <option value="rare">کمیاب</option>
            <option value="epic">حماسی</option>
            <option value="legendary">افسانه‌ای</option>
          </select>
        </div>
      </div>
      )}

      {/* Filtered / Searched Grid OR Showcase Shelves */}
      {activeCategory !== 'toman_topup' && hasActiveSearchOrFilters ? (
        paginatedFiltered.totalCount === 0 ? (
          <section
            data-testid="shop-empty-category"
            className="eyvan-card rounded-2xl p-8 text-center space-y-2"
          >
            <PackageOpen className="w-8 h-8 theme-muted mx-auto" />
            <div className="text-sm font-extrabold theme-heading">
              آیتمی مطابق جستجو یا فیلتر شما یافت نشد
            </div>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setOwnershipFilter('all');
                setRarityFilter('all');
              }}
              className="min-h-[36px] px-4 rounded-xl theme-btn-secondary border text-xs font-bold cursor-pointer mt-1"
            >
              نمایش همه آیتم‌ها
            </button>
          </section>
        ) : (
          <section
            data-testid="shop-filtered-results"
            className="space-y-4"
          >
            <div className="flex items-center justify-between text-xs theme-muted px-0.5">
              <span className="font-bold">
                نتایج یافت‌شده: {toPersianDigits(paginatedFiltered.totalCount)} مورد
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {paginatedFiltered.visibleItems.map((def) => {
                const shopItem = toShopItem(def);
                return (
                  <ShopProductCard
                    key={def.id}
                    item={shopItem}
                    isOwned={Boolean(def.isDefaultOwned || ownedSet.has(def.id))}
                    isEquipped={isItemEquipped(def.id)}
                    shopTestMode={shopTestMode}
                    onSelect={handleOpenProduct}
                  />
                );
              })}
            </div>
            {paginatedFiltered.hasMore && (
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  data-testid="shop-load-more-btn"
                  onClick={() => setPage((p) => p + 1)}
                  className="min-h-[42px] px-6 rounded-xl theme-btn-secondary border text-xs font-extrabold cursor-pointer"
                >
                  مشاهده موارد بیشتر
                </button>
              </div>
            )}
          </section>
        )
      ) : activeCategory === 'all' ? (
        <div className="space-y-6">
          {/* Featured Highlight Section */}
          {featuredItems.length > 0 && (
            <section
              data-shop-section="daily_deals"
              aria-label="پیشنهادهای ویژه امروز"
              className="eyvan-card rounded-2xl p-4 sm:p-5 space-y-3.5 border-[var(--eyvan-gold-border)]"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="w-4 h-4 theme-accent-gold shrink-0" />
                  <div className="min-w-0">
                    <h2 className="text-base sm:text-lg font-extrabold theme-heading truncate">
                      پیشنهادهای ویژه امروز
                    </h2>
                    <p className="text-[11px] sm:text-xs theme-muted truncate">
                      آیتم‌های برگزیده و مجموعه‌های ویژه ایوان
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveCategory('daily_deals')}
                  data-testid="shop-more-daily_deals"
                  className="min-h-[38px] px-3 py-1.5 rounded-xl theme-btn-secondary border text-xs font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--eyvan-teal)]"
                >
                  <span>مشاهده همه</span>
                  <ChevronLeft className="w-3.5 h-3.5 theme-accent-teal" />
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {featuredItems.map((item) => (
                  <ShopProductCard
                    key={item.id}
                    item={item}
                    isOwned={Boolean(item.isDefaultOwned || ownedSet.has(item.id))}
                    isEquipped={isItemEquipped(item.id)}
                    shopTestMode={shopTestMode}
                    onSelect={handleOpenProduct}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Structured Category Shelves */}
          {SHOP_SECTIONS.filter((s) => s.id !== 'daily_deals').map((section) => {
            if (section.id === 'toman_topup') {
              return (
                <TomanTopUpSection
                  key={section.id}
                  isAuthenticated={isAuthenticated}
                  onRequireAuth={onRequireAuth}
                  onInventorySync={onInventorySync}
                  pendingOrderIdFromUrl={pendingTomanOrderId}
                  onClearPendingOrderId={clearPendingOrder}
                />
              );
            }
            if (section.id === 'card_decks') {
              return (
                <DeckCatalogSection
                  key={section.id}
                  equippedDeckId={equippedDeckId}
                  ownedItemIds={ownedItemIds}
                  userCoins={userCoins}
                  userGems={userGems}
                  shopTestMode={shopTestMode}
                  isAuthenticated={isAuthenticated}
                  onSelectDeck={(deckId) => onSelectDeck?.(deckId)}
                  onClaimDeckItem={(deckId) => {
                    const deckItem = universalShopItems.find(
                      (i) => i.id === toDeckItemId(deckId)
                    );
                    if (deckItem) {
                      onPurchaseItem?.(deckItem);
                    }
                  }}
                  onRequireAuth={onRequireAuth}
                  onOpenTopUpShop={handleOpenTopUp}
                  onInventorySync={onInventorySync}
                />
              );
            }
            const sectionItems = getShopItemsByCategory(
              universalShopItems,
              section.id
            );
            return (
              <section
                key={section.id}
                data-shop-section={section.id}
                className="space-y-3"
              >
                <div className="flex items-center justify-between gap-2 px-0.5">
                  <div className="min-w-0">
                    <h2 className="text-base sm:text-lg font-extrabold theme-heading truncate">
                      {section.title}
                    </h2>
                    <p className="text-[11px] sm:text-xs theme-muted truncate mt-0.5">
                      {section.subtitle}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveCategory(section.id)}
                    data-testid={`shop-more-${section.id}`}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl theme-btn-secondary border text-xs font-bold inline-flex items-center gap-1 shrink-0 whitespace-nowrap cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--eyvan-teal)]"
                  >
                    <span>
                      همه ({toPersianDigits(sectionItems.length)})
                    </span>
                    <ChevronLeft className="w-3.5 h-3.5 theme-accent-teal" />
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                  {sectionItems.slice(0, ITEMS_PER_PAGE).map((item) => (
                    <ShopProductCard
                      key={item.id}
                      item={item}
                      isOwned={Boolean(item.isDefaultOwned || ownedSet.has(item.id))}
                      isEquipped={isItemEquipped(item.id)}
                      shopTestMode={shopTestMode}
                      onSelect={handleOpenProduct}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : activeCategory === 'toman_topup' ? (
        <TomanTopUpSection
          isAuthenticated={isAuthenticated}
          onRequireAuth={onRequireAuth}
          onInventorySync={onInventorySync}
          pendingOrderIdFromUrl={pendingTomanOrderId}
          onClearPendingOrderId={clearPendingOrder}
          compactHeader
        />
      ) : activeCategory === 'card_decks' ? (
        <DeckCatalogSection
          equippedDeckId={equippedDeckId}
          ownedItemIds={ownedItemIds}
          userCoins={userCoins}
          userGems={userGems}
          shopTestMode={shopTestMode}
          isAuthenticated={isAuthenticated}
          onSelectDeck={(deckId) => onSelectDeck?.(deckId)}
          onClaimDeckItem={(deckId) => {
            const deckItem = universalShopItems.find(
              (i) => i.id === toDeckItemId(deckId)
            );
            if (deckItem) {
              onPurchaseItem?.(deckItem);
            }
          }}
          onRequireAuth={onRequireAuth}
          onOpenTopUpShop={handleOpenTopUp}
          onInventorySync={onInventorySync}
        />
      ) : categoryItems.length === 0 ? (
        <section
          data-testid="shop-empty-category"
          className="eyvan-card rounded-2xl p-8 text-center space-y-2"
        >
          <PackageOpen className="w-8 h-8 theme-muted mx-auto" />
          <div className="text-sm font-extrabold theme-heading">
            در این دسته‌بندی فعلاً آیتمی وجود ندارد
          </div>
          <p className="text-xs theme-muted">
            می‌توانید سایر دسته‌های فروشگاه را بررسی کنید.
          </p>
        </section>
      ) : (
        <section
          aria-label={activeSectionMeta?.title ?? 'محصولات'}
          data-testid={`shop-category-view-${activeCategory}`}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {paginateCatalogItems(categoryItems, page, ITEMS_PER_PAGE).visibleItems.map(
              (item) => (
                <ShopProductCard
                  key={item.id}
                  item={item}
                  isOwned={Boolean(item.isDefaultOwned || ownedSet.has(item.id))}
                  isEquipped={isItemEquipped(item.id)}
                  shopTestMode={shopTestMode}
                  onSelect={handleOpenProduct}
                />
              )
            )}
          </div>
          {paginateCatalogItems(categoryItems, page, ITEMS_PER_PAGE).hasMore && (
            <div className="flex justify-center pt-1">
              <button
                type="button"
                data-testid="shop-load-more-btn"
                onClick={() => setPage((p) => p + 1)}
                className="min-h-[42px] px-6 rounded-xl theme-btn-secondary border text-xs font-extrabold cursor-pointer"
              >
                مشاهده موارد بیشتر
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
};
