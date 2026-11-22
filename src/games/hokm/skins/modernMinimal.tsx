import React from 'react';
import { SuitMark } from './suitGlyphs';
import { AceBox, CourtBox, DoubleHeaded } from './courtLayout';
import type { CardSkin, CourtRank, SkinAceProps, SkinBackProps, SkinCourtProps } from './types';
import type { Suit } from '../engine/types';

/**
 * MODERN MINIMAL — flat, geometric, two-tone: one ink colour per suit plus a
 * light tint of itself. Faceless figures built from circles and simple shapes,
 * maximum legibility, no ornament.
 */

const LINE = '#0F172A';
const HAIRLINE = '#D5D9E0';
const ACCENT = '#D62839';

const MinimalBack: React.FC<SkinBackProps> = ({ className = '' }) => (
  <svg
    viewBox="0 0 100 144"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`w-full h-full block ${className}`}
    aria-hidden="true"
  >
    <rect x="0.5" y="0.5" width="99" height="143" rx="8" fill="#F5F6F8" stroke={HAIRLINE} />
    <rect x="7" y="7" width="86" height="130" rx="4" stroke={LINE} strokeWidth="0.9" />
    <path d="M50 7V48M50 96V137M7 72H26M74 72H93" stroke={LINE} strokeWidth="0.5" strokeOpacity="0.5" />
    <circle cx="50" cy="72" r="24" stroke={LINE} strokeWidth="0.9" />
    <circle cx="50" cy="72" r="14" stroke={LINE} strokeWidth="0.6" />
    <circle cx="50" cy="72" r="4" fill={LINE} />
    <circle cx="50" cy="72" r="1.5" fill={ACCENT} />
    <g fill={LINE}>
      <rect x="11" y="11" width="3.4" height="3.4" />
      <rect x="85.6" y="11" width="3.4" height="3.4" />
      <rect x="11" y="129.6" width="3.4" height="3.4" />
      <rect x="85.6" y="129.6" width="3.4" height="3.4" />
    </g>
  </svg>
);

const MinimalAce: React.FC<SkinAceProps> = ({ suit, ink }) => (
  <AceBox>
    <circle cx="50" cy="50" r="47" stroke={ink} strokeWidth="0.9" strokeOpacity="0.25" fill="none" />
    <SuitMark suit={suit} x={50} y={51} size={64} fill={ink} />
  </AceBox>
);

const MinimalHalf: React.FC<{ rank: CourtRank; suit: Suit; ink: string }> = ({ rank, suit, ink }) => (
  <g>
    {rank === 'K' && (
      <>
        <path d="M6 60L9 40H51L54 60Z" fill={ink} fillOpacity="0.14" stroke={ink} strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M10.4 55.5H49.6" stroke={ink} strokeWidth="1" />
      </>
    )}
    {rank === 'Q' && (
      <>
        <path d="M16 40H44L57 60H3Z" fill={ink} fillOpacity="0.14" stroke={ink} strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M20 40L30 60L40 40" stroke={ink} strokeWidth="0.8" fill="none" strokeLinejoin="round" />
      </>
    )}
    {rank === 'J' && (
      <>
        <path d="M14 60V44Q14 38 20 38H40Q46 38 46 44V60Z" fill={ink} fillOpacity="0.14" stroke={ink} strokeWidth="1.2" strokeLinejoin="round" />
        <circle cx="30" cy="56" r="2" stroke={ink} strokeWidth="1" fill="none" />
      </>
    )}
    <path d="M27.5 28H32.5V38H27.5Z" fill="#FFFFFF" stroke={ink} strokeWidth="1.1" />
    <circle cx="30" cy="22" r="7" fill="#FFFFFF" stroke={ink} strokeWidth="1.4" />
    {rank === 'K' && (
      <path d="M21 14L22 6L26.5 10L30 4L33.5 10L38 6L39 14Z" stroke={ink} strokeWidth="1.4" fill="none" strokeLinejoin="round" />
    )}
    {rank === 'Q' && (
      <>
        <path d="M22 14Q30 5 38 14" stroke={ink} strokeWidth="1.4" fill="none" strokeLinecap="round" />
        <circle cx="24.5" cy="10.2" r="1.3" fill={ink} />
        <circle cx="30" cy="7.4" r="1.3" fill={ink} />
        <circle cx="35.5" cy="10.2" r="1.3" fill={ink} />
      </>
    )}
    {rank === 'J' && (
      <>
        <path d="M22 14.5H38" stroke={ink} strokeWidth="2.2" strokeLinecap="round" />
        <path d="M36 13.6L41 7.6" stroke={ink} strokeWidth="1.1" strokeLinecap="round" />
      </>
    )}
    {rank === 'K' && (
      <>
        <path d="M50 18.4V40" stroke={ink} strokeWidth="1.4" />
        <circle cx="50" cy="15.6" r="2.6" fill={ink} />
      </>
    )}
    {rank === 'Q' && (
      <>
        <path d="M50 33.6V40" stroke={ink} strokeWidth="1.2" />
        <circle cx="50" cy="30.6" r="2.6" stroke={ink} strokeWidth="1.2" fill="none" />
      </>
    )}
    {rank === 'J' && <path d="M50 12V40" stroke={ink} strokeWidth="1.4" />}
    <SuitMark suit={suit} x={30} y={48.5} size={9} fill={ink} />
  </g>
);

const MinimalCourt: React.FC<SkinCourtProps> = ({ rank, suit, ink }) => (
  <CourtBox border="#E1E4EA" background="#FFFFFF" borderWidth={1} radius={2}>
    <rect width="60" height="120" fill="#FFFFFF" />
    <path d="M6 60H54" stroke={ink} strokeWidth="0.6" strokeOpacity="0.3" />
    <DoubleHeaded>
      <MinimalHalf rank={rank} suit={suit} ink={ink} />
    </DoubleHeaded>
  </CourtBox>
);

export const MODERN_MINIMAL_SKIN: CardSkin = {
  id: 'modern-minimal',
  name: 'مینیمال مدرن',
  englishName: 'Modern Minimal',
  description:
    'طراحی تخت و هندسی با دو رنگ و خوانایی بسیار بالا؛ بدون تزئین اضافه، مناسب صفحه‌های کوچک موبایل.',
  price: 850,
  currency: 'coins',
  rarity: 'rare',
  palette: ['#0F172A', '#D62839', '#F5F6F8'],
  face: {
    paper: '#FFFFFF',
    border: HAIRLINE,
    inkRed: '#D62839',
    inkBlack: '#0F172A',
    indexFontFamily: 'ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif',
    indexFontWeight: 700,
  },
  backFrame: { background: '#FFFFFF', border: HAIRLINE },
  Back: MinimalBack,
  Ace: MinimalAce,
  Court: MinimalCourt,
};
