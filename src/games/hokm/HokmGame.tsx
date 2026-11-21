import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  HOKM_CONFIG,
  HokmState,
  Seat,
  Suit,
  TeamId,
} from './engine/types';
import {
  chooseTrumpSuit,
  collectCompletedTrick,
  createInitialMatchState,
  dealInitialFive,
  dealRemainingEight,
  playCard,
  resetMatch,
  startNextHand,
  startShufflingHand,
} from './engine/gameEngine';
import { pickRandomLegalCard, pickRandomTrumpSuit } from './engine/simulator';
import { hokmSound } from './audio/soundEffects';
import { preloadCardArtwork } from './components/PlayingCard';
import {
  FlyingDealCard,
  HokmTable,
  TrickCollectPhase,
} from './components/HokmTable';
import {
  ANIMATION_SPEED_FACTOR,
  AnimationSpeed,
} from '../../platform/theme/tokens';

interface HokmGameProps {
  playerName: string;
  soundEnabled: boolean;
  animationSpeed: AnimationSpeed;
  reducedMotionPreference: boolean;
  onToggleSound: () => void;
  onChangeAnimationSpeed: (speed: AnimationSpeed) => void;
  onBackToGames: () => void;
}

export const HokmGame: React.FC<HokmGameProps> = ({
  playerName,
  soundEnabled,
  animationSpeed,
  reducedMotionPreference,
  onBackToGames,
}) => {
  const [configuredHakem] = useState<Seat>('south');
  const [state, setState] = useState<HokmState>(() =>
    createInitialMatchState({
      initialHakem: 'south',
      targetMatchScore: HOKM_CONFIG.DEFAULT_MATCH_TARGET_SCORE,
    })
  );

  // Dealt visible hand counts (only used during animated dealing; afterwards synced directly to state.hands)
  const [dealtCounts, setDealtCounts] = useState<Record<Seat, number>>({
    south: 0,
    east: 0,
    north: 0,
    west: 0,
  });
  const [flyingDealCards, setFlyingDealCards] = useState<FlyingDealCard[]>([]);
  const [isShufflingAnim, setIsShufflingAnim] = useState(false);
  const [isDealingAnim, setIsDealingAnim] = useState(false);
  const [trickCollectPhase, setTrickCollectPhase] =
    useState<TrickCollectPhase>('idle');
  const [collectingWinnerTeam, setCollectingWinnerTeam] =
    useState<TeamId | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [showGameStartBanner, setShowGameStartBanner] = useState(false);

  const [osReducedMotion, setOsReducedMotion] = useState(false);
  useEffect(() => {
    preloadCardArtwork();
    hokmSound.prefetchRaw();
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setOsReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setOsReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const reducedMotion = reducedMotionPreference || osReducedMotion;

  useEffect(() => {
    hokmSound.setEnabled(soundEnabled);
  }, [soundEnabled]);

  const runIdRef = useRef(0);
  const timersRef = useRef<number[]>([]);
  const speedFactorRef = useRef(ANIMATION_SPEED_FACTOR[animationSpeed]);
  const reducedMotionRef = useRef(reducedMotion);
  const isExitingRef = useRef(false);
  const phaseRef = useRef(state.phase);

  useEffect(() => {
    phaseRef.current = state.phase;
  }, [state.phase]);

  useEffect(() => {
    speedFactorRef.current = ANIMATION_SPEED_FACTOR[animationSpeed];
  }, [animationSpeed]);

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  // Intercept mobile/browser Back button (popstate) & Escape key to open Forfeit Confirmation
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Push a history guard entry so pressing the phone/browser Back button fires popstate
    try {
      window.history.pushState(
        { eyvanHokmGuard: true },
        '',
        window.location.href
      );
    } catch {
      // Ignore history API restrictions in embedded frames
    }

    const handlePopState = () => {
      if (isExitingRef.current) return;
      if (phaseRef.current === 'MATCH_COMPLETE') {
        isExitingRef.current = true;
        onBackToGames();
        return;
      }
      // Keep user on the Hokm table and show forfeit confirmation warning
      try {
        window.history.pushState(
          { eyvanHokmGuard: true },
          '',
          window.location.href
        );
      } catch {
        // Ignore history API restrictions
      }
      hokmSound.playWarning();
      setExitConfirmOpen(true);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (phaseRef.current === 'MATCH_COMPLETE') {
          isExitingRef.current = true;
          onBackToGames();
        } else {
          setExitConfirmOpen((prev) => {
            if (!prev) hokmSound.playWarning();
            return !prev;
          });
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onBackToGames]);

  const handleRequestExit = useCallback(() => {
    if (phaseRef.current === 'MATCH_COMPLETE') {
      isExitingRef.current = true;
      onBackToGames();
      return;
    }
    hokmSound.playWarning();
    setExitConfirmOpen(true);
  }, [onBackToGames]);

  const handleConfirmForfeitExit = useCallback(() => {
    isExitingRef.current = true;
    setExitConfirmOpen(false);
    onBackToGames();
  }, [onBackToGames]);

  const handleCancelExit = useCallback(() => {
    setExitConfirmOpen(false);
  }, []);

  const clearAllTimers = useCallback(() => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  }, []);

  const schedule = useCallback(
    (fn: () => void, baseMs: number, expectedRunId: number): number => {
      const scaled = reducedMotionRef.current
        ? Math.min(baseMs, 45)
        : Math.max(30, Math.round(baseMs * speedFactorRef.current));
      const id = window.setTimeout(() => {
        if (runIdRef.current === expectedRunId) {
          fn();
        }
      }, scaled);
      timersRef.current.push(id);
      return id;
    },
    []
  );

  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      clearAllTimers();
    };
  }, [clearAllTimers]);

  /**
   * Calm, rhythmic dealing animation with authentic real physical card slide sounds.
   */
  const runDealWaveAnimation = useCallback(
    (
      dealSequence: Array<{ seat: Seat }>,
      startingCounts: Record<Seat, number>,
      waveTag: string,
      expectedRunId: number,
      onComplete: (finalCounts: Record<Seat, number>) => void
    ) => {
      setIsDealingAnim(true);
      const stepDelay = reducedMotionRef.current ? 12 : 108;
      const flyDuration = reducedMotionRef.current ? 50 : 295;
      const runningCounts: Record<Seat, number> = { ...startingCounts };

      dealSequence.forEach((entry, idx) => {
        schedule(
          () => {
            const flyId = `deal-${expectedRunId}-${waveTag}-${idx}-${entry.seat}`;
            setFlyingDealCards((prev) => [
              ...prev.slice(-6),
              { id: flyId, targetSeat: entry.seat },
            ]);
            hokmSound.playDealTick();
            runningCounts[entry.seat] += 1;
            setDealtCounts({ ...runningCounts });

            schedule(
              () => {
                setFlyingDealCards((prev) => prev.filter((c) => c.id !== flyId));
              },
              flyDuration,
              expectedRunId
            );
          },
          idx * stepDelay,
          expectedRunId
        );
      });

      schedule(
        () => {
          setFlyingDealCards([]);
          onComplete({ ...runningCounts });
        },
        dealSequence.length * stepDelay + flyDuration + 35,
        expectedRunId
      );
    },
    [schedule]
  );

  /**
   * Phase 1 of dealing: Shuffle -> Calmly deal 5 cards each -> Wait for Trump selection.
   */
  const beginShuffleAndInitialDeal = useCallback(
    (shufflingState: HokmState) => {
      runIdRef.current += 1;
      const runId = runIdRef.current;
      clearAllTimers();

      setSelectedCardId(null);
      setTrickCollectPhase('idle');
      setCollectingWinnerTeam(null);
      setFlyingDealCards([]);
      setShowGameStartBanner(false);
      setDealtCounts({ south: 0, east: 0, north: 0, west: 0 });
      setState(shufflingState);
      setIsShufflingAnim(true);
      hokmSound.playShuffle();

      schedule(
        () => {
          setIsShufflingAnim(false);
          const { state: dealt5State, dealSequence } =
            dealInitialFive(shufflingState);
          setState(dealt5State);
          runDealWaveAnimation(
            dealSequence,
            { south: 0, east: 0, north: 0, west: 0 },
            'init5',
            runId,
            () => {
              setIsDealingAnim(false);
              setDealtCounts({
                south: dealt5State.hands.south.length,
                east: dealt5State.hands.east.length,
                north: dealt5State.hands.north.length,
                west: dealt5State.hands.west.length,
              });
            }
          );
        },
        880,
        runId
      );
    },
    [clearAllTimers, runDealWaveAnimation, schedule]
  );

  useEffect(() => {
    const initial = createInitialMatchState({
      initialHakem: 'south',
      targetMatchScore: HOKM_CONFIG.DEFAULT_MATCH_TARGET_SCORE,
    });
    const shuffling = startShufflingHand(initial, 'south');
    beginShuffleAndInitialDeal(shuffling);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Phase 2 of dealing (4 + 4 in ONE seamless continuous stream — NO mid-deal pause!):
   */
  const handleChooseTrump = useCallback(
    (suit: Suit) => {
      if (state.phase !== 'CHOOSING_TRUMP' || isDealingAnim) return;
      const runId = runIdRef.current;

      const afterTrump = chooseTrumpSuit(state, suit, state.hakem);
      hokmSound.playTrumpChosen();
      setState(afterTrump);

      schedule(
        () => {
          const {
            state: dealt13State,
            wave1Sequence,
            wave2Sequence,
          } = dealRemainingEight(afterTrump);
          setState(dealt13State);

          // Continuous 4+4 stream with ZERO pause between waves
          const continuousEightSequence = [...wave1Sequence, ...wave2Sequence];

          runDealWaveAnimation(
            continuousEightSequence,
            { south: 5, east: 5, north: 5, west: 5 },
            'wave8',
            runId,
            () => {
              setIsDealingAnim(false);
              setDealtCounts({
                south: dealt13State.hands.south.length,
                east: dealt13State.hands.east.length,
                north: dealt13State.hands.north.length,
                west: dealt13State.hands.west.length,
              });
              // Exciting non-blocking "Game Started!" burst right when play begins
              setShowGameStartBanner(true);
              hokmSound.playGameStart();
              schedule(
                () => {
                  setShowGameStartBanner(false);
                },
                1280,
                runId
              );
            }
          );
        },
        320,
        runId
      );
    },
    [isDealingAnim, runDealWaveAnimation, schedule, state]
  );

  // Automated Hakem picks trump when human is not Hakem
  useEffect(() => {
    if (
      state.phase === 'CHOOSING_TRUMP' &&
      state.hakem !== 'south' &&
      !isDealingAnim &&
      !isShufflingAnim
    ) {
      const runId = runIdRef.current;
      const timerId = schedule(
        () => {
          const randomSuit = pickRandomTrumpSuit();
          handleChooseTrump(randomSuit);
        },
        720,
        runId
      );
      return () => window.clearTimeout(timerId);
    }
  }, [
    handleChooseTrump,
    isDealingAnim,
    isShufflingAnim,
    schedule,
    state.hakem,
    state.phase,
  ]);

  const executeCardPlay = useCallback((seat: Seat, cardId: string) => {
    setState((prev) => {
      if (prev.phase !== 'PLAYING_TRICK' || prev.currentTurn !== seat) {
        return prev;
      }
      return playCard(prev, seat, cardId);
    });
    hokmSound.playCardSnap();
    if (seat === 'south') {
      setSelectedCardId(null);
      setShowGameStartBanner(false);
    }
  }, []);

  // Simulated seats play legal cards automatically
  useEffect(() => {
    if (
      state.phase !== 'PLAYING_TRICK' ||
      isDealingAnim ||
      isShufflingAnim ||
      trickCollectPhase !== 'idle' ||
      state.currentTurn === 'south'
    ) {
      return;
    }

    const runId = runIdRef.current;
    const seat = state.currentTurn;
    const timerId = schedule(
      () => {
        const chosen = pickRandomLegalCard(
          state.hands[seat],
          state.currentTrick
        );
        executeCardPlay(seat, chosen.id);
      },
      560,
      runId
    );
    return () => window.clearTimeout(timerId);
  }, [
    executeCardPlay,
    isDealingAnim,
    isShufflingAnim,
    schedule,
    state.currentTrick,
    state.currentTurn,
    state.hands,
    state.phase,
    trickCollectPhase,
  ]);

  // 3-stage smooth team-based trick collection:
  // 1) Highlight winning card (520ms)
  // 2) Stack all 4 cards neatly on top of each other at center (270ms)
  // 3) Slide stacked 4-card packet to team pile (myTeam -> South, opponentTeam -> East)
  useEffect(() => {
    if (state.phase !== 'TRICK_COMPLETE' || !state.lastCompletedTrick) {
      return;
    }

    const runId = runIdRef.current;
    const { winnerTeam } = state.lastCompletedTrick;

    schedule(
      () => {
        setCollectingWinnerTeam(winnerTeam);
        setTrickCollectPhase('stacking');
        hokmSound.playTrickGather();

        schedule(
          () => {
            setTrickCollectPhase('sliding');
            hokmSound.playTrickWin(winnerTeam === 'myTeam');

            schedule(
              () => {
                setTrickCollectPhase('idle');
                setCollectingWinnerTeam(null);
                setState((prev) => {
                  if (prev.phase !== 'TRICK_COMPLETE') return prev;
                  const collected = collectCompletedTrick(prev);
                  if (collected.phase === 'MATCH_COMPLETE') {
                    if (collected.matchWinner === 'myTeam') {
                      hokmSound.playMatchVictory();
                    } else {
                      hokmSound.playMatchDefeat();
                    }
                  } else if (collected.phase === 'HAND_COMPLETE') {
                    const isKot =
                      collected.handOutcome?.winType === 'kot' ||
                      collected.handOutcome?.winType === 'hakem_kot';
                    hokmSound.playHandFinish(Boolean(isKot));
                  }
                  return collected;
                });
              },
              400,
              runId
            );
          },
          270,
          runId
        );
      },
      520,
      runId
    );
  }, [schedule, state.lastCompletedTrick, state.phase]);

  // Seamless auto-next-hand when a hand finishes (NO modal popup between hands!)
  useEffect(() => {
    if (state.phase !== 'HAND_COMPLETE') return;
    const runId = runIdRef.current;
    const timerId = schedule(
      () => {
        const next = startNextHand(state, configuredHakem);
        beginShuffleAndInitialDeal(next);
      },
      1100,
      runId
    );
    return () => window.clearTimeout(timerId);
  }, [beginShuffleAndInitialDeal, configuredHakem, schedule, state]);

  const visibleHandCounts: Record<Seat, number> =
    isDealingAnim || isShufflingAnim
      ? dealtCounts
      : {
          south: state.hands.south.length,
          east: state.hands.east.length,
          north: state.hands.north.length,
          west: state.hands.west.length,
        };

  const canHumanPlay =
    state.phase === 'PLAYING_TRICK' &&
    state.currentTurn === 'south' &&
    !isDealingAnim &&
    !isShufflingAnim &&
    trickCollectPhase === 'idle';

  const handleSelectCard = useCallback(
    (cardId: string | null) => {
      if (!canHumanPlay) return;
      if (cardId) hokmSound.playCardSelect();
      setSelectedCardId(cardId);
    },
    [canHumanPlay]
  );

  const handleHumanPlayCard = useCallback(
    (cardId: string) => {
      if (!canHumanPlay) return;
      executeCardPlay('south', cardId);
    },
    [canHumanPlay, executeCardPlay]
  );

  const handleStartNewMatch = useCallback(() => {
    const fresh = resetMatch(
      HOKM_CONFIG.DEFAULT_MATCH_TARGET_SCORE,
      configuredHakem
    );
    beginShuffleAndInitialDeal(fresh);
  }, [beginShuffleAndInitialDeal, configuredHakem]);

  return (
    <HokmTable
      state={state}
      visibleHandCounts={visibleHandCounts}
      flyingDealCards={flyingDealCards}
      isShufflingAnim={isShufflingAnim}
      isDealingAnim={isDealingAnim}
      showGameStartBanner={showGameStartBanner}
      trickCollectPhase={trickCollectPhase}
      collectingWinnerTeam={collectingWinnerTeam}
      selectedCardId={selectedCardId}
      playerName={playerName}
      reducedMotion={reducedMotion}
      canHumanPlay={canHumanPlay}
      exitConfirmOpen={exitConfirmOpen}
      onSelectCard={handleSelectCard}
      onPlayCard={handleHumanPlayCard}
      onChooseTrump={handleChooseTrump}
      onRequestExit={handleRequestExit}
      onCancelExit={handleCancelExit}
      onConfirmExit={handleConfirmForfeitExit}
      onNewMatch={handleStartNewMatch}
    />
  );
};
