import React, { useMemo, useState } from 'react';
import { ArrowLeft, FlaskConical, ShoppingBag } from 'lucide-react';
import { SHOP_SECTIONS } from '../../data/shopCatalog';
import { EYVAN_CLASSIC_DECK_ID } from '../../decks';
import {
  buildUnifiedUniversalCatalog,
  toDeckItemId,
  toShopItem,
} from '../../items/itemCatalog';
import {
  EquippedSlotsMap,
  ItemSlot,
  ServerInventoryState,
} from '../../items/itemTypes';
import { ShopItem } from '../../types/platform';
import { ShopCategoryFilter } from '../../utils/shopHelpers';
import {
  HokmShopSubFilter,
  filterShopItemsForGame,
} from '../../utils/gameHubHelpers';
import { ShopProductCard } from '../shop/ShopProductCard';
import { ShopProductDetails } from '../shop/ShopProductDetails';
import { DeckCatalogSection } from '../shop/DeckCatalogSection';

interface HokmShopTabProps {
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
  onInventorySync?: (inventory: ServerInventoryState) => void;
  onOpenFullShop: (category?: ShopCategoryFilter) => void;
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
  onInventorySync,
  onOpenFullShop,
}) => {
  const [subFilter, setSubFilter] = useState<HokmShopSubFilter>('all');
  const [selectedItem, setSelectedItem] = useState<ShopItem | null>(null);

  const universalCatalog = useMemo(() => buildUnifiedUniversalCatalog(), []);
  const universalShopItems = useMemo(
    () => universalCatalog.map(toShopItem),
    [universalCatalog]
  );
  const universalById = useMemo(
    () => new Map(universalCatalog.map((u) => [u.id, u])),
    [universalCatalog]
  );
  const ownedSet = useMemo(() => new Set(ownedItemIds), [ownedItemIds]);

  const items = useMemo(
    () => filterShopItemsForGame(universalShopItems, 'hokm', subFilter),
    [universalShopItems, subFilter]
  );

  const isItemEquipped = (itemId: string): boolean => {
    const def = universalById.get(itemId);
    if (!def?.slot || !def.isEquippable) return false;
    if (equippedSlots && def.slot in equippedSlots) {
      return equippedSlots[def.slot] === itemId;
    }
    if (def.slot === 'table_skin') return equippedTableSkinId === itemId;
    if (def.slot === 'card_deck') return toDeckItemId(equippedDeckId) === itemId;
    if (def.slot === 'banner' && def.visualMeta?.bannerCode) {
      return equippedBannerCode === def.visualMeta.bannerCode;
    }
    return false;
  };

  const selectedSectionMeta = selectedItem
    ? SHOP_SECTIONS.find((s) => s.id === selectedItem.section)
    : undefined;

  return (
    <div data-testid="hokm-shop-tab" className="space-y-4">
      {shopTestMode && (
        <div
          data-testid="hokm-shop-test-mode-banner"
          className="eyvan-card rounded-2xl px-4 py-2.5 border-[#19A2A2]/50 bg-[#0D8A8A]/10 flex items-center gap-2 text-xs font-extrabold theme-heading"
        >
          <FlaskConical className="w-4 h-4 theme-accent-teal shrink-0" />
          <span>حالت تست فروشگاه فعال است · دریافت آیتم‌ها بدون کسر موجودی انجام می‌شود.</span>
        </div>
      )}

      {shopNotice && (
        <div
          role="status"
          className="eyvan-card rounded-2xl px-4 py-2.5 border-[var(--eyvan-gold-border)] text-xs font-extrabold theme-accent-teal"
        >
          {shopNotice}
        </div>
      )}

      {selectedItem && (
        <ShopProductDetails
          item={selectedItem}
          sectionMeta={selectedSectionMeta}
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
          onOpenTopUpShop={() => onOpenFullShop('toman_topup')}
          onInventorySync={onInventorySync}
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
          onClick={() => onOpenFullShop('all')}
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
          onOpenTopUpShop={() => onOpenFullShop('toman_topup')}
          onInventorySync={onInventorySync}
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
              isOwned={Boolean(item.isDefaultOwned || ownedSet.has(item.id))}
              isEquipped={isItemEquipped(item.id)}
              shopTestMode={shopTestMode}
              onSelect={setSelectedItem}
            />
          ))}
        </div>
      )}
    </div>
  );
};
