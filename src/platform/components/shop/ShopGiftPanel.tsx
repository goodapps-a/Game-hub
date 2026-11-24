import React, { useState } from 'react';
import {
  Check,
  Gift,
  Loader2,
  Search,
  Wallet,
  X,
} from 'lucide-react';
import {
  GiftLookupUserSummary,
  giftShopItemRequest,
  lookupUserForGiftRequest,
} from '../../items/inventoryClient';
import { ServerInventoryState } from '../../items/itemTypes';
import { toPersianDigits } from '../../theme/tokens';
import { UserProfile } from '../../types/platform';
import {
  FramedPlayerAvatar,
  PlayerBadgeInline,
  PlayerBannerStage,
} from '../profile/PlayerAppearanceParts';
import { GoldCoinSvg, PurpleGemSvg } from '../TopBar';

interface ShopGiftPanelProps {
  itemId: string;
  itemName: string;
  price: number;
  currency: 'coins' | 'gems';
  userCoins: number;
  userGems: number;
  shopTestMode?: boolean;
  isAuthenticated?: boolean;
  onRequireAuth?: () => void;
  onOpenTopUpShop?: () => void;
  onInventorySync?: (inventory: ServerInventoryState) => void;
  onClosePanel: () => void;
}

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

export const ShopGiftPanel: React.FC<ShopGiftPanelProps> = ({
  itemId,
  itemName,
  price,
  currency,
  userCoins,
  userGems,
  shopTestMode = false,
  isAuthenticated = false,
  onRequireAuth,
  onOpenTopUpShop,
  onInventorySync,
  onClosePanel,
}) => {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [recipient, setRecipient] = useState<GiftLookupUserSummary | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [insufficientFunds, setInsufficientFunds] = useState(false);
  const [giftSuccess, setGiftSuccess] = useState<string | null>(null);

  const effectivePrice = shopTestMode ? 0 : Math.max(0, price);
  const balance = currency === 'gems' ? userGems : userCoins;
  const currencyLabel = currency === 'gems' ? 'الماس' : 'سکه';
  const canAfford = shopTestMode || balance >= effectivePrice;

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      onRequireAuth?.();
      return;
    }
    const clean = query.trim();
    if (clean.length < 2) {
      setLookupError('نام کاربری یا شناسه ۶ رقمی دوست را وارد کنید.');
      setRecipient(null);
      return;
    }

    setSearching(true);
    setLookupError(null);
    setSendError(null);
    setInsufficientFunds(false);
    setGiftSuccess(null);

    try {
      const res = await lookupUserForGiftRequest(clean);
      if (!res.ok || !res.user) {
        setRecipient(null);
        setLookupError(res.message ?? 'کاربری با این مشخصات یافت نشد.');
        return;
      }
      setRecipient(res.user);
    } catch {
      setRecipient(null);
      setLookupError('خطا در جستجوی بازیکن روی سرور.');
    } finally {
      setSearching(false);
    }
  };

  const handleConfirmGift = async () => {
    if (!recipient || sending) return;
    if (!isAuthenticated) {
      onRequireAuth?.();
      return;
    }

    setSending(true);
    setSendError(null);
    setInsufficientFunds(false);

    try {
      const res = await giftShopItemRequest({
        itemId,
        recipientUserId: recipient.userId,
      });

      if (!res.ok) {
        if (res.code === 'INSUFFICIENT_FUNDS') {
          setInsufficientFunds(true);
        }
        setSendError(res.message ?? 'ارسال هدیه انجام نشد.');
        return;
      }

      if (res.inventory) {
        onInventorySync?.(res.inventory);
      }
      setGiftSuccess(
        `«${itemName}» با موفقیت به ${recipient.username} هدیه داده شد.`
      );
    } catch {
      setSendError('خطا در ارتباط با سرور هنگام ارسال هدیه.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      data-testid="shop-gift-panel"
      className="rounded-2xl theme-subcard border border-[var(--eyvan-gold-border)] p-3.5 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-black theme-heading">
          <Gift className="w-4 h-4 theme-accent-gold shrink-0" />
          <span>هدیه به دوست</span>
        </div>
        <button
          type="button"
          onClick={onClosePanel}
          aria-label="بستن بخش هدیه"
          className="w-7 h-7 rounded-lg theme-btn-secondary border flex items-center justify-center cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {giftSuccess ? (
        <div
          data-testid="shop-gift-success"
          className="rounded-xl bg-[#0D8A8A]/15 border border-[#0D8A8A]/45 px-3 py-3 text-xs font-extrabold theme-win flex items-center gap-2"
        >
          <Check className="w-4 h-4 shrink-0" />
          <span>{giftSuccess}</span>
        </div>
      ) : (
        <>
          <form onSubmit={(e) => void handleLookup(e)} className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 theme-muted absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (lookupError) setLookupError(null);
                }}
                placeholder="نام کاربری یا شناسه ۶ رقمی..."
                aria-label="نام کاربری یا شناسه ۶ رقمی دوست"
                data-testid="shop-gift-lookup-input"
                className="w-full min-h-[38px] pr-8 pl-2.5 rounded-xl theme-input border text-xs font-bold focus:outline-none focus:ring-2 focus:ring-[var(--eyvan-teal)]"
              />
            </div>
            <button
              type="submit"
              disabled={searching}
              data-testid="shop-gift-lookup-btn"
              className="min-h-[38px] px-3 rounded-xl bg-[#0D8A8A] hover:bg-[#11A3A3] disabled:opacity-55 text-white text-xs font-extrabold whitespace-nowrap shrink-0 inline-flex items-center gap-1 cursor-pointer"
            >
              {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'جستجو'}
            </button>
          </form>

          {lookupError && (
            <p
              data-testid="shop-gift-lookup-error"
              className="text-[11px] font-bold text-red-400"
            >
              {lookupError}
            </p>
          )}

          {recipient && (
            <div
              data-testid="shop-gift-recipient-card"
              className="rounded-xl overflow-hidden border border-[var(--eyvan-line)] bg-[var(--eyvan-card-bg)]"
            >
              <div className="relative h-16 w-full overflow-hidden">
                <PlayerBannerStage
                  bannerItemIdOrCode={
                    recipient.appearance?.bannerItemId ??
                    recipient.appearance?.bannerCode
                  }
                  emptyText=""
                />
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent"
                />
              </div>

              <div className="px-3 pb-3 -mt-6 relative flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="rounded-full ring-2 ring-[var(--eyvan-modal-bg)] shrink-0">
                    <FramedPlayerAvatar
                      avatarCode={toValidAvatarCode(recipient.avatarCode)}
                      username={recipient.username}
                      customAvatarUrl={recipient.avatarUrl}
                      avatarFrameId={recipient.appearance?.avatarFrameId}
                      size="sm"
                    />
                  </div>
                  <div className="min-w-0 pt-4">
                    <div className="flex items-center gap-1 min-w-0">
                      <span
                        dir="ltr"
                        className="text-xs font-black theme-heading truncate"
                      >
                        {recipient.username}
                      </span>
                      <PlayerBadgeInline badgeId={recipient.appearance?.badgeId} />
                    </div>
                    <div className="flex items-center gap-2 text-[10px] theme-muted font-bold mt-0.5">
                      <span>سطح {toPersianDigits(recipient.level)}</span>
                      {recipient.accountCode && (
                        <span dir="ltr" className="font-mono">
                          #{recipient.accountCode}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="pt-4 shrink-0 text-left">
                  <span className="inline-flex items-center gap-1 text-xs font-black theme-heading tabular-nums">
                    {currency === 'gems' ? (
                      <PurpleGemSvg size={14} />
                    ) : (
                      <GoldCoinSvg size={14} />
                    )}
                    <span>
                      {effectivePrice === 0
                        ? 'رایگان'
                        : `${toPersianDigits(effectivePrice.toLocaleString())} ${currencyLabel}`}
                    </span>
                  </span>
                </div>
              </div>

              <div className="px-3 pb-3 space-y-2">
                {sendError && (
                  <p className="text-[11px] font-bold text-red-400">
                    {sendError}
                  </p>
                )}

                {!canAfford || insufficientFunds ? (
                  <div className="space-y-2">
                    <div className="text-[11px] font-bold text-amber-400">
                      موجودی {currencyLabel} شما برای ارسال این هدیه کافی نیست.
                    </div>
                    {onOpenTopUpShop && (
                      <button
                        type="button"
                        data-testid="shop-gift-topup-btn"
                        onClick={() => {
                          onClosePanel();
                          onOpenTopUpShop();
                        }}
                        className="w-full min-h-[38px] px-3 rounded-xl bg-gradient-to-b from-[#22C55E] to-[#15803D] hover:brightness-105 text-white text-xs font-black inline-flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Wallet className="w-3.5 h-3.5 shrink-0" />
                        <span>شارژ سکه و الماس (تومانی)</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={sending}
                    data-testid="shop-gift-confirm-btn"
                    onClick={() => void handleConfirmGift()}
                    className="w-full min-h-[40px] px-3 rounded-xl bg-gradient-to-b from-[#F5D98E] via-[#DDA942] to-[#B77E1E] hover:brightness-105 disabled:opacity-60 text-[#0B1628] text-xs font-black inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {sending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Gift className="w-4 h-4 shrink-0" />
                    )}
                    <span>تأیید و ارسال هدیه به {recipient.username}</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
