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
  kind: 'mote' | 'suit' | 'card';
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
 * Refined atmospheric backdrop for the Hokm Hub & Modes screens.
 * - Keeps Main Menu base tones (`#08101E` Dark, `#F4F6FA` Light).
 * - Adds gentle silk-aurora veils, subtle Persian girih lattice,
 *   luminous floating motes, suit emblems, and translucent playing-card silhouettes.
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

    // 1. Luminous warm golden & turquoise ambient motes (28 gentle drifting particles)
    for (let i = 0; i < 28; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vy: -(0.12 + Math.random() * 0.24),
        vx: (Math.random() - 0.5) * 0.14,
        size: 1.1 + Math.random() * 2.1,
        alpha: isLight
          ? 0.12 + Math.random() * 0.16
          : 0.16 + Math.random() * 0.24,
        phase: Math.random() * Math.PI * 2,
        kind: 'mote',
        isRed: i % 3 === 0,
        rotation: 0,
        rotSpeed: 0,
      });
    }

    // 2. Ambient suit glyphs floating across margins & upper field (8 crisp symbols)
    for (let i = 0; i < 8; i++) {
      const glyph = SUIT_GLYPHS[i % SUIT_GLYPHS.length];
      const onLeft = i % 2 === 0;
      const bandX = onLeft
        ? 18 + Math.random() * Math.max(64, width * 0.26)
        : width - 18 - Math.random() * Math.max(64, width * 0.26);
      particles.push({
        x: bandX,
        y: ((i + 0.4) / 8) * height,
        vy: -(0.14 + Math.random() * 0.16),
        vx: (Math.random() - 0.5) * 0.08,
        size: 16 + Math.random() * 10,
        alpha: isLight ? 0.075 : 0.09,
        phase: Math.random() * Math.PI * 2,
        kind: 'suit',
        suitChar: glyph.char,
        isRed: glyph.isRed,
        rotation: (Math.random() - 0.5) * 0.36,
        rotSpeed: (Math.random() - 0.5) * 0.0022,
      });
    }

    // 3. Tasteful translucent playing-card silhouettes drifting gracefully (6 cards)
    for (let i = 0; i < 6; i++) {
      const glyph = SUIT_GLYPHS[i % SUIT_GLYPHS.length];
      const onLeft = i % 2 === 0;
      const bandX = onLeft
        ? 26 + Math.random() * Math.max(70, width * 0.28)
        : width - 26 - Math.random() * Math.max(70, width * 0.28);
      particles.push({
        x: bandX,
        y: ((i + 0.35) / 6) * height,
        vy: -(0.16 + Math.random() * 0.18),
        vx: (Math.random() - 0.5) * 0.1,
        size: 32 + Math.random() * 14,
        alpha: isLight ? 0.085 : 0.095,
        phase: Math.random() * Math.PI * 2,
        kind: 'card',
        suitChar: glyph.char,
        isRed: glyph.isRed,
        rotation: (Math.random() - 0.5) * 0.55,
        rotSpeed: (Math.random() - 0.5) * 0.0024,
      });
    }

    let rafId = 0;
    let lastFrameTime = 0;
    const FRAME_INTERVAL_MS = 33;

    const drawRoundedRect = (
      x: number,
      y: number,
      w: number,
      h: number,
      r: number
    ) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    };

    const renderFrame = (now: number) => {
      rafId = requestAnimationFrame(renderFrame);
      if (document.hidden) return;
      if (now - lastFrameTime < FRAME_INTERVAL_MS) return;
      lastFrameTime = now;

      ctx.clearRect(0, 0, width, height);

      for (const p of particles) {
        p.phase += 0.016;
        p.y += p.vy;
        p.x += p.vx + Math.sin(p.phase) * 0.12;
        p.rotation += p.rotSpeed;

        if (p.y < -64) {
          p.y = height + 54;
          p.x = Math.random() * width;
        }
        if (p.x < -64) p.x = width + 48;
        if (p.x > width + 64) p.x = -48;

        const twinkle = 0.72 + 0.28 * Math.sin(p.phase * 1.35);
        const curAlpha = p.alpha * twinkle;

        if (p.kind === 'mote') {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          if (isLight) {
            ctx.fillStyle = p.isRed
              ? `rgba(180, 130, 35, ${curAlpha})`
              : `rgba(13, 138, 138, ${curAlpha})`;
          } else {
            ctx.fillStyle = p.isRed
              ? `rgba(44, 197, 194, ${curAlpha})`
              : `rgba(243, 209, 121, ${curAlpha})`;
          }
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
        } else if (p.kind === 'card' && p.suitChar) {
          const cardW = p.size;
          const cardH = p.size * 1.4;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);

          drawRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, cardW * 0.14);
          ctx.fillStyle = isLight
            ? `rgba(255, 255, 255, ${curAlpha * 1.4})`
            : `rgba(19, 36, 62, ${curAlpha * 1.6})`;
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = isLight
            ? `rgba(13, 138, 138, ${curAlpha * 2.2})`
            : `rgba(243, 209, 121, ${curAlpha * 2.2})`;
          ctx.stroke();

          ctx.font = `${Math.round(cardW * 0.46)}px serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = isLight
            ? p.isRed
              ? `rgba(185, 28, 28, ${curAlpha * 2.1})`
              : `rgba(15, 23, 42, ${curAlpha * 1.9})`
            : p.isRed
              ? `rgba(243, 209, 121, ${curAlpha * 2.1})`
              : `rgba(44, 197, 194, ${curAlpha * 2.1})`;
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
