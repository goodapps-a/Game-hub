/**
 * Eyvan Production-Ready Service Worker (PWABuilder & Android TWA compatible)
 *
 * Security & Realtime Guarantees:
 * - Caches ONLY safe static application assets and the app shell (`/`).
 * - NEVER intercepts or caches `/api/*`, `/ws/*`, `/auth/*`, `/oauth/*`,
 *   `/social/*`, `/rooms/*`, Cloudflare Worker/API requests, WebSocket upgrades,
 *   non-GET requests, or requests carrying Authorization headers.
 * - Safe versioned cache storage with automatic cleanup of outdated static caches.
 * - Online-first navigation with clean app-shell fallback so offline mode works
 *   for static shell + offline Hokm practice without faking online availability.
 */

const CACHE_VERSION = 'eyvan-static-v1';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_ASSET_CACHE = `${CACHE_VERSION}-assets`;
const VALID_CACHES = new Set([APP_SHELL_CACHE, STATIC_ASSET_CACHE]);

const APP_SHELL_URLS = [
  '/',
  '/manifest.webmanifest',
  '/icon.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/apple-touch-icon.png',
];

// Paths that MUST ALWAYS bypass the Service Worker completely
// (includes `/decks/` and `/r2/decks/` so external card decks are stored solely in IndexedDB without double-caching)
const BYPASS_PATH_PREFIXES = [
  '/api/',
  '/ws/',
  '/auth/',
  '/oauth/',
  '/social/',
  '/rooms/',
  '/cdn-cgi/',
  '/decks/',
  '/r2/decks/',
  '/assets/aistudio/',
  '/@vite/',
  '/@react-refresh',
  '/@fs/',
  '/node_modules/',
];

const SAFE_STATIC_EXT_RE =
  /\.(?:js|mjs|css|png|jpg|jpeg|webp|svg|ico|woff2?|webmanifest)$/i;

function shouldBypassRequest(request, url) {
  // Never touch non-GET requests (POST/PUT/PATCH/DELETE/etc.)
  if (request.method !== 'GET') return true;

  // Never intercept cross-origin requests (e.g. Cloudflare Workers APIs, OAuth, analytics)
  if (url.origin !== self.location.origin) return true;

  // Never cache authenticated header-based requests or Range requests (audio streaming)
  if (request.headers.has('authorization') || request.headers.has('range')) {
    return true;
  }

  // Never intercept backend APIs, WebSockets, dev HMR endpoints, or raw user uploads
  const pathname = url.pathname;
  for (const prefix of BYPASS_PATH_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }

  // Never intercept requests with sensitive auth query params
  if (
    url.searchParams.has('code') ||
    url.searchParams.has('state') ||
    url.searchParams.has('token')
  ) {
    return true;
  }

  return false;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) =>
        Promise.allSettled(
          APP_SHELL_URLS.map((url) =>
            cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (!VALID_CACHES.has(key)) {
              return caches.delete(key);
            }
            return Promise.resolve(false);
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (shouldBypassRequest(request, url)) {
    return;
  }

  // 1. HTML Navigation requests -> Network-first with cached app-shell fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (
            response &&
            response.ok &&
            response.type === 'basic' &&
            !response.headers.get('cache-control')?.includes('no-store')
          ) {
            const copy = response.clone();
            caches
              .open(APP_SHELL_CACHE)
              .then((cache) => cache.put('/', copy))
              .catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          const cachedShell = await caches.match('/');
          if (cachedShell) return cachedShell;
          return new Response(
            '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ایوان — حالت آفلاین</title></head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#08101E;color:#F5EFE4;font-family:system-ui,sans-serif;text-align:center;padding:24px"><div><h1 style="color:#F3D179;font-size:20px">اتصال اینترنت در دسترس نیست</h1><p style="opacity:0.8;font-size:14px">برای استفاده از بخش آنلاین ایوان، اتصال اینترنت خود را بررسی کنید.</p></div></body></html>',
            {
              status: 503,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            }
          );
        })
    );
    return;
  }

  // 2. Safe static assets only -> Stale-While-Revalidate (hashed bundles + icons + images)
  if (SAFE_STATIC_EXT_RE.test(url.pathname)) {
    event.respondWith(
      caches.open(STATIC_ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((response) => {
            if (
              response &&
              response.status === 200 &&
              response.type === 'basic' &&
              !response.headers.get('cache-control')?.includes('no-store') &&
              !response.headers.get('cache-control')?.includes('private')
            ) {
              cache.put(request, response.clone()).catch(() => {});
            }
            return response;
          })
          .catch(() => cached || Response.error());

        return cached || networkPromise;
      })
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
