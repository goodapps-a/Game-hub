/**
 * Safe Service Worker registration for Eyvan PWA.
 * - Registers `/sw.js` at root scope `/` after initial window load so it never blocks first paint.
 * - Strictly defers `SKIP_WAITING` activation while a player is inside an active match
 *   (`document.body.dataset.state === 'playing'`) and applies the update cleanly once outside gameplay.
 */

export function isGameplayActive(): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  return document.body.dataset.state === 'playing';
}

export function applyServiceWorkerUpdateWhenSafe(
  worker: { postMessage: (data: unknown) => void } | null | undefined,
  options?: {
    isPlaying?: () => boolean;
    observePlayStateChange?: (onSafe: () => void) => () => void;
  }
): { appliedImmediately: boolean } {
  if (!worker) return { appliedImmediately: false };

  const checkPlaying = options?.isPlaying ?? isGameplayActive;
  if (!checkPlaying()) {
    worker.postMessage({ type: 'SKIP_WAITING' });
    return { appliedImmediately: true };
  }

  const registerObserver =
    options?.observePlayStateChange ??
    ((onSafe: () => void) => {
      if (typeof MutationObserver === 'undefined' || !document.body) {
        return () => undefined;
      }
      const obs = new MutationObserver(() => {
        if (!checkPlaying()) {
          obs.disconnect();
          onSafe();
        }
      });
      obs.observe(document.body, {
        attributes: true,
        attributeFilter: ['data-state'],
      });
      return () => obs.disconnect();
    });

  registerObserver(() => {
    if (!checkPlaying()) {
      worker.postMessage({ type: 'SKIP_WAITING' });
    }
  });
  return { appliedImmediately: false };
}

export function registerEyvanServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  const isSecureContext =
    window.isSecureContext ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

  if (!isSecureContext) {
    return;
  }

  const doRegister = () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        if (registration.waiting) {
          applyServiceWorkerUpdateWhenSafe(registration.waiting);
        }
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (
              installing.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              applyServiceWorkerUpdateWhenSafe(installing);
            }
          });
        });
      })
      .catch(() => {
        // Non-fatal: app functions normally even in restricted webviews
      });
  };

  if (document.readyState === 'complete') {
    doRegister();
  } else {
    window.addEventListener('load', doRegister, { once: true });
  }
}
