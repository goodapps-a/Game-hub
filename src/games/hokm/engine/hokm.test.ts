import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDeckIntegrity,
  createStandardDeck,
  shuffleDeck,
  sortHand,
} from './deck';
import {
  COUNTER_CLOCKWISE_ORDER,
  getDealOrderFrom,
  getNextSeat,
  getPartnerSeat,
  getTeamForSeat,
} from './turns';
import {
  determineTrickWinner,
  getLegalCards,
  validateCardPlay,
} from './rules';
import { checkMatchWinner, evaluateHandOutcome } from './scoring';
import { pickRandomLegalCard, pickRandomTrumpSuit } from './simulator';
import {
  chooseTrumpSuit,
  collectCompletedTrick,
  createInitialMatchState,
  dealInitialFive,
  dealRemainingEight,
  playCard,
  resolveNextHakem,
  startNextHand,
  startShufflingHand,
} from './gameEngine';
import { Card, HOKM_CONFIG, RANK_POWER, Seat, Suit, TrickPlay } from './types';

function makeCard(suit: Suit, rank: Card['rank']): Card {
  return {
    id: `${suit}-${rank}`,
    suit,
    rank,
    power: RANK_POWER[rank],
  };
}

function makeSeededRng(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

test('Deck creation: exactly 52 unique cards, 4 suits x 13 ranks, no jokers', () => {
  const deck = createStandardDeck();
  assert.equal(deck.length, 52);
  assertDeckIntegrity(deck, 52);

  const bySuit = new Map<Suit, number>();
  for (const card of deck) {
    bySuit.set(card.suit, (bySuit.get(card.suit) ?? 0) + 1);
  }
  assert.equal(bySuit.get('hearts'), 13);
  assert.equal(bySuit.get('diamonds'), 13);
  assert.equal(bySuit.get('clubs'), 13);
  assert.equal(bySuit.get('spades'), 13);

  const shuffled = shuffleDeck(deck, makeSeededRng(42));
  assertDeckIntegrity(shuffled, 52);
  // Ensure shuffle actually reordered cards
  const sameOrder = shuffled.every((c, idx) => c.id === deck[idx].id);
  assert.equal(sameOrder, false);
});

test('Turn order: strictly counter-clockwise south -> east -> north -> west -> south', () => {
  assert.deepEqual(COUNTER_CLOCKWISE_ORDER, ['south', 'east', 'north', 'west']);
  assert.equal(getNextSeat('south'), 'east');
  assert.equal(getNextSeat('east'), 'north');
  assert.equal(getNextSeat('north'), 'west');
  assert.equal(getNextSeat('west'), 'south');

  assert.deepEqual(getDealOrderFrom('east'), ['east', 'north', 'west', 'south']);
  assert.equal(getTeamForSeat('south'), 'myTeam');
  assert.equal(getTeamForSeat('north'), 'myTeam');
  assert.equal(getTeamForSeat('east'), 'opponentTeam');
  assert.equal(getTeamForSeat('west'), 'opponentTeam');
  assert.equal(getPartnerSeat('south'), 'north');
  assert.equal(getPartnerSeat('east'), 'west');
});

test('5+4+4 dealing distributes 5 cards first, waits for trump, then deals 4 cards each and another 4 cards each (13 total, 0 duplicates)', () => {
  let state = createInitialMatchState({ initialHakem: 'south' });
  state = startShufflingHand(state, 'south', makeSeededRng(101));

  const after5 = dealInitialFive(state);
  state = after5.state;
  assert.equal(after5.dealSequence.length, 20);
  assert.equal(state.phase, 'CHOOSING_TRUMP');
  assert.equal(state.hands.south.length, 5);
  assert.equal(state.hands.east.length, 5);
  assert.equal(state.hands.north.length, 5);
  assert.equal(state.hands.west.length, 5);
  assert.equal(state.deck.length, 32);

  // Only Hakem can choose trump
  assert.throws(() => chooseTrumpSuit(state, 'hearts', 'east'));

  state = chooseTrumpSuit(state, 'hearts', 'south');
  assert.equal(state.trumpSuit, 'hearts');
  assert.equal(state.phase, 'DEALING_REMAINING_8');

  const after8 = dealRemainingEight(state);
  assert.equal(after8.wave1Sequence.length, 16);
  assert.equal(after8.wave2Sequence.length, 16);
  // First 4 of wave 1 go to Hakem (south), next 4 to east, etc.
  assert.deepEqual(
    after8.wave1Sequence.slice(0, 4).map((x) => x.seat),
    ['south', 'south', 'south', 'south']
  );
  assert.deepEqual(
    after8.wave1Sequence.slice(4, 8).map((x) => x.seat),
    ['east', 'east', 'east', 'east']
  );
  assert.deepEqual(
    after8.wave2Sequence.slice(0, 4).map((x) => x.seat),
    ['south', 'south', 'south', 'south']
  );

  state = after8.state;
  assert.equal(state.phase, 'PLAYING_TRICK');
  assert.equal(state.deck.length, 0);
  assert.equal(state.hands.south.length, 13);
  assert.equal(state.hands.east.length, 13);
  assert.equal(state.hands.north.length, 13);
  assert.equal(state.hands.west.length, 13);

  const allCards = [
    ...state.hands.south,
    ...state.hands.east,
    ...state.hands.north,
    ...state.hands.west,
  ];
  assertDeckIntegrity(allCards, 52);
});

test('Follow-suit rule: must follow lead suit if held; may play trump or off-suit only when void', () => {
  const hand: Card[] = [
    makeCard('hearts', 'K'),
    makeCard('hearts', '4'),
    makeCard('spades', 'A'),
    makeCard('clubs', '10'),
  ];

  // Lead is hearts -> only hearts are legal
  const trickLeadHearts: TrickPlay[] = [
    { seat: 'south', card: makeCard('hearts', '7') },
  ];
  const legalHearts = getLegalCards(hand, trickLeadHearts);
  assert.deepEqual(
    legalHearts.map((c) => c.id),
    ['hearts-K', 'hearts-4']
  );

  // Playing spades-A when holding hearts must be rejected by validator
  const invalidCheck = validateCardPlay(hand, 'spades-A', trickLeadHearts);
  assert.equal(invalidCheck.valid, false);

  // Lead is diamonds -> player has no diamonds -> all cards legal (including trump)
  const trickLeadDiamonds: TrickPlay[] = [
    { seat: 'south', card: makeCard('diamonds', 'Q') },
  ];
  const legalVoid = getLegalCards(hand, trickLeadDiamonds);
  assert.equal(legalVoid.length, 4);
  assert.equal(validateCardPlay(hand, 'spades-A', trickLeadDiamonds).valid, true);
});

test('Trick winner resolution: highest trump wins; without trump, highest lead suit wins; off-suit non-trump loses', () => {
  // Case 1: No trump played -> highest lead suit wins even if off-suit Ace is higher rank
  const trickNoTrump: TrickPlay[] = [
    { seat: 'south', card: makeCard('clubs', '9') },
    { seat: 'east', card: makeCard('clubs', 'Q') },
    { seat: 'north', card: makeCard('diamonds', 'A') }, // off-suit non-trump
    { seat: 'west', card: makeCard('clubs', '10') },
  ];
  const winner1 = determineTrickWinner(trickNoTrump, 'spades');
  assert.equal(winner1.seat, 'east');
  assert.equal(winner1.card.id, 'clubs-Q');

  // Case 2: Single low trump beats Ace of lead suit
  const trickOneTrump: TrickPlay[] = [
    { seat: 'south', card: makeCard('hearts', 'A') },
    { seat: 'east', card: makeCard('hearts', 'K') },
    { seat: 'north', card: makeCard('spades', '2') }, // lowest trump
    { seat: 'west', card: makeCard('hearts', 'Q') },
  ];
  const winner2 = determineTrickWinner(trickOneTrump, 'spades');
  assert.equal(winner2.seat, 'north');

  // Case 3: Multiple trumps -> highest trump wins
  const trickMultiTrump: TrickPlay[] = [
    { seat: 'east', card: makeCard('diamonds', 'A') },
    { seat: 'north', card: makeCard('hearts', '5') }, // trump
    { seat: 'west', card: makeCard('hearts', 'J') }, // higher trump
    { seat: 'south', card: makeCard('hearts', '9') }, // trump
  ];
  const winner3 = determineTrickWinner(trickMultiTrump, 'hearts');
  assert.equal(winner3.seat, 'west');
});

test('Scoring rules: Normal (1pt), Kot (Hakem team 7-0 -> 2pts), Hakem-Kot (Opposing team 7-0 -> 3pts)', () => {
  // Normal win: 7-3 -> 1 pt
  const normal = evaluateHandOutcome(
    { myTeam: 7, opponentTeam: 3 },
    'south',
    'hearts'
  );
  assert.ok(normal);
  assert.equal(normal.winningTeam, 'myTeam');
  assert.equal(normal.winType, 'normal');
  assert.equal(normal.pointsAwarded, 1);

  // Kot: Hakem is south (myTeam), myTeam wins 7-0 -> 2 pts
  const kot = evaluateHandOutcome(
    { myTeam: 7, opponentTeam: 0 },
    'south',
    'spades'
  );
  assert.ok(kot);
  assert.equal(kot.winningTeam, 'myTeam');
  assert.equal(kot.winType, 'kot');
  assert.equal(kot.pointsAwarded, 2);

  // Hakem-Kot: Hakem is south (myTeam), opponentTeam wins 7-0 -> 3 pts
  const hakemKot = evaluateHandOutcome(
    { myTeam: 0, opponentTeam: 7 },
    'south',
    'clubs'
  );
  assert.ok(hakemKot);
  assert.equal(hakemKot.winningTeam, 'opponentTeam');
  assert.equal(hakemKot.winType, 'hakem_kot');
  assert.equal(hakemKot.pointsAwarded, 3);

  // Reverse Hakem: Hakem is east (opponentTeam), myTeam wins 7-0 -> Hakem-Kot (3 pts for myTeam!)
  const hakemKotForMe = evaluateHandOutcome(
    { myTeam: 7, opponentTeam: 0 },
    'east',
    'diamonds'
  );
  assert.ok(hakemKotForMe);
  assert.equal(hakemKotForMe.winningTeam, 'myTeam');
  assert.equal(hakemKotForMe.winType, 'hakem_kot');
  assert.equal(hakemKotForMe.pointsAwarded, 3);

  // Not yet 7 tricks -> null
  assert.equal(
    evaluateHandOutcome({ myTeam: 6, opponentTeam: 6 }, 'south', 'hearts'),
    null
  );

  // Match target check (default target is 3 hands)
  assert.equal(
    checkMatchWinner({ myTeam: 3, opponentTeam: 1 }, HOKM_CONFIG.DEFAULT_MATCH_TARGET_SCORE),
    'myTeam'
  );
  assert.equal(
    checkMatchWinner({ myTeam: 2, opponentTeam: 2 }, HOKM_CONFIG.DEFAULT_MATCH_TARGET_SCORE),
    null
  );
});

test('Engine rejects illegal card play and out-of-turn plays independently of UI', () => {
  let state = createInitialMatchState({ initialHakem: 'south' });
  state = startShufflingHand(state, 'south', makeSeededRng(7));
  state = dealInitialFive(state).state;
  state = chooseTrumpSuit(state, 'spades', 'south');
  state = dealRemainingEight(state).state;

  // Out-of-turn play by east when it is south's turn must throw
  assert.throws(() => playCard(state, 'east', state.hands.east[0].id));

  // South leads a card
  const southLead = state.hands.south[0];
  state = playCard(state, 'south', southLead.id);
  assert.equal(state.currentTurn, 'east');

  // If east holds the lead suit, trying to play a non-lead-suit card must throw
  const eastHasLead = state.hands.east.some((c) => c.suit === southLead.suit);
  const eastOffSuit = state.hands.east.find((c) => c.suit !== southLead.suit);
  if (eastHasLead && eastOffSuit) {
    assert.throws(() => playCard(state, 'east', eastOffSuit.id));
  }
});

test('Full 50-hand simulation: counter-clockwise play, winner leads next trick, stops immediately at 7 tricks, zero card corruption', () => {
  const rng = makeSeededRng(2026);
  const seats: Seat[] = ['south', 'east', 'north', 'west'];

  for (let i = 0; i < 50; i++) {
    const initialHakem = seats[i % 4];
    let state = createInitialMatchState({ initialHakem, targetMatchScore: 7 });
    state = startShufflingHand(state, initialHakem, rng);
    state = dealInitialFive(state).state;
    const trump = pickRandomTrumpSuit(rng);
    state = chooseTrumpSuit(state, trump, initialHakem);
    state = dealRemainingEight(state).state;

    let expectedLeader: Seat = initialHakem;

    while (state.phase === 'PLAYING_TRICK') {
      assert.equal(state.currentTurn, expectedLeader);
      assert.equal(state.trickLeadSeat, expectedLeader);

      let turnSeat = expectedLeader;
      for (let p = 0; p < 4; p++) {
        assert.equal(state.currentTurn, turnSeat);
        const chosen = pickRandomLegalCard(
          state.hands[turnSeat],
          state.currentTrick,
          rng
        );
        state = playCard(state, turnSeat, chosen.id);
        turnSeat = getNextSeat(turnSeat);
      }

      assert.equal(state.phase, 'TRICK_COMPLETE');
      assert.ok(state.lastCompletedTrick);
      expectedLeader = state.lastCompletedTrick.winnerSeat;

      state = collectCompletedTrick(state);

      // Must stop immediately once either team hits 7 tricks
      if (state.trickCounts.myTeam === 7 || state.trickCounts.opponentTeam === 7) {
        assert.ok(
          state.phase === 'HAND_COMPLETE' || state.phase === 'MATCH_COMPLETE'
        );
        assert.ok(state.handOutcome);
        assert.ok(state.completedTricksCount <= 13);
        break;
      }
    }

    assert.ok(state.handOutcome, `Hand ${i} should conclude with an outcome`);
    const nextHandState = startNextHand(state, initialHakem, rng);
    assert.equal(nextHandState.handNumber, 2);
    assert.equal(nextHandState.hakem, initialHakem); // Engine never arbitrarily rotates Hakem
  }
});

test('wonTricksBySeat tracks trick wins per seat accurately and resets to zero on new hand', () => {
  const rng = makeSeededRng(999);
  let state = createInitialMatchState({ initialHakem: 'south' });
  state = startShufflingHand(state, 'south', rng);
  state = dealInitialFive(state).state;
  state = chooseTrumpSuit(state, 'hearts', 'south');
  state = dealRemainingEight(state).state;

  assert.deepEqual(state.wonTricksBySeat, {
    south: 0,
    east: 0,
    north: 0,
    west: 0,
  });

  // Play 3 complete tricks and verify seat-level trick pile count sums cleanly
  for (let t = 0; t < 3; t++) {
    let seat = state.currentTurn;
    for (let p = 0; p < 4; p++) {
      const card = pickRandomLegalCard(state.hands[seat], state.currentTrick, rng);
      state = playCard(state, seat, card.id);
      seat = getNextSeat(seat);
    }
    const winnerSeat = state.lastCompletedTrick!.winnerSeat;
    const prevWinnerCount = state.wonTricksBySeat[winnerSeat];
    state = collectCompletedTrick(state);
    assert.equal(state.wonTricksBySeat[winnerSeat], prevWinnerCount + 1);
  }

  const totalSeatTricks =
    state.wonTricksBySeat.south +
    state.wonTricksBySeat.east +
    state.wonTricksBySeat.north +
    state.wonTricksBySeat.west;
  assert.equal(totalSeatTricks, 3);
  assert.equal(
    state.wonTricksBySeat.south + state.wonTricksBySeat.north,
    state.trickCounts.myTeam
  );
  assert.equal(
    state.wonTricksBySeat.east + state.wonTricksBySeat.west,
    state.trickCounts.opponentTeam
  );

  // Reset on next hand
  const nextHand = startNextHand(state, 'south', rng);
  assert.deepEqual(nextHand.wonTricksBySeat, {
    south: 0,
    east: 0,
    north: 0,
    west: 0,
  });
});

test('resolveNextHakem keeps Hakem on win and rotates counter-clockwise on Hakem loss', () => {
  const base = createInitialMatchState({ initialHakem: 'south' });

  // Hakem (south, myTeam) wins -> stays south
  const wonByHakem = {
    ...base,
    hakem: 'south' as Seat,
    handOutcome: evaluateHandOutcome(
      { myTeam: 7, opponentTeam: 3 },
      'south',
      'hearts'
    ),
  };
  assert.equal(resolveNextHakem(wonByHakem), 'south');
  assert.equal(startNextHand(wonByHakem).hakem, 'south');

  // Hakem (south, myTeam) loses -> rotates counter-clockwise to east
  const lostBySouth = {
    ...base,
    hakem: 'south' as Seat,
    handOutcome: evaluateHandOutcome(
      { myTeam: 4, opponentTeam: 7 },
      'south',
      'spades'
    ),
  };
  assert.equal(resolveNextHakem(lostBySouth), 'east');
  assert.equal(startNextHand(lostBySouth).hakem, 'east');

  // Hakem (east, opponentTeam) loses -> rotates counter-clockwise to north
  const lostByEast = {
    ...base,
    hakem: 'east' as Seat,
    handOutcome: evaluateHandOutcome(
      { myTeam: 7, opponentTeam: 0 },
      'east',
      'diamonds'
    ),
  };
  assert.equal(resolveNextHakem(lostByEast), 'north');

  // Hakem (west, opponentTeam) loses -> wraps counter-clockwise to south
  const lostByWest = {
    ...base,
    hakem: 'west' as Seat,
    handOutcome: evaluateHandOutcome(
      { myTeam: 7, opponentTeam: 5 },
      'west',
      'clubs'
    ),
  };
  assert.equal(resolveNextHakem(lostByWest), 'south');
});

test('sortHand orders suits Left-to-Right (hearts -> spades -> diamonds -> clubs) and weakest (2) to strongest (A) left-to-right', () => {
  const unsorted: Card[] = [
    makeCard('clubs', 'A'),
    makeCard('clubs', '2'),
    makeCard('hearts', 'A'),
    makeCard('hearts', '3'),
    makeCard('hearts', '9'),
    makeCard('diamonds', 'K'),
    makeCard('diamonds', '4'),
    makeCard('spades', 'Q'),
    makeCard('spades', '2'),
  ];
  const sorted = sortHand(unsorted);
  assert.deepEqual(
    sorted.map((c) => c.id),
    [
      'hearts-3',
      'hearts-9',
      'hearts-A',
      'spades-2',
      'spades-Q',
      'diamonds-4',
      'diamonds-K',
      'clubs-2',
      'clubs-A',
    ]
  );
});


