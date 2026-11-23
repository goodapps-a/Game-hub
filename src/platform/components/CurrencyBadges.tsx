import React, { useId } from 'react';
import { toPersianDigits } from '../theme/tokens';

interface IconProps {
  size?: number;
  className?: string;
  animated?: boolean;
}

/**
 * Radiant multi-layered Persian Gold Coin with metallic bevel, specular gleam,
 * pulsing outer golden glow, and twinkling starlight sparkles.
 */
export const GoldCoinSvg: React.FC<IconProps> = ({
  size = 20,
  className = '',
  animated = true,
}) => {
  const uid = useId().replace(/:/g, '');
  const gradOuter = `gc-outer-${uid}`;
  const gradInner = `gc-inner-${uid}`;
  const gradShine = `gc-shine-${uid}`;
  const clipCoin = `gc-clip-${uid}`;

  return (
    <span
      className={`relative inline-flex items-center justify-center shrink-0 select-none ${
        animated ? 'eyvan-coin-glow' : ''
      } ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 36 36"
        fill="none"
        className="overflow-visible"
      >
        <defs>
          <radialGradient id={gradOuter} cx="32%" cy="26%" r="76%">
            <stop offset="0%" stopColor="#FFF7C8" />
            <stop offset="32%" stopColor="#F9D058" />
            <stop offset="72%" stopColor="#D6941E" />
            <stop offset="100%" stopColor="#8E5908" />
          </radialGradient>
          <linearGradient id={gradInner} x1="8" y1="6" x2="28" y2="30" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFE99B" />
            <stop offset="48%" stopColor="#E4A728" />
            <stop offset="100%" stopColor="#A66D0D" />
          </linearGradient>
          <linearGradient id={gradShine} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
            <stop offset="48%" stopColor="#FFFCE6" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
          <clipPath id={clipCoin}>
            <circle cx="18" cy="18" r="14.5" />
          </clipPath>
        </defs>

        {/* Soft Ambient Golden Halo */}
        <circle cx="18" cy="18" r="16.5" fill="#FACC15" fillOpacity="0.18" />

        {/* Outer Sculpted Rim */}
        <circle
          cx="18"
          cy="18"
          r="15"
          fill={`url(#${gradOuter})`}
          stroke="#FFF1B0"
          strokeWidth="1.5"
        />

        {/* Recessed Inner Coin Dish */}
        <circle
          cx="18"
          cy="18"
          r="11.2"
          fill={`url(#${gradInner})`}
          stroke="#8D5808"
          strokeOpacity="0.55"
          strokeWidth="1.1"
        />

        {/* Subtle Inner Highlight Ring */}
        <circle
          cx="18"
          cy="18"
          r="9.8"
          stroke="#FFF6C9"
          strokeOpacity="0.55"
          strokeWidth="0.7"
          strokeDasharray="2 2"
        />

        {/* Embossed Persian 4-Point Shamseh Diamond Emblem */}
        <path
          d="M18 9.8L20.4 15.6L26.2 18L20.4 20.4L18 26.2L15.6 20.4L9.8 18L15.6 15.6L18 9.8Z"
          fill="#FFF7CF"
          stroke="#B57510"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />
        <circle cx="18" cy="18" r="2.2" fill="#F5B82E" />

        {/* Looping Diagonal Specular Glint */}
        {animated && (
          <g clipPath={`url(#${clipCoin})`}>
            <rect
              x="-16"
              y="0"
              width="12"
              height="36"
              fill={`url(#${gradShine})`}
              className="eyvan-currency-sweep"
            />
          </g>
        )}

        {/* Top-left bright specular arc */}
        <path
          d="M9.5 12.2C11.3 8.8 14.5 6.8 18.2 6.6"
          stroke="#FFFFFF"
          strokeOpacity="0.82"
          strokeWidth="1.5"
          strokeLinecap="round"
        />

        {/* Twinkling micro-sparkles */}
        {animated && (
          <>
            <path
              d="M31 5L32 7.5L34.5 8.5L32 9.5L31 12L30 9.5L27.5 8.5L30 7.5L31 5Z"
              fill="#FFF8CC"
              className="eyvan-twinkle-a"
            />
            <path
              d="M6.5 25L7.2 26.8L9 27.5L7.2 28.2L6.5 30L5.8 28.2L4 27.5L5.8 26.8L6.5 25Z"
              fill="#FFE98A"
              className="eyvan-twinkle-b"
            />
          </>
        )}
      </svg>
    </span>
  );
};

/**
 * Radiant faceted Amethyst/Crystal Gem with prismatic multi-facet shading,
 * violet-cyan inner refraction, looping shimmer sweep, and twinkling glints.
 */
export const PurpleGemSvg: React.FC<IconProps> = ({
  size = 20,
  className = '',
  animated = true,
}) => {
  const uid = useId().replace(/:/g, '');
  const gradBody = `gm-body-${uid}`;
  const gradTop = `gm-top-${uid}`;
  const gradLeft = `gm-left-${uid}`;
  const gradRight = `gm-right-${uid}`;
  const gradShine = `gm-shine-${uid}`;
  const clipGem = `gm-clip-${uid}`;

  return (
    <span
      className={`relative inline-flex items-center justify-center shrink-0 select-none ${
        animated ? 'eyvan-gem-glow' : ''
      } ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 36 36"
        fill="none"
        className="overflow-visible"
      >
        <defs>
          <linearGradient id={gradBody} x1="6" y1="5" x2="30" y2="32" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#F5A6FF" />
            <stop offset="35%" stopColor="#B84CFF" />
            <stop offset="72%" stopColor="#7C22E8" />
            <stop offset="100%" stopColor="#43108F" />
          </linearGradient>
          <linearGradient id={gradTop} x1="11" y1="5" x2="25" y2="14" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.92" />
            <stop offset="60%" stopColor="#E9B8FF" stopOpacity="0.72" />
            <stop offset="100%" stopColor="#C36BFF" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id={gradLeft} x1="4" y1="13" x2="18" y2="32" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#E19EFF" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#5D16B8" stopOpacity="0.88" />
          </linearGradient>
          <linearGradient id={gradRight} x1="32" y1="13" x2="18" y2="32" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#9B3CF5" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#350B78" stopOpacity="0.95" />
          </linearGradient>
          <linearGradient id={gradShine} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
            <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.92" />
            <stop offset="100%" stopColor="#E0F2FE" stopOpacity="0" />
          </linearGradient>
          <clipPath id={clipGem}>
            <path d="M9.5 5.5H26.5L32.5 13.5L18 32L3.5 13.5L9.5 5.5Z" />
          </clipPath>
        </defs>

        {/* Ambient Crystal Halo */}
        <circle cx="18" cy="18" r="15.5" fill="#C084FC" fillOpacity="0.2" />

        {/* Base Cut Silhouette */}
        <path
          d="M9.5 5.5H26.5L32.5 13.5L18 32L3.5 13.5L9.5 5.5Z"
          fill={`url(#${gradBody})`}
          stroke="#F5D0FE"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />

        {/* Faceted Geometry */}
        <path d="M12.5 5.5H23.5L25.5 13.5H10.5L12.5 5.5Z" fill={`url(#${gradTop})`} />
        <path d="M3.5 13.5H10.5L18 32L3.5 13.5Z" fill={`url(#${gradLeft})`} />
        <path d="M25.5 13.5H32.5L18 32L25.5 13.5Z" fill={`url(#${gradRight})`} />
        <path
          d="M10.5 13.5H25.5L18 32L10.5 13.5Z"
          fill="#C66BFF"
          fillOpacity="0.5"
        />

        {/* Crisp Luminous Facet Edges */}
        <path
          d="M3.5 13.5H32.5M12.5 5.5L10.5 13.5L18 32L25.5 13.5L23.5 5.5"
          stroke="#FAE8FF"
          strokeOpacity="0.72"
          strokeWidth="1"
          strokeLinejoin="round"
        />

        {/* Looping Prismatic Shimmer Sweep */}
        {animated && (
          <g clipPath={`url(#${clipGem})`}>
            <rect
              x="-16"
              y="0"
              width="12"
              height="36"
              fill={`url(#${gradShine})`}
              className="eyvan-currency-sweep-delayed"
            />
          </g>
        )}

        {/* Twinkling Crystal Stars */}
        {animated && (
          <>
            <path
              d="M29.5 3.5L30.6 6.2L33.3 7.3L30.6 8.4L29.5 11.1L28.4 8.4L25.7 7.3L28.4 6.2L29.5 3.5Z"
              fill="#FAF5FF"
              className="eyvan-twinkle-b"
            />
            <path
              d="M6.2 21.5L7 23.4L8.9 24.2L7 25L6.2 26.9L5.4 25L3.5 24.2L5.4 23.4L6.2 21.5Z"
              fill="#E9D5FF"
              className="eyvan-twinkle-a"
            />
          </>
        )}
      </svg>
    </span>
  );
};

interface CurrencyCapsuleProps {
  kind: 'coins' | 'gems';
  amount: number;
  onClick?: () => void;
  ariaLabel?: string;
  size?: 'sm' | 'md';
}

/**
 * Sculpted AAA-style Currency Box where the luminous Coin/Gem icon overflows
 * slightly larger than the metallic-rimmed capsule, with subtle looping sheen.
 */
export const CurrencyCapsule: React.FC<CurrencyCapsuleProps> = ({
  kind,
  amount,
  onClick,
  ariaLabel,
  size = 'sm',
}) => {
  const isCoins = kind === 'coins';
  const iconSize = size === 'md' ? 32 : 28;
  const Wrapper: React.ElementType = onClick ? 'button' : 'div';

  return (
    <Wrapper
      {...(onClick
        ? {
            type: 'button',
            onClick,
            'aria-label': ariaLabel,
          }
        : { 'aria-label': ariaLabel })}
      data-testid={`currency-capsule-${kind}`}
      className={`group relative inline-flex items-center select-none overflow-visible ${
        size === 'md' ? 'h-[34px] pr-2 pl-3.5' : 'h-[30px] sm:h-[32px] pr-1.5 pl-2.5 sm:pl-3'
      } rounded-full transition-transform duration-150 ${
        onClick ? 'cursor-pointer hover:scale-[1.03] active:scale-[0.97]' : ''
      } ${
        isCoins ? 'eyvan-currency-box-coin' : 'eyvan-currency-box-gem'
      }`}
    >
      {/* Internal glossy shimmer track clipped strictly to the capsule */}
      <span
        className="pointer-events-none absolute inset-0 rounded-full overflow-hidden"
        aria-hidden="true"
      >
        <span
          className={`absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 ${
            isCoins
              ? 'bg-gradient-to-r from-transparent via-[#FFF2B2]/28 to-transparent eyvan-capsule-sheen'
              : 'bg-gradient-to-r from-transparent via-[#F0ABFC]/28 to-transparent eyvan-capsule-sheen-delayed'
          }`}
        />
      </span>

      {/* Oversized Luminous Icon breaking out of the capsule edge */}
      <span className="relative z-10 -my-2 -mr-2.5 ml-1.5 flex items-center justify-center shrink-0">
        {isCoins ? (
          <GoldCoinSvg size={iconSize} animated />
        ) : (
          <PurpleGemSvg size={iconSize} animated />
        )}
      </span>

      <span className="relative z-10 text-[11px] sm:text-xs font-black tabular-nums tracking-tight whitespace-nowrap theme-heading">
        {toPersianDigits(amount.toLocaleString())}
      </span>
    </Wrapper>
  );
};
