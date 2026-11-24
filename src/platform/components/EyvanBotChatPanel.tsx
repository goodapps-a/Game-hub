import React, { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { EyvanLogo } from '../theme/PersianPatterns';
import {
  EYVAN_BOT_ANNOUNCEMENTS,
  EYVAN_OFFICIAL_BOT,
  markEyvanBotAnnouncementsRead,
} from '../social/eyvanBot';

/**
 * Clean circular Eyvan avatar matching standard friend avatars.
 */
export const EyvanBotAvatar: React.FC<{ size?: 'sm' | 'md' }> = ({
  size = 'md',
}) => {
  const dim = size === 'sm' ? 'w-9 h-9' : 'w-12 h-12';
  const logoSize = size === 'sm' ? 28 : 36;

  return (
    <div
      className={`${dim} rounded-full bg-[#0D213B] border border-[#2CC5BE]/45 flex items-center justify-center overflow-hidden shrink-0 shadow-xs`}
    >
      <EyvanLogo size={logoSize} />
    </div>
  );
};

interface EyvanBotChatPanelProps {
  onClose: () => void;
  onMarkedRead?: () => void;
}

/**
 * Full-screen Telegram-style read-only announcements view for "ایوان".
 */
export const EyvanBotChatPanel: React.FC<EyvanBotChatPanelProps> = ({
  onClose,
  onMarkedRead,
}) => {
  useEffect(() => {
    markEyvanBotAnnouncementsRead();
    onMarkedRead?.();
  }, [onMarkedRead]);

  return (
    <section
      data-testid="eyvan-bot-chat-panel"
      className="fixed inset-0 z-50 flex flex-col bg-[var(--eyvan-bg)] text-[var(--eyvan-text)]"
    >
      {/* Telegram-Style Sticky Top Header */}
      <header className="h-14 shrink-0 px-2.5 sm:px-4 border-b border-[var(--eyvan-line)] theme-drawer flex items-center gap-2 shadow-sm">
        <button
          type="button"
          onClick={onClose}
          data-testid="eyvan-bot-chat-back-btn"
          aria-label="بازگشت به لیست گفتگوها"
          className="w-9 h-9 rounded-full hover:bg-white/8 flex items-center justify-center theme-heading shrink-0 cursor-pointer transition-colors"
        >
          <ArrowLeft className="w-5 h-5 rotate-180" />
        </button>

        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="relative shrink-0">
            <EyvanBotAvatar size="sm" />
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[var(--eyvan-bg)] bg-[#22C55E] shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
          </div>

          <div className="min-w-0">
            <div className="text-sm font-black theme-heading truncate leading-tight">
              {EYVAN_OFFICIAL_BOT.displayName}
            </div>
            <div className="text-[11px] font-bold text-[#22C55E] leading-tight mt-0.5">
              {EYVAN_OFFICIAL_BOT.statusLabel}
            </div>
          </div>
        </div>
      </header>

      {/* Full-Height Announcements Stream */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-2.5 max-w-3xl w-full mx-auto">
        {EYVAN_BOT_ANNOUNCEMENTS.map((msg) => (
          <div key={msg.id} className="flex justify-end">
            <div
              data-testid={`eyvan-bot-msg-${msg.id}`}
              className="max-w-[85%] sm:max-w-[74%] rounded-2xl px-3.5 py-2.5 text-[13px] sm:text-sm leading-relaxed break-words whitespace-pre-wrap border theme-subcard border-[var(--eyvan-line)] theme-heading rounded-tl-sm shadow-xs"
            >
              <div>{msg.body}</div>
              <div className="mt-1 flex items-center justify-end gap-1 text-[10px] theme-muted tabular-nums">
                <span>{msg.timeLabel}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Read-only footer notice */}
      <div
        className="shrink-0 px-4 py-2.5 border-t border-[var(--eyvan-line)] theme-drawer text-center text-[11px] font-bold theme-muted"
        style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}
      >
        پیام‌های رسمی و اطلاعیه‌های ایوان
      </div>
    </section>
  );
};
