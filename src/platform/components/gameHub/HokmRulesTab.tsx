import React from 'react';
import {
  CheckCircle2,
  Crown,
  Layers,
  Lightbulb,
  RefreshCw,
  Shield,
  Sparkles,
} from 'lucide-react';
import { toPersianDigits } from '../../theme/tokens';

const SUIT_VISUALS = [
  { symbol: '♠', name: 'پیک', colorClass: 'theme-heading' },
  { symbol: '♥', name: 'دل', colorClass: 'text-[#DC2626] dark:text-[#F87171]' },
  { symbol: '♣', name: 'گشنیز', colorClass: 'theme-heading' },
  { symbol: '♦', name: 'خشت', colorClass: 'text-[#DC2626] dark:text-[#F87171]' },
] as const;

const RANK_ORDER = [
  { label: 'A', fa: 'آس' },
  { label: 'K', fa: 'شاه' },
  { label: 'Q', fa: 'بی‌بی' },
  { label: 'J', fa: 'سرباز' },
  { label: '۱۰', fa: 'ده' },
  { label: '۹', fa: 'نه' },
  { label: '۸', fa: 'هشت' },
  { label: '۷', fa: 'هفت' },
  { label: '۶', fa: 'شش' },
  { label: '۵', fa: 'پنج' },
  { label: '۴', fa: 'چهار' },
  { label: '۳', fa: 'سه' },
  { label: '۲', fa: 'دو' },
] as const;

const FLOW_STEPS = [
  {
    step: '۱',
    title: 'پخش ۵ کارت و تعیین حکم',
    detail:
      'ابتدا به هر بازیکن ۵ کارت داده می‌شود. حاکم با دیدن ۵ کارت خود، یکی از چهار خال را به‌عنوان «حکم» انتخاب می‌کند.',
    icon: Crown,
  },
  {
    step: '۲',
    title: 'تکمیل ۱۳ کارت هر بازیکن',
    detail:
      'پس از اعلام حکم، ۸ کارت باقی‌مانده در دو نوبت ۴تایی پخش می‌شود تا هر چهار بازیکن دقیقاً ۱۳ کارت در دست داشته باشند.',
    icon: Layers,
  },
  {
    step: '۳',
    title: 'شروع دست و قانون خالِ سر',
    detail:
      'حاکم اولین کارت را می‌کشد و روی میز می‌اندازد. سایر بازیکنان موظف‌اند همان خال را بازی کنند؛ برنده هر دست، دست بعدی را شروع می‌کند.',
    icon: Shield,
  },
  {
    step: '۴',
    title: 'کسب ۷ دست برای برد راند',
    detail:
      'هر تیمی که زودتر ۷ دست از ۱۳ دست را ببرد، برنده آن راند می‌شود و امتیاز راند را در تابلوی بازی ثبت می‌کند.',
    icon: CheckCircle2,
  },
] as const;

const SCORE_CARDS = [
  {
    points: '+۱',
    title: 'برد عادی',
    condition: 'تیمی که زودتر ۷ دست را ببرد (و حریف حداقل ۱ دست گرفته باشد)',
    accentClass: 'theme-accent-teal',
  },
  {
    points: '+۲',
    title: 'کُت (۷ بر صفر)',
    condition: 'تیم حاکم هر ۷ دست پیاپی را بدون واگذاری حتی یک دست ببرد',
    accentClass: 'theme-accent-gold',
  },
  {
    points: '+۳',
    title: 'حاکم‌کُت',
    condition: 'تیم غیرحاکم بتواند تیمِ حاکم را با نتیجه ۷ بر صفر شکست دهد',
    accentClass: 'text-[#DC2626] dark:text-[#FB923C]',
  },
] as const;

const PRO_TIPS = [
  {
    title: 'دست یار را نبرید',
    detail:
      'اگر یار روبه‌رویتان با کارت بزرگ (مثل آس یا شاه) دست را گرفته، کارت کوچک رد کنید و حکم خود را حفظ نمایید.',
  },
  {
    title: 'خالی کردن یک خال',
    detail:
      'اگر در یک خال فقط یک کارت کوچک دارید، زودتر آن را رد کنید تا در دورهای بعدی بتوانید آن خال را با حکم بِبُرید.',
  },
  {
    title: 'شمارش کارت‌های حکم',
    detail:
      'در هر دست ۱۳ کارت حکم وجود دارد؛ با شمردن حکم‌های بازی‌شده می‌دانید چه زمانی کارت‌های آس و شاه غیرحکم امن هستند.',
  },
] as const;

export const HokmRulesTab: React.FC = () => {
  return (
    <div
      data-testid="hokm-rules-tab"
      className="space-y-4 sm:space-y-5"
    >
      {/* Hero Summary Strip */}
      <section className="eyvan-card rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-black theme-accent-teal">
            <Sparkles className="w-3.5 h-3.5" />
            <span>راهنمای جامع و سریع حکم</span>
          </div>
          <h2 className="text-base sm:text-lg font-black theme-heading">
            حکم در ۲ دقیقه — از صفر تا تسلط کامل
          </h2>
          <p className="text-xs sm:text-sm theme-muted leading-relaxed">
            حکم یک بازی تیمی ۴ نفره با ۵۲ کارت استاندارد است. برای بازی کردن، کافی است در نوبت خود کارت مجاز را به سمت مرکز میز بکشید و رها کنید.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="px-3 py-2 rounded-xl theme-subcard border text-center min-w-[74px]">
            <div className="text-base font-black theme-accent-gold tabular-nums">
              {toPersianDigits(4)}
            </div>
            <div className="text-[10px] font-bold theme-muted">بازیکن</div>
          </div>
          <div className="px-3 py-2 rounded-xl theme-subcard border text-center min-w-[74px]">
            <div className="text-base font-black theme-accent-teal tabular-nums">
              {toPersianDigits(13)}
            </div>
            <div className="text-[10px] font-bold theme-muted">کارت</div>
          </div>
          <div className="px-3 py-2 rounded-xl theme-subcard border text-center min-w-[74px]">
            <div className="text-base font-black theme-heading tabular-nums">
              {toPersianDigits(7)}
            </div>
            <div className="text-[10px] font-bold theme-muted">دست برد</div>
          </div>
        </div>
      </section>

      {/* Row 1: Visual 2x2 Table Diagram + Suits & Card Hierarchy */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* 2v2 Partnership Visual */}
        <section className="md:col-span-5 eyvan-card rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm sm:text-base font-extrabold theme-heading">
              ۱. ترکیب تیمی ۲ در برابر ۲
            </h2>
            <p className="text-xs theme-muted leading-relaxed">
              بازیکنان روبه‌روی هم هم‌تیمی هستند و امتیاز تمام دست‌های برده در یک صندوق مشترک ثبت می‌شود.
            </p>
          </div>

          <div
            className="relative mx-auto w-full max-w-[268px] aspect-[4/3] rounded-2xl theme-subcard border flex items-center justify-center p-3"
            aria-label="نمودار نشستن دو تیم در میز حکم"
          >
            {/* Team Axis Lines */}
            <div
              className="absolute inset-y-6 left-1/2 -translate-x-1/2 w-[2px] bg-[#0D8A8A]/50"
              aria-hidden="true"
            />
            <div
              className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-[2px] bg-[#D97706]/45"
              aria-hidden="true"
            />

            {/* Center Table Diamond */}
            <div className="relative z-10 w-14 h-14 rounded-2xl bg-[var(--eyvan-card-bg)] border-2 border-[var(--eyvan-gold)]/60 flex flex-col items-center justify-center shadow-sm">
              <span className="text-sm font-black theme-accent-gold tabular-nums leading-none">
                {toPersianDigits(7)}
              </span>
              <span className="text-[9px] font-bold theme-muted mt-0.5">
                دست برد
              </span>
            </div>

            {/* Top: Partner */}
            <div className="absolute top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-lg bg-[#0D8A8A]/15 border border-[#0D8A8A]/45 text-[11px] font-extrabold theme-accent-teal whitespace-nowrap">
              یار شما
            </div>
            {/* Bottom: You */}
            <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-lg bg-[#0D8A8A] text-white text-[11px] font-extrabold whitespace-nowrap shadow-xs">
              شما
            </div>
            {/* Right: Opponent */}
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 px-2 py-1 rounded-lg bg-[var(--eyvan-surface-muted)] border border-[var(--eyvan-line)] text-[11px] font-bold theme-muted whitespace-nowrap">
              حریف ۱
            </div>
            {/* Left: Opponent */}
            <div className="absolute left-2.5 top-1/2 -translate-y-1/2 px-2 py-1 rounded-lg bg-[var(--eyvan-surface-muted)] border border-[var(--eyvan-line)] text-[11px] font-bold theme-muted whitespace-nowrap">
              حریف ۲
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] font-bold pt-2 border-t border-[var(--eyvan-line)]">
            <span className="theme-accent-teal">تیم شما: بالا و پایین</span>
            <span className="theme-muted">تیم حریف: چپ و راست</span>
          </div>
        </section>

        {/* Suits & Rank Strip */}
        <section className="md:col-span-7 eyvan-card rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div className="space-y-1">
              <h2 className="text-sm sm:text-base font-extrabold theme-heading">
                ۲. خال‌ها و ترتیب قدرت کارت‌ها
              </h2>
              <p className="text-xs theme-muted leading-relaxed">
                آس (A) قوی‌ترین و دو (۲) ضعیف‌ترین کارت هر خال است. کارت‌های خال «حکم» حتی اگر ۲ باشند، از آس سایر خال‌ها قوی‌ترند.
              </p>
            </div>

            {/* 4 Suits */}
            <div className="grid grid-cols-4 gap-2">
              {SUIT_VISUALS.map((suit) => (
                <div
                  key={suit.name}
                  className="rounded-xl theme-subcard border py-2.5 px-2 flex flex-col items-center justify-center gap-0.5"
                >
                  <span
                    className={`text-2xl leading-none ${suit.colorClass}`}
                    aria-hidden="true"
                  >
                    {suit.symbol}
                  </span>
                  <span className="text-[11px] font-extrabold theme-heading mt-1">
                    {suit.name}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Rank Hierarchy Strip */}
          <div className="space-y-2 pt-3 border-t border-[var(--eyvan-line)]">
            <div className="flex items-center justify-between text-[11px] font-bold theme-muted">
              <span className="theme-accent-gold">قوی‌ترین (آس)</span>
              <span>ضعیف‌ترین (دو)</span>
            </div>
            <div
              className="grid grid-cols-13 gap-1"
              aria-label="ترتیب کارت‌ها از آس تا دو"
            >
              {RANK_ORDER.map((rank, index) => (
                <div
                  key={rank.label}
                  title={rank.fa}
                  className={`h-10 rounded-lg border flex flex-col items-center justify-center leading-none tabular-nums ${
                    index === 0
                      ? 'bg-[var(--eyvan-gold)]/20 border-[var(--eyvan-gold)]/65 theme-accent-gold'
                      : index < 4
                        ? 'theme-subcard border-[var(--eyvan-line)] theme-heading'
                        : 'bg-[var(--eyvan-surface-muted)]/60 border-[var(--eyvan-line)] theme-muted'
                  }`}
                >
                  <span className="text-[11px] sm:text-xs font-black">
                    {rank.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Row 2: Concrete Visual Example of Follow-Suit & Trump-Cut */}
      <section className="eyvan-card rounded-2xl p-4 sm:p-5 space-y-3.5">
        <div className="space-y-1">
          <h2 className="text-sm sm:text-base font-extrabold theme-heading">
            ۳. قانون طلایی «خالِ سر» و «بُریدن با حکم» (مثال تصویری)
          </h2>
          <p className="text-xs theme-muted leading-relaxed">
            فرض کنید <strong className="theme-heading">پیک (♠) حکم</strong> است و نفر اول <strong className="text-[#DC2626] dark:text-[#F87171]">شاه خشت (K♦)</strong> را روی میز می‌اندازد:
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Case A: Have Lead Suit */}
          <div className="rounded-xl theme-subcard border p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-black theme-accent-teal">
                حالت اول: خشت دارید
              </span>
              <span
                dir="ltr"
                className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[#C8102E] text-xs font-black shadow-2xs"
              >
                7♦ / A♦
              </span>
            </div>
            <p className="text-xs theme-muted leading-relaxed">
              <strong className="theme-heading">اجباری است</strong> یکی از کارت‌های خشت خود را بازی کنید. در نوبت شما، فقط کارت‌های مجاز روشن و قابل کشیدن هستند.
            </p>
          </div>

          {/* Case B: Out of Lead Suit -> Cut with Trump */}
          <div className="rounded-xl theme-subcard border p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-black theme-accent-gold">
                حالت دوم: خشت ندارید (بُرش)
              </span>
              <span
                dir="ltr"
                className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[#111317] text-xs font-black shadow-2xs"
              >
                4♠ (حکم)
              </span>
            </div>
            <p className="text-xs theme-muted leading-relaxed">
              می‌توانید با <strong className="theme-heading">پیک (حکم)</strong> دست را بِبُرید! حتی ۴ پیک، شاه خشت را شکست می‌دهد (مگر آنکه نفر بعدی حکم بزرگ‌تری بیندازد).
            </p>
          </div>

          {/* Case C: Out of Lead Suit -> Discard */}
          <div className="rounded-xl theme-subcard border p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-black theme-heading">
                حالت سوم: رد کردن کارت
              </span>
              <span
                dir="ltr"
                className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[#111317] text-xs font-black shadow-2xs"
              >
                3♣
              </span>
            </div>
            <p className="text-xs theme-muted leading-relaxed">
              اگر خشت ندارید و نمی‌خواهید بُرش بزنید (مثلاً یارتان دست را برده)، یک کارت کم‌ارزش از خال دیگر رد کنید.
            </p>
          </div>
        </div>
      </section>

      {/* Row 3: 4-Step Visual Game Flow */}
      <section className="eyvan-card rounded-2xl p-4 sm:p-5 space-y-3.5">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 theme-accent-gold shrink-0" />
          <h2 className="text-sm sm:text-base font-extrabold theme-heading">
            ۴. روند کامل هر راند در ۴ گام
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FLOW_STEPS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.step}
                className="rounded-xl theme-subcard border p-3.5 flex items-start gap-3"
              >
                <div className="w-9 h-9 rounded-xl bg-[var(--eyvan-surface-muted)] border border-[var(--eyvan-line)] flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 theme-accent-teal" />
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-black theme-accent-gold tabular-nums">
                      {item.step}.
                    </span>
                    <h3 className="text-xs sm:text-sm font-extrabold theme-heading">
                      {item.title}
                    </h3>
                  </div>
                  <p className="text-xs theme-muted leading-relaxed">
                    {item.detail}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Row 4: Scoring + Hakem Rotation Rule */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        <section className="md:col-span-8 eyvan-card rounded-2xl p-4 sm:p-5 space-y-3">
          <h2 className="text-sm sm:text-base font-extrabold theme-heading">
            ۵. امتیازدهی، کُت و حاکم‌کُت
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
            {SCORE_CARDS.map((card) => (
              <div
                key={card.title}
                className="rounded-xl theme-subcard border p-3.5 text-center space-y-1.5"
              >
                <div
                  className={`text-2xl font-black tabular-nums ${card.accentClass}`}
                >
                  {card.points}
                </div>
                <div className="text-xs sm:text-sm font-extrabold theme-heading">
                  {card.title}
                </div>
                <p className="text-[11px] theme-muted leading-relaxed">
                  {card.condition}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="md:col-span-4 eyvan-card rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-3">
          <div className="space-y-2">
            <div className="w-9 h-9 rounded-xl bg-[var(--eyvan-gold)]/15 border border-[var(--eyvan-gold)]/40 flex items-center justify-center">
              <RefreshCw className="w-4 h-4 theme-accent-gold" />
            </div>
            <h2 className="text-sm sm:text-base font-extrabold theme-heading">
              قانون جابه‌جایی حاکم
            </h2>
            <p className="text-xs theme-muted leading-relaxed">
              اگر تیمِ حاکم آن دست را ببرد، <strong className="theme-heading">حاکمیت ثابت می‌ماند</strong>؛ اما اگر تیم حاکم ببازد، حاکمیت پادساعتگرد به <strong className="theme-heading">نفر بعدی</strong> منتقل می‌شود.
            </p>
          </div>
          <div className="text-[11px] font-bold theme-accent-teal pt-2 border-t border-[var(--eyvan-line)]">
            تاج طلایی بالای آواتار، حاکم فعلی را نشان می‌دهد.
          </div>
        </section>
      </div>

      {/* Row 5: 3 Concise Pro Strategy Tips */}
      <section className="eyvan-card rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 theme-accent-gold shrink-0" />
          <h2 className="text-sm sm:text-base font-extrabold theme-heading">
            ۳ نکته حرفه‌ای برای برد بیشتر
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {PRO_TIPS.map((tip) => (
            <div
              key={tip.title}
              className="rounded-xl theme-subcard border p-3.5 space-y-1.5"
            >
              <h3 className="text-xs sm:text-sm font-extrabold theme-heading">
                {tip.title}
              </h3>
              <p className="text-[11px] sm:text-xs theme-muted leading-relaxed">
                {tip.detail}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
