import { EYVAN_CLASSIC_DECK_MANIFEST } from './deckCatalog';
import { ActiveDeckRuntimeState } from './deckRuntime';
import {
  CardAssetKey,
  DeckStyleTokens,
  EYVAN_CLASSIC_DECK_ID,
} from './types';

export type ResolvedCardVisual =
  | {
      readonly mode: 'builtin_classic';
      readonly deckId: string;
      readonly styleTokens: DeckStyleTokens;
    }
  | {
      readonly mode: 'image';
      readonly deckId: string;
      readonly assetKey: string;
      readonly src: string;
      readonly styleTokens: DeckStyleTokens;
    };

/**
 * Pure, deck-name-agnostic visual resolver for card faces.
 * Supports `builtin_classic`, `full_card`, and `partial_override` with automatic
 * fallback to Eyvan Classic if an asset key is missing or failed to decode.
 */
export function resolveCardFaceVisual(
  cardId: string,
  runtime: ActiveDeckRuntimeState
): ResolvedCardVisual {
  const { manifest, assetUrls, brokenAssetKeys } = runtime;
  if (
    manifest.id === EYVAN_CLASSIC_DECK_ID ||
    manifest.renderMode === 'builtin_classic'
  ) {
    return {
      mode: 'builtin_classic',
      deckId: EYVAN_CLASSIC_DECK_ID,
      styleTokens: EYVAN_CLASSIC_DECK_MANIFEST.styleTokens,
    };
  }

  const entry = manifest.cards[cardId as CardAssetKey];
  const assetKey = `card:${cardId}`;
  const src = assetUrls.get(assetKey);

  if (entry && src && !brokenAssetKeys.has(assetKey)) {
    return {
      mode: 'image',
      deckId: manifest.id,
      assetKey,
      src,
      styleTokens: manifest.styleTokens,
    };
  }

  // Fallback for missing or broken cards in partial/corrupted decks
  return {
    mode: 'builtin_classic',
    deckId: EYVAN_CLASSIC_DECK_ID,
    styleTokens: EYVAN_CLASSIC_DECK_MANIFEST.styleTokens,
  };
}

/**
 * Pure, deck-name-agnostic visual resolver for card backs.
 */
export function resolveCardBackVisual(
  runtime: ActiveDeckRuntimeState
): ResolvedCardVisual {
  const { manifest, assetUrls, brokenAssetKeys } = runtime;
  if (
    manifest.id === EYVAN_CLASSIC_DECK_ID ||
    manifest.renderMode === 'builtin_classic'
  ) {
    return {
      mode: 'builtin_classic',
      deckId: EYVAN_CLASSIC_DECK_ID,
      styleTokens: EYVAN_CLASSIC_DECK_MANIFEST.styleTokens,
    };
  }

  const src = assetUrls.get('back');
  if (manifest.back && src && !brokenAssetKeys.has('back')) {
    return {
      mode: 'image',
      deckId: manifest.id,
      assetKey: 'back',
      src,
      styleTokens: manifest.styleTokens,
    };
  }

  return {
    mode: 'builtin_classic',
    deckId: EYVAN_CLASSIC_DECK_ID,
    styleTokens: EYVAN_CLASSIC_DECK_MANIFEST.styleTokens,
  };
}
