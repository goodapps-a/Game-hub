import React from 'react';
import { Gamepad2, Store, Users } from 'lucide-react';
import { PlatformTabId } from '../types/platform';

interface BottomNavProps {
  activeTab: PlatformTabId;
  onSelectTab: (tab: PlatformTabId) => void;
  themeMode?: 'dark' | 'light';
}

/**
 * Floating Pill Bottom Dock (Dark & Light Mode adaptive):
 * Styled cleanly after the reference screenshot:
 * - Centered frosted capsule (`rounded-full`) floating above bottom safe area
 * - Raised circular central Games medallion with crisp emerald/gold accent ring
 * - Strictly ordered Left-to-Right: فروشگاه (Left) | بازی‌ها (Center) | دوستان (Right)
 */
export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onSelectTab,
  themeMode = 'dark',
}) => {
  const isLight = themeMode === 'light';
  const gamesActive = activeTab === 'games';
  const shopActive = activeTab === 'shop';
  const friendsActive = activeTab === 'friends';

  return (
    <nav
      dir="ltr"
      aria-label="ناوبری اصلی پایین"
      data-testid="mobile-bottom-nav"
      className="fixed bottom-3.5 sm:bottom-5 left-1/2 -translate-x-1/2 z-30 pb-safe transform-gpu"
    >
      <div
        className={`relative flex items-center justify-between gap-2 sm:gap-3 h-[56px] px-3 sm:px-4 rounded-full backdrop-blur-xl border transition-colors duration-200 ${
          isLight
            ? 'bg-white/92 border-[#CBD8E6] shadow-[0_14px_36px_rgba(15,23,42,0.14),0_2px_8px_rgba(15,23,42,0.06)]'
            : 'bg-[#101824]/90 border-white/14 shadow-[0_16px_42px_rgba(0,0,0,0.58),inset_0_1px_0_rgba(255,255,255,0.08)]'
        }`}
      >
        {/* LEFT: فروشگاه */}
        <button
          type="button"
          dir="rtl"
          onClick={() => onSelectTab('shop')}
          aria-label="فروشگاه"
          aria-current={shopActive ? 'page' : undefined}
          data-mobile-tab="shop"
          data-testid="bottom-nav-shop"
          className={`min-w-[66px] sm:min-w-[76px] h-[44px] px-2.5 rounded-full flex items-center justify-center gap-1.5 cursor-pointer select-none transition-all duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2CC5BE] ${
            shopActive
              ? isLight
                ? 'bg-[#0D8A8A]/12 text-[#0D8A8A]'
                : 'bg-[#19A2A2]/18 text-[#5EEAD4]'
              : isLight
                ? 'text-[#526075] hover:text-[#0F172A] hover:bg-black/5'
                : 'text-[#9EB0C8] hover:text-white hover:bg-white/6'
          }`}
        >
          <Store className="w-[19px] h-[19px] shrink-0 stroke-[2.15]" />
          <span className="text-[11px] font-extrabold whitespace-nowrap">
            فروشگاه
          </span>
        </button>

        {/* CENTER: بازی‌ها (Raised Circular Medallion Matching Reference) */}
        <button
          type="button"
          dir="rtl"
          onClick={() => onSelectTab('games')}
          aria-label="بازی‌ها"
          aria-current={gamesActive ? 'page' : undefined}
          data-mobile-tab="games"
          data-testid="bottom-nav-games"
          className={`relative -my-3 w-[64px] h-[64px] rounded-full flex flex-col items-center justify-center gap-0.5 cursor-pointer select-none transition-all duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3D179] shrink-0 ${
            gamesActive
              ? isLight
                ? 'bg-gradient-to-b from-[#FFFFFF] to-[#EDF6F5] text-[#0D8A8A] border-[2px] border-[#0D8A8A] shadow-[0_8px_24px_rgba(13,138,138,0.28),0_0_0_4px_rgba(13,138,138,0.10)]'
                : 'bg-gradient-to-b from-[#16273B] to-[#0D1928] text-[#4CE4B8] border-[2px] border-[#4CE4B8] shadow-[0_10px_28px_rgba(0,0,0,0.6),0_0_20px_rgba(76,228,184,0.28)]'
              : isLight
                ? 'bg-gradient-to-b from-[#FFFFFF] to-[#F1F5F9] text-[#475569] border border-[#CBD8E6] hover:border-[#0D8A8A]/60 shadow-[0_6px_18px_rgba(15,23,42,0.12)]'
                : 'bg-gradient-to-b from-[#172336] to-[#0E1725] text-[#CBD5E1] border border-white/18 hover:border-[#F3D179]/55 shadow-[0_8px_22px_rgba(0,0,0,0.48)]'
          }`}
        >
          <Gamepad2 className="w-[22px] h-[22px] shrink-0 stroke-[2.2]" />
          <span className="text-[10px] font-black leading-none whitespace-nowrap">
            بازی‌ها
          </span>
        </button>

        {/* RIGHT: دوستان */}
        <button
          type="button"
          dir="rtl"
          onClick={() => onSelectTab('friends')}
          aria-label="دوستان"
          aria-current={friendsActive ? 'page' : undefined}
          data-mobile-tab="friends"
          data-testid="floating-friends-btn"
          className={`min-w-[66px] sm:min-w-[76px] h-[44px] px-2.5 rounded-full flex items-center justify-center gap-1.5 cursor-pointer select-none transition-all duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2CC5BE] ${
            friendsActive
              ? isLight
                ? 'bg-[#0D8A8A]/12 text-[#0D8A8A]'
                : 'bg-[#19A2A2]/18 text-[#5EEAD4]'
              : isLight
                ? 'text-[#526075] hover:text-[#0F172A] hover:bg-black/5'
                : 'text-[#9EB0C8] hover:text-white hover:bg-white/6'
          }`}
        >
          <Users className="w-[19px] h-[19px] shrink-0 stroke-[2.15]" />
          <span className="text-[11px] font-extrabold whitespace-nowrap">
            دوستان
          </span>
        </button>
      </div>
    </nav>
  );
};
