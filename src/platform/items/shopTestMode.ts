/**
 * Central Shop Test Mode configuration shared by client UI & authoritative server endpoints.
 *
 * When enabled:
 * - True catalog prices remain visible in metadata (e.g. crossed out in the UI).
 * - Effective claim/purchase price is 0 (coins & gems), while ownership & chest currency
 *   grants still go through real server-authoritative inventory/wallet records.
 * - Toggling this flag cleanly switches between Free Test Claim Mode and Real Economy Pricing.
 */

export interface ShopTestModeConfig {
  readonly enabled: boolean;
  readonly label: string;
  readonly description: string;
}

export const SHOP_TEST_MODE_DEFAULT = true;

export function resolveShopTestModeEnabled(
  override?: boolean | string | null
): boolean {
  if (typeof override === 'boolean') return override;
  if (typeof override === 'string') {
    const normalized = override.trim().toLowerCase();
    if (normalized === 'false' || normalized === '0' || normalized === 'off') {
      return false;
    }
    if (normalized === 'true' || normalized === '1' || normalized === 'on') {
      return true;
    }
  }
  return SHOP_TEST_MODE_DEFAULT;
}

export function getShopTestModeConfig(override?: boolean | string | null): ShopTestModeConfig {
  const enabled = resolveShopTestModeEnabled(override);
  return {
    enabled,
    label: enabled ? 'حالت آزمایشی فروشگاه فعال است' : 'پرداخت واقعی سکه و الماس',
    description: enabled
      ? 'در این نسخه، دریافت تمام آیتم‌ها و صندوق‌ها رایگان است اما مالکیت و انتخاب آن‌ها به‌صورت واقعی در سرور ذخیره می‌شود.'
      : 'در این حالت، مبلغ سکه یا الماس هر آیتم از موجودی حساب شما کسر می‌شود.',
  };
}

export function getEffectiveItemPrice(
  catalogPrice: number,
  testModeEnabled: boolean = SHOP_TEST_MODE_DEFAULT
): number {
  const safePrice = Number.isFinite(catalogPrice) && catalogPrice > 0 ? Math.floor(catalogPrice) : 0;
  return testModeEnabled ? 0 : safePrice;
}
