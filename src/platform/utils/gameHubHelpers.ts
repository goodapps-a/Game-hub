import { GameId, ShopItem } from '../types/platform';

export type HokmMatchVariantId = 'quick_3' | 'classic_7' | 'single_1';
export type HokmOpponentMode = 'random' | 'friends' | 'offline';
export type GameHubTabId = 'play' | 'rules' | 'leaderboard' | 'shop';
export type HokmShopSubFilter =
  | 'all'
  | 'card_decks'
  | 'card_backs'
  | 'table_themes'
  | 'visual_effects';

export interface HokmMatchVariant {
  id: HokmMatchVariantId;
  title: string;
  targetScore: number;
  handsLabel: string;
  durationLabel: string;
  summary: string;
  recommended?: boolean;
}

export const HOKM_MATCH_VARIANTS: readonly HokmMatchVariant[] = [
  {
    id: 'quick_3',
    title: 'حکم سریع',
    targetScore: 3,
    handsLabel: 'تا ۳ امتیاز',
    durationLabel: 'حدود ۵ دقیقه',
    summary: 'مسابقه کوتاه و پرهیجان، مناسب بازی فوری',
    recommended: true,
  },
  {
    id: 'classic_7',
    title: 'حکم کلاسیک',
    targetScore: 7,
    handsLabel: 'تا ۷ امتیاز',
    durationLabel: 'حدود ۱۲ دقیقه',
    summary: 'قوانین کامل و سنتی حکم چهارنفره',
  },
  {
    id: 'single_1',
    title: 'تک‌دست فوری',
    targetScore: 1,
    handsLabel: '۱ دست',
    durationLabel: 'حدود ۲ دقیقه',
    summary: 'یک دست سریع برای رقابت آنی',
  },
] as const;

export function getHokmVariantById(id: HokmMatchVariantId): HokmMatchVariant {
  return (
    HOKM_MATCH_VARIANTS.find((v) => v.id === id) ?? HOKM_MATCH_VARIANTS[0]
  );
}

const HOKM_RELEVANT_SECTIONS = new Set<ShopItem['section']>([
  'card_decks',
  'card_backs',
  'table_themes',
  'visual_effects',
]);

const HOKM_DAILY_DEAL_IDS = new Set<string>([
  'dd-ruby-shamsa',
  'dd-kot-aura',
]);

/**
 * Returns cosmetic shop items directly relevant to the selected game.
 * For Hokm: card backs, table themes, Hokm visual effects, and Hokm-specific daily deals.
 */
export function filterShopItemsForGame(
  items: readonly ShopItem[],
  gameId: GameId,
  subFilter: HokmShopSubFilter = 'all'
): ShopItem[] {
  if (gameId !== 'hokm') return [];

  const hokmItems = items.filter(
    (item) =>
      HOKM_RELEVANT_SECTIONS.has(item.section) ||
      HOKM_DAILY_DEAL_IDS.has(item.id)
  );

  if (subFilter === 'all') {
    return hokmItems;
  }

  return hokmItems.filter((item) => {
    if (item.section === subFilter) return true;
    if (subFilter === 'card_backs' && item.id === 'dd-ruby-shamsa') return true;
    if (subFilter === 'visual_effects' && item.id === 'dd-kot-aura') return true;
    return false;
  });
}

export interface PasswordStrengthSummary {
  score: 0 | 1 | 2 | 3;
  label: string;
  hasMinLength: boolean;
  hasLetter: boolean;
  hasNumber: boolean;
  isValid: boolean;
}

/**
 * Evaluates password strength strictly aligned with Eyvan backend rules
 * (minimum 8 characters, at least one letter and one digit).
 */
export function computePasswordStrength(password: string): PasswordStrengthSummary {
  const hasMinLength = password.length >= 8;
  const hasLetter = /[A-Za-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasStrongBonus =
    password.length >= 12 || /[^A-Za-z0-9]/.test(password);

  if (password.length === 0) {
    return {
      score: 0,
      label: '',
      hasMinLength: false,
      hasLetter: false,
      hasNumber: false,
      isValid: false,
    };
  }

  const isValid = hasMinLength && hasLetter && hasNumber;
  if (!isValid) {
    return {
      score: 1,
      label: 'ضعیف',
      hasMinLength,
      hasLetter,
      hasNumber,
      isValid: false,
    };
  }

  if (hasStrongBonus) {
    return {
      score: 3,
      label: 'قوی',
      hasMinLength,
      hasLetter,
      hasNumber,
      isValid: true,
    };
  }

  return {
    score: 2,
    label: 'مناسب',
    hasMinLength,
    hasLetter,
    hasNumber,
    isValid: true,
  };
}

export interface RawLeaderboardRow {
  userId: string;
  username: string;
  avatarCode: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  kotWins: number;
  hakemKotWins: number;
  lastPlayedAt: number | null;
}

export interface RankedLeaderboardEntry extends RawLeaderboardRow {
  rank: number;
  winRatePct: number;
  scorePoints: number;
}

/**
 * Normalizes and ranks Hokm leaderboard entries deterministically.
 */
export function rankLeaderboardEntries(
  rows: readonly RawLeaderboardRow[]
): RankedLeaderboardEntry[] {
  const valid = rows
    .filter((r) => Number.isFinite(r.matchesPlayed) && r.matchesPlayed > 0)
    .map((r) => {
      const wins = Math.max(0, Math.floor(r.wins));
      const losses = Math.max(0, Math.floor(r.losses));
      const matchesPlayed = Math.max(wins + losses, Math.floor(r.matchesPlayed));
      const kotWins = Math.max(0, Math.floor(r.kotWins));
      const hakemKotWins = Math.max(0, Math.floor(r.hakemKotWins));
      const winRatePct =
        matchesPlayed > 0
          ? Math.max(0, Math.min(100, Math.round((wins / matchesPlayed) * 100)))
          : 0;
      const scorePoints = wins * 3 + kotWins * 2 + hakemKotWins * 3;
      return {
        ...r,
        matchesPlayed,
        wins,
        losses,
        kotWins,
        hakemKotWins,
        winRatePct,
        scorePoints,
      };
    });

  valid.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.scorePoints !== a.scorePoints) return b.scorePoints - a.scorePoints;
    if (b.winRatePct !== a.winRatePct) return b.winRatePct - a.winRatePct;
    return b.matchesPlayed - a.matchesPlayed;
  });

  return valid.map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));
}
