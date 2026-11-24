import type { GameId, ProfileBannerCode, ShopRarity, ShopSectionId } from '../types/platform';

export type ItemKind =
  | 'banner'
  | 'avatar'
  | 'avatar_frame'
  | 'profile_badge'
  | 'nameplate'
  | 'card_deck'
  | 'card_back'
  | 'game_effect'
  | 'table_skin'
  | 'table_background'
  | 'chest'
  | 'bundle';

export type ItemSlot =
  | 'banner'
  | 'avatar'
  | 'avatar_frame'
  | 'profile_badge'
  | 'nameplate'
  | 'card_deck'
  | 'card_back'
  | 'game_effect'
  | 'table_skin'
  | 'table_background';

/**
 * Strict visibility scopes separating shared public cosmetics from private client visuals:
 * - `public_profile`: shared in public profile, friends list, room seats
 * - `public_gameplay`: shared inside online game rooms so opponents render your deck/back/effects
 * - `owner_only`: strictly private to the owner's own table view; NEVER leaked to opponents or public APIs
 */
export type ItemVisibilityScope =
  | 'public_profile'
  | 'public_gameplay'
  | 'owner_only';

export type EquippedSlotsMap = Partial<Record<ItemSlot, string>>;

export interface ItemRewardPayload {
  readonly coins?: number;
  readonly gems?: number;
  readonly grantRandomPool?: boolean;
}

export interface UniversalItemVisualMeta {
  readonly bannerCode?: Exclude<ProfileBannerCode, 'none'>;
  readonly tableSkinImageKey?: 'hokmTableTraditional' | 'hokmTableLapis' | 'hokmTableRuby';
  readonly tableVignette?: string;
  readonly tableRailAccent?: string;
  readonly frameRingColor?: string;
  readonly frameGlowColor?: string;
  readonly badgeSymbol?: string;
  readonly badgeColor?: string;
  readonly cardBackAccent?: string;
  readonly effectAccent?: string;
  readonly deckId?: string;
  readonly deckBytes?: number;
  readonly deckCardCount?: number;
  readonly deckAuthor?: string;
  readonly deckLicense?: string;
  readonly deckRenderMode?: 'builtin_classic' | 'full_card' | 'partial_override';
}

export interface UniversalItemDefinition {
  readonly id: string;
  readonly kind: ItemKind;
  readonly slot: ItemSlot | null;
  readonly visibilityScope: ItemVisibilityScope;
  readonly section: ShopSectionId;
  readonly gameId?: GameId | 'platform';
  readonly name: string;
  readonly subtitle: string;
  readonly description: string;
  readonly price: number;
  readonly currency: 'coins' | 'gems';
  readonly rarity: ShopRarity;
  readonly palette: readonly [string, string, string];
  readonly motif: 'shamsa' | 'kashi' | 'carpet' | 'arch' | 'star' | 'cypress' | 'chest';
  readonly badge?: string;
  readonly isDefaultOwned?: boolean;
  readonly isEquippable: boolean;
  readonly isClaimable: boolean;
  readonly deckId?: string;
  readonly rewardPayload?: ItemRewardPayload;
  readonly visualMeta?: UniversalItemVisualMeta;
  readonly tags?: readonly string[];
  readonly imageCropScale?: boolean;
}

/**
 * Strictly filtered public appearance snapshot safe for friends, search, public profiles, and match seats.
 * NEVER contains `table_skin`, `table_background`, wallet balances, email, or private inventory.
 */
export interface PublicAppearanceSnapshot {
  readonly bannerItemId: string | null;
  readonly bannerCode: ProfileBannerCode;
  readonly avatarItemId: string | null;
  readonly avatarFrameId: string | null;
  readonly badgeId: string | null;
  readonly nameplateId: string | null;
  readonly deckId: string;
  readonly cardBackId: string | null;
  readonly gameEffectId: string | null;
}

export interface InventoryRecord {
  readonly itemId: string;
  readonly source: 'default' | 'shop_claim' | 'test_mode' | 'reward' | 'system';
  readonly acquiredAt: number;
}

export interface ServerInventoryState {
  readonly userId: string;
  readonly coins: number;
  readonly gems: number;
  readonly ownedItemIds: string[];
  readonly inventory: InventoryRecord[];
  readonly equippedSlots: EquippedSlotsMap;
  readonly publicAppearance: PublicAppearanceSnapshot;
  readonly shopTestMode: boolean;
}
