# سیستم پوسته‌های کارت حکم (Card Skins)

پوسته = یک بسته‌ی **ظاهری** (روی کارت، پشت کارت، رنگ‌بندی). هیچ پوسته‌ای به قوانین، نوبت، توزیع،
امتیازدهی یا انیمیشن‌ها دست نمی‌زند: `PlayingCard` تصمیم می‌گیرد *چه چیزی* کشیده شود و پوسته‌ی فعال تصمیم
می‌گیرد *چطور* دیده شود.

## ساختار

```
src/games/hokm/skins/
  types.ts            قرارداد CardSkin
  registry.ts         ← تنها جایی که فهرست پوسته‌ها نگه‌داری می‌شود
  CardSkinContext.tsx Provider + useCardSkin() (انتخاب‌شده، مالکیت، equip، grantSkin)
  config.ts           CARD_SKIN_PREVIEW_MODE و کلیدهای localStorage
  storage.ts          خواندن/نوشتن امن localStorage
  courtLayout.tsx     ابزار مشترک هندسه (CourtBox, DoubleHeaded, AceBox, DecorLayer)
  suitGlyphs.tsx      شکل خال‌ها (SuitIconSvg, SuitMark)
  svgUtils.ts         useSvgUid، starPoints، polar
  lapisShamsa.tsx     پوسته‌ی پیش‌فرض (طرح فعلی بازی، بدون تغییر ظاهری)
  royalGold.tsx · persianHeritage.tsx · modernMinimal.tsx · darkLuxury.tsx · classicVintage.tsx
  CardSkinPicker.tsx  انتخابگر (در تنظیمات برنامه)
  CardSkinPreview.tsx پیش‌نمایش زنده (پشت + شاه دل + آس پیک) با خود PlayingCard
  shopAdapter.ts      تبدیل CardSkin به ShopItem (هنوز به فروشگاه وصل نشده)
```

## هر پوسته چه دارد

`id` یکتا · `name` / `englishName` · `description` · `price` / `currency` / `rarity` · `palette` ·
`face` (کاغذ، حاشیه، جوهر قرمز/مشکی، فونت اندیس، دورخط خال‌ها) · `backFrame` ·
`Back` (پشت کارت) · `Decor` (تزئین اختیاری زیر اندیس‌ها و خال‌ها) · `Ace` (آس هر چهار خال) ·
`Court` (سرباز/بی‌بی/شاه هر چهار خال) · `preloadAssets` (اختیاری).
کارت‌های عددی از شبکه‌ی خال‌های مشترک استفاده می‌کنند و ظاهرشان را از `face` + `Decor` می‌گیرند.

## پوسته‌ها

| id | نام | قیمت (نمونه) |
|---|---|---|
| `lapis-shamsa` | شمسه لاجوردی (پیش‌فرض) | رایگان |
| `royal-gold` | طلای سلطنتی | ۱٬۶۵۰ سکه |
| `persian-heritage` | میراث ایرانی | ۲٬۴۰۰ سکه |
| `modern-minimal` | مینیمال مدرن | ۸۵۰ سکه |
| `dark-luxury` | لوکس تاریک | ۱۲۰ الماس |
| `classic-vintage` | کلاسیک قدیمی | ۱٬۲۰۰ سکه |

قیمت‌ها فقط مقدار نمونه‌اند و به اقتصاد بازی وصل نیستند.

## ساخت پوسته‌ی جدید

1. فایل `skins/<name>.tsx` بسازید و یک `CardSkin` صادر کنید (از `lapisShamsa.tsx` یا یکی از پنج پوسته الگو بگیرید).
   - `Court` فقط **یک نیمه‌ی شکل** را در جعبه‌ی ۶۰×۶۰ می‌کشد و `DoubleHeaded` آن را ۱۸۰° برمی‌گرداند.
   - ناحیه‌ی امن طراحی: `x ∈ [4, 56]`. برای gradient/pattern از `useSvgUid` استفاده کنید.
2. در `registry.ts` import کنید و به انتهای `CARD_SKINS` اضافه کنید.

همین. نیازی به تغییر منطق بازی، `PlayingCard`، `HokmTable` یا فروشگاه نیست.

## اتصال به بازی

* `PlayingCard` پوسته را از `useCardSkin()` می‌گیرد یا با prop اختیاری `skinId` (برای پیش‌نمایش).
* `CardBackSvg` (همه‌ی پشت‌کارت‌ها: دست حریف/یار، دسته‌ی ورق، کارت‌های در حال پخش، دسته‌های برده‌شده) پشت پوسته‌ی فعال را می‌کشد.
* قاب سفید دور پشت‌کارت‌ها در `HokmTable` با کلاس `.card-back-frame` و متغیرهای CSS
  (`--card-back-frame-bg/-border`) هم‌رنگ پوسته می‌شود — فقط کلاس‌های ظاهری عوض شده‌اند، نه منطق یا انیمیشن.
* `main.tsx` برنامه را با `CardSkinProvider` می‌پوشاند؛ انتخاب کاربر در `localStorage` ذخیره می‌شود.
* انتخابگر در «تنظیمات برنامه ← طرح کارت‌های حکم» است.

## آمادگی فروشگاه

* **آماده:** `CARD_SKIN_SHOP_ITEMS` / `cardSkinToShopItem()` داده‌ی پوسته‌ها را به شکل `ShopItem` می‌دهد،
  `grantSkin(id)` نقطه‌ی ورود پس از خرید است، `equip(id)` فقط پوسته‌ی مالکیت‌شده را فعال می‌کند.
* **وصل نشده:** نه به کاتالوگ فروشگاه، نه به کیف پول/پرداخت، نه به مالکیت سمت سرور.
* `CARD_SKIN_PREVIEW_MODE = true` یعنی فعلاً همه‌ی پوسته‌ها برای آزمایش قابل انتخاب‌اند.
  هنگام اتصال به خرید واقعی آن را `false` کنید.
