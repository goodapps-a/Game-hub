import { resolveShopTestModeEnabled } from '../../../../src/platform/items/shopTestMode';
import { parseAuthCookieFromHeader } from '../auth/authCookie';
import { verifyAuthSession } from '../auth/authService';
import {
  CSRF_CLIENT_HEADER_NAME,
  CSRF_CLIENT_HEADER_VALUE,
} from '../auth/httpHandler';
import { readBoundedUtf8Body } from '../httpBounds';
import type { D1DatabaseLike } from '../types';
import {
  initiateTomanTopUpOrder,
  listTomanPackages,
  verifyTomanTopUpOrder,
} from './tomanService';

const MAX_PAYMENT_BODY_BYTES = 4 * 1024;

export interface PaymentsHttpEnv {
  readonly db: D1DatabaseLike;
  readonly corsHeaders: Record<string, string>;
  readonly originAllowed: boolean;
  readonly zarinpalMerchantId?: string;
  readonly publicAppBaseUrl?: string;
  readonly shopTestMode?: boolean | string;
  readonly fetchImpl?: typeof fetch;
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

function verifyCsrf(request: Request, env: PaymentsHttpEnv): Response | null {
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
  env: PaymentsHttpEnv
): Promise<{ userId: string } | Response> {
  const token = parseAuthCookieFromHeader(request.headers.get('Cookie'));
  if (!token) {
    return buildJson(
      { ok: false, code: 'UNAUTHORIZED', message: 'برای خرید سکه و جم ابتدا وارد حساب کاربری شوید.' },
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

async function parseJsonBody(
  request: Request,
  env: PaymentsHttpEnv
): Promise<Record<string, unknown> | Response> {
  const read = await readBoundedUtf8Body(request, MAX_PAYMENT_BODY_BYTES);
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

export async function handlePaymentsHttpRequest(
  request: Request,
  pathname: string,
  env: PaymentsHttpEnv
): Promise<Response | null> {
  if (!pathname.startsWith('/api/payments/')) {
    return null;
  }

  const method = request.method.toUpperCase();
  const shopTestMode = resolveShopTestModeEnabled(env.shopTestMode);

  if (pathname === '/api/payments/toman/packages' && method === 'GET') {
    const info = listTomanPackages(env.zarinpalMerchantId);
    return buildJson(
      {
        ok: true,
        gatewayMode: info.gatewayMode,
        packages: info.packages,
      },
      200,
      env.corsHeaders
    );
  }

  if (pathname === '/api/payments/toman/initiate' && method === 'POST') {
    const csrfErr = verifyCsrf(request, env);
    if (csrfErr) return csrfErr;
    const auth = await requireAuthUser(request, env);
    if (auth instanceof Response) return auth;
    const body = await parseJsonBody(request, env);
    if (body instanceof Response) return body;

    const result = await initiateTomanTopUpOrder(env.db, auth.userId, {
      packageId: body.packageId,
      callbackUrl:
        typeof body.callbackUrl === 'string'
          ? body.callbackUrl
          : env.publicAppBaseUrl,
      zarinpalMerchantId: env.zarinpalMerchantId,
      fetchImpl: env.fetchImpl,
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
        order: result.order,
        package: result.package,
        checkoutUrl: result.checkoutUrl,
      },
      result.status,
      env.corsHeaders
    );
  }

  if (pathname === '/api/payments/toman/verify' && method === 'POST') {
    const csrfErr = verifyCsrf(request, env);
    if (csrfErr) return csrfErr;
    const auth = await requireAuthUser(request, env);
    if (auth instanceof Response) return auth;
    const body = await parseJsonBody(request, env);
    if (body instanceof Response) return body;

    const result = await verifyTomanTopUpOrder(env.db, auth.userId, {
      orderId: body.orderId,
      authority: body.authority,
      zarinpalMerchantId: env.zarinpalMerchantId,
      shopTestMode,
      fetchImpl: env.fetchImpl,
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
        order: result.order,
        deduplicated: result.deduplicated,
        inventory: result.inventory,
      },
      result.status,
      env.corsHeaders
    );
  }

  return null;
}
