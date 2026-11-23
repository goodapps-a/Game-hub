import React from 'react';
import { motion } from 'motion/react';
import { Crown, Flame, Sparkles, Trophy } from 'lucide-react';
import { HandOutcome, TeamId } from '../engine/types';
import { getHandWinTypeLabel } from '../engine/scoring';
import { toPersianDigits } from '../../../platform/theme/tokens';
import { SuitIconSvg } from './PlayingCard';

interface HandWinCelebrationProps {
  outcome: HandOutcome;
  matchScores: Record<TeamId, number>;
  nextHakemName?: string | null;
  hakemChanged?: boolean;
  reducedMotion?: boolean;
}

const BURST_PARTICLES = Array.from({ length: 18 }, (_, i) => {
  const angle = (i / 18) * Math.PI * 2;
  const radius = 115 + (i % 3) * 38;
  return {
    id: i,
    tx: Math.round(Math.cos(angle) * radius),
    ty: Math.round(Math.sin(angle) * radius),
    rot: (i % 2 === 0 ? 1 : -1) * (140 + (i % 4) * 55),
    size: 7 + (i % 3) * 3,
    delay: (i % 5) * 0.03,
    kind: i % 3 === 0 ? 'diamond' : i % 3 === 1 ? 'ribbon' : 'dot',
  };
});

/**
 * High-energy, GPU-composited celebration animation triggered whenever a hand
 * (7 tricks) is won — with amplified golden/royal choreography for Kot & Hakem-Kot!
 */
export const HandWinCelebration: React.FC<HandWinCelebrationProps> = ({
  outcome,
  matchScores,
  nextHakemName,
  hakemChanged = false,
  reducedMotion = false,
}) => {
  const isMyWin = outcome.winningTeam === 'myTeam';
  const isKot = outcome.winType === 'kot';
  const isHakemKot = outcome.winType === 'hakem_kot';
  const isSpecial = isKot || isHakemKot;
  const winMeta = getHandWinTypeLabel(outcome.winType);

  const primaryColors = isMyWin
    ? ['#FDE68A', '#F3D179', '#34D399', '#2DD4BF']
    : ['#FCA5A5', '#FB7185', '#F3D179', '#F59E0B'];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0.06 : 0.22 }}
      data-testid="hand-win-celebration"
      data-winning-team={outcome.winningTeam}
      data-win-type={outcome.winType}
      className="fixed inset-0 z-40 pointer-events-none flex items-center justify-center p-4 overflow-hidden select-none"
    >
      {/* Subtle atmospheric focus vignette */}
      <div
        className="absolute inset-0"
        style={{
          background: isMyWin
            ? 'radial-gradient(circle at 50% 48%, rgba(16, 85, 62, 0.34) 0%, rgba(4, 16, 13, 0.56) 65%, rgba(2, 10, 8, 0.72) 100%)'
            : 'radial-gradient(circle at 50% 48%, rgba(92, 22, 34, 0.32) 0%, rgba(12, 8, 14, 0.56) 65%, rgba(4, 6, 10, 0.72) 100%)',
        }}
        aria-hidden="true"
      />

      {/* Rotating Radial Golden Rays */}
      {!reducedMotion && (
        <motion.div
          initial={{ scale: 0.4, opacity: 0, rotate: 0 }}
          animate={{ scale: 1.15, opacity: isSpecial ? 0.55 : 0.36, rotate: 55 }}
          exit={{ opacity: 0, scale: 1.3 }}
          transition={{ duration: 1.9, ease: 'easeOut' }}
          className="absolute w-[460px] h-[460px] sm:w-[580px] sm:h-[580px]"
          style={{
            background: isMyWin
              ? 'repeating-conic-gradient(from 0deg, rgba(243,209,121,0.45) 0deg 9deg, transparent 9deg 22.5deg)'
              : 'repeating-conic-gradient(from 0deg, rgba(251,113,133,0.36) 0deg 9deg, transparent 9deg 22.5deg)',
            maskImage:
              'radial-gradient(circle, rgba(0,0,0,1) 0%, rgba(0,0,0,0.4) 42%, transparent 70%)',
            WebkitMaskImage:
              'radial-gradient(circle, rgba(0,0,0,1) 0%, rgba(0,0,0,0.4) 42%, transparent 70%)',
          }}
          aria-hidden="true"
        />
      )}

      {/* Twin Expanding Shockwave Rings */}
      {!reducedMotion && (
        <>
          <motion.div
            initial={{ scale: 0.35, opacity: 0.95 }}
            animate={{ scale: 2.35, opacity: 0 }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute w-36 h-36 rounded-full border-[3px] ${
              isMyWin
                ? 'border-[#F3D179] shadow-[0_0_28px_rgba(243,209,121,0.8)]'
                : 'border-[#FB7185] shadow-[0_0_24px_rgba(251,113,133,0.7)]'
            }`}
            aria-hidden="true"
          />
          <motion.div
            initial={{ scale: 0.45, opacity: 0.85 }}
            animate={{ scale: 2.75, opacity: 0 }}
            transition={{ duration: 1.15, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute w-36 h-36 rounded-full border-2 ${
              isMyWin ? 'border-[#34D399]/80' : 'border-[#F59E0B]/70'
            }`}
            aria-hidden="true"
          />
        </>
      )}

      {/* Radial Burst Particles (Sparkles, Confetti Ribbons, Diamonds) */}
      {!reducedMotion && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          aria-hidden="true"
        >
          {BURST_PARTICLES.map((p) => {
            const color = primaryColors[p.id % primaryColors.length];
            return (
              <motion.span
                key={p.id}
                initial={{ x: 0, y: 0, scale: 0.2, opacity: 1, rotate: 0 }}
                animate={{
                  x: p.tx,
                  y: p.ty,
                  scale: [0.3, 1.2, 0.85, 0],
                  opacity: [0, 1, 1, 0],
                  rotate: p.rot,
                }}
                transition={{
                  duration: isSpecial ? 1.55 : 1.25,
                  delay: p.delay,
                  ease: [0.16, 1, 0.3, 1],
                }}
                style={{
                  width: p.kind === 'ribbon' ? p.size * 0.65 : p.size,
                  height: p.kind === 'ribbon' ? p.size * 1.65 : p.size,
                  backgroundColor: color,
                  boxShadow: `0 0 10px ${color}`,
                }}
                className={`absolute ${
                  p.kind === 'dot'
                    ? 'rounded-full'
                    : p.kind === 'diamond'
                      ? 'rotate-45 rounded-[2px]'
                      : 'rounded-[2px]'
                }`}
              />
            );
          })}
        </div>
      )}

      {/* Center Celebration Crest Card */}
      <motion.div
        initial={
          reducedMotion
            ? { opacity: 1 }
            : { opacity: 0, scale: 0.62, y: 18 }
        }
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={
          reducedMotion
            ? { opacity: 0 }
            : { opacity: 0, scale: 1.08, y: -12 }
        }
        transition={
          reducedMotion
            ? { duration: 0.08 }
            : { type: 'spring', stiffness: 310, damping: 20 }
        }
        className={`relative z-10 w-full max-w-[340px] sm:max-w-[390px] rounded-[28px] border-2 px-5 py-5 sm:px-7 sm:py-6 text-center backdrop-blur-xl ${
          isMyWin
            ? 'bg-gradient-to-b from-[#0F3A2E]/96 via-[#09241D]/96 to-[#051512]/98 border-[#F3D179] shadow-[0_24px_70px_rgba(0,0,0,0.72),0_0_48px_rgba(243,209,121,0.36)]'
            : 'bg-gradient-to-b from-[#3A1520]/96 via-[#200C14]/96 to-[#11070C]/98 border-[#FB7185]/80 shadow-[0_24px_70px_rgba(0,0,0,0.72),0_0_38px_rgba(251,113,133,0.28)]'
        }`}
      >
        {/* Top Emblem + Points Surge */}
        <div className="flex items-center justify-center gap-3">
          <motion.div
            initial={reducedMotion ? false : { scale: 0.4, rotate: -20 }}
            animate={
              reducedMotion
                ? { scale: 1 }
                : { scale: [0.4, 1.16, 1], rotate: [0, -6, 6, 0] }
            }
            transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
            className={`w-14 h-14 sm:w-16 sm:h-16 rounded-2xl border-2 flex items-center justify-center shadow-xl ${
              isMyWin
                ? 'bg-gradient-to-b from-[#FCE29B] via-[#E5B84B] to-[#A6781E] border-[#FFF5D6] text-[#1A1104]'
                : 'bg-gradient-to-b from-[#7F1D1D] to-[#450A0A] border-[#FCA5A5]/65 text-[#FFE4E6]'
            }`}
          >
            {isHakemKot ? (
              <Flame className="w-8 h-8 stroke-[2.3]" />
            ) : isMyWin ? (
              <Trophy className="w-8 h-8 stroke-[2.2]" />
            ) : (
              <Crown className="w-8 h-8" />
            )}
          </motion.div>

          <motion.div
            initial={reducedMotion ? false : { scale: 0.5, x: -12, opacity: 0 }}
            animate={{ scale: 1, x: 0, opacity: 1 }}
            transition={{ delay: 0.12, type: 'spring', stiffness: 360, damping: 18 }}
            className={`px-3.5 py-1.5 rounded-2xl border text-lg sm:text-xl font-black tabular-nums ${
              isMyWin
                ? 'bg-[#F3D179]/20 border-[#F3D179]/80 text-[#FDE68A]'
                : 'bg-[#FB7185]/18 border-[#FB7185]/70 text-[#FECDD3]'
            }`}
          >
            +{toPersianDigits(outcome.pointsAwarded)} امتیاز
          </motion.div>
        </div>

        {/* Title & Special Win Label */}
        <div className="mt-3.5 space-y-1">
          <div className="inline-flex items-center justify-center gap-1.5">
            {isSpecial && (
              <Sparkles className="w-4 h-4 text-[#F3D179] shrink-0" />
            )}
            <h3
              className={`text-xl sm:text-2xl font-black tracking-tight ${
                isMyWin
                  ? 'bg-gradient-to-b from-[#FFF7D6] via-[#F3D179] to-[#D4A039] bg-clip-text text-transparent'
                  : 'text-[#FFE4E6]'
              }`}
            >
              {isSpecial
                ? `${winMeta.title} ${isMyWin ? 'تیم شما برد!' : 'تیم حریف برد!'}`
                : isMyWin
                  ? 'این دست مال شماست!'
                  : 'دست به سود حریف شد'}
            </h3>
          </div>

          <p
            className={`text-xs font-bold tabular-nums ${
              isMyWin ? 'text-[#A7F3D0]' : 'text-[#FDA4AF]'
            }`}
          >
            نتیجه دست: {toPersianDigits(outcome.finalTricks.myTeam)} بر{' '}
            {toPersianDigits(outcome.finalTricks.opponentTeam)}
          </p>
        </div>

        {/* Score Surge Bar */}
        <div className="mt-4 rounded-2xl bg-black/32 border border-[#D4AE58]/35 px-4 py-2.5 flex items-center justify-between gap-2">
          <div className="flex-1 text-center">
            <div className="text-[10px] font-bold text-[#6EE7B7]">تیم ما</div>
            <div className="text-2xl font-black text-white tabular-nums">
              {toPersianDigits(matchScores.myTeam)}
            </div>
          </div>

          <span className="w-9 h-9 rounded-full bg-white border-2 border-[#F3D179] flex items-center justify-center shadow-md shrink-0">
            <SuitIconSvg suit={outcome.trumpSuit} className="w-5 h-5" />
          </span>

          <div className="flex-1 text-center">
            <div className="text-[10px] font-bold text-[#FCA5A5]">حریف</div>
            <div className="text-2xl font-black text-white tabular-nums">
              {toPersianDigits(matchScores.opponentTeam)}
            </div>
          </div>
        </div>

        {/* Hakem Rotation Notice */}
        {nextHakemName && (
          <div className="mt-3 inline-flex items-center justify-center gap-1.5 text-[11px] font-extrabold text-[#FDE68A]/95">
            <Crown className="w-3.5 h-3.5 text-[#F3D179] fill-[#F3D179] shrink-0" />
            <span>
              {hakemChanged
                ? `حاکم تغییر کرد · حاکم دست بعد: ${nextHakemName}`
                : `حاکم دست بعد: ${nextHakemName}`}
            </span>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};
