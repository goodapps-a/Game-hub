import {
  TOMAN_TOPUP_PACKAGES,
  type TomanPackageDefinition,
  resolveTomanPackage,
} from '../../../../src/platform/items/tomanPackages';
import type { ServerInventoryState } from '../../../../src/platform/items/itemTypes';
import {
  ensureUserInventoryInitialized,
  readUserInventoryState,
} from '../items/inventoryService';
import type { D1DatabaseLike } from '../types';

export type TomanPaymentErrorCode =
  | 'UNAUTHORIZED'
  | 'INVALID_INPUT'
  | 'PACKAGE_NOT_FOUND'
  | 'ORDER_NOT_FOUND'
  | 'PAYMENT_FAILED'
  | 'GATEWAY_ERROR'
  | 'DATABASE_ERROR';

export type TomanPaymentResult<T> =
  | ({ readonly ok: true; readonly status: number } & T)
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: TomanPaymentErrorCode;
      readonly message: string;
    };

export interface TomanOrderSummary {
  readonly orderId: string;
  readonly packageId: string;
  readonly amountToman: number;
  readonly coinsAmount: number;
  readonly gemsAmount: number;
  readonly gatewayProvider: 'zarinpal' | 'sandbox';
  readonly authority: string;
  readonly refId: string | null;
  readonly status: 'PENDING' | 'VERIFIED' | 'FAILED';
  readonly createdAt: number;
  readonly verifiedAt: number | null;
}

const ZARINPAL_REQUEST_URL = 'https://payment.zarinpal.com/pg/v4/payment/request.json';
const ZARINPAL_VERIFY_URL = 'https://payment.zarinpal.com/pg/v4/payment/verify.json';
const ZARINPAL_STARTPAY_BASE = 'https://payment.zarinpal.com/pg/StartPay/';

function generatePrefixedId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export function listTomanPackages(merchantId?: string): {
  readonly gatewayMode: 'zarinpal' | 'sandbox';
  readonly packages: readonly TomanPackageDefinition[];
} {
  const hasZarinpal = typeof merchantId === 'string' && merchantId.trim().length >= 8;
  return {
    gatewayMode: hasZarinpal ? 'zarinpal' : 'sandbox',
    packages: TOMAN_TOPUP_PACKAGES,
  };
}

export async function initiateTomanTopUpOrder(
  db: D1DatabaseLike,
  userId: string,
  input: {
    readonly packageId: unknown;
    readonly callbackUrl?: string;
    readonly zarinpalMerchantId?: string;
    readonly fetchImpl?: typeof fetch;
    readonly now?: number;
  }
): Promise<
  TomanPaymentResult<{
    readonly order: TomanOrderSummary;
    readonly package: TomanPackageDefinition;
    readonly checkoutUrl: string | null;
  }>
> {
  const now = input.now ?? Date.now();
  if (typeof input.packageId !== 'string' || !input.packageId.trim()) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'شناسه بسته شارژ معتبر نیست.',
    };
  }
  const pkg = resolveTomanPackage(input.packageId.trim());
  if (!pkg) {
    return {
      ok: false,
      status: 404,
      code: 'PACKAGE_NOT_FOUND',
      message: 'بسته شارژ انتخاب‌شده در فروشگاه یافت نشد.',
    };
  }

  const orderId = generatePrefixedId('ord');
  const merchantId =
    typeof input.zarinpalMerchantId === 'string' && input.zarinpalMerchantId.trim().length >= 8
      ? input.zarinpalMerchantId.trim()
      : null;

  let gatewayProvider: 'zarinpal' | 'sandbox' = 'sandbox';
  let authority = generatePrefixedId('sbx');
  let checkoutUrl: string | null = null;

  if (merchantId) {
    const fetchImpl = input.fetchImpl ?? fetch;
    const cbBase = input.callbackUrl?.trim() || 'https://eyvan.ir/shop';
    const separator = cbBase.includes('?') ? '&' : '?';
    const callbackUrl = `${cbBase}${separator}tomanOrder=${encodeURIComponent(orderId)}`;
    try {
      const gwRes = await fetchImpl(ZARINPAL_REQUEST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          merchant_id: merchantId,
          amount: pkg.priceToman,
          currency: 'IRT',
          description: `خرید ${pkg.title} در پلتفرم ایوان`,
          callback_url: callbackUrl,
        }),
      });
      const gwJson = (await gwRes.json()) as {
        data?: { code?: number; authority?: string };
      };
      if (!gwRes.ok || gwJson?.data?.code !== 100 || !gwJson.data.authority) {
        return {
          ok: false,
          status: 502,
          code: 'GATEWAY_ERROR',
          message: 'اتصال به درگاه پرداخت زرین‌پال برقرار نشد. لطفاً دوباره تلاش کنید.',
        };
      }
      gatewayProvider = 'zarinpal';
      authority = String(gwJson.data.authority);
      checkoutUrl = `${ZARINPAL_STARTPAY_BASE}${encodeURIComponent(authority)}`;
    } catch {
      return {
        ok: false,
        status: 502,
        code: 'GATEWAY_ERROR',
        message: 'خطا در ارتباط با درگاه پرداخت. لطفاً لحظاتی دیگر تلاش کنید.',
      };
    }
  }

  await ensureUserInventoryInitialized(db, userId, now);

  await db
    .prepare(
      `INSERT INTO toman_payment_orders (
         order_id, user_id, package_id, amount_toman,
         coins_amount, gems_amount, gateway_provider, authority,
         ref_id, status, created_at, verified_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'PENDING', ?, NULL)`
    )
    .bind(
      orderId,
      userId,
      pkg.id,
      pkg.priceToman,
      pkg.coinsAmount,
      pkg.gemsAmount,
      gatewayProvider,
      authority,
      now
    )
    .run();

  return {
    ok: true,
    status: 201,
    package: pkg,
    checkoutUrl,
    order: {
      orderId,
      packageId: pkg.id,
      amountToman: pkg.priceToman,
      coinsAmount: pkg.coinsAmount,
      gemsAmount: pkg.gemsAmount,
      gatewayProvider,
      authority,
      refId: null,
      status: 'PENDING',
      createdAt: now,
      verifiedAt: null,
    },
  };
}

export async function verifyTomanTopUpOrder(
  db: D1DatabaseLike,
  userId: string,
  input: {
    readonly orderId?: unknown;
    readonly authority?: unknown;
    readonly zarinpalMerchantId?: string;
    readonly shopTestMode?: boolean;
    readonly fetchImpl?: typeof fetch;
    readonly now?: number;
  }
): Promise<
  TomanPaymentResult<{
    readonly order: TomanOrderSummary;
    readonly deduplicated: boolean;
    readonly inventory: ServerInventoryState;
  }>
> {
  const now = input.now ?? Date.now();
  const orderId =
    typeof input.orderId === 'string' && /^[a-zA-Z0-9_-]{6,64}$/.test(input.orderId.trim())
      ? input.orderId.trim()
      : null;
  const authority =
    typeof input.authority === 'string' && /^[a-zA-Z0-9_-]{6,80}$/.test(input.authority.trim())
      ? input.authority.trim()
      : null;

  if (!orderId && !authority) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'شناسه سفارش یا کد رهگیری درگاه برای تأیید الزامی است.',
    };
  }

  const row = await db
    .prepare(
      orderId
        ? `SELECT order_id, user_id, package_id, amount_toman, coins_amount, gems_amount,
                  gateway_provider, authority, ref_id, status, created_at, verified_at
           FROM toman_payment_orders
           WHERE order_id = ? AND user_id = ?
           LIMIT 1`
        : `SELECT order_id, user_id, package_id, amount_toman, coins_amount, gems_amount,
                  gateway_provider, authority, ref_id, status, created_at, verified_at
           FROM toman_payment_orders
           WHERE authority = ? AND user_id = ?
           LIMIT 1`
    )
    .bind(orderId ?? authority!, userId)
    .first<{
      order_id: string;
      user_id: string;
      package_id: string;
      amount_toman: number;
      coins_amount: number;
      gems_amount: number;
      gateway_provider: 'zarinpal' | 'sandbox';
      authority: string;
      ref_id: string | null;
      status: 'PENDING' | 'VERIFIED' | 'FAILED';
      created_at: number;
      verified_at: number | null;
    }>();

  if (!row) {
    return {
      ok: false,
      status: 404,
      code: 'ORDER_NOT_FOUND',
      message: 'سفارش پرداخت یافت نشد یا متعلق به حساب شما نیست.',
    };
  }

  if (row.status === 'VERIFIED') {
    const inventory = await readUserInventoryState(db, userId, {
      shopTestMode: input.shopTestMode,
      now,
    });
    return {
      ok: true,
      status: 200,
      deduplicated: true,
      inventory,
      order: {
        orderId: row.order_id,
        packageId: row.package_id,
        amountToman: Number(row.amount_toman),
        coinsAmount: Number(row.coins_amount),
        gemsAmount: Number(row.gems_amount),
        gatewayProvider: row.gateway_provider,
        authority: row.authority,
        refId: row.ref_id,
        status: 'VERIFIED',
        createdAt: Number(row.created_at),
        verifiedAt: row.verified_at ? Number(row.verified_at) : null,
      },
    };
  }

  if (row.status === 'FAILED') {
    return {
      ok: false,
      status: 400,
      code: 'PAYMENT_FAILED',
      message: 'این سفارش پرداخت قبلاً ناموفق ثبت شده است.',
    };
  }

  if (authority && row.authority !== authority) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'کد پیگیری درگاه با سفارش مطابقت ندارد.',
    };
  }

  let verifiedRefId = `EYV-${String(Math.floor(10000000 + Math.random() * 89999999))}`;

  if (row.gateway_provider === 'zarinpal') {
    const merchantId = input.zarinpalMerchantId?.trim();
    if (!merchantId) {
      return {
        ok: false,
        status: 502,
        code: 'GATEWAY_ERROR',
        message: 'پیکربندی درگاه زرین‌پال در سرور کامل نیست.',
      };
    }
    const fetchImpl = input.fetchImpl ?? fetch;
    try {
      const verRes = await fetchImpl(ZARINPAL_VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          merchant_id: merchantId,
          amount: Number(row.amount_toman),
          authority: row.authority,
        }),
      });
      const verJson = (await verRes.json()) as {
        data?: { code?: number; ref_id?: number | string };
      };
      const code = verJson?.data?.code;
      if (!verRes.ok || (code !== 100 && code !== 101)) {
        await db
          .prepare(
            `UPDATE toman_payment_orders
             SET status = 'FAILED'
             WHERE order_id = ? AND user_id = ? AND status = 'PENDING'`
          )
          .bind(row.order_id, userId)
          .run();
        return {
          ok: false,
          status: 402,
          code: 'PAYMENT_FAILED',
          message: 'پرداخت توسط درگاه بانکی تأیید نشد.',
        };
      }
      if (verJson.data?.ref_id !== undefined && verJson.data?.ref_id !== null) {
        verifiedRefId = String(verJson.data.ref_id);
      }
    } catch {
      return {
        ok: false,
        status: 502,
        code: 'GATEWAY_ERROR',
        message: 'خطا در استعلام تایید پرداخت از درگاه بانکی.',
      };
    }
  }

  // Atomic state transition guard: strictly ONE concurrent verifier can move PENDING -> VERIFIED
  const transitionRes = await db
    .prepare(
      `UPDATE toman_payment_orders
       SET status = 'VERIFIED',
           ref_id = ?,
           verified_at = ?
       WHERE order_id = ?
         AND user_id = ?
         AND status = 'PENDING'`
    )
    .bind(verifiedRefId, now, row.order_id, userId)
    .run();

  if (Number(transitionRes.meta?.changes ?? 0) !== 1) {
    const fresh = await db
      .prepare(
        `SELECT order_id, package_id, amount_toman, coins_amount, gems_amount,
                gateway_provider, authority, ref_id, status, created_at, verified_at
         FROM toman_payment_orders
         WHERE order_id = ? AND user_id = ?
         LIMIT 1`
      )
      .bind(row.order_id, userId)
      .first<{
        order_id: string;
        package_id: string;
        amount_toman: number;
        coins_amount: number;
        gems_amount: number;
        gateway_provider: 'zarinpal' | 'sandbox';
        authority: string;
        ref_id: string | null;
        status: 'PENDING' | 'VERIFIED' | 'FAILED';
        created_at: number;
        verified_at: number | null;
      }>();

    if (fresh?.status === 'VERIFIED') {
      const inventory = await readUserInventoryState(db, userId, {
        shopTestMode: input.shopTestMode,
        now,
      });
      return {
        ok: true,
        status: 200,
        deduplicated: true,
        inventory,
        order: {
          orderId: fresh.order_id,
          packageId: fresh.package_id,
          amountToman: Number(fresh.amount_toman),
          coinsAmount: Number(fresh.coins_amount),
          gemsAmount: Number(fresh.gems_amount),
          gatewayProvider: fresh.gateway_provider,
          authority: fresh.authority,
          refId: fresh.ref_id,
          status: 'VERIFIED',
          createdAt: Number(fresh.created_at),
          verifiedAt: fresh.verified_at ? Number(fresh.verified_at) : null,
        },
      };
    }
    return {
      ok: false,
      status: 409,
      code: 'PAYMENT_FAILED',
      message: 'وضعیت این سفارش پرداخت تغییر کرده است.',
    };
  }

  await ensureUserInventoryInitialized(db, userId, now);
  await db
    .prepare(
      `UPDATE user_wallets
       SET coins = coins + ?,
           gems = gems + ?,
           updated_at = ?
       WHERE user_id = ?`
    )
    .bind(Number(row.coins_amount), Number(row.gems_amount), now, userId)
    .run();

  const inventory = await readUserInventoryState(db, userId, {
    shopTestMode: input.shopTestMode,
    now,
  });

  return {
    ok: true,
    status: 200,
    deduplicated: false,
    inventory,
    order: {
      orderId: row.order_id,
      packageId: row.package_id,
      amountToman: Number(row.amount_toman),
      coinsAmount: Number(row.coins_amount),
      gemsAmount: Number(row.gems_amount),
      gatewayProvider: row.gateway_provider,
      authority: row.authority,
      refId: verifiedRefId,
      status: 'VERIFIED',
      createdAt: Number(row.created_at),
      verifiedAt: now,
    },
  };
}
