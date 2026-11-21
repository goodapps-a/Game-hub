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

export interface UserProfile {
  /** Unique English username acts as the player's sole ID across the platform */
  id: string;
  username: string;
  avatarCode: 'portrait' | 'shamsa' | 'turquoise' | 'lapis' | 'jade';
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
    animationSpeed: AnimationSpeed;
    reducedMotion: boolean;
    themeMode: ThemeMode;
  };
}

export type ShopRarity = 'common' | 'rare' | 'epic' | 'legendary';

export type ShopSectionId =
  | 'daily_deals'
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
}
