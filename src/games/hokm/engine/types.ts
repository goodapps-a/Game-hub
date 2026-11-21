export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';

export type Rank =
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '10'
  | 'J'
  | 'Q'
  | 'K'
  | 'A';

/**
 * Seat positions around the table:
 * - south: Main player (bottom)
 * - east: Opponent 1 (right)
 * - north: Partner (top)
 * - west: Opponent 2 (left)
 */
export type Seat = 'south' | 'east' | 'north' | 'west';

export type TeamId = 'myTeam' | 'opponentTeam';

export interface Card {
  readonly id: string; // e.g., "hearts-A"
  readonly suit: Suit;
  readonly rank: Rank;
  readonly power: number; // 2..14 (A = 14)
}

export interface TrickPlay {
  readonly seat: Seat;
  readonly card: Card;
}

export type HandWinType = 'normal' | 'kot' | 'hakem_kot';

export interface HandOutcome {
  readonly winningTeam: TeamId;
  readonly winType: HandWinType;
  readonly pointsAwarded: number;
  readonly finalTricks: Record<TeamId, number>;
  readonly hakem: Seat;
  readonly hakemTeam: TeamId;
  readonly trumpSuit: Suit;
}

export interface CompletedTrick {
  readonly trickNumber: number;
  readonly leadSeat: Seat;
  readonly leadSuit: Suit;
  readonly plays: readonly TrickPlay[];
  readonly winnerSeat: Seat;
  readonly winnerTeam: TeamId;
}

export type HokmPhase =
  | 'IDLE'
  | 'SHUFFLING'
  | 'DEALING_INITIAL_5'
  | 'CHOOSING_TRUMP'
  | 'DEALING_REMAINING_8'
  | 'PLAYING_TRICK'
  | 'TRICK_COMPLETE'
  | 'HAND_COMPLETE'
  | 'MATCH_COMPLETE';

export interface PlayerInfo {
  readonly seat: Seat;
  readonly name: string;
  readonly roleLabel: string;
  readonly team: TeamId;
  readonly isHuman: boolean;
  readonly avatarInitials: string;
  readonly avatarSrc: string;
  readonly accentColor: string;
}

export interface HokmState {
  readonly phase: HokmPhase;
  readonly handNumber: number;
  readonly targetMatchScore: number;
  readonly matchScores: Record<TeamId, number>;
  readonly trickCounts: Record<TeamId, number>;
  readonly wonTricksBySeat: Record<Seat, number>;
  readonly hakem: Seat;
  readonly trumpSuit: Suit | null;
  readonly deck: readonly Card[];
  readonly hands: Record<Seat, readonly Card[]>;
  readonly currentTurn: Seat;
  readonly trickLeadSeat: Seat;
  readonly currentTrick: readonly TrickPlay[];
  readonly lastCompletedTrick: CompletedTrick | null;
  readonly completedTricksCount: number;
  readonly handOutcome: HandOutcome | null;
  readonly matchWinner: TeamId | null;
}

export const HOKM_CONFIG = {
  /** Default match target score (first team to 3 hands wins the match) */
  DEFAULT_MATCH_TARGET_SCORE: 3,
  /** Tricks required to win a hand immediately */
  TRICKS_TO_WIN_HAND: 7,
  /** Initial cards dealt before trump selection (5 cards each) */
  INITIAL_DEAL_COUNT: 5,
  /** Second wave dealt after trump selection (4 cards each) */
  SECOND_DEAL_COUNT: 4,
  /** Third and final wave dealt after second wave (4 cards each) */
  THIRD_DEAL_COUNT: 4,
  /** Remaining cards dealt after trump selection (4 + 4 = 8) */
  REMAINING_DEAL_COUNT: 8,
  /** Total cards per player (5 + 4 + 4 = 13) */
  CARDS_PER_PLAYER: 13,
  /** Total cards in standard deck */
  STANDARD_DECK_SIZE: 52,
} as const;

export const SUITS: readonly Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];

export const RANKS: readonly Rank[] = [
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
  'A',
];

export const RANK_POWER: Record<Rank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export const SUIT_META: Record<
  Suit,
  { faName: string; symbol: string; isRed: boolean; color: string }
> = {
  hearts: { faName: 'دل', symbol: '♥', isRed: true, color: '#B83232' },
  diamonds: { faName: 'خشت', symbol: '♦', isRed: true, color: '#B83232' },
  clubs: { faName: 'گشنیز', symbol: '♣', isRed: false, color: '#13294B' },
  spades: { faName: 'پیک', symbol: '♠', isRed: false, color: '#13294B' },
};

export const RANK_META: Record<Rank, { label: string; faName: string }> = {
  A: { label: 'A', faName: 'آس' },
  K: { label: 'K', faName: 'شاه' },
  Q: { label: 'Q', faName: 'بی‌بی' },
  J: { label: 'J', faName: 'سرباز' },
  '10': { label: '10', faName: '۱۰' },
  '9': { label: '9', faName: '۹' },
  '8': { label: '8', faName: '۸' },
  '7': { label: '7', faName: '۷' },
  '6': { label: '6', faName: '۶' },
  '5': { label: '5', faName: '۵' },
  '4': { label: '4', faName: '۴' },
  '3': { label: '3', faName: '۳' },
  '2': { label: '2', faName: '۲' },
};

export const DEFAULT_PLAYERS: Record<Seat, PlayerInfo> = {
  south: {
    seat: 'south',
    name: 'amir_rad',
    roleLabel: 'بازیکن اصلی',
    team: 'myTeam',
    isHuman: true,
    avatarInitials: 'A',
    avatarSrc: '/src/assets/images/user_avatar_portrait_1795183077837.jpg',
    accentColor: '#148A8A',
  },
  east: {
    seat: 'east',
    name: 'sohrab_k',
    roleLabel: 'رقیب اول',
    team: 'opponentTeam',
    isHuman: false,
    avatarInitials: 'S',
    avatarSrc: '/src/assets/images/avatar_sohrab_1795191911310.jpg',
    accentColor: '#B83232',
  },
  north: {
    seat: 'north',
    name: 'parvin_sh',
    roleLabel: 'یار شما',
    team: 'myTeam',
    isHuman: false,
    avatarInitials: 'P',
    avatarSrc: '/src/assets/images/avatar_parvin_1795191910008.jpg',
    accentColor: '#1A6B54',
  },
  west: {
    seat: 'west',
    name: 'farhad_n',
    roleLabel: 'رقیب دوم',
    team: 'opponentTeam',
    isHuman: false,
    avatarInitials: 'F',
    avatarSrc: '/src/assets/images/avatar_farhad_1795191910041.jpg',
    accentColor: '#8B5A2B',
  },
};
