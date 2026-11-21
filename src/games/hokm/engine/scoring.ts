import {
  HandOutcome,
  HandWinType,
  HOKM_CONFIG,
  Seat,
  Suit,
  TeamId,
} from './types';
import { getTeamForSeat } from './turns';

/**
 * Evaluates whether a hand has ended (first team to 7 tricks) and computes exact points:
 * - Normal win (loser has >= 1 trick): 1 point
 * - Kot (کُت): Hakem's team wins 7-0 -> 2 points
 * - Hakem-Kot (حاکم‌کُت): Non-Hakem team wins 7-0 (Hakem's team has 0 tricks) -> 3 points
 */
export function evaluateHandOutcome(
  trickCounts: Record<TeamId, number>,
  hakem: Seat,
  trumpSuit: Suit
): HandOutcome | null {
  const { TRICKS_TO_WIN_HAND } = HOKM_CONFIG;
  let winningTeam: TeamId | null = null;

  if (trickCounts.myTeam >= TRICKS_TO_WIN_HAND) {
    winningTeam = 'myTeam';
  } else if (trickCounts.opponentTeam >= TRICKS_TO_WIN_HAND) {
    winningTeam = 'opponentTeam';
  }

  if (!winningTeam) {
    return null;
  }

  const losingTeam: TeamId =
    winningTeam === 'myTeam' ? 'opponentTeam' : 'myTeam';
  const hakemTeam = getTeamForSeat(hakem);
  const isShutout = trickCounts[losingTeam] === 0;

  let winType: HandWinType = 'normal';
  let pointsAwarded = 1;

  if (isShutout) {
    if (winningTeam === hakemTeam) {
      winType = 'kot';
      pointsAwarded = 2;
    } else {
      winType = 'hakem_kot';
      pointsAwarded = 3;
    }
  }

  return {
    winningTeam,
    winType,
    pointsAwarded,
    finalTricks: {
      myTeam: trickCounts.myTeam,
      opponentTeam: trickCounts.opponentTeam,
    },
    hakem,
    hakemTeam,
    trumpSuit,
  };
}

export function checkMatchWinner(
  matchScores: Record<TeamId, number>,
  targetScore: number = HOKM_CONFIG.DEFAULT_MATCH_TARGET_SCORE
): TeamId | null {
  if (matchScores.myTeam >= targetScore) return 'myTeam';
  if (matchScores.opponentTeam >= targetScore) return 'opponentTeam';
  return null;
}

export function getHandWinTypeLabel(winType: HandWinType): {
  title: string;
  description: string;
} {
  switch (winType) {
    case 'hakem_kot':
      return {
        title: 'حاکم‌کُت!',
        description: 'برد قاطع ۷ بر ۰ مقابل تیم حاکم — ۳ امتیاز',
      };
    case 'kot':
      return {
        title: 'کُت!',
        description: 'برد ۷ بر ۰ توسط تیم حاکم — ۲ امتیاز',
      };
    case 'normal':
      return {
        title: 'برد عادی',
        description: 'پیروزی دست — ۱ امتیاز',
      };
  }
}
