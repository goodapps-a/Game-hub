import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Ban,
  Check,
  Clock,
  Eye,
  EyeOff,
  Gamepad2,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Shield,
  ShieldOff,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  UserX,
  X,
} from 'lucide-react';
import { AuthUserSummary } from '../auth/authClient';
import { PrivateChatPanel } from '../components/PrivateChatPanel';
import { ProfileAvatar } from '../components/TopBar';
import { toPersianDigits } from '../theme/tokens';
import { UserProfile } from '../types/platform';
import {
  BlockedUserItem,
  ChatConversationItem,
  FriendListItem,
  FriendRequestItem,
  GameInviteItem,
  SocialPrivacySettings,
  SocialUserSummary,
  acceptFriendRequestApi,
  acceptGameInviteApi,
  blockUserApi,
  cancelFriendRequestApi,
  declineGameInviteApi,
  fetchBlockedUsersRequest,
  fetchChatConversationsRequest,
  fetchFriendRequestsRequest,
  fetchFriendsPresenceRequest,
  fetchFriendsRequest,
  fetchGameInvitesRequest,
  fetchSocialPrivacyRequest,
  openDirectConversationApi,
  rejectFriendRequestApi,
  removeFriendApi,
  searchSocialUsersRequest,
  sendFriendRequestApi,
  unblockUserApi,
  updateSocialPrivacyRequest,
} from '../social/socialClient';

interface FriendsPageProps {
  authUser: AuthUserSummary | null;
  authLoading: boolean;
  onOpenAccount: () => void;
  onJoinInvitedRoom?: (roomCode: string) => void;
}

type SocialSubTab = 'friends' | 'incoming' | 'outgoing' | 'blocked';

const PRESENCE_POLL_INTERVAL_MS = 20_000;
const SEARCH_PAGE_SIZE = 15;

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

export const FriendsPage: React.FC<FriendsPageProps> = ({
  authUser,
  authLoading,
  onOpenAccount,
  onJoinInvitedRoom,
}) => {
  const [activeTab, setActiveTab] = useState<SocialSubTab>('friends');

  // Server-backed social data
  const [friends, setFriends] = useState<FriendListItem[]>([]);
  const [incoming, setIncoming] = useState<FriendRequestItem[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestItem[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUserItem[]>([]);
  const [conversations, setConversations] = useState<ChatConversationItem[]>([]);
  const [activeConversation, setActiveConversation] =
    useState<ChatConversationItem | null>(null);
  const [incomingInvites, setIncomingInvites] = useState<GameInviteItem[]>([]);
  const [privacy, setPrivacy] = useState<SocialPrivacySettings | null>(null);
  const [initialLoading, setInitialLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Privacy panel toggle
  const [showPrivacyPanel, setShowPrivacyPanel] = useState(false);
  const [privacySaving, setPrivacySaving] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SocialUserSummary[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchOffset, setSearchOffset] = useState(0);
  const [searchExecutedQuery, setSearchExecutedQuery] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);

  // Action feedback & pending states
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmRemoveUserId, setConfirmRemoveUserId] = useState<string | null>(
    null
  );
  const [confirmBlockUserId, setConfirmBlockUserId] = useState<string | null>(
    null
  );
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const feedbackTimerRef = useRef<number | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  const showToast = useCallback((type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = window.setTimeout(() => {
      setFeedback(null);
    }, 3600);
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        window.clearTimeout(feedbackTimerRef.current);
      }
      searchAbortRef.current?.abort();
    };
  }, []);

  const loadSocialSnapshot = useCallback(async (silent = false) => {
    if (!silent) setInitialLoading(true);
    else setRefreshing(true);

    try {
      const [
        friendsRes,
        requestsRes,
        privacyRes,
        blocksRes,
        convsRes,
        invitesRes,
      ] = await Promise.all([
        fetchFriendsRequest(),
        fetchFriendRequestsRequest(),
        fetchSocialPrivacyRequest(),
        fetchBlockedUsersRequest(),
        fetchChatConversationsRequest(),
        fetchGameInvitesRequest(),
      ]);

      if (friendsRes.ok && Array.isArray(friendsRes.friends)) {
        setFriends(friendsRes.friends);
      }
      if (requestsRes.ok) {
        setIncoming(Array.isArray(requestsRes.incoming) ? requestsRes.incoming : []);
        setOutgoing(Array.isArray(requestsRes.outgoing) ? requestsRes.outgoing : []);
      }
      if (privacyRes.ok && privacyRes.privacy) {
        setPrivacy(privacyRes.privacy);
      }
      if (blocksRes.ok && Array.isArray(blocksRes.blocked)) {
        setBlockedUsers(blocksRes.blocked);
      }
      if (convsRes.ok && Array.isArray(convsRes.conversations)) {
        setConversations(convsRes.conversations);
      }
      if (invitesRes.ok && Array.isArray(invitesRes.incoming)) {
        setIncomingInvites(invitesRes.incoming);
      }
    } catch {
      if (!silent) {
        showToast('error', 'خطا در دریافت اطلاعات بخش دوستان از سرور.');
      }
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, [showToast]);

  // Reset and load whenever authenticated user changes
  useEffect(() => {
    if (!authUser) {
      setFriends([]);
      setIncoming([]);
      setOutgoing([]);
      setBlockedUsers([]);
      setConversations([]);
      setActiveConversation(null);
      setIncomingInvites([]);
      setPrivacy(null);
      setSearchQuery('');
      setSearchResults([]);
      setSearchExecutedQuery('');
      setSearchError(null);
      setConfirmRemoveUserId(null);
      setConfirmBlockUserId(null);
      return;
    }
    void loadSocialSnapshot(false);
  }, [authUser, loadSocialSnapshot]);

  // Lightweight live presence, invites & chat unread polling while viewing Friends tab
  useEffect(() => {
    if (!authUser) return;

    const pollLiveSocial = async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      try {
        const [presenceRes, invitesRes, convsRes] = await Promise.all([
          fetchFriendsPresenceRequest(),
          fetchGameInvitesRequest(),
          fetchChatConversationsRequest(),
        ]);

        if (presenceRes.ok && Array.isArray(presenceRes.presence)) {
          const map = new Map(
            presenceRes.presence.map((p) => [p.userId, p.onlineStatus])
          );
          setFriends((prev) =>
            prev.map((friend) => {
              const nextStatus = map.get(friend.userId);
              return nextStatus && nextStatus !== friend.onlineStatus
                ? { ...friend, onlineStatus: nextStatus }
                : friend;
            })
          );
        }
        if (invitesRes.ok && Array.isArray(invitesRes.incoming)) {
          setIncomingInvites(invitesRes.incoming);
        }
        if (convsRes.ok && Array.isArray(convsRes.conversations)) {
          setConversations(convsRes.conversations);
        }
      } catch {
        // Ignore transient polling hiccups
      }
    };

    const timer = window.setInterval(pollLiveSocial, PRESENCE_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [authUser]);

  const executeSearch = useCallback(
    async (rawQuery: string, offset = 0, append = false) => {
      const trimmed = rawQuery.trim();
      searchAbortRef.current?.abort();

      if (trimmed.length === 0) {
        setSearchResults([]);
        setSearchExecutedQuery('');
        setSearchHasMore(false);
        setSearchOffset(0);
        setSearchError(null);
        setSearchLoading(false);
        return;
      }

      if (trimmed.length < 2) {
        setSearchResults([]);
        setSearchExecutedQuery('');
        setSearchHasMore(false);
        setSearchError('برای جستجو حداقل ۲ کاراکتر از نام کاربری را وارد کنید.');
        setSearchLoading(false);
        return;
      }

      const controller = new AbortController();
      searchAbortRef.current = controller;
      setSearchLoading(true);
      setSearchError(null);

      try {
        const res = await searchSocialUsersRequest(
          trimmed,
          SEARCH_PAGE_SIZE,
          offset,
          controller.signal
        );
        if (controller.signal.aborted) return;

        if (!res.ok) {
          setSearchError(res.message ?? 'جستجو با خطا مواجه شد.');
          if (!append) setSearchResults([]);
          setSearchHasMore(false);
          return;
        }

        const list = Array.isArray(res.users) ? res.users : [];
        setSearchResults((prev) => (append ? [...prev, ...list] : list));
        setSearchHasMore(Boolean(res.hasMore));
        setSearchOffset(offset + list.length);
        setSearchExecutedQuery(trimmed);
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setSearchError('خطا در ارتباط با سرور هنگام جستجو.');
      } finally {
        if (!controller.signal.aborted) {
          setSearchLoading(false);
        }
      }
    },
    []
  );

  // Debounced search as user types
  useEffect(() => {
    if (!authUser) return;
    const trimmed = searchQuery.trim();
    if (trimmed.length === 0) {
      setSearchResults([]);
      setSearchExecutedQuery('');
      setSearchHasMore(false);
      setSearchError(null);
      return;
    }
    if (trimmed.length < 2) {
      setSearchError(null);
      return;
    }
    const tid = window.setTimeout(() => {
      void executeSearch(trimmed, 0, false);
    }, 350);
    return () => window.clearTimeout(tid);
  }, [searchQuery, authUser, executeSearch]);

  const refreshAfterMutation = useCallback(async () => {
    await loadSocialSnapshot(true);
    if (searchExecutedQuery.length >= 2) {
      await executeSearch(searchExecutedQuery, 0, false);
    }
  }, [loadSocialSnapshot, executeSearch, searchExecutedQuery]);

  const handleSendRequest = async (targetUserId: string) => {
    setBusyKey(`req:${targetUserId}`);
    try {
      const res = await sendFriendRequestApi(targetUserId);
      if (!res.ok) {
        showToast('error', res.message ?? 'ارسال درخواست دوستی انجام نشد.');
        return;
      }
      showToast(
        'success',
        res.message ??
          (res.outcome === 'auto_accepted'
            ? 'دوستی شما برقرار شد.'
            : 'درخواست دوستی ارسال شد.')
      );
      await refreshAfterMutation();
    } catch {
      showToast('error', 'خطا در ارتباط با سرور هنگام ارسال درخواست.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleAcceptRequest = async (friendshipId: string) => {
    setBusyKey(`acc:${friendshipId}`);
    try {
      const res = await acceptFriendRequestApi(friendshipId);
      if (!res.ok) {
        showToast('error', res.message ?? 'پذیرش درخواست انجام نشد.');
        return;
      }
      showToast('success', res.message ?? 'درخواست دوستی پذیرفته شد.');
      await refreshAfterMutation();
    } catch {
      showToast('error', 'خطا در ارتباط با سرور هنگام پذیرش درخواست.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleRejectRequest = async (friendshipId: string) => {
    setBusyKey(`rej:${friendshipId}`);
    try {
      const res = await rejectFriendRequestApi(friendshipId);
      if (!res.ok) {
        showToast('error', res.message ?? 'رد کردن درخواست انجام نشد.');
        return;
      }
      showToast('success', res.message ?? 'درخواست دوستی رد شد.');
      await refreshAfterMutation();
    } catch {
      showToast('error', 'خطا در ارتباط با سرور هنگام رد درخواست.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleCancelRequest = async (friendshipId: string) => {
    setBusyKey(`can:${friendshipId}`);
    try {
      const res = await cancelFriendRequestApi(friendshipId);
      if (!res.ok) {
        showToast('error', res.message ?? 'لغو درخواست انجام نشد.');
        return;
      }
      showToast('success', res.message ?? 'درخواست دوستی لغو شد.');
      await refreshAfterMutation();
    } catch {
      showToast('error', 'خطا در ارتباط با سرور هنگام لغو درخواست.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleRemoveFriend = async (targetUserId: string) => {
    setBusyKey(`rem:${targetUserId}`);
    try {
      const res = await removeFriendApi(targetUserId);
      if (!res.ok) {
        showToast('error', res.message ?? 'حذف دوستی انجام نشد.');
        return;
      }
      setConfirmRemoveUserId(null);
      if (activeConversation?.partner.userId === targetUserId) {
        setActiveConversation(null);
      }
      showToast('success', res.message ?? 'این کاربر از لیست دوستان شما حذف شد.');
      await refreshAfterMutation();
    } catch {
      showToast('error', 'خطا در ارتباط با سرور هنگام حذف دوستی.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleBlockUser = async (targetUserId: string) => {
    setBusyKey(`blk:${targetUserId}`);
    try {
      const res = await blockUserApi(targetUserId);
      if (!res.ok) {
        showToast('error', res.message ?? 'مسدود کردن کاربر انجام نشد.');
        return;
      }
      setConfirmBlockUserId(null);
      setConfirmRemoveUserId(null);
      if (activeConversation?.partner.userId === targetUserId) {
        setActiveConversation(null);
      }
      showToast('success', res.message ?? 'کاربر مسدود شد.');
      await refreshAfterMutation();
    } catch {
      showToast('error', 'خطا در ارتباط با سرور هنگام مسدود کردن کاربر.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleUnblockUser = async (targetUserId: string) => {
    setBusyKey(`ublk:${targetUserId}`);
    try {
      const res = await unblockUserApi(targetUserId);
      if (!res.ok) {
        showToast('error', res.message ?? 'رفع مسدودیت انجام نشد.');
        return;
      }
      showToast('success', res.message ?? 'مسدودیت کاربر برداشته شد.');
      await refreshAfterMutation();
    } catch {
      showToast('error', 'خطا در ارتباط با سرور هنگام رفع مسدودیت.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleOpenChat = async (friendUserId: string) => {
    setBusyKey(`chat:${friendUserId}`);
    try {
      const res = await openDirectConversationApi(friendUserId);
      if (!res.ok || !res.conversation) {
        showToast('error', res.message ?? 'باز کردن گفتگوی خصوصی انجام نشد.');
        return;
      }
      setActiveConversation(res.conversation);
    } catch {
      showToast('error', 'خطا در برقراری ارتباط برای شروع گفتگو.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleAcceptGameInvite = async (invite: GameInviteItem) => {
    setBusyKey(`invacc:${invite.inviteId}`);
    try {
      const res = await acceptGameInviteApi(invite.inviteId);
      if (!res.ok || !res.roomCode) {
        showToast('error', res.message ?? 'ورود به اتاق دعوت‌شده انجام نشد.');
        await loadSocialSnapshot(true);
        return;
      }
      setIncomingInvites((prev) =>
        prev.filter((i) => i.inviteId !== invite.inviteId)
      );
      if (onJoinInvitedRoom) {
        onJoinInvitedRoom(res.roomCode);
      } else {
        showToast('success', `دعوت پذیرفته شد. کد اتاق: ${res.roomCode}`);
      }
    } catch {
      showToast('error', 'خطا در ارتباط با سرور هنگام پذیرش دعوت‌نامه.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeclineGameInvite = async (inviteId: string) => {
    setBusyKey(`invdec:${inviteId}`);
    try {
      const res = await declineGameInviteApi(inviteId);
      if (!res.ok) {
        showToast('error', res.message ?? 'رد کردن دعوت‌نامه انجام نشد.');
        return;
      }
      setIncomingInvites((prev) => prev.filter((i) => i.inviteId !== inviteId));
      showToast('success', res.message ?? 'دعوت‌نامه بازی رد شد.');
    } catch {
      showToast('error', 'خطا در ارتباط با سرور هنگام رد دعوت‌نامه.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleTogglePrivacyField = async (
    field: 'showOnlineStatus' | 'allowFriendRequests'
  ) => {
    if (!privacy || privacySaving) return;
    setPrivacySaving(true);
    const nextValue = !privacy[field];
    const payload =
      field === 'showOnlineStatus'
        ? {
            showOnlineStatus: nextValue,
            presencePreference: nextValue ? ('online' as const) : ('invisible' as const),
          }
        : { allowFriendRequests: nextValue };

    try {
      const res = await updateSocialPrivacyRequest(payload);
      if (!res.ok || !res.privacy) {
        showToast('error', res.message ?? 'ذخیره تنظیمات حریم خصوصی انجام نشد.');
        return;
      }
      setPrivacy(res.privacy);
      showToast('success', res.message ?? 'تنظیمات حریم خصوصی ذخیره شد.');
    } catch {
      showToast('error', 'خطا در ارتباط با سرور هنگام ذخیره حریم خصوصی.');
    } finally {
      setPrivacySaving(false);
    }
  };

  const sortedFriends = useMemo(() => {
    return [...friends].sort((a, b) => {
      if (a.onlineStatus !== b.onlineStatus) {
        return a.onlineStatus === 'online' ? -1 : 1;
      }
      return a.username.localeCompare(b.username, 'en', { sensitivity: 'base' });
    });
  }, [friends]);

  const onlineFriendsCount = useMemo(
    () => friends.filter((f) => f.onlineStatus === 'online').length,
    [friends]
  );

  const unreadByPartnerId = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of conversations) {
      map.set(c.partner.userId, c.unreadCount);
    }
    return map;
  }, [conversations]);

  // =========================================================================
  // LOADING SESSION STATE
  // =========================================================================
  if (authLoading) {
    return (
      <div
        className="max-w-3xl mx-auto py-12 flex flex-col items-center justify-center gap-3 theme-muted"
        data-testid="friends-loading-auth"
      >
        <Loader2 className="w-7 h-7 animate-spin theme-accent-teal" />
        <p className="text-sm font-bold">در حال بررسی وضعیت حساب کاربری...</p>
      </div>
    );
  }

  // =========================================================================
  // LOGGED-OUT GATE (Central Account Required — Zero Fake/Demo Data)
  // =========================================================================
  if (!authUser) {
    return (
      <div
        className="max-w-xl mx-auto pt-4 sm:pt-8"
        data-testid="friends-auth-required"
      >
        <section className="eyvan-card rounded-2xl p-6 sm:p-8 text-center space-y-5">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[#0D8A8A]/16 border border-[#0D8A8A]/40 flex items-center justify-center">
            <Users className="w-8 h-8 theme-accent-teal" />
          </div>

          <div className="space-y-2">
            <h1 className="text-lg sm:text-xl font-black theme-heading">
              بخش دوستان و حضور آنلاین
            </h1>
            <p className="text-xs sm:text-sm theme-muted leading-relaxed max-w-md mx-auto">
              برای جستجوی بازیکنان، ارسال و مدیریت درخواست‌های دوستی و مشاهده وضعیت واقعی آنلاین دوستان، ابتدا وارد حساب کاربری مرکزی ایوان شوید.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-right pt-1">
            <div className="theme-subcard border rounded-xl p-3 space-y-1">
              <div className="text-xs font-extrabold theme-heading flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 theme-accent-teal shrink-0" />
                <span>جستجوی واقعی</span>
              </div>
              <p className="text-[11px] theme-muted leading-relaxed">
                یافتن بازیکنان با نام کاربری بدون افشای اطلاعات خصوصی
              </p>
            </div>
            <div className="theme-subcard border rounded-xl p-3 space-y-1">
              <div className="text-xs font-extrabold theme-heading flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 theme-accent-teal shrink-0" />
                <span>مدیریت دوستی</span>
              </div>
              <p className="text-[11px] theme-muted leading-relaxed">
                ارسال، پذیرش، رد یا لغو درخواست‌ها با تأیید سرور
              </p>
            </div>
            <div className="theme-subcard border rounded-xl p-3 space-y-1">
              <div className="text-xs font-extrabold theme-heading flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 theme-accent-gold shrink-0" />
                <span>حریم خصوصی</span>
              </div>
              <p className="text-[11px] theme-muted leading-relaxed">
                کنترل کامل نمایش وضعیت آنلاین و پذیرش درخواست‌ها
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenAccount}
            data-testid="friends-open-account-btn"
            className="w-full sm:w-auto min-h-[46px] px-7 rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] hover:from-[#F8DD94] hover:to-[#D4AE58] text-[#0B1628] text-sm font-black inline-flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>ورود یا ساخت حساب کاربری</span>
          </button>
        </section>
      </div>
    );
  }

  // =========================================================================
  // AUTHENTICATED STAGE D1 FRIENDS & ONLINE PRESENCE VIEW
  // =========================================================================
  return (
    <div className="space-y-3.5 max-w-3xl mx-auto" data-testid="friends-page">
      {/* Header Summary + Controls */}
      <section className="eyvan-card rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-[#0D8A8A]/18 border border-[#0D8A8A]/40 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5 theme-accent-teal" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-black theme-heading truncate">
                دوستان
              </h1>
              <div
                className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs theme-muted mt-0.5"
                data-testid="friends-summary-counts"
              >
                <span>{toPersianDigits(friends.length)} دوست</span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1.5 font-bold text-[#22C55E]">
                  <span className="w-2 h-2 rounded-full bg-[#22C55E]" />
                  <span>{toPersianDigits(onlineFriendsCount)} آنلاین</span>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowPrivacyPanel((prev) => !prev)}
              data-testid="social-privacy-toggle-btn"
              aria-expanded={showPrivacyPanel}
              className={`min-h-[40px] px-3 rounded-xl border text-xs font-extrabold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                showPrivacyPanel
                  ? 'bg-[#0D8A8A]/18 border-[#0D8A8A]/50 theme-accent-teal'
                  : 'theme-btn-secondary'
              }`}
            >
              <Shield className="w-4 h-4" />
              <span>حریم خصوصی</span>
            </button>

            <button
              type="button"
              onClick={() => void refreshAfterMutation()}
              disabled={refreshing}
              data-testid="social-refresh-btn"
              aria-label="به‌روزرسانی لیست دوستان"
              className="w-10 h-10 rounded-xl theme-btn-secondary border flex items-center justify-center cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
              />
            </button>
          </div>
        </div>

        {/* Collapsible Privacy Controls Panel */}
        {showPrivacyPanel && privacy && (
          <div
            className="pt-3 border-t border-[var(--eyvan-line)] grid grid-cols-1 sm:grid-cols-2 gap-2.5"
            data-testid="social-privacy-panel"
          >
            <button
              type="button"
              disabled={privacySaving}
              onClick={() => void handleTogglePrivacyField('showOnlineStatus')}
              data-testid="privacy-show-online-toggle"
              className="theme-subcard border rounded-xl p-3 flex items-center justify-between gap-3 text-right hover:border-[#0D8A8A]/50 transition-colors cursor-pointer disabled:opacity-60"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="text-xs font-extrabold theme-heading flex items-center gap-1.5">
                  {privacy.showOnlineStatus ? (
                    <Eye className="w-3.5 h-3.5 text-[#22C55E] shrink-0" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5 theme-muted shrink-0" />
                  )}
                  <span>نمایش وضعیت آنلاین به دوستان</span>
                </div>
                <p className="text-[11px] theme-muted">
                  {privacy.showOnlineStatus
                    ? 'دوستان تأییدشده وضعیت آنلاین شما را می‌بینند'
                    : 'وضعیت شما برای همه آفلاین نمایش داده می‌شود'}
                </p>
              </div>
              <span
                className={`px-2.5 py-1 rounded-lg text-[11px] font-black shrink-0 ${
                  privacy.showOnlineStatus
                    ? 'bg-[#22C55E]/15 text-[#22C55E]'
                    : 'bg-slate-500/15 theme-muted'
                }`}
              >
                {privacy.showOnlineStatus ? 'فعال' : 'مخفی'}
              </span>
            </button>

            <button
              type="button"
              disabled={privacySaving}
              onClick={() => void handleTogglePrivacyField('allowFriendRequests')}
              data-testid="privacy-allow-requests-toggle"
              className="theme-subcard border rounded-xl p-3 flex items-center justify-between gap-3 text-right hover:border-[#0D8A8A]/50 transition-colors cursor-pointer disabled:opacity-60"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="text-xs font-extrabold theme-heading flex items-center gap-1.5">
                  <UserPlus className="w-3.5 h-3.5 theme-accent-teal shrink-0" />
                  <span>پذیرش درخواست‌های دوستی جدید</span>
                </div>
                <p className="text-[11px] theme-muted">
                  {privacy.allowFriendRequests
                    ? 'کاربران دیگر می‌توانند به شما درخواست دوستی بفرستند'
                    : 'درخواست دوستی جدیدی برای شما ثبت نمی‌شود'}
                </p>
              </div>
              <span
                className={`px-2.5 py-1 rounded-lg text-[11px] font-black shrink-0 ${
                  privacy.allowFriendRequests
                    ? 'bg-[#0D8A8A]/18 theme-accent-teal'
                    : 'bg-slate-500/15 theme-muted'
                }`}
              >
                {privacy.allowFriendRequests ? 'باز' : 'بسته'}
              </span>
            </button>
          </div>
        )}
      </section>

      {/* Incoming Real-Room Game Invites Banner (Stage D3) */}
      {incomingInvites.length > 0 && (
        <section
          data-testid="incoming-game-invites-banner"
          className="eyvan-card rounded-2xl p-4 border border-[#D4AE58]/60 space-y-2.5"
        >
          <div className="flex items-center gap-2 text-xs sm:text-sm font-black theme-accent-gold">
            <Gamepad2 className="w-4 h-4 shrink-0" />
            <span>دعوت به بازی آنلاین حکم ({toPersianDigits(incomingInvites.length)})</span>
          </div>
          <div className="space-y-2">
            {incomingInvites.map((inv) => {
              const accepting = busyKey === `invacc:${inv.inviteId}`;
              const declining = busyKey === `invdec:${inv.inviteId}`;
              return (
                <div
                  key={inv.inviteId}
                  data-testid={`incoming-invite-${inv.inviteId}`}
                  className="theme-subcard border rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ProfileAvatar
                      avatarCode={toValidAvatarCode(inv.otherUser.avatarCode)}
                      username={inv.otherUser.username}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <div className="text-xs sm:text-sm font-extrabold theme-heading truncate">
                        <span dir="ltr">{inv.otherUser.username}</span> شما را به اتاق{' '}
                        <span dir="ltr" className="font-mono theme-accent-gold">
                          {inv.roomCode}
                        </span>{' '}
                        دعوت کرده است
                      </div>
                      <div className="text-[11px] theme-muted">
                        حکم آنلاین · اتصال مستقیم به اتاق واقعی
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={accepting || declining}
                      onClick={() => void handleAcceptGameInvite(inv)}
                      data-testid={`accept-invite-btn-${inv.roomCode}`}
                      className="min-h-[36px] px-3.5 rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] hover:from-[#F8DD94] hover:to-[#D4AE58] text-[#0B1628] text-xs font-black inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {accepting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Gamepad2 className="w-3.5 h-3.5" />
                      )}
                      <span>ورود به اتاق</span>
                    </button>
                    <button
                      type="button"
                      disabled={accepting || declining}
                      onClick={() => void handleDeclineGameInvite(inv.inviteId)}
                      data-testid={`decline-invite-btn-${inv.roomCode}`}
                      className="min-h-[36px] px-3 rounded-xl theme-btn-secondary border hover:border-red-500/45 hover:text-red-400 text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      رد
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Active Private 1-on-1 Direct Chat Panel (Stage D2) */}
      {activeConversation && (
        <PrivateChatPanel
          currentUserId={authUser.userId}
          conversation={activeConversation}
          onClose={() => {
            setActiveConversation(null);
            void loadSocialSnapshot(true);
          }}
          onConversationActivity={() => void loadSocialSnapshot(true)}
        />
      )}

      {/* Inline Feedback Toast */}
      {feedback && (
        <div
          role="status"
          data-testid="social-feedback-banner"
          className={`rounded-xl px-4 py-2.5 text-xs sm:text-sm font-bold flex items-center justify-between gap-2 border ${
            feedback.type === 'success'
              ? 'bg-[#107C41]/15 border-[#107C41]/40 text-[#22C55E]'
              : 'bg-red-500/12 border-red-500/35 text-red-400'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {feedback.type === 'success' ? (
              <Check className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span className="truncate">{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="بستن پیام"
            className="p-1 opacity-75 hover:opacity-100 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Search Users Card */}
      <section
        className="eyvan-card rounded-2xl p-4 space-y-3"
        data-testid="social-search-section"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void executeSearch(searchQuery, 0, false);
          }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 theme-muted absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              dir="ltr"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="جستجو با نام کاربری..."
              maxLength={20}
              data-testid="social-search-input"
              aria-label="جستجوی کاربر با نام کاربری"
              className="w-full min-h-[44px] pr-10 pl-9 rounded-xl theme-input border text-sm text-right placeholder:text-right focus:outline-none focus:border-[#0D8A8A]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                  setSearchExecutedQuery('');
                  setSearchError(null);
                }}
                aria-label="پاک کردن جستجو"
                className="w-7 h-7 rounded-lg flex items-center justify-center theme-muted hover:theme-heading absolute left-1.5 top-1/2 -translate-y-1/2 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={searchLoading}
            data-testid="social-search-btn"
            className="min-h-[44px] px-4 sm:px-5 rounded-xl bg-[#0D8A8A] hover:bg-[#11A3A3] disabled:opacity-50 text-white text-xs sm:text-sm font-extrabold inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer transition-colors"
          >
            {searchLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            <span>جستجو</span>
          </button>
        </form>

        {searchError && (
          <p
            className="text-xs font-bold text-amber-400 px-1"
            data-testid="social-search-error"
          >
            {searchError}
          </p>
        )}

        {/* Search Results List */}
        {searchExecutedQuery && !searchError && (
          <div
            className="pt-2 border-t border-[var(--eyvan-line)] space-y-2"
            data-testid="social-search-results"
          >
            <div className="flex items-center justify-between text-[11px] theme-muted px-1">
              <span>
                نتایج جستجو برای{' '}
                <strong dir="ltr" className="theme-heading font-mono">
                  {searchExecutedQuery}
                </strong>
              </span>
              <span>{toPersianDigits(searchResults.length)} نتیجه</span>
            </div>

            {searchResults.length === 0 && !searchLoading ? (
              <div
                className="py-5 text-center text-xs theme-muted theme-subcard border rounded-xl"
                data-testid="social-search-empty"
              >
                کاربری با این نام کاربری یافت نشد.
              </div>
            ) : (
              <div className="space-y-2">
                {searchResults.map((user) => {
                  const isBusy =
                    busyKey === `req:${user.userId}` ||
                    (user.friendshipId !== null &&
                      (busyKey === `can:${user.friendshipId}` ||
                        busyKey === `acc:${user.friendshipId}`));

                  return (
                    <div
                      key={user.userId}
                      data-testid={`search-result-${user.username}`}
                      className="theme-subcard border rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative shrink-0">
                          <ProfileAvatar
                            avatarCode={toValidAvatarCode(user.avatarCode)}
                            username={user.username}
                            size="sm"
                          />
                          {user.relationshipStatus === 'friend' && (
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[var(--eyvan-surface)] ${
                                user.onlineStatus === 'online'
                                  ? 'bg-[#22C55E]'
                                  : 'bg-[#64748B]'
                              }`}
                            />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div
                            dir="ltr"
                            className="text-sm font-extrabold theme-heading truncate text-right"
                          >
                            {user.username}
                          </div>
                          <div className="text-[11px] theme-muted mt-0.5">
                            {user.relationshipStatus === 'friend'
                              ? user.onlineStatus === 'online'
                                ? 'دوست شما · آنلاین'
                                : 'دوست شما · آفلاین'
                              : user.relationshipStatus === 'outgoing_pending'
                                ? 'درخواست دوستی ارسال شده'
                                : user.relationshipStatus === 'incoming_pending'
                                  ? 'برای شما درخواست فرستاده است'
                                  : 'کاربر ایوان'}
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0">
                        {user.relationshipStatus === 'none' && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleSendRequest(user.userId)}
                            data-testid={`send-request-btn-${user.username}`}
                            className="min-h-[38px] px-3.5 rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] hover:from-[#F8DD94] hover:to-[#D4AE58] disabled:opacity-50 text-[#0B1628] text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            {isBusy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <UserPlus className="w-3.5 h-3.5" />
                            )}
                            <span>ارسال درخواست</span>
                          </button>
                        )}

                        {user.relationshipStatus === 'outgoing_pending' &&
                          user.friendshipId && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleCancelRequest(user.friendshipId!)
                              }
                              data-testid={`cancel-request-btn-${user.username}`}
                              className="min-h-[38px] px-3 rounded-xl theme-btn-secondary border text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                              {isBusy ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <X className="w-3.5 h-3.5" />
                              )}
                              <span>لغو درخواست</span>
                            </button>
                          )}

                        {user.relationshipStatus === 'incoming_pending' &&
                          user.friendshipId && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleAcceptRequest(user.friendshipId!)
                              }
                              data-testid={`accept-request-btn-${user.username}`}
                              className="min-h-[38px] px-3.5 rounded-xl bg-[#0D8A8A] hover:bg-[#11A3A3] text-white text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                              {isBusy ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Check className="w-3.5 h-3.5" />
                              )}
                              <span>پذیرش درخواست</span>
                            </button>
                          )}

                        {user.relationshipStatus === 'friend' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#0D8A8A]/14 border border-[#0D8A8A]/35 text-xs font-bold theme-accent-teal">
                            <UserCheck className="w-3.5 h-3.5" />
                            <span>دوست شما</span>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {searchHasMore && (
                  <button
                    type="button"
                    disabled={searchLoading}
                    onClick={() =>
                      void executeSearch(searchExecutedQuery, searchOffset, true)
                    }
                    className="w-full min-h-[40px] rounded-xl theme-btn-secondary border text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    نمایش نتایج بیشتر
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 4-Tab Switcher: دوستان | دریافتی | ارسالی | مسدودشده‌ها */}
      <section className="eyvan-card rounded-xl p-1" data-testid="friends-tabs-card">
        <div
          role="tablist"
          aria-label="بخش‌های دوستان"
          className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-0.5 theme-tab-track rounded-lg border"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'friends'}
            data-testid="social-tab-friends"
            onClick={() => setActiveTab('friends')}
            className={`min-h-[40px] rounded-md text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'friends'
                ? 'bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] shadow-xs'
                : 'theme-muted'
            }`}
          >
            <Users className="w-3.5 h-3.5 shrink-0" />
            <span>دوستان</span>
            <span className="text-[11px] opacity-85 tabular-nums">
              ({toPersianDigits(friends.length)})
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'incoming'}
            data-testid="social-tab-incoming"
            onClick={() => setActiveTab('incoming')}
            className={`min-h-[40px] rounded-md text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'incoming'
                ? 'bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] shadow-xs'
                : 'theme-muted'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5 shrink-0" />
            <span>دریافتی</span>
            {incoming.length > 0 && (
              <span
                className={`min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-black inline-flex items-center justify-center tabular-nums ${
                  activeTab === 'incoming'
                    ? 'bg-[#0B1628]/20 text-[#0B1628]'
                    : 'bg-[#0D8A8A] text-white'
                }`}
              >
                {toPersianDigits(incoming.length)}
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'outgoing'}
            data-testid="social-tab-outgoing"
            onClick={() => setActiveTab('outgoing')}
            className={`min-h-[40px] rounded-md text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'outgoing'
                ? 'bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] shadow-xs'
                : 'theme-muted'
            }`}
          >
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span>ارسالی</span>
            {outgoing.length > 0 && (
              <span className="text-[11px] opacity-85 tabular-nums">
                ({toPersianDigits(outgoing.length)})
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'blocked'}
            data-testid="social-tab-blocked"
            onClick={() => setActiveTab('blocked')}
            className={`min-h-[40px] rounded-md text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'blocked'
                ? 'bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] shadow-xs'
                : 'theme-muted'
            }`}
          >
            <Ban className="w-3.5 h-3.5 shrink-0" />
            <span>مسدودشده‌ها</span>
            {blockedUsers.length > 0 && (
              <span className="text-[11px] opacity-85 tabular-nums">
                ({toPersianDigits(blockedUsers.length)})
              </span>
            )}
          </button>
        </div>
      </section>

      {/* Main List Body */}
      <section className="eyvan-card rounded-2xl overflow-hidden divide-y divide-[var(--eyvan-line)]">
        {initialLoading ? (
          <div className="px-4 py-10 flex items-center justify-center gap-2.5 theme-muted text-sm font-bold">
            <Loader2 className="w-5 h-5 animate-spin theme-accent-teal" />
            <span>در حال بارگذاری اطلاعات...</span>
          </div>
        ) : activeTab === 'friends' ? (
          sortedFriends.length === 0 ? (
            <div
              className="px-5 py-10 text-center space-y-2"
              data-testid="friends-empty-state"
            >
              <p className="text-sm font-bold theme-heading">
                هنوز دوستی در لیست شما ثبت نشده است.
              </p>
              <p className="text-xs theme-muted">
                نام کاربری دوستان خود را در کادر بالا جستجو کنید و درخواست دوستی بفرستید.
              </p>
            </div>
          ) : (
            sortedFriends.map((friend) => {
              const isConfirmingRemove = confirmRemoveUserId === friend.userId;
              const isConfirmingBlock = confirmBlockUserId === friend.userId;
              const isRemoving = busyKey === `rem:${friend.userId}`;
              const isBlocking = busyKey === `blk:${friend.userId}`;
              const isOpeningChat = busyKey === `chat:${friend.userId}`;
              const unreadCount = unreadByPartnerId.get(friend.userId) ?? 0;

              return (
                <div
                  key={friend.userId}
                  data-testid={`friend-row-${friend.username}`}
                  data-presence={friend.onlineStatus}
                  className="px-4 py-3.5 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative shrink-0">
                      <ProfileAvatar
                        avatarCode={toValidAvatarCode(friend.avatarCode)}
                        username={friend.username}
                        size="md"
                      />
                      <span
                        aria-label={
                          friend.onlineStatus === 'online' ? 'آنلاین' : 'آفلاین'
                        }
                        className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-[var(--eyvan-surface)] ${
                          friend.onlineStatus === 'online'
                            ? 'bg-[#22C55E]'
                            : 'bg-[#64748B]'
                        }`}
                      />
                    </div>

                    <div className="min-w-0">
                      <div
                        dir="ltr"
                        className="text-sm sm:text-[15px] font-extrabold theme-heading truncate text-right"
                      >
                        {friend.username}
                      </div>
                      <div
                        className={`text-xs font-bold mt-0.5 flex items-center gap-1.5 ${
                          friend.onlineStatus === 'online'
                            ? 'text-[#22C55E]'
                            : 'theme-muted'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            friend.onlineStatus === 'online'
                              ? 'bg-[#22C55E]'
                              : 'bg-[#64748B]'
                          }`}
                        />
                        <span>
                          {friend.onlineStatus === 'online' ? 'آنلاین' : 'آفلاین'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {isConfirmingRemove ? (
                      <>
                        <button
                          type="button"
                          disabled={isRemoving}
                          onClick={() => void handleRemoveFriend(friend.userId)}
                          data-testid={`confirm-remove-friend-${friend.username}`}
                          className="min-h-[36px] px-3 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          {isRemoving ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <UserMinus className="w-3.5 h-3.5" />
                          )}
                          <span>تأیید حذف</span>
                        </button>
                        <button
                          type="button"
                          disabled={isRemoving}
                          onClick={() => setConfirmRemoveUserId(null)}
                          className="min-h-[36px] px-2.5 rounded-xl theme-btn-secondary border text-xs font-bold cursor-pointer"
                        >
                          انصراف
                        </button>
                      </>
                    ) : isConfirmingBlock ? (
                      <>
                        <button
                          type="button"
                          disabled={isBlocking}
                          onClick={() => void handleBlockUser(friend.userId)}
                          data-testid={`confirm-block-friend-${friend.username}`}
                          className="min-h-[36px] px-3 rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-extrabold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          {isBlocking ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Ban className="w-3.5 h-3.5" />
                          )}
                          <span>تأیید مسدودسازی</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBlocking}
                          onClick={() => setConfirmBlockUserId(null)}
                          className="min-h-[36px] px-2.5 rounded-xl theme-btn-secondary border text-xs font-bold cursor-pointer"
                        >
                          انصراف
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={isOpeningChat}
                          onClick={() => void handleOpenChat(friend.userId)}
                          data-testid={`open-chat-btn-${friend.username}`}
                          className="min-h-[36px] px-3 rounded-xl bg-[#0D8A8A] hover:bg-[#11A3A3] text-white text-xs font-extrabold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {isOpeningChat ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <MessageSquare className="w-3.5 h-3.5" />
                          )}
                          <span>گفتگو</span>
                          {unreadCount > 0 && (
                            <span
                              data-testid={`chat-unread-${friend.username}`}
                              className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#F3D179] text-[#0B1628] text-[10px] font-black inline-flex items-center justify-center tabular-nums"
                            >
                              {toPersianDigits(unreadCount)}
                            </span>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setConfirmBlockUserId(null);
                            setConfirmRemoveUserId(friend.userId);
                          }}
                          data-testid={`remove-friend-btn-${friend.username}`}
                          className="min-h-[36px] px-2.5 rounded-xl theme-btn-secondary border hover:border-red-500/50 hover:text-red-400 text-xs font-bold inline-flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <UserMinus className="w-3.5 h-3.5" />
                          <span>حذف</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setConfirmRemoveUserId(null);
                            setConfirmBlockUserId(friend.userId);
                          }}
                          data-testid={`block-friend-btn-${friend.username}`}
                          aria-label={`مسدود کردن ${friend.username}`}
                          title="مسدود کردن کاربر"
                          className="min-h-[36px] px-2.5 rounded-xl theme-btn-secondary border hover:border-red-500/50 hover:text-red-400 text-xs font-bold inline-flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">مسدود</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )
        ) : activeTab === 'incoming' ? (
          incoming.length === 0 ? (
            <div
              className="px-5 py-10 text-center text-xs sm:text-sm theme-muted"
              data-testid="incoming-empty-state"
            >
              درخواست دوستی در انتظار پاسخی وجود ندارد.
            </div>
          ) : (
            incoming.map((req) => {
              const accepting = busyKey === `acc:${req.friendshipId}`;
              const rejecting = busyKey === `rej:${req.friendshipId}`;
              return (
                <div
                  key={req.friendshipId}
                  data-testid={`incoming-request-${req.user.username}`}
                  className="px-4 py-3.5 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <ProfileAvatar
                      avatarCode={toValidAvatarCode(req.user.avatarCode)}
                      username={req.user.username}
                      size="md"
                    />
                    <div className="min-w-0">
                      <div
                        dir="ltr"
                        className="text-sm font-extrabold theme-heading truncate text-right"
                      >
                        {req.user.username}
                      </div>
                      <div className="text-xs theme-muted mt-0.5">
                        درخواست دوستی برای شما ارسال کرده است
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={accepting || rejecting}
                      onClick={() => void handleAcceptRequest(req.friendshipId)}
                      data-testid={`incoming-accept-${req.user.username}`}
                      className="min-h-[38px] px-3.5 rounded-xl bg-[#0D8A8A] hover:bg-[#11A3A3] disabled:opacity-50 text-white text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      {accepting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      <span>پذیرش</span>
                    </button>

                    <button
                      type="button"
                      disabled={accepting || rejecting}
                      onClick={() => void handleRejectRequest(req.friendshipId)}
                      data-testid={`incoming-reject-${req.user.username}`}
                      className="min-h-[38px] px-3 rounded-xl theme-btn-secondary border hover:border-red-500/45 hover:text-red-400 disabled:opacity-50 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      {rejecting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <UserX className="w-3.5 h-3.5" />
                      )}
                      <span>رد کردن</span>
                    </button>
                  </div>
                </div>
              );
            })
          )
        ) : activeTab === 'outgoing' ? (
          outgoing.length === 0 ? (
            <div
              className="px-5 py-10 text-center text-xs sm:text-sm theme-muted"
              data-testid="outgoing-empty-state"
            >
              درخواست دوستی ارسال‌شده در انتظار تأییدی ندارید.
            </div>
          ) : (
            outgoing.map((req) => {
              const canceling = busyKey === `can:${req.friendshipId}`;
              return (
                <div
                  key={req.friendshipId}
                  data-testid={`outgoing-request-${req.user.username}`}
                  className="px-4 py-3.5 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <ProfileAvatar
                      avatarCode={toValidAvatarCode(req.user.avatarCode)}
                      username={req.user.username}
                      size="md"
                    />
                    <div className="min-w-0">
                      <div
                        dir="ltr"
                        className="text-sm font-extrabold theme-heading truncate text-right"
                      >
                        {req.user.username}
                      </div>
                      <div className="text-xs theme-muted mt-0.5">
                        در انتظار تأیید کاربر مقابل
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={canceling}
                    onClick={() => void handleCancelRequest(req.friendshipId)}
                    data-testid={`outgoing-cancel-${req.user.username}`}
                    className="min-h-[38px] px-3.5 rounded-xl theme-btn-secondary border hover:border-amber-500/45 text-xs font-bold inline-flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {canceling ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <X className="w-3.5 h-3.5" />
                    )}
                    <span>لغو درخواست</span>
                  </button>
                </div>
              );
            })
          )
        ) : blockedUsers.length === 0 ? (
          <div
            className="px-5 py-10 text-center text-xs sm:text-sm theme-muted"
            data-testid="blocked-empty-state"
          >
            هیچ کاربری را مسدود نکرده‌اید.
          </div>
        ) : (
          blockedUsers.map((blk) => {
            const unblocking = busyKey === `ublk:${blk.userId}`;
            return (
              <div
                key={blk.userId}
                data-testid={`blocked-user-${blk.username}`}
                className="px-4 py-3.5 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <ProfileAvatar
                    avatarCode={toValidAvatarCode(blk.avatarCode)}
                    username={blk.username}
                    size="md"
                  />
                  <div className="min-w-0">
                    <div
                      dir="ltr"
                      className="text-sm font-extrabold theme-heading truncate text-right"
                    >
                      {blk.username}
                    </div>
                    <div className="text-xs theme-muted mt-0.5">
                      کاربر مسدودشده
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={unblocking}
                  onClick={() => void handleUnblockUser(blk.userId)}
                  data-testid={`unblock-btn-${blk.username}`}
                  className="min-h-[38px] px-3.5 rounded-xl theme-btn-secondary border hover:border-[#0D8A8A]/50 text-xs font-bold inline-flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
                >
                  {unblocking ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ShieldOff className="w-3.5 h-3.5" />
                  )}
                  <span>رفع مسدودیت</span>
                </button>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
};
