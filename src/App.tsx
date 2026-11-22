import { useEffect, useState } from 'react';
import {
  GameId,
  PlatformTabId,
  ThemeMode,
  UserProfile,
} from './platform/types/platform';
import { PLATFORM_ASSETS } from './platform/data/assets';
import { createInitialGuestProfile } from './platform/data/guestDefaults';
import {
  AuthUserSummary,
  PendingAuthUrlAction,
  consumeAuthActionFromUrlHash,
  fetchCurrentAuthSession,
} from './platform/auth/authClient';
import { TopBar } from './platform/components/TopBar';
import { BottomNav } from './platform/components/BottomNav';
import { ProfileDrawer } from './platform/components/ProfileDrawer';
import { ShopPage } from './platform/pages/ShopPage';
import { GamesPage } from './platform/pages/GamesPage';
import { FriendsPage } from './platform/pages/FriendsPage';
import { HokmGame } from './games/hokm/HokmGame';
import { OnlineHokmGame } from './games/hokm/OnlineHokmGame';
import { fetchMyOnlineStats } from './games/hokm/online/client';
import { hokmSound } from './games/hokm/audio/soundEffects';
import { preloadCardArtwork } from './games/hokm/components/PlayingCard';
import {
  getOrCreateTabDeviceId,
  sendPresenceHeartbeat,
  sendPresenceOffline,
} from './platform/social/socialClient';

type ActiveGameView = 'hokm-online' | 'hokm-offline' | null;

function getInitialRoomCodeFromQuery(): string {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  const code = params.get('room');
  return code ? code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) : '';
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

export default function App() {
  const [activeTab, setActiveTab] = useState<PlatformTabId>('games');
  const [activeGame, setActiveGame] = useState<ActiveGameView>(
    getInitialGameFromQuery
  );
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
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  const themeMode = profile.appSettings.themeMode;

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

  // Real multi-device online presence lifecycle (30s heartbeat, 75s server lease TTL, instant offline on tab close)
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
        // Ignore transient network errors; lease expires safely on server if offline
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

  // Capture & immediately scrub `#verify-email=` / `#reset-password=` tokens from URL
  useEffect(() => {
    const syncAuthHashAction = () => {
      const action = consumeAuthActionFromUrlHash();
      if (action) {
        setPendingAuthAction(action);
        setIsProfileOpen(true);
      }
    };
    syncAuthHashAction();
    window.addEventListener('hashchange', syncAuthHashAction);
    return () => {
      window.removeEventListener('hashchange', syncAuthHashAction);
    };
  }, []);

  // Pre-decode court/ace card artwork gently after initial paint so home preview opens immediately
  useEffect(() => {
    const runPreload = () => {
      preloadCardArtwork();
    };
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(runPreload, { timeout: 1200 });
      return () => w.cancelIdleCallback?.(id);
    }
    const tid = window.setTimeout(runPreload, 450);
    return () => window.clearTimeout(tid);
  }, []);

  // Hide mobile bottom navigation automatically whenever the user is typing in any input/textarea
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
  }, [profile.appSettings.soundEnabled]);

  useEffect(() => {
    document.body.dataset.state = activeGame ? 'playing' : 'platform';
  }, [activeGame]);

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
    if (tab !== activeTab) {
      setActiveTab(tab);
    }
  };

  const handleLaunchGame = (gameId: GameId) => {
    if (gameId === 'hokm') {
      setIsProfileOpen(false);
      setActiveGame('hokm-online');
    }
  };

  if (activeGame === 'hokm-online') {
    return (
      <OnlineHokmGame
        username={profile.username}
        avatarCode={profile.avatarCode}
        isAuthenticated={Boolean(authUser)}
        initialRoomCode={initialRoomCode}
        autoJoinRoom={autoJoinInviteRoom}
        soundEnabled={profile.appSettings.soundEnabled}
        reducedMotionPreference={profile.appSettings.reducedMotion}
        onChangeUsername={(nextUsername) =>
          setProfile((prev) => ({
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
          setProfile((prev) => ({
            ...prev,
            avatarCode: validAvatar,
          }));
        }}
        onLaunchOffline={() => setActiveGame('hokm-offline')}
        onBackToGames={() => {
          setInitialRoomCode('');
          setAutoJoinInviteRoom(false);
          setActiveGame(null);
          setActiveTab('games');
        }}
      />
    );
  }

  if (activeGame === 'hokm-offline') {
    return (
      <HokmGame
        playerName={profile.username}
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
        }}
      />
    );
  }

  const hideBottomNav = isTyping;

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
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover object-top"
          style={{ opacity: 'var(--eyvan-backdrop-opacity)' }}
        />
        <div
          className="absolute inset-0"
          style={{ background: 'var(--eyvan-backdrop-scrim)' }}
        />
      </div>

      <div className="relative z-10 flex flex-col min-h-[100dvh]">
        <TopBar
          activeTab={activeTab}
          onSelectTab={handleSelectTab}
          profile={profile}
          themeMode={themeMode}
          onToggleTheme={handleToggleTheme}
          isProfileOpen={isProfileOpen}
          onToggleProfile={() => {
            setIsProfileOpen((prev) => !prev);
          }}
        />

        <main
          className={`flex-1 w-full max-w-5xl mx-auto px-3.5 sm:px-6 pt-3 sm:pt-5 ${
            hideBottomNav ? 'pb-3 md:pb-6' : 'pb-24 md:pb-12'
          }`}
        >
          {activeTab === 'shop' && (
            <ShopPage userCoins={profile.coins} userGems={profile.gems} />
          )}
          {activeTab === 'games' && (
            <GamesPage onSelectGame={handleLaunchGame} />
          )}
          {activeTab === 'friends' && (
            <FriendsPage
              authUser={authUser}
              authLoading={authLoading}
              onOpenAccount={() => setIsProfileOpen(true)}
              onJoinInvitedRoom={(roomCode) => {
                setIsProfileOpen(false);
                setInitialRoomCode(roomCode);
                setAutoJoinInviteRoom(true);
                setActiveGame('hokm-online');
              }}
            />
          )}
        </main>

        {!hideBottomNav && (
          <BottomNav activeTab={activeTab} onSelectTab={handleSelectTab} />
        )}

        <ProfileDrawer
          isOpen={isProfileOpen}
          onClose={() => setIsProfileOpen(false)}
          profile={profile}
          onUpdateProfile={setProfile}
          authUser={authUser}
          authLoading={authLoading}
          onAuthChange={applyAuthenticatedUser}
          pendingAuthAction={pendingAuthAction}
          onClearPendingAuthAction={() => setPendingAuthAction(null)}
        />
      </div>
    </div>
  );
}
