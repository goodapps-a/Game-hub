import { DeckSystemError } from './types';

let customDecksBaseUrl: string | null = null;

function readEnvDeckBaseUrl(): string | null {
  try {
    const meta = import.meta as unknown as {
      env?: Record<string, string | undefined>;
    };
    const envUrl = meta?.env?.VITE_DECKS_BASE_URL;
    if (typeof envUrl === 'string' && envUrl.trim().length > 0) {
      return envUrl.trim();
    }
  } catch {
    // Non-Vite runtime (e.g. Node unit tests)
  }
  return null;
}

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '/decks';
  if (trimmed.startsWith('/')) {
    return trimmed;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new DeckSystemError(
      'INVALID_CATALOG',
      'نشانی پایه میزبان مجموعه‌ها نامعتبر است.'
    );
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new DeckSystemError(
      'INVALID_CATALOG',
      'پروتکل میزبان مجموعه‌ها باید HTTP یا HTTPS باشد.'
    );
  }
  return parsed.toString().replace(/\/+$/, '');
}

/**
 * Resolves the active hosting root for external decks.
 * Defaults to `/decks`, and can be switched to Cloudflare R2 (`/r2/decks` or external CDN URL)
 * via `VITE_DECKS_BASE_URL` or `setDeckAssetsBaseUrl()` with zero engine/UI changes.
 */
export function getDeckAssetsBaseUrl(): string {
  if (customDecksBaseUrl !== null) {
    return customDecksBaseUrl;
  }
  const fromEnv = readEnvDeckBaseUrl();
  if (fromEnv) {
    return normalizeBaseUrl(fromEnv);
  }
  return '/decks';
}

export function setDeckAssetsBaseUrl(nextBaseUrl: string | null): void {
  if (nextBaseUrl === null) {
    customDecksBaseUrl = null;
    return;
  }
  customDecksBaseUrl = normalizeBaseUrl(nextBaseUrl);
}

/**
 * Validates that an asset or manifest path is strictly relative, clean, and traversal-free.
 */
export function isSafeRelativeDeckPath(rawPath: string): boolean {
  if (typeof rawPath !== 'string') return false;
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed.length > 260) return false;
  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return false;
  if (trimmed.includes('\\') || trimmed.includes('\0')) return false;
  const segments = trimmed.split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') return false;
  }
  return true;
}

/**
 * Safely resolves a deck manifest or asset path against the configured base URL.
 */
export function resolveDeckUrl(
  relativePath: string,
  baseUrl = getDeckAssetsBaseUrl()
): string {
  if (!isSafeRelativeDeckPath(relativePath)) {
    throw new DeckSystemError(
      'INVALID_MANIFEST',
      `مسیر نامعتبر در فایل مجموعه: ${String(relativePath)}`
    );
  }
  const cleanBase = normalizeBaseUrl(baseUrl);
  const encodedSegments = relativePath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `${cleanBase}/${encodedSegments}`;
}

export function getDeckCatalogUrl(baseUrl = getDeckAssetsBaseUrl()): string {
  return `${normalizeBaseUrl(baseUrl)}/catalog.json`;
}
