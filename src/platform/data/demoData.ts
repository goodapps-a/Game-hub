import {
  ChatGroupDemo,
  ChatMessage,
  FriendDemo,
  ShopItem,
  ShopSectionMeta,
  UserProfile,
} from '../types/platform';

import backdropImg from '../../assets/images/opt/backdrop.jpg';
import hokmHeroImg from '../../assets/images/opt/hokm_hero.jpg';
import chessArtImg from '../../assets/images/opt/chess.jpg';
import backgammonArtImg from '../../assets/images/opt/backgammon.jpg';
import ludoArtImg from '../../assets/images/opt/ludo.jpg';
import pasoorArtImg from '../../assets/images/opt/pasoor.jpg';
import hokmTableTraditionalImg from '../../assets/images/opt/hokm_table.jpg';
import shopChestGoldImg from '../../assets/images/opt/chest_gold.jpg';
import shopChestGemImg from '../../assets/images/opt/chest_gem.jpg';

import userAvatarImg from '../../assets/images/avatars/user.jpg';
import avatarParvinImg from '../../assets/images/avatars/parvin.jpg';
import avatarSohrabImg from '../../assets/images/avatars/sohrab.jpg';
import avatarFarhadImg from '../../assets/images/avatars/farhad.jpg';
import avatarNegarImg from '../../assets/images/avatars/negar.jpg';
import avatarKeyvanImg from '../../assets/images/avatars/keyvan.jpg';

import aceSpadesCardImg from '../../assets/images/cards/ace_spades.jpg';
import kingRedCardImg from '../../assets/images/cards/king_red.jpg';
import queenRedCardImg from '../../assets/images/cards/queen_red.jpg';
import jackRedCardImg from '../../assets/images/cards/jack_red.jpg';
import kingSpadesCardImg from '../../assets/images/cards/king_spades.jpg';
import kingClubsCardImg from '../../assets/images/cards/king_clubs.jpg';
import queenBlackCardImg from '../../assets/images/cards/queen_black.jpg';
import jackSpadesCardImg from '../../assets/images/cards/jack_spades.jpg';
import jackClubsCardImg from '../../assets/images/cards/jack_clubs.jpg';

export const PLATFORM_ASSETS = {
  backdrop: backdropImg,
  hokmHero: hokmHeroImg,
  chessArt: chessArtImg,
  backgammonArt: backgammonArtImg,
  ludoArt: ludoArtImg,
  pasoorArt: pasoorArtImg,
  hokmTableTraditional: hokmTableTraditionalImg,
  shopChestGold: shopChestGoldImg,
  shopChestGem: shopChestGemImg,
  userAvatar: userAvatarImg,
  avatarParvin: avatarParvinImg,
  avatarSohrab: avatarSohrabImg,
  avatarFarhad: avatarFarhadImg,
  avatarNegar: avatarNegarImg,
  avatarKeyvan: avatarKeyvanImg,
} as const;

export const CARD_ART_ASSETS = {
  aceSpades: aceSpadesCardImg,
  kingRed: kingRedCardImg,
  queenRed: queenRedCardImg,
  jackRed: jackRedCardImg,
  kingSpades: kingSpadesCardImg,
  kingClubs: kingClubsCardImg,
  queenBlack: queenBlackCardImg,
  jackSpades: jackSpadesCardImg,
  jackClubs: jackClubsCardImg,
} as const;

/**
 * Existing platform English usernames (unique player IDs).
 * Used for local duplicate detection & similar username suggestions.
 */
export const TAKEN_USERNAMES: readonly string[] = [
  'amir_rad',
  'parvin_sh',
  'sohrab_k',
  'farhad_n',
  'negar_th',
  'arash_m',
  'sara_bh',
  'keyvan_sf',
  'maryam_kz',
  'hamed_rf',
  'dariush_n',
  'navid_ir',
  'tara_play',
  'kian_98',
  'ali_hokm',
  'reza_pro',
];

export interface UsernameValidationResult {
  valid: boolean;
  reason?: 'format' | 'duplicate';
  message?: string;
  suggestions: string[];
}

const ENGLISH_USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;

/**
 * Validates that a player username is English-only (a-z, 0-9, _, .) and unique.
 * If taken, returns 4 guaranteed-available similar username suggestions.
 */
export function validateAndSuggestUsername(
  rawInput: string,
  currentUsername: string
): UsernameValidationResult {
  const cleaned = rawInput.trim();
  const normalized = cleaned.toLowerCase();
  const currentNormalized = currentUsername.trim().toLowerCase();

  if (!ENGLISH_USERNAME_RE.test(cleaned) || !/[a-zA-Z]/.test(cleaned)) {
    const fallbackBase =
      cleaned.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 12) || 'player';
    const base = /[a-zA-Z]/.test(fallbackBase) ? fallbackBase : 'eyvan_player';
    return {
      valid: false,
      reason: 'format',
      message:
        'نام کاربری باید فقط با حروف انگلیسی، عدد، زیرخط (_) یا نقطه (.) و بین ۳ تا ۲۰ کاراکتر باشد.',
      suggestions: buildAvailableSuggestions(base, currentNormalized),
    };
  }

  const takenSet = new Set(TAKEN_USERNAMES.map((u) => u.toLowerCase()));
  takenSet.delete(currentNormalized);

  if (takenSet.has(normalized)) {
    return {
      valid: false,
      reason: 'duplicate',
      message:
        'این نام کاربری قبلاً انتخاب شده است. یکی از پیشنهادهای زیر را انتخاب کنید یا نام دیگری بنویسید:',
      suggestions: buildAvailableSuggestions(cleaned, currentNormalized),
    };
  }

  return { valid: true, suggestions: [] };
}

function buildAvailableSuggestions(
  baseInput: string,
  currentNormalized: string
): string[] {
  const base = baseInput
    .replace(/[^a-zA-Z0-9_]/g, '')
    .replace(/^_+|_+$/g, '')
    .slice(0, 14) || 'eyvan';

  const takenSet = new Set(TAKEN_USERNAMES.map((u) => u.toLowerCase()));
  takenSet.delete(currentNormalized);

  const rawCandidates = [
    `${base}_99`,
    `${base}_pro`,
    `the_${base}`,
    `${base}24`,
    `${base}_ir`,
    `${base}_vip`,
    `${base}_07`,
    `${base}_play`,
  ];

  const available: string[] = [];
  for (const cand of rawCandidates) {
    const trimmed = cand.slice(0, 20);
    if (
      trimmed.length >= 3 &&
      !takenSet.has(trimmed.toLowerCase()) &&
      !available.includes(trimmed)
    ) {
      available.push(trimmed);
    }
    if (available.length >= 4) break;
  }
  return available;
}

export const INITIAL_DEMO_PROFILE: UserProfile = {
  id: 'amir_rad',
  username: 'amir_rad',
  avatarCode: 'portrait',
  level: 12,
  xp: 2340,
  xpToNextLevel: 3000,
  coins: 12450,
  gems: 320,
  stats: {
    gamesPlayed: 46,
    wins: 29,
    losses: 17,
    rating: 1480,
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
    themeMode: 'dark',
  },
};

export const SHOP_SECTIONS: readonly ShopSectionMeta[] = [
  {
    id: 'daily_deals',
    title: 'پیشنهادهای ویژه امروز',
    subtitle: 'تخفیف‌های محدود و آیتم‌های برگزیده روزانه',
    accentColor: '#F3D179',
    badge: 'ویژه امروز',
  },
  {
    id: 'card_backs',
    title: 'طرح‌های پشت کارت',
    subtitle: 'نقوش اصیل ایرانی و گره‌چینی برای دست ورق شما',
    accentColor: '#19A2A2',
  },
  {
    id: 'table_themes',
    title: 'پوسته‌های میز بازی',
    subtitle: 'مخمل، خاتم‌کاری و فضای سنتی تالار حکم',
    accentColor: '#22C55E',
  },
  {
    id: 'avatars_frames',
    title: 'آواتار و قاب پروفایل',
    subtitle: 'نشان‌های طلایی و قاب‌های اختصاصی کاربری',
    accentColor: '#A855F7',
  },
  {
    id: 'visual_effects',
    title: 'افکت‌ها و انیمیشن‌ها',
    subtitle: 'جلوه‌های ویژه هنگام جمع‌آوری دست و کُت',
    accentColor: '#F59E0B',
  },
  {
    id: 'chests',
    title: 'صندوق‌های سکه و الماس',
    subtitle: 'بسته‌های گنجینه سکه و الماس ایوان',
    accentColor: '#38BDF8',
  },
];

export const SHOP_ITEMS_DEMO: readonly ShopItem[] = [
  // 1. Daily Deals (پیشنهادهای ویژه امروز)
  {
    id: 'dd-gold-chest',
    section: 'daily_deals',
    name: 'صندوق گنج فیروزه‌ای',
    subtitle: '۵٬۰۰۰ سکه + طرح ویژه',
    description:
      'بسته ویژه امروز شامل ۵٬۰۰۰ سکه مجازی و یک آیتم تزئینی تصادفی از مجموعه اصیل ایوان.',
    price: 120,
    currency: 'gems',
    rarity: 'legendary',
    palette: ['#13294B', '#148A8A', '#F3D179'],
    motif: 'chest',
    imageSrc: PLATFORM_ASSETS.shopChestGold,
    badge: '۳۰٪ تخفیف',
  },
  {
    id: 'dd-ruby-shamsa',
    section: 'daily_deals',
    name: 'پشت کارت یاقوت صفوی',
    subtitle: 'طرح کمیاب روزانه',
    description:
      'نقش شمسه زرین بر بستر مخمل یاقوتی عمیق با حاشیه ظریف تذهیب.',
    price: 890,
    currency: 'coins',
    rarity: 'epic',
    palette: ['#6B1628', '#B83232', '#F3D179'],
    motif: 'shamsa',
    badge: 'پرفروش',
  },
  {
    id: 'dd-gem-coffer',
    section: 'daily_deals',
    name: 'جعبه‌جواهر الماس شبستان',
    subtitle: '۱۸۰ الماس ارغوانی',
    description:
      'صندوقچه ملیله‌دوزی‌شده حاوی ۱۸۰ الماس درخشان برای باز کردن آیتم‌های افسانه‌ای.',
    price: 2400,
    currency: 'coins',
    rarity: 'legendary',
    palette: ['#241247', '#7E3AF2', '#F3D179'],
    motif: 'chest',
    imageSrc: PLATFORM_ASSETS.shopChestGem,
    imageCropScale: true,
    badge: 'محدود',
  },
  {
    id: 'dd-kot-aura',
    section: 'daily_deals',
    name: 'هاله زرین حاکم‌کُت',
    subtitle: 'افکت ویژه پیروزی ۷-۰',
    description:
      'جلوه درخشش طلایی هنگام ثبت پیروزی قاطع کُت یا حاکم‌کُت در پایان دست.',
    price: 1150,
    currency: 'coins',
    rarity: 'rare',
    palette: ['#13294B', '#B88B36', '#F3D179'],
    motif: 'star',
    badge: 'جدید',
  },

  // 2. Card Backs (طرح‌های پشت کارت)
  {
    id: 'cb-shamsa',
    section: 'card_backs',
    name: 'شمسه لاجوردی',
    subtitle: 'طرح کلاسیک ایوان',
    description:
      'ترکیب لاجورد عمیق، فیروزه و گره‌چینی هندسی هشت‌پر در مرکز کارت.',
    price: 0,
    currency: 'coins',
    rarity: 'common',
    palette: ['#13294B', '#148A8A', '#D6B46A'],
    motif: 'shamsa',
    isDefaultOwned: true,
  },
  {
    id: 'cb-kashan',
    section: 'card_backs',
    name: 'کاشی هفت‌رنگ کاشان',
    subtitle: 'گره‌چینی فیروزه و یشم',
    description:
      'نقش هندسی متقارن الهام‌گرفته از کاشی‌کاری هفت‌رنگ با بافت مات.',
    price: 950,
    currency: 'coins',
    rarity: 'rare',
    palette: ['#0F5A5A', '#13294B', '#E5C67E'],
    motif: 'kashi',
  },
  {
    id: 'cb-isfahan-gold',
    section: 'card_backs',
    name: 'تذهیب طلایی اصفهان',
    subtitle: 'خطوط زرین روی سرمه‌ای',
    description:
      'قاب‌گذاری تذهیب‌دار با تقارن اسلیمی و جلوه فاخر هنگام پخش کارت.',
    price: 1650,
    currency: 'coins',
    rarity: 'epic',
    palette: ['#0C1D3A', '#B88B36', '#F8DF95'],
    motif: 'arch',
  },
  {
    id: 'cb-shiraz-cypress',
    section: 'card_backs',
    name: 'سرو گلستان شیراز',
    subtitle: 'عنابی و عاجی اصیل',
    description:
      'نقش سرو سنتی در حاشیه طلایی با کنتراست ملایم و کلاسیک.',
    price: 1200,
    currency: 'coins',
    rarity: 'rare',
    palette: ['#5A1A22', '#155947', '#E5C67E'],
    motif: 'cypress',
  },
  {
    id: 'cb-royal-peacock',
    section: 'card_backs',
    name: 'پر طاووس سلطنتی',
    subtitle: 'طرح افسانه‌ای درخشنده',
    description:
      'طرح کلکسیونی با طیف فیروزه‌ای و طلایی ویژه بازیکنان حرفه‌ای حکم.',
    price: 90,
    currency: 'gems',
    rarity: 'legendary',
    palette: ['#0A3B49', '#19A2A2', '#F3D179'],
    motif: 'shamsa',
  },

  // 3. Table Themes (پوسته‌های میز بازی)
  {
    id: 'tt-traditional',
    section: 'table_themes',
    name: 'تالار مخمل زمردی',
    subtitle: 'میز سنتی با قاب خاتم‌کاری',
    description:
      'میز اصیل ایوان با مخمل سبز زمردی، ترنج طلایی و حاشیه چوب گردو و خاتم.',
    price: 0,
    currency: 'coins',
    rarity: 'epic',
    palette: ['#0E4234', '#082920', '#D4AE58'],
    motif: 'carpet',
    imageSrc: PLATFORM_ASSETS.hokmTableTraditional,
    isDefaultOwned: true,
  },
  {
    id: 'tt-lapis',
    section: 'table_themes',
    name: 'شبستان لاجوردی',
    subtitle: 'سرمه‌ای عمیق با نقوش فیروزه',
    description:
      'فضای آرام و رسمی الهام‌گرفته از شبستان‌های سنتی با نور ملایم مرکزی.',
    price: 1800,
    currency: 'coins',
    rarity: 'rare',
    palette: ['#13294B', '#0B1A33', '#19A2A2'],
    motif: 'arch',
  },
  {
    id: 'tt-tabriz',
    section: 'table_themes',
    name: 'فرش ترنج تبریز',
    subtitle: 'حاشیه لاکی و طلایی',
    description:
      'میز حکم با الهام از حاشیه قالی‌های اصیل تبریز و کنتراست عالی برای ورق‌ها.',
    price: 2200,
    currency: 'coins',
    rarity: 'epic',
    palette: ['#5C1A1B', '#2E0D10', '#E5C67E'],
    motif: 'carpet',
  },
  {
    id: 'tt-turquoise-palace',
    section: 'table_themes',
    name: 'ایوان کاشی فیروزه',
    subtitle: 'تم ویژه کلکسیونی',
    description:
      'بافت ظریف فیروزه‌ای و مرمر سفید با قاب طلاکوب مخصوص مسابقات.',
    price: 110,
    currency: 'gems',
    rarity: 'legendary',
    palette: ['#0D5C63', '#09383E', '#F3D179'],
    motif: 'kashi',
  },

  // 4. Avatars & Frames (آواتار و قاب پروفایل)
  {
    id: 'af-gold-arch',
    section: 'avatars_frames',
    name: 'قاب طاق زرین',
    subtitle: 'حاشیه معماری طلایی',
    description:
      'قاب ظریف با خطوط معماری ایرانی و درخشش متعادل طلایی دور آواتار.',
    price: 750,
    currency: 'coins',
    rarity: 'rare',
    palette: ['#13294B', '#B88B36', '#F6F3EC'],
    motif: 'arch',
  },
  {
    id: 'af-turquoise-star',
    section: 'avatars_frames',
    name: 'نشان شمسه فیروزه',
    subtitle: 'آواتار هندسی هشت‌پر',
    description:
      'آواتار مینیمال برگرفته از شمسه‌های کاشی‌کاری ایرانی.',
    price: 600,
    currency: 'coins',
    rarity: 'common',
    palette: ['#148A8A', '#13294B', '#D6B46A'],
    motif: 'star',
  },
  {
    id: 'af-crown-frame',
    section: 'avatars_frames',
    name: 'قاب تاج حاکم',
    subtitle: 'ویژه برندگان حکم',
    description:
      'قاب زرین مزین به تاج سلطنتی و نگین‌های فیروزه‌ای برای پروفایل شما.',
    price: 75,
    currency: 'gems',
    rarity: 'legendary',
    palette: ['#181036', '#D4AE58', '#F8DF95'],
    motif: 'shamsa',
  },
  {
    id: 'af-cypress-seal',
    section: 'avatars_frames',
    name: 'مُهر سرو جاودان',
    subtitle: 'نشان افتخار کنار نام کاربری',
    description:
      'نماد کلاسیک سرو ایرانی با طراحی مدرن برای نمایش در میز بازی.',
    price: 500,
    currency: 'coins',
    rarity: 'common',
    palette: ['#148A8A', '#155947', '#B88B36'],
    motif: 'cypress',
  },

  // 5. Visual Effects (افکت‌ها و انیمیشن‌ها)
  {
    id: 've-gold-sweep',
    section: 'visual_effects',
    name: 'رد طلایی جمع‌آوری دست',
    subtitle: 'افکت هنگام بردن هر دور',
    description:
      'رد حرکت ملایم طلایی هنگام جمع شدن ۴ کارت و حرکت آن‌ها به سمت تیم برنده.',
    price: 1100,
    currency: 'coins',
    rarity: 'rare',
    palette: ['#B88B36', '#155947', '#FCFBF8'],
    motif: 'star',
  },
  {
    id: 've-kot-seal',
    section: 'visual_effects',
    name: 'مُهر افتخار کُت',
    subtitle: 'انیمیشن پایان دست ۷ بر ۰',
    description:
      'نشان هندسی ویژه برای ثبت پیروزی‌های قاطع ۷–۰ در پایان دست حکم.',
    price: 1450,
    currency: 'coins',
    rarity: 'epic',
    palette: ['#B83232', '#C59B43', '#13294B'],
    motif: 'shamsa',
  },
  {
    id: 've-turquoise-trump',
    section: 'visual_effects',
    name: 'درخشش فیروزه‌ای بُرش',
    subtitle: 'جلوه ویژه هنگام بُریدن با حکم',
    description:
      'نورپردازی فیروزه‌ای کوتاه هنگام بازی کردن کارت حکم روی خال زمینه.',
    price: 65,
    currency: 'gems',
    rarity: 'legendary',
    palette: ['#0B3844', '#19A2A2', '#F3D179'],
    motif: 'kashi',
  },
  {
    id: 've-silk-deal',
    section: 'visual_effects',
    name: 'پخش ابریشمی ورق‌ها',
    subtitle: 'جلوه نرم حرکت کارت',
    description:
      'افکت لطیف سایه طلایی هنگام توزیع ۵، ۴ و ۴ کارتی در ابتدای هر دست.',
    price: 850,
    currency: 'coins',
    rarity: 'common',
    palette: ['#155947', '#C59B43', '#F6F3EC'],
    motif: 'cypress',
  },

  // 6. Chests & Currency (صندوق‌های سکه و الماس)
  {
    id: 'ch-small-gold',
    section: 'chests',
    name: 'صندوقچه سکه کاروان',
    subtitle: '۳٬۰۰۰ سکه مجازی',
    description:
      'بسته استاندارد سکه برای آزادسازی پشت‌کارت‌ها و افکت‌های متنوع فروشگاه.',
    price: 45,
    currency: 'gems',
    rarity: 'rare',
    palette: ['#13294B', '#C89431', '#F8DF95'],
    motif: 'chest',
    imageSrc: PLATFORM_ASSETS.shopChestGold,
  },
  {
    id: 'ch-royal-gem',
    section: 'chests',
    name: 'گنجینه الماس سلطنتی',
    subtitle: '۵۰۰ الماس درخشان',
    description:
      'بسته کلکسیونی الماس ایوان برای دسترسی به کمیاب‌ترین آیتم‌های فصلی.',
    price: 4900,
    currency: 'coins',
    rarity: 'legendary',
    palette: ['#241247', '#8E3CE0', '#F3D179'],
    motif: 'chest',
    imageSrc: PLATFORM_ASSETS.shopChestGem,
    imageCropScale: true,
  },
  {
    id: 'ch-grand-gold',
    section: 'chests',
    name: 'صندوق بزرگ گنج ایوان',
    subtitle: '۱۲٬۰۰۰ سکه مجازی',
    description:
      'پربارترین صندوق سکه فروشگاه با نشان ویژه کلکسیونرها.',
    price: 150,
    currency: 'gems',
    rarity: 'epic',
    palette: ['#0E3A3D', '#D4AE58', '#FFF2BE'],
    motif: 'chest',
    imageSrc: PLATFORM_ASSETS.shopChestGold,
  },
  {
    id: 'ch-starter-gem',
    section: 'chests',
    name: 'بسته الماس شمسه',
    subtitle: '۱۲۰ الماس مجازی',
    description:
      'بسته جمع‌وجور الماس برای پیشنهادهای روزانه فروشگاه.',
    price: 1400,
    currency: 'coins',
    rarity: 'rare',
    palette: ['#1B1440', '#6D28D9', '#E3B8FF'],
    motif: 'chest',
    imageSrc: PLATFORM_ASSETS.shopChestGem,
    imageCropScale: true,
  },
];

export const INITIAL_FRIENDS_DEMO: FriendDemo[] = [
  {
    id: 'f1',
    username: 'parvin_sh',
    level: 16,
    status: 'online',
    avatarColor: '#148A8A',
    avatarSrc: PLATFORM_ASSETS.avatarParvin,
    initials: 'P',
    lastMessage: 'آماده‌ای یه دست حکم بزنیم؟',
    lastMessageTime: '۲ دقیقه پیش',
    unreadCount: 2,
  },
  {
    id: 'f2',
    username: 'sohrab_k',
    level: 14,
    status: 'online',
    avatarColor: '#13294B',
    avatarSrc: PLATFORM_ASSETS.avatarSohrab,
    initials: 'S',
    lastMessage: 'دست آخر عجب بُرسی زدی!',
    lastMessageTime: '۱۸ دقیقه پیش',
    unreadCount: 0,
  },
  {
    id: 'f3',
    username: 'farhad_n',
    level: 11,
    status: 'online',
    avatarColor: '#8B5A2B',
    avatarSrc: PLATFORM_ASSETS.avatarFarhad,
    initials: 'F',
    lastMessage: 'تا ۱۰ دقیقه دیگه میام میز.',
    lastMessageTime: '۱ ساعت پیش',
    unreadCount: 1,
  },
  {
    id: 'f4',
    username: 'negar_th',
    level: 13,
    status: 'offline',
    avatarColor: '#155947',
    avatarSrc: PLATFORM_ASSETS.avatarNegar,
    initials: 'N',
    lastMessage: 'منتظر اضافه شدن شطرنج هستم!',
    lastMessageTime: 'دیروز',
    unreadCount: 0,
  },
  {
    id: 'f5',
    username: 'keyvan_sf',
    level: 15,
    status: 'offline',
    avatarColor: '#24406E',
    avatarSrc: PLATFORM_ASSETS.avatarKeyvan,
    initials: 'K',
    lastMessage: 'ممنون بابت دعوت، شب می‌بینمت.',
    lastMessageTime: '۲ روز پیش',
    unreadCount: 0,
  },
];

export const INITIAL_GROUPS_DEMO: ChatGroupDemo[] = [
  {
    id: 'g1',
    name: 'میز حکم شبانه',
    members: ['amir_rad', 'parvin_sh', 'sohrab_k', 'farhad_n'],
    onlineCount: 3,
    accentColor: '#0F6E6E',
    lastMessage: 'parvin_sh: کی حاکم میشه امشب؟',
    lastMessageTime: '۵ دقیقه پیش',
    unreadCount: 3,
  },
  {
    id: 'g2',
    name: 'باشگاه تخته و حکم',
    members: ['amir_rad', 'keyvan_sf', 'negar_th', 'arash_m', 'sara_bh'],
    onlineCount: 2,
    accentColor: '#1D3E6E',
    lastMessage: 'keyvan_sf: لینک میز بعدی رو بذارید.',
    lastMessageTime: '۴۰ دقیقه پیش',
    unreadCount: 0,
  },
  {
    id: 'g3',
    name: 'تورنمنت دوستانه جمعه',
    members: ['amir_rad', 'sohrab_k', 'hamed_rf', 'maryam_kz'],
    onlineCount: 2,
    accentColor: '#7C4A1D',
    lastMessage: 'sohrab_k: تیم ما ۷ بر ۲ برد!',
    lastMessageTime: 'دیروز',
    unreadCount: 0,
  },
];

export const INITIAL_DIRECT_CHATS: Record<string, ChatMessage[]> = {
  f1: [
    {
      id: 'm1',
      sender: 'parvin_sh',
      text: 'سلام! دست قبلی خیلی خوب جمع شد.',
      time: '۱۸:۱۰',
    },
    {
      id: 'm2',
      sender: 'amir_rad',
      text: 'آره عالی بود، آس پیک رو خوب نگه داشتی.',
      time: '۱۸:۱۲',
      isMe: true,
    },
    {
      id: 'm3',
      sender: 'parvin_sh',
      text: 'آماده‌ای یه دست حکم بزنیم؟',
      time: '۱۸:۱۴',
    },
  ],
  f2: [
    {
      id: 'm4',
      sender: 'sohrab_k',
      text: 'دست آخر عجب بُرسی زدی!',
      time: '۱۷:۵۰',
    },
    {
      id: 'm5',
      sender: 'amir_rad',
      text: 'دمت گرم، دور بعدی تلافی کن!',
      time: '۱۷:۵۲',
      isMe: true,
    },
  ],
  f3: [
    {
      id: 'm6',
      sender: 'farhad_n',
      text: 'تا ۱۰ دقیقه دیگه میام میز.',
      time: '۱۶:۴۰',
    },
  ],
  f4: [
    {
      id: 'm7',
      sender: 'negar_th',
      text: 'منتظر اضافه شدن شطرنج هستم!',
      time: 'دیروز',
    },
  ],
  f5: [
    {
      id: 'm8',
      sender: 'keyvan_sf',
      text: 'ممنون بابت دعوت، شب می‌بینمت.',
      time: '۲ روز پیش',
    },
  ],
};

export const INITIAL_GROUP_CHATS: Record<string, ChatMessage[]> = {
  g1: [
    {
      id: 'gm1',
      sender: 'sohrab_k',
      text: 'بچه‌ها ۴ نفر تکمیلیم؟',
      time: '۲۰:۰۲',
    },
    {
      id: 'gm2',
      sender: 'farhad_n',
      text: 'من هستم، یه دقیقه دیگه آماده میشم.',
      time: '۲۰:۰۴',
    },
    {
      id: 'gm3',
      sender: 'amir_rad',
      text: 'منم پایه‌ام، بریم سر میز حکم.',
      time: '۲۰:۰۵',
      isMe: true,
    },
    {
      id: 'gm4',
      sender: 'parvin_sh',
      text: 'کی حاکم میشه امشب؟',
      time: '۲۰:۰۷',
    },
  ],
  g2: [
    {
      id: 'gm5',
      sender: 'negar_th',
      text: 'سلام همگی، مسابقه بعدی کی هست؟',
      time: '۱۹:۱۵',
    },
    {
      id: 'gm6',
      sender: 'keyvan_sf',
      text: 'لینک میز بعدی رو بذارید.',
      time: '۱۹:۲۴',
    },
  ],
  g3: [
    {
      id: 'gm7',
      sender: 'sohrab_k',
      text: 'تیم ما ۷ بر ۲ برد!',
      time: 'دیروز',
    },
  ],
};
