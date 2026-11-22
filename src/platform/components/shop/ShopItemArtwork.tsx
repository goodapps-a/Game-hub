import React from 'react';
import { ShopItem } from '../../types/platform';

interface ShopItemArtworkProps {
  item: ShopItem;
  variant?: 'card' | 'detail';
}

/**
 * Clean high-contrast artwork container for shop items: uses real product artwork
 * images when provided, or crisp scalable Persian geometric motif vectors.
 */
export const ShopItemArtwork: React.FC<ShopItemArtworkProps> = ({
  item,
  variant = 'card',
}) => {
  const [c1, c2, c3] = item.palette;
  const aspectClass =
    variant === 'detail'
      ? 'w-full aspect-[4/3] sm:aspect-[16/11] rounded-2xl'
      : 'w-full h-32 sm:h-36 rounded-xl';

  if (item.imageSrc) {
    return (
      <div
        className={`${aspectClass} overflow-hidden relative bg-[#0B172C] border border-[var(--eyvan-line)]`}
      >
        <img
          src={item.imageSrc}
          alt={item.name}
          decoding="sync"
          loading="eager"
          referrerPolicy="no-referrer"
          className={`w-full h-full object-cover object-center ${
            item.imageCropScale ? 'scale-[1.12]' : ''
          }`}
        />
      </div>
    );
  }

  return (
    <div
      className={`${aspectClass} overflow-hidden relative flex items-center justify-center border border-[var(--eyvan-line)]`}
      style={{ backgroundColor: c1 }}
    >
      <svg
        viewBox="0 0 240 150"
        fill="none"
        className="w-full h-full"
        aria-hidden="true"
      >
        <rect width="240" height="150" fill={c1} />
        <rect
          x="10"
          y="10"
          width="220"
          height="130"
          rx="10"
          stroke={c3}
          strokeWidth="1.4"
          strokeOpacity="0.55"
        />

        {item.motif === 'shamsa' && (
          <g>
            <circle
              cx="120"
              cy="75"
              r="42"
              fill={c2}
              fillOpacity="0.34"
              stroke={c3}
              strokeWidth="1.5"
            />
            <path
              d="M120 35L130 60L156 56L140 75L156 94L130 90L120 115L110 90L84 94L100 75L84 56L110 60L120 35Z"
              fill={c3}
              fillOpacity="0.92"
            />
            <circle
              cx="120"
              cy="75"
              r="12"
              fill={c1}
              stroke={c2}
              strokeWidth="2.2"
            />
          </g>
        )}

        {item.motif === 'arch' && (
          <g>
            <path
              d="M68 130V68C68 42 92 27 120 18C148 27 172 42 172 68V130"
              fill={c2}
              fillOpacity="0.24"
              stroke={c3}
              strokeWidth="2"
            />
            <rect
              x="95"
              y="42"
              width="50"
              height="72"
              rx="6"
              fill="#FCFBF8"
              stroke={c3}
              strokeWidth="1.6"
            />
            <path d="M120 62L131 78L120 94L109 78L120 62Z" fill={c2} />
          </g>
        )}

        {item.motif === 'kashi' && (
          <g>
            {[0, 1, 2].map((col) => (
              <path
                key={col}
                d={`M${68 + col * 52} 36L${94 + col * 52} 75L${68 + col * 52} 114L${42 + col * 52} 75Z`}
                fill={col === 1 ? c3 : c2}
                fillOpacity={col === 1 ? '0.88' : '0.45'}
                stroke={c3}
                strokeWidth="1.3"
              />
            ))}
          </g>
        )}

        {item.motif === 'carpet' && (
          <g>
            <rect
              x="32"
              y="24"
              width="176"
              height="102"
              rx="8"
              fill={c2}
              fillOpacity="0.6"
              stroke={c3}
              strokeWidth="1.5"
            />
            <path
              d="M120 38L165 75L120 112L75 75L120 38Z"
              fill={c1}
              stroke={c3}
              strokeWidth="1.5"
            />
            <circle cx="120" cy="75" r="13" fill={c3} fillOpacity="0.9" />
          </g>
        )}

        {item.motif === 'star' && (
          <g>
            <circle
              cx="120"
              cy="75"
              r="44"
              stroke={c3}
              strokeWidth="1.1"
              strokeDasharray="3 4"
            />
            <path
              d="M120 36L132 62L160 75L132 88L120 114L108 88L80 75L108 62L120 36Z"
              fill={c2}
              stroke={c3}
              strokeWidth="1.6"
            />
            <circle cx="120" cy="75" r="9" fill={c3} />
          </g>
        )}

        {item.motif === 'cypress' && (
          <g>
            <path
              d="M120 26C138 48 146 72 146 94C146 111 135 122 120 122C105 122 94 111 94 94C94 72 102 48 120 26Z"
              fill={c2}
              fillOpacity="0.88"
              stroke={c3}
              strokeWidth="1.6"
            />
            <path
              d="M120 44C130 59 134 76 134 94C134 103 128 110 120 110C112 110 106 103 106 94C106 76 110 59 120 44Z"
              stroke={c3}
              strokeWidth="1.1"
              strokeOpacity="0.85"
            />
          </g>
        )}
      </svg>
    </div>
  );
};
