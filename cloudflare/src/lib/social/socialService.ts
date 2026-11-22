/**
 * Core Social Service for Eyvan Stage D1: Friends System & Multi-Device Online Presence.
 * Shared 1:1 between Cloudflare Workers (D1) and Express (SQLite via SqliteD1Adapter).
 *
 * Design Guarantees:
 * - Every relationship & presence record is keyed strictly by permanent immutable `users.user_id`.
 * - Renaming a username NEVER breaks friendships, requests, or presence.
 * - Canonical `pair_key = min(a,b):max(a,b)` + `UNIQUE(pair_key)` makes duplicate requests/friendships impossible.
 * - Simultaneous mutual friend requests (`A->B` and `B->A`) atomically converge into one `accepted` friendship.
 * - Multi-device leased presence (`user_presence_sessions`, 75s TTL) guarantees zero fake online status:
 *   sudden disconnects expire automatically, explicit logout/tab-close clears only that device/session,
 *   and other active devices on the same account remain online.
 * - Strict privacy enforcement (`privacy_show_online`, `presence_preference`, `privacy_allow_friend_requests`)
 *   happens exclusively on the server.
 */

import { D1DatabaseLike } from '../types';
import { generatePrefixedId } from '../auth/crypto';
import {
  SOCIAL_FRIEND_MUTATION_USER_RATE_LIMIT,
  SOCIAL_FRIEND_REQUEST_USER_RATE_LIMIT,
  SOCIAL_PRESENCE_USER_RATE_LIMIT,
  SOCIAL_SEARCH_USER_RATE_LIMIT,
  consumeRateLimitSlot,
} from '../auth/rateLimit';
import {
  FriendListItem,
  FriendPresenceItem,
  FriendRequestItem,
  PresenceDeviceState,
  PresencePreference,
  PresenceStatus,
  RelationshipStatus,
  SocialErrorResult,
  SocialPrivacySettings,
  SocialRequestContext,
  SocialUserSummary,
} from './types';
import {
  buildCanonicalPairKey,
  escapeSqlLikePattern,
  validateDeviceId,
  validateFriendshipId,
  validatePagination,
  validatePresenceDeviceState,
  validatePrivacyUpdatePayload,
  validateUserId,
  validateUserSearchQuery,
} from './validation';

/** Online lease duration (75s = 2.5x the 30s client heartbeat interval). */
export const PRESENCE_LEASE_TTL_MS = 75_000;
export const DEFAULT_PRESENCE_PRUNE_BATCH_SIZE = 500;
export const DEFAULT_PRESENCE_PRUNE_MAX_BATCHES = 5;

function isUniqueConstraintError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE|SQLITE_CONSTRAINT/i.test(
    msg
  );
}

function resolveVisiblePresence(
  hasActiveSession: number | boolean,
  privacyShowOnline: number,
  presencePreference: string | null
): PresenceStatus {
  if (!hasActiveSession) return 'offline';
  if (privacyShowOnline !== 1) return 'offline';
  if (presencePreference === 'invisible') return 'offline';
  return 'online';
}

function buildDeviceSessionKey(authSessionId: string, deviceId: string): string {
  return `${authSessionId}:${deviceId}`;
}

interface SearchUserDbRow {
  user_id: string;
  username: string;
  display_name: string;
  avatar_code: string;
  avatar_url: string | null;
  privacy_show_online: number;
  presence_preference: string;
  friendship_id: string | null;
  friendship_status: string | null;
  requester_id: string | null;
  has_active_presence: number;
}

export type SearchUsersResult =
  | {
      readonly ok: true;
      readonly status: 200;
      readonly users: SocialUserSummary[];
      readonly limit: number;
      readonly offset: number;
      readonly hasMore: boolean;
    }
  | SocialErrorResult;

/**
 * Case-insensitive search across active verified central accounts by `username_key`.
 * Excludes self & blocked pairs, bounds pagination, enforces per-user rate limit,
 * and NEVER leaks sensitive account fields.
 */
export async function searchSocialUsers(
  db: D1DatabaseLike,
  rawQuery: unknown,
  rawLimit: unknown,
  rawOffset: unknown,
  ctx: SocialRequestContext
): Promise<SearchUsersResult> {
  const now = ctx.now ?? Date.now();
  const rl = await consumeRateLimitSlot(
    db,
    `social_search:user:${ctx.actorUserId}`,
    SOCIAL_SEARCH_USER_RATE_LIMIT,
    now
  );
  if (!rl.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'تعداد درخواست‌های جستجو بیش از حد مجاز است. لطفاً کمی بعد تلاش کنید.',
      retryAfterSec: rl.retryAfterSec,
    };
  }

  const validated = validateUserSearchQuery(rawQuery);
  if (validated.ok === false) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: validated.message,
    };
  }

  const { limit, offset } = validatePagination(rawLimit, rawOffset);
  const escaped = escapeSqlLikePattern(validated.queryKey);
  const containsPattern = `%${escaped}%`;
  const prefixPattern = `${escaped}%`;

  // Fetch limit + 1 to accurately compute `hasMore` without a second COUNT query
  const res = await db
    .prepare(
      `SELECT
         u.user_id,
         u.username,
         u.display_name,
         u.avatar_code,
         u.avatar_url,
         u.privacy_show_online,
         u.presence_preference,
         f.friendship_id,
         f.status AS friendship_status,
         f.requester_id,
         CASE
           WHEN EXISTS (
             SELECT 1
             FROM user_presence_sessions ups
             WHERE ups.user_id = u.user_id AND ups.expires_at > ?
           ) THEN 1
           ELSE 0
         END AS has_active_presence
       FROM users u
       LEFT JOIN friendships f
         ON f.pair_key = CASE
           WHEN ? < u.user_id THEN (? || ':' || u.user_id)
           ELSE (u.user_id || ':' || ?)
         END
       WHERE u.account_status = 'active'
         AND u.email_verified = 1
         AND u.user_id != ?
         AND u.username_key LIKE ? ESCAPE '\\'
         AND NOT EXISTS (
           SELECT 1
           FROM user_blocks ub
           WHERE (ub.blocker_id = ? AND ub.blocked_id = u.user_id)
              OR (ub.blocker_id = u.user_id AND ub.blocked_id = ?)
         )
       ORDER BY
         CASE
           WHEN u.username_key = ? THEN 0
           WHEN u.username_key LIKE ? ESCAPE '\\' THEN 1
           ELSE 2
         END ASC,
         u.username_key ASC
       LIMIT ? OFFSET ?`
    )
    .bind(
      now,
      ctx.actorUserId,
      ctx.actorUserId,
      ctx.actorUserId,
      ctx.actorUserId,
      containsPattern,
      ctx.actorUserId,
      ctx.actorUserId,
      validated.queryKey,
      prefixPattern,
      limit + 1,
      offset
    )
    .all<SearchUserDbRow>();

  const rows = res.results ?? [];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const users: SocialUserSummary[] = pageRows.map((row) => {
    let relationshipStatus: RelationshipStatus = 'none';
    let friendshipId: string | null = null;

    if (row.friendship_status === 'accepted') {
      relationshipStatus = 'friend';
      friendshipId = row.friendship_id;
    } else if (row.friendship_status === 'pending') {
      relationshipStatus =
        row.requester_id === ctx.actorUserId
          ? 'outgoing_pending'
          : 'incoming_pending';
      friendshipId = row.friendship_id;
    }

    // Privacy invariant: only accepted friends can observe real online presence
    const onlineStatus: PresenceStatus =
      relationshipStatus === 'friend'
        ? resolveVisiblePresence(
            row.has_active_presence === 1,
            row.privacy_show_online,
            row.presence_preference
          )
        : 'offline';

    return {
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      avatarCode: row.avatar_code,
      avatarUrl: row.avatar_url,
      onlineStatus,
      relationshipStatus,
      friendshipId,
    };
  });

  return {
    ok: true,
    status: 200,
    users,
    limit,
    offset,
    hasMore,
  };
}

interface TargetUserRow {
  user_id: string;
  account_status: string;
  email_verified: number;
  privacy_allow_friend_requests: number;
}

interface FriendshipRow {
  friendship_id: string;
  pair_key: string;
  requester_id: string;
  addressee_id: string;
  status: string;
}

export type SendFriendRequestResult =
  | {
      readonly ok: true;
      readonly status: 200 | 201;
      readonly outcome: 'request_sent' | 'auto_accepted';
      readonly friendshipId: string;
      readonly relationshipStatus: 'outgoing_pending' | 'friend';
      readonly message: string;
    }
  | SocialErrorResult;

/**
 * Sends a friend request from `ctx.actorUserId` to `targetUserId`.
 * - Rejects self-requests, blocked pairs, non-active accounts, duplicates, and privacy-disallowed targets.
 * - Handles simultaneous mutual requests atomically: if target already sent a pending request to actor,
 *   auto-accepts the mutual request into a single `accepted` friendship!
 */
export async function sendFriendRequest(
  db: D1DatabaseLike,
  rawTargetUserId: unknown,
  ctx: SocialRequestContext
): Promise<SendFriendRequestResult> {
  const now = ctx.now ?? Date.now();
  const rl = await consumeRateLimitSlot(
    db,
    `social_friend_req:user:${ctx.actorUserId}`,
    SOCIAL_FRIEND_REQUEST_USER_RATE_LIMIT,
    now
  );
  if (!rl.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'تعداد درخواست‌های دوستی بیش از حد مجاز است. لطفاً کمی صبر کنید.',
      retryAfterSec: rl.retryAfterSec,
    };
  }

  const targetValidated = validateUserId(rawTargetUserId, 'شناسه کاربر مقصد');
  if (targetValidated.ok === false) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: targetValidated.message,
    };
  }

  const targetUserId = targetValidated.userId;
  if (targetUserId === ctx.actorUserId) {
    return {
      ok: false,
      status: 400,
      code: 'SELF_ACTION_FORBIDDEN',
      message: 'امکان ارسال درخواست دوستی به خودتان وجود ندارد.',
    };
  }

  const targetUser = await db
    .prepare(
      `SELECT user_id, account_status, email_verified, privacy_allow_friend_requests
       FROM users
       WHERE user_id = ?
       LIMIT 1`
    )
    .bind(targetUserId)
    .first<TargetUserRow>();

  if (
    !targetUser ||
    targetUser.account_status !== 'active' ||
    targetUser.email_verified !== 1
  ) {
    return {
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      message: 'کاربر مورد نظر یافت نشد.',
    };
  }

  const blocked = await db
    .prepare(
      `SELECT 1 AS hit
       FROM user_blocks
       WHERE (blocker_id = ? AND blocked_id = ?)
          OR (blocker_id = ? AND blocked_id = ?)
       LIMIT 1`
    )
    .bind(ctx.actorUserId, targetUserId, targetUserId, ctx.actorUserId)
    .first<{ hit: number }>();

  if (blocked) {
    return {
      ok: false,
      status: 403,
      code: 'USER_BLOCKED',
      message: 'امکان ارسال درخواست دوستی به این کاربر وجود ندارد.',
    };
  }

  const pairKey = buildCanonicalPairKey(ctx.actorUserId, targetUserId);

  const handleExistingPair = async (
    existing: FriendshipRow
  ): Promise<SendFriendRequestResult> => {
    if (existing.status === 'accepted') {
      return {
        ok: false,
        status: 409,
        code: 'ALREADY_FRIENDS',
        message: 'شما هم‌اکنون با این کاربر دوست هستید.',
      };
    }

    if (existing.status === 'pending') {
      if (existing.requester_id === ctx.actorUserId) {
        return {
          ok: false,
          status: 409,
          code: 'REQUEST_ALREADY_SENT',
          message: 'درخواست دوستی شما قبلاً برای این کاربر ارسال شده است.',
        };
      }

      // Mutual simultaneous request: target already requested actor -> atomically accept!
      const acceptRes = await db
        .prepare(
          `UPDATE friendships
           SET status = 'accepted',
               responded_at = ?,
               updated_at = ?
           WHERE friendship_id = ?
             AND requester_id = ?
             AND addressee_id = ?
             AND status = 'pending'`
        )
        .bind(now, now, existing.friendship_id, targetUserId, ctx.actorUserId)
        .run();

      if (Number(acceptRes.meta?.changes ?? 0) > 0) {
        return {
          ok: true,
          status: 200,
          outcome: 'auto_accepted',
          friendshipId: existing.friendship_id,
          relationshipStatus: 'friend',
          message: 'درخواست دوستی متقابل شما به‌صورت خودکار تأیید شد و اکنون دوست هستید.',
        };
      }

      // Re-check if another concurrent request already accepted it
      const recheck = await db
        .prepare(`SELECT status FROM friendships WHERE friendship_id = ? LIMIT 1`)
        .bind(existing.friendship_id)
        .first<{ status: string }>();
      if (recheck?.status === 'accepted') {
        return {
          ok: true,
          status: 200,
          outcome: 'auto_accepted',
          friendshipId: existing.friendship_id,
          relationshipStatus: 'friend',
          message: 'درخواست دوستی متقابل شما تأیید شد و اکنون دوست هستید.',
        };
      }

      return {
        ok: false,
        status: 409,
        code: 'REQUEST_NOT_PENDING',
        message: 'وضعیت این درخواست تغییر کرده است. لطفاً دوباره بررسی کنید.',
      };
    }

    // Previously rejected or canceled -> check privacy before re-opening a fresh request
    if (targetUser.privacy_allow_friend_requests !== 1) {
      return {
        ok: false,
        status: 403,
        code: 'PRIVACY_RESTRICTED',
        message: 'این کاربر دریافت درخواست دوستی جدید را غیرفعال کرده است.',
      };
    }

    const reopenRes = await db
      .prepare(
        `UPDATE friendships
         SET requester_id = ?,
             addressee_id = ?,
             status = 'pending',
             created_at = ?,
             updated_at = ?,
             responded_at = NULL
         WHERE friendship_id = ?
           AND status IN ('rejected', 'canceled')`
      )
      .bind(ctx.actorUserId, targetUserId, now, now, existing.friendship_id)
      .run();

    if (Number(reopenRes.meta?.changes ?? 0) > 0) {
      return {
        ok: true,
        status: 201,
        outcome: 'request_sent',
        friendshipId: existing.friendship_id,
        relationshipStatus: 'outgoing_pending',
        message: 'درخواست دوستی ارسال شد.',
      };
    }

    return {
      ok: false,
      status: 409,
      code: 'REQUEST_ALREADY_SENT',
      message: 'درخواست دوستی برای این کاربر هم‌اکنون در حال پردازش است.',
    };
  };

  const existing = await db
    .prepare(
      `SELECT friendship_id, pair_key, requester_id, addressee_id, status
       FROM friendships
       WHERE pair_key = ?
       LIMIT 1`
    )
    .bind(pairKey)
    .first<FriendshipRow>();

  if (existing) {
    return handleExistingPair(existing);
  }

  if (targetUser.privacy_allow_friend_requests !== 1) {
    return {
      ok: false,
      status: 403,
      code: 'PRIVACY_RESTRICTED',
      message: 'این کاربر دریافت درخواست دوستی جدید را غیرفعال کرده است.',
    };
  }

  const friendshipId = generatePrefixedId('fr', 12);
  try {
    await db
      .prepare(
        `INSERT INTO friendships (
           friendship_id, pair_key, requester_id, addressee_id,
           status, created_at, updated_at, responded_at
         ) VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL)`
      )
      .bind(friendshipId, pairKey, ctx.actorUserId, targetUserId, now, now)
      .run();

    return {
      ok: true,
      status: 201,
      outcome: 'request_sent',
      friendshipId,
      relationshipStatus: 'outgoing_pending',
      message: 'درخواست دوستی ارسال شد.',
    };
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      // Concurrency recovery: another request for the same pair won the INSERT race
      const racedRow = await db
        .prepare(
          `SELECT friendship_id, pair_key, requester_id, addressee_id, status
           FROM friendships
           WHERE pair_key = ?
           LIMIT 1`
        )
        .bind(pairKey)
        .first<FriendshipRow>();
      if (racedRow) {
        return handleExistingPair(racedRow);
      }
    }
    throw err;
  }
}

export type FriendMutationResult =
  | {
      readonly ok: true;
      readonly status: 200;
      readonly friendshipId: string;
      readonly message: string;
    }
  | SocialErrorResult;

/**
 * Accepts an incoming pending friend request (strictly ONLY `addressee_id === actorUserId`).
 */
export async function acceptFriendRequest(
  db: D1DatabaseLike,
  rawFriendshipId: unknown,
  ctx: SocialRequestContext
): Promise<FriendMutationResult> {
  const now = ctx.now ?? Date.now();
  const rl = await consumeRateLimitSlot(
    db,
    `social_friend_mut:user:${ctx.actorUserId}`,
    SOCIAL_FRIEND_MUTATION_USER_RATE_LIMIT,
    now
  );
  if (!rl.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'تعداد عملیات بیش از حد مجاز است. لطفاً کمی صبر کنید.',
      retryAfterSec: rl.retryAfterSec,
    };
  }

  const validated = validateFriendshipId(rawFriendshipId);
  if (validated.ok === false) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: validated.message,
    };
  }

  const res = await db
    .prepare(
      `UPDATE friendships
       SET status = 'accepted',
           responded_at = ?,
           updated_at = ?
       WHERE friendship_id = ?
         AND addressee_id = ?
         AND status = 'pending'
         AND NOT EXISTS (
           SELECT 1
           FROM user_blocks ub
           WHERE (ub.blocker_id = friendships.requester_id AND ub.blocked_id = friendships.addressee_id)
              OR (ub.blocker_id = friendships.addressee_id AND ub.blocked_id = friendships.requester_id)
         )`
    )
    .bind(now, now, validated.friendshipId, ctx.actorUserId)
    .run();

  if (Number(res.meta?.changes ?? 0) === 0) {
    return {
      ok: false,
      status: 404,
      code: 'REQUEST_NOT_PENDING',
      message: 'درخواست دوستی در انتظار تأیید یافت نشد.',
    };
  }

  return {
    ok: true,
    status: 200,
    friendshipId: validated.friendshipId,
    message: 'درخواست دوستی پذیرفته شد.',
  };
}

/**
 * Rejects an incoming pending friend request (strictly ONLY `addressee_id === actorUserId`).
 */
export async function rejectFriendRequest(
  db: D1DatabaseLike,
  rawFriendshipId: unknown,
  ctx: SocialRequestContext
): Promise<FriendMutationResult> {
  const now = ctx.now ?? Date.now();
  const rl = await consumeRateLimitSlot(
    db,
    `social_friend_mut:user:${ctx.actorUserId}`,
    SOCIAL_FRIEND_MUTATION_USER_RATE_LIMIT,
    now
  );
  if (!rl.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'تعداد عملیات بیش از حد مجاز است. لطفاً کمی صبر کنید.',
      retryAfterSec: rl.retryAfterSec,
    };
  }

  const validated = validateFriendshipId(rawFriendshipId);
  if (validated.ok === false) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: validated.message,
    };
  }

  const res = await db
    .prepare(
      `UPDATE friendships
       SET status = 'rejected',
           responded_at = ?,
           updated_at = ?
       WHERE friendship_id = ?
         AND addressee_id = ?
         AND status = 'pending'`
    )
    .bind(now, now, validated.friendshipId, ctx.actorUserId)
    .run();

  if (Number(res.meta?.changes ?? 0) === 0) {
    return {
      ok: false,
      status: 404,
      code: 'REQUEST_NOT_PENDING',
      message: 'درخواست دوستی در انتظار پاسخ یافت نشد.',
    };
  }

  return {
    ok: true,
    status: 200,
    friendshipId: validated.friendshipId,
    message: 'درخواست دوستی رد شد.',
  };
}

/**
 * Cancels an outgoing pending friend request (strictly ONLY `requester_id === actorUserId`).
 */
export async function cancelFriendRequest(
  db: D1DatabaseLike,
  rawFriendshipId: unknown,
  ctx: SocialRequestContext
): Promise<FriendMutationResult> {
  const now = ctx.now ?? Date.now();
  const rl = await consumeRateLimitSlot(
    db,
    `social_friend_mut:user:${ctx.actorUserId}`,
    SOCIAL_FRIEND_MUTATION_USER_RATE_LIMIT,
    now
  );
  if (!rl.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'تعداد عملیات بیش از حد مجاز است. لطفاً کمی صبر کنید.',
      retryAfterSec: rl.retryAfterSec,
    };
  }

  const validated = validateFriendshipId(rawFriendshipId);
  if (validated.ok === false) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: validated.message,
    };
  }

  const res = await db
    .prepare(
      `UPDATE friendships
       SET status = 'canceled',
           responded_at = ?,
           updated_at = ?
       WHERE friendship_id = ?
         AND requester_id = ?
         AND status = 'pending'`
    )
    .bind(now, now, validated.friendshipId, ctx.actorUserId)
    .run();

  if (Number(res.meta?.changes ?? 0) === 0) {
    return {
      ok: false,
      status: 404,
      code: 'REQUEST_NOT_PENDING',
      message: 'درخواست ارسالی قابل لغو یافت نشد.',
    };
  }

  return {
    ok: true,
    status: 200,
    friendshipId: validated.friendshipId,
    message: 'درخواست دوستی لغو شد.',
  };
}

/**
 * Removes an accepted friendship atomically for BOTH sides (strictly requires actor to be a member).
 * Accepts either `targetUserId` or `friendshipId`.
 */
export async function removeFriend(
  db: D1DatabaseLike,
  body: Record<string, unknown>,
  ctx: SocialRequestContext
): Promise<FriendMutationResult> {
  const now = ctx.now ?? Date.now();
  const rl = await consumeRateLimitSlot(
    db,
    `social_friend_mut:user:${ctx.actorUserId}`,
    SOCIAL_FRIEND_MUTATION_USER_RATE_LIMIT,
    now
  );
  if (!rl.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'تعداد عملیات بیش از حد مجاز است. لطفاً کمی صبر کنید.',
      retryAfterSec: rl.retryAfterSec,
    };
  }

  let friendshipRow: { friendship_id: string } | null = null;

  if (body.targetUserId !== undefined) {
    const targetVal = validateUserId(body.targetUserId, 'شناسه دوست');
    if (targetVal.ok === false) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_INPUT',
        message: targetVal.message,
      };
    }
    if (targetVal.userId === ctx.actorUserId) {
      return {
        ok: false,
        status: 400,
        code: 'SELF_ACTION_FORBIDDEN',
        message: 'شناسه دوست نامعتبر است.',
      };
    }
    const pairKey = buildCanonicalPairKey(ctx.actorUserId, targetVal.userId);
    friendshipRow = await db
      .prepare(
        `SELECT friendship_id
         FROM friendships
         WHERE pair_key = ? AND status = 'accepted'
         LIMIT 1`
      )
      .bind(pairKey)
      .first<{ friendship_id: string }>();
  } else if (body.friendshipId !== undefined) {
    const frVal = validateFriendshipId(body.friendshipId);
    if (frVal.ok === false) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_INPUT',
        message: frVal.message,
      };
    }
    friendshipRow = await db
      .prepare(
        `SELECT friendship_id
         FROM friendships
         WHERE friendship_id = ?
           AND status = 'accepted'
           AND (requester_id = ? OR addressee_id = ?)
         LIMIT 1`
      )
      .bind(frVal.friendshipId, ctx.actorUserId, ctx.actorUserId)
      .first<{ friendship_id: string }>();
  } else {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'شناسه دوست یا شناسه دوستی الزامی است.',
    };
  }

  if (!friendshipRow) {
    return {
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      message: 'این کاربر در لیست دوستان شما نیست.',
    };
  }

  const delRes = await db
    .prepare(
      `DELETE FROM friendships
       WHERE friendship_id = ?
         AND status = 'accepted'
         AND (requester_id = ? OR addressee_id = ?)`
    )
    .bind(friendshipRow.friendship_id, ctx.actorUserId, ctx.actorUserId)
    .run();

  if (Number(delRes.meta?.changes ?? 0) === 0) {
    return {
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      message: 'این کاربر در لیست دوستان شما نیست.',
    };
  }

  return {
    ok: true,
    status: 200,
    friendshipId: friendshipRow.friendship_id,
    message: 'این کاربر از لیست دوستان شما حذف شد.',
  };
}

interface FriendListDbRow {
  friendship_id: string;
  friends_since: number;
  user_id: string;
  username: string;
  display_name: string;
  avatar_code: string;
  avatar_url: string | null;
  privacy_show_online: number;
  presence_preference: string;
  has_active_presence: number;
}

/**
 * Lists accepted friends for `actorUserId`, joined strictly via permanent `user_id`
 * and enriched with live privacy-respecting online/offline status.
 */
export async function listFriends(
  db: D1DatabaseLike,
  ctx: SocialRequestContext
): Promise<FriendListItem[]> {
  const now = ctx.now ?? Date.now();
  const res = await db
    .prepare(
      `SELECT
         f.friendship_id,
         COALESCE(f.responded_at, f.updated_at) AS friends_since,
         u.user_id,
         u.username,
         u.display_name,
         u.avatar_code,
         u.avatar_url,
         u.privacy_show_online,
         u.presence_preference,
         CASE
           WHEN EXISTS (
             SELECT 1
             FROM user_presence_sessions ups
             WHERE ups.user_id = u.user_id AND ups.expires_at > ?
           ) THEN 1
           ELSE 0
         END AS has_active_presence
       FROM friendships f
       INNER JOIN users u
         ON u.user_id = CASE
           WHEN f.requester_id = ? THEN f.addressee_id
           ELSE f.requester_id
         END
       WHERE f.status = 'accepted'
         AND (f.requester_id = ? OR f.addressee_id = ?)
         AND u.account_status = 'active'
         AND u.email_verified = 1
         AND NOT EXISTS (
           SELECT 1
           FROM user_blocks ub
           WHERE (ub.blocker_id = ? AND ub.blocked_id = u.user_id)
              OR (ub.blocker_id = u.user_id AND ub.blocked_id = ?)
         )
       ORDER BY has_active_presence DESC, u.username_key ASC`
    )
    .bind(
      now,
      ctx.actorUserId,
      ctx.actorUserId,
      ctx.actorUserId,
      ctx.actorUserId,
      ctx.actorUserId
    )
    .all<FriendListDbRow>();

  return (res.results ?? []).map((row) => ({
    friendshipId: row.friendship_id,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    avatarCode: row.avatar_code,
    avatarUrl: row.avatar_url,
    onlineStatus: resolveVisiblePresence(
      row.has_active_presence === 1,
      row.privacy_show_online,
      row.presence_preference
    ),
    friendsSince: row.friends_since,
  }));
}

interface FriendRequestDbRow {
  friendship_id: string;
  requester_id: string;
  addressee_id: string;
  created_at: number;
  updated_at: number;
  user_id: string;
  username: string;
  display_name: string;
  avatar_code: string;
  avatar_url: string | null;
}

/**
 * Lists incoming & outgoing pending friend requests for `actorUserId`, joined via `user_id`.
 * Privacy invariant: non-friends in pending requests always display `'offline'` until accepted.
 */
export async function listFriendRequests(
  db: D1DatabaseLike,
  ctx: SocialRequestContext
): Promise<{ incoming: FriendRequestItem[]; outgoing: FriendRequestItem[] }> {
  const res = await db
    .prepare(
      `SELECT
         f.friendship_id,
         f.requester_id,
         f.addressee_id,
         f.created_at,
         f.updated_at,
         u.user_id,
         u.username,
         u.display_name,
         u.avatar_code,
         u.avatar_url
       FROM friendships f
       INNER JOIN users u
         ON u.user_id = CASE
           WHEN f.requester_id = ? THEN f.addressee_id
           ELSE f.requester_id
         END
       WHERE f.status = 'pending'
         AND (f.requester_id = ? OR f.addressee_id = ?)
         AND u.account_status = 'active'
         AND u.email_verified = 1
         AND NOT EXISTS (
           SELECT 1
           FROM user_blocks ub
           WHERE (ub.blocker_id = ? AND ub.blocked_id = u.user_id)
              OR (ub.blocker_id = u.user_id AND ub.blocked_id = ?)
         )
       ORDER BY f.updated_at DESC`
    )
    .bind(
      ctx.actorUserId,
      ctx.actorUserId,
      ctx.actorUserId,
      ctx.actorUserId,
      ctx.actorUserId
    )
    .all<FriendRequestDbRow>();

  const incoming: FriendRequestItem[] = [];
  const outgoing: FriendRequestItem[] = [];

  for (const row of res.results ?? []) {
    const direction =
      row.addressee_id === ctx.actorUserId ? 'incoming' : 'outgoing';
    const item: FriendRequestItem = {
      friendshipId: row.friendship_id,
      direction,
      user: {
        userId: row.user_id,
        username: row.username,
        displayName: row.display_name,
        avatarCode: row.avatar_code,
        avatarUrl: row.avatar_url,
        onlineStatus: 'offline',
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    if (direction === 'incoming') {
      incoming.push(item);
    } else {
      outgoing.push(item);
    }
  }

  return { incoming, outgoing };
}

// ===========================================================================
// Multi-Device Online Presence (Low-Cost Cloudflare D1 Leased Heartbeat)
// ===========================================================================

export type PresenceHeartbeatResult =
  | {
      readonly ok: true;
      readonly status: 200;
      readonly onlineStatus: PresenceStatus;
      readonly deviceState: PresenceDeviceState;
      readonly expiresAt: number;
      readonly ttlMs: number;
    }
  | SocialErrorResult;

/**
 * Refreshes a single device's presence lease for `(authSessionId, deviceId)`.
 * Supports multiple concurrent devices per user account; when a user sets
 * `privacy_show_online = 0` or `presence_preference = 'invisible'`, friends see `offline`.
 */
export async function heartbeatPresence(
  db: D1DatabaseLike,
  rawDeviceId: unknown,
  rawState: unknown,
  ctx: SocialRequestContext
): Promise<PresenceHeartbeatResult> {
  const now = ctx.now ?? Date.now();
  const rl = await consumeRateLimitSlot(
    db,
    `social_presence:user:${ctx.actorUserId}`,
    SOCIAL_PRESENCE_USER_RATE_LIMIT,
    now
  );
  if (!rl.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'تعداد درخواست‌های به‌روزرسانی حضور بیش از حد مجاز است.',
      retryAfterSec: rl.retryAfterSec,
    };
  }

  const deviceVal = validateDeviceId(rawDeviceId);
  if (deviceVal.ok === false) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: deviceVal.message,
    };
  }

  const deviceState = validatePresenceDeviceState(rawState);
  const deviceSessionId = buildDeviceSessionKey(
    ctx.authSessionId,
    deviceVal.deviceId
  );
  const expiresAt = now + PRESENCE_LEASE_TTL_MS;

  await db
    .prepare(
      `INSERT INTO user_presence_sessions (
         device_session_id, user_id, auth_session_id, status,
         last_heartbeat_at, expires_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(device_session_id) DO UPDATE SET
         status = excluded.status,
         last_heartbeat_at = excluded.last_heartbeat_at,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`
    )
    .bind(
      deviceSessionId,
      ctx.actorUserId,
      ctx.authSessionId,
      deviceState,
      now,
      expiresAt,
      now
    )
    .run();

  const privacy = await getSocialPrivacySettings(db, ctx.actorUserId);
  const effectiveStatus: PresenceStatus =
    privacy && privacy.showOnlineStatus && privacy.presencePreference !== 'invisible'
      ? 'online'
      : 'offline';

  return {
    ok: true,
    status: 200,
    onlineStatus: effectiveStatus,
    deviceState,
    expiresAt,
    ttlMs: PRESENCE_LEASE_TTL_MS,
  };
}

/**
 * Immediately marks a specific device offline (called on tab close / pagehide).
 * Only deletes that specific `(authSessionId, deviceId)` lease so other active devices
 * on the same user account stay online!
 */
export async function markPresenceOffline(
  db: D1DatabaseLike,
  rawDeviceId: unknown,
  ctx: SocialRequestContext
): Promise<{ ok: true; status: 200 } | SocialErrorResult> {
  const deviceVal = validateDeviceId(rawDeviceId);
  if (deviceVal.ok === false) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: deviceVal.message,
    };
  }

  const deviceSessionId = buildDeviceSessionKey(
    ctx.authSessionId,
    deviceVal.deviceId
  );
  await db
    .prepare(
      `DELETE FROM user_presence_sessions
       WHERE device_session_id = ? AND user_id = ?`
    )
    .bind(deviceSessionId, ctx.actorUserId)
    .run();

  return { ok: true, status: 200 };
}

/**
 * Immediately clears presence rows tied to a single revoked auth session (logout).
 */
export async function clearPresenceForAuthSession(
  db: D1DatabaseLike,
  authSessionId: string
): Promise<void> {
  await db
    .prepare(`DELETE FROM user_presence_sessions WHERE auth_session_id = ?`)
    .bind(authSessionId)
    .run();
}

/**
 * Immediately clears ALL presence rows for a user (logout-all / password reset).
 */
export async function clearAllPresenceForUser(
  db: D1DatabaseLike,
  userId: string
): Promise<void> {
  await db
    .prepare(`DELETE FROM user_presence_sessions WHERE user_id = ?`)
    .bind(userId)
    .run();
}

interface FriendPresenceDbRow {
  user_id: string;
  privacy_show_online: number;
  presence_preference: string;
  has_active_presence: number;
}

/**
 * Lightweight poll returning live online/offline status strictly for accepted friends,
 * enforcing each friend's server-side privacy settings.
 */
export async function getFriendsPresence(
  db: D1DatabaseLike,
  ctx: SocialRequestContext
): Promise<FriendPresenceItem[]> {
  const now = ctx.now ?? Date.now();
  const res = await db
    .prepare(
      `SELECT
         u.user_id,
         u.privacy_show_online,
         u.presence_preference,
         CASE
           WHEN EXISTS (
             SELECT 1
             FROM user_presence_sessions ups
             WHERE ups.user_id = u.user_id AND ups.expires_at > ?
           ) THEN 1
           ELSE 0
         END AS has_active_presence
       FROM friendships f
       INNER JOIN users u
         ON u.user_id = CASE
           WHEN f.requester_id = ? THEN f.addressee_id
           ELSE f.requester_id
         END
       WHERE f.status = 'accepted'
         AND (f.requester_id = ? OR f.addressee_id = ?)
         AND u.account_status = 'active'
         AND u.email_verified = 1
         AND NOT EXISTS (
           SELECT 1
           FROM user_blocks ub
           WHERE (ub.blocker_id = ? AND ub.blocked_id = u.user_id)
              OR (ub.blocker_id = u.user_id AND ub.blocked_id = ?)
         )`
    )
    .bind(
      now,
      ctx.actorUserId,
      ctx.actorUserId,
      ctx.actorUserId,
      ctx.actorUserId,
      ctx.actorUserId
    )
    .all<FriendPresenceDbRow>();

  return (res.results ?? []).map((row) => ({
    userId: row.user_id,
    onlineStatus: resolveVisiblePresence(
      row.has_active_presence === 1,
      row.privacy_show_online,
      row.presence_preference
    ),
  }));
}

/**
 * Bounded batch pruning of expired `user_presence_sessions` rows for Cloudflare Cron Trigger
 * and Express periodic maintenance.
 */
export async function pruneExpiredPresenceSessionsBatched(
  db: D1DatabaseLike,
  options?: { now?: number; batchSize?: number; maxBatches?: number }
): Promise<{ deleted: number; batchesRun: number }> {
  const now = options?.now ?? Date.now();
  const batchSize = Math.max(
    1,
    Math.min(5000, Math.floor(options?.batchSize ?? DEFAULT_PRESENCE_PRUNE_BATCH_SIZE))
  );
  const maxBatches = Math.max(
    1,
    Math.min(20, Math.floor(options?.maxBatches ?? DEFAULT_PRESENCE_PRUNE_MAX_BATCHES))
  );

  let totalDeleted = 0;
  let batchesRun = 0;

  for (let i = 0; i < maxBatches; i += 1) {
    const res = await db
      .prepare(
        `DELETE FROM user_presence_sessions
         WHERE device_session_id IN (
           SELECT device_session_id
           FROM user_presence_sessions
           WHERE expires_at <= ?
           ORDER BY expires_at ASC
           LIMIT ?
         )`
      )
      .bind(now, batchSize)
      .run();
    const deleted = Number(res.meta?.changes ?? 0);
    batchesRun += 1;
    totalDeleted += deleted;
    if (deleted < batchSize) break;
  }

  return { deleted: totalDeleted, batchesRun };
}

// ===========================================================================
// Server-Enforced Social Privacy Controls (uses existing 0004 `users` columns)
// ===========================================================================

interface PrivacyRow {
  privacy_show_online: number;
  privacy_allow_friend_requests: number;
  presence_preference: PresencePreference;
}

export async function getSocialPrivacySettings(
  db: D1DatabaseLike,
  userId: string
): Promise<SocialPrivacySettings | null> {
  const row = await db
    .prepare(
      `SELECT privacy_show_online, privacy_allow_friend_requests, presence_preference
       FROM users
       WHERE user_id = ?
       LIMIT 1`
    )
    .bind(userId)
    .first<PrivacyRow>();

  if (!row) return null;
  return {
    showOnlineStatus: row.privacy_show_online === 1,
    allowFriendRequests: row.privacy_allow_friend_requests === 1,
    presencePreference: row.presence_preference ?? 'online',
  };
}

export type UpdatePrivacyResult =
  | {
      readonly ok: true;
      readonly status: 200;
      readonly privacy: SocialPrivacySettings;
      readonly message: string;
    }
  | SocialErrorResult;

export async function updateSocialPrivacySettings(
  db: D1DatabaseLike,
  body: Record<string, unknown>,
  ctx: SocialRequestContext
): Promise<UpdatePrivacyResult> {
  const now = ctx.now ?? Date.now();
  const rl = await consumeRateLimitSlot(
    db,
    `social_friend_mut:user:${ctx.actorUserId}`,
    SOCIAL_FRIEND_MUTATION_USER_RATE_LIMIT,
    now
  );
  if (!rl.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'تعداد تغییرات تنظیمات بیش از حد مجاز است. لطفاً کمی صبر کنید.',
      retryAfterSec: rl.retryAfterSec,
    };
  }

  const validated = validatePrivacyUpdatePayload(body);
  if (validated.ok === false) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: validated.message,
    };
  }

  const current = await getSocialPrivacySettings(db, ctx.actorUserId);
  if (!current) {
    return {
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      message: 'حساب کاربری یافت نشد.',
    };
  }

  const nextShowOnline =
    validated.showOnlineStatus !== undefined
      ? validated.showOnlineStatus
      : current.showOnlineStatus;
  const nextAllowRequests =
    validated.allowFriendRequests !== undefined
      ? validated.allowFriendRequests
      : current.allowFriendRequests;
  const nextPresencePref =
    validated.presencePreference !== undefined
      ? validated.presencePreference
      : current.presencePreference;

  await db
    .prepare(
      `UPDATE users
       SET privacy_show_online = ?,
           privacy_allow_friend_requests = ?,
           presence_preference = ?,
           updated_at = ?
       WHERE user_id = ?`
    )
    .bind(
      nextShowOnline ? 1 : 0,
      nextAllowRequests ? 1 : 0,
      nextPresencePref,
      now,
      ctx.actorUserId
    )
    .run();

  return {
    ok: true,
    status: 200,
    privacy: {
      showOnlineStatus: nextShowOnline,
      allowFriendRequests: nextAllowRequests,
      presencePreference: nextPresencePref,
    },
    message: 'تنظیمات حریم خصوصی ذخیره شد.',
  };
}
