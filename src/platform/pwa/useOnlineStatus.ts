import { useEffect, useState } from 'react';

async function probeServerReachability(timeoutMs = 3500): Promise<boolean> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return true;
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    // `/api/health` is always bypassed by sw.js, giving an honest live reachability signal
    const res = await fetch(`/api/health?_t=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    let active = true;
    let probing = false;

    const verifyIfReportedOffline = async () => {
      if (!active || probing) return;
      if (navigator.onLine) {
        setIsOnline(true);
        return;
      }
      probing = true;
      const reachable = await probeServerReachability();
      probing = false;
      if (active) {
        setIsOnline(reachable);
      }
    };

    const handleOnline = () => {
      setIsOnline(true);
    };
    const handleOffline = () => {
      // Immediately probe real reachability before trusting navigator.onLine=false
      // (avoids sticky false-offline banners in Android Chrome / VPN environments)
      void verifyIfReportedOffline();
    };
    const handleFocusOrVisible = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      if (navigator.onLine) {
        setIsOnline(true);
      } else {
        void verifyIfReportedOffline();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleFocusOrVisible);
    document.addEventListener('visibilitychange', handleFocusOrVisible);

    // If initially reporting offline, verify real server reachability right away
    if (!navigator.onLine) {
      void verifyIfReportedOffline();
    }

    // While offline, periodically probe so banner clears automatically as soon as internet returns
    const pollId = window.setInterval(() => {
      if (!navigator.onLine) {
        void verifyIfReportedOffline();
      } else {
        setIsOnline(true);
      }
    }, 10_000);

    return () => {
      active = false;
      window.clearInterval(pollId);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleFocusOrVisible);
      document.removeEventListener('visibilitychange', handleFocusOrVisible);
    };
  }, []);

  return isOnline;
}
