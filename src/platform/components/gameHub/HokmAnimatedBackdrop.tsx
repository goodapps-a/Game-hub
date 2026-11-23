import React, { useEffect, useRef } from 'react';

interface HokmAnimatedBackdropProps {
  isLight: boolean;
}

interface FloatingParticle {
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
 * Refined Coded Animated Backdrop for the Hokm Hub & Modes Screens.
 * - Strictly matches Main Menu base surface colors:
 *   Dark = `#08101E`, Light = `#F4F6FA`.
 * - Layers Persian Pointed Iwan Arch architectural framing, ultra-slow counter-rotating
 *   Shamsa geometry, gentle aurora veils, and a 30fps canvas with rising minimal card
 *   outlines, drifting suit symbols, and warm ambient motes.
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

    const particles: FloatingParticle[] = [];

    // 1. Subtle floating dust motes (22 particles)
    for (let i = 0; i < 22; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vy: -(0.12 + Math.random() * 0.22),
        vx: (Math.random() - 0.5) * 0.12,
        size: 1.0 + Math.random() * 1.8,
        alpha: isLight ? 0.16 + Math.random() * 0.22 : 0.16 + Math.random() * 0.28,
        phase: Math.random() * Math.PI * 2,
        kind: 'mote',
        rotation: 0,
        rotSpeed: 0,
      });
    }

    // 2. Crisp ambient suit silhouettes (8 particles)
    for (let i = 0; i < 8; i++) {
      const glyph = SUIT_GLYPHS[i % SUIT_GLYPHS.length];
      particles.push({
        x: ((i + 0.5) / 8) * width + (Math.random() - 0.5) * 44,
        y: Math.random() * height,
        vy: -(0.14 + Math.random() * 0.16),
        vx: (Math.random() - 0.5) * 0.08,
        size: 14 + Math.random() * 10,
        alpha: isLight ? 0.07 + Math.random() * 0.04 : 0.075 + Math.random() * 0.05,
        phase: Math.random() * Math.PI * 2,
        kind: 'suit',
        suitChar: glyph.char,
        isRed: glyph.isRed,
        rotation: (Math.random() - 0.5) * 0.4,
        rotSpeed: (Math.random() - 0.5) * 0.0024,
      });
    }

    // 3. Minimal drifting playing-card wireframe outlines near outer edges (6 cards)
    for (let i = 0; i < 6; i++) {
      const glyph = SUIT_GLYPHS[i % SUIT_GLYPHS.length];
      const onLeft = i % 2 === 0;
      const bandX = onLeft
        ? Math.random() * (width * 0.26)
        : width - Math.random() * (width * 0.26);
      particles.push({
        x: bandX,
        y: (i / 6) * height + Math.random() * 80,
        vy: -(0.15 + Math.random() * 0.14),
        vx: (Math.random() - 0.5) * 0.06,
        size: 34 + Math.random() * 14,
        alpha: isLight ? 0.085 + Math.random() * 0.045 : 0.08 + Math.random() * 0.05,
        phase: Math.random() * Math.PI * 2,
        kind: 'card',
        suitChar: glyph.char,
        isRed: glyph.isRed,
        rotation: (Math.random() - 0.5) * 0.45,
        rotSpeed: (Math.random() - 0.5) * 0.0022,
      });
    }

    let rafId = 0;
    let lastFrameTime = 0;
    const FRAME_INTERVAL_MS = 33; // ~30fps cap for smooth battery-friendly motion

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
        p.phase += 0.015;
        p.y += p.vy;
        p.x += p.vx + Math.sin(p.phase) * 0.11;
        p.rotation += p.rotSpeed;

        if (p.y < -60) {
          p.y = height + 54;
          p.x = Math.random() * width;
        }
        if (p.x < -50) p.x = width + 36;
        if (p.x > width + 50) p.x = -36;

        const twinkle = 0.72 + 0.28 * Math.sin(p.phase * 1.3);
        const curAlpha = p.alpha * twinkle;

        if (p.kind === 'mote') {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = isLight
            ? `rgba(13, 138, 138, ${curAlpha * 0.78})`
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
              ? `rgba(243, 209, 121, ${curAlpha * 1.1})`
              : `rgba(44, 197, 194, ${curAlpha * 0.95})`;
          }
          ctx.fillText(p.suitChar, 0, 0);
          ctx.restore();
        } else if (p.kind === 'card' && p.suitChar) {
          const cardW = p.size;
          const cardH = p.size * 1.4;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);

          drawRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 6);
          ctx.fillStyle = isLight
            ? `rgba(255, 255, 255, ${curAlpha * 2.2})`
            : `rgba(14, 27, 49, ${curAlpha * 2.1})`;
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = isLight
            ? `rgba(13, 138, 138, ${curAlpha * 2.4})`
            : `rgba(212, 174, 88, ${curAlpha * 2.3})`;
          ctx.stroke();

          ctx.font = `${Math.round(cardW * 0.42)}px serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = isLight
            ? p.isRed
              ? `rgba(185, 28, 28, ${curAlpha * 2.2})`
              : `rgba(15, 23, 42, ${curAlpha * 2.0})`
            : `rgba(243, 209, 121, ${curAlpha * 2.1})`;
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
            ? 'linear-gradient(180deg, #F4F6FA 0%, #EFF3F8 55%, #EBF0F6 100%)'
            : 'linear-gradient(180deg, #08101E 0%, #0A1527 52%, #070E1B 100%)',
        }}
      />

      {/* Slowly drifting silk-aurora light veils matching Navy & Turquoise palette */}
      <div
        className="hokm-aurora-orb-a absolute -top-[18%] -right-[14%] w-[72vw] h-[54vh] rounded-full blur-3xl will-change-transform"
        style={{
          background: isLight
            ? 'radial-gradient(circle, rgba(13,138,138,0.11) 0%, rgba(30,64,175,0.06) 45%, transparent 72%)'
            : 'radial-gradient(circle, rgba(212,174,88,0.14) 0%, rgba(25,162,162,0.10) 46%, transparent 72%)',
        }}
      />
      <div
        className="hokm-aurora-orb-b absolute -bottom-[16%] -left-[12%] w-[74vw] h-[50vh] rounded-full blur-3xl will-change-transform"
        style={{
          background: isLight
            ? 'radial-gradient(circle, rgba(30,64,175,0.08) 0%, rgba(13,138,138,0.08) 48%, transparent 72%)'
            : 'radial-gradient(circle, rgba(25,162,162,0.15) 0%, rgba(21,36,62,0.28) 50%, transparent 74%)',
        }}
      />

      {/* Subtle diagonal velvet sheen sweep */}
      <div
        className="hokm-light-sweep absolute -inset-y-1/4 -left-1/2 w-[65%] rotate-12 will-change-transform"
        style={{
          background: isLight
            ? 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.42) 50%, transparent 100%)'
            : 'linear-gradient(90deg, transparent 0%, rgba(243,209,121,0.04) 50%, transparent 100%)',
        }}
      />

      {/* Architectural Persian Pointed Iwan Arch Frame */}
      <svg
        viewBox="0 0 800 1000"
        fill="none"
        preserveAspectRatio="xMidYMid slice"
        className={`absolute inset-0 w-full h-full ${
          isLight ? 'opacity-[0.085] text-[#0D8A8A]' : 'opacity-[0.11] text-[#D4AE58]'
        }`}
      >
        <path
          d="M110 1000 V390 C110 215 240 120 400 54 C560 120 690 215 690 390 V1000"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path
          d="M142 1000 V405 C142 246 258 158 400 96 C542 158 658 246 658 405 V1000"
          stroke="currentColor"
          strokeWidth="0.9"
          strokeDasharray="6 8"
        />
        <line x1="400" y1="22" x2="400" y2="54" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="400" cy="22" r="4" stroke="currentColor" strokeWidth="1.1" />
      </svg>

      {/* Ultra-slow counter-rotating Persian Shamsa geometric rings */}
      <svg
        viewBox="0 0 600 600"
        fill="none"
        className={`hokm-shamsa-spin-cw absolute left-1/2 top-1/2 w-[540px] sm:w-[700px] h-[540px] sm:h-[700px] will-change-transform ${
          isLight ? 'opacity-[0.065] text-[#0D8A8A]' : 'opacity-[0.075] text-[#F3D179]'
        }`}
      >
        <circle cx="300" cy="300" r="248" stroke="currentColor" strokeWidth="1.2" />
        <circle
          cx="300"
          cy="300"
          r="212"
          stroke="currentColor"
          strokeWidth="0.9"
          strokeDasharray="5 9"
        />
        <polygon
          points="300,56 364,145 472,128 455,236 544,300 455,364 472,472 364,455 300,544 236,455 128,472 145,364 56,300 145,236 128,128 236,145"
          stroke="currentColor"
          strokeWidth="1.05"
        />
      </svg>

      <svg
        viewBox="0 0 600 600"
        fill="none"
        className={`hokm-shamsa-spin-ccw absolute left-1/2 top-1/2 w-[400px] sm:w-[520px] h-[400px] sm:h-[520px] will-change-transform ${
          isLight ? 'opacity-[0.055] text-[#B45309]' : 'opacity-[0.065] text-[#2CC5C2]'
        }`}
      >
        <circle cx="300" cy="300" r="184" stroke="currentColor" strokeWidth="1" strokeDasharray="3 10" />
        <polygon
          points="300,118 352,248 482,300 352,352 300,482 248,352 118,300 248,248"
          stroke="currentColor"
          strokeWidth="1.1"
        />
      </svg>

      {/* Canvas layer: drifting wireframe card outlines, suit symbols & glowing motes */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
};
