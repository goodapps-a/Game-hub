import type { ShopItem } from '../../../platform/types/platform';
import { CARD_SKINS } from './registry';
import type { CardSkin } from './types';

const MOTIF_BY_SKIN: Record<string, ShopItem['motif']> = {
  'lapis-shamsa': 'shamsa',
  'royal-gold': 'arch',
  'persian-heritage': 'kashi',
  'modern-minimal': 'star',
  'dark-luxury': 'star',
  'classic-vintage': 'cypress',
};

/**
 * Maps a CardSkin onto the shop's existing ShopItem shape so the shop can list
 * skins without a new data model. `id` is prefixed (`cs-`) to stay clear of the
 * other shop ids; `skinIdFromShopItemId` reverses it on purchase.
 *
 * NOT wired into the shop catalog on purpose — the shop/economy is untouched in
 * this phase. When ready: spread `CARD_SKIN_SHOP_ITEMS` into the catalog and,
 * after a successful purchase, call `grantSkin(skinIdFromShopItemId(item.id))`.
 */
export const SHOP_ITEM_ID_PREFIX = 'cs-';

export function cardSkinToShopItem(skin: CardSkin): ShopItem {
  return {
    id: `${SHOP_ITEM_ID_PREFIX}${skin.id}`,
    section: 'card_backs',
    name: skin.name,
    subtitle: skin.englishName,
    description: skin.description,
    price: skin.price,
    currency: skin.currency,
    rarity: skin.rarity,
    palette: skin.palette,
    motif: MOTIF_BY_SKIN[skin.id] ?? 'shamsa',
    isDefaultOwned: skin.isDefaultOwned,
  };
}

export const CARD_SKIN_SHOP_ITEMS: readonly ShopItem[] = CARD_SKINS.map(cardSkinToShopItem);

export function skinIdFromShopItemId(shopItemId: string): string | null {
  return shopItemId.startsWith(SHOP_ITEM_ID_PREFIX) ? shopItemId.slice(SHOP_ITEM_ID_PREFIX.length) : null;
}
