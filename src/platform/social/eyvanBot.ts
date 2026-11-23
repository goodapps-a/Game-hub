/**
 * Eyvan Built-in Contact ("ایوان")
 * - Appears inside the authenticated Friends list just like any regular online friend.
 * - Strictly one-way announcements / updates from Eyvan (no reply box).
 * - Tracks read state locally in localStorage without altering server DB or APIs.
 */

export interface EyvanBotAnnouncement {
  readonly id: string;
  readonly body: string;
  readonly timeLabel: string;
}

export const EYVAN_OFFICIAL_BOT = {
  id: 'eyvan_official_bot',
  displayName: 'ایوان',
  statusLabel: 'آنلاین',
} as const;

export const EYVAN_BOT_ANNOUNCEMENTS: readonly EyvanBotAnnouncement[] = [
  {
    id: 'eyvan-ann-welcome',
    body: 'سلام دوست عزیز! به ایوان خوش آمدید. خبرهای مهم، رویدادها و تورنمنت‌های جدید حکم اینجا برای شما ارسال می‌شود.',
    timeLabel: '۱۰:۰۰',
  },
  {
    id: 'eyvan-ann-hokm',
    body: 'چینش کارت‌های حکم اکنون به‌ترتیب دل، پیک، خشت و گشنیز مرتب می‌شود و کشیدن کارت‌ها روی موبایل روان‌تر شده است.',
    timeLabel: '۱۴:۳۰',
  },
  {
    id: 'eyvan-ann-pwa',
    body: 'می‌توانید اپلیکیشن ایوان را روی صفحه اصلی گوشی خود نصب کنید تا با سرعت بالاتر و نمای تمام‌صفحه وارد بازی شوید.',
    timeLabel: '۱۸:۱۵',
  },
];

const LAST_READ_KEY = 'eyvan_bot_last_read_id_v1';

export function getEyvanBotUnreadCount(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const lastReadId = window.localStorage.getItem(LAST_READ_KEY);
    const latest = EYVAN_BOT_ANNOUNCEMENTS[EYVAN_BOT_ANNOUNCEMENTS.length - 1];
    if (!latest) return 0;
    return lastReadId === latest.id ? 0 : 1;
  } catch {
    return 0;
  }
}

export function markEyvanBotAnnouncementsRead(): void {
  if (typeof window === 'undefined') return;
  try {
    const latest = EYVAN_BOT_ANNOUNCEMENTS[EYVAN_BOT_ANNOUNCEMENTS.length - 1];
    if (latest) {
      window.localStorage.setItem(LAST_READ_KEY, latest.id);
    }
  } catch {
    // Ignore storage restriction
  }
}
