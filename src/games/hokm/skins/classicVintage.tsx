import React from 'react';
import { SuitMark } from './suitGlyphs';
import { AceBox, CourtBox, DecorLayer, DoubleHeaded } from './courtLayout';
import { polar, starPoints, useSvgUid } from './svgUtils';
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
 * CLASSIC VINTAGE — old printed playing cards: aged cream stock, bold black
 * woodcut outlines, hatching and a limited four-ink palette (red, blue,
 * yellow, flesh) with a navy cross-hatched back.
 */

const BLACK = '#2B2118';
const BROWN = '#8C7350';
const CREAM = '#F4E8C6';
const NAVY = '#1F3A5F';
const RED = '#B3302A';
const BLUE = '#2D5AA0';
const YELLOW = '#E2B341';
const FLESH = '#F2D3A2';
const WHITE_HAIR = '#D9D2BE';

const HATCH = (() => {
  const seg: string[] = [];
  for (let k = -150; k <= 150; k += 5) {
    seg.push(`M${k} 0L${k + 144} 144`);
    seg.push(`M${k} 144L${k + 144} 0`);
  }
  return seg.join('');
})();

const SUN = (cx: number, cy: number, r1: number, r2: number, n: number) =>
  Array.from({ length: n }, (_, i) => {
    const [x1, y1] = polar(cx, cy, r1, (i * 360) / n);
    const [x2, y2] = polar(cx, cy, r2, (i * 360) / n);
    return `M${x1} ${y1}L${x2} ${y2}`;
  }).join('');

const ACE_RAYS = SUN(50, 50, 34, 40, 24);

const VintageBack: React.FC<SkinBackProps> = ({ className = '' }) => {
  const uid = useSvgUid('cv-back');
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
          <rect x="11.5" y="11.5" width="77" height="121" rx="2" />
        </clipPath>
      </defs>
      <rect x="0.5" y="0.5" width="99" height="143" rx="8" fill="#E9DAB0" stroke={BROWN} />
      <rect x="3.2" y="3.2" width="93.6" height="137.6" rx="5.5" stroke={NAVY} strokeWidth="0.8" />
      <rect x="7.5" y="7.5" width="85" height="129" rx="3" stroke={NAVY} strokeWidth="7" />
      <rect x="7.5" y="7.5" width="85" height="129" rx="3" stroke="#E9DAB0" strokeWidth="1" strokeDasharray="2 2" />
      <rect x="11.5" y="11.5" width="77" height="121" rx="2" stroke={NAVY} strokeWidth="0.8" />
      <path d={HATCH} stroke={NAVY} strokeWidth="0.35" strokeOpacity="0.5" clipPath={`url(#${uid}-clip)`} />
      <ellipse cx="50" cy="72" rx="27" ry="37" fill="#E9DAB0" stroke={NAVY} strokeWidth="1.5" />
      <ellipse cx="50" cy="72" rx="23" ry="33" stroke={RED} strokeWidth="0.8" />
      {[0, 45, 90, 135].map((deg) => (
        <ellipse key={deg} cx="50" cy="72" rx="3.2" ry="13" transform={`rotate(${deg} 50 72)`} fill={NAVY} />
      ))}
      <circle cx="50" cy="72" r="4.2" fill={RED} stroke="#E9DAB0" strokeWidth="1" />
      <polygon points={starPoints(50, 42, 3.6, 1.6, 5)} fill={RED} />
      <polygon points={starPoints(50, 102, 3.6, 1.6, 5)} fill={RED} />
    </svg>
  );
};

const VintageDecor: React.FC<SkinDecorProps> = () => (
  <DecorLayer>
    <rect x="3.2" y="3.2" width="93.6" height="137.6" rx="3" stroke={BROWN} strokeWidth="0.8" fill="none" />
    <rect x="4.9" y="4.9" width="90.2" height="134.2" rx="2" stroke={BROWN} strokeWidth="0.3" fill="none" />
    <rect x="90.4" y="7.6" width="2.4" height="2.4" fill={BROWN} />
    <rect x="7.2" y="134" width="2.4" height="2.4" fill={BROWN} />
  </DecorLayer>
);

const VintageAce: React.FC<SkinAceProps> = ({ suit, ink }) => (
  <AceBox>
    <ellipse cx="50" cy="50" rx="44" ry="47" fill={CREAM} stroke={BLACK} strokeWidth="1.8" />
    <ellipse cx="50" cy="50" rx="40.6" ry="43.6" stroke={BLACK} strokeWidth="0.5" fill="none" />
    <path d={ACE_RAYS} stroke={BLACK} strokeWidth="0.8" strokeLinecap="round" />
    <polygon points={starPoints(50, 9, 3.6, 1.6, 5)} fill={YELLOW} stroke={BLACK} strokeWidth="0.5" strokeLinejoin="round" />
    <polygon points={starPoints(50, 91, 3.6, 1.6, 5)} fill={YELLOW} stroke={BLACK} strokeWidth="0.5" strokeLinejoin="round" />
    <SuitMark suit={suit} x={50} y={51} size={46} fill={ink} stroke={BLACK} strokeWidth={1.5} />
  </AceBox>
);

const VintageHalf: React.FC<{ rank: CourtRank; suit: Suit; ink: string; hatch: string }> = ({
  rank,
  suit,
  ink,
  hatch,
}) => {
  const isRed = SUIT_META[suit].isRed;
  const robe = isRed ? RED : BLUE;
  const cap = isRed ? BLUE : RED;
  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      {rank === 'Q' && (
        <path d="M21.5 18Q15.5 32 21 47L26 38ZM38.5 18Q44.5 32 39 47L34 38Z" fill="#C98A2B" stroke={BLACK} strokeWidth="1" />
      )}
      <path d="M5 60L9 41Q30 32 51 41L55 60Z" fill={robe} stroke={BLACK} strokeWidth="1.3" />
      <path d="M5 60L9 41Q18 36.4 24 36L26 60Z" fill={hatch} />
      <path d="M28 37H32L33.5 60H26.5Z" fill={YELLOW} stroke={BLACK} strokeWidth="1" />
      <path d="M27 30H33V38H27Z" fill={FLESH} stroke={BLACK} strokeWidth="1" />
      {rank === 'K' &&
        [18, 24, 30, 36, 42].map((x) => (
          <circle key={x} cx={x} cy="41.4" r="3.1" fill="#F7EFD6" stroke={BLACK} strokeWidth="1" />
        ))}
      {rank === 'Q' && <path d="M15 40Q30 51 45 40Q30 37 15 40Z" fill="#F7EFD6" stroke={BLACK} strokeWidth="1" />}
      {rank === 'J' && <path d="M17 41Q30 36 43 41L40 45Q30 41.4 20 45Z" fill={YELLOW} stroke={BLACK} strokeWidth="1" />}
      <ellipse cx="30" cy="24" rx="7.5" ry="8.8" fill={FLESH} stroke={BLACK} strokeWidth="1.3" />
      {rank === 'J' && (
        <path d="M22 20Q22 11.6 30 11.6Q38 11.6 38 20L39 28Q37 22.6 30 21.4Q23 22.6 21 28Z" fill="#6B4A24" stroke={BLACK} strokeWidth="1" />
      )}
      <path d="M25.6 22.6H28.6M31.4 22.6H34.4" stroke={BLACK} strokeWidth="1.2" />
      <path d="M30 23.6V27H31.4" stroke={BLACK} strokeWidth="0.9" fill="none" />
      <path d="M27.6 30.4H32.4" stroke={BLACK} strokeWidth="1" />
      {rank === 'K' && (
        <>
          <path d="M23 27Q22 40 30 46Q38 40 37 27Q34 33.4 30 33.4Q26 33.4 23 27Z" fill={WHITE_HAIR} stroke={BLACK} strokeWidth="1" />
          <path d="M25 28.4Q30 25.8 35 28.4Q30 29.8 25 28.4Z" fill={WHITE_HAIR} stroke={BLACK} strokeWidth="0.8" />
        </>
      )}
      {rank === 'K' && (
        <>
          <path d="M21.5 16.4L22.5 6.4L26.5 11.2L30 4.4L33.5 11.2L37.5 6.4L38.5 16.4Z" fill={YELLOW} stroke={BLACK} strokeWidth="1.3" />
          <path d="M30 4.4V1M28.6 2.4H31.4" stroke={BLACK} strokeWidth="1" />
        </>
      )}
      {rank === 'Q' && (
        <path d="M22 17.4L23 9.4L26.5 13.4L30 7.4L33.5 13.4L37 9.4L38 17.4Z" fill={YELLOW} stroke={BLACK} strokeWidth="1.3" />
      )}
      {rank === 'J' && (
        <>
          <path d="M21.5 18.2Q20 8.4 30 7.4Q40 8.4 38.5 18.2Q30 14 21.5 18.2Z" fill={cap} stroke={BLACK} strokeWidth="1.3" />
          <path d="M36 9.4Q46 1.4 50 4.4Q44 5.4 40 13.4Z" fill={YELLOW} stroke={BLACK} strokeWidth="0.9" />
        </>
      )}
      {rank === 'K' && (
        <>
          <path d="M50 14V60" stroke={BLACK} strokeWidth="1.8" />
          <path d="M45.5 40H54.5" stroke={BLACK} strokeWidth="1.6" />
          <circle cx="50" cy="46" r="2.6" fill={FLESH} stroke={BLACK} strokeWidth="1" />
        </>
      )}
      {rank === 'Q' && (
        <>
          <path d="M50 60V42" stroke="#3E6B3A" strokeWidth="1.3" />
          <path d="M50 50Q54.6 47 55.6 50.8Q52 52.4 50 50Z" fill="#6FA06A" stroke={BLACK} strokeWidth="0.7" />
          <circle cx="50" cy="38" r="4.2" fill={RED} stroke={BLACK} strokeWidth="1" />
          <circle cx="50" cy="38" r="1.5" fill={YELLOW} stroke={BLACK} strokeWidth="0.5" />
          <circle cx="50" cy="46.4" r="2.2" fill={FLESH} stroke={BLACK} strokeWidth="1" />
        </>
      )}
      {rank === 'J' && (
        <>
          <path d="M50 12V60" stroke={BLACK} strokeWidth="1.5" />
          <path d="M50 12Q58 14 55.6 22.4Q52 20.4 50 20.4Z" fill="#CFCFC4" stroke={BLACK} strokeWidth="1" />
          <circle cx="50" cy="46" r="2.4" fill={FLESH} stroke={BLACK} strokeWidth="1" />
        </>
      )}
      <circle cx="30" cy="52" r="5.2" fill="#F7EFD6" stroke={BLACK} strokeWidth="1.2" />
      <SuitMark suit={suit} x={30} y={52.2} size={7} fill={ink} />
    </g>
  );
};

const VintageCourt: React.FC<SkinCourtProps> = ({ rank, suit, ink }) => {
  const uid = useSvgUid('cv-court');
  return (
    <CourtBox border={BLACK} background={CREAM} borderWidth={1.2} radius={1}>
      <defs>
        <pattern id={`${uid}-hatch`} width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="3" stroke={BLACK} strokeWidth="0.7" strokeOpacity="0.5" />
        </pattern>
      </defs>
      <rect width="60" height="120" fill={CREAM} />
      <path d="M0 60H60" stroke={BLACK} strokeWidth="0.8" />
      <DoubleHeaded>
        <VintageHalf rank={rank} suit={suit} ink={ink} hatch={`url(#${uid}-hatch)`} />
      </DoubleHeaded>
    </CourtBox>
  );
};

export const CLASSIC_VINTAGE_SKIN: CardSkin = {
  id: 'classic-vintage',
  name: 'کلاسیک قدیمی',
  englishName: 'Classic Vintage',
  description:
    'حال‌وهوای ورق‌های چاپی قدیمی: کاغذ کاهی، خطوط ضخیم چوب‌کنده، هاشور و چهار رنگ ساده؛ پشت ورق سرمه‌ای هاشورخورده با قاب بیضی.',
  price: 1200,
  currency: 'coins',
  rarity: 'rare',
  palette: ['#1F3A5F', '#B3302A', '#EFE2BE'],
  face: {
    paper: 'linear-gradient(180deg,#F4E9C9 0%,#EAD9AB 100%)',
    border: BROWN,
    inkRed: '#A62A24',
    inkBlack: BLACK,
    indexFontFamily: 'Georgia, "Times New Roman", serif',
    indexFontWeight: 700,
    innerEdge: 'inset 0 0 0 1px rgba(91,70,49,0.28), inset 0 0 12px rgba(120,90,40,0.18)',
  },
  backFrame: { background: '#F2E6C4', border: BROWN },
  Back: VintageBack,
  Decor: VintageDecor,
  Ace: VintageAce,
  Court: VintageCourt,
};
