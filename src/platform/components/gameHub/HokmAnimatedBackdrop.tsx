import React, { useEffect, useRef } from 'react';

interface HokmAnimatedBackdropProps {
  isLight: boolean;
}

interface AmbientParticle {
  x: number;
  y: number;
  vy: number;
  vx: number;
  size: number;
  alpha: number;
  phase: number;
  kind: 'mote' | 'suit';
  suitChar?: string;
  isRed?: boolean;
  rotation: number;
  rotSpeed: number;
}

const SUIT_GLYPHS: readonly { char: string; isRed: boolean }[] = [
  { char: '♥', isRed: true },
  { char: '♠', isRed: false },
  { char: '♦', isRed: true },
  { char: '♣', isRed: false },
];

/**
 * Calm, luxury atmospheric backdrop for the Hokm Hub & Modes screens.
 * - Matches Main Menu exact base tones (`#08101E` Dark, `#F4F6FA` Light).
 * - Uses soft silk-aurora glow veils, whisper-subtle Persian girih lattice,
 *   a slow diagonal sheen, and sparse ambient dust motes without cluttered
 *   astrolabe wireframes or floating card outlines.
 */
export const HokmAnimatedBackdrop: React.FC<HokmAnimatedBackdropProps> = ({
  isLight,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === 'undefined') return;

    const reducedMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reducedMotion) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const particles: AmbientParticle[] = [];

    // 1. Sparse warm ambient motes (16 gentle dust particles)
    for (let i = 0; i < 16; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vy: -(0.08 + Math.random() * 0.14),
        vx: (Math.random() - 0.5) * 0.08,
        size: 1.0 + Math.random() * 1.4,
        alpha: isLight
          ? 0.09 + Math.random() * 0.12
          : 0.11 + Math.random() * 0.16,
        phase: Math.random() * Math.PI * 2,
        kind: 'mote',
        rotation: 0,
        rotSpeed: 0,
      });
    }

    // 2. Whisper-soft ambient suit silhouettes near outer margins (4 subtle symbols)
    for (let i = 0; i < 4; i++) {
      const glyph = SUIT_GLYPHS[i];
      const onLeft = i % 2 === 0;
      const bandX = onLeft
        ? 24 + Math.random() * Math.max(48, width * 0.18)
        : width - 24 - Math.random() * Math.max(48, width * 0.18);
      particles.push({
        x: bandX,
        y: ((i + 0.5) / 4) * height,
        vy: -(0.09 + Math.random() * 0.1),
        vx: (Math.random() - 0.5) * 0.05,
        size: 15 + Math.random() * 7,
        alpha: isLight ? 0.045 : 0.055,
        phase: Math.random() * Math.PI * 2,
        kind: 'suit',
        suitChar: glyph.char,
        isRed: glyph.isRed,
        rotation: (Math.random() - 0.5) * 0.25,
        rotSpeed: (Math.random() - 0.5) * 0.0014,
      });
    }

    let rafId = 0;
    let lastFrameTime = 0;
    const FRAME_INTERVAL_MS = 33;

    const renderFrame = (now: number) => {
      rafId = requestAnimationFrame(renderFrame);
      if (document.hidden) return;
      if (now - lastFrameTime < FRAME_INTERVAL_MS) return;
      lastFrameTime = now;

      ctx.clearRect(0, 0, width, height);

      for (const p of particles) {
        p.phase += 0.012;
        p.y += p.vy;
        p.x += p.vx + Math.sin(p.phase) * 0.08;
        p.rotation += p.rotSpeed;

        if (p.y < -36) {
          p.y = height + 32;
          p.x = Math.random() * width;
        }
        if (p.x < -36) p.x = width + 24;
        if (p.x > width + 36) p.x = -24;

        const twinkle = 0.78 + 0.22 * Math.sin(p.phase * 1.1);
        const curAlpha = p.alpha * twinkle;

        if (p.kind === 'mote') {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = isLight
            ? `rgba(13, 138, 138, ${curAlpha})`
            : `rgba(243, 209, 121, ${curAlpha})`;
          ctx.fill();
        } else if (p.kind === 'suit' && p.suitChar) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.font = `${Math.round(p.size)}px serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          if (isLight) {
            ctx.fillStyle = p.isRed
              ? `rgba(185, 28, 28, ${curAlpha})`
              : `rgba(15, 23, 42, ${curAlpha})`;
          } else {
            ctx.fillStyle = p.isRed
              ? `rgba(243, 209, 121, ${curAlpha})`
              : `rgba(44, 197, 194, ${curAlpha})`;
          }
          ctx.fillText(p.suitChar, 0, 0);
          ctx.restore();
        }
      }
    };

    window.addEventListener('resize', resize);
    rafId = requestAnimationFrame(renderFrame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [isLight]);

  return (
    <div
      className="fixed inset-0 pointer-events-none overflow-hidden"
      aria-hidden="true"
      data-testid="hokm-animated-backdrop"
    >
      {/* Main Menu Exact Base Surface Colors (#08101E Dark / #F4F6FA Light) */}
      <div
        className="absolute inset-0"
        style={{
          background: isLight
            ? 'linear-gradient(180deg, #F4F6FA 0%, #EEF2F8 54%, #E8EEF6 100%)'
            : 'linear-gradient(180deg, #08101E 0%, #0A1527 54%, #070E1A 100%)',
        }}
      />

      {/* Whisper-subtle Persian Girih Geometric Lattice Texture */}
      <svg
        className={`absolute inset-0 w-full h-full ${
          isLight
            ? 'opacity-[0.026] text-[#0D8A8A]'
            : 'opacity-[0.024] text-[#D4AE58]'
        }`}
        aria-hidden="true"
      >
        <defs>
          <pattern
            id="hokm-girih-lattice"
            width="72"
            height="72"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M36 0L72 36L36 72L0 36Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.65"
            />
            <circle
              cx="36"
              cy="36"
              r="2.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.65"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#hokm-girih-lattice)" />
      </svg>

      {/* Calm silk-aurora ambient light veils */}
      <div
        className="hokm-aurora-orb-a absolute -top-[22%] -right-[16%] w-[70vw] h-[52vh] rounded-full blur-3xl will-change-transform"
        style={{
          background: isLight
            ? 'radial-gradient(circle, rgba(13,138,138,0.09) 0%, rgba(30,64,175,0.04) 48%, transparent 74%)'
            : 'radial-gradient(circle, rgba(212,174,88,0.11) 0%, rgba(25,162,162,0.08) 48%, transparent 74%)',
        }}
      />
      <div
        className="hokm-aurora-orb-b absolute -bottom-[20%] -left-[14%] w-[72vw] h-[48vh] rounded-full blur-3xl will-change-transform"
        style={{
          background: isLight
            ? 'radial-gradient(circle, rgba(30,64,175,0.06) 0%, rgba(13,138,138,0.07) 48%, transparent 74%)'
            : 'radial-gradient(circle, rgba(25,162,162,0.12) 0%, rgba(18,34,58,0.22) 52%, transparent 76%)',
        }}
      />

      {/* Slow diagonal velvet sheen sweep */}
      <div
        className="hokm-light-sweep absolute -inset-y-1/4 -left-1/2 w-[58%] rotate-12 will-change-transform"
        style={{
          background: isLight
            ? 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.34) 50%, transparent 100%)'
            : 'linear-gradient(90deg, transparent 0%, rgba(243,209,121,0.032) 50%, transparent 100%)',
        }}
      />

      {/* Top soft ambient vignette for depth */}
      <div
        className="absolute inset-x-0 top-0 h-44"
        style={{
          background: isLight
            ? 'linear-gradient(180deg, rgba(255,255,255,0.45) 0%, transparent 100%)'
            : 'linear-gradient(180deg, rgba(4,9,18,0.42) 0%, transparent 100%)',
        }}
      />

      {/* Sparse ambient canvas particles */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
};
