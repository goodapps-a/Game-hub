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

const GUEST_ID_STORAGE_KEY = 'eyvan_guest_id';

export function getOrCreateRandomGuestId(): string {
  if (typeof window === 'undefined') {
    return 'guest_player';
  }
  try {
    const existing = window.localStorage.getItem(GUEST_ID_STORAGE_KEY);
    if (existing && /^guest_[0-9]{4,6}$/.test(existing)) {
      return existing;
    }
  } catch {
    // Ignore storage access restriction
  }

  let num = Math.floor(10000 + Math.random() * 90000);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    num = 10000 + (buf[0] % 90000);
  }
  const generated = `guest_${num}`;

  try {
    window.localStorage.setItem(GUEST_ID_STORAGE_KEY, generated);
  } catch {
    // Ignore storage write restriction
  }
  return generated;
}

const COSMETICS_STORAGE_KEY = 'eyvan_local_cosmetics_v1';

export interface LocalCosmeticPreferences {
  bannerCode?: UserProfile['bannerCode'];
  customAvatarUrl?: string | null;
  customBannerUrl?: string | null;
  equippedTableSkinId?: string;
  equippedDeckId?: string;
  ownedShopItemIds?: string[];
  coins?: number;
  gems?: number;
}

export const DEFAULT_OWNED_SHOP_IDS: readonly string[] = [
  'cb-shamsa',
  'tt-traditional',
  'af-banner-royal',
];

function isSafeDataImageUrl(val: unknown): val is string {
  return (
    typeof val === 'string' &&
    val.length <= 450_000 &&
    /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(val)
  );
}

export function loadLocalCosmetics(): LocalCosmeticPreferences {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(COSMETICS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: LocalCosmeticPreferences = {};
    if (
      parsed.bannerCode === 'royal' ||
      parsed.bannerCode === 'garden' ||
      parsed.bannerCode === 'ruby' ||
      parsed.bannerCode === 'none'
    ) {
      out.bannerCode = parsed.bannerCode;
    }
    if (parsed.customAvatarUrl === null || isSafeDataImageUrl(parsed.customAvatarUrl)) {
      out.customAvatarUrl = parsed.customAvatarUrl;
    }
    if (parsed.customBannerUrl === null || isSafeDataImageUrl(parsed.customBannerUrl)) {
      out.customBannerUrl = parsed.customBannerUrl;
    }
    if (typeof parsed.equippedTableSkinId === 'string' && parsed.equippedTableSkinId.length <= 40) {
      out.equippedTableSkinId = parsed.equippedTableSkinId;
    }
    if (
      typeof parsed.equippedDeckId === 'string' &&
      /^[a-z0-9][a-z0-9._-]{1,60}$/i.test(parsed.equippedDeckId)
    ) {
      out.equippedDeckId = parsed.equippedDeckId;
    }
    if (Array.isArray(parsed.ownedShopItemIds)) {
      const validIds = parsed.ownedShopItemIds.filter(
        (id): id is string => typeof id === 'string' && id.length <= 40
      );
      out.ownedShopItemIds = Array.from(new Set([...DEFAULT_OWNED_SHOP_IDS, ...validIds]));
    }
    if (typeof parsed.coins === 'number' && Number.isFinite(parsed.coins) && parsed.coins >= 0) {
      out.coins = Math.floor(parsed.coins);
    }
    if (typeof parsed.gems === 'number' && Number.isFinite(parsed.gems) && parsed.gems >= 0) {
      out.gems = Math.floor(parsed.gems);
    }
    return out;
  } catch {
    return {};
  }
}

export function saveLocalCosmetics(prefs: LocalCosmeticPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    const prev = loadLocalCosmetics();
    const merged: LocalCosmeticPreferences = { ...prev, ...prefs };
    window.localStorage.setItem(COSMETICS_STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Ignore quota or storage restriction errors
  }
}

/**
 * Neutral default profile for an unauthenticated guest session with a random guest ID.
 * Guests can immediately play Hokm; purchasing from the Shop or opening Friends requires
 * registering or logging into a central Eyvan account.
 */
export function createInitialGuestProfile(themeMode: ThemeMode): UserProfile {
  const guestId = getOrCreateRandomGuestId();
  const cosmetics = loadLocalCosmetics();
  return {
    id: guestId,
    username: guestId,
    avatarCode: 'portrait',
    customAvatarUrl: cosmetics.customAvatarUrl ?? null,
    bannerCode: cosmetics.bannerCode ?? 'royal',
    customBannerUrl: cosmetics.customBannerUrl ?? null,
    equippedTableSkinId: cosmetics.equippedTableSkinId ?? 'tt-traditional',
    equippedDeckId: cosmetics.equippedDeckId ?? 'eyvan-classic',
    ownedShopItemIds: cosmetics.ownedShopItemIds ?? [...DEFAULT_OWNED_SHOP_IDS],
    level: 1,
    xp: 0,
    xpToNextLevel: 100,
    coins: cosmetics.coins ?? 2500,
    gems: cosmetics.gems ?? 120,
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
