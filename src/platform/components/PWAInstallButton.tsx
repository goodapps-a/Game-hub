import React, { useState } from 'react';
import { CheckCircle2, Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../pwa/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'card' | 'settings';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'card',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  const handleInstallClick = async () => {
    if (isInstallable) {
      setInstalling(true);
      try {
        await install();
      } finally {
        setInstalling(false);
      }
      return;
    }
    setShowGuide(true);
  };

  // Home card variant: show only when installable or on iOS, and hide when already standalone
  if (variant === 'card') {
    if (isInstalled || dismissed || (!isInstallable && !isIOS)) {
      return null;
    }

    return (
      <>
        <div
          data-testid="pwa-install-banner"
          className="eyvan-card rounded-2xl px-4 py-3 flex items-center justify-between gap-3 border border-[var(--eyvan-gold-border)]"
        >
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/pwa-192x192.png"
              alt="ایوان"
              className="w-10 h-10 rounded-xl shrink-0 border border-[#D4AE58]/40"
            />
            <div className="min-w-0">
              <div className="text-xs sm:text-sm font-extrabold theme-heading truncate">
                نصب نسخه اپلیکیشن ایوان
              </div>
              <p className="text-[11px] theme-muted truncate">
                اجرای تمام‌صفحه، سریع‌تر و دسترسی مستقیم از صفحه اصلی
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={installing}
              onClick={() => void handleInstallClick()}
              data-testid="pwa-install-btn"
              className="min-h-[40px] px-3.5 rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] hover:from-[#F8DD94] hover:to-[#D4AE58] text-[#0B1628] text-xs font-black inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-transform active:scale-95 disabled:opacity-60"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span>{isIOS ? 'راهنمای نصب' : 'نصب برنامه'}</span>
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label="بستن پیشنهاد نصب"
              className="w-9 h-9 rounded-xl flex items-center justify-center theme-muted hover:theme-heading hover:bg-black/5 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {showGuide && (
          <InstallGuideModal isIOS={isIOS} onClose={() => setShowGuide(false)} />
        )}
      </>
    );
  }

  // Settings variant inside ProfileSettingsView (always shows install status or action)
  return (
    <>
      <div
        className="flex items-center justify-between gap-3 py-3.5 min-h-[64px]"
        data-testid="pwa-settings-install-row"
      >
        <div className="min-w-0">
          <div className="text-xs sm:text-sm font-bold theme-heading flex items-center gap-1.5">
            <Smartphone className="w-4 h-4 theme-accent-teal shrink-0" />
            <span>نصب اپلیکیشن ایوان (PWA)</span>
          </div>
          <div className="text-[11px] theme-muted mt-0.5">
            {isInstalled
              ? 'برنامه به‌صورت مستقل روی دستگاه شما نصب شده است'
              : isInstallable
                ? 'نصب مستقیم روی صفحه اصلی بدون نیاز به مرورگر'
                : 'افزودن ایوان به صفحه اصلی گوشی یا دسکتاپ'}
          </div>
        </div>

        {isInstalled ? (
          <span className="inline-flex items-center gap-1 text-xs font-extrabold text-[#22C55E] shrink-0 whitespace-nowrap">
            <CheckCircle2 className="w-4 h-4" />
            <span>نصب شده</span>
          </span>
        ) : (
          <button
            type="button"
            disabled={installing}
            onClick={() => void handleInstallClick()}
            data-testid="pwa-settings-install-btn"
            className="min-h-[40px] px-3.5 rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] hover:from-[#F8DD94] hover:to-[#D4AE58] text-[#0B1628] text-xs font-black inline-flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>{isInstallable ? 'نصب' : 'راهنما'}</span>
          </button>
        )}
      </div>

      {showGuide && (
        <InstallGuideModal isIOS={isIOS} onClose={() => setShowGuide(false)} />
      )}
    </>
  );
};

const InstallGuideModal: React.FC<{ isIOS: boolean; onClose: () => void }> = ({
  isIOS,
  onClose,
}) => (
  <div
    className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label="راهنمای نصب ایوان"
  >
    <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
    <div className="relative z-10 w-full max-w-sm rounded-3xl theme-drawer border border-[var(--eyvan-gold-border)] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.55)] space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <img
            src="/pwa-192x192.png"
            alt="ایوان"
            className="w-10 h-10 rounded-xl border border-[#D4AE58]/40"
          />
          <div>
            <h3 className="text-sm font-black theme-heading">
              نصب ایوان روی صفحه اصلی
            </h3>
            <p className="text-[11px] theme-muted">
              {isIOS ? 'راهنمای iPhone و iPad (Safari)' : 'راهنمای مرورگر'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="بستن"
          className="w-9 h-9 rounded-xl flex items-center justify-center theme-muted hover:theme-heading cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {isIOS ? (
        <ol className="space-y-2.5 text-xs theme-heading leading-relaxed">
          <li className="flex items-start gap-2">
            <span className="font-black theme-accent-gold">۱.</span>
            <span>
              در نوار پایین مرورگر Safari دکمه{' '}
              <strong className="inline-flex items-center gap-1">
                <Share className="w-3.5 h-3.5 inline" />
                اشتراک‌گذاری (Share)
              </strong>{' '}
              را بزنید.
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
        <ol className="space-y-2.5 text-xs theme-heading leading-relaxed">
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

      <button
        type="button"
        onClick={onClose}
        className="w-full min-h-[42px] rounded-xl theme-btn-secondary border text-xs font-extrabold cursor-pointer"
      >
        متوجه شدم
      </button>
    </div>
  </div>
);
