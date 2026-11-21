import { ShopItem, ShopSectionMeta } from '../types/platform';
import { PLATFORM_ASSETS } from './assets';

/**
 * Static cosmetic shop catalog (sections & item metadata).
 * Kept completely separate from user profiles, friends, and chat records.
 */
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

export const SHOP_CATALOG_ITEMS = SHOP_ITEMS_DEMO;
