import React from 'react';
import { PlatformTabId } from '../types/platform';
import { NAV_TABS_LTR } from './TopBar';

interface BottomNavProps {
  activeTab: PlatformTabId;
  onSelectTab: (tab: PlatformTabId) => void;
}

/**
 * Balanced mobile fixed bottom navigation dock (Dark & Light Mode adaptive):
 * 3 tabs strictly ordered Left-to-Right: فروشگاه | بازی‌ها | دوستان.
 * Accessibility: >=48px touch hitboxes, focus-visible rings, safe-area support,
 * zero horizontal overflow down to 320px viewports.
 */
export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onSelectTab,
}) => {
  return (
    <nav
      dir="ltr"
      aria-label="ناوبری پایین موبایل"
      data-testid="mobile-bottom-nav"
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 transform-gpu"
    >
      <div
        className="backdrop-blur-md border-t border-[var(--eyvan-line)] pb-safe shadow-[0_-4px_16px_rgba(8,16,30,0.12)]"
        style={{ backgroundColor: 'var(--eyvan-dock-bg)' }}
      >
        <div className="grid grid-cols-3 items-stretch h-[60px] max-w-md mx-auto px-1.5 gap-1">
          {NAV_TABS_LTR.map((tab) => {
            const active = activeTab === tab.id;
            const Icon = tab.icon;
            const isCenter = Boolean(tab.isCenter);

            return (
              <button
                key={tab.id}
                type="button"
                dir="rtl"
                onClick={() => onSelectTab(tab.id)}
                aria-current={active ? 'page' : undefined}
                data-mobile-tab={tab.id}
                className={`relative min-w-0 min-h-[48px] px-1 py-1 rounded-xl flex flex-col items-center justify-center gap-0.5 cursor-pointer select-none transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--eyvan-teal)] ${
                  active
                    ? isCenter
                      ? 'theme-accent-gold'
                      : 'theme-accent-teal'
                    : 'theme-muted hover:bg-black/5'
                }`}
              >
                {/* Clean single active indicator hairline at top */}
                <span
                  aria-hidden="true"
                  className={`h-[2.5px] w-7 rounded-full transition-opacity duration-150 mb-0.5 ${
                    active
                      ? isCenter
                        ? 'bg-[var(--eyvan-gold-text)] opacity-100'
                        : 'bg-[var(--eyvan-teal)] opacity-100'
                      : 'opacity-0'
                  }`}
                />

                {/* Balanced icon capsule: subtle center emphasis without visual noise */}
                <span
                  className={`w-10 h-7 rounded-lg flex items-center justify-center transition-colors duration-150 ${
                    active
                      ? isCenter
                        ? 'bg-[#D4AE58]/18 border border-[#D4AE58]/45'
                        : 'bg-[#0D8A8A]/14'
                      : ''
                  }`}
                >
                  <Icon className="w-[20px] h-[20px] shrink-0" />
                </span>

                <span
                  className={`text-[11px] leading-tight truncate max-w-full ${
                    active ? 'font-extrabold' : 'font-semibold'
                  }`}
                >
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
};
