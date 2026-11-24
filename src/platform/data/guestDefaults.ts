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

const GUEST_NUMERIC_CODE_KEY = 'eyvan_guest_numeric_code_v1';

export function getOrCreateGuestNumericCode(): string {
  if (typeof window === 'undefined') {
    return '100000';
  }
  try {
    const existing = window.localStorage.getItem(GUEST_NUMERIC_CODE_KEY);
    if (existing && /^\d{6}$/.test(existing)) {
      return existing;
    }
  } catch {
    // Ignore storage restriction
  }

  let num = Math.floor(100000 + Math.random() * 900000);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    num = 100000 + (buf[0] % 900000);
  }
  const code = String(num);
  try {
    window.localStorage.setItem(GUEST_NUMERIC_CODE_KEY, code);
  } catch {
    // Ignore storage restriction
  }
  return code;
}

const COSMETICS_STORAGE_KEY = 'eyvan_local_cosmetics_v1';

export interface LocalCosmeticPreferences {
  bannerCode?: UserProfile['bannerCode'];
  customAvatarUrl?: string | null;
  customBannerUrl?: string | null;
  bio?: string;
  equippedTableSkinId?: string;
  equippedDeckId?: string;
  equippedCardBackId?: string;
  equippedAvatarFrameId?: string;
  equippedBadgeId?: string;
  equippedNameplateId?: string;
  equippedGameEffectId?: string;
  equippedTableBackgroundId?: string;
  ownedShopItemIds?: string[];
  coins?: number;
  gems?: number;
}

export const DEFAULT_OWNED_SHOP_IDS: readonly string[] = [
  'cb-shamsa',
  'tt-traditional',
  'af-banner-royal',
  'deck-eyvan-classic',
];

function isSafeDataImageUrl(val: unknown): val is string {
  return (
    typeof val === 'string' &&
    val.length <= 450_000 &&
    /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(val)
  );
}

function isValidItemId(val: unknown): val is string {
  return typeof val === 'string' && /^[a-z0-9][a-z0-9._-]{1,60}$/i.test(val);
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
    if (typeof parsed.bio === 'string' && parsed.bio.length <= 160) {
      out.bio = parsed.bio;
    }
    if (isValidItemId(parsed.equippedTableSkinId)) {
      out.equippedTableSkinId = parsed.equippedTableSkinId;
    }
    if (isValidItemId(parsed.equippedDeckId)) {
      out.equippedDeckId = parsed.equippedDeckId;
    }
    if (isValidItemId(parsed.equippedCardBackId)) {
      out.equippedCardBackId = parsed.equippedCardBackId;
    }
    if (isValidItemId(parsed.equippedAvatarFrameId)) {
      out.equippedAvatarFrameId = parsed.equippedAvatarFrameId;
    }
    if (isValidItemId(parsed.equippedBadgeId)) {
      out.equippedBadgeId = parsed.equippedBadgeId;
    }
    if (isValidItemId(parsed.equippedNameplateId)) {
      out.equippedNameplateId = parsed.equippedNameplateId;
    }
    if (isValidItemId(parsed.equippedGameEffectId)) {
      out.equippedGameEffectId = parsed.equippedGameEffectId;
    }
    if (isValidItemId(parsed.equippedTableBackgroundId)) {
      out.equippedTableBackgroundId = parsed.equippedTableBackgroundId;
    }
    if (Array.isArray(parsed.ownedShopItemIds)) {
      const validIds = parsed.ownedShopItemIds.filter(
        (id): id is string => typeof id === 'string' && id.length <= 64
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

const AUDIO_PREFS_STORAGE_KEY = 'eyvan_audio_prefs_v1';

export interface LocalAudioPrefs {
  musicEnabled: boolean;
  sfxEnabled: boolean;
}

export function loadLocalAudioPrefs(): LocalAudioPrefs {
  if (typeof window === 'undefined') {
    return { musicEnabled: true, sfxEnabled: true };
  }
  try {
    const raw = window.localStorage.getItem(AUDIO_PREFS_STORAGE_KEY);
    if (!raw) return { musicEnabled: true, sfxEnabled: true };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      musicEnabled:
        typeof parsed.musicEnabled === 'boolean' ? parsed.musicEnabled : true,
      sfxEnabled:
        typeof parsed.sfxEnabled === 'boolean' ? parsed.sfxEnabled : true,
    };
  } catch {
    return { musicEnabled: true, sfxEnabled: true };
  }
}

export function saveLocalAudioPrefs(prefs: LocalAudioPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUDIO_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage restriction errors
  }
}

/**
 * Neutral default profile for an unauthenticated guest session with a random guest ID.
 * Guests start with 0 coins & 0 gems and can immediately play Hokm; server-persisted
 * purchases/inventory require an Eyvan account (with free Test Mode preview/claim).
 */
export function createInitialGuestProfile(themeMode: ThemeMode): UserProfile {
  const guestId = getOrCreateRandomGuestId();
  const cosmetics = loadLocalCosmetics();
  const equippedDeckId = cosmetics.equippedDeckId ?? 'eyvan-classic';
  const equippedTableSkinId = cosmetics.equippedTableSkinId ?? 'tt-traditional';
  const equippedCardBackId = cosmetics.equippedCardBackId ?? 'cb-shamsa';
  const bannerItemId =
    cosmetics.bannerCode === 'garden'
      ? 'af-banner-garden'
      : cosmetics.bannerCode === 'ruby'
        ? 'af-banner-ruby'
        : cosmetics.bannerCode === 'none'
          ? undefined
          : 'af-banner-royal';

  return {
    id: guestId,
    accountCode: getOrCreateGuestNumericCode(),
    username: guestId,
    bio: cosmetics.bio ?? '',
    avatarCode: 'portrait',
    customAvatarUrl: cosmetics.customAvatarUrl ?? null,
    bannerCode: cosmetics.bannerCode ?? 'royal',
    customBannerUrl: null,
    equippedTableSkinId,
    equippedDeckId,
    equippedCardBackId,
    equippedAvatarFrameId: cosmetics.equippedAvatarFrameId,
    equippedBadgeId: cosmetics.equippedBadgeId,
    equippedNameplateId: cosmetics.equippedNameplateId,
    equippedGameEffectId: cosmetics.equippedGameEffectId,
    equippedSlots: {
      card_deck: equippedDeckId === 'eyvan-classic' ? 'deck-eyvan-classic' : `deck-${equippedDeckId}`,
      card_back: equippedCardBackId,
      table_skin: equippedTableSkinId,
      ...(bannerItemId ? { banner: bannerItemId } : {}),
      ...(cosmetics.equippedAvatarFrameId ? { avatar_frame: cosmetics.equippedAvatarFrameId } : {}),
      ...(cosmetics.equippedBadgeId ? { profile_badge: cosmetics.equippedBadgeId } : {}),
      ...(cosmetics.equippedNameplateId ? { nameplate: cosmetics.equippedNameplateId } : {}),
      ...(cosmetics.equippedGameEffectId ? { game_effect: cosmetics.equippedGameEffectId } : {}),
    },
    ownedShopItemIds: cosmetics.ownedShopItemIds ?? [...DEFAULT_OWNED_SHOP_IDS],
    level: 1,
    xp: 0,
    xpToNextLevel: 100,
    coins: cosmetics.coins ?? 0,
    gems: cosmetics.gems ?? 0,
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
      soundEnabled: loadLocalAudioPrefs().sfxEnabled,
      musicEnabled: loadLocalAudioPrefs().musicEnabled,
      sfxEnabled: loadLocalAudioPrefs().sfxEnabled,
      animationSpeed: 'normal',
      reducedMotion: false,
      themeMode,
    },
  };
}
