import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  AtSign,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Mail,
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
  checkEmailExistsRequest,
  checkUsernameAvailabilityRequest,
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
import { validateUsernameFormat } from '../data/guestDefaults';
import { toPersianDigits } from '../theme/tokens';
import { computePasswordStrength } from '../utils/gameHubHelpers';

interface AccountAuthPanelProps {
  authUser: AuthUserSummary | null;
  authLoading: boolean;
  onAuthChange: (user: AuthUserSummary | null) => void;
  pendingAuthAction?: PendingAuthUrlAction | null;
  onClearPendingAuthAction?: () => void;
  initialMode?: 'login' | 'register';
}

type AuthFormMode =
  | 'email_entry'
  | 'login_password'
  | 'register_details'
  | 'pending_verify'
  | 'forgot'
  | 'verify_token'
  | 'reset_password';

type RegUsernameStatus =
  | { state: 'idle' }
  | { state: 'invalid'; message: string }
  | { state: 'checking' }
  | { state: 'available'; message: string }
  | { state: 'taken'; message: string };

const GoogleLogoSvg: React.FC = () => (
  <svg aria-hidden="true" className="w-[18px] h-[18px] shrink-0" viewBox="0 0 24 24">
    <path
      fill="#4285F4"
      d="M23.52 12.27c0-.85-.08-1.68-.22-2.47H12v4.68h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.83z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.07 7.94-2.9l-3.88-3c-1.08.72-2.46 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.95H1.28v3.1A12 12 0 0 0 12 24z"
    />
    <path
      fill="#FBBC05"
      d="M5.28 14.3a7.18 7.18 0 0 1 0-4.6V6.6H1.28a12 12 0 0 0 0 10.8l4-3.1z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.6l4 3.1c.95-2.84 3.6-4.95 6.72-4.95z"
    />
  </svg>
);

export const AccountAuthPanel: React.FC<AccountAuthPanelProps> = ({
  authUser,
  authLoading,
  onAuthChange,
  pendingAuthAction = null,
  onClearPendingAuthAction,
  initialMode = 'login',
}) => {
  const [mode, setMode] = useState<AuthFormMode>('email_entry');
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

  // Password visibility toggles
  const [showLoginPass, setShowLoginPass] = useState(false);
  const [showRegPass, setShowRegPass] = useState(false);
  const [showRegConfirm, setShowRegConfirm] = useState(false);
  const [showResetPass, setShowResetPass] = useState(false);

  // Live registration username server availability
  const [regUsernameStatus, setRegUsernameStatus] = useState<RegUsernameStatus>({
    state: 'idle',
  });
  const usernameCheckTimerRef = useRef<number | null>(null);
  const usernameCheckAbortRef = useRef<AbortController | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [unverifiedNotice, setUnverifiedNotice] = useState(false);
  const [verifyState, setVerifyState] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [resetDone, setResetDone] = useState(false);

  // Google OAuth, linked providers & active sessions
  const [googleConfigured, setGoogleConfigured] = useState<boolean | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [linkedProviders, setLinkedProviders] = useState<LinkedAuthProvider[]>([]);
  const [activeSessions, setActiveSessions] = useState<ActiveAuthSessionItem[]>([]);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);

  const lastAutoVerifiedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingAuthAction && initialMode) {
      setMode('email_entry');
    }
  }, [initialMode, pendingAuthAction]);

  useEffect(() => {
    return () => {
      if (usernameCheckTimerRef.current) {
        window.clearTimeout(usernameCheckTimerRef.current);
      }
      usernameCheckAbortRef.current?.abort();
    };
  }, []);

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

  // React to `#verify-email=` or `#reset-password=` actions
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
              res.message ??
                'لینک تأیید ایمیل نامعتبر، استفاده‌شده یا منقضی شده است.'
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

  const handleRegUsernameChange = (raw: string) => {
    setUsername(raw);
    if (usernameCheckTimerRef.current) {
      window.clearTimeout(usernameCheckTimerRef.current);
    }
    usernameCheckAbortRef.current?.abort();

    const trimmed = raw.trim();
    if (!trimmed) {
      setRegUsernameStatus({ state: 'idle' });
      return;
    }

    const fmt = validateUsernameFormat(trimmed);
    if (!fmt.valid) {
      setRegUsernameStatus({
        state: 'invalid',
        message: fmt.message ?? '۳ تا ۲۰ کاراکتر انگلیسی، عدد، نقطه یا زیرخط',
      });
      return;
    }

    setRegUsernameStatus({ state: 'checking' });
    usernameCheckTimerRef.current = window.setTimeout(async () => {
      const controller = new AbortController();
      usernameCheckAbortRef.current = controller;
      try {
        const res = await checkUsernameAvailabilityRequest(
          trimmed,
          controller.signal
        );
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setRegUsernameStatus({ state: 'idle' });
          return;
        }
        if (res.valid === false) {
          setRegUsernameStatus({
            state: 'invalid',
            message: res.message || 'فرمت نام کاربری معتبر نیست.',
          });
          return;
        }
        if (res.available) {
          setRegUsernameStatus({ state: 'available', message: 'آزاد است' });
        } else {
          setRegUsernameStatus({
            state: 'taken',
            message: 'این نام کاربری قبلاً ثبت شده',
          });
        }
      } catch {
        setRegUsernameStatus({ state: 'idle' });
      }
    }, 320);
  };

  const regPasswordStrength = useMemo(
    () => computePasswordStrength(password),
    [password]
  );
  const resetPasswordStrength = useMemo(
    () => computePasswordStrength(newPassword),
    [newPassword]
  );
  const passwordsMatch =
    confirmPassword.length > 0 && password === confirmPassword;
  const passwordsMismatch =
    confirmPassword.length > 0 && password !== confirmPassword;

  const handleEmailCheckSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const cleaned = email.trim();
    if (!cleaned) {
      setErrorMsg('لطفاً ایمیل خود را وارد کنید.');
      return;
    }
    resetFeedback();
    setSubmitting(true);
    try {
      const res = await checkEmailExistsRequest(cleaned);
      if (!res.ok) {
        setErrorMsg(res.message ?? 'فرمت ایمیل واردشده معتبر نیست.');
        return;
      }
      const normalized = res.email ?? cleaned;
      setEmail(normalized);
      setIdentifier(normalized);
      setPassword('');
      setConfirmPassword('');
      if (res.exists) {
        setMode('login_password');
      } else {
        setMode('register_details');
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'خطا در برقراری ارتباط با سرور.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    resetFeedback();
    setSubmitting(true);
    try {
      const loginId = (email || identifier).trim();
      const res = await loginAccount({ identifier: loginId, password });
      if (!res.ok || !res.user) {
        setErrorMsg(res.message ?? 'ورود انجام نشد.');
        if (res.code === 'EMAIL_NOT_VERIFIED' || res.verificationRequired) {
          setUnverifiedNotice(true);
          if (loginId.includes('@')) {
            setResendEmail(loginId);
          }
        }
        return;
      }
      setPassword('');
      setIdentifier('');
      try {
        window.sessionStorage.removeItem('eyvan_test_logged_out');
      } catch {
        // Ignore storage restriction
      }
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
      try {
        window.sessionStorage.removeItem('eyvan_test_logged_out');
      } catch {
        // Ignore storage restriction
      }
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
      setErrorMsg(
        'توکن بازیابی رمز عبور موجود نیست. لطفاً مجدداً درخواست بازیابی ثبت کنید.'
      );
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
      try {
        window.sessionStorage.setItem('eyvan_test_logged_out', '1');
      } catch {
        // Ignore storage restriction
      }
      onAuthChange(null);
      setInfoMsg(
        'از حساب کاربری خارج شدید. همچنان می‌توانید به‌صورت مهمان بازی کنید.'
      );
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
      try {
        window.sessionStorage.setItem('eyvan_test_logged_out', '1');
      } catch {
        // Ignore storage restriction
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
        try {
          window.sessionStorage.removeItem('eyvan_test_logged_out');
        } catch {
          // Ignore storage restriction
        }
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
        try {
          window.sessionStorage.setItem('eyvan_test_logged_out', '1');
        } catch {
          // Ignore storage restriction
        }
        onAuthChange(null);
        setInfoMsg('نشست فعلی لغو شد.');
        return;
      }
      setActiveSessions((prev) =>
        prev.filter((s) => s.sessionId !== sessionId)
      );
      setInfoMsg(res.message ?? 'نشست انتخاب‌شده با موفقیت لغو شد.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'خطا در لغو نشست.');
    } finally {
      setRevokingSessionId(null);
    }
  };

  // Dedicated C2 Token Flow: Verify Email
  if (mode === 'verify_token') {
    return (
      <div className="space-y-4" data-testid="auth-verify-email-panel">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-[#0D8A8A]/14 border border-[#0D8A8A]/35 flex items-center justify-center shrink-0">
            <MailCheck className="w-5 h-5 theme-accent-teal" />
          </div>
          <div>
            <h3 className="text-sm font-extrabold theme-heading">
              تأیید ایمیل حساب کاربری
            </h3>
            <p className="text-xs theme-muted">فعال‌سازی حساب مرکزی ایوان</p>
          </div>
        </div>

        {verifyState === 'loading' && (
          <div className="p-4 rounded-xl theme-subcard border text-xs theme-muted flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>در حال بررسی و تأیید لینک ایمیل...</span>
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            data-testid="auth-verify-error"
            className="p-3 rounded-xl bg-[#DC2626]/10 border border-[#DC2626]/40 flex items-start gap-2 text-xs font-semibold theme-loss"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {infoMsg && (
          <div
            data-testid="auth-verify-success"
            className="p-3 rounded-xl bg-[#0D8A8A]/10 border border-[#0D8A8A]/40 flex items-start gap-2 text-xs font-semibold theme-win"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{infoMsg}</span>
          </div>
        )}

        <div className="space-y-2">
          <button
            type="button"
            data-testid="auth-verify-go-login"
            onClick={() => {
              setMode('email_entry');
              setVerifyState('idle');
            }}
            className="w-full min-h-[46px] rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1528] text-sm font-black cursor-pointer"
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
              className="w-full min-h-[42px] rounded-xl theme-btn-secondary border text-xs font-bold cursor-pointer"
            >
              درخواست ارسال مجدد لینک تأیید
            </button>
          )}
        </div>
      </div>
    );
  }

  // Dedicated C2 Token Flow: Reset Password
  if (mode === 'reset_password') {
    return (
      <div className="space-y-4" data-testid="auth-reset-password-panel">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-extrabold theme-heading">
            <KeyRound className="w-4 h-4 theme-accent-gold shrink-0" />
            <span>تنظیم رمز عبور جدید</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setResetToken(null);
              setMode('email_entry');
              resetFeedback();
            }}
            className="text-xs font-bold theme-muted hover:theme-heading flex items-center gap-1 cursor-pointer"
          >
            <span>بازگشت</span>
            <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
          </button>
        </div>

        {errorMsg && (
          <div
            role="alert"
            data-testid="auth-reset-error"
            className="p-3 rounded-xl bg-[#DC2626]/10 border border-[#DC2626]/40 flex items-start gap-2 text-xs font-semibold theme-loss"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {infoMsg && (
          <div
            data-testid="auth-reset-success"
            className="p-3 rounded-xl bg-[#0D8A8A]/10 border border-[#0D8A8A]/40 flex items-start gap-2 text-xs font-semibold theme-win"
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
              setMode('email_entry');
              setResetDone(false);
            }}
            className="w-full min-h-[46px] rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1528] text-sm font-black cursor-pointer"
          >
            ورود با رمز عبور جدید
          </button>
        ) : (
          <form onSubmit={handleResetPasswordSubmit} className="space-y-3.5">
            <div className="space-y-1.5">
              <label
                htmlFor="auth-reset-password"
                className="block text-xs font-bold theme-heading"
              >
                رمز عبور جدید
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 theme-muted absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="auth-reset-password"
                  data-testid="auth-reset-password"
                  type={showResetPass ? 'text' : 'password'}
                  dir="ltr"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                  maxLength={128}
                  required
                  className="w-full min-h-[46px] pr-10 pl-11 rounded-xl theme-input border text-sm font-semibold text-left focus:outline-none focus:ring-2 focus:ring-[var(--eyvan-teal)]"
                />
                <button
                  type="button"
                  onClick={() => setShowResetPass((v) => !v)}
                  aria-label={showResetPass ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'}
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 min-w-[38px] min-h-[38px] rounded-lg flex items-center justify-center theme-muted hover:text-[var(--eyvan-text)] cursor-pointer"
                >
                  {showResetPass ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              {newPassword.length > 0 && (
                <PasswordStrengthMeter strength={resetPasswordStrength} />
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="auth-reset-confirm"
                className="block text-xs font-bold theme-heading"
              >
                تکرار رمز عبور جدید
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 theme-muted absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="auth-reset-confirm"
                  data-testid="auth-reset-confirm"
                  type={showResetPass ? 'text' : 'password'}
                  dir="ltr"
                  autoComplete="new-password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  minLength={8}
                  maxLength={128}
                  required
                  className="w-full min-h-[46px] pr-10 pl-3.5 rounded-xl theme-input border text-sm font-semibold text-left focus:outline-none focus:ring-2 focus:ring-[var(--eyvan-teal)]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              data-testid="auth-reset-submit"
              className="w-full min-h-[46px] rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] disabled:opacity-50 text-[#0B1528] text-sm font-black cursor-pointer"
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
      <div className="p-5 rounded-2xl theme-subcard border text-xs theme-muted flex items-center justify-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>در حال بررسی وضعیت حساب...</span>
      </div>
    );
  }

  // Signed-In Account Security View
  if (authUser) {
    return (
      <div className="space-y-4" data-testid="auth-signed-in-panel">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 text-sm font-extrabold theme-heading">
              <ShieldCheck className="w-4 h-4 theme-accent-teal shrink-0" />
              <span>حساب مرکزی فعال است</span>
            </div>
            <div
              dir="ltr"
              className="text-sm font-extrabold theme-accent-gold truncate text-right"
              data-testid="auth-user-username"
            >
              {authUser.username}
            </div>
            {authUser.email && (
              <div
                dir="ltr"
                className="text-xs theme-muted truncate text-right"
                data-testid="auth-user-email"
              >
                {authUser.email}
              </div>
            )}
          </div>

          <span
            className={`text-xs font-bold shrink-0 ${
              authUser.emailVerified ? 'theme-win' : 'theme-accent-gold'
            }`}
          >
            {authUser.emailVerified ? 'ایمیل تأییدشده' : 'در انتظار تأیید'}
          </span>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-[#DC2626]/10 border border-[#DC2626]/40 flex items-start gap-2 text-xs font-semibold theme-loss"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {infoMsg && (
          <div className="p-3 rounded-xl bg-[#0D8A8A]/10 border border-[#0D8A8A]/40 flex items-start gap-2 text-xs font-semibold theme-win">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{infoMsg}</span>
          </div>
        )}

        {/* Connected Login Providers */}
        <div className="pt-3.5 border-t border-[var(--eyvan-line)] space-y-2.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-bold theme-muted">روش‌های ورود متصل</span>
            <div className="flex items-center gap-2 font-extrabold">
              {linkedProviders.includes('password') && (
                <span className="theme-heading">رمز عبور</span>
              )}
              {linkedProviders.includes('password') &&
                linkedProviders.includes('google') && (
                  <span className="theme-muted">·</span>
                )}
              {linkedProviders.includes('google') && (
                <span
                  data-testid="auth-provider-google-badge"
                  className="theme-accent-teal"
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
              className="w-full min-h-[44px] px-3.5 rounded-xl theme-btn-secondary border text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Link2 className="w-4 h-4 theme-accent-gold shrink-0" />
              <span>
                {googleBusy
                  ? 'در حال اتصال به گوگل...'
                  : 'اتصال حساب گوگل به این حساب'}
              </span>
            </button>
          )}
        </div>

        {/* Collapsible Active Sessions */}
        <div className="pt-3.5 border-t border-[var(--eyvan-line)] space-y-2.5">
          <button
            type="button"
            onClick={() => {
              const next = !sessionsOpen;
              setSessionsOpen(next);
              if (next) void loadAccountSecurityState();
            }}
            data-testid="auth-sessions-toggle"
            className="w-full min-h-[38px] flex items-center justify-between text-xs font-extrabold theme-heading cursor-pointer"
          >
            <span className="inline-flex items-center gap-2">
              <Monitor className="w-4 h-4 theme-accent-teal shrink-0" />
              <span>
                نشست‌های فعال ({toPersianDigits(activeSessions.length)})
              </span>
            </span>
            {sessionsOpen ? (
              <ChevronUp className="w-4 h-4 theme-muted" />
            ) : (
              <ChevronDown className="w-4 h-4 theme-muted" />
            )}
          </button>

          {sessionsOpen && (
            <div className="space-y-2" data-testid="auth-sessions-list">
              {sessionsLoading ? (
                <div className="text-xs theme-muted py-2 text-center">
                  در حال دریافت نشست‌ها...
                </div>
              ) : activeSessions.length === 0 ? (
                <div className="text-xs theme-muted py-2 text-center">
                  نشست فعالی یافت نشد.
                </div>
              ) : (
                activeSessions.map((sess) => (
                  <div
                    key={sess.sessionId}
                    data-testid={`auth-session-row-${sess.isCurrent ? 'current' : sess.sessionId}`}
                    className="p-3 rounded-xl theme-subcard border flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-bold theme-heading truncate">
                        {sess.isCurrent
                          ? 'همین دستگاه (نشست فعلی)'
                          : 'دستگاه دیگر'}
                      </div>
                      <div className="text-[11px] theme-muted mt-0.5">
                        آخرین فعالیت:{' '}
                        {new Date(sess.lastSeenAt).toLocaleDateString('fa-IR')}
                      </div>
                    </div>
                    {!sess.isCurrent && (
                      <button
                        type="button"
                        disabled={revokingSessionId === sess.sessionId}
                        onClick={() =>
                          void handleRevokeSingleSession(sess.sessionId)
                        }
                        data-testid={`auth-revoke-session-${sess.sessionId}`}
                        className="px-3 min-h-[34px] rounded-lg border border-[#DC2626]/45 text-xs font-bold theme-loss hover:bg-[#DC2626]/10 inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>لغو</span>
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Sign Out Actions */}
        <div className="grid grid-cols-2 gap-2.5 pt-2">
          <button
            type="button"
            disabled={submitting}
            onClick={handleLogout}
            data-testid="auth-logout-btn"
            className="min-h-[44px] px-3 rounded-xl border border-[#DC2626]/45 text-xs font-extrabold theme-loss hover:bg-[#DC2626]/10 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>خروج از حساب</span>
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleLogoutAll}
            data-testid="auth-logout-all-btn"
            className="min-h-[44px] px-3 rounded-xl theme-btn-secondary border text-xs font-bold disabled:opacity-50 flex items-center justify-center cursor-pointer transition-colors"
          >
            <span>خروج از همه دستگاه‌ها</span>
          </button>
        </div>
      </div>
    );
  }

  // Unified Email-First Auth Flow (Single clean entry: auto-detects Login vs Registration from DB)
  return (
    <div className="space-y-4" data-testid="auth-guest-panel">
      {/* Clean Contextual Header */}
      <div className="space-y-1">
        <h3 className="text-base font-black theme-heading">
          {mode === 'register_details'
            ? 'ساخت حساب جدید'
            : mode === 'login_password'
              ? 'ورود به حساب'
              : mode === 'pending_verify'
                ? 'تأیید ایمیل'
                : mode === 'forgot'
                  ? 'بازیابی رمز عبور'
                  : 'ورود به ایوان'}
        </h3>
        <p className="text-xs theme-muted leading-relaxed">
          {mode === 'register_details'
            ? 'این ایمیل هنوز ثبت نشده است؛ نام کاربری و رمز عبور خود را انتخاب کنید.'
            : mode === 'login_password'
              ? 'رمز عبور حساب خود را وارد کنید.'
              : mode === 'forgot'
                ? 'ایمیل حساب خود را وارد کنید تا لینک بازیابی ارسال شود.'
                : mode === 'pending_verify'
                  ? 'لینک تأیید به ایمیل شما ارسال شد.'
                  : 'ایمیل خود را وارد کنید تا به‌صورت خودکار وارد شوید یا حساب جدید بسازید.'}
        </p>
      </div>

      {/* Prominent 1-Tap Google OAuth on Email Entry Step */}
      {mode === 'email_entry' && (
        <div className="space-y-3">
          <button
            type="button"
            disabled={submitting || googleBusy}
            onClick={() => void handleGoogleOAuth('login')}
            data-testid="auth-google-btn"
            className="w-full min-h-[46px] px-4 rounded-xl theme-subcard border border-[var(--eyvan-line)] hover:border-[var(--eyvan-teal)] disabled:opacity-50 text-xs sm:text-sm font-extrabold theme-heading flex items-center justify-center gap-2.5 cursor-pointer transition-colors"
          >
            <GoogleLogoSvg />
            <span>
              {googleBusy ? 'در حال اتصال به گوگل...' : 'ادامه با گوگل'}
            </span>
          </button>

          {googleConfigured === false && (
            <p
              data-testid="auth-google-not-configured-hint"
              className="text-[11px] theme-muted text-center"
            >
              ورود با گوگل پس از تنظیم کلیدهای Google OAuth در سرور فعال می‌شود.
            </p>
          )}

          <div className="flex items-center gap-2.5 text-[11px] font-bold theme-muted">
            <span className="flex-1 h-px bg-[var(--eyvan-line)]" />
            <span>یا ورود با ایمیل</span>
            <span className="flex-1 h-px bg-[var(--eyvan-line)]" />
          </div>
        </div>
      )}

      {/* Feedback Alerts */}
      {errorMsg && (
        <div
          role="alert"
          data-testid="auth-error-msg"
          className="p-3 rounded-xl bg-[#DC2626]/10 border border-[#DC2626]/40 flex items-start gap-2 text-xs font-semibold theme-loss leading-relaxed"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {infoMsg && (
        <div
          data-testid="auth-info-msg"
          className="p-3 rounded-xl bg-[#0D8A8A]/10 border border-[#0D8A8A]/40 flex items-start gap-2 text-xs font-semibold theme-win leading-relaxed"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{infoMsg}</span>
        </div>
      )}

      {/* STEP 1: UNIFIED EMAIL ENTRY */}
      {mode === 'email_entry' && (
        <form
          onSubmit={handleEmailCheckSubmit}
          className="space-y-3.5"
          data-testid="auth-email-step-form"
        >
          <div className="space-y-1.5">
            <label
              htmlFor="auth-email-input"
              className="block text-xs font-bold theme-heading"
            >
              ایمیل
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 theme-muted absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="auth-email-input"
                data-testid="auth-email-input"
                type="email"
                dir="ltr"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                required
                className="w-full min-h-[48px] pr-10 pl-3.5 rounded-xl theme-input border text-sm font-semibold text-left focus:outline-none focus:ring-2 focus:ring-[var(--eyvan-teal)]"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            data-testid="auth-email-continue-btn"
            className="w-full min-h-[48px] rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] hover:brightness-105 disabled:opacity-50 text-[#0B1528] text-sm font-black cursor-pointer transition-all shadow-xs flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>در حال بررسی...</span>
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                <span>ادامه</span>
              </>
            )}
          </button>
        </form>
      )}

      {/* STEP 2A: PASSWORD LOGIN (Existing Email in DB) */}
      {mode === 'login_password' && (
        <div className="space-y-3" data-testid="auth-login-password-step">
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl theme-subcard border text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Mail className="w-3.5 h-3.5 theme-accent-teal shrink-0" />
              <span dir="ltr" className="font-bold theme-heading truncate">
                {email}
              </span>
            </div>
            <button
              type="button"
              data-testid="auth-change-email-btn"
              onClick={() => {
                setMode('email_entry');
                setPassword('');
                resetFeedback();
              }}
              className="text-[11px] font-extrabold theme-accent-teal hover:underline shrink-0 cursor-pointer"
            >
              تغییر
            </button>
          </div>

          <form onSubmit={handleLoginSubmit} className="space-y-3.5">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="auth-login-password"
                  className="block text-xs font-bold theme-heading"
                >
                  رمز عبور
                </label>
                <button
                  type="button"
                  data-testid="auth-forgot-link"
                  onClick={() => {
                    setForgotEmail(email.trim());
                    setMode('forgot');
                    resetFeedback();
                  }}
                  className="text-xs font-bold theme-accent-teal hover:underline cursor-pointer"
                >
                  فراموشی رمز عبور؟
                </button>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 theme-muted absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="auth-login-password"
                  data-testid="auth-login-password"
                  type={showLoginPass ? 'text' : 'password'}
                  dir="ltr"
                  autoComplete="current-password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full min-h-[46px] pr-10 pl-11 rounded-xl theme-input border text-sm font-semibold text-left focus:outline-none focus:ring-2 focus:ring-[var(--eyvan-teal)]"
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPass((v) => !v)}
                  aria-label={showLoginPass ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'}
                  data-testid="auth-login-toggle-password"
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 min-w-[38px] min-h-[38px] rounded-lg flex items-center justify-center theme-muted hover:text-[var(--eyvan-text)] cursor-pointer"
                >
                  {showLoginPass ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              data-testid="auth-login-submit"
              className="w-full min-h-[48px] rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] hover:brightness-105 disabled:opacity-50 text-[#0B1528] text-sm font-black cursor-pointer transition-all shadow-xs"
            >
              {submitting ? 'در حال ورود...' : 'ورود به حساب'}
            </button>
          </form>

          {unverifiedNotice && (
            <div
              data-testid="auth-unverified-resend-box"
              className="p-3 rounded-xl border border-[#D4AE58]/40 bg-[#D4AE58]/10 space-y-2.5"
            >
              <div className="text-xs font-bold theme-heading">
                حساب شما در انتظار تأیید ایمیل است
              </div>
              <div className="flex gap-2">
                <input
                  type="email"
                  dir="ltr"
                  data-testid="auth-inline-resend-email"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="flex-1 min-h-[40px] px-3 rounded-xl theme-input border text-xs text-left focus:outline-none focus:ring-2 focus:ring-[var(--eyvan-teal)]"
                />
                <button
                  type="button"
                  disabled={submitting}
                  data-testid="auth-inline-resend-btn"
                  onClick={() => handleResendVerification()}
                  className="px-3.5 min-h-[40px] rounded-xl bg-[#0D8A8A] hover:bg-[#0B7676] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>ارسال مجدد</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* STEP 2B: COMPLETE REGISTRATION (New Email not found in DB) */}
      {mode === 'register_details' && (
        <form
          onSubmit={handleRegisterSubmit}
          className="space-y-3.5"
          data-testid="auth-register-details-step"
        >
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl theme-subcard border text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Mail className="w-3.5 h-3.5 theme-accent-teal shrink-0" />
              <span dir="ltr" className="font-bold theme-heading truncate">
                {email}
              </span>
            </div>
            <button
              type="button"
              data-testid="auth-change-email-btn"
              onClick={() => {
                setMode('email_entry');
                setPassword('');
                setConfirmPassword('');
                resetFeedback();
              }}
              className="text-[11px] font-extrabold theme-accent-teal hover:underline shrink-0 cursor-pointer"
            >
              تغییر
            </button>
          </div>

          {/* Username with Live Server Availability */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="auth-reg-username"
                className="block text-xs font-bold theme-heading"
              >
                نام کاربری (انگلیسی)
              </label>
              {regUsernameStatus.state === 'checking' && (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold theme-muted">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>بررسی...</span>
                </span>
              )}
              {regUsernameStatus.state === 'available' && (
                <span
                  data-testid="auth-reg-username-available"
                  className="inline-flex items-center gap-1 text-[11px] font-bold theme-win"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{regUsernameStatus.message}</span>
                </span>
              )}
              {(regUsernameStatus.state === 'taken' ||
                regUsernameStatus.state === 'invalid') && (
                <span className="text-[11px] font-bold theme-loss">
                  {regUsernameStatus.message}
                </span>
              )}
            </div>
            <div className="relative">
              <AtSign className="w-4 h-4 theme-muted absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="auth-reg-username"
                data-testid="auth-reg-username"
                type="text"
                dir="ltr"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => handleRegUsernameChange(e.target.value)}
                placeholder="player_one"
                maxLength={20}
                required
                className={`w-full min-h-[46px] pr-10 pl-3.5 rounded-xl theme-input border text-sm font-semibold text-left focus:outline-none focus:ring-2 ${
                  regUsernameStatus.state === 'taken' ||
                  regUsernameStatus.state === 'invalid'
                    ? 'border-[#DC2626] focus:ring-[#DC2626]/30'
                    : 'focus:ring-[var(--eyvan-teal)]'
                }`}
              />
            </div>
          </div>

          {/* Password with Strength Meter & Eye Toggle */}
          <div className="space-y-1.5">
            <label
              htmlFor="auth-reg-password"
              className="block text-xs font-bold theme-heading"
            >
              رمز عبور
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 theme-muted absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="auth-reg-password"
                data-testid="auth-reg-password"
                type={showRegPass ? 'text' : 'password'}
                dir="ltr"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="حداقل ۸ کاراکتر شامل حرف و عدد"
                minLength={8}
                maxLength={128}
                required
                className="w-full min-h-[46px] pr-10 pl-11 rounded-xl theme-input border text-sm font-semibold text-left focus:outline-none focus:ring-2 focus:ring-[var(--eyvan-teal)]"
              />
              <button
                type="button"
                onClick={() => setShowRegPass((v) => !v)}
                aria-label={showRegPass ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'}
                data-testid="auth-reg-toggle-password"
                className="absolute left-1.5 top-1/2 -translate-y-1/2 min-w-[38px] min-h-[38px] rounded-lg flex items-center justify-center theme-muted hover:text-[var(--eyvan-text)] cursor-pointer"
              >
                {showRegPass ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            <PasswordStrengthMeter strength={regPasswordStrength} />
          </div>

          {/* Confirm Password with Match Indicator */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="auth-reg-confirm"
                className="block text-xs font-bold theme-heading"
              >
                تکرار رمز عبور
              </label>
              {passwordsMatch && (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold theme-win">
                  <Check className="w-3.5 h-3.5" />
                  <span>یکسان است</span>
                </span>
              )}
              {passwordsMismatch && (
                <span className="text-[11px] font-bold theme-loss">
                  با رمز عبور مطابقت ندارد
                </span>
              )}
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 theme-muted absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="auth-reg-confirm"
                data-testid="auth-reg-confirm"
                type={showRegConfirm ? 'text' : 'password'}
                dir="ltr"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="تکرار رمز عبور"
                minLength={8}
                maxLength={128}
                required
                className={`w-full min-h-[46px] pr-10 pl-11 rounded-xl theme-input border text-sm font-semibold text-left focus:outline-none focus:ring-2 ${
                  passwordsMismatch
                    ? 'border-[#DC2626] focus:ring-[#DC2626]/30'
                    : 'focus:ring-[var(--eyvan-teal)]'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowRegConfirm((v) => !v)}
                aria-label={
                  showRegConfirm ? 'پنهان کردن تکرار رمز' : 'نمایش تکرار رمز'
                }
                className="absolute left-1.5 top-1/2 -translate-y-1/2 min-w-[38px] min-h-[38px] rounded-lg flex items-center justify-center theme-muted hover:text-[var(--eyvan-text)] cursor-pointer"
              >
                {showRegConfirm ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || regUsernameStatus.state === 'taken'}
            data-testid="auth-reg-submit"
            className="w-full min-h-[48px] rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] hover:brightness-105 disabled:opacity-50 text-[#0B1528] text-sm font-black cursor-pointer transition-all shadow-xs flex items-center justify-center gap-2"
          >
            <UserPlus className="w-4 h-4" />
            <span>{submitting ? 'در حال ساخت حساب...' : 'تکمیل ثبت‌نام'}</span>
          </button>
        </form>
      )}

      {/* PENDING EMAIL VERIFICATION */}
      {mode === 'pending_verify' && (
        <form
          onSubmit={handleResendVerification}
          className="space-y-3.5"
          data-testid="auth-pending-verify-panel"
        >
          <div className="p-3.5 rounded-xl border border-[#D4AE58]/40 bg-[#D4AE58]/10 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-extrabold theme-heading">
              <MailCheck className="w-4 h-4 theme-accent-gold shrink-0" />
              <span>تأیید ایمیل برای فعال‌سازی حساب</span>
            </div>
            <p className="text-xs theme-muted leading-relaxed">
              لینک تأیید به ایمیل شما ارسال شد. پس از باز کردن آن می‌توانید وارد شوید.
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="auth-resend-email"
              className="block text-xs font-bold theme-heading"
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
              className="w-full min-h-[46px] px-3.5 rounded-xl theme-input border text-sm font-semibold text-left focus:outline-none focus:ring-2 focus:ring-[var(--eyvan-teal)]"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            data-testid="auth-resend-submit"
            className="w-full min-h-[46px] rounded-xl bg-[#0D8A8A] hover:bg-[#0B7676] disabled:opacity-50 text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>
              {submitting ? 'در حال ارسال...' : 'ارسال مجدد ایمیل تأیید'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMode('email_entry');
              resetFeedback();
            }}
            className="w-full min-h-[42px] rounded-xl theme-btn-secondary border text-xs font-bold cursor-pointer"
          >
            بازگشت به صفحه ورود
          </button>
        </form>
      )}

      {/* FORGOT PASSWORD */}
      {mode === 'forgot' && (
        <form
          onSubmit={handleForgotSubmit}
          className="space-y-3.5"
          data-testid="auth-forgot-panel"
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-extrabold theme-heading">
              <KeyRound className="w-4 h-4 theme-accent-gold" />
              <span>بازیابی رمز عبور</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setMode('email_entry');
                resetFeedback();
              }}
              className="text-xs font-bold theme-muted hover:theme-heading flex items-center gap-1 cursor-pointer"
            >
              <span>بازگشت</span>
              <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
            </button>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="auth-forgot-email"
              className="block text-xs font-bold theme-heading"
            >
              ایمیل حساب
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 theme-muted absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
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
                className="w-full min-h-[46px] pr-10 pl-3.5 rounded-xl theme-input border text-sm font-semibold text-left focus:outline-none focus:ring-2 focus:ring-[var(--eyvan-teal)]"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            data-testid="auth-forgot-submit"
            className="w-full min-h-[46px] rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] disabled:opacity-50 text-[#0B1528] text-sm font-black cursor-pointer"
          >
            {submitting ? 'در حال ارسال...' : 'ارسال لینک بازیابی'}
          </button>
        </form>
      )}
    </div>
  );
};

const PasswordStrengthMeter: React.FC<{
  strength: ReturnType<typeof computePasswordStrength>;
}> = ({ strength }) => {
  const barColors = [
    strength.score >= 1
      ? strength.score === 1
        ? 'bg-[#DC2626]'
        : strength.score === 2
          ? 'bg-[#D4AE58]'
          : 'bg-[#0D8A8A]'
      : 'bg-[var(--eyvan-line)]',
    strength.score >= 2
      ? strength.score === 2
        ? 'bg-[#D4AE58]'
        : 'bg-[#0D8A8A]'
      : 'bg-[var(--eyvan-line)]',
    strength.score >= 3 ? 'bg-[#0D8A8A]' : 'bg-[var(--eyvan-line)]',
  ];

  return (
    <div data-testid="password-strength-meter" className="space-y-1.5 pt-1">
      <div className="grid grid-cols-3 gap-1.5">
        {barColors.map((cls, idx) => (
          <span
            key={idx}
            className={`h-1.5 rounded-full transition-colors ${cls}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
          <span className={strength.hasMinLength ? 'theme-win' : 'theme-muted'}>
            {strength.hasMinLength ? '✓' : '·'} ۸+ کاراکتر
          </span>
          <span className={strength.hasLetter ? 'theme-win' : 'theme-muted'}>
            {strength.hasLetter ? '✓' : '·'} حرف انگلیسی
          </span>
          <span className={strength.hasNumber ? 'theme-win' : 'theme-muted'}>
            {strength.hasNumber ? '✓' : '·'} عدد
          </span>
        </div>
        {strength.label && (
          <span
            className={
              strength.score === 3
                ? 'theme-win'
                : strength.score === 2
                  ? 'theme-accent-gold'
                  : 'theme-loss'
            }
          >
            {strength.label}
          </span>
        )}
      </div>
    </div>
  );
};
