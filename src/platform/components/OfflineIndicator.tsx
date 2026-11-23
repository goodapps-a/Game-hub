import React, { useEffect, useState } from 'react';
import { WifiOff, X } from 'lucide-react';
import { useOnlineStatus } from '../pwa/useOnlineStatus';

/**
 * Honest connectivity indicator: when offline, clearly states that online multiplayer,
 * friends, and chat are unavailable while offline Hokm practice remains usable.
 * Includes a dismiss button and auto-hides the moment connectivity returns.
 */
export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isOnline) {
      setDismissed(false);
    }
  }, [isOnline]);

  if (isOnline || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="pwa-offline-indicator"
      className="fixed bottom-24 right-4 left-4 sm:left-auto sm:max-w-md z-[70] rounded-2xl bg-[#1A1308]/95 border border-[#F59E0B]/55 px-3.5 py-2.5 text-xs font-bold text-[#FEF3C7] shadow-[0_12px_32px_rgba(0,0,0,0.45)] backdrop-blur-md flex items-center justify-between gap-2.5"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <WifiOff className="w-4 h-4 text-[#FBBF24] shrink-0" />
        <span className="leading-snug">
          اتصال اینترنت قطع است · بازی آنلاین و بخش دوستان در دسترس نیست (تمرین آفلاین فعال است)
        </span>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="بستن اعلان آفلاین"
        data-testid="pwa-offline-dismiss-btn"
        className="w-7 h-7 rounded-lg flex items-center justify-center text-[#FDE68A]/80 hover:text-white hover:bg-white/10 shrink-0 cursor-pointer transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
