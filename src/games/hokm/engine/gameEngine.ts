import {
  Card,
  CompletedTrick,
  HOKM_CONFIG,
  HokmState,
  Seat,
  Suit,
  TeamId,
} from './types';
import {
  assertDeckIntegrity,
  createStandardDeck,
  dealCardsBatch,
  RandomFn,
  shuffleDeck,
  sortHand,
} from './deck';
import { getNextSeat, getTeamForSeat } from './turns';
import { determineTrickWinner, validateCardPlay } from './rules';
import { checkMatchWinner, evaluateHandOutcome } from './scoring';

export interface InitMatchOptions {
  initialHakem?: Seat;
  targetMatchScore?: number;
}

/**
 * Creates a clean initial match state before dealing begins.
 */
export function createInitialMatchState(
  options: InitMatchOptions = {}
): HokmState {
  const hakem = options.initialHakem ?? 'south';
  const targetMatchScore =
    options.targetMatchScore ?? HOKM_CONFIG.DEFAULT_MATCH_TARGET_SCORE;

  return {
    phase: 'IDLE',
    handNumber: 1,
    targetMatchScore,
    matchScores: { myTeam: 0, opponentTeam: 0 },
    trickCounts: { myTeam: 0, opponentTeam: 0 },
    wonTricksBySeat: { south: 0, east: 0, north: 0, west: 0 },
    hakem,
    trumpSuit: null,
    deck: createStandardDeck(),
    hands: { south: [], east: [], north: [], west: [] },
    currentTurn: hakem,
    trickLeadSeat: hakem,
    currentTrick: [],
    lastCompletedTrick: null,
    completedTricksCount: 0,
    handOutcome: null,
    matchWinner: null,
  };
}

/**
 * Starts a fresh hand (keeping existing match scores unless reset explicitly),
 * shuffles a verified 52-card deck, and enters the SHUFFLING phase.
 */
export function startShufflingHand(
  state: HokmState,
  hakemOverride?: Seat,
  rng: RandomFn = Math.random
): HokmState {
  const hakem = hakemOverride ?? state.hakem;
  const freshDeck = shuffleDeck(createStandardDeck(), rng);
  assertDeckIntegrity(freshDeck, HOKM_CONFIG.STANDARD_DECK_SIZE);

  return {
    ...state,
    phase: 'SHUFFLING',
    hakem,
    trumpSuit: null,
    deck: freshDeck,
    hands: { south: [], east: [], north: [], west: [] },
    trickCounts: { myTeam: 0, opponentTeam: 0 },
    wonTricksBySeat: { south: 0, east: 0, north: 0, west: 0 },
    currentTurn: hakem,
    trickLeadSeat: hakem,
    currentTrick: [],
    lastCompletedTrick: null,
    completedTricksCount: 0,
    handOutcome: null,
  };
}

/**
 * Deals the initial 5 cards to each player (starting from Hakem, counter-clockwise)
 * and moves to CHOOSING_TRUMP.
 */
export function dealInitialFive(state: HokmState): {
  state: HokmState;
  dealSequence: Array<{ seat: Seat; card: Card }>;
} {
  if (state.phase !== 'SHUFFLING' && state.phase !== 'DEALING_INITIAL_5') {
    throw new Error(`Cannot deal initial 5 cards during phase ${state.phase}`);
  }

  const { hands, remainingDeck, dealSequence } = dealCardsBatch(
    state.deck,
    { south: [], east: [], north: [], west: [] },
    HOKM_CONFIG.INITIAL_DEAL_COUNT,
    state.hakem
  );

  // Sort South's hand for crisp readability while keeping other hands hidden
  hands.south = sortHand(hands.south, null);

  return {
    state: {
      ...state,
      phase: 'CHOOSING_TRUMP',
      deck: remainingDeck,
      hands,
      currentTurn: state.hakem,
      trickLeadSeat: state.hakem,
    },
    dealSequence,
  };
}

/**
 * Records the Hakem's chosen trump suit and prepares for dealing the remaining 8 cards.
 */
export function chooseTrumpSuit(
  state: HokmState,
  suit: Suit,
  actorSeat: Seat
): HokmState {
  if (state.phase !== 'CHOOSING_TRUMP') {
    throw new Error(`Cannot choose trump during phase ${state.phase}`);
  }
  if (actorSeat !== state.hakem) {
    throw new Error(
      `Only the Hakem (${state.hakem}) may choose trump, not ${actorSeat}.`
    );
  }

  return {
    ...state,
    phase: 'DEALING_REMAINING_8',
    trumpSuit: suit,
    hands: {
      ...state.hands,
      south: sortHand(state.hands.south, suit),
    },
  };
}

/**
 * Deals the remaining 8 cards in two authentic Iranian Hokm waves:
 * Wave 1: 4 cards to each player (counter-clockwise from Hakem)
 * Wave 2: 4 cards to each player (counter-clockwise from Hakem)
 * Total: 5 + 4 + 4 = 13 cards per player, 0 left in deck.
 */
export function dealRemainingEight(state: HokmState): {
  state: HokmState;
  wave1Sequence: Array<{ seat: Seat; card: Card }>;
  wave2Sequence: Array<{ seat: Seat; card: Card }>;
  dealSequence: Array<{ seat: Seat; card: Card }>;
} {
  if (state.phase !== 'DEALING_REMAINING_8') {
    throw new Error(
      `Cannot deal remaining 8 cards during phase ${state.phase}`
    );
  }
  if (!state.trumpSuit) {
    throw new Error('Trump suit must be chosen before dealing remaining 8 cards.');
  }

  // Wave 1: 4 cards each
  const wave1 = dealCardsBatch(
    state.deck,
    state.hands,
    HOKM_CONFIG.SECOND_DEAL_COUNT,
    state.hakem
  );

  // Wave 2: 4 cards each
  const wave2 = dealCardsBatch(
    wave1.remainingDeck,
    wave1.hands,
    HOKM_CONFIG.THIRD_DEAL_COUNT,
    state.hakem
  );

  if (wave2.remainingDeck.length !== 0) {
    throw new Error(
      `Expected 0 cards left in deck, got ${wave2.remainingDeck.length}`
    );
  }

  const hands = wave2.hands;

  // Verify total 52 unique cards across all 4 hands
  assertDeckIntegrity(
    [...hands.south, ...hands.east, ...hands.north, ...hands.west],
    HOKM_CONFIG.STANDARD_DECK_SIZE
  );

  hands.south = sortHand(hands.south, state.trumpSuit);

  return {
    state: {
      ...state,
      phase: 'PLAYING_TRICK',
      deck: [],
      hands,
      currentTurn: state.hakem,
      trickLeadSeat: state.hakem,
      currentTrick: [],
    },
    wave1Sequence: wave1.dealSequence,
    wave2Sequence: wave2.dealSequence,
    dealSequence: [...wave1.dealSequence, ...wave2.dealSequence],
  };
}

/**
 * Plays a single card for `seat`. Enforces turn order, phase, and Hokm follow-suit rules.
 * When the 4th card is played, transitions to TRICK_COMPLETE with `lastCompletedTrick` populated
 * so the UI can animate trick collection before calling `collectCompletedTrick`.
 */
export function playCard(
  state: HokmState,
  seat: Seat,
  cardId: string
): HokmState {
  if (state.phase !== 'PLAYING_TRICK') {
    throw new Error(`Cannot play card during phase ${state.phase}`);
  }
  if (!state.trumpSuit) {
    throw new Error('Cannot play card before trump suit is selected.');
  }
  if (seat !== state.currentTurn) {
    throw new Error(
      `Out of turn: expected ${state.currentTurn}, received ${seat}.`
    );
  }
  if (state.currentTrick.length >= 4) {
    throw new Error('Current trick already has 4 cards.');
  }

  const hand = state.hands[seat];
  const validation = validateCardPlay(hand, cardId, state.currentTrick);
  if (validation.valid === false) {
    throw new Error(validation.reason);
  }

  const playedCard = validation.card;
  const nextHand = hand.filter((c) => c.id !== playedCard.id);
  const nextHands: Record<Seat, readonly Card[]> = {
    ...state.hands,
    [seat]: nextHand,
  };

  const nextTrick = [...state.currentTrick, { seat, card: playedCard }];

  // If fewer than 4 cards have been played, advance turn counter-clockwise
  if (nextTrick.length < 4) {
    return {
      ...state,
      hands: nextHands,
      currentTrick: nextTrick,
      currentTurn: getNextSeat(seat),
    };
  }

  // 4th card played: determine winner and pause in TRICK_COMPLETE for collection animation
  const winningPlay = determineTrickWinner(nextTrick, state.trumpSuit);
  const winnerTeam = getTeamForSeat(winningPlay.seat);

  const completedTrick: CompletedTrick = {
    trickNumber: state.completedTricksCount + 1,
    leadSeat: state.trickLeadSeat,
    leadSuit: nextTrick[0].card.suit,
    plays: nextTrick,
    winnerSeat: winningPlay.seat,
    winnerTeam,
  };

  return {
    ...state,
    phase: 'TRICK_COMPLETE',
    hands: nextHands,
    currentTrick: nextTrick,
    lastCompletedTrick: completedTrick,
  };
}

/**
 * Collects the completed trick, awards the trick to the winning team, checks for hand win (at 7 tricks),
 * computes Normal / Kot / Hakem-Kot points, and prepares either the next trick or HAND_COMPLETE / MATCH_COMPLETE.
 */
export function collectCompletedTrick(state: HokmState): HokmState {
  if (state.phase !== 'TRICK_COMPLETE' || !state.lastCompletedTrick) {
    throw new Error('No completed trick available to collect.');
  }
  if (!state.trumpSuit) {
    throw new Error('Missing trump suit when collecting trick.');
  }

  const { winnerSeat, winnerTeam } = state.lastCompletedTrick;
  const nextTrickCounts: Record<TeamId, number> = {
    ...state.trickCounts,
    [winnerTeam]: state.trickCounts[winnerTeam] + 1,
  };
  const nextWonTricksBySeat: Record<Seat, number> = {
    ...state.wonTricksBySeat,
    [winnerSeat]: state.wonTricksBySeat[winnerSeat] + 1,
  };

  const completedTricksCount = state.completedTricksCount + 1;

  // Verify remaining card count invariant across all 4 hands
  const expectedRemainingPerPlayer =
    HOKM_CONFIG.CARDS_PER_PLAYER - completedTricksCount;
  for (const s of ['south', 'east', 'north', 'west'] as const) {
    if (state.hands[s].length !== expectedRemainingPerPlayer) {
      throw new Error(
        `Hand size mismatch after trick ${completedTricksCount}: seat ${s} has ${state.hands[s].length} cards, expected ${expectedRemainingPerPlayer}.`
      );
    }
  }

  const handOutcome = evaluateHandOutcome(
    nextTrickCounts,
    state.hakem,
    state.trumpSuit
  );

  if (handOutcome) {
    const nextMatchScores: Record<TeamId, number> = {
      ...state.matchScores,
      [handOutcome.winningTeam]:
        state.matchScores[handOutcome.winningTeam] + handOutcome.pointsAwarded,
    };
    const matchWinner = checkMatchWinner(
      nextMatchScores,
      state.targetMatchScore
    );

    return {
      ...state,
      phase: matchWinner ? 'MATCH_COMPLETE' : 'HAND_COMPLETE',
      trickCounts: nextTrickCounts,
      wonTricksBySeat: nextWonTricksBySeat,
      matchScores: nextMatchScores,
      currentTrick: [],
      completedTricksCount,
      handOutcome,
      matchWinner,
      currentTurn: winnerSeat,
      trickLeadSeat: winnerSeat,
    };
  }

  // Hand continues: winner of the trick leads the next trick!
  return {
    ...state,
    phase: 'PLAYING_TRICK',
    trickCounts: nextTrickCounts,
    wonTricksBySeat: nextWonTricksBySeat,
    currentTrick: [],
    completedTricksCount,
    currentTurn: winnerSeat,
    trickLeadSeat: winnerSeat,
  };
}

/**
 * Starts the next hand in an ongoing match (preserves matchScores and increments handNumber).
 * Hakem is NOT arbitrarily rotated; caller supplies the configured Hakem (defaulting to current state.hakem).
 */
export function startNextHand(
  state: HokmState,
  hakemForNextHand?: Seat,
  rng: RandomFn = Math.random
): HokmState {
  const nextState: HokmState = {
    ...state,
    handNumber: state.handNumber + 1,
    handOutcome: null,
  };
  return startShufflingHand(nextState, hakemForNextHand ?? state.hakem, rng);
}

/**
 * Resets match scores to 0-0 and begins Hand 1 cleanly.
 */
export function resetMatch(
  targetMatchScore: number,
  initialHakem: Seat,
  rng: RandomFn = Math.random
): HokmState {
  const initial = createInitialMatchState({ initialHakem, targetMatchScore });
  return startShufflingHand(initial, initialHakem, rng);
}
