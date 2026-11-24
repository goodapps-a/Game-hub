export interface TomanPackageDefinition {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly coinsAmount: number;
  readonly gemsAmount: number;
  readonly priceToman: number;
  readonly currencyKind: 'coins' | 'gems' | 'bundle';
  readonly badge?: string;
}

export const TOMAN_TOPUP_PACKAGES: readonly TomanPackageDefinition[] = [
  {
    id: 'tm-coins-starter',
    title: 'بسته ۱٬۵۰۰ سکه',
    subtitle: 'شارژ فوری حساب سکه',
    coinsAmount: 1500,
    gemsAmount: 0,
    priceToman: 29000,
    currencyKind: 'coins',
  },
  {
    id: 'tm-coins-classic',
    title: 'بسته ۵٬۰۰۰ سکه',
    subtitle: 'مناسب خرید پشت‌کارت و افکت',
    coinsAmount: 5000,
    gemsAmount: 0,
    priceToman: 79000,
    currencyKind: 'coins',
    badge: 'پرفروش',
  },
  {
    id: 'tm-coins-royal',
    title: 'بسته ۱۵٬۰۰۰ سکه',
    subtitle: '۲۰٪ سکه هدیه بیشتر',
    coinsAmount: 15000,
    gemsAmount: 0,
    priceToman: 199000,
    currencyKind: 'coins',
    badge: 'به‌صرفه',
  },
  {
    id: 'tm-gems-starter',
    title: 'بسته ۸۰ الماس',
    subtitle: 'شارژ فوری الماس',
    coinsAmount: 0,
    gemsAmount: 80,
    priceToman: 45000,
    currencyKind: 'gems',
  },
  {
    id: 'tm-gems-palace',
    title: 'بسته ۲۵۰ الماس',
    subtitle: 'مناسب آیتم‌های افسانه‌ای',
    coinsAmount: 0,
    gemsAmount: 250,
    priceToman: 119000,
    currencyKind: 'gems',
    badge: 'محبوب',
  },
  {
    id: 'tm-gems-crown',
    title: 'بسته ۷۰۰ الماس',
    subtitle: 'بیشترین ارزش خرید الماس',
    coinsAmount: 0,
    gemsAmount: 700,
    priceToman: 279000,
    currencyKind: 'gems',
    badge: 'ویژه',
  },
  {
    id: 'tm-bundle-eyvan',
    title: 'پکیج ترکیبی ایوان',
    subtitle: '۱۰٬۰۰۰ سکه + ۲۰۰ الماس',
    coinsAmount: 10000,
    gemsAmount: 200,
    priceToman: 169000,
    currencyKind: 'bundle',
    badge: 'ترکیبی',
  },
];

const PACKAGE_BY_ID = new Map<string, TomanPackageDefinition>(
  TOMAN_TOPUP_PACKAGES.map((pkg) => [pkg.id, pkg])
);

export function resolveTomanPackage(packageId: string): TomanPackageDefinition | undefined {
  return PACKAGE_BY_ID.get(packageId);
}
