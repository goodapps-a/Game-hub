import React, { useRef, useState } from 'react';
import { Check, Copy, Camera, LogIn, Pencil, ShieldCheck, Trash2, Trophy, Upload, X } from 'lucide-react';
import { AuthUserSummary } from '../../auth/authClient';
import { PLATFORM_ASSETS } from '../../data/assets';
import { saveLocalCosmetics } from '../../data/guestDefaults';
import {
  buildUnifiedUniversalCatalog,
  getBannerVisual,
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
}

/**
 * Safely resizes a user-selected image file on an offscreen canvas into a compact JPEG data URL.
 * Rejects non-images and caps dimensions/file size cleanly on client side.
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
}) => {
  const [copiedId, setCopiedId] = useState(false);
  const [lightbox, setLightbox] = useState<'avatar' | 'banner' | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const avatarFileRef = useRef<HTMLInputElement | null>(null);
  const bannerFileRef = useRef<HTMLInputElement | null>(null);

  const xp = computeXpProgress(profile.xp, profile.xpToNextLevel);
  const stats = computeWinRateSummary(profile.stats);
  const persistentId = authUser
    ? authUser.accountCode ?? profile.accountCode ?? authUser.userId
    : profile.id;
  const ownedIds = new Set(profile.ownedShopItemIds ?? ['af-banner-royal']);

  const bannerOptions = buildUnifiedUniversalCatalog()
    .filter((item) => item.kind === 'banner')
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
    });

  const bannerCode = profile.bannerCode ?? 'royal';
  const activeBannerIdOrCode =
    bannerCode === 'none'
      ? 'none'
      : profile.equippedSlots?.banner ?? bannerCode;
  const resolvedBanner = getBannerVisual(activeBannerIdOrCode);
  const activeBannerSrc = profile.customBannerUrl
    ? profile.customBannerUrl
    : bannerCode === 'none'
      ? null
      : resolvedBanner.imageSrc;
  const activeFrameId =
    profile.equippedAvatarFrameId ?? profile.equippedSlots?.avatar_frame ?? null;
  const activeBadgeId =
    profile.equippedBadgeId ?? profile.equippedSlots?.profile_badge ?? null;

  const handleCopyId = async () => {
    try {
      await navigator.clipboard?.writeText(persistentId);
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

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const dataUrl = await compressImageToDataUrl(file, 720, 300, 0.82);
    if (!dataUrl) {
      setUploadError('لطفاً یک تصویر بنر معتبر انتخاب کنید.');
      return;
    }
    saveLocalCosmetics({ customBannerUrl: dataUrl });
    onUpdateProfile((prev) => ({ ...prev, customBannerUrl: dataUrl }));
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
      className="divide-y divide-[var(--eyvan-line)]"
      data-testid="profile-overview"
    >
      {/* Hidden safe file inputs */}
      <input
        ref={avatarFileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => void handleAvatarUpload(e)}
      />
      <input
        ref={bannerFileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => void handleBannerUpload(e)}
      />

      {/* 1. Centered Banner-Backed Identity Hero (Tap Banner or Avatar to Zoom & Edit) */}
      <section className="pb-5 space-y-3">
        {/* Tappable Profile Banner */}
        <button
          type="button"
          data-testid="profile-banner-header"
          onClick={() => {
            setUploadError(null);
            setLightbox('banner');
          }}
          aria-label="مشاهده و تغییر بنر پروفایل"
          className="group relative block w-[calc(100%+2rem)] sm:w-[calc(100%+2.5rem)] -mx-4 sm:-mx-5 -mt-4 sm:-mt-5 h-[132px] sm:h-[146px] overflow-hidden bg-gradient-to-br from-[#0F203D] via-[#132C50] to-[#0B3C42] cursor-pointer text-right focus-visible:outline-none"
        >
          <PlayerBannerStage
            bannerItemIdOrCode={activeBannerIdOrCode}
            customBannerUrl={profile.customBannerUrl}
            emptyText="برای افزودن بنر لمس کنید"
            interactive
          />
          <div
            className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/15"
            aria-hidden="true"
          />
          <span className="absolute top-2.5 left-2.5 w-8 h-8 rounded-full bg-black/45 text-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-xs">
            <Camera className="w-4 h-4" />
          </span>
        </button>

        {/* Centered Large Overlapping Avatar (Tap to Zoom, Upload or Remove) */}
        <div className="relative flex flex-col items-center -mt-12">
          <button
            type="button"
            data-testid="profile-avatar-btn"
            onClick={() => {
              setUploadError(null);
              setLightbox('avatar');
            }}
            aria-label="مشاهده و تغییر عکس پروفایل"
            className="group relative rounded-full ring-[4px] ring-[var(--eyvan-modal-bg)] shadow-[0_10px_28px_rgba(0,0,0,0.34)] cursor-pointer transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--eyvan-teal)]"
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

          {/* Centered Username + Badge + Subtle Rename Pencil */}
          <div className="mt-2.5 flex items-center justify-center gap-1.5 max-w-full px-2">
            <PlayerBadgeInline badgeId={activeBadgeId} />
            <h3
              dir="ltr"
              className="text-lg font-black theme-heading truncate"
              data-testid="profile-username-display"
            >
              {profile.username}
            </h3>
            <button
              type="button"
              data-testid="profile-rename-btn"
              onClick={() => onNavigate('edit')}
              aria-label="تغییر نام کاربری"
              title="تغییر نام کاربری"
              className="w-7 h-7 rounded-lg flex items-center justify-center theme-muted hover:text-[var(--eyvan-teal)] hover:bg-black/5 cursor-pointer transition-colors shrink-0"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-xs font-bold mt-0.5">
            {authUser ? (
              <>
                <span className="theme-accent-teal">حساب مرکزی</span>
                <span className="theme-muted" aria-hidden="true">
                  ·
                </span>
                <span
                  className={
                    authUser.emailVerified ? 'theme-win' : 'theme-accent-gold'
                  }
                >
                  {authUser.emailVerified
                    ? 'ایمیل تأییدشده'
                    : 'در انتظار تأیید ایمیل'}
                </span>
              </>
            ) : (
              <span className="theme-muted">حالت مهمان · بازی آزاد</span>
            )}
          </div>

          {authUser?.email && (
            <div dir="ltr" className="text-xs theme-muted truncate mt-0.5">
              {authUser.email}
            </div>
          )}

          {/* Discreet Tap-to-Copy Persistent 6-Digit Account ID */}
          <button
            type="button"
            onClick={() => void handleCopyId()}
            className="inline-flex items-center gap-1.5 text-[11px] theme-muted hover:text-[var(--eyvan-text)] transition-colors cursor-pointer mt-1"
            title="کپی شناسه یکتا"
          >
            <span>{authUser ? 'شناسه کاربری:' : 'شناسه:'}</span>
            <code
              dir="ltr"
              data-testid="profile-persistent-id"
              className="font-mono text-[11px] font-bold tracking-wider truncate max-w-[180px]"
            >
              {persistentId}
            </code>
            {copiedId ? (
              <Check className="w-3 h-3 theme-win shrink-0" />
            ) : (
              <Copy className="w-3 h-3 shrink-0 opacity-75" />
            )}
          </button>
        </div>

        {/* Clean Guest Login Action (no suggestion box) */}
        {!authUser && (
          <div data-testid="profile-guest-cta-strip" className="pt-1">
            <button
              type="button"
              data-testid="profile-quick-login-btn"
              onClick={() =>
                onOpenAuth ? onOpenAuth('login') : onNavigate('account')
              }
              className="w-full min-h-[42px] px-4 rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] hover:brightness-105 text-[#0B1628] text-xs font-black inline-flex items-center justify-center gap-1.5 cursor-pointer transition-all"
            >
              <LogIn className="w-4 h-4 shrink-0" />
              <span>ورود به حساب</span>
            </button>
          </div>
        )}
      </section>

      {/* 2. Unified Level & Wallet Strip */}
      <section className="py-4 space-y-3.5">
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

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-xs font-bold theme-muted">دارایی کیف پول</span>
          <div className="flex items-center gap-3 text-xs sm:text-sm font-extrabold theme-heading tabular-nums">
            <span className="inline-flex items-center gap-1.5">
              <GoldCoinSvg size={18} />
              <span>{toPersianDigits(profile.coins.toLocaleString())}</span>
            </span>
            <span className="theme-muted" aria-hidden="true">
              ·
            </span>
            <span className="inline-flex items-center gap-1.5">
              <PurpleGemSvg size={18} />
              <span>{toPersianDigits(profile.gems.toLocaleString())}</span>
            </span>
          </div>
        </div>
      </section>

      {/* 3. Scannable 3-Metric Game Stats */}
      <section className="pt-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Trophy className="w-4 h-4 theme-accent-gold shrink-0" />
            <h4 className="text-xs sm:text-sm font-extrabold theme-heading">
              عملکرد حکم
            </h4>
          </div>
          {stats.hasGames && (
            <span className="text-xs font-bold theme-muted tabular-nums">
              امتیاز {toPersianDigits(stats.rating)}
            </span>
          )}
        </div>

        {!stats.hasGames ? (
          <div
            data-testid="profile-stats-empty"
            className="rounded-2xl theme-subcard border p-4 text-center space-y-1"
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
            className="rounded-2xl theme-subcard border grid grid-cols-3 divide-x divide-x-reverse divide-[var(--eyvan-line)] text-center"
          >
            <div className="py-3.5 px-2">
              <div className="text-[11px] font-bold theme-muted">کل بازی</div>
              <div className="text-lg font-black theme-heading mt-0.5 tabular-nums">
                {toPersianDigits(stats.gamesPlayed)}
              </div>
            </div>
            <div className="py-3.5 px-2">
              <div className="text-[11px] font-bold theme-muted">برد / باخت</div>
              <div className="text-lg font-black mt-0.5 tabular-nums">
                <span className="theme-win">{toPersianDigits(stats.wins)}</span>
                <span className="theme-muted text-xs mx-0.5">/</span>
                <span className="theme-loss">
                  {toPersianDigits(stats.losses)}
                </span>
              </div>
            </div>
            <div className="py-3.5 px-2">
              <div className="text-[11px] font-bold theme-muted">نرخ برد</div>
              <div className="text-lg font-black theme-accent-teal mt-0.5 tabular-nums">
                {toPersianDigits(stats.winRatePct ?? 0)}٪
              </div>
            </div>
          </div>
        )}

        {authUser && (
          <button
            type="button"
            onClick={() => onNavigate('account')}
            className="w-full min-h-[44px] px-3.5 rounded-xl theme-subcard border hover:border-[var(--eyvan-teal)]/45 flex items-center justify-between gap-2 text-xs font-bold theme-heading cursor-pointer transition-colors"
          >
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 theme-accent-teal shrink-0" />
              <span>مدیریت نشست‌ها و امنیت حساب</span>
            </span>
            <span className="text-[11px] theme-muted">مشاهده</span>
          </button>
        )}
      </section>

      {/* AVATAR LIGHTBOX (Zoom + Upload + Presets + Delete) */}
      {lightbox === 'avatar' && (
        <div
          data-testid="profile-avatar-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="عکس پروفایل"
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/78 backdrop-blur-sm"
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

            {/* Large Enlarged Avatar Preview */}
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

            {/* Upload & Delete Actions */}
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

      {/* BANNER LIGHTBOX (Zoom + Owned Banners + Upload + Shop + Delete) */}
      {lightbox === 'banner' && (
        <div
          data-testid="profile-banner-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="بنر پروفایل"
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/78 backdrop-blur-sm"
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

            {/* Large Banner Preview */}
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

            {/* Owned Banners (only if player owns > 1) */}
            {bannerOptions.filter((b) => ownedIds.has(b.shopItemId)).length > 1 && (
              <div className="grid grid-cols-3 gap-2">
                {bannerOptions.filter((b) => ownedIds.has(b.shopItemId)).map((b) => {
                  const isActive =
                    !profile.customBannerUrl && bannerCode === b.code;
                  return (
                    <button
                      key={b.code}
                      type="button"
                      onClick={() => handleSelectBannerPreset(b.code, b.shopItemId)}
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
            )}

            {uploadError && (
              <p className="text-xs font-bold theme-loss text-center">
                {uploadError}
              </p>
            )}

            {/* Upload & Delete Actions */}
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                data-testid="profile-banner-upload-btn"
                onClick={() => bannerFileRef.current?.click()}
                className="min-h-[42px] px-3 rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] text-xs font-black inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>آپلود بنر</span>
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
