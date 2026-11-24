import { AnimationSpeed } from '../theme/tokens';

/**
 * 3 clean platform navigation tabs (visually ordered Left-to-Right):
 * 1. shop (فروشگاه)
 * 2. games (بازی‌ها) — Center & primary tab
 * 3. friends (دوستان)
 */
export type PlatformTabId = 'shop' | 'games' | 'friends';

export type GameId = 'hokm' | 'chess' | 'backgammon' | 'ludo' | 'pasoor';

export type ThemeMode = 'dark' | 'light';

export type ProfileBannerCode = 'royal' | 'garden' | 'ruby' | 'none';

export interface UserProfile {
  /** Unique English username acts as the player's sole ID across the platform */
  id: string;
  /** Public 6-digit random account identifier for logged-in accounts */
  accountCode?: string | null;
  username: string;
  bio?: string;
  avatarCode: 'portrait' | 'shamsa' | 'turquoise' | 'lapis' | 'jade';
  customAvatarUrl?: string | null;
  bannerCode?: ProfileBannerCode;
  customBannerUrl?: string | null;
  equippedTableSkinId?: string;
  equippedDeckId?: string;
  equippedCardBackId?: string;
  equippedAvatarFrameId?: string;
  equippedBadgeId?: string;
  equippedNameplateId?: string;
  equippedGameEffectId?: string;
  equippedSlots?: Partial<Record<
    | 'banner'
    | 'avatar'
    | 'avatar_frame'
    | 'profile_badge'
    | 'nameplate'
    | 'card_deck'
    | 'card_back'
    | 'game_effect'
    | 'table_skin'
    | 'table_background',
    string
  >>;
  ownedShopItemIds?: string[];
  level: number;
  xp: number;
  xpToNextLevel: number;
  coins: number;
  gems: number;
  stats: {
    gamesPlayed: number;
    wins: number;
    losses: number;
    rating: number;
  };
  accountSettings: {
    showOnlineStatus: boolean;
    allowFriendRequests: boolean;
    compactProfileStats: boolean;
  };
  appSettings: {
    soundEnabled: boolean;
    musicEnabled?: boolean;
    sfxEnabled?: boolean;
    animationSpeed: AnimationSpeed;
    reducedMotion: boolean;
    themeMode: ThemeMode;
  };
}

export type ShopRarity = 'common' | 'rare' | 'epic' | 'legendary';

export type ShopSectionId =
  | 'toman_topup'
  | 'daily_deals'
  | 'card_decks'
  | 'card_backs'
  | 'table_themes'
  | 'avatars_frames'
  | 'visual_effects'
  | 'chests';

export interface ShopSectionMeta {
  id: ShopSectionId;
  title: string;
  subtitle: string;
  accentColor: string;
  badge?: string;
}

export interface ShopItem {
  id: string;
  section: ShopSectionId;
  name: string;
  subtitle: string;
  description: string;
  price: number;
  currency: 'coins' | 'gems';
  rarity: ShopRarity;
  palette: [string, string, string];
  motif: 'shamsa' | 'kashi' | 'carpet' | 'arch' | 'star' | 'cypress' | 'chest';
  imageSrc?: string;
  imageCropScale?: boolean;
  badge?: string;
  isDefaultOwned?: boolean;
}

export interface FriendDemo {
  id: string;
  /** Unique English username (also serves as player ID) */
  username: string;
  level: number;
  status: 'online' | 'offline';
  avatarColor: string;
  avatarSrc?: string;
  initials: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
}

export interface ChatGroupDemo {
  id: string;
  name: string;
  members: string[];
  onlineCount: number;
  accentColor: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
}

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  time: string;
  isMe?: boolean;
  isGameInvite?: boolean;
}

export interface GameModuleDescriptor {
  id: GameId;
  name: string;
  englishName: string;
  subtitle: string;
  playersLabel: string;
  durationLabel: string;
  available: boolean;
  accentColor: string;
  bgTint: string;
  artworkSrc: string;
  readonly lightArtworkSrc?: string;
}
