/**
 * Strict server-side validation for Eyvan Central Auth (C1).
 * Blocks malformed emails, unsafe/reserved usernames, control characters,
 * and weak passwords without leaking sensitive internals.
 */

const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

// Practical strict RFC-aligned email pattern (rejects spaces, quotes, angle brackets, double dots)
const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;

const RESERVED_USERNAMES = new Set<string>([
  'admin',
  'administrator',
  'root',
  'system',
  'support',
  'moderator',
  'mod',
  'staff',
  'official',
  'security',
  'eyvan',
  'eyvan_admin',
  'eyvan_official',
  'eyvan_support',
  'guest',
  'guest_player',
  'anonymous',
  'null',
  'undefined',
  'api',
  'auth',
  'login',
  'register',
  'logout',
  'hokm',
  'bot',
]);

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export interface ValidatedEmail {
  readonly ok: true;
  readonly email: string;
  readonly emailKey: string;
}

export interface ValidatedUsername {
  readonly ok: true;
  readonly username: string;
  readonly usernameKey: string;
}

export interface ValidationFailure {
  readonly ok: false;
  readonly message: string;
}

export function validateEmail(
  raw: unknown
): ValidatedEmail | ValidationFailure {
  if (typeof raw !== 'string') {
    return { ok: false, message: 'لطفاً یک ایمیل معتبر وارد کنید.' };
  }
  const email = raw.trim();
  if (
    email.length < 5 ||
    email.length > 254 ||
    CONTROL_CHAR_RE.test(email) ||
    email.includes('..') ||
    !EMAIL_RE.test(email)
  ) {
    return { ok: false, message: 'فرمت ایمیل واردشده معتبر نیست.' };
  }
  return {
    ok: true,
    email,
    emailKey: email.toLowerCase(),
  };
}

export function validateAuthUsername(
  raw: unknown
): ValidatedUsername | ValidationFailure {
  if (typeof raw !== 'string') {
    return { ok: false, message: 'نام کاربری الزامی است.' };
  }
  const username = raw.trim();
  if (
    !USERNAME_RE.test(username) ||
    !/[a-zA-Z]/.test(username) ||
    username.startsWith('.') ||
    username.endsWith('.') ||
    username.startsWith('_') ||
    username.endsWith('_') ||
    username.includes('..') ||
    username.includes('__')
  ) {
    return {
      ok: false,
      message:
        'نام کاربری باید بین ۳ تا ۲۰ کاراکتر انگلیسی (حروف، عدد، _ یا .) باشد و حداقل یک حرف انگلیسی داشته باشد.',
    };
  }

  const usernameKey = username.toLowerCase();
  if (RESERVED_USERNAMES.has(usernameKey)) {
    return {
      ok: false,
      message: 'انتخاب این نام کاربری مجاز نیست. لطفاً نام دیگری انتخاب کنید.',
    };
  }

  return { ok: true, username, usernameKey };
}

export function validateNewPassword(
  rawPassword: unknown,
  rawConfirmPassword: unknown
): { ok: true; password: string } | ValidationFailure {
  if (typeof rawPassword !== 'string') {
    return { ok: false, message: 'وارد کردن رمز عبور الزامی است.' };
  }
  if (
    rawPassword.length < MIN_PASSWORD_LENGTH ||
    rawPassword.length > MAX_PASSWORD_LENGTH
  ) {
    return {
      ok: false,
      message: `رمز عبور باید بین ${MIN_PASSWORD_LENGTH} تا ${MAX_PASSWORD_LENGTH} کاراکتر باشد.`,
    };
  }
  if (CONTROL_CHAR_RE.test(rawPassword)) {
    return {
      ok: false,
      message: 'رمز عبور شامل کاراکترهای غیرمجاز است.',
    };
  }
  if (!/[a-zA-Z]/.test(rawPassword) || !/[0-9]/.test(rawPassword)) {
    return {
      ok: false,
      message: 'رمز عبور باید حداقل شامل یک حرف انگلیسی و یک عدد باشد.',
    };
  }
  if (typeof rawConfirmPassword !== 'string' || rawConfirmPassword !== rawPassword) {
    return {
      ok: false,
      message: 'تکرار رمز عبور با رمز عبور مطابقت ندارد.',
    };
  }
  return { ok: true, password: rawPassword };
}

export interface ValidatedRegisterPayload {
  readonly ok: true;
  readonly email: string;
  readonly emailKey: string;
  readonly username: string;
  readonly usernameKey: string;
  readonly password: string;
}

export function validateRegisterPayload(
  body: Record<string, unknown>
): ValidatedRegisterPayload | ValidationFailure {
  const emailRes = validateEmail(body.email);
  if (emailRes.ok === false) return emailRes;

  const userRes = validateAuthUsername(body.username);
  if (userRes.ok === false) return userRes;

  const passRes = validateNewPassword(body.password, body.confirmPassword);
  if (passRes.ok === false) return passRes;

  return {
    ok: true,
    email: emailRes.email,
    emailKey: emailRes.emailKey,
    username: userRes.username,
    usernameKey: userRes.usernameKey,
    password: passRes.password,
  };
}

export interface ValidatedLoginPayload {
  readonly ok: true;
  readonly identifierType: 'email' | 'username';
  readonly identifierKey: string;
  readonly password: string;
}

export function validateLoginPayload(
  body: Record<string, unknown>
): ValidatedLoginPayload | ValidationFailure {
  const rawIdentifier =
    typeof body.identifier === 'string'
      ? body.identifier
      : typeof body.email === 'string'
      ? body.email
      : typeof body.username === 'string'
      ? body.username
      : '';

  const trimmed = rawIdentifier.trim();
  if (
    trimmed.length < 3 ||
    trimmed.length > 254 ||
    CONTROL_CHAR_RE.test(trimmed)
  ) {
    return {
      ok: false,
      message: 'ایمیل/نام کاربری یا رمز عبور نادرست است.',
    };
  }

  if (
    typeof body.password !== 'string' ||
    body.password.length === 0 ||
    body.password.length > MAX_PASSWORD_LENGTH ||
    CONTROL_CHAR_RE.test(body.password)
  ) {
    return {
      ok: false,
      message: 'ایمیل/نام کاربری یا رمز عبور نادرست است.',
    };
  }

  const isEmail = trimmed.includes('@');
  return {
    ok: true,
    identifierType: isEmail ? 'email' : 'username',
    identifierKey: trimmed.toLowerCase(),
    password: body.password,
  };
}

const OPAQUE_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

export function validateOpaqueActionToken(
  raw: unknown
): { ok: true; token: string } | ValidationFailure {
  if (typeof raw !== 'string') {
    return { ok: false, message: 'توکن ارسال‌شده معتبر نیست.' };
  }
  const token = raw.trim();
  if (!OPAQUE_TOKEN_RE.test(token)) {
    return { ok: false, message: 'توکن ارسال‌شده معتبر نیست.' };
  }
  return { ok: true, token };
}

export function validateResetPasswordPayload(
  body: Record<string, unknown>
): { ok: true; token: string; password: string } | ValidationFailure {
  const tokenRes = validateOpaqueActionToken(body.token);
  if (tokenRes.ok === false) return tokenRes;

  const passRes = validateNewPassword(body.password, body.confirmPassword);
  if (passRes.ok === false) return passRes;

  return {
    ok: true,
    token: tokenRes.token,
    password: passRes.password,
  };
}

export const ALLOWED_AVATAR_CODES = [
  'portrait',
  'shamsa',
  'turquoise',
  'lapis',
  'jade',
] as const;

export type ValidAvatarCode = (typeof ALLOWED_AVATAR_CODES)[number];

const AVATAR_CODE_SET = new Set<string>(ALLOWED_AVATAR_CODES);

export function validateAvatarCode(
  raw: unknown
): { ok: true; avatarCode: ValidAvatarCode } | ValidationFailure {
  if (typeof raw !== 'string') {
    return { ok: false, message: 'نشان پروفایل نامعتبر است.' };
  }
  const cleaned = raw.trim();
  if (!AVATAR_CODE_SET.has(cleaned)) {
    return { ok: false, message: 'نشان پروفایل انتخاب‌شده معتبر نیست.' };
  }
  return { ok: true, avatarCode: cleaned as ValidAvatarCode };
}

export interface ValidatedProfileUpdatePayload {
  readonly ok: true;
  readonly username: string;
  readonly usernameKey: string;
  readonly avatarCode: ValidAvatarCode;
}

export function validateProfileUpdatePayload(
  body: Record<string, unknown>
): ValidatedProfileUpdatePayload | ValidationFailure {
  const userRes = validateAuthUsername(body.username);
  if (userRes.ok === false) return userRes;

  const avatarRes = validateAvatarCode(body.avatarCode ?? 'portrait');
  if (avatarRes.ok === false) return avatarRes;

  return {
    ok: true,
    username: userRes.username,
    usernameKey: userRes.usernameKey,
    avatarCode: avatarRes.avatarCode,
  };
}
