import React, { useEffect, useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../pwa/usePWAInstall';

const SESSION_DISMISS_KEY = 'eyvan_pwa_entry_popup_dismissed';

/**
 * Entry PWA Install Popup Modal:
 * - Appears automatically upon entering the site ONLY when the app is NOT already installed
 *   as a standalone PWA (and has not been dismissed in the current session).
 * - Triggers native one-tap installation via `beforeinstallprompt` when supported,
 *   or shows concise Safari / browser install instructions otherwise.
 */
export const PWAInstallModal: React.FC<{ disabled?: boolean }> = ({
  disabled = false,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [showManualSteps, setShowManualSteps] = useState(false);

  useEffect(() => {
    if (disabled || isInstalled || typeof window === 'undefined') {
      setVisible(false);
      return;
    }

    let dismissed = false;
    try {
      dismissed = window.sessionStorage.getItem(SESSION_DISMISS_KEY) === '1';
    } catch {
      dismissed = false;
    }
    if (dismissed) return;

    const timer = window.setTimeout(() => {
      setVisible(true);
    }, 850);

    return () => window.clearTimeout(timer);
  }, [disabled, isInstalled]);

  if (!visible || isInstalled || disabled) return null;

  const handleDismiss = () => {
    setVisible(false);
    try {
      window.sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
    } catch {
      // Ignore storage restriction
    }
  };

  const handleInstallAction = async () => {
    if (isInstallable) {
      setInstalling(true);
      try {
        const accepted = await install();
        if (accepted) {
          setVisible(false);
        }
      } finally {
        setInstalling(false);
      }
      return;
    }
    setShowManualSteps(true);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="نصب اپلیکیشن ایوان"
      data-testid="pwa-entry-install-modal"
      className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-3.5 sm:p-4 bg-black/65 backdrop-blur-sm"
      onClick={handleDismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[380px] rounded-[24px] theme-drawer border border-[var(--eyvan-gold-border)] shadow-[0_24px_64px_rgba(0,0,0,0.62)] p-5 space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/pwa-192x192.png"
              alt="ایوان"
              className="w-12 h-12 rounded-2xl border border-[#D4AE58]/50 shrink-0 shadow-sm"
            />
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-black theme-heading truncate">
                نصب اپلیکیشن ایوان
              </h2>
              <p className="text-[11px] sm:text-xs theme-muted mt-0.5 leading-snug">
                اجرای تمام‌صفحه، سریع‌تر و دسترسی مستقیم از صفحه اصلی
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            data-testid="pwa-entry-modal-close"
            aria-label="بستن پیشنهاد نصب"
            className="w-8 h-8 rounded-xl flex items-center justify-center theme-muted hover:theme-heading hover:bg-black/5 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {(isIOS || showManualSteps) && (
          <div className="rounded-2xl theme-subcard border p-3.5 space-y-2 text-xs theme-heading leading-relaxed">
            {isIOS ? (
              <ol className="space-y-1.5">
                <li className="flex items-start gap-2">
                  <span className="font-black theme-accent-gold">۱.</span>
                  <span>
                    در پایین مرورگر Safari روی دکمه{' '}
                    <strong className="inline-flex items-center gap-1">
                      <Share className="w-3.5 h-3.5 inline" />
                      Share
                    </strong>{' '}
                    بزنید.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-black theme-accent-gold">۲.</span>
                  <span>
                    گزینه <strong>Add to Home Screen</strong> را انتخاب کرده و{' '}
                    <strong>Add</strong> را بزنید.
                  </span>
                </li>
              </ol>
            ) : (
              <ol className="space-y-1.5">
                <li className="flex items-start gap-2">
                  <span className="font-black theme-accent-gold">۱.</span>
                  <span>
                    منوی مرورگر (سه نقطه بالای صفحه در Chrome یا Edge) را باز کنید.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-black theme-accent-gold">۲.</span>
                  <span>
                    گزینه <strong>Install app</strong> یا{' '}
                    <strong>Add to Home screen</strong> را انتخاب کنید.
                  </span>
                </li>
              </ol>
            )}
          </div>
        )}

        <div className="flex items-center gap-2.5">
          {!isIOS && (
            <button
              type="button"
              disabled={installing}
              onClick={() => void handleInstallAction()}
              data-testid="pwa-entry-install-btn"
              className="flex-1 min-h-[44px] px-4 rounded-xl bg-gradient-to-b from-[#F5D98E] via-[#DDA942] to-[#B77E1E] hover:brightness-105 text-[#0B1628] text-xs sm:text-sm font-black inline-flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-60"
            >
              {isInstallable ? (
                <>
                  <Download className="w-4 h-4 shrink-0" />
                  <span>{installing ? 'در حال نصب...' : 'نصب مستقیم'}</span>
                </>
              ) : (
                <>
                  <Smartphone className="w-4 h-4 shrink-0" />
                  <span>راهنمای نصب</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={handleDismiss}
            data-testid="pwa-entry-later-btn"
            className={`${
              isIOS ? 'w-full' : 'px-4'
            } min-h-[44px] rounded-xl theme-btn-secondary border text-xs font-extrabold cursor-pointer transition-colors`}
          >
            {isIOS ? 'متوجه شدم' : 'بعداً'}
          </button>
        </div>
      </div>
    </div>
  );
};
