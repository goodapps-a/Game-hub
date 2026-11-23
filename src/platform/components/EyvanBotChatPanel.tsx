import React, { useEffect } from 'react';
import { ArrowLeft, MessageSquare } from 'lucide-react';
import { EyvanLogo } from '../theme/PersianPatterns';
import {
  EYVAN_BOT_ANNOUNCEMENTS,
  EYVAN_OFFICIAL_BOT,
  markEyvanBotAnnouncementsRead,
} from '../social/eyvanBot';

/**
 * Clean circular Eyvan avatar matching standard friend avatars (zero extra badges).
 */
export const EyvanBotAvatar: React.FC<{ size?: 'sm' | 'md' }> = ({
  size = 'md',
}) => {
  const dim = size === 'sm' ? 'w-9 h-9' : 'w-11 h-11';
  const logoSize = size === 'sm' ? 28 : 34;

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
 * One-way read-only chat panel for "ایوان", matching PrivateChatPanel's visual layout 1:1
 * without any extra channel/bot chrome or message composer.
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
      className="eyvan-card rounded-2xl overflow-hidden flex flex-col border border-[var(--eyvan-gold-border)]"
    >
      {/* Header matching PrivateChatPanel */}
      <header className="px-4 py-3 border-b border-[var(--eyvan-line)] flex items-center justify-between gap-3 bg-black/15">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            <EyvanBotAvatar size="sm" />
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[var(--eyvan-surface)] bg-[#22C55E]" />
          </div>

          <div className="min-w-0">
            <div className="text-sm font-extrabold theme-heading truncate">
              {EYVAN_OFFICIAL_BOT.displayName}
            </div>
            <div className="text-[11px] theme-muted">
              {EYVAN_OFFICIAL_BOT.statusLabel}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-bold theme-accent-teal shrink-0">
            <MessageSquare className="w-3.5 h-3.5" />
            <span>گفتگوی خصوصی</span>
          </span>

          <button
            type="button"
            onClick={onClose}
            data-testid="eyvan-bot-chat-back-btn"
            aria-label="بازگشت به لیست دوستان"
            className="min-h-[36px] px-2.5 rounded-xl theme-btn-secondary border inline-flex items-center gap-1 text-xs font-extrabold shrink-0 cursor-pointer"
          >
            <span>بازگشت</span>
            <ArrowLeft className="w-4 h-4 shrink-0" />
          </button>
        </div>
      </header>

      {/* Messages List matching PrivateChatPanel bubbles (no reply input box) */}
      <div className="flex-1 min-h-[260px] max-h-[420px] overflow-y-auto px-4 py-3 space-y-2.5">
        {EYVAN_BOT_ANNOUNCEMENTS.map((msg) => (
          <div key={msg.id} className="flex justify-end">
            <div
              data-testid={`eyvan-bot-msg-${msg.id}`}
              className="max-w-[82%] rounded-2xl px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed break-words whitespace-pre-wrap border theme-subcard border-[var(--eyvan-line)] theme-heading rounded-tl-sm"
            >
              <div>{msg.body}</div>
              <div className="mt-1 flex items-center justify-end gap-1 text-[10px] theme-muted tabular-nums">
                <span>{msg.timeLabel}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
