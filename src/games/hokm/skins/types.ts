import type React from 'react';
import type { Rank, Suit } from '../engine/types';

/**
 * Card Skin System — type contracts.
 *
 * A skin is a pure *presentation* bundle. It never touches game rules, turns,
 * dealing, scoring or animations: PlayingCard decides *what* to draw
 * (rank/suit/size/state) and the active skin decides *how it looks*.
 */

export type CourtRank = Extract<Rank, 'J' | 'Q' | 'K'>;
export type CardSkinRarity = 'common' | 'rare' | 'epic' | 'legendary';
export type CardSkinCurrency = 'coins' | 'gems';

/** Flat colours/typography of the card face (numbers, indices, paper). */
export interface CardSkinFaceTheme {
  /** CSS `background` of the face: colour or gradient. */
  paper: string;
  /** Border colour of an idle card (selected / winning states keep the shared gold highlight). */
  border: string;
  /** Ink used for hearts & diamonds. */
  inkRed: string;
  /** Ink used for clubs & spades. */
  inkBlack: string;
  indexFontFamily: string;
  indexFontWeight: number;
  /** Optional thin outline around pips and index suit icons (24×24 glyph units). */
  pipOutline?: { color: string; width: number };
  /** Optional CSS box-shadow that replaces the default soft inner edge. */
  innerEdge?: string;
}

/** Frame drawn around a face-down card (wrapper around `Back`). */
export interface CardSkinBackFrame {
  background: string;
  border: string;
}

export interface SkinBackProps {
  className?: string;
}

/** Full-card decoration under the indices/pips. SVG viewBox is 0 0 100 144. */
export interface SkinDecorProps {
  suit: Suit;
  ink: string;
}

export interface SkinAceProps {
  suit: Suit;
  ink: string;
}

export interface SkinCourtProps {
  rank: CourtRank;
  suit: Suit;
  ink: string;
}

export interface CardSkin {
  /** Stable unique id — this is what ownership / equip state stores. */
  id: string;
  name: string;
  englishName: string;
  description: string;
  price: number;
  currency: CardSkinCurrency;
  rarity: CardSkinRarity;
  /** [dominant, secondary, accent] — used by shop tiles and previews. */
  palette: [string, string, string];
  /** Owned by every account from the start (no purchase needed). */
  isDefaultOwned?: boolean;

  face: CardSkinFaceTheme;
  backFrame: CardSkinBackFrame;

  /** Card back. SVG viewBox 0 0 100 144, must fill its box (w-full h-full). */
  Back: React.ComponentType<SkinBackProps>;
  /** Optional decoration beneath indices (frames, flourishes). */
  Decor?: React.ComponentType<SkinDecorProps>;
  /** Centre artwork of an Ace. Renders its own absolutely positioned region. */
  Ace: React.ComponentType<SkinAceProps>;
  /** Centre artwork of a J / Q / K. Renders its own absolutely positioned region. */
  Court: React.ComponentType<SkinCourtProps>;
  /** Image URLs to warm up in the browser cache (optional). */
  preloadAssets?: readonly string[];
}
