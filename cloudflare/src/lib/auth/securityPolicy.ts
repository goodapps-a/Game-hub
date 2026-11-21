/**
 * Shared Origin/CORS & Trusted-Proxy Client IP security policies for Eyvan.
 * Used identically by Express (`server/createExpressApp.ts`) and Cloudflare Workers (`cloudflare/src/index.ts`).
 *
 * Security invariants:
 * - Zero wildcard suffix allowlists (NEVER allows `*.run.app` or `*`).
 * - Only exact Same-Origin or explicitly configured origins from `ALLOWED_ORIGINS` / `APP_URL` are permitted.
 * - In Production, missing `ALLOWED_ORIGINS` NEVER falls back to permissive localhost or wildcard rules.
 * - `X-Forwarded-For` is NEVER trusted unless the immediate socket peer IP is in explicit `TRUSTED_PROXY_IPS`,
 *   and is parsed right-to-left so spoofed leading entries cannot bypass rate limits.
 */

export interface OriginPolicyConfig {
  readonly allowedOriginsRaw?: string;
  readonly appUrlRaw?: string;
  readonly isProduction: boolean;
}

export interface OriginEvaluationInput {
  readonly originHeader: string | null | undefined;
  readonly refererHeader?: string | null | undefined;
  readonly secFetchSite?: string | null | undefined;
  readonly requestOrigin: string;
  readonly method: string;
  readonly config: OriginPolicyConfig;
}

export interface OriginEvaluationResult {
  readonly allowed: boolean;
  readonly corsOrigin: string | null;
  readonly reason: string;
}

function tryNormalizeOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null') return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function parseConfiguredOrigins(config: OriginPolicyConfig): Set<string> {
  const out = new Set<string>();
  const appOrigin = tryNormalizeOrigin(config.appUrlRaw);
  if (appOrigin) {
    out.add(appOrigin);
  }
  if (config.allowedOriginsRaw) {
    for (const entry of config.allowedOriginsRaw.split(',')) {
      const norm = tryNormalizeOrigin(entry);
      if (norm) out.add(norm);
    }
  }
  return out;
}

function isLocalhostOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function isExactAllowedOrigin(
  candidateOrigin: string,
  requestOrigin: string,
  configured: Set<string>,
  isProduction: boolean
): boolean {
  if (candidateOrigin === requestOrigin) {
    return true;
  }
  if (configured.has(candidateOrigin)) {
    return true;
  }
  // Local dev fallback ONLY when not in production and no explicit allowlist overrides it
  if (!isProduction && configured.size === 0 && isLocalhostOrigin(candidateOrigin)) {
    return true;
  }
  return false;
}

/**
 * Evaluates Origin / Referer / Sec-Fetch-Site uniformly across Worker and Express.
 */
export function evaluateOriginPolicy(
  input: OriginEvaluationInput
): OriginEvaluationResult {
  const configured = parseConfiguredOrigins(input.config);
  const reqOrigin = tryNormalizeOrigin(input.requestOrigin) ?? input.requestOrigin;
  const method = input.method.toUpperCase();
  const isMutating = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';

  // Case 1: Origin header is present (including literal "null" from sandboxed iframes)
  if (input.originHeader !== null && input.originHeader !== undefined && input.originHeader !== '') {
    const parsedOrigin = tryNormalizeOrigin(input.originHeader);
    if (!parsedOrigin) {
      return { allowed: false, corsOrigin: null, reason: 'invalid_origin' };
    }
    if (
      isExactAllowedOrigin(
        parsedOrigin,
        reqOrigin,
        configured,
        input.config.isProduction
      )
    ) {
      return {
        allowed: true,
        corsOrigin: parsedOrigin,
        reason: 'allowed_origin',
      };
    }
    return { allowed: false, corsOrigin: null, reason: 'origin_not_allowed' };
  }

  // Case 2: No Origin header — inspect browser Fetch Metadata & Referer on mutating routes
  if (isMutating) {
    const fetchSite = input.secFetchSite?.trim().toLowerCase();
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
      return {
        allowed: false,
        corsOrigin: null,
        reason: 'cross_site_without_origin',
      };
    }

    if (input.refererHeader) {
      const refOrigin = tryNormalizeOrigin(input.refererHeader);
      if (
        !refOrigin ||
        !isExactAllowedOrigin(
          refOrigin,
          reqOrigin,
          configured,
          input.config.isProduction
        )
      ) {
        return {
          allowed: false,
          corsOrigin: null,
          reason: 'referer_not_allowed',
        };
      }
    }
  }

  return { allowed: true, corsOrigin: null, reason: 'no_origin_allowed' };
}

/**
 * Normalizes IPv4-mapped IPv6 addresses (`::ffff:127.0.0.1` -> `127.0.0.1`) and trims whitespace.
 */
export function normalizeIpAddress(raw: string | null | undefined): string {
  if (!raw) return '';
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith('[') && ip.endsWith(']')) {
    ip = ip.slice(1, -1);
  }
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice('::ffff:'.length);
  }
  return ip;
}

export function parseTrustedProxyIps(raw: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;
  for (const part of raw.split(',')) {
    const norm = normalizeIpAddress(part);
    if (norm && norm !== '*') {
      out.add(norm);
    }
  }
  return out;
}

export interface ResolveClientIpInput {
  /** Authoritative socket peer IP (Express `req.socket.remoteAddress`). */
  readonly remoteAddress?: string | null;
  /** Cloudflare edge-injected header (`CF-Connecting-IP`). Only pass when running on Cloudflare Workers. */
  readonly cfConnectingIp?: string | null;
  /** `X-Forwarded-For` header value (UNTRUSTED unless `remoteAddress` is in `trustedProxies`). */
  readonly xForwardedFor?: string | null;
  /** Explicit allowlist of trusted reverse-proxy IPs (`TRUSTED_PROXY_IPS`). */
  readonly trustedProxies?: Set<string>;
}

/**
 * Extracts the real client IP without allowing `X-Forwarded-For` spoofing:
 * 1. On Cloudflare Workers: trusts `CF-Connecting-IP` (injected by Cloudflare edge).
 * 2. On Express: uses direct `remoteAddress` UNLESS `remoteAddress` is explicitly listed
 *    in `trustedProxies`, in which case walks `X-Forwarded-For` right-to-left and returns
 *    the rightmost non-trusted IP so leading attacker-forged IPs are ignored.
 */
export function resolveClientIp(input: ResolveClientIpInput): string {
  const cfIp = normalizeIpAddress(input.cfConnectingIp);
  if (cfIp) {
    return cfIp;
  }

  const peerIp = normalizeIpAddress(input.remoteAddress);
  const trusted = input.trustedProxies;

  if (peerIp && trusted && trusted.size > 0 && trusted.has(peerIp) && input.xForwardedFor) {
    const chain = input.xForwardedFor
      .split(',')
      .map((s) => normalizeIpAddress(s))
      .filter(Boolean);

    // Walk right-to-left: skip trusted proxies appended at the right edge; pick first untrusted client IP
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      if (!trusted.has(chain[i])) {
        return chain[i];
      }
    }
    if (chain.length > 0) {
      return chain[0];
    }
  }

  return peerIp || 'unknown';
}
