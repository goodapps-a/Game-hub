import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  X,
  Edit3,
  Shield,
  Sliders,
  Check,
  Coins,
  BarChart3,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { UserProfile } from '../types/platform';
import { ProfileAvatar } from './TopBar';
import {
  ANIMATION_SPEED_LABELS,
  AnimationSpeed,
  toPersianDigits,
} from '../theme/tokens';
import {
  validateUsernameFormat,
  UsernameValidationResult,
} from '../data/guestDefaults';
import { AuthUserSummary } from '../auth/authClient';
import { AccountAuthPanel } from './AccountAuthPanel';

interface ProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  onUpdateProfile: (updater: (prev: UserProfile) => UserProfile) => void;
  authUser: AuthUserSummary | null;
  authLoading: boolean;
  onAuthChange: (user: AuthUserSummary | null) => void;
}

type DrawerSection = 'overview' | 'edit' | 'account' | 'app';

const AVATAR_OPTIONS: Array<{
  code: UserProfile['avatarCode'];
  label: string;
}> = [
  { code: 'portrait', label: 'تصویر پروفایل' },
  { code: 'shamsa', label: 'نشان لاجوردی' },
  { code: 'turquoise', label: 'نشان فیروزه‌ای' },
  { code: 'jade', label: 'نشان یشمی' },
];

export const ProfileDrawer: React.FC<ProfileDrawerProps> = ({
  isOpen,
  onClose,
  profile,
  onUpdateProfile,
  authUser,
  authLoading,
  onAuthChange,
}) => {
  const [section, setSection] = useState<DrawerSection>('overview');
  const [draftName, setDraftName] = useState(profile.username);
  const [draftAvatar, setDraftAvatar] = useState<UserProfile['avatarCode']>(
    profile.avatarCode
  );
  const [validation, setValidation] = useState<UsernameValidationResult>({
    valid: true,
    suggestions: [],
  });
  const [savedFeedback, setSavedFeedback] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setDraftName(profile.username);
      setDraftAvatar(profile.avatarCode);
      setValidation({ valid: true, suggestions: [] });
      setSavedFeedback(false);
    }
  }, [isOpen, profile.avatarCode, profile.username]);

  const winRate =
    profile.stats.gamesPlayed > 0
      ? Math.round((profile.stats.wins / profile.stats.gamesPlayed) * 100)
      : 0;
  const xpPct = Math.min(
    100,
    Math.round((profile.xp / profile.xpToNextLevel) * 100)
  );

  const handleDraftNameChange = (value: string) => {
    setDraftName(value);
    setSavedFeedback(false);
    if (value.trim().length > 0) {
      setValidation(validateUsernameFormat(value));
    } else {
      setValidation({ valid: false, suggestions: [] });
    }
  };

  const handlePickSuggestion = (suggested: string) => {
    setDraftName(suggested);
    setValidation(validateUsernameFormat(suggested));
    setSavedFeedback(false);
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateUsernameFormat(draftName);
    setValidation(check);
    if (!check.valid) return;

    const cleaned = draftName.trim();
    onUpdateProfile((prev) => ({
      ...prev,
      id: cleaned,
      username: cleaned,
      avatarCode: draftAvatar,
    }));
    setSavedFeedback(true);
    window.setTimeout(() => setSavedFeedback(false), 1800);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-3.5 sm:p-5 bg-black/62 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="پنجره پروفایل کاربری"
          data-testid="profile-drawer"
        >
          <div
            className="fixed inset-0"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Centered Floating Overlay Card (never full-page takeover) */}
          <motion.aside
            initial={{ opacity: 0, scale: 0.93, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 10 }}
            transition={{ type: 'spring', stiffness: 360, damping: 28 }}
            className="relative z-10 w-full max-w-md max-h-[84dvh] theme-drawer rounded-3xl border border-[var(--eyvan-gold-border)] shadow-[0_24px_64px_rgba(0,0,0,0.52)] overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--eyvan-gold-border)] shrink-0">
              <h2 className="text-base font-extrabold theme-accent-gold">
                پروفایل کاربری
              </h2>
              <button
                type="button"
                onClick={() => {
                  onClose();
                }}
                aria-label="بستن پروفایل"
                className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl theme-muted hover:bg-black/10 cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="overflow-y-auto flex-1">
              {/* Identity Banner — Clean English Player ID without @ */}
              <div className="p-4 sm:p-5 border-b border-[var(--eyvan-gold-border)] theme-panel-tint">
                <div className="flex items-center gap-3.5">
                  <ProfileAvatar
                    avatarCode={profile.avatarCode}
                    username={profile.username}
                    size="lg"
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      dir="ltr"
                      className="text-lg font-extrabold theme-heading truncate text-right"
                      data-testid="profile-username-display"
                    >
                      {profile.username}
                    </div>
                    <div className="text-xs theme-muted mt-0.5">
                      {authUser ? 'حساب مرکزی ایوان' : 'حالت مهمان'} · سطح{' '}
                      {toPersianDigits(profile.level)}
                    </div>
                  </div>
                </div>

                {/* Level & XP Bar */}
                <div className="mt-3.5 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold theme-accent-gold">
                      سطح {toPersianDigits(profile.level)}
                    </span>
                    <span className="theme-muted tabular-nums">
                      {toPersianDigits(profile.xp)} /{' '}
                      {toPersianDigits(profile.xpToNextLevel)} XP
                    </span>
                  </div>
                  <div className="h-2 rounded-full theme-bar-track overflow-hidden border border-[var(--eyvan-gold-border)]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#0D8A8A] to-[#D4AE58]"
                      style={{ width: `${xpPct}%` }}
                    />
                  </div>
                </div>

                {/* Virtual Coins & Gems */}
                <div className="mt-3.5 flex items-center justify-between py-2 px-3.5 rounded-xl theme-subcard border">
                  <div className="flex items-center gap-2">
                    <Coins className="w-4 h-4 theme-accent-gold" />
                    <span className="text-xs font-medium theme-muted">
                      موجودی
                    </span>
                  </div>
                  <span className="text-xs sm:text-sm font-extrabold theme-heading tabular-nums">
                    {toPersianDigits(profile.coins.toLocaleString())} سکه ·{' '}
                    {toPersianDigits(profile.gems)} الماس
                  </span>
                </div>
              </div>

              {/* Section Switcher */}
              <div className="px-4 sm:px-5 pt-4">
                <div className="grid grid-cols-4 gap-1 p-1 theme-tab-track rounded-xl border">
                  {(
                    [
                      { id: 'overview', label: 'آمار', icon: BarChart3 },
                      { id: 'edit', label: 'ویرایش', icon: Edit3 },
                      { id: 'account', label: 'حساب', icon: Shield },
                      { id: 'app', label: 'برنامه', icon: Sliders },
                    ] as const
                  ).map((tab) => {
                    const active = section === tab.id;
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        data-drawer-tab={tab.id}
                        onClick={() => {
                          setSection(tab.id);
                          setDraftName(profile.username);
                          setDraftAvatar(profile.avatarCode);
                          setValidation({ valid: true, suggestions: [] });
                          setSavedFeedback(false);
                        }}
                        className={`min-h-[36px] px-2 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                          active
                            ? 'bg-[#D4AE58] text-[#0B1528] font-bold'
                            : 'theme-muted'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Section Body */}
              <div className="p-4 sm:p-5">
                {section === 'overview' && (
                  <div className="space-y-3.5">
                    <h3 className="text-sm font-bold theme-heading">
                      آمار کلی بازی
                    </h3>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="p-3 rounded-xl theme-subcard border">
                        <div className="text-xs theme-muted">کل بازی‌ها</div>
                        <div className="text-xl font-extrabold theme-heading mt-1 tabular-nums">
                          {toPersianDigits(profile.stats.gamesPlayed)}
                        </div>
                      </div>
                      <div className="p-3 rounded-xl theme-subcard border">
                        <div className="text-xs theme-muted">درصد برد</div>
                        <div className="text-xl font-extrabold theme-accent-gold mt-1 tabular-nums">
                          {toPersianDigits(winRate)}٪
                        </div>
                      </div>
                      <div className="p-3 rounded-xl theme-subcard border">
                        <div className="text-xs theme-muted">بردها</div>
                        <div className="text-xl font-extrabold theme-win mt-1 tabular-nums">
                          {toPersianDigits(profile.stats.wins)}
                        </div>
                      </div>
                      <div className="p-3 rounded-xl theme-subcard border">
                        <div className="text-xs theme-muted">باخت‌ها</div>
                        <div className="text-xl font-extrabold theme-loss mt-1 tabular-nums">
                          {toPersianDigits(profile.stats.losses)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {section === 'edit' && (
                  <form onSubmit={handleSaveProfile} className="space-y-4">
                    <div>
                      <label
                        htmlFor="profile-username-input"
                        className="block text-xs font-bold theme-heading mb-1.5"
                      >
                        نام کاربری یکتا (فقط انگلیسی)
                      </label>
                      <input
                        id="profile-username-input"
                        data-testid="username-input"
                        type="text"
                        dir="ltr"
                        value={draftName}
                        onChange={(e) => handleDraftNameChange(e.target.value)}
                        maxLength={20}
                        placeholder="e.g. amir_rad"
                        required
                        className={`w-full min-h-[44px] px-3.5 rounded-xl theme-input border text-sm font-semibold text-left focus:outline-none ${
                          !validation.valid
                            ? 'border-[#DC2626] focus:border-[#DC2626]'
                            : 'focus:border-[#0D8A8A]'
                        }`}
                      />

                      {/* Duplicate or Format Error + Clickable Similar Suggestions (NO @!) */}
                      {!validation.valid && validation.message && (
                        <div
                          data-testid="username-error-box"
                          className="mt-2.5 p-3 rounded-xl bg-[#DC2626]/10 border border-[#DC2626]/40 space-y-2.5"
                        >
                          <div className="flex items-start gap-2 text-xs font-semibold theme-loss leading-relaxed">
                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                            <span>{validation.message}</span>
                          </div>

                          {validation.suggestions.length > 0 && (
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-1 text-[11px] font-bold theme-muted">
                                <Sparkles className="w-3.5 h-3.5 theme-accent-teal" />
                                <span>پیشنهادهای آزاد و مشابه:</span>
                              </div>
                              <div
                                dir="ltr"
                                className="flex flex-wrap gap-1.5"
                                data-testid="username-suggestions"
                              >
                                {validation.suggestions.map((sug) => (
                                  <button
                                    key={sug}
                                    type="button"
                                    onClick={() => handlePickSuggestion(sug)}
                                    className="px-2.5 py-1.5 rounded-lg text-xs font-bold theme-subcard border border-[#0D8A8A]/45 hover:border-[#D4AE58] theme-heading transition-colors cursor-pointer"
                                  >
                                    {sug}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {validation.valid &&
                        draftName.trim().toLowerCase() !==
                          profile.username.toLowerCase() && (
                          <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold theme-win">
                            <Check className="w-3.5 h-3.5" />
                            <span>این نام کاربری آزاد و قابل انتخاب است.</span>
                          </div>
                        )}
                    </div>

                    <div>
                      <div className="text-xs font-bold theme-heading mb-2">
                        انتخاب تصویر یا نشان پروفایل
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {AVATAR_OPTIONS.map((opt) => (
                          <button
                            key={opt.code}
                            type="button"
                            onClick={() => {
                              setDraftAvatar(opt.code);
                            }}
                            className={`min-h-[46px] px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors ${
                              draftAvatar === opt.code
                                ? 'bg-[#D4AE58]/20 theme-accent-gold border-[#D4AE58]'
                                : 'theme-subcard theme-heading'
                            }`}
                          >
                            <ProfileAvatar
                              avatarCode={opt.code}
                              username={draftName || profile.username}
                              size="sm"
                            />
                            <span>{opt.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={!validation.valid}
                      data-testid="save-profile-btn"
                      className="w-full min-h-[44px] rounded-xl bg-[#D4AE58] hover:bg-[#E5BF69] disabled:opacity-45 disabled:cursor-not-allowed text-[#0B1528] text-sm font-extrabold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      {savedFeedback ? (
                        <>
                          <Check className="w-4 h-4" />
                          <span>تغییرات ذخیره شد</span>
                        </>
                      ) : (
                        <span>ذخیره تغییرات پروفایل</span>
                      )}
                    </button>
                  </form>
                )}

                {section === 'account' && (
                  <div className="space-y-3.5">
                    <AccountAuthPanel
                      authUser={authUser}
                      authLoading={authLoading}
                      onAuthChange={onAuthChange}
                    />
                    <h3 className="text-sm font-bold theme-heading pt-1">
                      تنظیمات حساب
                    </h3>
                    {(
                      [
                        {
                          key: 'showOnlineStatus',
                          title: 'نمایش وضعیت آنلاین',
                          desc: 'نمایش وضعیت حضور در فهرست دوستان',
                        },
                        {
                          key: 'allowFriendRequests',
                          title: 'پذیرش لینک دعوت و دوستی',
                          desc: 'اجازه افزودن از طریق لینک دعوت اختصاصی شما',
                        },
                        {
                          key: 'compactProfileStats',
                          title: 'نمایش خلاصه آمار',
                          desc: 'نمایش فشرده‌تر اطلاعات در نمایه کاربری',
                        },
                      ] as const
                    ).map((item) => {
                      const checked = profile.accountSettings[item.key];
                      return (
                        <div
                          key={item.key}
                          className="flex items-center justify-between gap-3 p-3 rounded-xl theme-subcard border"
                        >
                          <div>
                            <div className="text-xs font-bold theme-heading">
                              {item.title}
                            </div>
                            <div className="text-[11px] theme-muted mt-0.5">
                              {item.desc}
                            </div>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={checked}
                            aria-label={item.title}
                            onClick={() => {
                              onUpdateProfile((prev) => ({
                                ...prev,
                                accountSettings: {
                                  ...prev.accountSettings,
                                  [item.key]: !prev.accountSettings[item.key],
                                },
                              }));
                            }}
                            className={`w-11 h-6 rounded-full p-0.5 transition-colors flex items-center shrink-0 cursor-pointer ${
                              checked
                                ? 'bg-[#0D8A8A] justify-start'
                                : 'bg-[#6B7A90] justify-end'
                            }`}
                          >
                            <span className="w-5 h-5 rounded-full bg-white shadow-sm block" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {section === 'app' && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-bold theme-heading">
                      تنظیمات برنامه
                    </h3>

                    <div className="flex items-center justify-between gap-3 p-3 rounded-xl theme-subcard border">
                      <div>
                        <div className="text-xs font-bold theme-heading">
                          حالت نمایش (تاریک / روشن)
                        </div>
                        <div className="text-[11px] theme-muted mt-0.5">
                          {profile.appSettings.themeMode === 'dark'
                            ? 'حالت تاریک فعال است'
                            : 'حالت روشن فیروزه‌ای فعال است'}
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={profile.appSettings.themeMode === 'light'}
                        aria-label="تغییر حالت تاریک و روشن"
                        onClick={() => {
                          onUpdateProfile((prev) => ({
                            ...prev,
                            appSettings: {
                              ...prev.appSettings,
                              themeMode:
                                prev.appSettings.themeMode === 'dark'
                                  ? 'light'
                                  : 'dark',
                            },
                          }));
                        }}
                        className={`w-11 h-6 rounded-full p-0.5 transition-colors flex items-center shrink-0 cursor-pointer ${
                          profile.appSettings.themeMode === 'light'
                            ? 'bg-[#0D8A8A] justify-start'
                            : 'bg-[#6B7A90] justify-end'
                        }`}
                      >
                        <span className="w-5 h-5 rounded-full bg-white shadow-sm block" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-3 p-3 rounded-xl theme-subcard border">
                      <div>
                        <div className="text-xs font-bold theme-heading">
                          صدای افکت‌های بازی
                        </div>
                        <div className="text-[11px] theme-muted mt-0.5">
                          پخش صدای واقعی پخش ورق و افکت‌های میز
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={profile.appSettings.soundEnabled}
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
                        className={`w-11 h-6 rounded-full p-0.5 transition-colors flex items-center shrink-0 cursor-pointer ${
                          profile.appSettings.soundEnabled
                            ? 'bg-[#0D8A8A] justify-start'
                            : 'bg-[#6B7A90] justify-end'
                        }`}
                      >
                        <span className="w-5 h-5 rounded-full bg-white shadow-sm block" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-3 p-3 rounded-xl theme-subcard border">
                      <div>
                        <div className="text-xs font-bold theme-heading">
                          کاهش حرکت انیمیشن‌ها
                        </div>
                        <div className="text-[11px] theme-muted mt-0.5">
                          ارائه نسخه سبک‌تر انیمیشن‌ها
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={profile.appSettings.reducedMotion}
                        aria-label="کاهش حرکت انیمیشن‌ها"
                        onClick={() => {
                          onUpdateProfile((prev) => ({
                            ...prev,
                            appSettings: {
                              ...prev.appSettings,
                              reducedMotion: !prev.appSettings.reducedMotion,
                            },
                          }));
                        }}
                        className={`w-11 h-6 rounded-full p-0.5 transition-colors flex items-center shrink-0 cursor-pointer ${
                          profile.appSettings.reducedMotion
                            ? 'bg-[#0D8A8A] justify-start'
                            : 'bg-[#6B7A90] justify-end'
                        }`}
                      >
                        <span className="w-5 h-5 rounded-full bg-white shadow-sm block" />
                      </button>
                    </div>

                    <div className="p-3 rounded-xl theme-subcard border space-y-2">
                      <div className="text-xs font-bold theme-heading">
                        سرعت پیش‌فرض انیمیشن‌های بازی
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 p-1 theme-tab-track rounded-lg border">
                        {(['slow', 'normal', 'fast'] as AnimationSpeed[]).map(
                          (spd) => {
                            const active =
                              profile.appSettings.animationSpeed === spd;
                            return (
                              <button
                                key={spd}
                                type="button"
                                onClick={() => {
                                  onUpdateProfile((prev) => ({
                                    ...prev,
                                    appSettings: {
                                      ...prev.appSettings,
                                      animationSpeed: spd,
                                    },
                                  }));
                                }}
                                className={`min-h-[34px] rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                                  active
                                    ? 'bg-[#D4AE58] text-[#0B1528] font-bold'
                                    : 'theme-muted'
                                }`}
                              >
                                {ANIMATION_SPEED_LABELS[spd]}
                              </button>
                            );
                          }
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
