/**
 * Strict input validation for Eyvan Stage D1 (Friends & Online Presence).
 * Blocks malformed IDs, SQL LIKE wildcard abuse, control characters, and out-of-range pagination.
 */

import { PresenceDeviceState, PresencePreference } from './types';

const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;
const USER_ID_RE = /^usr_[a-zA-Z0-9_-]{6,64}$/;
const FRIENDSHIP_ID_RE = /^fr_[a-zA-Z0-9_-]{6,64}$/;
const DEVICE_ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;
const SEARCH_QUERY_RE = /^[a-zA-Z0-9_.]{2,20}$/;

const VALID_DEVICE_STATES = new Set<PresenceDeviceState>(['online', 'away', 'busy']);
const VALID_PRESENCE_PREFS = new Set<PresencePreference>([
  'online',
  'away',
  'invisible',
]);

export interface ValidationFailure {
  readonly ok: false;
  readonly message: string;
}

export function validateUserSearchQuery(
  rawQuery: unknown
): { ok: true; queryKey: string; rawClean: string } | ValidationFailure {
  if (typeof rawQuery !== 'string') {
    return { ok: false, message: 'عبارت جستجو الزامی است.' };
  }
  const trimmed = rawQuery.trim();
  if (trimmed.length < 2) {
    return {
      ok: false,
      message: 'برای جستجو حداقل ۲ کاراکتر انگلیسی وارد کنید.',
    };
  }
  if (
    trimmed.length > 20 ||
    CONTROL_CHAR_RE.test(trimmed) ||
    !SEARCH_QUERY_RE.test(trimmed) ||
    !/[a-zA-Z0-9]/.test(trimmed)
  ) {
    return {
      ok: false,
      message: 'عبارت جستجو باید شامل حداقل یک حرف انگلیسی یا عدد باشد.',
    };
  }
  return {
    ok: true,
    rawClean: trimmed,
    queryKey: trimmed.toLowerCase(),
  };
}

/**
 * Escapes SQL LIKE wildcards (`%`, `_`, `\`) so user input like `_` matches literal underscores.
 */
export function escapeSqlLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function validatePagination(
  rawLimit: unknown,
  rawOffset: unknown,
  defaults = { limit: 15, maxLimit: 25, maxOffset: 500 }
): { limit: number; offset: number } {
  const parsedLimit = Number(rawLimit);
  const parsedOffset = Number(rawOffset);
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(defaults.maxLimit, Math.floor(parsedLimit)))
    : defaults.limit;
  const offset = Number.isFinite(parsedOffset)
    ? Math.max(0, Math.min(defaults.maxOffset, Math.floor(parsedOffset)))
    : 0;
  return { limit, offset };
}

export function validateUserId(
  raw: unknown,
  fieldLabel = 'شناسه کاربر'
): { ok: true; userId: string } | ValidationFailure {
  if (typeof raw !== 'string') {
    return { ok: false, message: `${fieldLabel} نامعتبر است.` };
  }
  const cleaned = raw.trim();
  if (!USER_ID_RE.test(cleaned)) {
    return { ok: false, message: `${fieldLabel} نامعتبر است.` };
  }
  return { ok: true, userId: cleaned };
}

export function validateFriendshipId(
  raw: unknown
): { ok: true; friendshipId: string } | ValidationFailure {
  if (typeof raw !== 'string') {
    return { ok: false, message: 'شناسه درخواست دوستی نامعتبر است.' };
  }
  const cleaned = raw.trim();
  if (!FRIENDSHIP_ID_RE.test(cleaned)) {
    return { ok: false, message: 'شناسه درخواست دوستی نامعتبر است.' };
  }
  return { ok: true, friendshipId: cleaned };
}

export function validateDeviceId(
  raw: unknown
): { ok: true; deviceId: string } | ValidationFailure {
  if (typeof raw !== 'string') {
    return { ok: false, message: 'شناسه دستگاه نامعتبر است.' };
  }
  const cleaned = raw.trim();
  if (!DEVICE_ID_RE.test(cleaned)) {
    return { ok: false, message: 'شناسه دستگاه نامعتبر است.' };
  }
  return { ok: true, deviceId: cleaned };
}

export function validatePresenceDeviceState(
  raw: unknown
): PresenceDeviceState {
  if (typeof raw === 'string' && VALID_DEVICE_STATES.has(raw as PresenceDeviceState)) {
    return raw as PresenceDeviceState;
  }
  return 'online';
}

export function validatePrivacyUpdatePayload(
  body: Record<string, unknown>
):
  | {
      ok: true;
      showOnlineStatus?: boolean;
      allowFriendRequests?: boolean;
      presencePreference?: PresencePreference;
    }
  | ValidationFailure {
  let hasAny = false;
  let showOnlineStatus: boolean | undefined;
  let allowFriendRequests: boolean | undefined;
  let presencePreference: PresencePreference | undefined;

  if (body.showOnlineStatus !== undefined) {
    if (typeof body.showOnlineStatus !== 'boolean') {
      return { ok: false, message: 'مقدار تنظیم نمایش وضعیت آنلاین نامعتبر است.' };
    }
    showOnlineStatus = body.showOnlineStatus;
    hasAny = true;
  }

  if (body.allowFriendRequests !== undefined) {
    if (typeof body.allowFriendRequests !== 'boolean') {
      return { ok: false, message: 'مقدار تنظیم پذیرش درخواست دوستی نامعتبر است.' };
    }
    allowFriendRequests = body.allowFriendRequests;
    hasAny = true;
  }

  if (body.presencePreference !== undefined) {
    if (
      typeof body.presencePreference !== 'string' ||
      !VALID_PRESENCE_PREFS.has(body.presencePreference as PresencePreference)
    ) {
      return { ok: false, message: 'حالت حضور انتخاب‌شده نامعتبر است.' };
    }
    presencePreference = body.presencePreference as PresencePreference;
    hasAny = true;
  }

  if (!hasAny) {
    return { ok: false, message: 'حداقل یک تنظیم حریم خصوصی باید ارسال شود.' };
  }

  return {
    ok: true,
    showOnlineStatus,
    allowFriendRequests,
    presencePreference,
  };
}

export function buildCanonicalPairKey(userIdA: string, userIdB: string): string {
  return userIdA < userIdB ? `${userIdA}:${userIdB}` : `${userIdB}:${userIdA}`;
}
