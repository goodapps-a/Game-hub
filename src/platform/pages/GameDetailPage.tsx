import React, { useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Bot,
  ChevronLeft,
  Clock,
  Crown,
  Flame,
  KeyRound,
  Play,
  ShoppingBag,
  Shuffle,
  Spade,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import { GAME_REGISTRY } from '../../games/registry';
import { toPersianDigits } from '../theme/tokens';
import { GameId, ShopItem, ThemeMode } from '../types/platform';
import { HokmMatchVariantId } from '../utils/gameHubHelpers';
import { HokmRulesTab } from '../components/gameHub/HokmRulesTab';
import { HokmLeaderboardTab } from '../components/gameHub/HokmLeaderboardTab';
import { HokmShopTab } from '../components/gameHub/HokmShopTab';
import { HokmAnimatedBackdrop } from '../components/gameHub/HokmAnimatedBackdrop';
import { useOnlineStatus } from '../pwa/useOnlineStatus';

export interface GameHubLaunchRequest {
  readonly mode: 'random' | 'friends_create' | 'friends_join' | 'offline';
  readonly targetMatchScore: number;
  readonly roomCode?: string;
}

export type HokmHubSubView = 'hub' | 'modes' | 'rules' | 'leaderboard' | 'shop';

interface GameDetailPageProps {
  gameId: GameId;
  themeMode?: ThemeMode;
  subView?: HokmHubSubView;
  onSubViewChange?: (next: HokmHubSubView) => void;
  currentUserId?: string | null;
  userCoins: number;
  userGems: number;
  isAuthenticated?: boolean;
  ownedItemIds?: readonly string[];
  equippedTableSkinId?: string;
  equippedBannerCode?: string;
  equippedDeckId?: string;
  onPurchaseItem?: (item: ShopItem) => void;
  onEquipItem?: (item: ShopItem) => void;
  onSelectDeck?: (deckId: string) => void | Promise<void>;
  onRequireAuth?: () => void;
  onBack: () => void;
  onLaunchHokm: (req: GameHubLaunchRequest) => void;
  onOpenFullShop: () => void;
}

type ModeLaunchTarget = 'random' | 'friends_create' | 'offline';

interface ModeCardVisual {
  readonly id: HokmMatchVariantId;
  readonly title: string;
  readonly subtitle: string;
  readonly handsRibbon: string;
  readonly targetScore: number;
  readonly durationLabel: string;
  readonly tierLabel: string;
  readonly testId: string;
  readonly cardGradient: string;
  readonly ribbonBg: string;
  readonly borderAccent: string;
  readonly icon: React.ComponentType<{ className?: string }>;
}

const MODE_CARDS: readonly ModeCardVisual[] = [
  {
    id: 'single_1',
    title: 'تک‌دست فوری',
    subtitle: 'یک دست برق‌آسا و هیجانی · برنده اولین ۷ امتیاز دست پیروز است',
    handsRibbon: '۱ دست',
    targetScore: 1,
    durationLabel: 'حدود ۲ دقیقه',
    tierLabel: 'فوری',
    testId: 'hokm-mode-card-single_1',
    cardGradient: 'from-[#0D5B47] via-[#0B7760] to-[#083B35]',
    ribbonBg: 'from-[#F9E3A0] via-[#E5B84B] to-[#BC8822]',
    borderAccent: 'border-[#5AE5BE]/55',
    icon: Zap,
  },
  {
    id: 'quick_3',
    title: 'حکم سریع',
    subtitle: 'رقابت متعادل و پرطرفدار آنلاین · تیم اول با ۳ امتیاز پیروز میدان',
    handsRibbon: '۳ دست',
    targetScore: 3,
    durationLabel: 'حدود ۵ دقیقه',
    tierLabel: 'محبوب‌ترین',
    testId: 'hokm-play-random-btn',
    cardGradient: 'from-[#7B1A33] via-[#9C2342] to-[#4A0E22]',
    ribbonBg: 'from-[#FFE9A6] via-[#F2BE4E] to-[#C6861E]',
    borderAccent: 'border-[#F3D179]/70',
    icon: Flame,
  },
  {
    id: 'classic_7',
    title: 'حکم کلاسیک',
    subtitle: 'نبرد اصیل و استراتژیک ایرانی · تا ۷ دست کامل با کُت و حاکم‌کُت',
    handsRibbon: '۷ دست',
    targetScore: 7,
    durationLabel: 'حدود ۱۲ دقیقه',
    tierLabel: 'حرفه‌ای',
    testId: 'hokm-mode-card-classic_7',
    cardGradient: 'from-[#14376A] via-[#1B4E8F] to-[#0D2144]',
    ribbonBg: 'from-[#C8F3F0] via-[#45D0C5] to-[#0F8C86]',
    borderAccent: 'border-[#7CE9E0]/55',
    icon: Crown,
  },
];



export const GameDetailPage: React.FC<GameDetailPageProps> = ({
  gameId,
  themeMode = 'dark',
  subView: controlledSubView,
  onSubViewChange,
  currentUserId = null,
  userCoins,
  userGems,
  isAuthenticated = false,
  ownedItemIds = [],
  equippedTableSkinId = 'tt-traditional',
  equippedBannerCode = 'royal',
  equippedDeckId,
  onPurchaseItem,
  onEquipItem,
  onSelectDeck,
  onRequireAuth,
  onBack,
  onLaunchHokm,
  onOpenFullShop,
}) => {
  const game =
    GAME_REGISTRY.find((g) => g.id === gameId) ?? GAME_REGISTRY[0];
  const isLight = themeMode === 'light';
  const isOnline = useOnlineStatus();

  const [internalSubView, setInternalSubView] =
    useState<HokmHubSubView>('hub');
  const subView = controlledSubView ?? internalSubView;
  const setSubView = (next: HokmHubSubView) => {
    setInternalSubView(next);
    onSubViewChange?.(next);
  };

  const [friendsPanelOpen, setFriendsPanelOpen] = useState(false);
  const [launchTarget, setLaunchTarget] = useState<ModeLaunchTarget>('random');
  const [friendRoomCode, setFriendRoomCode] = useState('');
  const [roomCodeError, setRoomCodeError] = useState<string | null>(null);

  const handleJoinFriendCode = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = friendRoomCode
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (cleaned.length < 4) {
      setRoomCodeError('کد اتاق باید حداقل ۴ کاراکتر باشد.');
      return;
    }
    setRoomCodeError(null);
    onLaunchHokm({
      mode: 'friends_join',
      targetMatchScore: 3,
      roomCode: cleaned,
    });
  };

  // =========================================================================
  // VIEW 1: FULL-SCREEN HOKM HUB (No photo clutter, Left-aligned Back Arrow)
  // =========================================================================
  if (subView === 'hub') {
    const bottomTiles = [
      {
        id: 'rules',
        label: 'آموزش',
        subtitle: 'قوانین ساده',
        icon: BookOpen,
        testId: 'game-hub-tab-rules',
        onClick: () => setSubView('rules'),
        cardCls: isLight
          ? 'bg-white/92 hover:bg-white border-[#B9E6E2] hover:border-[#0D9488] shadow-[0_10px_24px_rgba(13,148,136,0.12)]'
          : 'bg-gradient-to-b from-[#0E2F38]/92 to-[#091D29]/95 hover:from-[#123D48] border-[#2DD4BF]/38 hover:border-[#5EEAD4]/75 shadow-[0_12px_28px_rgba(0,0,0,0.4)]',
        medallionCls:
          'bg-gradient-to-br from-[#34D399] via-[#0D9488] to-[#0F766E] text-white shadow-[0_6px_16px_rgba(13,148,136,0.42)]',
        titleCls: isLight ? 'text-[#0F172A]' : 'text-[#ECFDF5]',
        subCls: isLight ? 'text-[#0F766E]' : 'text-[#7CEEE4]',
      },
      {
        id: 'leaderboard',
        label: 'برترین‌ها',
        subtitle: 'جدول امتیاز',
        icon: Trophy,
        testId: 'game-hub-tab-leaderboard',
        onClick: () => setSubView('leaderboard'),
        cardCls: isLight
          ? 'bg-white/92 hover:bg-white border-[#F3D89B] hover:border-[#D97706] shadow-[0_10px_24px_rgba(217,119,6,0.12)]'
          : 'bg-gradient-to-b from-[#2B2313]/92 to-[#17130C]/95 hover:from-[#3A2E17] border-[#F3D179]/42 hover:border-[#FDE68A]/80 shadow-[0_12px_28px_rgba(0,0,0,0.4)]',
        medallionCls:
          'bg-gradient-to-br from-[#FDE68A] via-[#F59E0B] to-[#B45309] text-[#1A1003] shadow-[0_6px_16px_rgba(245,158,11,0.42)]',
        titleCls: isLight ? 'text-[#0F172A]' : 'text-[#FFF7DF]',
        subCls: isLight ? 'text-[#B45309]' : 'text-[#F5D37B]',
      },
      {
        id: 'shop',
        label: 'فروشگاه',
        subtitle: 'پوسته و میز',
        icon: ShoppingBag,
        testId: 'game-hub-tab-shop',
        onClick: () => setSubView('shop'),
        cardCls: isLight
          ? 'bg-white/92 hover:bg-white border-[#D8C7FA] hover:border-[#7C3AED] shadow-[0_10px_24px_rgba(124,58,237,0.12)]'
          : 'bg-gradient-to-b from-[#20193B]/92 to-[#120F26]/95 hover:from-[#2B2150] border-[#A78BFA]/42 hover:border-[#C4B5FD]/80 shadow-[0_12px_28px_rgba(0,0,0,0.4)]',
        medallionCls:
          'bg-gradient-to-br from-[#D8B4FE] via-[#8B5CF6] to-[#6D28D9] text-white shadow-[0_6px_16px_rgba(139,92,246,0.44)]',
        titleCls: isLight ? 'text-[#0F172A]' : 'text-[#F5F3FF]',
        subCls: isLight ? 'text-[#6D28D9]' : 'text-[#C4B5FD]',
      },
    ];

    return (
      <div
        data-testid="game-detail-page"
        className={`relative min-h-[100dvh] w-full overflow-hidden flex flex-col justify-between ${
          isLight ? 'bg-[#F4F6FA] text-[#111827]' : 'bg-[#08101E] text-[#F5EFE4]'
        }`}
      >
        <HokmAnimatedBackdrop isLight={isLight} />

        {/* Top Navigation Strip — Clean LEFT-aligned Back Arrow ONLY */}
        <header className="relative z-10 w-full max-w-5xl mx-auto flex items-center justify-end px-4 sm:px-6 pt-4 sm:pt-6">
          <button
            type="button"
            onClick={onBack}
            data-testid="game-hub-back-btn"
            className={`min-h-[42px] px-4 rounded-xl border text-xs sm:text-sm font-extrabold inline-flex items-center gap-2 backdrop-blur-md cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
              isLight
                ? 'bg-white/88 hover:bg-white border-[#CBD5E1] text-[#0F172A] shadow-xs'
                : 'bg-[#0C1C34]/82 hover:bg-[#132949] border-[#F3D179]/35 text-[#F8FAFC]'
            }`}
          >
            <span>بازگشت</span>
            <ArrowLeft
              className={`w-4 h-4 shrink-0 ${
                isLight ? 'text-[#0D8A8A]' : 'text-[#F3D179]'
              }`}
            />
          </button>
        </header>

        {/* Center Emblem + Cleanly Separated Action Stack */}
        <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 sm:px-8 py-5 sm:py-8 gap-7">
          {/* Sculpted Persian Game Crest */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center gap-2.5 mb-1">
              <span
                className={`h-px w-10 bg-gradient-to-l to-transparent ${
                  isLight ? 'from-[#0D8A8A]' : 'from-[#F3D179]'
                }`}
              />
              <Crown
                className={`w-6 h-6 ${
                  isLight
                    ? 'text-[#D49A2A]'
                    : 'text-[#F6D983] drop-shadow-[0_0_12px_rgba(246,217,131,0.55)]'
                }`}
              />
              <span
                className={`h-px w-10 bg-gradient-to-r to-transparent ${
                  isLight ? 'from-[#0D8A8A]' : 'from-[#F3D179]'
                }`}
              />
            </div>
            <h1
              className={`text-5xl sm:text-6xl font-black tracking-tight leading-none ${
                isLight
                  ? 'text-[#0F172A]'
                  : 'eyvan-gold-title drop-shadow-[0_6px_22px_rgba(0,0,0,0.65)]'
              }`}
            >
              {game.name}
            </h1>
            <p
              className={`text-xs sm:text-sm font-semibold ${
                isLight ? 'text-[#475569]' : 'text-[#B9CCE3]'
              }`}
            >
              تالار رسمی حکم ایوان · انتخاب سریع و ورود به میز
            </p>
          </div>

          {/* Separated Action Buttons Column */}
          <div className="w-full max-w-[388px] space-y-3.5">
            {/* HERO PRIMARY CTA: شروع بازی */}
            <button
              type="button"
              data-testid="hokm-open-modes-btn"
              onClick={() => setSubView('modes')}
              className="group relative w-full min-h-[78px] px-5 py-3.5 rounded-2xl overflow-hidden bg-gradient-to-l from-[#F7DC8C] via-[#DFAC44] to-[#B77C1B] hover:brightness-[1.06] active:scale-[0.985] border-2 border-[#FFF1C2]/90 shadow-[0_14px_34px_rgba(200,148,40,0.38),inset_0_2px_0_rgba(255,255,255,0.65)] flex items-center justify-between gap-3 cursor-pointer transition-all"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 -right-1/2 w-1/2 bg-gradient-to-l from-transparent via-white/35 to-transparent -skew-x-12 animate-[eyvanCapsuleSheen_3.2s_ease-in-out_infinite]"
              />

              <div className="relative flex items-center gap-3.5 min-w-0">
                <span className="w-12 h-12 rounded-xl bg-[#0D1A30]/90 border border-[#FFE9A6]/70 flex items-center justify-center shadow-inner shrink-0 group-hover:scale-105 transition-transform">
                  <Spade className="w-6 h-6 text-[#F8DF93] fill-[#F8DF93]/30" />
                </span>
                <div className="text-right min-w-0">
                  <div className="text-xl font-black text-[#0B1528] leading-tight">
                    شروع بازی
                  </div>
                  <div className="text-[11px] font-extrabold text-[#231805]/85 truncate mt-0.5">
                    تک‌دست · حکم سریع · کلاسیک
                  </div>
                </div>
              </div>

              <span className="relative w-9 h-9 rounded-xl bg-[#0B1528]/18 flex items-center justify-center shrink-0">
                <ChevronLeft className="w-5 h-5 text-[#0B1528] stroke-[2.75]" />
              </span>
            </button>

            {/* SECONDARY CTA 1: بازی با دوستان */}
            <div className="space-y-2.5">
              <button
                type="button"
                data-testid="hokm-friends-drawer-toggle"
                onClick={() => setFriendsPanelOpen((prev) => !prev)}
                className={`w-full min-h-[58px] px-4 rounded-2xl border backdrop-blur-md flex items-center justify-between gap-3 cursor-pointer transition-all ${
                  isLight
                    ? friendsPanelOpen
                      ? 'bg-[#E6F7F7] border-[#0D8A8A] shadow-[0_8px_20px_rgba(13,138,138,0.16)]'
                      : 'bg-white/90 hover:bg-white border-[#CBD8E6] hover:border-[#0D8A8A]/65 shadow-[0_6px_18px_rgba(15,23,42,0.06)]'
                    : friendsPanelOpen
                      ? 'bg-gradient-to-l from-[#0F7F7F]/95 to-[#0B4F64]/95 border-[#6EECE2]/70 shadow-[0_10px_26px_rgba(13,138,138,0.34)]'
                      : 'bg-[#0D2742]/84 hover:bg-[#113557]/92 border-[#4DD9CE]/45 shadow-[0_8px_22px_rgba(0,0,0,0.32)]'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${
                      isLight
                        ? 'bg-[#0D8A8A]/12 border-[#0D8A8A]/30'
                        : 'bg-[#0D8A8A]/30 border-[#5DE3D8]/45'
                    }`}
                  >
                    <Users
                      className={`w-4.5 h-4.5 ${
                        isLight ? 'text-[#0D8A8A]' : 'text-[#7CF4EA]'
                      }`}
                    />
                  </span>
                  <span
                    className={`text-sm sm:text-base font-extrabold ${
                      isLight ? 'text-[#0F172A]' : 'text-[#F5FAFF]'
                    }`}
                  >
                    بازی با دوستان
                  </span>
                </div>
                <span
                  className={`text-[11px] font-bold ${
                    isLight ? 'text-[#0D8A8A]' : 'text-[#8FF2E8]'
                  }`}
                >
                  {friendsPanelOpen ? 'بستن' : 'میز اختصاصی'}
                </span>
              </button>

              {friendsPanelOpen && (
                <div
                  data-testid="hokm-friends-inline-panel"
                  className={`rounded-2xl border p-3.5 space-y-2.5 backdrop-blur-md shadow-xl ${
                    isLight
                      ? 'bg-white border-[#CBD8E6]'
                      : 'bg-[#0A182E]/94 border-[#4DD9CE]/40'
                  }`}
                >
                  <button
                    type="button"
                    data-testid="hokm-play-friends-create-btn"
                    onClick={() =>
                      onLaunchHokm({
                        mode: 'friends_create',
                        targetMatchScore: 3,
                      })
                    }
                    className="w-full min-h-[44px] px-4 rounded-xl bg-[#0D8A8A] hover:bg-[#10A0A0] text-white text-xs sm:text-sm font-extrabold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
                  >
                    <Users className="w-4 h-4 shrink-0" />
                    <span>ساخت میز دوستانه جدید</span>
                  </button>

                  <form
                    onSubmit={handleJoinFriendCode}
                    className={`flex items-center gap-2 pt-2 border-t ${
                      isLight ? 'border-[#E2E8F0]' : 'border-white/10'
                    }`}
                  >
                    <div className="relative flex-1 min-w-0">
                      <KeyRound
                        className={`w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none ${
                          isLight ? 'text-[#64748B]' : 'text-[#9FB2CC]'
                        }`}
                      />
                      <input
                        type="text"
                        dir={friendRoomCode.length > 0 ? 'ltr' : 'rtl'}
                        maxLength={8}
                        value={friendRoomCode}
                        onChange={(e) => {
                          setFriendRoomCode(
                            e.target.value
                              .toUpperCase()
                              .replace(/[^A-Z0-9]/g, '')
                          );
                          if (roomCodeError) setRoomCodeError(null);
                        }}
                        placeholder="کد اتاق (مثلاً K7P2M9)"
                        aria-label="کد اتاق دوستانه"
                        data-testid="hokm-friend-code-input"
                        className={`w-full min-h-[42px] pr-9 pl-3 rounded-xl border text-xs font-bold focus:outline-none focus:ring-2 focus:ring-[#2CC5BE] ${
                          isLight
                            ? 'bg-[#F8FAFC] border-[#CBD5E1] text-[#0F172A] placeholder:text-[#94A3B8]'
                            : 'bg-[#071222] border-white/15 text-white placeholder:text-[#7E92AE]'
                        } ${
                          friendRoomCode.length > 0
                            ? 'font-mono tracking-wider uppercase text-left'
                            : 'text-right'
                        }`}
                      />
                    </div>
                    <button
                      type="submit"
                      data-testid="hokm-friend-code-join-btn"
                      className="min-h-[42px] px-4 rounded-xl bg-[#F3D179] hover:bg-[#F9DE96] text-[#0B1628] text-xs font-black whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      ورود
                    </button>
                  </form>
                  {roomCodeError && (
                    <p className="text-[11px] font-bold text-[#EF4444]">
                      {roomCodeError}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* SECONDARY CTA 2: تمرین آفلاین */}
            <button
              type="button"
              data-testid="hokm-play-offline-btn"
              onClick={() =>
                onLaunchHokm({
                  mode: 'offline',
                  targetMatchScore: 3,
                })
              }
              className={`w-full min-h-[56px] px-4 rounded-2xl border backdrop-blur-md flex items-center justify-between gap-3 cursor-pointer transition-all ${
                isLight
                  ? 'bg-white/90 hover:bg-white border-[#CBD8E6] hover:border-[#94A3B8] shadow-[0_6px_18px_rgba(15,23,42,0.06)]'
                  : 'bg-[#101E36]/84 hover:bg-[#172B4B]/92 border-white/20 shadow-[0_8px_20px_rgba(0,0,0,0.28)]'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${
                    isLight
                      ? 'bg-[#F1F5F9] border-[#CBD5E1]'
                      : 'bg-white/10 border-white/15'
                  }`}
                >
                  <Bot
                    className={`w-4.5 h-4.5 ${
                      isLight ? 'text-[#334155]' : 'text-[#D8E5F8]'
                    }`}
                  />
                </span>
                <span
                  className={`text-sm sm:text-base font-extrabold ${
                    isLight ? 'text-[#0F172A]' : 'text-[#EDF4FF]'
                  }`}
                >
                  تمرین آفلاین
                </span>
              </div>
              <span
                className={`text-[11px] font-bold ${
                  isLight ? 'text-[#64748B]' : 'text-[#B3C4DC]'
                }`}
              >
                هوش مصنوعی
              </span>
            </button>
          </div>
        </main>

        {/* Redesigned Bottom 3-Tile Jewel Quick-Access Dock */}
        <footer className="relative z-10 px-4 sm:px-6 pb-6 pt-2">
          <div className="max-w-[404px] w-full mx-auto grid grid-cols-3 gap-2.5 sm:gap-3.5">
            {bottomTiles.map((tile) => {
              const Icon = tile.icon;
              return (
                <button
                  key={tile.id}
                  type="button"
                  data-testid={tile.testId}
                  onClick={tile.onClick}
                  className={`group relative overflow-hidden rounded-2xl border px-2.5 py-3.5 min-h-[92px] sm:min-h-[100px] flex flex-col items-center justify-center gap-2 backdrop-blur-md cursor-pointer transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.97] ${tile.cardCls}`}
                >
                  {/* Specular top edge highlight */}
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent"
                  />
                  <span
                    className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 group-hover:scale-108 transition-transform duration-200 ${tile.medallionCls}`}
                  >
                    <Icon className="w-5 h-5 stroke-[2.25]" />
                  </span>
                  <div className="text-center leading-tight">
                    <div
                      className={`text-xs sm:text-[13px] font-black whitespace-nowrap ${tile.titleCls}`}
                    >
                      {tile.label}
                    </div>
                    <div
                      className={`text-[10px] font-bold mt-0.5 whitespace-nowrap ${tile.subCls}`}
                    >
                      {tile.subtitle}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </footer>
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: FULL-SCREEN HOKM MODES SCREEN (No photo clutter, Left Back Arrow)
  // =========================================================================
  if (subView === 'modes') {
    return (
      <div
        data-testid="hokm-modes-screen"
        className={`relative min-h-[100dvh] w-full overflow-hidden flex flex-col ${
          isLight ? 'bg-[#F4F6FA] text-[#111827]' : 'bg-[#08101E] text-[#F5EFE4]'
        }`}
      >
        <HokmAnimatedBackdrop isLight={isLight} />

        {/* Header Bar — Back button on physical LEFT pointing LEFT */}
        <header
          className={`relative z-10 w-full max-w-4xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 pt-4 sm:pt-6 pb-3 border-b ${
            isLight ? 'border-[#E2E8F0]' : 'border-white/10'
          }`}
        >
          <div className="w-[84px] shrink-0" aria-hidden="true" />

          <div className="text-center min-w-0">
            <h2
              className={`text-base sm:text-lg font-black truncate ${
                isLight ? 'text-[#0F172A]' : 'text-[#FFF5DC]'
              }`}
            >
              انتخاب نوع بازی حکم
            </h2>
          </div>

          <button
            type="button"
            data-testid="hokm-modes-back-btn"
            onClick={() => setSubView('hub')}
            className={`min-h-[42px] px-3.5 rounded-xl border text-xs sm:text-sm font-extrabold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
              isLight
                ? 'bg-white/90 hover:bg-white border-[#CBD5E1] text-[#0F172A]'
                : 'bg-[#0B172B]/80 hover:bg-[#132645] border-[#F3D179]/35 text-[#F6F1E6]'
            }`}
          >
            <span>بازگشت</span>
            <ArrowLeft
              className={`w-4 h-4 shrink-0 ${
                isLight ? 'text-[#0D8A8A]' : 'text-[#F3D179]'
              }`}
            />
          </button>
        </header>

        {/* Launch Target Compact Selector */}
        <div className="relative z-10 px-4 sm:px-6 pt-5">
          <div
            role="radiogroup"
            aria-label="نحوه ورود به میز"
            className={`max-w-md mx-auto grid grid-cols-3 gap-1 p-1 rounded-xl border backdrop-blur-md ${
              isLight
                ? 'bg-white/90 border-[#CBD5E1]'
                : 'bg-[#071122]/85 border-white/15'
            }`}
          >
            {(
              [
                { id: 'random', label: 'آنلاین رندوم', icon: Shuffle },
                { id: 'friends_create', label: 'میز دوستانه', icon: Users },
                { id: 'offline', label: 'آفلاین', icon: Bot },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              const active = launchTarget === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`hokm-launch-target-${opt.id}`}
                  onClick={() => setLaunchTarget(opt.id)}
                  className={`min-h-[40px] px-2 rounded-lg text-[11px] sm:text-xs font-extrabold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-all whitespace-nowrap ${
                    active
                      ? 'bg-gradient-to-b from-[#F5D98E] to-[#C89634] text-[#0B1528] shadow-xs'
                      : isLight
                        ? 'text-[#475569] hover:text-[#0F172A]'
                        : 'text-[#B8C7DE] hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
          {!isOnline && launchTarget !== 'offline' && (
            <p className="max-w-md mx-auto mt-2 text-center text-[11px] font-bold text-amber-500">
              اینترنت قطع است — بازی آنلاین در حال حاضر در دسترس نیست؛ برای بازی بدون اینترنت گزینه «آفلاین» را انتخاب کنید.
            </p>
          )}
        </div>

        {/* Stacked Vibrant Tiered Mode Banner Cards */}
        <main className="relative z-10 flex-1 px-4 sm:px-6 py-6 flex flex-col justify-center gap-4 max-w-xl w-full mx-auto">
          {MODE_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.id}
                type="button"
                data-testid={card.testId}
                data-variant={card.id}
                onClick={() =>
                  onLaunchHokm({
                    mode: launchTarget,
                    targetMatchScore: card.targetScore,
                  })
                }
                className={`group relative w-full rounded-[22px] overflow-hidden border-2 ${card.borderAccent} bg-gradient-to-l ${card.cardGradient} hover:brightness-110 active:scale-[0.985] shadow-[0_14px_30px_rgba(0,0,0,0.24)] flex items-stretch text-right cursor-pointer transition-all`}
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_82%_20%,rgba(255,255,255,0.16),transparent_55%)]"
                />

                <div className="relative flex-1 p-3.5 sm:p-5 flex items-center gap-3 sm:gap-3.5 min-w-0">
                  <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-black/28 border border-white/25 flex items-center justify-center shrink-0 shadow-inner group-hover:scale-105 transition-transform">
                    <Icon className="w-5 h-5 sm:w-7 sm:h-7 text-[#FFF3C9]" />
                  </div>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base sm:text-xl font-black text-white leading-tight whitespace-nowrap">
                        {card.title}
                      </span>
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-black/35 border border-white/20 text-[#FFE8A3] whitespace-nowrap">
                        {card.tierLabel}
                      </span>
                    </div>
                    <p className="text-[11px] sm:text-xs text-white/85 font-medium leading-relaxed line-clamp-2">
                      {card.subtitle}
                    </p>
                    <div className="flex items-center gap-2.5 sm:gap-3 pt-0.5 text-[11px] font-bold text-[#F8E7B8] flex-wrap">
                      <span className="inline-flex items-center gap-1 whitespace-nowrap">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        <span>{card.durationLabel}</span>
                      </span>
                      <span className="inline-flex items-center gap-1 text-white/85 whitespace-nowrap">
                        <Play className="w-3 h-3 fill-current shrink-0" />
                        <span>ورود فوری</span>
                      </span>
                    </div>
                  </div>
                </div>

                <div
                  className={`relative w-[74px] sm:w-[96px] shrink-0 bg-gradient-to-b ${card.ribbonBg} text-[#0B1628] flex flex-col items-center justify-center px-2 border-r border-white/35 shadow-[inset_0_2px_0_rgba(255,255,255,0.55)]`}
                >
                  <span className="text-2xl sm:text-3xl font-black leading-none tabular-nums">
                    {toPersianDigits(card.targetScore)}
                  </span>
                  <span className="text-xs font-black mt-1 tracking-tight">
                    دست
                  </span>
                </div>
              </button>
            );
          })}
        </main>
      </div>
    );
  }

  // =========================================================================
  // VIEW 3: FULL-SCREEN SECONDARY SUB-VIEWS (Rules / Leaderboard / Hokm Shop)
  // =========================================================================
  return (
    <div
      data-testid="game-detail-page"
      className="min-h-[100dvh] w-full bg-[var(--eyvan-bg)] text-[var(--eyvan-text)] px-3.5 sm:px-6 py-4 sm:py-6"
    >
      <div className="space-y-4 sm:space-y-5 max-w-4xl mx-auto">
        {/* Clean Return-to-Hub Bar — Start CTA on RIGHT, Back Arrow on physical LEFT */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setSubView('modes')}
            className="min-h-[40px] px-4 rounded-xl bg-gradient-to-b from-[#F5D98E] to-[#C89634] text-[#0B1528] text-xs font-black inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>شروع بازی</span>
          </button>

          <button
            type="button"
            onClick={() => setSubView('hub')}
            data-testid="game-hub-subview-back-btn"
            className="min-h-[42px] px-3.5 rounded-xl theme-btn-secondary border text-xs sm:text-sm font-extrabold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
          >
            <span>بازگشت به تالار حکم</span>
            <ArrowLeft className="w-4 h-4 shrink-0" />
          </button>
        </div>

        {/* Quick Sub-view Switcher */}
        <nav
          aria-label="بخش‌های اطلاعات حکم"
          role="tablist"
          className="grid grid-cols-3 gap-1 p-1 rounded-2xl theme-tab-track"
        >
          {(
            [
              { id: 'rules', label: 'آموزش سریع', icon: BookOpen },
              { id: 'leaderboard', label: 'برترین‌ها', icon: Trophy },
              { id: 'shop', label: 'فروشگاه حکم', icon: ShoppingBag },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = subView === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`game-hub-subtab-${tab.id}`}
                onClick={() => setSubView(tab.id)}
                className={`min-h-[42px] px-2.5 rounded-xl text-xs font-extrabold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-all ${
                  active
                    ? 'bg-[var(--eyvan-card-bg)] theme-heading shadow-sm border border-[var(--eyvan-gold)]/40'
                    : 'theme-muted hover:text-[var(--eyvan-text)]'
                }`}
              >
                <Icon
                  className={`w-3.5 h-3.5 shrink-0 ${
                    active ? 'theme-accent-gold' : ''
                  }`}
                />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {subView === 'rules' && <HokmRulesTab />}

        {subView === 'leaderboard' && (
          <HokmLeaderboardTab
            currentUserId={currentUserId}
            onJumpToPlay={() => setSubView('modes')}
          />
        )}

        {subView === 'shop' && (
          <HokmShopTab
            userCoins={userCoins}
            userGems={userGems}
            isAuthenticated={isAuthenticated}
            ownedItemIds={ownedItemIds}
            equippedTableSkinId={equippedTableSkinId}
            equippedBannerCode={equippedBannerCode}
            equippedDeckId={equippedDeckId}
            onPurchaseItem={onPurchaseItem}
            onEquipItem={onEquipItem}
            onSelectDeck={onSelectDeck}
            onRequireAuth={onRequireAuth}
            onOpenFullShop={onOpenFullShop}
          />
        )}
      </div>
    </div>
  );
};
