import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { MessageCircle, Smile, Volume2, X } from 'lucide-react';
import { hokmSound } from '../audio/soundEffects';
import { HOKM_VOICE_CALLOUTS } from '../audio/voiceCallouts';

export type ReactionKind = 'text' | 'emoji' | 'voice';

export interface InGameReactionPayload {
  readonly id: string;
  readonly kind: ReactionKind;
  readonly label: string;
  readonly emoji?: string;
  readonly calloutId?: string;
  readonly spokenText?: string;
  readonly createdAt: number;
}

const PRESET_MESSAGES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'msg-dastkhosh', label: 'دست خوش!' },
  { id: 'msg-eyval', label: 'ایول!' },
  { id: 'msg-hakem', label: 'حاکم واقعی!' },
  { id: 'msg-ajab', label: 'عجب دستی!' },
  { id: 'msg-boridam', label: 'بُریدم!' },
  { id: 'msg-ali', label: 'عالی بازی کردی!' },
  { id: 'msg-eybaba', label: 'ای بابا!' },
  { id: 'msg-havaset', label: 'حواست باشه!' },
  { id: 'msg-kot', label: 'کُت شدین!' },
  { id: 'msg-dametgarm', label: 'دمت گرم یار!' },
  { id: 'msg-zoodbash', label: 'بزن بریم!' },
  { id: 'msg-shans', label: 'عجب شانسی!' },
  { id: 'msg-bacheha', label: 'ایول بچه‌ها!' },
  { id: 'msg-dastetala', label: 'دستت طلا!' },
];

const PRESET_EMOJIS: ReadonlyArray<{ id: string; emoji: string; label: string }> = [
  { id: 'emo-fire', emoji: '🔥', label: 'آتیش' },
  { id: 'emo-clap', emoji: '👏', label: 'تشویق' },
  { id: 'emo-laugh', emoji: '😂', label: 'خنده' },
  { id: 'emo-cool', emoji: '😎', label: 'خفن' },
  { id: 'emo-shock', emoji: '😱', label: 'تعجب' },
  { id: 'emo-crown', emoji: '👑', label: 'پادشاه' },
  { id: 'emo-heart', emoji: '❤️', label: 'عشق' },
  { id: 'emo-skull', emoji: '💀', label: 'وای' },
  { id: 'emo-wink', emoji: '😉', label: 'چشمک' },
  { id: 'emo-sweat', emoji: '😅', label: 'خیس عرق' },
  { id: 'emo-angry', emoji: '😤', label: 'حرص' },
  { id: 'emo-party', emoji: '🎉', label: 'جشن' },
  { id: 'emo-muscle', emoji: '💪', label: 'قوی' },
  { id: 'emo-thinking', emoji: '🤔', label: 'فکر' },
  { id: 'emo-salute', emoji: '🫡', label: 'احترام' },
  { id: 'emo-100', emoji: '💯', label: 'صد در صد' },
];

interface InGameReactionMenuProps {
  onSendReaction: (payload: InGameReactionPayload) => void;
  reducedMotion: boolean;
}

export const InGameReactionMenu: React.FC<InGameReactionMenuProps> = ({
  onSendReaction,
  reducedMotion,
}) => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ReactionKind>('emoji');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutsidePointer = (e: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handleOutsidePointer, true);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer, true);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const emit = (payload: Omit<InGameReactionPayload, 'createdAt'>) => {
    if (payload.kind === 'voice' && payload.calloutId && payload.spokenText) {
      // Strictly ZERO click/chime SFX for voice callouts — play only the natural TTS voice!
      hokmSound.playVoiceCallout(payload.calloutId, payload.spokenText);
    } else {
      hokmSound.playCardSelect();
    }
    onSendReaction({
      ...payload,
      createdAt: Date.now(),
    });
    setOpen(false);
  };

  return (
    <div
      ref={containerRef}
      dir="rtl"
      className="fixed right-2.5 sm:right-4 bottom-[20%] sm:bottom-[22%] z-[38] pointer-events-auto"
    >
      {/* Absolutely anchored glass popover above the trigger so the trigger button NEVER shifts */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="reaction-popover"
            data-testid="ingame-reaction-popover"
            initial={
              reducedMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.9, y: 10 }
            }
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={
              reducedMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.92, y: 8 }
            }
            transition={{ type: 'spring', stiffness: 460, damping: 32 }}
            className="absolute bottom-[calc(100%+10px)] right-0 w-[264px] sm:w-[296px] rounded-2xl bg-[#071A16]/88 border border-white/22 shadow-[0_18px_48px_rgba(0,0,0,0.68),inset_0_1px_0_rgba(255,255,255,0.22)] backdrop-blur-2xl overflow-hidden"
          >
            {/* Compact 3-tab selector */}
            <div className="grid grid-cols-3 gap-1 p-1.5 bg-black/30 border-b border-white/12">
              <button
                type="button"
                onClick={() => setTab('emoji')}
                data-testid="reaction-tab-emoji"
                className={`h-8 rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                  tab === 'emoji'
                    ? 'bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628]'
                    : 'text-[#C6DDD5] hover:bg-white/10'
                }`}
              >
                <Smile className="w-3.5 h-3.5" />
                <span>ایموجی</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('text')}
                data-testid="reaction-tab-text"
                className={`h-8 rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                  tab === 'text'
                    ? 'bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628]'
                    : 'text-[#C6DDD5] hover:bg-white/10'
                }`}
              >
                <MessageCircle className="w-3.5 h-3.5" />
                <span>پیام</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('voice')}
                data-testid="reaction-tab-voice"
                className={`h-8 rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                  tab === 'voice'
                    ? 'bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628]'
                    : 'text-[#C6DDD5] hover:bg-white/10'
                }`}
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>صوت</span>
              </button>
            </div>

            {/* Scrollable compact panel body */}
            <div className="p-2 max-h-[228px] overflow-y-auto overscroll-contain">
              {tab === 'emoji' && (
                <div className="grid grid-cols-4 gap-1.5">
                  {PRESET_EMOJIS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-label={item.label}
                      onClick={() =>
                        emit({
                          id: item.id,
                          kind: 'emoji',
                          label: item.label,
                          emoji: item.emoji,
                        })
                      }
                      className="h-11 rounded-xl bg-white/[0.08] hover:bg-[#F3D179]/22 border border-white/12 hover:border-[#F3D179]/55 text-xl flex items-center justify-center transition-transform active:scale-90 cursor-pointer"
                    >
                      <span>{item.emoji}</span>
                    </button>
                  ))}
                </div>
              )}

              {tab === 'text' && (
                <div className="grid grid-cols-2 gap-1.5">
                  {PRESET_MESSAGES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        emit({
                          id: item.id,
                          kind: 'text',
                          label: item.label,
                        })
                      }
                      className="min-h-[36px] px-2.5 py-1.5 rounded-xl bg-white/[0.08] hover:bg-[#F3D179]/22 border border-white/12 hover:border-[#F3D179]/55 text-[11px] sm:text-xs font-extrabold text-[#FAF6EE] transition-colors cursor-pointer truncate"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}

              {tab === 'voice' && (
                <div className="grid grid-cols-2 gap-1.5">
                  {HOKM_VOICE_CALLOUTS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      data-voice-callout={item.calloutId}
                      onClick={() =>
                        emit({
                          id: item.id,
                          kind: 'voice',
                          label: item.label,
                          calloutId: item.calloutId,
                          spokenText: item.spokenText,
                        })
                      }
                      className="min-h-[38px] px-2.5 py-1.5 rounded-xl bg-[#0D8A8A]/28 hover:bg-[#0D8A8A]/48 border border-[#2CC5BE]/45 text-[11px] sm:text-xs font-black text-[#E8FFF9] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Volume2 className="w-3.5 h-3.5 text-[#FDE68A] shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fixed-anchor Trigger Button: Smile icon morphs seamlessly into X in the exact same position */}
      <motion.button
        type="button"
        whileTap={reducedMotion ? undefined : { scale: 0.9 }}
        onClick={() => setOpen((prev) => !prev)}
        data-testid="ingame-reaction-trigger"
        data-open={open ? 'true' : 'false'}
        aria-label={open ? 'بستن پیام‌های سریع' : 'ارسال ایموجی، پیام یا صوت'}
        aria-expanded={open}
        className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full border flex items-center justify-center shadow-[0_8px_24px_rgba(0,0,0,0.52),inset_0_1px_0_rgba(255,255,255,0.28)] backdrop-blur-xl transition-colors cursor-pointer ${
          open
            ? 'bg-gradient-to-b from-[#F3D179] to-[#C89B3C] border-[#FFF3C4] text-[#0B1628]'
            : 'bg-[#081F1A]/80 hover:bg-[#0C2D26]/92 border-[#F3D179]/55 text-[#FDE68A]'
        }`}
      >
        <AnimatePresence mode="wait" initial={false}>
          {open ? (
            <motion.span
              key="icon-close"
              initial={reducedMotion ? false : { rotate: -90, scale: 0.6, opacity: 0 }}
              animate={{ rotate: 0, scale: 1, opacity: 1 }}
              exit={reducedMotion ? undefined : { rotate: 90, scale: 0.6, opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="flex items-center justify-center"
            >
              <X className="w-5 h-5" />
            </motion.span>
          ) : (
            <motion.span
              key="icon-smile"
              initial={reducedMotion ? false : { rotate: 90, scale: 0.6, opacity: 0 }}
              animate={{ rotate: 0, scale: 1, opacity: 1 }}
              exit={reducedMotion ? undefined : { rotate: -90, scale: 0.6, opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="flex items-center justify-center"
            >
              <Smile className="w-5 h-5" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
};

/**
 * Sleek modern animated SVG acoustic waveform for in-game Persian voice callout bubbles.
 * Uses GPU-composited vertical harmonic oscillation so it stays silky 60fps with zero SVG path errors.
 */
const SleekVoiceWaveform: React.FC<{ reducedMotion: boolean }> = ({
  reducedMotion,
}) => (
  <span
    className="relative inline-flex items-center justify-center w-9 h-5 shrink-0"
    aria-hidden="true"
  >
    <svg
      viewBox="0 0 36 20"
      className="w-full h-full overflow-visible"
      fill="none"
    >
      <defs>
        <linearGradient id="eyvanWaveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#5EEAD4" />
          <stop offset="50%" stopColor="#FEF08A" />
          <stop offset="100%" stopColor="#34D399" />
        </linearGradient>
      </defs>
      {/* Soft ambient wave glow */}
      <motion.g
        style={{ transformOrigin: '18px 10px' }}
        animate={
          reducedMotion
            ? undefined
            : { scaleY: [0.55, 1.15, -0.85, 0.55], opacity: [0.24, 0.44, 0.28, 0.24] }
        }
        transition={{ duration: 0.95, repeat: Infinity, ease: 'easeInOut' }}
      >
        <path
          d="M1 10 Q 5.5 3, 10 10 T 19 10 T 28 10 T 35 10"
          stroke="url(#eyvanWaveGrad)"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      </motion.g>
      {/* Crisp primary harmonic curve */}
      <motion.g
        style={{ transformOrigin: '18px 10px' }}
        animate={
          reducedMotion
            ? undefined
            : { scaleY: [0.95, -1.05, 0.7, 0.95] }
        }
        transition={{ duration: 0.76, repeat: Infinity, ease: 'easeInOut' }}
      >
        <path
          d="M1 10 Q 5.5 2, 10 10 T 19 10 T 28 10 T 35 10"
          stroke="url(#eyvanWaveGrad)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </motion.g>
      {/* Counter-phase secondary acoustic wave */}
      <motion.g
        style={{ transformOrigin: '18px 10px' }}
        animate={
          reducedMotion
            ? undefined
            : { scaleY: [-0.8, 0.95, -0.55, -0.8] }
        }
        transition={{ duration: 0.88, repeat: Infinity, ease: 'easeInOut' }}
      >
        <path
          d="M1 10 Q 6 16, 11 10 T 21 10 T 35 10"
          stroke="#FFFFFF"
          strokeOpacity={0.78}
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </motion.g>
    </svg>
  </span>
);

interface SeatReactionBubbleProps {
  reaction: InGameReactionPayload | null;
  positionClassName: string;
  reducedMotion: boolean;
}

export const SeatReactionBubble: React.FC<SeatReactionBubbleProps> = ({
  reaction,
  positionClassName,
  reducedMotion,
}) => (
  <AnimatePresence>
    {reaction && (
      <motion.div
        key={`${reaction.id}-${reaction.createdAt}`}
        data-testid="seat-reaction-bubble"
        initial={
          reducedMotion
            ? { opacity: 0 }
            : { opacity: 0, scale: 0.6, y: 10 }
        }
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={
          reducedMotion
            ? { opacity: 0 }
            : { opacity: 0, scale: 0.82, y: -12 }
        }
        transition={{ type: 'spring', stiffness: 420, damping: 24 }}
        className={`pointer-events-none z-[48] ${positionClassName}`}
      >
        {reaction.kind === 'emoji' ? (
          <motion.div
            animate={
              reducedMotion
                ? undefined
                : { scale: [1, 1.24, 1], rotate: [-6, 6, 0] }
            }
            transition={{ duration: 0.55, ease: 'easeOut' }}
            className="text-4xl sm:text-5xl drop-shadow-[0_6px_16px_rgba(0,0,0,0.65)] select-none"
          >
            {reaction.emoji}
          </motion.div>
        ) : reaction.kind === 'voice' ? (
          <div className="relative px-3.5 py-1.5 rounded-full bg-gradient-to-l from-[#0B3D37]/85 via-[#092926]/85 to-[#0B3D37]/85 backdrop-blur-xl border border-[#5EEAD4]/55 shadow-[0_10px_28px_rgba(0,0,0,0.58),0_0_20px_rgba(44,197,190,0.28),inset_0_1px_0_rgba(255,255,255,0.25)] flex items-center gap-2 whitespace-nowrap">
            <SleekVoiceWaveform reducedMotion={reducedMotion} />
            <span className="text-xs sm:text-sm font-black text-[#FFFBEB]">
              {reaction.label}
            </span>
          </div>
        ) : (
          <div className="px-3.5 py-1.5 rounded-2xl bg-[#071B17]/88 backdrop-blur-xl border border-[#F3D179]/55 shadow-[0_10px_28px_rgba(0,0,0,0.58),inset_0_1px_0_rgba(255,255,255,0.2)] text-xs sm:text-sm font-black text-[#FAF6EE] whitespace-nowrap">
            {reaction.label}
          </div>
        )}
      </motion.div>
    )}
  </AnimatePresence>
);
