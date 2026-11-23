import React from 'react';
import {
  Star,
  Sun,
  Moon,
} from 'lucide-react';
import { PlatformTabId, ThemeMode, UserProfile } from '../types/platform';
import { PLATFORM_ASSETS } from '../data/assets';
import { EyvanLogo } from '../theme/PersianPatterns';
import { toPersianDigits } from '../theme/tokens';
import { computeXpProgress } from '../utils/profileMetrics';
import { CurrencyCapsule, GoldCoinSvg, PurpleGemSvg } from './CurrencyBadges';

export { GoldCoinSvg, PurpleGemSvg, CurrencyCapsule };

export const ProfileAvatar: React.FC<{
  avatarCode: UserProfile['avatarCode'];
  username: string;
  customAvatarUrl?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}> = ({ avatarCode, username, customAvatarUrl = null, size = 'sm' }) => {
  const dims =
    size === 'xl'
      ? 'w-[80px] h-[80px] text-2xl'
      : size === 'lg'
        ? 'w-14 h-14 text-lg'
        : size === 'md'
          ? 'w-11 h-11 text-sm'
          : 'w-9 h-9 text-xs';

  if (customAvatarUrl) {
    return (
      <div
        className={`${dims} rounded-full overflow-hidden shrink-0 border-2 border-[#D4AE58] shadow-[0_0_12px_rgba(212,174,88,0.3)] bg-[#13294B]`}
      >
        <img
          src={customAvatarUrl}
          alt={username}
          decoding="sync"
          loading="eager"
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

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

interface TopBarProps {
  activeTab: PlatformTabId;
  onSelectTab: (tab: PlatformTabId) => void;
  profile: UserProfile;
  isAuthenticated?: boolean;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
  isProfileOpen: boolean;
  onToggleProfile: () => void;
  onOpenAuth?: (mode: 'login' | 'register') => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  onSelectTab,
  profile,
  themeMode,
  onToggleTheme,
  isProfileOpen,
  onToggleProfile,
}) => {
  const xpPct = computeXpProgress(profile.xp, profile.xpToNextLevel).percent;
  const isLight = themeMode === 'light';

  return (
    <header
      className="sticky top-0 z-30 h-[58px] md:h-[68px] backdrop-blur-md border-b border-[var(--eyvan-line)] px-2.5 sm:px-6 transform-gpu shadow-[0_2px_14px_rgba(12,26,52,0.06)]"
      style={{ backgroundColor: 'var(--eyvan-bar-bg)' }}
    >
      <div className="max-w-5xl mx-auto h-full flex items-center justify-between gap-2 sm:gap-4">
        {/* User Profile Trigger */}
        <button
          type="button"
          onClick={onToggleProfile}
          aria-expanded={isProfileOpen}
          aria-label={`باز کردن پنل پروفایل ${profile.username}`}
          data-testid="profile-trigger"
          className="flex items-center gap-2 py-1 pr-0.5 pl-1.5 rounded-2xl hover:bg-black/5 transition-colors cursor-pointer shrink-0 min-h-[44px]"
        >
          <ProfileAvatar
            avatarCode={profile.avatarCode}
            customAvatarUrl={profile.customAvatarUrl}
            username={profile.username}
            size="sm"
          />
          <div className="text-right leading-tight">
            <div
              dir="ltr"
              className="text-xs sm:text-sm font-extrabold theme-heading max-w-[92px] sm:max-w-[152px] truncate text-left"
            >
              {profile.username}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={`inline-flex items-center gap-0.5 text-[10px] font-bold tabular-nums whitespace-nowrap ${
                  isLight ? 'text-[#0D8A8A]' : 'text-[#F2D27B]'
                }`}
              >
                <Star className="w-2.5 h-2.5 fill-current" />
                سطح {toPersianDigits(profile.level)}
              </span>
              <span
                className={`w-10 sm:w-16 h-1.5 rounded-full overflow-hidden hidden sm:inline-block ${
                  isLight
                    ? 'bg-[#E2E8F0]'
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

        {/* Left/End Cluster: Always-visible Coins & Gems (taps open Shop) + Theme Toggle + Crest */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3.5 pl-0.5 pr-1">
            <CurrencyCapsule
              kind="coins"
              amount={profile.coins}
              onClick={() => onSelectTab('shop')}
              ariaLabel="مشاهده سکه در فروشگاه"
            />
            <CurrencyCapsule
              kind="gems"
              amount={profile.gems}
              onClick={() => onSelectTab('shop')}
              ariaLabel="مشاهده الماس در فروشگاه"
            />
          </div>

          <button
            type="button"
            onClick={onToggleTheme}
            data-testid="theme-toggle-btn"
            aria-label={
              themeMode === 'dark' ? 'تغییر به حالت روشن' : 'تغییر به حالت تاریک'
            }
            style={{ backgroundColor: 'var(--eyvan-pill-bg)' }}
            className="w-[34px] h-[34px] sm:w-[38px] sm:h-[38px] rounded-full border border-[var(--eyvan-line)] hover:border-[var(--eyvan-teal)] flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            {themeMode === 'dark' ? (
              <Sun className="w-4 h-4 text-[#F3D179]" />
            ) : (
              <Moon className="w-4 h-4 text-[#0F172A]" />
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
