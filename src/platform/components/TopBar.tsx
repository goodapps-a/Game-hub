import React from 'react';
import {
  ShoppingBag,
  Gamepad2,
  Users,
  Star,
  Sun,
  Moon,
} from 'lucide-react';
import { PlatformTabId, ThemeMode, UserProfile } from '../types/platform';
import { PLATFORM_ASSETS } from '../data/assets';
import { EyvanLogo } from '../theme/PersianPatterns';
import { toPersianDigits } from '../theme/tokens';

/**
 * Exact 3 clean platform navigation tabs (visually ordered Left-to-Right):
 * 1. فروشگاه (shop)
 * 2. بازی‌ها (games) — Center & primary tab
 * 3. دوستان (friends)
 */
export const NAV_TABS_LTR: Array<{
  id: PlatformTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isCenter?: boolean;
}> = [
  { id: 'shop', label: 'فروشگاه', icon: ShoppingBag },
  { id: 'games', label: 'بازی‌ها', icon: Gamepad2, isCenter: true },
  { id: 'friends', label: 'دوستان', icon: Users },
];

export const ProfileAvatar: React.FC<{
  avatarCode: UserProfile['avatarCode'];
  username: string;
  size?: 'sm' | 'md' | 'lg';
}> = ({ avatarCode, username, size = 'sm' }) => {
  const dims =
    size === 'lg'
      ? 'w-14 h-14 text-lg'
      : size === 'md'
        ? 'w-11 h-11 text-sm'
        : 'w-9 h-9 text-xs';

  if (avatarCode === 'portrait') {
    return (
      <div
        className={`${dims} rounded-full overflow-hidden shrink-0 border-2 border-[#D4AE58] shadow-[0_0_10px_rgba(212,174,88,0.28)] bg-[#13294B]`}
      >
        <img
          src={PLATFORM_ASSETS.userAvatar}
          alt={username}
          decoding="sync"
          loading="eager"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  const palette: Record<
    Exclude<UserProfile['avatarCode'], 'portrait'>,
    { bg: string; ring: string }
  > = {
    shamsa: { bg: '#13294B', ring: '#E6C167' },
    turquoise: { bg: '#0D8A8A', ring: '#E6C167' },
    lapis: { bg: '#1E3A63', ring: '#19A2A2' },
    jade: { bg: '#155947', ring: '#E6C167' },
  };
  const colors = palette[avatarCode];

  return (
    <div
      className={`${dims} rounded-full flex items-center justify-center font-extrabold text-[#FCFBF8] shrink-0 border-2 shadow-[0_0_10px_rgba(230,193,103,0.25)] uppercase`}
      style={{ backgroundColor: colors.bg, borderColor: colors.ring }}
      aria-hidden="true"
    >
      <span>{username.trim().slice(0, 1).toUpperCase() || 'A'}</span>
    </div>
  );
};

export const GoldCoinSvg: React.FC<{ size?: number }> = ({ size = 17 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="url(#goldCoin)" stroke="#F7DF92" strokeWidth="1.2" />
    <circle cx="12" cy="12" r="6.5" stroke="#8C6214" strokeWidth="1" strokeOpacity="0.6" />
    <path d="M12 8.2L13.5 12L12 15.8L10.5 12L12 8.2Z" fill="#FFF2BE" />
    <defs>
      <linearGradient id="goldCoin" x1="4" y1="3" x2="20" y2="21" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FCE28B" />
        <stop offset="0.55" stopColor="#D6A136" />
        <stop offset="1" stopColor="#9A6D17" />
      </linearGradient>
    </defs>
  </svg>
);

export const PurpleGemSvg: React.FC<{ size?: number }> = ({ size = 17 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6.5 4.5H17.5L21 9.5L12 20.5L3 9.5L6.5 4.5Z" fill="url(#gemGrad)" stroke="#E3B8FF" strokeWidth="1.1" />
    <path d="M3 9.5H21M8.5 4.5L7 9.5L12 20.5L17 9.5L15.5 4.5" stroke="#F4DFFF" strokeOpacity="0.5" strokeWidth="0.9" />
    <defs>
      <linearGradient id="gemGrad" x1="4" y1="4" x2="19" y2="20" gradientUnits="userSpaceOnUse">
        <stop stopColor="#D484FF" />
        <stop offset="0.5" stopColor="#8E3CE0" />
        <stop offset="1" stopColor="#4F1A8E" />
      </linearGradient>
    </defs>
  </svg>
);

interface TopBarProps {
  activeTab: PlatformTabId;
  onSelectTab: (tab: PlatformTabId) => void;
  profile: UserProfile;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
  isProfileOpen: boolean;
  onToggleProfile: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onSelectTab,
  profile,
  themeMode,
  onToggleTheme,
  isProfileOpen,
  onToggleProfile,
}) => {
  const xpPct = Math.min(
    100,
    Math.round((profile.xp / profile.xpToNextLevel) * 100)
  );
  const isLight = themeMode === 'light';

  return (
    <header
      className="sticky top-0 z-30 h-[56px] md:h-[68px] backdrop-blur-md border-b border-[var(--eyvan-gold-border)] px-3 sm:px-6 transform-gpu shadow-[0_2px_14px_rgba(12,26,52,0.08)]"
      style={{ backgroundColor: 'var(--eyvan-bar-bg)' }}
    >
      <div className="max-w-5xl mx-auto h-full flex items-center justify-between gap-2 md:gap-5">
        {/* User Profile Trigger */}
        <button
          type="button"
          onClick={onToggleProfile}
          aria-expanded={isProfileOpen}
          aria-label={`باز کردن پنل پروفایل ${profile.username}`}
          data-testid="profile-trigger"
          className="flex items-center gap-2 py-1 pr-1 pl-2 rounded-2xl hover:bg-black/5 transition-colors cursor-pointer shrink-0 min-h-[44px]"
        >
          <ProfileAvatar
            avatarCode={profile.avatarCode}
            username={profile.username}
            size="sm"
          />
          <div className="text-right leading-tight">
            <div
              dir="ltr"
              className="text-xs sm:text-sm font-extrabold theme-heading max-w-[104px] sm:max-w-[144px] truncate text-left"
            >
              {profile.username}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={`inline-flex items-center gap-0.5 text-[10px] font-bold tabular-nums whitespace-nowrap ${
                  isLight ? 'text-[#0B7C7E]' : 'text-[#F2D27B]'
                }`}
              >
                <Star className="w-2.5 h-2.5 fill-current" />
                سطح {toPersianDigits(profile.level)}
              </span>
              <span
                className={`w-10 sm:w-16 h-1.5 rounded-full overflow-hidden hidden sm:inline-block ${
                  isLight
                    ? 'bg-[#DCE8F2] border border-[#0D8A8A]/25'
                    : 'bg-[#1C2C49] border border-[#D4AE58]/30'
                }`}
              >
                <span
                  className={`block h-full rounded-full ${
                    isLight
                      ? 'bg-gradient-to-r from-[#0D8A8A] to-[#2BB8B8]'
                      : 'bg-gradient-to-r from-[#C89431] to-[#F3D27C]'
                  }`}
                  style={{ width: `${xpPct}%` }}
                />
              </span>
            </div>
          </div>
        </button>

        {/* Desktop 3-Tab Navigation strictly ordered Left-to-Right */}
        <nav
          dir="ltr"
          aria-label="ناوبری اصلی پلتفرم"
          className="hidden md:flex items-center gap-2"
        >
          {NAV_TABS_LTR.map((tab) => {
            const active = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                dir="rtl"
                onClick={() => onSelectTab(tab.id)}
                aria-current={active ? 'page' : undefined}
                data-tab-id={tab.id}
                className={`min-h-[40px] px-4 py-2 rounded-xl flex items-center gap-2 text-xs lg:text-sm whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                  tab.isCenter
                    ? active
                      ? isLight
                        ? 'bg-gradient-to-l from-[#0F274D] to-[#163A6E] text-[#FFFFFF] font-extrabold border border-[#0D8A8A]/40 shadow-[0_6px_16px_rgba(15,39,77,0.22)]'
                        : 'bg-[#172844] text-[#F3D27C] font-extrabold border border-[#D4AE58]/70 shadow-[0_0_16px_rgba(212,174,88,0.2)]'
                      : isLight
                        ? 'bg-[#EAF3F8] text-[#0F274D] hover:bg-[#DDEBF3] font-bold border border-[#0D8A8A]/25'
                        : 'bg-[#111E35] text-[#F5EFE4] hover:border-[#D4AE58]/50 font-bold border border-[#D4AE58]/30'
                    : active
                      ? isLight
                        ? 'bg-[#E5F5F5] text-[#0B7C7E] font-extrabold border border-[#0D8A8A]/35'
                        : 'text-[#F3D27C] font-bold border-b-2 border-[#D4AE58] rounded-b-none'
                      : isLight
                        ? 'text-[#4D6380] hover:text-[#0F274D] hover:bg-[#F0F5FA] font-semibold'
                        : 'text-[#9EB0C8] hover:text-[#F5EFE4] font-medium'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Right/End Cluster: Coins + Gems + Dark/Light Mode Toggle + Crest */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onSelectTab('shop')}
            aria-label="مشاهده سکه در فروشگاه"
            style={{ backgroundColor: 'var(--eyvan-pill-bg)' }}
            className="min-h-[34px] px-2 sm:px-2.5 py-1 rounded-full border border-[var(--eyvan-gold-border)] hover:border-[#D4AE58] flex items-center gap-1 text-[11px] sm:text-xs font-bold theme-heading tabular-nums transition-colors cursor-pointer whitespace-nowrap"
          >
            <GoldCoinSvg />
            <span>{toPersianDigits(profile.coins.toLocaleString())}</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('shop')}
            aria-label="مشاهده الماس در فروشگاه"
            style={{ backgroundColor: 'var(--eyvan-pill-bg)' }}
            className="min-h-[34px] px-2 sm:px-2.5 py-1 rounded-full border border-[var(--eyvan-gold-border)] hover:border-[#D4AE58] flex items-center gap-1 text-[11px] sm:text-xs font-bold theme-heading tabular-nums transition-colors cursor-pointer whitespace-nowrap"
          >
            <PurpleGemSvg />
            <span>{toPersianDigits(profile.gems.toLocaleString())}</span>
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            data-testid="theme-toggle-btn"
            aria-label={
              themeMode === 'dark' ? 'تغییر به حالت روشن' : 'تغییر به حالت تاریک'
            }
            style={{ backgroundColor: 'var(--eyvan-pill-bg)' }}
            className="w-[34px] h-[34px] sm:w-[38px] sm:h-[38px] rounded-full border border-[var(--eyvan-gold-border)] hover:border-[#0D8A8A] flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            {themeMode === 'dark' ? (
              <Sun className="w-4 h-4 text-[#F3D179]" />
            ) : (
              <Moon className="w-4 h-4 text-[#0F274D]" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('games')}
            aria-label="ایوان"
            className="hidden lg:flex items-center gap-1.5 pr-1 cursor-pointer"
          >
            <EyvanLogo size={32} />
          </button>
        </div>
      </div>
    </header>
  );
};
