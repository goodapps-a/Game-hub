import React from 'react';
import {
  deckRuntime,
  resolveCardBackVisual,
  useDeckRuntimeState,
} from '../../../platform/decks';
import { getCardBackPalette } from '../../../platform/items';

interface CardBackSvgProps {
  className?: string;
  deckId?: string;
  cardBackId?: string | null;
}

/**
 * Default built-in Iranian geometric Girih & Shamsa playing card back in Lapis, Turquoise, and Matte Gold
 * (or customized palette from equipped Shop card_back cosmetic).
 * Pure SVG with zero external image dependencies.
 */
export const ClassicCardBackSvg: React.FC<CardBackSvgProps> = ({
  className = '',
  cardBackId,
}) => {
  const customPalette =
    cardBackId && cardBackId !== 'cb-shamsa'
      ? getCardBackPalette(cardBackId).palette
      : null;
  const bodyColor = customPalette ? customPalette[0] : '#13294B';
  const secondaryColor = customPalette ? customPalette[1] : '#148A8A';
  const goldAccent = customPalette ? customPalette[2] : '#C59B43';

  return (
    <svg
      viewBox="0 0 100 144"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      data-card-back-id={cardBackId ?? 'cb-shamsa'}
      className={`w-full h-full block ${className}`}
      aria-hidden="true"
    >
      {/* Crisp matte ivory outer card rim */}
      <rect
        x="0.5"
        y="0.5"
        width="99"
        height="143"
        rx="6"
        fill="#EFECE3"
        stroke="#C9C3B4"
      />
      {/* Primary body */}
      <rect x="4.5" y="4.5" width="91" height="135" rx="4" fill={bodyColor} />
      {/* Matte gold inner geometric border */}
      <rect
        x="8"
        y="8"
        width="84"
        height="128"
        rx="3.5"
        stroke={goldAccent}
        strokeWidth="1.2"
        strokeOpacity="0.9"
      />
      {/* Fine secondary inner inset */}
      <rect
        x="11.5"
        y="11.5"
        width="77"
        height="121"
        rx="2"
        stroke={secondaryColor}
        strokeWidth="0.9"
        strokeOpacity="0.7"
      />
      {/* Subtle diamond lattice lines */}
      <path
        d="M12 36L50 12L88 36M12 108L50 132L88 108M12 72L50 42L88 72L50 102L12 72Z"
        stroke={secondaryColor}
        strokeWidth="0.75"
        strokeOpacity="0.45"
      />
      {/* Top & Bottom pointed arch finials */}
      <path
        d="M37 25C42 20 46 17 50 15C54 17 58 20 63 25L50 34L37 25Z"
        fill={secondaryColor}
        fillOpacity="0.35"
        stroke={goldAccent}
        strokeWidth="0.9"
      />
      <path
        d="M37 119C42 124 46 127 50 129C54 127 58 124 63 119L50 110L37 119Z"
        fill={secondaryColor}
        fillOpacity="0.35"
        stroke={goldAccent}
        strokeWidth="0.9"
      />
      {/* Central Persian Shamsa Medallion */}
      <circle
        cx="50"
        cy="72"
        r="21"
        fill="#0E203D"
        fillOpacity="0.65"
        stroke={goldAccent}
        strokeWidth="1.2"
      />
      <circle
        cx="50"
        cy="72"
        r="16.5"
        stroke={secondaryColor}
        strokeWidth="0.9"
        strokeDasharray="2 2"
      />
      {/* 8-pointed star */}
      <path
        d="M50 53L54 63.5L65 61L58.5 70.5L68 72L58.5 73.5L65 83L54 80.5L50 91L46 80.5L35 83L41.5 73.5L32 72L41.5 70.5L35 61L46 63.5L50 53Z"
        fill={goldAccent}
        fillOpacity="0.9"
      />
      <circle
        cx="50"
        cy="72"
        r="6.5"
        fill={bodyColor}
        stroke="#D6B46A"
        strokeWidth="1"
      />
      <circle cx="50" cy="72" r="2.8" fill={secondaryColor} />
      {/* Corner micro-diamonds */}
      <path d="M16 16L19 19L16 22L13 19L16 16Z" fill={goldAccent} fillOpacity="0.75" />
      <path d="M84 16L87 19L84 22L81 19L84 16Z" fill={goldAccent} fillOpacity="0.75" />
      <path
        d="M16 122L19 125L16 128L13 125L16 122Z"
        fill={goldAccent}
        fillOpacity="0.75"
      />
      <path
        d="M84 122L87 125L84 128L81 125L84 122Z"
        fill={goldAccent}
        fillOpacity="0.75"
      />
    </svg>
  );
};

/**
 * Multi-Deck-aware Card Back renderer: renders active or per-seat deck's card back via safe `<img>`
 * (never inline SVG injection) with automatic fallback to ClassicCardBackSvg.
 */
export const CardBackSvg: React.FC<CardBackSvgProps> = React.memo(
  ({ className = '', deckId, cardBackId }) => {
    const runtime = useDeckRuntimeState(deckId);
    const backVisual = resolveCardBackVisual(runtime);

    if (backVisual.mode === 'image') {
      return (
        <img
          src={backVisual.src}
          alt=""
          aria-hidden="true"
          decoding="sync"
          loading="eager"
          draggable={false}
          data-deck-id={backVisual.deckId}
          data-card-back-id={cardBackId ?? undefined}
          onError={() =>
            deckRuntime.markAssetBroken(backVisual.deckId, backVisual.assetKey)
          }
          className={`w-full h-full block select-none pointer-events-none ${
            backVisual.styleTokens.imageFit === 'contain'
              ? 'object-contain'
              : 'object-cover'
          } ${className}`}
        />
      );
    }

    return <ClassicCardBackSvg className={className} cardBackId={cardBackId} />;
  }
);
CardBackSvg.displayName = 'CardBackSvg';

