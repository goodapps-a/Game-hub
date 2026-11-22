import React from 'react';
import { Suit, SUIT_META } from '../engine/types';

export const CARD_RED = '#C8102E';
export const CARD_BLACK = '#111317';

/** Classic French / Bicycle suit silhouettes on a 24×24 grid. */
export const SUIT_PATHS: Record<Suit, string> = {
  hearts: "M12 22C12 22 3.1 15.5 3.1 8.8C3.1 5.3 5.7 2.8 8.8 2.8C10.5 2.8 11.5 3.8 12 5C12.5 3.8 13.5 2.8 15.2 2.8C18.3 2.8 20.9 5.3 20.9 8.8C20.9 15.5 12 22 12 22Z",
  diamonds: "M12 1.6C14.3 6.1 17 9.3 20.6 12C17 14.7 14.3 17.9 12 22.4C9.7 17.9 7 14.7 3.4 12C7 9.3 9.7 6.1 12 1.6Z",
  clubs: "M12 2.3C9.5 2.3 7.6 4.2 7.6 6.6C7.6 7.9 8.2 9 9.1 9.7C8.4 9.3 7.5 9.1 6.5 9.1C4.1 9.1 2.3 10.9 2.3 13.2C2.3 15.5 4.1 17.3 6.5 17.3C8.5 17.3 10.1 16.2 10.7 14.6C10.5 17.8 9.6 20.3 8.3 21.9H15.7C14.4 20.3 13.5 17.8 13.3 14.6C13.9 16.2 15.5 17.3 17.5 17.3C19.9 17.3 21.7 15.5 21.7 13.2C21.7 10.9 19.9 9.1 17.5 9.1C16.5 9.1 15.6 9.3 14.9 9.7C15.8 9 16.4 7.9 16.4 6.6C16.4 4.2 14.5 2.3 12 2.3Z",
  spades: "M12 1.6C12 1.6 3.4 9.5 3.4 14.3C3.4 17.3 5.8 19.1 8.4 19.1C9.8 19.1 10.9 18.3 11.4 17.3C11.1 19.7 10.1 21.2 8.7 22.3H15.3C13.9 21.2 12.9 19.7 12.6 17.3C13.1 18.3 14.2 19.1 15.6 19.1C18.2 19.1 20.6 17.3 20.6 14.3C20.6 9.5 12 1.6 12 1.6Z",
};

export interface SuitOutline {
  color: string;
  width: number;
}

export const SuitIconSvg: React.FC<{
  suit: Suit;
  className?: string;
  colorOverride?: string;
  outline?: SuitOutline;
}> = ({ suit, className = 'w-5 h-5', colorOverride, outline }) => {
  const color = colorOverride ?? (SUIT_META[suit].isRed ? CARD_RED : CARD_BLACK);
  return (
    <svg viewBox="0 0 24 24" fill={color} className={className} aria-hidden="true">
      <path
        d={SUIT_PATHS[suit]}
        stroke={outline?.color}
        strokeWidth={outline?.width}
        strokeLinejoin={outline ? 'round' : undefined}
        paintOrder={outline ? 'stroke fill' : undefined}
      />
    </svg>
  );
};

/** Suit mark placed inside another SVG (court art, aces). `size` is the final width/height. */
export const SuitMark: React.FC<{
  suit: Suit;
  x: number;
  y: number;
  size: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}> = ({ suit, x, y, size, fill, stroke, strokeWidth, opacity }) => (
  <g transform={`translate(${x - size / 2} ${y - size / 2}) scale(${size / 24})`} opacity={opacity}>
    <path
      d={SUIT_PATHS[suit]}
      fill={fill}
      stroke={stroke}
      strokeWidth={stroke ? (strokeWidth ?? 1) * (24 / size) : undefined}
      strokeLinejoin="round"
    />
  </g>
);
