import { Card, Suit, TrickPlay } from './types';

/**
 * Returns the lead suit of the current trick, or null if no card has been played yet.
 */
export function getLeadSuit(currentTrick: readonly TrickPlay[]): Suit | null {
  return currentTrick.length > 0 ? currentTrick[0].card.suit : null;
}

/**
 * Returns all cards from `hand` that are strictly legal to play given `currentTrick`.
 * Rule:
 * - If leading the trick (currentTrick is empty): all cards in hand are legal.
 * - If following: if the player holds at least one card of the lead suit, ONLY cards of the lead suit are legal.
 * - If void in the lead suit: all cards in hand (including trump) are legal.
 */
export function getLegalCards(
  hand: readonly Card[],
  currentTrick: readonly TrickPlay[]
): Card[] {
  const leadSuit = getLeadSuit(currentTrick);
  if (!leadSuit) {
    return [...hand];
  }
  const matchingSuitCards = hand.filter((card) => card.suit === leadSuit);
  if (matchingSuitCards.length > 0) {
    return matchingSuitCards;
  }
  return [...hand];
}

/**
 * Validates whether `cardId` is legal to play from `hand` in the current trick.
 * Independently enforces Hokm rules inside the engine regardless of UI state.
 */
export function validateCardPlay(
  hand: readonly Card[],
  cardId: string,
  currentTrick: readonly TrickPlay[]
): { valid: true; card: Card } | { valid: false; reason: string } {
  const card = hand.find((c) => c.id === cardId);
  if (!card) {
    return { valid: false, reason: 'کارت انتخاب‌شده در دست بازیکن وجود ندارد.' };
  }

  const legalCards = getLegalCards(hand, currentTrick);
  const isLegal = legalCards.some((c) => c.id === card.id);
  if (!isLegal) {
    return {
      valid: false,
      reason: 'باید از خال شروع‌شده در این دور بازی کنید.',
    };
  }

  return { valid: true, card };
}

/**
 * Determines the winning play of a completed 4-card trick.
 * Rules:
 * - If one or more trump cards were played, the highest-power trump wins.
 * - Otherwise, the highest-power card of the lead suit wins.
 */
export function determineTrickWinner(
  trick: readonly TrickPlay[],
  trumpSuit: Suit
): TrickPlay {
  if (trick.length !== 4) {
    throw new Error(
      `Cannot determine trick winner: expected 4 plays, got ${trick.length}.`
    );
  }

  const leadSuit = trick[0].card.suit;
  const trumpPlays = trick.filter((play) => play.card.suit === trumpSuit);

  if (trumpPlays.length > 0) {
    return trumpPlays.reduce((highest, current) =>
      current.card.power > highest.card.power ? current : highest
    );
  }

  const leadSuitPlays = trick.filter((play) => play.card.suit === leadSuit);
  return leadSuitPlays.reduce((highest, current) =>
    current.card.power > highest.card.power ? current : highest
  );
}
