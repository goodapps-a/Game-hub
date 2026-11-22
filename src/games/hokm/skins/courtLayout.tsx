import React from 'react';

/**
 * Shared geometry for skinned court cards. Every skin draws ONE half figure
 * inside a 60×60 box (head up, waist on the bottom edge) and <DoubleHeaded>
 * mirrors it 180° around the card centre, like printed J/Q/K cards.
 *
 * Safe drawing zone: x ∈ [4, 56] — the box is cropped slightly on narrow cards.
 */
export const COURT_VIEWBOX = '0 0 60 120';

const COURT_BOX_CLASS =
  'absolute inset-y-[9px] inset-x-[18px] sm:inset-y-[12px] sm:inset-x-[24px] overflow-hidden pointer-events-none';

export const CourtBox: React.FC<{
  border: string;
  background: string;
  borderWidth?: number;
  radius?: number;
  children: React.ReactNode;
}> = ({ border, background, borderWidth = 1, radius = 2, children }) => (
  <div
    className={COURT_BOX_CLASS}
    style={{ border: `${borderWidth}px solid ${border}`, background, borderRadius: radius }}
  >
    <svg
      viewBox={COURT_VIEWBOX}
      preserveAspectRatio="xMidYMid slice"
      className="w-full h-full block"
      aria-hidden="true"
    >
      {children}
    </svg>
  </div>
);

/** Draws `children` (a 60×60 half figure) upright on top and rotated 180° below. */
export const DoubleHeaded: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <>
    <g>{children}</g>
    <g transform="rotate(180 30 60)">{children}</g>
  </>
);

const ACE_BOX_CLASS =
  'absolute inset-y-[12px] inset-x-[16px] sm:inset-y-[16px] sm:inset-x-[20px] flex items-center justify-center pointer-events-none';

/** Centre region for an Ace; children is an SVG with viewBox 0 0 100 100. */
export const AceBox: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className={ACE_BOX_CLASS}>
    <svg viewBox="0 0 100 100" className="w-full h-full block" aria-hidden="true">
      {children}
    </svg>
  </div>
);

/** Full-card decoration layer (viewBox 0 0 100 144, stretches with the card). */
export const DecorLayer: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <svg
    viewBox="0 0 100 144"
    preserveAspectRatio="none"
    className="absolute inset-0 w-full h-full pointer-events-none"
    aria-hidden="true"
  >
    {children}
  </svg>
);
