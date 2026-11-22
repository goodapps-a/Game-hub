import React from 'react';
import { Check, Lock } from 'lucide-react';
import { toPersianDigits } from '../../../platform/theme/tokens';
import { CARD_SKINS } from './registry';
import { useCardSkin } from './CardSkinContext';
import { CardSkinPreview } from './CardSkinPreview';

const RARITY_LABEL = {
  common: 'معمولی',
  rare: 'کمیاب',
  epic: 'حماسی',
  legendary: 'افسانه‌ای',
} as const;

/**
 * Lets the player choose which owned skin is used on the table.
 * Purely a selector: it never charges anything (see config.CARD_SKIN_PREVIEW_MODE).
 */
export const CardSkinPicker: React.FC = () => {
  const { skinId, equip, isOwned } = useCardSkin();

  return (
    <div className="space-y-2" role="radiogroup" aria-label="طرح کارت‌های حکم">
      {CARD_SKINS.map((s) => {
        const active = s.id === skinId;
        const owned = isOwned(s.id);
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={!owned}
            onClick={() => equip(s.id)}
            className={`w-full flex items-center gap-3 p-2.5 rounded-xl theme-subcard border text-right transition-colors ${
              active ? 'ring-2 ring-[#D4AE58]' : ''
            } ${owned ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}
          >
            <CardSkinPreview skinId={s.id} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold theme-heading truncate">{s.name}</div>
              <div className="text-[11px] theme-muted mt-0.5 truncate">
                {s.englishName} · {RARITY_LABEL[s.rarity]}
              </div>
              <div className="text-[11px] mt-1 font-semibold theme-accent-gold">
                {active
                  ? 'در حال استفاده'
                  : owned
                    ? s.price === 0
                      ? 'رایگان'
                      : 'انتخاب'
                    : `${toPersianDigits(s.price)} ${s.currency === 'gems' ? 'الماس' : 'سکه'}`}
              </div>
            </div>
            <span className="w-6 h-6 shrink-0 flex items-center justify-center" aria-hidden="true">
              {active ? (
                <Check className="w-5 h-5 text-[#19A2A2]" />
              ) : !owned ? (
                <Lock className="w-4 h-4 theme-muted" />
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
};
