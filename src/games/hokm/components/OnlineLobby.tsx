import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Crown,
  Gamepad2,
  Link2,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trophy,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Seat } from '../engine/types';
import {
  CompletedMatchRecord,
  MAX_ROOM_PLAYERS,
  RoomSeatView,
  RoomSnapshot,
  sanitizeRoomCode,
  sanitizeUsername,
} from '../online/protocol';
import { ConnectionState } from '../online/client';
import { PLATFORM_ASSETS } from '../../../platform/data/assets';
import { toPersianDigits } from '../../../platform/theme/tokens';

export const ONLINE_AVATAR_OPTIONS: readonly {
  code: string;
  label: string;
  src: string;
}[] = [
  { code: 'portrait', label: 'امیر', src: PLATFORM_ASSETS.userAvatar },
  { code: 'shamsa', label: 'پروین', src: PLATFORM_ASSETS.avatarParvin },
  { code: 'turquoise', label: 'سهراب', src: PLATFORM_ASSETS.avatarSohrab },
  { code: 'jade', label: 'فرهاد', src: PLATFORM_ASSETS.avatarFarhad },
];

export function getAvatarSrcByCode(avatarCode: string): string {
  const found = ONLINE_AVATAR_OPTIONS.find((a) => a.code === avatarCode);
  return found ? found.src : PLATFORM_ASSETS.userAvatar;
}

const SEAT_PERSIAN_LABELS: Record<Seat, string> = {
  south: 'صندلی پایین (شما)',
  north: 'صندلی بالا (یار)',
  east: 'صندلی راست (حریف)',
  west: 'صندلی چپ (حریف)',
};

interface OnlineLobbyProps {
  username: string;
  avatarCode: string;
  initialRoomCode?: string;
  snapshot: RoomSnapshot | null;
  connectionState: ConnectionState;
  rttMs: number | null;
  busy: boolean;
  errorMessage: string | null;
  recentMatches: readonly CompletedMatchRecord[];
  onChangeUsername: (username: string) => void;
  onChangeAvatar: (avatarCode: string) => void;
  onCreateRoom: () => void;
  onJoinRoom: (roomCode: string) => void;
  onToggleReady: (ready: boolean) => void;
  onSelectSeat: (canonicalSeat: Seat) => void;
  onStartMatch: () => void;
  onLeaveRoom: () => void;
  onLaunchOffline: () => void;
  onBackToGames: () => void;
  onRefreshMatches: () => void;
}

const LobbySeatCard: React.FC<{
  seatView: RoomSeatView;
  isViewer: boolean;
  onSelectSeat: (canonicalSeat: Seat) => void;
}> = ({ seatView, isViewer, onSelectSeat }) => {
  const isEmpty = !seatView.playerId;
  const isMyTeam = seatView.team === 'myTeam';

  return (
    <button
      type="button"
      disabled={!isEmpty}
      onClick={() => {
        if (isEmpty) onSelectSeat(seatView.canonicalSeat);
      }}
      data-testid={`lobby-seat-${seatView.visualSeat}`}
      data-canonical-seat={seatView.canonicalSeat}
      data-occupied={isEmpty ? 'false' : 'true'}
      className={`relative flex flex-col items-center justify-center gap-1.5 rounded-2xl p-3 sm:p-4 border transition-all min-h-[124px] sm:min-h-[138px] w-full text-center ${
        isEmpty
          ? 'bg-[#091F1A]/60 border-dashed border-[#D4AE58]/40 hover:border-[#F3D179] hover:bg-[#0D2B24]/80 cursor-pointer'
          : isViewer
            ? 'bg-gradient-to-b from-[#113A30]/95 to-[#0A241E]/95 border-[#F3D179] shadow-[0_8px_24px_rgba(243,209,121,0.18)] cursor-default'
            : isMyTeam
              ? 'bg-gradient-to-b from-[#0E3129]/90 to-[#081F1A]/90 border-[#34D399]/55 cursor-default'
              : 'bg-gradient-to-b from-[#2B151B]/90 to-[#180C10]/90 border-[#FB7185]/45 cursor-default'
      }`}
    >
      {/* Team pill */}
      <span
        className={`absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
          isMyTeam
            ? 'bg-[#0C352C] border-[#34D399]/50 text-[#6EE7B7]'
            : 'bg-[#3B161C] border-[#FB7185]/45 text-[#FCA5A5]'
        }`}
      >
        {isMyTeam ? 'تیم اول' : 'تیم دوم'}
      </span>

      {/* Ready / Online badges */}
      {!isEmpty && (
        <span className="absolute top-2 left-2 flex items-center gap-1">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              seatView.connected
                ? 'bg-[#34D399] shadow-[0_0_8px_rgba(52,211,153,0.9)]'
                : 'bg-[#F59E0B] animate-pulse'
            }`}
            title={seatView.connected ? 'آنلاین' : 'در حال اتصال مجدد'}
          />
        </span>
      )}

      {isEmpty ? (
        <>
          <div className="w-11 h-11 rounded-full border-2 border-dashed border-[#D4AE58]/45 flex items-center justify-center text-[#D4AE58]/70 mt-3">
            <Users className="w-5 h-5" />
          </div>
          <span className="text-xs font-bold text-[#D4AE58]/90">
            صندلی خالی
          </span>
          <span className="text-[10px] text-[#9BB8AE]">
            برای جابه‌جایی کلیک کنید
          </span>
        </>
      ) : (
        <>
          <div className="relative mt-2">
            <div
              className={`w-12 h-12 rounded-full overflow-hidden border-2 ${
                seatView.isReady
                  ? 'border-[#34D399] shadow-[0_0_14px_rgba(52,211,153,0.45)]'
                  : 'border-[#D4AE58]/65'
              }`}
            >
              <img
                src={getAvatarSrcByCode(seatView.avatarCode)}
                alt={seatView.username ?? ''}
                className="w-full h-full object-cover"
              />
            </div>
            {seatView.isHost && (
              <span
                className="absolute -top-2 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-[#0E2822] border border-[#F3D179] flex items-center justify-center"
                title="میزبان اتاق"
              >
                <Crown className="w-3 h-3 text-[#F3D179] fill-[#F3D179]" />
              </span>
            )}
          </div>

          <span
            dir="ltr"
            className="text-xs sm:text-sm font-extrabold text-[#FAF6EE] truncate max-w-[130px]"
          >
            {seatView.username}
          </span>

          <div className="flex items-center gap-1.5">
            {seatView.isReady ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#34D399]/18 border border-[#34D399]/50 text-[#6EE7B7]">
                <CheckCircle2 className="w-3 h-3" />
                آماده
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/8 border border-white/15 text-[#B8CEC6]">
                <Clock className="w-3 h-3" />
                در انتظار
              </span>
            )}
          </div>
        </>
      )}

      <span className="text-[10px] text-[#8EA9A0] mt-0.5">
        {SEAT_PERSIAN_LABELS[seatView.visualSeat]}
      </span>
    </button>
  );
};

export const OnlineLobby: React.FC<OnlineLobbyProps> = ({
  username,
  avatarCode,
  initialRoomCode = '',
  snapshot,
  connectionState,
  rttMs,
  busy,
  errorMessage,
  recentMatches,
  onChangeUsername,
  onChangeAvatar,
  onCreateRoom,
  onJoinRoom,
  onToggleReady,
  onSelectSeat,
  onStartMatch,
  onLeaveRoom,
  onLaunchOffline,
  onBackToGames,
  onRefreshMatches,
}) => {
  const [joinCodeInput, setJoinCodeInput] = useState(
    initialRoomCode.toUpperCase()
  );
  const [copiedMode, setCopiedMode] = useState<'code' | 'link' | null>(null);

  const validUsername = sanitizeUsername(username) !== null;
  const cleanJoinCode = sanitizeRoomCode(joinCodeInput);

  const handleCopy = async (mode: 'code' | 'link') => {
    if (!snapshot) return;
    const text =
      mode === 'code'
        ? snapshot.roomCode
        : `${window.location.origin}${window.location.pathname}?room=${snapshot.roomCode}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMode(mode);
      window.setTimeout(() => setCopiedMode(null), 1800);
    } catch {
      // Clipboard API fallback ignored cleanly
    }
  };

  // =========================================================================
  // VIEW 2: ACTIVE 4-PLAYER WAITING ROOM
  // =========================================================================
  if (snapshot && snapshot.status === 'WAITING') {
    const seatsByVisual: Record<Seat, RoomSeatView> = {
      south: snapshot.seats.find((s) => s.visualSeat === 'south')!,
      north: snapshot.seats.find((s) => s.visualSeat === 'north')!,
      east: snapshot.seats.find((s) => s.visualSeat === 'east')!,
      west: snapshot.seats.find((s) => s.visualSeat === 'west')!,
    };

    const viewerSeat = seatsByVisual.south;
    const isHost = snapshot.hostPlayerId === snapshot.viewerPlayerId;
    const seatedPlayers = snapshot.seats.filter((s) => s.playerId !== null);
    const seatedCount = seatedPlayers.length;
    const readyCount = seatedPlayers.filter((s) => s.isReady).length;
    const canHostStart =
      isHost && seatedCount === MAX_ROOM_PLAYERS && readyCount === MAX_ROOM_PLAYERS;

    return (
      <div
        className="min-h-[100dvh] w-full flex flex-col bg-[#061814] text-[#FAF6EE] relative overflow-x-hidden"
        data-testid="online-waiting-room"
        data-room-code={snapshot.roomCode}
      >
        {/* Subtle emerald salon background */}
        <div
          className="fixed inset-0 z-0 pointer-events-none opacity-45"
          aria-hidden="true"
        >
          <img
            src={PLATFORM_ASSETS.hokmTableTraditional}
            alt=""
            className="w-full h-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#04120F]/92 via-[#061B16]/88 to-[#04110E]/96" />
        </div>

        <div className="relative z-10 flex-1 w-full max-w-3xl mx-auto px-3.5 sm:px-6 py-4 sm:py-6 flex flex-col gap-4">
          {/* Room Header */}
          <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#0A251F]/90 border border-[#D4AE58]/45 px-4 py-3 backdrop-blur-md shadow-lg">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] flex items-center justify-center shadow-md shrink-0">
                <Users className="w-5 h-5 stroke-[2.3]" />
              </div>
              <div>
                <h1 className="text-base sm:text-lg font-black text-[#FAF6EE]">
                  اتاق حکم آنلاین
                </h1>
                <div className="flex items-center gap-2 text-xs text-[#A7C4BA]">
                  <span>
                    ظرفیت: {toPersianDigits(seatedCount)} از{' '}
                    {toPersianDigits(MAX_ROOM_PLAYERS)} بازیکن
                  </span>
                  <span>•</span>
                  <span className="inline-flex items-center gap-1">
                    {connectionState === 'connected' ? (
                      <>
                        <Wifi className="w-3.5 h-3.5 text-[#34D399]" />
                        <span className="text-[#6EE7B7]">
                          متصل{rttMs ? ` (${toPersianDigits(rttMs)}ms)` : ''}
                        </span>
                      </>
                    ) : (
                      <>
                        <WifiOff className="w-3.5 h-3.5 text-[#F59E0B] animate-pulse" />
                        <span className="text-[#FDE68A]">در حال اتصال مجدد...</span>
                      </>
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Shareable Room Code Box */}
            <div className="flex items-center gap-2">
              <div className="px-3.5 py-1.5 rounded-xl bg-[#051411] border border-[#F3D179]/65 text-center">
                <span className="block text-[9px] text-[#D4AE58] font-bold">
                  کد اتاق
                </span>
                <span
                  dir="ltr"
                  data-testid="room-code-display"
                  className="font-mono text-base sm:text-lg font-black tracking-[0.2em] text-[#F3D179]"
                >
                  {snapshot.roomCode}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleCopy('code')}
                data-testid="copy-room-code-btn"
                className="min-h-[42px] px-3 rounded-xl bg-white/10 hover:bg-white/16 border border-[#D4AE58]/40 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                title="کپی کد اتاق"
              >
                {copiedMode === 'code' ? (
                  <Check className="w-4 h-4 text-[#34D399]" />
                ) : (
                  <Copy className="w-4 h-4 text-[#F3D179]" />
                )}
                <span className="hidden sm:inline">
                  {copiedMode === 'code' ? 'کپی شد' : 'کپی کد'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleCopy('link')}
                data-testid="copy-invite-link-btn"
                className="min-h-[42px] px-3 rounded-xl bg-white/10 hover:bg-white/16 border border-[#D4AE58]/40 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                title="کپی لینک دعوت"
              >
                {copiedMode === 'link' ? (
                  <Check className="w-4 h-4 text-[#34D399]" />
                ) : (
                  <Link2 className="w-4 h-4 text-[#F3D179]" />
                )}
                <span className="hidden sm:inline">
                  {copiedMode === 'link' ? 'لینک کپی شد' : 'لینک دعوت'}
                </span>
              </button>
            </div>
          </header>

          {errorMessage && (
            <div
              role="alert"
              className="rounded-xl bg-[#7F1D1D]/85 border border-[#F87171]/60 px-4 py-2.5 text-xs sm:text-sm font-bold text-[#FEE2E2]"
            >
              {errorMessage}
            </div>
          )}

          {/* 4-Seat Diamond Table */}
          <section className="flex-1 flex flex-col justify-center gap-3 rounded-3xl bg-[#071D18]/80 border border-[#D4AE58]/35 p-4 sm:p-6 shadow-xl">
            <p className="text-center text-xs text-[#A8C4BA]">
              بازیکنان روبه‌روی هم (بالا و پایین / راست و چپ) هم‌تیمی هستند. برای تغییر تیم، روی هر صندلی خالی کلیک کنید.
            </p>

            <div
              dir="ltr"
              className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center max-w-2xl mx-auto w-full"
            >
              {/* Top Row: Partner (North) */}
              <div dir="rtl" className="sm:col-start-2">
                <LobbySeatCard
                  seatView={seatsByVisual.north}
                  isViewer={false}
                  onSelectSeat={onSelectSeat}
                />
              </div>

              {/* Middle Row: West (physical left) - Center Info - East (physical right) */}
              <div dir="rtl" className="sm:col-start-1 sm:row-start-2">
                <LobbySeatCard
                  seatView={seatsByVisual.west}
                  isViewer={false}
                  onSelectSeat={onSelectSeat}
                />
              </div>

              <div
                dir="rtl"
                className="sm:col-start-2 sm:row-start-2 flex flex-col items-center justify-center py-2 text-center gap-1"
              >
                <div className="w-14 h-14 rounded-full bg-[#0C2F27] border-2 border-[#D4AE58]/60 flex items-center justify-center shadow-inner">
                  <ShieldCheck className="w-7 h-7 text-[#F3D179]" />
                </div>
                <span className="text-xs font-extrabold text-[#F3D179]">
                  قوانین رسمی حکم (تا ۳ دست)
                </span>
                <span className="text-[11px] text-[#9EBAB0]">
                  آماده: {toPersianDigits(readyCount)} از{' '}
                  {toPersianDigits(MAX_ROOM_PLAYERS)}
                </span>
              </div>

              <div dir="rtl" className="sm:col-start-3 sm:row-start-2">
                <LobbySeatCard
                  seatView={seatsByVisual.east}
                  isViewer={false}
                  onSelectSeat={onSelectSeat}
                />
              </div>

              {/* Bottom Row: Viewer (South) */}
              <div dir="rtl" className="sm:col-start-2 sm:row-start-3">
                <LobbySeatCard
                  seatView={seatsByVisual.south}
                  isViewer={true}
                  onSelectSeat={onSelectSeat}
                />
              </div>
            </div>
          </section>

          {/* Bottom Controls */}
          <footer className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 rounded-2xl bg-[#0A251F]/90 border border-[#D4AE58]/40 p-3.5 backdrop-blur-md">
            <button
              type="button"
              onClick={onLeaveRoom}
              data-testid="room-leave-btn"
              className="min-h-[46px] px-4 rounded-xl bg-[#7F1D1D]/70 hover:bg-[#991B1B] border border-[#F87171]/40 text-xs sm:text-sm font-bold text-white flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>خروج از اتاق</span>
            </button>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1 sm:justify-end">
              <button
                type="button"
                onClick={() => onToggleReady(!viewerSeat.isReady)}
                data-testid="room-ready-btn"
                data-ready={viewerSeat.isReady ? 'true' : 'false'}
                className={`min-h-[46px] px-5 rounded-xl text-sm font-extrabold flex items-center justify-center gap-2 cursor-pointer transition-all ${
                  viewerSeat.isReady
                    ? 'bg-[#0F3D31] hover:bg-[#134D3E] border-2 border-[#34D399] text-[#6EE7B7]'
                    : 'bg-gradient-to-b from-[#FCE08B] via-[#E5B84B] to-[#C28F2B] hover:from-[#FFF0B3] hover:to-[#D4A039] text-[#0B1628] shadow-[0_6px_20px_rgba(243,209,121,0.3)]'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{viewerSeat.isReady ? 'لغو آمادگی' : 'آماده‌ام'}</span>
              </button>

              {isHost && (
                <button
                  type="button"
                  disabled={!canHostStart || busy}
                  onClick={onStartMatch}
                  data-testid="room-start-btn"
                  className={`min-h-[46px] px-6 rounded-xl text-sm font-black flex items-center justify-center gap-2 transition-all ${
                    canHostStart
                      ? 'bg-gradient-to-b from-[#34D399] to-[#059669] hover:from-[#6EE7B7] hover:to-[#10B981] text-[#041812] shadow-[0_8px_24px_rgba(52,211,153,0.38)] cursor-pointer'
                      : 'bg-white/10 border border-white/15 text-white/45 cursor-not-allowed'
                  }`}
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>شروع مسابقه</span>
                </button>
              )}
            </div>
          </footer>
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW 1: HOKM MODE & ONLINE ROOM ENTRY HUB
  // =========================================================================
  return (
    <div
      className="min-h-[100dvh] w-full flex flex-col bg-[#061814] text-[#FAF6EE] relative overflow-x-hidden"
      data-testid="online-lobby-hub"
    >
      <div
        className="fixed inset-0 z-0 pointer-events-none opacity-40"
        aria-hidden="true"
      >
        <img
          src={PLATFORM_ASSETS.hokmTableTraditional}
          alt=""
          className="w-full h-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#04120F]/90 via-[#071E19]/88 to-[#03100D]/96" />
      </div>

      <div className="relative z-10 w-full max-w-3xl mx-auto px-4 sm:px-6 py-5 sm:py-8 flex flex-col gap-5">
        {/* Top Bar */}
        <header className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBackToGames}
            data-testid="lobby-back-games-btn"
            className="min-h-[42px] px-3.5 rounded-xl bg-white/10 hover:bg-white/16 border border-[#D4AE58]/40 text-xs sm:text-sm font-bold flex items-center gap-2 cursor-pointer transition-colors"
          >
            <ArrowRight className="w-4 h-4" />
            <span>بازگشت به بازی‌ها</span>
          </button>

          <div className="flex items-center gap-2">
            <Crown className="w-5 h-5 text-[#F3D179]" />
            <h1 className="text-lg sm:text-xl font-black text-[#F3D179]">
              حکم ایوان
            </h1>
          </div>
        </header>

        {/* Player Identity Strip (English Username + Avatar) */}
        <section className="rounded-2xl bg-[#0A241E]/90 border border-[#D4AE58]/40 p-4 backdrop-blur-md space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1 flex-1">
              <label
                htmlFor="online-username-input"
                className="block text-xs font-bold text-[#D4AE58]"
              >
                شناسه کاربری شما در میز آنلاین (انگلیسی)
              </label>
              <input
                id="online-username-input"
                data-testid="online-username-input"
                dir="ltr"
                type="text"
                value={username}
                maxLength={20}
                onChange={(e) =>
                  onChangeUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))
                }
                placeholder="amir_rad"
                className="w-full sm:max-w-xs min-h-[42px] px-3.5 rounded-xl bg-[#051411] border border-[#D4AE58]/45 focus:border-[#F3D179] focus:outline-none text-sm font-bold text-white"
              />
              {!validUsername && (
                <p className="text-[11px] text-[#FCA5A5]">
                  حداقل ۳ کاراکتر انگلیسی، عدد یا _ وارد کنید.
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              {ONLINE_AVATAR_OPTIONS.map((av) => {
                const active = av.code === avatarCode;
                return (
                  <button
                    key={av.code}
                    type="button"
                    onClick={() => onChangeAvatar(av.code)}
                    className={`w-11 h-11 rounded-full overflow-hidden border-2 transition-all cursor-pointer ${
                      active
                        ? 'border-[#F3D179] scale-108 shadow-[0_0_14px_rgba(243,209,121,0.5)]'
                        : 'border-white/20 opacity-70 hover:opacity-100'
                    }`}
                    title={av.label}
                  >
                    <img
                      src={av.src}
                      alt={av.label}
                      className="w-full h-full object-cover"
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {errorMessage && (
          <div
            role="alert"
            data-testid="online-lobby-error"
            className="rounded-xl bg-[#7F1D1D]/85 border border-[#F87171]/60 px-4 py-2.5 text-xs sm:text-sm font-bold text-[#FEE2E2]"
          >
            {errorMessage}
          </div>
        )}

        {/* Primary Online Multiplayer Card */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl bg-gradient-to-b from-[#0E3129]/95 to-[#071C17]/95 border-2 border-[#D4AE58]/60 p-5 sm:p-6 shadow-[0_18px_48px_rgba(0,0,0,0.45)] space-y-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#34D399]/18 border border-[#34D399]/45 text-[11px] font-bold text-[#6EE7B7]">
                <Wifi className="w-3.5 h-3.5" />
                <span>چندنفره زنده با ۴ بازیکن واقعی</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-[#FAF6EE]">
                مسابقه آنلاین حکم
              </h2>
              <p className="text-xs sm:text-sm text-[#A8C4BA] leading-relaxed">
                اتاق اختصاصی بسازید، کد ۶ کاراکتری را برای سه دوست خود بفرستید و همزمان از دستگاه‌های مختلف بازی کنید.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Create Room */}
            <button
              type="button"
              disabled={!validUsername || busy}
              onClick={onCreateRoom}
              data-testid="create-room-btn"
              className="min-h-[54px] px-5 py-3 rounded-2xl bg-gradient-to-b from-[#FCE08B] via-[#E5B84B] to-[#C28F2B] hover:from-[#FFF0B3] hover:to-[#D4A039] disabled:opacity-50 text-[#0B1628] text-sm sm:text-base font-black flex items-center justify-center gap-2 shadow-[0_10px_26px_rgba(243,209,121,0.3)] cursor-pointer transition-all active:scale-[0.98]"
            >
              <Plus className="w-5 h-5 stroke-[2.6]" />
              <span>ساخت اتاق جدید</span>
            </button>

            {/* Join Room by Code */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (cleanJoinCode && validUsername && !busy) {
                  onJoinRoom(cleanJoinCode);
                }
              }}
              className="flex items-stretch gap-2"
            >
              <input
                type="text"
                dir="ltr"
                value={joinCodeInput}
                maxLength={8}
                onChange={(e) =>
                  setJoinCodeInput(
                    e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
                  )
                }
                placeholder="کد اتاق (مثلاً K7M4P2)"
                data-testid="join-room-code-input"
                className="flex-1 min-w-0 min-h-[54px] px-3.5 rounded-2xl bg-[#051411] border border-[#D4AE58]/55 focus:border-[#F3D179] focus:outline-none text-center font-mono text-sm sm:text-base font-black tracking-[0.16em] text-[#F3D179] placeholder:font-sans placeholder:tracking-normal placeholder:text-xs placeholder:text-[#7D9B91]"
              />
              <button
                type="submit"
                disabled={!cleanJoinCode || !validUsername || busy}
                data-testid="join-room-btn"
                className="min-h-[54px] px-4 rounded-2xl bg-[#114236] hover:bg-[#165546] disabled:opacity-45 border border-[#34D399]/55 text-[#ECFDF5] text-sm font-extrabold whitespace-nowrap cursor-pointer transition-colors"
              >
                ورود به اتاق
              </button>
            </form>
          </div>
        </motion.section>

        {/* Secondary Phase 1 Offline Mode Card (Preserved 100%) */}
        <section className="rounded-2xl bg-[#0A221C]/85 border border-[#D4AE58]/35 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/8 border border-[#D4AE58]/40 flex items-center justify-center text-[#F3D179] shrink-0">
              <Gamepad2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-extrabold text-[#FAF6EE]">
                تمرین آفلاین (نسخه مرحله اول)
              </h3>
              <p className="text-xs text-[#9EBAB0]">
                بازی سریع تک‌نفره با ۳ بازیکن شبیه‌سازی‌شده بدون نیاز به اینترنت
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onLaunchOffline}
            data-testid="launch-offline-hokm-btn"
            className="w-full sm:w-auto min-h-[44px] px-5 rounded-xl bg-white/10 hover:bg-white/18 border border-[#D4AE58]/50 text-[#F3D179] text-xs sm:text-sm font-extrabold cursor-pointer transition-colors shrink-0"
          >
            شروع نسخه آفلاین
          </button>
        </section>

        {/* Persisted Recent Online Matches (from SQLite / D1) */}
        <section
          className="rounded-2xl bg-[#081D18]/85 border border-[#D4AE58]/30 p-4 space-y-3"
          data-testid="recent-matches-panel"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-[#F3D179]" />
              <h3 className="text-sm font-extrabold text-[#FAF6EE]">
                مسابقات آنلاین ثبت‌شده اخیر
              </h3>
            </div>
            <button
              type="button"
              onClick={onRefreshMatches}
              className="p-1.5 rounded-lg bg-white/8 hover:bg-white/14 text-[#B8CEC6] cursor-pointer transition-colors"
              title="بروزرسانی"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {recentMatches.length === 0 ? (
            <p className="text-xs text-[#89A59B] py-2 text-center">
              هنوز مسابقه آنلاین تمام‌شده‌ای ثبت نشده است. اولین مسابقه را آغاز کنید!
            </p>
          ) : (
            <div className="space-y-2">
              {recentMatches.slice(0, 5).map((m) => {
                const teamA = m.players
                  .filter((p) => p.team === 'myTeam')
                  .map((p) => p.username)
                  .join(' و ');
                const teamB = m.players
                  .filter((p) => p.team === 'opponentTeam')
                  .map((p) => p.username)
                  .join(' و ');
                return (
                  <div
                    key={m.matchId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-black/25 border border-white/8 px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        dir="ltr"
                        className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-[#0E3129] text-[#F3D179]"
                      >
                        {m.roomCode}
                      </span>
                      <span dir="ltr" className="text-[#A7F3D0] font-semibold">
                        {teamA}
                      </span>
                      <span className="text-[#88A399]">مقابل</span>
                      <span dir="ltr" className="text-[#FCA5A5] font-semibold">
                        {teamB}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {m.lastWinType !== 'normal' && (
                        <span className="px-2 py-0.5 rounded-full bg-[#F3D179]/20 border border-[#F3D179]/50 text-[#FDE68A] text-[10px] font-extrabold">
                          {m.lastWinType === 'hakem_kot' ? 'حاکم‌کُت' : 'کُت'}
                        </span>
                      )}
                      <span className="font-black text-[#FAF6EE] tabular-nums">
                        {toPersianDigits(m.teamAScore)} -{' '}
                        {toPersianDigits(m.teamBScore)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
