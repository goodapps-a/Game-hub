import type { DeckCatalogEntry } from '../decks/types';
import {
  EquippedSlotsMap,
  ItemSlot,
  PublicAppearanceSnapshot,
  UniversalItemDefinition,
} from './itemTypes';

export const DEFAULT_EQUIPPED_SLOTS: Readonly<EquippedSlotsMap> = {
  card_deck: 'deck-eyvan-classic',
  card_back: 'cb-shamsa',
  table_skin: 'tt-traditional',
  banner: 'af-banner-royal',
};

export const SLOT_FALLBACK_ITEMS: Readonly<Partial<Record<ItemSlot, string>>> = {
  card_deck: 'deck-eyvan-classic',
  card_back: 'cb-shamsa',
  table_skin: 'tt-traditional',
  banner: 'af-banner-royal',
};

export function toDeckItemId(deckId: string): string {
  const clean = deckId.trim();
  return clean.startsWith('deck-') ? clean : `deck-${clean}`;
}

export function extractDeckIdFromItemId(itemId: string): string {
  return itemId.startsWith('deck-') ? itemId.slice(5) : itemId;
}

/**
 * Pure data-driven catalog items shared 1:1 between server (Cloudflare D1 / SQLite) and browser UI.
 * Contains ZERO Vite asset imports so Workers & Node runtimes execute directly without bundlers.
 */
export const BASE_UNIVERSAL_ITEMS: readonly UniversalItemDefinition[] = [
  // Built-in & Default Card Decks
  {
    id: 'deck-eyvan-classic',
    kind: 'card_deck',
    slot: 'card_deck',
    visibilityScope: 'public_gameplay',
    section: 'card_decks',
    gameId: 'hokm',
    deckId: 'eyvan-classic',
    name: 'ایوان کلاسیک (اصیل)',
    subtitle: 'مجموعه پیش‌فرض و همیشه آماده آفلاین',
    description:
      'مجموعه استاندارد و سبک ایوان با کارت‌های چهره حکاکی‌شده و پشت کارت شمسه و گره‌چینی لاجوردی.',
    price: 0,
    currency: 'coins',
    rarity: 'common',
    palette: ['#13294B', '#148A8A', '#D6B46A'],
    motif: 'shamsa',
    badge: 'پیش‌فرض',
    isDefaultOwned: true,
    isEquippable: true,
    isClaimable: true,
    visualMeta: {
      deckId: 'eyvan-classic',
      deckBytes: 0,
      deckCardCount: 52,
      deckAuthor: 'تیم طراحی ایوان',
      deckLicense: 'Proprietary / Built-in Eyvan',
      deckRenderMode: 'builtin_classic',
    },
    tags: ['deck', 'hokm', 'classic', 'builtin'],
  },
  {
    id: 'deck-public-domain-cc0',
    kind: 'card_deck',
    slot: 'card_deck',
    visibilityScope: 'public_gameplay',
    section: 'card_decks',
    gameId: 'hokm',
    deckId: 'public-domain-cc0',
    name: 'کلاسیک جهانی (CC0)',
    subtitle: 'طراحی مصور بین‌المللی · ۵۲ برگ کامل + پشت آبی کلاسیک',
    description:
      'دست ورق کلاسیک بین‌المللی با کارت‌های چهره مصور، خال‌های برداری تیز و پشت کارت توری آبی. پس از یک‌بار دریافت، به‌صورت کامل آفلاین در حافظه دستگاه ذخیره می‌شود.',
    price: 0,
    currency: 'coins',
    rarity: 'rare',
    palette: ['#13294B', '#19A2A2', '#F3D179'],
    motif: 'kashi',
    badge: 'رایگان · ۵۲ برگ',
    isDefaultOwned: false,
    isEquippable: true,
    isClaimable: true,
    visualMeta: {
      deckId: 'public-domain-cc0',
      deckBytes: 1175770,
      deckCardCount: 52,
      deckAuthor: 'AustinGabriel (Public Domain / CC0)',
      deckLicense: 'CC0-1.0 (Public Domain)',
      deckRenderMode: 'full_card',
    },
    tags: ['deck', 'hokm', 'cc0', 'svg'],
  },

  // 1. Daily Deals
  {
    id: 'dd-gold-chest',
    kind: 'chest',
    slot: null,
    visibilityScope: 'owner_only',
    section: 'daily_deals',
    gameId: 'platform',
    name: 'صندوق گنج فیروزه‌ای',
    subtitle: '۵٬۰۰۰ سکه مجازی',
    description:
      'بسته ویژه امروز شامل ۵٬۰۰۰ سکه مجازی برای گسترش کلکسیون ایوان.',
    price: 120,
    currency: 'gems',
    rarity: 'legendary',
    palette: ['#13294B', '#148A8A', '#F3D179'],
    motif: 'chest',
    badge: '۳۰٪ تخفیف',
    isEquippable: false,
    isClaimable: true,
    rewardPayload: { coins: 5000 },
    tags: ['chest', 'coins', 'daily'],
  },
  {
    id: 'dd-ruby-shamsa',
    kind: 'card_back',
    slot: 'card_back',
    visibilityScope: 'public_gameplay',
    section: 'daily_deals',
    gameId: 'hokm',
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
    isEquippable: true,
    isClaimable: true,
    visualMeta: { cardBackAccent: '#B83232' },
    tags: ['card_back', 'hokm', 'daily'],
  },
  {
    id: 'dd-gem-coffer',
    kind: 'chest',
    slot: null,
    visibilityScope: 'owner_only',
    section: 'daily_deals',
    gameId: 'platform',
    name: 'جعبه‌جواهر الماس شبستان',
    subtitle: '۱۸۰ الماس ارغوانی',
    description:
      'صندوقچه ملیله‌دوزی‌شده حاوی ۱۸۰ الماس درخشان برای باز کردن آیتم‌های افسانه‌ای.',
    price: 2400,
    currency: 'coins',
    rarity: 'legendary',
    palette: ['#241247', '#7E3AF2', '#F3D179'],
    motif: 'chest',
    badge: 'محدود',
    imageCropScale: true,
    isEquippable: false,
    isClaimable: true,
    rewardPayload: { gems: 180 },
    tags: ['chest', 'gems', 'daily'],
  },
  {
    id: 'dd-kot-aura',
    kind: 'game_effect',
    slot: 'game_effect',
    visibilityScope: 'public_gameplay',
    section: 'daily_deals',
    gameId: 'hokm',
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
    isEquippable: true,
    isClaimable: true,
    visualMeta: { effectAccent: '#F3D179' },
    tags: ['effect', 'hokm', 'daily'],
  },

  // 2. Card Backs
  {
    id: 'cb-shamsa',
    kind: 'card_back',
    slot: 'card_back',
    visibilityScope: 'public_gameplay',
    section: 'card_backs',
    gameId: 'hokm',
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
    isEquippable: true,
    isClaimable: true,
    visualMeta: { cardBackAccent: '#148A8A' },
    tags: ['card_back', 'hokm', 'default'],
  },
  {
    id: 'cb-kashan',
    kind: 'card_back',
    slot: 'card_back',
    visibilityScope: 'public_gameplay',
    section: 'card_backs',
    gameId: 'hokm',
    name: 'کاشی هفت‌رنگ کاشان',
    subtitle: 'گره‌چینی فیروزه و یشم',
    description:
      'نقش هندسی متقارن الهام‌گرفته از کاشی‌کاری هفت‌رنگ با بافت مات.',
    price: 950,
    currency: 'coins',
    rarity: 'rare',
    palette: ['#0F5A5A', '#13294B', '#E5C67E'],
    motif: 'kashi',
    isEquippable: true,
    isClaimable: true,
    visualMeta: { cardBackAccent: '#0F5A5A' },
    tags: ['card_back', 'hokm'],
  },
  {
    id: 'cb-isfahan-gold',
    kind: 'card_back',
    slot: 'card_back',
    visibilityScope: 'public_gameplay',
    section: 'card_backs',
    gameId: 'hokm',
    name: 'تذهیب طلایی اصفهان',
    subtitle: 'خطوط زرین روی سرمه‌ای',
    description:
      'قاب‌گذاری تذهیب‌دار با تقارن اسلیمی و جلوه فاخر هنگام پخش کارت.',
    price: 1650,
    currency: 'coins',
    rarity: 'epic',
    palette: ['#0C1D3A', '#B88B36', '#F8DF95'],
    motif: 'arch',
    isEquippable: true,
    isClaimable: true,
    visualMeta: { cardBackAccent: '#B88B36' },
    tags: ['card_back', 'hokm'],
  },
  {
    id: 'cb-shiraz-cypress',
    kind: 'card_back',
    slot: 'card_back',
    visibilityScope: 'public_gameplay',
    section: 'card_backs',
    gameId: 'hokm',
    name: 'سرو گلستان شیراز',
    subtitle: 'عنابی و عاجی اصیل',
    description:
      'نقش سرو سنتی در حاشیه طلایی با کنتراست ملایم و کلاسیک.',
    price: 1200,
    currency: 'coins',
    rarity: 'rare',
    palette: ['#5A1A22', '#155947', '#E5C67E'],
    motif: 'cypress',
    isEquippable: true,
    isClaimable: true,
    visualMeta: { cardBackAccent: '#5A1A22' },
    tags: ['card_back', 'hokm'],
  },
  {
    id: 'cb-royal-peacock',
    kind: 'card_back',
    slot: 'card_back',
    visibilityScope: 'public_gameplay',
    section: 'card_backs',
    gameId: 'hokm',
    name: 'پر طاووس سلطنتی',
    subtitle: 'طرح افسانه‌ای درخشنده',
    description:
      'طرح کلکسیونی با طیف فیروزه‌ای و طلایی ویژه بازیکنان حرفه‌ای حکم.',
    price: 90,
    currency: 'gems',
    rarity: 'legendary',
    palette: ['#0A3B49', '#19A2A2', '#F3D179'],
    motif: 'shamsa',
    isEquippable: true,
    isClaimable: true,
    visualMeta: { cardBackAccent: '#19A2A2' },
    tags: ['card_back', 'hokm', 'legendary'],
  },
  {
    id: 'cb-yazd-termeh',
    kind: 'card_back',
    slot: 'card_back',
    visibilityScope: 'public_gameplay',
    section: 'card_backs',
    gameId: 'hokm',
    name: 'ترمه زرین یزد',
    subtitle: 'نقش بته‌جقه سنتی',
    description:
      'پشت کارت بافت‌دار با نقش بته‌جقه اصیل یزد بر زمینه لاجوردی و طلاکوب.',
    price: 1100,
    currency: 'coins',
    rarity: 'rare',
    palette: ['#18294A', '#9E2B3B', '#E5C67E'],
    motif: 'cypress',
    isEquippable: true,
    isClaimable: true,
    visualMeta: { cardBackAccent: '#9E2B3B' },
    tags: ['card_back', 'hokm'],
  },

  // 3. Table Skins (STRICTLY OWNER ONLY)
  {
    id: 'tt-traditional',
    kind: 'table_skin',
    slot: 'table_skin',
    visibilityScope: 'owner_only',
    section: 'table_themes',
    gameId: 'hokm',
    name: 'مخمل زمردی شاهی',
    subtitle: 'میز اصلی با قاب گردو و طلا',
    description:
      'پوسته استاندارد و شفاف میز حکم با مخمل سبز زمردی، ترنج محو مرکزی و حاشیه چوب گردو.',
    price: 0,
    currency: 'coins',
    rarity: 'epic',
    palette: ['#0E4234', '#082920', '#D4AE58'],
    motif: 'carpet',
    isDefaultOwned: true,
    isEquippable: true,
    isClaimable: true,
    visualMeta: {
      tableSkinImageKey: 'hokmTableTraditional',
      tableVignette:
        'radial-gradient(ellipse at 50% 48%, rgba(7, 46, 33, 0.08) 0%, rgba(4, 28, 20, 0.40) 72%, rgba(2, 16, 12, 0.76) 100%)',
      tableRailAccent: 'border-[#D4AE58]/42',
    },
    tags: ['table', 'hokm', 'owner_only', 'default'],
  },
  {
    id: 'tt-lapis',
    kind: 'table_skin',
    slot: 'table_skin',
    visibilityScope: 'owner_only',
    section: 'table_themes',
    gameId: 'hokm',
    name: 'مخمل لاجوردی شبستان',
    subtitle: 'سرمه‌ای عمیق با قاب طلاکوب',
    description:
      'پوسته لاجوردی آرام و رسمی با کنتراست عالی برای ورق‌ها و رگه‌های ظریف فیروزه.',
    price: 1800,
    currency: 'coins',
    rarity: 'rare',
    palette: ['#13294B', '#0B1A33', '#19A2A2'],
    motif: 'arch',
    badge: 'محبوب',
    isEquippable: true,
    isClaimable: true,
    visualMeta: {
      tableSkinImageKey: 'hokmTableLapis',
      tableVignette:
        'radial-gradient(ellipse at 50% 48%, rgba(8, 30, 62, 0.10) 0%, rgba(5, 19, 44, 0.42) 72%, rgba(3, 10, 26, 0.78) 100%)',
      tableRailAccent: 'border-[#67D5E8]/45',
    },
    tags: ['table', 'hokm', 'owner_only'],
  },
  {
    id: 'tt-tabriz',
    kind: 'table_skin',
    slot: 'table_skin',
    visibilityScope: 'owner_only',
    section: 'table_themes',
    gameId: 'hokm',
    name: 'مخمل یاقوتی صفوی',
    subtitle: 'عنابی شاهی با حاشیه زرین',
    description:
      'پوسته مخمل یاقوتی عمیق با حاشیه آبنوس و طلا برای تجربه‌ای باشکوه در بازی حکم.',
    price: 2200,
    currency: 'coins',
    rarity: 'epic',
    palette: ['#5C1A1B', '#2E0D10', '#E5C67E'],
    motif: 'carpet',
    badge: 'جدید',
    isEquippable: true,
    isClaimable: true,
    visualMeta: {
      tableSkinImageKey: 'hokmTableRuby',
      tableVignette:
        'radial-gradient(ellipse at 50% 48%, rgba(58, 12, 24, 0.10) 0%, rgba(36, 7, 15, 0.42) 72%, rgba(20, 4, 9, 0.78) 100%)',
      tableRailAccent: 'border-[#F3D179]/48',
    },
    tags: ['table', 'hokm', 'owner_only'],
  },
  {
    id: 'tt-turquoise-palace',
    kind: 'table_skin',
    slot: 'table_skin',
    visibilityScope: 'owner_only',
    section: 'table_themes',
    gameId: 'hokm',
    name: 'ایوان لاجورد و فیروزه',
    subtitle: 'تم ویژه مسابقات',
    description:
      'پوسته کلکسیونی لاجوردی با درخشش طلایی ویژه میزهای دوستانه و رقابتی.',
    price: 90,
    currency: 'gems',
    rarity: 'legendary',
    palette: ['#0D5C63', '#09383E', '#F3D179'],
    motif: 'kashi',
    isEquippable: true,
    isClaimable: true,
    visualMeta: {
      tableSkinImageKey: 'hokmTableLapis',
      tableVignette:
        'radial-gradient(ellipse at 50% 48%, rgba(9, 56, 62, 0.10) 0%, rgba(5, 32, 38, 0.44) 72%, rgba(2, 14, 18, 0.78) 100%)',
      tableRailAccent: 'border-[#F3D179]/50',
    },
    tags: ['table', 'hokm', 'owner_only', 'legendary'],
  },

  // 4. Public Profile Banners, Avatars, Frames & Badges
  {
    id: 'af-banner-royal',
    kind: 'banner',
    slot: 'banner',
    visibilityScope: 'public_profile',
    section: 'avatars_frames',
    gameId: 'platform',
    name: 'بنر پروفایل ایوان شاهی',
    subtitle: 'بنر پیش‌فرض طاق زرین اصفهان',
    description:
      'پس‌زمینه باشکوه طاق و شمسه زرین ایوان که به‌صورت پیش‌فرض روی پروفایل شما فعال است.',
    price: 0,
    currency: 'coins',
    rarity: 'common',
    palette: ['#0E1E3B', '#D4AE58', '#19A2A2'],
    motif: 'arch',
    isDefaultOwned: true,
    isEquippable: true,
    isClaimable: true,
    visualMeta: { bannerCode: 'royal' },
    tags: ['banner', 'profile', 'default'],
  },
  {
    id: 'af-banner-garden',
    kind: 'banner',
    slot: 'banner',
    visibilityScope: 'public_profile',
    section: 'avatars_frames',
    gameId: 'platform',
    name: 'بنر پروفایل باغ فیروزه',
    subtitle: 'حیاط کاشی‌کاری و حوض زمردی',
    description:
      'بنر اختصاصی پشت پروفایل با طراحی حوض فیروزه‌ای، سروهای شبانه و فانوس‌های گرم ایرانی.',
    price: 1200,
    currency: 'coins',
    rarity: 'epic',
    palette: ['#0B3D42', '#19A2A2', '#F3D179'],
    motif: 'kashi',
    badge: 'بنر جدید',
    isEquippable: true,
    isClaimable: true,
    visualMeta: { bannerCode: 'garden' },
    tags: ['banner', 'profile'],
  },
  {
    id: 'af-banner-ruby',
    kind: 'banner',
    slot: 'banner',
    visibilityScope: 'public_profile',
    section: 'avatars_frames',
    gameId: 'platform',
    name: 'بنر پروفایل تالار یاقوت',
    subtitle: 'مخمل یاقوتی و زربافت صفوی',
    description:
      'بنر کلکسیونی و مجلل با نقش زربافت صفوی برای نمایش متمایز پشت کارت پروفایل شما.',
    price: 85,
    currency: 'gems',
    rarity: 'legendary',
    palette: ['#5A0E1B', '#9E1B32', '#F3D179'],
    motif: 'carpet',
    badge: 'ویژه',
    isEquippable: true,
    isClaimable: true,
    visualMeta: { bannerCode: 'ruby' },
    tags: ['banner', 'profile', 'legendary'],
  },
  {
    id: 'af-gold-arch',
    kind: 'avatar_frame',
    slot: 'avatar_frame',
    visibilityScope: 'public_profile',
    section: 'avatars_frames',
    gameId: 'platform',
    name: 'قاب طاق زرین',
    subtitle: 'حاشیه معماری طلایی',
    description:
      'قاب ظریف با خطوط معماری ایرانی و درخشش متعادل طلایی دور آواتار.',
    price: 750,
    currency: 'coins',
    rarity: 'rare',
    palette: ['#13294B', '#B88B36', '#F6F3EC'],
    motif: 'arch',
    isEquippable: true,
    isClaimable: true,
    visualMeta: {
      frameRingColor: '#E5BA58',
      frameGlowColor: 'rgba(229, 186, 88, 0.45)',
    },
    tags: ['frame', 'profile'],
  },
  {
    id: 'af-turquoise-star',
    kind: 'avatar',
    slot: 'avatar',
    visibilityScope: 'public_profile',
    section: 'avatars_frames',
    gameId: 'platform',
    name: 'نشان شمسه فیروزه',
    subtitle: 'آواتار هندسی هشت‌پر',
    description:
      'آواتار مینیمال برگرفته از شمسه‌های کاشی‌کاری ایرانی.',
    price: 600,
    currency: 'coins',
    rarity: 'common',
    palette: ['#148A8A', '#13294B', '#D6B46A'],
    motif: 'star',
    isEquippable: true,
    isClaimable: true,
    tags: ['avatar', 'profile'],
  },
  {
    id: 'af-crown-frame',
    kind: 'avatar_frame',
    slot: 'avatar_frame',
    visibilityScope: 'public_profile',
    section: 'avatars_frames',
    gameId: 'platform',
    name: 'قاب تاج حاکم',
    subtitle: 'ویژه برندگان حکم',
    description:
      'قاب زرین مزین به تاج سلطنتی و نگین‌های فیروزه‌ای برای پروفایل شما.',
    price: 75,
    currency: 'gems',
    rarity: 'legendary',
    palette: ['#181036', '#D4AE58', '#F8DF95'],
    motif: 'shamsa',
    isEquippable: true,
    isClaimable: true,
    visualMeta: {
      frameRingColor: '#F3D179',
      frameGlowColor: 'rgba(243, 209, 121, 0.55)',
    },
    tags: ['frame', 'profile', 'legendary'],
  },
  {
    id: 'af-cypress-seal',
    kind: 'profile_badge',
    slot: 'profile_badge',
    visibilityScope: 'public_profile',
    section: 'avatars_frames',
    gameId: 'platform',
    name: 'مُهر سرو جاودان',
    subtitle: 'نشان افتخار کنار نام کاربری',
    description:
      'نماد کلاسیک سرو ایرانی با طراحی مدرن برای نمایش در میز بازی.',
    price: 500,
    currency: 'coins',
    rarity: 'common',
    palette: ['#148A8A', '#155947', '#B88B36'],
    motif: 'cypress',
    isEquippable: true,
    isClaimable: true,
    visualMeta: {
      badgeSymbol: 'سرو',
      badgeColor: '#19A2A2',
    },
    tags: ['badge', 'profile'],
  },
  {
    id: 'af-hakem-seal',
    kind: 'profile_badge',
    slot: 'profile_badge',
    visibilityScope: 'public_profile',
    section: 'avatars_frames',
    gameId: 'platform',
    name: 'نشان حاکم ایوان',
    subtitle: 'نشان تاج طلایی پروفایل',
    description:
      'نشان ویژه حاکم که در کنار نام کاربری شما در میز بازی و فهرست دوستان نمایش داده می‌شود.',
    price: 850,
    currency: 'coins',
    rarity: 'epic',
    palette: ['#18122B', '#C89B3C', '#F3D179'],
    motif: 'shamsa',
    isEquippable: true,
    isClaimable: true,
    visualMeta: {
      badgeSymbol: 'حاکم',
      badgeColor: '#D4AE58',
    },
    tags: ['badge', 'profile'],
  },

  // 5. Visual Effects (Public Gameplay)
  {
    id: 've-gold-sweep',
    kind: 'game_effect',
    slot: 'game_effect',
    visibilityScope: 'public_gameplay',
    section: 'visual_effects',
    gameId: 'hokm',
    name: 'رد طلایی جمع‌آوری دست',
    subtitle: 'افکت هنگام بردن هر دور',
    description:
      'رد حرکت ملایم طلایی هنگام جمع شدن ۴ کارت و حرکت آن‌ها به سمت تیم برنده.',
    price: 1100,
    currency: 'coins',
    rarity: 'rare',
    palette: ['#B88B36', '#155947', '#FCFBF8'],
    motif: 'star',
    isEquippable: true,
    isClaimable: true,
    visualMeta: { effectAccent: '#E5BA58' },
    tags: ['effect', 'hokm'],
  },
  {
    id: 've-kot-seal',
    kind: 'game_effect',
    slot: 'game_effect',
    visibilityScope: 'public_gameplay',
    section: 'visual_effects',
    gameId: 'hokm',
    name: 'مُهر افتخار کُت',
    subtitle: 'انیمیشن پایان دست ۷ بر ۰',
    description:
      'نشان هندسی ویژه برای ثبت پیروزی‌های قاطع ۷–۰ در پایان دست حکم.',
    price: 1450,
    currency: 'coins',
    rarity: 'epic',
    palette: ['#B83232', '#C59B43', '#13294B'],
    motif: 'shamsa',
    isEquippable: true,
    isClaimable: true,
    visualMeta: { effectAccent: '#E04D66' },
    tags: ['effect', 'hokm'],
  },
  {
    id: 've-turquoise-trump',
    kind: 'game_effect',
    slot: 'game_effect',
    visibilityScope: 'public_gameplay',
    section: 'visual_effects',
    gameId: 'hokm',
    name: 'درخشش فیروزه‌ای بُرش',
    subtitle: 'جلوه ویژه هنگام بُریدن با حکم',
    description:
      'نورپردازی فیروزه‌ای کوتاه هنگام بازی کردن کارت حکم روی خال زمینه.',
    price: 65,
    currency: 'gems',
    rarity: 'legendary',
    palette: ['#0B3844', '#19A2A2', '#F3D179'],
    motif: 'kashi',
    isEquippable: true,
    isClaimable: true,
    visualMeta: { effectAccent: '#19A2A2' },
    tags: ['effect', 'hokm'],
  },
  {
    id: 've-silk-deal',
    kind: 'game_effect',
    slot: 'game_effect',
    visibilityScope: 'public_gameplay',
    section: 'visual_effects',
    gameId: 'hokm',
    name: 'پخش ابریشمی ورق‌ها',
    subtitle: 'جلوه نرم حرکت کارت',
    description:
      'افکت لطیف سایه طلایی هنگام توزیع ۵، ۴ و ۴ کارتی در ابتدای هر دست.',
    price: 850,
    currency: 'coins',
    rarity: 'common',
    palette: ['#155947', '#C59B43', '#F6F3EC'],
    motif: 'cypress',
    isEquippable: true,
    isClaimable: true,
    visualMeta: { effectAccent: '#C59B43' },
    tags: ['effect', 'hokm'],
  },

  // 6. Chests & Currency
  {
    id: 'ch-small-gold',
    kind: 'chest',
    slot: null,
    visibilityScope: 'owner_only',
    section: 'chests',
    gameId: 'platform',
    name: 'صندوقچه سکه کاروان',
    subtitle: '۳٬۰۰۰ سکه مجازی',
    description:
      'بسته استاندارد سکه برای آزادسازی پشت‌کارت‌ها و افکت‌های متنوع فروشگاه.',
    price: 45,
    currency: 'gems',
    rarity: 'rare',
    palette: ['#13294B', '#C89431', '#F8DF95'],
    motif: 'chest',
    isEquippable: false,
    isClaimable: true,
    rewardPayload: { coins: 3000 },
    tags: ['chest', 'coins'],
  },
  {
    id: 'ch-royal-gem',
    kind: 'chest',
    slot: null,
    visibilityScope: 'owner_only',
    section: 'chests',
    gameId: 'platform',
    name: 'گنجینه الماس سلطنتی',
    subtitle: '۵۰۰ الماس درخشان',
    description:
      'بسته کلکسیونی الماس ایوان برای دسترسی به کمیاب‌ترین آیتم‌های فصلی.',
    price: 4900,
    currency: 'coins',
    rarity: 'legendary',
    palette: ['#241247', '#8E3CE0', '#F3D179'],
    motif: 'chest',
    imageCropScale: true,
    isEquippable: false,
    isClaimable: true,
    rewardPayload: { gems: 500 },
    tags: ['chest', 'gems'],
  },
  {
    id: 'ch-grand-gold',
    kind: 'chest',
    slot: null,
    visibilityScope: 'owner_only',
    section: 'chests',
    gameId: 'platform',
    name: 'صندوق بزرگ گنج ایوان',
    subtitle: '۱۲٬۰۰۰ سکه مجازی',
    description:
      'پربارترین صندوق سکه فروشگاه با نشان ویژه کلکسیونرها.',
    price: 150,
    currency: 'gems',
    rarity: 'epic',
    palette: ['#0E3A3D', '#D4AE58', '#FFF2BE'],
    motif: 'chest',
    isEquippable: false,
    isClaimable: true,
    rewardPayload: { coins: 12000 },
    tags: ['chest', 'coins'],
  },
  {
    id: 'ch-starter-gem',
    kind: 'chest',
    slot: null,
    visibilityScope: 'owner_only',
    section: 'chests',
    gameId: 'platform',
    name: 'بسته الماس شمسه',
    subtitle: '۱۲۰ الماس مجازی',
    description:
      'بسته جمع‌وجور الماس برای پیشنهادهای روزانه فروشگاه.',
    price: 1400,
    currency: 'coins',
    rarity: 'rare',
    palette: ['#1B1440', '#6D28D9', '#E3B8FF'],
    motif: 'chest',
    imageCropScale: true,
    isEquippable: false,
    isClaimable: true,
    rewardPayload: { gems: 120 },
    tags: ['chest', 'gems'],
  },
];

const BASE_ITEM_BY_ID = new Map<string, UniversalItemDefinition>(
  BASE_UNIVERSAL_ITEMS.map((item) => [item.id, item])
);

export function getBaseUniversalCatalogItem(
  itemId: string
): UniversalItemDefinition | undefined {
  return BASE_ITEM_BY_ID.get(itemId);
}

export function deckEntryToUniversalItem(
  entry: DeckCatalogEntry
): UniversalItemDefinition {
  const itemId = toDeckItemId(entry.id);
  const existing = BASE_ITEM_BY_ID.get(itemId);
  if (existing) {
    return existing;
  }
  const isBuiltin = entry.pricing.access === 'builtin' || entry.id === 'eyvan-classic';
  return {
    id: itemId,
    kind: 'card_deck',
    slot: 'card_deck',
    visibilityScope: 'public_gameplay',
    section: 'card_decks',
    gameId: 'hokm',
    deckId: entry.id,
    name: entry.name,
    subtitle: entry.subtitle,
    description: entry.description,
    price: entry.pricing.price,
    currency: entry.pricing.currency,
    rarity: entry.pricing.rarity,
    palette: ['#13294B', '#19A2A2', '#F3D179'],
    motif: 'kashi',
    badge: entry.pricing.badge,
    isDefaultOwned: isBuiltin,
    isEquippable: true,
    isClaimable: true,
    visualMeta: {
      deckId: entry.id,
      deckBytes: entry.totalBytes,
      deckCardCount: entry.cardCount,
      deckAuthor: entry.author,
      deckLicense: entry.license,
      deckRenderMode: entry.renderMode,
    },
    tags: ['deck', 'hokm', entry.format],
  };
}

/**
 * Resolves a dynamic/arbitrary item ID cleanly for catalog + inventory lookup,
 * including dynamically registered Multi-Deck packs (`deck-<id>`).
 */
export function resolveCatalogItemDefinition(
  itemId: string,
  extraDecks?: readonly DeckCatalogEntry[]
): UniversalItemDefinition | undefined {
  const direct = BASE_ITEM_BY_ID.get(itemId);
  if (direct) return direct;
  const deckDirect = BASE_ITEM_BY_ID.get(toDeckItemId(itemId));
  if (deckDirect) return deckDirect;
  if (extraDecks) {
    const cleanDeckId = extractDeckIdFromItemId(itemId);
    const match = extraDecks.find(
      (d) => d.id === itemId || d.id === cleanDeckId || toDeckItemId(d.id) === itemId
    );
    if (match) return deckEntryToUniversalItem(match);
  }
  return undefined;
}

/**
 * Strips ALL `owner_only` slots (`table_skin`, `table_background`, etc.)
 * and returns strictly safe public appearance fields for social profiles, friends, and game rooms.
 */
export function buildPublicAppearanceFromSlots(
  equippedSlots: EquippedSlotsMap,
  customBannerNone = false
): PublicAppearanceSnapshot {
  const bannerItemId = customBannerNone ? null : equippedSlots.banner ?? 'af-banner-royal';
  const bannerDef = bannerItemId ? BASE_ITEM_BY_ID.get(bannerItemId) : undefined;
  const bannerCode = customBannerNone
    ? 'none'
    : bannerDef?.visualMeta?.bannerCode ?? 'royal';

  const deckItemId = equippedSlots.card_deck ?? 'deck-eyvan-classic';
  const deckId = extractDeckIdFromItemId(deckItemId);

  return {
    bannerItemId,
    bannerCode,
    avatarItemId: equippedSlots.avatar ?? null,
    avatarFrameId: equippedSlots.avatar_frame ?? null,
    badgeId: equippedSlots.profile_badge ?? null,
    nameplateId: equippedSlots.nameplate ?? null,
    deckId: deckId || 'eyvan-classic',
    cardBackId: equippedSlots.card_back ?? 'cb-shamsa',
    gameEffectId: equippedSlots.game_effect ?? null,
  };
}
