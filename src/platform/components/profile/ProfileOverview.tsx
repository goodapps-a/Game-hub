import React from 'react';
import {
  ChevronLeft,
  Coins,
  Edit3,
  MailCheck,
  Shield,
  Sliders,
  Trophy,
  UserCheck,
  UserRound,
} from 'lucide-react';
import { AuthUserSummary } from '../../auth/authClient';
import { toPersianDigits } from '../../theme/tokens';
import { UserProfile } from '../../types/platform';
import { computeWinRateSummary, computeXpProgress } from '../../utils/profileMetrics';
import { GoldCoinSvg, ProfileAvatar, PurpleGemSvg } from '../TopBar';

export type ProfileSubView = 'overview' | 'edit' | 'account' | 'settings';

interface ProfileOverviewProps {
  profile: UserProfile;
  authUser: AuthUserSummary | null;
  onNavigate: (view: ProfileSubView) => void;
}

export const ProfileOverview: React.FC<ProfileOverviewProps> = ({
  profile,
  authUser,
  onNavigate,
}) => {
  const xp = computeXpProgress(profile.xp, profile.xpToNextLevel);
  const stats = computeWinRateSummary(profile.stats);
  const persistentId = authUser ? authUser.userId : profile.id;

  return (
    <div className="space-y-4" data-testid="profile-overview">
      {/* A. Identity Section */}
      <section className="rounded-2xl theme-subcard border p-4 space-y-3.5">
        <div className="flex items-start gap-3.5">
          <ProfileAvatar
            avatarCode={profile.avatarCode}
            username={profile.username}
            size="lg"
          />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <h3
                dir="ltr"
                className="text-lg font-extrabold theme-heading truncate text-right"
                data-testid="profile-username-display"
              >
                {profile.username}
              </h3>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold shrink-0 border ${
                  authUser
                    ? 'bg-[#0D8A8A]/12 border-[#0D8A8A]/35 theme-accent-teal'
                    : 'bg-[var(--eyvan-surface-muted)] border-[var(--eyvan-line)] theme-muted'
                }`}
              >
                {authUser ? (
                  <>
                    <UserCheck className="w-3 h-3" />
                    <span>حساب مرکزی</span>
                  </>
                ) : (
                  <>
                    <UserRound className="w-3 h-3" />
                    <span>مهمان</span>
                  </>
                )}
              </span>
            </div>

            <div className="flex items-center gap-1.5 text-[11px] theme-muted">
              <span>شناسه:</span>
              <code
                dir="ltr"
                data-testid="profile-persistent-id"
                className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-[var(--eyvan-surface-muted)] border border-[var(--eyvan-line)] truncate max-w-[190px]"
              >
                {persistentId}
              </code>
            </div>

            {authUser ? (
              <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px]">
                {authUser.email && (
                  <span dir="ltr" className="theme-muted truncate max-w-full">
                    {authUser.email}
                  </span>
                )}
                <span
                  className={`inline-flex items-center gap-1 font-bold ${
                    authUser.emailVerified ? 'theme-win' : 'theme-accent-gold'
                  }`}
                >
                  <MailCheck className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {authUser.emailVerified
                      ? 'ایمیل تأییدشده'
                      : 'در انتظار تأیید ایمیل'}
                  </span>
                </span>
              </div>
            ) : (
              <p className="text-[11px] theme-muted leading-relaxed pt-0.5">
                اطلاعات این بخش فقط برای نشست فعلی است؛ برای ذخیره دائمی و تأیید ایمیل از بخش حساب اقدام کنید.
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          data-testid="profile-edit-cta"
          onClick={() => onNavigate('edit')}
          className="w-full min-h-[42px] px-3.5 rounded-xl theme-btn-secondary border text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--eyvan-teal)]"
        >
          <Edit3 className="w-4 h-4 theme-accent-teal" />
          <span>ویرایش پروفایل</span>
        </button>
      </section>

      {/* B. Level & Progress Section */}
      <section className="rounded-2xl theme-subcard border p-4 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-extrabold theme-heading">
              پیشرفت سطح
            </span>
            <span className="text-xs font-extrabold theme-accent-gold tabular-nums">
              سطح {toPersianDigits(profile.level)}
            </span>
          </div>
          <span className="text-xs font-bold theme-muted tabular-nums">
            {toPersianDigits(xp.currentXp)} / {toPersianDigits(xp.targetXp)} XP
          </span>
        </div>

        <div
          className="h-2.5 rounded-full theme-bar-track overflow-hidden"
          role="progressbar"
          aria-valuenow={xp.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="پیشرفت تجربه تا سطح بعدی"
        >
          <div
            className="h-full rounded-full bg-[#0D8A8A] transition-all duration-300"
            style={{ width: `${xp.percent}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-[11px] theme-muted tabular-nums">
          <span>{toPersianDigits(xp.percent)}٪ تکمیل‌شده</span>
          <span>
            {xp.remainingXp > 0
              ? `${toPersianDigits(xp.remainingXp)} XP تا سطح بعدی`
              : 'آماده ارتقای سطح'}
          </span>
        </div>
      </section>

      {/* C. Game Stats Section */}
      <section className="rounded-2xl theme-subcard border p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 theme-accent-teal shrink-0" />
            <h3 className="text-xs sm:text-sm font-extrabold theme-heading">
              آمار بازی‌ها
            </h3>
          </div>
          {stats.hasGames && (
            <span className="text-[11px] font-bold theme-muted tabular-nums">
              امتیاز {toPersianDigits(stats.rating)}
            </span>
          )}
        </div>

        {!stats.hasGames ? (
          <div
            data-testid="profile-stats-empty"
            className="rounded-xl bg-[var(--eyvan-surface-muted)] border border-[var(--eyvan-line)] p-4 text-center space-y-1"
          >
            <div className="text-xs sm:text-sm font-extrabold theme-heading">
              {stats.emptyLabel}
            </div>
            <p className="text-[11px] theme-muted leading-relaxed">
              پس از انجام اولین مسابقه حکم، تعداد بازی‌ها، درصد برد و آمار برد و باخت شما اینجا ثبت می‌شود.
            </p>
          </div>
        ) : (
          <div
            data-testid="profile-stats-grid"
            className="grid grid-cols-2 gap-2.5"
          >
            <div className="p-3 rounded-xl bg-[var(--eyvan-surface-muted)] border border-[var(--eyvan-line)]">
              <div className="text-[11px] theme-muted">کل بازی‌ها</div>
              <div className="text-lg font-extrabold theme-heading mt-0.5 tabular-nums">
                {toPersianDigits(stats.gamesPlayed)}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[var(--eyvan-surface-muted)] border border-[var(--eyvan-line)]">
              <div className="text-[11px] theme-muted">درصد برد</div>
              <div className="text-lg font-extrabold theme-accent-teal mt-0.5 tabular-nums">
                {toPersianDigits(stats.winRatePct ?? 0)}٪
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[var(--eyvan-surface-muted)] border border-[var(--eyvan-line)]">
              <div className="text-[11px] theme-muted">بردها</div>
              <div className="text-lg font-extrabold theme-win mt-0.5 tabular-nums">
                {toPersianDigits(stats.wins)}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[var(--eyvan-surface-muted)] border border-[var(--eyvan-line)]">
              <div className="text-[11px] theme-muted">باخت‌ها</div>
              <div className="text-lg font-extrabold theme-loss mt-0.5 tabular-nums">
                {toPersianDigits(stats.losses)}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* D. Wallet / Balance Section */}
      <section className="rounded-2xl theme-subcard border px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Coins className="w-4 h-4 theme-accent-gold shrink-0" />
          <span className="text-xs font-bold theme-heading">موجودی کیف پول</span>
        </div>
        <div className="flex items-center gap-3 text-xs sm:text-sm font-extrabold theme-heading tabular-nums shrink-0">
          <span className="inline-flex items-center gap-1">
            <GoldCoinSvg size={15} />
            <span>{toPersianDigits(profile.coins.toLocaleString())} سکه</span>
          </span>
          <span className="theme-muted" aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1">
            <PurpleGemSvg size={15} />
            <span>{toPersianDigits(profile.gems.toLocaleString())} الماس</span>
          </span>
        </div>
      </section>

      {/* E. Clean Navigation List (replaces cramped 4-tab bar) */}
      <section
        aria-label="بخش‌های مدیریت پروفایل و تنظیمات"
        className="rounded-2xl theme-subcard border overflow-hidden divide-y divide-[var(--eyvan-line)]"
      >
        <button
          type="button"
          data-drawer-nav="edit"
          onClick={() => onNavigate('edit')}
          className="w-full min-h-[58px] px-4 py-3 flex items-center justify-between gap-3 text-right hover:bg-black/5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--eyvan-teal)]"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-[var(--eyvan-surface-muted)] border border-[var(--eyvan-line)] flex items-center justify-center shrink-0">
              <Edit3 className="w-4 h-4 theme-accent-teal" />
            </span>
            <div className="min-w-0">
              <div className="text-xs sm:text-sm font-extrabold theme-heading">
                ویرایش پروفایل
              </div>
              <div className="text-[11px] theme-muted truncate mt-0.5">
                تغییر نام کاربری یکتا و نشان پروفایل
              </div>
            </div>
          </div>
          <ChevronLeft className="w-4 h-4 theme-muted shrink-0" />
        </button>

        <button
          type="button"
          data-drawer-nav="account"
          onClick={() => onNavigate('account')}
          className="w-full min-h-[58px] px-4 py-3 flex items-center justify-between gap-3 text-right hover:bg-black/5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--eyvan-teal)]"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-[var(--eyvan-surface-muted)] border border-[var(--eyvan-line)] flex items-center justify-center shrink-0">
              <Shield className="w-4 h-4 theme-accent-gold" />
            </span>
            <div className="min-w-0">
              <div className="text-xs sm:text-sm font-extrabold theme-heading">
                امنیت و حساب کاربری
              </div>
              <div className="text-[11px] theme-muted truncate mt-0.5">
                ورود، ثبت‌نام، تأیید ایمیل و تنظیمات حریم خصوصی
              </div>
            </div>
          </div>
          <ChevronLeft className="w-4 h-4 theme-muted shrink-0" />
        </button>

        <button
          type="button"
          data-drawer-nav="settings"
          onClick={() => onNavigate('settings')}
          className="w-full min-h-[58px] px-4 py-3 flex items-center justify-between gap-3 text-right hover:bg-black/5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--eyvan-teal)]"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-[var(--eyvan-surface-muted)] border border-[var(--eyvan-line)] flex items-center justify-center shrink-0">
              <Sliders className="w-4 h-4 theme-accent-teal" />
            </span>
            <div className="min-w-0">
              <div className="text-xs sm:text-sm font-extrabold theme-heading">
                تنظیمات برنامه
              </div>
              <div className="text-[11px] theme-muted truncate mt-0.5">
                حالت نمایش، صدا و سرعت کارت
              </div>
            </div>
          </div>
          <ChevronLeft className="w-4 h-4 theme-muted shrink-0" />
        </button>
      </section>
    </div>
  );
};
