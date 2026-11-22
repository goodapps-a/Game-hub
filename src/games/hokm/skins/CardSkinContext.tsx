import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import type { CardSkin } from './types';
import {
  DEFAULT_CARD_SKIN_ID,
  DEFAULT_OWNED_SKIN_IDS,
  getCardSkin,
  isKnownCardSkinId,
} from './registry';
import { CARD_SKIN_PREVIEW_MODE, CARD_SKIN_STORAGE_KEYS } from './config';
import { loadEquippedSkinId, loadOwnedSkinIds, saveEquippedSkinId, saveOwnedSkinIds } from './storage';

export interface CardSkinContextValue {
  /** Currently equipped skin (always resolvable). */
  skin: CardSkin;
  skinId: string;
  /** Default skins + granted skins. In preview mode every skin counts as owned. */
  isOwned: (id: string) => boolean;
  /** Equip an owned skin. Returns false when the skin is unknown or not owned. */
  equip: (id: string) => boolean;
  /** Entry point for the future shop: call after a successful purchase. */
  grantSkin: (id: string) => void;
}

const FALLBACK_VALUE: CardSkinContextValue = {
  skin: getCardSkin(DEFAULT_CARD_SKIN_ID),
  skinId: DEFAULT_CARD_SKIN_ID,
  isOwned: () => true,
  equip: () => false,
  grantSkin: () => undefined,
};

const CardSkinContext = createContext<CardSkinContextValue>(FALLBACK_VALUE);

function initialEquipped(): string {
  const saved = loadEquippedSkinId();
  return isKnownCardSkinId(saved) ? saved : DEFAULT_CARD_SKIN_ID;
}

function initialOwned(): string[] {
  const saved = loadOwnedSkinIds().filter((id) => isKnownCardSkinId(id));
  return Array.from(new Set([...DEFAULT_OWNED_SKIN_IDS, ...saved]));
}

export const CardSkinProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [equippedId, setEquippedId] = useState<string>(initialEquipped);
  const [ownedIds, setOwnedIds] = useState<string[]>(initialOwned);

  const isOwned = useCallback(
    (id: string) => CARD_SKIN_PREVIEW_MODE || ownedIds.includes(id),
    [ownedIds]
  );

  const equip = useCallback(
    (id: string) => {
      if (!isKnownCardSkinId(id) || !isOwned(id)) return false;
      setEquippedId(id);
      saveEquippedSkinId(id);
      return true;
    },
    [isOwned]
  );

  const grantSkin = useCallback((id: string) => {
    if (!isKnownCardSkinId(id)) return;
    setOwnedIds((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      saveOwnedSkinIds(next);
      return next;
    });
  }, []);

  // If ownership rules tighten and the equipped skin is not owned, fall back safely.
  useEffect(() => {
    if (!isOwned(equippedId)) setEquippedId(DEFAULT_CARD_SKIN_ID);
  }, [equippedId, isOwned]);

  // Keep several tabs in sync.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === CARD_SKIN_STORAGE_KEYS.equipped) {
        setEquippedId(isKnownCardSkinId(e.newValue) ? e.newValue : DEFAULT_CARD_SKIN_ID);
      } else if (e.key === CARD_SKIN_STORAGE_KEYS.owned) {
        setOwnedIds(initialOwned());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const skin = getCardSkin(equippedId);

  // Face-down card wrappers in HokmTable use the `.card-back-frame` class (index.css);
  // these variables recolour their frame to match the equipped skin.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--card-back-frame-bg', skin.backFrame.background);
    root.style.setProperty('--card-back-frame-border', skin.backFrame.border);
    return () => {
      root.style.removeProperty('--card-back-frame-bg');
      root.style.removeProperty('--card-back-frame-border');
    };
  }, [skin]);

  const value = useMemo<CardSkinContextValue>(
    () => ({ skin, skinId: skin.id, isOwned, equip, grantSkin }),
    [skin, isOwned, equip, grantSkin]
  );

  return <CardSkinContext.Provider value={value}>{children}</CardSkinContext.Provider>;
};

/** Works without a provider too (falls back to the default skin) so isolated renders never crash. */
export function useCardSkin(): CardSkinContextValue {
  return useContext(CardSkinContext);
}
