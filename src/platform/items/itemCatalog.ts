import { PLATFORM_ASSETS } from '../data/assets';
import { SHOP_ITEMS_DEMO } from '../data/shopCatalog';
import { DeckCatalogEntry, DeckRegistry, EYVAN_CLASSIC_DECK_ID } from '../decks';
import { resolveDeckUrl } from '../decks/deckHosting';
import type { ProfileBannerCode, ShopItem } from '../types/platform';
import {
  BASE_UNIVERSAL_ITEMS,
  DEFAULT_EQUIPPED_SLOTS,
  buildPublicAppearanceFromSlots,
  deckEntryToUniversalItem,
  extractDeckIdFromItemId,
  resolveCatalogItemDefinition,
  toDeckItemId,
} from './catalogData';
import type {
  EquippedSlotsMap,
  PublicAppearanceSnapshot,
  UniversalItemDefinition,
} from './itemTypes';

const DEMO_IMAGE_MAP = new Map<string, string>(
  SHOP_ITEMS_DEMO.filter((item) => Boolean(item.imageSrc)).map((item) => [
    item.id,
    item.imageSrc as string,
  ])
);

const ITEM_IMAGE_OVERRIDES: Record<string, string> = {
  'dd-gold-chest': PLATFORM_ASSETS.shopChestGold,
  'dd-gem-coffer': PLATFORM_ASSETS.shopChestGem,
  'tt-traditional': PLATFORM_ASSETS.hokmTableTraditional,
  'tt-lapis': PLATFORM_ASSETS.hokmTableLapis,
  'tt-tabriz': PLATFORM_ASSETS.hokmTableRuby,
  'tt-turquoise-palace': PLATFORM_ASSETS.hokmTableLapis,
  'af-banner-royal': PLATFORM_ASSETS.profileBannerRoyal,
  'af-banner-garden': PLATFORM_ASSETS.profileBannerGarden,
  'af-banner-ruby': PLATFORM_ASSETS.profileBannerRuby,
  'ch-small-gold': PLATFORM_ASSETS.shopChestGold,
  'ch-royal-gem': PLATFORM_ASSETS.shopChestGem,
  'ch-grand-gold': PLATFORM_ASSETS.shopChestGold,
  'ch-starter-gem': PLATFORM_ASSETS.shopChestGem,
};

export interface ClientUniversalItem extends UniversalItemDefinition {
  readonly imageSrc?: string;
}

export function resolveItemImageSrc(
  item: UniversalItemDefinition,
  deckEntry?: DeckCatalogEntry
): string | undefined {
  if (item.deckId) {
    if (deckEntry?.previewPath) {
      return resolveDeckUrl(deckEntry.previewPath);
    }
    const fromRegistry = DeckRegistry.getCatalogEntry(item.deckId);
    if (fromRegistry?.previewPath) {
      return resolveDeckUrl(fromRegistry.previewPath);
    }
  }
  return ITEM_IMAGE_OVERRIDES[item.id] ?? DEMO_IMAGE_MAP.get(item.id);
}

export function toClientUniversalItem(
  def: UniversalItemDefinition,
  deckEntry?: DeckCatalogEntry
): ClientUniversalItem {
  return {
    ...def,
    imageSrc: resolveItemImageSrc(def, deckEntry),
  };
}

/**
 * Generates unified Shop items combining standard catalog items, built-in `eyvan-classic`,
 * and all dynamically registered Multi-Deck packs from `DeckRegistry`.
 */
export function buildUnifiedUniversalCatalog(
  extraDecks?: readonly DeckCatalogEntry[]
): ClientUniversalItem[] {
  const registryDecks = extraDecks ?? DeckRegistry.getAllCatalogEntries(false);
  const deckMap = new Map<string, DeckCatalogEntry>(
    registryDecks.map((d) => [d.id, d])
  );

  const itemsById = new Map<string, ClientUniversalItem>();
  for (const base of BASE_UNIVERSAL_ITEMS) {
    const deckEntry = base.deckId ? deckMap.get(base.deckId) : undefined;
    itemsById.set(base.id, toClientUniversalItem(base, deckEntry));
  }

  for (const entry of registryDecks) {
    const def = deckEntryToUniversalItem(entry);
    itemsById.set(def.id, toClientUniversalItem(def, entry));
  }

  return Array.from(itemsById.values());
}

/**
 * Converts a UniversalItemDefinition into a compatible `ShopItem` shape for existing helpers & UI.
 */
export function toShopItem(item: ClientUniversalItem): ShopItem {
  return {
    id: item.id,
    section: item.section,
    name: item.name,
    subtitle: item.subtitle,
    description: item.description,
    price: item.price,
    currency: item.currency,
    rarity: item.rarity,
    palette: [...item.palette] as [string, string, string],
    motif: item.motif,
    imageSrc: item.imageSrc,
    imageCropScale: item.imageCropScale,
    badge: item.badge,
    isDefaultOwned: item.isDefaultOwned,
  };
}

export function getTableSkinVisual(tableSkinId?: string): {
  imageSrc: string;
  vignette: string;
  railAccent: string;
} {
  const def = resolveCatalogItemDefinition(tableSkinId ?? 'tt-traditional');
  const imageKey = def?.visualMeta?.tableSkinImageKey ?? 'hokmTableTraditional';
  return {
    imageSrc: PLATFORM_ASSETS[imageKey] ?? PLATFORM_ASSETS.hokmTableTraditional,
    vignette:
      def?.visualMeta?.tableVignette ??
      'radial-gradient(ellipse at 50% 48%, rgba(7, 46, 33, 0.08) 0%, rgba(4, 28, 20, 0.40) 72%, rgba(2, 16, 12, 0.76) 100%)',
    railAccent: def?.visualMeta?.tableRailAccent ?? 'border-[#D4AE58]/42',
  };
}

export function getBannerVisual(
  bannerItemIdOrCode?: string | null
): {
  itemId: string | null;
  code: ProfileBannerCode;
  imageSrc: string | null;
  label: string;
} {
  if (!bannerItemIdOrCode || bannerItemIdOrCode === 'none') {
    return { itemId: null, code: 'none', imageSrc: null, label: 'بدون بنر' };
  }
  const byId = resolveCatalogItemDefinition(bannerItemIdOrCode);
  if (byId && byId.kind === 'banner') {
    const code = byId.visualMeta?.bannerCode ?? 'royal';
    return {
      itemId: byId.id,
      code,
      imageSrc: resolveItemImageSrc(byId) ?? PLATFORM_ASSETS.profileBannerRoyal,
      label: byId.name,
    };
  }
  const byCode = BASE_UNIVERSAL_ITEMS.find(
    (item) => item.kind === 'banner' && item.visualMeta?.bannerCode === bannerItemIdOrCode
  );
  if (byCode) {
    return {
      itemId: byCode.id,
      code: byCode.visualMeta?.bannerCode ?? 'royal',
      imageSrc: resolveItemImageSrc(byCode) ?? PLATFORM_ASSETS.profileBannerRoyal,
      label: byCode.name,
    };
  }
  return {
    itemId: 'af-banner-royal',
    code: 'royal',
    imageSrc: PLATFORM_ASSETS.profileBannerRoyal,
    label: 'بنر پروفایل ایوان شاهی',
  };
}

export function getAvatarFrameVisual(frameId?: string | null): {
  ringColor: string;
  glowColor: string;
  label: string | null;
} {
  if (!frameId) {
    return {
      ringColor: '#D4AE58',
      glowColor: 'rgba(212, 174, 88, 0.28)',
      label: null,
    };
  }
  const def = resolveCatalogItemDefinition(frameId);
  return {
    ringColor: def?.visualMeta?.frameRingColor ?? '#D4AE58',
    glowColor: def?.visualMeta?.frameGlowColor ?? 'rgba(212, 174, 88, 0.42)',
    label: def?.name ?? null,
  };
}

export function getProfileBadgeVisual(badgeId?: string | null): {
  symbol: string;
  color: string;
  label: string;
} | null {
  if (!badgeId) return null;
  const def = resolveCatalogItemDefinition(badgeId);
  if (!def || def.kind !== 'profile_badge') return null;
  return {
    symbol: def.visualMeta?.badgeSymbol ?? 'نشان',
    color: def.visualMeta?.badgeColor ?? '#19A2A2',
    label: def.name,
  };
}

export function getCardBackPalette(cardBackId?: string | null): {
  palette: readonly [string, string, string];
  motif: UniversalItemDefinition['motif'];
} {
  const def = resolveCatalogItemDefinition(cardBackId ?? 'cb-shamsa');
  if (def && def.kind === 'card_back') {
    return { palette: def.palette, motif: def.motif };
  }
  return { palette: ['#13294B', '#148A8A', '#D6B46A'], motif: 'shamsa' };
}

export function getGameEffectAccent(effectId?: string | null): string | null {
  if (!effectId) return null;
  const def = resolveCatalogItemDefinition(effectId);
  return def?.visualMeta?.effectAccent ?? null;
}

export function getDefaultEquippedSlots(): EquippedSlotsMap {
  return { ...DEFAULT_EQUIPPED_SLOTS };
}

export function filterPublicAppearance(
  equippedSlots: EquippedSlotsMap,
  customBannerNone = false
): PublicAppearanceSnapshot {
  const snapshot = buildPublicAppearanceFromSlots(equippedSlots, customBannerNone);
  return {
    ...snapshot,
    deckId: snapshot.deckId || EYVAN_CLASSIC_DECK_ID,
  };
}

export function getItemCategoryLabel(
  kind?: UniversalItemDefinition['kind'] | null,
  section?: string | null
): string {
  switch (kind) {
    case 'card_deck':
      return 'دسته کارت';
    case 'card_back':
      return 'پشت کارت';
    case 'table_skin':
    case 'table_background':
      return 'طرح میز بازی';
    case 'banner':
      return 'بنر پروفایل';
    case 'avatar_frame':
      return 'قاب آواتار';
    case 'avatar':
      return 'آواتار';
    case 'profile_badge':
    case 'nameplate':
      return 'نشان پروفایل';
    case 'game_effect':
      return 'افکت بازی';
    case 'chest':
    case 'bundle':
      return 'صندوق و سکه';
    default:
      break;
  }
  switch (section) {
    case 'card_decks':
      return 'دسته کارت';
    case 'card_backs':
      return 'پشت کارت';
    case 'table_themes':
      return 'طرح میز بازی';
    case 'avatars_frames':
      return 'پروفایل و قاب';
    case 'visual_effects':
      return 'افکت بازی';
    case 'chests':
      return 'صندوق و سکه';
    case 'toman_topup':
      return 'شارژ تومانی';
    default:
      return 'آیتم فروشگاه';
  }
}

export function getItemKindLabelFa(kind?: string | null): string {
  return getItemCategoryLabel(kind as UniversalItemDefinition['kind'] | null);
}

export {
  DEFAULT_EQUIPPED_SLOTS,
  extractDeckIdFromItemId,
  resolveCatalogItemDefinition,
  toDeckItemId,
};
