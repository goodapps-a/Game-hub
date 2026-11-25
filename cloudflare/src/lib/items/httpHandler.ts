import { BASE_UNIVERSAL_ITEMS } from '../../../../src/platform/items/catalogData';
import {
  getShopTestModeConfig,
  resolveShopTestModeEnabled,
} from '../../../../src/platform/items/shopTestMode';
import { parseAuthCookieFromHeader } from '../auth/authCookie';
import { verifyAuthSession } from '../auth/authService';
import {
  CSRF_CLIENT_HEADER_NAME,
  CSRF_CLIENT_HEADER_VALUE,
} from '../auth/httpHandler';
import { readBoundedUtf8Body } from '../httpBounds';
import type { D1DatabaseLike } from '../types';
import {
  claimShopItemForUser,
  equipItemForUser,
  getPublicUserProfileById,
  giftShopItemForUser,
  lookupPublicUserForGift,
  readUserInventoryState,
  unequipSlotForUser,
} from './inventoryService';

const MAX_ITEMS_BODY_BYTES = 8 * 1024;

export interface ItemsHttpEnv {
  readonly db: D1DatabaseLike;
  readonly corsHeaders: Record<string, string>;
  readonly originAllowed: boolean;
  readonly shopTestMode?: boolean | string;
  readonly now?: number;
}

function buildJson(
  payload: unknown,
  status: number,
  corsHeaders: Record<string, string>
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders,
    },
  });
}

function verifyCsrf(request: Request, env: ItemsHttpEnv): Response | null {
  if (!env.originAllowed) {
    return buildJson(
      { ok: false, code: 'FORBIDDEN_ORIGIN', message: 'مبدا درخواست مجاز نیست.' },
      403,
      env.corsHeaders
    );
  }
  const csrf = request.headers.get(CSRF_CLIENT_HEADER_NAME);
  if (csrf !== CSRF_CLIENT_HEADER_VALUE) {
    return buildJson(
      { ok: false, code: 'CSRF_REJECTED', message: 'درخواست نامعتبر است.' },
      403,
      env.corsHeaders
    );
  }
  const ct = request.headers.get('Content-Type') ?? '';
  if (!ct.toLowerCase().includes('application/json')) {
    return buildJson(
      { ok: false, code: 'INVALID_INPUT', message: 'نوع بدنه باید JSON باشد.' },
      400,
      env.corsHeaders
    );
  }
  return null;
}

async function requireAuthUser(
  request: Request,
  env: ItemsHttpEnv
): Promise<{ userId: string } | Response> {
  const token = parseAuthCookieFromHeader(request.headers.get('Cookie'));
  if (!token) {
    return buildJson(
      { ok: false, code: 'UNAUTHORIZED', message: 'برای این عملیات ابتدا وارد حساب کاربری شوید.' },
      401,
      env.corsHeaders
    );
  }
  const verified = await verifyAuthSession(env.db, token, env.now);
  if (!verified.authenticated || !verified.user) {
    return buildJson(
      { ok: false, code: 'UNAUTHORIZED', message: 'نشست کاربری معتبر نیست یا منقضی شده است.' },
      401,
      env.corsHeaders
    );
  }
  return { userId: verified.user.userId };
}

async function parseJsonObjectBody(
  request: Request,
  env: ItemsHttpEnv
): Promise<Record<string, unknown> | Response> {
  const read = await readBoundedUtf8Body(request, MAX_ITEMS_BODY_BYTES);
  if (!read.ok) {
    return buildJson(
      { ok: false, code: 'INVALID_INPUT', message: 'حجم بدنه درخواست بیش از حد مجاز است.' },
      read.status,
      env.corsHeaders
    );
  }
  try {
    const parsed = JSON.parse(read.text || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return buildJson(
        { ok: false, code: 'INVALID_INPUT', message: 'فرمت JSON درخواست نامعتبر است.' },
        400,
        env.corsHeaders
      );
    }
    return parsed as Record<string, unknown>;
  } catch {
    return buildJson(
      { ok: false, code: 'INVALID_INPUT', message: 'فرمت JSON درخواست نامعتبر است.' },
      400,
      env.corsHeaders
    );
  }
}

export async function handleItemsHttpRequest(
  request: Request,
  pathname: string,
  env: ItemsHttpEnv
): Promise<Response | null> {
  const method = request.method.toUpperCase();
  const testModeEnabled = resolveShopTestModeEnabled(env.shopTestMode);

  // 1) Public Shop Catalog (`GET /api/shop/catalog`)
  if (pathname === '/api/shop/catalog' && method === 'GET') {
    const testConfig = getShopTestModeConfig(testModeEnabled);
    return buildJson(
      {
        ok: true,
        shopTestMode: testConfig.enabled,
        testModeLabel: testConfig.label,
        items: BASE_UNIVERSAL_ITEMS,
      },
      200,
      env.corsHeaders
    );
  }

  // 2) Public User Lookup by username OR 6-digit accountCode (`GET /api/users/lookup?q=...`)
  if (pathname === '/api/users/lookup' && method === 'GET') {
    const auth = await requireAuthUser(request, env);
    if (auth instanceof Response) return auth;
    const reqUrl = new URL(request.url);
    const q = reqUrl.searchParams.get('q') ?? '';
    const result = await lookupPublicUserForGift(env.db, q, auth.userId);
    if (result.ok === false) {
      return buildJson(
        { ok: false, code: result.code, message: result.message },
        result.status,
        env.corsHeaders
      );
    }
    return buildJson({ ok: true, user: result.user }, 200, env.corsHeaders);
  }

  // 2b) Public Profile & Public Appearance (`GET /api/users/:userId/public-profile`)
  const publicProfileMatch = pathname.match(
    /^\/api\/users\/([A-Za-z0-9_.-]{3,64})\/public-profile$/
  );
  if (publicProfileMatch && method === 'GET') {
    let viewerUserId: string | null = null;
    const rawToken = parseAuthCookieFromHeader(request.headers.get('Cookie'));
    if (rawToken) {
      try {
        const verified = await verifyAuthSession(env.db, rawToken, env.now);
        if (verified.authenticated && verified.user) {
          viewerUserId = verified.user.userId;
        }
      } catch {
        viewerUserId = null;
      }
    }
    const result = await getPublicUserProfileById(
      env.db,
      publicProfileMatch[1],
      viewerUserId
    );
    if (result.ok === false) {
      return buildJson(
        { ok: false, code: result.code, message: result.message },
        result.status,
        env.corsHeaders
      );
    }
    return buildJson({ ok: true, profile: result.profile }, 200, env.corsHeaders);
  }

  // 3) Authenticated Inventory & Equipped Slots (`GET /api/inventory`)
  if (pathname === '/api/inventory' && method === 'GET') {
    const auth = await requireAuthUser(request, env);
    if (auth instanceof Response) return auth;
    try {
      const state = await readUserInventoryState(env.db, auth.userId, {
        shopTestMode: testModeEnabled,
        now: env.now,
      });
      return buildJson({ ok: true, ...state }, 200, env.corsHeaders);
    } catch {
      return buildJson(
        { ok: false, code: 'DATABASE_ERROR', message: 'خطا در دریافت موجودی حساب.' },
        503,
        env.corsHeaders
      );
    }
  }

  // 4) Shop Claim / Purchase (`POST /api/shop/claim`)
  if (pathname === '/api/shop/claim' && method === 'POST') {
    const csrfErr = verifyCsrf(request, env);
    if (csrfErr) return csrfErr;
    const auth = await requireAuthUser(request, env);
    if (auth instanceof Response) return auth;
    const body = await parseJsonObjectBody(request, env);
    if (body instanceof Response) return body;

    try {
      const result = await claimShopItemForUser(env.db, auth.userId, {
        itemId: body.itemId,
        requestId: body.requestId,
        shopTestMode: testModeEnabled,
        now: env.now,
      });
      if (result.ok === false) {
        return buildJson(
          { ok: false, code: result.code, message: result.message },
          result.status,
          env.corsHeaders
        );
      }
      return buildJson(
        {
          ok: true,
          item: result.item,
          effectivePrice: result.effectivePrice,
          deduplicated: result.deduplicated,
          alreadyOwned: result.alreadyOwned,
          grantedCoins: result.grantedCoins,
          grantedGems: result.grantedGems,
          inventory: result.state,
        },
        result.status,
        env.corsHeaders
      );
    } catch {
      return buildJson(
        {
          ok: false,
          code: 'DATABASE_ERROR',
          message: 'ثبت تراکنش فروشگاه با خطا مواجه شد.',
        },
        503,
        env.corsHeaders
      );
    }
  }

  // 4b) Shop Gift to Friend (`POST /api/shop/gift`)
  if (pathname === '/api/shop/gift' && method === 'POST') {
    const csrfErr = verifyCsrf(request, env);
    if (csrfErr) return csrfErr;
    const auth = await requireAuthUser(request, env);
    if (auth instanceof Response) return auth;
    const body = await parseJsonObjectBody(request, env);
    if (body instanceof Response) return body;

    try {
      const result = await giftShopItemForUser(env.db, auth.userId, {
        itemId: body.itemId,
        recipientUserId: body.recipientUserId,
        requestId: body.requestId,
        shopTestMode: testModeEnabled,
        now: env.now,
      });
      if (result.ok === false) {
        return buildJson(
          { ok: false, code: result.code, message: result.message },
          result.status,
          env.corsHeaders
        );
      }
      return buildJson(
        {
          ok: true,
          giftId: result.giftId,
          item: result.item,
          effectivePrice: result.effectivePrice,
          deduplicated: result.deduplicated,
          recipient: result.recipient,
          inventory: result.state,
        },
        result.status,
        env.corsHeaders
      );
    } catch {
      return buildJson(
        {
          ok: false,
          code: 'DATABASE_ERROR',
          message: 'ثبت هدیه با خطا مواجه شد.',
        },
        503,
        env.corsHeaders
      );
    }
  }

  // 5) Equip Owned Item (`POST /api/inventory/equip`)
  if (pathname === '/api/inventory/equip' && method === 'POST') {
    const csrfErr = verifyCsrf(request, env);
    if (csrfErr) return csrfErr;
    const auth = await requireAuthUser(request, env);
    if (auth instanceof Response) return auth;
    const body = await parseJsonObjectBody(request, env);
    if (body instanceof Response) return body;

    try {
      const result = await equipItemForUser(env.db, auth.userId, {
        itemId: body.itemId,
        slot: body.slot,
        shopTestMode: testModeEnabled,
        now: env.now,
      });
      if (result.ok === false) {
        return buildJson(
          { ok: false, code: result.code, message: result.message },
          result.status,
          env.corsHeaders
        );
      }
      return buildJson(
        { ok: true, inventory: result.state },
        result.status,
        env.corsHeaders
      );
    } catch {
      return buildJson(
        {
          ok: false,
          code: 'DATABASE_ERROR',
          message: 'ذخیره‌سازی انتخاب آیتم با خطا مواجه شد.',
        },
        503,
        env.corsHeaders
      );
    }
  }

  // 6) Unequip Slot (`POST /api/inventory/unequip`)
  if (pathname === '/api/inventory/unequip' && method === 'POST') {
    const csrfErr = verifyCsrf(request, env);
    if (csrfErr) return csrfErr;
    const auth = await requireAuthUser(request, env);
    if (auth instanceof Response) return auth;
    const body = await parseJsonObjectBody(request, env);
    if (body instanceof Response) return body;

    try {
      const result = await unequipSlotForUser(env.db, auth.userId, {
        slot: body.slot,
        shopTestMode: testModeEnabled,
        now: env.now,
      });
      if (result.ok === false) {
        return buildJson(
          { ok: false, code: result.code, message: result.message },
          result.status,
          env.corsHeaders
        );
      }
      return buildJson(
        { ok: true, inventory: result.state },
        result.status,
        env.corsHeaders
      );
    } catch {
      return buildJson(
        {
          ok: false,
          code: 'DATABASE_ERROR',
          message: 'به‌روزرسانی وضعیت اسلات با خطا مواجه شد.',
        },
        503,
        env.corsHeaders
      );
    }
  }

  return null;
}
