import React from 'react';
import { Card, RANK_META, Rank, SUIT_META } from '../engine/types';
import { SuitIconSvg } from '../skins/suitGlyphs';
import { useCardSkin } from '../skins/CardSkinContext';
import { CARD_SKINS, getCardSkin } from '../skins/registry';

// Re-exported so existing imports (`import { SuitIconSvg } from './PlayingCard'`) keep working.
export { SuitIconSvg };

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

let cardArtPreloaded = false;
const decodedCardArtCache: HTMLImageElement[] = [];

/** Warms the browser cache with every skin's image assets (the default skin ships photographic court cards). */
export function preloadCardArtwork(): void {
  if (cardArtPreloaded || typeof window === 'undefined') return;
  cardArtPreloaded = true;
  CARD_SKINS.forEach((skin) => {
    skin.preloadAssets?.forEach((url) => {
      const img = new Image();
      img.decoding = 'sync';
      img.src = url;
      decodedCardArtCache.push(img);
      if (typeof img.decode === 'function') {
        img.decode().catch(() => {});
      }
    });
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
  /**
   * Force a specific skin (shop previews, galleries). When omitted the card follows the
   * skin equipped by the player (CardSkinProvider).
   */
  skinId?: string;
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
    skinId,
  }) => {
    const sizeClass = SIZE_CLASSES[size];
    const { skin: equippedSkin } = useCardSkin();
    const skin = skinId ? getCardSkin(skinId) : equippedSkin;

    if (faceDown || !card) {
      const Back = skin.Back;
      return (
        <div
          className={`${sizeClass} relative select-none overflow-hidden p-[2px] shadow-[0_4px_12px_rgba(0,0,0,0.42)] border ${className}`}
          style={{
            background: skin.backFrame.background,
            borderColor: skin.backFrame.border,
          }}
          aria-hidden="true"
        >
          <div className="w-full h-full rounded-[inherit] overflow-hidden">
            <Back />
          </div>
        </div>
      );
    }

    const theme = skin.face;
    const suitMeta = SUIT_META[card.suit];
    const rankMeta = RANK_META[card.rank];
    const inkColor = suitMeta.isRed ? theme.inkRed : theme.inkBlack;
    const pips = PIP_LAYOUTS[card.rank];
    const isCourt = card.rank === 'J' || card.rank === 'Q' || card.rank === 'K';
    const label = `${rankMeta.faName} ${suitMeta.faName}`;
    const isIdle = !isWinningCard && !isSelected;
    const Decor = skin.Decor;
    const Ace = skin.Ace;
    const Court = skin.Court;
    const indexRankClass =
      card.rank === '10'
        ? 'text-[13px] sm:text-[16px] tracking-[-0.1em] scale-x-[0.84]'
        : 'text-[14px] sm:text-[18px] tracking-[-0.03em]';

    return (
      <div
        dir="ltr"
        aria-label={label}
        data-card-id={card.id}
        data-skin={skin.id}
        style={{
          background: theme.paper,
          ...(isIdle ? { borderColor: theme.border } : null),
        }}
        className={`${sizeClass} relative border select-none overflow-hidden transform-gpu transition-[filter,box-shadow] duration-200 ${
          isWinningCard
            ? 'border-[#E8C268] ring-[2.5px] ring-[#F3D179] shadow-[0_0_24px_rgba(243,209,121,0.72),0_8px_20px_rgba(0,0,0,0.45)]'
            : isSelected
              ? 'border-[#E8C268] ring-2 ring-[#F3D179]/85 shadow-[0_14px_28px_rgba(0,0,0,0.52)]'
              : 'shadow-[0_4px_14px_rgba(0,0,0,0.38)]'
        } ${!isPlayable ? 'brightness-[0.62] saturate-[0.22] contrast-[0.94]' : ''} ${className}`}
      >
        {/* Inner edge sheen */}
        <div
          className={`absolute inset-0 pointer-events-none rounded-[inherit] ${
            theme.innerEdge ? '' : 'shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)]'
          }`}
          style={theme.innerEdge ? { boxShadow: theme.innerEdge } : undefined}
          aria-hidden="true"
        />

        {/* Skin decoration (frames, flourishes) beneath indices and pips */}
        {Decor && <Decor suit={card.suit} ink={inkColor} />}

        {/* Top-left index (rank + suit) */}
        <div
          className="absolute top-[4px] left-[3.5px] sm:top-[6px] sm:left-[5px] flex flex-col items-center leading-none z-10 w-[16px] sm:w-[21px]"
          style={{ color: inkColor }}
        >
          <span
            className={`font-black leading-none tabular-nums ${indexRankClass}`}
            style={{ fontFamily: theme.indexFontFamily, fontWeight: theme.indexFontWeight }}
          >
            {rankMeta.label}
          </span>
          <SuitIconSvg
            suit={card.suit}
            colorOverride={inkColor}
            outline={theme.pipOutline}
            className="w-[10px] h-[10px] sm:w-[13px] sm:h-[13px] mt-[1.5px]"
          />
        </div>

        {/* Centre: Ace art, court art or pip grid — all supplied by the skin */}
        {card.rank === 'A' ? (
          <Ace suit={card.suit} ink={inkColor} />
        ) : isCourt ? (
          <Court rank={card.rank as Extract<Rank, 'J' | 'Q' | 'K'>} suit={card.suit} ink={inkColor} />
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
                    outline={theme.pipOutline}
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

        {/* Bottom-right inverted index */}
        <div
          className="absolute bottom-[4px] right-[3.5px] sm:bottom-[6px] sm:right-[5px] flex flex-col items-center leading-none rotate-180 z-10 w-[16px] sm:w-[21px]"
          style={{ color: inkColor }}
        >
          <span
            className={`font-black leading-none tabular-nums ${indexRankClass}`}
            style={{ fontFamily: theme.indexFontFamily, fontWeight: theme.indexFontWeight }}
          >
            {rankMeta.label}
          </span>
          <SuitIconSvg
            suit={card.suit}
            colorOverride={inkColor}
            outline={theme.pipOutline}
            className="w-[10px] h-[10px] sm:w-[13px] sm:h-[13px] mt-[1.5px]"
          />
        </div>
      </div>
    );
  }
);
PlayingCard.displayName = 'PlayingCard';
