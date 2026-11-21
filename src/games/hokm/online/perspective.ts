import {
  CompletedTrick,
  HandOutcome,
  HokmState,
  Seat,
  TeamId,
} from '../engine/types';
import { COUNTER_CLOCKWISE_ORDER, getTeamForSeat } from '../engine/turns';
import { sortHand } from '../engine/deck';
import { ProjectedHokmState } from './protocol';

/**
 * Rotates a canonical server seat into the visual perspective of `viewerSeat`,
 * so that every player ALWAYS sees:
 * - themselves at visual 'south' (bottom)
 * - their partner at visual 'north' (top)
 * - the next counter-clockwise player at visual 'east' (right)
 * - the previous player at visual 'west' (left)
 *
 * Strictly preserves counter-clockwise order for all 4 players!
 */
export function rotateSeatForViewer(canonicalSeat: Seat, viewerSeat: Seat): Seat {
  const cIdx = COUNTER_CLOCKWISE_ORDER.indexOf(canonicalSeat);
  const vIdx = COUNTER_CLOCKWISE_ORDER.indexOf(viewerSeat);
  return COUNTER_CLOCKWISE_ORDER[(cIdx - vIdx + 4) % 4];
}

/**
 * Inverse mapping: converts a visual seat on `viewerSeat`'s screen back to its canonical server seat.
 */
export function unrotateSeatFromViewer(visualSeat: Seat, viewerSeat: Seat): Seat {
  const visIdx = COUNTER_CLOCKWISE_ORDER.indexOf(visualSeat);
  const vIdx = COUNTER_CLOCKWISE_ORDER.indexOf(viewerSeat);
  return COUNTER_CLOCKWISE_ORDER[(visIdx + vIdx) % 4];
}

/**
 * Rotates canonical team ('myTeam' = south+north, 'opponentTeam' = east+west)
 * so that `viewerSeat`'s own team is ALWAYS 'myTeam' on their screen.
 */
export function rotateTeamForViewer(
  canonicalTeam: TeamId,
  viewerSeat: Seat
): TeamId {
  const viewerCanonicalTeam = getTeamForSeat(viewerSeat);
  if (viewerCanonicalTeam === 'myTeam') {
    return canonicalTeam;
  }
  return canonicalTeam === 'myTeam' ? 'opponentTeam' : 'myTeam';
}

function rotateTeamScores(
  scores: Record<TeamId, number>,
  viewerSeat: Seat
): Record<TeamId, number> {
  const viewerCanonicalTeam = getTeamForSeat(viewerSeat);
  if (viewerCanonicalTeam === 'myTeam') {
    return { myTeam: scores.myTeam, opponentTeam: scores.opponentTeam };
  }
  return { myTeam: scores.opponentTeam, opponentTeam: scores.myTeam };
}

function rotateSeatCounts(
  counts: Record<Seat, number>,
  viewerSeat: Seat
): Record<Seat, number> {
  const rotated: Record<Seat, number> = {
    south: 0,
    east: 0,
    north: 0,
    west: 0,
  };
  for (const canonicalSeat of COUNTER_CLOCKWISE_ORDER) {
    const visualSeat = rotateSeatForViewer(canonicalSeat, viewerSeat);
    rotated[visualSeat] = counts[canonicalSeat];
  }
  return rotated;
}

/**
 * Projects the authoritative server `HokmState` into a strictly sanitized,
 * viewer-specific `ProjectedHokmState`.
 *
 * SECURITY BOUNDARY:
 * - Only `state.hands[viewerSeat]` is serialized into `myHand`.
 * - Other players' cards and `state.deck` are NEVER included anywhere in the output.
 * - `currentTrick` only ever contains cards validly played onto the table.
 */
export function projectStateForViewer(
  state: HokmState,
  viewerSeat: Seat
): ProjectedHokmState {
  const handCounts: Record<Seat, number> = {
    south: 0,
    east: 0,
    north: 0,
    west: 0,
  };
  for (const canonicalSeat of COUNTER_CLOCKWISE_ORDER) {
    const visualSeat = rotateSeatForViewer(canonicalSeat, viewerSeat);
    handCounts[visualSeat] = state.hands[canonicalSeat].length;
  }

  // Sort the viewer's own hand cleanly with trump first (if chosen)
  const myHand = sortHand(state.hands[viewerSeat], state.trumpSuit);

  const currentTrick = state.currentTrick.map((play) => ({
    seat: rotateSeatForViewer(play.seat, viewerSeat),
    card: play.card,
  }));

  let lastCompletedTrick: CompletedTrick | null = null;
  if (state.lastCompletedTrick) {
    lastCompletedTrick = {
      trickNumber: state.lastCompletedTrick.trickNumber,
      leadSeat: rotateSeatForViewer(state.lastCompletedTrick.leadSeat, viewerSeat),
      leadSuit: state.lastCompletedTrick.leadSuit,
      plays: state.lastCompletedTrick.plays.map((p) => ({
        seat: rotateSeatForViewer(p.seat, viewerSeat),
        card: p.card,
      })),
      winnerSeat: rotateSeatForViewer(
        state.lastCompletedTrick.winnerSeat,
        viewerSeat
      ),
      winnerTeam: rotateTeamForViewer(
        state.lastCompletedTrick.winnerTeam,
        viewerSeat
      ),
    };
  }

  let handOutcome: HandOutcome | null = null;
  if (state.handOutcome) {
    handOutcome = {
      winningTeam: rotateTeamForViewer(state.handOutcome.winningTeam, viewerSeat),
      winType: state.handOutcome.winType,
      pointsAwarded: state.handOutcome.pointsAwarded,
      finalTricks: rotateTeamScores(state.handOutcome.finalTricks, viewerSeat),
      hakem: rotateSeatForViewer(state.handOutcome.hakem, viewerSeat),
      hakemTeam: rotateTeamForViewer(state.handOutcome.hakemTeam, viewerSeat),
      trumpSuit: state.handOutcome.trumpSuit,
    };
  }

  return {
    phase: state.phase,
    handNumber: state.handNumber,
    targetMatchScore: state.targetMatchScore,
    matchScores: rotateTeamScores(state.matchScores, viewerSeat),
    trickCounts: rotateTeamScores(state.trickCounts, viewerSeat),
    wonTricksBySeat: rotateSeatCounts(state.wonTricksBySeat, viewerSeat),
    hakem: rotateSeatForViewer(state.hakem, viewerSeat),
    trumpSuit: state.trumpSuit,
    deckCount: state.deck.length,
    myHand,
    handCounts,
    currentTurn: rotateSeatForViewer(state.currentTurn, viewerSeat),
    trickLeadSeat: rotateSeatForViewer(state.trickLeadSeat, viewerSeat),
    currentTrick,
    lastCompletedTrick,
    completedTricksCount: state.completedTricksCount,
    handOutcome,
    matchWinner: state.matchWinner
      ? rotateTeamForViewer(state.matchWinner, viewerSeat)
      : null,
  };
}

/**
 * Adapts a sanitized `ProjectedHokmState` into the `HokmState` shape expected by
 * the Phase 1 `HokmTable` component (leaving opponent hands empty & deck empty,
 * since `HokmTable` renders opponent hands strictly via `visibleHandCounts`).
 */
export function projectedToTableState(projected: ProjectedHokmState): HokmState {
  return {
    phase: projected.phase,
    handNumber: projected.handNumber,
    targetMatchScore: projected.targetMatchScore,
    matchScores: projected.matchScores,
    trickCounts: projected.trickCounts,
    wonTricksBySeat: projected.wonTricksBySeat,
    hakem: projected.hakem,
    trumpSuit: projected.trumpSuit,
    deck: [],
    hands: {
      south: projected.myHand,
      east: [],
      north: [],
      west: [],
    },
    currentTurn: projected.currentTurn,
    trickLeadSeat: projected.trickLeadSeat,
    currentTrick: projected.currentTrick,
    lastCompletedTrick: projected.lastCompletedTrick,
    completedTricksCount: projected.completedTricksCount,
    handOutcome: projected.handOutcome,
    matchWinner: projected.matchWinner,
  };
}
