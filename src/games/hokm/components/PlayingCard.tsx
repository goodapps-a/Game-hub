import React from 'react';
import { Card, RANK_META, Rank, Suit, SUIT_META } from '../engine/types';
import { CARD_ART_ASSETS } from '../../../platform/data/demoData';
import { CardBackSvg } from './CardBackSvg';

const CARD_RED = '#C8102E';
const CARD_BLACK = '#111317';

/**
 * Authentic classic French / Bicycle playing-card suit silhouettes.
 */
export const SuitIconSvg: React.FC<{
  suit: Suit;
  className?: string;
  colorOverride?: string;
}> = ({ suit, className = 'w-5 h-5', colorOverride }) => {
  const color = colorOverride ?? (SUIT_META[suit].isRed ? CARD_RED : CARD_BLACK);
  switch (suit) {
    case 'hearts':
      return (
        <svg viewBox="0 0 24 24" fill={color} className={className} aria-hidden="true">
          <path d="M12 22C12 22 3.1 15.5 3.1 8.8C3.1 5.3 5.7 2.8 8.8 2.8C10.5 2.8 11.5 3.8 12 5C12.5 3.8 13.5 2.8 15.2 2.8C18.3 2.8 20.9 5.3 20.9 8.8C20.9 15.5 12 22 12 22Z" />
        </svg>
      );
    case 'diamonds':
      return (
        <svg viewBox="0 0 24 24" fill={color} className={className} aria-hidden="true">
          <path d="M12 1.6C14.3 6.1 17 9.3 20.6 12C17 14.7 14.3 17.9 12 22.4C9.7 17.9 7 14.7 3.4 12C7 9.3 9.7 6.1 12 1.6Z" />
        </svg>
      );
    case 'clubs':
      return (
        <svg viewBox="0 0 24 24" fill={color} className={className} aria-hidden="true">
          <path d="M12 2.3C9.5 2.3 7.6 4.2 7.6 6.6C7.6 7.9 8.2 9 9.1 9.7C8.4 9.3 7.5 9.1 6.5 9.1C4.1 9.1 2.3 10.9 2.3 13.2C2.3 15.5 4.1 17.3 6.5 17.3C8.5 17.3 10.1 16.2 10.7 14.6C10.5 17.8 9.6 20.3 8.3 21.9H15.7C14.4 20.3 13.5 17.8 13.3 14.6C13.9 16.2 15.5 17.3 17.5 17.3C19.9 17.3 21.7 15.5 21.7 13.2C21.7 10.9 19.9 9.1 17.5 9.1C16.5 9.1 15.6 9.3 14.9 9.7C15.8 9 16.4 7.9 16.4 6.6C16.4 4.2 14.5 2.3 12 2.3Z" />
        </svg>
      );
    case 'spades':
      return (
        <svg viewBox="0 0 24 24" fill={color} className={className} aria-hidden="true">
          <path d="M12 1.6C12 1.6 3.4 9.5 3.4 14.3C3.4 17.3 5.8 19.1 8.4 19.1C9.8 19.1 10.9 18.3 11.4 17.3C11.1 19.7 10.1 21.2 8.7 22.3H15.3C13.9 21.2 12.9 19.7 12.6 17.3C13.1 18.3 14.2 19.1 15.6 19.1C18.2 19.1 20.6 17.3 20.6 14.3C20.6 9.5 12 1.6 12 1.6Z" />
        </svg>
      );
  }
};

/**
 * Standard Bicycle / French poker playing-card pip coordinates (x%, y%, inverted).
 * Lower-half pips are inverted 180 degrees exactly like real printed cards.
 */
type PipPoint = [number, number, boolean?];

const PIP_LAYOUTS: Partial<Record<Rank, PipPoint[]>> = {
  '2': [
    [50, 15],
    [50, 85, true],
  ],
  '3': [
    [50, 15],
    [50, 50],
    [50, 85, true],
  ],
  '4': [
    [26, 15],
    [74, 15],
    [26, 85, true],
    [74, 85, true],
  ],
  '5': [
    [26, 15],
    [74, 15],
    [50, 50],
    [26, 85, true],
    [74, 85, true],
  ],
  '6': [
    [26, 15],
    [74, 15],
    [26, 50],
    [74, 50],
    [26, 85, true],
    [74, 85, true],
  ],
  '7': [
    [26, 15],
    [74, 15],
    [50, 32.5],
    [26, 50],
    [74, 50],
    [26, 85, true],
    [74, 85, true],
  ],
  '8': [
    [26, 15],
    [74, 15],
    [50, 32.5],
    [26, 50],
    [74, 50],
    [50, 67.5, true],
    [26, 85, true],
    [74, 85, true],
  ],
  '9': [
    [26, 14],
    [74, 14],
    [26, 38],
    [74, 38],
    [50, 50],
    [26, 62, true],
    [74, 62, true],
    [26, 86, true],
    [74, 86, true],
  ],
  '10': [
    [26, 14],
    [74, 14],
    [50, 26],
    [26, 38],
    [74, 38],
    [26, 62, true],
    [74, 62, true],
    [50, 74, true],
    [26, 86, true],
    [74, 86, true],
  ],
};

function getCourtArtwork(rank: 'J' | 'Q' | 'K', suit: Suit): {
  src: string;
  hasBuiltInCornerPips?: boolean;
} {
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

let cardArtPreloaded = false;
const decodedCardArtCache: HTMLImageElement[] = [];

export function preloadCardArtwork(): void {
  if (cardArtPreloaded || typeof window === 'undefined') return;
  cardArtPreloaded = true;
  Object.values(CARD_ART_ASSETS).forEach((url) => {
    const img = new Image();
    img.decoding = 'sync';
    img.src = url;
    decodedCardArtCache.push(img);
    if (typeof img.decode === 'function') {
      img.decode().catch(() => {});
    }
  });
}

interface PlayingCardProps {
  /** Omit card when faceDown is true so opponent card data is never exposed to DOM */
  card?: Card;
  faceDown?: boolean;
  isSelected?: boolean;
  isPlayable?: boolean;
  isWinningCard?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'trick' | 'lg';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<PlayingCardProps['size']>, string> = {
  xs: 'w-9 h-[52px] rounded-[5px]',
  sm: 'w-14 h-[78px] rounded-[7px]',
  md: 'w-[84px] h-[118px] sm:w-[106px] sm:h-[148px] rounded-[8px] sm:rounded-[10px]',
  trick:
    'w-[78px] h-[110px] sm:w-[102px] sm:h-[143px] rounded-[8px] sm:rounded-[10px]',
  lg: 'w-[96px] h-[134px] sm:w-[116px] sm:h-[162px] rounded-[9px] sm:rounded-[11px]',
};

export const PlayingCard: React.FC<PlayingCardProps> = React.memo(
  ({
    card,
    faceDown = false,
    isSelected = false,
    isPlayable = true,
    isWinningCard = false,
    size = 'md',
    className = '',
  }) => {
    const sizeClass = SIZE_CLASSES[size];

    if (faceDown || !card) {
      return (
        <div
          className={`${sizeClass} relative select-none overflow-hidden bg-white p-[2px] shadow-[0_4px_12px_rgba(0,0,0,0.42)] border border-[#D4CFC5] ${className}`}
          aria-hidden="true"
        >
          <div className="w-full h-full rounded-[inherit] overflow-hidden">
            <CardBackSvg />
          </div>
        </div>
      );
    }

    const suitMeta = SUIT_META[card.suit];
    const rankMeta = RANK_META[card.rank];
    const inkColor = suitMeta.isRed ? CARD_RED : CARD_BLACK;
    const pips = PIP_LAYOUTS[card.rank];
    const isCourt = card.rank === 'J' || card.rank === 'Q' || card.rank === 'K';
    const label = `${rankMeta.faName} ${suitMeta.faName}`;
    const courtArt = isCourt
      ? getCourtArtwork(card.rank as 'J' | 'Q' | 'K', card.suit)
      : null;

    return (
      <div
        dir="ltr"
        aria-label={label}
        data-card-id={card.id}
        className={`${sizeClass} relative bg-[#FFFFFF] border select-none overflow-hidden transform-gpu transition-[filter,box-shadow] duration-200 ${
          isWinningCard
            ? 'border-[#E8C268] ring-[2.5px] ring-[#F3D179] shadow-[0_0_24px_rgba(243,209,121,0.72),0_8px_20px_rgba(0,0,0,0.45)]'
            : isSelected
              ? 'border-[#E8C268] ring-2 ring-[#F3D179]/85 shadow-[0_14px_28px_rgba(0,0,0,0.52)]'
              : 'border-[#CFCBC2] shadow-[0_4px_14px_rgba(0,0,0,0.38)]'
        } ${!isPlayable ? 'brightness-[0.62] saturate-[0.22] contrast-[0.94]' : ''} ${className}`}
      >
        {/* Subtle real poker-stock inner edge sheen */}
        <div
          className="absolute inset-0 pointer-events-none rounded-[inherit] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)]"
          aria-hidden="true"
        />

        {/* Top-Left authentic Bicycle index (tightly stacked rank + suit) */}
        <div
          className="absolute top-[4px] left-[3.5px] sm:top-[6px] sm:left-[5px] flex flex-col items-center leading-none z-10 w-[16px] sm:w-[21px]"
          style={{ color: inkColor }}
        >
          <span
            className={`font-black leading-none tabular-nums ${
              card.rank === '10'
                ? 'text-[13px] sm:text-[16px] tracking-[-0.1em] scale-x-[0.84]'
                : 'text-[14px] sm:text-[18px] tracking-[-0.03em]'
            }`}
            style={{
              fontFamily:
                '"Times New Roman", Georgia, "Liberation Serif", serif',
            }}
          >
            {rankMeta.label}
          </span>
          <SuitIconSvg
            suit={card.suit}
            colorOverride={inkColor}
            className="w-[10px] h-[10px] sm:w-[13px] sm:h-[13px] mt-[1.5px]"
          />
        </div>

        {/* Center Card Face: Authentic Ace, Double-Headed Court Engraving, or Standard Pip Grid */}
        {card.rank === 'A' ? (
          <div className="absolute inset-y-[12px] inset-x-[16px] sm:inset-y-[16px] sm:inset-x-[20px] flex items-center justify-center pointer-events-none">
            {card.suit === 'spades' ? (
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
                suit={card.suit}
                colorOverride={inkColor}
                className="w-[34px] h-[34px] sm:w-[46px] sm:h-[46px]"
              />
            )}
          </div>
        ) : isCourt && courtArt ? (
          <div className="absolute inset-y-[9px] inset-x-[18px] sm:inset-y-[12px] sm:inset-x-[24px] rounded-[2px] border border-[#2A3342]/45 bg-white overflow-hidden pointer-events-none">
            <img
              src={courtArt.src}
              alt=""
              aria-hidden="true"
              decoding="sync"
              loading="eager"
              draggable={false}
              className="w-full h-full object-cover object-center mix-blend-multiply select-none scale-[1.03]"
            />
            {!courtArt.hasBuiltInCornerPips && (
              <>
                <div className="absolute top-[2px] left-[2px] sm:top-[3px] sm:left-[3px] bg-white/85 rounded-full p-[1px]">
                  <SuitIconSvg
                    suit={card.suit}
                    colorOverride={inkColor}
                    className="w-[9px] h-[9px] sm:w-[12px] sm:h-[12px]"
                  />
                </div>
                <div className="absolute bottom-[2px] right-[2px] sm:bottom-[3px] sm:right-[3px] bg-white/85 rounded-full p-[1px] rotate-180">
                  <SuitIconSvg
                    suit={card.suit}
                    colorOverride={inkColor}
                    className="w-[9px] h-[9px] sm:w-[12px] sm:h-[12px]"
                  />
                </div>
              </>
            )}
          </div>
        ) : pips ? (
          <div className="absolute inset-y-[11px] inset-x-[19px] sm:inset-y-[14px] sm:inset-x-[25px] pointer-events-none">
            <div className="relative w-full h-full">
              {pips.map(([x, y, inv], idx) => (
                <div
                  key={idx}
                  className="absolute"
                  style={{
                    left: `${x}%`,
                    top: `${y}%`,
                    transform: `translate(-50%, -50%)${inv ? ' rotate(180deg)' : ''}`,
                  }}
                >
                  <SuitIconSvg
                    suit={card.suit}
                    colorOverride={inkColor}
                    className={
                      pips.length >= 9
                        ? 'w-[13px] h-[13px] sm:w-[17px] sm:h-[17px]'
                        : 'w-[15px] h-[15px] sm:w-[20px] sm:h-[20px]'
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Bottom-Right inverted authentic Bicycle index */}
        <div
          className="absolute bottom-[4px] right-[3.5px] sm:bottom-[6px] sm:right-[5px] flex flex-col items-center leading-none rotate-180 z-10 w-[16px] sm:w-[21px]"
          style={{ color: inkColor }}
        >
          <span
            className={`font-black leading-none tabular-nums ${
              card.rank === '10'
                ? 'text-[13px] sm:text-[16px] tracking-[-0.1em] scale-x-[0.84]'
                : 'text-[14px] sm:text-[18px] tracking-[-0.03em]'
            }`}
            style={{
              fontFamily:
                '"Times New Roman", Georgia, "Liberation Serif", serif',
            }}
          >
            {rankMeta.label}
          </span>
          <SuitIconSvg
            suit={card.suit}
            colorOverride={inkColor}
            className="w-[10px] h-[10px] sm:w-[13px] sm:h-[13px] mt-[1.5px]"
          />
        </div>
      </div>
    );
  }
);
PlayingCard.displayName = 'PlayingCard';
