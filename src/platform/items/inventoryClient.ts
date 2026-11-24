import { buildOnlineHttpUrl } from '../../games/hokm/online/client';
import type {
  ItemSlot,
  PublicAppearanceSnapshot,
  ServerInventoryState,
  UniversalItemDefinition,
} from './itemTypes';

export interface ShopCatalogResponse {
  readonly ok: boolean;
  readonly shopTestMode?: boolean;
  readonly testModeLabel?: string;
  readonly items?: UniversalItemDefinition[];
  readonly code?: string;
  readonly message?: string;
}

export interface InventoryResponse extends Partial<ServerInventoryState> {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
}

export interface ShopClaimResponse {
  readonly ok: boolean;
  readonly item?: UniversalItemDefinition;
  readonly effectivePrice?: number;
  readonly deduplicated?: boolean;
  readonly alreadyOwned?: boolean;
  readonly grantedCoins?: number;
  readonly grantedGems?: number;
  readonly inventory?: ServerInventoryState;
  readonly code?: string;
  readonly message?: string;
}

export interface InventoryEquipResponse {
  readonly ok: boolean;
  readonly inventory?: ServerInventoryState;
  readonly code?: string;
  readonly message?: string;
}

import type { TomanPackageDefinition } from './tomanPackages';

export interface PublicUserProfileResponse {
  readonly ok: boolean;
  readonly profile?: {
    readonly userId: string;
    readonly accountCode?: string | null;
    readonly username: string;
    readonly displayName: string;
    readonly avatarCode: string;
    readonly avatarUrl: string | null;
    readonly level: number;
    readonly stats: {
      readonly matchesPlayed: number;
      readonly wins: number;
      readonly losses: number;
    };
    readonly appearance: PublicAppearanceSnapshot;
  };
  readonly code?: string;
  readonly message?: string;
}

export interface GiftLookupUserSummary {
  readonly userId: string;
  readonly accountCode?: string | null;
  readonly username: string;
  readonly displayName: string;
  readonly avatarCode: string;
  readonly avatarUrl: string | null;
  readonly level: number;
  readonly appearance?: PublicAppearanceSnapshot;
}

export interface GiftLookupResponse {
  readonly ok: boolean;
  readonly user?: GiftLookupUserSummary;
  readonly code?: string;
  readonly message?: string;
}

export interface ShopGiftResponse {
  readonly ok: boolean;
  readonly giftId?: string;
  readonly item?: UniversalItemDefinition;
  readonly effectivePrice?: number;
  readonly deduplicated?: boolean;
  readonly recipient?: {
    readonly userId: string;
    readonly username: string;
    readonly displayName: string;
    readonly accountCode?: string | null;
  };
  readonly inventory?: ServerInventoryState;
  readonly code?: string;
  readonly message?: string;
}

export interface TomanOrderSummary {
  readonly orderId: string;
  readonly packageId: string;
  readonly amountToman: number;
  readonly coinsAmount: number;
  readonly gemsAmount: number;
  readonly status: 'pending' | 'paid' | 'failed' | 'canceled';
  readonly gatewayMode: 'zarinpal' | 'sandbox';
  readonly authority: string | null;
  readonly refId: string | null;
  readonly createdAt: number;
  readonly paidAt: number | null;
}

export interface TomanPackagesResponse {
  readonly ok: boolean;
  readonly gatewayMode?: 'zarinpal' | 'sandbox';
  readonly packages?: TomanPackageDefinition[];
  readonly code?: string;
  readonly message?: string;
}

export interface TomanInitiateResponse {
  readonly ok: boolean;
  readonly order?: TomanOrderSummary;
  readonly package?: TomanPackageDefinition;
  readonly checkoutUrl?: string | null;
  readonly code?: string;
  readonly message?: string;
}

export interface TomanVerifyResponse {
  readonly ok: boolean;
  readonly order?: TomanOrderSummary;
  readonly deduplicated?: boolean;
  readonly inventory?: ServerInventoryState;
  readonly code?: string;
  readonly message?: string;
}

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `req_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

async function parseJsonSafe<T>(res: Response, fallbackMsg: string): Promise<T> {
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.toLowerCase().includes('application/json')) {
    throw new Error(fallbackMsg);
  }
  return (await res.json()) as T;
}

export async function fetchShopCatalogRequest(
  signal?: AbortSignal
): Promise<ShopCatalogResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/shop/catalog'), {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  });
  return parseJsonSafe<ShopCatalogResponse>(res, 'خطا در دریافت کاتالوگ فروشگاه.');
}

export async function fetchMyInventoryRequest(
  signal?: AbortSignal
): Promise<InventoryResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/inventory'), {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  });
  return parseJsonSafe<InventoryResponse>(res, 'خطا در دریافت موجودی حساب کاربری.');
}

export async function claimShopItemRequest(
  itemId: string,
  requestId: string = generateRequestId()
): Promise<ShopClaimResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/shop/claim'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify({ itemId, requestId }),
  });
  return parseJsonSafe<ShopClaimResponse>(res, 'خطا در دریافت آیتم فروشگاه.');
}

export async function lookupUserForGiftRequest(
  q: string,
  signal?: AbortSignal
): Promise<GiftLookupResponse> {
  const res = await fetch(
    buildOnlineHttpUrl(`/api/users/lookup?q=${encodeURIComponent(q.trim())}`),
    {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal,
    }
  );
  return parseJsonSafe<GiftLookupResponse>(res, 'خطا در جستجوی کاربر.');
}

export async function giftShopItemRequest(input: {
  itemId: string;
  recipientUserId: string;
  requestId?: string;
}): Promise<ShopGiftResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/shop/gift'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify({
      itemId: input.itemId,
      recipientUserId: input.recipientUserId,
      requestId: input.requestId ?? generateRequestId(),
    }),
  });
  return parseJsonSafe<ShopGiftResponse>(res, 'خطا در ارسال هدیه.');
}

export async function fetchTomanPackagesRequest(
  signal?: AbortSignal
): Promise<TomanPackagesResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/payments/toman/packages'), {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  });
  return parseJsonSafe<TomanPackagesResponse>(
    res,
    'خطا در دریافت بسته‌های شارژ تومانی.'
  );
}

export async function initiateTomanOrderRequest(
  packageId: string,
  callbackUrl?: string
): Promise<TomanInitiateResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/payments/toman/initiate'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify({
      packageId,
      ...(callbackUrl ? { callbackUrl } : {}),
    }),
  });
  return parseJsonSafe<TomanInitiateResponse>(
    res,
    'خطا در ایجاد سفارش پرداخت.'
  );
}

export async function verifyTomanOrderRequest(input: {
  orderId?: string;
  authority?: string;
}): Promise<TomanVerifyResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/payments/toman/verify'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify(input),
  });
  return parseJsonSafe<TomanVerifyResponse>(
    res,
    'خطا در تأیید پرداخت تومانی.'
  );
}

export async function equipInventoryItemRequest(
  itemId: string,
  slot?: ItemSlot
): Promise<InventoryEquipResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/inventory/equip'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify(slot ? { itemId, slot } : { itemId }),
  });
  return parseJsonSafe<InventoryEquipResponse>(res, 'خطا در فعال‌سازی آیتم.');
}

export async function unequipInventorySlotRequest(
  slot: ItemSlot
): Promise<InventoryEquipResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/inventory/unequip'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify({ slot }),
  });
  return parseJsonSafe<InventoryEquipResponse>(res, 'خطا در برداشتن انتخاب آیتم.');
}

export async function fetchPublicUserProfileRequest(
  userId: string,
  signal?: AbortSignal
): Promise<PublicUserProfileResponse> {
  const res = await fetch(
    buildOnlineHttpUrl(`/api/users/${encodeURIComponent(userId)}/public-profile`),
    {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal,
    }
  );
  return parseJsonSafe<PublicUserProfileResponse>(res, 'خطا در دریافت پروفایل بازیکن.');
}
