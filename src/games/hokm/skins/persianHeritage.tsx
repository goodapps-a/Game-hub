import React from 'react';
import { SuitMark } from './suitGlyphs';
import { AceBox, CourtBox, DecorLayer, DoubleHeaded } from './courtLayout';
import { polar, starPoints } from './svgUtils';
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
 * PERSIAN HERITAGE — inspired by Persian miniature painting (negargari),
 * tazhib illumination and Tabriz carpets: lapis / turquoise / madder red /
 * saffron gold, mehrab arch panels, flame halos, shamsa medallions.
 */

const LAPIS = '#1B3F7C';
const LAPIS_DEEP = '#14305E';
const TURQ = '#168A8A';
const SAFFRON = '#D9A441';
const SAFFRON_DEEP = '#B8862B';
const MADDER = '#7D1F2A';
const ROSE = '#B02A37';
const JADE = '#17594A';
const CREAM = '#F6EAD0';
const SKIN = '#EBC9A0';
const INKB = '#2A1B12';

const BORDER_DOTS: Array<[number, number]> = (() => {
  const pts: Array<[number, number]> = [];
  for (let x = 14; x <= 86; x += 9) {
    pts.push([x, 5.1]);
    pts.push([x, 138.9]);
  }
  for (let y = 14; y <= 130; y += 9.7) {
    pts.push([5.1, y]);
    pts.push([94.9, y]);
  }
  return pts;
})();

const CORNER_D = 'M9 9H29A20 20 0 0 1 9 29Z';

const PersianBack: React.FC<SkinBackProps> = ({ className = '' }) => (
  <svg
    viewBox="0 0 100 144"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`w-full h-full block ${className}`}
    aria-hidden="true"
  >
    <rect x="0.5" y="0.5" width="99" height="143" rx="8" fill="#F3E6C8" stroke={SAFFRON_DEEP} />
    <rect x="3.5" y="3.5" width="93" height="137" rx="5" fill={LAPIS_DEEP} />
    {BORDER_DOTS.map(([x, y]) => (
      <circle key={`${x}-${y}`} cx={x} cy={y} r="0.9" fill={TURQ} />
    ))}
    <rect x="6.5" y="6.5" width="87" height="131" rx="3" stroke={SAFFRON} strokeWidth="0.8" />
    <rect x="9" y="9" width="82" height="126" rx="2" fill={MADDER} />
    <g fill={LAPIS_DEEP} stroke={SAFFRON} strokeWidth="0.5">
      <path d={CORNER_D} />
      <path d={CORNER_D} transform="translate(100 0) scale(-1 1)" />
      <path d={CORNER_D} transform="translate(0 144) scale(1 -1)" />
      <path d={CORNER_D} transform="translate(100 144) scale(-1 -1)" />
    </g>
    <g fill={TURQ}>
      <circle cx="17" cy="17" r="2" />
      <circle cx="83" cy="17" r="2" />
      <circle cx="17" cy="127" r="2" />
      <circle cx="83" cy="127" r="2" />
    </g>
    <path d="M50 22C71 43 71 101 50 122C29 101 29 43 50 22Z" fill={LAPIS_DEEP} stroke={SAFFRON} strokeWidth="1" />
    <path d="M50 31C65 49 65 95 50 113C35 95 35 49 50 31Z" fill={TURQ} stroke={SAFFRON} strokeWidth="0.6" />
    <path d="M50 40C60 54 60 90 50 104C40 90 40 54 50 40Z" fill={MADDER} stroke={SAFFRON} strokeWidth="0.6" />
    <polygon points={starPoints(50, 72, 13, 6.4, 8)} fill={SAFFRON} stroke={LAPIS_DEEP} strokeWidth="0.6" strokeLinejoin="round" />
    <circle cx="50" cy="72" r="4" fill={LAPIS_DEEP} stroke={SAFFRON} strokeWidth="0.6" />
    <circle cx="50" cy="72" r="1.5" fill={TURQ} />
    <path d="M50 15L52.4 19L50 23L47.6 19Z" fill={SAFFRON} />
    <path d="M50 129L52.4 125L50 121L47.6 125Z" fill={SAFFRON} />
    <polygon points={starPoints(21, 72, 4, 1.6, 4)} fill={SAFFRON} />
    <polygon points={starPoints(79, 72, 4, 1.6, 4)} fill={SAFFRON} />
  </svg>
);

const PersianDecor: React.FC<SkinDecorProps> = () => (
  <DecorLayer>
    <rect x="3.4" y="3.4" width="93.2" height="137.2" rx="3" stroke={LAPIS} strokeWidth="0.7" strokeOpacity="0.9" fill="none" />
    <rect x="5.2" y="5.2" width="89.6" height="133.6" rx="2" stroke={SAFFRON} strokeWidth="0.35" fill="none" />
    <path d="M96.6 3.4V12A8.6 8.6 0 0 1 88 3.4Z" fill={TURQ} fillOpacity="0.85" />
    <path d="M3.4 140.6V132A8.6 8.6 0 0 1 12 140.6Z" fill={TURQ} fillOpacity="0.85" />
  </DecorLayer>
);

const PersianAce: React.FC<SkinAceProps> = ({ suit, ink }) => (
  <AceBox>
    <circle cx="50" cy="50" r="46" fill="#FBF1D6" stroke={SAFFRON_DEEP} strokeWidth="1.3" />
    <polygon points={starPoints(50, 50, 44, 35, 16)} fill={LAPIS} stroke={SAFFRON} strokeWidth="1" strokeLinejoin="round" />
    <circle cx="50" cy="50" r="31" stroke={TURQ} strokeWidth="1.1" strokeDasharray="1.6 2.2" fill="none" />
    <circle cx="50" cy="50" r="28.5" fill="#FFF8E4" stroke={SAFFRON} strokeWidth="0.8" />
    <SuitMark suit={suit} x={50} y={51} size={36} fill={ink} />
  </AceBox>
);

const FLAME_HALO = starPoints(30, 23, 15.5, 11.5, 12);

const PersianHalf: React.FC<{ rank: CourtRank; suit: Suit; ink: string }> = ({ rank, suit, ink }) => {
  const isRed = SUIT_META[suit].isRed;
  const panel = isRed ? LAPIS : JADE;
  const robe = isRed ? ROSE : LAPIS_DEEP;
  return (
    <g>
      <path d="M5 60V27Q5 9 30 3Q55 9 55 27V60Z" fill={panel} stroke={SAFFRON} strokeWidth="1" />
      <path d="M8 60V28Q8 12 30 6.4Q52 12 52 28V60Z" fill="none" stroke={SAFFRON} strokeWidth="0.35" />
      <g fill={SAFFRON} fillOpacity="0.85">
        <circle cx="12" cy="20" r="0.9" />
        <circle cx="48" cy="20" r="0.9" />
        <circle cx="10.5" cy="38" r="0.9" />
        <circle cx="49.5" cy="38" r="0.9" />
        <circle cx="13" cy="50" r="0.9" />
        <circle cx="47" cy="50" r="0.9" />
      </g>
      <polygon points={FLAME_HALO} fill="#F2C14E" stroke={SAFFRON_DEEP} strokeWidth="0.4" strokeLinejoin="round" />
      {rank === 'Q' && (
        <path d="M22 22Q22 12 30 11Q38 12 38 22Q40.6 32 37.6 41L33 33.6Q30 35.4 27 33.6L22.4 41Q19.4 32 22 22Z" fill="#F8EFD8" stroke={SAFFRON} strokeWidth="0.6" strokeLinejoin="round" />
      )}
      <path d="M5 60L9 43Q30 34 51 43L55 60Z" fill={robe} stroke={SAFFRON} strokeWidth="0.8" strokeLinejoin="round" />
      <path d="M7 53Q30 48.6 53 53L53.8 57.4Q30 53 6.2 57.4Z" fill={SAFFRON} />
      <path d="M30 46V52" stroke={SAFFRON} strokeWidth="0.7" />
      <path d="M23 37.6L30 47L37 37.6" stroke={SAFFRON} strokeWidth="1.2" fill="none" strokeLinejoin="round" />
      <g fill={SAFFRON} fillOpacity="0.9">
        <circle cx="15" cy="49" r="0.9" />
        <circle cx="21" cy="57" r="0.9" />
        <circle cx="39" cy="57" r="0.9" />
        <circle cx="45" cy="49" r="0.9" />
      </g>
      <path d="M27.5 31H32.5V38H27.5Z" fill={SKIN} />
      <ellipse cx="30" cy="25" rx="6.8" ry="8.2" fill={SKIN} stroke="#7A4B24" strokeWidth="0.5" />
      <path d="M24.8 21.4Q27.2 19.8 29.4 21.4M30.6 21.4Q32.8 19.8 35.2 21.4" stroke={INKB} strokeWidth="0.9" fill="none" strokeLinecap="round" />
      <path d="M25.6 23.8Q27.4 22.6 29.2 23.8Q27.4 24.8 25.6 23.8ZM30.8 23.8Q32.6 22.6 34.4 23.8Q32.6 24.8 30.8 23.8Z" fill={INKB} />
      <path d="M30 24.4L29.3 28Q30 28.5 30.7 28" stroke="#9A6A3A" strokeWidth="0.4" fill="none" />
      <path d="M28.4 30.6Q30 31.6 31.6 30.6" stroke={MADDER} strokeWidth="0.7" fill="none" strokeLinecap="round" />
      {rank === 'K' && (
        <>
          <path d="M24.6 29.4Q27.5 27.6 30 29Q32.5 27.6 35.4 29.4Q32 30.4 30 29.6Q28 30.4 24.6 29.4Z" fill={INKB} />
          <path d="M24 30.4Q30 40 36 30.4Q34.6 36 30 38Q25.4 36 24 30.4Z" fill={INKB} />
          <path d="M22 19.6H38V16.2H22Z" fill={SAFFRON} stroke="#8A5E12" strokeWidth="0.5" />
          <path d="M22 16.2L23 8L26.5 11.6L30 5L33.5 11.6L37 8L38 16.2Z" fill={SAFFRON} stroke="#8A5E12" strokeWidth="0.6" strokeLinejoin="round" />
          <circle cx="30" cy="12.4" r="1.2" fill={TURQ} />
          <circle cx="25.6" cy="17.9" r="0.9" fill={ROSE} />
          <circle cx="34.4" cy="17.9" r="0.9" fill={ROSE} />
          <path d="M30 5Q28.4 1.6 30.8 0.6Q32.8 2.4 30 5Z" fill={ROSE} />
        </>
      )}
      {rank === 'Q' && (
        <>
          <path d="M23.5 17.4Q30 12.8 36.5 17.4" stroke={SAFFRON} strokeWidth="1.7" fill="none" strokeLinecap="round" />
          <circle cx="26" cy="15.1" r="1" fill={TURQ} />
          <circle cx="30" cy="13.7" r="1.2" fill={ROSE} />
          <circle cx="34" cy="15.1" r="1" fill={TURQ} />
          <circle cx="30" cy="19" r="1.1" fill={ROSE} stroke={SAFFRON} strokeWidth="0.3" />
          <circle cx="22.8" cy="30.4" r="1" fill={SAFFRON} />
          <circle cx="37.2" cy="30.4" r="1" fill={SAFFRON} />
        </>
      )}
      {rank === 'J' && (
        <>
          <path d="M26.4 28.8Q30 27.2 33.6 28.8" stroke={INKB} strokeWidth="1.1" fill="none" strokeLinecap="round" />
          <path d="M22.5 19.6Q22.5 9.6 30 5.4Q37.5 9.6 37.5 19.6Z" fill="#C9CED8" stroke="#5B6472" strokeWidth="0.6" strokeLinejoin="round" />
          <path d="M22.5 19.6H37.5" stroke={SAFFRON} strokeWidth="1.3" />
          <path d="M30 5.4V1.8" stroke="#5B6472" strokeWidth="0.9" />
          <path d="M30 6Q40 2.4 41 10.4Q36 7.2 31 9.6Z" fill={ROSE} />
          <path d="M22.5 19.6Q20.6 28 24 32" stroke="#5B6472" strokeWidth="0.9" fill="none" />
        </>
      )}
      {rank === 'K' && (
        <>
          <path d="M49 47Q55 32 50.4 14" stroke="#C9CED8" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M46.6 47.6H51.8" stroke={SAFFRON} strokeWidth="1.5" />
          <circle cx="49" cy="48" r="2.3" fill={SKIN} stroke="#7A4B24" strokeWidth="0.4" />
        </>
      )}
      {rank === 'Q' && (
        <>
          <path d="M50 60V41" stroke={JADE} strokeWidth="0.9" />
          {[0, 60, 120, 180, 240, 300].map((deg) => {
            const [x, y] = polar(50, 37.6, 2.7, deg);
            return <circle key={deg} cx={x} cy={y} r="1.9" fill="#F4C7C7" stroke={ROSE} strokeWidth="0.3" />;
          })}
          <circle cx="50" cy="37.6" r="1.3" fill={SAFFRON} />
          <circle cx="50" cy="47.4" r="2.2" fill={SKIN} stroke="#7A4B24" strokeWidth="0.4" />
        </>
      )}
      {rank === 'J' && (
        <>
          <path d="M50 12V60" stroke="#8A5E12" strokeWidth="1.2" />
          <path d="M50 6.6L52.5 12.6H47.5Z" fill="#D8DCE6" stroke="#6B7280" strokeWidth="0.4" strokeLinejoin="round" />
          <circle cx="50" cy="47" r="2.2" fill={SKIN} stroke="#7A4B24" strokeWidth="0.4" />
        </>
      )}
      <circle cx="30" cy="51" r="4.9" fill="#FFF8E4" stroke={SAFFRON_DEEP} strokeWidth="0.7" />
      <polygon points={starPoints(30, 51, 4.9, 3.6, 8)} fill="none" stroke={SAFFRON_DEEP} strokeWidth="0.35" />
      <SuitMark suit={suit} x={30} y={51.2} size={5.8} fill={ink} />
    </g>
  );
};

const PersianCourt: React.FC<SkinCourtProps> = ({ rank, suit, ink }) => (
  <CourtBox border={SAFFRON_DEEP} background={CREAM} borderWidth={1}>
    <rect width="60" height="120" fill={CREAM} />
    <DoubleHeaded>
      <PersianHalf rank={rank} suit={suit} ink={ink} />
    </DoubleHeaded>
  </CourtBox>
);

export const PERSIAN_HERITAGE_SKIN: CardSkin = {
  id: 'persian-heritage',
  name: 'میراث ایرانی',
  englishName: 'Persian Heritage',
  description:
    'الهام‌گرفته از مینیاتور و تذهیب: شاه با هاله شعله و تاج پرنشان، بی‌بی با روسری و تاج‌زنانه، سرباز با کلاهخود؛ پشت ورق به سبک فرش تبریز با ترنج و شمسه.',
  price: 2400,
  currency: 'coins',
  rarity: 'legendary',
  palette: ['#14305E', '#168A8A', '#D9A441'],
  face: {
    paper: 'linear-gradient(180deg,#FFFBF0 0%,#F7EBD0 100%)',
    border: '#B8862B',
    inkRed: '#B02A37',
    inkBlack: '#14305E',
    indexFontFamily: '"Times New Roman", Georgia, "Liberation Serif", serif',
    indexFontWeight: 800,
    pipOutline: { color: SAFFRON, width: 0.45 },
    innerEdge: 'inset 0 0 0 1px rgba(27,63,124,0.2)',
  },
  backFrame: { background: '#F3E6C8', border: '#B8862B' },
  Back: PersianBack,
  Decor: PersianDecor,
  Ace: PersianAce,
  Court: PersianCourt,
};
