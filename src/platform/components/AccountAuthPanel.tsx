import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  LogIn,
  LogOut,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import {
  AuthUserSummary,
  loginAccount,
  logoutAccount,
  logoutAllAccountSessions,
  registerAccount,
} from '../auth/authClient';

interface AccountAuthPanelProps {
  authUser: AuthUserSummary | null;
  authLoading: boolean;
  onAuthChange: (user: AuthUserSummary | null) => void;
}

type AuthFormMode = 'login' | 'register';

export const AccountAuthPanel: React.FC<AccountAuthPanelProps> = ({
  authUser,
  authLoading,
  onAuthChange,
}) => {
  const [mode, setMode] = useState<AuthFormMode>('login');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const resetFeedback = () => {
    setErrorMsg(null);
    setInfoMsg(null);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetFeedback();
    setSubmitting(true);
    try {
      const res = await loginAccount({ identifier, password });
      if (!res.ok || !res.user) {
        setErrorMsg(res.message ?? 'ورود انجام نشد.');
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
    resetFeedback();
    setSubmitting(true);
    try {
      const res = await registerAccount({
        email,
        username,
        password,
        confirmPassword,
      });
      if (!res.ok || !res.user) {
        setErrorMsg(res.message ?? 'ثبت‌نام انجام نشد.');
        return;
      }
      setPassword('');
      setConfirmPassword('');
      onAuthChange(res.user);
      setInfoMsg('حساب کاربری شما با موفقیت ساخته شد.');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'خطا در برقراری ارتباط با سرور.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
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
          ساخت حساب، هویت کاربری شما در تمام بازی‌های ایوان حفظ می‌شود.
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
            mode === 'login'
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
            mode === 'register'
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

      {mode === 'login' ? (
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
            <label
              htmlFor="auth-login-password"
              className="block text-[11px] font-bold theme-heading mb-1"
            >
              رمز عبور
            </label>
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
      ) : (
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
    </div>
  );
};
