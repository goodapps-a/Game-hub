import React from 'react';
import { motion } from 'motion/react';
import { Suit, SUIT_META, SUITS } from '../engine/types';
import { SuitIconSvg } from './PlayingCard';

interface TrumpSelectorProps {
  onSelectTrump: (suit: Suit) => void;
  reducedMotion?: boolean;
}

/**
 * Large, unmistakable icon-only Trump suit picker — zero suit words or explanatory copy,
 * framed with a radiant golden halo so the Hakem notices immediately.
 */
export const TrumpSelector: React.FC<TrumpSelectorProps> = ({
  onSelectTrump,
  reducedMotion = false,
}) => {
  return (
    <motion.div
      initial={reducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.82 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.88 }}
      transition={
        reducedMotion
          ? { duration: 0.05 }
          : { type: 'spring', stiffness: 320, damping: 22 }
      }
      className="relative"
      role="dialog"
      aria-label="انتخاب خال حکم"
      data-testid="trump-selector-dialog"
    >
      {/* Pulsing radiant gold spotlight behind the picker */}
      {!reducedMotion && (
        <motion.div
          animate={{ scale: [1, 1.07, 1], opacity: [0.45, 0.8, 0.45] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          className="pointer-events-none absolute -inset-4 rounded-[34px] bg-[radial-gradient(circle,rgba(243,209,121,0.42)_0%,rgba(212,174,88,0.12)_55%,transparent_75%)] blur-md"
          aria-hidden="true"
        />
      )}

      <div className="relative w-max shrink-0 bg-gradient-to-b from-[#0E2E26]/95 to-[#061814]/96 backdrop-blur-xl rounded-[28px] border-[2.5px] border-[#F3D179] shadow-[0_28px_72px_rgba(0,0,0,0.72),0_0_38px_rgba(243,209,121,0.34)] p-4 sm:p-6">
        <div className="grid grid-cols-2 gap-3.5 sm:gap-5">
          {SUITS.map((suit, idx) => {
            const meta = SUIT_META[suit];
            return (
              <motion.button
                key={suit}
                type="button"
                initial={
                  reducedMotion ? false : { opacity: 0, scale: 0.78, y: 8 }
                }
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={
                  reducedMotion
                    ? { duration: 0.05 }
                    : {
                        delay: idx * 0.045,
                        type: 'spring',
                        stiffness: 360,
                        damping: 22,
                      }
                }
                whileHover={reducedMotion ? undefined : { scale: 1.06, y: -3 }}
                whileTap={reducedMotion ? undefined : { scale: 0.94 }}
                onClick={() => onSelectTrump(suit)}
                aria-label={meta.faName}
                data-trump-suit={suit}
                className="w-[92px] h-[92px] sm:w-[116px] sm:h-[116px] flex items-center justify-center rounded-[20px] bg-gradient-to-b from-[#FFFFFF] to-[#F6F1E7] border-[2.5px] border-[#D4AE58]/75 hover:border-[#F8DD94] shadow-[0_12px_26px_rgba(0,0,0,0.42),inset_0_2px_0_rgba(255,255,255,0.95)] cursor-pointer focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#F3D179]"
              >
                <SuitIconSvg
                  suit={suit}
                  className="w-[50px] h-[50px] sm:w-[64px] sm:h-[64px] drop-shadow-[0_3px_6px_rgba(0,0,0,0.16)]"
                />
              </motion.button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
};
