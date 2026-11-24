import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Card,
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
  resolveNextHakem,
  startNextHand,
  startShufflingHand,
} from './engine/gameEngine';
import { pickRandomLegalCard, pickRandomTrumpSuit } from './engine/simulator';
import { hokmSound } from './audio/soundEffects';
import { preloadCardArtwork } from './components/PlayingCard';
import {
  EYVAN_CLASSIC_DECK_ID,
  deckRuntime,
} from '../../platform/decks';
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
  tableSkinId?: string;
  deckId?: string;
  targetMatchScore?: number;
  soundEnabled: boolean;
  animationSpeed: AnimationSpeed;
  reducedMotionPreference: boolean;
  onToggleSound: () => void;
  onChangeAnimationSpeed: (speed: AnimationSpeed) => void;
  onBackToGames: () => void;
}

export const HokmGame: React.FC<HokmGameProps> = ({
  playerName,
  tableSkinId = 'tt-traditional',
  deckId = EYVAN_CLASSIC_DECK_ID,
  targetMatchScore = HOKM_CONFIG.DEFAULT_MATCH_TARGET_SCORE,
  soundEnabled,
  animationSpeed,
  reducedMotionPreference,
  onBackToGames,
}) => {
  const safeTargetScore = Math.max(
    1,
    Math.min(7, Math.floor(targetMatchScore) || HOKM_CONFIG.DEFAULT_MATCH_TARGET_SCORE)
  );
  const [configuredHakem] = useState<Seat>('south');
  const [state, setState] = useState<HokmState>(() =>
    createInitialMatchState({
      initialHakem: 'south',
      targetMatchScore: safeTargetScore,
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
  const [southDealCards, setSouthDealCards] = useState<Card[]>([]);
  const [southHandSorted, setSouthHandSorted] = useState(false);
  const [handGathered, setHandGathered] = useState(false);
  const [isShufflingAnim, setIsShufflingAnim] = useState(false);
  const [isDealingAnim, setIsDealingAnim] = useState(false);
  const [isSortingAnim, setIsSortingAnim] = useState(false);
  const [trickCollectPhase, setTrickCollectPhase] =
    useState<TrickCollectPhase>('idle');
  const [collectingWinnerTeam, setCollectingWinnerTeam] =
    useState<TeamId | null>(null);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [showGameStartBanner, setShowGameStartBanner] = useState(false);

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
    return () => mq.removeEventListener('change', handler);
  }, [deckId]);

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
  const southDealCardsRef = useRef<Card[]>([]);

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
   * Appends South cards strictly in raw arrival order (never sorting mid-deal).
   */
  const runDealWaveAnimation = useCallback(
    (
      dealSequence: Array<{ seat: Seat; card: Card }>,
      startingCounts: Record<Seat, number>,
      startingSouthCards: readonly Card[],
      waveTag: string,
      expectedRunId: number,
      onComplete: (finalCounts: Record<Seat, number>) => void
    ) => {
      setIsDealingAnim(true);
      const stepDelay = reducedMotionRef.current ? 12 : 108;
      const flyDuration = reducedMotionRef.current ? 50 : 295;
      const runningCounts: Record<Seat, number> = { ...startingCounts };
      const runningSouthCards: Card[] = [...startingSouthCards];
      southDealCardsRef.current = runningSouthCards;
      setSouthDealCards([...runningSouthCards]);

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
            if (entry.seat === 'south') {
              runningSouthCards.push(entry.card);
              southDealCardsRef.current = [...runningSouthCards];
              setSouthDealCards([...runningSouthCards]);
            }

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
   * Smoothly gathers the full 13-card hand to a tight stack, applies the sorted suit order
   * (Hearts -> Spades -> Diamonds -> Clubs), and fans the hand back open fluidly.
   */
  const runGatherAndSortAnimation = useCallback(
    (
      sortedSouthHand: readonly Card[],
      expectedRunId: number,
      onSortedOpen: () => void
    ) => {
      setIsSortingAnim(true);
      setHandGathered(true);
      hokmSound.playCardSelect();

      schedule(
        () => {
          const nextSorted = [...sortedSouthHand];
          southDealCardsRef.current = nextSorted;
          setSouthDealCards(nextSorted);
          schedule(
            () => {
              setHandGathered(false);
              schedule(
                () => {
                  setIsSortingAnim(false);
                  onSortedOpen();
                },
                440,
                expectedRunId
              );
            },
            130,
            expectedRunId
          );
        },
        380,
        expectedRunId
      );
    },
    [schedule]
  );

  /**
   * Phase 1 of dealing: Shuffle -> Deal 5 cards in raw arrival order (NO sorting yet) -> Wait for Trump.
   */
  const beginShuffleAndInitialDeal = useCallback(
    (shufflingState: HokmState) => {
      runIdRef.current += 1;
      const runId = runIdRef.current;
      clearAllTimers();

      setTrickCollectPhase('idle');
      setCollectingWinnerTeam(null);
      setFlyingDealCards([]);
      southDealCardsRef.current = [];
      setSouthDealCards([]);
      setSouthHandSorted(false);
      setHandGathered(false);
      setIsSortingAnim(false);
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
            [],
            'init5',
            runId,
            () => {
              setDealtCounts({
                south: dealt5State.hands.south.length,
                east: dealt5State.hands.east.length,
                north: dealt5State.hands.north.length,
                west: dealt5State.hands.west.length,
              });
              setIsDealingAnim(false);
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
      targetMatchScore: safeTargetScore,
    });
    const shuffling = startShufflingHand(initial, 'south');
    beginShuffleAndInitialDeal(shuffling);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Phase 2 of dealing (4 + 4 in ONE seamless continuous stream — NO mid-deal sorting!):
   * Appends the 8 newly dealt South cards in raw arrival order, THEN gathers & fans open sorted once.
   */
  const handleChooseTrump = useCallback(
    (suit: Suit) => {
      if (state.phase !== 'CHOOSING_TRUMP' || isDealingAnim || isSortingAnim) {
        return;
      }
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

          // Continuous 4+4 stream with ZERO pause between waves, keeping initial 5 cards unsorted
          const continuousEightSequence = [...wave1Sequence, ...wave2Sequence];
          const existingUnsortedFive =
            southDealCardsRef.current.length > 0
              ? southDealCardsRef.current
              : afterTrump.hands.south;

          runDealWaveAnimation(
            continuousEightSequence,
            { south: 5, east: 5, north: 5, west: 5 },
            existingUnsortedFive,
            'wave8',
            runId,
            () => {
              setDealtCounts({
                south: dealt13State.hands.south.length,
                east: dealt13State.hands.east.length,
                north: dealt13State.hands.north.length,
                west: dealt13State.hands.west.length,
              });
              runGatherAndSortAnimation(dealt13State.hands.south, runId, () => {
                setSouthHandSorted(true);
                setIsDealingAnim(false);
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
              });
            }
          );
        },
        320,
        runId
      );
    },
    [
      isDealingAnim,
      isSortingAnim,
      runDealWaveAnimation,
      runGatherAndSortAnimation,
      schedule,
      state,
    ]
  );

  // Automated Hakem picks trump when human is not Hakem
  useEffect(() => {
    if (
      state.phase === 'CHOOSING_TRUMP' &&
      state.hakem !== 'south' &&
      !isDealingAnim &&
      !isShufflingAnim &&
      !isSortingAnim
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
    isSortingAnim,
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
      setShowGameStartBanner(false);
    }
  }, []);

  // Simulated seats play legal cards automatically
  useEffect(() => {
    if (
      state.phase !== 'PLAYING_TRICK' ||
      isDealingAnim ||
      isShufflingAnim ||
      isSortingAnim ||
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
    isSortingAnim,
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

  // Seamless auto-next-hand after Hand-Win Celebration Animation,
  // rotating Hakem counter-clockwise to the next seat whenever the Hakem loses the hand!
  useEffect(() => {
    if (state.phase !== 'HAND_COMPLETE') return;
    const runId = runIdRef.current;
    const timerId = schedule(
      () => {
        const nextHakem = resolveNextHakem(state);
        const next = startNextHand(state, nextHakem);
        beginShuffleAndInitialDeal(next);
      },
      2100,
      runId
    );
    return () => window.clearTimeout(timerId);
  }, [beginShuffleAndInitialDeal, schedule, state]);

  const visibleHandCounts: Record<Seat, number> =
    isDealingAnim || isShufflingAnim || isSortingAnim
      ? dealtCounts
      : {
          south: state.hands.south.length,
          east: state.hands.east.length,
          north: state.hands.north.length,
          west: state.hands.west.length,
        };

  const canHumanPlay =
    southHandSorted &&
    state.phase === 'PLAYING_TRICK' &&
    state.currentTurn === 'south' &&
    !isDealingAnim &&
    !isShufflingAnim &&
    !isSortingAnim &&
    !handGathered &&
    trickCollectPhase === 'idle';

  const handleHumanPlayCard = useCallback(
    (cardId: string) => {
      if (!canHumanPlay) return;
      executeCardPlay('south', cardId);
    },
    [canHumanPlay, executeCardPlay]
  );

  const handleStartNewMatch = useCallback(() => {
    const fresh = resetMatch(safeTargetScore, configuredHakem);
    beginShuffleAndInitialDeal(fresh);
  }, [beginShuffleAndInitialDeal, configuredHakem, safeTargetScore]);

  return (
    <HokmTable
      state={state}
      visibleHandCounts={visibleHandCounts}
      flyingDealCards={flyingDealCards}
      isShufflingAnim={isShufflingAnim}
      isDealingAnim={isDealingAnim}
      southHandOverride={
        isDealingAnim || isSortingAnim || handGathered || !southHandSorted
          ? southDealCards
          : undefined
      }
      handGathered={handGathered}
      showGameStartBanner={showGameStartBanner}
      trickCollectPhase={trickCollectPhase}
      collectingWinnerTeam={collectingWinnerTeam}
      playerName={playerName}
      tableSkinId={tableSkinId}
      deckId={deckId}
      reducedMotion={reducedMotion}
      canHumanPlay={canHumanPlay}
      exitConfirmOpen={exitConfirmOpen}
      onPlayCard={handleHumanPlayCard}
      onChooseTrump={handleChooseTrump}
      onRequestExit={handleRequestExit}
      onCancelExit={handleCancelExit}
      onConfirmExit={handleConfirmForfeitExit}
      onNewMatch={handleStartNewMatch}
    />
  );
};
