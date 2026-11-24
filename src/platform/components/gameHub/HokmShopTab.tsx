import React, { useMemo, useState } from 'react';
import { ArrowLeft, ShoppingBag } from 'lucide-react';
import { SHOP_ITEMS_DEMO, SHOP_SECTIONS } from '../../data/shopCatalog';
import { ShopItem } from '../../types/platform';
import {
  HokmShopSubFilter,
  filterShopItemsForGame,
} from '../../utils/gameHubHelpers';
import { ShopProductCard } from '../shop/ShopProductCard';
import { ShopProductDetails } from '../shop/ShopProductDetails';
import { DeckCatalogSection } from '../shop/DeckCatalogSection';
import { EYVAN_CLASSIC_DECK_ID } from '../../decks';

interface HokmShopTabProps {
  userCoins: number;
  userGems: number;
  isAuthenticated?: boolean;
  ownedItemIds?: readonly string[];
  equippedTableSkinId?: string;
  equippedBannerCode?: string;
  equippedDeckId?: string;
  onPurchaseItem?: (item: ShopItem) => void;
  onEquipItem?: (item: ShopItem) => void;
  onSelectDeck?: (deckId: string) => void | Promise<void>;
  onRequireAuth?: () => void;
  onOpenFullShop: () => void;
}

const SUB_FILTERS: ReadonlyArray<{ id: HokmShopSubFilter; label: string }> = [
  { id: 'all', label: 'همه آیتم‌های حکم' },
  { id: 'card_decks', label: 'دست‌های کارت' },
  { id: 'card_backs', label: 'پشت کارت' },
  { id: 'table_themes', label: 'میز حکم' },
  { id: 'visual_effects', label: 'افکت‌ها' },
];

export const HokmShopTab: React.FC<HokmShopTabProps> = ({
  userCoins,
  userGems,
  isAuthenticated = false,
  ownedItemIds = [],
  equippedTableSkinId = 'tt-traditional',
  equippedBannerCode = 'royal',
  equippedDeckId = EYVAN_CLASSIC_DECK_ID,
  onPurchaseItem,
  onEquipItem,
  onSelectDeck,
  onRequireAuth,
  onOpenFullShop,
}) => {
  const [subFilter, setSubFilter] = useState<HokmShopSubFilter>('all');
  const [selectedItem, setSelectedItem] = useState<ShopItem | null>(null);

  const items = useMemo(
    () => filterShopItemsForGame(SHOP_ITEMS_DEMO, 'hokm', subFilter),
    [subFilter]
  );

  const selectedSectionMeta = selectedItem
    ? SHOP_SECTIONS.find((s) => s.id === selectedItem.section)
    : undefined;

  return (
    <div data-testid="hokm-shop-tab" className="space-y-4">
      {selectedItem && (
        <ShopProductDetails
          item={selectedItem}
          sectionMeta={selectedSectionMeta}
          userCoins={userCoins}
          userGems={userGems}
          isAuthenticated={isAuthenticated}
          ownedItemIds={ownedItemIds}
          equippedTableSkinId={equippedTableSkinId}
          equippedBannerCode={equippedBannerCode}
          onPurchaseItem={onPurchaseItem}
          onEquipItem={onEquipItem}
          onRequireAuth={onRequireAuth}
          onBack={() => setSelectedItem(null)}
        />
      )}
      {/* Top Filter & Full Shop Shortcut */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="فیلتر آیتم‌های فروشگاه حکم"
          className="inline-flex items-center gap-1 p-1 rounded-xl theme-tab-track overflow-x-auto max-w-full"
        >
          {SUB_FILTERS.map((f) => {
            const active = subFilter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`hokm-shop-filter-${f.id}`}
                onClick={() => setSubFilter(f.id)}
                className={`min-h-[38px] px-3 rounded-lg text-xs font-extrabold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  active
                    ? 'bg-[var(--eyvan-card-bg)] theme-heading shadow-xs'
                    : 'theme-muted hover:text-[var(--eyvan-text)]'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onOpenFullShop}
          className="min-h-[40px] px-3.5 rounded-xl theme-btn-secondary border text-xs font-extrabold inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
        >
          <ShoppingBag className="w-3.5 h-3.5 theme-accent-gold shrink-0" />
          <span>کل فروشگاه ایوان</span>
          <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
        </button>
      </div>

      {/* Multi-Deck Card Sets Section */}
      {(subFilter === 'all' || subFilter === 'card_decks') && (
        <DeckCatalogSection
          equippedDeckId={equippedDeckId}
          ownedItemIds={ownedItemIds}
          onSelectDeck={(deckId) => onSelectDeck?.(deckId)}
          compactHeader={subFilter === 'card_decks'}
        />
      )}

      {/* Product Grid */}
      {subFilter !== 'card_decks' && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {items.map((item) => (
            <ShopProductCard
              key={item.id}
              item={item}
              onSelect={setSelectedItem}
            />
          ))}
        </div>
      )}
    </div>
  );
};
