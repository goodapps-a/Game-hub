import React from 'react';
import { motion } from 'motion/react';
import { Lock } from 'lucide-react';
import { GAME_REGISTRY } from '../../games/registry';
import { GameId, ThemeMode } from '../types/platform';
import { PWAInstallButton } from '../components/PWAInstallButton';

interface GamesPageProps {
  onSelectGame: (gameId: GameId) => void;
  themeMode?: ThemeMode;
}

export const GamesPage: React.FC<GamesPageProps> = ({
  onSelectGame,
  themeMode = 'dark',
}) => {
  const hokmGame = GAME_REGISTRY.find((g) => g.id === 'hokm')!;
  const otherGames = GAME_REGISTRY.filter((g) => g.id !== 'hokm');
  const isLight = themeMode === 'light';
  const hokmSrc =
    isLight && hokmGame.lightArtworkSrc
      ? hokmGame.lightArtworkSrc
      : hokmGame.artworkSrc;

  return (
    <div className="space-y-4 sm:space-y-5 max-w-4xl mx-auto">
      {/* TOP HERO CARD: HOKM */}
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
        className={`group relative w-full block text-right rounded-[24px] overflow-hidden border-[1.5px] transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 transform-gpu ${
          isLight
            ? 'border-[#CBD8E6] hover:border-[#0D8A8A] shadow-[0_14px_34px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.9)] focus-visible:ring-[#0D8A8A]'
            : 'border-[#D4AE58]/72 hover:border-[#F3D27C] shadow-[0_14px_38px_rgba(12,26,52,0.28),inset_0_1px_0_rgba(243,210,124,0.38)] focus-visible:ring-[#F3D27C]'
        }`}
      >
        <div
          className={`relative h-[216px] sm:h-[276px] md:h-[308px] w-full overflow-hidden ${
            isLight ? 'bg-[#F8FAFC]' : 'bg-[#0C1B33]'
          }`}
        >
          {/* Calm ambient breathing zoom on Hokm hero art */}
          <img
            src={hokmSrc}
            alt="بازی حکم چهارنفره"
            decoding="sync"
            loading="eager"
            className={`w-full h-full object-cover object-[left_22%] sm:object-[center_18%] eyvan-hero-breathe ${
              isLight
                ? 'brightness-[0.98] contrast-[1.04] saturate-[1.05]'
                : 'brightness-[1.14] contrast-[1.05] saturate-[1.12]'
            }`}
          />

          {/* Localized right-side directional gradient for readable Persian title */}
          <div
            className={`absolute inset-0 ${
              isLight
                ? 'bg-gradient-to-l from-[#F4F6FA]/78 via-[#F4F6FA]/22 to-transparent'
                : 'bg-gradient-to-l from-[#091529]/88 via-[#0B1931]/40 to-transparent'
            }`}
            aria-hidden="true"
          />

          {/* Periodic subtle sheen sweep across the hero */}
          <div
            className="pointer-events-none absolute inset-0 overflow-hidden"
            aria-hidden="true"
          >
            <div
              className={`eyvan-hero-sheen absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent to-transparent -skew-x-12 ${
                isLight ? 'via-white/50' : 'via-[#F6DC93]/18'
              }`}
            />
          </div>

          {/* Subtle floating ambient motes */}
          {!isLight && (
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
          )}

          {/* Delicate inner frame */}
          <div
            className={`absolute inset-2 rounded-[18px] border transition-colors duration-300 pointer-events-none ${
              isLight
                ? 'border-[#0D8A8A]/20 group-hover:border-[#0D8A8A]/45'
                : 'border-[#D4AE58]/36 group-hover:border-[#F3D179]/60'
            }`}
            aria-hidden="true"
          />

          {/* Clean Hokm Title ONLY */}
          <div className="absolute inset-0 flex flex-col justify-center items-start pr-6 sm:pr-11 pl-4 max-w-[54%] sm:max-w-[46%]">
            <h1
              className={`text-5xl sm:text-7xl font-extrabold tracking-tight leading-none ${
                isLight
                  ? 'text-[#0F172A] drop-shadow-[0_2px_10px_rgba(255,255,255,0.9)]'
                  : 'eyvan-gold-title'
              }`}
            >
              {hokmGame.name}
            </h1>
            <p
              className={`text-xs sm:text-base font-bold mt-3 flex items-center gap-1.5 ${
                isLight
                  ? 'text-[#334155]'
                  : 'text-[#FAF2DE] drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]'
              }`}
            >
              <span
                className={`eyvan-gentle-pulse ${
                  isLight ? 'text-[#0D8A8A]' : 'text-[#F3D179]'
                }`}
                aria-hidden="true"
              >
                ❖
              </span>
              <span>{hokmGame.subtitle}</span>
              <span
                className={`eyvan-gentle-pulse ${
                  isLight ? 'text-[#0D8A8A]' : 'text-[#F3D179]'
                }`}
                aria-hidden="true"
              >
                ❖
              </span>
            </p>
          </div>
        </div>
      </motion.button>

      {/* 2x2 GRID: OTHER GAMES */}
      <section aria-label="بازی‌های دیگر پلتفرم">
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          {otherGames.map((game, idx) => {
            const artSrc =
              isLight && game.lightArtworkSrc
                ? game.lightArtworkSrc
                : game.artworkSrc;

            return (
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
                className={`group relative rounded-[20px] overflow-hidden border-[1.5px] min-h-[146px] sm:min-h-[192px] flex flex-col justify-end transform-gpu transition-colors duration-200 ${
                  isLight
                    ? 'bg-white border-[#D6DFEA] hover:border-[#0D8A8A]/60 shadow-[0_8px_24px_rgba(15,23,42,0.08)]'
                    : 'bg-[#0C1A30] border-[#D4AE58]/55 hover:border-[#F3D179]/80 shadow-[0_10px_28px_rgba(12,26,52,0.2)]'
                }`}
              >
                <img
                  src={artSrc}
                  alt={game.name}
                  decoding="sync"
                  loading="eager"
                  className={`absolute inset-0 w-full h-full object-cover object-center opacity-100 group-hover:scale-[1.04] transition-transform duration-500 ease-out ${
                    isLight
                      ? 'brightness-[0.98] contrast-[1.04] saturate-[1.05]'
                      : 'brightness-[1.12] contrast-[1.05] saturate-[1.1]'
                  }`}
                />
                {/* Soft bottom-only scrim so upper artwork stays crisp with full detail */}
                <div
                  className={`absolute inset-0 ${
                    isLight
                      ? 'bg-gradient-to-t from-[#EFF4F8]/76 via-[#EFF4F8]/16 to-transparent'
                      : 'bg-gradient-to-t from-[#071122]/88 via-[#0A172C]/22 to-transparent'
                  }`}
                  aria-hidden="true"
                />

                <div className="relative z-10 p-3 sm:p-4 flex flex-col justify-between h-full">
                  <div className="flex items-center justify-end">
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] sm:text-xs font-bold backdrop-blur-xs px-2 py-0.5 rounded-lg border ${
                        isLight
                          ? 'text-[#334155] bg-white/88 border-[#CBD5E1] shadow-xs'
                          : 'text-[#F5D680] bg-[#081224]/72 border-[#D4AE58]/45'
                      }`}
                    >
                      <Lock className="w-3 h-3" />
                      <span>به‌زودی</span>
                    </span>
                  </div>

                  <div className="mt-auto pt-8">
                    <h2
                      className={`text-base sm:text-xl font-extrabold ${
                        isLight
                          ? 'text-[#0F172A]'
                          : 'text-[#FFFFFF] drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]'
                      }`}
                    >
                      {game.name}
                    </h2>
                    <p
                      className={`text-[11px] sm:text-xs mt-0.5 truncate ${
                        isLight
                          ? 'text-[#475569] font-semibold'
                          : 'text-[#E4ECF7] drop-shadow-[0_1px_5px_rgba(0,0,0,0.8)]'
                      }`}
                    >
                      {game.subtitle}
                    </p>
                  </div>
                </div>
              </motion.article>
            );
          })}
        </div>
      </section>

      {/* Subtle Installable PWA Prompt Card (only renders when installable / iOS & not installed) */}
      <PWAInstallButton variant="card" />
    </div>
  );
};
