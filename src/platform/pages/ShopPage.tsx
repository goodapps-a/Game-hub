import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Lock, PackageOpen, Sparkles } from 'lucide-react';
import { SHOP_ITEMS_DEMO, SHOP_SECTIONS } from '../data/shopCatalog';
import { toPersianDigits } from '../theme/tokens';
import { ShopItem } from '../types/platform';
import {
  ShopCategoryFilter,
  getFeaturedShopItems,
  getShopItemsByCategory,
} from '../utils/shopHelpers';
import { ShopCategories } from '../components/shop/ShopCategories';
import { ShopHeader } from '../components/shop/ShopHeader';
import { ShopProductCard } from '../components/shop/ShopProductCard';
import { ShopProductDetails } from '../components/shop/ShopProductDetails';

interface ShopPageProps {
  userCoins: number;
  userGems: number;
  isAuthenticated?: boolean;
  ownedItemIds?: readonly string[];
  equippedTableSkinId?: string;
  equippedBannerCode?: string;
  onPurchaseItem?: (item: ShopItem) => void;
  onEquipItem?: (item: ShopItem) => void;
  onRequireAuth?: () => void;
  initialCategory?: ShopCategoryFilter;
  onBack?: () => void;
}

export const ShopPage: React.FC<ShopPageProps> = ({
  userCoins,
  userGems,
  isAuthenticated = false,
  ownedItemIds = [],
  equippedTableSkinId = 'tt-traditional',
  equippedBannerCode = 'royal',
  onPurchaseItem,
  onEquipItem,
  onRequireAuth,
  initialCategory = 'all',
  onBack,
}) => {
  const [activeCategory, setActiveCategory] =
    useState<ShopCategoryFilter>(initialCategory);
  const [selectedItem, setSelectedItem] = useState<ShopItem | null>(null);

  useEffect(() => {
    setActiveCategory(initialCategory);
    setSelectedItem(null);
  }, [initialCategory]);

  const activeSectionMeta = useMemo(
    () =>
      activeCategory === 'all'
        ? null
        : SHOP_SECTIONS.find((s) => s.id === activeCategory) ?? null,
    [activeCategory]
  );

  const featuredItems = useMemo(
    () => getFeaturedShopItems(SHOP_ITEMS_DEMO),
    []
  );

  const filteredItems = useMemo(
    () => getShopItemsByCategory(SHOP_ITEMS_DEMO, activeCategory),
    [activeCategory]
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
          equippedTableSkinId={equippedTableSkinId}
          equippedBannerCode={equippedBannerCode}
          onPurchaseItem={onPurchaseItem}
          onEquipItem={onEquipItem}
          onRequireAuth={onRequireAuth}
          onBack={handleCloseProduct}
        />
      )}

      {/* 1-Tap Category Switcher */}
      <ShopCategories
        sections={SHOP_SECTIONS}
        activeCategory={activeCategory}
        onSelectCategory={(cat) => setActiveCategory(cat)}
      />

      {activeCategory === 'all' ? (
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
                    onSelect={handleOpenProduct}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Structured Category Shelves */}
          {SHOP_SECTIONS.filter((s) => s.id !== 'daily_deals').map((section) => {
            const sectionItems = getShopItemsByCategory(
              SHOP_ITEMS_DEMO,
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
                  {sectionItems.map((item) => (
                    <ShopProductCard
                      key={item.id}
                      item={item}
                      onSelect={handleOpenProduct}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : filteredItems.length === 0 ? (
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
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4"
        >
          {filteredItems.map((item) => (
            <ShopProductCard
              key={item.id}
              item={item}
              onSelect={handleOpenProduct}
            />
          ))}
        </section>
      )}
    </div>
  );
};
