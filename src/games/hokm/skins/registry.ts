import type { CardSkin } from './types';
import { LAPIS_SHAMSA_SKIN } from './lapisShamsa';
import { ROYAL_GOLD_SKIN } from './royalGold';
import { PERSIAN_HERITAGE_SKIN } from './persianHeritage';
import { MODERN_MINIMAL_SKIN } from './modernMinimal';
import { DARK_LUXURY_SKIN } from './darkLuxury';
import { CLASSIC_VINTAGE_SKIN } from './classicVintage';

/**
 * THE one place that lists card skins.
 *
 * Adding a skin = create `<name>.tsx` exporting a `CardSkin`, import it here and
 * append it to CARD_SKINS. No game logic, PlayingCard, HokmTable or shop code
 * has to change.
 */
export const CARD_SKINS: readonly CardSkin[] = [
  LAPIS_SHAMSA_SKIN,
  ROYAL_GOLD_SKIN,
  PERSIAN_HERITAGE_SKIN,
  MODERN_MINIMAL_SKIN,
  DARK_LUXURY_SKIN,
  CLASSIC_VINTAGE_SKIN,
];

export const DEFAULT_CARD_SKIN_ID: string = LAPIS_SHAMSA_SKIN.id;

const SKIN_BY_ID: ReadonlyMap<string, CardSkin> = new Map(CARD_SKINS.map((s) => [s.id, s]));

export function isKnownCardSkinId(id: string | null | undefined): id is string {
  return !!id && SKIN_BY_ID.has(id);
}

/** Unknown / missing ids fall back to the default skin — a stale saved id can never break rendering. */
export function getCardSkin(id?: string | null): CardSkin {
  return (id ? SKIN_BY_ID.get(id) : undefined) ?? LAPIS_SHAMSA_SKIN;
}

export const DEFAULT_OWNED_SKIN_IDS: readonly string[] = CARD_SKINS.filter((s) => s.isDefaultOwned).map(
  (s) => s.id
);
