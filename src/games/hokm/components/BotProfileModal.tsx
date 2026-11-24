import React, { useState } from 'react';
import { Check, Flame, Trophy, UserPlus, X } from 'lucide-react';
import { Seat } from '../engine/types';
import { toPersianDigits } from '../../../platform/theme/tokens';
import { PLATFORM_ASSETS } from '../../../platform/data/assets';

export interface BotShowcaseProfile {
  readonly seat: Seat;
  readonly username: string;
  readonly avatarSrc: string;
  readonly bannerSrc: string;
  readonly level: number;
  readonly wins: number;
  readonly accountAgeDays: number;
  readonly bio: string;
}

export const OFFLINE_BOT_PROFILES: Record<Exclude<Seat, 'south'>, BotShowcaseProfile> = {
  north: {
    seat: 'north',
    username: 'parvin_sh',
    avatarSrc: PLATFORM_ASSETS.avatarParvin,
    bannerSrc: PLATFORM_ASSETS.profileBannerGarden,
    level: 14,
    wins: 128,
    accountAgeDays: 245,
    bio: 'همیشه پای یار می‌ایستم؛ حکم رو دقیق بشمار!',
  },
  east: {
    seat: 'east',
    username: 'sohrab_k',
    avatarSrc: PLATFORM_ASSETS.avatarSohrab,
    bannerSrc: PLATFORM_ASSETS.profileBannerRuby,
    level: 19,
    wins: 214,
    accountAgeDays: 380,
    bio: 'عاشق کُت کردن حاکم و بازی‌های سریع!',
  },
  west: {
    seat: 'west',
    username: 'farhad_n',
    avatarSrc: PLATFORM_ASSETS.avatarFarhad,
    bannerSrc: PLATFORM_ASSETS.profileBannerRoyal,
    level: 16,
    wins: 167,
    accountAgeDays: 312,
    bio: 'تک پیک رو تا دست آخر نگه می‌دارم.',
  },
};

interface BotProfileModalProps {
  bot: BotShowcaseProfile | null;
  onClose: () => void;
}

export const BotProfileModal: React.FC<BotProfileModalProps> = ({
  bot,
  onClose,
}) => {
  const [requestedIds, setRequestedIds] = useState<Record<string, boolean>>({});

  if (!bot) return null;

  const isRequested = Boolean(requestedIds[bot.seat]);

  return (
    <div
      dir="rtl"
      data-testid="bot-profile-modal"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/55 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={`پروفایل ${bot.username}`}
    >
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />

      {/* Translucent Frosted Liquid Glass Card */}
      <div className="relative z-10 w-full max-w-[360px] rounded-[28px] bg-gradient-to-b from-white/[0.14] via-[#0B1F2E]/72 to-[#071422]/82 backdrop-blur-2xl border border-white/25 shadow-[0_28px_72px_rgba(0,0,0,0.68),inset_0_1px_0_rgba(255,255,255,0.38)] overflow-hidden">
        {/* Specular liquid glass top highlight */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent z-20"
          aria-hidden="true"
        />

        {/* Real Banner Image Header */}
        <div className="relative h-32 w-full overflow-hidden">
          <img
            src={bot.bannerSrc}
            alt=""
            data-testid="bot-profile-banner"
            decoding="sync"
            loading="eager"
            className="w-full h-full object-cover object-center"
          />
          <div
            className="absolute inset-0 bg-gradient-to-t from-[#081724]/85 via-black/15 to-black/20"
            aria-hidden="true"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن پروفایل"
            data-testid="bot-profile-close-btn"
            className="absolute top-3 left-3 w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-xl border border-white/30 text-white flex items-center justify-center cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Overlapping Circular Real Avatar + Pure English Username (NO @, NO ID, NO Persian name) */}
        <div className="px-5 pb-5 -mt-12 text-center relative z-10">
          <div className="w-24 h-24 mx-auto rounded-full p-[3px] bg-gradient-to-b from-white/75 via-[#FDE68A]/85 to-white/25 shadow-[0_12px_32px_rgba(0,0,0,0.55)] backdrop-blur-xl">
            <img
              src={bot.avatarSrc}
              alt={bot.username}
              data-testid="bot-profile-avatar"
              decoding="sync"
              loading="eager"
              className="w-full h-full rounded-full object-cover"
            />
          </div>

          <h3
            dir="ltr"
            data-testid="bot-profile-username"
            className="mt-3 text-xl font-black tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.45)]"
          >
            {bot.username}
          </h3>

          <p className="mt-2 text-xs text-white/80 leading-relaxed max-w-[270px] mx-auto">
            {bot.bio}
          </p>

          {/* Liquid Glass 3-Stat Strip: Wins | Account Age | Level */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-white/[0.08] backdrop-blur-xl border border-white/18 shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] py-2.5 px-1.5">
              <div className="text-[10px] text-white/65 font-bold">تعداد برد</div>
              <div className="mt-1 text-sm font-black text-white tabular-nums flex items-center justify-center gap-1">
                <Trophy className="w-3.5 h-3.5 text-[#FDE68A]" />
                <span>{toPersianDigits(bot.wins)}</span>
              </div>
            </div>
            <div className="rounded-2xl bg-white/[0.08] backdrop-blur-xl border border-white/18 shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] py-2.5 px-1.5">
              <div className="text-[10px] text-white/65 font-bold">سابقه</div>
              <div className="mt-1 text-sm font-black text-white tabular-nums">
                {toPersianDigits(bot.accountAgeDays)} روز
              </div>
            </div>
            <div className="rounded-2xl bg-white/[0.08] backdrop-blur-xl border border-white/18 shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] py-2.5 px-1.5">
              <div className="text-[10px] text-white/65 font-bold">سطح</div>
              <div className="mt-1 text-sm font-black text-[#FDE68A] tabular-nums flex items-center justify-center gap-1">
                <Flame className="w-3.5 h-3.5 text-[#FB923C]" />
                <span>{toPersianDigits(bot.level)}</span>
              </div>
            </div>
          </div>

          {/* Liquid Glass Friend Request CTA */}
          <button
            type="button"
            disabled={isRequested}
            onClick={() =>
              setRequestedIds((prev) => ({ ...prev, [bot.seat]: true }))
            }
            data-testid="bot-friend-request-btn"
            className={`mt-4 w-full min-h-[44px] rounded-2xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 backdrop-blur-xl border transition-all cursor-pointer ${
              isRequested
                ? 'bg-[#14B8A6]/22 border-[#5EEAD4]/50 text-[#99F6E4] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]'
                : 'bg-[#38BDF8]/32 hover:bg-[#38BDF8]/44 border-white/35 text-white shadow-[0_10px_28px_rgba(14,165,233,0.32),inset_0_1px_0_rgba(255,255,255,0.42)]'
            }`}
          >
            {isRequested ? (
              <>
                <Check className="w-4 h-4" />
                <span>درخواست دوستی ارسال شد</span>
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                <span>پیشنهاد دوستی</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
