import React from 'react';
import { motion } from 'motion/react';
import { Crown, Home, RotateCcw, Sparkles, Star, Trophy } from 'lucide-react';
import { HandOutcome, TeamId } from '../engine/types';
import { getHandWinTypeLabel } from '../engine/scoring';
import { toPersianDigits } from '../../../platform/theme/tokens';
import { SuitIconSvg } from './PlayingCard';

interface HandResultModalProps {
  outcome: HandOutcome;
  matchScores: Record<TeamId, number>;
  targetMatchScore: number;
  matchWinner: TeamId;
  onNewMatch: () => void;
  onBackToMenu: () => void;
  reducedMotion?: boolean;
}

const CONFETTI_PIECES = [
  { id: 1, x: '8%', color: '#F3D179', size: 10, delay: 0.0, duration: 2.8, rot: 220 },
  { id: 2, x: '15%', color: '#34D399', size: 8, delay: 0.35, duration: 3.1, rot: -180 },
  { id: 3, x: '22%', color: '#FDE68A', size: 12, delay: 0.15, duration: 2.6, rot: 300 },
  { id: 4, x: '30%', color: '#14B8A6', size: 9, delay: 0.6, duration: 3.2, rot: -260 },
  { id: 5, x: '38%', color: '#F59E0B', size: 11, delay: 0.25, duration: 2.9, rot: 190 },
  { id: 6, x: '46%', color: '#FAF6EE', size: 8, delay: 0.45, duration: 2.7, rot: -220 },
  { id: 7, x: '54%', color: '#F3D179', size: 13, delay: 0.1, duration: 3.0, rot: 280 },
  { id: 8, x: '62%', color: '#34D399', size: 9, delay: 0.55, duration: 2.8, rot: -195 },
  { id: 9, x: '70%', color: '#FBBF24', size: 11, delay: 0.2, duration: 3.3, rot: 240 },
  { id: 10, x: '78%', color: '#2DD4BF', size: 8, delay: 0.5, duration: 2.7, rot: -310 },
  { id: 11, x: '86%', color: '#F3D179', size: 12, delay: 0.3, duration: 2.9, rot: 210 },
  { id: 12, x: '93%', color: '#FDE68A', size: 9, delay: 0.65, duration: 3.1, rot: -250 },
  { id: 13, x: '19%', color: '#F59E0B', size: 7, delay: 0.9, duration: 2.9, rot: 330 },
  { id: 14, x: '42%', color: '#34D399', size: 10, delay: 1.05, duration: 3.0, rot: -280 },
  { id: 15, x: '66%', color: '#FAF6EE', size: 8, delay: 0.85, duration: 2.6, rot: 260 },
  { id: 16, x: '82%', color: '#F3D179', size: 10, delay: 1.15, duration: 3.2, rot: -210 },
];

const SPARKLE_STARS = [
  { id: 1, top: '12%', left: '14%', delay: 0.1, size: 18 },
  { id: 2, top: '18%', right: '14%', delay: 0.4, size: 22 },
  { id: 3, top: '44%', left: '8%', delay: 0.7, size: 15 },
  { id: 4, top: '42%', right: '9%', delay: 0.25, size: 16 },
  { id: 5, bottom: '20%', left: '16%', delay: 0.55, size: 14 },
  { id: 6, bottom: '18%', right: '15%', delay: 0.85, size: 18 },
];

/**
 * Full-screen celebratory Match End / Victory Experience (first to 3 hands).
 * Never shown between intermediate hands — only when the match finishes at 3!
 */
export const HandResultModal: React.FC<HandResultModalProps> = ({
  outcome,
  matchScores,
  targetMatchScore,
  matchWinner,
  onNewMatch,
  onBackToMenu,
  reducedMotion = false,
}) => {
  const isVictory = matchWinner === 'myTeam';
  const winLabel = getHandWinTypeLabel(outcome.winType);
  const isSpecialKot =
    outcome.winType === 'kot' || outcome.winType === 'hakem_kot';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0.08 : 0.3 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-hidden select-none"
      style={{
        background: isVictory
          ? 'radial-gradient(ellipse at 50% 42%, rgba(18, 72, 56, 0.92) 0%, rgba(7, 26, 22, 0.96) 55%, rgba(3, 12, 10, 0.98) 100%)'
          : 'radial-gradient(ellipse at 50% 42%, rgba(62, 18, 26, 0.9) 0%, rgba(16, 12, 18, 0.96) 60%, rgba(6, 8, 12, 0.98) 100%)',
      }}
      role="dialog"
      aria-modal="true"
      aria-label={isVictory ? 'تبریک پیروزی در مسابقه حکم' : 'پایان مسابقه حکم'}
      data-testid="match-result-screen"
      data-match-winner={matchWinner}
    >
      {/* Victory Rotating Golden Sunburst Rays */}
      {isVictory && (
        <motion.div
          animate={reducedMotion ? undefined : { rotate: 360 }}
          transition={{ duration: 28, repeat: Infinity, ease: 'linear' }}
          className="pointer-events-none absolute w-[150vmax] h-[150vmax] opacity-30"
          style={{
            background:
              'repeating-conic-gradient(from 0deg, rgba(243,209,121,0.34) 0deg 10deg, transparent 10deg 24deg)',
            maskImage:
              'radial-gradient(circle, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.25) 45%, transparent 70%)',
            WebkitMaskImage:
              'radial-gradient(circle, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.25) 45%, transparent 70%)',
          }}
          aria-hidden="true"
        />
      )}

      {/* Victory Falling Confetti Shower */}
      {isVictory && !reducedMotion && (
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden"
          aria-hidden="true"
        >
          {CONFETTI_PIECES.map((piece) => (
            <motion.span
              key={piece.id}
              initial={{ y: '-12vh', opacity: 0, rotate: 0 }}
              animate={{
                y: '112vh',
                opacity: [0, 1, 1, 0.7, 0],
                rotate: piece.rot,
                x: [0, piece.id % 2 === 0 ? 22 : -22, 0],
              }}
              transition={{
                duration: piece.duration,
                delay: piece.delay,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
              style={{
                left: piece.x,
                width: piece.size,
                height: piece.size * 1.45,
                backgroundColor: piece.color,
              }}
              className="absolute top-0 rounded-[3px] shadow-[0_0_10px_rgba(243,209,121,0.55)]"
            />
          ))}
        </div>
      )}

      {/* Victory Twinkling Stars */}
      {isVictory && !reducedMotion && (
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          {SPARKLE_STARS.map((s) => (
            <motion.div
              key={s.id}
              style={{
                top: s.top,
                left: s.left,
                right: s.right,
                bottom: s.bottom,
              }}
              animate={{
                scale: [0.6, 1.35, 0.6],
                opacity: [0.25, 1, 0.25],
                rotate: [0, 25, 0],
              }}
              transition={{
                duration: 2.1,
                delay: s.delay,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
              className="absolute text-[#F8DD94]"
            >
              <Star
                style={{ width: s.size, height: s.size }}
                className="fill-[#F3D179] drop-shadow-[0_0_10px_rgba(243,209,121,0.85)]"
              />
            </motion.div>
          ))}
        </div>
      )}

      {/* Main Celebration Card */}
      <motion.div
        initial={
          reducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.78, y: 26 }
        }
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={
          reducedMotion
            ? { duration: 0.08 }
            : { type: 'spring', stiffness: 260, damping: 20 }
        }
        className={`relative z-10 w-full max-w-md rounded-[32px] border-2 p-6 sm:p-8 text-center backdrop-blur-xl ${
          isVictory
            ? 'bg-gradient-to-b from-[#0E342A]/95 via-[#09231D]/96 to-[#051411]/98 border-[#F3D179] shadow-[0_32px_90px_rgba(0,0,0,0.75),0_0_60px_rgba(243,209,121,0.32)]'
            : 'bg-gradient-to-b from-[#2A131A]/95 via-[#180C12]/96 to-[#0E080D]/98 border-[#D4AE58]/55 shadow-[0_32px_90px_rgba(0,0,0,0.75)]'
        }`}
      >
        {/* Animated Trophy / Crown Centerpiece */}
        <div className="relative mx-auto w-28 h-28 flex items-center justify-center">
          {isVictory && !reducedMotion && (
            <>
              <motion.div
                animate={{ scale: [1, 1.38, 1], opacity: [0.55, 0, 0.55] }}
                transition={{
                  duration: 2.1,
                  repeat: Infinity,
                  ease: 'easeOut',
                }}
                className="absolute inset-0 rounded-full border-2 border-[#F3D179]/75"
              />
              <motion.div
                animate={{ scale: [0.95, 1.15, 0.95], opacity: [0.4, 0.75, 0.4] }}
                transition={{
                  duration: 2.4,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
                className="absolute -inset-3 rounded-full bg-[#F3D179]/24 blur-xl"
              />
            </>
          )}

          <motion.div
            initial={
              reducedMotion ? false : { scale: 0.4, rotate: -18, y: 12 }
            }
            animate={
              reducedMotion
                ? { scale: 1 }
                : { scale: 1, rotate: [0, -5, 5, 0], y: 0 }
            }
            transition={{
              scale: { type: 'spring', stiffness: 320, damping: 16, delay: 0.1 },
              rotate: { duration: 0.9, delay: 0.35, ease: 'easeInOut' },
            }}
            className={`relative w-24 h-24 rounded-full flex items-center justify-center border-[3px] shadow-2xl ${
              isVictory
                ? 'bg-gradient-to-b from-[#FCE29B] via-[#E5B84B] to-[#A6781E] border-[#FFF5D6] text-[#1C1204] shadow-[0_12px_36px_rgba(243,209,121,0.55)]'
                : 'bg-gradient-to-b from-[#4B1D26] to-[#270E14] border-[#FCA5A5]/45 text-[#FCA5A5]'
            }`}
          >
            {isVictory ? (
              <Trophy className="w-12 h-12 stroke-[2.2]" />
            ) : (
              <Crown className="w-11 h-11 opacity-85" />
            )}
          </motion.div>

          {isVictory && (
            <motion.div
              initial={reducedMotion ? false : { opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.35, type: 'spring', stiffness: 400 }}
              className="absolute -top-1 -right-1 w-9 h-9 rounded-full bg-[#0C352C] border-2 border-[#F3D179] flex items-center justify-center text-[#F3D179] shadow-lg"
            >
              <Sparkles className="w-4 h-4" />
            </motion.div>
          )}
        </div>

        {/* Headline */}
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, duration: 0.35 }}
          className="mt-4 space-y-1.5"
        >
          <h2
            className={`text-2xl sm:text-3xl font-black tracking-tight ${
              isVictory
                ? 'bg-gradient-to-b from-[#FFF5D6] via-[#F3D179] to-[#D4A039] bg-clip-text text-transparent drop-shadow-[0_2px_10px_rgba(243,209,121,0.35)]'
                : 'text-[#FFE4E6]'
            }`}
          >
            {isVictory ? 'تبریک! برنده بازی شدید!' : 'مسابقه به پایان رسید'}
          </h2>
          <p
            className={`text-xs sm:text-sm font-semibold ${
              isVictory ? 'text-[#A7F3D0]' : 'text-[#FDA4AF]/90'
            }`}
          >
            {isVictory
              ? `تیم شما با کسب ${toPersianDigits(targetMatchScore)} امتیاز قهرمان میز حکم شد`
              : 'این دور به سود تیم مقابل پایان یافت — دست بعدی را ببرید!'}
          </p>
        </motion.div>

        {/* Special Kot / Hakem-Kot Badge when final hand was a Kot */}
        {isSpecialKot && (
          <motion.div
            initial={reducedMotion ? false : { scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.28 }}
            className="mt-3 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#F3D179]/20 border border-[#F3D179]/75 text-[#FDE68A] text-xs font-extrabold"
          >
            <Crown className="w-3.5 h-3.5 fill-current" />
            <span>{winLabel.title}</span>
          </motion.div>
        )}

        {/* Scoreboard Summary Card */}
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.25, duration: 0.32 }}
          className="mt-6 rounded-2xl bg-black/32 border border-[#D4AE58]/40 p-4 flex items-center justify-between gap-3"
        >
          <div className="flex-1 text-center">
            <div className="text-xs font-bold text-[#6EE7B7]">تیم ما</div>
            <div
              className={`text-3xl sm:text-4xl font-black tabular-nums mt-1 ${
                isVictory ? 'text-[#F3D179]' : 'text-white'
              }`}
            >
              {toPersianDigits(matchScores.myTeam)}
            </div>
          </div>

          <div className="flex flex-col items-center gap-1.5 px-2">
            <span className="w-10 h-10 rounded-full bg-white border-2 border-[#F3D179] flex items-center justify-center shadow-md">
              <SuitIconSvg suit={outcome.trumpSuit} className="w-5 h-5" />
            </span>
            <span className="text-[10px] font-bold text-[#D4AE58]/85 tabular-nums">
              از {toPersianDigits(targetMatchScore)}
            </span>
          </div>

          <div className="flex-1 text-center">
            <div className="text-xs font-bold text-[#FCA5A5]">حریف</div>
            <div
              className={`text-3xl sm:text-4xl font-black tabular-nums mt-1 ${
                !isVictory ? 'text-[#FCA5A5]' : 'text-white/80'
              }`}
            >
              {toPersianDigits(matchScores.opponentTeam)}
            </div>
          </div>
        </motion.div>

        {/* Action Buttons */}
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.34, duration: 0.3 }}
          className="mt-6 flex flex-col sm:flex-row gap-2.5"
        >
          <button
            type="button"
            onClick={onNewMatch}
            data-testid="match-new-game-btn"
            className="flex-1 min-h-[48px] px-5 py-2.5 rounded-2xl bg-gradient-to-b from-[#FCE08B] via-[#E5B84B] to-[#C28F2B] hover:from-[#FFF0B3] hover:to-[#D4A039] text-[#0B1628] text-sm font-black flex items-center justify-center gap-2 shadow-[0_8px_24px_rgba(243,209,121,0.35)] transition-all active:scale-[0.97] cursor-pointer"
          >
            <RotateCcw className="w-4 h-4 stroke-[2.5]" />
            <span>{isVictory ? 'بازی جدید' : 'شروع مجدد'}</span>
          </button>

          <button
            type="button"
            onClick={onBackToMenu}
            data-testid="match-back-menu-btn"
            className="min-h-[48px] px-5 py-2.5 rounded-2xl bg-white/10 hover:bg-white/16 border border-[#D4AE58]/45 text-[#FAF6EE] text-sm font-bold flex items-center justify-center gap-2 transition-colors active:scale-[0.97] cursor-pointer"
          >
            <Home className="w-4 h-4" />
            <span>بازگشت به منو</span>
          </button>
        </motion.div>
      </motion.div>
    </motion.div>
  );
};
