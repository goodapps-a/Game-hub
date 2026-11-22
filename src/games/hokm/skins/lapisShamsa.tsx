import React from 'react';
import { CARD_ART_ASSETS } from '../../../platform/data/assets';
import { Suit } from '../engine/types';
import { CARD_BLACK, CARD_RED, SuitIconSvg } from './suitGlyphs';
import type { CardSkin, CourtRank, SkinAceProps, SkinBackProps, SkinCourtProps } from './types';

/**
 * DEFAULT SKIN — "شمسه لاجوردی" (Lapis Shamsa).
 * The artwork the game shipped with before the skin system existed:
 * photographic court cards + lapis/turquoise/gold geometric back. Markup and
 * class names are kept 1:1 so the default look is unchanged.
 */

function getCourtArtwork(
  rank: CourtRank,
  suit: Suit
): { src: string; hasBuiltInCornerPips?: boolean } {
  if (suit === 'hearts' || suit === 'diamonds') {
    if (rank === 'K') return { src: CARD_ART_ASSETS.kingRed };
    if (rank === 'Q') return { src: CARD_ART_ASSETS.queenRed };
    return { src: CARD_ART_ASSETS.jackRed };
  }
  if (rank === 'K') {
    return suit === 'spades'
      ? { src: CARD_ART_ASSETS.kingSpades, hasBuiltInCornerPips: true }
      : { src: CARD_ART_ASSETS.kingClubs };
  }
  if (rank === 'Q') {
    return { src: CARD_ART_ASSETS.queenBlack };
  }
  return suit === 'spades'
    ? { src: CARD_ART_ASSETS.jackSpades }
    : { src: CARD_ART_ASSETS.jackClubs };
}

const LapisShamsaBack: React.FC<SkinBackProps> = ({ className = '' }) => (
  <svg
    viewBox="0 0 100 144"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`w-full h-full block ${className}`}
    aria-hidden="true"
  >
    {/* Crisp ivory outer card rim */}
    <rect x="0.5" y="0.5" width="99" height="143" rx="8" fill="#FCFBF8" stroke="#D7CEBE" />
    {/* Deep Lapis body */}
    <rect x="4.5" y="4.5" width="91" height="135" rx="5.5" fill="#13294B" />
    {/* Matte gold inner geometric border */}
    <rect
      x="8"
      y="8"
      width="84"
      height="128"
      rx="3.5"
      stroke="#C59B43"
      strokeWidth="1.2"
      strokeOpacity="0.9"
    />
    {/* Fine turquoise inner inset */}
    <rect
      x="11.5"
      y="11.5"
      width="77"
      height="121"
      rx="2"
      stroke="#148A8A"
      strokeWidth="0.9"
      strokeOpacity="0.7"
    />
    {/* Subtle diamond lattice lines */}
    <path
      d="M12 36L50 12L88 36M12 108L50 132L88 108M12 72L50 42L88 72L50 102L12 72Z"
      stroke="#148A8A"
      strokeWidth="0.75"
      strokeOpacity="0.45"
    />
    {/* Top & Bottom pointed arch finials */}
    <path
      d="M37 25C42 20 46 17 50 15C54 17 58 20 63 25L50 34L37 25Z"
      fill="#148A8A"
      fillOpacity="0.35"
      stroke="#C59B43"
      strokeWidth="0.9"
    />
    <path
      d="M37 119C42 124 46 127 50 129C54 127 58 124 63 119L50 110L37 119Z"
      fill="#148A8A"
      fillOpacity="0.35"
      stroke="#C59B43"
      strokeWidth="0.9"
    />
    {/* Central Persian Shamsa Medallion */}
    <circle cx="50" cy="72" r="21" fill="#0E203D" stroke="#C59B43" strokeWidth="1.2" />
    <circle cx="50" cy="72" r="16.5" stroke="#148A8A" strokeWidth="0.9" strokeDasharray="2 2" />
    {/* 8-pointed star */}
    <path
      d="M50 53L54 63.5L65 61L58.5 70.5L68 72L58.5 73.5L65 83L54 80.5L50 91L46 80.5L35 83L41.5 73.5L32 72L41.5 70.5L35 61L46 63.5L50 53Z"
      fill="#C59B43"
      fillOpacity="0.9"
    />
    <circle cx="50" cy="72" r="6.5" fill="#13294B" stroke="#D6B46A" strokeWidth="1" />
    <circle cx="50" cy="72" r="2.8" fill="#148A8A" />
    {/* Corner micro-diamonds */}
    <path d="M16 16L19 19L16 22L13 19L16 16Z" fill="#C59B43" fillOpacity="0.75" />
    <path d="M84 16L87 19L84 22L81 19L84 16Z" fill="#C59B43" fillOpacity="0.75" />
    <path d="M16 122L19 125L16 128L13 125L16 122Z" fill="#C59B43" fillOpacity="0.75" />
    <path d="M84 122L87 125L84 128L81 125L84 122Z" fill="#C59B43" fillOpacity="0.75" />
  </svg>
);


const LapisShamsaAce: React.FC<SkinAceProps> = ({ suit, ink }) => (
  <div className="absolute inset-y-[12px] inset-x-[16px] sm:inset-y-[16px] sm:inset-x-[20px] flex items-center justify-center pointer-events-none">
    {suit === 'spades' ? (
      <img
        src={CARD_ART_ASSETS.aceSpades}
        alt=""
        aria-hidden="true"
        decoding="sync"
        loading="eager"
        draggable={false}
        className="w-[88%] h-[84%] object-contain mix-blend-multiply select-none"
      />
    ) : (
      <SuitIconSvg
        suit={suit}
        colorOverride={ink}
        className="w-[34px] h-[34px] sm:w-[46px] sm:h-[46px]"
      />
    )}
  </div>
);

const LapisShamsaCourt: React.FC<SkinCourtProps> = ({ rank, suit, ink }) => {
  const art = getCourtArtwork(rank, suit);
  return (
    <div className="absolute inset-y-[9px] inset-x-[18px] sm:inset-y-[12px] sm:inset-x-[24px] rounded-[2px] border border-[#2A3342]/45 bg-white overflow-hidden pointer-events-none">
      <img
        src={art.src}
        alt=""
        aria-hidden="true"
        decoding="sync"
        loading="eager"
        draggable={false}
        className="w-full h-full object-cover object-center mix-blend-multiply select-none scale-[1.03]"
      />
      {!art.hasBuiltInCornerPips && (
        <>
          <div className="absolute top-[2px] left-[2px] sm:top-[3px] sm:left-[3px] bg-white/85 rounded-full p-[1px]">
            <SuitIconSvg
              suit={suit}
              colorOverride={ink}
              className="w-[9px] h-[9px] sm:w-[12px] sm:h-[12px]"
            />
          </div>
          <div className="absolute bottom-[2px] right-[2px] sm:bottom-[3px] sm:right-[3px] bg-white/85 rounded-full p-[1px] rotate-180">
            <SuitIconSvg
              suit={suit}
              colorOverride={ink}
              className="w-[9px] h-[9px] sm:w-[12px] sm:h-[12px]"
            />
          </div>
        </>
      )}
    </div>
  );
};

export const LAPIS_SHAMSA_SKIN: CardSkin = {
  id: 'lapis-shamsa',
  name: 'شمسه لاجوردی',
  englishName: 'Lapis Shamsa',
  description:
    'طرح کلاسیک ایوان: ورق‌های سنتی با شاه و بی‌بی نقاشی‌شده و پشت لاجوردی با شمسه فیروزه‌ای و طلایی.',
  price: 0,
  currency: 'coins',
  rarity: 'common',
  palette: ['#13294B', '#148A8A', '#D6B46A'],
  isDefaultOwned: true,
  face: {
    paper: '#FFFFFF',
    border: '#CFCBC2',
    inkRed: CARD_RED,
    inkBlack: CARD_BLACK,
    indexFontFamily: '"Times New Roman", Georgia, "Liberation Serif", serif',
    indexFontWeight: 900,
  },
  backFrame: { background: '#FFFFFF', border: '#D4CFC5' },
  Back: LapisShamsaBack,
  Ace: LapisShamsaAce,
  Court: LapisShamsaCourt,
  preloadAssets: Object.values(CARD_ART_ASSETS),
};
