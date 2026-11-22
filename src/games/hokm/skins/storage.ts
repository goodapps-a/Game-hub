import { CARD_SKIN_STORAGE_KEYS } from './config';

/** Guarded localStorage helpers — never throw (private mode, SSR, quota). */
function safeGet(key: string): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function loadEquippedSkinId(): string | null {
  return safeGet(CARD_SKIN_STORAGE_KEYS.equipped);
}

export function saveEquippedSkinId(id: string): void {
  safeSet(CARD_SKIN_STORAGE_KEYS.equipped, id);
}

export function loadOwnedSkinIds(): string[] {
  const raw = safeGet(CARD_SKIN_STORAGE_KEYS.owned);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function saveOwnedSkinIds(ids: readonly string[]): void {
  safeSet(CARD_SKIN_STORAGE_KEYS.owned, JSON.stringify(ids));
}
