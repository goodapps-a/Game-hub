import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GameId,
  PlatformTabId,
  ProfileBannerCode,
  ShopItem,
  ThemeMode,
  UserProfile,
} from './platform/types/platform';
import { PLATFORM_ASSETS, preloadPlatformAssets } from './platform/data/assets';
import { eyvanBgMusic } from './platform/audio/bgMusic';
import {
  DEFAULT_OWNED_SHOP_IDS,
  createInitialGuestProfile,
  saveLocalCosmetics,
} from './platform/data/guestDefaults';
import {
  AuthUserSummary,
  PendingAuthUrlAction,
  consumeAuthActionFromUrlHash,
  fetchCurrentAuthSession,
} from './platform/auth/authClient';
import { TopBar } from './platform/components/TopBar';
import { AuthModal, AuthModalMode } from './platform/components/AuthModal';
import {
  ProfileDrawer,
  ProfileInitialAuthMode,
} from './platform/components/ProfileDrawer';
import { ProfileSubView } from './platform/components/profile/ProfileOverview';
import { ShopPage } from './platform/pages/ShopPage';
import { ShopCategoryFilter } from './platform/utils/shopHelpers';
import { GamesPage } from './platform/pages/GamesPage';
import {
  GameDetailPage,
  GameHubLaunchRequest,
  HokmHubSubView,
} from './platform/pages/GameDetailPage';
import { FriendsPage } from './platform/pages/FriendsPage';
import { HokmGame } from './games/hokm/HokmGame';
import {
  OnlineHokmGame,
  OnlineHokmLaunchAction,
} from './games/hokm/OnlineHokmGame';
import { fetchMyOnlineStats } from './games/hokm/online/client';
import { hokmSound } from './games/hokm/audio/soundEffects';
import { OfflineIndicator } from './platform/components/OfflineIndicator';
import { BottomNav } from './platform/components/BottomNav';
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

function resolveBannerCodeFromShopItem(itemId: string): ProfileBannerCode | null {
  if (itemId === 'af-banner-garden') return 'garden';
  if (itemId === 'af-banner-ruby') return 'ruby';
  if (itemId === 'af-banner-royal') return 'royal';
  return null;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<PlatformTabId>('games');
  const [shopInitialCategory, setShopInitialCategory] =
    useState<ShopCategoryFilter>('all');
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

  const [isTyping, setIsTyping] = useState(false);

  // Double-back-to-exit toast on Games Main Menu root
  const [exitToastVisible, setExitToastVisible] = useState(false);
  const exitToastTimerRef = useRef<number | null>(null);
  const lastRootBackPressRef = useRef<number>(0);

  const themeMode = profile.appSettings.themeMode;

  const updateProfile = useCallback(
    (updater: UserProfile | ((prev: UserProfile) => UserProfile)) => {
      setProfile((prev) => {
        const next =
          typeof updater === 'function'
            ? (updater as (p: UserProfile) => UserProfile)(prev)
            : updater;
        saveLocalCosmetics({
          bannerCode: next.bannerCode,
          customAvatarUrl: next.customAvatarUrl ?? null,
          customBannerUrl: next.customBannerUrl ?? null,
          equippedTableSkinId: next.equippedTableSkinId ?? 'tt-traditional',
          equippedDeckId: next.equippedDeckId ?? EYVAN_CLASSIC_DECK_ID,
          ownedShopItemIds: next.ownedShopItemIds ?? [...DEFAULT_OWNED_SHOP_IDS],
          coins: next.coins,
          gems: next.gems,
        });
        return next;
      });
    },
    []
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
        username: user.username,
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
  useEffect(() => {
    let active = true;
    fetchCurrentAuthSession()
      .then((res) => {
        if (!active) return;
        if (res.ok && res.authenticated && res.user) {
          applyAuthenticatedUser(res.user);
        } else {
          setAuthUser(null);
        }
      })
      .catch(() => {
        if (active) setAuthUser(null);
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

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

  useEffect(() => {
    hokmSound.setEnabled(profile.appSettings.soundEnabled);
    eyvanBgMusic.setEnabled(profile.appSettings.soundEnabled);
  }, [profile.appSettings.soundEnabled]);

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
    isAuthModalOpen,
    isProfileOpen,
    selectedGameHub,
    hokmHubSubView,
    activeTab,
  });
  navStateRef.current = {
    activeGame,
    isAuthModalOpen,
    isProfileOpen,
    selectedGameHub,
    hokmHubSubView,
    activeTab,
  };

  const pushHistoryGuard = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      window.history.pushState(
        { eyvanNavGuard: true },
        '',
        window.location.href
      );
    } catch {
      // Ignore history restrictions in sandboxed frames
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    pushHistoryGuard();

    const handlePopState = () => {
      const cur = navStateRef.current;

      // Active offline Hokm game has its own forfeit-confirm popstate guard
      if (cur.activeGame === 'hokm-offline') {
        return;
      }

      // Online Hokm lobby/table: exit cleanly back to Hokm Hub
      if (cur.activeGame === 'hokm-online') {
        pushHistoryGuard();
        setInitialRoomCode('');
        setAutoJoinInviteRoom(false);
        setOnlineLaunchAction(null);
        setActiveGame(null);
        setActiveTab('games');
        setSelectedGameHub('hokm');
        setHokmHubSubView('hub');
        return;
      }

      // Close topmost floating modal first
      if (cur.isAuthModalOpen) {
        pushHistoryGuard();
        setIsAuthModalOpen(false);
        setAuthModalReason(null);
        return;
      }

      if (cur.isProfileOpen) {
        pushHistoryGuard();
        setIsProfileOpen(false);
        return;
      }

      // Inside Hokm full-screen Hub: step back from subview -> hub -> Games menu
      if (cur.selectedGameHub !== null) {
        pushHistoryGuard();
        if (cur.hokmHubSubView !== 'hub') {
          setHokmHubSubView('hub');
        } else {
          setSelectedGameHub(null);
        }
        return;
      }

      // Inside Shop or Friends tab -> return to Games Main Menu
      if (cur.activeTab !== 'games') {
        pushHistoryGuard();
        setActiveTab('games');
        return;
      }

      // On Games Main Menu root: Double-Back-to-Exit pattern
      const now = Date.now();
      if (now - lastRootBackPressRef.current < 2200) {
        setExitToastVisible(false);
        lastRootBackPressRef.current = 0;
        // Allow actual browser/device back navigation on second press
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
    if (tab !== activeTab) {
      setActiveTab(tab);
    }
  };

  const openAuthModal = (
    mode: AuthModalMode = 'login',
    reason: string | null = null
  ) => {
    setIsProfileOpen(false);
    setAuthModalMode(mode);
    setAuthModalReason(reason);
    setIsAuthModalOpen(true);
  };

  const openProfileModal = (
    initialView: ProfileSubView = 'overview',
    initialAuthMode: ProfileInitialAuthMode = 'login'
  ) => {
    setIsAuthModalOpen(false);
    setProfileInitialView(initialView);
    setProfileInitialAuthMode(initialAuthMode);
    setIsProfileOpen(true);
  };

  const handleOpenGameHub = (gameId: GameId) => {
    if (gameId === 'hokm') {
      setIsProfileOpen(false);
      setIsAuthModalOpen(false);
      setActiveTab('games');
      setSelectedGameHub('hokm');
      setHokmHubSubView('hub');
    }
  };

  const handlePurchaseShopItem = useCallback(
    (item: ShopItem) => {
      updateProfile((prev) => {
        const owned = new Set(prev.ownedShopItemIds ?? DEFAULT_OWNED_SHOP_IDS);
        if (owned.has(item.id)) return prev;

        const nextCoins =
          item.currency === 'coins' ? prev.coins - item.price : prev.coins;
        const nextGems =
          item.currency === 'gems' ? prev.gems - item.price : prev.gems;
        if (nextCoins < 0 || nextGems < 0) return prev;

        owned.add(item.id);
        const bannerFromItem = resolveBannerCodeFromShopItem(item.id);

        return {
          ...prev,
          coins: nextCoins,
          gems: nextGems,
          ownedShopItemIds: Array.from(owned),
          equippedTableSkinId:
            item.section === 'table_themes'
              ? item.id
              : prev.equippedTableSkinId,
          bannerCode: bannerFromItem ?? prev.bannerCode,
          customBannerUrl: bannerFromItem ? null : prev.customBannerUrl,
        };
      });
    },
    [updateProfile]
  );

  const handleEquipShopItem = useCallback(
    (item: ShopItem) => {
      updateProfile((prev) => {
        if (item.section === 'table_themes') {
          return {
            ...prev,
            equippedTableSkinId: item.id,
          };
        }
        const bannerFromItem = resolveBannerCodeFromShopItem(item.id);
        if (bannerFromItem) {
          return {
            ...prev,
            bannerCode: bannerFromItem,
            customBannerUrl: null,
          };
        }
        return prev;
      });
    },
    [updateProfile]
  );

  const handleSelectDeck = useCallback(
    async (deckId: string) => {
      const res = await deckRuntime.activateDeck(deckId);
      updateProfile((prev) => ({
        ...prev,
        equippedDeckId: res.activatedDeckId,
      }));
    },
    [updateProfile]
  );

  const handleLaunchFromGameHub = (req: GameHubLaunchRequest) => {
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

  // =========================================================================
  // ACTIVE GAME VIEWS (Full-Screen)
  // =========================================================================
  if (activeGame === 'hokm-online') {
    return (
      <OnlineHokmGame
        username={profile.username}
        avatarCode={profile.avatarCode}
        tableSkinId={profile.equippedTableSkinId}
        deckId={profile.equippedDeckId ?? EYVAN_CLASSIC_DECK_ID}
        isAuthenticated={Boolean(authUser)}
        initialRoomCode={initialRoomCode}
        autoJoinRoom={autoJoinInviteRoom}
        targetMatchScore={hokmTargetScore}
        initialLaunchAction={onlineLaunchAction}
        soundEnabled={profile.appSettings.soundEnabled}
        reducedMotionPreference={profile.appSettings.reducedMotion}
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
    );
  }

  if (activeGame === 'hokm-offline') {
    return (
      <HokmGame
        playerName={profile.username}
        tableSkinId={profile.equippedTableSkinId}
        deckId={profile.equippedDeckId ?? EYVAN_CLASSIC_DECK_ID}
        targetMatchScore={hokmTargetScore}
        soundEnabled={profile.appSettings.soundEnabled}
        animationSpeed={profile.appSettings.animationSpeed}
        reducedMotionPreference={profile.appSettings.reducedMotion}
        onToggleSound={() =>
          setProfile((prev) => ({
            ...prev,
            appSettings: {
              ...prev.appSettings,
              soundEnabled: !prev.appSettings.soundEnabled,
            },
          }))
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
          onSubViewChange={setHokmHubSubView}
          currentUserId={authUser?.userId ?? null}
          userCoins={profile.coins}
          userGems={profile.gems}
          isAuthenticated={Boolean(authUser)}
          ownedItemIds={profile.ownedShopItemIds}
          equippedTableSkinId={profile.equippedTableSkinId}
          equippedBannerCode={profile.bannerCode}
          equippedDeckId={profile.equippedDeckId ?? EYVAN_CLASSIC_DECK_ID}
          onPurchaseItem={handlePurchaseShopItem}
          onEquipItem={handleEquipShopItem}
          onSelectDeck={handleSelectDeck}
          onRequireAuth={() => openAuthModal('login', null)}
          onBack={() => {
            setSelectedGameHub(null);
            setHokmHubSubView('hub');
          }}
          onLaunchHokm={handleLaunchFromGameHub}
          onOpenFullShop={() => {
            setSelectedGameHub(null);
            setHokmHubSubView('hub');
            setShopInitialCategory('all');
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
      </>
    );
  }

  // =========================================================================
  // MAIN PLATFORM SHELL (Floating Frosted Pill Bottom Dock)
  // =========================================================================

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[var(--eyvan-bg)] text-[var(--eyvan-text)] relative overflow-x-hidden transition-colors duration-200">
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
              equippedTableSkinId={profile.equippedTableSkinId}
              equippedBannerCode={profile.bannerCode}
              equippedDeckId={profile.equippedDeckId ?? EYVAN_CLASSIC_DECK_ID}
              onPurchaseItem={handlePurchaseShopItem}
              onEquipItem={handleEquipShopItem}
              onSelectDeck={handleSelectDeck}
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
              onOpenAccount={() => openAuthModal('login', null)}
              onBack={() => handleSelectTab('games')}
              onJoinInvitedRoom={(roomCode) => {
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
        {!isTyping && (
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

        {/* Floating Centered Profile Modal */}
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
          onOpenBannerShop={() => {
            setIsProfileOpen(false);
            setSelectedGameHub(null);
            setShopInitialCategory('avatars_frames');
            setActiveTab('shop');
          }}
        />

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
      </div>
    </div>
  );
}
