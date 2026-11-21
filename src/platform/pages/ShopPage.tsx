import React, { useState } from 'react';
import {
  ArrowRight,
  ChevronLeft,
  Sparkles,
  X,
  Check,
} from 'lucide-react';
import {
  ShopItem,
  ShopRarity,
  ShopSectionId,
} from '../types/platform';
import { SHOP_ITEMS_DEMO, SHOP_SECTIONS } from '../data/shopCatalog';
import { toPersianDigits } from '../theme/tokens';
import { GoldCoinSvg, PurpleGemSvg } from '../components/TopBar';

const RARITY_STYLE: Record<
  ShopRarity,
  { label: string; border: string; badgeBg: string; glow: string }
> = {
  common: {
    label: 'معمولی',
    border: 'border-[#64748B]/45',
    badgeBg: 'bg-[#475569] text-white',
    glow: 'from-[#334155]/20 to-transparent',
  },
  rare: {
    label: 'کمیاب',
    border: 'border-[#14A3A8]/65',
    badgeBg: 'bg-[#0D8A8A] text-white',
    glow: 'from-[#14A3A8]/24 to-transparent',
  },
  epic: {
    label: 'حماسی',
    border: 'border-[#9B51E0]/70',
    badgeBg: 'bg-[#7E3AF2] text-white',
    glow: 'from-[#8E3CE0]/26 to-transparent',
  },
  legendary: {
    label: 'افسانه‌ای',
    border: 'border-[#E5B84B]/80',
    badgeBg: 'bg-gradient-to-l from-[#D4A028] to-[#F3D179] text-[#0B1528]',
    glow: 'from-[#F3D179]/28 to-transparent',
  },
};

/**
 * Collectible thumbnail artwork: uses bespoke generated images when available
 * (chests, traditional table), or crisp Persian geometric vector art.
 */
const ShopItemThumb: React.FC<{
  item: ShopItem;
  size?: 'compact' | 'card' | 'modal';
}> = ({ item, size = 'compact' }) => {
  const [c1, c2, c3] = item.palette;
  const heightClass =
    size === 'modal'
      ? 'h-48'
      : size === 'card'
        ? 'h-32 sm:h-36'
        : 'h-[88px] sm:h-[118px]';

  if (item.imageSrc) {
    return (
      <div
        className={`w-full ${heightClass} rounded-xl overflow-hidden relative bg-[#0B172C] border border-[#D4AE58]/25`}
      >
        <img
          src={item.imageSrc}
          alt={item.name}
          decoding="sync"
          loading="eager"
          referrerPolicy="no-referrer"
          className={`w-full h-full object-cover object-center ${
            item.imageCropScale ? 'scale-[1.15]' : ''
          }`}
        />
      </div>
    );
  }

  return (
    <div
      className={`w-full ${heightClass} rounded-xl overflow-hidden relative flex items-center justify-center border border-[#D4AE58]/28`}
      style={{ backgroundColor: c1 }}
    >
      <svg
        viewBox="0 0 240 150"
        fill="none"
        className="w-full h-full"
        aria-hidden="true"
      >
        <rect width="240" height="150" fill={c1} />
        <rect
          x="10"
          y="10"
          width="220"
          height="130"
          rx="10"
          stroke={c3}
          strokeWidth="1.4"
          strokeOpacity="0.6"
        />

        {item.motif === 'shamsa' && (
          <g>
            <circle
              cx="120"
              cy="75"
              r="42"
              fill={c2}
              fillOpacity="0.34"
              stroke={c3}
              strokeWidth="1.5"
            />
            <path
              d="M120 35L130 60L156 56L140 75L156 94L130 90L120 115L110 90L84 94L100 75L84 56L110 60L120 35Z"
              fill={c3}
              fillOpacity="0.92"
            />
            <circle
              cx="120"
              cy="75"
              r="12"
              fill={c1}
              stroke={c2}
              strokeWidth="2.2"
            />
          </g>
        )}

        {item.motif === 'arch' && (
          <g>
            <path
              d="M68 130V68C68 42 92 27 120 18C148 27 172 42 172 68V130"
              fill={c2}
              fillOpacity="0.24"
              stroke={c3}
              strokeWidth="2"
            />
            <rect
              x="95"
              y="42"
              width="50"
              height="72"
              rx="6"
              fill="#FCFBF8"
              stroke={c3}
              strokeWidth="1.6"
            />
            <path d="M120 62L131 78L120 94L109 78L120 62Z" fill={c2} />
          </g>
        )}

        {item.motif === 'kashi' && (
          <g>
            {[0, 1, 2].map((col) => (
              <path
                key={col}
                d={`M${68 + col * 52} 36L${94 + col * 52} 75L${68 + col * 52} 114L${42 + col * 52} 75Z`}
                fill={col === 1 ? c3 : c2}
                fillOpacity={col === 1 ? '0.88' : '0.45'}
                stroke={c3}
                strokeWidth="1.3"
              />
            ))}
          </g>
        )}

        {item.motif === 'carpet' && (
          <g>
            <rect
              x="32"
              y="24"
              width="176"
              height="102"
              rx="8"
              fill={c2}
              fillOpacity="0.6"
              stroke={c3}
              strokeWidth="1.5"
            />
            <path
              d="M120 38L165 75L120 112L75 75L120 38Z"
              fill={c1}
              stroke={c3}
              strokeWidth="1.5"
            />
            <circle cx="120" cy="75" r="13" fill={c3} fillOpacity="0.9" />
          </g>
        )}

        {item.motif === 'star' && (
          <g>
            <circle
              cx="120"
              cy="75"
              r="44"
              stroke={c3}
              strokeWidth="1.1"
              strokeDasharray="3 4"
            />
            <path
              d="M120 36L132 62L160 75L132 88L120 114L108 88L80 75L108 62L120 36Z"
              fill={c2}
              stroke={c3}
              strokeWidth="1.6"
            />
            <circle cx="120" cy="75" r="9" fill={c3} />
          </g>
        )}

        {item.motif === 'cypress' && (
          <g>
            <path
              d="M120 26C138 48 146 72 146 94C146 111 135 122 120 122C105 122 94 111 94 94C94 72 102 48 120 26Z"
              fill={c2}
              fillOpacity="0.88"
              stroke={c3}
              strokeWidth="1.6"
            />
            <path
              d="M120 44C130 59 134 76 134 94C134 103 128 110 120 110C112 110 106 103 106 94C106 76 110 59 120 44Z"
              stroke={c3}
              strokeWidth="1.1"
              strokeOpacity="0.85"
            />
          </g>
        )}
      </svg>
    </div>
  );
};

/**
 * Compact Clash-Royale-style collectible slot card.
 */
const CompactShopSlot: React.FC<{
  item: ShopItem;
  onSelect: (item: ShopItem) => void;
  expanded?: boolean;
}> = ({ item, onSelect, expanded = false }) => {
  const rarity = RARITY_STYLE[item.rarity];

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      data-shop-item={item.id}
      className={`group relative eyvan-card eyvan-card-hover rounded-2xl border-[1.5px] ${rarity.border} ${
        expanded ? 'p-3 sm:p-4' : 'p-2 sm:p-3'
      } flex flex-col justify-between text-right overflow-hidden cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AE58]`}
    >
      {/* Top rarity ambient gradient */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b ${rarity.glow}`}
        aria-hidden="true"
      />

      <div className="relative z-10 w-full space-y-2">
        <div className="relative">
          <ShopItemThumb item={item} size={expanded ? 'card' : 'compact'} />
          {item.badge && (
            <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-extrabold bg-[#DC2626] text-white shadow">
              {item.badge}
            </span>
          )}
        </div>

        <div className="min-w-0">
          <div className="text-[11px] sm:text-sm font-extrabold theme-heading truncate leading-snug">
            {item.name}
          </div>
          {expanded && (
            <p className="text-[11px] sm:text-xs theme-muted mt-0.5 line-clamp-2">
              {item.subtitle}
            </p>
          )}
        </div>
      </div>

      {/* Bottom Price Button Bar (Clash Royale Shelf Feel) */}
      <div className="relative z-10 w-full mt-2.5 pt-2 border-t border-[var(--eyvan-gold-border)] flex items-center justify-center">
        {item.isDefaultOwned ? (
          <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs font-extrabold theme-win">
            <Check className="w-3.5 h-3.5" />
            <span>فعال</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gradient-to-b from-[#F3D179] to-[#C89B3C] text-[#0B1628] text-[11px] sm:text-xs font-extrabold tabular-nums shadow-xs">
            {item.currency === 'gems' ? (
              <PurpleGemSvg size={14} />
            ) : (
              <GoldCoinSvg size={14} />
            )}
            <span>{toPersianDigits(item.price.toLocaleString())}</span>
          </span>
        )}
      </div>
    </button>
  );
};

interface ShopPageProps {
  userCoins: number;
  userGems: number;
}

export const ShopPage: React.FC<ShopPageProps> = ({ userCoins, userGems }) => {
  const [activeSectionId, setActiveSectionId] = useState<ShopSectionId | null>(
    null
  );
  const [previewItem, setPreviewItem] = useState<ShopItem | null>(null);

  const activeSection = activeSectionId
    ? SHOP_SECTIONS.find((s) => s.id === activeSectionId) ?? null
    : null;

  return (
    <div className="space-y-5 max-w-4xl mx-auto" data-testid="shop-page">
      {/* Top Banner Header (فروشگاه) */}
      <section className="eyvan-card rounded-2xl p-4 sm:p-5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          {activeSection ? (
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setActiveSectionId(null)}
                data-testid="shop-back-btn"
                className="min-w-[38px] min-h-[38px] rounded-xl theme-btn-secondary border flex items-center justify-center cursor-pointer shrink-0"
                aria-label="بازگشت به فروشگاه"
              >
                <ArrowRight className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-2xl font-extrabold eyvan-gold-title-adaptive truncate">
                  {activeSection.title}
                </h1>
                <p className="text-xs theme-muted truncate">
                  {activeSection.subtitle}
                </p>
              </div>
            </div>
          ) : (
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold eyvan-gold-title-adaptive">
                فروشگاه
              </h1>
              <p className="text-xs sm:text-sm theme-muted mt-0.5">
                پیشنهادهای روزانه، پوسته‌ها و صندوق‌های ایوان
              </p>
            </div>
          )}
        </div>

        {/* Coins & Gems Summary */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <div className="px-2.5 py-1.5 rounded-xl theme-subcard border flex items-center gap-1.5 text-xs sm:text-sm font-extrabold theme-heading tabular-nums">
            <GoldCoinSvg size={16} />
            <span>{toPersianDigits(userCoins.toLocaleString())}</span>
          </div>
          <div className="px-2.5 py-1.5 rounded-xl theme-subcard border flex items-center gap-1.5 text-xs sm:text-sm font-extrabold theme-heading tabular-nums">
            <PurpleGemSvg size={16} />
            <span>{toPersianDigits(userGems.toLocaleString())}</span>
          </div>
        </div>
      </section>

      {/* DEDICATED FULL CATEGORY PAGE (when user clicks "مشاهده همه") */}
      {activeSection ? (
        <section
          aria-label={activeSection.title}
          data-testid={`shop-category-view-${activeSection.id}`}
          className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4"
        >
          {SHOP_ITEMS_DEMO.filter((item) => item.section === activeSection.id).map(
            (item) => (
              <CompactShopSlot
                key={item.id}
                item={item}
                onSelect={setPreviewItem}
                expanded
              />
            )
          )}
        </section>
      ) : (
        /* CLASH ROYALE-STYLE VERTICAL SCROLLING SHOWCASE (Zero category filter pills!) */
        <div className="space-y-6">
          {SHOP_SECTIONS.map((section) => {
            const sectionItems = SHOP_ITEMS_DEMO.filter(
              (item) => item.section === section.id
            );
            const previewThree = sectionItems.slice(0, 3);

            return (
              <section
                key={section.id}
                data-shop-section={section.id}
                className="space-y-3"
              >
                {/* Section Shelf Header + "مشاهده همه" button */}
                <div className="flex items-center justify-between gap-2 px-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-1.5 h-6 rounded-full shrink-0"
                      style={{ backgroundColor: section.accentColor }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="text-base sm:text-lg font-extrabold theme-heading truncate">
                          {section.title}
                        </h2>
                        {section.badge && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-gradient-to-l from-[#D4A028] to-[#F3D179] text-[#0B1528] shrink-0">
                            <Sparkles className="w-2.5 h-2.5" />
                            <span>{section.badge}</span>
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] sm:text-xs theme-muted truncate">
                        {section.subtitle}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveSectionId(section.id)}
                    data-testid={`shop-more-${section.id}`}
                    className="min-h-[36px] px-3 py-1.5 rounded-xl theme-btn-secondary border text-xs font-bold inline-flex items-center gap-1 shrink-0 whitespace-nowrap cursor-pointer transition-colors"
                  >
                    <span>مشاهده همه</span>
                    <ChevronLeft className="w-3.5 h-3.5 theme-accent-teal" />
                  </button>
                </div>

                {/* 3 Compact Collectible Items Row */}
                <div className="grid grid-cols-3 gap-2 sm:gap-3.5">
                  {previewThree.map((item) => (
                    <CompactShopSlot
                      key={item.id}
                      item={item}
                      onSelect={setPreviewItem}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Item Preview Modal */}
      {previewItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label={`پیش‌نمایش ${previewItem.name}`}
          data-testid="shop-preview-modal"
        >
          <div
            className="fixed inset-0"
            onClick={() => setPreviewItem(null)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-full max-w-md theme-drawer rounded-2xl border border-[#D4AE58]/70 shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded-md text-[11px] font-extrabold ${
                    RARITY_STYLE[previewItem.rarity].badgeBg
                  }`}
                >
                  {RARITY_STYLE[previewItem.rarity].label}
                </span>
                <h3 className="text-base font-bold theme-heading">
                  پیش‌نمایش آیتم
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                aria-label="بستن پیش‌نمایش"
                className="min-w-[38px] min-h-[38px] rounded-lg flex items-center justify-center theme-muted hover:bg-black/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <ShopItemThumb item={previewItem} size="modal" />

            <div className="space-y-1.5">
              <div className="text-lg font-extrabold theme-heading">
                {previewItem.name}
              </div>
              <p className="text-sm theme-muted leading-relaxed">
                {previewItem.description}
              </p>
            </div>

            <div className="p-3 rounded-xl theme-subcard border flex items-center justify-between gap-2 text-xs">
              <span className="theme-muted font-semibold">
                {previewItem.isDefaultOwned ? 'وضعیت:' : 'قیمت نمایشی:'}
              </span>
              {previewItem.isDefaultOwned ? (
                <span className="font-extrabold theme-win">فعال در حساب شما</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-extrabold theme-heading tabular-nums text-sm">
                  {previewItem.currency === 'gems' ? (
                    <PurpleGemSvg size={16} />
                  ) : (
                    <GoldCoinSvg size={16} />
                  )}
                  <span>
                    {toPersianDigits(previewItem.price.toLocaleString())}{' '}
                    {previewItem.currency === 'gems' ? 'الماس' : 'سکه'}
                  </span>
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => setPreviewItem(null)}
              className="w-full min-h-[44px] rounded-xl bg-gradient-to-b from-[#F3D179] to-[#C89B3C] hover:from-[#F8DD94] hover:to-[#D4AE58] text-[#0B1628] text-sm font-extrabold cursor-pointer transition-all"
            >
              بستن پیش‌نمایش
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
