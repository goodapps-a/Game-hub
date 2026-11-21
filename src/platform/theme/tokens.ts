export const EYVAN_THEME = {
  brandName: 'ایوان',
  brandSubtitle: 'پلتفرم بازی‌های فکری و سنتی',
  colors: {
    ivory: '#F6F3EC',
    alabaster: '#FCFBF8',
    sandstone: '#E5DDD0',
    lapis: '#13294B',
    lapisLight: '#1E3A63',
    turquoise: '#148A8A',
    turquoiseDark: '#0F6E6E',
    jade: '#155947',
    jadeDeep: '#0B352A',
    gold: '#B88B36',
    goldSoft: '#D6B46A',
    crimson: '#B83232',
    inkMuted: '#5A6577',
  },
} as const;

export type AnimationSpeed = 'slow' | 'normal' | 'fast';

export const ANIMATION_SPEED_FACTOR: Record<AnimationSpeed, number> = {
  slow: 1.55,
  normal: 1.0,
  fast: 0.55,
};

export const ANIMATION_SPEED_LABELS: Record<AnimationSpeed, string> = {
  slow: 'کند',
  normal: 'عادی',
  fast: 'سریع',
};

export function toPersianDigits(value: number | string): string {
  const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return String(value).replace(/\d/g, (d) => persianDigits[Number(d)]);
}
