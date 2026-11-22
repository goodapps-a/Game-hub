/**
 * Client-side API wrapper for Eyvan Stage D1 Social & Online Presence (`/api/social/*`).
 *
 * Security & Privacy Invariants:
 * - Relies strictly on server-verified HttpOnly cookie (`eyvan_auth_sess`) via `credentials: 'include'`.
 * - Sends `X-Requested-With: eyvan-client` + `Content-Type: application/json` on every mutating POST.
 * - Uses per-tab ephemeral `deviceId` (stored only in `sessionStorage`, never a credential) so multiple
 *   tabs/devices on the same account manage independent presence leases accurately.
 */

import { buildOnlineHttpUrl } from '../../games/hokm/online/client';

export type PresenceStatus = 'online' | 'offline';
export type PresenceDeviceState = 'online' | 'away' | 'busy';
export type PresencePreference = 'online' | 'away' | 'invisible';

export type RelationshipStatus =
  | 'none'
  | 'friend'
  | 'outgoing_pending'
  | 'incoming_pending'
  | 'blocked';

export interface SocialUserSummary {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarCode: string;
  readonly avatarUrl: string | null;
  readonly onlineStatus: PresenceStatus;
  readonly relationshipStatus: RelationshipStatus;
  readonly friendshipId: string | null;
}

export interface FriendListItem {
  readonly friendshipId: string;
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarCode: string;
  readonly avatarUrl: string | null;
  readonly onlineStatus: PresenceStatus;
  readonly friendsSince: number;
}

export interface FriendRequestItem {
  readonly friendshipId: string;
  readonly direction: 'incoming' | 'outgoing';
  readonly user: {
    readonly userId: string;
    readonly username: string;
    readonly displayName: string;
    readonly avatarCode: string;
    readonly avatarUrl: string | null;
    readonly onlineStatus: PresenceStatus;
  };
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface FriendPresenceItem {
  readonly userId: string;
  readonly onlineStatus: PresenceStatus;
}

export interface SocialPrivacySettings {
  readonly showOnlineStatus: boolean;
  readonly allowFriendRequests: boolean;
  readonly presencePreference: PresencePreference;
}

export interface SocialSearchResponse {
  readonly ok: boolean;
  readonly users?: SocialUserSummary[];
  readonly limit?: number;
  readonly offset?: number;
  readonly hasMore?: boolean;
  readonly code?: string;
  readonly message?: string;
}

export interface SocialFriendsListResponse {
  readonly ok: boolean;
  readonly friends?: FriendListItem[];
  readonly code?: string;
  readonly message?: string;
}

export interface SocialRequestsListResponse {
  readonly ok: boolean;
  readonly incoming?: FriendRequestItem[];
  readonly outgoing?: FriendRequestItem[];
  readonly code?: string;
  readonly message?: string;
}

export interface SocialMutationResponse {
  readonly ok: boolean;
  readonly outcome?: 'request_sent' | 'auto_accepted';
  readonly friendshipId?: string;
  readonly relationshipStatus?: RelationshipStatus;
  readonly code?: string;
  readonly message?: string;
}

export interface SocialPresenceHeartbeatResponse {
  readonly ok: boolean;
  readonly onlineStatus?: PresenceStatus;
  readonly deviceState?: PresenceDeviceState;
  readonly expiresAt?: number;
  readonly ttlMs?: number;
  readonly code?: string;
  readonly message?: string;
}

export interface SocialFriendsPresenceResponse {
  readonly ok: boolean;
  readonly presence?: FriendPresenceItem[];
  readonly serverTime?: number;
  readonly code?: string;
  readonly message?: string;
}

export interface SocialPrivacyResponse {
  readonly ok: boolean;
  readonly privacy?: SocialPrivacySettings;
  readonly code?: string;
  readonly message?: string;
}

const DEVICE_ID_STORAGE_KEY = 'eyvan_presence_device_id';
let memoryFallbackDeviceId: string | null = null;

function generateTabDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return `dev_${hex}`;
  }
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Returns a stable per-tab device identifier (`dev_...`) for multi-device presence leases.
 */
export function getOrCreateTabDeviceId(): string {
  if (typeof window !== 'undefined') {
    try {
      const existing = window.sessionStorage.getItem(DEVICE_ID_STORAGE_KEY);
      if (existing && /^dev_[A-Za-z0-9_-]{8,48}$/.test(existing)) {
        return existing;
      }
      const next = generateTabDeviceId();
      window.sessionStorage.setItem(DEVICE_ID_STORAGE_KEY, next);
      return next;
    } catch {
      // Fall back to in-memory tab identifier if sessionStorage is restricted
    }
  }
  if (!memoryFallbackDeviceId) {
    memoryFallbackDeviceId = generateTabDeviceId();
  }
  return memoryFallbackDeviceId;
}

async function parseSocialJson<T>(res: Response, fallbackMsg: string): Promise<T> {
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.toLowerCase().includes('application/json')) {
    throw new Error(fallbackMsg);
  }
  return (await res.json()) as T;
}

export async function searchSocialUsersRequest(
  q: string,
  limit = 15,
  offset = 0,
  signal?: AbortSignal
): Promise<SocialSearchResponse> {
  const params = new URLSearchParams({
    q,
    limit: String(limit),
    offset: String(offset),
  });
  const res = await fetch(
    buildOnlineHttpUrl(`/api/social/users/search?${params.toString()}`),
    {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal,
    }
  );
  return parseSocialJson<SocialSearchResponse>(
    res,
    'خطا در جستجوی کاربران روی سرور.'
  );
}

export async function fetchFriendsRequest(
  signal?: AbortSignal
): Promise<SocialFriendsListResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/social/friends'), {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  });
  return parseSocialJson<SocialFriendsListResponse>(
    res,
    'خطا در دریافت لیست دوستان.'
  );
}

export async function fetchFriendRequestsRequest(
  signal?: AbortSignal
): Promise<SocialRequestsListResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/social/friends/requests'), {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  });
  return parseSocialJson<SocialRequestsListResponse>(
    res,
    'خطا در دریافت درخواست‌های دوستی.'
  );
}

export async function sendFriendRequestApi(
  targetUserId: string
): Promise<SocialMutationResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/social/friends/request'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify({ targetUserId }),
  });
  return parseSocialJson<SocialMutationResponse>(
    res,
    'خطا در ارسال درخواست دوستی.'
  );
}

export async function acceptFriendRequestApi(
  friendshipId: string
): Promise<SocialMutationResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/social/friends/accept'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify({ friendshipId }),
  });
  return parseSocialJson<SocialMutationResponse>(
    res,
    'خطا در پذیرش درخواست دوستی.'
  );
}

export async function rejectFriendRequestApi(
  friendshipId: string
): Promise<SocialMutationResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/social/friends/reject'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify({ friendshipId }),
  });
  return parseSocialJson<SocialMutationResponse>(
    res,
    'خطا در رد کردن درخواست دوستی.'
  );
}

export async function cancelFriendRequestApi(
  friendshipId: string
): Promise<SocialMutationResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/social/friends/cancel'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify({ friendshipId }),
  });
  return parseSocialJson<SocialMutationResponse>(
    res,
    'خطا در لغو درخواست دوستی.'
  );
}

export async function removeFriendApi(
  targetUserId: string
): Promise<SocialMutationResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/social/friends/remove'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify({ targetUserId }),
  });
  return parseSocialJson<SocialMutationResponse>(
    res,
    'خطا در حذف دوستی.'
  );
}

export async function sendPresenceHeartbeat(
  deviceId: string,
  state: PresenceDeviceState = 'online'
): Promise<SocialPresenceHeartbeatResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/social/presence/heartbeat'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify({ deviceId, state }),
  });
  return parseSocialJson<SocialPresenceHeartbeatResponse>(
    res,
    'خطا در به‌روزرسانی وضعیت حضور.'
  );
}

/**
 * Sends a best-effort `keepalive` offline signal when the user closes a tab or logs out.
 */
export function sendPresenceOffline(deviceId: string): Promise<void> {
  return fetch(buildOnlineHttpUrl('/api/social/presence/offline'), {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify({ deviceId }),
  })
    .then(() => undefined)
    .catch(() => undefined);
}

export async function fetchFriendsPresenceRequest(
  signal?: AbortSignal
): Promise<SocialFriendsPresenceResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/social/presence/friends'), {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  });
  return parseSocialJson<SocialFriendsPresenceResponse>(
    res,
    'خطا در دریافت وضعیت آنلاین دوستان.'
  );
}

export async function fetchSocialPrivacyRequest(
  signal?: AbortSignal
): Promise<SocialPrivacyResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/social/privacy'), {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  });
  return parseSocialJson<SocialPrivacyResponse>(
    res,
    'خطا در دریافت تنظیمات حریم خصوصی.'
  );
}

export async function updateSocialPrivacyRequest(payload: {
  showOnlineStatus?: boolean;
  allowFriendRequests?: boolean;
  presencePreference?: PresencePreference;
}): Promise<SocialPrivacyResponse> {
  const res = await fetch(buildOnlineHttpUrl('/api/social/privacy'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    },
    body: JSON.stringify(payload),
  });
  return parseSocialJson<SocialPrivacyResponse>(
    res,
    'خطا در ذخیره تنظیمات حریم خصوصی.'
  );
}
