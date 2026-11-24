import React, { useState } from 'react';
import {
  Bell,
  Check,
  ChevronLeft,
  Copy,
  Gamepad2,
  Globe,
  HelpCircle,
  Info,
  Lock,
  Moon,
  Palette,
  Smartphone,
  Sun,
  User,
} from 'lucide-react';
import { AuthUserSummary, PendingAuthUrlAction } from '../../auth/authClient';
import { ANIMATION_SPEED_LABELS, AnimationSpeed } from '../../theme/tokens';
import { UserProfile } from '../../types/platform';
import { AccountAuthPanel } from '../AccountAuthPanel';
import { PWAInstallButton } from '../PWAInstallButton';
import { ProfileInitialAuthMode } from '../ProfileDrawer';
import { ProfileAccountView } from './ProfileAccountView';

export type SettingsSectionId =
  | 'account'
  | 'devices'
  | 'language'
  | 'games'
  | 'notifications'
  | 'privacy'
  | 'themes'
  | 'about'
  | 'support';

export const SETTINGS_SECTION_TITLES: Record<SettingsSectionId, string> = {
  account: 'حساب کاربری',
  devices: 'دستگاه‌ها و نشست‌ها',
  language: 'زبان',
  games: 'بازی‌ها',
  notifications: 'اعلان‌ها و صدا',
  privacy: 'حریم خصوصی و دسترسی‌پذیری',
  themes: 'ظاهر و تم',
  about: 'درباره ایوان',
  support: 'پشتیبانی',
};

interface ProfileSettingsViewProps {
  profile: UserProfile;
  onUpdateProfile: (updater: (prev: UserProfile) => UserProfile) => void;
  authUser: AuthUserSummary | null;
  authLoading: boolean;
  onAuthChange: (user: AuthUserSummary | null) => void;
  pendingAuthAction?: PendingAuthUrlAction | null;
  onClearPendingAuthAction?: () => void;
  initialAuthMode?: ProfileInitialAuthMode;
  activeSection: SettingsSectionId | null;
  onSelectSection: (section: SettingsSectionId | null) => void;
}

const SETTINGS_GROUPS: ReadonlyArray<
  ReadonlyArray<{
    id: SettingsSectionId;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }>
> = [
  [
    { id: 'account', label: 'حساب کاربری', icon: User },
    { id: 'devices', label: 'دستگاه‌ها و نشست‌ها', icon: Smartphone },
  ],
  [
    { id: 'language', label: 'زبان', icon: Globe },
    { id: 'games', label: 'بازی‌ها', icon: Gamepad2 },
    { id: 'notifications', label: 'اعلان‌ها و صدا', icon: Bell },
    { id: 'privacy', label: 'حریم خصوصی و دسترسی‌پذیری', icon: Lock },
    { id: 'themes', label: 'ظاهر و تم', icon: Palette },
  ],
  [
    { id: 'about', label: 'درباره ایوان', icon: Info },
    { id: 'support', label: 'پشتیبانی', icon: HelpCircle },
  ],
];

const ToggleSwitchRow: React.FC<{
  title: string;
  desc: string;
  checked: boolean;
  onToggle: () => void;
}> = ({ title, desc, checked, onToggle }) => (
  <div className="flex items-center justify-between gap-3 py-3.5 min-h-[60px]">
    <div className="min-w-0">
      <div className="text-xs sm:text-sm font-bold theme-heading">{title}</div>
      <div className="text-[11px] theme-muted mt-0.5">{desc}</div>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={title}
      onClick={onToggle}
      className={`w-12 h-7 rounded-full p-1 transition-colors flex items-center shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--eyvan-teal)] ${
        checked ? 'bg-[#0D8A8A] justify-start' : 'bg-[#64748B] justify-end'
      }`}
    >
      <span className="w-5 h-5 rounded-full bg-white shadow-xs block" />
    </button>
  </div>
);

export const ProfileSettingsView: React.FC<ProfileSettingsViewProps> = ({
  profile,
  onUpdateProfile,
  authUser,
  authLoading,
  onAuthChange,
  pendingAuthAction = null,
  onClearPendingAuthAction,
  initialAuthMode = 'login',
  activeSection,
  onSelectSection,
}) => {
  const [copiedCode, setCopiedCode] = useState(false);
  const { themeMode, soundEnabled, reducedMotion, animationSpeed } =
    profile.appSettings;

  const accountCode = authUser?.accountCode ?? profile.accountCode ?? '------';

  // Root grouped Settings list (matching Screenshot 1 architecture)
  if (!activeSection) {
    return (
      <div
        className="max-w-lg mx-auto space-y-4 pb-6"
        data-testid="profile-settings-view"
      >
        {SETTINGS_GROUPS.map((group, gIdx) => (
          <div
            key={gIdx}
            className="rounded-2xl theme-subcard border overflow-hidden divide-y divide-[var(--eyvan-line)]"
          >
            {group.map((row) => {
              const Icon = row.icon;
              return (
                <button
                  key={row.id}
                  type="button"
                  data-settings-row={row.id}
                  onClick={() => onSelectSection(row.id)}
                  className="w-full min-h-[54px] px-4 py-3 flex items-center justify-between gap-3 hover:bg-black/5 dark:hover:bg-white/[0.03] transition-colors cursor-pointer text-right"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <Icon className="w-5 h-5 theme-heading shrink-0 opacity-90" />
                    <span className="text-sm font-bold theme-heading truncate">
                      {row.label}
                    </span>
                  </div>
                  <ChevronLeft className="w-4 h-4 theme-muted shrink-0 opacity-75" />
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className="max-w-lg mx-auto pb-8"
      data-testid={`settings-section-${activeSection}`}
    >
      {activeSection === 'account' && (
        <ProfileAccountView
          profile={profile}
          onUpdateProfile={onUpdateProfile}
          authUser={authUser}
          authLoading={authLoading}
          onAuthChange={onAuthChange}
          pendingAuthAction={pendingAuthAction}
          onClearPendingAuthAction={onClearPendingAuthAction}
          initialAuthMode={initialAuthMode}
        />
      )}

      {activeSection === 'devices' && (
        <div className="space-y-4">
          <div className="rounded-2xl theme-subcard border p-4 space-y-1.5">
            <h3 className="text-sm font-black theme-heading">
              دستگاه‌های متصل و نشست‌های فعال
            </h3>
            <p className="text-xs theme-muted leading-relaxed">
              می‌توانید نشست‌های فعال حساب ایوان خود را بررسی کرده و در صورت نیاز هر دستگاه را لغو کنید.
            </p>
          </div>
          <AccountAuthPanel
            authUser={authUser}
            authLoading={authLoading}
            onAuthChange={onAuthChange}
            pendingAuthAction={pendingAuthAction}
            onClearPendingAuthAction={onClearPendingAuthAction}
            initialMode={initialAuthMode}
          />
        </div>
      )}

      {activeSection === 'language' && (
        <div className="rounded-2xl theme-subcard border overflow-hidden divide-y divide-[var(--eyvan-line)]">
          <div className="px-4 py-3.5 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black theme-heading">فارسی (ایران)</div>
              <div className="text-xs theme-muted mt-0.5">
                زبان رسمی پلتفرم بازی ایوان
              </div>
            </div>
            <span className="w-6 h-6 rounded-full bg-[#0D8A8A] text-white flex items-center justify-center shrink-0">
              <Check className="w-3.5 h-3.5" />
            </span>
          </div>
        </div>
      )}

      {activeSection === 'games' && (
        <div className="rounded-2xl theme-subcard border p-4 space-y-3.5">
          <div>
            <div className="text-sm font-black theme-heading">
              سرعت حرکت کارت‌ها در بازی حکم
            </div>
            <p className="text-xs theme-muted mt-1">
              سرعت پخش ورق و جمع‌آوری دست‌ها را متناسب با سبک بازی خود تنظیم کنید.
            </p>
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
                  className={`min-h-[42px] rounded-lg text-xs font-extrabold cursor-pointer transition-colors ${
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
        </div>
      )}

      {activeSection === 'notifications' && (
        <div className="rounded-2xl theme-subcard border px-4 divide-y divide-[var(--eyvan-line)]">
          <ToggleSwitchRow
            title="صدای افکت‌های بازی و موسیقی"
            desc="پخش صدای ورق‌ها، موسیقی پس‌زمینه و جلوه‌های صوتی میز حکم"
            checked={soundEnabled}
            onToggle={() =>
              onUpdateProfile((prev) => ({
                ...prev,
                appSettings: {
                  ...prev.appSettings,
                  soundEnabled: !prev.appSettings.soundEnabled,
                },
              }))
            }
          />
        </div>
      )}

      {activeSection === 'privacy' && (
        <div className="rounded-2xl theme-subcard border px-4 divide-y divide-[var(--eyvan-line)]">
          <ToggleSwitchRow
            title="نمایش وضعیت آنلاین"
            desc="دوستان ببینند چه زمانی در ایوان آنلاین هستید"
            checked={profile.accountSettings.showOnlineStatus}
            onToggle={() =>
              onUpdateProfile((prev) => ({
                ...prev,
                accountSettings: {
                  ...prev.accountSettings,
                  showOnlineStatus: !prev.accountSettings.showOnlineStatus,
                },
              }))
            }
          />
          <ToggleSwitchRow
            title="پذیرش درخواست دوستی"
            desc="امکان افزودن شما از طریق نام کاربری یا آیدی عددی"
            checked={profile.accountSettings.allowFriendRequests}
            onToggle={() =>
              onUpdateProfile((prev) => ({
                ...prev,
                accountSettings: {
                  ...prev.accountSettings,
                  allowFriendRequests: !prev.accountSettings.allowFriendRequests,
                },
              }))
            }
          />
          <ToggleSwitchRow
            title="نمایش خلاصه آمار"
            desc="نمایش فشرده‌تر اطلاعات در نمایه کاربری"
            checked={profile.accountSettings.compactProfileStats}
            onToggle={() =>
              onUpdateProfile((prev) => ({
                ...prev,
                accountSettings: {
                  ...prev.accountSettings,
                  compactProfileStats: !prev.accountSettings.compactProfileStats,
                },
              }))
            }
          />
          <ToggleSwitchRow
            title="کاهش حرکت انیمیشن‌ها"
            desc="کاهش جابه‌جایی‌های سریع و افکت‌های متحرک برای دسترسی‌پذیری بیشتر"
            checked={reducedMotion}
            onToggle={() =>
              onUpdateProfile((prev) => ({
                ...prev,
                appSettings: {
                  ...prev.appSettings,
                  reducedMotion: !prev.appSettings.reducedMotion,
                },
              }))
            }
          />
        </div>
      )}

      {activeSection === 'themes' && (
        <div className="rounded-2xl theme-subcard border p-4 space-y-3.5">
          <div>
            <div className="text-sm font-black theme-heading">حالت نمایش</div>
            <p className="text-xs theme-muted mt-0.5">
              بین پوسته تاریک و روشن ایوان جابه‌جا شوید.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-1.5 p-1 theme-tab-track rounded-xl">
            <button
              type="button"
              onClick={() =>
                onUpdateProfile((prev) => ({
                  ...prev,
                  appSettings: { ...prev.appSettings, themeMode: 'dark' },
                }))
              }
              aria-pressed={themeMode === 'dark'}
              className={`min-h-[44px] rounded-lg text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                themeMode === 'dark'
                  ? 'bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1528]'
                  : 'theme-muted hover:text-[var(--eyvan-text)]'
              }`}
            >
              <Moon className="w-4 h-4" />
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
              className={`min-h-[44px] rounded-lg text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                themeMode === 'light'
                  ? 'bg-[#0D8A8A] text-white'
                  : 'theme-muted hover:text-[var(--eyvan-text)]'
              }`}
            >
              <Sun className="w-4 h-4" />
              <span>روشن</span>
            </button>
          </div>
        </div>
      )}

      {activeSection === 'about' && (
        <div className="space-y-4">
          <div className="rounded-2xl theme-subcard border p-4 space-y-2">
            <div className="text-base font-black theme-heading">پلتفرم بازی ایوان</div>
            <p className="text-xs theme-muted leading-relaxed">
              ایوان یک سکوی مدرن و اصیل برای بازی‌های دورهمی و رقابتی از جمله حکم آنلاین و آفلاین، با طراحی چندمجموعه‌ای کارت‌ها و امکانات اجتماعی زنده است.
            </p>
          </div>
          <PWAInstallButton variant="settings" />
        </div>
      )}

      {activeSection === 'support' && (
        <div className="rounded-2xl theme-subcard border p-4 space-y-3.5">
          <div className="space-y-1">
            <div className="text-sm font-black theme-heading">پشتیبانی ایوان</div>
            <p className="text-xs theme-muted leading-relaxed">
              در صورت بروز مشکل در بازی آنلاین، حساب کاربری یا خرید فروشگاه، هنگام ارسال پیام آیدی عددی حساب خود را اعلام کنید.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--eyvan-line)] px-3.5 py-2.5 flex items-center justify-between gap-2">
            <div className="text-xs theme-muted">
              آیدی عددی شما:{' '}
              <code
                dir="ltr"
                className="font-mono font-bold theme-heading tabular-nums"
              >
                #{accountCode}
              </code>
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard?.writeText(accountCode);
                  setCopiedCode(true);
                  window.setTimeout(() => setCopiedCode(false), 1800);
                } catch {
                  // Ignore clipboard restriction
                }
              }}
              className="min-h-[34px] px-3 rounded-lg theme-btn-secondary border text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              {copiedCode ? (
                <>
                  <Check className="w-3.5 h-3.5 theme-win" />
                  <span>کپی شد</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>کپی آیدی</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
