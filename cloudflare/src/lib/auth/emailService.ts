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

export interface EmailProviderConfig {
  readonly provider?: string;
  readonly resendApiKey?: string;
  readonly emailFrom?: string;
  readonly fetchImpl?: typeof fetch;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function resolvePublicAppBaseUrl(
  candidates: Array<string | undefined>,
  fallbackRequestUrl?: string
): string {
  for (const raw of candidates) {
    if (!raw) continue;
    for (const part of raw.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          return parsed.origin;
        }
      } catch {
        // Ignore invalid placeholders such as MY_APP_URL
      }
    }
  }
  if (fallbackRequestUrl) {
    try {
      const parsed = new URL(fallbackRequestUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin;
      }
    } catch {
      // Fall through
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
  const fetchFn = config.fetchImpl ?? fetch;

  const isConfigured =
    provider === 'resend' && apiKey.length > 0 && fromAddress.length > 0;

  async function sendViaResend(
    to: string,
    subject: string,
    html: string,
    text: string
  ): Promise<EmailDeliveryResult> {
    if (!isConfigured) {
      return {
        configured: false,
        sent: false,
        provider: provider === 'disabled' ? 'disabled' : 'unconfigured',
        errorCode: 'EMAIL_NOT_CONFIGURED',
      };
    }

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
      });

      if (!response.ok) {
        // Log ONLY HTTP status code — never recipient email, raw tokens, URLs, or API key
        console.error(`[AuthEmail] Resend delivery failed with HTTP ${response.status}`);
        return {
          configured: true,
          sent: false,
          provider: 'resend',
          errorCode: `PROVIDER_HTTP_${response.status}`,
        };
      }

      return {
        configured: true,
        sent: true,
        provider: 'resend',
      };
    } catch {
      console.error('[AuthEmail] Resend network error during delivery');
      return {
        configured: true,
        sent: false,
        provider: 'resend',
        errorCode: 'PROVIDER_NETWORK_ERROR',
      };
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
