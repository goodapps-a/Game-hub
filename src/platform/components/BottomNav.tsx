import React from 'react';
import { PlatformTabId } from '../types/platform';
import { NAV_TABS_LTR } from './TopBar';

interface BottomNavProps {
  activeTab: PlatformTabId;
  onSelectTab: (tab: PlatformTabId) => void;
}

/**
 * Mobile fixed bottom navigation dock (Dark & Light Mode adaptive):
 * 3 balanced tabs strictly ordered Left-to-Right: فروشگاه | بازی‌ها | دوستان.
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
        className="backdrop-blur-md border-t border-[var(--eyvan-gold-border)] rounded-t-[22px] shadow-[0_-8px_24px_rgba(10,24,48,0.18)]"
        style={{ backgroundColor: 'var(--eyvan-dock-bg)' }}
      >
        <div className="grid grid-cols-3 items-center h-[60px] px-2">
          {NAV_TABS_LTR.map((tab) => {
            const active = activeTab === tab.id;
            const Icon = tab.icon;

            if (tab.isCenter) {
              return (
                <button
                  key={tab.id}
                  type="button"
                  dir="rtl"
                  onClick={() => onSelectTab(tab.id)}
                  aria-current={active ? 'page' : undefined}
                  data-mobile-tab={tab.id}
                  className="relative flex flex-col items-center justify-center h-full cursor-pointer focus-visible:outline-none"
                >
                  {active && (
                    <span
                      className="absolute top-0 left-5 right-5 h-[2px] bg-gradient-to-r from-transparent via-[var(--eyvan-gold)] to-transparent"
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className={`w-12 h-7 rounded-xl flex items-center justify-center transition-colors ${
                      active ? 'text-[var(--eyvan-gold)]' : 'theme-muted'
                    }`}
                  >
                    <Icon className="w-6 h-6" />
                  </span>
                  <span
                    className={`text-[11px] mt-0.5 whitespace-nowrap ${
                      active
                        ? 'font-extrabold text-[var(--eyvan-gold)]'
                        : 'font-bold theme-muted'
                    }`}
                  >
                    {tab.label}
                  </span>
                  {active && (
                    <span
                      className="absolute bottom-0 left-6 right-6 h-[3px] rounded-t-full bg-[var(--eyvan-gold)]"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            }

            return (
              <button
                key={tab.id}
                type="button"
                dir="rtl"
                onClick={() => onSelectTab(tab.id)}
                aria-current={active ? 'page' : undefined}
                data-mobile-tab={tab.id}
                className={`relative flex flex-col items-center justify-center min-h-[48px] transition-colors cursor-pointer focus-visible:outline-none ${
                  active ? 'text-[var(--eyvan-gold)]' : 'theme-muted'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span
                  className={`text-[11px] mt-1 whitespace-nowrap ${
                    active ? 'font-extrabold' : 'font-semibold'
                  }`}
                >
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
        <div className="h-2 w-full persian-dock-strip border-t border-[var(--eyvan-gold-border)] pb-safe" />
      </div>
    </nav>
  );
};
