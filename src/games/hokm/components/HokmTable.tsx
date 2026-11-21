import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Crown, Wifi, WifiOff } from 'lucide-react';
import {
  Card,
  DEFAULT_PLAYERS,
  HokmState,
  Seat,
  Suit,
  TeamId,
} from '../engine/types';
import { getLegalCards } from '../engine/rules';
import { PlayingCard, SuitIconSvg } from './PlayingCard';
import { TrumpSelector } from './TrumpSelector';
import { HandResultModal } from './HandResultModal';
import { CardBackSvg } from './CardBackSvg';
import { PersianCornerOrnament } from '../../../platform/theme/PersianPatterns';
import { toPersianDigits } from '../../../platform/theme/tokens';
import { PLATFORM_ASSETS } from '../../../platform/data/demoData';

export interface FlyingDealCard {
  id: string;
  targetSeat: Seat;
}

export type TrickCollectPhase = 'idle' | 'stacking' | 'sliding';

export interface OnlineSeatPlayerMeta {
  name: string;
  avatarSrc: string;
  connected?: boolean;
  disconnectRemainingSec?: number | null;
}

export interface OnlineTableHudInfo {
  roomCode: string;
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  rttMs: number | null;
  bannerNotice?: string | null;
  waitingHakemName?: string | null;
}

interface HokmTableProps {
  state: HokmState;
  visibleHandCounts: Record<Seat, number>;
  flyingDealCards: readonly FlyingDealCard[];
  isShufflingAnim: boolean;
  isDealingAnim: boolean;
  showGameStartBanner: boolean;
  trickCollectPhase: TrickCollectPhase;
  collectingWinnerTeam: TeamId | null;
  selectedCardId: string | null;
  playerName: string;
  reducedMotion: boolean;
  canHumanPlay: boolean;
  exitConfirmOpen: boolean;
  seatPlayers?: Record<Seat, OnlineSeatPlayerMeta>;
  deckCount?: number;
  onlineHud?: OnlineTableHudInfo;
  canStartRematch?: boolean;
  onSelectCard: (cardId: string | null) => void;
  onPlayCard: (cardId: string) => void;
  onChooseTrump: (suit: Suit) => void;
  onRequestExit: () => void;
  onCancelExit: () => void;
  onConfirmExit: () => void;
  onNewMatch: () => void;
}

const SEAT_AVATARS: Record<Seat, string> = {
  south: PLATFORM_ASSETS.userAvatar,
  east: PLATFORM_ASSETS.avatarSohrab,
  north: PLATFORM_ASSETS.avatarParvin,
  west: PLATFORM_ASSETS.avatarFarhad,
};

const SEAT_FLY_OFFSETS: Record<Seat, { x: number; y: number; rotate: number }> = {
  south: { x: 0, y: 185, rotate: 0 },
  north: { x: 0, y: -175, rotate: 180 },
  east: { x: 205, y: 0, rotate: -90 },
  west: { x: -205, y: 0, rotate: 90 },
};

const TRICK_SLOT_OFFSETS: Record<Seat, { x: number; y: number; rotate: number }> = {
  south: { x: 0, y: 44, rotate: -2 },
  north: { x: 0, y: -44, rotate: 2 },
  east: { x: 46, y: 0, rotate: 4 },
  west: { x: -46, y: 0, rotate: -4 },
};

const STACK_CARD_JITTER = [
  { x: -1.5, y: -1, rotate: -3.5 },
  { x: 1.5, y: 0.5, rotate: 2 },
  { x: -0.5, y: 1.5, rotate: -1 },
  { x: 1, y: -1, rotate: 3 },
];

/**
 * Standard, uniform card-game player badge across ALL 4 seats:
 * Circular portrait frame (with glowing active-turn golden ring + top Hakem crown)
 * paired with a centered dark-glass English username plate underneath.
 */
const SeatProfile: React.FC<{
  seat: Seat;
  displayName: string;
  avatarSrc: string;
  isTurn: boolean;
  isHakem: boolean;
  connected?: boolean;
  disconnectRemainingSec?: number | null;
}> = ({
  seat,
  displayName,
  avatarSrc,
  isTurn,
  isHakem,
  connected = true,
  disconnectRemainingSec = null,
}) => {
  return (
    <div
      className="relative inline-flex flex-col items-center select-none shrink-0"
      data-seat={seat}
      data-active-turn={isTurn ? 'true' : 'false'}
      data-connected={connected ? 'true' : 'false'}
    >
      {/* Circular Avatar Medallion */}
      <div className="relative">
        {isTurn && connected && (
          <span
            className="absolute -inset-1.5 rounded-full bg-[#F3D179]/28 blur-[5px] animate-pulse pointer-events-none"
            aria-hidden="true"
          />
        )}
        <div
          className={`relative w-11 h-11 sm:w-12 sm:h-12 rounded-full overflow-hidden border-[2.5px] bg-[#0B1E1A] transition-all duration-200 ${
            !connected
              ? 'border-[#F59E0B] opacity-70 grayscale-[0.4]'
              : isTurn
                ? 'border-[#F3D179] shadow-[0_0_20px_rgba(243,209,121,0.65)] scale-[1.04]'
                : 'border-[#D4AE58]/60 shadow-[0_4px_12px_rgba(0,0,0,0.45)]'
          }`}
        >
          <img
            src={avatarSrc}
            alt={displayName}
            decoding="sync"
            loading="eager"
            draggable={false}
            className="w-full h-full object-cover"
          />
        </div>

        {/* Hakem Crown perched cleanly on top rim */}
        {isHakem && (
          <span
            className="absolute -top-2 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-gradient-to-b from-[#17362E] to-[#0B1F1A] border border-[#F3D179] flex items-center justify-center shadow-[0_2px_8px_rgba(0,0,0,0.65)]"
            aria-label="حاکم"
          >
            <Crown className="w-3 h-3 text-[#F3D179] fill-[#F3D179]" />
          </span>
        )}
      </div>

      {/* Uniform Centered Dark-Glass English Nameplate overlapping bottom edge of ring */}
      <div
        className={`relative z-10 -mt-2 px-2.5 py-[2px] rounded-full border backdrop-blur-md transition-colors duration-200 ${
          !connected
            ? 'bg-[#3B1D0A]/95 border-[#F59E0B] shadow-[0_2px_8px_rgba(0,0,0,0.5)]'
            : isTurn
              ? 'bg-[#0E2B24]/95 border-[#F3D179] shadow-[0_3px_10px_rgba(0,0,0,0.5)]'
              : 'bg-[#061814]/88 border-[#D4AE58]/40 shadow-[0_2px_8px_rgba(0,0,0,0.4)]'
        }`}
      >
        <span
          dir="ltr"
          className="block text-[10px] sm:text-xs font-extrabold tracking-tight text-[#FAF6EE] truncate max-w-[74px] sm:max-w-[108px] text-center leading-tight"
        >
          {displayName}
        </span>
      </div>

      {/* Disconnected Grace Countdown Badge (Online Mode Only) */}
      {!connected && (
        <span className="mt-1 px-2 py-[1px] rounded-full bg-[#78350F]/90 border border-[#F59E0B]/70 text-[9px] font-bold text-[#FDE68A] whitespace-nowrap">
          قطع اتصال
          {disconnectRemainingSec !== null
            ? ` · ${toPersianDigits(disconnectRemainingSec)}ث`
            : ''}
        </span>
      )}
    </div>
  );
};

/**
 * Stacked 4-card trick packets collected strictly by TEAM:
 * - myTeam: stacked beside South (bottom player)
 * - opponentTeam: stacked beside East (right player)
 */
const TeamTrickPile: React.FC<{
  count: number;
  team: TeamId;
}> = ({ count, team }) => {
  if (count <= 0) return null;
  const visiblePackets = Math.min(count, 7);

  return (
    <motion.div
      initial={{ scale: 0.72, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      data-testid={`won-pile-${team}`}
      data-won-count={count}
      className="relative flex items-center justify-center shrink-0"
      aria-label={`${toPersianDigits(count)}`}
    >
      <div className="relative w-[36px] h-[50px] sm:w-[44px] sm:h-[62px]">
        {Array.from({ length: visiblePackets }).map((_, idx) => (
          <div
            key={idx}
            className="absolute inset-0 rounded-[5px] bg-white p-[1.5px] border border-[#C9C4BA] shadow-[0_2px_6px_rgba(0,0,0,0.5)]"
            style={{
              transform: `translate(${idx * 2}px, ${-idx * 2.2}px) rotate(${
                idx % 2 === 0 ? -4 + idx : 5 - idx
              }deg)`,
              zIndex: idx,
            }}
          >
            <div className="w-full h-full rounded-[3px] overflow-hidden">
              <CardBackSvg />
            </div>
          </div>
        ))}
        <span
          className={`absolute -bottom-1.5 -right-1.5 z-20 min-w-[20px] h-[20px] px-1 rounded-full border text-[10px] font-extrabold flex items-center justify-center tabular-nums shadow-md ${
            team === 'myTeam'
              ? 'bg-[#0C352C] border-[#F3D179] text-[#F3D179]'
              : 'bg-[#3D1418] border-[#F3D179] text-[#FDE68A]'
          }`}
        >
          {toPersianDigits(count)}
        </span>
      </div>
    </motion.div>
  );
};

/**
 * Strictly face-down card backs for opponent & partner hands.
 * ALWAYS reserves fixed layout dimensions even at 0 cards so the arena NEVER jumps
 * downward when the first card arrives during dealing!
 */
const HiddenHandFan: React.FC<{
  count: number;
  orientation: 'horizontal' | 'vertical';
}> = ({ count, orientation }) => {
  const displayCount = Math.min(count, 13);

  if (orientation === 'horizontal') {
    return (
      <div
        dir="ltr"
        className="flex items-center justify-center h-[48px] sm:h-[62px] w-full"
        aria-hidden="true"
      >
        {displayCount > 0 &&
          Array.from({ length: displayCount }).map((_, idx) => (
            <div
              key={idx}
              className="w-[34px] h-[48px] sm:w-[42px] sm:h-[60px] rounded-[5px] bg-white p-[1.5px] overflow-hidden shadow-md border border-[#D4CFC5] shrink-0"
              style={{
                marginLeft: idx === 0 ? 0 : displayCount > 9 ? -21 : -15,
                zIndex: idx,
              }}
            >
              <div className="w-full h-full rounded-[3px] overflow-hidden">
                <CardBackSvg />
              </div>
            </div>
          ))}
      </div>
    );
  }

  const visibleStack = Math.min(displayCount, 7);
  return (
    <div
      className="flex flex-col items-center justify-center h-[112px] sm:h-[146px] w-[48px] sm:w-[58px] shrink-0"
      aria-hidden="true"
    >
      {visibleStack > 0 &&
        Array.from({ length: visibleStack }).map((_, idx) => (
          <div
            key={idx}
            className="w-[46px] h-[32px] sm:w-[56px] sm:h-[38px] rounded-[5px] bg-white p-[1.5px] overflow-hidden shadow-md border border-[#D4CFC5] shrink-0"
            style={{
              marginTop: idx === 0 ? 0 : -20,
              zIndex: idx,
            }}
          >
            <div className="w-full h-full rounded-[3px] overflow-hidden">
              <div className="w-full h-full rotate-90 scale-[1.45]">
                <CardBackSvg />
              </div>
            </div>
          </div>
        ))}
    </div>
  );
};

/**
 * Commanding, enlarged Royal Persian Scoreboard:
 * - Big numeric badge = Rounds/Hands won in the match (first to 3!)
 * - 7 glowing dots underneath = Tricks won in the current hand (out of 7!)
 * - Center Trump Medallion = clickable temporary Back trigger (opens exit/forfeit warning)
 */
const RoyalScoreboard: React.FC<{
  state: HokmState;
  reducedMotion: boolean;
  onRequestExit: () => void;
}> = ({ state, reducedMotion, onRequestExit }) => {
  return (
    <div
      className="w-full max-w-[440px] sm:max-w-[560px] flex items-center justify-between gap-2 sm:gap-5 rounded-2xl px-3.5 sm:px-6 py-2 sm:py-2.5 bg-gradient-to-b from-[#0D2E27]/96 to-[#071A16]/96 border-[1.5px] border-[#D4AE58]/65 shadow-[0_8px_28px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(243,209,121,0.28)]"
      data-testid="tricks-scoreboard"
    >
      {/* MY TEAM WING */}
      <div className="flex items-center gap-2.5 sm:gap-4 flex-1 justify-end">
        <div className="flex flex-col items-end">
          <span className="text-xs sm:text-sm font-extrabold text-[#6EE7B7] whitespace-nowrap">
            تیم ما
          </span>
          {/* 7-Trick Pip Progress Bar (counts the 7 tricks in the current hand) */}
          <div
            className="flex items-center gap-[4px] sm:gap-1.5 mt-1.5"
            data-testid="tricks-pips-myTeam"
            data-tricks={state.trickCounts.myTeam}
            aria-label={`دست‌های برده تیم ما: ${toPersianDigits(state.trickCounts.myTeam)} از ۷`}
          >
            {Array.from({ length: 7 }).map((_, i) => (
              <span
                key={i}
                className={`w-[7.5px] h-[7.5px] sm:w-2.5 sm:h-2.5 rounded-full transition-all duration-200 ${
                  i < state.trickCounts.myTeam
                    ? 'bg-[#34D399] shadow-[0_0_8px_rgba(52,211,153,0.9)] scale-110'
                    : 'bg-white/15'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Big Main Number = Match Rounds Won (out of 3) */}
        <motion.div
          key={`my-rounds-${state.matchScores.myTeam}`}
          initial={reducedMotion ? false : { scale: 1.38 }}
          animate={{ scale: 1 }}
          data-testid="match-score-myTeam"
          className="min-w-[38px] sm:min-w-[48px] h-10 sm:h-12 rounded-xl bg-[#0F382E] border border-[#34D399]/60 flex items-center justify-center text-xl sm:text-2xl font-black text-[#FFFFFF] tabular-nums shadow-inner"
        >
          {toPersianDigits(state.matchScores.myTeam)}
        </motion.div>
      </div>

      {/* CENTER ORNATE TRUMP MEDALLION (Pure Icon-Only + Temporary Back Trigger) */}
      <div className="relative flex items-center justify-center px-1 sm:px-2 shrink-0">
        <button
          type="button"
          onClick={onRequestExit}
          data-testid="scoreboard-trump-back-btn"
          aria-label="خروج از بازی"
          className="rounded-full cursor-pointer transition-transform active:scale-92 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3D179]"
        >
          {state.trumpSuit ? (
            <motion.div
              key={state.trumpSuit}
              data-testid="trump-indicator"
              initial={reducedMotion ? false : { scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 360, damping: 24 }}
              className="w-11 h-11 sm:w-14 sm:h-14 rounded-full bg-[#FFFFFF] border-[2.5px] border-[#F3D179] shadow-[0_0_22px_rgba(243,209,121,0.52)] hover:shadow-[0_0_28px_rgba(243,209,121,0.75)] flex items-center justify-center shrink-0"
            >
              <SuitIconSvg
                suit={state.trumpSuit}
                className="w-6 h-6 sm:w-8 sm:h-8"
              />
            </motion.div>
          ) : (
            <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-full bg-[#102B26] border-2 border-[#D4AE58]/60 hover:border-[#F3D179] flex items-center justify-center shrink-0">
              <Crown className="w-5 h-5 sm:w-7 sm:h-7 text-[#F3D179]/85" />
            </div>
          )}
        </button>
      </div>

      {/* OPPONENT TEAM WING */}
      <div
        className="flex items-center gap-2.5 sm:gap-4 flex-1 justify-start"
        data-testid="match-scoreboard"
      >
        {/* Big Main Number = Match Rounds Won (out of 3) */}
        <motion.div
          key={`opp-rounds-${state.matchScores.opponentTeam}`}
          initial={reducedMotion ? false : { scale: 1.38 }}
          animate={{ scale: 1 }}
          data-testid="match-score-opponentTeam"
          className="min-w-[38px] sm:min-w-[48px] h-10 sm:h-12 rounded-xl bg-[#3B161C] border border-[#FB7185]/60 flex items-center justify-center text-xl sm:text-2xl font-black text-[#FFFFFF] tabular-nums shadow-inner"
        >
          {toPersianDigits(state.matchScores.opponentTeam)}
        </motion.div>

        <div className="flex flex-col items-start">
          <span className="text-xs sm:text-sm font-extrabold text-[#FCA5A5] whitespace-nowrap">
            حریف
          </span>
          {/* 7-Trick Pip Progress Bar (counts the 7 tricks in the current hand) */}
          <div
            className="flex items-center gap-[4px] sm:gap-1.5 mt-1.5"
            data-testid="tricks-pips-opponentTeam"
            data-tricks={state.trickCounts.opponentTeam}
            aria-label={`دست‌های برده حریف: ${toPersianDigits(state.trickCounts.opponentTeam)} از ۷`}
          >
            {Array.from({ length: 7 }).map((_, i) => (
              <span
                key={i}
                className={`w-[7.5px] h-[7.5px] sm:w-2.5 sm:h-2.5 rounded-full transition-all duration-200 ${
                  i < state.trickCounts.opponentTeam
                    ? 'bg-[#FB7185] shadow-[0_0_8px_rgba(251,113,133,0.9)] scale-110'
                    : 'bg-white/15'
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Zero-Latency Pointer-Events Draggable & Two-Tap Hand Card:
 * - Tap 1 on a legal card: lifts the card smoothly higher and highlights it.
 * - Tap 2 on the ALREADY selected card: plays that card onto the table!
 * - Dragging upward onto center table (dy < -62px or brisk upward flick): also plays smoothly!
 * - Grayed-out / dimmed whenever it is NOT the player's turn (or card is illegal),
 *   brightening immediately when it becomes the player's turn!
 */
interface DraggableHandCardProps {
  card: Card;
  idx: number;
  targetX: number;
  cardWidthPx: number;
  isLegal: boolean;
  canHumanPlay: boolean;
  isWaitingTurn: boolean;
  isSelected: boolean;
  isDraggingGlobal: boolean;
  reducedMotion: boolean;
  onSelectCard: (cardId: string | null) => void;
  onPlayCard: (cardId: string) => void;
  onDragChange: (cardId: string | null, overDrop: boolean) => void;
}

const DraggableHandCard: React.FC<DraggableHandCardProps> = ({
  card,
  idx,
  targetX,
  cardWidthPx,
  isLegal,
  canHumanPlay,
  isWaitingTurn,
  isSelected,
  isDraggingGlobal,
  reducedMotion,
  onSelectCard,
  onPlayCard,
  onDragChange,
}) => {
  const isDraggable = canHumanPlay && isLegal;
  const dimmed = isWaitingTurn || (canHumanPlay && !isLegal);

  const innerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    lastY: number;
    lastTime: number;
    vy: number;
    didDrag: boolean;
    overDrop: boolean;
    baseY: number;
  }>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    lastY: 0,
    lastTime: 0,
    vy: 0,
    didDrag: false,
    overDrop: false,
    baseY: 0,
  });

  // Sync resting/selected transform cleanly whenever NOT actively dragging
  useEffect(() => {
    const el = innerRef.current;
    if (!el || dragStateRef.current.active) return;
    el.style.transition = reducedMotion
      ? 'none'
      : 'transform 210ms cubic-bezier(0.22, 1, 0.36, 1)';
    el.style.transform = isSelected
      ? 'translate3d(0px, -28px, 0px) scale(1.12)'
      : 'translate3d(0px, 0px, 0px) scale(1)';
  }, [isSelected, reducedMotion]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggable) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    const el = innerRef.current;
    if (!el) return;

    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic events without active pointerId
    }

    const baseY = isSelected ? -28 : 0;
    dragStateRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastY: e.clientY,
      lastTime: performance.now(),
      vy: 0,
      didDrag: false,
      overDrop: false,
      baseY,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const ds = dragStateRef.current;
    if (!ds.active || ds.pointerId !== e.pointerId) return;
    const el = innerRef.current;
    if (!el) return;

    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    const now = performance.now();
    const dt = Math.max(8, now - ds.lastTime);
    ds.vy = (e.clientY - ds.lastY) / dt;
    ds.lastY = e.clientY;
    ds.lastTime = now;

    if (!ds.didDrag) {
      if (Math.hypot(dx, dy) < 7) return;
      ds.didDrag = true;
      el.style.transition = 'none';
      const overNow = dy + ds.baseY < -54;
      ds.overDrop = overNow;
      onDragChange(card.id, overNow);
    }

    const visualY = dy + ds.baseY;
    const tilt = Math.max(-13, Math.min(13, dx * 0.065));
    el.style.transform = `translate3d(${dx}px, ${visualY}px, 0px) rotate(${tilt}deg) scale(1.14)`;

    const overNow = visualY < -54;
    if (overNow !== ds.overDrop) {
      ds.overDrop = overNow;
      onDragChange(card.id, overNow);
    }
  };

  const finishPointer = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const ds = dragStateRef.current;
    if (!ds.active || ds.pointerId !== e.pointerId) return;

    const el = innerRef.current;
    if (el) {
      try {
        if (el.hasPointerCapture(e.pointerId)) {
          el.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore
      }
    }

    const dy = e.clientY - ds.startY;
    const totalY = dy + ds.baseY;
    const wasDrag = ds.didDrag;
    const vy = ds.vy;

    ds.active = false;
    ds.pointerId = null;
    ds.didDrag = false;
    ds.overDrop = false;

    if (wasDrag) {
      onDragChange(null, false);
      const droppedOnTable =
        !cancelled &&
        (totalY < -62 || (vy < -0.45 && totalY < -28));

      if (droppedOnTable && isDraggable) {
        onPlayCard(card.id);
        return;
      }

      // Smoothly return card to hand (keeping selection state cleanly)
      if (el) {
        el.style.transition = reducedMotion
          ? 'none'
          : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';
        el.style.transform = isSelected
          ? 'translate3d(0px, -28px, 0px) scale(1.12)'
          : 'translate3d(0px, 0px, 0px) scale(1)';
      }
      return;
    }

    // TAP 1: lift & select card; TAP 2 on the ALREADY selected card: play it!
    if (!cancelled && isDraggable) {
      if (isSelected) {
        onPlayCard(card.id);
      } else {
        onSelectCard(card.id);
      }
    }
  };

  return (
    <motion.div
      initial={
        reducedMotion
          ? { x: targetX, opacity: 1 }
          : { x: targetX, y: -36, opacity: 0, scale: 0.9 }
      }
      animate={{
        x: targetX,
        y: 0,
        opacity: 1,
        scale: 1,
      }}
      transition={
        reducedMotion
          ? { duration: 0.05 }
          : {
              x: { type: 'spring', stiffness: 195, damping: 24, mass: 0.85 },
              y: { type: 'spring', stiffness: 260, damping: 26 },
              opacity: { duration: 0.2 },
              scale: { duration: 0.2 },
            }
      }
      style={{
        position: 'absolute',
        bottom: 4,
        left: '50%',
        marginLeft: -(cardWidthPx / 2),
        zIndex: isDraggingGlobal ? 95 : isSelected ? 55 : idx + 1,
      }}
      className="will-change-transform"
    >
      <div
        ref={innerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => finishPointer(e, false)}
        onPointerCancel={(e) => finishPointer(e, true)}
        role={isDraggable ? 'button' : undefined}
        tabIndex={isDraggable ? 0 : -1}
        aria-disabled={dimmed ? 'true' : undefined}
        data-playable={isDraggable ? 'true' : 'false'}
        data-selected={isSelected ? 'true' : 'false'}
        data-card-slot={card.id}
        style={{
          transform: isSelected
            ? 'translate3d(0px, -28px, 0px) scale(1.12)'
            : 'translate3d(0px, 0px, 0px) scale(1)',
        }}
        className={`touch-none select-none will-change-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3D179] rounded-[10px] ${
          isDraggable
            ? 'cursor-grab active:cursor-grabbing'
            : dimmed
              ? 'cursor-not-allowed'
              : 'cursor-default'
        }`}
      >
        <PlayingCard
          card={card}
          isSelected={isSelected || isDraggingGlobal}
          isPlayable={!dimmed}
          size="md"
        />
      </div>
    </motion.div>
  );
};

export const HokmTable: React.FC<HokmTableProps> = ({
  state,
  visibleHandCounts,
  flyingDealCards,
  isShufflingAnim,
  isDealingAnim,
  showGameStartBanner,
  trickCollectPhase,
  collectingWinnerTeam,
  selectedCardId,
  playerName,
  reducedMotion,
  canHumanPlay,
  exitConfirmOpen,
  seatPlayers,
  deckCount,
  onlineHud,
  canStartRematch = true,
  onSelectCard,
  onPlayCard,
  onChooseTrump,
  onRequestExit,
  onCancelExit,
  onConfirmExit,
  onNewMatch,
}) => {
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [isOverDropZone, setIsOverDropZone] = useState(false);

  const handleDragChange = useCallback(
    (cardId: string | null, overDrop: boolean) => {
      setDraggingCardId(cardId);
      setIsOverDropZone(overDrop);
    },
    []
  );

  // Measure South hand container width for silky-smooth dynamic card spacing as hand shrinks
  const handContainerRef = useRef<HTMLDivElement | null>(null);
  const [handLayout, setHandLayout] = useState<{
    width: number;
    isDesktop: boolean;
  }>(() => ({
    width: typeof window !== 'undefined' ? Math.min(window.innerWidth, 1024) : 390,
    isDesktop: typeof window !== 'undefined' ? window.innerWidth >= 640 : false,
  }));

  useEffect(() => {
    const updateSize = () => {
      const el = handContainerRef.current;
      const measured = el ? el.clientWidth : window.innerWidth;
      setHandLayout({
        width: measured,
        isDesktop: window.innerWidth >= 640,
      });
    };

    updateSize();
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(updateSize)
        : null;
    if (ro && handContainerRef.current) {
      ro.observe(handContainerRef.current);
    }
    window.addEventListener('resize', updateSize);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  const southHand = state.hands.south.slice(0, visibleHandCounts.south);
  const legalIds = new Set(
    canHumanPlay
      ? getLegalCards(state.hands.south, state.currentTrick).map((c) => c.id)
      : []
  );

  const effectiveDeckCount = deckCount ?? state.deck.length;
  const showDeckOnTable =
    state.phase === 'SHUFFLING' ||
    state.phase === 'DEALING_INITIAL_5' ||
    state.phase === 'DEALING_REMAINING_8' ||
    (state.phase === 'CHOOSING_TRUMP' && effectiveDeckCount > 0);

  const resolvedSeats: Record<Seat, OnlineSeatPlayerMeta> = {
    south: seatPlayers?.south ?? {
      name: playerName,
      avatarSrc: SEAT_AVATARS.south,
      connected: true,
    },
    east: seatPlayers?.east ?? {
      name: DEFAULT_PLAYERS.east.name,
      avatarSrc: SEAT_AVATARS.east,
      connected: true,
    },
    north: seatPlayers?.north ?? {
      name: DEFAULT_PLAYERS.north.name,
      avatarSrc: SEAT_AVATARS.north,
      connected: true,
    },
    west: seatPlayers?.west ?? {
      name: DEFAULT_PLAYERS.west.name,
      avatarSrc: SEAT_AVATARS.west,
      connected: true,
    },
  };

  // Team-based collection slide target:
  // myTeam -> always South (bottom player); opponentTeam -> always East (right player)
  const slideDestination = collectingWinnerTeam
    ? collectingWinnerTeam === 'myTeam'
      ? SEAT_FLY_OFFSETS.south
      : SEAT_FLY_OFFSETS.east
    : { x: 0, y: 0, rotate: 0 };

  // Dynamic smooth horizontal fan step:
  // As southHand.length decreases (13 -> 12 -> ... -> 1), step widens smoothly!
  const cardWidthPx = handLayout.isDesktop ? 106 : 84;
  const maxUsableWidth = handLayout.isDesktop
    ? Math.min(handLayout.width - 28, 960)
    : Math.max(260, handLayout.width - 14);
  const idealSpreadStep = handLayout.isDesktop ? cardWidthPx + 10 : cardWidthPx + 6;
  const count = southHand.length;
  const fanStepPx =
    count <= 1
      ? 0
      : Math.min(idealSpreadStep, Math.max(22, (maxUsableWidth - cardWidthPx) / (count - 1)));

  return (
    <div
      className="min-h-[100dvh] w-full flex flex-col hokm-traditional-arena text-[#F6F3EC] relative overflow-hidden select-none transform-gpu"
      data-testid="hokm-table"
      data-phase={state.phase}
      data-turn={state.currentTurn}
    >
      {/* TRADITIONAL PERSIAN EMERALD VELVET & KHATAMKARI TABLE BACKDROP */}
      <div
        className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
        aria-hidden="true"
      >
        <img
          src={PLATFORM_ASSETS.hokmTableTraditional}
          alt=""
          decoding="sync"
          loading="eager"
          className="w-full h-full object-cover object-center scale-[1.18] brightness-[0.94] contrast-[1.06] saturate-[1.08]"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse at 50% 48%, rgba(8, 52, 39, 0.14) 0%, rgba(5, 30, 23, 0.45) 70%, rgba(3, 18, 14, 0.78) 100%)',
          }}
        />
      </div>

      {/* Clean Top HUD Header: Enlarged Royal Persian Scoreboard Centered */}
      <header
        className="relative z-30 flex items-center justify-center px-3 sm:px-6 py-2 sm:py-2.5 backdrop-blur-md bg-[#061814]/82 border-b border-[#D4AE58]/35 text-[#FAF6EE]"
        data-testid="hokm-header"
      >
        <RoyalScoreboard
          state={state}
          reducedMotion={reducedMotion}
          onRequestExit={onRequestExit}
        />
      </header>

      {/* Subtle Online Status Strip (Online Mode ONLY) */}
      {onlineHud && (
        <div
          className="relative z-25 flex flex-wrap items-center justify-center gap-2 px-3 pt-1.5"
          data-testid="online-table-hud"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#061814]/88 border border-[#D4AE58]/35 text-[11px] font-bold text-[#DCECE6] backdrop-blur-md">
            <span dir="ltr" className="font-mono text-[#F3D179]">
              #{onlineHud.roomCode}
            </span>
            <span className="opacity-40">|</span>
            {onlineHud.connectionState === 'connected' ? (
              <span className="inline-flex items-center gap-1 text-[#6EE7B7]">
                <Wifi className="w-3 h-3" />
                {onlineHud.rttMs !== null
                  ? `${toPersianDigits(onlineHud.rttMs)}ms`
                  : 'متصل'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[#FDE68A]">
                <WifiOff className="w-3 h-3 animate-pulse" />
                در حال اتصال مجدد...
              </span>
            )}
          </div>

          {(onlineHud.bannerNotice || onlineHud.waitingHakemName) && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0E3129]/92 border border-[#F3D179]/55 text-[11px] font-bold text-[#FDE68A] backdrop-blur-md">
              {onlineHud.bannerNotice
                ? onlineHud.bannerNotice
                : `در انتظار انتخاب خال حکم توسط ${onlineHud.waitingHakemName}...`}
            </div>
          )}
        </div>
      )}

      {/* Main Traditional Salon Arena */}
      <main className="flex-1 relative z-10 flex flex-col justify-between px-2 sm:px-6 py-2 sm:py-3 max-w-6xl w-full mx-auto">
        {/* Inlaid Persian Gold & Khatamkari Perimeter Rail */}
        <div className="pointer-events-none absolute inset-1.5 sm:inset-3 rounded-[28px] border-2 border-[#D4AE58]/40 shadow-[inset_0_0_54px_rgba(0,0,0,0.42)]">
          <div className="absolute inset-1.5 rounded-[22px] border border-[#D4AE58]/22" />
          <PersianCornerOrnament className="absolute top-2 left-2 opacity-80 hidden sm:block" />
          <PersianCornerOrnament
            className="absolute top-2 right-2 opacity-80 hidden sm:block"
            flipX
          />
          <PersianCornerOrnament
            className="absolute bottom-2 left-2 opacity-80 hidden sm:block"
            flipY
          />
          <PersianCornerOrnament
            className="absolute bottom-2 right-2 opacity-80 hidden sm:block"
            flipX
            flipY
          />
        </div>

        {/* TOP SEAT: North (Partner) */}
        <section
          className="relative z-10 flex flex-col items-center gap-1 pt-1"
          aria-label={resolvedSeats.north.name}
        >
          <SeatProfile
            seat="north"
            displayName={resolvedSeats.north.name}
            avatarSrc={resolvedSeats.north.avatarSrc}
            connected={resolvedSeats.north.connected}
            disconnectRemainingSec={resolvedSeats.north.disconnectRemainingSec}
            isTurn={
              (state.phase === 'PLAYING_TRICK' ||
                state.phase === 'CHOOSING_TRUMP') &&
              state.currentTurn === 'north'
            }
            isHakem={state.hakem === 'north'}
          />
          <HiddenHandFan count={visibleHandCounts.north} orientation="horizontal" />
        </section>

        {/* MIDDLE ROW: West (left), Center Trick Arena, East (right + opponentTeam pile) */}
        <section
          dir="ltr"
          className="relative z-10 flex-1 grid grid-cols-[80px_1fr_80px] sm:grid-cols-[164px_1fr_164px] items-center gap-1 sm:gap-4 my-1"
        >
          {/* Physical LEFT: West */}
          <div
            dir="rtl"
            className="flex flex-col items-center justify-center gap-2"
            aria-label={resolvedSeats.west.name}
          >
            <SeatProfile
              seat="west"
              displayName={resolvedSeats.west.name}
              avatarSrc={resolvedSeats.west.avatarSrc}
              connected={resolvedSeats.west.connected}
              disconnectRemainingSec={resolvedSeats.west.disconnectRemainingSec}
              isTurn={
                (state.phase === 'PLAYING_TRICK' ||
                  state.phase === 'CHOOSING_TRUMP') &&
                state.currentTurn === 'west'
              }
              isHakem={state.hakem === 'west'}
            />
            <HiddenHandFan count={visibleHandCounts.west} orientation="vertical" />
          </div>

          {/* CENTER ARENA */}
          <div
            dir="rtl"
            className="relative min-h-[206px] sm:min-h-[280px] flex flex-col items-center justify-center"
          >
            {/* Interactive Drop Ring over the Traditional Embossed Shamseh */}
            <div
              className={`w-[192px] h-[192px] sm:w-[268px] sm:h-[268px] rounded-full border flex items-center justify-center relative transition-all duration-150 ${
                draggingCardId
                  ? isOverDropZone
                    ? 'border-[#F3D179] bg-[#F3D179]/16 shadow-[0_0_36px_rgba(243,209,121,0.38)] scale-[1.05]'
                    : 'border-[#F3D179]/55 bg-black/15'
                  : 'border-[#D4AE58]/26 bg-black/8'
              }`}
              aria-hidden="true"
            />

            {/* Deck Pile & Calm Riffle Shuffle Animation */}
            <AnimatePresence>
              {showDeckOnTable && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  transition={{ duration: 0.24 }}
                  className="absolute inset-0 flex items-center justify-center pointer-events-none"
                >
                  <div className="relative w-[64px] h-[90px] sm:w-[78px] sm:h-[110px]">
                    {[0, 1, 2, 3].map((layer) => (
                      <motion.div
                        key={layer}
                        animate={
                          isShufflingAnim && !reducedMotion
                            ? {
                                x: layer % 2 === 0 ? [-30, 22, 0] : [30, -22, 0],
                                rotate: layer % 2 === 0 ? [-8, 5, 0] : [8, -5, 0],
                              }
                            : { x: layer * 1.4, y: -layer * 1.4, rotate: 0 }
                        }
                        transition={
                          isShufflingAnim
                            ? {
                                duration: 0.4,
                                repeat: 2,
                                ease: 'easeInOut',
                                delay: layer * 0.04,
                              }
                            : { duration: 0.22 }
                        }
                        className="absolute inset-0 rounded-[8px] bg-white p-[2px] border border-[#D4CFC5] shadow-lg overflow-hidden"
                      >
                        <div className="w-full h-full rounded-[6px] overflow-hidden">
                          <CardBackSvg />
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Flying Cards during Dealing */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-visible">
              <AnimatePresence>
                {flyingDealCards.map((fc) => {
                  const dest = SEAT_FLY_OFFSETS[fc.targetSeat];
                  return (
                    <motion.div
                      key={fc.id}
                      initial={{ x: 0, y: 0, scale: 0.9, opacity: 1, rotate: 0 }}
                      animate={{
                        x: dest.x,
                        y: dest.y,
                        scale: 0.74,
                        opacity: 0.18,
                        rotate: dest.rotate * 0.14,
                      }}
                      exit={{ opacity: 0 }}
                      transition={{
                        duration: reducedMotion ? 0.05 : 0.29,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      className="absolute w-[54px] h-[76px] rounded-[7px] bg-white p-[1.5px] border border-[#D4CFC5] shadow-lg overflow-hidden"
                    >
                      <div className="w-full h-full rounded-[5px] overflow-hidden">
                        <CardBackSvg />
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>

            {/* Active 4-Card Trick -> Stacks cleanly -> Slides to Team Pile */}
            <motion.div
              dir="ltr"
              animate={
                trickCollectPhase === 'sliding'
                  ? {
                      x: slideDestination.x,
                      y: slideDestination.y,
                      scale: 0.56,
                      opacity: 0.14,
                    }
                  : { x: 0, y: 0, scale: 1, opacity: 1 }
              }
              transition={{
                duration: reducedMotion ? 0.08 : 0.38,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              data-testid="trick-center-area"
            >
              <AnimatePresence>
                {state.currentTrick.map((play, idx) => {
                  const origin = SEAT_FLY_OFFSETS[play.seat];
                  const slot = TRICK_SLOT_OFFSETS[play.seat];
                  const stackPose =
                    STACK_CARD_JITTER[idx % STACK_CARD_JITTER.length];
                  const isStacking =
                    trickCollectPhase === 'stacking' ||
                    trickCollectPhase === 'sliding';
                  const isWinnerCard =
                    state.phase === 'TRICK_COMPLETE' &&
                    trickCollectPhase === 'idle' &&
                    state.lastCompletedTrick?.winnerSeat === play.seat;

                  return (
                    <motion.div
                      key={play.card.id}
                      initial={
                        reducedMotion
                          ? { x: slot.x, y: slot.y, opacity: 1, rotate: slot.rotate }
                          : {
                              x: origin.x * 0.72,
                              y: origin.y * 0.72,
                              scale: 0.86,
                              opacity: 0.4,
                              rotate: origin.rotate * 0.08,
                            }
                      }
                      animate={
                        isStacking
                          ? {
                              x: stackPose.x,
                              y: stackPose.y,
                              rotate: stackPose.rotate,
                              scale: 0.92,
                              opacity: 1,
                            }
                          : {
                              x: slot.x,
                              y: slot.y,
                              rotate: slot.rotate,
                              scale: isWinnerCard ? 1.07 : 1,
                              opacity: 1,
                            }
                      }
                      exit={{ opacity: 0, scale: 0.7 }}
                      transition={{
                        duration: reducedMotion ? 0.05 : 0.24,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      style={{ zIndex: isWinnerCard ? 30 : idx + 5 }}
                      className="absolute"
                    >
                      <PlayingCard
                        card={play.card}
                        isWinningCard={isWinnerCard}
                        size="trick"
                      />
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </motion.div>

            {/* Exciting Non-Blocking "Game Started!" Burst right after dealing finishes */}
            <AnimatePresence>
              {showGameStartBanner && (
                <motion.div
                  initial={
                    reducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.7 }
                  }
                  animate={{ opacity: 1, scale: 1 }}
                  exit={
                    reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 1.12 }
                  }
                  transition={{
                    type: 'spring',
                    stiffness: 320,
                    damping: 22,
                  }}
                  className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
                  data-testid="game-start-burst"
                >
                  {/* Expanding golden pulse ring */}
                  {!reducedMotion && (
                    <motion.div
                      initial={{ scale: 0.5, opacity: 0.9 }}
                      animate={{ scale: 2.1, opacity: 0 }}
                      transition={{ duration: 0.95, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute w-32 h-32 rounded-full border-2 border-[#F3D179] shadow-[0_0_24px_rgba(243,209,121,0.75)]"
                    />
                  )}
                  <div className="relative flex items-center gap-2.5 px-6 py-3 rounded-full bg-gradient-to-b from-[#0E352B]/96 to-[#061914]/96 border-2 border-[#F3D179] shadow-[0_14px_40px_rgba(0,0,0,0.68),0_0_32px_rgba(243,209,121,0.45)] backdrop-blur-md">
                    {state.trumpSuit && (
                      <span className="w-8 h-8 rounded-full bg-white border border-[#F3D179] flex items-center justify-center shrink-0">
                        <SuitIconSvg suit={state.trumpSuit} className="w-5 h-5" />
                      </span>
                    )}
                    <span className="text-lg sm:text-2xl font-black bg-gradient-to-b from-[#FFF5D6] via-[#F3D179] to-[#D4A039] bg-clip-text text-transparent whitespace-nowrap">
                      شروع بازی!
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Enlarged Spotlight Icon-Only Trump Selector (keeps bottom 5 cards & header crystal clear) */}
            <AnimatePresence>
              {state.phase === 'CHOOSING_TRUMP' &&
                state.hakem === 'south' &&
                !isDealingAnim &&
                !isShufflingAnim && (
                  <div className="absolute inset-0 z-40 flex items-center justify-center overflow-visible pointer-events-none">
                    <div className="pointer-events-auto">
                      <TrumpSelector
                        onSelectTrump={onChooseTrump}
                        reducedMotion={reducedMotion}
                      />
                    </div>
                  </div>
                )}
            </AnimatePresence>
          </div>

          {/* Physical RIGHT: East + Opponent Team Pile (anchored inward so never clips on mobile) */}
          <div
            dir="rtl"
            className="flex flex-col items-center justify-center gap-2"
            aria-label={resolvedSeats.east.name}
          >
            <SeatProfile
              seat="east"
              displayName={resolvedSeats.east.name}
              avatarSrc={resolvedSeats.east.avatarSrc}
              connected={resolvedSeats.east.connected}
              disconnectRemainingSec={resolvedSeats.east.disconnectRemainingSec}
              isTurn={
                (state.phase === 'PLAYING_TRICK' ||
                  state.phase === 'CHOOSING_TRUMP') &&
                state.currentTurn === 'east'
              }
              isHakem={state.hakem === 'east'}
            />
            <div className="relative flex items-center justify-center">
              <HiddenHandFan
                count={visibleHandCounts.east}
                orientation="vertical"
              />
              {state.trickCounts.opponentTeam > 0 && (
                <div className="absolute top-1/2 -translate-y-1/2 right-full mr-1.5 sm:mr-2.5 pointer-events-none">
                  <TeamTrickPile
                    count={state.trickCounts.opponentTeam}
                    team="opponentTeam"
                  />
                </div>
              )}
            </div>
          </div>
        </section>

        {/* BOTTOM SEAT: South (Main Player) + My Team Pile (zero-shift anchored) + Hand */}
        <section
          className="relative z-20 flex flex-col items-center gap-4 sm:gap-3.5 pb-2 sm:pb-3"
          aria-label={resolvedSeats.south.name}
        >
          <div className="relative flex items-center justify-center min-h-[58px] sm:min-h-[64px]">
            <SeatProfile
              seat="south"
              displayName={resolvedSeats.south.name}
              avatarSrc={resolvedSeats.south.avatarSrc}
              connected={resolvedSeats.south.connected}
              disconnectRemainingSec={resolvedSeats.south.disconnectRemainingSec}
              isTurn={
                (state.phase === 'PLAYING_TRICK' ||
                  state.phase === 'CHOOSING_TRUMP') &&
                state.currentTurn === 'south'
              }
              isHakem={state.hakem === 'south'}
            />
            {state.trickCounts.myTeam > 0 && (
              <div className="absolute right-full mr-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <TeamTrickPile count={state.trickCounts.myTeam} team="myTeam" />
              </div>
            )}
          </div>

          <div
            ref={handContainerRef}
            dir="ltr"
            className="relative w-full h-[142px] sm:h-[178px] overflow-visible"
            data-testid="south-hand"
          >
            {southHand.map((card, idx) => {
              const targetX = (idx - (count - 1) / 2) * fanStepPx;
              const isWaitingTurn =
                !canHumanPlay &&
                (state.phase === 'PLAYING_TRICK' ||
                  state.phase === 'TRICK_COMPLETE');
              return (
                <DraggableHandCard
                  key={card.id}
                  card={card}
                  idx={idx}
                  targetX={targetX}
                  cardWidthPx={cardWidthPx}
                  isLegal={legalIds.has(card.id)}
                  canHumanPlay={canHumanPlay}
                  isWaitingTurn={isWaitingTurn}
                  isSelected={selectedCardId === card.id}
                  isDraggingGlobal={draggingCardId === card.id}
                  reducedMotion={reducedMotion}
                  onSelectCard={onSelectCard}
                  onPlayCard={onPlayCard}
                  onDragChange={handleDragChange}
                />
              );
            })}
          </div>
        </section>
      </main>

      {/* Exit / Forfeit Confirmation Modal (Triggered by Phone/Browser Back or Escape) */}
      <AnimatePresence>
        {exitConfirmOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="hokm-forfeit-title"
            data-testid="hokm-exit-modal"
          >
            <div
              className="fixed inset-0"
              onClick={onCancelExit}
              aria-hidden="true"
            />
            <motion.div
              initial={reducedMotion ? false : { scale: 0.92, y: 12, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={reducedMotion ? undefined : { scale: 0.94, y: 8, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 360, damping: 26 }}
              className="relative z-10 w-full max-w-sm rounded-3xl bg-gradient-to-b from-[#0E2822] to-[#071814] border border-[#D4AE58]/60 shadow-[0_24px_60px_rgba(0,0,0,0.65)] p-5 sm:p-6 text-center space-y-4"
            >
              <div className="w-14 h-14 mx-auto rounded-2xl bg-[#DC2626]/18 border border-[#F87171]/45 flex items-center justify-center shadow-inner">
                <AlertTriangle className="w-7 h-7 text-[#FCA5A5]" />
              </div>

              <div className="space-y-1.5">
                <h2
                  id="hokm-forfeit-title"
                  className="text-lg font-extrabold text-[#FAF6EE]"
                >
                  انصراف از بازی حکم؟
                </h2>
                <p className="text-xs sm:text-sm text-[#B8CEC6] leading-relaxed">
                  در صورت خروج از وسط بازی، این دست به عنوان انصراف ثبت می‌شود. آیا می‌خواهید از میز خارج شوید؟
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={onCancelExit}
                  data-testid="hokm-continue-btn"
                  className="min-h-[44px] rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] hover:from-[#F8DD94] hover:to-[#D4AE58] text-[#0B1628] text-sm font-extrabold transition-all cursor-pointer"
                >
                  ادامه بازی
                </button>
                <button
                  type="button"
                  onClick={onConfirmExit}
                  data-testid="hokm-forfeit-confirm-btn"
                  className="min-h-[44px] rounded-xl bg-[#991B1B]/90 hover:bg-[#B91C1C] border border-[#F87171]/40 text-white text-sm font-extrabold transition-colors cursor-pointer"
                >
                  انصراف و خروج
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Spectacular Full-Screen Match Completion Screen (ONLY when first team reaches 3!) */}
      <AnimatePresence>
        {state.phase === 'MATCH_COMPLETE' &&
          state.handOutcome &&
          state.matchWinner && (
            <HandResultModal
              outcome={state.handOutcome}
              matchScores={state.matchScores}
              targetMatchScore={state.targetMatchScore}
              matchWinner={state.matchWinner}
              onNewMatch={onNewMatch}
              onBackToMenu={onConfirmExit}
              reducedMotion={reducedMotion}
              canStartRematch={canStartRematch}
            />
          )}
      </AnimatePresence>
    </div>
  );
};
