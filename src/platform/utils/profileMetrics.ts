import { AuthUserSummary } from '../auth/authClient';
import { UserProfile } from '../types/platform';

export interface AvatarOptionMeta {
  readonly code: UserProfile['avatarCode'];
  readonly label: string;
  readonly caption: string;
}

export const PROFILE_AVATAR_OPTIONS: readonly AvatarOptionMeta[] = [
  { code: 'portrait', label: 'نگاره پیش‌فرض', caption: 'تصویر کلاسیک' },
  { code: 'shamsa', label: 'شمسه لاجوردی', caption: 'نشان هندسی' },
  { code: 'turquoise', label: 'کاشی فیروزه‌ای', caption: 'فیروزه نیشابور' },
  { code: 'jade', label: 'سرو یشمی', caption: 'زمرد و طلا' },
  { code: 'lapis', label: 'لاجورد شبستان', caption: 'سرمه‌ای و فیروزه' },
] as const;

export interface XpProgressMetrics {
  readonly currentXp: number;
  readonly targetXp: number;
  readonly percent: number;
  readonly remainingXp: number;
}

/**
 * Safely computes level progress percentage, clamping invalid, zero, or negative
 * denominators cleanly to [0, 100].
 */
export function computeXpProgress(
  xp: number,
  xpToNextLevel: number
): XpProgressMetrics {
  const safeCurrent = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  const safeTarget =
    Number.isFinite(xpToNextLevel) && xpToNextLevel > 0
      ? Math.floor(xpToNextLevel)
      : 100;

  const rawPct = Math.round((safeCurrent / safeTarget) * 100);
  const percent = Math.max(0, Math.min(100, rawPct));
  const remainingXp = Math.max(0, safeTarget - safeCurrent);

  return {
    currentXp: safeCurrent,
    targetXp: safeTarget,
    percent,
    remainingXp,
  };
}

export interface WinRateSummary {
  readonly hasGames: boolean;
  readonly gamesPlayed: number;
  readonly wins: number;
  readonly losses: number;
  readonly rating: number;
  readonly winRatePct: number | null;
  readonly emptyLabel: string | null;
}

/**
 * Computes real match summary without inventing a misleading 0% win rate when zero
 * games have been played.
 */
export function computeWinRateSummary(
  stats: UserProfile['stats']
): WinRateSummary {
  const gamesPlayed =
    Number.isFinite(stats.gamesPlayed) && stats.gamesPlayed > 0
      ? Math.floor(stats.gamesPlayed)
      : 0;
  const wins =
    Number.isFinite(stats.wins) && stats.wins > 0
      ? Math.min(gamesPlayed, Math.floor(stats.wins))
      : 0;
  const losses =
    Number.isFinite(stats.losses) && stats.losses > 0
      ? Math.floor(stats.losses)
      : 0;
  const rating = Number.isFinite(stats.rating) ? Math.round(stats.rating) : 1000;

  if (gamesPlayed === 0) {
    return {
      hasGames: false,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      rating,
      winRatePct: null,
      emptyLabel: 'هنوز بازی‌ای ثبت نشده',
    };
  }

  const winRatePct = Math.max(
    0,
    Math.min(100, Math.round((wins / gamesPlayed) * 100))
  );

  return {
    hasGames: true,
    gamesPlayed,
    wins,
    losses,
    rating,
    winRatePct,
    emptyLabel: null,
  };
}

export function normalizeAvatarCode(
  code: string | undefined | null
): UserProfile['avatarCode'] {
  if (
    code === 'portrait' ||
    code === 'shamsa' ||
    code === 'turquoise' ||
    code === 'jade' ||
    code === 'lapis'
  ) {
    return code;
  }
  return 'portrait';
}

/**
 * Updates guest/local display username & avatar while keeping the persistent `id`
 * strictly immutable (username and persistent user ID are never conflated).
 */
export function applyLocalProfileEdit(
  prev: UserProfile,
  nextUsername: string,
  nextAvatarCode: UserProfile['avatarCode'],
  nextBio?: string
): UserProfile {
  return {
    ...prev,
    id: prev.id,
    username: nextUsername.trim(),
    avatarCode: normalizeAvatarCode(nextAvatarCode),
    ...(nextBio !== undefined ? { bio: nextBio.trim() } : {}),
  };
}

/**
 * Hydrates UI profile state from a server-verified central user record without
 * mutating `userId`.
 */
export function applyServerProfileUpdate(
  prev: UserProfile,
  serverUser: AuthUserSummary
): UserProfile {
  return {
    ...prev,
    id: serverUser.userId,
    accountCode: serverUser.accountCode ?? prev.accountCode ?? null,
    username: serverUser.username,
    bio: typeof serverUser.bio === 'string' ? serverUser.bio : prev.bio ?? '',
    avatarCode: normalizeAvatarCode(serverUser.avatarCode),
  };
}
