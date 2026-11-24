import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GameId,
  PlatformTabId,
  ShopItem,
  ThemeMode,
  UserProfile,
} from './platform/types/platform';
import { PLATFORM_ASSETS, preloadPlatformAssets } from './platform/data/assets';
import { eyvanBgMusic } from './platform/audio/bgMusic';
import {
  DEFAULT_OWNED_SHOP_IDS,
  createInitialGuestProfile,
  saveLocalAudioPrefs,
  saveLocalCosmetics,
} from './platform/data/guestDefaults';
import {
  AuthUserSummary,
  PendingAuthUrlAction,
  consumeAuthActionFromUrlHash,
  fetchCurrentAuthSession,
  requestTestModeSessionApi,
} from './platform/auth/authClient';
import { TopBar } from './platform/components/TopBar';
import { AuthModal, AuthModalMode } from './platform/components/AuthModal';
import {
  ProfileDrawer,
  ProfileInitialAuthMode,
} from './platform/components/ProfileDrawer';
import { ProfileSubView } from './platform/components/profile/ProfileOverview';
import { PublicPlayerProfileModal } from './platform/components/profile/PublicPlayerProfileModal';
import { ShopPage } from './platform/pages/ShopPage';
import { ShopCategoryFilter } from './platform/utils/shopHelpers';
import { GamesPage } from './platform/pages/GamesPage';
import {
  GameDetailPage,
  GameHubLaunchRequest,
  HokmHubSubView,
} from './platform/pages/GameDetailPage';
import { FriendsPage, SocialSubTab } from './platform/pages/FriendsPage';
import { HokmGame } from './games/hokm/HokmGame';
import {
  OnlineHokmGame,
  OnlineHokmLaunchAction,
} from './games/hokm/OnlineHokmGame';
import { fetchMyOnlineStats } from './games/hokm/online/client';
import { hokmSound } from './games/hokm/audio/soundEffects';
import { OfflineIndicator } from './platform/components/OfflineIndicator';
import { BottomNav } from './platform/components/BottomNav';
import { PWAInstallModal } from './platform/components/PWAInstallModal';
import {
  getOrCreateTabDeviceId,
  sendPresenceHeartbeat,
  sendPresenceOffline,
} from './platform/social/socialClient';
import {
  DeckRegistry,
  EYVAN_CLASSIC_DECK_ID,
  deckRuntime,
} from './platform/decks';
import {
  DEFAULT_EQUIPPED_SLOTS,
  ItemSlot,
  SHOP_TEST_MODE_DEFAULT,
  ServerInventoryState,
  buildPublicAppearanceFromSlots,
  claimShopItemRequest,
  equipInventoryItemRequest,
  fetchMyInventoryRequest,
  fetchShopCatalogRequest,
  resolveCatalogItemDefinition,
  toDeckItemId,
  unequipInventorySlotRequest,
} from './platform/items';

type ActiveGameView = 'hokm-online' | 'hokm-offline' | null;

function getInitialRoomCodeFromQuery(): string {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  const code = params.get('room');
  return code
    ? code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    : '';
}

function getInitialGameFromQuery(): ActiveGameView {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get('autostart') === '1') return 'hokm-offline';
  if (params.get('room')) return 'hokm-online';
  return null;
}

function consumeTomanOrderFromQuery(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('tomanOrder')?.trim() ?? '';
  if (!raw) return null;
  params.delete('tomanOrder');
  params.delete('Authority');
  params.delete('Status');
  const nextQuery = params.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
  try {
    window.history.replaceState(window.history.state, '', nextUrl);
  } catch {
    // Ignore history restrictions
  }
  return raw;
}

function getInitialThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = window.localStorage.getItem('eyvan_theme_mode');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Ignore storage restriction
  }
  return 'dark';
}

function isEditableElement(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type?.toLowerCase();
    return ![
      'button',
      'submit',
      'reset',
      'checkbox',
      'radio',
      'range',
      'file',
      'color',
    ].includes(type);
  }
  return el.isContentEditable;
}

const TAB_SWIPE_ORDER: readonly PlatformTabId[] = ['shop', 'games', 'friends'];

function hasHorizontalScrollAncestor(target: EventTarget | null): boolean {
  let node = target instanceof HTMLElement ? target : null;
  while (node && node !== document.body) {
    if (node.scrollWidth > node.clientWidth + 6) {
      const style = window.getComputedStyle(node);
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') {
        return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

export default function App() {
  const [pendingTomanOrderId, setPendingTomanOrderId] = useState<string | null>(() =>
    consumeTomanOrderFromQuery()
  );
  const [activeTab, setActiveTab] = useState<PlatformTabId>(() =>
    pendingTomanOrderId ? 'shop' : 'games'
  );
  const [shopInitialCategory, setShopInitialCategory] =
    useState<ShopCategoryFilter>(() =>
      pendingTomanOrderId ? 'toman_topup' : 'all'
    );
  const [friendsInitialTab, setFriendsInitialTab] =
    useState<SocialSubTab>('friends');
  const [selectedGameHub, setSelectedGameHub] = useState<GameId | null>(null);
  const [hokmHubSubView, setHokmHubSubView] =
    useState<HokmHubSubView>('hub');
  const [activeGame, setActiveGame] = useState<ActiveGameView>(
    getInitialGameFromQuery
  );
  const [hokmTargetScore, setHokmTargetScore] = useState<number>(3);
  const [onlineLaunchAction, setOnlineLaunchAction] =
    useState<OnlineHokmLaunchAction>(null);
  const [initialRoomCode, setInitialRoomCode] = useState<string>(
    getInitialRoomCodeFromQuery
  );
  const [autoJoinInviteRoom, setAutoJoinInviteRoom] = useState(false);
  const [profile, setProfile] = useState<UserProfile>(() =>
    createInitialGuestProfile(getInitialThemeMode())
  );
  const [authUser, setAuthUser] = useState<AuthUserSummary | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [pendingAuthAction, setPendingAuthAction] =
    useState<PendingAuthUrlAction | null>(null);

  // Floating Profile Modal state
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [profileInitialView, setProfileInitialView] =
    useState<ProfileSubView>('overview');
  const [profileInitialAuthMode, setProfileInitialAuthMode] =
    useState<ProfileInitialAuthMode>('login');

  // Dedicated Standalone Auth-Only Modal state
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>('login');
  const [authModalReason, setAuthModalReason] = useState<string | null>(null);

  // Global Public Player Profile Modal (Screenshot 3)
  const [inspectedPlayerUserId, setInspectedPlayerUserId] = useState<string | null>(
    null
  );
  const [pendingChatTargetUserId, setPendingChatTargetUserId] = useState<string | null>(
    null
  );
  const [friendsRefreshSignal, setFriendsRefreshSignal] = useState(0);

  const [isTyping, setIsTyping] = useState(false);

  // Double-back-to-exit toast on Games Main Menu root
  const [exitToastVisible, setExitToastVisible] = useState(false);
  const exitToastTimerRef = useRef<number | null>(null);
  const lastRootBackPressRef = useRef<number>(0);

  // Track whether Telegram full-screen chat inside FriendsPage is open
  const [isFriendsChatOpen, setIsFriendsChatOpen] = useState(false);
  const [closeFriendsChatSignal, setCloseFriendsChatSignal] = useState(0);

  // Horizontal touch-swipe tracking for main tabs
  const swipeStartRef = useRef<{
    x: number;
    y: number;
    ts: number;
    blocked: boolean;
  } | null>(null);

  const themeMode = profile.appSettings.themeMode;

  const [shopTestMode, setShopTestMode] = useState<boolean>(SHOP_TEST_MODE_DEFAULT);
  const [shopNotice, setShopNotice] = useState<string | null>(null);
  const shopNoticeTimerRef = useRef<number | null>(null);

  const showShopNotice = useCallback((msg: string | null) => {
    setShopNotice(msg);
    if (shopNoticeTimerRef.current) {
      window.clearTimeout(shopNoticeTimerRef.current);
      shopNoticeTimerRef.current = null;
    }
    if (msg) {
      shopNoticeTimerRef.current = window.setTimeout(() => {
        setShopNotice(null);
      }, 3400);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (shopNoticeTimerRef.current) {
        window.clearTimeout(shopNoticeTimerRef.current);
      }
    };
  }, []);

  const updateProfile = useCallback(
    (updater: UserProfile | ((prev: UserProfile) => UserProfile)) => {
      setProfile((prev) => {
        const next =
          typeof updater === 'function'
            ? (updater as (p: UserProfile) => UserProfile)(prev)
            : updater;
        saveLocalCosmetics({
          bannerCode: next.bannerCode,
          bio: next.bio ?? '',
          customAvatarUrl: next.customAvatarUrl ?? null,
          customBannerUrl: null,
          equippedTableSkinId: next.equippedTableSkinId ?? 'tt-traditional',
          equippedDeckId: next.equippedDeckId ?? EYVAN_CLASSIC_DECK_ID,
          equippedCardBackId: next.equippedCardBackId ?? 'cb-shamsa',
          equippedAvatarFrameId: next.equippedAvatarFrameId,
          equippedBadgeId: next.equippedBadgeId,
          equippedNameplateId: next.equippedNameplateId,
          equippedGameEffectId: next.equippedGameEffectId,
          ownedShopItemIds: next.ownedShopItemIds ?? [...DEFAULT_OWNED_SHOP_IDS],
          coins: next.coins,
          gems: next.gems,
        });
        return next;
      });
    },
    []
  );

  const applyServerInventoryToProfile = useCallback(
    (inv: ServerInventoryState) => {
      setShopTestMode(inv.shopTestMode);
      const pub = inv.publicAppearance ?? buildPublicAppearanceFromSlots(inv.equippedSlots);
      updateProfile((prev) => ({
        ...prev,
        coins: inv.coins,
        gems: inv.gems,
        ownedShopItemIds: inv.ownedItemIds,
        equippedSlots: inv.equippedSlots,
        equippedTableSkinId: inv.equippedSlots.table_skin ?? 'tt-traditional',
        equippedDeckId: pub.deckId || EYVAN_CLASSIC_DECK_ID,
        equippedCardBackId: pub.cardBackId ?? 'cb-shamsa',
        equippedAvatarFrameId: pub.avatarFrameId ?? undefined,
        equippedBadgeId: pub.badgeId ?? undefined,
        equippedNameplateId: pub.nameplateId ?? undefined,
        equippedGameEffectId: pub.gameEffectId ?? undefined,
        bannerCode: pub.bannerCode ?? 'royal',
        customBannerUrl: null,
      }));
      if (pub.deckId && pub.deckId !== EYVAN_CLASSIC_DECK_ID) {
        void deckRuntime.activateDeck(pub.deckId);
      }
    },
    [updateProfile]
  );

  const applyAuthenticatedUser = (user: AuthUserSummary | null) => {
    setAuthUser(user);
    if (user) {
      const validAvatar: UserProfile['avatarCode'] =
        user.avatarCode === 'portrait' ||
        user.avatarCode === 'shamsa' ||
        user.avatarCode === 'turquoise' ||
        user.avatarCode === 'jade' ||
        user.avatarCode === 'lapis'
          ? user.avatarCode
          : 'portrait';
      setProfile((prev) => ({
        ...prev,
        id: user.userId,
        accountCode: user.accountCode ?? prev.accountCode ?? null,
        username: user.username,
        bio: typeof user.bio === 'string' ? user.bio : prev.bio ?? '',
        avatarCode: validAvatar,
      }));
    } else {
      setProfile((prev) => ({
        ...createInitialGuestProfile(prev.appSettings.themeMode),
        appSettings: prev.appSettings,
      }));
    }
  };

  // Hydrate central account session strictly from server HttpOnly cookie (`/api/auth/me`)
  // and auto-create a zero-registration Test Mode session when shopTestMode is enabled
  useEffect(() => {
    let active = true;

    async function hydrateSessionAndMode() {
      let resolvedTestMode = SHOP_TEST_MODE_DEFAULT;
      try {
        const [sessionRes, catalogRes] = await Promise.all([
          fetchCurrentAuthSession().catch(() => null),
          fetchShopCatalogRequest().catch(() => null),
        ]);
        if (!active) return;

        if (catalogRes?.ok && typeof catalogRes.shopTestMode === 'boolean') {
          resolvedTestMode = catalogRes.shopTestMode;
          setShopTestMode(catalogRes.shopTestMode);
        }

        if (sessionRes?.ok && sessionRes.authenticated && sessionRes.user) {
          applyAuthenticatedUser(sessionRes.user);
          return;
        }

        let explicitlyLoggedOut = false;
        try {
          explicitlyLoggedOut =
            typeof window !== 'undefined' &&
            window.sessionStorage.getItem('eyvan_test_logged_out') === '1';
        } catch {
          explicitlyLoggedOut = false;
        }

        if (resolvedTestMode && !explicitlyLoggedOut) {
          const testRes = await requestTestModeSessionApi().catch(() => null);
          if (!active) return;
          if (testRes?.ok && testRes.user) {
            applyAuthenticatedUser(testRes.user);
            return;
          }
        }

        setAuthUser(null);
      } catch {
        if (active) setAuthUser(null);
      } finally {
        if (active) setAuthLoading(false);
      }
    }

    void hydrateSessionAndMode();
    return () => {
      active = false;
    };
  }, []);

  // Hydrate authoritative server inventory, wallet & equipped slots when authenticated
  useEffect(() => {
    if (!authUser) return;
    let active = true;
    fetchMyInventoryRequest()
      .then((res) => {
        if (!active || !res.ok || !res.ownedItemIds || !res.equippedSlots) return;
        applyServerInventoryToProfile({
          userId: res.userId ?? authUser.userId,
          coins: res.coins ?? 0,
          gems: res.gems ?? 0,
          ownedItemIds: res.ownedItemIds,
          inventory: res.inventory ?? [],
          equippedSlots: res.equippedSlots,
          publicAppearance:
            res.publicAppearance ?? buildPublicAppearanceFromSlots(res.equippedSlots),
          shopTestMode: res.shopTestMode ?? shopTestMode,
        });
      })
      .catch(() => {
        // Non-fatal if offline
      });
    return () => {
      active = false;
    };
  }, [authUser?.userId, applyServerInventoryToProfile]);

  // Hydrate real permanent game stats bound strictly to `user_id` (`/api/stats/me`)
  useEffect(() => {
    if (!authUser || activeGame !== null) return;
    let active = true;
    fetchMyOnlineStats()
      .then((stats) => {
        if (!active || !stats) return;
        setProfile((prev) => ({
          ...prev,
          stats: {
            ...prev.stats,
            gamesPlayed: stats.matchesPlayed,
            wins: stats.wins,
            losses: stats.losses,
          },
        }));
      })
      .catch(() => {
        // Non-fatal: retain current stats snapshot
      });
    return () => {
      active = false;
    };
  }, [authUser?.userId, authUser?.username, activeGame]);

  // Real multi-device online presence lifecycle (30s heartbeat, 75s server lease TTL)
  useEffect(() => {
    if (!authUser) return;
    const deviceId = getOrCreateTabDeviceId();
    const HEARTBEAT_INTERVAL_MS = 30_000;

    const ping = () => {
      const state =
        typeof document !== 'undefined' && document.visibilityState === 'hidden'
          ? 'away'
          : 'online';
      void sendPresenceHeartbeat(deviceId, state).catch(() => {
        // Ignore transient network errors
      });
    };

    ping();
    const intervalId = window.setInterval(ping, HEARTBEAT_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        ping();
      }
    };
    const handleOnline = () => {
      ping();
    };
    const handlePageHide = () => {
      void sendPresenceOffline(deviceId);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handlePageHide);
    };
  }, [authUser?.userId]);

  // Capture & immediately scrub `#verify-email=` / `#reset-password=` tokens from URL -> open AuthModal directly
  useEffect(() => {
    const syncAuthHashAction = () => {
      const action = consumeAuthActionFromUrlHash();
      if (action) {
        setPendingAuthAction(action);
        setIsProfileOpen(false);
        setAuthModalReason(null);
        setIsAuthModalOpen(true);
      }
    };
    syncAuthHashAction();
    window.addEventListener('hashchange', syncAuthHashAction);
    return () => {
      window.removeEventListener('hashchange', syncAuthHashAction);
    };
  }, []);

  // Preload ONLY active-theme home artwork immediately; secondary assets warm up after window.load
  useEffect(() => {
    preloadPlatformAssets(themeMode);
  }, [themeMode]);

  // Initialize seamless looping background soundtrack
  useEffect(() => {
    eyvanBgMusic.init();
  }, []);

  // Initialize Multi-Deck catalog & preload the persisted equipped deck (falling back cleanly if evicted)
  useEffect(() => {
    let active = true;
    const savedDeckId = profile.equippedDeckId ?? EYVAN_CLASSIC_DECK_ID;
    void DeckRegistry.fetchCatalog();
    void deckRuntime.activateDeck(savedDeckId).then((res) => {
      if (!active) return;
      if (res.fallbackUsed && savedDeckId !== EYVAN_CLASSIC_DECK_ID) {
        updateProfile((prev) => ({
          ...prev,
          equippedDeckId: EYVAN_CLASSIC_DECK_ID,
        }));
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // Track active text input so floating FAB stays out of the way of mobile keyboard
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let blurTimer: number | null = null;

    const handleFocusIn = (e: FocusEvent) => {
      if (isEditableElement(e.target)) {
        if (blurTimer) window.clearTimeout(blurTimer);
        setIsTyping(true);
      }
    };

    const handleFocusOut = () => {
      if (blurTimer) window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(() => {
        setIsTyping(isEditableElement(document.activeElement));
      }, 60);
    };

    const handleViewportResize = () => {
      if (!window.visualViewport) return;
      const keyboardLikelyOpen =
        window.innerHeight - window.visualViewport.height > 150;
      if (keyboardLikelyOpen && isEditableElement(document.activeElement)) {
        setIsTyping(true);
      }
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    window.visualViewport?.addEventListener('resize', handleViewportResize);

    return () => {
      if (blurTimer) window.clearTimeout(blurTimer);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      window.visualViewport?.removeEventListener('resize', handleViewportResize);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    try {
      window.localStorage.setItem('eyvan_theme_mode', themeMode);
    } catch {
      // Ignore storage restriction
    }
  }, [themeMode]);

  const effectiveMusicEnabled =
    profile.appSettings.musicEnabled ?? profile.appSettings.soundEnabled;
  const effectiveSfxEnabled =
    profile.appSettings.sfxEnabled ?? profile.appSettings.soundEnabled;

  useEffect(() => {
    hokmSound.setEnabled(effectiveSfxEnabled);
    eyvanBgMusic.setEnabled(effectiveMusicEnabled);
    saveLocalAudioPrefs({
      musicEnabled: effectiveMusicEnabled,
      sfxEnabled: effectiveSfxEnabled,
    });
  }, [effectiveMusicEnabled, effectiveSfxEnabled]);

  useEffect(() => {
    document.body.dataset.state = activeGame ? 'playing' : 'platform';
    // Automatically halve the reduced background music level when entering an active game
    eyvanBgMusic.setInGame(activeGame !== null);
  }, [activeGame]);

  // =========================================================================
  // DETERMINISTIC HARDWARE / BROWSER BACK BUTTON STACK + DOUBLE-BACK EXIT
  // =========================================================================
  const navStateRef = useRef({
    activeGame,
    inspectedPlayerUserId,
    isAuthModalOpen,
    isProfileOpen,
    selectedGameHub,
    hokmHubSubView,
    activeTab,
    isFriendsChatOpen,
  });
  navStateRef.current = {
    activeGame,
    inspectedPlayerUserId,
    isAuthModalOpen,
    isProfileOpen,
    selectedGameHub,
    hokmHubSubView,
    activeTab,
    isFriendsChatOpen,
  };

  const historyGuardDepthRef = useRef(0);
  const rootGestureArmedRef = useRef(false);

  const pushHistoryGuard = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      historyGuardDepthRef.current += 1;
      window.history.pushState(
        { eyvanNavGuard: true, depth: historyGuardDepthRef.current },
        '',
        window.location.href
      );
    } catch {
      // Ignore history restrictions in sandboxed frames
    }
  }, []);

  // Arm a genuine user-activated root guard on the very first touch/pointer gesture
  // so Chrome/Android History Manipulation Intervention never skips our Back handler.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const armOnce = () => {
      if (rootGestureArmedRef.current) return;
      rootGestureArmedRef.current = true;
      pushHistoryGuard();
    };
    window.addEventListener('pointerdown', armOnce, { capture: true, passive: true });
    window.addEventListener('keydown', armOnce, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', armOnce, true);
      window.removeEventListener('keydown', armOnce, true);
    };
  }, [pushHistoryGuard]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    pushHistoryGuard();

    const handlePopState = () => {
      historyGuardDepthRef.current = Math.max(0, historyGuardDepthRef.current - 1);
      const cur = navStateRef.current;

      // Helper: keep at least one guard entry ready while still inside the app
      const ensureGuard = () => {
        if (historyGuardDepthRef.current <= 0) {
          pushHistoryGuard();
        }
      };

      // Close topmost player profile card first regardless of view
      if (cur.inspectedPlayerUserId) {
        setInspectedPlayerUserId(null);
        ensureGuard();
        return;
      }

      // Active offline Hokm game has its own forfeit-confirm popstate guard
      if (cur.activeGame === 'hokm-offline') {
        return;
      }

      // Close topmost floating modal before exiting game/hub
      if (cur.isAuthModalOpen) {
        setIsAuthModalOpen(false);
        setAuthModalReason(null);
        ensureGuard();
        return;
      }

      if (cur.isProfileOpen) {
        setIsProfileOpen(false);
        ensureGuard();
        return;
      }

      // Online Hokm lobby/table: exit cleanly back to Hokm Hub
      if (cur.activeGame === 'hokm-online') {
        setInitialRoomCode('');
        setAutoJoinInviteRoom(false);
        setOnlineLaunchAction(null);
        setActiveGame(null);
        setActiveTab('games');
        setSelectedGameHub('hokm');
        setHokmHubSubView('hub');
        ensureGuard();
        return;
      }

      // Inside Hokm full-screen Hub: step back from subview -> hub -> Games menu
      if (cur.selectedGameHub !== null) {
        if (cur.hokmHubSubView !== 'hub') {
          setHokmHubSubView('hub');
        } else {
          setSelectedGameHub(null);
        }
        ensureGuard();
        return;
      }

      // Inside full-screen Telegram chat in Friends tab -> close chat first
      if (cur.activeTab === 'friends' && cur.isFriendsChatOpen) {
        setCloseFriendsChatSignal((prev) => prev + 1);
        setIsFriendsChatOpen(false);
        ensureGuard();
        return;
      }

      // Inside Shop or Friends tab -> return to Games Main Menu
      if (cur.activeTab !== 'games') {
        setActiveTab('games');
        ensureGuard();
        return;
      }

      // On Games Main Menu root: Double-Back-to-Exit pattern
      const now = Date.now();
      if (now - lastRootBackPressRef.current < 2200) {
        setExitToastVisible(false);
        lastRootBackPressRef.current = 0;
        return;
      }

      lastRootBackPressRef.current = now;
      pushHistoryGuard();
      setExitToastVisible(true);
      if (exitToastTimerRef.current) {
        window.clearTimeout(exitToastTimerRef.current);
      }
      exitToastTimerRef.current = window.setTimeout(() => {
        setExitToastVisible(false);
      }, 2200);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (exitToastTimerRef.current) {
        window.clearTimeout(exitToastTimerRef.current);
      }
    };
  }, [pushHistoryGuard]);

  const handleToggleTheme = () => {
    setProfile((prev) => ({
      ...prev,
      appSettings: {
        ...prev.appSettings,
        themeMode: prev.appSettings.themeMode === 'dark' ? 'light' : 'dark',
      },
    }));
  };

  const handleSelectTab = (tab: PlatformTabId) => {
    setSelectedGameHub(null);
    setHokmHubSubView('hub');
    if (tab === 'shop') {
      setShopInitialCategory('all');
    }
    if (tab === 'friends') {
      setFriendsInitialTab('friends');
    }
    if (tab !== activeTab) {
      if (tab !== 'games') {
        pushHistoryGuard();
      }
      setActiveTab(tab);
    }
  };

  const openAuthModal = (
    mode: AuthModalMode = 'login',
    reason: string | null = null
  ) => {
    pushHistoryGuard();
    setIsProfileOpen(false);
    setAuthModalMode(mode);
    setAuthModalReason(reason);
    setIsAuthModalOpen(true);
  };

  const openProfileModal = (
    initialView: ProfileSubView = 'overview',
    initialAuthMode: ProfileInitialAuthMode = 'login'
  ) => {
    pushHistoryGuard();
    setIsAuthModalOpen(false);
    setProfileInitialView(initialView);
    setProfileInitialAuthMode(initialAuthMode);
    setIsProfileOpen(true);
  };

  const handleOpenGameHub = (gameId: GameId) => {
    if (gameId === 'hokm') {
      pushHistoryGuard();
      setIsProfileOpen(false);
      setIsAuthModalOpen(false);
      setActiveTab('games');
      setSelectedGameHub('hokm');
      setHokmHubSubView('hub');
    }
  };

  const handleChangeHokmSubView = (nextSubView: HokmHubSubView) => {
    if (nextSubView !== 'hub' && hokmHubSubView === 'hub') {
      pushHistoryGuard();
    }
    setHokmHubSubView(nextSubView);
  };

  const applyEquippedDefinitionLocally = useCallback(
    (itemId: string) => {
      const def = resolveCatalogItemDefinition(
        itemId,
        DeckRegistry.getAllCatalogEntries(false)
      );
      if (!def || !def.isEquippable || !def.slot) return;
      const slot = def.slot;

      updateProfile((prev) => {
        const nextSlots = {
          ...(prev.equippedSlots ?? DEFAULT_EQUIPPED_SLOTS),
          [slot]: def.id,
        };
        const pub = buildPublicAppearanceFromSlots(nextSlots);
        return {
          ...prev,
          equippedSlots: nextSlots,
          equippedTableSkinId: nextSlots.table_skin ?? prev.equippedTableSkinId,
          equippedDeckId: pub.deckId || prev.equippedDeckId,
          equippedCardBackId: pub.cardBackId ?? prev.equippedCardBackId,
          equippedAvatarFrameId: pub.avatarFrameId ?? undefined,
          equippedBadgeId: pub.badgeId ?? undefined,
          equippedNameplateId: pub.nameplateId ?? undefined,
          equippedGameEffectId: pub.gameEffectId ?? undefined,
          bannerCode: slot === 'banner' ? pub.bannerCode : prev.bannerCode,
          customBannerUrl: slot === 'banner' ? null : prev.customBannerUrl,
        };
      });
    },
    [updateProfile]
  );

  const handleEquipShopItem = useCallback(
    async (item: ShopItem) => {
      showShopNotice(null);
      const def = resolveCatalogItemDefinition(
        item.id,
        DeckRegistry.getAllCatalogEntries(false)
      );
      if (!def || !def.isEquippable || !def.slot) return;

      if (def.deckId) {
        const res = await deckRuntime.activateDeck(def.deckId);
        if (res.fallbackUsed && def.deckId !== EYVAN_CLASSIC_DECK_ID) {
          showShopNotice('برای فعال‌سازی این دست ورق ابتدا باید بسته‌ی آن دانلود شود.');
          return;
        }
      }

      let activeUser = authUser;
      if (!activeUser && shopTestMode) {
        const testRes = await requestTestModeSessionApi().catch(() => null);
        if (testRes?.ok && testRes.user) {
          applyAuthenticatedUser(testRes.user);
          activeUser = testRes.user;
        }
      }

      if (activeUser) {
        try {
          let equipRes = await equipInventoryItemRequest(def.id, def.slot);
          // In Shop Test Mode, if user clicks Equip directly on an item not yet claimed on server, auto-claim then equip
          if (!equipRes.ok && shopTestMode) {
            const claimRes = await claimShopItemRequest(def.id).catch(() => null);
            if (claimRes?.ok) {
              equipRes = await equipInventoryItemRequest(def.id, def.slot);
            }
          }
          if (equipRes.ok && equipRes.inventory) {
            applyServerInventoryToProfile(equipRes.inventory);
            showShopNotice(`«${item.name || def.name}» فعال شد.`);
            return;
          }
          if (!shopTestMode) {
            if (equipRes.message) {
              showShopNotice(equipRes.message);
            }
            return;
          }
        } catch {
          if (!shopTestMode) {
            showShopNotice('خطا در ذخیره انتخاب روی سرور.');
            return;
          }
        }
      }

      // Guaranteed local apply (also acts as seamless test-mode fallback if cookies are restricted)
      if (shopTestMode) {
        updateProfile((prev) => ({
          ...prev,
          ownedShopItemIds: Array.from(
            new Set([...(prev.ownedShopItemIds ?? []), def.id])
          ),
        }));
      }
      applyEquippedDefinitionLocally(def.id);
      showShopNotice(`«${item.name || def.name}» فعال شد.`);
    },
    [
      authUser,
      shopTestMode,
      applyEquippedDefinitionLocally,
      applyServerInventoryToProfile,
      showShopNotice,
      updateProfile,
    ]
  );

  const handleUnequipSlot = useCallback(
    async (slot: ItemSlot) => {
      showShopNotice(null);
      if (authUser) {
        try {
          const res = await unequipInventorySlotRequest(slot);
          if (res.ok && res.inventory) {
            applyServerInventoryToProfile(res.inventory);
            return;
          }
        } catch {
          // Fall through to local unequip
        }
      }

      updateProfile((prev) => {
        const nextSlots = { ...(prev.equippedSlots ?? DEFAULT_EQUIPPED_SLOTS) };
        if (slot === 'card_deck') nextSlots.card_deck = 'deck-eyvan-classic';
        else if (slot === 'card_back') nextSlots.card_back = 'cb-shamsa';
        else if (slot === 'table_skin') nextSlots.table_skin = 'tt-traditional';
        else if (slot === 'banner') nextSlots.banner = 'af-banner-royal';
        else delete nextSlots[slot];

        const pub = buildPublicAppearanceFromSlots(nextSlots);
        return {
          ...prev,
          equippedSlots: nextSlots,
          equippedTableSkinId: nextSlots.table_skin ?? 'tt-traditional',
          equippedDeckId: pub.deckId || EYVAN_CLASSIC_DECK_ID,
          equippedCardBackId: pub.cardBackId ?? 'cb-shamsa',
          equippedAvatarFrameId: pub.avatarFrameId ?? undefined,
          equippedBadgeId: pub.badgeId ?? undefined,
          equippedNameplateId: pub.nameplateId ?? undefined,
          equippedGameEffectId: pub.gameEffectId ?? undefined,
          bannerCode: slot === 'banner' ? 'none' : pub.bannerCode,
          customBannerUrl: slot === 'banner' ? null : prev.customBannerUrl,
        };
      });
    },
    [authUser, applyServerInventoryToProfile, showShopNotice, updateProfile]
  );

  const handlePurchaseShopItem = useCallback(
    async (item: ShopItem) => {
      showShopNotice(null);
      const def = resolveCatalogItemDefinition(
        item.id,
        DeckRegistry.getAllCatalogEntries(false)
      );
      if (!def) return;

      let activeUser = authUser;
      if (!activeUser && shopTestMode) {
        const testRes = await requestTestModeSessionApi().catch(() => null);
        if (testRes?.ok && testRes.user) {
          applyAuthenticatedUser(testRes.user);
          activeUser = testRes.user;
        }
      }

      if (!activeUser) {
        if (shopTestMode) {
          updateProfile((prev) => ({
            ...prev,
            ownedShopItemIds: Array.from(
              new Set([...(prev.ownedShopItemIds ?? []), def.id])
            ),
          }));
          if (def.isEquippable && def.slot && def.kind !== 'card_deck') {
            applyEquippedDefinitionLocally(def.id);
          }
          showShopNotice(`«${item.name || def.name}» دریافت و فعال شد.`);
          return;
        }
        openAuthModal('login', 'برای دریافت آیتم‌ها و ذخیره دائمی در حساب، ابتدا وارد شوید.');
        return;
      }

      try {
        const claimRes = await claimShopItemRequest(def.id);
        if (!claimRes.ok || !claimRes.inventory) {
          if (shopTestMode) {
            updateProfile((prev) => ({
              ...prev,
              ownedShopItemIds: Array.from(
                new Set([...(prev.ownedShopItemIds ?? []), def.id])
              ),
            }));
            if (def.isEquippable && def.slot && def.kind !== 'card_deck') {
              applyEquippedDefinitionLocally(def.id);
            }
            showShopNotice(`«${item.name || def.name}» دریافت و فعال شد.`);
            return;
          }
          showShopNotice(claimRes.message ?? 'دریافت آیتم انجام نشد.');
          return;
        }
        applyServerInventoryToProfile(claimRes.inventory);

        if (claimRes.grantedCoins || claimRes.grantedGems) {
          const parts: string[] = [];
          if (claimRes.grantedCoins) {
            parts.push(`${claimRes.grantedCoins.toLocaleString('fa-IR')} سکه`);
          }
          if (claimRes.grantedGems) {
            parts.push(`${claimRes.grantedGems.toLocaleString('fa-IR')} الماس`);
          }
          showShopNotice(`تبریک! ${parts.join(' و ')} به حساب شما اضافه شد.`);
        } else if (def.isEquippable && def.slot && def.kind !== 'card_deck') {
          const equipRes = await equipInventoryItemRequest(def.id, def.slot).catch(() => null);
          if (equipRes?.ok && equipRes.inventory) {
            applyServerInventoryToProfile(equipRes.inventory);
          } else {
            applyEquippedDefinitionLocally(def.id);
          }
          showShopNotice(`«${item.name || def.name}» دریافت و فعال شد.`);
        } else {
          showShopNotice(`«${item.name || def.name}» به کلکسیون شما اضافه شد.`);
        }
      } catch {
        if (shopTestMode) {
          updateProfile((prev) => ({
            ...prev,
            ownedShopItemIds: Array.from(
              new Set([...(prev.ownedShopItemIds ?? []), def.id])
            ),
          }));
          if (def.isEquippable && def.slot && def.kind !== 'card_deck') {
            applyEquippedDefinitionLocally(def.id);
          }
          showShopNotice(`«${item.name || def.name}» دریافت و فعال شد.`);
          return;
        }
        showShopNotice('ارتباط با سرور فروشگاه برقرار نشد.');
      }
    },
    [
      authUser,
      shopTestMode,
      applyEquippedDefinitionLocally,
      applyServerInventoryToProfile,
      showShopNotice,
      updateProfile,
    ]
  );

  const handleSelectDeck = useCallback(
    async (deckId: string) => {
      showShopNotice(null);
      const res = await deckRuntime.activateDeck(deckId);
      const targetDeckId = res.activatedDeckId;
      const deckItemId = toDeckItemId(targetDeckId);

      if (authUser) {
        try {
          const ownedSet = new Set(profile.ownedShopItemIds ?? []);
          if (!ownedSet.has(deckItemId)) {
            await claimShopItemRequest(deckItemId);
          }
          const equipRes = await equipInventoryItemRequest(deckItemId, 'card_deck');
          if (equipRes.ok && equipRes.inventory) {
            applyServerInventoryToProfile(equipRes.inventory);
            return;
          }
        } catch {
          // Fall back locally when offline so downloaded offline decks still equip smoothly
        }
      }

      updateProfile((prev) => ({
        ...prev,
        equippedDeckId: targetDeckId,
        equippedSlots: {
          ...(prev.equippedSlots ?? DEFAULT_EQUIPPED_SLOTS),
          card_deck: deckItemId,
        },
      }));
    },
    [
      authUser,
      profile.ownedShopItemIds,
      applyServerInventoryToProfile,
      showShopNotice,
      updateProfile,
    ]
  );

  const handleEquipItemById = useCallback(
    async (itemId: string) => {
      const def = resolveCatalogItemDefinition(
        itemId,
        DeckRegistry.getAllCatalogEntries(false)
      );
      if (!def) return;
      if (def.kind === 'card_deck' && def.deckId) {
        await handleSelectDeck(def.deckId);
        return;
      }
      await handleEquipShopItem({
        id: def.id,
        section: def.section,
        name: def.name,
        subtitle: def.subtitle,
        description: def.description,
        price: def.price,
        currency: def.currency,
        rarity: def.rarity,
        palette: [def.palette[0], def.palette[1], def.palette[2]],
        motif: def.motif,
      });
    },
    [handleEquipShopItem, handleSelectDeck]
  );

  const handleLaunchFromGameHub = (req: GameHubLaunchRequest) => {
    pushHistoryGuard();
    setIsProfileOpen(false);
    setIsAuthModalOpen(false);
    setHokmTargetScore(req.targetMatchScore);

    if (req.mode === 'offline') {
      setOnlineLaunchAction(null);
      setInitialRoomCode('');
      setAutoJoinInviteRoom(false);
      setActiveGame('hokm-offline');
      return;
    }

    if (req.mode === 'random') {
      setInitialRoomCode('');
      setAutoJoinInviteRoom(false);
      setOnlineLaunchAction('quick_match');
      setActiveGame('hokm-online');
      return;
    }

    if (req.mode === 'friends_create') {
      setInitialRoomCode('');
      setAutoJoinInviteRoom(false);
      setOnlineLaunchAction('create_friends');
      setActiveGame('hokm-online');
      return;
    }

    setInitialRoomCode(req.roomCode ?? '');
    setAutoJoinInviteRoom(false);
    setOnlineLaunchAction('join_room');
    setActiveGame('hokm-online');
  };

  const handleInspectPlayer = (userId: string) => {
    if (!userId) return;
    pushHistoryGuard();
    setInspectedPlayerUserId(userId);
  };

  const handleMainTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (
      e.touches.length !== 1 ||
      isProfileOpen ||
      isAuthModalOpen ||
      Boolean(inspectedPlayerUserId) ||
      isFriendsChatOpen
    ) {
      swipeStartRef.current = null;
      return;
    }
    const touch = e.touches[0];
    const blocked =
      isEditableElement(e.target) || hasHorizontalScrollAncestor(e.target);
    swipeStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      ts: Date.now(),
      blocked,
    };
  };

  const handleMainTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || start.blocked || e.changedTouches.length !== 1) return;

    const dt = Date.now() - start.ts;
    if (dt > 650) return;

    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    if (Math.abs(dx) < 58 || Math.abs(dx) < Math.abs(dy) * 1.45) return;

    const currentIdx = TAB_SWIPE_ORDER.indexOf(activeTab);
    if (currentIdx < 0) return;

    // Physical left-to-right order: shop (left) | games (center) | friends (right)
    // Swiping finger right (dx > 0) reveals the tab on the left; swiping left (dx < 0) reveals the tab on the right.
    const nextIdx = dx > 0 ? currentIdx - 1 : currentIdx + 1;
    if (nextIdx >= 0 && nextIdx < TAB_SWIPE_ORDER.length) {
      handleSelectTab(TAB_SWIPE_ORDER[nextIdx]);
    }
  };

  const profileDrawerNode = (
    <ProfileDrawer
      isOpen={isProfileOpen}
      onClose={() => setIsProfileOpen(false)}
      profile={profile}
      onUpdateProfile={updateProfile}
      authUser={authUser}
      authLoading={authLoading}
      onAuthChange={applyAuthenticatedUser}
      pendingAuthAction={pendingAuthAction}
      onClearPendingAuthAction={() => setPendingAuthAction(null)}
      initialView={profileInitialView}
      initialAuthMode={profileInitialAuthMode}
      onOpenAuthModal={(mode) => openAuthModal(mode, null)}
      onEquipItemById={handleEquipItemById}
      onUnequipSlot={handleUnequipSlot}
      onOpenBannerShop={() => {
        pushHistoryGuard();
        setIsProfileOpen(false);
        setActiveGame(null);
        setSelectedGameHub(null);
        setShopInitialCategory('avatars_frames');
        setActiveTab('shop');
      }}
      onOpenTopUpShop={() => {
        pushHistoryGuard();
        setIsProfileOpen(false);
        setActiveGame(null);
        setSelectedGameHub(null);
        setHokmHubSubView('hub');
        setShopInitialCategory('toman_topup');
        setActiveTab('shop');
      }}
    />
  );

  const publicProfileModalNode = (
    <PublicPlayerProfileModal
      targetUserId={inspectedPlayerUserId}
      currentUserId={authUser?.userId ?? null}
      isAuthenticated={Boolean(authUser)}
      onClose={() => setInspectedPlayerUserId(null)}
      onOpenGiftShop={() => {
        pushHistoryGuard();
        setInspectedPlayerUserId(null);
        setActiveGame(null);
        setSelectedGameHub(null);
        setHokmHubSubView('hub');
        setShopInitialCategory('all');
        setActiveTab('shop');
      }}
      onOpenDirectChat={(targetUid) => {
        pushHistoryGuard();
        setInspectedPlayerUserId(null);
        setActiveGame(null);
        setSelectedGameHub(null);
        setHokmHubSubView('hub');
        setFriendsInitialTab('friends');
        setPendingChatTargetUserId(targetUid);
        setActiveTab('friends');
      }}
      onRequireAuth={() => {
        setInspectedPlayerUserId(null);
        openAuthModal('login', null);
      }}
      onRelationshipChanged={() => {
        setFriendsRefreshSignal((prev) => prev + 1);
      }}
    />
  );

  // =========================================================================
  // ACTIVE GAME VIEWS (Full-Screen)
  // =========================================================================
  if (activeGame === 'hokm-online') {
    const publicAppearance = buildPublicAppearanceFromSlots(
      profile.equippedSlots ?? DEFAULT_EQUIPPED_SLOTS,
      Boolean(!profile.customBannerUrl && profile.bannerCode === 'none')
    );
    return (
      <>
        <OnlineHokmGame
          username={profile.username}
          avatarCode={profile.avatarCode}
          tableSkinId={profile.equippedTableSkinId}
          deckId={profile.equippedDeckId ?? EYVAN_CLASSIC_DECK_ID}
          cardBackId={profile.equippedCardBackId}
          gameEffectId={profile.equippedGameEffectId}
          appearance={publicAppearance}
          isAuthenticated={Boolean(authUser)}
          initialRoomCode={initialRoomCode}
          autoJoinRoom={autoJoinInviteRoom}
          targetMatchScore={hokmTargetScore}
          initialLaunchAction={onlineLaunchAction}
          soundEnabled={effectiveSfxEnabled}
          reducedMotionPreference={profile.appSettings.reducedMotion}
          onInspectPlayer={handleInspectPlayer}
          onInspectSelf={() => openProfileModal('overview', 'login')}
          onChangeUsername={(nextUsername) =>
            updateProfile((prev) => ({
              ...prev,
              username: nextUsername,
            }))
          }
          onChangeAvatar={(nextAvatar) => {
            const validAvatar: UserProfile['avatarCode'] =
              nextAvatar === 'portrait' ||
              nextAvatar === 'shamsa' ||
              nextAvatar === 'turquoise' ||
              nextAvatar === 'jade' ||
              nextAvatar === 'lapis'
                ? nextAvatar
                : 'portrait';
            updateProfile((prev) => ({
              ...prev,
              avatarCode: validAvatar,
            }));
          }}
          onLaunchOffline={() => {
            setOnlineLaunchAction(null);
            setActiveGame('hokm-offline');
          }}
          onBackToGames={() => {
            setInitialRoomCode('');
            setAutoJoinInviteRoom(false);
            setOnlineLaunchAction(null);
            setActiveGame(null);
            setActiveTab('games');
            setSelectedGameHub('hokm');
            setHokmHubSubView('hub');
          }}
        />
        {profileDrawerNode}
        {publicProfileModalNode}
      </>
    );
  }

  if (activeGame === 'hokm-offline') {
    return (
      <>
        <HokmGame
          playerName={profile.username}
          playerAvatarSrc={profile.customAvatarUrl ?? PLATFORM_ASSETS.userAvatar}
          tableSkinId={profile.equippedTableSkinId}
          deckId={profile.equippedDeckId ?? EYVAN_CLASSIC_DECK_ID}
          cardBackId={profile.equippedCardBackId}
          gameEffectId={profile.equippedGameEffectId}
          targetMatchScore={hokmTargetScore}
          soundEnabled={effectiveSfxEnabled}
          animationSpeed="normal"
          reducedMotionPreference={profile.appSettings.reducedMotion}
          onInspectSelf={() => openProfileModal('overview', 'login')}
          onToggleSound={() =>
            setProfile((prev) => {
              const nextSfx = !(
                prev.appSettings.sfxEnabled ?? prev.appSettings.soundEnabled
              );
              return {
                ...prev,
                appSettings: {
                  ...prev.appSettings,
                  soundEnabled: nextSfx,
                  sfxEnabled: nextSfx,
                },
              };
            })
          }
          onChangeAnimationSpeed={(speed) =>
            setProfile((prev) => ({
              ...prev,
              appSettings: {
                ...prev.appSettings,
                animationSpeed: speed,
              },
            }))
          }
          onBackToGames={() => {
            setActiveGame(null);
            setActiveTab('games');
            setSelectedGameHub('hokm');
            setHokmHubSubView('hub');
          }}
        />
        {profileDrawerNode}
        {publicProfileModalNode}
      </>
    );
  }

  // =========================================================================
  // FULL-SCREEN GAME HUB (No TopBar, No Rounded Box — Full Edge-to-Edge!)
  // =========================================================================
  if (activeTab === 'games' && selectedGameHub !== null) {
    return (
      <>
        <OfflineIndicator />
        <GameDetailPage
          gameId={selectedGameHub}
          themeMode={themeMode}
          subView={hokmHubSubView}
          onSubViewChange={handleChangeHokmSubView}
          currentUserId={authUser?.userId ?? null}
          userCoins={profile.coins}
          userGems={profile.gems}
          isAuthenticated={Boolean(authUser)}
          ownedItemIds={profile.ownedShopItemIds}
          equippedSlots={profile.equippedSlots}
          equippedTableSkinId={profile.equippedTableSkinId}
          equippedBannerCode={profile.bannerCode}
          equippedDeckId={profile.equippedDeckId ?? EYVAN_CLASSIC_DECK_ID}
          shopTestMode={shopTestMode}
          shopNotice={shopNotice}
          onPurchaseItem={handlePurchaseShopItem}
          onEquipItem={handleEquipShopItem}
          onUnequipSlot={handleUnequipSlot}
          onSelectDeck={handleSelectDeck}
          onRequireAuth={() => openAuthModal('login', null)}
          onInventorySync={applyServerInventoryToProfile}
          onInspectPlayer={handleInspectPlayer}
          onOpenFriendGroups={() => {
            pushHistoryGuard();
            setSelectedGameHub(null);
            setHokmHubSubView('hub');
            setFriendsInitialTab('groups');
            setActiveTab('friends');
          }}
          onBack={() => {
            setSelectedGameHub(null);
            setHokmHubSubView('hub');
          }}
          onLaunchHokm={handleLaunchFromGameHub}
          onOpenFullShop={(category = 'all') => {
            pushHistoryGuard();
            setSelectedGameHub(null);
            setHokmHubSubView('hub');
            setShopInitialCategory(category);
            setActiveTab('shop');
          }}
        />

        {/* Standalone Auth Modal when triggered from Hokm Shop */}
        <AuthModal
          isOpen={isAuthModalOpen}
          onClose={() => {
            setIsAuthModalOpen(false);
            setAuthModalReason(null);
          }}
          authUser={authUser}
          authLoading={authLoading}
          onAuthChange={applyAuthenticatedUser}
          initialMode={authModalMode}
          reasonMessage={authModalReason}
          pendingAuthAction={pendingAuthAction}
          onClearPendingAuthAction={() => setPendingAuthAction(null)}
          reducedMotion={profile.appSettings.reducedMotion}
        />

        {publicProfileModalNode}
      </>
    );
  }

  // =========================================================================
  // MAIN PLATFORM SHELL (Floating Frosted Pill Bottom Dock)
  // =========================================================================

  return (
    <div
      onTouchStart={handleMainTouchStart}
      onTouchEnd={handleMainTouchEnd}
      className="min-h-[100dvh] flex flex-col bg-[var(--eyvan-bg)] text-[var(--eyvan-text)] relative overflow-x-hidden transition-colors duration-200"
    >
      {/* GPU-stabilized Persian Iwan Architectural Backdrop */}
      <div
        className="fixed inset-0 z-0 pointer-events-none transform-gpu will-change-transform"
        style={{ contain: 'strict' }}
        aria-hidden="true"
      >
        <img
          src={PLATFORM_ASSETS.backdrop}
          alt=""
          decoding="sync"
          loading="eager"
          className="w-full h-full object-cover object-top"
          style={{ opacity: 'var(--eyvan-backdrop-opacity)' }}
        />
        <div
          className="absolute inset-0"
          style={{ background: 'var(--eyvan-backdrop-scrim)' }}
        />
      </div>

      <div className="relative z-10 flex flex-col min-h-[100dvh]">
        <OfflineIndicator />
        <TopBar
          activeTab={activeTab}
          onSelectTab={handleSelectTab}
          profile={profile}
          isAuthenticated={Boolean(authUser)}
          themeMode={themeMode}
          onToggleTheme={handleToggleTheme}
          musicEnabled={effectiveMusicEnabled}
          sfxEnabled={effectiveSfxEnabled}
          onToggleMusic={() =>
            setProfile((prev) => {
              const nextMusic = !(
                prev.appSettings.musicEnabled ?? prev.appSettings.soundEnabled
              );
              return {
                ...prev,
                appSettings: {
                  ...prev.appSettings,
                  musicEnabled: nextMusic,
                },
              };
            })
          }
          onToggleSfx={() =>
            setProfile((prev) => {
              const nextSfx = !(
                prev.appSettings.sfxEnabled ?? prev.appSettings.soundEnabled
              );
              return {
                ...prev,
                appSettings: {
                  ...prev.appSettings,
                  soundEnabled: nextSfx,
                  sfxEnabled: nextSfx,
                },
              };
            })
          }
          isProfileOpen={isProfileOpen}
          onToggleProfile={() => {
            if (isProfileOpen) {
              setIsProfileOpen(false);
            } else {
              openProfileModal('overview', 'login');
            }
          }}
          onOpenAuth={(mode) => openAuthModal(mode, null)}
        />

        <main className="flex-1 w-full max-w-5xl mx-auto px-3.5 sm:px-6 pt-3 sm:pt-5 pb-24 sm:pb-24">
          {activeTab === 'shop' && (
            <ShopPage
              userCoins={profile.coins}
              userGems={profile.gems}
              isAuthenticated={Boolean(authUser)}
              ownedItemIds={profile.ownedShopItemIds}
              equippedSlots={profile.equippedSlots}
              equippedTableSkinId={profile.equippedTableSkinId}
              equippedBannerCode={profile.bannerCode}
              equippedDeckId={profile.equippedDeckId ?? EYVAN_CLASSIC_DECK_ID}
              shopTestMode={shopTestMode}
              shopNotice={shopNotice}
              onPurchaseItem={handlePurchaseShopItem}
              onEquipItem={handleEquipShopItem}
              onUnequipSlot={handleUnequipSlot}
              onSelectDeck={handleSelectDeck}
              onOpenTopUpShop={() => {
                setSelectedGameHub(null);
                setHokmHubSubView('hub');
                setShopInitialCategory('toman_topup');
                setActiveTab('shop');
              }}
              onInventorySync={applyServerInventoryToProfile}
              pendingTomanOrderId={pendingTomanOrderId}
              onClearPendingTomanOrder={() => setPendingTomanOrderId(null)}
              initialCategory={shopInitialCategory}
              onRequireAuth={() => openAuthModal('login', null)}
              onBack={() => handleSelectTab('games')}
            />
          )}
          {activeTab === 'games' && (
            <GamesPage
              onSelectGame={handleOpenGameHub}
              themeMode={themeMode}
            />
          )}
          {activeTab === 'friends' && (
            <FriendsPage
              authUser={authUser}
              authLoading={authLoading}
              initialTab={friendsInitialTab}
              initialChatTargetUserId={pendingChatTargetUserId}
              onClearInitialChatTarget={() => setPendingChatTargetUserId(null)}
              refreshSignal={friendsRefreshSignal}
              closeChatSignal={closeFriendsChatSignal}
              onChatOpenChange={(open) => {
                if (open && !isFriendsChatOpen) {
                  pushHistoryGuard();
                }
                setIsFriendsChatOpen(open);
              }}
              onOpenAccount={() => openAuthModal('login', null)}
              onInspectPlayer={handleInspectPlayer}
              onBack={() => handleSelectTab('games')}
              onJoinInvitedRoom={(roomCode) => {
                pushHistoryGuard();
                setIsProfileOpen(false);
                setIsAuthModalOpen(false);
                setSelectedGameHub(null);
                setOnlineLaunchAction('join_room');
                setInitialRoomCode(roomCode);
                setAutoJoinInviteRoom(true);
                setActiveGame('hokm-online');
              }}
            />
          )}
        </main>

        {/* Floating Frosted Pill Bottom Dock */}
        {!isTyping && !isFriendsChatOpen && (
          <BottomNav
            activeTab={activeTab}
            onSelectTab={handleSelectTab}
            themeMode={themeMode}
          />
        )}

        {/* Double-Back-to-Exit Toast on Main Menu */}
        {exitToastVisible && (
          <div
            role="status"
            aria-live="polite"
            data-testid="exit-back-toast"
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[80] px-4 py-2.5 rounded-2xl bg-[#0B172A]/94 border border-[#F3D179]/45 text-[#F8FAFC] text-xs font-extrabold shadow-[0_14px_36px_rgba(0,0,0,0.45)] backdrop-blur-md whitespace-nowrap"
          >
            برای خروج، دکمه بازگشت را یک‌بار دیگر بزنید
          </div>
        )}

        {/* PWA Entry Install Popup (only when NOT installed as PWA) */}
        <PWAInstallModal disabled={activeGame !== null} />

        {/* Full-Screen Own Profile & Grouped Settings */}
        {profileDrawerNode}

        {/* Dedicated Standalone Auth-Only Modal (Unified Email-First Flow) */}
        <AuthModal
          isOpen={isAuthModalOpen}
          onClose={() => {
            setIsAuthModalOpen(false);
            setAuthModalReason(null);
          }}
          authUser={authUser}
          authLoading={authLoading}
          onAuthChange={applyAuthenticatedUser}
          initialMode={authModalMode}
          reasonMessage={authModalReason}
          pendingAuthAction={pendingAuthAction}
          onClearPendingAuthAction={() => setPendingAuthAction(null)}
          reducedMotion={profile.appSettings.reducedMotion}
        />

        {/* Shared Public Player Profile Card (Screenshot 3) */}
        {publicProfileModalNode}
      </div>
    </div>
  );
}
