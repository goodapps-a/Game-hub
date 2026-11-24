/**
 * Public DTOs and strict domain types for Eyvan Stage D1 (Friends & Online Presence).
 *
 * Security Invariant:
 * - Public social summaries NEVER contain `email`, `email_key`, password hashes,
 *   session IDs, IP hashes, tokens, internal account flags, or owner-only items.
 */

import type { PublicAppearanceSnapshot } from '../../../../src/platform/items/itemTypes';

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
  readonly accountCode?: string | null;
  readonly avatarCode: string;
  readonly avatarUrl: string | null;
  readonly onlineStatus: PresenceStatus;
  readonly relationshipStatus: RelationshipStatus;
  readonly friendshipId: string | null;
  readonly appearance?: PublicAppearanceSnapshot;
}

export interface FriendListItem {
  readonly friendshipId: string;
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly accountCode?: string | null;
  readonly avatarCode: string;
  readonly avatarUrl: string | null;
  readonly onlineStatus: PresenceStatus;
  readonly friendsSince: number;
  readonly appearance?: PublicAppearanceSnapshot;
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

export interface BlockedUserItem {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarCode: string;
  readonly avatarUrl: string | null;
  readonly blockedAt: number;
}

export interface PublicUserProfile {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly accountCode?: string | null;
  readonly avatarCode: string;
  readonly avatarUrl: string | null;
  readonly onlineStatus: PresenceStatus;
  readonly relationshipStatus: RelationshipStatus;
  readonly friendshipId: string | null;
  readonly stats: {
    readonly matchesPlayed: number;
    readonly wins: number;
    readonly losses: number;
  };
  readonly appearance?: PublicAppearanceSnapshot;
}

export interface ChatPartnerSummary {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarCode: string;
  readonly avatarUrl: string | null;
  readonly onlineStatus: PresenceStatus;
}

export interface ChatConversationItem {
  readonly conversationId: string;
  readonly partner: ChatPartnerSummary;
  readonly lastMessagePreview: string | null;
  readonly lastMessageAt: number | null;
  readonly unreadCount: number;
  readonly createdAt: number;
}

export interface ChatMessageItem {
  readonly messageId: string;
  readonly conversationId: string;
  readonly senderId: string;
  readonly kind: 'text' | 'system' | 'game_invite';
  readonly body: string;
  readonly clientMsgId: string | null;
  readonly createdAt: number;
}

export type GameInviteStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'canceled'
  | 'expired';

export interface GameInviteItem {
  readonly inviteId: string;
  readonly gameId: 'hokm';
  readonly roomCode: string;
  readonly status: GameInviteStatus;
  readonly direction: 'incoming' | 'outgoing';
  readonly otherUser: {
    readonly userId: string;
    readonly username: string;
    readonly displayName: string;
    readonly avatarCode: string;
    readonly avatarUrl: string | null;
  };
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly respondedAt: number | null;
}

export interface RoomInviteCheckSummary {
  readonly roomCode: string;
  readonly status: 'WAITING' | 'PLAYING' | 'FINISHED';
  readonly playerCount: number;
  readonly maxPlayers: number;
  readonly hostUsername: string | null;
  readonly playerUsernames?: readonly string[];
}

export type GameRoomLookupFn = (
  roomCode: string
) => Promise<RoomInviteCheckSummary | null>;

export type SocialErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN_ORIGIN'
  | 'CSRF_REJECTED'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'SELF_ACTION_FORBIDDEN'
  | 'ALREADY_FRIENDS'
  | 'NOT_FRIENDS'
  | 'REQUEST_ALREADY_SENT'
  | 'REQUEST_NOT_PENDING'
  | 'INVITE_ALREADY_PENDING'
  | 'INVITE_EXPIRED'
  | 'INVITE_NOT_PENDING'
  | 'ROOM_NOT_AVAILABLE'
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

export interface FriendGroupMemberSummary {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly accountCode?: string | null;
  readonly avatarCode: string;
  readonly avatarUrl: string | null;
  readonly role: 'owner' | 'member';
  readonly onlineStatus: PresenceStatus;
  readonly appearance?: PublicAppearanceSnapshot;
}

export interface FriendGroupSummary {
  readonly groupId: string;
  readonly name: string;
  readonly ownerUserId: string;
  readonly memberCount: number;
  readonly members: FriendGroupMemberSummary[];
  readonly lastMessagePreview: string | null;
  readonly lastMessageAt: number | null;
  readonly createdAt: number;
}

export interface GroupMessageItem {
  readonly messageId: string;
  readonly groupId: string;
  readonly senderId: string;
  readonly senderUsername: string;
  readonly senderDisplayName: string;
  readonly kind: 'text' | 'game_invite';
  readonly body: string;
  readonly roomCode: string | null;
  readonly gameId: string | null;
  readonly clientMsgId: string | null;
  readonly createdAt: number;
}
