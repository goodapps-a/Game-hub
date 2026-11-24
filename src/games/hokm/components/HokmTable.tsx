import React, { useEffect, useRef, useState } from 'react';
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
import { resolveNextHakem } from '../engine/gameEngine';
import { PlayingCard, SuitIconSvg } from './PlayingCard';
import { TrumpSelector } from './TrumpSelector';
import { HandResultModal } from './HandResultModal';
import { HandWinCelebration } from './HandWinCelebration';
import { CardBackSvg } from './CardBackSvg';
import { PersianCornerOrnament } from '../../../platform/theme/PersianPatterns';
import { toPersianDigits } from '../../../platform/theme/tokens';
import { PLATFORM_ASSETS } from '../../../platform/data/assets';
import {
  EYVAN_CLASSIC_DECK_ID,
  resolveCardBackVisual,
  useDeckRuntimeState,
} from '../../../platform/decks';

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
  southHandOverride?: readonly Card[];
  handGathered?: boolean;
  showGameStartBanner: boolean;
  trickCollectPhase: TrickCollectPhase;
  collectingWinnerTeam: TeamId | null;
  playerName: string;
  tableSkinId?: string;
  deckId?: string;
  reducedMotion: boolean;
  canHumanPlay: boolean;
  exitConfirmOpen: boolean;
  seatPlayers?: Record<Seat, OnlineSeatPlayerMeta>;
  deckCount?: number;
  onlineHud?: OnlineTableHudInfo;
  canStartRematch?: boolean;
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
  backBg?: string;
  backBorder?: string;
}> = ({ count, team, backBg = '#FFFFFF', backBorder = '#C9C4BA' }) => {
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
            className="absolute inset-0 rounded-[5px] p-[1.5px] border shadow-[0_2px_6px_rgba(0,0,0,0.5)]"
            style={{
              backgroundColor: backBg,
              borderColor: backBorder,
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
 * Sized identically to South's cards (`92x130` mobile / `120x168` desktop) and
 * anchored neatly off the viewport edges like classic Hokm salons.
 */
const HiddenHandFan: React.FC<{
  count: number;
  orientation: 'horizontal' | 'vertical';
  side?: 'north' | 'west' | 'east';
  isDesktop?: boolean;
  backBg?: string;
  backBorder?: string;
}> = ({
  count,
  orientation,
  side = 'north',
  isDesktop = false,
  backBg = '#FFFFFF',
  backBorder = '#D4CFC5',
}) => {
  const displayCount = Math.min(count, 13);

  if (orientation === 'horizontal') {
    const mid = (displayCount - 1) / 2;
    return (
      <div
        dir="ltr"
        className="flex items-start justify-center h-[130px] sm:h-[168px] pointer-events-none select-none"
        aria-hidden="true"
      >
        {displayCount > 0 &&
          Array.from({ length: displayCount }).map((_, idx) => {
            const norm = displayCount <= 1 ? 0 : (idx - mid) / Math.max(1, mid);
            const rot = -norm * Math.min(15, (displayCount - 1) * 1.25);
            const arcY = -(norm * norm) * Math.min(18, (displayCount - 1) * 1.45);
            const overlapMargin =
              idx === 0
                ? 0
                : isDesktop
                  ? displayCount > 9
                    ? -91
                    : displayCount > 6
                      ? -82
                      : -72
                  : displayCount > 9
                    ? -71
                    : displayCount > 6
                      ? -64
                      : -56;
            return (
              <div
                key={idx}
                className="w-[92px] h-[130px] sm:w-[120px] sm:h-[168px] rounded-[9px] sm:rounded-[11px] p-[2.5px] sm:p-[3px] overflow-hidden shadow-[0_6px_18px_rgba(0,0,0,0.42)] border shrink-0 transition-transform duration-200"
                style={{
                  backgroundColor: backBg,
                  borderColor: backBorder,
                  marginLeft: overlapMargin,
                  transform: `translateY(${arcY}px) rotate(${rot}deg)`,
                  zIndex: idx,
                }}
              >
                <div className="w-full h-full rounded-[6px] sm:rounded-[8px] overflow-hidden">
                  <CardBackSvg />
                </div>
              </div>
            );
          })}
      </div>
    );
  }

  const visibleStack = Math.min(displayCount, 13);
  const mid = (visibleStack - 1) / 2;
  const dirSign = side === 'west' ? 1 : -1;
  return (
    <div
      className="flex flex-col items-center justify-center w-[130px] sm:w-[168px] pointer-events-none select-none"
      aria-hidden="true"
    >
      {visibleStack > 0 &&
        Array.from({ length: visibleStack }).map((_, idx) => {
          const norm = visibleStack <= 1 ? 0 : (idx - mid) / Math.max(1, mid);
          const rot = dirSign * norm * Math.min(14, (visibleStack - 1) * 1.25);
          const arcX = -dirSign * (norm * norm) * 14;
          const overlapMt =
            idx === 0
              ? 0
              : isDesktop
                ? visibleStack > 9
                  ? -102
                  : visibleStack > 6
                    ? -92
                    : -78
                : visibleStack > 9
                  ? -78
                  : visibleStack > 6
                    ? -70
                    : -60;
          return (
            <div
              key={idx}
              className="w-[130px] h-[92px] sm:w-[168px] sm:h-[120px] rounded-[9px] sm:rounded-[11px] p-[2.5px] sm:p-[3px] overflow-hidden shadow-[0_6px_16px_rgba(0,0,0,0.42)] border shrink-0 flex items-center justify-center transition-transform duration-200"
              style={{
                backgroundColor: backBg,
                borderColor: backBorder,
                marginTop: overlapMt,
                transform: `translateX(${arcX}px) rotate(${rot}deg)`,
                zIndex: idx,
              }}
            >
              <div className="w-[86px] h-[124px] sm:w-[114px] sm:h-[162px] rounded-[6px] sm:rounded-[8px] overflow-hidden rotate-90 shrink-0">
                <CardBackSvg />
              </div>
            </div>
          );
        })}
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

function resolveTableSkinVisual(tableSkinId?: string): {
  imageSrc: string;
  vignette: string;
  railAccent: string;
} {
  if (tableSkinId === 'tt-lapis' || tableSkinId === 'tt-turquoise-palace') {
    return {
      imageSrc: PLATFORM_ASSETS.hokmTableLapis,
      vignette:
        'radial-gradient(ellipse at 50% 48%, rgba(8, 30, 62, 0.10) 0%, rgba(5, 19, 44, 0.42) 72%, rgba(3, 10, 26, 0.78) 100%)',
      railAccent: 'border-[#67D5E8]/45',
    };
  }
  if (tableSkinId === 'tt-tabriz') {
    return {
      imageSrc: PLATFORM_ASSETS.hokmTableRuby,
      vignette:
        'radial-gradient(ellipse at 50% 48%, rgba(58, 12, 24, 0.10) 0%, rgba(36, 7, 15, 0.42) 72%, rgba(20, 4, 9, 0.78) 100%)',
      railAccent: 'border-[#F3D179]/48',
    };
  }
  return {
    imageSrc: PLATFORM_ASSETS.hokmTableTraditional,
    vignette:
      'radial-gradient(ellipse at 50% 48%, rgba(7, 46, 33, 0.08) 0%, rgba(4, 28, 20, 0.40) 72%, rgba(2, 16, 12, 0.76) 100%)',
    railAccent: 'border-[#D4AE58]/42',
  };
}

/**
 * Zero-Lag 60-120fps Direct-DOM Pure Drag-and-Drop Hand Card:
 * - Zero React re-renders during drag (drives transforms via rAF + direct DOM style & dropRingRef dataset).
 * - Pure drag-and-drop ONLY (no tap-to-select).
 * - Out of turn (!canHumanPlay): ALL cards remain vivid, active, and draggable (springing back on release).
 * - On player's turn (canHumanPlay): ONLY legal cards remain bright & draggable;
 *   illegal cards are dimmed and non-draggable!
 */
interface DraggableHandCardProps {
  card: Card;
  idx: number;
  targetX: number;
  fanArcY: number;
  fanRotateDeg: number;
  cardWidthPx: number;
  isLegal: boolean;
  canHumanPlay: boolean;
  handGathered: boolean;
  reducedMotion: boolean;
  dropRingRef: React.RefObject<HTMLDivElement | null>;
  onPlayCard: (cardId: string) => void;
}

const DraggableHandCard: React.FC<DraggableHandCardProps> = React.memo(
  ({
    card,
    idx,
    targetX,
    fanArcY,
    fanRotateDeg,
    cardWidthPx,
    isLegal,
    canHumanPlay,
    handGathered,
    reducedMotion,
    dropRingRef,
    onPlayCard,
  }) => {
    const canPlayNow = canHumanPlay && isLegal && !handGathered;
    // Out of turn: every card stays vivid & draggable (springs back without playing).
    // On player's turn: ONLY legal cards stay vivid & draggable; illegal cards are dimmed & disabled!
    const isCardActive = !canHumanPlay || isLegal;
    const isDraggableNow = isCardActive && !handGathered;

    const slotRef = useRef<HTMLDivElement | null>(null);
    const innerRef = useRef<HTMLDivElement | null>(null);
    const rafIdRef = useRef<number | null>(null);

    const dragStateRef = useRef<{
      active: boolean;
      pointerId: number | null;
      startX: number;
      startY: number;
      anchorDx: number;
      anchorDy: number;
      latestDx: number;
      latestDy: number;
      lastY: number;
      lastTime: number;
      vy: number;
      didDrag: boolean;
      baseY: number;
      canPlayAtStart: boolean;
    }>({
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      anchorDx: 0,
      anchorDy: 0,
      latestDx: 0,
      latestDy: 0,
      lastY: 0,
      lastTime: 0,
      vy: 0,
      didDrag: false,
      baseY: 0,
      canPlayAtStart: false,
    });

    const prevDropStateRef = useRef<{ dragActive: boolean; dropOver: boolean }>({
      dragActive: false,
      dropOver: false,
    });

    const restTransform = `translate3d(0px, ${fanArcY}px, 0px) rotate(${fanRotateDeg}deg) scale(${
      handGathered ? 0.94 : 1
    })`;

    // Keep resting fan transform synced smoothly when NOT actively dragging
    useEffect(() => {
      const el = innerRef.current;
      const slot = slotRef.current;
      if (!el || dragStateRef.current.active) return;
      el.style.transition = reducedMotion
        ? 'none'
        : handGathered
          ? 'transform 360ms cubic-bezier(0.22, 1, 0.36, 1)'
          : 'transform 380ms cubic-bezier(0.16, 1, 0.3, 1)';
      el.style.transform = restTransform;
      if (slot) {
        slot.style.zIndex = String(idx + 1);
      }
    }, [restTransform, reducedMotion, idx, handGathered]);

    // Cleanup any pending animation frame on unmount
    useEffect(() => {
      return () => {
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
      };
    }, []);

    const syncDropRing = (dragActive: boolean, dropOver: boolean) => {
      const prev = prevDropStateRef.current;
      if (prev.dragActive === dragActive && prev.dropOver === dropOver) {
        return;
      }
      prev.dragActive = dragActive;
      prev.dropOver = dropOver;
      const ring = dropRingRef.current;
      if (!ring) return;
      ring.dataset.dragActive = dragActive ? 'true' : 'false';
      ring.dataset.dropOver = dropOver ? 'true' : 'false';
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      // On player's turn, illegal cards are strictly locked and non-draggable!
      if (!isDraggableNow) return;

      e.stopPropagation();
      const el = innerRef.current;
      const slot = slotRef.current;
      if (!el) return;

      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Ignore synthetic events without active pointerId
      }

      dragStateRef.current = {
        active: true,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        anchorDx: 0,
        anchorDy: 0,
        latestDx: 0,
        latestDy: 0,
        lastY: e.clientY,
        lastTime: performance.now(),
        vy: 0,
        didDrag: false,
        baseY: fanArcY,
        canPlayAtStart: canPlayNow,
      };

      // When out of turn (!canHumanPlay), immediately stand card upright (0deg) in its slot without shifting sideways
      if (!canHumanPlay) {
        el.style.transition = reducedMotion
          ? 'none'
          : 'transform 160ms cubic-bezier(0.22, 1, 0.36, 1)';
        el.style.transform = `translate3d(0px, ${fanArcY - 6}px, 0px) rotate(0deg) scale(1.04)`;
        if (slot) {
          slot.style.zIndex = '95';
        }
      }
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      const ds = dragStateRef.current;
      if (!ds.active || ds.pointerId !== e.pointerId) return;

      const dx = e.clientX - ds.startX;
      const dy = e.clientY - ds.startY;
      const now = performance.now();
      const dt = Math.max(8, now - ds.lastTime);
      ds.vy = (e.clientY - ds.lastY) / dt;
      ds.lastY = e.clientY;
      ds.lastTime = now;
      ds.latestDx = dx;
      ds.latestDy = dy;

      if (!ds.didDrag) {
        if (Math.hypot(dx, dy) < 2.5) return;
        ds.didDrag = true;
        ds.anchorDx = dx;
        ds.anchorDy = dy;
      }

      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          const cur = dragStateRef.current;
          if (!cur.active || !cur.didDrag) return;
          const el = innerRef.current;
          const slot = slotRef.current;
          if (!el) return;

          const moveDx = cur.latestDx - cur.anchorDx;
          const moveDy = cur.latestDy - cur.anchorDy;
          const dist = Math.hypot(moveDx, moveDy);
          const t = Math.min(1, dist / 28);
          const easeOut = 1 - (1 - t) * (1 - t);

          if (!canHumanPlay) {
            // Out of turn: card stays anchored in its slot horizontally/vertically & stands cleanly upright at 0deg
            const uprightRot = fanRotateDeg * (1 - easeOut);
            el.style.transition = 'none';
            el.style.transform = `translate3d(0px, ${
              cur.baseY - 6 * Math.max(0.35, easeOut)
            }px, 0px) rotate(${uprightRot.toFixed(2)}deg) scale(${(
              1 +
              0.04 * easeOut
            ).toFixed(4)})`;
            if (slot) {
              slot.style.zIndex = '95';
            }
            return;
          }

          const visualY = moveDy + cur.baseY;
          const targetTilt = Math.max(-12, Math.min(12, moveDx * 0.055));
          const rot = fanRotateDeg + (targetTilt - fanRotateDeg) * easeOut;
          const scale = 1 + 0.075 * easeOut;

          el.style.transition = 'none';
          el.style.transform = `translate3d(${moveDx}px, ${visualY}px, 0px) rotate(${rot.toFixed(
            2
          )}deg) scale(${scale.toFixed(4)})`;
          if (slot) {
            slot.style.zIndex = '95';
          }
          // Measure actual upward drag distance cleanly for ALL cards
          const overNow = cur.canPlayAtStart && moveDy < -48;
          syncDropRing(cur.canPlayAtStart, overNow);
        });
      }
    };

    const finishPointer = (
      e: React.PointerEvent<HTMLDivElement>,
      cancelled: boolean
    ) => {
      const ds = dragStateRef.current;
      if (!ds.active || ds.pointerId !== e.pointerId) return;

      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      const el = innerRef.current;
      const slot = slotRef.current;
      if (el) {
        try {
          if (el.hasPointerCapture(e.pointerId)) {
            el.releasePointerCapture(e.pointerId);
          }
        } catch {
          // Ignore
        }
      }

      const dy = e.clientY - ds.startY - ds.anchorDy;
      const wasDrag = ds.didDrag;
      const vy = ds.vy;

      ds.active = false;
      ds.pointerId = null;
      ds.didDrag = false;
      ds.anchorDx = 0;
      ds.anchorDy = 0;

      syncDropRing(false, false);

      if (wasDrag && canHumanPlay) {
        // Uniform upward drag threshold for EVERY card regardless of fan arc position
        const droppedOnTable =
          !cancelled && (dy < -50 || (vy < -0.35 && dy < -24));

        // Play ONLY if it is the player's turn AND the card is legal
        if (droppedOnTable && canPlayNow) {
          onPlayCard(card.id);
          return;
        }
      }

      // Pure Drag-and-Drop ONLY: tapping or invalid/out-of-turn release springs smoothly back into the fan
      if (el) {
        el.style.transition = reducedMotion
          ? 'none'
          : 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)';
        el.style.transform = restTransform;
      }
      if (slot) {
        slot.style.zIndex = String(idx + 1);
      }
    };

    return (
      <div
        ref={slotRef}
        style={{
          position: 'absolute',
          bottom: 14,
          left: '50%',
          marginLeft: -(cardWidthPx / 2),
          transform: `translate3d(${targetX}px, 0px, 0px)`,
          transition: reducedMotion
            ? 'none'
            : handGathered
              ? 'transform 360ms cubic-bezier(0.22, 1, 0.36, 1)'
              : 'transform 380ms cubic-bezier(0.16, 1, 0.3, 1)',
          zIndex: idx + 1,
        }}
        className="will-change-transform"
      >
        <div
          ref={innerRef}
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(e) => finishPointer(e, false)}
          onPointerCancel={(e) => finishPointer(e, true)}
          role="button"
          tabIndex={canPlayNow ? 0 : -1}
          aria-disabled={!isCardActive}
          data-playable={canPlayNow ? 'true' : 'false'}
          data-visually-dimmed={!isCardActive ? 'true' : 'false'}
          data-card-slot={card.id}
          style={{
            transformOrigin: '50% 72%',
            transform: restTransform,
          }}
          className={`touch-none select-none will-change-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3D179] rounded-[11px] ${
            isCardActive
              ? 'cursor-grab active:cursor-grabbing'
              : 'cursor-not-allowed'
          }`}
        >
          <PlayingCard
            card={card}
            isPlayable={isCardActive}
            size="md"
          />
        </div>
      </div>
    );
  }
);
DraggableHandCard.displayName = 'DraggableHandCard';

export const HokmTable: React.FC<HokmTableProps> = ({
  state,
  visibleHandCounts,
  flyingDealCards,
  isShufflingAnim,
  isDealingAnim,
  southHandOverride,
  handGathered = false,
  showGameStartBanner,
  trickCollectPhase,
  collectingWinnerTeam,
  playerName,
  tableSkinId = 'tt-traditional',
  deckId = EYVAN_CLASSIC_DECK_ID,
  reducedMotion,
  canHumanPlay,
  exitConfirmOpen,
  seatPlayers,
  deckCount,
  onlineHud,
  canStartRematch = true,
  onPlayCard,
  onChooseTrump,
  onRequestExit,
  onCancelExit,
  onConfirmExit,
  onNewMatch,
}) => {
  const dropRingRef = useRef<HTMLDivElement | null>(null);
  const tableSkin = resolveTableSkinVisual(tableSkinId);
  const deckRuntimeState = useDeckRuntimeState();
  const backVisual = resolveCardBackVisual(deckRuntimeState);
  const activeBackBg = backVisual.styleTokens.backBackground ?? '#FFFFFF';
  const activeBackBorder = backVisual.styleTokens.backBorderColor ?? '#D4CFC5';

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

  const southHand =
    southHandOverride ?? state.hands.south.slice(0, visibleHandCounts.south);
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

  // Zero-Overflow Curved Fan Geometry:
  // Computes exact rotated upper-corner bounding extent for transformOrigin(50%, 72%)
  // so ALL 13 cards strictly remain inside even narrow 360px mobile viewports with uniform grab spacing!
  const cardWidthPx = handLayout.isDesktop ? 120 : 92;
  const cardHeightPx = handLayout.isDesktop ? 168 : 130;
  const count = southHand.length;
  const maxAngleDeg = Math.min(
    handLayout.isDesktop ? 20 : 16,
    Math.max(0, (count - 1) * (handLayout.isDesktop ? 1.65 : 1.35))
  );
  const maxArcDropPx = Math.min(
    handLayout.isDesktop ? 40 : 24,
    Math.max(0, (count - 1) * (handLayout.isDesktop ? 3.3 : 2.0))
  );
  const maxAngleRad = (maxAngleDeg * Math.PI) / 180;
  const rotatedHalfExtent = Math.ceil(
    (cardWidthPx / 2) * Math.cos(maxAngleRad) +
      cardHeightPx * 0.72 * Math.sin(maxAngleRad)
  );
  const edgePadPx = handLayout.isDesktop ? 16 : 6;
  const safeHalfSpan = Math.max(
    24,
    Math.floor(handLayout.width / 2 - rotatedHalfExtent - edgePadPx)
  );
  const idealHalfSpan = ((count - 1) * (handLayout.isDesktop ? 52 : 34)) / 2;
  const fanHalfSpan =
    count <= 1
      ? 0
      : Math.min(
          handLayout.isDesktop ? Math.min(safeHalfSpan, 316) : safeHalfSpan,
          idealHalfSpan
        );

  const showTrumpModal =
    state.phase === 'CHOOSING_TRUMP' &&
    state.hakem === 'south' &&
    !isDealingAnim &&
    !isShufflingAnim &&
    !handGathered;

  const nextHakemSeat =
    state.phase === 'HAND_COMPLETE' ? resolveNextHakem(state) : state.hakem;
  const hakemChangedOnHand =
    state.phase === 'HAND_COMPLETE' && nextHakemSeat !== state.hakem;

  return (
    <div
      className="min-h-[100dvh] w-full flex flex-col hokm-traditional-arena text-[#F6F3EC] relative overflow-clip select-none transform-gpu"
      data-testid="hokm-table"
      data-table-skin={tableSkinId}
      data-deck-id={backVisual.deckId || deckId}
      data-phase={state.phase}
      data-turn={state.currentTurn}
    >
      {/* LUXURY HOKM TABLE BACKDROP (Active Skin from Shop or Default Emerald Baize) */}
      <div
        className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
        aria-hidden="true"
      >
        <img
          src={tableSkin.imageSrc}
          alt=""
          decoding="sync"
          loading="eager"
          className="w-full h-full object-cover object-center scale-[1.06] brightness-[0.96] contrast-[1.04]"
        />
        <div
          className="absolute inset-0"
          style={{
            background: tableSkin.vignette,
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

      {/* Main Traditional Salon Arena (Full viewport width so edge opponent card fans clip cleanly off sides) */}
      <main className="flex-1 relative z-10 flex flex-col justify-between px-2 sm:px-6 py-2 sm:py-3 w-full">
        {/* Inlaid Persian Gold & Khatamkari Perimeter Rail */}
        <div
          className={`pointer-events-none absolute inset-1.5 sm:inset-3 max-w-6xl mx-auto rounded-[28px] border-2 ${tableSkin.railAccent} shadow-[inset_0_0_54px_rgba(0,0,0,0.42)]`}
        >
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

        {/* TOP SEAT: North (Partner — Full-size edge-bleeding fan behind SeatProfile) */}
        <section
          className="relative z-10 flex flex-col items-center pt-1.5 sm:pt-2.5 min-h-[78px] sm:min-h-[96px]"
          aria-label={resolvedSeats.north.name}
        >
          <div className="pointer-events-none absolute -top-[82px] sm:-top-[108px] left-1/2 -translate-x-1/2 z-0">
            <HiddenHandFan
              count={visibleHandCounts.north}
              orientation="horizontal"
              isDesktop={handLayout.isDesktop}
              backBg={activeBackBg}
              backBorder={activeBackBorder}
            />
          </div>
          <div className="relative z-20">
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
          </div>
        </section>

        {/* MIDDLE ROW: West (left edge fan), Center Trick Arena, East (right edge fan + opponentTeam pile) */}
        <section
          dir="ltr"
          className="relative z-10 flex-1 grid grid-cols-[88px_1fr_88px] sm:grid-cols-[170px_1fr_170px] items-center gap-1 sm:gap-4 my-1 max-w-6xl w-full mx-auto"
        >
          {/* Full-size West Card Fan anchored flush off viewport LEFT edge */}
          <div className="pointer-events-none fixed left-[-92px] sm:left-[-118px] top-1/2 -translate-y-1/2 z-0">
            <HiddenHandFan
              count={visibleHandCounts.west}
              orientation="vertical"
              side="west"
              isDesktop={handLayout.isDesktop}
              backBg={activeBackBg}
              backBorder={activeBackBorder}
            />
          </div>

          {/* Full-size East Card Fan anchored flush off viewport RIGHT edge */}
          <div className="pointer-events-none fixed right-[-92px] sm:right-[-118px] top-1/2 -translate-y-1/2 z-0">
            <HiddenHandFan
              count={visibleHandCounts.east}
              orientation="vertical"
              side="east"
              isDesktop={handLayout.isDesktop}
              backBg={activeBackBg}
              backBorder={activeBackBorder}
            />
          </div>

          {/* Physical LEFT: West Profile */}
          <div
            dir="rtl"
            className="relative z-20 flex flex-col items-center justify-center pl-7 sm:pl-12"
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
          </div>

          {/* CENTER ARENA */}
          <div
            dir="rtl"
            className="relative min-h-[206px] sm:min-h-[280px] flex flex-col items-center justify-center"
          >
            {/* Interactive Zero-Rerender Drop Ring over Center Table */}
            <div
              ref={dropRingRef}
              data-drag-active="false"
              data-drop-over="false"
              className="w-[192px] h-[192px] sm:w-[268px] sm:h-[268px] rounded-full border border-[#D4AE58]/28 bg-black/8 flex items-center justify-center relative transition-all duration-150 data-[drag-active=true]:border-[#F3D179]/60 data-[drag-active=true]:bg-black/16 data-[drop-over=true]:border-[#F3D179] data-[drop-over=true]:bg-[#F3D179]/18 data-[drop-over=true]:shadow-[0_0_38px_rgba(243,209,121,0.42)] data-[drop-over=true]:scale-[1.05]"
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
                        style={{
                          backgroundColor: activeBackBg,
                          borderColor: activeBackBorder,
                        }}
                        className="absolute inset-0 rounded-[8px] p-[2px] border shadow-lg overflow-hidden"
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
                      style={{
                        backgroundColor: activeBackBg,
                        borderColor: activeBackBorder,
                      }}
                      className="absolute w-[54px] h-[76px] rounded-[7px] p-[1.5px] border shadow-lg overflow-hidden"
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

            {/* TrumpSelector is rendered above the dimmed backdrop at z-50 below */}
          </div>

          {/* Physical RIGHT: East Profile + Opponent Team Pile */}
          <div
            dir="rtl"
            className="relative z-20 flex flex-col items-center justify-center pr-7 sm:pr-12"
            aria-label={resolvedSeats.east.name}
          >
            <div className="relative flex items-center justify-center">
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
              {state.trickCounts.opponentTeam > 0 && (
                <div className="absolute top-1/2 -translate-y-1/2 right-full mr-2 sm:mr-3 pointer-events-none">
                  <TeamTrickPile
                    count={state.trickCounts.opponentTeam}
                    team="opponentTeam"
                    backBg={activeBackBg}
                    backBorder={activeBackBorder}
                  />
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Subtle Focus-Dimming Backdrop behind Trump Selector (keeps bottom 5 cards bright & clear!) */}
        <AnimatePresence>
          {showTrumpModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reducedMotion ? 0.05 : 0.24 }}
              data-testid="trump-selector-backdrop"
              className="fixed inset-0 z-30 bg-[#020A08]/62 backdrop-blur-[2.5px] pointer-events-none"
              aria-hidden="true"
            />
          )}
        </AnimatePresence>

        {/* Enlarged Spotlight Icon-Only Trump Selector — hoisted to z-50 ABOVE the dimmed backdrop */}
        <AnimatePresence>
          {showTrumpModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center pb-28 sm:pb-32 pointer-events-none">
              <div className="pointer-events-auto">
                <TrumpSelector
                  onSelectTrump={onChooseTrump}
                  reducedMotion={reducedMotion}
                />
              </div>
            </div>
          )}
        </AnimatePresence>

        {/* BOTTOM SEAT: Exact Screenshot-1 Deep Radial Curved Fan + Centered Lower-Base South Profile */}
        <section
          className={`relative ${
            showTrumpModal ? 'z-40' : 'z-20'
          } flex flex-col items-center pb-0`}
          aria-label={resolvedSeats.south.name}
        >
          <div
            ref={handContainerRef}
            dir="ltr"
            className="relative w-full h-[168px] sm:h-[208px] overflow-visible touch-none"
            data-testid="south-hand"
          >
            {southHand.map((card, idx) => {
              const mid = (count - 1) / 2;
              const norm = count <= 1 ? 0 : (idx - mid) / Math.max(1, mid);
              const fanRotateDeg = handGathered
                ? Number(((idx - mid) * 0.45).toFixed(2))
                : Number((norm * maxAngleDeg).toFixed(2));
              // Uniform linear X distribution ensures outer left/right cards have the exact same grab area as center cards
              const targetX = handGathered
                ? Math.round((idx - mid) * 1.4)
                : count <= 1
                  ? 0
                  : Math.round(norm * fanHalfSpan);
              const fanArcY = handGathered
                ? Math.round(Math.abs(idx - mid) * 0.45) + 4
                : Math.round(norm * norm * maxArcDropPx) - 10;

              return (
                <DraggableHandCard
                  key={card.id}
                  card={card}
                  idx={idx}
                  targetX={targetX}
                  fanArcY={fanArcY}
                  fanRotateDeg={fanRotateDeg}
                  cardWidthPx={cardWidthPx}
                  isLegal={legalIds.has(card.id)}
                  canHumanPlay={canHumanPlay}
                  handGathered={handGathered}
                  reducedMotion={reducedMotion}
                  dropRingRef={dropRingRef}
                  onPlayCard={onPlayCard}
                />
              );
            })}

            {/* South SeatProfile overlaid neatly at lower-center base of the fan (exactly like Screenshot 1) */}
            <div
              dir="rtl"
              className="pointer-events-none absolute bottom-1 sm:bottom-2 left-1/2 -translate-x-1/2 z-40"
            >
              <SeatProfile
                seat="south"
                displayName={resolvedSeats.south.name}
                avatarSrc={resolvedSeats.south.avatarSrc}
                connected={resolvedSeats.south.connected}
                disconnectRemainingSec={
                  resolvedSeats.south.disconnectRemainingSec
                }
                isTurn={
                  (state.phase === 'PLAYING_TRICK' ||
                    state.phase === 'CHOOSING_TRUMP') &&
                  state.currentTurn === 'south'
                }
                isHakem={state.hakem === 'south'}
              />
            </div>

            {/* My Team Trick Pile anchored cleanly at bottom-left edge */}
            {state.trickCounts.myTeam > 0 && (
              <div className="pointer-events-none absolute left-2 sm:left-5 bottom-2 sm:bottom-4 z-30">
                <TeamTrickPile
                  count={state.trickCounts.myTeam}
                  team="myTeam"
                  backBg={activeBackBg}
                  backBorder={activeBackBorder}
                />
              </div>
            )}
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

      {/* Exciting Hand-Win Celebration Animation (between hands when 7 tricks reached) */}
      <AnimatePresence>
        {state.phase === 'HAND_COMPLETE' && state.handOutcome && (
          <HandWinCelebration
            outcome={state.handOutcome}
            matchScores={state.matchScores}
            nextHakemName={resolvedSeats[nextHakemSeat].name}
            hakemChanged={hakemChangedOnHand}
            reducedMotion={reducedMotion}
          />
        )}
      </AnimatePresence>

      {/* Spectacular Full-Screen Match Completion Screen (ONLY when first team reaches targetMatchScore!) */}
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
