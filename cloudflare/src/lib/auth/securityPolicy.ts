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

import {
  containsPlaceholderToken,
  isLocalOrWorkerHostname,
  isPlaceholderHostname,
  isValidEmailFromAddress,
  resolvePublicAppBaseUrl,
} from './emailService';

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
  if (containsPlaceholderToken(trimmed)) return null;
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
  const addCandidate = (raw: string | undefined) => {
    const norm = tryNormalizeOrigin(raw);
    if (!norm) return;
    if (config.isProduction) {
      try {
        const parsed = new URL(norm);
        if (isPlaceholderHostname(parsed.hostname)) return;
      } catch {
        return;
      }
    }
    out.add(norm);
  };

  addCandidate(config.appUrlRaw);
  if (config.allowedOriginsRaw) {
    for (const entry of config.allowedOriginsRaw.split(',')) {
      addCandidate(entry);
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

export interface ProductionAuthConfigInput {
  readonly allowedOrigins?: string;
  readonly appUrl?: string;
  readonly publicAppUrl?: string;
  readonly emailProvider?: string;
  readonly resendApiKey?: string;
  readonly emailFrom?: string;
  readonly trustedProxyIps?: string;
  readonly d1DatabaseId?: string;
}

export interface ConfigValidationIssue {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export interface ProductionAuthConfigReport {
  readonly ok: boolean;
  readonly errors: ConfigValidationIssue[];
  readonly warnings: ConfigValidationIssue[];
}

/**
 * Validates Production central-auth configuration for Cloudflare Workers & Express.
 * Never echoes secret values in diagnostic messages.
 */
export function validateProductionAuthConfig(
  input: ProductionAuthConfigInput
): ProductionAuthConfigReport {
  const errors: ConfigValidationIssue[] = [];
  const warnings: ConfigValidationIssue[] = [];

  // 1) ALLOWED_ORIGINS check
  const rawAllowed = (input.allowedOrigins ?? '').trim();
  if (!rawAllowed) {
    errors.push({
      field: 'ALLOWED_ORIGINS',
      code: 'ALLOWED_ORIGINS_MISSING',
      message: 'ALLOWED_ORIGINS must list explicit HTTPS frontend origins in Production.',
    });
  } else {
    const parts = rawAllowed.split(',').map((p) => p.trim()).filter(Boolean);
    let validCount = 0;
    for (const part of parts) {
      if (part.includes('*')) {
        errors.push({
          field: 'ALLOWED_ORIGINS',
          code: 'ALLOWED_ORIGINS_WILDCARD',
          message: 'ALLOWED_ORIGINS must not contain wildcard patterns.',
        });
        continue;
      }
      if (containsPlaceholderToken(part)) {
        errors.push({
          field: 'ALLOWED_ORIGINS',
          code: 'ALLOWED_ORIGINS_PLACEHOLDER',
          message: 'ALLOWED_ORIGINS contains a placeholder value.',
        });
        continue;
      }
      try {
        const u = new URL(part);
        if (u.protocol !== 'https:') {
          errors.push({
            field: 'ALLOWED_ORIGINS',
            code: 'ALLOWED_ORIGINS_NON_HTTPS',
            message: 'ALLOWED_ORIGINS must use HTTPS in Production.',
          });
          continue;
        }
        if (isPlaceholderHostname(u.hostname) || isLocalOrWorkerHostname(u.hostname)) {
          errors.push({
            field: 'ALLOWED_ORIGINS',
            code: 'ALLOWED_ORIGINS_INVALID_HOST',
            message: 'ALLOWED_ORIGINS must not use localhost, workers.dev, or placeholder domains in Production.',
          });
          continue;
        }
        validCount += 1;
      } catch {
        errors.push({
          field: 'ALLOWED_ORIGINS',
          code: 'ALLOWED_ORIGINS_INVALID_URL',
          message: 'ALLOWED_ORIGINS contains a malformed URL.',
        });
      }
    }
    if (validCount === 0 && errors.every((e) => e.field !== 'ALLOWED_ORIGINS')) {
      errors.push({
        field: 'ALLOWED_ORIGINS',
        code: 'ALLOWED_ORIGINS_EMPTY',
        message: 'ALLOWED_ORIGINS has no valid Production HTTPS origins.',
      });
    }
  }

  // 2) PUBLIC_APP_URL check (must resolve to a real HTTPS non-localhost non-placeholder origin)
  const resolvedPublicUrl = resolvePublicAppBaseUrl(
    [input.publicAppUrl, input.appUrl],
    undefined,
    { isProduction: true }
  );
  if (!resolvedPublicUrl) {
    errors.push({
      field: 'PUBLIC_APP_URL',
      code: 'PUBLIC_APP_URL_INVALID_OR_MISSING',
      message: 'PUBLIC_APP_URL must be an explicit HTTPS Production frontend origin (not localhost, workers.dev, or placeholder).',
    });
  }

  // 3) Transactional email provider checks
  const provider = (input.emailProvider ?? 'resend').trim().toLowerCase();
  if (provider === 'disabled') {
    warnings.push({
      field: 'EMAIL_PROVIDER',
      code: 'EMAIL_PROVIDER_DISABLED',
      message: 'EMAIL_PROVIDER is disabled; verification and password reset emails will not be delivered.',
    });
  } else if (provider !== 'resend') {
    errors.push({
      field: 'EMAIL_PROVIDER',
      code: 'EMAIL_PROVIDER_UNSUPPORTED',
      message: 'EMAIL_PROVIDER must be "resend" or "disabled".',
    });
  } else {
    const key = (input.resendApiKey ?? '').trim();
    if (!key || containsPlaceholderToken(key)) {
      errors.push({
        field: 'RESEND_API_KEY',
        code: 'RESEND_API_KEY_MISSING_OR_PLACEHOLDER',
        message: 'RESEND_API_KEY must be set via server secret in Production.',
      });
    }
    const fromCheck = isValidEmailFromAddress(input.emailFrom ?? '', {
      isProduction: true,
    });
    if (fromCheck.ok === false) {
      errors.push({
        field: 'EMAIL_FROM',
        code: fromCheck.code,
        message: 'EMAIL_FROM must use a valid verified Production sender domain (not example.com).',
      });
    }
  }

  // 4) TRUSTED_PROXY_IPS wildcard check (when supplied)
  if (input.trustedProxyIps && input.trustedProxyIps.includes('*')) {
    errors.push({
      field: 'TRUSTED_PROXY_IPS',
      code: 'TRUSTED_PROXY_IPS_WILDCARD',
      message: 'TRUSTED_PROXY_IPS must never contain "*".',
    });
  }

  // 5) Optional D1 database ID placeholder check
  if (input.d1DatabaseId !== undefined) {
    const trimmedId = input.d1DatabaseId.trim();
    if (!trimmedId || containsPlaceholderToken(trimmedId)) {
      errors.push({
        field: 'D1_DATABASE_ID',
        code: 'D1_DATABASE_ID_PLACEHOLDER',
        message: 'Cloudflare D1 database_id must be replaced with the real D1 UUID before deploy.',
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
