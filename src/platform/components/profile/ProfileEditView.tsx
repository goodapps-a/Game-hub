import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2, RotateCcw } from 'lucide-react';
import {
  AuthUserSummary,
  checkUsernameAvailabilityRequest,
  updateAccountProfileRequest,
} from '../../auth/authClient';
import {
  saveLocalCosmetics,
  validateUsernameFormat,
} from '../../data/guestDefaults';
import { toPersianDigits } from '../../theme/tokens';
import { UserProfile } from '../../types/platform';
import {
  applyLocalProfileEdit,
  applyServerProfileUpdate,
  normalizeAvatarCode,
} from '../../utils/profileMetrics';
import { FramedPlayerAvatar } from './PlayerAppearanceParts';

interface ProfileEditViewProps {
  profile: UserProfile;
  authUser: AuthUserSummary | null;
  onUpdateProfile: (updater: (prev: UserProfile) => UserProfile) => void;
  onAuthChange: (user: AuthUserSummary | null) => void;
  onCancel: () => void;
}

type ServerCheckState =
  | { status: 'idle' }
  | { status: 'unchanged'; message: string }
  | { status: 'checking'; message: string }
  | { status: 'available'; message: string }
  | { status: 'taken'; message: string }
  | { status: 'error'; message: string };

const MAX_BIO_LENGTH = 160;

export const ProfileEditView: React.FC<ProfileEditViewProps> = ({
  profile,
  authUser,
  onUpdateProfile,
  onAuthChange,
  onCancel,
}) => {
  const initialBio = profile.bio ?? authUser?.bio ?? '';
  const [draftName, setDraftName] = useState(profile.username);
  const [draftAvatar, setDraftAvatar] = useState<UserProfile['avatarCode']>(
    profile.avatarCode
  );
  const [draftBio, setDraftBio] = useState(initialBio);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [serverCheck, setServerCheck] = useState<ServerCheckState>({
    status: 'idle',
  });
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const checkTimerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastSavedRef = useRef<{
    username: string;
    avatarCode: UserProfile['avatarCode'];
    bio: string;
  } | null>(null);

  useEffect(() => {
    const incomingBio = profile.bio ?? authUser?.bio ?? '';
    if (
      lastSavedRef.current &&
      lastSavedRef.current.username === profile.username &&
      lastSavedRef.current.avatarCode === profile.avatarCode &&
      lastSavedRef.current.bio === incomingBio
    ) {
      lastSavedRef.current = null;
      return;
    }
    setDraftName(profile.username);
    setDraftAvatar(profile.avatarCode);
    setDraftBio(incomingBio);
    setFormatError(null);
    setServerCheck({ status: 'idle' });
    setSubmitError(null);
    setSavedNotice(null);
  }, [profile.username, profile.avatarCode, profile.bio, authUser?.bio]);

  useEffect(() => {
    return () => {
      if (checkTimerRef.current) window.clearTimeout(checkTimerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const cleanedDraft = draftName.trim();
  const cleanedBio = draftBio.replace(/\s+/g, ' ').trim();
  const currentBio = (profile.bio ?? authUser?.bio ?? '').trim();

  const nameChanged =
    cleanedDraft.toLowerCase() !== profile.username.toLowerCase() ||
    cleanedDraft !== profile.username;
  const avatarChanged = draftAvatar !== profile.avatarCode;
  const bioChanged = cleanedBio !== currentBio;
  const hasChanges = nameChanged || avatarChanged || bioChanged;

  const activeFrameId =
    profile.equippedAvatarFrameId ?? profile.equippedSlots?.avatar_frame ?? null;

  // Strictly display 6-digit numeric account code — never raw UUID
  const displayAccountCode =
    authUser?.accountCode ?? profile.accountCode ?? '------';

  const triggerServerAvailabilityCheck = (rawValue: string) => {
    if (checkTimerRef.current) window.clearTimeout(checkTimerRef.current);
    abortRef.current?.abort();

    const trimmed = rawValue.trim();
    if (!trimmed) {
      setFormatError('وارد کردن نام کاربری الزامی است.');
      setServerCheck({ status: 'idle' });
      return;
    }

    const fmt = validateUsernameFormat(trimmed);
    if (!fmt.valid) {
      setFormatError(fmt.message ?? 'فرمت نام کاربری معتبر نیست.');
      setServerCheck({ status: 'idle' });
      return;
    }

    setFormatError(null);

    if (trimmed.toLowerCase() === profile.username.toLowerCase()) {
      setServerCheck({
        status: 'unchanged',
        message: 'این نام کاربری فعلی شماست.',
      });
      return;
    }

    setServerCheck({
      status: 'checking',
      message: 'در حال بررسی آزاد بودن در سرور...',
    });

    checkTimerRef.current = window.setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await checkUsernameAvailabilityRequest(
          trimmed,
          controller.signal
        );
        if (controller.signal.aborted) return;

        if (!res.ok) {
          setServerCheck({
            status: 'error',
            message: res.message || 'بررسی سروری نام کاربری در دسترس نیست.',
          });
          return;
        }

        if (res.valid === false) {
          setFormatError(res.message);
          setServerCheck({ status: 'idle' });
          return;
        }

        if (res.available) {
          setServerCheck({
            status: 'available',
            message: res.message || 'تأیید سرور: این نام کاربری آزاد است.',
          });
        } else {
          setServerCheck({
            status: 'taken',
            message: res.message || 'این نام کاربری قبلاً در سرور ثبت شده است.',
          });
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setServerCheck({
          status: 'error',
          message: 'امکان استعلام نام کاربری از سرور برقرار نشد.',
        });
      }
    }, 320);
  };

  const handleNameChange = (value: string) => {
    setDraftName(value);
    setSubmitError(null);
    setSavedNotice(null);
    triggerServerAvailabilityCheck(value);
  };

  const handleBioChange = (value: string) => {
    if (value.length <= MAX_BIO_LENGTH) {
      setDraftBio(value);
      setSubmitError(null);
      setSavedNotice(null);
    }
  };

  const handleResetDraft = () => {
    if (saving) return;
    if (checkTimerRef.current) window.clearTimeout(checkTimerRef.current);
    abortRef.current?.abort();
    onCancel();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    setSubmitError(null);
    setSavedNotice(null);

    const fmt = validateUsernameFormat(cleanedDraft);
    if (!fmt.valid) {
      setFormatError(fmt.message ?? 'فرمت نام کاربری معتبر نیست.');
      return;
    }

    if (cleanedBio.length > MAX_BIO_LENGTH) {
      setSubmitError('بیوگرافی نباید بیشتر از ۱۶۰ کاراکتر باشد.');
      return;
    }

    if (serverCheck.status === 'checking') {
      return;
    }

    if (nameChanged && serverCheck.status === 'taken') {
      setSubmitError('این نام کاربری قبلاً در سرور ثبت شده است.');
      return;
    }

    setSaving(true);
    try {
      if (authUser) {
        const res = await updateAccountProfileRequest({
          username: cleanedDraft,
          avatarCode: draftAvatar,
          bio: cleanedBio,
        });

        if (!res.ok || !res.user) {
          setSubmitError(
            res.message ?? 'ذخیره تغییرات در سرور انجام نشد. تغییرات قبلی حفظ شدند.'
          );
          return;
        }

        const persistedBio = typeof res.user.bio === 'string' ? res.user.bio : cleanedBio;
        lastSavedRef.current = {
          username: res.user.username,
          avatarCode: normalizeAvatarCode(res.user.avatarCode),
          bio: persistedBio,
        };
        onAuthChange(res.user);
        onUpdateProfile((prev) => applyServerProfileUpdate(prev, res.user!));
        setSavedNotice(res.message ?? 'تغییرات پروفایل روی سرور ذخیره شد.');
        setServerCheck({ status: 'idle' });
      } else {
        const nextDraft = cleanedDraft;
        const nextAvatar = draftAvatar;
        lastSavedRef.current = {
          username: nextDraft,
          avatarCode: nextAvatar,
          bio: cleanedBio,
        };
        saveLocalCosmetics({ bio: cleanedBio });
        onUpdateProfile((prev) =>
          applyLocalProfileEdit(prev, nextDraft, nextAvatar, cleanedBio)
        );
        setSavedNotice('تغییرات پروفایل شما با موفقیت ذخیره شد.');
        setServerCheck({ status: 'idle' });
      }
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'خطا در ارتباط با سرور. اطلاعات قبلی شما بدون تغییر باقی ماند.'
      );
    } finally {
      setSaving(false);
    }
  };

  const saveDisabled =
    saving ||
    !hasChanges ||
    Boolean(formatError) ||
    serverCheck.status === 'checking' ||
    serverCheck.status === 'taken';

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-lg mx-auto space-y-5"
      data-testid="profile-edit-form"
    >
      {/* Live Preview — displays player's actual custom avatar + equipped frame & 6-digit account code */}
      <section className="rounded-2xl theme-subcard border p-4 space-y-3">
        <div className="flex items-center justify-between text-[11px] theme-muted">
          <span className="font-bold">پیش‌نمایش پروفایل</span>
          {hasChanges && (
            <span className="font-bold theme-accent-teal">تغییرات ذخیره نشده</span>
          )}
        </div>
        <div className="flex items-center gap-3.5">
          <FramedPlayerAvatar
            avatarCode={draftAvatar}
            customAvatarUrl={profile.customAvatarUrl}
            username={cleanedDraft || profile.username}
            avatarFrameId={activeFrameId}
            size="lg"
          />
          <div className="min-w-0 flex-1 space-y-0.5">
            <div
              dir="ltr"
              data-testid="profile-edit-preview-name"
              className="text-base font-black theme-heading truncate text-right"
            >
              {cleanedDraft || profile.username}
            </div>
            <div className="text-[11px] theme-muted flex items-center gap-1.5">
              <span>آیدی عددی:</span>
              <code
                dir="ltr"
                data-testid="profile-edit-account-code"
                className="font-mono font-bold tracking-wider tabular-nums"
              >
                #{displayAccountCode}
              </code>
            </div>
            {cleanedBio && (
              <p className="text-xs theme-muted line-clamp-2 pt-0.5 leading-relaxed">
                {cleanedBio}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Username Field + Real Server Uniqueness Feedback */}
      <section className="space-y-2">
        <label
          htmlFor="profile-username-input"
          className="block text-xs font-extrabold theme-heading"
        >
          نام کاربری یکتا (انگلیسی)
        </label>
        <input
          id="profile-username-input"
          data-testid="username-input"
          type="text"
          dir="ltr"
          autoComplete="username"
          value={draftName}
          onChange={(e) => handleNameChange(e.target.value)}
          maxLength={20}
          disabled={saving}
          placeholder="player_one"
          required
          className={`w-full min-h-[44px] px-3.5 rounded-xl theme-input border text-sm font-semibold text-left focus:outline-none focus:ring-2 ${
            formatError || serverCheck.status === 'taken'
              ? 'border-[#DC2626] focus:ring-[#DC2626]/30'
              : 'focus:border-[#0D8A8A] focus:ring-[#0D8A8A]/25'
          }`}
        />

        {formatError && (
          <div
            role="alert"
            data-testid="username-error-box"
            className="p-3 rounded-xl bg-[#DC2626]/10 border border-[#DC2626]/40 flex items-start gap-2 text-xs font-semibold theme-loss leading-relaxed"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{formatError}</span>
          </div>
        )}

        {!formatError && serverCheck.status === 'checking' && (
          <div
            data-testid="username-checking-msg"
            className="flex items-center gap-1.5 text-xs font-semibold theme-muted pt-0.5"
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span>{serverCheck.message}</span>
          </div>
        )}

        {!formatError && serverCheck.status === 'available' && (
          <div
            data-testid="username-available-msg"
            className="flex items-center gap-1.5 text-xs font-semibold theme-win pt-0.5"
          >
            <Check className="w-3.5 h-3.5 shrink-0" />
            <span>{serverCheck.message}</span>
          </div>
        )}

        {!formatError && serverCheck.status === 'taken' && (
          <div
            role="alert"
            data-testid="username-taken-msg"
            className="p-2.5 rounded-xl bg-[#DC2626]/10 border border-[#DC2626]/40 flex items-start gap-2 text-xs font-semibold theme-loss"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{serverCheck.message}</span>
          </div>
        )}

        {!formatError && serverCheck.status === 'error' && (
          <div
            data-testid="username-check-error-msg"
            className="p-2.5 rounded-xl bg-[#D4AE58]/10 border border-[#D4AE58]/40 flex items-start gap-2 text-xs font-semibold theme-accent-gold"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{serverCheck.message}</span>
          </div>
        )}
      </section>

      {/* Bio Field (Max 160 chars) */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="profile-bio-input"
            className="block text-xs font-extrabold theme-heading"
          >
            بیوگرافی
          </label>
          <span className="text-[11px] font-bold theme-muted tabular-nums">
            {toPersianDigits(draftBio.length)} / {toPersianDigits(MAX_BIO_LENGTH)}
          </span>
        </div>
        <textarea
          id="profile-bio-input"
          data-testid="bio-input"
          value={draftBio}
          onChange={(e) => handleBioChange(e.target.value)}
          maxLength={MAX_BIO_LENGTH}
          rows={3}
          disabled={saving}
          placeholder="درباره خودت بنویس..."
          className="w-full px-3.5 py-2.5 rounded-xl theme-input border text-sm font-medium leading-relaxed resize-none focus:outline-none focus:ring-2 focus:border-[#0D8A8A] focus:ring-[#0D8A8A]/25"
        />
      </section>

      {/* Save / Error Feedback */}
      {submitError && (
        <div
          role="alert"
          data-testid="profile-save-error"
          className="p-3 rounded-xl bg-[#DC2626]/10 border border-[#DC2626]/40 flex items-start gap-2 text-xs font-semibold theme-loss"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{submitError}</span>
        </div>
      )}

      {savedNotice && (
        <div
          data-testid="profile-save-success"
          className="p-3 rounded-xl bg-[#0D8A8A]/12 border border-[#0D8A8A]/40 flex items-start gap-2 text-xs font-semibold theme-win"
        >
          <Check className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{savedNotice}</span>
        </div>
      )}

      {/* Action Buttons: Save + Cancel */}
      <div className="grid grid-cols-2 gap-2.5 pt-1">
        <button
          type="submit"
          disabled={saveDisabled}
          data-testid="save-profile-btn"
          className="min-h-[44px] px-3 rounded-xl bg-[#D4AE58] hover:bg-[#E2BE68] disabled:opacity-45 disabled:cursor-not-allowed text-[#0B1528] text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--eyvan-teal)]"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>در حال ذخیره...</span>
            </>
          ) : (
            <span>ذخیره تغییرات</span>
          )}
        </button>

        <button
          type="button"
          disabled={saving}
          onClick={handleResetDraft}
          data-testid="cancel-profile-edit-btn"
          className="min-h-[44px] px-3 rounded-xl theme-btn-secondary border text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--eyvan-teal)]"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>لغو تغییرات</span>
        </button>
      </div>
    </form>
  );
};
