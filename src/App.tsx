import { useEffect, useState } from 'react';
import {
  GameId,
  PlatformTabId,
  ThemeMode,
  UserProfile,
} from './platform/types/platform';
import { INITIAL_DEMO_PROFILE, PLATFORM_ASSETS } from './platform/data/demoData';
import { TopBar } from './platform/components/TopBar';
import { BottomNav } from './platform/components/BottomNav';
import { ProfileDrawer } from './platform/components/ProfileDrawer';
import { ShopPage } from './platform/pages/ShopPage';
import { GamesPage } from './platform/pages/GamesPage';
import { FriendsPage } from './platform/pages/FriendsPage';
import { HokmGame } from './games/hokm/HokmGame';
import { hokmSound } from './games/hokm/audio/soundEffects';
import { preloadCardArtwork } from './games/hokm/components/PlayingCard';

function getInitialGameFromQuery(): GameId | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('autostart') === '1' ? 'hokm' : null;
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
  const [activeGame, setActiveGame] = useState<GameId | null>(
    getInitialGameFromQuery
  );
  const [profile, setProfile] = useState<UserProfile>(() => ({
    ...INITIAL_DEMO_PROFILE,
    appSettings: {
      ...INITIAL_DEMO_PROFILE.appSettings,
      themeMode: getInitialThemeMode(),
    },
  }));
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isInChatRoom, setIsInChatRoom] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  const themeMode = profile.appSettings.themeMode;

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
      setIsInChatRoom(false);
      setActiveTab(tab);
    }
  };

  const handleLaunchGame = (gameId: GameId) => {
    if (gameId === 'hokm') {
      setIsProfileOpen(false);
      setIsInChatRoom(false);
      setActiveGame('hokm');
    }
  };

  if (activeGame === 'hokm') {
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

  const hideBottomNav = isTyping || isInChatRoom;

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
              currentUsername={profile.username}
              onInviteToHokm={() => handleLaunchGame('hokm')}
              onChatModeChange={setIsInChatRoom}
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
        />
      </div>
    </div>
  );
}
