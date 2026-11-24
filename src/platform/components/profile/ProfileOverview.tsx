import React, { useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Copy,
  Layers,
  LogIn,
  Pencil,
  Plus,
  ShoppingBag,
  Sparkles,
  Trash2,
  Trophy,
  Upload,
  X,
} from 'lucide-react';
import { AuthUserSummary } from '../../auth/authClient';
import { PLATFORM_ASSETS } from '../../data/assets';
import { saveLocalCosmetics } from '../../data/guestDefaults';
import {
  buildUnifiedUniversalCatalog,
  getBannerVisual,
  getItemKindLabelFa,
} from '../../items/itemCatalog';
import { toPersianDigits } from '../../theme/tokens';
import { ProfileBannerCode, UserProfile } from '../../types/platform';
import {
  computeWinRateSummary,
  computeXpProgress,
} from '../../utils/profileMetrics';
import { GoldCoinSvg, PurpleGemSvg } from '../TopBar';
import {
  FramedPlayerAvatar,
  PlayerBadgeInline,
  PlayerBannerStage,
} from './PlayerAppearanceParts';

export type ProfileSubView = 'overview' | 'edit' | 'account' | 'settings';

interface ProfileOverviewProps {
  profile: UserProfile;
  authUser: AuthUserSummary | null;
  onUpdateProfile: (updater: (prev: UserProfile) => UserProfile) => void;
  onNavigate: (view: ProfileSubView) => void;
  onOpenAuth?: (mode: 'login' | 'register') => void;
  onOpenBannerShop?: () => void;
  onOpenTopUpShop?: () => void;
}

/**
 * Safely resizes a user-selected avatar image file on an offscreen canvas into a compact JPEG data URL.
 */
async function compressImageToDataUrl(
  file: File,
  maxWidth: number,
  maxHeight: number,
  quality = 0.84
): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(null);
      img.onload = () => {
        const scale = Math.min(
          1,
          maxWidth / Math.max(1, img.width),
          maxHeight / Math.max(1, img.height)
        );
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        try {
          const out = canvas.toDataURL('image/jpeg', quality);
          resolve(out.length <= 420_000 ? out : null);
        } catch {
          resolve(null);
        }
      };
      img.src = typeof reader.result === 'string' ? reader.result : '';
    };
    reader.readAsDataURL(file);
  });
}

export const ProfileOverview: React.FC<ProfileOverviewProps> = ({
  profile,
  authUser,
  onUpdateProfile,
  onNavigate,
  onOpenAuth,
  onOpenBannerShop,
  onOpenTopUpShop,
}) => {
  const [copiedId, setCopiedId] = useState(false);
  const [lightbox, setLightbox] = useState<'avatar' | 'banner' | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const avatarFileRef = useRef<HTMLInputElement | null>(null);

  const xp = computeXpProgress(profile.xp, profile.xpToNextLevel);
  const stats = computeWinRateSummary(profile.stats);

  // Strictly display 6-digit numeric account code — never raw UUID or guest_ prefix
  const numericAccountCode =
    authUser?.accountCode ?? profile.accountCode ?? '------';
  const ownedIds = useMemo(
    () => new Set(profile.ownedShopItemIds ?? ['af-banner-royal']),
    [profile.ownedShopItemIds]
  );

  const catalog = useMemo(() => buildUnifiedUniversalCatalog(), []);

  const ownedBanners = useMemo(
    () =>
      catalog
        .filter((item) => item.kind === 'banner' && ownedIds.has(item.id))
        .map((item) => {
          const vis = getBannerVisual(item.id);
          return {
            code: (vis.code === 'none' ? 'royal' : vis.code) as Exclude<
              ProfileBannerCode,
              'none'
            >,
            shopItemId: item.id,
            src: vis.imageSrc ?? PLATFORM_ASSETS.profileBannerRoyal,
            label: item.name,
          };
        }),
    [catalog, ownedIds]
  );

  const ownedCollection = useMemo(() => {
    const equippedValues = new Set(
      Object.values(profile.equippedSlots ?? {}).filter(Boolean)
    );
    return catalog
      .filter(
        (item) =>
          ownedIds.has(item.id) &&
          item.kind !== 'chest' &&
          item.kind !== 'bundle'
      )
      .map((item) => ({
        id: item.id,
        name: item.name,
        kindLabel: getItemKindLabelFa(item.kind),
        imageSrc: item.imageSrc,
        accent: item.palette[0],
        equipped: equippedValues.has(item.id),
      }));
  }, [catalog, ownedIds, profile.equippedSlots]);

  const bannerCode = profile.bannerCode ?? 'royal';
  const activeBannerIdOrCode =
    bannerCode === 'none'
      ? 'none'
      : profile.equippedSlots?.banner ?? bannerCode;
  const resolvedBanner = getBannerVisual(activeBannerIdOrCode);
  const activeBannerSrc =
    bannerCode === 'none' ? null : resolvedBanner.imageSrc;
  const activeFrameId =
    profile.equippedAvatarFrameId ?? profile.equippedSlots?.avatar_frame ?? null;
  const activeBadgeId =
    profile.equippedBadgeId ?? profile.equippedSlots?.profile_badge ?? null;
  const bioText = (profile.bio ?? authUser?.bio ?? '').trim();

  const handleCopyId = async () => {
    try {
      await navigator.clipboard?.writeText(numericAccountCode);
      setCopiedId(true);
      window.setTimeout(() => setCopiedId(false), 1800);
    } catch {
      // Clipboard unavailable in restricted context
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const dataUrl = await compressImageToDataUrl(file, 256, 256, 0.85);
    if (!dataUrl) {
      setUploadError('لطفاً یک تصویر معتبر انتخاب کنید.');
      return;
    }
    saveLocalCosmetics({ customAvatarUrl: dataUrl });
    onUpdateProfile((prev) => ({ ...prev, customAvatarUrl: dataUrl }));
  };

  const handleRemoveAvatar = () => {
    setUploadError(null);
    saveLocalCosmetics({ customAvatarUrl: null });
    onUpdateProfile((prev) => ({
      ...prev,
      customAvatarUrl: null,
      avatarCode: prev.avatarCode === 'portrait' ? 'turquoise' : prev.avatarCode,
    }));
  };

  const handleSelectBannerPreset = (
    code: Exclude<ProfileBannerCode, 'none'>,
    shopItemId: string
  ) => {
    setUploadError(null);
    saveLocalCosmetics({ bannerCode: code, customBannerUrl: null });
    onUpdateProfile((prev) => ({
      ...prev,
      bannerCode: code,
      customBannerUrl: null,
      equippedSlots: {
        ...(prev.equippedSlots ?? {}),
        banner: shopItemId,
      },
    }));
  };

  const handleRemoveBanner = () => {
    setUploadError(null);
    saveLocalCosmetics({ bannerCode: 'none', customBannerUrl: null });
    onUpdateProfile((prev) => ({
      ...prev,
      bannerCode: 'none',
      customBannerUrl: null,
    }));
  };

  return (
    <div
      className="max-w-xl mx-auto pb-8 space-y-5"
      data-testid="profile-overview"
    >
      {/* Hidden safe avatar file input (Banners are Shop-only!) */}
      <input
        ref={avatarFileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => void handleAvatarUpload(e)}
      />

      {/* 1. Edge-to-Edge Banner + Overlapping Avatar + Dead-Centered Identity */}
      <section className="rounded-[24px] theme-subcard border overflow-hidden">
        {/* Tappable Shop-Only Banner Stage */}
        <button
          type="button"
          data-testid="profile-banner-header"
          onClick={() => {
            setUploadError(null);
            setLightbox('banner');
          }}
          aria-label="تغییر بنر پروفایل از کلکسیون فروشگاه"
          className="group relative block w-full h-[140px] sm:h-[164px] overflow-hidden bg-gradient-to-br from-[#0F203D] via-[#132C50] to-[#0B3C42] cursor-pointer text-right focus-visible:outline-none"
        >
          <PlayerBannerStage
            bannerItemIdOrCode={activeBannerIdOrCode}
            emptyText="برای انتخاب بنر از فروشگاه لمس کنید"
            interactive
          />
          <div
            className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/10"
            aria-hidden="true"
          />
          <span className="absolute top-3 left-3 w-8 h-8 rounded-full bg-black/45 text-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-xs">
            <ShoppingBag className="w-4 h-4" />
          </span>
        </button>

        <div className="px-4 sm:px-6 pb-5">
          {/* Centered Overlapping Avatar */}
          <div className="relative flex flex-col items-center -mt-12">
            <button
              type="button"
              data-testid="profile-avatar-btn"
              onClick={() => {
                setUploadError(null);
                setLightbox('avatar');
              }}
              aria-label="مشاهده و تغییر عکس پروفایل"
              className="group relative rounded-full ring-[4px] ring-[var(--eyvan-card-bg)] shadow-[0_10px_28px_rgba(0,0,0,0.34)] cursor-pointer transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--eyvan-teal)]"
            >
              <FramedPlayerAvatar
                avatarCode={profile.avatarCode}
                customAvatarUrl={profile.customAvatarUrl}
                username={profile.username}
                avatarFrameId={activeFrameId}
                size="xl"
              />
              <span className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                <Camera className="w-5 h-5" />
              </span>
            </button>

            {/* Mathematically Dead-Centered Username (Symmetric 3-column grid isolates Pencil width) */}
            <div className="mt-3 w-full grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div aria-hidden="true" />
              <div className="inline-flex items-center justify-center gap-1.5 min-w-0 max-w-[240px] sm:max-w-[300px]">
                <PlayerBadgeInline badgeId={activeBadgeId} />
                <h3
                  dir="ltr"
                  className="text-lg sm:text-xl font-black theme-heading truncate text-center"
                  data-testid="profile-username-display"
                >
                  {profile.username}
                </h3>
              </div>
              <div className="flex justify-start">
                <button
                  type="button"
                  data-testid="profile-rename-btn"
                  onClick={() => onNavigate('edit')}
                  aria-label="ویرایش نام کاربری و بیوگرافی"
                  title="ویرایش پروفایل"
                  className="w-8 h-8 rounded-xl flex items-center justify-center theme-muted hover:text-[var(--eyvan-teal)] hover:bg-black/5 cursor-pointer transition-colors shrink-0"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Tap-to-Copy Pure 6-Digit Numeric Account ID */}
            <button
              type="button"
              onClick={() => void handleCopyId()}
              className="mt-1 inline-flex items-center gap-1.5 text-xs theme-muted hover:text-[var(--eyvan-text)] transition-colors cursor-pointer"
              title="کپی آیدی عددی"
            >
              <span>آیدی:</span>
              <code
                dir="ltr"
                data-testid="profile-persistent-id"
                className="font-mono font-bold tracking-wider tabular-nums"
              >
                {numericAccountCode}
              </code>
              {copiedId ? (
                <Check className="w-3.5 h-3.5 theme-win shrink-0" />
              ) : (
                <Copy className="w-3.5 h-3.5 shrink-0 opacity-75" />
              )}
            </button>

            {/* Bio Display or Tappable Placeholder */}
            <div className="mt-2.5 w-full max-w-md text-center">
              {bioText ? (
                <button
                  type="button"
                  onClick={() => onNavigate('edit')}
                  data-testid="profile-bio-display"
                  className="text-xs sm:text-sm theme-text/90 leading-relaxed hover:text-[var(--eyvan-teal)] transition-colors cursor-pointer"
                >
                  {bioText}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate('edit')}
                  data-testid="profile-bio-placeholder"
                  className="text-xs theme-muted hover:text-[var(--eyvan-teal)] transition-colors cursor-pointer"
                >
                  درباره خودت بنویس...
                </button>
              )}
            </div>
          </div>

          {/* 3-Column Scannable Stats Row with Vertical Hairline Dividers (Wins | History | Score) */}
          <div
            data-testid="profile-stats-summary"
            className="mt-5 pt-4 border-t border-[var(--eyvan-line)] grid grid-cols-3 divide-x divide-x-reverse divide-[var(--eyvan-line)] text-center"
          >
            <div className="px-2">
              <div className="text-[11px] font-bold theme-muted">برد</div>
              <div className="text-base sm:text-lg font-black theme-heading mt-0.5 tabular-nums">
                {toPersianDigits(stats.wins)}
              </div>
            </div>
            <div className="px-2">
              <div className="text-[11px] font-bold theme-muted">سابقه</div>
              <div className="text-base sm:text-lg font-black theme-heading mt-0.5 tabular-nums">
                {toPersianDigits(stats.gamesPlayed)} بازی
              </div>
            </div>
            <div className="px-2">
              <div className="text-[11px] font-bold theme-muted">امتیاز</div>
              <div className="text-base sm:text-lg font-black theme-accent-gold mt-0.5 tabular-nums">
                {toPersianDigits(stats.rating)}
              </div>
            </div>
          </div>

          {/* Clean Guest Login Action when not logged in */}
          {!authUser && (
            <div data-testid="profile-guest-cta-strip" className="pt-4">
              <button
                type="button"
                data-testid="profile-quick-login-btn"
                onClick={() =>
                  onOpenAuth ? onOpenAuth('login') : onNavigate('account')
                }
                className="w-full min-h-[42px] px-4 rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] hover:brightness-105 text-[#0B1628] text-xs font-black inline-flex items-center justify-center gap-1.5 cursor-pointer transition-all"
              >
                <LogIn className="w-4 h-4 shrink-0" />
                <span>ورود به حساب مرکزی</span>
              </button>
            </div>
          )}
        </div>
      </section>

      {/* 2. Wallet & Level Strip (with + Top-Up Button) */}
      <section className="rounded-[22px] theme-subcard border p-4 space-y-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4 text-sm font-black theme-heading tabular-nums">
            <span className="inline-flex items-center gap-1.5">
              <GoldCoinSvg size={20} />
              <span>{toPersianDigits(profile.coins.toLocaleString())}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <PurpleGemSvg size={20} />
              <span>{toPersianDigits(profile.gems.toLocaleString())}</span>
            </span>
          </div>

          <button
            type="button"
            data-testid="profile-wallet-topup-btn"
            onClick={() => onOpenTopUpShop?.()}
            aria-label="شارژ کیف پول و خرید سکه و الماس"
            className="min-h-[36px] px-3 rounded-xl bg-[#0D8A8A] hover:bg-[#0F9B9B] text-white text-xs font-extrabold inline-flex items-center gap-1 cursor-pointer transition-colors"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>شارژ</span>
          </button>
        </div>

        <div className="space-y-1.5 pt-1 border-t border-[var(--eyvan-line)]">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-extrabold theme-heading tabular-nums">
              سطح {toPersianDigits(profile.level)}
            </span>
            <span className="font-bold theme-muted tabular-nums">
              {toPersianDigits(xp.currentXp)} / {toPersianDigits(xp.targetXp)} XP
            </span>
          </div>
          <div
            className="h-2 rounded-full theme-bar-track overflow-hidden"
            role="progressbar"
            aria-valuenow={xp.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="پیشرفت تجربه تا سطح بعدی"
          >
            <div
              className="h-full rounded-full bg-[#0D8A8A] transition-all duration-300"
              style={{ width: `${xp.percent}%` }}
            />
          </div>
        </div>
      </section>

      {/* 3. My Collection Section ("کلکسیون من") */}
      <section
        className="rounded-[22px] theme-subcard border p-4 space-y-3"
        data-testid="profile-collection-section"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 theme-accent-teal shrink-0" />
            <h4 className="text-sm font-black theme-heading">کلکسیون من</h4>
          </div>
          <span className="text-xs font-bold theme-muted tabular-nums">
            {toPersianDigits(ownedCollection.length)} آیتم
          </span>
        </div>

        {ownedCollection.length === 0 ? (
          <p className="text-xs theme-muted py-2">
            هنوز آیتم اختصاصی‌ای در کلکسیون شما ثبت نشده است.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {ownedCollection.slice(0, 9).map((item) => (
              <div
                key={item.id}
                className={`rounded-xl border p-2.5 flex items-center gap-2.5 ${
                  item.equipped
                    ? 'border-[#0D8A8A]/55 bg-[#0D8A8A]/8'
                    : 'border-[var(--eyvan-line)] bg-[var(--eyvan-card-bg)]/50'
                }`}
              >
                <div
                  className="w-9 h-9 rounded-lg overflow-hidden shrink-0 border border-white/10 flex items-center justify-center"
                  style={{ backgroundColor: item.accent }}
                >
                  {item.imageSrc ? (
                    <img
                      src={item.imageSrc}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Sparkles className="w-4 h-4 text-white/90" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-extrabold theme-heading truncate">
                    {item.name}
                  </div>
                  <div className="text-[10px] font-bold theme-muted truncate">
                    {item.kindLabel}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. Game Stats Section ("آمار بازی‌ها") with Win-Rate Bar */}
      <section
        className="rounded-[22px] theme-subcard border p-4 space-y-3"
        data-testid="profile-game-stats-section"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 theme-accent-gold shrink-0" />
            <h4 className="text-sm font-black theme-heading">آمار بازی‌ها</h4>
          </div>
          <span className="text-xs font-bold theme-muted tabular-nums">
            امتیاز {toPersianDigits(stats.rating)}
          </span>
        </div>

        {!stats.hasGames ? (
          <div
            data-testid="profile-stats-empty"
            className="rounded-xl border border-[var(--eyvan-line)] p-4 text-center space-y-1"
          >
            <div className="text-xs sm:text-sm font-extrabold theme-heading">
              {stats.emptyLabel}
            </div>
            <p className="text-[11px] theme-muted leading-relaxed">
              با اتمام اولین مسابقه آنلاین حکم، تعداد بازی‌ها و نرخ برد شما اینجا ثبت می‌شود.
            </p>
          </div>
        ) : (
          <div
            data-testid="profile-stats-grid"
            className="rounded-xl border border-[var(--eyvan-line)] p-3.5 space-y-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#0D8A8A]/14 border border-[#0D8A8A]/35 flex items-center justify-center shrink-0">
                  <Trophy className="w-4 h-4 theme-accent-teal" />
                </div>
                <div>
                  <div className="text-sm font-black theme-heading">حکم</div>
                  <div className="text-[11px] font-bold theme-muted tabular-nums">
                    {toPersianDigits(stats.wins)} برد ·{' '}
                    {toPersianDigits(stats.losses)} باخت از{' '}
                    {toPersianDigits(stats.gamesPlayed)} بازی
                  </div>
                </div>
              </div>
              <div className="text-sm font-black theme-accent-teal tabular-nums">
                {toPersianDigits(stats.winRatePct ?? 0)}٪
              </div>
            </div>
            <div className="h-2 rounded-full theme-bar-track overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-l from-[#14B8A6] to-[#0D8A8A] transition-all duration-300"
                style={{ width: `${stats.winRatePct ?? 0}%` }}
              />
            </div>
          </div>
        )}
      </section>

      {/* AVATAR LIGHTBOX (Zoom + Upload + Remove) */}
      {lightbox === 'avatar' && (
        <div
          data-testid="profile-avatar-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="عکس پروفایل"
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/78 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[350px] rounded-[24px] theme-drawer border border-[var(--eyvan-gold-border)] shadow-[0_24px_64px_rgba(0,0,0,0.6)] p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black theme-heading">عکس پروفایل</h3>
              <button
                type="button"
                data-testid="profile-lightbox-close"
                onClick={() => setLightbox(null)}
                aria-label="بستن"
                className="w-8 h-8 rounded-xl flex items-center justify-center theme-muted hover:theme-heading hover:bg-black/5 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex justify-center py-2">
              <div className="w-36 h-36 rounded-full overflow-hidden border-[3px] border-[#D4AE58] shadow-[0_12px_32px_rgba(0,0,0,0.4)] flex items-center justify-center bg-[#13294B]">
                {profile.customAvatarUrl ? (
                  <img
                    src={profile.customAvatarUrl}
                    alt={profile.username}
                    className="w-full h-full object-cover"
                  />
                ) : profile.avatarCode === 'portrait' ? (
                  <img
                    src={PLATFORM_ASSETS.userAvatar}
                    alt={profile.username}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-5xl font-black text-white uppercase">
                    {profile.username.trim().slice(0, 1).toUpperCase() || 'A'}
                  </span>
                )}
              </div>
            </div>

            {uploadError && (
              <p className="text-xs font-bold theme-loss text-center">
                {uploadError}
              </p>
            )}

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                data-testid="profile-avatar-upload-btn"
                onClick={() => avatarFileRef.current?.click()}
                className="min-h-[42px] px-3 rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] text-xs font-black inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>تغییر عکس</span>
              </button>
              <button
                type="button"
                data-testid="profile-avatar-delete-btn"
                onClick={handleRemoveAvatar}
                className="min-h-[42px] px-3 rounded-xl border border-[#DC2626]/40 text-xs font-extrabold theme-loss hover:bg-[#DC2626]/10 inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>حذف عکس</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SHOP-ONLY BANNER LIGHTBOX (Owned Shop Banners + Open Shop + Remove — ZERO custom upload!) */}
      {lightbox === 'banner' && (
        <div
          data-testid="profile-banner-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="بنر پروفایل"
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/78 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[400px] rounded-[24px] theme-drawer border border-[var(--eyvan-gold-border)] shadow-[0_24px_64px_rgba(0,0,0,0.6)] p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black theme-heading">بنر پروفایل</h3>
              <button
                type="button"
                data-testid="profile-lightbox-close"
                onClick={() => setLightbox(null)}
                aria-label="بستن"
                className="w-8 h-8 rounded-xl flex items-center justify-center theme-muted hover:theme-heading hover:bg-black/5 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="w-full aspect-[16/7] rounded-2xl overflow-hidden border border-[var(--eyvan-line)] bg-gradient-to-br from-[#0F203D] to-[#0B3C42] flex items-center justify-center">
              {activeBannerSrc ? (
                <img
                  src={activeBannerSrc}
                  alt="پیش‌نمایش بنر پروفایل"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-xs font-bold text-white/65">
                  بدون بنر فعال
                </span>
              )}
            </div>

            {ownedBanners.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold theme-muted">
                  بنرهای موجود در کلکسیون شما
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {ownedBanners.map((b) => {
                    const isActive = bannerCode === b.code;
                    return (
                      <button
                        key={b.shopItemId}
                        type="button"
                        onClick={() =>
                          handleSelectBannerPreset(b.code, b.shopItemId)
                        }
                        className={`relative h-[54px] rounded-xl overflow-hidden border-2 cursor-pointer transition-all ${
                          isActive
                            ? 'border-[#0D8A8A] ring-2 ring-[#0D8A8A]/35'
                            : 'border-[var(--eyvan-line)] hover:border-[var(--eyvan-teal)]/50'
                        }`}
                        title={b.label}
                      >
                        <img
                          src={b.src}
                          alt={b.label}
                          className="w-full h-full object-cover"
                        />
                        {isActive && (
                          <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-[#0D8A8A] text-white flex items-center justify-center">
                            <Check className="w-2.5 h-2.5" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                data-testid="profile-banner-shop-btn"
                onClick={() => {
                  setLightbox(null);
                  onOpenBannerShop?.();
                }}
                className="min-h-[42px] px-3 rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] text-xs font-black inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                <span>فروشگاه بنر</span>
              </button>
              <button
                type="button"
                data-testid="profile-banner-delete-btn"
                onClick={handleRemoveBanner}
                className="min-h-[42px] px-3 rounded-xl border border-[#DC2626]/40 text-xs font-extrabold theme-loss hover:bg-[#DC2626]/10 inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>حذف بنر</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
