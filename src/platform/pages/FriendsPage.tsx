import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCheck,
  Copy,
  Gamepad2,
  Link2,
  Plus,
  Send,
  User,
  Users,
  X,
} from 'lucide-react';
import {
  ChatGroupDemo,
  ChatMessage,
  FriendDemo,
} from '../types/platform';
import { toPersianDigits } from '../theme/tokens';

interface FriendsPageProps {
  currentUsername: string;
  onInviteToHokm: () => void;
  onChatModeChange?: (inChat: boolean) => void;
}

type FriendsTab = 'people' | 'groups';

type ActiveChatTarget =
  | { type: 'direct'; id: string }
  | { type: 'group'; id: string }
  | null;

function formatCurrentTimeFa(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return toPersianDigits(`${hh}:${mm}`);
}

export const FriendsPage: React.FC<FriendsPageProps> = ({
  currentUsername,
  onInviteToHokm,
  onChatModeChange,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<FriendsTab>('people');
  const [friends, setFriends] = useState<FriendDemo[]>([]);
  const [groups, setGroups] = useState<ChatGroupDemo[]>([]);
  const [directChats, setDirectChats] = useState<Record<string, ChatMessage[]>>(
    {}
  );
  const [groupChats, setGroupChats] = useState<Record<string, ChatMessage[]>>(
    {}
  );
  const [activeChat, setActiveChat] = useState<ActiveChatTarget>(null);
  const [draftMessage, setDraftMessage] = useState('');
  const [copiedInvite, setCopiedInvite] = useState(false);

  // Local create-group modal state
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const inviteLink = `${origin}/?invite=${encodeURIComponent(currentUsername)}`;

  // Inform App when entering/leaving chat room so mobile BottomNav hides inside chat
  useEffect(() => {
    onChatModeChange?.(Boolean(activeChat));
  }, [activeChat, onChatModeChange]);

  useEffect(() => {
    return () => {
      onChatModeChange?.(false);
    };
  }, [onChatModeChange]);

  const handleCopyInviteLink = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(inviteLink);
      } else {
        const ta = document.createElement('textarea');
        ta.value = inviteLink;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch {
      // Visual confirmation still shown for local prototype
    }
    setCopiedInvite(true);
    window.setTimeout(() => setCopiedInvite(false), 2200);
  };

  const handleOpenDirectChat = (friendId: string) => {
    setFriends((prev) =>
      prev.map((f) => (f.id === friendId ? { ...f, unreadCount: 0 } : f))
    );
    setActiveChat({ type: 'direct', id: friendId });
  };

  const handleOpenGroupChat = (groupId: string) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, unreadCount: 0 } : g))
    );
    setActiveChat({ type: 'group', id: groupId });
  };

  const handleSendMessage = (customText?: string, isGameInvite = false) => {
    if (!activeChat) return;
    const text = (customText ?? draftMessage).trim();
    if (!text) return;

    const nowTime = formatCurrentTimeFa();
    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: currentUsername,
      text,
      time: nowTime,
      isMe: true,
      isGameInvite,
    };

    if (activeChat.type === 'direct') {
      setDirectChats((prev) => ({
        ...prev,
        [activeChat.id]: [...(prev[activeChat.id] ?? []), newMsg],
      }));
      setFriends((prev) =>
        prev.map((f) =>
          f.id === activeChat.id
            ? { ...f, lastMessage: text, lastMessageTime: 'هم‌اکنون' }
            : f
        )
      );
    } else {
      setGroupChats((prev) => ({
        ...prev,
        [activeChat.id]: [...(prev[activeChat.id] ?? []), newMsg],
      }));
      setGroups((prev) =>
        prev.map((g) =>
          g.id === activeChat.id
            ? {
                ...g,
                lastMessage: `${currentUsername}: ${text}`,
                lastMessageTime: 'هم‌اکنون',
              }
            : g
        )
      );
    }

    if (!customText) setDraftMessage('');
    window.setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 30);
  };

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newGroupName.trim();
    if (!trimmed) return;

    const newId = `g-${Date.now()}`;
    const members = [currentUsername, ...selectedMembers];
    const created: ChatGroupDemo = {
      id: newId,
      name: trimmed,
      members,
      onlineCount: Math.max(1, members.length - 1),
      accentColor: '#0D8A8A',
      lastMessage: `${currentUsername}: گروه ساخته شد`,
      lastMessageTime: 'هم‌اکنون',
      unreadCount: 0,
    };

    setGroups((prev) => [created, ...prev]);
    setGroupChats((prev) => ({
      ...prev,
      [newId]: [
        {
          id: `gm-init-${Date.now()}`,
          sender: currentUsername,
          text: 'سلام بچه‌ها! گروه جدید ساخته شد، آماده حکم هستید؟',
          time: formatCurrentTimeFa(),
          isMe: true,
        },
      ],
    }));
    setNewGroupName('');
    setIsCreatingGroup(false);
    setActiveChat({ type: 'group', id: newId });
  };

  const activeFriend = useMemo(
    () =>
      activeChat?.type === 'direct'
        ? friends.find((f) => f.id === activeChat.id) ?? null
        : null,
    [activeChat, friends]
  );

  const activeGroup = useMemo(
    () =>
      activeChat?.type === 'group'
        ? groups.find((g) => g.id === activeChat.id) ?? null
        : null,
    [activeChat, groups]
  );

  // =========================================================================
  // FULL-SCREEN TELEGRAM-STYLE CHAT ROOM (100dvh edge-to-edge, Send on RIGHT)
  // =========================================================================
  if (activeChat && (activeFriend || activeGroup)) {
    const messages =
      activeChat.type === 'direct'
        ? directChats[activeChat.id] ?? []
        : groupChats[activeChat.id] ?? [];

    return (
      <div
        className="fixed inset-0 z-40 h-[100dvh] w-full flex flex-col bg-[var(--eyvan-bg)] overflow-hidden"
        data-testid="chat-room-view"
      >
        {/* Full-Width Compact Header */}
        <header className="px-3 sm:px-5 py-2.5 border-b border-[var(--eyvan-gold-border)] flex items-center justify-between gap-2.5 theme-panel-tint backdrop-blur-md shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setActiveChat(null)}
              data-testid="chat-back-btn"
              aria-label="بازگشت به لیست دوستان"
              className="w-9 h-9 rounded-full hover:bg-black/10 theme-heading flex items-center justify-center cursor-pointer shrink-0 transition-colors"
            >
              <ArrowRight className="w-5 h-5" />
            </button>

            {activeFriend ? (
              <>
                <div className="relative shrink-0">
                  <img
                    src={activeFriend.avatarSrc}
                    alt={activeFriend.username}
                    className="w-10 h-10 rounded-full object-cover border border-[#D4AE58]/60"
                  />
                  <span
                    className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-[#0B1528] ${
                      activeFriend.status === 'online'
                        ? 'bg-[#22C55E]'
                        : 'bg-[#64748B]'
                    }`}
                  />
                </div>
                <div className="min-w-0 leading-tight">
                  <div
                    dir="ltr"
                    className="text-sm sm:text-[15px] font-extrabold theme-heading truncate text-right"
                  >
                    {activeFriend.username}
                  </div>
                  <div
                    className={`text-[11px] mt-0.5 font-semibold ${
                      activeFriend.status === 'online'
                        ? 'text-[#22C55E]'
                        : 'theme-muted'
                    }`}
                  >
                    {activeFriend.status === 'online'
                      ? 'آنلاین'
                      : 'آخرین بازدید به‌تازگی'}
                  </div>
                </div>
              </>
            ) : (
              activeGroup && (
                <>
                  <div
                    className="w-10 h-10 rounded-full border border-[#D4AE58]/55 flex items-center justify-center text-white shrink-0 shadow-xs"
                    style={{ backgroundColor: activeGroup.accentColor }}
                  >
                    <Users className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 leading-tight">
                    <div className="text-sm sm:text-[15px] font-extrabold theme-heading truncate">
                      {activeGroup.name}
                    </div>
                    <div className="text-[11px] theme-muted mt-0.5 truncate">
                      {toPersianDigits(activeGroup.members.length)} عضو ·{' '}
                      <span className="text-[#22C55E] font-semibold">
                        {toPersianDigits(activeGroup.onlineCount)} آنلاین
                      </span>
                    </div>
                  </div>
                </>
              )
            )}
          </div>

          <button
            type="button"
            onClick={() =>
              handleSendMessage('دعوت به میز بازی حکم چهارنفره ♠♥', true)
            }
            aria-label="دعوت به بازی حکم"
            className="min-h-[36px] px-3 py-1.5 rounded-full bg-gradient-to-b from-[#F3D179] to-[#C89B3C] hover:from-[#F8DD94] hover:to-[#D4AE58] text-[#0B1628] text-xs font-extrabold inline-flex items-center gap-1.5 shrink-0 cursor-pointer shadow-xs transition-all"
          >
            <Gamepad2 className="w-4 h-4" />
            <span className="hidden sm:inline">دعوت به حکم</span>
          </button>
        </header>

        {/* Telegram Patterned Chat Wallpaper + Message Stream */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 space-y-2 telegram-chat-wallpaper">
          {/* Telegram Date Divider Pill */}
          <div className="flex justify-center pb-2">
            <span className="px-3 py-0.5 rounded-full text-[11px] font-bold bg-black/28 text-white/90 backdrop-blur-xs">
              امروز
            </span>
          </div>

          {messages.map((msg) => {
            const isSent = Boolean(msg.isMe);
            return (
              <div
                key={msg.id}
                className={`flex w-full ${
                  isSent ? 'justify-start' : 'justify-end'
                }`}
              >
                <div
                  className={`relative max-w-[82%] sm:max-w-[70%] px-3.5 pt-2 pb-1.5 text-[13px] sm:text-sm leading-relaxed shadow-[0_1px_3px_rgba(0,0,0,0.22)] ${
                    isSent
                      ? 'telegram-bubble-out rounded-[18px] rounded-br-[4px]'
                      : 'telegram-bubble-in rounded-[18px] rounded-bl-[4px]'
                  }`}
                >
                  {activeChat.type === 'group' && !isSent && (
                    <div
                      dir="ltr"
                      className="text-[11px] font-extrabold text-[#38BDF8] mb-0.5 text-right"
                    >
                      {msg.sender}
                    </div>
                  )}

                  <p className="whitespace-pre-wrap break-words">{msg.text}</p>

                  {msg.isGameInvite && (
                    <button
                      type="button"
                      onClick={onInviteToHokm}
                      className="mt-2 mb-1 w-full min-h-[36px] px-3 py-1.5 rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] hover:from-[#F8DD94] text-[#0B1528] text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <Gamepad2 className="w-4 h-4" />
                      <span>ورود به میز حکم</span>
                    </button>
                  )}

                  {/* Telegram Inline Timestamp + Double Checkmark */}
                  <div
                    className={`flex items-center justify-end gap-1 mt-0.5 text-[10px] tabular-nums select-none ${
                      isSent ? 'text-white/75' : 'theme-muted'
                    }`}
                  >
                    <span>{msg.time}</span>
                    {isSent && (
                      <CheckCheck
                        className="w-3.5 h-3.5 text-[#7DD3FC]"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={chatEndRef} />
        </div>

        {/* Full-Width Composer — Send Button strictly on the physical RIGHT side (first in RTL row) */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="px-3 sm:px-5 py-2.5 pb-[max(0.65rem,env(safe-area-inset-bottom))] border-t border-[var(--eyvan-gold-border)] flex items-center gap-2 theme-panel-tint backdrop-blur-md shrink-0"
        >
          <button
            type="submit"
            disabled={!draftMessage.trim()}
            data-testid="chat-send-btn"
            aria-label="ارسال پیام"
            className="w-[42px] h-[42px] rounded-full bg-[#0D8A8A] hover:bg-[#11A3A3] disabled:opacity-40 text-white flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0 shadow-sm"
          >
            <Send className="w-4 h-4 -scale-x-100 translate-x-[1px]" />
          </button>
          <input
            type="text"
            value={draftMessage}
            onChange={(e) => setDraftMessage(e.target.value)}
            placeholder="پیام..."
            data-testid="chat-message-input"
            className="flex-1 min-h-[42px] px-4 rounded-full theme-input border text-sm focus:outline-none focus:border-[#0D8A8A]"
          />
        </form>
      </div>
    );
  }

  // =========================================================================
  // FRIENDS HUB: Slim Invite Link at TOP + Slim People/Groups Switcher BELOW
  // =========================================================================
  return (
    <div className="space-y-2.5 max-w-3xl mx-auto" data-testid="friends-page">
      {/* TOP: Slim Copy Invite Link Strip */}
      <section
        className="eyvan-card rounded-xl px-3 py-2 flex items-center justify-between gap-2.5"
        data-testid="invite-link-card"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#0D8A8A]/18 border border-[#0D8A8A]/40 flex items-center justify-center shrink-0">
            <Link2 className="w-4 h-4 theme-accent-teal" />
          </div>
          <div className="min-w-0 leading-tight">
            <div
              className="text-xs sm:text-[13px] font-extrabold theme-heading truncate"
              data-testid="invite-link-title"
            >
              لینک دعوت به دوستی
            </div>
            <div
              dir="ltr"
              className="text-[11px] theme-muted truncate text-right font-mono mt-0.5"
            >
              {inviteLink}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleCopyInviteLink}
          data-testid="copy-invite-link-btn"
          className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-extrabold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer shrink-0 whitespace-nowrap ${
            copiedInvite
              ? 'bg-[#107C41] text-white'
              : 'bg-gradient-to-b from-[#F3D179] to-[#C89B3C] hover:from-[#F8DD94] hover:to-[#D4AE58] text-[#0B1628]'
          }`}
        >
          {copiedInvite ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>کپی شد</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>کپی لینک</span>
            </>
          )}
        </button>
      </section>

      {/* BELOW INVITE LINK: Slim 2-Tab Switcher Box (افراد | گروه) */}
      <section
        className="eyvan-card rounded-xl p-1"
        data-testid="friends-tabs-card"
      >
        <div
          role="tablist"
          aria-label="بخش‌های دوستان"
          className="grid grid-cols-2 gap-1 p-0.5 theme-tab-track rounded-lg border"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'people'}
            data-testid="friends-tab-people"
            onClick={() => setActiveSubTab('people')}
            className={`min-h-[34px] rounded-md text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeSubTab === 'people'
                ? 'bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] shadow-xs'
                : 'theme-muted'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>افراد</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'groups'}
            data-testid="friends-tab-groups"
            onClick={() => setActiveSubTab('groups')}
            className={`min-h-[34px] rounded-md text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeSubTab === 'groups'
                ? 'bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] shadow-xs'
                : 'theme-muted'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>گروه</span>
          </button>
        </div>
      </section>

      {/* TAB 1: افراد — Friends List */}
      {activeSubTab === 'people' && (
        <div>
          {/* Friends Chat List (Every friend has a cohesive portrait avatar) */}
          <section className="eyvan-card rounded-2xl overflow-hidden divide-y divide-[var(--eyvan-gold-border)]">
            {friends.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs sm:text-sm theme-muted">
                هنوز دوستی اضافه نشده است.
              </div>
            ) : (
              friends.map((friend) => (
                <button
                  key={friend.id}
                  type="button"
                  onClick={() => handleOpenDirectChat(friend.id)}
                  data-friend-chat={friend.username}
                  className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-black/5 transition-colors text-right cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative shrink-0">
                      <img
                        src={friend.avatarSrc}
                        alt={friend.username}
                        decoding="sync"
                        loading="eager"
                        className="w-11 h-11 rounded-full object-cover border-2 border-[#D4AE58]/55"
                      />
                      <span
                        className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#0B1528] ${
                          friend.status === 'online'
                            ? 'bg-[#22C55E]'
                            : 'bg-[#64748B]'
                        }`}
                      />
                    </div>

                    <div className="min-w-0">
                      <div
                        dir="ltr"
                        className="text-sm font-extrabold theme-heading truncate text-right"
                      >
                        {friend.username}
                      </div>
                      <div className="text-xs theme-muted truncate mt-0.5">
                        {friend.lastMessage}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="text-[10px] theme-muted whitespace-nowrap">
                      {friend.lastMessageTime}
                    </span>
                    {friend.unreadCount > 0 && (
                      <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#0D8A8A] text-white text-[10px] font-extrabold flex items-center justify-center tabular-nums">
                        {toPersianDigits(friend.unreadCount)}
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </section>
        </div>
      )}

      {/* TAB 2: گروه — Groups List + Create New Group + Click to Open Group Chat */}
      {activeSubTab === 'groups' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold theme-muted">
              گروه‌های بازی شما ({toPersianDigits(groups.length)})
            </span>
            <button
              type="button"
              onClick={() => setIsCreatingGroup((prev) => !prev)}
              data-testid="create-group-toggle-btn"
              className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer"
            >
              {isCreatingGroup ? (
                <>
                  <X className="w-3.5 h-3.5" />
                  <span>بستن</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  <span>ساخت گروه جدید</span>
                </>
              )}
            </button>
          </div>

          {isCreatingGroup && (
            <form
              onSubmit={handleCreateGroup}
              className="eyvan-card rounded-2xl p-4 space-y-3"
            >
              <div>
                <label
                  htmlFor="new-group-name"
                  className="block text-xs font-bold theme-heading mb-1.5"
                >
                  نام گروه
                </label>
                <input
                  id="new-group-name"
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="مثلاً میز حکم آخر هفته"
                  required
                  className="w-full min-h-[42px] px-3.5 rounded-xl theme-input border text-sm focus:outline-none focus:border-[#0D8A8A]"
                />
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-bold theme-heading">
                  انتخاب اعضا
                </div>
                <div dir="ltr" className="flex flex-wrap gap-1.5">
                  {friends.map((f) => {
                    const picked = selectedMembers.includes(f.username);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => {
                          setSelectedMembers((prev) =>
                            picked
                              ? prev.filter((u) => u !== f.username)
                              : [...prev, f.username]
                          );
                        }}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-colors ${
                          picked
                            ? 'bg-[#0D8A8A] text-white border-[#0D8A8A]'
                            : 'theme-subcard theme-heading'
                        }`}
                      >
                        {f.username}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="submit"
                className="w-full min-h-[42px] rounded-xl bg-[#0D8A8A] hover:bg-[#11A3A3] text-white text-sm font-extrabold cursor-pointer"
              >
                ایجاد گروه و ورود به گفتگو
              </button>
            </form>
          )}

          <section className="eyvan-card rounded-2xl overflow-hidden divide-y divide-[var(--eyvan-gold-border)]">
            {groups.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs sm:text-sm theme-muted">
                هنوز گروهی ثبت نشده است.
              </div>
            ) : (
              groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => handleOpenGroupChat(group.id)}
                  data-group-chat={group.id}
                  className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-black/5 transition-colors text-right cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-11 h-11 rounded-full border border-[#D4AE58]/50 flex items-center justify-center text-white shrink-0"
                      style={{ backgroundColor: group.accentColor }}
                    >
                      <Users className="w-5 h-5" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-extrabold theme-heading truncate">
                          {group.name}
                        </span>
                        <span className="text-[10px] theme-accent-teal font-bold whitespace-nowrap">
                          {toPersianDigits(group.members.length)} عضو
                        </span>
                      </div>
                      <div className="text-xs theme-muted truncate mt-0.5">
                        {group.lastMessage}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="text-[10px] theme-muted whitespace-nowrap">
                      {group.lastMessageTime}
                    </span>
                    {group.unreadCount > 0 && (
                      <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#0D8A8A] text-white text-[10px] font-extrabold flex items-center justify-center tabular-nums">
                        {toPersianDigits(group.unreadCount)}
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </section>
        </div>
      )}
    </div>
  );
};
