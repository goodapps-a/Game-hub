import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock,
  Gift,
  Layers,
  Loader2,
  MessageCircle,
  ShieldOff,
  Sparkles,
  Trophy,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import {
  PublicUserProfileData,
  fetchPublicUserProfileRequest,
} from '../../items/inventoryClient';
import { getItemKindLabelFa } from '../../items/itemCatalog';
import {
  acceptFriendRequestApi,
  blockUserApi,
  openDirectConversationApi,
  sendFriendRequestApi,
  unblockUserApi,
} from '../../social/socialClient';
import { toPersianDigits } from '../../theme/tokens';
import { UserProfile } from '../../types/platform';
import {
  FramedPlayerAvatar,
  PlayerBadgeInline,
  PlayerBannerStage,
} from './PlayerAppearanceParts';

interface PublicPlayerProfileModalProps {
  targetUserId: string | null;
  currentUserId?: string | null;
  isAuthenticated?: boolean;
  onClose: () => void;
  onOpenGiftShop?: (targetUsername: string, targetAccountCode?: string | null) => void;
  onOpenDirectChat?: (targetUserId: string) => void;
  onRequireAuth?: () => void;
  onRelationshipChanged?: () => void;
}

function toValidAvatarCode(code?: string | null): UserProfile['avatarCode'] {
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

function formatAccountAgeDays(createdAt?: number): string {
  if (!createdAt || !Number.isFinite(createdAt)) return 'جدید';
  const days = Math.max(1, Math.floor((Date.now() - createdAt) / (1000 * 60 * 60 * 24)));
  return `${toPersianDigits(days)} روز`;
}

/**
 * Shared Public Player Profile Modal (Screenshot 3):
 * - Opens as a crisp compact floating profile card for any other player.
 * - Expands into a full profile & stats sheet (Bio, Collection, Game Stats) on tap.
 * - Wires real Gift, Chat, Friend Request / Accept, and Block / Unblock actions.
 */
export const PublicPlayerProfileModal: React.FC<PublicPlayerProfileModalProps> = ({
  targetUserId,
  currentUserId = null,
  isAuthenticated = false,
  onClose,
  onOpenGiftShop,
  onOpenDirectChat,
  onRequireAuth,
  onRelationshipChanged,
}) => {
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<PublicUserProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);

  const loadProfile = useCallback(async (uid: string) => {
    setLoading(true);
    setError(null);
    setActionFeedback(null);
    setConfirmBlock(false);
    try {
      const res = await fetchPublicUserProfileRequest(uid);
      if (res.ok && res.profile) {
        setProfile(res.profile);
      } else {
        setProfile(null);
        setError(res.message ?? 'پروفایل این بازیکن در دسترس نیست.');
      }
    } catch {
      setProfile(null);
      setError('خطا در دریافت پروفایل بازیکن.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!targetUserId) {
      setProfile(null);
      setError(null);
      setExpanded(false);
      setConfirmBlock(false);
      setActionFeedback(null);
      return;
    }
    setExpanded(false);
    void loadProfile(targetUserId);
  }, [targetUserId, loadProfile]);

  useEffect(() => {
    if (!targetUserId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (expanded) setExpanded(false);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded, onClose, targetUserId]);

  if (!targetUserId) return null;

  const isSelf =
    Boolean(currentUserId && profile?.userId === currentUserId) ||
    profile?.viewerRelationship === 'self';
  const rel = profile?.viewerRelationship ?? 'none';

  const handleFriendAction = async () => {
    if (!profile || actionBusy) return;
    if (!isAuthenticated) {
      onRequireAuth?.();
      return;
    }
    setActionBusy('friend');
    setActionFeedback(null);
    try {
      if (rel === 'pending_incoming' && profile.friendshipId) {
        const res = await acceptFriendRequestApi(profile.friendshipId);
        if (res.ok) {
          setProfile((prev) =>
            prev ? { ...prev, viewerRelationship: 'friend' } : prev
          );
          setActionFeedback({ type: 'success', text: 'درخواست دوستی پذیرفته شد.' });
          onRelationshipChanged?.();
        } else {
          setActionFeedback({
            type: 'error',
            text: res.message ?? 'پذیرش درخواست انجام نشد.',
          });
        }
      } else if (rel === 'none') {
        const res = await sendFriendRequestApi(profile.userId);
        if (res.ok) {
          setProfile((prev) =>
            prev ? { ...prev, viewerRelationship: 'pending_outgoing' } : prev
          );
          setActionFeedback({ type: 'success', text: 'درخواست دوستی ارسال شد.' });
          onRelationshipChanged?.();
        } else {
          setActionFeedback({
            type: 'error',
            text: res.message ?? 'ارسال درخواست دوستی انجام نشد.',
          });
        }
      }
    } catch {
      setActionFeedback({ type: 'error', text: 'خطا در ارتباط با سرور.' });
    } finally {
      setActionBusy(null);
    }
  };

  const handleChatAction = async () => {
    if (!profile || actionBusy) return;
    if (!isAuthenticated) {
      onRequireAuth?.();
      return;
    }
    setActionBusy('chat');
    setActionFeedback(null);
    try {
      const res = await openDirectConversationApi(profile.userId);
      if (res.ok) {
        onClose();
        onOpenDirectChat?.(profile.userId);
      } else {
        setActionFeedback({
          type: 'error',
          text:
            res.message ??
            'برای گفتگوی خصوصی ابتدا باید با این بازیکن دوست باشید.',
        });
      }
    } catch {
      setActionFeedback({ type: 'error', text: 'باز کردن گفتگو با خطا مواجه شد.' });
    } finally {
      setActionBusy(null);
    }
  };

  const isBlockedByMe = rel === 'blocked_by_me';
  const isBlockedAny = rel === 'blocked_by_me' || rel === 'blocked_by_other';

  const handleBlockToggle = async () => {
    if (!profile || actionBusy) return;
    if (!isAuthenticated) {
      onRequireAuth?.();
      return;
    }
    if (!isBlockedByMe && !confirmBlock) {
      setConfirmBlock(true);
      return;
    }
    setActionBusy('block');
    setActionFeedback(null);
    try {
      if (isBlockedByMe) {
        const res = await unblockUserApi(profile.userId);
        if (res.ok) {
          setProfile((prev) =>
            prev ? { ...prev, viewerRelationship: 'none' } : prev
          );
          setConfirmBlock(false);
          setActionFeedback({ type: 'success', text: 'رفع مسدودیت انجام شد.' });
          onRelationshipChanged?.();
        } else {
          setActionFeedback({
            type: 'error',
            text: res.message ?? 'رفع مسدودیت انجام نشد.',
          });
        }
      } else {
        const res = await blockUserApi(profile.userId);
        if (res.ok) {
          setProfile((prev) =>
            prev ? { ...prev, viewerRelationship: 'blocked_by_me' } : prev
          );
          setConfirmBlock(false);
          setActionFeedback({ type: 'success', text: 'کاربر مسدود شد.' });
          onRelationshipChanged?.();
        } else {
          setActionFeedback({
            type: 'error',
            text: res.message ?? 'مسدود کردن کاربر انجام نشد.',
          });
        }
      }
    } catch {
      setActionFeedback({ type: 'error', text: 'خطا در ارتباط با سرور.' });
    } finally {
      setActionBusy(null);
    }
  };

  const handleGiftAction = () => {
    if (!profile) return;
    if (!isAuthenticated) {
      onRequireAuth?.();
      return;
    }
    onClose();
    onOpenGiftShop?.(profile.username, profile.accountCode);
  };

  const gameStatsList =
    profile?.gameStats && profile.gameStats.length > 0
      ? profile.gameStats
      : [
          {
            gameId: 'hokm' as const,
            name: 'حکم',
            matchesPlayed: profile?.stats.matchesPlayed ?? 0,
            wins: profile?.stats.wins ?? 0,
            losses: profile?.stats.losses ?? 0,
            kotWins: profile?.stats.kotWins ?? 0,
            hakemKotWins: profile?.stats.hakemKotWins ?? 0,
          },
        ];

  const hokmStat = gameStatsList[0];
  const hokmWinRatePct =
    hokmStat.matchesPlayed > 0
      ? Math.round((hokmStat.wins / hokmStat.matchesPlayed) * 100)
      : 0;

  const equippedPublicIds = new Set<string>(
    [
      profile?.appearance.bannerItemId,
      profile?.appearance.avatarFrameId,
      profile?.appearance.badgeId,
      profile?.appearance.cardBackId,
      profile?.appearance.nameplateId,
      profile?.appearance.gameEffectId,
    ].filter((id): id is string => Boolean(id))
  );

  const scoreValue =
    1000 +
    (profile?.stats.wins ?? 0) * 25 +
    (profile?.stats.kotWins ?? 0) * 15 +
    (profile?.stats.hakemKotWins ?? 0) * 30;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="پروفایل عمومی بازیکن"
      data-testid="public-profile-modal"
      data-expanded={expanded ? 'true' : 'false'}
      className="fixed inset-0 z-[75] flex items-center justify-center p-3.5 sm:p-5 bg-black/72 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full rounded-[24px] theme-drawer border border-[var(--eyvan-gold-border)] shadow-[0_24px_68px_rgba(0,0,0,0.62)] overflow-hidden flex flex-col transition-all ${
          expanded ? 'max-w-[440px] max-h-[88dvh]' : 'max-w-[360px] max-h-[86dvh]'
        }`}
      >
        {loading ? (
          <div className="p-10 flex items-center justify-center gap-2 text-xs font-bold theme-muted">
            <Loader2 className="w-4 h-4 animate-spin theme-accent-teal" />
            <span>در حال دریافت پروفایل بازیکن...</span>
          </div>
        ) : error || !profile ? (
          <div className="p-6 text-center space-y-3">
            <p className="text-xs font-bold theme-loss">
              {error ?? 'پروفایل بازیکن یافت نشد.'}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[38px] px-5 rounded-xl theme-btn-secondary border text-xs font-bold cursor-pointer"
            >
              بستن
            </button>
          </div>
        ) : (
          <>
            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {/* Banner Header with Close / Back Button */}
              <div className="relative h-28 sm:h-32 w-full overflow-hidden">
                <PlayerBannerStage
                  bannerItemIdOrCode={
                    profile.appearance.bannerItemId ??
                    profile.appearance.bannerCode
                  }
                  emptyText=""
                />
                <div
                  className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/15"
                  aria-hidden="true"
                />

                {expanded && (
                  <button
                    type="button"
                    data-testid="public-profile-collapse-btn"
                    onClick={() => setExpanded(false)}
                    aria-label="بازگشت به نمای خلاصه"
                    className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center cursor-pointer transition-colors"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}

                <button
                  type="button"
                  data-testid="public-profile-close-btn"
                  onClick={onClose}
                  aria-label="بستن پروفایل"
                  className="absolute top-3 left-3 w-8 h-8 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center cursor-pointer transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Overlapping Circular Avatar + Dead-Centered Username + Bio */}
              <div className="px-5 pb-4 -mt-10 flex flex-col items-center text-center">
                <div className="rounded-full ring-4 ring-[var(--eyvan-modal-bg)] shadow-[0_10px_24px_rgba(0,0,0,0.4)]">
                  <FramedPlayerAvatar
                    avatarCode={toValidAvatarCode(profile.avatarCode)}
                    username={profile.username}
                    customAvatarUrl={profile.avatarUrl}
                    avatarFrameId={profile.appearance.avatarFrameId}
                    size="lg"
                  />
                </div>

                <div className="mt-2.5 flex items-center justify-center gap-1.5 max-w-full">
                  <PlayerBadgeInline badgeId={profile.appearance.badgeId} />
                  <h3
                    dir="ltr"
                    data-testid="public-profile-username"
                    className="text-lg font-black theme-heading truncate"
                  >
                    {profile.username}
                  </h3>
                </div>

                {profile.accountCode && (
                  <span
                    dir="ltr"
                    data-testid="public-profile-account-code"
                    className="text-[11px] font-mono font-bold theme-muted tabular-nums mt-0.5"
                  >
                    #{profile.accountCode}
                  </span>
                )}

                {profile.bio && (
                  <p
                    data-testid="public-profile-bio"
                    className="mt-2 text-xs theme-text/85 leading-relaxed max-w-[300px]"
                  >
                    {profile.bio}
                  </p>
                )}

                {/* 3-Column Stats Row with Vertical Dividers (Wins | Age | Score) */}
                <div className="mt-4 w-full grid grid-cols-3 divide-x divide-x-reverse divide-[var(--eyvan-line)] text-center py-1">
                  <div className="px-1.5">
                    <div className="text-[10px] font-bold theme-muted">برد</div>
                    <div className="text-base font-black theme-heading mt-0.5 tabular-nums">
                      {toPersianDigits(profile.stats.wins)}
                    </div>
                  </div>
                  <div className="px-1.5">
                    <div className="text-[10px] font-bold theme-muted">سابقه</div>
                    <div className="text-base font-black theme-heading mt-0.5 tabular-nums">
                      {formatAccountAgeDays(profile.createdAt)}
                    </div>
                  </div>
                  <div className="px-1.5">
                    <div className="text-[10px] font-bold theme-muted">امتیاز</div>
                    <div className="text-base font-black theme-accent-gold mt-0.5 tabular-nums">
                      {toPersianDigits(scoreValue)}
                    </div>
                  </div>
                </div>

                {/* Featured Game Card (Screenshot 3 center banner) */}
                <div className="mt-3.5 w-full rounded-2xl theme-subcard border px-4 py-3 flex items-center justify-between gap-3 text-right">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-[#0D8A8A]/16 border border-[#0D8A8A]/35 flex items-center justify-center shrink-0">
                      <Trophy className="w-5 h-5 theme-accent-gold" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-black theme-heading truncate">
                        {hokmStat.name}
                      </div>
                      <div className="text-[11px] font-bold theme-muted tabular-nums">
                        سطح {toPersianDigits(profile.level)} ·{' '}
                        {toPersianDigits(hokmStat.matchesPlayed)} بازی
                      </div>
                    </div>
                  </div>
                  <div className="text-xs font-black theme-accent-teal tabular-nums shrink-0">
                    {toPersianDigits(hokmWinRatePct)}٪ برد
                  </div>
                </div>

                {/* Expand to Full Profile & Stats Button (Compact View Only) */}
                {!expanded && (
                  <button
                    type="button"
                    data-testid="public-profile-expand-btn"
                    onClick={() => setExpanded(true)}
                    className="mt-3 w-full min-h-[40px] rounded-xl border border-[#38BDF8]/40 hover:border-[#38BDF8]/75 text-[#38BDF8] text-xs font-extrabold tracking-wide cursor-pointer transition-colors"
                  >
                    مشاهده پروفایل کامل و آمار
                  </button>
                )}

                {/* Expanded Full Profile Details: Collection + Detailed Game Stats */}
                {expanded && (
                  <div className="mt-4 w-full space-y-4 text-right">
                    {/* Public Collection (Owner-only skins excluded server-side) */}
                    <section
                      data-testid="public-profile-collection"
                      className="rounded-2xl theme-subcard border p-3.5 space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <Layers className="w-4 h-4 theme-accent-teal" />
                          <h4 className="text-xs font-black theme-heading">
                            کلکسیون عمومی
                          </h4>
                        </div>
                        <span className="text-[11px] font-bold theme-muted tabular-nums">
                          {toPersianDigits(profile.collection?.length ?? 0)} آیتم
                        </span>
                      </div>

                      {!profile.collection || profile.collection.length === 0 ? (
                        <p className="text-xs theme-muted">
                          آیتم عمومی‌ای برای نمایش ثبت نشده است.
                        </p>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {profile.collection.slice(0, 8).map((item) => {
                            const isEquipped = equippedPublicIds.has(item.itemId);
                            return (
                              <div
                                key={item.itemId}
                                className={`rounded-xl border p-2 flex items-center gap-2 ${
                                  isEquipped
                                    ? 'border-[#0D8A8A]/55 bg-[#0D8A8A]/8'
                                    : 'border-[var(--eyvan-line)]'
                                }`}
                              >
                                <div className="w-7 h-7 rounded-lg bg-[#0D8A8A]/18 flex items-center justify-center shrink-0">
                                  <Sparkles className="w-3.5 h-3.5 theme-accent-gold" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-[11px] font-extrabold theme-heading truncate">
                                    {item.name}
                                  </div>
                                  <div className="text-[10px] theme-muted truncate">
                                    {getItemKindLabelFa(item.kind)}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>

                    {/* Detailed Game Stats */}
                    <section
                      data-testid="public-profile-game-stats"
                      className="rounded-2xl theme-subcard border p-3.5 space-y-2.5"
                    >
                      <div className="flex items-center gap-1.5">
                        <Trophy className="w-4 h-4 theme-accent-gold" />
                        <h4 className="text-xs font-black theme-heading">
                          آمار بازی‌ها
                        </h4>
                      </div>
                      {gameStatsList.map((gs) => {
                        const winRatePct =
                          gs.matchesPlayed > 0
                            ? Math.round((gs.wins / gs.matchesPlayed) * 100)
                            : 0;
                        return (
                          <div
                            key={gs.gameId}
                            className="rounded-xl border border-[var(--eyvan-line)] p-3 space-y-2"
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-black theme-heading">
                                {gs.name}
                              </span>
                              <span className="font-extrabold theme-accent-teal tabular-nums">
                                {toPersianDigits(winRatePct)}٪ نرخ برد
                              </span>
                            </div>
                            <div className="h-2 rounded-full theme-bar-track overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gradient-to-l from-[#14B8A6] to-[#0D8A8A]"
                                style={{ width: `${winRatePct}%` }}
                              />
                            </div>
                            <div className="flex items-center justify-between text-[11px] theme-muted tabular-nums">
                              <span>کل بازی: {toPersianDigits(gs.matchesPlayed)}</span>
                              <span className="theme-win font-bold">
                                برد: {toPersianDigits(gs.wins)}
                              </span>
                              <span className="theme-loss font-bold">
                                باخت: {toPersianDigits(gs.losses)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </section>
                  </div>
                )}

                {/* Inline Block Confirmation (no window.confirm) */}
                {confirmBlock && !isSelf && (
                  <div className="mt-3 w-full rounded-xl bg-[#DC2626]/12 border border-[#DC2626]/40 p-3 text-right space-y-2">
                    <p className="text-xs font-bold theme-loss">
                      آیا مطمئن هستید می‌خواهید {profile.username} را مسدود کنید؟
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={actionBusy === 'block'}
                        onClick={() => void handleBlockToggle()}
                        className="flex-1 min-h-[34px] rounded-lg bg-[#DC2626] text-white text-xs font-extrabold cursor-pointer"
                      >
                        تأیید مسدودیت
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmBlock(false)}
                        className="flex-1 min-h-[34px] rounded-lg theme-btn-secondary border text-xs font-bold cursor-pointer"
                      >
                        انصراف
                      </button>
                    </div>
                  </div>
                )}

                {actionFeedback && (
                  <div
                    role="status"
                    className={`mt-2.5 w-full rounded-xl px-3 py-2 text-xs font-bold ${
                      actionFeedback.type === 'success'
                        ? 'bg-[#0D8A8A]/14 border border-[#0D8A8A]/40 theme-win'
                        : 'bg-[#DC2626]/12 border border-[#DC2626]/40 theme-loss'
                    }`}
                  >
                    {actionFeedback.text}
                  </div>
                )}
              </div>
            </div>

            {/* Bottom 4-Button Action Bar (Screenshot 3: Gift | Chat | +Friend | Block) */}
            {!isSelf && (
              <footer className="px-4 py-3 border-t border-[var(--eyvan-line)] flex items-center gap-2 shrink-0">
                {/* 1. Purple Gift Button */}
                <button
                  type="button"
                  data-testid="public-profile-gift-btn"
                  onClick={handleGiftAction}
                  aria-label="ارسال هدیه از فروشگاه"
                  title="ارسال هدیه"
                  className="w-11 h-11 rounded-xl bg-[#9333EA] hover:bg-[#A855F7] text-white flex items-center justify-center shrink-0 cursor-pointer transition-colors"
                >
                  <Gift className="w-5 h-5" />
                </button>

                {/* 2. Teal Chat Button */}
                <button
                  type="button"
                  data-testid="public-profile-chat-btn"
                  disabled={actionBusy === 'chat' || isBlockedAny}
                  onClick={() => void handleChatAction()}
                  aria-label="گفتگوی خصوصی"
                  title="پیام خصوصی"
                  className="w-11 h-11 rounded-xl bg-[#0EA5E9] hover:bg-[#38BDF8] disabled:opacity-45 text-white flex items-center justify-center shrink-0 cursor-pointer transition-colors"
                >
                  {actionBusy === 'chat' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <MessageCircle className="w-5 h-5" />
                  )}
                </button>

                {/* 3. Primary Blue +Friend / Relationship Button */}
                <button
                  type="button"
                  data-testid="public-profile-friend-btn"
                  disabled={
                    actionBusy === 'friend' ||
                    rel === 'friend' ||
                    rel === 'pending_outgoing' ||
                    isBlockedAny
                  }
                  onClick={() => void handleFriendAction()}
                  className={`flex-1 h-11 px-3 rounded-xl text-xs sm:text-sm font-black inline-flex items-center justify-center gap-1.5 transition-colors ${
                    rel === 'friend'
                      ? 'bg-[#0D8A8A]/20 border border-[#0D8A8A]/45 theme-accent-teal cursor-default'
                      : rel === 'pending_outgoing'
                        ? 'theme-subcard border theme-muted cursor-default'
                        : 'bg-[#2563EB] hover:bg-[#3B82F6] text-white cursor-pointer disabled:opacity-50'
                  }`}
                >
                  {actionBusy === 'friend' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : rel === 'friend' ? (
                    <>
                      <UserCheck className="w-4 h-4 shrink-0" />
                      <span>دوست شما</span>
                    </>
                  ) : rel === 'pending_outgoing' ? (
                    <>
                      <Clock className="w-4 h-4 shrink-0" />
                      <span>در انتظار تأیید</span>
                    </>
                  ) : rel === 'pending_incoming' ? (
                    <>
                      <Check className="w-4 h-4 shrink-0" />
                      <span>پذیرش دوستی</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4 shrink-0" />
                      <span>دوستی</span>
                    </>
                  )}
                </button>

                {/* 4. Outlined Warning / Block Button */}
                <button
                  type="button"
                  data-testid="public-profile-block-btn"
                  disabled={actionBusy === 'block'}
                  onClick={() => void handleBlockToggle()}
                  aria-label={isBlockedByMe ? 'رفع مسدودیت' : 'مسدود کردن بازیکن'}
                  title={isBlockedByMe ? 'رفع مسدودیت' : 'مسدود کردن'}
                  className={`w-11 h-11 rounded-xl border flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
                    isBlockedByMe
                      ? 'border-[#0D8A8A]/55 text-[#14B8A6] hover:bg-[#0D8A8A]/12'
                      : 'border-[#DC2626]/55 text-[#EF4444] hover:bg-[#DC2626]/12'
                  }`}
                >
                  {actionBusy === 'block' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isBlockedByMe ? (
                    <ShieldOff className="w-5 h-5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5" />
                  )}
                </button>
              </footer>
            )}
          </>
        )}
      </div>
    </div>
  );
};
