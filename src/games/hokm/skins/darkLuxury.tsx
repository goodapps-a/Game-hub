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

/**
 * DARK LUXURY — obsidian paper, gold-foil linework, art-deco geometry:
 * sunbursts, stepped crowns, chevrons. Red suits glow rose-crimson, black
 * suits are printed in ivory so every index stays readable on the dark card.
 */

const GOLD = '#C9A55A';
const GOLD_DEEP = '#8E6F2E';
const OBSIDIAN = '#0B0C10';
const PANEL = '#14171E';
const PANEL_LIGHT = '#1C2029';
const PALE = '#E9D9B5';

const LATTICE = (() => {
  const seg: string[] = [];
  for (let k = -150; k <= 150; k += 12) {
    seg.push(`M${k} 0L${k + 144} 144`);
    seg.push(`M${k} 144L${k + 144} 0`);
  }
  return seg.join('');
})();

const burst = (cx: number, cy: number, r1: number, r2: number, count: number, offset = 0) =>
  Array.from({ length: count }, (_, i) => {
    const deg = offset + (i * 360) / count;
    const [x1, y1] = polar(cx, cy, r1, deg);
    const [x2, y2] = polar(cx, cy, r2, deg);
    return `M${x1} ${y1}L${x2} ${y2}`;
  }).join('');

const BACK_RAYS = burst(50, 72, 14, 31, 24);
const ACE_RAYS = burst(50, 52, 31, 46, 28);
const HALO_RAYS = burst(30, 23, 11, 21, 18, -90);

const DarkBack: React.FC<SkinBackProps> = ({ className = '' }) => {
  const uid = useSvgUid('dl-back');
  return (
    <svg
      viewBox="0 0 100 144"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`w-full h-full block ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${uid}-gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F0D58A" />
          <stop offset="55%" stopColor="#C9A55A" />
          <stop offset="100%" stopColor="#8E6F2E" />
        </linearGradient>
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#14171E" />
          <stop offset="100%" stopColor="#07080B" />
        </linearGradient>
        <clipPath id={`${uid}-clip`}>
          <rect x="9" y="9" width="82" height="126" rx="2" />
        </clipPath>
      </defs>
      <rect width="100" height="144" rx="8" fill={`url(#${uid}-bg)`} />
      <rect x="3.5" y="3.5" width="93" height="137" rx="5" stroke={`url(#${uid}-gold)`} strokeWidth="1.2" />
      <rect x="7" y="7" width="86" height="130" rx="3" stroke={GOLD} strokeWidth="0.45" strokeOpacity="0.7" />
      <path d={LATTICE} stroke={GOLD} strokeWidth="0.3" strokeOpacity="0.16" clipPath={`url(#${uid}-clip)`} />
      <path d={BACK_RAYS} stroke={`url(#${uid}-gold)`} strokeWidth="0.55" strokeLinecap="round" />
      <path d="M50 38L68 72L50 106L32 72Z" fill={OBSIDIAN} stroke={`url(#${uid}-gold)`} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M50 48L61 72L50 96L39 72Z" fill={`url(#${uid}-gold)`} />
      <path d="M50 61L55.4 72L50 83L44.6 72Z" fill={OBSIDIAN} stroke={GOLD_DEEP} strokeWidth="0.5" />
      <path d="M38 25L50 17L62 25M38 119L50 127L62 119" stroke={`url(#${uid}-gold)`} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 22V13H22M87 22V13H78M13 122V131H22M87 122V131H78" stroke={GOLD} strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const DarkDecor: React.FC<SkinDecorProps> = () => (
  <DecorLayer>
    <path d="M8 3.4H92L96.6 8V136L92 140.6H8L3.4 136V8Z" stroke={GOLD} strokeWidth="0.6" strokeOpacity="0.8" fill="none" strokeLinejoin="round" />
    <path d="M9 5.4H91L94.6 9V135L91 138.6H9L5.4 135V9Z" stroke={GOLD_DEEP} strokeWidth="0.25" strokeOpacity="0.8" fill="none" strokeLinejoin="round" />
  </DecorLayer>
);

const DarkAce: React.FC<SkinAceProps> = ({ suit, ink }) => (
  <AceBox>
    <path d={ACE_RAYS} stroke={GOLD} strokeWidth="0.8" strokeLinecap="round" strokeOpacity="0.9" />
    <path d="M50 4L96 50L50 96L4 50Z" fill={PANEL} stroke={GOLD} strokeWidth="1.1" strokeLinejoin="round" />
    <path d="M50 11L89 50L50 89L11 50Z" stroke={GOLD_DEEP} strokeWidth="0.4" fill="none" strokeLinejoin="round" />
    <SuitMark suit={suit} x={50} y={52} size={46} fill={ink} stroke={GOLD} strokeWidth={0.9} />
  </AceBox>
);

const DarkHalf: React.FC<{ rank: CourtRank; suit: Suit; ink: string; gold: string }> = ({
  rank,
  suit,
  ink,
  gold,
}) => (
  <g>
    <path d={HALO_RAYS} stroke={GOLD} strokeWidth="0.5" strokeOpacity="0.6" strokeLinecap="round" />
    {rank === 'Q' && (
      <path d="M22.5 25Q20.6 13.4 30 12.6Q39.4 13.4 37.5 25L36.6 32Q35 21 30 19.4Q25 21 23.4 32Z" fill={OBSIDIAN} stroke={GOLD} strokeWidth="0.5" strokeLinejoin="round" />
    )}
    <path d="M4 60L9 42L30 36L51 42L56 60Z" fill={PANEL_LIGHT} stroke={gold} strokeWidth="1" strokeLinejoin="round" />
    <path d="M30 36L36.6 42.4L30 60L23.4 42.4Z" fill={ink} fillOpacity="0.92" stroke={gold} strokeWidth="0.5" strokeLinejoin="round" />
    <path d="M13 47L22 54M47 47L38 54M10 53L18 59M50 53L42 59" stroke={GOLD} strokeWidth="0.6" strokeOpacity="0.8" strokeLinecap="round" />
    <path d="M27 30H33V37H27Z" fill="#2A2E39" stroke={GOLD} strokeWidth="0.5" />
    <ellipse cx="30" cy="24" rx="6.6" ry="8" fill={PALE} stroke={GOLD} strokeWidth="0.5" />
    <path d="M25.6 22.6H28.6M31.4 22.6H34.4" stroke={OBSIDIAN} strokeWidth="1" strokeLinecap="round" />
    <path d="M28.2 29Q30 30.4 31.8 29" stroke="#B2445A" strokeWidth="0.8" fill="none" strokeLinecap="round" />
    {rank === 'K' && (
      <>
        <path d="M21 17.6V9.4H25V12.4H27.6V6.2H32.4V12.4H35V9.4H39V17.6Z" fill={gold} stroke={GOLD_DEEP} strokeWidth="0.5" strokeLinejoin="round" />
        <path d="M30 8.2L31.6 10.4L30 12.6L28.4 10.4Z" fill={ink} />
      </>
    )}
    {rank === 'Q' && (
      <>
        <path d="M21.4 18Q30 3.4 38.6 18Q30 11.4 21.4 18Z" fill={gold} stroke={GOLD_DEEP} strokeWidth="0.5" strokeLinejoin="round" />
        <circle cx="21.6" cy="17.8" r="1.2" fill={ink} />
        <circle cx="30" cy="5.8" r="1.3" fill={ink} />
        <circle cx="38.4" cy="17.8" r="1.2" fill={ink} />
      </>
    )}
    {rank === 'J' && (
      <>
        <path d="M28.4 8.6L34.4 2.6L36.4 11.6Z" fill={gold} stroke={GOLD_DEEP} strokeWidth="0.4" strokeLinejoin="round" />
        <path d="M22.5 20.4Q22.5 10 30 8Q37.5 10 37.5 20.4Z" fill="#2A2E39" stroke={gold} strokeWidth="0.6" strokeLinejoin="round" />
        <path d="M22.5 20.4H37.5" stroke={gold} strokeWidth="1" />
      </>
    )}
    {rank === 'K' && (
      <>
        <path d="M50 20V60" stroke={gold} strokeWidth="1.3" />
        <path d="M50 11L52.8 15.6L50 20.2L47.2 15.6Z" fill={ink} stroke={gold} strokeWidth="0.4" strokeLinejoin="round" />
      </>
    )}
    {rank === 'Q' && (
      <>
        <circle cx="49.5" cy="44" r="3.4" fill={ink} stroke={gold} strokeWidth="0.6" />
        <path d="M49.5 38.4V36M49.5 49.6V52M43.9 44H41.5M55.1 44H57.5" stroke={gold} strokeWidth="0.6" strokeLinecap="round" />
      </>
    )}
    {rank === 'J' && (
      <>
        <path d="M50 8L51.7 40H48.3Z" fill="#C9CED8" stroke={gold} strokeWidth="0.4" strokeLinejoin="round" />
        <path d="M45.4 40H54.6" stroke={gold} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M50 40V56" stroke={gold} strokeWidth="1.2" />
      </>
    )}
    <SuitMark suit={suit} x={30} y={51} size={7.4} fill={PANEL} stroke={gold} strokeWidth={0.5} />
  </g>
);

const DarkCourt: React.FC<SkinCourtProps> = ({ rank, suit, ink }) => {
  const uid = useSvgUid('dl-court');
  const gold = `url(#${uid}-gold)`;
  return (
    <CourtBox border="#A8843A" background="#12151B" borderWidth={1}>
      <defs>
        <linearGradient id={`${uid}-gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F0D58A" />
          <stop offset="55%" stopColor="#C9A55A" />
          <stop offset="100%" stopColor="#8E6F2E" />
        </linearGradient>
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#171A22" />
          <stop offset="50%" stopColor="#0D0F14" />
          <stop offset="100%" stopColor="#171A22" />
        </linearGradient>
      </defs>
      <rect width="60" height="120" fill={`url(#${uid}-bg)`} />
      <path d={LATTICE} stroke={GOLD} strokeWidth="0.25" strokeOpacity="0.12" />
      <path d="M0 60H60" stroke={GOLD} strokeWidth="0.5" strokeOpacity="0.7" />
      <DoubleHeaded>
        <DarkHalf rank={rank} suit={suit} ink={ink} gold={gold} />
      </DoubleHeaded>
    </CourtBox>
  );
};

export const DARK_LUXURY_SKIN: CardSkin = {
  id: 'dark-luxury',
  name: 'لوکس تاریک',
  englishName: 'Dark Luxury',
  description:
    'زمینه سیاه مات با خطوط ورق طلا به سبک آرت‌دکو: تاج‌های پلکانی، هاله پرتوی، و پشت ورق با الماس طلایی؛ ارقام روی زمینه تیره کاملاً خوانا.',
  price: 120,
  currency: 'gems',
  rarity: 'legendary',
  palette: ['#0B0C10', '#C9A55A', '#FF5468'],
  face: {
    paper: 'linear-gradient(160deg,#171A22 0%,#0B0D11 100%)',
    border: GOLD_DEEP,
    inkRed: '#FF5468',
    inkBlack: '#EDE4CF',
    indexFontFamily: '"Cinzel", "Times New Roman", Georgia, serif',
    indexFontWeight: 700,
    pipOutline: { color: GOLD, width: 0.4 },
    innerEdge: 'inset 0 0 0 1px rgba(226,194,117,0.22), inset 0 0 14px rgba(0,0,0,0.6)',
  },
  backFrame: { background: '#0B0C10', border: GOLD_DEEP },
  Back: DarkBack,
  Decor: DarkDecor,
  Ace: DarkAce,
  Court: DarkCourt,
};
