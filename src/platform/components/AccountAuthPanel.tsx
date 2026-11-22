import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Link2,
  LogIn,
  LogOut,
  MailCheck,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserPlus,
} from 'lucide-react';
import {
  ActiveAuthSessionItem,
  AuthUserSummary,
  LinkedAuthProvider,
  PendingAuthUrlAction,
  fetchActiveAuthSessions,
  fetchCurrentAuthSession,
  fetchGoogleOAuthConfig,
  forgotPasswordRequest,
  loginAccount,
  logoutAccount,
  logoutAllAccountSessions,
  openGoogleOAuthPopup,
  registerAccount,
  resendVerificationRequest,
  resetPasswordRequest,
  revokeAuthSessionByIdRequest,
  verifyEmailWithTokenRequest,
} from '../auth/authClient';
import { toPersianDigits } from '../theme/tokens';

interface AccountAuthPanelProps {
  authUser: AuthUserSummary | null;
  authLoading: boolean;
  onAuthChange: (user: AuthUserSummary | null) => void;
  pendingAuthAction?: PendingAuthUrlAction | null;
  onClearPendingAuthAction?: () => void;
}

type AuthFormMode =
  | 'login'
  | 'register'
  | 'pending_verify'
  | 'forgot'
  | 'verify_token'
  | 'reset_password';

export const AccountAuthPanel: React.FC<AccountAuthPanelProps> = ({
  authUser,
  authLoading,
  onAuthChange,
  pendingAuthAction = null,
  onClearPendingAuthAction,
}) => {
  const [mode, setMode] = useState<AuthFormMode>('login');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [resendEmail, setResendEmail] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [unverifiedNotice, setUnverifiedNotice] = useState(false);
  const [verifyState, setVerifyState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [resetDone, setResetDone] = useState(false);

  // Stage 2 & C3: Google OAuth availability, linked providers & active sessions
  const [googleConfigured, setGoogleConfigured] = useState<boolean | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [linkedProviders, setLinkedProviders] = useState<LinkedAuthProvider[]>([]);
  const [activeSessions, setActiveSessions] = useState<ActiveAuthSessionItem[]>([]);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);

  const lastAutoVerifiedTokenRef = useRef<string | null>(null);

  const resetFeedback = () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setUnverifiedNotice(false);
  };

  useEffect(() => {
    let active = true;
    fetchGoogleOAuthConfig()
      .then((res) => {
        if (active) setGoogleConfigured(Boolean(res.ok && res.configured));
      })
      .catch(() => {
        if (active) setGoogleConfigured(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const loadAccountSecurityState = async () => {
    setSessionsLoading(true);
    try {
      const res = await fetchActiveAuthSessions();
      if (res.ok) {
        setActiveSessions(Array.isArray(res.sessions) ? res.sessions : []);
        setLinkedProviders(Array.isArray(res.providers) ? res.providers : []);
      }
    } catch {
      // Non-fatal
    } finally {
      setSessionsLoading(false);
    }
  };

  useEffect(() => {
    if (!authUser) {
      setActiveSessions([]);
      setLinkedProviders([]);
      setSessionsOpen(false);
      return;
    }
    void loadAccountSecurityState();
  }, [authUser?.userId]);

  // React to incoming `#verify-email=` or `#reset-password=` actions (already scrubbed from URL)
  useEffect(() => {
    if (!pendingAuthAction) return;

    if (pendingAuthAction.type === 'verify-email') {
      const tok = pendingAuthAction.token;
      if (lastAutoVerifiedTokenRef.current === tok) return;
      lastAutoVerifiedTokenRef.current = tok;

      setMode('verify_token');
      setVerifyState('loading');
      setErrorMsg(null);
      setInfoMsg(null);

      let active = true;
      verifyEmailWithTokenRequest(tok)
        .then((res) => {
          if (!active) return;
          if (res.ok && res.verified) {
            setVerifyState('success');
            setInfoMsg(
              res.message ??
                'ایمیل شما با موفقیت تأیید شد. اکنون می‌توانید وارد حساب کاربری خود شوید.'
            );
          } else {
            setVerifyState('error');
            setErrorMsg(
              res.message ?? 'لینک تأیید ایمیل نامعتبر، استفاده‌شده یا منقضی شده است.'
            );
          }
        })
        .catch((err) => {
          if (!active) return;
          setVerifyState('error');
          setErrorMsg(
            err instanceof Error ? err.message : 'خطا در تأیید ایمیل.'
          );
        })
        .finally(() => {
          onClearPendingAuthAction?.();
        });

      return () => {
        active = false;
      };
    }

    if (pendingAuthAction.type === 'reset-password') {
      setResetToken(pendingAuthAction.token);
      setResetDone(false);
      setNewPassword('');
      setConfirmNewPassword('');
      setErrorMsg(null);
      setInfoMsg(null);
      setMode('reset_password');
      onClearPendingAuthAction?.();
    }
  }, [pendingAuthAction, onClearPendingAuthAction]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    resetFeedback();
    setSubmitting(true);
    try {
      const res = await loginAccount({ identifier, password });
      if (!res.ok || !res.user) {
        setErrorMsg(res.message ?? 'ورود انجام نشد.');
        if (res.code === 'EMAIL_NOT_VERIFIED' || res.verificationRequired) {
          setUnverifiedNotice(true);
          if (identifier.includes('@')) {
            setResendEmail(identifier.trim());
          }
        }
        return;
      }
      setPassword('');
      setIdentifier('');
      onAuthChange(res.user);
      setInfoMsg('با موفقیت وارد حساب کاربری خود شدید.');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'خطا در برقراری ارتباط با سرور.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    resetFeedback();
    setSubmitting(true);
    try {
      const res = await registerAccount({
        email,
        username,
        password,
        confirmPassword,
      });
      if (!res.ok) {
        setErrorMsg(res.message ?? 'ثبت‌نام انجام نشد.');
        return;
      }
      setPassword('');
      setConfirmPassword('');
      setResendEmail(email.trim());
      setMode('pending_verify');
      setInfoMsg(
        res.message ??
          'حساب شما ساخته شد. لطفاً لینک تأیید ارسال‌شده به ایمیل خود را باز کنید.'
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'خطا در برقراری ارتباط با سرور.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendVerification = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (submitting) return;
    const targetEmail = resendEmail.trim();
    if (!targetEmail) {
      setErrorMsg('لطفاً ایمیل خود را برای ارسال مجدد لینک تأیید وارد کنید.');
      return;
    }
    setErrorMsg(null);
    setInfoMsg(null);
    setSubmitting(true);
    try {
      const res = await resendVerificationRequest(targetEmail);
      if (!res.ok) {
        setErrorMsg(res.message ?? 'ارسال مجدد ایمیل تأیید انجام نشد.');
        return;
      }
      setInfoMsg(
        res.message ??
          'در صورت وجود حساب تأییدنشده با این ایمیل، لینک تأیید جدید ارسال خواهد شد.'
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'خطا در ارسال مجدد ایمیل تأیید.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    resetFeedback();
    setSubmitting(true);
    try {
      const res = await forgotPasswordRequest(forgotEmail.trim());
      if (!res.ok) {
        setErrorMsg(res.message ?? 'ثبت درخواست بازیابی انجام نشد.');
        return;
      }
      setInfoMsg(
        res.message ??
          'اگر حساب کاربری با این ایمیل ثبت شده باشد، لینک بازیابی رمز عبور ارسال خواهد شد.'
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'خطا در ارتباط با سرور.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!resetToken) {
      setErrorMsg('توکن بازیابی رمز عبور موجود نیست. لطفاً مجدداً درخواست بازیابی ثبت کنید.');
      return;
    }
    resetFeedback();
    setSubmitting(true);
    try {
      const res = await resetPasswordRequest({
        token: resetToken,
        password: newPassword,
        confirmPassword: confirmNewPassword,
      });
      if (!res.ok) {
        setErrorMsg(res.message ?? 'تغییر رمز عبور انجام نشد.');
        return;
      }
      setResetToken(null);
      setNewPassword('');
      setConfirmNewPassword('');
      setResetDone(true);
      onAuthChange(null);
      setInfoMsg(
        res.message ??
          'رمز عبور شما با موفقیت تغییر یافت و تمام نشست‌های قبلی لغو شدند.'
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'خطا در ارتباط با سرور.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    if (submitting) return;
    resetFeedback();
    setSubmitting(true);
    try {
      const res = await logoutAccount();
      if (!res.ok) {
        setErrorMsg(res.message ?? 'خطا در خروج از حساب کاربری.');
        return;
      }
      onAuthChange(null);
      setInfoMsg('از حساب کاربری خارج شدید. همچنان می‌توانید به‌صورت مهمان بازی کنید.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'خطا در خروج از حساب.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogoutAll = async () => {
    if (submitting) return;
    resetFeedback();
    setSubmitting(true);
    try {
      const res = await logoutAllAccountSessions();
      if (!res.ok) {
        setErrorMsg(res.message ?? 'خطا در لغو نشست‌ها.');
        return;
      }
      onAuthChange(null);
      setInfoMsg('تمام نشست‌های فعال حساب شما لغو شدند.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'خطا در لغو نشست‌ها.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleOAuth = async (flowMode: 'login' | 'link') => {
    if (submitting || googleBusy) return;
    resetFeedback();
    setGoogleBusy(true);
    try {
      const result = await openGoogleOAuthPopup(flowMode);
      if (!result.ok) {
        setErrorMsg(result.message);
        return;
      }
      const me = await fetchCurrentAuthSession();
      if (me.ok && me.authenticated && me.user) {
        onAuthChange(me.user);
        if (Array.isArray(me.providers)) {
          setLinkedProviders(me.providers);
        }
        await loadAccountSecurityState();
      }
      setInfoMsg(
        result.message ||
          (flowMode === 'link'
            ? 'حساب گوگل با موفقیت به حساب شما متصل شد.'
            : 'ورود با گوگل با موفقیت انجام شد.')
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'خطا در ورود با حساب گوگل.'
      );
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleRevokeSingleSession = async (sessionId: string) => {
    if (revokingSessionId) return;
    resetFeedback();
    setRevokingSessionId(sessionId);
    try {
      const res = await revokeAuthSessionByIdRequest(sessionId);
      if (!res.ok) {
        setErrorMsg(res.message ?? 'لغو نشست انجام نشد.');
        return;
      }
      if (res.revokedCurrentSession) {
        onAuthChange(null);
        setInfoMsg('نشست فعلی لغو شد.');
        return;
      }
      setActiveSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
      setInfoMsg(res.message ?? 'نشست انتخاب‌شده با موفقیت لغو شد.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'خطا در لغو نشست.');
    } finally {
      setRevokingSessionId(null);
    }
  };

  // Dedicated C2 token flows take priority even if a stale session was previously shown
  if (mode === 'verify_token') {
    return (
      <div
        className="p-3.5 rounded-2xl theme-subcard border space-y-3"
        data-testid="auth-verify-email-panel"
      >
        <div className="flex items-center gap-2 text-xs font-extrabold theme-heading">
          <MailCheck className="w-4 h-4 theme-accent-teal shrink-0" />
          <span>تأیید ایمیل حساب کاربری</span>
        </div>

        {verifyState === 'loading' && (
          <div className="p-3 rounded-xl theme-input border text-xs theme-muted text-center">
            در حال بررسی و تأیید لینک ایمیل...
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            data-testid="auth-verify-error"
            className="p-2.5 rounded-xl bg-[#DC2626]/10 border border-[#DC2626]/40 flex items-start gap-2 text-xs font-semibold theme-loss"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {infoMsg && (
          <div
            data-testid="auth-verify-success"
            className="p-2.5 rounded-xl bg-[#0D8A8A]/10 border border-[#0D8A8A]/40 flex items-start gap-2 text-xs font-semibold theme-win"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{infoMsg}</span>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            data-testid="auth-verify-go-login"
            onClick={() => {
              setMode('login');
              setVerifyState('idle');
            }}
            className="w-full min-h-[40px] rounded-xl bg-[#D4AE58] hover:bg-[#E5BF69] text-[#0B1528] text-xs font-extrabold cursor-pointer transition-colors"
          >
            ورود به حساب کاربری
          </button>
          {verifyState === 'error' && (
            <button
              type="button"
              data-testid="auth-verify-open-resend"
              onClick={() => {
                setMode('pending_verify');
                setVerifyState('idle');
                resetFeedback();
              }}
              className="w-full min-h-[38px] rounded-xl border border-[var(--eyvan-gold-border)] text-xs font-bold theme-heading hover:bg-black/10 cursor-pointer transition-colors"
            >
              درخواست ارسال مجدد لینک تأیید
            </button>
          )}
        </div>
      </div>
    );
  }

  if (mode === 'reset_password') {
    return (
      <div
        className="p-3.5 rounded-2xl theme-subcard border space-y-3"
        data-testid="auth-reset-password-panel"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-extrabold theme-heading">
            <KeyRound className="w-4 h-4 theme-accent-gold shrink-0" />
            <span>تنظیم رمز عبور جدید</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setResetToken(null);
              setMode('login');
              resetFeedback();
            }}
            className="text-[11px] font-bold theme-muted hover:theme-heading flex items-center gap-1 cursor-pointer"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            <span>بازگشت</span>
          </button>
        </div>

        {errorMsg && (
          <div
            role="alert"
            data-testid="auth-reset-error"
            className="p-2.5 rounded-xl bg-[#DC2626]/10 border border-[#DC2626]/40 flex items-start gap-2 text-xs font-semibold theme-loss"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {infoMsg && (
          <div
            data-testid="auth-reset-success"
            className="p-2.5 rounded-xl bg-[#0D8A8A]/10 border border-[#0D8A8A]/40 flex items-start gap-2 text-xs font-semibold theme-win"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{infoMsg}</span>
          </div>
        )}

        {resetDone ? (
          <button
            type="button"
            data-testid="auth-reset-go-login"
            onClick={() => {
              setMode('login');
              setResetDone(false);
            }}
            className="w-full min-h-[42px] rounded-xl bg-[#D4AE58] hover:bg-[#E5BF69] text-[#0B1528] text-xs font-extrabold cursor-pointer transition-colors"
          >
            ورود با رمز عبور جدید
          </button>
        ) : (
          <form onSubmit={handleResetPasswordSubmit} className="space-y-2.5">
            <div>
              <label
                htmlFor="auth-reset-password"
                className="block text-[11px] font-bold theme-heading mb-1"
              >
                رمز عبور جدید (حداقل ۸ کاراکتر، شامل حرف و عدد)
              </label>
              <input
                id="auth-reset-password"
                data-testid="auth-reset-password"
                type="password"
                dir="ltr"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                maxLength={128}
                required
                className="w-full min-h-[40px] px-3 rounded-xl theme-input border text-xs font-semibold text-left focus:outline-none focus:border-[#0D8A8A]"
              />
            </div>
            <div>
              <label
                htmlFor="auth-reset-confirm"
                className="block text-[11px] font-bold theme-heading mb-1"
              >
                تکرار رمز عبور جدید
              </label>
              <input
                id="auth-reset-confirm"
                data-testid="auth-reset-confirm"
                type="password"
                dir="ltr"
                autoComplete="new-password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                minLength={8}
                maxLength={128}
                required
                className="w-full min-h-[40px] px-3 rounded-xl theme-input border text-xs font-semibold text-left focus:outline-none focus:border-[#0D8A8A]"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              data-testid="auth-reset-submit"
              className="w-full min-h-[42px] rounded-xl bg-[#D4AE58] hover:bg-[#E5BF69] disabled:opacity-50 text-[#0B1528] text-xs font-extrabold cursor-pointer transition-colors"
            >
              {submitting ? 'در حال ثبت رمز جدید...' : 'ثبت رمز عبور جدید'}
            </button>
          </form>
        )}
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="p-3.5 rounded-xl theme-subcard border text-xs theme-muted text-center">
        در حال بررسی وضعیت حساب کاربری...
      </div>
    );
  }

  if (authUser) {
    return (
      <div
        className="p-3.5 rounded-2xl theme-subcard border space-y-3"
        data-testid="auth-signed-in-panel"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-extrabold theme-heading">
              <ShieldCheck className="w-4 h-4 theme-accent-teal shrink-0" />
              <span>حساب مرکزی ایوان فعال است</span>
            </div>
            <div
              dir="ltr"
              className="text-xs font-bold theme-accent-gold mt-1 truncate text-right"
              data-testid="auth-user-username"
            >
              {authUser.username}
            </div>
            {authUser.email && (
              <div
                dir="ltr"
                className="text-[11px] theme-muted truncate text-right"
                data-testid="auth-user-email"
              >
                {authUser.email}
              </div>
            )}
          </div>
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-md border shrink-0 ${
              authUser.emailVerified
                ? 'border-[#0D8A8A]/50 text-[#0D8A8A]'
                : 'border-[#D4AE58]/50 theme-accent-gold'
            }`}
          >
            {authUser.emailVerified ? 'ایمیل تایید شده' : 'در انتظار تایید ایمیل'}
          </span>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="p-2.5 rounded-xl bg-[#DC2626]/10 border border-[#DC2626]/40 flex items-start gap-2 text-xs font-semibold theme-loss"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {infoMsg && (
          <div className="p-2.5 rounded-xl bg-[#0D8A8A]/10 border border-[#0D8A8A]/40 flex items-start gap-2 text-xs font-semibold theme-win">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{infoMsg}</span>
          </div>
        )}

        {/* Linked Providers & Explicit Google Linking */}
        <div className="pt-1 border-t border-[var(--eyvan-line)] space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-bold theme-muted">
              روش‌های ورود متصل:
            </span>
            <div className="flex items-center gap-1.5">
              {linkedProviders.includes('password') && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-[var(--eyvan-line)] theme-heading">
                  رمز عبور
                </span>
              )}
              {linkedProviders.includes('google') && (
                <span
                  data-testid="auth-provider-google-badge"
                  className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-[#0D8A8A]/50 theme-accent-teal"
                >
                  گوگل
                </span>
              )}
            </div>
          </div>

          {!linkedProviders.includes('google') && (
            <button
              type="button"
              disabled={submitting || googleBusy}
              onClick={() => void handleGoogleOAuth('link')}
              data-testid="auth-link-google-btn"
              className="w-full min-h-[38px] px-3 rounded-xl border border-[var(--eyvan-gold-border)] hover:border-[#D4AE58] text-xs font-bold theme-heading flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
            >
              <Link2 className="w-3.5 h-3.5 theme-accent-gold" />
              <span>
                {googleBusy
                  ? 'در حال اتصال به گوگل...'
                  : 'اتصال حساب گوگل به این حساب'}
              </span>
            </button>
          )}
        </div>

        {/* Collapsible Active Sessions Management */}
        <div className="pt-1 border-t border-[var(--eyvan-line)] space-y-2">
          <button
            type="button"
            onClick={() => {
              const next = !sessionsOpen;
              setSessionsOpen(next);
              if (next) void loadAccountSecurityState();
            }}
            data-testid="auth-sessions-toggle"
            className="w-full flex items-center justify-between text-[11px] font-bold theme-heading py-1 cursor-pointer"
          >
            <span className="inline-flex items-center gap-1.5">
              <Monitor className="w-3.5 h-3.5 theme-accent-teal" />
              <span>
                نشست‌های فعال ({toPersianDigits(activeSessions.length)})
              </span>
            </span>
            {sessionsOpen ? (
              <ChevronUp className="w-3.5 h-3.5 theme-muted" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 theme-muted" />
            )}
          </button>

          {sessionsOpen && (
            <div
              className="space-y-1.5"
              data-testid="auth-sessions-list"
            >
              {sessionsLoading ? (
                <div className="text-[11px] theme-muted py-2 text-center">
                  در حال دریافت نشست‌ها...
                </div>
              ) : activeSessions.length === 0 ? (
                <div className="text-[11px] theme-muted py-2 text-center">
                  نشست فعالی یافت نشد.
                </div>
              ) : (
                activeSessions.map((sess) => (
                  <div
                    key={sess.sessionId}
                    data-testid={`auth-session-row-${sess.isCurrent ? 'current' : sess.sessionId}`}
                    className="p-2 rounded-xl theme-input border flex items-center justify-between gap-2 text-[11px]"
                  >
                    <div className="min-w-0">
                      <div className="font-bold theme-heading truncate">
                        {sess.isCurrent ? 'همین دستگاه (نشست فعلی)' : 'دستگاه دیگر'}
                      </div>
                      <div className="text-[10px] theme-muted">
                        آخرین فعالیت:{' '}
                        {new Date(sess.lastSeenAt).toLocaleDateString('fa-IR')}
                      </div>
                    </div>
                    {!sess.isCurrent && (
                      <button
                        type="button"
                        disabled={revokingSessionId === sess.sessionId}
                        onClick={() => void handleRevokeSingleSession(sess.sessionId)}
                        data-testid={`auth-revoke-session-${sess.sessionId}`}
                        className="px-2.5 min-h-[30px] rounded-lg border border-[#DC2626]/45 text-[10px] font-bold theme-loss hover:bg-[#DC2626]/10 inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>لغو</span>
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            disabled={submitting}
            onClick={handleLogout}
            data-testid="auth-logout-btn"
            className="min-h-[40px] px-3 rounded-xl border border-[#DC2626]/45 text-xs font-bold theme-loss hover:bg-[#DC2626]/10 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>خروج از حساب</span>
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleLogoutAll}
            data-testid="auth-logout-all-btn"
            className="min-h-[40px] px-3 rounded-xl border border-[var(--eyvan-gold-border)] text-xs font-bold theme-muted hover:theme-heading disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
          >
            <span>خروج از همه دستگاه‌ها</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="p-3.5 rounded-2xl theme-subcard border space-y-3"
      data-testid="auth-guest-panel"
    >
      <div className="space-y-1">
        <div className="text-xs font-extrabold theme-heading">
          ورود یا ثبت‌نام در حساب مرکزی ایوان
        </div>
        <p className="text-[11px] theme-muted leading-relaxed">
          اکنون در حالت مهمان هستید. برای بازی حکم نیازی به ثبت‌نام نیست، اما با
          ساخت و تأیید حساب، هویت کاربری شما در تمام بازی‌های ایوان حفظ می‌شود.
        </p>
      </div>

      {/* Mode Switch */}
      <div className="grid grid-cols-2 gap-1 p-1 theme-tab-track rounded-xl border">
        <button
          type="button"
          data-testid="auth-mode-login"
          onClick={() => {
            setMode('login');
            resetFeedback();
          }}
          className={`min-h-[34px] rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
            mode === 'login' || mode === 'forgot'
              ? 'bg-[#D4AE58] text-[#0B1528]'
              : 'theme-muted'
          }`}
        >
          <LogIn className="w-3.5 h-3.5" />
          <span>ورود</span>
        </button>
        <button
          type="button"
          data-testid="auth-mode-register"
          onClick={() => {
            setMode('register');
            resetFeedback();
          }}
          className={`min-h-[34px] rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
            mode === 'register' || mode === 'pending_verify'
              ? 'bg-[#D4AE58] text-[#0B1528]'
              : 'theme-muted'
          }`}
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>ثبت‌نام</span>
        </button>
      </div>

      {errorMsg && (
        <div
          role="alert"
          data-testid="auth-error-msg"
          className="p-2.5 rounded-xl bg-[#DC2626]/10 border border-[#DC2626]/40 flex items-start gap-2 text-xs font-semibold theme-loss"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {infoMsg && (
        <div
          data-testid="auth-info-msg"
          className="p-2.5 rounded-xl bg-[#0D8A8A]/10 border border-[#0D8A8A]/40 flex items-start gap-2 text-xs font-semibold theme-win"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{infoMsg}</span>
        </div>
      )}

      {mode === 'login' && (
        <div className="space-y-2.5">
          <form onSubmit={handleLoginSubmit} className="space-y-2.5">
            <div>
              <label
                htmlFor="auth-login-identifier"
                className="block text-[11px] font-bold theme-heading mb-1"
              >
                ایمیل یا نام کاربری
              </label>
              <input
                id="auth-login-identifier"
                data-testid="auth-login-identifier"
                type="text"
                dir="ltr"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="name@example.com or player_one"
                required
                className="w-full min-h-[40px] px-3 rounded-xl theme-input border text-xs font-semibold text-left focus:outline-none focus:border-[#0D8A8A]"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="auth-login-password"
                  className="block text-[11px] font-bold theme-heading"
                >
                  رمز عبور
                </label>
                <button
                  type="button"
                  data-testid="auth-forgot-link"
                  onClick={() => {
                    setForgotEmail(identifier.includes('@') ? identifier.trim() : '');
                    setMode('forgot');
                    resetFeedback();
                  }}
                  className="text-[11px] font-bold theme-accent-gold hover:underline cursor-pointer"
                >
                  فراموشی رمز عبور؟
                </button>
              </div>
              <input
                id="auth-login-password"
                data-testid="auth-login-password"
                type="password"
                dir="ltr"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full min-h-[40px] px-3 rounded-xl theme-input border text-xs font-semibold text-left focus:outline-none focus:border-[#0D8A8A]"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              data-testid="auth-login-submit"
              className="w-full min-h-[42px] rounded-xl bg-[#D4AE58] hover:bg-[#E5BF69] disabled:opacity-50 text-[#0B1528] text-xs font-extrabold cursor-pointer transition-colors"
            >
              {submitting ? 'در حال ورود...' : 'ورود به حساب'}
            </button>
          </form>

          {unverifiedNotice && (
            <div
              data-testid="auth-unverified-resend-box"
              className="p-2.5 rounded-xl border border-[#D4AE58]/40 bg-[#D4AE58]/10 space-y-2"
            >
              <div className="text-[11px] font-bold theme-heading">
                حساب شما در انتظار تأیید ایمیل است
              </div>
              <div className="flex gap-1.5">
                <input
                  type="email"
                  dir="ltr"
                  data-testid="auth-inline-resend-email"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="flex-1 min-h-[36px] px-2.5 rounded-lg theme-input border text-xs text-left focus:outline-none focus:border-[#0D8A8A]"
                />
                <button
                  type="button"
                  disabled={submitting}
                  data-testid="auth-inline-resend-btn"
                  onClick={() => handleResendVerification()}
                  className="px-3 min-h-[36px] rounded-lg bg-[#0D8A8A] hover:bg-[#0F9F9F] disabled:opacity-50 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer shrink-0 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>ارسال مجدد</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {mode === 'register' && (
        <form onSubmit={handleRegisterSubmit} className="space-y-2.5">
          <div>
            <label
              htmlFor="auth-reg-email"
              className="block text-[11px] font-bold theme-heading mb-1"
            >
              ایمیل
            </label>
            <input
              id="auth-reg-email"
              data-testid="auth-reg-email"
              type="email"
              dir="ltr"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full min-h-[40px] px-3 rounded-xl theme-input border text-xs font-semibold text-left focus:outline-none focus:border-[#0D8A8A]"
            />
          </div>
          <div>
            <label
              htmlFor="auth-reg-username"
              className="block text-[11px] font-bold theme-heading mb-1"
            >
              نام کاربری (انگلیسی، ۳ تا ۲۰ کاراکتر)
            </label>
            <input
              id="auth-reg-username"
              data-testid="auth-reg-username"
              type="text"
              dir="ltr"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="player_one"
              maxLength={20}
              required
              className="w-full min-h-[40px] px-3 rounded-xl theme-input border text-xs font-semibold text-left focus:outline-none focus:border-[#0D8A8A]"
            />
          </div>
          <div>
            <label
              htmlFor="auth-reg-password"
              className="block text-[11px] font-bold theme-heading mb-1"
            >
              رمز عبور (حداقل ۸ کاراکتر، شامل حرف و عدد)
            </label>
            <input
              id="auth-reg-password"
              data-testid="auth-reg-password"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              maxLength={128}
              required
              className="w-full min-h-[40px] px-3 rounded-xl theme-input border text-xs font-semibold text-left focus:outline-none focus:border-[#0D8A8A]"
            />
          </div>
          <div>
            <label
              htmlFor="auth-reg-confirm"
              className="block text-[11px] font-bold theme-heading mb-1"
            >
              تکرار رمز عبور
            </label>
            <input
              id="auth-reg-confirm"
              data-testid="auth-reg-confirm"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              maxLength={128}
              required
              className="w-full min-h-[40px] px-3 rounded-xl theme-input border text-xs font-semibold text-left focus:outline-none focus:border-[#0D8A8A]"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            data-testid="auth-reg-submit"
            className="w-full min-h-[42px] rounded-xl bg-[#D4AE58] hover:bg-[#E5BF69] disabled:opacity-50 text-[#0B1528] text-xs font-extrabold cursor-pointer transition-colors"
          >
            {submitting ? 'در حال ثبت‌نام...' : 'ساخت حساب کاربری'}
          </button>
        </form>
      )}

      {(mode === 'login' || mode === 'register') && (
        <div className="pt-1 space-y-2">
          <div className="flex items-center gap-2 text-[10px] theme-muted">
            <span className="flex-1 h-px bg-[var(--eyvan-line)]" />
            <span>یا</span>
            <span className="flex-1 h-px bg-[var(--eyvan-line)]" />
          </div>
          <button
            type="button"
            disabled={submitting || googleBusy}
            onClick={() => void handleGoogleOAuth('login')}
            data-testid="auth-google-btn"
            className="w-full min-h-[42px] px-3 rounded-xl theme-input border border-[var(--eyvan-gold-border)] hover:border-[#D4AE58] disabled:opacity-50 text-xs font-extrabold theme-heading flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            <svg
              aria-hidden="true"
              className="w-4 h-4 shrink-0"
              viewBox="0 0 24 24"
            >
              <path
                fill="#EA4335"
                d="M12 10.2v3.9h5.4c-.2 1.3-1.5 3.9-5.4 3.9-3.2 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.8 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.4 14.6 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12s4.3 9.5 9.5 9.5c5.5 0 9.1-3.9 9.1-9.3 0-.6-.1-1.1-.2-1.6H12z"
              />
            </svg>
            <span>
              {googleBusy ? 'در حال اتصال به گوگل...' : 'ورود با حساب گوگل'}
            </span>
          </button>
          {googleConfigured === false && (
            <p
              data-testid="auth-google-not-configured-hint"
              className="text-[10px] theme-muted text-center leading-relaxed"
            >
              ورود با گوگل پس از تنظیم کلیدهای Google OAuth در سرور فعال می‌شود.
            </p>
          )}
        </div>
      )}

      {mode === 'pending_verify' && (
        <form
          onSubmit={handleResendVerification}
          className="space-y-2.5"
          data-testid="auth-pending-verify-panel"
        >
          <div className="p-2.5 rounded-xl border border-[#D4AE58]/40 bg-[#D4AE58]/10 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-extrabold theme-heading">
              <MailCheck className="w-4 h-4 theme-accent-gold shrink-0" />
              <span>تأیید ایمیل برای فعال‌سازی حساب</span>
            </div>
            <p className="text-[11px] theme-muted leading-relaxed">
              پس از باز کردن لینک تأیید در ایمیل، حساب شما فعال می‌شود و می‌توانید
              وارد شوید.
            </p>
          </div>

          <div>
            <label
              htmlFor="auth-resend-email"
              className="block text-[11px] font-bold theme-heading mb-1"
            >
              ایمیل برای ارسال مجدد لینک تأیید
            </label>
            <input
              id="auth-resend-email"
              data-testid="auth-resend-email"
              type="email"
              dir="ltr"
              autoComplete="email"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full min-h-[40px] px-3 rounded-xl theme-input border text-xs font-semibold text-left focus:outline-none focus:border-[#0D8A8A]"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            data-testid="auth-resend-submit"
            className="w-full min-h-[40px] rounded-xl bg-[#0D8A8A] hover:bg-[#0F9F9F] disabled:opacity-50 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{submitting ? 'در حال ارسال...' : 'ارسال مجدد ایمیل تأیید'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMode('login');
              resetFeedback();
            }}
            className="w-full min-h-[36px] rounded-xl border border-[var(--eyvan-gold-border)] text-xs font-bold theme-muted hover:theme-heading cursor-pointer transition-colors"
          >
            بازگشت به صفحه ورود
          </button>
        </form>
      )}

      {mode === 'forgot' && (
        <form
          onSubmit={handleForgotSubmit}
          className="space-y-2.5"
          data-testid="auth-forgot-panel"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-extrabold theme-heading">
              <KeyRound className="w-4 h-4 theme-accent-gold shrink-0" />
              <span>بازیابی رمز عبور</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setMode('login');
                resetFeedback();
              }}
              className="text-[11px] font-bold theme-muted hover:theme-heading flex items-center gap-1 cursor-pointer"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              <span>بازگشت به ورود</span>
            </button>
          </div>
          <p className="text-[11px] theme-muted leading-relaxed">
            ایمیل ثبت‌شده خود را وارد کنید تا لینک یک‌بارمصرف بازیابی رمز عبور
            برای شما ارسال شود.
          </p>
          <div>
            <label
              htmlFor="auth-forgot-email"
              className="block text-[11px] font-bold theme-heading mb-1"
            >
              ایمیل
            </label>
            <input
              id="auth-forgot-email"
              data-testid="auth-forgot-email"
              type="email"
              dir="ltr"
              autoComplete="email"
              value={forgotEmail}
              onChange={(e) => setForgotEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full min-h-[40px] px-3 rounded-xl theme-input border text-xs font-semibold text-left focus:outline-none focus:border-[#0D8A8A]"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            data-testid="auth-forgot-submit"
            className="w-full min-h-[42px] rounded-xl bg-[#D4AE58] hover:bg-[#E5BF69] disabled:opacity-50 text-[#0B1528] text-xs font-extrabold cursor-pointer transition-colors"
          >
            {submitting ? 'در حال ارسال...' : 'ارسال لینک بازیابی رمز عبور'}
          </button>
        </form>
      )}
    </div>
  );
};
