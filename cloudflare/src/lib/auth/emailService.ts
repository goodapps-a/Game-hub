/**
 * Cloudflare Workers + Node.js compatible transactional email service for Eyvan (C2).
 *
 * Uses Resend HTTP API (`https://api.resend.com/emails`) via standard Web `fetch`
 * so it runs natively on Cloudflare Workers (no Node-only SMTP sockets) and local Express.
 *
 * Security invariants:
 * - Credentials (`RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_PROVIDER`) come strictly from server env/secrets.
 * - NEVER logs raw verification/reset tokens, full links, or API keys.
 * - NEVER fabricates successful email delivery when unconfigured — explicitly reports `{ configured: false, sent: false }`.
 * - Verification and reset URLs carry opaque tokens in the URL hash fragment (`#verify-email=...`, `#reset-password=...`)
 *   so browsers never send tokens in HTTP request paths, server access logs, or Referer headers.
 */

export interface EmailDeliveryResult {
  readonly configured: boolean;
  readonly sent: boolean;
  readonly provider: string;
  readonly errorCode?: string;
}

export interface VerificationEmailPayload {
  readonly to: string;
  readonly username: string;
  readonly verifyUrl: string;
  readonly expiresInHours: number;
}

export interface PasswordResetEmailPayload {
  readonly to: string;
  readonly username: string;
  readonly resetUrl: string;
  readonly expiresInMinutes: number;
}

export interface EmailSender {
  sendVerificationEmail(
    payload: VerificationEmailPayload
  ): Promise<EmailDeliveryResult>;
  sendPasswordResetEmail(
    payload: PasswordResetEmailPayload
  ): Promise<EmailDeliveryResult>;
}

export const DEFAULT_EMAIL_REQUEST_TIMEOUT_MS = 8_000;
const MIN_EMAIL_REQUEST_TIMEOUT_MS = 50;
const MAX_EMAIL_REQUEST_TIMEOUT_MS = 30_000;

export interface EmailProviderConfig {
  readonly provider?: string;
  readonly resendApiKey?: string;
  readonly emailFrom?: string;
  readonly isProduction?: boolean;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Defensively invokes an email delivery callback so that even an unexpected exception
 * from a custom/runtime `EmailSender` never crashes an auth route or leaks internal details.
 */
export async function deliverEmailSafely(
  deliver: () => Promise<EmailDeliveryResult>
): Promise<EmailDeliveryResult> {
  try {
    return await deliver();
  } catch {
    return {
      configured: true,
      sent: false,
      provider: 'unknown',
      errorCode: 'PROVIDER_UNEXPECTED_ERROR',
    };
  }
}

export interface ResolvePublicBaseUrlOptions {
  readonly isProduction?: boolean;
}

const PLACEHOLDER_TOKENS = [
  'MY_APP_URL',
  'MY_GEMINI_API_KEY',
  'REPLACE_WITH_',
  'YOUR_DOMAIN',
  'YOUR_APP',
  'YOUR_RESEND',
];

const PLACEHOLDER_DOMAINS = [
  'example.com',
  'example.org',
  'example.net',
  'your-domain.com',
  'yourdomain.com',
  'mydomain.com',
];

const SIMPLE_EMAIL_RE = /^[^\s@<>,"'\\]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i;
const DISPLAY_EMAIL_RE = /^[^<>\r\n]+<\s*([^\s@<>,"'\\]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+))\s*>$/i;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function containsPlaceholderToken(value: string): boolean {
  const upper = value.trim().toUpperCase();
  return PLACEHOLDER_TOKENS.some((tok) => upper.includes(tok));
}

export function isPlaceholderHostname(hostname: string): boolean {
  const lower = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!lower) return true;
  return PLACEHOLDER_DOMAINS.some(
    (domain) => lower === domain || lower.endsWith(`.${domain}`)
  );
}

export function isLocalOrWorkerHostname(hostname: string): boolean {
  const lower = hostname.trim().toLowerCase();
  return (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '[::1]' ||
    lower === '::1' ||
    lower === '0.0.0.0' ||
    lower.endsWith('.local') ||
    lower.endsWith('.workers.dev')
  );
}

/**
 * Extracts the sender mailbox domain from `user@domain.tld` or `Display Name <user@domain.tld>`.
 * Returns `null` if the syntax is invalid or contains header-injection characters.
 */
export function extractEmailFromDomain(emailFrom: string): string | null {
  const trimmed = emailFrom.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) return null;
  const direct = SIMPLE_EMAIL_RE.exec(trimmed);
  if (direct) return direct[1].toLowerCase();
  const display = DISPLAY_EMAIL_RE.exec(trimmed);
  if (display) return display[2].toLowerCase();
  return null;
}

export function isValidEmailFromAddress(
  emailFrom: string,
  options?: { isProduction?: boolean }
): { ok: true; domain: string } | { ok: false; code: 'EMAIL_FROM_MISSING' | 'EMAIL_FROM_INVALID' | 'EMAIL_FROM_PLACEHOLDER' } {
  const trimmed = emailFrom.trim();
  if (!trimmed) {
    return { ok: false, code: 'EMAIL_FROM_MISSING' };
  }
  if (containsPlaceholderToken(trimmed)) {
    return { ok: false, code: 'EMAIL_FROM_PLACEHOLDER' };
  }
  const domain = extractEmailFromDomain(trimmed);
  if (!domain) {
    return { ok: false, code: 'EMAIL_FROM_INVALID' };
  }
  if (options?.isProduction && (isPlaceholderHostname(domain) || isLocalOrWorkerHostname(domain))) {
    return { ok: false, code: 'EMAIL_FROM_PLACEHOLDER' };
  }
  return { ok: true, domain };
}

/**
 * Resolves the canonical public frontend origin used inside verification & password reset links.
 *
 * Security invariants:
 * - Always rejects placeholder values (`MY_APP_URL`, `REPLACE_WITH_*`, `example.com`).
 * - In Production (`isProduction: true`): accepts ONLY explicit `https://` non-localhost,
 *   non-`*.workers.dev`, non-placeholder origins; NEVER falls back to `http://localhost:3000`
 *   or an arbitrary Worker request URL. Returns `null` if unconfigured so callers refuse
 *   to generate broken links instead of silently emailing a localhost/Worker URL.
 * - In local dev (`isProduction: false`): falls back cleanly to `fallbackRequestUrl` or `http://localhost:3000`.
 */
export function resolvePublicAppBaseUrl(
  candidates: Array<string | undefined>,
  fallbackRequestUrl?: string,
  options?: ResolvePublicBaseUrlOptions
): string | null {
  const isProduction = options?.isProduction === true;

  for (const raw of candidates) {
    if (!raw) continue;
    for (const part of raw.split(',')) {
      const trimmed = part.trim();
      if (!trimmed || containsPlaceholderToken(trimmed)) continue;
      try {
        const parsed = new URL(trimmed);
        if (isProduction) {
          if (parsed.protocol !== 'https:') continue;
          if (isPlaceholderHostname(parsed.hostname) || isLocalOrWorkerHostname(parsed.hostname)) {
            continue;
          }
          return parsed.origin;
        }
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          if (isPlaceholderHostname(parsed.hostname)) continue;
          return parsed.origin;
        }
      } catch {
        // Ignore invalid placeholders such as MY_APP_URL
      }
    }
  }

  if (isProduction) {
    return null;
  }

  if (fallbackRequestUrl && !containsPlaceholderToken(fallbackRequestUrl)) {
    try {
      const parsed = new URL(fallbackRequestUrl);
      if (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        !isPlaceholderHostname(parsed.hostname)
      ) {
        return parsed.origin;
      }
    } catch {
      // Fall through to local dev default
    }
  }
  return 'http://localhost:3000';
}

export function buildVerificationLink(baseUrl: string, rawToken: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return `${cleanBase}/#verify-email=${encodeURIComponent(rawToken)}`;
}

export function buildPasswordResetLink(baseUrl: string, rawToken: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return `${cleanBase}/#reset-password=${encodeURIComponent(rawToken)}`;
}

function classifyResendHttpError(status: number): string {
  if (status === 400 || status === 422) return 'RESEND_BAD_REQUEST';
  if (status === 401 || status === 403) return 'RESEND_AUTH_ERROR';
  if (status === 429) return 'RESEND_RATE_LIMITED';
  if (status >= 500) return 'RESEND_SERVER_ERROR';
  return `PROVIDER_HTTP_${status}`;
}

function renderVerificationEmail(payload: VerificationEmailPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const safeName = escapeHtml(payload.username);
  const safeUrl = escapeHtml(payload.verifyUrl);
  const subject = 'تأیید ایمیل حساب کاربری ایوان';
  const text = [
    `سلام ${payload.username}،`,
    '',
    'برای فعال‌سازی حساب مرکزی ایوان، لینک زیر را در مرورگر باز کنید:',
    payload.verifyUrl,
    '',
    `این لینک یک‌بارمصرف است و تا ${payload.expiresInHours} ساعت اعتبار دارد.`,
    'اگر این درخواست از سوی شما نبوده است، این پیام را نادیده بگیرید.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="fa" dir="rtl">
  <body style="margin:0;padding:24px;background:#08101E;color:#F5EFE4;font-family:Tahoma,Arial,sans-serif;direction:rtl;text-align:right;">
    <div style="max-width:520px;margin:0 auto;background:#101C33;border:1px solid #D4AE58;border-radius:16px;padding:24px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:#E8C268;">تأیید ایمیل حساب ایوان</h1>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.8;color:#F5EFE4;">
        سلام <strong>${safeName}</strong>، برای فعال‌سازی حساب کاربری خود در پلتفرم ایوان روی دکمه زیر کلیک کنید:
      </p>
      <p style="margin:20px 0;text-align:center;">
        <a href="${safeUrl}" style="display:inline-block;padding:12px 24px;background:#D4AE58;color:#0B1528;text-decoration:none;font-weight:bold;border-radius:10px;font-size:14px;">
          تأیید ایمیل و فعال‌سازی حساب
        </a>
      </p>
      <p style="margin:16px 0 0;font-size:12px;line-height:1.7;color:#B8C2D6;">
        این لینک یک‌بارمصرف است و تا ${payload.expiresInHours} ساعت اعتبار دارد. اگر شما ثبت‌نام نکرده‌اید، این ایمیل را نادیده بگیرید.
      </p>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

function renderPasswordResetEmail(payload: PasswordResetEmailPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const safeName = escapeHtml(payload.username);
  const safeUrl = escapeHtml(payload.resetUrl);
  const subject = 'بازیابی رمز عبور حساب کاربری ایوان';
  const text = [
    `سلام ${payload.username}،`,
    '',
    'درخواستی برای بازیابی رمز عبور حساب کاربری ایوان ثبت شده است.',
    'برای تنظیم رمز عبور جدید، لینک زیر را در مرورگر باز کنید:',
    payload.resetUrl,
    '',
    `این لینک یک‌بارمصرف است و تا ${payload.expiresInMinutes} دقیقه اعتبار دارد.`,
    'پس از تغییر رمز عبور، تمام نشست‌های فعال قبلی شما به‌صورت خودکار لغو می‌شوند.',
    'اگر شما این درخواست را ثبت نکرده‌اید، این پیام را نادیده بگیرید.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="fa" dir="rtl">
  <body style="margin:0;padding:24px;background:#08101E;color:#F5EFE4;font-family:Tahoma,Arial,sans-serif;direction:rtl;text-align:right;">
    <div style="max-width:520px;margin:0 auto;background:#101C33;border:1px solid #D4AE58;border-radius:16px;padding:24px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:#E8C268;">بازیابی رمز عبور ایوان</h1>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.8;color:#F5EFE4;">
        سلام <strong>${safeName}</strong>، برای تعیین رمز عبور جدید حساب کاربری خود روی دکمه زیر کلیک کنید:
      </p>
      <p style="margin:20px 0;text-align:center;">
        <a href="${safeUrl}" style="display:inline-block;padding:12px 24px;background:#D4AE58;color:#0B1528;text-decoration:none;font-weight:bold;border-radius:10px;font-size:14px;">
          تنظیم رمز عبور جدید
        </a>
      </p>
      <p style="margin:16px 0 0;font-size:12px;line-height:1.7;color:#B8C2D6;">
        این لینک یک‌بارمصرف است و تا ${payload.expiresInMinutes} دقیقه اعتبار دارد. پس از تغییر رمز عبور، تمام نشست‌های فعال قبلی لغو خواهند شد.
      </p>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

export function createEmailSender(config: EmailProviderConfig): EmailSender {
  const provider = (config.provider ?? 'resend').trim().toLowerCase();
  const apiKey = (config.resendApiKey ?? '').trim();
  const fromAddress = (config.emailFrom ?? '').trim();
  const isProduction = config.isProduction === true;
  const fetchFn = config.fetchImpl ?? fetch;
  const rawTimeout = config.timeoutMs ?? DEFAULT_EMAIL_REQUEST_TIMEOUT_MS;
  const timeoutMs = Number.isFinite(rawTimeout)
    ? Math.max(
        MIN_EMAIL_REQUEST_TIMEOUT_MS,
        Math.min(MAX_EMAIL_REQUEST_TIMEOUT_MS, Math.floor(rawTimeout))
      )
    : DEFAULT_EMAIL_REQUEST_TIMEOUT_MS;

  function evaluateConfiguration():
    | { ok: true }
    | { ok: false; provider: string; errorCode: string } {
    if (provider === 'disabled') {
      return {
        ok: false,
        provider: 'disabled',
        errorCode: 'EMAIL_PROVIDER_DISABLED',
      };
    }
    if (provider !== 'resend') {
      return {
        ok: false,
        provider: provider || 'unconfigured',
        errorCode: 'EMAIL_PROVIDER_UNSUPPORTED',
      };
    }
    if (!apiKey || containsPlaceholderToken(apiKey)) {
      return {
        ok: false,
        provider: 'unconfigured',
        errorCode: 'EMAIL_API_KEY_MISSING',
      };
    }
    const fromCheck = isValidEmailFromAddress(fromAddress, { isProduction });
    if (fromCheck.ok === false) {
      return {
        ok: false,
        provider: 'unconfigured',
        errorCode: fromCheck.code,
      };
    }
    return { ok: true };
  }

  async function sendViaResend(
    to: string,
    subject: string,
    html: string,
    text: string
  ): Promise<EmailDeliveryResult> {
    const cfg = evaluateConfiguration();
    if (cfg.ok === false) {
      return {
        configured: false,
        sent: false,
        provider: cfg.provider,
        errorCode: cfg.errorCode,
      };
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [to],
          subject,
          html,
          text,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorCode = classifyResendHttpError(response.status);
        // Log ONLY HTTP status & error code — NEVER recipient email, raw tokens, URLs, or API key
        console.error(
          `[AuthEmail] Resend delivery failed code=${errorCode} status=${response.status}`
        );
        return {
          configured: true,
          sent: false,
          provider: 'resend',
          errorCode,
        };
      }

      return {
        configured: true,
        sent: true,
        provider: 'resend',
      };
    } catch (err) {
      const isAbortOrTimeout =
        timedOut ||
        (err instanceof Error &&
          (err.name === 'AbortError' || err.name === 'TimeoutError'));
      const errorCode = isAbortOrTimeout
        ? 'PROVIDER_TIMEOUT'
        : 'PROVIDER_NETWORK_ERROR';
      console.error(`[AuthEmail] Resend delivery failed code=${errorCode}`);
      return {
        configured: true,
        sent: false,
        provider: 'resend',
        errorCode,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async sendVerificationEmail(payload) {
      const rendered = renderVerificationEmail(payload);
      return sendViaResend(
        payload.to,
        rendered.subject,
        rendered.html,
        rendered.text
      );
    },
    async sendPasswordResetEmail(payload) {
      const rendered = renderPasswordResetEmail(payload);
      return sendViaResend(
        payload.to,
        rendered.subject,
        rendered.html,
        rendered.text
      );
    },
  };
}
