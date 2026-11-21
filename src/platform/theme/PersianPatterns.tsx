import React from 'react';

interface LogoProps {
  size?: number;
  className?: string;
}

/**
 * Custom Eyvan (ایوان) emblem: an architectural Persian pointed arch framing
 * an eight-pointed Shamsa geometry in lapis, turquoise, and matte antique gold.
 */
export const EyvanLogo: React.FC<LogoProps> = ({ size = 34, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    {/* Outer architectural lapis tile */}
    <rect x="2" y="2" width="44" height="44" rx="11" fill="#13294B" />
    <rect
      x="4.5"
      y="4.5"
      width="39"
      height="39"
      rx="9"
      stroke="#C59B43"
      strokeWidth="1.2"
      strokeOpacity="0.85"
    />
    {/* Persian pointed Iwan arch */}
    <path
      d="M12 38V23.5C12 16.2 17.5 11.4 24 8.8C30.5 11.4 36 16.2 36 23.5V38"
      stroke="#D6B46A"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
    <path
      d="M15.5 38V24.5C15.5 19.1 19.4 15.2 24 13.1C28.6 15.2 32.5 19.1 32.5 24.5V38"
      fill="#148A8A"
      fillOpacity="0.22"
      stroke="#148A8A"
      strokeWidth="1.2"
    />
    {/* Eight-pointed Persian Shamsa star */}
    <path
      d="M24 17.5L26 21.8L30.5 22.5L27.2 25.8L28 30.3L24 28L20 30.3L20.8 25.8L17.5 22.5L22 21.8L24 17.5Z"
      fill="#C59B43"
    />
    <circle cx="24" cy="24.5" r="2.2" fill="#13294B" />
    {/* Subtle base plinth */}
    <line
      x1="10"
      y1="38"
      x2="38"
      y2="38"
      stroke="#C59B43"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * Subtle Persian geometric Girih hairline ornament for section headers and table trim.
 */
export const PersianGeometricDivider: React.FC<{ className?: string }> = ({
  className = '',
}) => (
  <svg
    viewBox="0 0 320 14"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`w-full h-3.5 ${className}`}
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <line x1="0" y1="7" x2="142" y2="7" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" />
    <path
      d="M160 1.5L166 7L160 12.5L154 7L160 1.5Z"
      stroke="currentColor"
      strokeOpacity="0.6"
      strokeWidth="1.2"
    />
    <circle cx="160" cy="7" r="1.6" fill="currentColor" fillOpacity="0.7" />
    <path
      d="M148 7L151 4.5L154 7L151 9.5L148 7ZM166 7L169 4.5L172 7L169 9.5L166 7Z"
      fill="currentColor"
      fillOpacity="0.35"
    />
    <line x1="178" y1="7" x2="320" y2="7" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" />
  </svg>
);

/**
 * Architectural corner arabesque/girih bracket for the Hokm table frame.
 */
export const PersianCornerOrnament: React.FC<{
  className?: string;
  flipX?: boolean;
  flipY?: boolean;
}> = ({ className = '', flipX = false, flipY = false }) => {
  const transform = `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`;
  return (
    <svg
      width="44"
      height="44"
      viewBox="0 0 44 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ transform }}
      aria-hidden="true"
    >
      <path
        d="M3 41V13C3 7.5 7.5 3 13 3H41"
        stroke="#D6B46A"
        strokeWidth="1.5"
        strokeOpacity="0.65"
      />
      <path
        d="M8 36V15C8 11.1 11.1 8 15 8H36"
        stroke="#148A8A"
        strokeWidth="1"
        strokeOpacity="0.55"
      />
      <path
        d="M13 13L18 8L23 13L18 18L13 13Z"
        stroke="#D6B46A"
        strokeWidth="1.1"
        strokeOpacity="0.7"
      />
      <circle cx="18" cy="13" r="1.7" fill="#D6B46A" fillOpacity="0.75" />
    </svg>
  );
};
