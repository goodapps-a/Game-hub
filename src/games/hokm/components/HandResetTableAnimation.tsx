import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Card, HandOutcome, Seat, TeamId } from '../engine/types';
import { toPersianDigits } from '../../../platform/theme/tokens';
import { PlayingCard } from './PlayingCard';
import { hokmSound } from '../audio/soundEffects';

interface HandResetTableAnimationProps {
  outcome: HandOutcome;
  remainingHands: Record<Seat, readonly Card[]>;
  seatDeckMap: Record<Seat, string>;
  seatCardBackMap: Record<Seat, string | undefined>;
  targetScoreRect: { x: number; y: number } | null;
  reducedMotion: boolean;
  onScoreLanded?: (winnerTeam: TeamId) => void;
}

interface ThrownCardSpec {
  readonly id: string;
  readonly seat: Seat;
  readonly card?: Card;
  readonly faceDown: boolean;
  readonly fromX: number;
  readonly fromY: number;
  readonly fromRot: number;
  readonly slideX: number;
  readonly slideY: number;
  readonly slideRot: number;
  readonly delay: number;
  readonly riffleSide: -1 | 1;
}

// Deterministic pseudo-random helper so every hand's toss looks organic yet glitch-free
function seededNoise(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const SEAT_ORIGINS: Record<
  Seat,
  { x: number; y: number; baseRot: number; seatDelay: number; spreadAxis: 'x' | 'y' }
> = {
  south: { x: 0, y: 270, baseRot: 0, seatDelay: 0.0, spreadAxis: 'x' },
  east: { x: 255, y: -10, baseRot: 82, seatDelay: 0.11, spreadAxis: 'y' },
  north: { x: 0, y: -255, baseRot: 178, seatDelay: 0.21, spreadAxis: 'x' },
  west: { x: -255, y: 6, baseRot: -84, seatDelay: 0.3, spreadAxis: 'y' },
};

function buildQuadraticBezierSamples(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  steps = 10
): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const rawT = i / steps;
    // Smooth ease-in-out curve progression along the arc
    const t = rawT < 0.5 ? 2 * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 2) / 2;
    const inv = 1 - t;
    xs.push(inv * inv * x0 + 2 * inv * t * cx + t * t * x1);
    ys.push(inv * inv * y0 + 2 * inv * t * cy + t * t * y1);
  }
  return { xs, ys };
}

type ResetStage = 'scatter' | 'gather' | 'shuffle';

export const HandResetTableAnimation: React.FC<HandResetTableAnimationProps> = ({
  outcome,
  remainingHands,
  seatDeckMap,
  seatCardBackMap,
  targetScoreRect,
  reducedMotion,
  onScoreLanded,
}) => {
  const [stage, setStage] = useState<ResetStage>('scatter');
  const isMyWin = outcome.winningTeam === 'myTeam';

  // Build authentic thrown cards: EVERY unplayed remaining card from all 4 seats + collected pile cards
  const thrownCards = useMemo<readonly ThrownCardSpec[]>(() => {
    const list: ThrownCardSpec[] = [];
    const seats: Seat[] = ['south', 'east', 'north', 'west'];
    let seed =
      outcome.finalTricks.myTeam * 31 + outcome.finalTricks.opponentTeam * 17 + 7;

    seats.forEach((seat) => {
      const origin = SEAT_ORIGINS[seat];
      const hand = remainingHands[seat] ?? [];
      // Ensure every seat tosses at least 3 cards (their unplayed cards + their collected trick cards)
      const visualCount = Math.max(hand.length, 3);
      const cappedCount = Math.min(visualCount, 6);

      for (let i = 0; i < cappedCount; i++) {
        seed += 1;
        const r1 = seededNoise(seed);
        const r2 = seededNoise(seed + 19);
        const r3 = seededNoise(seed + 43);
        const cardObj = hand[i];
        const norm = cappedCount <= 1 ? 0 : (i / (cappedCount - 1)) * 2 - 1;

        const fromX =
          origin.spreadAxis === 'x'
            ? origin.x + norm * 74
            : origin.x + (r1 - 0.5) * 18;
        const fromY =
          origin.spreadAxis === 'y'
            ? origin.y + norm * 62
            : origin.y + (r1 - 0.5) * 18;

        // Cards slide naturally onto the central felt with organic human scatter & momentum
        const biasX =
          seat === 'east' ? 18 : seat === 'west' ? -18 : norm * 32;
        const biasY =
          seat === 'south' ? 18 : seat === 'north' ? -20 : norm * 24;
        const slideX = biasX + (r1 - 0.5) * 105;
        const slideY = biasY + (r2 - 0.5) * 86;
        const spinDrift = (r3 - 0.5) * 115;

        list.push({
          id: `throw-${seat}-${cardObj?.id ?? i}`,
          seat,
          card: cardObj,
          // South's unplayed remaining cards are tossed face-up onto the felt like real Hokm!
          faceDown: !(seat === 'south' && Boolean(cardObj)),
          fromX,
          fromY,
          fromRot: origin.baseRot + norm * 16,
          slideX,
          slideY,
          slideRot: origin.baseRot * 0.25 + spinDrift,
          // Authentic staggered human reaction + flick cadence
          delay: origin.seatDelay + i * (0.048 + r2 * 0.022),
          riffleSide: list.length % 2 === 0 ? -1 : 1,
        });
      }
    });

    return list;
  }, [outcome.finalTricks.myTeam, outcome.finalTricks.opponentTeam, remainingHands]);

  useEffect(() => {
    hokmSound.playCardScatter();

    const tScoreLand = window.setTimeout(() => {
      hokmSound.playScoreOrbLand(isMyWin);
      onScoreLanded?.(outcome.winningTeam);
    }, reducedMotion ? 160 : 720);

    const tGather = window.setTimeout(() => {
      setStage('gather');
      hokmSound.playTrickGather();
    }, reducedMotion ? 240 : 1080);

    const tShuffle = window.setTimeout(() => {
      setStage('shuffle');
      hokmSound.playShuffle();
    }, reducedMotion ? 440 : 1620);

    return () => {
      window.clearTimeout(tScoreLand);
      window.clearTimeout(tGather);
      window.clearTimeout(tShuffle);
    };
  }, [isMyWin, onScoreLanded, outcome.winningTeam, reducedMotion]);

  // Smooth quadratic Bézier trajectory from table center to the winning team's match score box
  const centerX = typeof window !== 'undefined' ? window.innerWidth / 2 : 0;
  const centerY = typeof window !== 'undefined' ? window.innerHeight * 0.48 : 0;
  const scoreDx = targetScoreRect
    ? targetScoreRect.x - centerX
    : isMyWin
      ? 92
      : -92;
  const scoreDy = targetScoreRect
    ? targetScoreRect.y - centerY
    : -Math.min(280, centerY * 0.85);
  const badgeArc = useMemo(
    () =>
      buildQuadraticBezierSamples(
        0,
        0,
        scoreDx * 0.35 + (isMyWin ? 24 : -24),
        scoreDy * 0.46 - 28,
        scoreDx,
        scoreDy,
        10
      ),
    [isMyWin, scoreDx, scoreDy]
  );

  const pointsText = `+${toPersianDigits(outcome.pointsAwarded)}`;

  return (
    <div
      data-testid="hand-reset-table-animation"
      className="fixed inset-0 z-[44] pointer-events-none flex items-center justify-center overflow-hidden"
      aria-hidden="true"
    >
      {/* Realistic 4-Seat Staggered Card Toss & Felt Slide -> Sweep Together -> Riffle Shuffle */}
      <div className="relative w-0 h-0">
        {thrownCards.map((c, idx) => {
          const stackOffset = (idx - thrownCards.length / 2) * 0.4;
          const animateTarget =
            stage === 'scatter'
              ? {
                  x: c.slideX,
                  y: c.slideY,
                  rotate: c.slideRot,
                  scale: 1,
                }
              : stage === 'gather'
                ? {
                    x: stackOffset,
                    y: -idx * 0.4,
                    rotate: ((idx % 3) - 1) * 1.4,
                    scale: 0.94,
                  }
                : {
                    x: [
                      stackOffset,
                      c.riffleSide * 38,
                      stackOffset,
                      -c.riffleSide * 28,
                      stackOffset,
                    ],
                    y: [
                      -idx * 0.4,
                      -idx * 0.45 - 4,
                      -idx * 0.4,
                      -idx * 0.4,
                      -idx * 0.4,
                    ],
                    rotate: [0, c.riffleSide * 7, 0, -c.riffleSide * 5, 0],
                    scale: 0.94,
                  };

          return (
            <motion.div
              key={c.id}
              initial={{
                x: c.fromX,
                y: c.fromY,
                rotate: c.fromRot,
                scale: 0.92,
              }}
              animate={animateTarget}
              transition={
                stage === 'scatter'
                  ? {
                      duration: reducedMotion ? 0.16 : 0.56,
                      delay: reducedMotion ? 0 : c.delay,
                      // Fast human toss deceleration sliding smoothly to rest on felt
                      ease: [0.12, 0.92, 0.24, 1],
                    }
                  : stage === 'gather'
                    ? {
                        duration: reducedMotion ? 0.16 : 0.44,
                        delay: reducedMotion ? 0 : idx * 0.012,
                        ease: [0.22, 1, 0.36, 1],
                      }
                    : {
                        duration: reducedMotion ? 0.2 : 0.62,
                        ease: 'easeInOut',
                      }
              }
              className="absolute -translate-x-1/2 -translate-y-1/2 will-change-transform"
              style={{ zIndex: idx + 1 }}
            >
              <PlayingCard
                card={c.faceDown ? undefined : c.card}
                faceDown={c.faceDown}
                size="sm"
                deckId={seatDeckMap[c.seat]}
                cardBackId={seatCardBackMap[c.seat]}
                className="shadow-[0_6px_16px_rgba(0,0,0,0.45)]"
              />
            </motion.div>
          );
        })}
      </div>

      {/* Glowing flying match score badge (+1 / +2 / +3) soaring smoothly into scoreboard */}
      <motion.div
        data-testid="flying-match-score-badge"
        initial={{
          x: 0,
          y: 0,
          scale: 0.45,
          opacity: 0,
        }}
        animate={{
          x: badgeArc.xs,
          y: badgeArc.ys,
          scale: [0.45, 1.45, 1.32, 1.15, 0.95, 0.72, 0.52, 0.38, 0.28, 0.2, 0.15],
          opacity: [0, 1, 1, 1, 1, 1, 1, 0.92, 0.75, 0.35, 0],
        }}
        transition={{
          duration: reducedMotion ? 0.24 : 0.78,
          ease: 'linear',
        }}
        className="absolute left-1/2 top-[48%] -translate-x-1/2 -translate-y-1/2 z-[55]"
      >
        <div
          className={`px-4 py-2 rounded-full border-2 font-black text-2xl sm:text-3xl tabular-nums shadow-2xl ${
            isMyWin
              ? 'bg-gradient-to-b from-[#FEF08A] via-[#F3D179] to-[#D97706] border-[#FFFBEB] text-[#0A1815] shadow-[0_0_38px_rgba(243,209,121,0.95)]'
              : 'bg-gradient-to-b from-[#FCA5A5] via-[#EF4444] to-[#991B1B] border-[#FEE2E2] text-white shadow-[0_0_38px_rgba(239,68,68,0.9)]'
          }`}
        >
          {pointsText}
        </div>
      </motion.div>
    </div>
  );
};
