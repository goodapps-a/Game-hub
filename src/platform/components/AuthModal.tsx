import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Lock, Sparkles, X } from 'lucide-react';
import { AuthUserSummary, PendingAuthUrlAction } from '../auth/authClient';
import { AccountAuthPanel } from './AccountAuthPanel';

export type AuthModalMode = 'login' | 'register';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  authUser: AuthUserSummary | null;
  authLoading: boolean;
  onAuthChange: (user: AuthUserSummary | null) => void;
  initialMode?: AuthModalMode;
  reasonMessage?: string | null;
  pendingAuthAction?: PendingAuthUrlAction | null;
  onClearPendingAuthAction?: () => void;
  reducedMotion?: boolean;
}

/**
 * Focused, standalone centered Authentication Modal (Login / Register / Forgot / Verify).
 * Never mixes Profile overview or Settings tabs into the sign-in flow.
 */
export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  authUser,
  authLoading,
  onAuthChange,
  initialMode = 'login',
  reasonMessage = null,
  pendingAuthAction = null,
  onClearPendingAuthAction,
  reducedMotion = false,
}) => {
  const prevAuthUserRef = useRef<AuthUserSummary | null>(authUser);

  // Auto-close smoothly once a guest completes login/OAuth inside the modal
  useEffect(() => {
    const wasLoggedOut = prevAuthUserRef.current === null;
    prevAuthUserRef.current = authUser;
    if (isOpen && wasLoggedOut && authUser && !pendingAuthAction) {
      const timer = window.setTimeout(() => {
        onClose();
      }, 420);
      return () => window.clearTimeout(timer);
    }
  }, [authUser, isOpen, onClose, pendingAuthAction]);

  // Body scroll lock + Escape key dismissal
  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0.01 : 0.16 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/68 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="ورود و ثبت‌نام حساب ایوان"
          data-testid="auth-modal"
        >
          {/* Click-outside backdrop */}
          <div
            className="fixed inset-0"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Centered Floating Auth Card */}
          <motion.div
            initial={
              reducedMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.94, y: 14 }
            }
            animate={
              reducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }
            }
            exit={
              reducedMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.95, y: 10 }
            }
            transition={{
              duration: reducedMotion ? 0.01 : 0.22,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="relative z-10 w-full max-w-[440px] max-h-[90dvh] rounded-[26px] theme-drawer border border-[var(--eyvan-gold-border)] shadow-[0_24px_70px_rgba(0,0,0,0.52)] flex flex-col overflow-hidden"
          >
            {/* Minimal Dedicated Header */}
            <header className="px-5 pt-4 pb-3 border-b border-[var(--eyvan-line)] flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#F3D179]/25 to-[#0D8A8A]/20 border border-[var(--eyvan-gold-border)] flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4 theme-accent-gold" />
                </span>
                <h2 className="text-sm sm:text-base font-black theme-heading truncate">
                  ورود به حساب ایوان
                </h2>
              </div>

              <button
                type="button"
                data-testid="auth-modal-close-btn"
                onClick={onClose}
                aria-label="بستن پنجره ورود"
                className="min-w-[38px] min-h-[38px] -ml-1 rounded-xl flex items-center justify-center theme-muted hover:theme-heading hover:bg-black/5 cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            {/* Focused Auth Content Only */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 pb-6 space-y-4">
              {reasonMessage && !authUser && (
                <div
                  data-testid="auth-modal-reason"
                  className="p-3 rounded-xl bg-[var(--eyvan-gold)]/12 border border-[var(--eyvan-gold-border)] flex items-start gap-2.5 text-xs font-bold theme-heading leading-relaxed"
                >
                  <Lock className="w-4 h-4 theme-accent-gold shrink-0 mt-0.5" />
                  <span>{reasonMessage}</span>
                </div>
              )}

              <AccountAuthPanel
                authUser={authUser}
                authLoading={authLoading}
                onAuthChange={onAuthChange}
                pendingAuthAction={pendingAuthAction}
                onClearPendingAuthAction={onClearPendingAuthAction}
                initialMode={initialMode}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
