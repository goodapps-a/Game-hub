import React from 'react';
import {
  Crown,
  Frame,
  Gem,
  Layers,
  LayoutGrid,
  Sparkles,
  SquareStack,
} from 'lucide-react';
import { ShopSectionId, ShopSectionMeta } from '../../types/platform';
import { ShopCategoryFilter } from '../../utils/shopHelpers';

interface ShopCategoriesProps {
  sections: readonly ShopSectionMeta[];
  activeCategory: ShopCategoryFilter;
  onSelectCategory: (category: ShopCategoryFilter) => void;
}

const SECTION_ICONS: Record<
  ShopSectionId,
  React.ComponentType<{ className?: string }>
> = {
  daily_deals: Sparkles,
  card_backs: SquareStack,
  table_themes: Layers,
  avatars_frames: Frame,
  visual_effects: Crown,
  chests: Gem,
};

/**
 * Structured 1-tap category switcher bar using clean architectural tabs (not pill spam).
 */
export const ShopCategories: React.FC<ShopCategoriesProps> = ({
  sections,
  activeCategory,
  onSelectCategory,
}) => {
  return (
    <nav
      aria-label="دسته‌بندی‌های فروشگاه"
      data-testid="shop-categories"
      className="flex items-center md:flex-wrap gap-1.5 sm:gap-2 overflow-x-auto md:overflow-visible pb-1 -mx-0.5 px-0.5 no-scrollbar"
    >
      <button
        type="button"
        data-shop-category="all"
        aria-pressed={activeCategory === 'all'}
        onClick={() => onSelectCategory('all')}
        className={`min-h-[40px] px-3 py-2 rounded-xl border text-xs font-extrabold inline-flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--eyvan-teal)] ${
          activeCategory === 'all'
            ? 'bg-[#0D8A8A] border-[#0D8A8A] text-white'
            : 'eyvan-card theme-muted hover:theme-heading'
        }`}
      >
        <LayoutGrid className="w-3.5 h-3.5 shrink-0" />
        <span>همه دسته‌ها</span>
      </button>

      {sections.map((section) => {
        const active = activeCategory === section.id;
        const Icon = SECTION_ICONS[section.id];
        return (
          <button
            key={section.id}
            type="button"
            data-shop-category={section.id}
            aria-pressed={active}
            onClick={() => onSelectCategory(section.id)}
            className={`min-h-[40px] px-3 py-2 rounded-xl border text-xs font-extrabold inline-flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--eyvan-teal)] ${
              active
                ? section.id === 'daily_deals'
                  ? 'bg-[#D4AE58] border-[#D4AE58] text-[#0B1528]'
                  : 'bg-[#0D8A8A] border-[#0D8A8A] text-white'
                : 'eyvan-card theme-muted hover:theme-heading'
            }`}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span>{section.title}</span>
          </button>
        );
      })}
    </nav>
  );
};
