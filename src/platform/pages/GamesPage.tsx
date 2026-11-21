import React from 'react';
import { motion } from 'motion/react';
import { Lock } from 'lucide-react';
import { GAME_REGISTRY } from '../../games/registry';
import { GameId } from '../types/platform';

interface GamesPageProps {
  onSelectGame: (gameId: GameId) => void;
}

export const GamesPage: React.FC<GamesPageProps> = ({ onSelectGame }) => {
  const hokmGame = GAME_REGISTRY.find((g) => g.id === 'hokm')!;
  const otherGames = GAME_REGISTRY.filter((g) => g.id !== 'hokm');

  return (
    <div className="space-y-4 sm:space-y-5 max-w-4xl mx-auto">
      {/* TOP HERO CARD: HOKM — Calm breathing artwork, delicate gold sheen & ambient twinkles */}
      <motion.button
        type="button"
        onClick={() => onSelectGame('hokm')}
        data-testid="launch-hokm-btn"
        data-start="true"
        aria-label="ورود به بازی حکم چهارنفره"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.988 }}
        transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
        className="group relative w-full block text-right rounded-[24px] overflow-hidden border-[1.5px] border-[#D4AE58]/72 hover:border-[#F3D27C] shadow-[0_14px_38px_rgba(12,26,52,0.28),inset_0_1px_0_rgba(243,210,124,0.38)] transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3D27C] transform-gpu"
      >
        <div className="relative h-[216px] sm:h-[276px] md:h-[308px] w-full bg-[#0C1B33] overflow-hidden">
          {/* Calm ambient breathing zoom on Hokm hero art */}
          <img
            src={hokmGame.artworkSrc}
            alt="بازی حکم چهارنفره"
            decoding="sync"
            loading="eager"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover object-[left_22%] sm:object-[center_18%] brightness-[1.14] contrast-[1.05] saturate-[1.12] eyvan-hero-breathe"
          />

          {/* Localized right-side directional gradient: keeps left crown & cards bright and luminous */}
          <div
            className="absolute inset-0 bg-gradient-to-l from-[#091529]/88 via-[#0B1931]/40 to-transparent"
            aria-hidden="true"
          />

          {/* Periodic subtle golden light sheen sweep across the hero */}
          <div
            className="pointer-events-none absolute inset-0 overflow-hidden"
            aria-hidden="true"
          >
            <div className="eyvan-hero-sheen absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-[#F6DC93]/18 to-transparent -skew-x-12" />
          </div>

          {/* Subtle floating gold ambient motes */}
          <div
            className="pointer-events-none absolute inset-0 overflow-hidden"
            aria-hidden="true"
          >
            <span className="eyvan-sparkle-float absolute top-[24%] right-[14%] w-1.5 h-1.5 rounded-full bg-[#F6DC93]/75 shadow-[0_0_8px_#F6DC93]" />
            <span
              className="eyvan-sparkle-float absolute bottom-[28%] right-[32%] w-1 h-1 rounded-full bg-[#F3D179]/70 shadow-[0_0_6px_#F3D179]"
              style={{ animationDelay: '1.8s' }}
            />
            <span
              className="eyvan-sparkle-float absolute top-[34%] left-[44%] w-1 h-1 rounded-full bg-[#F8E2A1]/65 shadow-[0_0_6px_#F8E2A1]"
              style={{ animationDelay: '3.2s' }}
            />
          </div>

          {/* Delicate antique gold inner frame */}
          <div
            className="absolute inset-2 rounded-[18px] border border-[#D4AE58]/36 group-hover:border-[#F3D179]/60 transition-colors duration-300 pointer-events-none"
            aria-hidden="true"
          />

          {/* Clean Hokm Title ONLY */}
          <div className="absolute inset-0 flex flex-col justify-center items-start pr-6 sm:pr-11 pl-4 max-w-[54%] sm:max-w-[46%]">
            <h1 className="text-5xl sm:text-7xl font-extrabold eyvan-gold-title tracking-tight leading-none">
              {hokmGame.name}
            </h1>
            <p className="text-xs sm:text-base font-bold text-[#FAF2DE] mt-3 flex items-center gap-1.5 drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">
              <span className="text-[#F3D179] eyvan-gentle-pulse" aria-hidden="true">❖</span>
              <span>{hokmGame.subtitle}</span>
              <span className="text-[#F3D179] eyvan-gentle-pulse" aria-hidden="true">❖</span>
            </p>
          </div>
        </div>
      </motion.button>

      {/* 2x2 GRID: OTHER GAMES — Staggered gentle entrance + subtle living hover motion */}
      <section aria-label="بازی‌های دیگر پلتفرم">
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          {otherGames.map((game, idx) => (
            <motion.article
              key={game.id}
              aria-disabled="true"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -3 }}
              transition={{
                duration: 0.34,
                delay: 0.06 + idx * 0.055,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="group relative rounded-[20px] overflow-hidden border-[1.5px] border-[#D4AE58]/55 hover:border-[#F3D179]/80 shadow-[0_10px_28px_rgba(12,26,52,0.2)] min-h-[146px] sm:min-h-[192px] flex flex-col justify-end transform-gpu bg-[#0C1A30] transition-colors duration-200"
            >
              <img
                src={game.artworkSrc}
                alt={game.name}
                decoding="sync"
                loading="eager"
                referrerPolicy="no-referrer"
                className="absolute inset-0 w-full h-full object-cover object-center opacity-100 brightness-[1.12] contrast-[1.05] saturate-[1.1] group-hover:scale-[1.04] transition-transform duration-500 ease-out"
              />
              {/* Soft bottom-only scrim so upper artwork stays vivid and luminous */}
              <div
                className="absolute inset-0 bg-gradient-to-t from-[#071122]/88 via-[#0A172C]/22 to-transparent"
                aria-hidden="true"
              />

              <div className="relative z-10 p-3 sm:p-4 flex flex-col justify-between h-full">
                <div className="flex items-center justify-end">
                  <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs font-bold text-[#F5D680] bg-[#081224]/72 backdrop-blur-xs px-2 py-0.5 rounded-lg border border-[#D4AE58]/45">
                    <Lock className="w-3 h-3" />
                    <span>به‌زودی</span>
                  </span>
                </div>

                <div className="mt-auto pt-8">
                  <h2 className="text-base sm:text-xl font-extrabold text-[#FFFFFF] drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
                    {game.name}
                  </h2>
                  <p className="text-[11px] sm:text-xs text-[#E4ECF7] mt-0.5 truncate drop-shadow-[0_1px_5px_rgba(0,0,0,0.8)]">
                    {game.subtitle}
                  </p>
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      </section>
    </div>
  );
};
