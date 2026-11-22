import { ThemeMode, UserProfile } from '../types/platform';

export interface UsernameValidationResult {
  valid: boolean;
  reason?: 'format' | 'duplicate';
  message?: string;
  suggestions: string[];
}

const ENGLISH_USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;

/**
 * Pure client-side format validation for usernames.
 * Contains ZERO hardcoded taken usernames — authoritative uniqueness is checked
 * strictly on the backend database in Stage C+.
 */
export function validateUsernameFormat(rawInput: string): UsernameValidationResult {
  const cleaned = rawInput.trim();
  if (
    !ENGLISH_USERNAME_RE.test(cleaned) ||
    !/[a-zA-Z]/.test(cleaned) ||
    cleaned.startsWith('.') ||
    cleaned.endsWith('.') ||
    cleaned.startsWith('_') ||
    cleaned.endsWith('_') ||
    cleaned.includes('..') ||
    cleaned.includes('__')
  ) {
    return {
      valid: false,
      reason: 'format',
      message:
        'نام کاربری باید بین ۳ تا ۲۰ کاراکتر انگلیسی (حروف، عدد، زیرخط یا نقطه) باشد، با نقطه یا زیرخط شروع/ختم نشود و حداقل یک حرف انگلیسی داشته باشد.',
      suggestions: [],
    };
  }
  return { valid: true, suggestions: [] };
}

/**
 * Neutral default profile for an unauthenticated guest session before Stage C
 * wires server-backed account hydration. Contains zero demo stats, demo users,
 * or fabricated balances.
 */
export function createInitialGuestProfile(themeMode: ThemeMode): UserProfile {
  return {
    id: 'guest_player',
    username: 'guest_player',
    avatarCode: 'portrait',
    level: 1,
    xp: 0,
    xpToNextLevel: 100,
    coins: 0,
    gems: 0,
    stats: {
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      rating: 1000,
    },
    accountSettings: {
      showOnlineStatus: true,
      allowFriendRequests: true,
      compactProfileStats: false,
    },
    appSettings: {
      soundEnabled: true,
      animationSpeed: 'normal',
      reducedMotion: false,
      themeMode,
    },
  };
}
