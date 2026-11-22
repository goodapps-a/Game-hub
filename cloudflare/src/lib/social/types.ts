/**
 * Public DTOs and strict domain types for Eyvan Stage D1 (Friends & Online Presence).
 *
 * Security Invariant:
 * - Public social summaries NEVER contain `email`, `email_key`, password hashes,
 *   session IDs, IP hashes, tokens, or internal account flags.
 */

export type FriendshipStatus = 'pending' | 'accepted' | 'rejected' | 'canceled';

export type RelationshipStatus =
  | 'none'
  | 'friend'
  | 'outgoing_pending'
  | 'incoming_pending'
  | 'blocked';

export type PresenceStatus = 'online' | 'offline';
export type PresenceDeviceState = 'online' | 'away' | 'busy';
export type PresencePreference = 'online' | 'away' | 'invisible';

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

export interface SocialRequestContext {
  readonly actorUserId: string;
  readonly authSessionId: string;
  readonly clientIp: string;
  readonly now?: number;
}

export type SocialErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN_ORIGIN'
  | 'CSRF_REJECTED'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'SELF_ACTION_FORBIDDEN'
  | 'ALREADY_FRIENDS'
  | 'REQUEST_ALREADY_SENT'
  | 'REQUEST_NOT_PENDING'
  | 'PRIVACY_RESTRICTED'
  | 'USER_BLOCKED'
  | 'RATE_LIMITED'
  | 'DATABASE_ERROR';

export interface SocialErrorResult {
  readonly ok: false;
  readonly status: number;
  readonly code: SocialErrorCode;
  readonly message: string;
  readonly retryAfterSec?: number;
}
