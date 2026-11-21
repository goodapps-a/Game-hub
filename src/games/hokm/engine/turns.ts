import { Seat, TeamId } from './types';

/**
 * Strictly counter-clockwise order starting from South (main player):
 * south (bottom) -> east (right) -> north (top) -> west (left) -> south
 */
export const COUNTER_CLOCKWISE_ORDER: readonly Seat[] = [
  'south',
  'east',
  'north',
  'west',
];

/**
 * Returns the next seat in strict counter-clockwise order.
 */
export function getNextSeat(seat: Seat): Seat {
  const index = COUNTER_CLOCKWISE_ORDER.indexOf(seat);
  if (index === -1) {
    throw new Error(`Invalid seat: ${String(seat)}`);
  }
  return COUNTER_CLOCKWISE_ORDER[(index + 1) % COUNTER_CLOCKWISE_ORDER.length];
}

/**
 * Returns all 4 seats in counter-clockwise order starting from `startSeat`.
 */
export function getDealOrderFrom(startSeat: Seat): Seat[] {
  const result: Seat[] = [];
  let cursor = startSeat;
  for (let i = 0; i < 4; i++) {
    result.push(cursor);
    cursor = getNextSeat(cursor);
  }
  return result;
}

/**
 * Opposite seats are partners:
 * - myTeam: south & north
 * - opponentTeam: east & west
 */
export function getTeamForSeat(seat: Seat): TeamId {
  return seat === 'south' || seat === 'north' ? 'myTeam' : 'opponentTeam';
}

export function getPartnerSeat(seat: Seat): Seat {
  switch (seat) {
    case 'south':
      return 'north';
    case 'north':
      return 'south';
    case 'east':
      return 'west';
    case 'west':
      return 'east';
  }
}

export function getOpposingTeam(team: TeamId): TeamId {
  return team === 'myTeam' ? 'opponentTeam' : 'myTeam';
}
