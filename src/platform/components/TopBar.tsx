import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Moon,
  Music,
  Share,
  SlidersHorizontal,
  Star,
  Sun,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { PlatformTabId, ThemeMode, UserProfile } from '../types/platform';
import { PLATFORM_ASSETS } from '../data/assets';
import { EyvanLogo } from '../theme/PersianPatterns';
import { toPersianDigits } from '../theme/tokens';
import { computeXpProgress } from '../utils/profileMetrics';
import { CurrencyCapsule, GoldCoinSvg, PurpleGemSvg } from './CurrencyBadges';
import { usePWAInstall } from '../pwa/usePWAInstall';

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
  musicEnabled?: boolean;
  sfxEnabled?: boolean;
  onToggleMusic?: () => void;
  onToggleSfx?: () => void;
  isProfileOpen: boolean;
  onToggleProfile: () => void;
  onOpenAuth?: (mode: 'login' | 'register') => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  onSelectTab,
  profile,
  themeMode,
  onToggleTheme,
  musicEnabled = true,
  sfxEnabled = true,
  onToggleMusic,
  onToggleSfx,
  isProfileOpen,
  onToggleProfile,
}) => {
  const xpPct = computeXpProgress(profile.xp, profile.xpToNextLevel).percent;
  const isLight = themeMode === 'light';
  const [quickOpen, setQuickOpen] = useState(false);
  const [installGuideOpen, setInstallGuideOpen] = useState(false);
  const [installingPwa, setInstallingPwa] = useState(false);
  const quickMenuRef = useRef<HTMLDivElement>(null);
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  useEffect(() => {
    if (!quickOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (
        quickMenuRef.current &&
        !quickMenuRef.current.contains(e.target as Node)
      ) {
        setQuickOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setQuickOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [quickOpen]);

  const handleInstallGame = async () => {
    setQuickOpen(false);
    if (isInstalled) return;
    if (isInstallable) {
      setInstallingPwa(true);
      try {
        await install();
      } finally {
        setInstallingPwa(false);
      }
      return;
    }
    setInstallGuideOpen(true);
  };

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

          {/* Quick Controls Popover Trigger (replaces standalone dark-mode button) */}
          <div ref={quickMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setQuickOpen((prev) => !prev)}
              data-testid="quick-controls-btn"
              aria-label="تنظیمات سریع صدا، تم و نصب بازی"
              aria-expanded={quickOpen}
              style={{ backgroundColor: 'var(--eyvan-pill-bg)' }}
              className={`w-[36px] h-[36px] sm:w-[40px] sm:h-[40px] rounded-full border flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                quickOpen
                  ? 'border-[var(--eyvan-teal)] ring-2 ring-[var(--eyvan-teal)]/30'
                  : 'border-[var(--eyvan-line)] hover:border-[var(--eyvan-teal)]'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4 theme-heading" />
            </button>

            {quickOpen && (
              <div
                dir="rtl"
                data-testid="quick-controls-popover"
                className="absolute left-0 top-[calc(100%+10px)] z-50 w-56 rounded-2xl theme-drawer border border-[var(--eyvan-gold-border)] shadow-[0_18px_46px_rgba(0,0,0,0.42)] p-2 space-y-1 backdrop-blur-xl"
              >
                {/* 1. Dark / Light Theme */}
                <button
                  type="button"
                  onClick={onToggleTheme}
                  data-testid="theme-toggle-btn"
                  className="w-full min-h-[42px] px-3 py-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/[0.06] flex items-center justify-between gap-2.5 transition-colors cursor-pointer text-right"
                >
                  <span className="flex items-center gap-2.5 text-xs font-extrabold theme-heading">
                    {themeMode === 'dark' ? (
                      <Sun className="w-4 h-4 text-[#F3D179] shrink-0" />
                    ) : (
                      <Moon className="w-4 h-4 text-[#0D8A8A] shrink-0" />
                    )}
                    <span>{themeMode === 'dark' ? 'حالت روشن' : 'حالت تاریک'}</span>
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                      themeMode === 'dark'
                        ? 'bg-[#F3D179]/20 text-[#F3D179]'
                        : 'bg-[#0D8A8A]/15 text-[#0D8A8A]'
                    }`}
                  >
                    {themeMode === 'dark' ? 'تاریک' : 'روشن'}
                  </span>
                </button>

                {/* 2. Background Music Mute/Unmute */}
                <button
                  type="button"
                  onClick={() => onToggleMusic?.()}
                  data-testid="music-toggle-btn"
                  aria-pressed={musicEnabled}
                  className="w-full min-h-[42px] px-3 py-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/[0.06] flex items-center justify-between gap-2.5 transition-colors cursor-pointer text-right"
                >
                  <span className="flex items-center gap-2.5 text-xs font-extrabold theme-heading">
                    <Music
                      className={`w-4 h-4 shrink-0 ${
                        musicEnabled ? 'text-[#2CC5BE]' : 'theme-muted opacity-60'
                      }`}
                    />
                    <span>موسیقی پس‌زمینه</span>
                  </span>
                  <span
                    className={`w-9 h-5 rounded-full p-0.5 flex items-center transition-colors ${
                      musicEnabled
                        ? 'bg-[#0D8A8A] justify-start'
                        : 'bg-[#64748B]/70 justify-end'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full bg-white shadow-xs block" />
                  </span>
                </button>

                {/* 3. Sound Effects (SFX) Mute/Unmute */}
                <button
                  type="button"
                  onClick={() => onToggleSfx?.()}
                  data-testid="sfx-toggle-btn"
                  aria-pressed={sfxEnabled}
                  className="w-full min-h-[42px] px-3 py-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/[0.06] flex items-center justify-between gap-2.5 transition-colors cursor-pointer text-right"
                >
                  <span className="flex items-center gap-2.5 text-xs font-extrabold theme-heading">
                    {sfxEnabled ? (
                      <Volume2 className="w-4 h-4 text-[#2CC5BE] shrink-0" />
                    ) : (
                      <VolumeX className="w-4 h-4 theme-muted opacity-60 shrink-0" />
                    )}
                    <span>صدای بازی</span>
                  </span>
                  <span
                    className={`w-9 h-5 rounded-full p-0.5 flex items-center transition-colors ${
                      sfxEnabled
                        ? 'bg-[#0D8A8A] justify-start'
                        : 'bg-[#64748B]/70 justify-end'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full bg-white shadow-xs block" />
                  </span>
                </button>

                <div className="h-px bg-[var(--eyvan-line)] my-1" />

                {/* 4. Install Game (PWA) */}
                <button
                  type="button"
                  disabled={installingPwa || isInstalled}
                  onClick={() => void handleInstallGame()}
                  data-testid="topbar-pwa-install-btn"
                  className={`w-full min-h-[42px] px-3 py-2 rounded-xl flex items-center justify-between gap-2.5 transition-colors text-right ${
                    isInstalled
                      ? 'opacity-75 cursor-default'
                      : 'bg-[#D4AE58]/16 hover:bg-[#D4AE58]/26 cursor-pointer'
                  }`}
                >
                  <span className="flex items-center gap-2.5 text-xs font-black theme-heading">
                    {isInstalled ? (
                      <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0" />
                    ) : (
                      <Download className="w-4 h-4 theme-accent-gold shrink-0" />
                    )}
                    <span>{isInstalled ? 'بازی نصب شده' : 'نصب بازی'}</span>
                  </span>
                  {!isInstalled && (
                    <span className="text-[10px] font-black theme-accent-gold">
                      اپلیکیشن
                    </span>
                  )}
                </button>
              </div>
            )}
          </div>

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

      {/* Inline PWA Install Guide Modal when triggered from Quick Controls on iOS / Desktop */}
      {installGuideOpen && (
        <div
          dir="rtl"
          className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="راهنمای نصب بازی ایوان"
        >
          <div
            className="fixed inset-0"
            onClick={() => setInstallGuideOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-full max-w-sm rounded-3xl theme-drawer border border-[var(--eyvan-gold-border)] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <img
                  src="/pwa-192x192.png"
                  alt="ایوان"
                  className="w-10 h-10 rounded-xl border border-[#D4AE58]/40"
                />
                <div>
                  <h3 className="text-sm font-black theme-heading">
                    نصب بازی ایوان روی صفحه اصلی
                  </h3>
                  <p className="text-[11px] theme-muted">
                    {isIOS ? 'راهنمای Safari در iPhone و iPad' : 'راهنمای مرورگر'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInstallGuideOpen(false)}
                aria-label="بستن"
                className="w-9 h-9 rounded-xl flex items-center justify-center theme-muted hover:theme-heading cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <ol className="space-y-2 text-xs theme-heading leading-relaxed">
                <li className="flex items-start gap-2">
                  <span className="font-black theme-accent-gold">۱.</span>
                  <span>
                    در پایین صفحه Safari دکمه{' '}
                    <strong className="inline-flex items-center gap-1">
                      <Share className="w-3.5 h-3.5 inline" /> Share
                    </strong>{' '}
                    را بزنید.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-black theme-accent-gold">۲.</span>
                  <span>
                    گزینه <strong>Add to Home Screen</strong> را بزنید.
                  </span>
                </li>
              </ol>
            ) : (
              <ol className="space-y-2 text-xs theme-heading leading-relaxed">
                <li className="flex items-start gap-2">
                  <span className="font-black theme-accent-gold">۱.</span>
                  <span>منوی مرورگر (سه نقطه بالای صفحه) را باز کنید.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-black theme-accent-gold">۲.</span>
                  <span>
                    گزینه <strong>Install app</strong> یا{' '}
                    <strong>Add to Home screen</strong> را انتخاب کنید.
                  </span>
                </li>
              </ol>
            )}

            <button
              type="button"
              onClick={() => setInstallGuideOpen(false)}
              className="w-full min-h-[42px] rounded-xl theme-btn-secondary border text-xs font-extrabold cursor-pointer"
            >
              متوجه شدم
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
