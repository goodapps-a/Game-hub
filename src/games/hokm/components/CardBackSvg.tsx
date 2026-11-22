import React from 'react';
import { useCardSkin } from '../skins/CardSkinContext';
import { getCardSkin } from '../skins/registry';

interface CardBackSvgProps {
  className?: string;
  /** Force a specific skin; defaults to the skin equipped by the player. */
  skinId?: string;
}

/**
 * Card back of the equipped skin. Every place in the game that draws a face-down
 * card (hidden hands, deck, flying deal cards, won-trick piles) uses this
 * component, so the whole table follows the selected skin automatically.
 * The default skin ("Lapis Shamsa") is the original Girih/Shamsa artwork.
 */
export const CardBackSvg: React.FC<CardBackSvgProps> = ({ className = '', skinId }) => {
  const { skin: equipped } = useCardSkin();
  const Back = (skinId ? getCardSkin(skinId) : equipped).Back;
  return <Back className={className} />;
};
