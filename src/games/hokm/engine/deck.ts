import {
  Card,
  HOKM_CONFIG,
  RANK_POWER,
  RANKS,
  Seat,
  SUITS,
} from './types';
import { getDealOrderFrom } from './turns';

export type RandomFn = () => number;

/**
 * Creates a standard 52-card deck with no jokers and 13 unique cards per suit.
 */
export function createStandardDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: `${suit}-${rank}`,
        suit,
        rank,
        power: RANK_POWER[rank],
      });
    }
  }
  return deck;
}

/**
 * Validates that a collection of cards has exact uniqueness and valid suits/ranks.
 */
export function assertDeckIntegrity(
  cards: readonly Card[],
  expectedCount = HOKM_CONFIG.STANDARD_DECK_SIZE
): void {
  if (cards.length !== expectedCount) {
    throw new Error(
      `Deck integrity error: expected ${expectedCount} cards, found ${cards.length}.`
    );
  }
  const seen = new Set<string>();
  for (const card of cards) {
    if (!SUITS.includes(card.suit)) {
      throw new Error(`Invalid card suit: ${String(card.suit)}`);
    }
    if (!RANKS.includes(card.rank)) {
      throw new Error(`Invalid card rank: ${String(card.rank)}`);
    }
    if (seen.has(card.id)) {
      throw new Error(`Duplicate card detected: ${card.id}`);
    }
    seen.add(card.id);
  }
}

/**
 * Returns a new Fisher-Yates shuffled copy of the deck.
 */
export function shuffleDeck(
  deck: readonly Card[],
  rng: RandomFn = Math.random
): Card[] {
  const copy = [...deck];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = copy[i];
    copy[i] = copy[j];
    copy[j] = temp;
  }
  return copy;
}

/**
 * Deals `cardsPerPlayer` cards from the top of `deck` to all 4 seats in counter-clockwise order starting at `startSeat`.
 */
export function dealCardsBatch(
  deck: readonly Card[],
  existingHands: Record<Seat, readonly Card[]>,
  cardsPerPlayer: number,
  startSeat: Seat
): {
  hands: Record<Seat, Card[]>;
  remainingDeck: Card[];
  dealSequence: Array<{ seat: Seat; card: Card }>;
} {
  const totalNeeded = cardsPerPlayer * 4;
  if (deck.length < totalNeeded) {
    throw new Error(
      `Not enough cards in deck to deal ${cardsPerPlayer} each (need ${totalNeeded}, have ${deck.length}).`
    );
  }

  const order = getDealOrderFrom(startSeat);
  const hands: Record<Seat, Card[]> = {
    south: [...existingHands.south],
    east: [...existingHands.east],
    north: [...existingHands.north],
    west: [...existingHands.west],
  };

  const dealSequence: Array<{ seat: Seat; card: Card }> = [];
  let cursor = 0;

  for (const seat of order) {
    for (let c = 0; c < cardsPerPlayer; c++) {
      const card = deck[cursor++];
      hands[seat].push(card);
      dealSequence.push({ seat, card });
    }
  }

  return {
    hands,
    remainingDeck: deck.slice(cursor),
    dealSequence,
  };
}

/**
 * Sorts a player's hand strictly Left-to-Right by suit:
 * Hearts (دل) -> Spades (پیک) -> Diamonds (خشت) -> Clubs (گشنیز)
 * and descending power (Ace -> 2) within each suit.
 */
export function sortHand(
  hand: readonly Card[],
  _trumpSuit: Card['suit'] | null = null
): Card[] {
  const suitOrder: readonly Card['suit'][] = [
    'hearts',
    'spades',
    'diamonds',
    'clubs',
  ];

  return [...hand].sort((a, b) => {
    const suitDiff = suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
    if (suitDiff !== 0) return suitDiff;
    return b.power - a.power;
  });
}
