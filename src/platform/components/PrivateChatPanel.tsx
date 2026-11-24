import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCheck,
  Clock,
  Gamepad2,
  Loader2,
  MessageSquare,
  RotateCcw,
  Send,
  Users,
  WifiOff,
} from 'lucide-react';
import { ProfileAvatar } from './TopBar';
import { toPersianDigits } from '../theme/tokens';
import { UserProfile } from '../types/platform';
import {
  CHAT_FALLBACK_POLL_INTERVAL_MS,
  CHAT_WS_CLOSE_FORBIDDEN,
  CHAT_WS_CLOSE_UNAUTHORIZED,
  ChatReadCursor,
  ChatUiMessage,
  advanceReadCursorMonotonic,
  compareMessageCursor,
  computeReconnectDelayMs,
  getLatestConfirmedCursor,
  getLatestPartnerConfirmedMessage,
  isMessageReadByPartner,
  mergeChatMessages,
  parseChatWsServerEvent,
  toConfirmedUiMessage,
} from '../social/chatRealtimeProtocol';
import {
  ChatConversationItem,
  buildChatWebSocketUrl,
  fetchChatMessagesRequest,
  markChatReadApi,
  sendChatMessageApi,
} from '../social/socialClient';

interface PrivateChatPanelProps {
  currentUserId: string;
  conversation: ChatConversationItem;
  onClose: () => void;
  onConversationActivity?: () => void;
  onOpenFriendGroups?: () => void;
  onInspectPlayer?: (userId: string) => void;
}

const MAX_CHAT_CHARS = 2000;

const TWO_PLAYER_GAMES: ReadonlyArray<{
  id: 'chess' | 'backgammon' | 'pasoor' | 'ludo';
  label: string;
}> = [
  { id: 'chess', label: 'شطرنج' },
  { id: 'backgammon', label: 'تخته نرد' },
  { id: 'pasoor', label: 'پاسور' },
  { id: 'ludo', label: 'منچ' },
];

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

function isPageVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState === 'visible';
}

export const PrivateChatPanel: React.FC<PrivateChatPanelProps> = ({
  currentUserId,
  conversation,
  onClose,
  onConversationActivity,
  onOpenFriendGroups,
  onInspectPlayer,
}) => {
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [partnerReadCursor, setPartnerReadCursor] = useState<ChatReadCursor | null>(
    null
  );
  const [draft, setDraft] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [offline, setOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);
  const messagesRef = useRef<ChatUiMessage[]>([]);
  const lastReadMarkedRef = useRef<{ createdAt: number; messageId: string } | null>(
    null
  );
  const readInFlightRef = useRef(false);
  const deltaInFlightRef = useRef(false);
  const wsConnectedRef = useRef(false);
  const revokedRef = useRef(false);
  const activeConvIdRef = useRef(conversation.conversationId);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const hadConnectedOnceRef = useRef(false);
  const prevMsgCountRef = useRef(0);
  const onConversationActivityRef = useRef(onConversationActivity);
  const readCooldownUntilRef = useRef(0);

  messagesRef.current = messages;
  activeConvIdRef.current = conversation.conversationId;
  onConversationActivityRef.current = onConversationActivity;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Marks the latest confirmed message from the partner as read ONLY when:
   * - This chat panel is open for the exact conversationId,
   * - The page/tab is genuinely visible (`document.visibilityState === 'visible'`),
   * - The partner message is strictly newer than the last marked cursor.
   */
  const maybeMarkPartnerMessagesRead = useCallback(
    async (items: readonly ChatUiMessage[]) => {
      if (!mountedRef.current || revokedRef.current || !isPageVisible()) return;
      const targetConvId = activeConvIdRef.current;
      const latestPartnerMsg = getLatestPartnerConfirmedMessage(items, currentUserId);
      if (!latestPartnerMsg) return;

      const prevMarked = lastReadMarkedRef.current;
      if (
        prevMarked &&
        compareMessageCursor(
          {
            createdAt: latestPartnerMsg.createdAt,
            messageId: latestPartnerMsg.messageId,
          },
          prevMarked
        ) <= 0
      ) {
        return;
      }

      if (readInFlightRef.current || Date.now() < readCooldownUntilRef.current) return;
      readInFlightRef.current = true;
      const attemptCursor = {
        createdAt: latestPartnerMsg.createdAt,
        messageId: latestPartnerMsg.messageId,
      };
      try {
        const res = await markChatReadApi(targetConvId, latestPartnerMsg.messageId);
        if (!mountedRef.current || activeConvIdRef.current !== targetConvId) return;
        if (res.ok) {
          lastReadMarkedRef.current = attemptCursor;
          readCooldownUntilRef.current = 0;
          onConversationActivityRef.current?.();
        } else {
          readCooldownUntilRef.current = Date.now() + 2500;
        }
      } catch {
        readCooldownUntilRef.current = Date.now() + 2500;
        // Non-fatal; will retry on next message/focus/sync
      } finally {
        readInFlightRef.current = false;
      }
    },
    [currentUserId]
  );

  /**
   * Initial history load (fetches latest 30 messages + initial partner read cursor).
   */
  const loadInitialMessages = useCallback(async () => {
    const targetConvId = conversation.conversationId;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetchChatMessagesRequest(targetConvId, undefined, 30);
      if (!mountedRef.current || activeConvIdRef.current !== targetConvId) return;
      if (!res.ok) {
        setErrorMsg(res.message ?? 'خطا در دریافت پیام‌های گفتگو.');
        if (res.code === 'USER_BLOCKED' || res.code === 'FORBIDDEN' || res.code === 'NOT_FRIENDS') {
          revokedRef.current = true;
          setRevoked(true);
        }
        return;
      }
      const fetched = Array.isArray(res.messages)
        ? res.messages.map(toConfirmedUiMessage)
        : [];
      setMessages((prev) => mergeChatMessages(prev, fetched));
      setHasMore(Boolean(res.hasMore));
      setNextBefore(res.nextBefore ?? null);
      if (typeof res.partnerLastReadAt === 'number' && res.partnerLastReadAt > 0) {
        setPartnerReadCursor((prev) =>
          advanceReadCursorMonotonic(prev, {
            lastReadAt: res.partnerLastReadAt!,
            lastReadMessageId: res.partnerLastReadMessageId ?? null,
          })
        );
      }
      if (fetched.length > 0) {
        void maybeMarkPartnerMessagesRead(fetched);
      }
    } catch {
      if (mountedRef.current && activeConvIdRef.current === targetConvId) {
        setErrorMsg('ارتباط با سرور برای دریافت پیام‌ها برقرار نشد.');
      }
    } finally {
      if (mountedRef.current && activeConvIdRef.current === targetConvId) {
        setLoading(false);
      }
    }
  }, [conversation.conversationId, maybeMarkPartnerMessagesRead]);

  /**
   * Lightweight incremental HTTP delta sync:
   * - Fetches ONLY messages strictly after the latest confirmed `(createdAt, messageId)`
   *   plus the latest `partnerLastReadAt` / `partnerLastReadMessageId` cursor.
   * - Used ONLY on WebSocket reconnect recovery OR while WebSocket is disconnected (fallback).
   * - Never refetches 30 old messages on every tick.
   */
  const syncDeltaMessages = useCallback(async () => {
    if (deltaInFlightRef.current || revokedRef.current) return;
    const targetConvId = conversation.conversationId;
    deltaInFlightRef.current = true;
    try {
      const latestCursor = getLatestConfirmedCursor(messagesRef.current);
      const res = await fetchChatMessagesRequest(
        targetConvId,
        undefined,
        30,
        undefined,
        latestCursor
          ? {
              after: latestCursor.createdAt,
              afterMessageId: latestCursor.messageId,
            }
          : undefined
      );
      if (!mountedRef.current || activeConvIdRef.current !== targetConvId) return;
      if (!res.ok) {
        if (
          res.code === 'USER_BLOCKED' ||
          res.code === 'FORBIDDEN' ||
          res.code === 'NOT_FRIENDS' ||
          res.code === 'UNAUTHORIZED'
        ) {
          revokedRef.current = true;
          setRevoked(true);
          setErrorMsg(res.message ?? 'دسترسی به این گفتگو دیگر فعال نیست.');
        }
        return;
      }

      const incoming = Array.isArray(res.messages)
        ? res.messages.map(toConfirmedUiMessage)
        : [];
      if (incoming.length > 0) {
        const merged = mergeChatMessages(messagesRef.current, incoming);
        setMessages(merged);
        void maybeMarkPartnerMessagesRead(merged);
      }

      if (typeof res.partnerLastReadAt === 'number' && res.partnerLastReadAt > 0) {
        setPartnerReadCursor((prev) =>
          advanceReadCursorMonotonic(prev, {
            lastReadAt: res.partnerLastReadAt!,
            lastReadMessageId: res.partnerLastReadMessageId ?? null,
          })
        );
      }
    } catch {
      // Non-fatal transient network failure; next backoff/fallback cycle will retry
    } finally {
      deltaInFlightRef.current = false;
    }
  }, [conversation.conversationId, maybeMarkPartnerMessagesRead]);

  // Reset state & perform single initial load when conversation changes
  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    setNextBefore(null);
    setPartnerReadCursor(null);
    setErrorMsg(null);
    setRevoked(false);
    setWsConnected(false);
    wsConnectedRef.current = false;
    revokedRef.current = false;
    lastReadMarkedRef.current = null;
    readCooldownUntilRef.current = 0;
    hadConnectedOnceRef.current = false;
    reconnectAttemptRef.current = 0;
    prevMsgCountRef.current = 0;
    void loadInitialMessages();
  }, [conversation.conversationId, loadInitialMessages]);

  // Real-time WebSocket lifecycle with capped Exponential Backoff reconnect
  useEffect(() => {
    const targetConvId = conversation.conversationId;
    let disposed = false;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed || revokedRef.current) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      clearReconnectTimer();
      const delayMs = computeReconnectDelayMs(reconnectAttemptRef.current);
      reconnectAttemptRef.current = Math.min(10, reconnectAttemptRef.current + 1);
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        if (!disposed && !revokedRef.current) {
          connectSocket();
        }
      }, delayMs);
    };

    const connectSocket = () => {
      if (disposed || revokedRef.current) return;
      if (typeof WebSocket === 'undefined') return;
      clearReconnectTimer();

      let wsUrl: string;
      try {
        wsUrl = buildChatWebSocketUrl(targetConvId);
      } catch {
        return;
      }

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed || wsRef.current !== ws) {
          try {
            ws.close(1000, 'panel_closed');
          } catch {
            // Ignore
          }
          return;
        }
        wsConnectedRef.current = true;
        setWsConnected(true);
        reconnectAttemptRef.current = 0;

        // Recover any missed messages/read updates after a disconnect/reconnect
        if (hadConnectedOnceRef.current) {
          void syncDeltaMessages();
        }
        hadConnectedOnceRef.current = true;
      };

      ws.onmessage = (event) => {
        if (disposed || wsRef.current !== ws || typeof event.data !== 'string') {
          return;
        }
        const parsed = parseChatWsServerEvent(event.data);
        if (!parsed) return;

        if (
          parsed.type === 'message:new' &&
          parsed.conversationId === targetConvId
        ) {
          const confirmed = toConfirmedUiMessage(parsed.message);
          const merged = mergeChatMessages(messagesRef.current, [confirmed]);
          setMessages(merged);
          if (confirmed.senderId !== currentUserId) {
            void maybeMarkPartnerMessagesRead(merged);
          }
          return;
        }

        if (
          parsed.type === 'read:updated' &&
          parsed.conversationId === targetConvId &&
          parsed.readerUserId !== currentUserId
        ) {
          setPartnerReadCursor((prev) =>
            advanceReadCursorMonotonic(prev, {
              lastReadAt: parsed.lastReadAt,
              lastReadMessageId: parsed.lastReadMessageId,
            })
          );
          return;
        }

        if (
          parsed.type === 'conversation:revoked' &&
          (!parsed.conversationId || parsed.conversationId === targetConvId)
        ) {
          revokedRef.current = true;
          wsConnectedRef.current = false;
          setRevoked(true);
          setWsConnected(false);
          clearReconnectTimer();
          setErrorMsg(
            parsed.reason === 'blocked'
              ? 'دسترسی به این گفتگو به دلیل مسدودیت قطع شد.'
              : parsed.reason === 'unfriended'
                ? 'این گفتگو دیگر فعال نیست زیرا دوستی حذف شده است.'
                : parsed.reason === 'session_revoked'
                  ? 'نشست کاربری شما خاتمه یافت. لطفاً دوباره وارد شوید.'
                  : 'دسترسی به این گفتگو غیرفعال شد.'
          );
        }
      };

      ws.onerror = () => {
        // Close handler manages reconnect & fallback transition
      };

      ws.onclose = (closeEvent) => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
        wsConnectedRef.current = false;
        if (!disposed) {
          setWsConnected(false);
        }
        if (disposed) return;

        if (
          closeEvent.code === CHAT_WS_CLOSE_UNAUTHORIZED ||
          closeEvent.code === CHAT_WS_CLOSE_FORBIDDEN
        ) {
          revokedRef.current = true;
          setRevoked(true);
          clearReconnectTimer();
          setErrorMsg(
            closeEvent.code === CHAT_WS_CLOSE_UNAUTHORIZED
              ? 'نشست کاربری معتبر نیست یا منقضی شده است.'
              : 'دسترسی به این گفتگو مجاز نیست.'
          );
          return;
        }

        scheduleReconnect();
      };
    };

    connectSocket();

    const handleOnline = () => {
      setOffline(false);
      if (disposed || revokedRef.current) return;
      reconnectAttemptRef.current = 0;
      if (!wsConnectedRef.current) {
        connectSocket();
        void syncDeltaMessages();
      }
    };

    const handleOffline = () => {
      setOffline(true);
      clearReconnectTimer();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      disposed = true;
      clearReconnectTimer();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      wsConnectedRef.current = false;
      const activeWs = wsRef.current;
      wsRef.current = null;
      if (activeWs) {
        try {
          activeWs.close(1000, 'panel_closed');
        } catch {
          // Ignore
        }
      }
    };
  }, [
    conversation.conversationId,
    currentUserId,
    maybeMarkPartnerMessagesRead,
    syncDeltaMessages,
  ]);

  // Fallback incremental HTTP polling — strictly DISABLED while WebSocket is connected
  useEffect(() => {
    if (wsConnected || loading || revoked || offline) return;

    const timerId = window.setInterval(() => {
      if (wsConnectedRef.current || revokedRef.current || !isPageVisible()) {
        return;
      }
      void syncDeltaMessages();
    }, CHAT_FALLBACK_POLL_INTERVAL_MS);

    return () => window.clearInterval(timerId);
  }, [wsConnected, loading, revoked, offline, syncDeltaMessages]);

  // Mark unread partner messages as read ONLY when the user brings the tab/window into focus
  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (isPageVisible() && messagesRef.current.length > 0) {
        void maybeMarkPartnerMessagesRead(messagesRef.current);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, [maybeMarkPartnerMessagesRead]);

  // Auto-scroll smoothly when new messages arrive
  useEffect(() => {
    if (!loading && messages.length > prevMsgCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    prevMsgCountRef.current = messages.length;
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
      const older = Array.isArray(res.messages)
        ? res.messages.map(toConfirmedUiMessage)
        : [];
      setMessages((prev) => mergeChatMessages(older, prev));
      setHasMore(Boolean(res.hasMore));
      setNextBefore(res.nextBefore ?? null);
    } catch {
      setErrorMsg('خطا در ارتباط با سرور هنگام بارگذاری تاریخچه.');
    } finally {
      setLoadingOlder(false);
    }
  };

  /**
   * Sends (or retries) a message using strict `clientMsgId` idempotency.
   * Shows Optimistic UI (`sending`, NO tick) immediately and upgrades to 1 tick
   * ONLY after the server commits to D1 and returns success.
   */
  const dispatchMessageSend = useCallback(
    async (
      bodyText: string,
      clientMsgId: string,
      existingOptimisticId?: string,
      kind: 'text' | 'game_invite' = 'text',
      gameId?: 'chess' | 'backgammon' | 'pasoor' | 'ludo'
    ) => {
      const targetConvId = conversation.conversationId;
      const optimisticId = existingOptimisticId ?? `opt_${clientMsgId}`;
      const optimisticItem: ChatUiMessage = {
        messageId: optimisticId,
        conversationId: targetConvId,
        senderId: currentUserId,
        kind,
        body: bodyText,
        clientMsgId,
        createdAt: Date.now(),
        localStatus: 'sending',
      };

      setErrorMsg(null);
      setMessages((prev) => mergeChatMessages(prev, [optimisticItem]));

      try {
        const res = await sendChatMessageApi(
          targetConvId,
          bodyText,
          clientMsgId,
          kind,
          gameId
        );
        if (!mountedRef.current || activeConvIdRef.current !== targetConvId) return;

        if (!res.ok || !res.message || typeof res.message === 'string') {
          const reason =
            typeof res.message === 'string'
              ? res.message
              : 'ارسال پیام انجام نشد.';
          setMessages((prev) =>
            prev.map((m) =>
              m.clientMsgId === clientMsgId && m.localStatus !== 'sent'
                ? { ...m, localStatus: 'failed', errorText: reason }
                : m
            )
          );
          if (
            res.code === 'USER_BLOCKED' ||
            res.code === 'NOT_FRIENDS' ||
            res.code === 'FORBIDDEN'
          ) {
            revokedRef.current = true;
            setRevoked(true);
            setErrorMsg(reason);
          }
          return;
        }

        const confirmed = toConfirmedUiMessage(res.message);
        setMessages((prev) => mergeChatMessages(prev, [confirmed]));
      } catch {
        if (!mountedRef.current || activeConvIdRef.current !== targetConvId) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.clientMsgId === clientMsgId && m.localStatus !== 'sent'
              ? {
                  ...m,
                  localStatus: 'failed',
                  errorText: 'ارسال نشد. برای تلاش مجدد کلیک کنید.',
                }
              : m
          )
        );
      }
    },
    [conversation.conversationId, currentUserId]
  );

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (revoked) return;
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_CHAT_CHARS) {
      setErrorMsg(`حداکثر طول پیام ${toPersianDigits(MAX_CHAT_CHARS)} کاراکتر است.`);
      return;
    }

    const clientMsgId = generateClientMsgId();
    setDraft('');
    await dispatchMessageSend(trimmed, clientMsgId);
  };

  const handleRetryFailed = (msg: ChatUiMessage) => {
    if (revoked || msg.localStatus !== 'failed') return;
    const retryClientMsgId = msg.clientMsgId ?? generateClientMsgId();
    void dispatchMessageSend(msg.body, retryClientMsgId, msg.messageId);
  };

  const handleSendTwoPlayerInvite = (
    gameId: 'chess' | 'backgammon' | 'pasoor' | 'ludo',
    label: string
  ) => {
    if (revoked || offline) return;
    const clientMsgId = generateClientMsgId();
    void dispatchMessageSend(
      `دعوت به بازی دونفره ${label} از طریق گفتگوی خصوصی`,
      clientMsgId,
      undefined,
      'game_invite',
      gameId
    );
  };

  const [showInviteTray, setShowInviteTray] = useState(false);

  return (
    <section
      className="fixed inset-0 z-50 flex flex-col bg-[var(--eyvan-bg)] text-[var(--eyvan-text)]"
      data-testid="private-chat-panel"
    >
      {/* Telegram-Style Sticky Top Header */}
      <header className="h-14 shrink-0 px-2.5 sm:px-4 border-b border-[var(--eyvan-line)] theme-drawer flex items-center justify-between gap-2 shadow-sm">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={onClose}
            data-testid="chat-close-btn"
            aria-label="بازگشت به لیست گفتگوها"
            className="w-9 h-9 rounded-full hover:bg-white/8 flex items-center justify-center theme-heading shrink-0 cursor-pointer transition-colors"
          >
            <ArrowLeft className="w-5 h-5 rotate-180" />
          </button>

          <button
            type="button"
            onClick={() => onInspectPlayer?.(conversation.partner.userId)}
            disabled={!onInspectPlayer}
            className={`flex items-center gap-2.5 min-w-0 flex-1 text-right py-1 ${
              onInspectPlayer ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''
            }`}
          >
            <div className="relative shrink-0">
              <ProfileAvatar
                avatarCode={toValidAvatarCode(conversation.partner.avatarCode)}
                username={conversation.partner.username}
                size="sm"
              />
              {conversation.partner.onlineStatus === 'online' && (
                <span
                  aria-label="آنلاین"
                  className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[var(--eyvan-bg)] bg-[#22C55E] shadow-[0_0_6px_rgba(34,197,94,0.8)]"
                />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div
                dir="ltr"
                className="text-sm font-black theme-heading truncate text-right leading-tight"
                data-testid="chat-partner-username"
              >
                {conversation.partner.username}
              </div>
              <div
                className={`text-[11px] font-bold leading-tight mt-0.5 ${
                  conversation.partner.onlineStatus === 'online'
                    ? 'text-[#22C55E]'
                    : 'theme-muted'
                }`}
              >
                {conversation.partner.onlineStatus === 'online'
                  ? 'آنلاین'
                  : 'آفلاین'}
              </div>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!revoked && (
            <button
              type="button"
              onClick={() => setShowInviteTray((prev) => !prev)}
              aria-label="دعوت به بازی"
              data-testid="chat-invite-toggle-btn"
              className={`h-9 px-2.5 rounded-full border text-[11px] font-extrabold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                showInviteTray
                  ? 'bg-[#0D8A8A]/20 border-[#2CC5BE]/60 text-[#2CC5BE]'
                  : 'theme-btn-secondary'
              }`}
            >
              <Gamepad2 className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">دعوت بازی</span>
            </button>
          )}
        </div>
      </header>

      {/* Collapsible 2-Player Invite Drawer */}
      {!revoked && showInviteTray && (
        <div className="shrink-0 px-3.5 py-2.5 border-b border-[var(--eyvan-line)] theme-subcard space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold theme-muted inline-flex items-center gap-1 ml-1">
              <Gamepad2 className="w-3.5 h-3.5 theme-accent-teal shrink-0" />
              <span>دعوت دونفره:</span>
            </span>
            {TWO_PLAYER_GAMES.map((g) => (
              <button
                key={g.id}
                type="button"
                disabled={offline}
                data-testid={`pv-invite-${g.id}`}
                onClick={() => {
                  handleSendTwoPlayerInvite(g.id, g.label);
                  setShowInviteTray(false);
                }}
                className="min-h-[30px] px-2.5 rounded-xl theme-btn-secondary border text-[11px] font-extrabold hover:border-[var(--eyvan-teal)] cursor-pointer disabled:opacity-50"
              >
                {g.label}
              </button>
            ))}
          </div>

          <div
            data-testid="pv-hokm-group-notice"
            className="flex flex-wrap items-center justify-between gap-2 text-[11px] theme-muted"
          >
            <span>حکم بازی ۴ نفره است — برای دعوت دوستان، گروه بسازید.</span>
            {onOpenFriendGroups && (
              <button
                type="button"
                data-testid="pv-go-to-groups-btn"
                onClick={() => {
                  setShowInviteTray(false);
                  onOpenFriendGroups();
                }}
                className="inline-flex items-center gap-1 font-extrabold theme-accent-gold hover:underline cursor-pointer shrink-0"
              >
                <Users className="w-3 h-3 shrink-0" />
                <span>گروه‌های دوستان</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Offline banner */}
      {offline && (
        <div className="shrink-0 px-4 py-2 bg-amber-500/15 border-b border-amber-500/30 text-xs font-bold text-amber-300 flex items-center gap-2">
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          <span>اتصال اینترنت قطع است. پیام‌ها پس از اتصال مجدد همگام‌سازی می‌شوند.</span>
        </div>
      )}

      {/* Error banner */}
      {errorMsg && (
        <div
          role="alert"
          data-testid="chat-error-banner"
          className="shrink-0 px-4 py-2 bg-red-500/12 border-b border-red-500/30 text-xs font-bold text-red-400 flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Full-Height Telegram Message Stream */}
      <div
        className="flex-1 overflow-y-auto px-3 sm:px-5 py-3 space-y-2 max-w-3xl w-full mx-auto"
        data-testid="chat-messages-list"
      >
        {hasMore && (
          <div className="text-center pb-1">
            <button
              type="button"
              disabled={loadingOlder}
              onClick={() => void handleLoadOlder()}
              data-testid="chat-load-older-btn"
              className="min-h-[32px] px-3.5 rounded-full theme-btn-secondary border text-xs font-bold cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {loadingOlder && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>پیام‌های قدیمی‌تر</span>
            </button>
          </div>
        )}

        {loading ? (
          <div className="py-16 flex items-center justify-center gap-2 theme-muted text-xs font-bold">
            <Loader2 className="w-4 h-4 animate-spin theme-accent-teal" />
            <span>در حال دریافت پیام‌ها...</span>
          </div>
        ) : messages.length === 0 ? (
          <div
            className="py-16 text-center space-y-1.5"
            data-testid="chat-empty-state"
          >
            <div className="w-12 h-12 mx-auto rounded-full theme-subcard border border-[var(--eyvan-line)] flex items-center justify-center mb-2">
              <MessageSquare className="w-5 h-5 theme-accent-teal" />
            </div>
            <p className="text-xs font-extrabold theme-heading">
              هنوز پیامی ارسال نشده است
            </p>
            <p className="text-[11px] theme-muted">
              اولین پیام را بنویسید تا گفتگو شروع شود.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMine = msg.senderId === currentUserId;
            const isReadByPartner =
              isMine && isMessageReadByPartner(msg, partnerReadCursor);

            return (
              <div
                key={msg.clientMsgId && msg.localStatus !== 'sent' ? msg.clientMsgId : msg.messageId}
                data-testid={`chat-msg-${isMine ? 'mine' : 'theirs'}`}
                className={`flex ${isMine ? 'justify-start' : 'justify-end'}`}
              >
                <div
                  className={`max-w-[82%] sm:max-w-[72%] rounded-2xl px-3.5 py-2 text-[13px] sm:text-sm leading-relaxed break-words whitespace-pre-wrap border shadow-xs ${
                    isMine
                      ? msg.localStatus === 'failed'
                        ? 'bg-red-500/14 border-red-500/40 theme-heading rounded-tr-sm'
                        : msg.kind === 'game_invite'
                          ? 'bg-[#D4AE58]/18 border-[#D4AE58]/45 theme-heading rounded-tr-sm'
                          : 'bg-[#0D8A8A]/24 border-[#2CC5BE]/35 theme-heading rounded-tr-sm'
                      : msg.kind === 'game_invite'
                        ? 'bg-[#0D8A8A]/12 border-[#0D8A8A]/35 theme-heading rounded-tl-sm'
                        : 'theme-subcard border-[var(--eyvan-line)] theme-heading rounded-tl-sm'
                  }`}
                >
                  {msg.kind === 'game_invite' && (
                    <div className="mb-1 inline-flex items-center gap-1 text-[10px] font-black theme-accent-gold">
                      <Gamepad2 className="w-3 h-3 shrink-0" />
                      <span>دعوت به بازی دونفره</span>
                    </div>
                  )}
                  <div>{msg.body}</div>

                  {msg.localStatus === 'failed' && (
                    <div className="mt-1.5 pt-1.5 border-t border-red-500/25 flex items-center justify-between gap-2 text-[11px] text-red-400">
                      <span>{msg.errorText ?? 'ارسال نشد'}</span>
                      <button
                        type="button"
                        onClick={() => handleRetryFailed(msg)}
                        data-testid="chat-retry-btn"
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-300 font-bold cursor-pointer shrink-0"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>تلاش مجدد</span>
                      </button>
                    </div>
                  )}

                  <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] theme-muted">
                    <span className="tabular-nums">{formatMessageTime(msg.createdAt)}</span>
                    {isMine && msg.localStatus === 'sending' && (
                      <Clock
                        className="w-3 h-3 opacity-70"
                        data-testid="chat-tick-sending"
                        aria-label="در حال ارسال"
                      />
                    )}
                    {isMine && msg.localStatus === 'sent' && !isReadByPartner && (
                      <Check
                        className="w-3.5 h-3.5 opacity-80"
                        data-testid="chat-tick-sent"
                        aria-label="ارسال‌شده"
                      />
                    )}
                    {isMine && msg.localStatus === 'sent' && isReadByPartner && (
                      <CheckCheck
                        className="w-3.5 h-3.5 text-[#34D399]"
                        data-testid="chat-tick-read"
                        aria-label="خوانده‌شده"
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

      {/* Pinned Telegram Bottom Composer */}
      <form
        onSubmit={handleSend}
        className="shrink-0 px-3 py-2.5 border-t border-[var(--eyvan-line)] theme-drawer"
        style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}
      >
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          <div className="flex-1 min-w-0">
            <textarea
              value={draft}
              disabled={revoked}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend(e);
                }
              }}
              rows={1}
              maxLength={MAX_CHAT_CHARS}
              placeholder={
                revoked
                  ? 'امکان ارسال پیام در این گفتگو فعال نیست.'
                  : 'پیام...'
              }
              data-testid="chat-message-input"
              className="w-full min-h-[42px] max-h-[112px] px-4 py-2.5 rounded-3xl theme-input border text-sm focus:outline-none focus:border-[#0D8A8A] resize-none disabled:opacity-50"
            />
            {draft.length > 1600 && (
              <div className="text-[10px] theme-muted text-left mt-0.5 px-2">
                {toPersianDigits(draft.length)} / {toPersianDigits(MAX_CHAT_CHARS)}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={draft.trim().length === 0 || offline || revoked}
            data-testid="chat-send-btn"
            aria-label="ارسال پیام"
            className="w-[42px] h-[42px] rounded-full bg-gradient-to-b from-[#F3D179] to-[#C89B3C] hover:from-[#F8DD94] hover:to-[#D4AE58] disabled:opacity-40 text-[#0B1628] flex items-center justify-center shrink-0 cursor-pointer shadow-sm transition-opacity"
          >
            <Send className="w-4 h-4 -translate-x-[1px]" />
          </button>
        </div>
      </form>
    </section>
  );
};
