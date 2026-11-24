import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Seat, Suit, TeamId } from './engine/types';
import {
  CompletedMatchRecord,
  RoomEventNotice,
  RoomSnapshot,
  SeatPublicAppearance,
} from './online/protocol';
import { projectedToTableState } from './online/perspective';
import {
  ConnectionState,
  HokmOnlineClient,
  OnlineSessionCredentials,
  clearOnlineSession,
  createOnlineRoom,
  fetchRecentOnlineMatches,
  joinOnlineRoom,
  quickMatchOnlineRoom,
  resumeOnlineSession,
} from './online/client';
import {
  FlyingDealCard,
  HokmTable,
  OnlineSeatPlayerMeta,
  TrickCollectPhase,
} from './components/HokmTable';
import { OnlineLobby, getAvatarSrcByCode } from './components/OnlineLobby';
import { hokmSound } from './audio/soundEffects';
import { preloadCardArtwork } from './components/PlayingCard';
import {
  DeckRegistry,
  EYVAN_CLASSIC_DECK_ID,
  deckRuntime,
  defaultDeckStorageManager,
} from '../../platform/decks';

export type OnlineHokmLaunchAction =
  | 'quick_match'
  | 'create_friends'
  | 'join_room'
  | null;

interface OnlineHokmGameProps {
  username: string;
  avatarCode: string;
  tableSkinId?: string;
  deckId?: string;
  cardBackId?: string;
  gameEffectId?: string;
  appearance?: SeatPublicAppearance;
  isAuthenticated?: boolean;
  initialRoomCode?: string;
  autoJoinRoom?: boolean;
  targetMatchScore?: number;
  initialLaunchAction?: OnlineHokmLaunchAction;
  soundEnabled: boolean;
  reducedMotionPreference: boolean;
  onChangeUsername: (username: string) => void;
  onChangeAvatar: (avatarCode: string) => void;
  onLaunchOffline: () => void;
  onBackToGames: () => void;
}

export const OnlineHokmGame: React.FC<OnlineHokmGameProps> = ({
  username,
  avatarCode,
  tableSkinId = 'tt-traditional',
  deckId = EYVAN_CLASSIC_DECK_ID,
  cardBackId,
  gameEffectId,
  appearance,
  isAuthenticated = false,
  initialRoomCode = '',
  autoJoinRoom = false,
  targetMatchScore = 3,
  initialLaunchAction = null,
  soundEnabled,
  reducedMotionPreference,
  onChangeUsername,
  onChangeAvatar,
  onLaunchOffline,
  onBackToGames,
}) => {
  // SECURITY: sessionCreds contains ONLY public room/seat metadata — auth secret stays strictly in HttpOnly cookie!
  const [sessionCreds, setSessionCreds] =
    useState<OnlineSessionCredentials | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('disconnected');
  const [rttMs, setRttMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bannerNotice, setBannerNotice] = useState<string | null>(null);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [recentMatches, setRecentMatches] = useState<CompletedMatchRecord[]>(
    []
  );

  // Table visual states synced to authoritative server events
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [flyingDealCards] = useState<FlyingDealCard[]>([]);
  const [showGameStartBanner, setShowGameStartBanner] = useState(false);
  const [trickCollectPhase, setTrickCollectPhase] =
    useState<TrickCollectPhase>('idle');
  const [collectingWinnerTeam, setCollectingWinnerTeam] =
    useState<TeamId | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const clientRef = useRef<HokmOnlineClient | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const trickTimersRef = useRef<number[]>([]);
  const startBannerTimerRef = useRef<number | null>(null);

  const [osReducedMotion, setOsReducedMotion] = useState(false);
  useEffect(() => {
    preloadCardArtwork();
    void deckRuntime.ensureDeckReady(deckId);
    hokmSound.prefetchRaw();
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setOsReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setOsReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => {
      mq.removeEventListener('change', handler);
      deckRuntime.releaseRoomDecks(new Set([deckId]));
    };
  }, [deckId]);

  const seatDeckKey =
    snapshot?.seats
      .map((s) => `${s.visualSeat}:${s.appearance?.deckId ?? ''}`)
      .join('|') ?? '';

  // Load every distinct player's Multi-Deck concurrently for authentic display at the table
  // WITHOUT modifying the viewer's own ownedShopItemIds or equippedDeckId!
  useEffect(() => {
    if (!snapshot?.seats) return;
    let active = true;
    const distinctDecks = new Set<string>();
    for (const s of snapshot.seats) {
      const seatDeck = s.appearance?.deckId;
      if (seatDeck && seatDeck !== EYVAN_CLASSIC_DECK_ID) {
        distinctDecks.add(seatDeck);
      }
    }
    if (distinctDecks.size === 0) return;

    void (async () => {
      for (const seatDeckId of distinctDecks) {
        if (!active) break;
        const firstLoad = await deckRuntime.loadDeck(seatDeckId, 'room_seat');
        if (!active) break;
        if (
          firstLoad.fallbackUsed &&
          typeof navigator !== 'undefined' &&
          navigator.onLine !== false
        ) {
          let entry = DeckRegistry.getCatalogEntry(seatDeckId);
          if (!entry) {
            await DeckRegistry.fetchCatalog();
            entry = DeckRegistry.getCatalogEntry(seatDeckId);
          }
          if (entry && active) {
            try {
              await defaultDeckStorageManager.installOrUpdateDeck({ entry });
              if (active) {
                await deckRuntime.loadDeck(seatDeckId, 'room_seat');
              }
            } catch {
              // Seamless silent fallback to Eyvan Classic if display assets cannot download
            }
          }
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [seatDeckKey]);

  const reducedMotion = reducedMotionPreference || osReducedMotion;

  useEffect(() => {
    hokmSound.setEnabled(soundEnabled);
  }, [soundEnabled]);

  const refreshMatches = useCallback(() => {
    void fetchRecentOnlineMatches().then((rows) => setRecentMatches(rows));
  }, []);

  useEffect(() => {
    refreshMatches();
  }, [refreshMatches]);

  // Secure page-refresh session recovery via server-verified HttpOnly cookie
  // (ZERO sessionToken in React state, localStorage, sessionStorage, or URL!)
  const resumeAttemptedRef = useRef(false);
  const [resumeChecked, setResumeChecked] = useState(false);
  const autoJoinAttemptedRef = useRef(false);
  useEffect(() => {
    if (resumeAttemptedRef.current || sessionCreds) {
      setResumeChecked(true);
      return;
    }
    resumeAttemptedRef.current = true;
    let active = true;
    void resumeOnlineSession(initialRoomCode || undefined)
      .then((recovered) => {
        if (active && recovered) {
          setSessionCreds(recovered);
        }
      })
      .finally(() => {
        if (active) setResumeChecked(true);
      });
    return () => {
      active = false;
    };
  }, [initialRoomCode, sessionCreds]);

  // Reflect public roomCode in URL query so refreshing returns directly to OnlineHokmGame
  useEffect(() => {
    if (typeof window === 'undefined' || !sessionCreds?.roomCode) return;
    try {
      const nextUrl = new URL(window.location.href);
      if (nextUrl.searchParams.get('room') !== sessionCreds.roomCode) {
        nextUrl.searchParams.set('room', sessionCreds.roomCode);
        window.history.replaceState(null, '', nextUrl.toString());
      }
    } catch {
      // Ignore iframe history restriction
    }
  }, [sessionCreds?.roomCode]);

  // 1-second ticker only when someone is disconnected so countdown updates live
  const hasDisconnectedPlayer = Boolean(
    snapshot?.seats.some((s) => s.playerId && !s.connected && s.disconnectDeadline)
  );
  useEffect(() => {
    if (!hasDisconnectedPlayer) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasDisconnectedPlayer]);

  const showTransientNotice = useCallback((text: string, ms = 3200) => {
    setBannerNotice(text);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setBannerNotice(null);
      noticeTimerRef.current = null;
    }, ms);
  }, []);

  const clearTrickTimers = useCallback(() => {
    trickTimersRef.current.forEach((id) => window.clearTimeout(id));
    trickTimersRef.current = [];
  }, []);

  const handleServerEvent = useCallback(
    (nextSnap: RoomSnapshot, event?: RoomEventNotice) => {
      if (!event) return;

      switch (event.type) {
        case 'DEALT_INITIAL_5':
          clearTrickTimers();
          setTrickCollectPhase('idle');
          setCollectingWinnerTeam(null);
          hokmSound.playShuffle();
          break;

        case 'DEALT_REMAINING_8':
          hokmSound.playTrumpChosen();
          setShowGameStartBanner(true);
          hokmSound.playGameStart();
          if (startBannerTimerRef.current !== null) {
            window.clearTimeout(startBannerTimerRef.current);
          }
          startBannerTimerRef.current = window.setTimeout(() => {
            setShowGameStartBanner(false);
          }, 1250);
          break;

        case 'CARD_PLAYED':
          hokmSound.playCardSnap();
          setShowGameStartBanner(false);
          break;

        case 'TRICK_COMPLETED': {
          hokmSound.playCardSnap();
          const winnerTeam =
            nextSnap.game?.lastCompletedTrick?.winnerTeam ?? null;
          clearTrickTimers();
          if (winnerTeam) {
            const t1 = window.setTimeout(() => {
              setCollectingWinnerTeam(winnerTeam);
              setTrickCollectPhase('stacking');
              hokmSound.playTrickGather();
              const t2 = window.setTimeout(() => {
                setTrickCollectPhase('sliding');
                hokmSound.playTrickWin(winnerTeam === 'myTeam');
              }, 260);
              trickTimersRef.current.push(t2);
            }, 460);
            trickTimersRef.current.push(t1);
          }
          break;
        }

        case 'TRICK_COLLECTED':
          clearTrickTimers();
          setTrickCollectPhase('idle');
          setCollectingWinnerTeam(null);
          break;

        case 'HAND_COMPLETED': {
          clearTrickTimers();
          setTrickCollectPhase('idle');
          setCollectingWinnerTeam(null);
          const isKot =
            nextSnap.game?.handOutcome?.winType === 'kot' ||
            nextSnap.game?.handOutcome?.winType === 'hakem_kot';
          hokmSound.playHandFinish(Boolean(isKot));
          break;
        }

        case 'MATCH_COMPLETED':
          clearTrickTimers();
          setTrickCollectPhase('idle');
          setCollectingWinnerTeam(null);
          if (nextSnap.game?.matchWinner === 'myTeam') {
            hokmSound.playMatchVictory();
          } else {
            hokmSound.playMatchDefeat();
          }
          refreshMatches();
          break;

        case 'PLAYER_DISCONNECTED':
          showTransientNotice(
            `اتصال ${event.detail ?? 'بازیکن'} قطع شد — صندلی تا بازگشت حفظ می‌شود.`,
            4500
          );
          break;

        case 'PLAYER_RECONNECTED':
          showTransientNotice(`${event.detail ?? 'بازیکن'} مجدداً متصل شد.`);
          break;

        case 'ROOM_CLOSED':
          if (event.detail?.startsWith('forfeit:')) {
            const who = event.detail.slice('forfeit:'.length);
            setClosedReason(
              `بازیکن ${who} از بازی انصراف داد و اتاق بسته شد.`
            );
          } else if (event.detail?.startsWith('disconnect_timeout:')) {
            const who = event.detail.slice('disconnect_timeout:'.length);
            setClosedReason(
              `مهلت اتصال مجدد بازیکن ${who} به پایان رسید و اتاق بسته شد.`
            );
          } else {
            setClosedReason('این اتاق بسته شد.');
          }
          break;
      }
    },
    [clearTrickTimers, refreshMatches, showTransientNotice]
  );

  // Connect WebSocket whenever sessionCreds are obtained
  useEffect(() => {
    if (!sessionCreds) return;

    const client = new HokmOnlineClient(sessionCreds, {
      onConnectionChange: (st) => setConnectionState(st),
      onSnapshot: (snap, event) => {
        setSnapshot(snap);
        setErrorMessage(null);
        handleServerEvent(snap, event);
      },
      onError: (_code, msg) => {
        setErrorMessage(msg);
        showTransientNotice(msg, 3500);
      },
      onRttUpdate: (ms) => setRttMs(ms),
      onClosedByServer: (reason) => {
        setClosedReason(reason);
      },
    });

    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
      clearTrickTimers();
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
      if (startBannerTimerRef.current !== null) {
        window.clearTimeout(startBannerTimerRef.current);
      }
    };
  }, [clearTrickTimers, handleServerEvent, sessionCreds, showTransientNotice]);

  // Browser Back / Escape guard during active match
  useEffect(() => {
    if (!snapshot || snapshot.status !== 'PLAYING') return;

    try {
      window.history.pushState(
        { eyvanOnlineHokmGuard: true },
        '',
        window.location.href
      );
    } catch {
      // Ignore iframe history restriction
    }

    const onPopState = () => {
      try {
        window.history.pushState(
          { eyvanOnlineHokmGuard: true },
          '',
          window.location.href
        );
      } catch {
        // Ignore
      }
      hokmSound.playWarning();
      setExitConfirmOpen(true);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExitConfirmOpen((prev) => {
          if (!prev) hokmSound.playWarning();
          return !prev;
        });
      }
    };

    window.addEventListener('popstate', onPopState);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [snapshot]);

  const handleCreateRoom = useCallback(async () => {
    setBusy(true);
    setErrorMessage(null);
    setClosedReason(null);
    try {
      const creds = await createOnlineRoom({
        username,
        avatarCode,
        targetMatchScore,
        appearance,
      });
      setSessionCreds(creds);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'ساخت اتاق با خطا مواجه شد.'
      );
    } finally {
      setBusy(false);
    }
  }, [appearance, avatarCode, targetMatchScore, username]);

  const handleQuickMatch = useCallback(async () => {
    setBusy(true);
    setErrorMessage(null);
    setClosedReason(null);
    try {
      const creds = await quickMatchOnlineRoom({
        username,
        avatarCode,
        targetMatchScore,
        appearance,
      });
      setSessionCreds(creds);
      showTransientNotice(
        creds.matchedExisting
          ? 'به یک میز رندوم باز متصل شدید.'
          : 'میز رندوم جدید ساخته شد — در انتظار بازیکنان دیگر.',
        3600
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'ورود به بازی تصادفی با خطا مواجه شد.'
      );
    } finally {
      setBusy(false);
    }
  }, [appearance, avatarCode, showTransientNotice, targetMatchScore, username]);

  const handleJoinRoom = useCallback(
    async (roomCode: string) => {
      setBusy(true);
      setErrorMessage(null);
      setClosedReason(null);
      try {
        const creds = await joinOnlineRoom({
          roomCode,
          username,
          avatarCode,
          appearance,
        });
        setSessionCreds(creds);
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : 'ورود به اتاق با خطا مواجه شد.'
        );
      } finally {
        setBusy(false);
      }
    },
    [appearance, avatarCode, username]
  );

  // One-click real-room launch from Game Hub or accepted game invite
  useEffect(() => {
    if (!resumeChecked || sessionCreds || busy || autoJoinAttemptedRef.current) {
      return;
    }
    const effectiveAction: OnlineHokmLaunchAction =
      initialLaunchAction ?? (autoJoinRoom && initialRoomCode ? 'join_room' : null);
    if (!effectiveAction) return;

    autoJoinAttemptedRef.current = true;
    if (effectiveAction === 'join_room' && initialRoomCode) {
      void handleJoinRoom(initialRoomCode);
    } else if (effectiveAction === 'quick_match') {
      void handleQuickMatch();
    } else if (effectiveAction === 'create_friends') {
      void handleCreateRoom();
    }
  }, [
    autoJoinRoom,
    busy,
    handleCreateRoom,
    handleJoinRoom,
    handleQuickMatch,
    initialLaunchAction,
    initialRoomCode,
    resumeChecked,
    sessionCreds,
  ]);

  const handleLeaveToLobby = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.leaveRoom();
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    void clearOnlineSession();
    deckRuntime.releaseRoomDecks(new Set([deckId]));
    try {
      const nextUrl = new URL(window.location.href);
      if (nextUrl.searchParams.has('room')) {
        nextUrl.searchParams.delete('room');
        window.history.replaceState(null, '', nextUrl.toString());
      }
    } catch {
      // Ignore iframe history restriction
    }
    setExitConfirmOpen(false);
    setSessionCreds(null);
    setSnapshot(null);
    setClosedReason(null);
    setErrorMessage(null);
    setRttMs(null);
    setConnectionState('disconnected');
    refreshMatches();
  }, [deckId, refreshMatches]);

  // Build visual seat metadata from authoritative snapshot
  const seatPlayers = useMemo<Record<Seat, OnlineSeatPlayerMeta> | undefined>(() => {
    if (!snapshot) return undefined;
    const map = {} as Record<Seat, OnlineSeatPlayerMeta>;
    for (const s of snapshot.seats) {
      const remainingSec =
        !s.connected && s.disconnectDeadline
          ? Math.max(0, Math.ceil((s.disconnectDeadline - nowTick) / 1000))
          : null;
      map[s.visualSeat] = {
        name: s.username ?? '---',
        avatarSrc: getAvatarSrcByCode(s.avatarCode),
        connected: s.connected,
        disconnectRemainingSec: remainingSec,
      };
    }
    return map;
  }, [nowTick, snapshot]);

  const seatAppearances = useMemo<
    Partial<Record<Seat, SeatPublicAppearance>> | undefined
  >(() => {
    if (!snapshot) return undefined;
    const map: Partial<Record<Seat, SeatPublicAppearance>> = {};
    for (const s of snapshot.seats) {
      if (s.appearance) {
        map[s.visualSeat] = s.appearance;
      }
    }
    return map;
  }, [snapshot]);

  // If playing or match finished -> render Phase 1 HokmTable seamlessly!
  if (
    snapshot &&
    snapshot.game &&
    (snapshot.status === 'PLAYING' || snapshot.status === 'FINISHED')
  ) {
    const tableState = projectedToTableState(snapshot.game);
    const canHumanPlay =
      snapshot.status === 'PLAYING' &&
      connectionState === 'connected' &&
      tableState.phase === 'PLAYING_TRICK' &&
      tableState.currentTurn === 'south' &&
      trickCollectPhase === 'idle';

    const isHost = snapshot.hostPlayerId === snapshot.viewerPlayerId;
    const hakemName =
      tableState.phase === 'CHOOSING_TRUMP' && tableState.hakem !== 'south'
        ? seatPlayers?.[tableState.hakem]?.name ?? null
        : null;

    return (
      <>
        <HokmTable
          state={tableState}
          visibleHandCounts={snapshot.game.handCounts}
          flyingDealCards={flyingDealCards}
          isShufflingAnim={false}
          isDealingAnim={false}
          showGameStartBanner={showGameStartBanner}
          trickCollectPhase={trickCollectPhase}
          collectingWinnerTeam={collectingWinnerTeam}
          playerName={username}
          tableSkinId={tableSkinId}
          deckId={deckId}
          cardBackId={cardBackId}
          gameEffectId={gameEffectId}
          seatAppearances={seatAppearances}
          reducedMotion={reducedMotion}
          canHumanPlay={canHumanPlay}
          exitConfirmOpen={exitConfirmOpen}
          seatPlayers={seatPlayers}
          deckCount={snapshot.game.deckCount}
          canStartRematch={isHost}
          onlineHud={{
            roomCode: snapshot.roomCode,
            connectionState,
            rttMs,
            bannerNotice,
            waitingHakemName: hakemName,
          }}
          onPlayCard={(cardId) => {
            if (!canHumanPlay) return;
            clientRef.current?.playCard(cardId);
          }}
          onChooseTrump={(suit: Suit) => {
            if (
              tableState.phase !== 'CHOOSING_TRUMP' ||
              tableState.hakem !== 'south'
            ) {
              return;
            }
            clientRef.current?.chooseTrump(suit);
          }}
          onRequestExit={() => {
            if (snapshot.status === 'FINISHED') {
              handleLeaveToLobby();
              return;
            }
            hokmSound.playWarning();
            setExitConfirmOpen(true);
          }}
          onCancelExit={() => setExitConfirmOpen(false)}
          onConfirmExit={handleLeaveToLobby}
          onNewMatch={() => {
            if (isHost) {
              clientRef.current?.requestRematch();
            }
          }}
        />

        {/* Room Closed Overlay (forfeit / disconnect grace expiry) */}
        {closedReason && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
            role="alertdialog"
            aria-modal="true"
            data-testid="online-room-closed-modal"
          >
            <div className="w-full max-w-sm rounded-3xl bg-gradient-to-b from-[#0E2822] to-[#071814] border border-[#D4AE58]/60 p-6 text-center space-y-4 shadow-2xl">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-[#D97706]/20 border border-[#F59E0B]/50 flex items-center justify-center">
                <AlertTriangle className="w-7 h-7 text-[#FDE68A]" />
              </div>
              <h2 className="text-lg font-black text-[#FAF6EE]">
                اتاق بازی بسته شد
              </h2>
              <p className="text-xs sm:text-sm text-[#B8CEC6] leading-relaxed">
                {closedReason}
              </p>
              <button
                type="button"
                onClick={handleLeaveToLobby}
                data-testid="room-closed-back-btn"
                className="w-full min-h-[46px] rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] text-sm font-black cursor-pointer"
              >
                بازگشت به لابی آنلاین
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <OnlineLobby
      username={username}
      avatarCode={avatarCode}
      isAuthenticated={isAuthenticated}
      initialRoomCode={initialRoomCode}
      snapshot={snapshot}
      connectionState={connectionState}
      rttMs={rttMs}
      busy={busy}
      errorMessage={closedReason ?? errorMessage}
      recentMatches={recentMatches}
      onChangeUsername={onChangeUsername}
      onChangeAvatar={onChangeAvatar}
      onCreateRoom={handleCreateRoom}
      onJoinRoom={handleJoinRoom}
      onToggleReady={(ready) => clientRef.current?.setReady(ready)}
      onSelectSeat={(seat) => clientRef.current?.selectSeat(seat)}
      onStartMatch={() => clientRef.current?.startMatch()}
      onLeaveRoom={handleLeaveToLobby}
      onLaunchOffline={onLaunchOffline}
      onBackToGames={onBackToGames}
      onRefreshMatches={refreshMatches}
    />
  );
};
