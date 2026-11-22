import React from 'react';
import { SuitMark } from './suitGlyphs';
import { AceBox, CourtBox, DecorLayer, DoubleHeaded } from './courtLayout';
import { polar, useSvgUid } from './svgUtils';
import type {
  CardSkin,
  CourtRank,
  SkinAceProps,
  SkinBackProps,
  SkinCourtProps,
  SkinDecorProps,
} from './types';
import type { Suit } from '../engine/types';
import { SUIT_META } from '../engine/types';

/**
 * ROYAL GOLD — European court style: ivory paper, burnished gold leaf,
 * crimson / royal-blue robes with ermine collars, crowns with jewels.
 */

const GOLD = '#C9A227';
const GOLD_BRIGHT = '#E3C253';
const GOLD_DEEP = '#8F6A12';
const IVORY = '#FBF3DC';
const CRIMSON = '#9B1C2E';
const ROYAL = '#1F2F6B';
const SKIN = '#F3D6B0';

const LATTICE = (() => {
  const seg: string[] = [];
  for (let k = -150; k <= 150; k += 14) {
    seg.push(`M${k} 0L${k + 144} 144`);
    seg.push(`M${k} 144L${k + 144} 0`);
  }
  return seg.join('');
})();

const RAYS = Array.from({ length: 16 }, (_, i) => {
  const [x1, y1] = polar(50, 72, 21.5, i * 22.5);
  const [x2, y2] = polar(50, 72, 28, i * 22.5);
  return `M${x1} ${y1}L${x2} ${y2}`;
}).join('');

const RoyalGoldBack: React.FC<SkinBackProps> = ({ className = '' }) => {
  const uid = useSvgUid('rg-back');
  return (
    <svg
      viewBox="0 0 100 144"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`w-full h-full block ${className}`}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={`${uid}-clip`}>
          <rect x="9" y="9" width="82" height="126" rx="3" />
        </clipPath>
        <radialGradient id={`${uid}-med`} cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#7C1429" />
          <stop offset="100%" stopColor="#4A0A18" />
        </radialGradient>
      </defs>
      <rect width="100" height="144" rx="8" fill="#7A1226" />
      <rect x="3.5" y="3.5" width="93" height="137" rx="5.5" stroke={GOLD_BRIGHT} strokeWidth="1.1" />
      <rect x="6.5" y="6.5" width="87" height="131" rx="3.5" stroke={GOLD} strokeWidth="0.5" />
      <path d={LATTICE} stroke={GOLD} strokeWidth="0.45" strokeOpacity="0.4" clipPath={`url(#${uid}-clip)`} />
      <circle cx="50" cy="72" r="22" fill={`url(#${uid}-med)`} stroke={GOLD_BRIGHT} strokeWidth="1.3" />
      <circle cx="50" cy="72" r="18" stroke={GOLD} strokeWidth="0.6" strokeDasharray="1.6 1.6" />
      <path d={RAYS} stroke={GOLD_BRIGHT} strokeWidth="0.9" strokeLinecap="round" />
      <path d="M38 81L40 63L45 71L50 59L55 71L60 63L62 81Z" fill={GOLD_BRIGHT} stroke={GOLD_DEEP} strokeWidth="0.7" strokeLinejoin="round" />
      <path d="M38 81H62V85H38Z" fill={GOLD} stroke={GOLD_DEEP} strokeWidth="0.7" />
      <circle cx="40" cy="62.6" r="1.7" fill="#F6E7A8" />
      <circle cx="50" cy="58.6" r="1.7" fill="#F6E7A8" />
      <circle cx="60" cy="62.6" r="1.7" fill="#F6E7A8" />
      <circle cx="50" cy="76" r="1.8" fill="#C0182B" />
      <path d="M15 15L18 18L15 21L12 18Z" fill={GOLD_BRIGHT} />
      <path d="M85 15L88 18L85 21L82 18Z" fill={GOLD_BRIGHT} />
      <path d="M15 123L18 126L15 129L12 126Z" fill={GOLD_BRIGHT} />
      <path d="M85 123L88 126L85 129L82 126Z" fill={GOLD_BRIGHT} />
    </svg>
  );
};

const RoyalGoldDecor: React.FC<SkinDecorProps> = () => (
  <DecorLayer>
    <rect x="3.2" y="3.2" width="93.6" height="137.6" rx="3" stroke={GOLD} strokeWidth="0.6" strokeOpacity="0.8" fill="none" />
    <rect x="5" y="5" width="90" height="134" rx="2" stroke={GOLD} strokeWidth="0.25" strokeOpacity="0.6" fill="none" />
    <path d="M93 7L95.2 9.2L93 11.4L90.8 9.2Z" fill={GOLD} fillOpacity="0.85" />
    <path d="M7 133L9.2 135.2L7 137.4L4.8 135.2Z" fill={GOLD} fillOpacity="0.85" />
  </DecorLayer>
);

const LAUREL_LEFT = Array.from({ length: 11 }, (_, i) => 108 + i * 14.4);
const LAUREL_RIGHT = Array.from({ length: 11 }, (_, i) => -72 + i * 14.4);

const RoyalGoldAce: React.FC<SkinAceProps> = ({ suit, ink }) => {
  const uid = useSvgUid('rg-ace');
  const leaf = (deg: number, key: string) => {
    const [x, y] = polar(50, 52, 39, deg);
    return (
      <ellipse
        key={key}
        cx={x}
        cy={y}
        rx="6.2"
        ry="2.5"
        transform={`rotate(${deg + 90} ${x} ${y})`}
        fill={`url(#${uid}-g)`}
        stroke={GOLD_DEEP}
        strokeWidth="0.35"
      />
    );
  };
  return (
    <AceBox>
      <defs>
        <linearGradient id={`${uid}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F2D77C" />
          <stop offset="100%" stopColor="#A57C16" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="52" r="46" stroke={GOLD} strokeWidth="1.1" fill="none" />
      <circle cx="50" cy="52" r="43.5" stroke={GOLD} strokeWidth="0.35" fill="none" />
      {LAUREL_LEFT.map((d, i) => leaf(d, `l${i}`))}
      {LAUREL_RIGHT.map((d, i) => leaf(d, `r${i}`))}
      <path d="M43 11L44 4L47 7.5L50 2.5L53 7.5L56 4L57 11Z" fill={`url(#${uid}-g)`} stroke={GOLD_DEEP} strokeWidth="0.5" strokeLinejoin="round" />
      <SuitMark suit={suit} x={50} y={53} size={44} fill={ink} stroke={GOLD} strokeWidth={1.1} />
    </AceBox>
  );
};

const ERMINE_TAILS: Array<[number, number]> = [
  [18, 43.6],
  [24, 46.2],
  [36, 46.2],
  [42, 43.6],
];

const RoyalHalf: React.FC<{ rank: CourtRank; suit: Suit; ink: string }> = ({ rank, suit, ink }) => {
  const robe = SUIT_META[suit].isRed ? CRIMSON : ROYAL;
  const hair = '#6A4520';
  return (
    <g>
      {rank === 'Q' && (
        <path d="M22 19Q16 33 22 47L27 40ZM38 19Q44 33 38 47L33 40Z" fill={hair} stroke={GOLD_DEEP} strokeWidth="0.4" />
      )}
      <path d="M6 60L10 42Q30 33 50 42L54 60Z" fill={robe} stroke={GOLD} strokeWidth="0.8" strokeLinejoin="round" />
      <path d="M27 37.5L30 60L33 37.5Z" fill={GOLD} />
      <path d="M27 30H33V37H27Z" fill={SKIN} stroke="#B98A5A" strokeWidth="0.4" />
      <path d="M12 42Q30 52 48 42Q46 36.5 30 35.5Q14 36.5 12 42Z" fill="#FFFFFF" stroke={GOLD} strokeWidth="0.7" strokeLinejoin="round" />
      {ERMINE_TAILS.map(([x, y]) => (
        <path key={x} d={`M${x - 0.9} ${y - 2.4}L${x} ${y + 0.6}L${x + 0.9} ${y - 2.4}Z`} fill="#1B1B1B" />
      ))}
      <ellipse cx="30" cy="24" rx="7.2" ry="8.4" fill={SKIN} stroke="#9A6B3A" strokeWidth="0.6" />
      <circle cx="27.2" cy="23" r="0.85" fill="#2B1B0E" />
      <circle cx="32.8" cy="23" r="0.85" fill="#2B1B0E" />
      <path d="M25.4 20.8Q27.2 19.8 28.8 20.8M31.2 20.8Q32.8 19.8 34.6 20.8" stroke="#5A3A1A" strokeWidth="0.55" fill="none" strokeLinecap="round" />
      {rank === 'K' ? (
        <>
          <path d="M23.5 26.5Q30 43 36.5 26.5Q36.2 33.5 30 38.5Q23.8 33.5 23.5 26.5Z" fill="#8A6A45" stroke="#5A3A1A" strokeWidth="0.4" />
          <path d="M25.2 27.4Q30 24.8 34.8 27.4Q30 29.6 25.2 27.4Z" fill="#8A6A45" stroke="#5A3A1A" strokeWidth="0.3" />
        </>
      ) : (
        <path d="M28 28.8Q30 30.4 32 28.8" stroke="#B02A3A" strokeWidth="0.7" fill="none" strokeLinecap="round" />
      )}
      {rank === 'K' && (
        <>
          <path d="M21.5 17.8L22.5 7L26.5 12L30 4.5L33.5 12L37.5 7L38.5 17.8Z" fill={GOLD_BRIGHT} stroke={GOLD_DEEP} strokeWidth="0.7" strokeLinejoin="round" />
          <path d="M21.3 17.8H38.7V14.6H21.3Z" fill={GOLD} stroke={GOLD_DEEP} strokeWidth="0.5" />
          <circle cx="30" cy="10.4" r="1.2" fill="#C0182B" />
          <circle cx="25.6" cy="16.2" r="0.9" fill="#2349A8" />
          <circle cx="34.4" cy="16.2" r="0.9" fill="#2349A8" />
          <circle cx="22.5" cy="6.6" r="1" fill="#F6E7A8" />
          <circle cx="30" cy="4.1" r="1" fill="#F6E7A8" />
          <circle cx="37.5" cy="6.6" r="1" fill="#F6E7A8" />
        </>
      )}
      {rank === 'Q' && (
        <>
          <path d="M22 18.2Q22 8.6 30 6.8Q38 8.6 38 18.2Z" fill={GOLD_BRIGHT} stroke={GOLD_DEEP} strokeWidth="0.7" strokeLinejoin="round" />
          {[
            [24, 12.4],
            [27, 9],
            [30, 7.6],
            [33, 9],
            [36, 12.4],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="0.95" fill="#FFFFFF" stroke={GOLD_DEEP} strokeWidth="0.3" />
          ))}
          <circle cx="30" cy="14" r="1.5" fill="#C0182B" stroke={GOLD_DEEP} strokeWidth="0.3" />
        </>
      )}
      {rank === 'J' && (
        <>
          <path d="M21 18Q20 8.6 31 6.6Q41 7.4 41.6 15Q36 12.6 21 18Z" fill={robe} stroke={GOLD} strokeWidth="0.7" strokeLinejoin="round" />
          <path d="M22 16.6Q30 13.4 40.4 14.4" stroke={GOLD} strokeWidth="1" fill="none" />
          <path d="M38 10.4Q47 3 51 6.4Q46 7 41 14Z" fill="#FFFFFF" stroke={GOLD} strokeWidth="0.5" strokeLinejoin="round" />
        </>
      )}
      {rank === 'K' && (
        <>
          <path d="M50 19V60" stroke={GOLD} strokeWidth="1.6" />
          <circle cx="50" cy="16" r="3" fill={GOLD_BRIGHT} stroke={GOLD_DEEP} strokeWidth="0.5" />
          <path d="M50 11.4V13.4M49 12.4H51" stroke={GOLD_DEEP} strokeWidth="0.5" />
          <circle cx="50" cy="46" r="2.3" fill={SKIN} stroke="#9A6B3A" strokeWidth="0.4" />
        </>
      )}
      {rank === 'Q' && (
        <>
          <path d="M49 60V41" stroke="#2F6B3A" strokeWidth="0.9" />
          {[0, 72, 144, 216, 288].map((deg) => {
            const [x, y] = polar(49, 37.5, 2.6, deg - 90);
            return <circle key={deg} cx={x} cy={y} r="2.1" fill="#D8445A" stroke="#8E1B2C" strokeWidth="0.3" />;
          })}
          <circle cx="49" cy="37.5" r="1.3" fill={GOLD_BRIGHT} />
          <circle cx="49" cy="47" r="2.2" fill={SKIN} stroke="#9A6B3A" strokeWidth="0.4" />
        </>
      )}
      {rank === 'J' && (
        <>
          <path d="M50 22V60" stroke="#8A6A2D" strokeWidth="1.3" />
          <path d="M50 12.6L54.2 20.4L50 24.4Z" fill="#D8DCE6" stroke="#6B7280" strokeWidth="0.4" strokeLinejoin="round" />
          <circle cx="50" cy="46" r="2.2" fill={SKIN} stroke="#9A6B3A" strokeWidth="0.4" />
        </>
      )}
      <circle cx="30" cy="52" r="4.8" fill="#FFF8E4" stroke={GOLD} strokeWidth="0.8" />
      <SuitMark suit={suit} x={30} y={52.2} size={6.6} fill={ink} />
    </g>
  );
};

const RoyalGoldCourt: React.FC<SkinCourtProps> = ({ rank, suit, ink }) => {
  const uid = useSvgUid('rg-court');
  return (
    <CourtBox border={GOLD} background={IVORY} borderWidth={1}>
      <defs>
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFBEA" />
          <stop offset="50%" stopColor="#F6E9C4" />
          <stop offset="100%" stopColor="#FFFBEA" />
        </linearGradient>
      </defs>
      <rect width="60" height="120" fill={`url(#${uid}-bg)`} />
      <rect x="2" y="2" width="56" height="116" fill="none" stroke={GOLD} strokeWidth="0.5" />
      <path d="M2 60H58" stroke={GOLD} strokeWidth="0.6" />
      <DoubleHeaded>
        <RoyalHalf rank={rank} suit={suit} ink={ink} />
      </DoubleHeaded>
    </CourtBox>
  );
};

export const ROYAL_GOLD_SKIN: CardSkin = {
  id: 'royal-gold',
  name: 'طلای سلطنتی',
  englishName: 'Royal Gold',
  description:
    'سبک دربار سلطنتی: زمینه عاجی، ورق طلای پرداخت‌شده، شاه و بی‌بی با تاج مرصع و یقه خزِ سفید، و پشت زرشکی با نشان تاج.',
  price: 1650,
  currency: 'coins',
  rarity: 'epic',
  palette: ['#7A1226', '#C9A227', '#FBF3DC'],
  face: {
    paper: 'linear-gradient(180deg,#FFFDF5 0%,#FBF3DC 100%)',
    border: '#C9A94E',
    inkRed: '#A61B2B',
    inkBlack: '#16213F',
    indexFontFamily: '"Playfair Display", "Times New Roman", Georgia, serif',
    indexFontWeight: 800,
    pipOutline: { color: GOLD, width: 0.5 },
    innerEdge: 'inset 0 0 0 1px rgba(201,162,39,0.35)',
  },
  backFrame: { background: '#F6E9C4', border: '#C9A94E' },
  Back: RoyalGoldBack,
  Decor: RoyalGoldDecor,
  Ace: RoyalGoldAce,
  Court: RoyalGoldCourt,
};
