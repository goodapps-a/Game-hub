import { Card, Suit, SUITS, TrickPlay } from './types';
import { getLegalCards } from './rules';
import { RandomFn } from './deck';

/**
 * Simple simulated player (Phase 1):
 * Strictly no AI strategy, no hand reading, no heuristics.
 * Computes legal moves and chooses one uniformly at random.
 */
export function pickRandomLegalCard(
  hand: readonly Card[],
  currentTrick: readonly TrickPlay[],
  rng: RandomFn = Math.random
): Card {
  const legal = getLegalCards(hand, currentTrick);
  if (legal.length === 0) {
    throw new Error('Simulated player has no legal cards to play.');
  }
  const index = Math.floor(rng() * legal.length);
  return legal[index];
}

/**
 * Randomly selects a trump suit when a simulated player is configured as Hakem.
 */
export function pickRandomTrumpSuit(rng: RandomFn = Math.random): Suit {
  const index = Math.floor(rng() * SUITS.length);
  return SUITS[index];
}
