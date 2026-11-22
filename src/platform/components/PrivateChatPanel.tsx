import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCheck,
  Loader2,
  MessageSquare,
  Send,
  WifiOff,
} from 'lucide-react';
import { ProfileAvatar } from './TopBar';
import { toPersianDigits } from '../theme/tokens';
import { UserProfile } from '../types/platform';
import {
  ChatConversationItem,
  ChatMessageItem,
  fetchChatMessagesRequest,
  markChatReadApi,
  sendChatMessageApi,
} from '../social/socialClient';

interface PrivateChatPanelProps {
  currentUserId: string;
  conversation: ChatConversationItem;
  onClose: () => void;
  onConversationActivity?: () => void;
}

const CHAT_POLL_INTERVAL_MS = 4500;
const MAX_CHAT_CHARS = 2000;

function toValidAvatarCode(code: string): UserProfile['avatarCode'] {
  if (
    code === 'portrait' ||
    code === 'shamsa' ||
    code === 'turquoise' ||
    code === 'jade' ||
    code === 'lapis'
  ) {
    return code;
  }
  return 'portrait';
}

function generateClientMsgId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return `cmsg_${hex}`;
  }
  return `cmsg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function formatMessageTime(ts: number): string {
  try {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return toPersianDigits(`${hh}:${mm}`);
  } catch {
    return '';
  }
}

function mergeMessagesUnique(
  existing: ChatMessageItem[],
  incoming: ChatMessageItem[]
): ChatMessageItem[] {
  const byId = new Map<string, ChatMessageItem>();
  for (const m of existing) {
    byId.set(m.messageId, m);
  }
  for (const m of incoming) {
    byId.set(m.messageId, m);
  }
  return Array.from(byId.values()).sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.messageId.localeCompare(b.messageId);
  });
}

export const PrivateChatPanel: React.FC<PrivateChatPanelProps> = ({
  currentUserId,
  conversation,
  onClose,
  onConversationActivity,
}) => {
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [partnerLastReadAt, setPartnerLastReadAt] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [offline, setOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastReadMarkedRef = useRef<string | null>(null);
  const pendingClientMsgIdRef = useRef<string | null>(null);

  useEffect(() => {
    const handleOnline = () => setOffline(false);
    const handleOffline = () => setOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const markLatestRead = useCallback(
    async (items: ChatMessageItem[]) => {
      const latest = items[items.length - 1];
      if (!latest || latest.messageId === lastReadMarkedRef.current) return;
      lastReadMarkedRef.current = latest.messageId;
      try {
        await markChatReadApi(conversation.conversationId, latest.messageId);
        onConversationActivity?.();
      } catch {
        // Non-fatal
      }
    },
    [conversation.conversationId, onConversationActivity]
  );

  const loadLatestMessages = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setErrorMsg(null);
      }
      try {
        const res = await fetchChatMessagesRequest(
          conversation.conversationId,
          undefined,
          30
        );
        if (!res.ok) {
          if (!silent) {
            setErrorMsg(res.message ?? 'خطا در دریافت پیام‌های گفتگو.');
          }
          return;
        }
        const fetched = Array.isArray(res.messages) ? res.messages : [];
        setMessages((prev) =>
          silent ? mergeMessagesUnique(prev, fetched) : fetched
        );
        if (!silent) {
          setHasMore(Boolean(res.hasMore));
          setNextBefore(res.nextBefore ?? null);
        }
        setPartnerLastReadAt(res.partnerLastReadAt ?? null);
        if (fetched.length > 0) {
          void markLatestRead(fetched);
        }
      } catch {
        if (!silent) {
          setErrorMsg('ارتباط با سرور برای دریافت پیام‌ها برقرار نشد.');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [conversation.conversationId, markLatestRead]
  );

  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    setNextBefore(null);
    setPartnerLastReadAt(null);
    setErrorMsg(null);
    lastReadMarkedRef.current = null;
    void loadLatestMessages(false);
  }, [conversation.conversationId, loadLatestMessages]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      void loadLatestMessages(true);
    }, CHAT_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [loadLatestMessages]);

  useEffect(() => {
    if (!loading && messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages.length, loading]);

  const handleLoadOlder = async () => {
    if (!hasMore || !nextBefore || loadingOlder) return;
    setLoadingOlder(true);
    setErrorMsg(null);
    try {
      const res = await fetchChatMessagesRequest(
        conversation.conversationId,
        nextBefore,
        30
      );
      if (!res.ok) {
        setErrorMsg(res.message ?? 'خطا در بارگذاری پیام‌های قدیمی‌تر.');
        return;
      }
      const older = Array.isArray(res.messages) ? res.messages : [];
      setMessages((prev) => mergeMessagesUnique(older, prev));
      setHasMore(Boolean(res.hasMore));
      setNextBefore(res.nextBefore ?? null);
    } catch {
      setErrorMsg('خطا در ارتباط با سرور هنگام بارگذاری تاریخچه.');
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_CHAT_CHARS) {
      setErrorMsg(`حداکثر طول پیام ${toPersianDigits(MAX_CHAT_CHARS)} کاراکتر است.`);
      return;
    }

    setSending(true);
    setErrorMsg(null);
    // Preserve clientMsgId across retries of the same draft for strict idempotency
    const clientMsgId = pendingClientMsgIdRef.current ?? generateClientMsgId();
    pendingClientMsgIdRef.current = clientMsgId;

    try {
      const res = await sendChatMessageApi(
        conversation.conversationId,
        trimmed,
        clientMsgId
      );
      if (!res.ok || !res.message || typeof res.message === 'string') {
        setErrorMsg(
          typeof res.message === 'string'
            ? res.message
            : 'ارسال پیام انجام نشد.'
        );
        return;
      }
      const sentItem = res.message;
      pendingClientMsgIdRef.current = null;
      setDraft('');
      setMessages((prev) => mergeMessagesUnique(prev, [sentItem]));
      onConversationActivity?.();
    } catch {
      setErrorMsg('ارسال پیام با خطا مواجه شد. می‌توانید دوباره ارسال کنید.');
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      className="eyvan-card rounded-2xl overflow-hidden flex flex-col border border-[var(--eyvan-gold-border)]"
      data-testid="private-chat-panel"
    >
      {/* Chat Header */}
      <header className="px-4 py-3 border-b border-[var(--eyvan-line)] flex items-center justify-between gap-3 bg-black/15">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            data-testid="chat-close-btn"
            aria-label="بازگشت به لیست دوستان"
            className="w-9 h-9 rounded-xl theme-btn-secondary border flex items-center justify-center shrink-0 cursor-pointer"
          >
            <ArrowRight className="w-4 h-4" />
          </button>

          <div className="relative shrink-0">
            <ProfileAvatar
              avatarCode={toValidAvatarCode(conversation.partner.avatarCode)}
              username={conversation.partner.username}
              size="sm"
            />
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[var(--eyvan-surface)] ${
                conversation.partner.onlineStatus === 'online'
                  ? 'bg-[#22C55E]'
                  : 'bg-[#64748B]'
              }`}
            />
          </div>

          <div className="min-w-0">
            <div
              dir="ltr"
              className="text-sm font-extrabold theme-heading truncate text-right"
              data-testid="chat-partner-username"
            >
              {conversation.partner.username}
            </div>
            <div className="text-[11px] theme-muted">
              {conversation.partner.onlineStatus === 'online'
                ? 'آنلاین'
                : 'آفلاین'}
            </div>
          </div>
        </div>

        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold theme-accent-teal shrink-0">
          <MessageSquare className="w-3.5 h-3.5" />
          <span>گفتگوی خصوصی</span>
        </span>
      </header>

      {/* Offline banner */}
      {offline && (
        <div className="px-4 py-2 bg-amber-500/15 border-b border-amber-500/30 text-xs font-bold text-amber-300 flex items-center gap-2">
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          <span>اتصال اینترنت قطع است. پیام‌ها پس از اتصال مجدد همگام‌سازی می‌شوند.</span>
        </div>
      )}

      {/* Error banner */}
      {errorMsg && (
        <div
          role="alert"
          data-testid="chat-error-banner"
          className="px-4 py-2.5 bg-red-500/12 border-b border-red-500/30 text-xs font-bold text-red-400 flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Messages List */}
      <div
        className="flex-1 min-h-[280px] max-h-[420px] overflow-y-auto px-4 py-3 space-y-2.5"
        data-testid="chat-messages-list"
      >
        {hasMore && (
          <div className="text-center pb-1">
            <button
              type="button"
              disabled={loadingOlder}
              onClick={() => void handleLoadOlder()}
              data-testid="chat-load-older-btn"
              className="min-h-[34px] px-3.5 rounded-xl theme-btn-secondary border text-xs font-bold cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {loadingOlder && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>بارگذاری پیام‌های قدیمی‌تر</span>
            </button>
          </div>
        )}

        {loading ? (
          <div className="py-12 flex items-center justify-center gap-2 theme-muted text-xs font-bold">
            <Loader2 className="w-4 h-4 animate-spin theme-accent-teal" />
            <span>در حال دریافت پیام‌ها...</span>
          </div>
        ) : messages.length === 0 ? (
          <div
            className="py-12 text-center space-y-1.5"
            data-testid="chat-empty-state"
          >
            <p className="text-xs font-bold theme-heading">
              هنوز پیامی ردوبدل نشده است.
            </p>
            <p className="text-[11px] theme-muted">
              اولین پیام را برای شروع گفتگو ارسال کنید.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMine = msg.senderId === currentUserId;
            const isReadByPartner =
              isMine &&
              partnerLastReadAt !== null &&
              partnerLastReadAt >= msg.createdAt;

            return (
              <div
                key={msg.messageId}
                data-testid={`chat-msg-${isMine ? 'mine' : 'theirs'}`}
                className={`flex ${isMine ? 'justify-start' : 'justify-end'}`}
              >
                <div
                  className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed break-words whitespace-pre-wrap border ${
                    isMine
                      ? 'bg-[#0D8A8A]/22 border-[#0D8A8A]/45 theme-heading rounded-tr-sm'
                      : 'theme-subcard border-[var(--eyvan-line)] theme-heading rounded-tl-sm'
                  }`}
                >
                  <div>{msg.body}</div>
                  <div className="mt-1 flex items-center justify-end gap-1 text-[10px] theme-muted">
                    <span>{formatMessageTime(msg.createdAt)}</span>
                    {isReadByPartner && (
                      <CheckCheck
                        className="w-3.5 h-3.5 text-[#34D399]"
                        aria-label="خوانده شده"
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <form
        onSubmit={handleSend}
        className="p-3 border-t border-[var(--eyvan-line)] bg-black/10 flex items-end gap-2"
      >
        <div className="flex-1 min-w-0">
          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              pendingClientMsgIdRef.current = null;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend(e);
              }
            }}
            rows={1}
            maxLength={MAX_CHAT_CHARS}
            placeholder="پیام خود را بنویسید..."
            data-testid="chat-message-input"
            className="w-full min-h-[42px] max-h-[110px] px-3 py-2.5 rounded-xl theme-input border text-xs sm:text-sm focus:outline-none focus:border-[#0D8A8A] resize-none"
          />
          {draft.length > 1600 && (
            <div className="text-[10px] theme-muted text-left mt-0.5 px-1">
              {toPersianDigits(draft.length)} / {toPersianDigits(MAX_CHAT_CHARS)}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={sending || draft.trim().length === 0 || offline}
          data-testid="chat-send-btn"
          className="min-h-[42px] px-4 rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] hover:from-[#F8DD94] hover:to-[#D4AE58] disabled:opacity-50 text-[#0B1628] text-xs font-extrabold inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
        >
          {sending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          <span>ارسال</span>
        </button>
      </form>
    </section>
  );
};
