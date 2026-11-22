import React from 'react';
import { PlayingCard } from '../components/PlayingCard';
import type { Card } from '../engine/types';

const PREVIEW_CARDS: readonly Card[] = [
  { id: 'preview-hearts-K', suit: 'hearts', rank: 'K', power: 13 },
  { id: 'preview-spades-A', suit: 'spades', rank: 'A', power: 14 },
];

/**
 * Live preview of a skin (back + King of hearts + Ace of spades), rendered by
 * the real PlayingCard so what you see is exactly what the table draws.
 * Fixed 118×70 box — suitable for shop tiles and the picker.
 */
export const CardSkinPreview: React.FC<{ skinId: string; className?: string }> = ({
  skinId,
  className = '',
}) => (
  <div dir="ltr" className={`relative w-[118px] h-[70px] shrink-0 ${className}`} aria-hidden="true">
    <div className="absolute left-0 top-0 origin-top-left scale-[0.55] -rotate-6">
      <PlayingCard faceDown size="md" skinId={skinId} />
    </div>
    <div className="absolute left-[34px] top-0 origin-top-left scale-[0.55]">
      <PlayingCard card={PREVIEW_CARDS[0]} size="md" skinId={skinId} />
    </div>
    <div className="absolute left-[68px] top-0 origin-top-left scale-[0.55] rotate-6">
      <PlayingCard card={PREVIEW_CARDS[1]} size="md" skinId={skinId} />
    </div>
  </div>
);
