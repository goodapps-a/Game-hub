import React from 'react';
import { Card, RANK_META, Rank, Suit, SUIT_META } from '../engine/types';
import { CARD_ART_ASSETS } from '../../../platform/data/assets';
import {
  deckRuntime,
  resolveCardBackVisual,
  resolveCardFaceVisual,
  useDeckRuntimeState,
} from '../../../platform/decks';
import { CardBackSvg } from './CardBackSvg';

const CARD_RED = '#C8102E';
const CARD_BLACK = '#111317';

/**
 * Playing-card suit silhouettes matching the CC0 SVG deck geometry.
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
        <svg
          viewBox="330.23 167.72 5.86 6.46"
          fill={color}
          className={className}
          aria-hidden="true"
        >
          <path d="M330.73 169.605c0-.485.213-.949.595-1.197.167-.109.365-.176.592-.186h.001c.79-.035 1.113.563 1.243 1.054.13-.491.453-1.089 1.243-1.054h.001c.227.01.425.077.592.186.382.248.595.712.595 1.197a1.5 1.5 0 0 1-.017.239c-.082.612-.492 1.311-1.005 1.955-.337.424-.641.821-.877 1.141-.329.446-.532.74-.532.74s-.203-.294-.532-.74c-.236-.32-.54-.717-.877-1.141-.513-.644-.923-1.343-1.005-1.955a1.4 1.4 0 0 1-.017-.239" />
        </svg>
      );
    case 'diamonds':
      return (
        <svg
          viewBox="317.6 167.5 5.5 6.6"
          fill={color}
          className={className}
          aria-hidden="true"
        >
          <path d="M320.35 173.68c-.59-1.034-1.292-2-2.093-2.881a16.2 16.2 0 0 0 2.093-2.882 16.2 16.2 0 0 0 2.093 2.882 16.3 16.3 0 0 0-2.093 2.881" />
        </svg>
      );
    case 'clubs':
      return (
        <svg
          viewBox="556 176 388 418"
          fill={color}
          className={className}
          aria-hidden="true"
        >
          <path d="M568.358 433.373v-2.067c0-1.282 0-2.493.07-3.775.357-7.48 1.354-14.391 2.85-20.874 14.32-63.762 79.293-75.232 115.627-51.865 15.46 9.974 14.818 3.847 6.198-6.198-59.131-69.105-22.94-159.084 56.566-160.794h.642c79.577 1.71 115.697 91.689 56.566 160.794-8.62 10.045-9.19 16.172 6.198 6.198 36.334-23.367 101.307-11.897 115.698 51.865a124 124 0 0 1 2.778 20.874c.071 1.282.143 2.493.143 3.775l-.072 2.067.072 1.994c0 44.598-36.69 81.288-81.288 81.288-39.04 0-74.092-27.998-79.934-66.683-.712-4.63-2.422-7.338-4.346-7.694-2.28.427-3.918 4.417-3.063 12.61 4.488 42.745 15.103 84.564 34.481 122.893h-95.108c19.378-38.329 29.993-80.148 34.481-122.893.855-8.193-.784-12.183-3.063-12.61-1.853.356-3.634 3.063-4.346 7.694-5.842 38.685-40.822 66.683-79.934 66.683-44.527 0-81.216-36.69-81.216-81.288z" />
        </svg>
      );
    case 'spades':
      return (
        <svg
          viewBox="575 178 350 410"
          fill={color}
          className={className}
          aria-hidden="true"
        >
          <path d="M750.022 187.804C825.607 294.68 904.977 356.118 906.19 439.632c.43 27.004-13.788 74.655-59.724 81.656-2.286.358-4.643.358-7.072.358-35.292 0-64.44-29.077-64.44-64.44l.072-3c.071-4.5-2.072-6.858-4.43-6.858-2.714.071-5.93 3.429-5.786 10.644 1.143 42.007 13.93 82.943 34.22 119.806h-98.088c20.289-36.863 33.077-77.799 34.22-119.806.214-7.215-3-10.573-5.787-10.644-2.357 0-4.43 2.357-4.43 6.858l.072 3c0 35.363-29.076 64.44-64.439 64.44-2.357 0-4.715 0-7.073-.358-45.864-7-60.152-54.652-59.724-81.656 1.215-83.514 80.656-144.953 156.24-251.828" />
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
  deckId?: string;
  cardBackId?: string;
  size?: 'xs' | 'sm' | 'md' | 'trick' | 'lg';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<PlayingCardProps['size']>, string> = {
  xs: 'w-9 h-[52px] rounded-[4px]',
  sm: 'w-14 h-[78px] rounded-[5px]',
  md: 'w-[92px] h-[130px] sm:w-[120px] sm:h-[168px] rounded-[6px] sm:rounded-[8px]',
  trick:
    'w-[82px] h-[116px] sm:w-[106px] sm:h-[150px] rounded-[6px] sm:rounded-[8px]',
  lg: 'w-[108px] h-[152px] sm:w-[128px] sm:h-[180px] rounded-[7px] sm:rounded-[9px]',
};

export const PlayingCard: React.FC<PlayingCardProps> = React.memo(
  ({
    card,
    faceDown = false,
    isSelected = false,
    isPlayable = true,
    isWinningCard = false,
    deckId,
    cardBackId,
    size = 'md',
    className = '',
  }) => {
    const runtime = useDeckRuntimeState(deckId);
    const sizeClass = SIZE_CLASSES[size];

    if (faceDown || !card) {
      const backVisual = resolveCardBackVisual(runtime);
      const backTokens = backVisual.styleTokens;
      const backPad = backTokens.backPaddingPx ?? 2;
      const resolvedBackBg =
        !backTokens.backBackground ||
        backTokens.backBackground.toUpperCase() === '#FFFFFF'
          ? '#EFECE3'
          : backTokens.backBackground;
      const resolvedBackBorder =
        !backTokens.backBorderColor ||
        backTokens.backBorderColor.toUpperCase() === '#D4CFC5'
          ? '#C9C3B4'
          : backTokens.backBorderColor;
      return (
        <div
          data-deck-id={backVisual.deckId}
          data-card-back-id={cardBackId ?? undefined}
          style={{
            backgroundColor: resolvedBackBg,
            borderColor: resolvedBackBorder,
            padding: `${backPad}px`,
          }}
          className={`${sizeClass} relative select-none overflow-hidden shadow-[0_4px_12px_rgba(0,0,0,0.42)] border ${className}`}
          aria-hidden="true"
        >
          <div className="w-full h-full rounded-[inherit] overflow-hidden">
            <CardBackSvg deckId={deckId} cardBackId={cardBackId} />
          </div>
        </div>
      );
    }

    const suitMeta = SUIT_META[card.suit];
    const rankMeta = RANK_META[card.rank];
    const label = `${rankMeta.faName} ${suitMeta.faName}`;
    const faceVisual = resolveCardFaceVisual(card.id, runtime);

    const stateHighlightClass = isWinningCard
      ? 'border-[#E8C268] ring-[2.5px] ring-[#F3D179] shadow-[0_0_24px_rgba(243,209,121,0.72),0_8px_20px_rgba(0,0,0,0.45)]'
      : isSelected
        ? 'border-[#E8C268] ring-2 ring-[#F3D179]/85 shadow-[0_14px_28px_rgba(0,0,0,0.52)]'
        : 'shadow-[0_4px_14px_rgba(0,0,0,0.38)]';

    const unplayableClass = !isPlayable
      ? 'brightness-[0.52] saturate-[0.2] contrast-[0.92]'
      : '';

    // Data-driven Multi-Deck image renderer (supports SVG, WebP, PNG & mixed formats)
    if (faceVisual.mode === 'image') {
      const tokens = faceVisual.styleTokens;
      const isWhiteCardStock =
        !tokens.cardBackground ||
        tokens.cardBackground.toUpperCase() === '#FFFFFF';
      const resolvedCardBg = isWhiteCardStock
        ? '#F3EFE4'
        : tokens.cardBackground;
      const resolvedBorderColor =
        !tokens.cardBorderColor ||
        tokens.cardBorderColor.toUpperCase() === '#CFCBC2'
          ? '#C9C3B4'
          : tokens.cardBorderColor;
      return (
        <div
          dir="ltr"
          aria-label={label}
          data-card-id={card.id}
          data-deck-id={faceVisual.deckId}
          style={{
            backgroundColor: resolvedCardBg,
            borderColor:
              isWinningCard || isSelected ? undefined : resolvedBorderColor,
            padding: tokens.imagePaddingPx
              ? `${tokens.imagePaddingPx}px`
              : undefined,
            filter:
              !isPlayable && tokens.unplayableFilter
                ? tokens.unplayableFilter
                : undefined,
          }}
          className={`${sizeClass} relative border select-none overflow-hidden transform-gpu transition-[filter,box-shadow] duration-200 ${stateHighlightClass} ${
            !isPlayable && !tokens.unplayableFilter ? unplayableClass : ''
          } ${className}`}
        >
          {isWhiteCardStock && (
            <div
              className="absolute inset-0 pointer-events-none bg-[#F3EFE4] mix-blend-multiply z-[5]"
              aria-hidden="true"
            />
          )}
          {tokens.cardInnerFrame !== false && (
            <div
              className="absolute inset-0 pointer-events-none rounded-[inherit] shadow-[inset_0_0_0_1px_rgba(32,26,18,0.06)] z-10"
              aria-hidden="true"
            />
          )}
          <img
            src={faceVisual.src}
            alt=""
            aria-hidden="true"
            decoding="sync"
            loading="eager"
            draggable={false}
            onError={() =>
              deckRuntime.markAssetBroken(
                faceVisual.deckId,
                faceVisual.assetKey
              )
            }
            className={`w-full h-full block select-none pointer-events-none ${
              tokens.imageFit === 'contain' ? 'object-contain' : 'object-cover'
            }`}
          />
        </div>
      );
    }

    // Built-in default Eyvan Classic composite card renderer (always available offline)
    const inkColor = suitMeta.isRed ? CARD_RED : CARD_BLACK;
    const pips = PIP_LAYOUTS[card.rank];
    const isCourt = card.rank === 'J' || card.rank === 'Q' || card.rank === 'K';
    const courtArt = isCourt
      ? getCourtArtwork(card.rank as 'J' | 'Q' | 'K', card.suit)
      : null;

    return (
      <div
        dir="ltr"
        aria-label={label}
        data-card-id={card.id}
        data-deck-id={faceVisual.deckId}
        className={`${sizeClass} relative bg-[#F3EFE4] border select-none overflow-hidden transform-gpu transition-[filter,box-shadow] duration-200 ${
          isWinningCard
            ? 'border-[#E8C268] ring-[2.5px] ring-[#F3D179] shadow-[0_0_24px_rgba(243,209,121,0.72),0_8px_20px_rgba(0,0,0,0.45)]'
            : isSelected
              ? 'border-[#E8C268] ring-2 ring-[#F3D179]/85 shadow-[0_14px_28px_rgba(0,0,0,0.52)]'
              : 'border-[#C9C3B4] shadow-[0_4px_14px_rgba(0,0,0,0.38)]'
        } ${unplayableClass} ${className}`}
      >
        {/* Subtle matte linen paper rim */}
        <div
          className="absolute inset-0 pointer-events-none rounded-[inherit] shadow-[inset_0_0_0_1px_rgba(32,26,18,0.06)]"
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
          <div className="absolute inset-y-[9px] inset-x-[18px] sm:inset-y-[12px] sm:inset-x-[24px] rounded-[2px] border border-[#2A3342]/45 bg-[#F3EFE4] overflow-hidden pointer-events-none">
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
                <div className="absolute top-[2px] left-[2px] sm:top-[3px] sm:left-[3px] bg-[#F3EFE4]/90 rounded-full p-[1px]">
                  <SuitIconSvg
                    suit={card.suit}
                    colorOverride={inkColor}
                    className="w-[9px] h-[9px] sm:w-[12px] sm:h-[12px]"
                  />
                </div>
                <div className="absolute bottom-[2px] right-[2px] sm:bottom-[3px] sm:right-[3px] bg-[#F3EFE4]/90 rounded-full p-[1px] rotate-180">
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
