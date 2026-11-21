import React from 'react';
import {
  RotateCcw,
  Shuffle,
  Volume2,
  VolumeX,
  X,
  Crown,
  Gauge,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { DEFAULT_PLAYERS, Seat } from '../engine/types';
import {
  ANIMATION_SPEED_LABELS,
  AnimationSpeed,
} from '../../../platform/theme/tokens';

interface TestSettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  playerName: string;
  configuredHakem: Seat;
  onChangeConfiguredHakem: (seat: Seat) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  animationSpeed: AnimationSpeed;
  onChangeAnimationSpeed: (speed: AnimationSpeed) => void;
  onStartNewMatch: () => void;
  onReshuffleDeck: () => void;
  onRestartHand: () => void;
  onResetMatchScore: () => void;
}

const SEATS: Seat[] = ['south', 'east', 'north', 'west'];
const SPEEDS: AnimationSpeed[] = ['slow', 'normal', 'fast'];

export const TestSettingsPanel: React.FC<TestSettingsPanelProps> = ({
  isOpen,
  onClose,
  playerName,
  configuredHakem,
  onChangeConfiguredHakem,
  soundEnabled,
  onToggleSound,
  animationSpeed,
  onChangeAnimationSpeed,
  onStartNewMatch,
  onReshuffleDeck,
  onRestartHand,
  onResetMatchScore,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/65 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="تنظیمات آزمایشی حکم"
    >
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="relative z-10 w-full max-w-sm theme-drawer h-full overflow-y-auto border-r border-[#D4AE58]/40 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#D4AE58]/25">
          <h2 className="text-base font-bold theme-accent-gold">
            تنظیمات بازی
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن تنظیمات"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl theme-muted hover:bg-black/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5 flex-1">
          {/* Initial / Next Hand Hakem selector */}
          <section className="space-y-2.5">
            <div className="flex items-center gap-2 text-sm font-bold theme-heading">
              <Crown className="w-4 h-4 theme-accent-gold" />
              <span>حاکم دست بعدی</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {SEATS.map((seat) => {
                const info = DEFAULT_PLAYERS[seat];
                const label = seat === 'south' ? playerName : info.name;
                const active = configuredHakem === seat;
                return (
                  <button
                    key={seat}
                    type="button"
                    onClick={() => onChangeConfiguredHakem(seat)}
                    className={`min-h-[42px] px-3 py-2 rounded-xl border text-left transition-colors cursor-pointer ${
                      active
                        ? 'bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] border-[#F3D179]'
                        : 'theme-subcard theme-heading'
                    }`}
                  >
                    <div dir="ltr" className="text-xs font-extrabold truncate">
                      {label}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Animation Speed */}
          <section className="space-y-2.5">
            <div className="flex items-center gap-2 text-sm font-bold theme-heading">
              <Gauge className="w-4 h-4 theme-accent-teal" />
              <span>سرعت انیمیشن</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 p-1 theme-tab-track border rounded-xl">
              {SPEEDS.map((speed) => {
                const active = animationSpeed === speed;
                return (
                  <button
                    key={speed}
                    type="button"
                    onClick={() => onChangeAnimationSpeed(speed)}
                    className={`min-h-[40px] rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                      active
                        ? 'bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] shadow-sm'
                        : 'theme-muted'
                    }`}
                  >
                    {ANIMATION_SPEED_LABELS[speed]}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Sound Toggle */}
          <section className="flex items-center justify-between py-3 px-4 rounded-xl theme-subcard border">
            <div className="flex items-center gap-2.5">
              {soundEnabled ? (
                <Volume2 className="w-4 h-4 theme-accent-teal" />
              ) : (
                <VolumeX className="w-4 h-4 theme-muted" />
              )}
              <div className="text-sm font-semibold theme-heading">
                صدای بازی
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={soundEnabled}
              aria-label="تغییر وضعیت صدا"
              onClick={onToggleSound}
              className={`w-12 h-7 rounded-full transition-colors p-0.5 cursor-pointer flex items-center ${
                soundEnabled ? 'bg-[#148A8A] justify-start' : 'bg-[#6B7A90] justify-end'
              }`}
            >
              <span className="w-6 h-6 rounded-full bg-white shadow-sm block" />
            </button>
          </section>

          {/* Actions */}
          <section className="space-y-2 pt-2 border-t border-[#D4AE58]/25">
            <button
              type="button"
              onClick={() => {
                onReshuffleDeck();
                onClose();
              }}
              className="w-full min-h-[44px] flex items-center justify-between px-4 py-2.5 rounded-xl theme-btn-secondary border text-sm font-medium transition-colors cursor-pointer"
            >
              <span>بُرزدن مجدد کارت‌ها</span>
              <Shuffle className="w-4 h-4 theme-accent-teal" />
            </button>

            <button
              type="button"
              onClick={() => {
                onRestartHand();
                onClose();
              }}
              className="w-full min-h-[44px] flex items-center justify-between px-4 py-2.5 rounded-xl theme-btn-secondary border text-sm font-medium transition-colors cursor-pointer"
            >
              <span>شروع مجدد همین دست</span>
              <RefreshCw className="w-4 h-4 theme-muted" />
            </button>

            <button
              type="button"
              onClick={() => {
                onResetMatchScore();
                onClose();
              }}
              className="w-full min-h-[44px] flex items-center justify-between px-4 py-2.5 rounded-xl theme-btn-secondary border text-sm font-medium transition-colors cursor-pointer"
            >
              <span>بازنشانی امتیاز (۰ - ۰)</span>
              <Trash2 className="w-4 h-4 theme-accent-gold" />
            </button>

            <button
              type="button"
              onClick={() => {
                onStartNewMatch();
                onClose();
              }}
              className="w-full min-h-[44px] flex items-center justify-between px-4 py-2.5 rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] hover:from-[#F8DD94] hover:to-[#D4AE58] text-sm font-extrabold text-[#0B1628] transition-all cursor-pointer"
            >
              <span>شروع بازی جدید</span>
              <RotateCcw className="w-4 h-4 text-[#0B1628]" />
            </button>
          </section>
        </div>
      </aside>
    </div>
  );
};
