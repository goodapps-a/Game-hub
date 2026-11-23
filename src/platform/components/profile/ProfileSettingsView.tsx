import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { ANIMATION_SPEED_LABELS, AnimationSpeed } from '../../theme/tokens';
import { UserProfile } from '../../types/platform';
import { PWAInstallButton } from '../PWAInstallButton';

interface ProfileSettingsViewProps {
  profile: UserProfile;
  onUpdateProfile: (updater: (prev: UserProfile) => UserProfile) => void;
}

export const ProfileSettingsView: React.FC<ProfileSettingsViewProps> = ({
  profile,
  onUpdateProfile,
}) => {
  const { themeMode, soundEnabled, reducedMotion, animationSpeed } =
    profile.appSettings;

  return (
    <div
      className="divide-y divide-[var(--eyvan-line)]"
      data-testid="profile-settings-view"
    >
      {/* Theme Selection */}
      <section className="pb-5 space-y-2.5">
        <div className="text-xs sm:text-sm font-extrabold theme-heading">
          حالت نمایش
        </div>
        <div className="grid grid-cols-2 gap-1 p-1 theme-tab-track rounded-xl">
          <button
            type="button"
            onClick={() =>
              onUpdateProfile((prev) => ({
                ...prev,
                appSettings: { ...prev.appSettings, themeMode: 'dark' },
              }))
            }
            aria-pressed={themeMode === 'dark'}
            className={`min-h-[42px] rounded-lg text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
              themeMode === 'dark'
                ? 'bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1528]'
                : 'theme-muted hover:text-[var(--eyvan-text)]'
            }`}
          >
            <Moon className="w-3.5 h-3.5" />
            <span>تاریک</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onUpdateProfile((prev) => ({
                ...prev,
                appSettings: { ...prev.appSettings, themeMode: 'light' },
              }))
            }
            aria-pressed={themeMode === 'light'}
            className={`min-h-[42px] rounded-lg text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
              themeMode === 'light'
                ? 'bg-[#0D8A8A] text-white'
                : 'theme-muted hover:text-[var(--eyvan-text)]'
            }`}
          >
            <Sun className="w-3.5 h-3.5" />
            <span>روشن</span>
          </button>
        </div>
      </section>

      {/* Sound & Motion Switches */}
      <section className="py-2 divide-y divide-[var(--eyvan-line)]">
        <div className="flex items-center justify-between gap-3 py-3.5 min-h-[60px]">
          <div className="min-w-0">
            <div className="text-xs sm:text-sm font-bold theme-heading">
              صدای افکت‌های بازی
            </div>
            <div className="text-[11px] theme-muted mt-0.5">
              پخش صدای ورق‌ها و جلوه‌های صوتی میز حکم
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={soundEnabled}
            aria-label="صدای افکت‌های بازی"
            onClick={() =>
              onUpdateProfile((prev) => ({
                ...prev,
                appSettings: {
                  ...prev.appSettings,
                  soundEnabled: !prev.appSettings.soundEnabled,
                },
              }))
            }
            className={`w-12 h-7 rounded-full p-1 transition-colors flex items-center shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--eyvan-teal)] ${
              soundEnabled
                ? 'bg-[#0D8A8A] justify-start'
                : 'bg-[#64748B] justify-end'
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-white shadow-xs block" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 py-3.5 min-h-[60px]">
          <div className="min-w-0">
            <div className="text-xs sm:text-sm font-bold theme-heading">
              کاهش حرکت انیمیشن‌ها
            </div>
            <div className="text-[11px] theme-muted mt-0.5">
              کاهش جابه‌جایی‌های سریع و افکت‌های متحرک
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={reducedMotion}
            aria-label="کاهش حرکت انیمیشن‌ها"
            onClick={() =>
              onUpdateProfile((prev) => ({
                ...prev,
                appSettings: {
                  ...prev.appSettings,
                  reducedMotion: !prev.appSettings.reducedMotion,
                },
              }))
            }
            className={`w-12 h-7 rounded-full p-1 transition-colors flex items-center shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--eyvan-teal)] ${
              reducedMotion
                ? 'bg-[#0D8A8A] justify-start'
                : 'bg-[#64748B] justify-end'
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-white shadow-xs block" />
          </button>
        </div>
      </section>

      {/* Default Game Animation Speed */}
      <section className="pt-5 space-y-2.5">
        <div className="text-xs sm:text-sm font-extrabold theme-heading">
          سرعت حرکت کارت‌ها در بازی
        </div>
        <div className="grid grid-cols-3 gap-1 p-1 theme-tab-track rounded-xl">
          {(['slow', 'normal', 'fast'] as AnimationSpeed[]).map((spd) => {
            const active = animationSpeed === spd;
            return (
              <button
                key={spd}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  onUpdateProfile((prev) => ({
                    ...prev,
                    appSettings: {
                      ...prev.appSettings,
                      animationSpeed: spd,
                    },
                  }))
                }
                className={`min-h-[40px] rounded-lg text-xs font-extrabold cursor-pointer transition-colors ${
                  active
                    ? 'bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1528]'
                    : 'theme-muted hover:text-[var(--eyvan-text)]'
                }`}
              >
                {ANIMATION_SPEED_LABELS[spd]}
              </button>
            );
          })}
        </div>
      </section>

      {/* Installable PWA App Row */}
      <section className="pt-4">
        <PWAInstallButton variant="settings" />
      </section>
    </div>
  );
};
