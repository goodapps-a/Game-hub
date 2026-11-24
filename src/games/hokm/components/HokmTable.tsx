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
import { PlayingCard, SuitIconSvg } from './PlayingCard';
import { TrumpSelector } from './TrumpSelector';
import { HandResultModal } from './HandResultModal';
import { HandResetTableAnimation } from './HandResetTableAnimation';
import {
  InGameReactionMenu,
  InGameReactionPayload,
  SeatReactionBubble,
} from './InGameReactionMenu';
import {
  BotProfileModal,
  BotShowcaseProfile,
  OFFLINE_BOT_PROFILES,
} from './BotProfileModal';
import { hokmSound } from '../audio/soundEffects';
import { CardBackSvg } from './CardBackSvg';
import { PersianCornerOrnament } from '../../../platform/theme/PersianPatterns';
import { toPersianDigits } from '../../../platform/theme/tokens';
import { PLATFORM_ASSETS } from '../../../platform/data/assets';
import {
  EYVAN_CLASSIC_DECK_ID,
  resolveCardBackVisual,
  useDeckRuntimeState,
} from '../../../platform/decks';
import {
  getAvatarFrameVisual,
  getGameEffectAccent,
  getProfileBadgeVisual,
  getTableSkinVisual,
} from '../../../platform/items';
import type { SeatPublicAppearance } from '../online/protocol';

export interface FlyingDealCard {
  id: string;
  targetSeat: Seat;
  spinDeg?: number;
}

export type TrickCollectPhase = 'idle' | 'stacking' | 'sliding';

export interface OnlineSeatPlayerMeta {
  name: string;
  avatarSrc: string;
  userId?: string | null;
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
  playerAvatarSrc?: string;
  tableSkinId?: string;
  deckId?: string;
  cardBackId?: string;
  gameEffectId?: string;
  seatAppearances?: Partial<Record<Seat, SeatPublicAppearance>>;
  reducedMotion: boolean;
  canHumanPlay: boolean;
  exitConfirmOpen: boolean;
  seatPlayers?: Record<Seat, OnlineSeatPlayerMeta>;
  deckCount?: number;
  onlineHud?: OnlineTableHudInfo;
  canStartRematch?: boolean;
  onInspectPlayer?: (userId: string) => void;
  onInspectSelf?: () => void;
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

const SEAT_FLY_OFFSETS: Record<
  Seat,
  { x: number; y: number; rotate: number; dealSpin: number; playSpin: number }
> = {
  south: { x: 0, y: 205, rotate: 0, dealSpin: 185, playSpin: -16 },
  north: { x: 0, y: -195, rotate: 180, dealSpin: -185, playSpin: 22 },
  east: { x: 225, y: 0, rotate: -90, dealSpin: 175, playSpin: -28 },
  west: { x: -225, y: 0, rotate: 90, dealSpin: -175, playSpin: 28 },
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
  userId?: string | null;
  onInspectPlayer?: (userId: string) => void;
  onInspectSelf?: () => void;
  onInspectSeat?: (seat: Seat) => void;
  showOnlineDot?: boolean;
  isTurn: boolean;
  isHakem: boolean;
  hakemKey?: string;
  reducedMotion?: boolean;
  connected?: boolean;
  disconnectRemainingSec?: number | null;
  appearance?: SeatPublicAppearance;
}> = ({
  seat,
  displayName,
  avatarSrc,
  userId,
  onInspectPlayer,
  onInspectSeat,
  showOnlineDot = false,
  isTurn,
  isHakem,
  hakemKey = '1',
  reducedMotion = false,
  connected = true,
  disconnectRemainingSec = null,
  appearance,
}) => {
  const frameVisual = appearance?.avatarFrameId
    ? getAvatarFrameVisual(appearance.avatarFrameId)
    : null;
  const badgeVisual = getProfileBadgeVisual(appearance?.badgeId);
  // Mid-game tapping own profile ('south') does NOTHING; only other players open their profile card
  const canInspect = Boolean(
    seat !== 'south' && ((userId && onInspectPlayer) || onInspectSeat)
  );

  const handleOpenProfile = (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation();
    if (seat === 'south') return;
    if (userId && onInspectPlayer) {
      onInspectPlayer(userId);
    } else if (onInspectSeat) {
      onInspectSeat(seat);
    }
  };

  return (
    <div
      className={`relative inline-flex flex-col items-center select-none shrink-0 ${
        canInspect
          ? 'pointer-events-auto cursor-pointer active:opacity-90'
          : 'pointer-events-none'
      }`}
      role={canInspect ? 'button' : undefined}
      tabIndex={canInspect ? 0 : undefined}
      onClick={canInspect ? (e) => handleOpenProfile(e) : undefined}
      onKeyDown={
        canInspect
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleOpenProfile(e);
              }
            }
          : undefined
      }
      data-seat={seat}
      data-testid={`seat-profile-${seat}`}
      data-active-turn={isTurn ? 'true' : 'false'}
      data-connected={connected ? 'true' : 'false'}
      data-seat-deck={appearance?.deckId ?? undefined}
      data-avatar-frame={appearance?.avatarFrameId ?? undefined}
      data-profile-badge={appearance?.badgeId ?? undefined}
    >
      {/* Enlarged Circular Avatar Medallion (zero layout-shift scale during dealing) */}
      <div className="relative w-14 h-14 sm:w-16 sm:h-16 shrink-0">
        {isTurn && connected && (
          <span
            className="absolute -inset-2 rounded-full bg-[#F3D179]/34 blur-[7px] animate-pulse pointer-events-none"
            aria-hidden="true"
          />
        )}
        <div
          className={`relative w-14 h-14 sm:w-16 sm:h-16 rounded-full overflow-hidden border-[2.5px] bg-[#0B1E1A] transition-colors duration-200 ${
            !connected
              ? 'border-[#F59E0B] opacity-70 grayscale-[0.4]'
              : isTurn
                ? 'border-[#F3D179] shadow-[0_0_24px_rgba(243,209,121,0.78)]'
                : 'border-[#D4AE58]/65 shadow-[0_5px_14px_rgba(0,0,0,0.48)]'
          }`}
          style={
            connected && !isTurn && frameVisual
              ? {
                  borderColor: frameVisual.ringColor,
                  boxShadow: `0 0 16px ${frameVisual.glowColor}`,
                }
              : undefined
          }
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

        {/* Live Online Green Dot (Online Hokm Only — vanishes immediately on disconnect) */}
        {showOnlineDot && connected && (
          <span
            data-testid={`seat-online-dot-${seat}`}
            aria-label="آنلاین"
            className="absolute bottom-0.5 right-0.5 z-20 w-3.5 h-3.5 rounded-full bg-[#22C55E] border-[2.5px] border-[#061814] shadow-[0_0_9px_rgba(34,197,94,0.9)]"
          />
        )}

        {/* Eye-Catching Gleaming Golden Hakem Crown perched cleanly on top rim */}
        {isHakem && (
          <motion.span
            key={`hakem-crown-${seat}-${hakemKey}`}
            data-testid={`hakem-crown-${seat}`}
            initial={
              reducedMotion
                ? false
                : { scale: 0.45, y: -12, rotate: -18, opacity: 0 }
            }
            animate={{ scale: 1, y: 0, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 360, damping: 18 }}
            className="absolute -top-4 left-1/2 -translate-x-1/2 z-20 w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-gradient-to-b from-[#295A4B] via-[#13332B] to-[#081A16] border-2 border-[#FEF08A] flex items-center justify-center shadow-[0_3px_16px_rgba(0,0,0,0.72),0_0_22px_rgba(253,224,71,0.82)]"
            aria-label="حاکم"
          >
            {/* Entrance Golden Sunburst Flare so everyone immediately notices the Hakem */}
            {!reducedMotion && (
              <>
                <motion.span
                  aria-hidden="true"
                  initial={{ scale: 0.6, opacity: 1 }}
                  animate={{ scale: 2.9, opacity: 0 }}
                  transition={{ duration: 0.95, ease: 'easeOut' }}
                  className="pointer-events-none absolute inset-0 rounded-full border-2 border-[#FEF08A] shadow-[0_0_24px_rgba(253,224,71,0.95)]"
                />
                <motion.span
                  aria-hidden="true"
                  initial={{ scale: 0.5, opacity: 0.95 }}
                  animate={{ scale: 2.3, opacity: 0 }}
                  transition={{ duration: 0.72, ease: 'easeOut' }}
                  className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.95)_0%,rgba(254,240,138,0.75)_45%,transparent_75%)]"
                />
                <motion.span
                  aria-hidden="true"
                  animate={{ opacity: [0.32, 0.82, 0.32], scale: [1, 1.24, 1] }}
                  transition={{ duration: 2.1, repeat: Infinity, ease: 'easeInOut' }}
                  className="pointer-events-none absolute -inset-1 rounded-full bg-[#FEF08A]/35 blur-[5px]"
                />
              </>
            )}
            <Crown className="relative z-10 w-5 h-5 sm:w-[22px] sm:h-[22px] text-[#FEF08A] fill-[#F5C542] drop-shadow-[0_0_8px_rgba(253,224,71,0.9)]" />
          </motion.span>
        )}
      </div>

      {/* Uniform Centered Dark-Glass Username Plate overlapping bottom edge of ring */}
      <div
        className={`relative z-10 -mt-2 px-3 py-[3px] rounded-full border backdrop-blur-md transition-colors duration-200 flex items-center gap-1 ${
          !connected
            ? 'bg-[#3B1D0A]/95 border-[#F59E0B] shadow-[0_2px_8px_rgba(0,0,0,0.5)]'
            : isTurn
              ? 'bg-[#0E2B24]/95 border-[#F3D179] shadow-[0_3px_10px_rgba(0,0,0,0.5)]'
              : 'bg-[#061814]/88 border-[#D4AE58]/45 shadow-[0_2px_8px_rgba(0,0,0,0.42)]'
        }`}
      >
        <span
          dir="ltr"
          className="block text-[11px] sm:text-xs font-extrabold tracking-tight text-[#FAF6EE] truncate max-w-[92px] sm:max-w-[126px] text-center leading-tight"
        >
          {displayName}
        </span>
        {badgeVisual && (
          <span
            title={badgeVisual.label}
            style={{ color: badgeVisual.color }}
            className="text-[10px] font-black shrink-0"
          >
            {badgeVisual.symbol}
          </span>
        )}
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
 * Strictly face-down card backs for opponent & partner hands.
 * Sized identically to South's cards (`92x130` mobile / `120x168` desktop) and
 * anchored neatly off the viewport edges like classic Hokm salons.
 */
const HiddenHandFan: React.FC<{
  count: number;
  orientation: 'horizontal' | 'vertical';
  side?: 'north' | 'west' | 'east';
  isDesktop?: boolean;
  deckId?: string;
  cardBackId?: string;
  backBg?: string;
  backBorder?: string;
}> = ({
  count,
  orientation,
  side = 'north',
  isDesktop = false,
  deckId,
  cardBackId,
  backBg = '#EFECE3',
  backBorder = '#C9C3B4',
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
                className="w-[92px] h-[130px] sm:w-[120px] sm:h-[168px] rounded-[6px] sm:rounded-[8px] p-[2.5px] sm:p-[3px] overflow-hidden shadow-[0_6px_18px_rgba(0,0,0,0.42)] border shrink-0 transition-transform duration-200"
                style={{
                  backgroundColor: backBg,
                  borderColor: backBorder,
                  marginLeft: overlapMargin,
                  transform: `translateY(${arcY}px) rotate(${rot}deg)`,
                  zIndex: idx,
                }}
              >
                <div className="w-full h-full rounded-[4px] sm:rounded-[6px] overflow-hidden">
                  <CardBackSvg deckId={deckId} cardBackId={cardBackId} />
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
              className="w-[130px] h-[92px] sm:w-[168px] sm:h-[120px] rounded-[6px] sm:rounded-[8px] p-[2.5px] sm:p-[3px] overflow-hidden shadow-[0_6px_16px_rgba(0,0,0,0.42)] border shrink-0 flex items-center justify-center transition-transform duration-200"
              style={{
                backgroundColor: backBg,
                borderColor: backBorder,
                marginTop: overlapMt,
                transform: `translateX(${arcX}px) rotate(${rot}deg)`,
                zIndex: idx,
              }}
            >
              <div className="w-[86px] h-[124px] sm:w-[114px] sm:h-[162px] rounded-[4px] sm:rounded-[6px] overflow-hidden rotate-90 shrink-0">
                <CardBackSvg deckId={deckId} cardBackId={cardBackId} />
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
const TrickLedPip: React.FC<{
  lit: boolean;
  team: 'myTeam' | 'opponentTeam';
  reducedMotion: boolean;
  flashPulse?: boolean;
  pipRef?: (el: HTMLSpanElement | null) => void;
}> = ({ lit, team, reducedMotion, flashPulse = false, pipRef }) => {
  const isMy = team === 'myTeam';
  const ringBorder = isMy ? 'border-[#A7F3D0]' : 'border-[#FECDD3]';
  const activeHex = isMy ? '#34D399' : '#FB7185';
  const activeGlow = isMy
    ? '0 0 11px 2px rgba(52,211,153,0.92)'
    : '0 0 11px 2px rgba(251,113,133,0.92)';
  const burstGlow = isMy
    ? '0 0 24px 8px rgba(110,231,183,1)'
    : '0 0 24px 8px rgba(253,164,175,1)';

  return (
    <span
      ref={pipRef}
      className="relative inline-flex items-center justify-center w-[9.5px] h-[9.5px] sm:w-3 sm:h-3"
    >
      {flashPulse && !reducedMotion && (
        <>
          <motion.span
            initial={{ scale: 0.7, opacity: 1 }}
            animate={{ scale: 4.6, opacity: 0 }}
            transition={{ duration: 0.78, ease: 'easeOut' }}
            className={`pointer-events-none absolute inset-0 rounded-full border-2 ${ringBorder}`}
            aria-hidden="true"
          />
          <motion.span
            initial={{ scale: 0.6, opacity: 1 }}
            animate={{ scale: 3.4, opacity: 0 }}
            transition={{ duration: 0.54, ease: 'easeOut' }}
            className="pointer-events-none absolute inset-0 rounded-full bg-white blur-[2px]"
            aria-hidden="true"
          />
        </>
      )}
      <motion.span
        animate={
          lit
            ? {
                scale: flashPulse && !reducedMotion ? [1.95, 1.1] : 1.08,
                backgroundColor:
                  flashPulse && !reducedMotion ? ['#FFFFFF', activeHex] : activeHex,
                boxShadow:
                  flashPulse && !reducedMotion ? [burstGlow, activeGlow] : activeGlow,
              }
            : {
                scale: 1,
                backgroundColor: 'rgba(255,255,255,0.16)',
                boxShadow: '0 0 0px 0px rgba(0,0,0,0)',
              }
        }
        transition={{ duration: reducedMotion ? 0.05 : 0.48, ease: [0.18, 1, 0.3, 1] }}
        className="w-full h-full rounded-full"
      />
    </span>
  );
};

const RoyalScoreboard: React.FC<{
  state: HokmState;
  reducedMotion: boolean;
  trumpSlotRef: React.RefObject<HTMLDivElement | null>;
  myScoreRef: React.RefObject<HTMLDivElement | null>;
  oppScoreRef: React.RefObject<HTMLDivElement | null>;
  registerPipRef: (team: TeamId, index: number, el: HTMLSpanElement | null) => void;
  activePipFlash: { team: TeamId; index: number } | null;
  pendingOrbPip: { team: TeamId; index: number } | null;
  activeScoreFlashTeam: TeamId | null;
  hideTrumpUntilLanded: boolean;
  onRequestExit: () => void;
}> = ({
  state,
  reducedMotion,
  trumpSlotRef,
  myScoreRef,
  oppScoreRef,
  registerPipRef,
  activePipFlash,
  pendingOrbPip,
  activeScoreFlashTeam,
  hideTrumpUntilLanded,
  onRequestExit,
}) => {
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
          {/* 7-Trick Pip Progress Bar (newly won pip lights right as flying orb merges in) */}
          <div
            className="flex items-center gap-[4px] sm:gap-1.5 mt-1.5"
            data-testid="tricks-pips-myTeam"
            data-tricks={state.trickCounts.myTeam}
            aria-label={`دست‌های برده تیم ما: ${toPersianDigits(state.trickCounts.myTeam)} از ۷`}
          >
            {Array.from({ length: 7 }).map((_, i) => {
              const isHeldForOrb =
                pendingOrbPip?.team === 'myTeam' && pendingOrbPip.index === i;
              return (
                <TrickLedPip
                  key={i}
                  lit={i < state.trickCounts.myTeam && !isHeldForOrb}
                  team="myTeam"
                  reducedMotion={reducedMotion}
                  flashPulse={
                    activePipFlash?.team === 'myTeam' &&
                    activePipFlash.index === i
                  }
                  pipRef={(el) => registerPipRef('myTeam', i, el)}
                />
              );
            })}
          </div>
        </div>

        {/* Big Main Number = Match Rounds Won (zero key-remount jitter) */}
        <motion.div
          ref={myScoreRef}
          animate={
            activeScoreFlashTeam === 'myTeam' && !reducedMotion
              ? {
                  scale: [1, 1.38, 1],
                  boxShadow: [
                    '0 0 0px 0px rgba(110,231,183,0)',
                    '0 0 32px 8px rgba(110,231,183,0.92)',
                    '0 0 0px 0px rgba(110,231,183,0)',
                  ],
                }
              : { scale: 1, boxShadow: '0 0 0px 0px rgba(0,0,0,0)' }
          }
          transition={{ duration: 0.62, ease: [0.18, 1, 0.3, 1] }}
          data-testid="match-score-myTeam"
          className="min-w-[38px] sm:min-w-[48px] h-10 sm:h-12 rounded-xl bg-[#0F382E] border border-[#34D399]/60 flex items-center justify-center text-xl sm:text-2xl font-black text-[#FFFFFF] tabular-nums shadow-inner"
        >
          {toPersianDigits(state.matchScores.myTeam)}
        </motion.div>
      </div>

      {/* CENTER ORNATE TRUMP MEDALLION (Pure Icon-Only + Temporary Back Trigger) */}
      <div
        ref={trumpSlotRef}
        className="relative flex items-center justify-center px-1 sm:px-2 shrink-0"
      >
        <button
          type="button"
          onClick={onRequestExit}
          data-testid="scoreboard-trump-back-btn"
          aria-label="خروج از بازی"
          className="rounded-full cursor-pointer transition-transform active:scale-92 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3D179]"
        >
          {state.trumpSuit && !hideTrumpUntilLanded ? (
            <motion.div
              key={state.trumpSuit}
              data-testid="trump-indicator"
              initial={reducedMotion ? false : { scale: 1.24 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 360, damping: 22 }}
              className="w-11 h-11 sm:w-14 sm:h-14 rounded-full bg-[#FFFFFF] border-[2.5px] border-[#F3D179] shadow-[0_0_24px_rgba(243,209,121,0.65)] hover:shadow-[0_0_28px_rgba(243,209,121,0.82)] flex items-center justify-center shrink-0"
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
        {/* Big Main Number = Match Rounds Won (zero key-remount jitter) */}
        <motion.div
          ref={oppScoreRef}
          animate={
            activeScoreFlashTeam === 'opponentTeam' && !reducedMotion
              ? {
                  scale: [1, 1.38, 1],
                  boxShadow: [
                    '0 0 0px 0px rgba(251,113,133,0)',
                    '0 0 32px 8px rgba(251,113,133,0.92)',
                    '0 0 0px 0px rgba(251,113,133,0)',
                  ],
                }
              : { scale: 1, boxShadow: '0 0 0px 0px rgba(0,0,0,0)' }
          }
          transition={{ duration: 0.62, ease: [0.18, 1, 0.3, 1] }}
          data-testid="match-score-opponentTeam"
          className="min-w-[38px] sm:min-w-[48px] h-10 sm:h-12 rounded-xl bg-[#3B161C] border border-[#FB7185]/60 flex items-center justify-center text-xl sm:text-2xl font-black text-[#FFFFFF] tabular-nums shadow-inner"
        >
          {toPersianDigits(state.matchScores.opponentTeam)}
        </motion.div>

        <div className="flex flex-col items-start">
          <span className="text-xs sm:text-sm font-extrabold text-[#FCA5A5] whitespace-nowrap">
            حریف
          </span>
          {/* 7-Trick Pip Progress Bar */}
          <div
            className="flex items-center gap-[4px] sm:gap-1.5 mt-1.5"
            data-testid="tricks-pips-opponentTeam"
            data-tricks={state.trickCounts.opponentTeam}
            aria-label={`دست‌های برده حریف: ${toPersianDigits(state.trickCounts.opponentTeam)} از ۷`}
          >
            {Array.from({ length: 7 }).map((_, i) => {
              const isHeldForOrb =
                pendingOrbPip?.team === 'opponentTeam' &&
                pendingOrbPip.index === i;
              return (
                <TrickLedPip
                  key={i}
                  lit={i < state.trickCounts.opponentTeam && !isHeldForOrb}
                  team="opponentTeam"
                  reducedMotion={reducedMotion}
                  flashPulse={
                    activePipFlash?.team === 'opponentTeam' &&
                    activePipFlash.index === i
                  }
                  pipRef={(el) => registerPipRef('opponentTeam', i, el)}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

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
  deckId?: string;
  isLegal: boolean;
  isSelected: boolean;
  canHumanPlay: boolean;
  handGathered: boolean;
  reducedMotion: boolean;
  dropRingRef: React.RefObject<HTMLDivElement | null>;
  onSelectCard: (cardId: string | null) => void;
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
    deckId,
    isLegal,
    isSelected,
    canHumanPlay,
    handGathered,
    reducedMotion,
    dropRingRef,
    onSelectCard,
    onPlayCard,
  }) => {
    const canPlayNow = canHumanPlay && isLegal && !handGathered;
    const isCardActive = !canHumanPlay || isLegal;
    const isDraggableNow = isCardActive && !handGathered;
    const selectedActive = isSelected && canPlayNow;

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

    // Tap-to-Select elevates the card cleanly IN ITS OWN FAN SLOT (never jumping in front of neighbors!)
    const restTransform = selectedActive
      ? `translate3d(0px, ${fanArcY - 20}px, 0px) rotate(${fanRotateDeg}deg) scale(1.03)`
      : `translate3d(0px, ${fanArcY}px, 0px) rotate(${fanRotateDeg}deg) scale(${
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
          : 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1)';
      el.style.transform = restTransform;
      if (slot) {
        // Strictly preserve slot z-order when selected so neighboring cards stay naturally layered!
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
          onSelectCard(null);
          onPlayCard(card.id);
          return;
        }
      } else if (!wasDrag && !cancelled && canPlayNow) {
        // Tap-to-select + 2nd-tap-to-play alongside Drag-and-Drop!
        if (selectedActive) {
          onSelectCard(null);
          onPlayCard(card.id);
          return;
        }
        hokmSound.playCardSelect();
        onSelectCard(card.id);
        return;
      }

      // Snap smoothly back into resting/selected slot
      if (el) {
        el.style.transition = reducedMotion
          ? 'none'
          : 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1)';
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
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (!canPlayNow) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              if (selectedActive) {
                onSelectCard(null);
                onPlayCard(card.id);
              } else {
                hokmSound.playCardSelect();
                onSelectCard(card.id);
              }
            }
          }}
          role="button"
          tabIndex={canPlayNow ? 0 : -1}
          aria-disabled={!isCardActive}
          aria-pressed={selectedActive}
          data-playable={canPlayNow ? 'true' : 'false'}
          data-selected={selectedActive ? 'true' : 'false'}
          data-visually-dimmed={!isCardActive ? 'true' : 'false'}
          data-card-slot={card.id}
          style={{
            transformOrigin: '50% 72%',
            transform: restTransform,
          }}
          className={`touch-none select-none will-change-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3D179] rounded-[6px] sm:rounded-[8px] ${
            selectedActive
              ? 'ring-2 ring-[#FDE68A] shadow-[0_14px_30px_rgba(243,209,121,0.52)]'
              : ''
          } ${
            isCardActive
              ? 'cursor-grab active:cursor-grabbing'
              : 'cursor-not-allowed'
          }`}
        >
          <PlayingCard
            card={card}
            deckId={deckId}
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
  playerAvatarSrc,
  tableSkinId = 'tt-traditional',
  deckId = EYVAN_CLASSIC_DECK_ID,
  cardBackId,
  gameEffectId,
  seatAppearances,
  reducedMotion,
  canHumanPlay,
  exitConfirmOpen,
  seatPlayers,
  deckCount,
  onlineHud,
  canStartRematch = true,
  onInspectPlayer,
  onInspectSelf,
  onPlayCard,
  onChooseTrump,
  onRequestExit,
  onCancelExit,
  onConfirmExit,
  onNewMatch,
}) => {
  const dropRingRef = useRef<HTMLDivElement | null>(null);
  const trumpSlotRef = useRef<HTMLDivElement | null>(null);
  const myScoreRef = useRef<HTMLDivElement | null>(null);
  const oppScoreRef = useRef<HTMLDivElement | null>(null);
  const pipRefs = useRef<Record<string, HTMLSpanElement | null>>({});

  const registerPipRef = (
    team: TeamId,
    index: number,
    el: HTMLSpanElement | null
  ) => {
    pipRefs.current[`${team}-${index}`] = el;
  };

  // Selected card for Tap-to-Select + 2nd-Tap-to-Play (coexists with Drag-to-Play)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  useEffect(() => {
    if (!canHumanPlay || handGathered) {
      setSelectedCardId(null);
    }
  }, [canHumanPlay, handGathered, state.hands.south.length]);

  // Offline Bot Profile inspection modal (so tapping ANY player avatar mid-game always works!)
  const [inspectedBot, setInspectedBot] = useState<BotShowcaseProfile | null>(
    null
  );
  const handleInspectSeatFallback = (seat: Seat) => {
    if (seat === 'south') return;
    setInspectedBot(OFFLINE_BOT_PROFILES[seat]);
  };

  // In-game Quick Reactions (messages, emojis, Persian voice callouts)
  const [southReaction, setSouthReaction] =
    useState<InGameReactionPayload | null>(null);
  const southReactionTimerRef = useRef<number | null>(null);
  const handleSendReaction = (payload: InGameReactionPayload) => {
    setSouthReaction(payload);
    if (southReactionTimerRef.current !== null) {
      window.clearTimeout(southReactionTimerRef.current);
    }
    southReactionTimerRef.current = window.setTimeout(() => {
      setSouthReaction(null);
      southReactionTimerRef.current = null;
    }, 3200);
  };
  useEffect(() => {
    return () => {
      if (southReactionTimerRef.current !== null) {
        window.clearTimeout(southReactionTimerRef.current);
      }
    };
  }, []);

  // Flying Glowing Trick Light Orb from table center -> newly lit Scoreboard Pip
  const prevTricksRef = useRef<{ myTeam: number; opponentTeam: number }>({
    myTeam: state.trickCounts.myTeam,
    opponentTeam: state.trickCounts.opponentTeam,
  });
  const [flyingTrickOrb, setFlyingTrickOrb] = useState<{
    key: string;
    team: TeamId;
    pipIndex: number;
    xs: number[];
    ys: number[];
  } | null>(null);
  const [pendingOrbPip, setPendingOrbPip] = useState<{
    team: TeamId;
    index: number;
  } | null>(null);
  const [activePipFlash, setActivePipFlash] = useState<{
    team: TeamId;
    index: number;
  } | null>(null);
  const [activeScoreFlashTeam, setActiveScoreFlashTeam] =
    useState<TeamId | null>(null);

  useEffect(() => {
    const prev = prevTricksRef.current;
    const curMy = state.trickCounts.myTeam;
    const curOpp = state.trickCounts.opponentTeam;
    prevTricksRef.current = { myTeam: curMy, opponentTeam: curOpp };

    let winnerTeam: TeamId | null = null;
    let pipIdx = -1;
    if (curMy > prev.myTeam) {
      winnerTeam = 'myTeam';
      pipIdx = Math.min(6, curMy - 1);
    } else if (curOpp > prev.opponentTeam) {
      winnerTeam = 'opponentTeam';
      pipIdx = Math.min(6, curOpp - 1);
    }

    if (!winnerTeam || pipIdx < 0 || typeof window === 'undefined') {
      if (curMy === 0 && curOpp === 0) {
        setFlyingTrickOrb(null);
        setPendingOrbPip(null);
        setActivePipFlash(null);
      }
      return;
    }

    if (reducedMotion) {
      setPendingOrbPip(null);
      setActivePipFlash({ team: winnerTeam, index: pipIdx });
      const tid = window.setTimeout(() => setActivePipFlash(null), 650);
      return () => window.clearTimeout(tid);
    }

    const pipEl = pipRefs.current[`${winnerTeam}-${pipIdx}`];
    const rect = pipEl?.getBoundingClientRect();
    const startX = window.innerWidth / 2 - 16;
    const startY = window.innerHeight * 0.46 - 16;
    const targetX =
      (rect
        ? rect.left + rect.width / 2
        : window.innerWidth * (winnerTeam === 'myTeam' ? 0.65 : 0.35)) - 16;
    const targetY = (rect ? rect.top + rect.height / 2 : 34) - 16;

    // Sample a smooth 12-point quadratic Bézier arc with eased progression so flight is silky & curved
    const ctrlX =
      (startX + targetX) * 0.5 + (winnerTeam === 'myTeam' ? 44 : -44);
    const ctrlY = Math.min(startY, targetY) + Math.abs(startY - targetY) * 0.36;
    const steps = 12;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const t = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      const inv = 1 - t;
      xs.push(inv * inv * startX + 2 * inv * t * ctrlX + t * t * targetX);
      ys.push(inv * inv * startY + 2 * inv * t * ctrlY + t * t * targetY);
    }

    const orbKey = `${winnerTeam}-${pipIdx}-${Date.now()}`;
    setPendingOrbPip({ team: winnerTeam, index: pipIdx });
    setFlyingTrickOrb({
      key: orbKey,
      team: winnerTeam,
      pipIndex: pipIdx,
      xs,
      ys,
    });

    const tLand = window.setTimeout(() => {
      setPendingOrbPip(null);
      setActivePipFlash({ team: winnerTeam!, index: pipIdx });
      hokmSound.playScoreOrbLand(winnerTeam === 'myTeam');
    }, 540);

    const tClearOrb = window.setTimeout(() => {
      setFlyingTrickOrb((cur) => (cur?.key === orbKey ? null : cur));
    }, 610);

    const tClearFlash = window.setTimeout(() => {
      setActivePipFlash(null);
    }, 1260);

    return () => {
      window.clearTimeout(tLand);
      window.clearTimeout(tClearOrb);
      window.clearTimeout(tClearFlash);
    };
  }, [reducedMotion, state.trickCounts.myTeam, state.trickCounts.opponentTeam]);

  // Flying trump suit animation state (from table center -> scoreboard trump medallion)
  const prevTrumpRef = useRef<Suit | null>(state.trumpSuit);
  const [flyingTrump, setFlyingTrump] = useState<{
    suit: Suit;
    startX: number;
    startY: number;
    targetX: number;
    targetY: number;
  } | null>(null);

  useEffect(() => {
    const prev = prevTrumpRef.current;
    prevTrumpRef.current = state.trumpSuit;
    if (!prev && state.trumpSuit && !reducedMotion && typeof window !== 'undefined') {
      const slotRect = trumpSlotRef.current?.getBoundingClientRect();
      const targetX = slotRect
        ? slotRect.left + slotRect.width / 2
        : window.innerWidth / 2;
      const targetY = slotRect ? slotRect.top + slotRect.height / 2 : 34;
      const startX = window.innerWidth / 2;
      const startY = window.innerHeight * 0.44;
      setFlyingTrump({
        suit: state.trumpSuit,
        startX,
        startY,
        targetX,
        targetY,
      });
      const tid = window.setTimeout(() => {
        setFlyingTrump(null);
      }, 640);
      return () => window.clearTimeout(tid);
    }
    if (!state.trumpSuit) {
      setFlyingTrump(null);
    }
  }, [reducedMotion, state.trumpSuit]);

  // Exaggerated ZERO-TEXT Trump Cut ("بریدن") visual burst detector
  const lastCutCardIdRef = useRef<string | null>(null);
  const [trumpCutBurst, setTrumpCutBurst] = useState<{
    id: string;
    suit: Suit;
    seat: Seat;
  } | null>(null);

  useEffect(() => {
    if (
      reducedMotion ||
      !state.trumpSuit ||
      state.currentTrick.length < 2
    ) {
      if (state.currentTrick.length === 0) {
        lastCutCardIdRef.current = null;
      }
      return;
    }
    const leadSuit = state.currentTrick[0].card.suit;
    const latestPlay = state.currentTrick[state.currentTrick.length - 1];
    if (
      leadSuit !== state.trumpSuit &&
      latestPlay.card.suit === state.trumpSuit &&
      lastCutCardIdRef.current !== latestPlay.card.id
    ) {
      lastCutCardIdRef.current = latestPlay.card.id;
      setTrumpCutBurst({
        id: latestPlay.card.id,
        suit: state.trumpSuit,
        seat: latestPlay.seat,
      });
      const tid = window.setTimeout(() => {
        setTrumpCutBurst((cur) =>
          cur?.id === latestPlay.card.id ? null : cur
        );
      }, 920);
      return () => window.clearTimeout(tid);
    }
  }, [reducedMotion, state.currentTrick, state.trumpSuit]);

  // Owner-only visual: tableSkin ALWAYS comes strictly from local player's own equipped skin
  const tableSkin = getTableSkinVisual(tableSkinId);
  const effectAccent = getGameEffectAccent(gameEffectId);

  const southDeckId = seatAppearances?.south?.deckId ?? deckId;
  const northDeckId = seatAppearances?.north?.deckId ?? deckId;
  const eastDeckId = seatAppearances?.east?.deckId ?? deckId;
  const westDeckId = seatAppearances?.west?.deckId ?? deckId;

  const southCardBackId = seatAppearances?.south?.cardBackId ?? cardBackId;
  const northCardBackId = seatAppearances?.north?.cardBackId ?? undefined;
  const eastCardBackId = seatAppearances?.east?.cardBackId ?? undefined;
  const westCardBackId = seatAppearances?.west?.cardBackId ?? undefined;

  const southRuntime = useDeckRuntimeState(southDeckId);
  const northRuntime = useDeckRuntimeState(northDeckId);
  const eastRuntime = useDeckRuntimeState(eastDeckId);
  const westRuntime = useDeckRuntimeState(westDeckId);

  const southBackVisual = resolveCardBackVisual(southRuntime);
  const northBackVisual = resolveCardBackVisual(northRuntime);
  const eastBackVisual = resolveCardBackVisual(eastRuntime);
  const westBackVisual = resolveCardBackVisual(westRuntime);

  const seatDeckMap: Record<Seat, string> = {
    south: southDeckId,
    north: northDeckId,
    east: eastDeckId,
    west: westDeckId,
  };
  const seatCardBackMap: Record<Seat, string | undefined> = {
    south: southCardBackId,
    north: northCardBackId,
    east: eastCardBackId,
    west: westCardBackId,
  };

  const activeBackBg =
    !southBackVisual.styleTokens.backBackground ||
    southBackVisual.styleTokens.backBackground.toUpperCase() === '#FFFFFF'
      ? '#EFECE3'
      : southBackVisual.styleTokens.backBackground;
  const activeBackBorder =
    !southBackVisual.styleTokens.backBorderColor ||
    southBackVisual.styleTokens.backBorderColor.toUpperCase() === '#D4CFC5'
      ? '#C9C3B4'
      : southBackVisual.styleTokens.backBorderColor;

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

  const isHandResetThrowing = state.phase === 'HAND_COMPLETE';
  const southHand = isHandResetThrowing
    ? []
    : southHandOverride ?? state.hands.south.slice(0, visibleHandCounts.south);
  const effectiveVisibleCounts: Record<Seat, number> = isHandResetThrowing
    ? { south: 0, east: 0, north: 0, west: 0 }
    : visibleHandCounts;
  const legalIds = new Set(
    canHumanPlay
      ? getLegalCards(state.hands.south, state.currentTrick).map((c) => c.id)
      : []
  );

  const effectiveDeckCount = deckCount ?? state.deck.length;
  const showDeckOnTable =
    isShufflingAnim ||
    state.phase === 'SHUFFLING' ||
    state.phase === 'DEALING_INITIAL_5' ||
    state.phase === 'DEALING_REMAINING_8' ||
    effectiveDeckCount > 0;
  const deckStackLayers = isShufflingAnim
    ? 5
    : effectiveDeckCount > 0
      ? Math.min(5, Math.max(1, Math.ceil(effectiveDeckCount / 10)))
      : 0;

  const resolvedSeats: Record<Seat, OnlineSeatPlayerMeta> = {
    south: seatPlayers?.south ?? {
      name: playerName,
      avatarSrc: playerAvatarSrc || SEAT_AVATARS.south,
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

  // Target screen coordinates for flying match score badge when a hand ends
  const handResetTargetScoreRect = (() => {
    if (state.phase !== 'HAND_COMPLETE' || !state.handOutcome) return null;
    const el =
      state.handOutcome.winningTeam === 'myTeam'
        ? myScoreRef.current
        : oppScoreRef.current;
    const rect = el?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  })();

  // Keep unused prop referenced cleanly for TypeScript compatibility
  void showGameStartBanner;

  return (
    <motion.div
      animate={
        trumpCutBurst && !reducedMotion
          ? {
              x: [0, -11, 10, -8, 6, -4, 2, 0],
              y: [0, 8, -7, 5, -4, 2, -1, 0],
              rotate: [0, -0.65, 0.55, -0.4, 0.25, -0.12, 0],
            }
          : { x: 0, y: 0, rotate: 0 }
      }
      transition={{ duration: 0.46, ease: 'easeOut' }}
      onClick={(e) => {
        if (
          selectedCardId &&
          !(e.target instanceof Element && e.target.closest('[data-card-slot]'))
        ) {
          setSelectedCardId(null);
        }
      }}
      className="min-h-[100dvh] w-full flex flex-col hokm-traditional-arena text-[#F6F3EC] relative overflow-clip select-none transform-gpu"
      data-testid="hokm-table"
      data-table-skin={tableSkinId}
      data-deck-id={southBackVisual.deckId || southDeckId}
      data-game-effect={gameEffectId ?? undefined}
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

      {/* Brief Dramatic Full-Screen Dark Shock Vignette on Heavy Trump Cut (ZERO TEXT) */}
      <AnimatePresence>
        {trumpCutBurst && !reducedMotion && (
          <motion.div
            key={`cut-vignette-${trumpCutBurst.id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.78, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.66, ease: 'easeOut' }}
            aria-hidden="true"
            className="fixed inset-0 z-[34] pointer-events-none"
            style={{
              background:
                'radial-gradient(circle at center, transparent 34%, rgba(0,0,0,0.68) 80%, rgba(120,53,15,0.42) 100%)',
            }}
          />
        )}
      </AnimatePresence>

      {/* Clean Top HUD Header: Enlarged Royal Persian Scoreboard Centered */}
      <header
        className="relative z-30 flex items-center justify-center px-3 sm:px-6 py-2 sm:py-2.5 backdrop-blur-md bg-[#061814]/82 border-b border-[#D4AE58]/35 text-[#FAF6EE]"
        data-testid="hokm-header"
      >
        <RoyalScoreboard
          state={state}
          reducedMotion={reducedMotion}
          trumpSlotRef={trumpSlotRef}
          myScoreRef={myScoreRef}
          oppScoreRef={oppScoreRef}
          registerPipRef={registerPipRef}
          activePipFlash={activePipFlash}
          pendingOrbPip={pendingOrbPip}
          activeScoreFlashTeam={activeScoreFlashTeam}
          hideTrumpUntilLanded={Boolean(flyingTrump)}
          onRequestExit={onRequestExit}
        />
      </header>

      {/* Silky Curved Flying Luminous Orb + Comet Trail morphing seamlessly into Scoreboard Pip */}
      {flyingTrickOrb && (
        <div className="fixed inset-0 z-[72] pointer-events-none" aria-hidden="true">
          {/* Soft trailing comet motes */}
          {[0.045, 0.09].map((trailDelay, tIdx) => (
            <motion.div
              key={`${flyingTrickOrb.key}-trail-${tIdx}`}
              initial={{
                x: flyingTrickOrb.xs[0],
                y: flyingTrickOrb.ys[0],
                scale: 0.85 - tIdx * 0.22,
                opacity: 0.55 - tIdx * 0.18,
              }}
              animate={{
                x: flyingTrickOrb.xs,
                y: flyingTrickOrb.ys,
                scale: [0.85 - tIdx * 0.22, 0.72 - tIdx * 0.18, 0.22],
                opacity: [0.5 - tIdx * 0.16, 0.38 - tIdx * 0.12, 0],
              }}
              transition={{
                duration: 0.56,
                delay: trailDelay,
                ease: 'linear',
              }}
              className="fixed top-0 left-0 w-8 h-8 flex items-center justify-center will-change-transform"
            >
              <span
                className={`w-4 h-4 rounded-full blur-[4px] ${
                  flyingTrickOrb.team === 'myTeam'
                    ? 'bg-[#6EE7B7]'
                    : 'bg-[#FDA4AF]'
                }`}
              />
            </motion.div>
          ))}

          {/* Primary Luminous Orb smoothly morphing from center burst down to exact 10px pip */}
          <motion.div
            key={flyingTrickOrb.key}
            data-testid="flying-trick-orb"
            initial={{
              x: flyingTrickOrb.xs[0],
              y: flyingTrickOrb.ys[0],
              scale: 1.35,
              opacity: 1,
            }}
            animate={{
              x: flyingTrickOrb.xs,
              y: flyingTrickOrb.ys,
              scale: [1.35, 1.28, 1.18, 1.06, 0.94, 0.82, 0.7, 0.58, 0.48, 0.4, 0.34, 0.3, 0.28],
              opacity: [0.92, 1, 1, 1, 1, 1, 1, 1, 1, 0.98, 0.92, 0.6, 0],
            }}
            transition={{
              duration: 0.58,
              ease: 'linear',
            }}
            className="fixed top-0 left-0 w-8 h-8 flex items-center justify-center will-change-transform"
          >
            <span
              className={`absolute inset-0 rounded-full blur-[7px] ${
                flyingTrickOrb.team === 'myTeam'
                  ? 'bg-[#34D399] shadow-[0_0_26px_8px_rgba(52,211,153,0.92)]'
                  : 'bg-[#FB7185] shadow-[0_0_26px_8px_rgba(251,113,133,0.92)]'
              }`}
            />
            <span className="relative w-3.5 h-3.5 rounded-full bg-white shadow-[0_0_14px_3px_#FFFFFF]" />
          </motion.div>
        </div>
      )}

      {/* Flying Chosen Trump Emblem -> Glides smoothly from Center into Scoreboard Slot */}
      {flyingTrump && (
        <motion.div
          key={`flying-trump-${flyingTrump.suit}`}
          initial={{
            x: flyingTrump.startX - 36,
            y: flyingTrump.startY - 36,
            scale: 1.45,
            rotate: -18,
          }}
          animate={{
            x: flyingTrump.targetX - 36,
            y: flyingTrump.targetY - 36,
            scale: 0.78,
            rotate: 0,
          }}
          transition={{
            duration: 0.6,
            ease: [0.22, 1, 0.36, 1],
          }}
          data-testid="flying-trump-emblem"
          className="fixed top-0 left-0 z-[70] pointer-events-none w-[72px] h-[72px] rounded-full bg-white border-[3px] border-[#F3D179] shadow-[0_0_36px_rgba(243,209,121,0.95),0_12px_28px_rgba(0,0,0,0.55)] flex items-center justify-center"
        >
          <SuitIconSvg suit={flyingTrump.suit} className="w-10 h-10" />
        </motion.div>
      )}

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

        {/* TOP SEAT: North (Partner — Fixed height so avatar NEVER jumps during dealing!) */}
        <section
          className="relative z-10 flex flex-col items-center justify-start pt-3 sm:pt-4 h-[98px] sm:h-[112px] shrink-0"
          aria-label={resolvedSeats.north.name}
        >
          <div className="pointer-events-none absolute -top-[82px] sm:-top-[108px] left-1/2 -translate-x-1/2 z-0">
            <HiddenHandFan
              count={effectiveVisibleCounts.north}
              orientation="horizontal"
              isDesktop={handLayout.isDesktop}
              deckId={northDeckId}
              cardBackId={northCardBackId}
              backBg={
                !northBackVisual.styleTokens.backBackground ||
                northBackVisual.styleTokens.backBackground.toUpperCase() === '#FFFFFF'
                  ? '#EFECE3'
                  : northBackVisual.styleTokens.backBackground
              }
              backBorder={
                !northBackVisual.styleTokens.backBorderColor ||
                northBackVisual.styleTokens.backBorderColor.toUpperCase() === '#D4CFC5'
                  ? '#C9C3B4'
                  : northBackVisual.styleTokens.backBorderColor
              }
            />
          </div>
          <div className="relative z-20">
            <SeatProfile
              seat="north"
              displayName={resolvedSeats.north.name}
              avatarSrc={resolvedSeats.north.avatarSrc}
              userId={resolvedSeats.north.userId}
              onInspectPlayer={onInspectPlayer}
              onInspectSeat={handleInspectSeatFallback}
              showOnlineDot={Boolean(onlineHud)}
              connected={resolvedSeats.north.connected}
              disconnectRemainingSec={resolvedSeats.north.disconnectRemainingSec}
              appearance={seatAppearances?.north}
              isTurn={
                (state.phase === 'PLAYING_TRICK' ||
                  state.phase === 'CHOOSING_TRUMP') &&
                state.currentTurn === 'north'
              }
              isHakem={state.hakem === 'north'}
              hakemKey={`${state.handNumber}`}
              reducedMotion={reducedMotion}
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
              count={effectiveVisibleCounts.west}
              orientation="vertical"
              side="west"
              isDesktop={handLayout.isDesktop}
              deckId={westDeckId}
              cardBackId={westCardBackId}
              backBg={
                !westBackVisual.styleTokens.backBackground ||
                westBackVisual.styleTokens.backBackground.toUpperCase() === '#FFFFFF'
                  ? '#EFECE3'
                  : westBackVisual.styleTokens.backBackground
              }
              backBorder={
                !westBackVisual.styleTokens.backBorderColor ||
                westBackVisual.styleTokens.backBorderColor.toUpperCase() === '#D4CFC5'
                  ? '#C9C3B4'
                  : westBackVisual.styleTokens.backBorderColor
              }
            />
          </div>

          {/* Full-size East Card Fan anchored flush off viewport RIGHT edge */}
          <div className="pointer-events-none fixed right-[-92px] sm:right-[-118px] top-1/2 -translate-y-1/2 z-0">
            <HiddenHandFan
              count={effectiveVisibleCounts.east}
              orientation="vertical"
              side="east"
              isDesktop={handLayout.isDesktop}
              deckId={eastDeckId}
              cardBackId={eastCardBackId}
              backBg={
                !eastBackVisual.styleTokens.backBackground ||
                eastBackVisual.styleTokens.backBackground.toUpperCase() === '#FFFFFF'
                  ? '#EFECE3'
                  : eastBackVisual.styleTokens.backBackground
              }
              backBorder={
                !eastBackVisual.styleTokens.backBorderColor ||
                eastBackVisual.styleTokens.backBorderColor.toUpperCase() === '#D4CFC5'
                  ? '#C9C3B4'
                  : eastBackVisual.styleTokens.backBorderColor
              }
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
              userId={resolvedSeats.west.userId}
              onInspectPlayer={onInspectPlayer}
              onInspectSeat={handleInspectSeatFallback}
              showOnlineDot={Boolean(onlineHud)}
              connected={resolvedSeats.west.connected}
              disconnectRemainingSec={resolvedSeats.west.disconnectRemainingSec}
              appearance={seatAppearances?.west}
              isTurn={
                (state.phase === 'PLAYING_TRICK' ||
                  state.phase === 'CHOOSING_TRUMP') &&
                state.currentTurn === 'west'
              }
              isHakem={state.hakem === 'west'}
              hakemKey={`${state.handNumber}`}
              reducedMotion={reducedMotion}
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
              style={
                effectAccent
                  ? {
                      boxShadow: `inset 0 0 24px ${effectAccent}22`,
                    }
                  : undefined
              }
              className="w-[192px] h-[192px] sm:w-[268px] sm:h-[268px] rounded-full border border-[#D4AE58]/28 bg-black/8 flex items-center justify-center relative transition-all duration-150 data-[drag-active=true]:border-[#F3D179]/60 data-[drag-active=true]:bg-black/16 data-[drop-over=true]:border-[#F3D179] data-[drop-over=true]:bg-[#F3D179]/18 data-[drop-over=true]:shadow-[0_0_38px_rgba(243,209,121,0.42)] data-[drop-over=true]:scale-[1.05]"
              aria-hidden="true"
            />

            {/* Solid Multi-Layer Center Deck Pile & Riffle Shuffle (Last card launches directly off stack — zero fade/shrink!) */}
            {showDeckOnTable && deckStackLayers > 0 && (
              <div
                data-testid="center-deal-deck"
                data-deck-remaining={effectiveDeckCount}
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
              >
                  <div className="relative w-[68px] h-[96px] sm:w-[84px] sm:h-[118px]">
                    {/* Table contact shadow beneath the deck stack */}
                    <div
                      className="absolute inset-0 translate-y-2.5 scale-[0.96] rounded-[9px] bg-black/45 blur-[6px]"
                      aria-hidden="true"
                    />
                    {Array.from({ length: deckStackLayers }).map((_, layer) => (
                      <motion.div
                        key={layer}
                        animate={
                          isShufflingAnim && !reducedMotion
                            ? {
                                x: layer % 2 === 0 ? [-32, 20, 0] : [32, -20, 0],
                                y: -layer * 1.6,
                                rotate: layer % 2 === 0 ? [-10, 6, 0] : [10, -6, 0],
                              }
                            : { x: layer * 1.3, y: -layer * 1.7, rotate: 0 }
                        }
                        transition={
                          isShufflingAnim
                            ? {
                                duration: 0.36,
                                repeat: 2,
                                ease: 'easeInOut',
                                delay: layer * 0.035,
                              }
                            : { duration: 0.18 }
                        }
                        style={{
                          backgroundColor: activeBackBg,
                          borderColor: activeBackBorder,
                          zIndex: layer + 1,
                        }}
                        className="absolute inset-0 rounded-[7px] p-[2px] border shadow-[0_6px_14px_rgba(0,0,0,0.48)] overflow-hidden"
                      >
                        <div className="w-full h-full rounded-[5px] overflow-hidden">
                          <CardBackSvg
                            deckId={southDeckId}
                            cardBackId={southCardBackId}
                          />
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

            {/* Solid Dealer Wrist-Spin Flying Cards Launched Directly From Center Deck */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-visible z-20">
              {flyingDealCards.map((fc) => {
                const dest = SEAT_FLY_OFFSETS[fc.targetSeat];
                const spinTarget = fc.spinDeg ?? dest.dealSpin;
                return (
                  <motion.div
                    key={fc.id}
                    initial={{ x: 0, y: -6, scale: 0.96, rotate: 0 }}
                    animate={{
                      x: dest.x,
                      y: dest.y,
                      scale: 0.84,
                      rotate: spinTarget,
                    }}
                    transition={{
                      duration: reducedMotion ? 0.05 : 0.28,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    style={{
                      backgroundColor: activeBackBg,
                      borderColor: activeBackBorder,
                    }}
                    className="absolute w-[64px] h-[90px] sm:w-[76px] sm:h-[106px] rounded-[7px] p-[2px] border shadow-[0_10px_22px_rgba(0,0,0,0.52)] overflow-hidden"
                  >
                    <div className="w-full h-full rounded-[5px] overflow-hidden">
                      <CardBackSvg
                        deckId={seatDeckMap[fc.targetSeat]}
                        cardBackId={seatCardBackMap[fc.targetSeat]}
                      />
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* Active 4-Card Trick -> Stacks cleanly -> Slides Solidly Off Table (Keyed per trick so ZERO 1-frame rebound!) */}
            <motion.div
              key={`trick-packet-${state.handNumber}-${state.trickCounts.myTeam + state.trickCounts.opponentTeam}`}
              dir="ltr"
              animate={
                trickCollectPhase === 'sliding'
                  ? {
                      x: slideDestination.x * 1.45,
                      y: slideDestination.y * 1.45,
                      scale: 0.74,
                      rotate: collectingWinnerTeam === 'myTeam' ? -18 : 18,
                    }
                  : { x: 0, y: 0, scale: 1, rotate: 0 }
              }
              transition={{
                duration:
                  reducedMotion || trickCollectPhase === 'idle' ? 0 : 0.34,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              data-testid="trick-center-area"
            >
              {state.currentTrick.map((play, idx) => {
                const origin = SEAT_FLY_OFFSETS[play.seat];
                const slot = TRICK_SLOT_OFFSETS[play.seat];
                const stackPose =
                  STACK_CARD_JITTER[idx % STACK_CARD_JITTER.length];
                const isStacking =
                  trickCollectPhase === 'stacking' ||
                  trickCollectPhase === 'sliding';
                const shouldFlip3D = !reducedMotion && play.seat !== 'south';
                const isActiveCutCard = trumpCutBurst?.id === play.card.id;

                return (
                  <motion.div
                    key={play.card.id}
                    initial={
                      reducedMotion
                        ? { x: slot.x, y: slot.y, rotate: slot.rotate }
                        : play.seat === 'south'
                          ? {
                              x: 0,
                              y: 124,
                              scale: 0.96,
                              rotate: origin.playSpin,
                            }
                          : {
                              x: origin.x * 0.82,
                              y: origin.y * 0.82,
                              scale: 0.88,
                              rotate: origin.playSpin,
                            }
                    }
                    animate={
                      isStacking
                        ? {
                            x: stackPose.x,
                            y: stackPose.y,
                            rotate: stackPose.rotate,
                            scale: 0.92,
                          }
                        : isActiveCutCard && !reducedMotion
                          ? {
                              x: slot.x,
                              y: [slot.y - 38, slot.y + 8, slot.y - 2, slot.y],
                              rotate: [slot.rotate - 16, slot.rotate + 9, slot.rotate - 3, slot.rotate],
                              scale: [1.72, 0.88, 1.08, 1],
                            }
                          : {
                              x: slot.x,
                              y: slot.y,
                              rotate: slot.rotate,
                              scale: 1,
                            }
                    }
                    transition={{
                      duration: reducedMotion ? 0.05 : isActiveCutCard ? 0.46 : 0.3,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    style={{ zIndex: idx + 5, perspective: 960 }}
                    className="absolute"
                  >
                    {shouldFlip3D ? (
                      <motion.div
                        initial={{ rotateY: 180 }}
                        animate={{ rotateY: 0 }}
                        transition={{
                          duration: 0.34,
                          ease: [0.18, 1, 0.3, 1],
                        }}
                        style={{ transformStyle: 'preserve-3d' }}
                        className="relative"
                      >
                        <div
                          style={{
                            backfaceVisibility: 'hidden',
                            WebkitBackfaceVisibility: 'hidden',
                          }}
                        >
                          <PlayingCard
                            card={play.card}
                            deckId={seatDeckMap[play.seat]}
                            cardBackId={seatCardBackMap[play.seat]}
                            size="trick"
                          />
                        </div>
                        <div
                          className="absolute inset-0"
                          style={{
                            backfaceVisibility: 'hidden',
                            WebkitBackfaceVisibility: 'hidden',
                            transform: 'rotateY(180deg)',
                          }}
                          aria-hidden="true"
                        >
                          <PlayingCard
                            faceDown
                            deckId={seatDeckMap[play.seat]}
                            cardBackId={seatCardBackMap[play.seat]}
                            size="trick"
                          />
                        </div>
                      </motion.div>
                    ) : (
                      <PlayingCard
                        card={play.card}
                        deckId={seatDeckMap[play.seat]}
                        cardBackId={seatCardBackMap[play.seat]}
                        size="trick"
                      />
                    )}
                  </motion.div>
                );
              })}
            </motion.div>

            {/* HEAVY TABLE-SHATTERING CRACK & DEBRIS VFX ON TRUMP CUT ("بریدن") — ZERO TEXT */}
            {trumpCutBurst && !reducedMotion && (
              <div
                key={`cut-vfx-${trumpCutBurst.id}`}
                data-testid="trump-cut-vfx"
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-[36] flex items-center justify-center overflow-visible"
              >
                <div
                  className="relative flex items-center justify-center"
                  style={{
                    transform: `translate(${TRICK_SLOT_OFFSETS[trumpCutBurst.seat].x}px, ${TRICK_SLOT_OFFSETS[trumpCutBurst.seat].y}px)`,
                  }}
                >
                  {/* Dark impact crater & heavy dust shockwave */}
                  <motion.div
                    initial={{ scale: 0.25, opacity: 0.95 }}
                    animate={{ scale: 2.8, opacity: 0 }}
                    transition={{ duration: 0.72, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute w-36 h-36 rounded-full bg-[radial-gradient(circle,rgba(10,8,6,0.88)_0%,rgba(120,53,15,0.48)_45%,transparent_75%)]"
                  />

                  {/* Shattering Table Fissures SVG (deep abyssal wood cracks + amber impact seams) */}
                  <motion.svg
                    viewBox="-170 -170 340 340"
                    initial={{ scale: 0.38, opacity: 0 }}
                    animate={{ scale: [0.38, 1.06, 1.1], opacity: [0, 1, 0.95, 0] }}
                    transition={{ duration: 0.9, times: [0, 0.14, 0.62, 1], ease: [0.16, 1, 0.3, 1] }}
                    className="absolute w-[310px] h-[310px] sm:w-[400px] sm:h-[400px] overflow-visible"
                    fill="none"
                  >
                    <defs>
                      <filter id="crackGlow" x="-30%" y="-30%" width="160%" height="160%">
                        <feGaussianBlur stdDeviation="2.4" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    {/* Main deep dark shattered fissures radiating across the table */}
                    <g stroke="#060807" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M0 0 L-22 -36 L-58 -52 L-108 -96 L-152 -118" strokeWidth="6.5" />
                      <path d="M-58 -52 L-46 -98 L-66 -144" strokeWidth="4" />
                      <path d="M0 0 L34 -24 L76 -38 L122 -78 L158 -92" strokeWidth="6" />
                      <path d="M76 -38 L112 -18 L154 -8" strokeWidth="3.8" />
                      <path d="M0 0 L28 36 L68 58 L104 108 L142 138" strokeWidth="6.5" />
                      <path d="M68 58 L42 102 L48 148" strokeWidth="3.6" />
                      <path d="M0 0 L-36 22 L-82 44 L-126 84 L-160 104" strokeWidth="6" />
                      <path d="M-82 44 L-116 14 L-152 18" strokeWidth="3.8" />
                      <path d="M0 0 L-8 46 L-16 96 L-8 146" strokeWidth="4.5" />
                      <path d="M0 0 L10 -48 L4 -102 L18 -148" strokeWidth="4.5" />
                      {/* Fractured concentric inner polygon breaks */}
                      <path d="M-22 -36 L10 -48 L34 -24 L28 36 L-8 46 L-36 22 Z" strokeWidth="3.2" />
                      <path d="M-58 -52 L4 -102 M76 -38 L68 58 M-82 44 L-16 96" strokeWidth="2.4" />
                    </g>
                    {/* Glowing molten amber crack edges inside the fractured seams */}
                    <g
                      stroke="#F59E0B"
                      strokeOpacity="0.82"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      filter="url(#crackGlow)"
                    >
                      <path d="M0 0 L-22 -36 L-58 -52 L-108 -96" strokeWidth="2.1" />
                      <path d="M0 0 L34 -24 L76 -38 L122 -78" strokeWidth="1.9" />
                      <path d="M0 0 L28 36 L68 58 L104 108" strokeWidth="2.1" />
                      <path d="M0 0 L-36 22 L-82 44 L-126 84" strokeWidth="1.9" />
                      <path d="M0 0 L-8 46 L-16 96 M0 0 L10 -48 L4 -102" strokeWidth="1.5" />
                      <path d="M-22 -36 L10 -48 L34 -24 L28 36 L-8 46 L-36 22 Z" strokeWidth="1.3" />
                    </g>
                  </motion.svg>

                  {/* Flying broken table wood/felt shards & splinters */}
                  {Array.from({ length: 16 }).map((_, sIdx) => {
                    const deg = sIdx * 22.5 + (sIdx % 2 === 0 ? 7 : -6);
                    const rad = (deg * Math.PI) / 180;
                    const dist = 85 + (sIdx % 4) * 32;
                    const tx = Math.cos(rad) * dist;
                    const ty = Math.sin(rad) * dist + 14;
                    const isSplinter = sIdx % 2 === 0;
                    return (
                      <motion.span
                        key={sIdx}
                        initial={{ x: 0, y: 0, scale: 1.15, rotate: deg, opacity: 1 }}
                        animate={{
                          x: tx,
                          y: ty,
                          scale: 0.35,
                          rotate: deg + (sIdx % 2 === 0 ? 150 : -140),
                          opacity: 0,
                        }}
                        transition={{
                          duration: 0.64 + (sIdx % 3) * 0.08,
                          ease: [0.16, 1, 0.3, 1],
                        }}
                        className={
                          isSplinter
                            ? 'absolute w-4 h-1.5 rounded-[1px] bg-gradient-to-r from-[#2E1A0F] via-[#78350F] to-[#D97706] shadow-[0_2px_6px_rgba(0,0,0,0.7)]'
                            : 'absolute w-2.5 h-2.5 rounded-[2px] bg-[#0B2E24] border border-[#F59E0B]/60 shadow-[0_2px_6px_rgba(0,0,0,0.65)]'
                        }
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Pure Floating Frameless Soft "نوبت شماست" Prompt (NO background, NO border, higher up) */}
            {canHumanPlay &&
              state.phase === 'PLAYING_TRICK' &&
              !showTrumpModal && (
                <motion.div
                  data-testid="your-turn-prompt"
                  initial={reducedMotion ? false : { opacity: 0 }}
                  animate={
                    reducedMotion
                      ? { opacity: 0.72 }
                      : {
                          opacity: [0.34, 0.76, 0.34],
                        }
                  }
                  transition={
                    reducedMotion
                      ? { duration: 0.1 }
                      : {
                          duration: 2.1,
                          repeat: Infinity,
                          ease: 'easeInOut',
                        }
                  }
                  className="pointer-events-none select-none absolute inset-x-0 -top-10 sm:-top-8 z-25 flex justify-center"
                >
                  <span className="text-xl sm:text-3xl font-extrabold tracking-wide text-[#F6E3B4]/80 drop-shadow-[0_2px_10px_rgba(0,0,0,0.68)]">
                    نوبت شماست
                  </span>
                </motion.div>
              )}

            {/* TrumpSelector is rendered above the dimmed backdrop at z-50 below */}
          </div>

          {/* Physical RIGHT: East Profile */}
          <div
            dir="rtl"
            className="relative z-20 flex flex-col items-center justify-center pr-7 sm:pr-12"
            aria-label={resolvedSeats.east.name}
          >
            <SeatProfile
              seat="east"
              displayName={resolvedSeats.east.name}
              avatarSrc={resolvedSeats.east.avatarSrc}
              userId={resolvedSeats.east.userId}
              onInspectPlayer={onInspectPlayer}
              onInspectSeat={handleInspectSeatFallback}
              showOnlineDot={Boolean(onlineHud)}
              connected={resolvedSeats.east.connected}
              disconnectRemainingSec={resolvedSeats.east.disconnectRemainingSec}
              appearance={seatAppearances?.east}
              isTurn={
                (state.phase === 'PLAYING_TRICK' ||
                  state.phase === 'CHOOSING_TRUMP') &&
                state.currentTurn === 'east'
              }
              isHakem={state.hakem === 'east'}
              hakemKey={`${state.handNumber}`}
              reducedMotion={reducedMotion}
            />
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
                  deckId={southDeckId}
                  isLegal={legalIds.has(card.id)}
                  isSelected={selectedCardId === card.id}
                  canHumanPlay={canHumanPlay}
                  handGathered={handGathered}
                  reducedMotion={reducedMotion}
                  dropRingRef={dropRingRef}
                  onSelectCard={setSelectedCardId}
                  onPlayCard={onPlayCard}
                />
              );
            })}

            {/* South SeatProfile overlaid neatly at lower-center base of the fan */}
            <div
              dir="rtl"
              className="pointer-events-none absolute bottom-1 sm:bottom-2 left-1/2 -translate-x-1/2 z-40"
            >
              <SeatReactionBubble
                reaction={southReaction}
                positionClassName="absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2"
                reducedMotion={reducedMotion}
              />
              <SeatProfile
                seat="south"
                displayName={resolvedSeats.south.name}
                avatarSrc={resolvedSeats.south.avatarSrc}
                userId={resolvedSeats.south.userId}
                showOnlineDot={Boolean(onlineHud)}
                connected={resolvedSeats.south.connected}
                disconnectRemainingSec={
                  resolvedSeats.south.disconnectRemainingSec
                }
                appearance={seatAppearances?.south}
                isTurn={
                  (state.phase === 'PLAYING_TRICK' ||
                    state.phase === 'CHOOSING_TRUMP') &&
                  state.currentTurn === 'south'
                }
                isHakem={state.hakem === 'south'}
                hakemKey={`${state.handNumber}`}
                reducedMotion={reducedMotion}
              />
            </div>
          </div>
        </section>
      </main>

      {/* Non-Blocking Right-Edge Quick Reaction Menu (Messages, Emojis, Persian Voice Callouts) */}
      <InGameReactionMenu
        onSendReaction={handleSendReaction}
        reducedMotion={reducedMotion}
      />

      {/* Offline Bot Profile Inspection Modal */}
      <BotProfileModal
        bot={inspectedBot}
        onClose={() => setInspectedBot(null)}
      />

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

      {/* Real-World End-of-Hand Card Throw (all remaining cards from 4 seats) -> Flying Score -> Sweep & Shuffle */}
      <AnimatePresence>
        {state.phase === 'HAND_COMPLETE' && state.handOutcome && (
          <HandResetTableAnimation
            outcome={state.handOutcome}
            remainingHands={state.hands}
            seatDeckMap={seatDeckMap}
            seatCardBackMap={seatCardBackMap}
            targetScoreRect={handResetTargetScoreRect}
            reducedMotion={reducedMotion}
            onScoreLanded={(winnerTeam) => {
              setActiveScoreFlashTeam(winnerTeam);
              window.setTimeout(() => {
                setActiveScoreFlashTeam((cur) =>
                  cur === winnerTeam ? null : cur
                );
              }, 850);
            }}
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
    </motion.div>
  );
};
