import React from 'react';
import { Award, Image as ImageIcon } from 'lucide-react';
import {
  getAvatarFrameVisual,
  getBannerVisual,
  getProfileBadgeVisual,
} from '../../items/itemCatalog';
import { UserProfile } from '../../types/platform';
import { ProfileAvatar } from '../TopBar';

interface PlayerBannerStageProps {
  bannerItemIdOrCode?: string | null;
  customBannerUrl?: string | null;
  emptyText?: string;
  className?: string;
  interactive?: boolean;
}

export const PlayerBannerStage: React.FC<PlayerBannerStageProps> = ({
  bannerItemIdOrCode,
  customBannerUrl,
  emptyText = 'بدون بنر فعال',
  className = '',
  interactive = false,
}) => {
  const resolved = getBannerVisual(bannerItemIdOrCode);
  const src = customBannerUrl || resolved.imageSrc;

  if (!src) {
    return (
      <div
        className={`w-full h-full flex items-center justify-center bg-gradient-to-br from-[#0F203D] via-[#132C50] to-[#0B3C42] ${className}`}
      >
        <span className="text-[11px] font-bold text-white/60 inline-flex items-center gap-1.5">
          <ImageIcon className="w-4 h-4 shrink-0" />
          <span>{emptyText}</span>
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={resolved.label}
      decoding="async"
      loading="lazy"
      referrerPolicy="no-referrer"
      className={`w-full h-full object-cover object-center brightness-[1.02] contrast-[1.04] ${
        interactive ? 'transition-transform duration-300 group-hover:scale-[1.03]' : ''
      } ${className}`}
    />
  );
};

interface FramedPlayerAvatarProps {
  avatarCode: UserProfile['avatarCode'];
  username: string;
  customAvatarUrl?: string | null;
  avatarFrameId?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const FramedPlayerAvatar: React.FC<FramedPlayerAvatarProps> = ({
  avatarCode,
  username,
  customAvatarUrl = null,
  avatarFrameId = null,
  size = 'sm',
}) => {
  if (!avatarFrameId) {
    return (
      <ProfileAvatar
        avatarCode={avatarCode}
        username={username}
        customAvatarUrl={customAvatarUrl}
        size={size}
      />
    );
  }

  const frame = getAvatarFrameVisual(avatarFrameId);
  return (
    <span
      data-avatar-frame-id={avatarFrameId}
      className="inline-flex rounded-full p-[2.5px] shrink-0"
      style={{
        background: `linear-gradient(135deg, ${frame.ringColor}, ${frame.glowColor})`,
        boxShadow: `0 0 14px ${frame.glowColor}`,
      }}
      title={frame.label ?? undefined}
    >
      <span className="rounded-full bg-[var(--eyvan-surface)] p-[1.5px] inline-flex">
        <ProfileAvatar
          avatarCode={avatarCode}
          username={username}
          customAvatarUrl={customAvatarUrl}
          size={size}
        />
      </span>
    </span>
  );
};

interface PlayerBadgeInlineProps {
  badgeId?: string | null;
  className?: string;
}

export const PlayerBadgeInline: React.FC<PlayerBadgeInlineProps> = ({
  badgeId,
  className = '',
}) => {
  const badge = getProfileBadgeVisual(badgeId);
  if (!badge) return null;

  return (
    <span
      data-profile-badge-id={badgeId}
      title={badge.label}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-extrabold border shrink-0 whitespace-nowrap ${className}`}
      style={{
        color: badge.color,
        borderColor: `${badge.color}55`,
        backgroundColor: `${badge.color}16`,
      }}
    >
      <Award className="w-2.5 h-2.5 shrink-0" />
      <span>{badge.symbol}</span>
    </span>
  );
};
