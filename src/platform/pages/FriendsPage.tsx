import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  Check,
  Clock,
  Eye,
  EyeOff,
  Gamepad2,
  Link2,
  Loader2,
  MoreVertical,
  Plus,
  Search,
  Send,
  ShieldOff,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { AuthUserSummary } from '../auth/authClient';
import { createOnlineRoom } from '../../games/hokm/online/client';
import { PrivateChatPanel } from '../components/PrivateChatPanel';
import {
  EyvanBotAvatar,
  EyvanBotChatPanel,
} from '../components/EyvanBotChatPanel';
import {
  EYVAN_BOT_ANNOUNCEMENTS,
  EYVAN_OFFICIAL_BOT,
  getEyvanBotUnreadCount,
} from '../social/eyvanBot';
import { ProfileAvatar } from '../components/TopBar';
import {
  FramedPlayerAvatar,
  PlayerBadgeInline,
} from '../components/profile/PlayerAppearanceParts';
import { toPersianDigits } from '../theme/tokens';
import { UserProfile } from '../types/platform';
import {
  BlockedUserItem,
  ChatConversationItem,
  FriendGroupSummary,
  FriendListItem,
  FriendRequestItem,
  GameInviteItem,
  GroupMessageItem,
  SocialPrivacySettings,
  SocialUserSummary,
  acceptFriendRequestApi,
  acceptGameInviteApi,
  addFriendToGroupApi,
  blockUserApi,
  cancelFriendRequestApi,
  createFriendGroupApi,
  declineGameInviteApi,
  fetchBlockedUsersRequest,
  fetchChatConversationsRequest,
  fetchFriendGroupsRequest,
  fetchFriendRequestsRequest,
  fetchFriendsPresenceRequest,
  fetchFriendsRequest,
  fetchGameInvitesRequest,
  fetchGroupMessagesRequest,
  fetchSocialPrivacyRequest,
  openDirectConversationApi,
  rejectFriendRequestApi,
  removeFriendApi,
  searchSocialUsersRequest,
  sendFriendRequestApi,
  sendGroupMessageApi,
  unblockUserApi,
  updateSocialPrivacyRequest,
} from '../social/socialClient';

export type SocialSubTab = 'friends' | 'groups' | 'incoming' | 'outgoing' | 'blocked';

interface FriendsPageProps {
  authUser: AuthUserSummary | null;
  authLoading: boolean;
  initialTab?: SocialSubTab;
  initialChatTargetUserId?: string | null;
  onClearInitialChatTarget?: () => void;
  refreshSignal?: number;
  closeChatSignal?: number;
  onChatOpenChange?: (isOpen: boolean) => void;
  onOpenAccount: () => void;
  onJoinInvitedRoom?: (roomCode: string) => void;
  onInspectPlayer?: (userId: string) => void;
  onBack?: () => void;
}

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

function formatTelegramTime(ts: number | null | undefined): string {
  if (!ts || !Number.isFinite(ts) || ts <= 0) return '';
  try {
    const date = new Date(ts);
    const now = new Date();
    const isSameDay =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();

    if (isSameDay) {
      const hh = String(date.getHours()).padStart(2, '0');
      const mm = String(date.getMinutes()).padStart(2, '0');
      return toPersianDigits(`${hh}:${mm}`);
    }

    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 1) return 'دیروز';
    if (diffDays < 7) {
      return date.toLocaleDateString('fa-IR', { weekday: 'short' });
    }
    return date.toLocaleDateString('fa-IR', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

interface UnifiedPersonChatRow {
  readonly userId: string;
  readonly username: string;
  readonly accountCode?: string | null;
  readonly avatarCode: string;
  readonly avatarUrl: string | null;
  readonly onlineStatus: 'online' | 'offline';
  readonly appearance?: FriendListItem['appearance'];
  readonly lastMessagePreview: string | null;
  readonly lastMessageAt: number | null;
  readonly unreadCount: number;
  readonly isFriend: boolean;
  readonly conversation?: ChatConversationItem;
}

interface FriendsSnapshotCacheEntry {
  friends: FriendListItem[];
  groups: FriendGroupSummary[];
  incoming: FriendRequestItem[];
  outgoing: FriendRequestItem[];
  blockedUsers: BlockedUserItem[];
  conversations: ChatConversationItem[];
  incomingInvites: GameInviteItem[];
  privacy: SocialPrivacySettings | null;
}

const FRIENDS_SNAPSHOT_CACHE = new Map<string, FriendsSnapshotCacheEntry>();

export const FriendsPage: React.FC<FriendsPageProps> = ({
  authUser,
  authLoading,
  initialTab = 'friends',
  initialChatTargetUserId = null,
  onClearInitialChatTarget,
  refreshSignal = 0,
  closeChatSignal = 0,
  onChatOpenChange,
  onOpenAccount,
  onJoinInvitedRoom,
  onInspectPlayer,
}) => {
  const initialCached = authUser
    ? FRIENDS_SNAPSHOT_CACHE.get(authUser.userId)
    : undefined;

  const [segment, setSegment] = useState<'chats' | 'groups'>(
    initialTab === 'groups' ? 'groups' : 'chats'
  );
  const [activeSheet, setActiveSheet] = useState<'none' | 'requests' | 'privacy' | 'create_group'>(
    initialTab === 'incoming' || initialTab === 'outgoing'
      ? 'requests'
      : initialTab === 'blocked'
        ? 'privacy'
        : 'none'
  );

  useEffect(() => {
    if (initialTab === 'groups') {
      setSegment('groups');
      setActiveSheet('none');
    } else if (initialTab === 'incoming' || initialTab === 'outgoing') {
      setSegment('chats');
      setActiveSheet('requests');
    } else if (initialTab === 'blocked') {
      setSegment('chats');
      setActiveSheet('privacy');
    } else {
      setSegment('chats');
    }
  }, [initialTab]);

  // Core social data (hydrated instantly from module cache — ZERO spinner when returning to Friends tab!)
  const [friends, setFriends] = useState<FriendListItem[]>(
    () => initialCached?.friends ?? []
  );
  const [groups, setGroups] = useState<FriendGroupSummary[]>(
    () => initialCached?.groups ?? []
  );
  const [incoming, setIncoming] = useState<FriendRequestItem[]>(
    () => initialCached?.incoming ?? []
  );
  const [outgoing, setOutgoing] = useState<FriendRequestItem[]>(
    () => initialCached?.outgoing ?? []
  );
  const [blockedUsers, setBlockedUsers] = useState<BlockedUserItem[]>(
    () => initialCached?.blockedUsers ?? []
  );
  const [conversations, setConversations] = useState<ChatConversationItem[]>(
    () => initialCached?.conversations ?? []
  );
  const [incomingInvites, setIncomingInvites] = useState<GameInviteItem[]>(
    () => initialCached?.incomingInvites ?? []
  );
  const [privacy, setPrivacy] = useState<SocialPrivacySettings | null>(
    () => initialCached?.privacy ?? null
  );
  const [initialLoading, setInitialLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedInviteLink, setCopiedInviteLink] = useState(false);

  // Full-screen chats
  const [activeConversation, setActiveConversation] =
    useState<ChatConversationItem | null>(null);
  const [eyvanBotChatOpen, setEyvanBotChatOpen] = useState(false);
  const [eyvanBotUnread, setEyvanBotUnread] = useState<number>(() =>
    getEyvanBotUnreadCount()
  );
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupMessages, setGroupMessages] = useState<GroupMessageItem[]>([]);
  const [groupMessagesLoading, setGroupMessagesLoading] = useState(false);
  const [groupDraft, setGroupDraft] = useState('');
  const [showGroupMembersTray, setShowGroupMembersTray] = useState(false);
  const [addMemberUserId, setAddMemberUserId] = useState('');

  // Create group state
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMemberIds, setNewGroupMemberIds] = useState<string[]>([]);

  // Search / Add Friend state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SocialUserSummary[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchOffset, setSearchOffset] = useState(0);
  const [searchExecutedQuery, setSearchExecutedQuery] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);

  // Row quick menu + confirmations + toast
  const [menuOpenUserId, setMenuOpenUserId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const feedbackTimerRef = useRef<number | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const groupBottomRef = useRef<HTMLDivElement | null>(null);

  // Pull-to-refresh touch gesture state (replaces manual refresh button)
  const [pullDistance, setPullDistance] = useState(0);
  const pullStartYRef = useRef<number | null>(null);

  const isAnyChatOpen = Boolean(
    activeConversation || eyvanBotChatOpen || selectedGroupId
  );

  useEffect(() => {
    onChatOpenChange?.(isAnyChatOpen);
  }, [isAnyChatOpen, onChatOpenChange]);

  useEffect(() => {
    if (closeChatSignal <= 0) return;
    setActiveConversation(null);
    setEyvanBotChatOpen(false);
    setSelectedGroupId(null);
    setShowGroupMembersTray(false);
  }, [closeChatSignal]);

  const showToast = useCallback((type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = window.setTimeout(() => {
      setFeedback(null);
    }, 3400);
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
        groupsRes,
      ] = await Promise.all([
        fetchFriendsRequest(),
        fetchFriendRequestsRequest(),
        fetchSocialPrivacyRequest(),
        fetchBlockedUsersRequest(),
        fetchChatConversationsRequest(),
        fetchGameInvitesRequest(),
        fetchFriendGroupsRequest(),
      ]);

      const nextFriends =
        friendsRes.ok && Array.isArray(friendsRes.friends)
          ? friendsRes.friends
          : undefined;
      const nextIncoming = requestsRes.ok
        ? Array.isArray(requestsRes.incoming)
          ? requestsRes.incoming
          : []
        : undefined;
      const nextOutgoing = requestsRes.ok
        ? Array.isArray(requestsRes.outgoing)
          ? requestsRes.outgoing
          : []
        : undefined;
      const nextPrivacy =
        privacyRes.ok && privacyRes.privacy ? privacyRes.privacy : undefined;
      const nextBlocked =
        blocksRes.ok && Array.isArray(blocksRes.blocked)
          ? blocksRes.blocked
          : undefined;
      const nextConvs =
        convsRes.ok && Array.isArray(convsRes.conversations)
          ? convsRes.conversations
          : undefined;
      const nextInvites =
        invitesRes.ok && Array.isArray(invitesRes.incoming)
          ? invitesRes.incoming
          : undefined;
      const nextGroups =
        groupsRes.ok && Array.isArray(groupsRes.groups)
          ? groupsRes.groups
          : undefined;

      if (nextFriends) setFriends(nextFriends);
      if (nextIncoming) setIncoming(nextIncoming);
      if (nextOutgoing) setOutgoing(nextOutgoing);
      if (nextPrivacy) setPrivacy(nextPrivacy);
      if (nextBlocked) setBlockedUsers(nextBlocked);
      if (nextConvs) setConversations(nextConvs);
      if (nextInvites) setIncomingInvites(nextInvites);
      if (nextGroups) setGroups(nextGroups);

      if (authUser?.userId) {
        const prevCache = FRIENDS_SNAPSHOT_CACHE.get(authUser.userId);
        FRIENDS_SNAPSHOT_CACHE.set(authUser.userId, {
          friends: nextFriends ?? prevCache?.friends ?? [],
          groups: nextGroups ?? prevCache?.groups ?? [],
          incoming: nextIncoming ?? prevCache?.incoming ?? [],
          outgoing: nextOutgoing ?? prevCache?.outgoing ?? [],
          blockedUsers: nextBlocked ?? prevCache?.blockedUsers ?? [],
          conversations: nextConvs ?? prevCache?.conversations ?? [],
          incomingInvites: nextInvites ?? prevCache?.incomingInvites ?? [],
          privacy: nextPrivacy ?? prevCache?.privacy ?? null,
        });
      }
    } catch {
      if (!silent) {
        showToast('error', 'خطا در دریافت اطلاعات گفتگوها از سرور.');
      }
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, [authUser?.userId, showToast]);

  const pollFriendsPresence = useCallback(async () => {
    try {
      const [presenceRes, convsRes, invitesRes, groupsRes] = await Promise.all([
        fetchFriendsPresenceRequest(),
        fetchChatConversationsRequest(),
        fetchGameInvitesRequest(),
        fetchFriendGroupsRequest(),
      ]);

      if (presenceRes.ok && Array.isArray(presenceRes.presence)) {
        const statusById = new Map(
          presenceRes.presence.map((item) => [item.userId, item])
        );
        setFriends((prev) =>
          prev.map((friend) => {
            const p = statusById.get(friend.userId);
            if (!p) return friend;
            return {
              ...friend,
              onlineStatus: p.onlineStatus,
            };
          })
        );
        setActiveConversation((prev) => {
          if (!prev) return prev;
          const p = statusById.get(prev.partner.userId);
          if (!p) return prev;
          return {
            ...prev,
            partner: {
              ...prev.partner,
              onlineStatus: p.onlineStatus,
            },
          };
        });
      }

      if (convsRes.ok && Array.isArray(convsRes.conversations)) {
        setConversations(convsRes.conversations);
      }
      if (invitesRes.ok && Array.isArray(invitesRes.incoming)) {
        setIncomingInvites(invitesRes.incoming);
      }
      if (groupsRes.ok && Array.isArray(groupsRes.groups)) {
        setGroups(groupsRes.groups);
      }
    } catch {
      // Non-fatal background refresh
    }
  }, []);

  useEffect(() => {
    if (!authUser) {
      setFriends([]);
      setGroups([]);
      setSelectedGroupId(null);
      setGroupMessages([]);
      setIncoming([]);
      setOutgoing([]);
      setBlockedUsers([]);
      setConversations([]);
      setActiveConversation(null);
      setEyvanBotChatOpen(false);
      setIncomingInvites([]);
      setPrivacy(null);
      setSearchResults([]);
      setSearchExecutedQuery('');
      return;
    }

    const cached = FRIENDS_SNAPSHOT_CACHE.get(authUser.userId);
    if (cached) {
      setFriends(cached.friends);
      setGroups(cached.groups);
      setIncoming(cached.incoming);
      setOutgoing(cached.outgoing);
      setBlockedUsers(cached.blockedUsers);
      setConversations(cached.conversations);
      setIncomingInvites(cached.incomingInvites);
      setPrivacy(cached.privacy);
      setInitialLoading(false);
      // Silently refresh in background — zero loading spinner on tab revisit!
      void loadSocialSnapshot(true);
    } else {
      void loadSocialSnapshot(false);
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void pollFriendsPresence();
      }
    }, PRESENCE_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [authUser?.userId, loadSocialSnapshot, pollFriendsPresence]);

  useEffect(() => {
    if (!authUser || refreshSignal <= 0) return;
    void loadSocialSnapshot(true);
  }, [authUser?.userId, refreshSignal, loadSocialSnapshot]);

  // Search execution (debounced live search + explicit submit)
  const runSearch = useCallback(async (rawQuery: string, offset = 0, append = false) => {
    const trimmed = rawQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setSearchExecutedQuery('');
      setSearchHasMore(false);
      setSearchOffset(0);
      setSearchError(null);
      return;
    }

    searchAbortRef.current?.abort();
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
        return;
      }

      const items = Array.isArray(res.users) ? res.users : [];
      setSearchResults((prev) => (append ? [...prev, ...items] : items));
      setSearchHasMore(Boolean(res.hasMore));
      setSearchOffset(offset + items.length);
      setSearchExecutedQuery(trimmed);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      setSearchError('ارتباط با سرور برای جستجو برقرار نشد.');
    } finally {
      if (!controller.signal.aborted) {
        setSearchLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!authUser) return;
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setSearchExecutedQuery('');
      setSearchError(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void runSearch(trimmed, 0, false);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [authUser, searchQuery, runSearch]);

  // Open direct conversation helper
  const handleOpenDirectChat = useCallback(
    async (targetUserId: string) => {
      const key = `chat:${targetUserId}`;
      setBusyKey(key);
      setMenuOpenUserId(null);
      try {
        const res = await openDirectConversationApi(targetUserId);
        if (!res.ok || !res.conversation) {
          showToast('error', res.message ?? 'امکان باز کردن گفتگو وجود ندارد.');
          return;
        }
        setEyvanBotChatOpen(false);
        setSelectedGroupId(null);
        setActiveConversation(res.conversation);
        setConversations((prev) => {
          const exists = prev.some(
            (c) => c.conversationId === res.conversation!.conversationId
          );
          if (exists) {
            return prev.map((c) =>
              c.conversationId === res.conversation!.conversationId
                ? { ...c, ...res.conversation!, unreadCount: 0 }
                : c
            );
          }
          return [res.conversation!, ...prev];
        });
      } catch {
        showToast('error', 'خطا در باز کردن گفتگو.');
      } finally {
        setBusyKey(null);
      }
    },
    [showToast]
  );

  // Deep-link direct chat from PublicPlayerProfileModal
  useEffect(() => {
    if (!authUser || !initialChatTargetUserId) return;
    void handleOpenDirectChat(initialChatTargetUserId);
    onClearInitialChatTarget?.();
  }, [authUser?.userId, initialChatTargetUserId, handleOpenDirectChat, onClearInitialChatTarget]);

  // Load & poll active group messages
  const loadGroupMessages = useCallback(async (groupId: string, silent = false) => {
    if (!silent) setGroupMessagesLoading(true);
    try {
      const res = await fetchGroupMessagesRequest(groupId, 50);
      if (res.ok && Array.isArray(res.messages)) {
        setGroupMessages(res.messages);
      }
    } catch {
      // Non-fatal
    } finally {
      if (!silent) setGroupMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authUser || !selectedGroupId) {
      setGroupMessages([]);
      return;
    }
    void loadGroupMessages(selectedGroupId, false);
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadGroupMessages(selectedGroupId, true);
      }
    }, 6_000);
    return () => window.clearInterval(id);
  }, [authUser?.userId, selectedGroupId, loadGroupMessages]);

  useEffect(() => {
    if (selectedGroupId && groupMessages.length > 0) {
      groupBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [selectedGroupId, groupMessages.length]);

  // Friend & privacy actions
  const handleSendFriendRequest = async (targetUser: SocialUserSummary) => {
    const key = `req:${targetUser.userId}`;
    setBusyKey(key);
    try {
      const res = await sendFriendRequestApi(targetUser.userId);
      if (!res.ok) {
        showToast('error', res.message ?? 'ارسال درخواست دوستی انجام نشد.');
        return;
      }
      showToast('success', `درخواست دوستی برای ${targetUser.username} ارسال شد.`);
      setSearchResults((prev) =>
        prev.map((item) =>
          item.userId === targetUser.userId
            ? {
                ...item,
                relationshipStatus:
                  res.relationshipStatus === 'friend' ? 'friend' : 'outgoing_pending',
                friendshipId: res.friendshipId ?? item.friendshipId,
              }
            : item
        )
      );
      await loadSocialSnapshot(true);
    } catch {
      showToast('error', 'خطا در ارسال درخواست دوستی.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleAcceptRequest = async (friendshipId: string, label: string) => {
    const key = `acc:${friendshipId}`;
    setBusyKey(key);
    try {
      const res = await acceptFriendRequestApi(friendshipId);
      if (!res.ok) {
        showToast('error', res.message ?? 'پذیرش درخواست انجام نشد.');
        return;
      }
      showToast('success', `دوستی با ${label} تایید شد.`);
      await loadSocialSnapshot(true);
      if (searchExecutedQuery) {
        void runSearch(searchExecutedQuery, 0, false);
      }
    } catch {
      showToast('error', 'خطا در پذیرش درخواست دوستی.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleRejectRequest = async (friendshipId: string) => {
    const key = `rej:${friendshipId}`;
    setBusyKey(key);
    try {
      const res = await rejectFriendRequestApi(friendshipId);
      if (!res.ok) {
        showToast('error', res.message ?? 'رد کردن درخواست انجام نشد.');
        return;
      }
      showToast('success', 'درخواست دوستی رد شد.');
      await loadSocialSnapshot(true);
    } catch {
      showToast('error', 'خطا در رد کردن درخواست.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleCancelRequest = async (friendshipId: string) => {
    const key = `can:${friendshipId}`;
    setBusyKey(key);
    try {
      const res = await cancelFriendRequestApi(friendshipId);
      if (!res.ok) {
        showToast('error', res.message ?? 'لغو درخواست انجام نشد.');
        return;
      }
      showToast('success', 'درخواست لغو شد.');
      await loadSocialSnapshot(true);
    } catch {
      showToast('error', 'خطا در لغو درخواست.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleRemoveFriend = async (userId: string, username: string) => {
    const key = `rm:${userId}`;
    setBusyKey(key);
    setMenuOpenUserId(null);
    try {
      const res = await removeFriendApi(userId);
      if (!res.ok) {
        showToast('error', res.message ?? 'حذف دوستی انجام نشد.');
        return;
      }
      if (activeConversation?.partner.userId === userId) {
        setActiveConversation(null);
      }
      showToast('success', `${username} از لیست دوستان حذف شد.`);
      await loadSocialSnapshot(true);
    } catch {
      showToast('error', 'خطا در حذف دوستی.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleBlockUser = async (userId: string, username: string) => {
    const key = `blk:${userId}`;
    setBusyKey(key);
    setMenuOpenUserId(null);
    try {
      const res = await blockUserApi(userId);
      if (!res.ok) {
        showToast('error', res.message ?? 'مسدود کردن کاربر انجام نشد.');
        return;
      }
      if (activeConversation?.partner.userId === userId) {
        setActiveConversation(null);
      }
      showToast('success', `${username} مسدود شد.`);
      await loadSocialSnapshot(true);
    } catch {
      showToast('error', 'خطا در مسدود کردن کاربر.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleUnblockUser = async (userId: string, username: string) => {
    const key = `unblk:${userId}`;
    setBusyKey(key);
    try {
      const res = await unblockUserApi(userId);
      if (!res.ok) {
        showToast('error', res.message ?? 'رفع مسدودیت انجام نشد.');
        return;
      }
      showToast('success', `مسدودیت ${username} برداشته شد.`);
      await loadSocialSnapshot(true);
    } catch {
      showToast('error', 'خطا در رفع مسدودیت.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleTogglePrivacy = async (
    field: 'showOnlineStatus' | 'allowFriendRequests'
  ) => {
    if (!privacy || privacySaving) return;
    setPrivacySaving(true);
    try {
      const nextVal = !privacy[field];
      const res = await updateSocialPrivacyRequest({ [field]: nextVal });
      if (!res.ok || !res.privacy) {
        showToast('error', res.message ?? 'ذخیره تنظیمات حریم خصوصی انجام نشد.');
        return;
      }
      setPrivacy(res.privacy);
      showToast('success', 'تنظیمات حریم خصوصی ذخیره شد.');
    } catch {
      showToast('error', 'خطا در ذخیره تنظیمات حریم خصوصی.');
    } finally {
      setPrivacySaving(false);
    }
  };

  const handleAcceptInvite = async (invite: GameInviteItem) => {
    const key = `inv-acc:${invite.inviteId}`;
    setBusyKey(key);
    try {
      const res = await acceptGameInviteApi(invite.inviteId);
      if (!res.ok) {
        showToast('error', res.message ?? 'امکان پذیرش دعوت‌نامه وجود ندارد.');
        await loadSocialSnapshot(true);
        return;
      }
      const roomCode = res.roomCode ?? invite.roomCode;
      setIncomingInvites((prev) => prev.filter((i) => i.inviteId !== invite.inviteId));
      onJoinInvitedRoom?.(roomCode);
    } catch {
      showToast('error', 'خطا در پذیرش دعوت‌نامه بازی.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeclineInvite = async (invite: GameInviteItem) => {
    const key = `inv-dec:${invite.inviteId}`;
    setBusyKey(key);
    try {
      await declineGameInviteApi(invite.inviteId);
      setIncomingInvites((prev) => prev.filter((i) => i.inviteId !== invite.inviteId));
    } catch {
      showToast('error', 'خطا در رد کردن دعوت‌نامه.');
    } finally {
      setBusyKey(null);
    }
  };

  // Group actions
  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newGroupName.trim();
    if (trimmed.length < 2) {
      showToast('error', 'نام گروه باید حداقل ۲ کاراکتر باشد.');
      return;
    }
    setBusyKey('create-group');
    try {
      const res = await createFriendGroupApi(trimmed, newGroupMemberIds);
      if (!res.ok || !res.group) {
        showToast('error', res.message ?? 'ایجاد گروه انجام نشد.');
        return;
      }
      setGroups((prev) => [res.group!, ...prev]);
      setNewGroupName('');
      setNewGroupMemberIds([]);
      setActiveSheet('none');
      setSegment('groups');
      setSelectedGroupId(res.group.groupId);
      showToast('success', `گروه «${res.group.name}» ساخته شد.`);
    } catch {
      showToast('error', 'خطا در ایجاد گروه.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleAddMemberToGroup = async (groupId: string) => {
    if (!addMemberUserId) return;
    setBusyKey(`grp-add:${groupId}`);
    try {
      const res = await addFriendToGroupApi(groupId, addMemberUserId);
      if (!res.ok || !res.group) {
        showToast('error', res.message ?? 'افزودن عضو انجام نشد.');
        return;
      }
      setGroups((prev) => prev.map((g) => (g.groupId === groupId ? res.group! : g)));
      setAddMemberUserId('');
      showToast('success', 'عضو جدید به گروه اضافه شد.');
    } catch {
      showToast('error', 'خطا در افزودن دوست به گروه.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleSendGroupText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroupId) return;
    const trimmed = groupDraft.trim();
    if (!trimmed) return;
    setBusyKey('grp-send');
    try {
      const res = await sendGroupMessageApi(selectedGroupId, {
        kind: 'text',
        body: trimmed,
      });
      if (!res.ok || !res.message || typeof res.message === 'string') {
        showToast('error', typeof res.message === 'string' ? res.message : 'ارسال پیام انجام نشد.');
        return;
      }
      setGroupDraft('');
      setGroupMessages((prev) => [...prev, res.message as GroupMessageItem]);
      void loadSocialSnapshot(true);
    } catch {
      showToast('error', 'خطا در ارسال پیام گروهی.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleCreateAndInviteHokmGroup = async (group: FriendGroupSummary) => {
    if (!authUser) return;
    setBusyKey(`grp-hokm:${group.groupId}`);
    try {
      const created = await createOnlineRoom({
        username: authUser.username,
        avatarCode: toValidAvatarCode(authUser.avatarCode),
        targetMatchScore: 3,
        isPublic: false,
      });
      const roomCode = created.roomCode;
      const sendRes = await sendGroupMessageApi(group.groupId, {
        kind: 'game_invite',
        gameId: 'hokm',
        roomCode,
        body: `دعوت به بازی حکم ۴ نفره — کد اتاق: ${roomCode}`,
      });
      if (sendRes.ok && sendRes.message && typeof sendRes.message !== 'string') {
        setGroupMessages((prev) => [...prev, sendRes.message as GroupMessageItem]);
      }
      showToast('success', `دعوت اتاق حکم (${roomCode}) در گروه ارسال شد.`);
      onJoinInvitedRoom?.(roomCode);
    } catch {
      showToast('error', 'خطا در ساخت اتاق حکم گروهی.');
    } finally {
      setBusyKey(null);
    }
  };

  // Build unified Telegram-style people chat rows (friends + conversations)
  const unifiedChats = useMemo<UnifiedPersonChatRow[]>(() => {
    const map = new Map<string, UnifiedPersonChatRow>();

    for (const f of friends) {
      map.set(f.userId, {
        userId: f.userId,
        username: f.username,
        accountCode: f.accountCode,
        avatarCode: f.avatarCode,
        avatarUrl: f.avatarUrl,
        onlineStatus: f.onlineStatus === 'online' ? 'online' : 'offline',
        appearance: f.appearance,
        lastMessagePreview: null,
        lastMessageAt: null,
        unreadCount: 0,
        isFriend: true,
      });
    }

    for (const conv of conversations) {
      const existing = map.get(conv.partner.userId);
      map.set(conv.partner.userId, {
        userId: conv.partner.userId,
        username: conv.partner.username,
        accountCode: conv.partner.accountCode ?? existing?.accountCode ?? null,
        avatarCode: conv.partner.avatarCode || existing?.avatarCode || 'portrait',
        avatarUrl: conv.partner.avatarUrl ?? existing?.avatarUrl ?? null,
        onlineStatus:
          conv.partner.onlineStatus === 'online' || existing?.onlineStatus === 'online'
            ? 'online'
            : 'offline',
        appearance: existing?.appearance,
        lastMessagePreview: conv.lastMessagePreview ?? existing?.lastMessagePreview ?? null,
        lastMessageAt: conv.lastMessageAt ?? existing?.lastMessageAt ?? null,
        unreadCount: conv.unreadCount ?? 0,
        isFriend: existing?.isFriend ?? true,
        conversation: conv,
      });
    }

    return Array.from(map.values()).sort((a, b) => {
      const tA = a.lastMessageAt ?? 0;
      const tB = b.lastMessageAt ?? 0;
      if (tA !== tB) return tB - tA;
      if (a.onlineStatus !== b.onlineStatus) {
        return a.onlineStatus === 'online' ? -1 : 1;
      }
      return a.username.localeCompare(b.username);
    });
  }, [friends, conversations]);

  const totalDirectUnread = useMemo(
    () =>
      unifiedChats.reduce((sum, c) => sum + (c.unreadCount || 0), 0) +
      eyvanBotUnread,
    [unifiedChats, eyvanBotUnread]
  );

  const selectedGroup = useMemo(
    () => groups.find((g) => g.groupId === selectedGroupId) ?? null,
    [groups, selectedGroupId]
  );

  const latestEyvanAnnouncement =
    EYVAN_BOT_ANNOUNCEMENTS[EYVAN_BOT_ANNOUNCEMENTS.length - 1];

  // =========================================================================
  // AUTH GATE
  // =========================================================================
  if (authLoading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center gap-3 theme-muted">
        <Loader2 className="w-6 h-6 animate-spin theme-accent-teal" />
        <span className="text-xs font-bold">در حال بارگذاری گفتگوها...</span>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div
        data-testid="friends-auth-required"
        className="max-w-md mx-auto mt-6 eyvan-card rounded-2xl p-6 text-center space-y-4 border border-[var(--eyvan-gold-border)]"
      >
        <div className="w-14 h-14 mx-auto rounded-full bg-[#0D8A8A]/18 border border-[#2CC5BE]/40 flex items-center justify-center">
          <Users className="w-7 h-7 theme-accent-teal" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-base font-black theme-heading">
            گفتگوها و دوستان ایوان
          </h2>
          <p className="text-xs theme-muted leading-relaxed">
            برای گفتگوی خصوصی، ساخت گروه دوستان و دعوت به میز حکم، وارد حساب کاربری خود شوید.
          </p>
        </div>
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={onOpenAccount}
            data-testid="friends-open-account-btn"
            className="w-full min-h-[44px] rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] text-sm font-black shadow-md cursor-pointer"
          >
            ورود یا ثبت‌نام
          </button>
          <button
            type="button"
            onClick={async () => {
              const inviteUrl = `${window.location.origin}/?invite=eyvan`;
              try {
                await navigator.clipboard?.writeText(inviteUrl);
                setCopiedInviteLink(true);
                window.setTimeout(() => setCopiedInviteLink(false), 2200);
              } catch {
                // Ignore clipboard restriction
              }
            }}
            data-testid="friends-invite-link-btn"
            className="w-full min-h-[42px] rounded-xl theme-btn-secondary border text-xs font-extrabold inline-flex items-center justify-center gap-1.5 cursor-pointer"
          >
            {copiedInviteLink ? (
              <>
                <Check className="w-4 h-4 text-[#22C55E]" />
                <span>لینک دعوت کپی شد!</span>
              </>
            ) : (
              <>
                <Link2 className="w-4 h-4 theme-accent-gold" />
                <span>کپی لینک دعوت به ایوان</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // =========================================================================
  // FULL-SCREEN TELEGRAM PRIVATE CHAT
  // =========================================================================
  if (activeConversation) {
    return (
      <PrivateChatPanel
        currentUserId={authUser.userId}
        conversation={activeConversation}
        onClose={() => {
          setActiveConversation(null);
          void loadSocialSnapshot(true);
        }}
        onConversationActivity={() => void loadSocialSnapshot(true)}
        onOpenFriendGroups={() => {
          setActiveConversation(null);
          setSegment('groups');
        }}
        onInspectPlayer={onInspectPlayer}
      />
    );
  }

  // =========================================================================
  // FULL-SCREEN TELEGRAM EYVAN ANNOUNCEMENTS CHAT
  // =========================================================================
  if (eyvanBotChatOpen) {
    return (
      <EyvanBotChatPanel
        onClose={() => setEyvanBotChatOpen(false)}
        onMarkedRead={() => setEyvanBotUnread(0)}
      />
    );
  }

  // =========================================================================
  // FULL-SCREEN TELEGRAM GROUP CHAT
  // =========================================================================
  if (selectedGroup) {
    const memberIds = new Set(selectedGroup.members.map((m) => m.userId));
    const addableFriends = friends.filter((f) => !memberIds.has(f.userId));

    return (
      <section
        data-testid="group-chat-panel"
        className="fixed inset-0 z-50 flex flex-col bg-[var(--eyvan-bg)] text-[var(--eyvan-text)]"
      >
        {/* Sticky Group Header */}
        <header className="h-14 shrink-0 px-2.5 sm:px-4 border-b border-[var(--eyvan-line)] theme-drawer flex items-center justify-between gap-2 shadow-sm">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => {
                setSelectedGroupId(null);
                setShowGroupMembersTray(false);
              }}
              aria-label="بازگشت به لیست گروه‌ها"
              className="w-9 h-9 rounded-full hover:bg-white/8 flex items-center justify-center theme-heading shrink-0 cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 rotate-180" />
            </button>

            <button
              type="button"
              onClick={() => setShowGroupMembersTray((prev) => !prev)}
              className="flex items-center gap-2.5 min-w-0 flex-1 text-right cursor-pointer"
            >
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#0D8A8A]/35 to-[#C89B3C]/35 border border-[#2CC5BE]/40 flex items-center justify-center shrink-0">
                <Users className="w-4 h-4 theme-accent-gold" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-black theme-heading truncate leading-tight">
                  {selectedGroup.name}
                </div>
                <div className="text-[11px] font-bold theme-muted leading-tight mt-0.5">
                  {toPersianDigits(selectedGroup.memberCount)} عضو
                </div>
              </div>
            </button>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowGroupMembersTray((prev) => !prev)}
              aria-label="اعضای گروه"
              className={`w-9 h-9 rounded-full border flex items-center justify-center cursor-pointer transition-colors ${
                showGroupMembersTray
                  ? 'bg-[#0D8A8A]/20 border-[#2CC5BE]/60 text-[#2CC5BE]'
                  : 'theme-btn-secondary'
              }`}
            >
              <UserPlus className="w-4 h-4" />
            </button>

            <button
              type="button"
              disabled={busyKey === `grp-hokm:${selectedGroup.groupId}`}
              onClick={() => void handleCreateAndInviteHokmGroup(selectedGroup)}
              data-testid="group-invite-hokm-btn"
              className="h-9 px-3 rounded-full bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] text-[11px] font-black inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
            >
              {busyKey === `grp-hokm:${selectedGroup.groupId}` ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Gamepad2 className="w-3.5 h-3.5" />
              )}
              <span>دعوت حکم</span>
            </button>
          </div>
        </header>

        {/* Collapsible Members & Add-Member Bar */}
        {showGroupMembersTray && (
          <div className="shrink-0 px-3.5 py-3 border-b border-[var(--eyvan-line)] theme-subcard space-y-2.5">
            <div className="flex flex-wrap gap-1.5">
              {selectedGroup.members.map((m) => (
                <button
                  key={m.userId}
                  type="button"
                  onClick={() => onInspectPlayer?.(m.userId)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full theme-card border border-[var(--eyvan-line)] text-[11px] font-bold theme-heading cursor-pointer"
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      m.onlineStatus === 'online' ? 'bg-[#22C55E]' : 'bg-slate-500/60'
                    }`}
                  />
                  <span dir="ltr">{m.username}</span>
                </button>
              ))}
            </div>

            {addableFriends.length > 0 && (
              <div className="flex items-center gap-2">
                <select
                  value={addMemberUserId}
                  onChange={(e) => setAddMemberUserId(e.target.value)}
                  className="flex-1 min-h-[36px] px-3 rounded-xl theme-input border text-xs"
                >
                  <option value="">افزودن دوست به گروه...</option>
                  {addableFriends.map((f) => (
                    <option key={f.userId} value={f.userId}>
                      {f.username}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!addMemberUserId || busyKey === `grp-add:${selectedGroup.groupId}`}
                  onClick={() => void handleAddMemberToGroup(selectedGroup.groupId)}
                  className="min-h-[36px] px-3.5 rounded-xl bg-[#0D8A8A] text-white text-xs font-extrabold cursor-pointer disabled:opacity-50"
                >
                  افزودن
                </button>
              </div>
            )}
          </div>
        )}

        {/* Group Messages Stream */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-3 space-y-2 max-w-3xl w-full mx-auto">
          {groupMessagesLoading ? (
            <div className="py-16 flex items-center justify-center gap-2 theme-muted text-xs font-bold">
              <Loader2 className="w-4 h-4 animate-spin theme-accent-teal" />
              <span>در حال دریافت پیام‌های گروه...</span>
            </div>
          ) : groupMessages.length === 0 ? (
            <div className="py-16 text-center space-y-1.5">
              <p className="text-xs font-extrabold theme-heading">
                هنوز پیامی در گروه ارسال نشده است
              </p>
              <p className="text-[11px] theme-muted">
                پیامی بنویسید یا دعوت حکم ۴ نفره بفرستید.
              </p>
            </div>
          ) : (
            groupMessages.map((msg) => {
              const isMine = msg.senderId === authUser.userId;
              return (
                <div
                  key={msg.messageId}
                  className={`flex ${isMine ? 'justify-start' : 'justify-end'}`}
                >
                  <div
                    className={`max-w-[82%] sm:max-w-[72%] rounded-2xl px-3.5 py-2 text-[13px] sm:text-sm leading-relaxed break-words whitespace-pre-wrap border shadow-xs ${
                      isMine
                        ? msg.kind === 'game_invite'
                          ? 'bg-[#D4AE58]/18 border-[#D4AE58]/45 theme-heading rounded-tr-sm'
                          : 'bg-[#0D8A8A]/24 border-[#2CC5BE]/35 theme-heading rounded-tr-sm'
                        : 'theme-subcard border-[var(--eyvan-line)] theme-heading rounded-tl-sm'
                    }`}
                  >
                    {!isMine && (
                      <button
                        type="button"
                        onClick={() => onInspectPlayer?.(msg.senderId)}
                        dir="ltr"
                        className="block text-[11px] font-black theme-accent-teal mb-0.5 cursor-pointer hover:underline"
                      >
                        {msg.senderUsername}
                      </button>
                    )}

                    <div>{msg.body}</div>

                    {msg.kind === 'game_invite' && msg.roomCode && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedGroupId(null);
                          onJoinInvitedRoom?.(msg.roomCode!);
                        }}
                        className="mt-2 w-full min-h-[34px] px-3 rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] text-xs font-black inline-flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Gamepad2 className="w-3.5 h-3.5" />
                        <span>ورود به اتاق {msg.roomCode}</span>
                      </button>
                    )}

                    <div className="mt-0.5 text-[10px] theme-muted text-left tabular-nums">
                      {formatTelegramTime(msg.createdAt)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={groupBottomRef} />
        </div>

        {/* Pinned Group Composer */}
        <form
          onSubmit={handleSendGroupText}
          className="shrink-0 px-3 py-2.5 border-t border-[var(--eyvan-line)] theme-drawer"
          style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}
        >
          <div className="max-w-3xl mx-auto flex items-end gap-2">
            <input
              type="text"
              value={groupDraft}
              onChange={(e) => setGroupDraft(e.target.value)}
              placeholder="پیام به گروه..."
              className="flex-1 min-h-[42px] px-4 rounded-3xl theme-input border text-sm focus:outline-none focus:border-[#0D8A8A]"
            />
            <button
              type="submit"
              disabled={!groupDraft.trim() || busyKey === 'grp-send'}
              aria-label="ارسال پیام گروهی"
              className="w-[42px] h-[42px] rounded-full bg-gradient-to-b from-[#F3D179] to-[#C89B3C] disabled:opacity-40 text-[#0B1628] flex items-center justify-center shrink-0 cursor-pointer"
            >
              <Send className="w-4 h-4 -translate-x-[1px]" />
            </button>
          </div>
        </form>
      </section>
    );
  }

  // =========================================================================
  // MAIN TELEGRAM-STYLE LIST VIEW
  // =========================================================================
  const handlePullTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (refreshing || window.scrollY > 2) {
      pullStartYRef.current = null;
      return;
    }
    pullStartYRef.current = e.touches[0]?.clientY ?? null;
  };

  const handlePullTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (pullStartYRef.current === null || refreshing) return;
    if (window.scrollY > 2) {
      pullStartYRef.current = null;
      setPullDistance(0);
      return;
    }
    const delta = (e.touches[0]?.clientY ?? pullStartYRef.current) - pullStartYRef.current;
    if (delta > 0) {
      setPullDistance(Math.min(84, Math.round(delta * 0.55)));
    } else {
      setPullDistance(0);
    }
  };

  const handlePullTouchEnd = () => {
    if (pullStartYRef.current === null) return;
    const triggered = pullDistance >= 54;
    pullStartYRef.current = null;
    setPullDistance(0);
    if (triggered && !refreshing) {
      void loadSocialSnapshot(true);
    }
  };

  return (
    <div
      data-testid="friends-page"
      onTouchStart={handlePullTouchStart}
      onTouchMove={handlePullTouchMove}
      onTouchEnd={handlePullTouchEnd}
      onTouchCancel={handlePullTouchEnd}
      className="max-w-2xl mx-auto space-y-3 pb-4"
    >
      {/* Pull-to-refresh smooth indicator */}
      {(pullDistance > 8 || refreshing) && (
        <div
          data-testid="friends-pull-refresh-indicator"
          style={{
            height: refreshing ? 36 : Math.min(44, pullDistance),
          }}
          className="flex items-center justify-center overflow-hidden transition-[height] duration-150"
        >
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold theme-accent-teal">
            <Loader2
              className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
              style={
                !refreshing
                  ? { transform: `rotate(${Math.min(360, pullDistance * 5)}deg)` }
                  : undefined
              }
            />
            <span>
              {refreshing
                ? 'در حال به‌روزرسانی...'
                : pullDistance >= 54
                  ? 'رها کنید تا به‌روز شود'
                  : 'بکشید برای به‌روزرسانی'}
            </span>
          </span>
        </div>
      )}
      {/* Toast feedback */}
      {feedback && (
        <div
          role="status"
          className={`px-3.5 py-2.5 rounded-2xl border text-xs font-extrabold flex items-center justify-between gap-2 ${
            feedback.type === 'success'
              ? 'bg-[#0D8A8A]/18 border-[#2CC5BE]/45 text-[#2CC5BE]'
              : 'bg-red-500/15 border-red-500/35 text-red-400'
          }`}
        >
          <span className="flex items-center gap-2">
            {feedback.type === 'error' ? (
              <AlertCircle className="w-4 h-4 shrink-0" />
            ) : (
              <Check className="w-4 h-4 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 1. Compact Telegram Top Search / Add Friend Bar + Utility Icons */}
      <div className="relative">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 theme-muted absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void runSearch(searchQuery, 0, false);
                }
              }}
              placeholder="جستجو یا افزودن دوست با نام کاربری / ID..."
              data-testid="friends-search-input"
              className="w-full h-11 pr-10 pl-9 rounded-full theme-input border border-[var(--eyvan-line)] text-xs sm:text-sm focus:outline-none focus:border-[#2CC5BE] transition-colors"
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
                className="w-6 h-6 rounded-full flex items-center justify-center theme-muted hover:theme-heading absolute left-2.5 top-1/2 -translate-y-1/2 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Pending Requests Toggle */}
          <button
            type="button"
            onClick={() =>
              setActiveSheet((prev) => (prev === 'requests' ? 'none' : 'requests'))
            }
            data-testid="friends-requests-toggle-btn"
            aria-label="درخواست‌های دوستی"
            className={`relative w-11 h-11 rounded-full border flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
              activeSheet === 'requests'
                ? 'bg-[#D4AE58]/20 border-[#F3D179]/60 text-[#F3D179]'
                : 'theme-btn-secondary'
            }`}
          >
            <UserPlus className="w-4 h-4" />
            {incoming.length > 0 && (
              <span className="absolute -top-0.5 -left-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center shadow-sm">
                {toPersianDigits(incoming.length)}
              </span>
            )}
          </button>

          {/* Icon-Only Personal Invite Link Copy/Share Button */}
          <button
            type="button"
            onClick={async () => {
              const refCode = authUser.accountCode || authUser.username;
              const inviteUrl = `${window.location.origin}/?invite=${encodeURIComponent(refCode)}`;
              const shareText = `بیا در ایوان با هم حکم بازی کنیم! آیدی من: ${authUser.username} (ID: ${refCode})\n${inviteUrl}`;
              try {
                if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                  await navigator.clipboard.writeText(inviteUrl);
                } else if (typeof navigator !== 'undefined' && 'share' in navigator) {
                  await (navigator as Navigator & { share: (d: ShareData) => Promise<void> }).share({
                    title: 'دعوت به بازی در ایوان',
                    text: shareText,
                    url: inviteUrl,
                  });
                }
                setCopiedInviteLink(true);
                showToast('success', 'لینک دعوت کپی شد — برای دوستانتان ارسال کنید!');
                window.setTimeout(() => setCopiedInviteLink(false), 2200);
              } catch {
                showToast('error', 'کپی کردن لینک دعوت در این مرورگر مجاز نبود.');
              }
            }}
            data-testid="friends-invite-link-btn"
            aria-label="کپی لینک دعوت دوستان"
            title="کپی لینک دعوت دوستان"
            className={`w-11 h-11 rounded-full border flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
              copiedInviteLink
                ? 'bg-[#22C55E]/20 border-[#22C55E]/55 text-[#22C55E]'
                : 'bg-gradient-to-b from-[#F3D179] to-[#C89B3C] border-[#FDE68A]/70 text-[#0B1628] shadow-xs'
            }`}
          >
            {copiedInviteLink ? (
              <Check className="w-4 h-4 shrink-0" />
            ) : (
              <Link2 className="w-4 h-4 shrink-0" />
            )}
          </button>
        </div>

        {/* Live Search Results Dropdown */}
        {searchQuery.trim().length >= 2 && (
          <div
            data-testid="friends-search-results"
            className="mt-2 eyvan-card rounded-2xl border border-[var(--eyvan-gold-border)] overflow-hidden shadow-lg"
          >
            {searchLoading && searchResults.length === 0 ? (
              <div className="py-5 flex items-center justify-center gap-2 text-xs theme-muted">
                <Loader2 className="w-4 h-4 animate-spin theme-accent-teal" />
                <span>در حال جستجو...</span>
              </div>
            ) : searchError ? (
              <div className="px-4 py-3 text-xs text-red-400 font-bold">
                {searchError}
              </div>
            ) : searchResults.length === 0 && searchExecutedQuery ? (
              <div className="px-4 py-4 text-center text-xs theme-muted">
                کاربری با «{searchExecutedQuery}» پیدا نشد.
              </div>
            ) : (
              <div className="divide-y divide-[var(--eyvan-line)]">
                {searchResults.map((user) => (
                  <div
                    key={user.userId}
                    className="px-3.5 py-2.5 flex items-center justify-between gap-2.5"
                  >
                    <button
                      type="button"
                      onClick={() => onInspectPlayer?.(user.userId)}
                      className="flex items-center gap-2.5 min-w-0 flex-1 text-right cursor-pointer"
                    >
                      <ProfileAvatar
                        avatarCode={toValidAvatarCode(user.avatarCode)}
                        username={user.username}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <div
                          dir="ltr"
                          className="text-xs sm:text-sm font-extrabold theme-heading truncate text-right"
                        >
                          {user.username}
                        </div>
                        {user.accountCode && (
                          <div dir="ltr" className="text-[10px] theme-muted text-right">
                            ID: {user.accountCode}
                          </div>
                        )}
                      </div>
                    </button>

                    <div className="shrink-0">
                      {user.relationshipStatus === 'friend' ? (
                        <button
                          type="button"
                          onClick={() => void handleOpenDirectChat(user.userId)}
                          className="min-h-[32px] px-3 rounded-full bg-[#0D8A8A]/20 border border-[#2CC5BE]/45 text-[#2CC5BE] text-[11px] font-black cursor-pointer"
                        >
                          پیام
                        </button>
                      ) : user.relationshipStatus === 'incoming_pending' && user.friendshipId ? (
                        <button
                          type="button"
                          disabled={busyKey === `acc:${user.friendshipId}`}
                          onClick={() =>
                            void handleAcceptRequest(user.friendshipId!, user.username)
                          }
                          className="min-h-[32px] px-3 rounded-full bg-[#22C55E] text-[#052010] text-[11px] font-black cursor-pointer"
                        >
                          پذیرش
                        </button>
                      ) : user.relationshipStatus === 'outgoing_pending' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full theme-subcard text-[10px] font-bold theme-muted">
                          <Clock className="w-3 h-3" />
                          <span>در انتظار</span>
                        </span>
                      ) : user.relationshipStatus === 'blocked' ? (
                        <span className="text-[10px] font-bold text-red-400">مسدود</span>
                      ) : (
                        <button
                          type="button"
                          disabled={busyKey === `req:${user.userId}`}
                          onClick={() => void handleSendFriendRequest(user)}
                          data-testid={`send-friend-req-${user.userId}`}
                          className="min-h-[32px] px-3 rounded-full bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] text-[11px] font-black inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                          <span>افزودن</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {searchHasMore && (
                  <button
                    type="button"
                    disabled={searchLoading}
                    onClick={() => void runSearch(searchExecutedQuery, searchOffset, true)}
                    className="w-full py-2 text-center text-xs font-bold theme-accent-teal hover:bg-white/5 cursor-pointer"
                  >
                    نمایش بیشتر
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Incoming Hokm Game Invites Strip (only when active) */}
      {incomingInvites.length > 0 && (
        <div className="space-y-2">
          {incomingInvites.map((invite) => (
            <div
              key={invite.inviteId}
              className="eyvan-card rounded-2xl px-3.5 py-2.5 border border-[#F3D179]/45 bg-[#D4AE58]/10 flex items-center justify-between gap-2.5"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Gamepad2 className="w-5 h-5 theme-accent-gold shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-black theme-heading truncate">
                    دعوت حکم از <span dir="ltr">{invite.otherUser.username}</span>
                  </div>
                  <div className="text-[10px] theme-muted">
                    اتاق {invite.roomCode}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  disabled={busyKey === `inv-acc:${invite.inviteId}`}
                  onClick={() => void handleAcceptInvite(invite)}
                  className="min-h-[32px] px-3 rounded-full bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] text-[11px] font-black cursor-pointer"
                >
                  ورود
                </button>
                <button
                  type="button"
                  disabled={busyKey === `inv-dec:${invite.inviteId}`}
                  onClick={() => void handleDeclineInvite(invite)}
                  className="w-8 h-8 rounded-full theme-btn-secondary border flex items-center justify-center cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Expandable Utility Sheets (Requests / Privacy / Create Group) */}
      {activeSheet === 'requests' && (
        <div
          data-testid="friends-requests-sheet"
          className="eyvan-card rounded-2xl p-3.5 border border-[var(--eyvan-gold-border)] space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black theme-heading">درخواست‌های دوستی</h3>
            <button
              type="button"
              onClick={() => setActiveSheet('none')}
              className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center theme-muted cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {incoming.length === 0 && outgoing.length === 0 ? (
            <p className="text-xs theme-muted py-2 text-center">
              درخواست دوستی در انتظاری وجود ندارد.
            </p>
          ) : (
            <div className="space-y-2.5">
              {incoming.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold theme-accent-gold">
                    دریافتی ({toPersianDigits(incoming.length)})
                  </div>
                  {incoming.map((req) => (
                    <div
                      key={req.friendshipId}
                      className="flex items-center justify-between gap-2 p-2 rounded-xl theme-subcard border border-[var(--eyvan-line)]"
                    >
                      <button
                        type="button"
                        onClick={() => onInspectPlayer?.(req.user.userId)}
                        className="flex items-center gap-2 min-w-0 cursor-pointer"
                      >
                        <ProfileAvatar
                          avatarCode={toValidAvatarCode(req.user.avatarCode)}
                          username={req.user.username}
                          size="sm"
                        />
                        <span dir="ltr" className="text-xs font-extrabold theme-heading truncate">
                          {req.user.username}
                        </span>
                      </button>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={busyKey === `acc:${req.friendshipId}`}
                          onClick={() =>
                            void handleAcceptRequest(req.friendshipId, req.user.username)
                          }
                          className="min-h-[30px] px-2.5 rounded-lg bg-[#22C55E] text-[#052010] text-[11px] font-black cursor-pointer"
                        >
                          تایید
                        </button>
                        <button
                          type="button"
                          disabled={busyKey === `rej:${req.friendshipId}`}
                          onClick={() => void handleRejectRequest(req.friendshipId)}
                          className="min-h-[30px] px-2.5 rounded-lg theme-btn-secondary border text-[11px] font-bold cursor-pointer"
                        >
                          رد
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {outgoing.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold theme-muted">
                    ارسالی ({toPersianDigits(outgoing.length)})
                  </div>
                  {outgoing.map((req) => (
                    <div
                      key={req.friendshipId}
                      className="flex items-center justify-between gap-2 p-2 rounded-xl theme-subcard border border-[var(--eyvan-line)]"
                    >
                      <span dir="ltr" className="text-xs font-bold theme-heading truncate">
                        {req.user.username}
                      </span>
                      <button
                        type="button"
                        disabled={busyKey === `can:${req.friendshipId}`}
                        onClick={() => void handleCancelRequest(req.friendshipId)}
                        className="min-h-[28px] px-2.5 rounded-lg theme-btn-secondary border text-[11px] font-bold cursor-pointer"
                      >
                        لغو
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeSheet === 'privacy' && (
        <div
          data-testid="friends-privacy-sheet"
          className="eyvan-card rounded-2xl p-3.5 border border-[var(--eyvan-line)] space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black theme-heading">حریم خصوصی و مسدودشده‌ها</h3>
            <button
              type="button"
              onClick={() => setActiveSheet('none')}
              className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center theme-muted cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {privacy && (
            <div className="space-y-2">
              <button
                type="button"
                disabled={privacySaving}
                onClick={() => void handleTogglePrivacy('showOnlineStatus')}
                className="w-full p-2.5 rounded-xl theme-subcard border border-[var(--eyvan-line)] flex items-center justify-between text-xs font-bold theme-heading cursor-pointer"
              >
                <span className="inline-flex items-center gap-2">
                  {privacy.showOnlineStatus ? (
                    <Eye className="w-4 h-4 text-[#22C55E]" />
                  ) : (
                    <EyeOff className="w-4 h-4 theme-muted" />
                  )}
                  <span>نمایش وضعیت آنلاین</span>
                </span>
                <span
                  className={`text-[11px] font-black ${
                    privacy.showOnlineStatus ? 'text-[#22C55E]' : 'theme-muted'
                  }`}
                >
                  {privacy.showOnlineStatus ? 'فعال' : 'مخفی'}
                </span>
              </button>

              <button
                type="button"
                disabled={privacySaving}
                onClick={() => void handleTogglePrivacy('allowFriendRequests')}
                className="w-full p-2.5 rounded-xl theme-subcard border border-[var(--eyvan-line)] flex items-center justify-between text-xs font-bold theme-heading cursor-pointer"
              >
                <span className="inline-flex items-center gap-2">
                  <UserPlus className="w-4 h-4 theme-accent-teal" />
                  <span>پذیرش درخواست دوستی</span>
                </span>
                <span
                  className={`text-[11px] font-black ${
                    privacy.allowFriendRequests ? 'text-[#22C55E]' : 'theme-muted'
                  }`}
                >
                  {privacy.allowFriendRequests ? 'فعال' : 'غیرفعال'}
                </span>
              </button>
            </div>
          )}

          {blockedUsers.length > 0 && (
            <div className="pt-2 border-t border-[var(--eyvan-line)] space-y-1.5">
              <div className="text-[11px] font-bold theme-muted">
                کاربران مسدودشده ({toPersianDigits(blockedUsers.length)})
              </div>
              {blockedUsers.map((b) => (
                <div
                  key={b.userId}
                  className="flex items-center justify-between gap-2 p-2 rounded-xl theme-subcard border border-[var(--eyvan-line)]"
                >
                  <span dir="ltr" className="text-xs font-bold theme-heading truncate">
                    {b.username}
                  </span>
                  <button
                    type="button"
                    disabled={busyKey === `unblk:${b.userId}`}
                    onClick={() => void handleUnblockUser(b.userId, b.username)}
                    className="min-h-[28px] px-2.5 rounded-lg theme-btn-secondary border text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <ShieldOff className="w-3 h-3" />
                    <span>رفع مسدودیت</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeSheet === 'create_group' && (
        <form
          onSubmit={handleCreateGroup}
          className="eyvan-card rounded-2xl p-3.5 border border-[var(--eyvan-gold-border)] space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black theme-heading">ساخت گروه جدید</h3>
            <button
              type="button"
              onClick={() => setActiveSheet('none')}
              className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center theme-muted cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            maxLength={40}
            placeholder="نام گروه (مثلاً جمع حکم شبانه)..."
            className="w-full min-h-[40px] px-3.5 rounded-xl theme-input border text-xs sm:text-sm focus:outline-none focus:border-[#2CC5BE]"
          />

          {friends.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold theme-muted">
                انتخاب اعضا از دوستان:
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                {friends.map((f) => {
                  const selected = newGroupMemberIds.includes(f.userId);
                  return (
                    <button
                      key={f.userId}
                      type="button"
                      onClick={() =>
                        setNewGroupMemberIds((prev) =>
                          prev.includes(f.userId)
                            ? prev.filter((id) => id !== f.userId)
                            : [...prev, f.userId]
                        )
                      }
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold border cursor-pointer transition-colors ${
                        selected
                          ? 'bg-[#0D8A8A]/25 border-[#2CC5BE] text-[#2CC5BE]'
                          : 'theme-subcard border-[var(--eyvan-line)] theme-muted'
                      }`}
                    >
                      <span dir="ltr">{f.username}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={newGroupName.trim().length < 2 || busyKey === 'create-group'}
            className="w-full min-h-[40px] rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] text-xs font-black cursor-pointer disabled:opacity-50"
          >
            ایجاد گروه
          </button>
        </form>
      )}

      {/* 2. Compact Telegram Segmented Switcher: افراد | گروه‌ها */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 p-1 rounded-2xl theme-subcard border border-[var(--eyvan-line)] grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={() => setSegment('chats')}
            data-testid="friends-tab-chats"
            className={`min-h-[36px] rounded-xl text-xs font-black inline-flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
              segment === 'chats'
                ? 'bg-gradient-to-b from-[#163150] to-[#0E2138] text-[#F3D179] border border-[#F3D179]/35 shadow-xs'
                : 'theme-muted hover:theme-heading'
            }`}
          >
            <span>افراد</span>
            {totalDirectUnread > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#2CC5BE] text-[#06181A] text-[10px] font-black flex items-center justify-center">
                {toPersianDigits(totalDirectUnread)}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSegment('groups')}
            data-testid="friends-tab-groups"
            className={`min-h-[36px] rounded-xl text-xs font-black inline-flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
              segment === 'groups'
                ? 'bg-gradient-to-b from-[#163150] to-[#0E2138] text-[#F3D179] border border-[#F3D179]/35 shadow-xs'
                : 'theme-muted hover:theme-heading'
            }`}
          >
            <span>گروه‌ها</span>
            {groups.length > 0 && (
              <span className="text-[10px] opacity-75">
                ({toPersianDigits(groups.length)})
              </span>
            )}
          </button>
        </div>

        {segment === 'groups' && (
          <button
            type="button"
            onClick={() =>
              setActiveSheet((prev) =>
                prev === 'create_group' ? 'none' : 'create_group'
              )
            }
            data-testid="friends-new-group-btn"
            className="min-h-[44px] px-3.5 rounded-2xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] text-xs font-black inline-flex items-center gap-1 shrink-0 cursor-pointer shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>گروه جدید</span>
          </button>
        )}
      </div>

      {/* 3. Telegram Chat List: افراد */}
      {segment === 'chats' && (
        <section
          aria-label="لیست گفتگوهای خصوصی"
          className="eyvan-card rounded-2xl overflow-hidden border border-[var(--eyvan-line)] divide-y divide-[var(--eyvan-line)]"
        >
          {/* Built-in Eyvan Official Announcements Row */}
          <div
            role="button"
            tabIndex={0}
            data-testid="friend-row-eyvan-bot"
            onClick={() => setEyvanBotChatOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setEyvanBotChatOpen(true);
              }
            }}
            className="px-3.5 py-3 flex items-center gap-3 hover:bg-white/[0.04] active:bg-white/[0.07] transition-colors cursor-pointer"
          >
            <div className="relative shrink-0">
              <EyvanBotAvatar size="md" />
              <span
                aria-label="آنلاین"
                className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-[var(--eyvan-surface)] bg-[#22C55E] shadow-[0_0_6px_rgba(34,197,94,0.8)]"
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-black theme-heading truncate">
                  {EYVAN_OFFICIAL_BOT.displayName}
                </span>
                <span className="text-[10px] font-bold theme-muted shrink-0 tabular-nums">
                  {latestEyvanAnnouncement?.timeLabel ?? ''}
                </span>
              </div>

              <div className="mt-0.5 flex items-center justify-between gap-2">
                <p className="text-xs theme-muted truncate">
                  {latestEyvanAnnouncement?.body ?? 'اطلاعیه‌های رسمی ایوان'}
                </p>
                {eyvanBotUnread > 0 && (
                  <span
                    data-testid="open-chat-btn-eyvan-bot"
                    className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#2CC5BE] text-[#06181A] text-[10px] font-black flex items-center justify-center shrink-0"
                  >
                    {toPersianDigits(eyvanBotUnread)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Loading State */}
          {initialLoading ? (
            <div className="py-10 flex items-center justify-center gap-2 theme-muted text-xs font-bold">
              <Loader2 className="w-4 h-4 animate-spin theme-accent-teal" />
              <span>در حال بارگذاری گفتگوها...</span>
            </div>
          ) : unifiedChats.length === 0 ? (
            <div className="py-10 px-4 text-center space-y-1.5">
              <p className="text-xs font-extrabold theme-heading">
                هنوز دوستی اضافه نکرده‌اید
              </p>
              <p className="text-[11px] theme-muted">
                از کادر جستجوی بالا نام کاربری یا ID دوستان خود را جستجو و اضافه کنید.
              </p>
            </div>
          ) : (
            unifiedChats.map((row) => {
              const isOnline = row.onlineStatus === 'online';
              const menuOpen = menuOpenUserId === row.userId;

              return (
                <div
                  key={row.userId}
                  data-testid={`friend-row-${row.userId}`}
                  className="relative px-3.5 py-3 flex items-center gap-3 hover:bg-white/[0.04] active:bg-white/[0.07] transition-colors"
                >
                  {/* Clickable Avatar -> Public Profile */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onInspectPlayer?.(row.userId);
                    }}
                    aria-label={`پروفایل ${row.username}`}
                    className="relative shrink-0 cursor-pointer"
                  >
                    <FramedPlayerAvatar
                      avatarCode={toValidAvatarCode(row.avatarCode)}
                      username={row.username}
                      avatarFrameId={row.appearance?.avatarFrameId}
                      size="md"
                    />
                    {isOnline && (
                      <span
                        data-testid={`friend-online-dot-${row.userId}`}
                        aria-label="آنلاین"
                        className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-[var(--eyvan-surface)] bg-[#22C55E] shadow-[0_0_6px_rgba(34,197,94,0.85)]"
                      />
                    )}
                  </button>

                  {/* Main Row Body -> Opens Full-Screen Telegram Chat */}
                  <button
                    type="button"
                    disabled={busyKey === `chat:${row.userId}`}
                    onClick={() => void handleOpenDirectChat(row.userId)}
                    data-testid={`open-chat-btn-${row.userId}`}
                    className="min-w-0 flex-1 text-right cursor-pointer disabled:opacity-60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          dir="ltr"
                          className="text-sm font-black theme-heading truncate"
                        >
                          {row.username}
                        </span>
                        <PlayerBadgeInline badgeId={row.appearance?.badgeId} />
                      </div>

                      <span className="text-[10px] font-bold theme-muted shrink-0 tabular-nums">
                        {formatTelegramTime(row.lastMessageAt)}
                      </span>
                    </div>

                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <p className="text-xs theme-muted truncate">
                        {row.lastMessagePreview
                          ? row.lastMessagePreview
                          : isOnline
                            ? 'آنلاین — برای گفتگو لمس کنید'
                            : 'گفتگو را شروع کنید...'}
                      </p>

                      {row.unreadCount > 0 && (
                        <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#2CC5BE] text-[#06181A] text-[10px] font-black flex items-center justify-center shrink-0 tabular-nums">
                          {toPersianDigits(row.unreadCount)}
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Minimal More Menu */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenUserId((prev) =>
                        prev === row.userId ? null : row.userId
                      );
                    }}
                    aria-label="گزینه‌ها"
                    className="w-8 h-8 rounded-full hover:bg-white/8 flex items-center justify-center theme-muted shrink-0 cursor-pointer"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>

                  {menuOpen && (
                    <div className="absolute left-3 top-12 z-30 min-w-[155px] eyvan-card rounded-xl border border-[var(--eyvan-gold-border)] shadow-xl overflow-hidden divide-y divide-[var(--eyvan-line)]">
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpenUserId(null);
                          onInspectPlayer?.(row.userId);
                        }}
                        className="w-full px-3 py-2.5 text-right text-xs font-bold theme-heading hover:bg-white/5 flex items-center gap-2 cursor-pointer"
                      >
                        <Users className="w-3.5 h-3.5 theme-accent-teal" />
                        <span>مشاهده پروفایل</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRemoveFriend(row.userId, row.username)}
                        className="w-full px-3 py-2.5 text-right text-xs font-bold text-amber-300 hover:bg-white/5 flex items-center gap-2 cursor-pointer"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                        <span>حذف از دوستان</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleBlockUser(row.userId, row.username)}
                        className="w-full px-3 py-2.5 text-right text-xs font-bold text-red-400 hover:bg-white/5 flex items-center gap-2 cursor-pointer"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        <span>مسدود کردن</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>
      )}

      {/* 4. Telegram Chat List: گروه‌ها */}
      {segment === 'groups' && (
        <section
          aria-label="لیست گروه‌های دوستان"
          className="eyvan-card rounded-2xl overflow-hidden border border-[var(--eyvan-line)] divide-y divide-[var(--eyvan-line)]"
        >
          {initialLoading ? (
            <div className="py-10 flex items-center justify-center gap-2 theme-muted text-xs font-bold">
              <Loader2 className="w-4 h-4 animate-spin theme-accent-teal" />
              <span>در حال بارگذاری گروه‌ها...</span>
            </div>
          ) : groups.length === 0 ? (
            <div className="py-12 px-4 text-center space-y-2.5">
              <div className="w-12 h-12 mx-auto rounded-full theme-subcard border border-[var(--eyvan-line)] flex items-center justify-center">
                <Users className="w-5 h-5 theme-accent-gold" />
              </div>
              <p className="text-xs font-extrabold theme-heading">
                هنوز عضوی از هیچ گروهی نیستید
              </p>
              <p className="text-[11px] theme-muted">
                برای گفتگوی جمعی و دعوت سریع دوستان به بازی حکم ۴ نفره، یک گروه بسازید.
              </p>
              <button
                type="button"
                onClick={() => setActiveSheet('create_group')}
                className="min-h-[38px] px-4 rounded-full bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] text-xs font-black inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>ساخت اولین گروه</span>
              </button>
            </div>
          ) : (
            groups.map((group) => (
              <button
                key={group.groupId}
                type="button"
                onClick={() => setSelectedGroupId(group.groupId)}
                data-testid={`group-row-${group.groupId}`}
                className="w-full px-3.5 py-3 flex items-center gap-3 hover:bg-white/[0.04] active:bg-white/[0.07] transition-colors text-right cursor-pointer"
              >
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#0D8A8A]/30 to-[#C89B3C]/30 border border-[#2CC5BE]/40 flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5 theme-accent-gold" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-black theme-heading truncate">
                      {group.name}
                    </span>
                    <span className="text-[10px] font-bold theme-muted shrink-0 tabular-nums">
                      {formatTelegramTime(group.lastMessageAt ?? group.createdAt)}
                    </span>
                  </div>

                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <p className="text-xs theme-muted truncate">
                      {group.lastMessagePreview
                        ? group.lastMessagePreview
                        : `${toPersianDigits(group.memberCount)} عضو — برای گفتگو لمس کنید`}
                    </p>
                    <span className="px-2 py-0.5 rounded-full theme-subcard text-[10px] font-bold theme-muted shrink-0">
                      {toPersianDigits(group.memberCount)} نفر
                    </span>
                  </div>
                </div>
              </button>
            ))
          )}
        </section>
      )}
    </div>
  );
};
