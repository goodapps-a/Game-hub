import { GameModuleDescriptor } from '../platform/types/platform';
import { PLATFORM_ASSETS } from '../platform/data/assets';

/**
 * Central plug-and-play game module registry.
 * Top hero is Hokm (active); lower 2x2 boxes showcase Chess, Backgammon, Ludo, and Pasoor (coming soon).
 */
export const GAME_REGISTRY: readonly GameModuleDescriptor[] = [
  {
    id: 'hokm',
    name: 'حکم',
    englishName: 'Hokm',
    subtitle: 'بازی محبوب ایرانی',
    playersLabel: '۴ نفره (تیمی)',
    durationLabel: '۱۰ تا ۱۵ دقیقه',
    available: true,
    accentColor: '#D4AE58',
    bgTint: '#0D1C34',
    artworkSrc: PLATFORM_ASSETS.hokmHero,
    lightArtworkSrc: PLATFORM_ASSETS.hokmHeroLight,
  },
  {
    id: 'chess',
    name: 'شطرنج',
    englishName: 'Chess',
    subtitle: 'رقابت فکری کلاسیک',
    playersLabel: '۲ نفره',
    durationLabel: '۱۵ تا ۳۰ دقیقه',
    available: false,
    accentColor: '#D4AE58',
    bgTint: '#101C32',
    artworkSrc: PLATFORM_ASSETS.chessArt,
    lightArtworkSrc: PLATFORM_ASSETS.chessArtLight,
  },
  {
    id: 'backgammon',
    name: 'تخته‌نرد',
    englishName: 'Backgammon',
    subtitle: 'بازی اصیل ایرانی',
    playersLabel: '۲ نفره',
    durationLabel: '۱۰ تا ۲۰ دقیقه',
    available: false,
    accentColor: '#D4AE58',
    bgTint: '#101C32',
    artworkSrc: PLATFORM_ASSETS.backgammonArt,
    lightArtworkSrc: PLATFORM_ASSETS.backgammonArtLight,
  },
  {
    id: 'ludo',
    name: 'منچ',
    englishName: 'Ludo',
    subtitle: 'بازی گروهی و خانوادگی',
    playersLabel: '۲ تا ۴ نفره',
    durationLabel: '۱۵ تا ۲۵ دقیقه',
    available: false,
    accentColor: '#19A2A2',
    bgTint: '#101C32',
    artworkSrc: PLATFORM_ASSETS.ludoArt,
    lightArtworkSrc: PLATFORM_ASSETS.ludoArtLight,
  },
  {
    id: 'pasoor',
    name: 'چهاربرگ',
    englishName: 'Pasoor',
    subtitle: 'پاسور سنتی ۱۱ امتیازی',
    playersLabel: '۲ و ۴ نفره',
    durationLabel: '۱۰ تا ۱۵ دقیقه',
    available: false,
    accentColor: '#19A2A2',
    bgTint: '#101C32',
    artworkSrc: PLATFORM_ASSETS.pasoorArt,
    lightArtworkSrc: PLATFORM_ASSETS.pasoorArtLight,
  },
];
