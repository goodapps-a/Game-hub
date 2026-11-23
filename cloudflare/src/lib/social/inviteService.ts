/**
 * Stage D3 — Real-Room Game Invitation Service for Eyvan (Hokm Online).
 * Shared 1:1 between Cloudflare Workers (D1 + HOKM_ROOM DO) and Express (SQLite + HokmRoomManager).
 *
 * Security & Integrity Guarantees:
 * - Invites are strictly bound to REAL active Hokm rooms verified via `roomLookup(roomCode)`:
 *   * Room MUST exist, MUST be in `WAITING` status, and MUST have open seats (`playerCount < maxPlayers`).
 *   * Inviter MUST be an active participant seated inside that room (prevents forged room invites).
 * - Inviter and invitee MUST be accepted, active, non-blocked friends.
 * - Duplicate pending invites for the same `(room_code, inviter_id, invitee_id)` are deduplicated
 *   cleanly (idempotent reconnect/retry behavior).
 * - Invites have a strict server-side TTL (default 5 minutes) and auto-expire.
 * - Accept / Decline / Cancel use atomic `WHERE status = 'pending'` updates so concurrent clicks
 *   never produce duplicate transitions.
 * - Accepting an invite re-verifies that the live room is STILL open & `WAITING` before returning
 *   the verified `roomCode` for real one-click room join.
 */

import { sanitizeRoomCode } from '../../../../src/games/hokm/online/protocol';
import { generatePrefixedId } from '../auth/crypto';
import {
  RateLimitPolicy,
  SOCIAL_FRIEND_MUTATION_USER_RATE_LIMIT,
  consumeRateLimitSlot,
} from '../auth/rateLimit';
import { D1DatabaseLike } from '../types';
import {
  GameInviteItem,
  GameInviteStatus,
  GameRoomLookupFn,
  SocialErrorResult,
  SocialRequestContext,
} from './types';
import { buildCanonicalPairKey, validateTargetUserId } from './validation';

export const DEFAULT_GAME_INVITE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const INVITE_ID_RE = /^inv_[a-zA-Z0-9_-]{8,64}$/;

export const GAME_INVITE_USER_RATE_LIMIT: RateLimitPolicy = {
  action: 'game_invite_user',
  maxAttempts: 15,
  windowMs: 5 * 60 * 1000,
  blockMs: 5 * 60 * 1000,
};

function isUniqueConstraintError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(msg);
}

async function isBlockedEitherWay(
  db: D1DatabaseLike,
  userA: string,
  userB: string
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS hit
       FROM user_blocks
       WHERE (blocker_id = ? AND blocked_id = ?)
          OR (blocker_id = ? AND blocked_id = ?)
       LIMIT 1`
    )
    .bind(userA, userB, userB, userA)
    .first<{ hit: number }>();
  return Boolean(row);
}

async function areAcceptedFriends(
  db: D1DatabaseLike,
  userA: string,
  userB: string
): Promise<boolean> {
  const pairKey = buildCanonicalPairKey(userA, userB);
  const row = await db
    .prepare(
      `SELECT 1 AS hit
       FROM friendships
       WHERE pair_key = ? AND status = 'accepted'
       LIMIT 1`
    )
    .bind(pairKey)
    .first<{ hit: number }>();
  return Boolean(row);
}

async function expireStaleInvitesForUser(
  db: D1DatabaseLike,
  userId: string,
  now: number
): Promise<void> {
  await db
    .prepare(
      `UPDATE game_invites
       SET status = 'expired', updated_at = ?
       WHERE status = 'pending'
         AND expires_at <= ?
         AND (inviter_id = ? OR invitee_id = ?)`
    )
    .bind(now, now, userId, userId)
    .run();
}

export type CreateGameInviteResult =
  | {
      readonly ok: true;
      readonly status: number;
      readonly invite: GameInviteItem;
      readonly deduplicated: boolean;
      readonly message: string;
    }
  | SocialErrorResult;

/**
 * Creates a real-room game invitation from `ctx.actorUserId` to an accepted non-blocked friend.
 */
export async function createGameInvite(
  db: D1DatabaseLike,
  payload: Record<string, unknown>,
  roomLookup: GameRoomLookupFn,
  ctx: SocialRequestContext
): Promise<CreateGameInviteResult> {
  const now = ctx.now ?? Date.now();
  const targetVal = validateTargetUserId(payload.targetUserId);
  if (targetVal.ok === false) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: targetVal.message,
    };
  }

  const targetUserId = targetVal.userId;
  if (targetUserId === ctx.actorUserId) {
    return {
      ok: false,
      status: 400,
      code: 'SELF_ACTION_FORBIDDEN',
      message: 'امکان دعوت کردن خودتان به اتاق وجود ندارد.',
    };
  }

  const roomCode = sanitizeRoomCode(payload.roomCode);
  if (!roomCode) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'کد اتاق بازی معتبر نیست.',
    };
  }

  const gameId = payload.gameId === undefined ? 'hokm' : payload.gameId;
  if (gameId !== 'hokm') {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'در حال حاضر فقط دعوت به بازی حکم آنلاین پشتیبانی می‌شود.',
    };
  }

  const [blocked, friends, actorRow, targetRow] = await Promise.all([
    isBlockedEitherWay(db, ctx.actorUserId, targetUserId),
    areAcceptedFriends(db, ctx.actorUserId, targetUserId),
    db
      .prepare(
        `SELECT user_id, username
         FROM users
         WHERE user_id = ? AND account_status = 'active' AND email_verified = 1
         LIMIT 1`
      )
      .bind(ctx.actorUserId)
      .first<{ user_id: string; username: string }>(),
    db
      .prepare(
        `SELECT user_id, username, display_name, avatar_code, avatar_url
         FROM users
         WHERE user_id = ? AND account_status = 'active' AND email_verified = 1
         LIMIT 1`
      )
      .bind(targetUserId)
      .first<{
        user_id: string;
        username: string;
        display_name: string;
        avatar_code: string;
        avatar_url: string | null;
      }>(),
  ]);

  if (blocked) {
    return {
      ok: false,
      status: 403,
      code: 'USER_BLOCKED',
      message: 'امکان ارسال دعوت به این کاربر به دلیل مسدودیت وجود ندارد.',
    };
  }

  if (!friends) {
    return {
      ok: false,
      status: 403,
      code: 'NOT_FRIENDS',
      message: 'ارسال دعوت بازی فقط برای دوستان تأییدشده مجاز است.',
    };
  }

  if (!actorRow || !targetRow) {
    return {
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      message: 'کاربر مورد نظر یافت نشد.',
    };
  }

  // Verify REAL live Hokm room state
  const roomSummary = await roomLookup(roomCode);
  if (!roomSummary) {
    return {
      ok: false,
      status: 404,
      code: 'ROOM_NOT_AVAILABLE',
      message: 'اتاق بازی با این کد فعال نیست یا بسته شده است.',
    };
  }

  if (roomSummary.status !== 'WAITING') {
    return {
      ok: false,
      status: 409,
      code: 'ROOM_NOT_AVAILABLE',
      message: 'این اتاق در حال بازی یا پایان‌یافته است و امکان دعوت وجود ندارد.',
    };
  }

  if (roomSummary.playerCount >= roomSummary.maxPlayers) {
    return {
      ok: false,
      status: 409,
      code: 'ROOM_NOT_AVAILABLE',
      message: 'ظرفیت این اتاق تکمیل شده است.',
    };
  }

  // Verify inviter is actually seated/host in this room
  const actorLower = actorRow.username.trim().toLowerCase();
  const hostLower = roomSummary.hostUsername?.trim().toLowerCase() ?? '';
  const seatLowers = (roomSummary.playerUsernames ?? []).map((u) =>
    u.trim().toLowerCase()
  );
  const inviterInRoom =
    hostLower === actorLower ||
    (seatLowers.length > 0 && seatLowers.includes(actorLower));

  if (!inviterInRoom) {
    return {
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'فقط بازیکن حاضر در اتاق می‌تواند دوستان را به آن دعوت کند.',
    };
  }

  const fetchExistingLivePending = async () =>
    db
      .prepare(
        `SELECT invite_id, game_id, room_code, status, created_at, expires_at, responded_at
         FROM game_invites
         WHERE room_code = ?
           AND inviter_id = ?
           AND invitee_id = ?
           AND status = 'pending'
           AND expires_at > ?
         LIMIT 1`
      )
      .bind(roomCode, ctx.actorUserId, targetUserId, now)
      .first<{
        invite_id: string;
        game_id: 'hokm';
        room_code: string;
        status: GameInviteStatus;
        created_at: number;
        expires_at: number;
        responded_at: number | null;
      }>();

  const buildDeduplicatedResponse = (
    row: NonNullable<Awaited<ReturnType<typeof fetchExistingLivePending>>>
  ): CreateGameInviteResult => ({
    ok: true,
    status: 200,
    deduplicated: true,
    invite: {
      inviteId: row.invite_id,
      gameId: row.game_id,
      roomCode: row.room_code,
      status: row.status,
      direction: 'outgoing',
      otherUser: {
        userId: targetRow.user_id,
        username: targetRow.username,
        displayName: targetRow.display_name,
        avatarCode: targetRow.avatar_code,
        avatarUrl: targetRow.avatar_url,
      },
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      respondedAt: row.responded_at,
    },
    message: 'دعوت فعال برای این اتاق از قبل ارسال شده است.',
  });

  // Expire stale pending invites first so partial UNIQUE index never blocks fresh re-invite
  await expireStaleInvitesForUser(db, ctx.actorUserId, now);

  // Fast-path deduplication for existing live pending invite for the same room & pair
  const existing = await fetchExistingLivePending();
  if (existing) {
    return buildDeduplicatedResponse(existing);
  }

  const rl = await consumeRateLimitSlot(
    db,
    `game_invite:user:${ctx.actorUserId}`,
    GAME_INVITE_USER_RATE_LIMIT,
    now
  );
  if (!rl.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'تعداد دعوت‌های ارسالی بیش از حد مجاز است. لطفاً کمی صبر کنید.',
      retryAfterSec: rl.retryAfterSec,
    };
  }

  const inviteId = generatePrefixedId('inv', 12);
  const expiresAt = now + DEFAULT_GAME_INVITE_TTL_MS;
  const pairKey = buildCanonicalPairKey(ctx.actorUserId, targetUserId);

  // Atomic DB-level uniqueness backed by `uq_game_invites_pending_pair_room` AND
  // atomic commit-time friendship/non-block verification so a concurrent `removeFriend`
  // or `blockUser` can NEVER leave an orphaned live pending invite.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const insertRes = await db
        .prepare(
          `INSERT INTO game_invites (
             invite_id, game_id, room_code, inviter_id, invitee_id,
             status, created_at, updated_at, expires_at, responded_at
           )
           SELECT ?, 'hokm', ?, ?, ?, 'pending', ?, ?, ?, NULL
           WHERE EXISTS (
             SELECT 1 FROM friendships f
             WHERE f.pair_key = ? AND f.status = 'accepted'
           )
             AND NOT EXISTS (
               SELECT 1 FROM user_blocks ub
               WHERE (ub.blocker_id = ? AND ub.blocked_id = ?)
                  OR (ub.blocker_id = ? AND ub.blocked_id = ?)
             )`
        )
        .bind(
          inviteId,
          roomCode,
          ctx.actorUserId,
          targetUserId,
          now,
          now,
          expiresAt,
          pairKey,
          ctx.actorUserId,
          targetUserId,
          targetUserId,
          ctx.actorUserId
        )
        .run();

      if (Number(insertRes.meta?.changes ?? 0) === 0) {
        const nowBlocked = await isBlockedEitherWay(
          db,
          ctx.actorUserId,
          targetUserId
        );
        if (nowBlocked) {
          return {
            ok: false,
            status: 403,
            code: 'USER_BLOCKED',
            message: 'امکان ارسال دعوت به این کاربر به دلیل مسدودیت وجود ندارد.',
          };
        }
        return {
          ok: false,
          status: 403,
          code: 'NOT_FRIENDS',
          message: 'ارسال دعوت بازی فقط برای دوستان تأییدشده مجاز است.',
        };
      }

      return {
        ok: true,
        status: 201,
        deduplicated: false,
        invite: {
          inviteId,
          gameId: 'hokm',
          roomCode,
          status: 'pending',
          direction: 'outgoing',
          otherUser: {
            userId: targetRow.user_id,
            username: targetRow.username,
            displayName: targetRow.display_name,
            avatarCode: targetRow.avatar_code,
            avatarUrl: targetRow.avatar_url,
          },
          createdAt: now,
          expiresAt,
          respondedAt: null,
        },
        message: `دعوت بازی به اتاق ${roomCode} برای ${targetRow.username} ارسال شد.`,
      };
    } catch (err) {
      if (!isUniqueConstraintError(err)) {
        throw err;
      }

      // Expire any stale pending rows that might have tripped the partial unique index
      await expireStaleInvitesForUser(db, ctx.actorUserId, now);
      const racedExisting = await fetchExistingLivePending();
      if (racedExisting) {
        return buildDeduplicatedResponse(racedExisting);
      }

      if (attempt === 1) {
        return {
          ok: false,
          status: 409,
          code: 'INVITE_NOT_PENDING',
          message: 'درخواست دعوت هم‌زمان در حال پردازش است. لطفاً دوباره بررسی کنید.',
        };
      }
    }
  }

  return {
    ok: false,
    status: 409,
    code: 'INVITE_NOT_PENDING',
    message: 'درخواست دعوت هم‌زمان در حال پردازش است. لطفاً دوباره بررسی کنید.',
  };
}

/**
 * Lists incoming and outgoing active/recent game invites for `ctx.actorUserId`
 * (auto-expiring overdue pending rows and filtering blocked users).
 */
export async function listGameInvites(
  db: D1DatabaseLike,
  ctx: SocialRequestContext
): Promise<{ incoming: GameInviteItem[]; outgoing: GameInviteItem[] }> {
  const now = ctx.now ?? Date.now();
  await expireStaleInvitesForUser(db, ctx.actorUserId, now);

  const res = await db
    .prepare(
      `SELECT
         gi.invite_id,
         gi.game_id,
         gi.room_code,
         gi.inviter_id,
         gi.invitee_id,
         gi.status,
         gi.created_at,
         gi.expires_at,
         gi.responded_at,
         u.user_id,
         u.username,
         u.display_name,
         u.avatar_code,
         u.avatar_url
       FROM game_invites gi
       INNER JOIN users u
         ON u.user_id = CASE
           WHEN gi.inviter_id = ? THEN gi.invitee_id
           ELSE gi.inviter_id
         END
       WHERE (gi.inviter_id = ? OR gi.invitee_id = ?)
         AND gi.status = 'pending'
         AND gi.expires_at > ?
         AND u.account_status = 'active'
         AND u.email_verified = 1
         AND NOT EXISTS (
           SELECT 1
           FROM user_blocks ub
           WHERE (ub.blocker_id = ? AND ub.blocked_id = u.user_id)
              OR (ub.blocker_id = u.user_id AND ub.blocked_id = ?)
         )
         AND EXISTS (
           SELECT 1
           FROM friendships f
           WHERE f.status = 'accepted'
             AND ((f.requester_id = ? AND f.addressee_id = u.user_id)
               OR (f.requester_id = u.user_id AND f.addressee_id = ?))
         )
       ORDER BY gi.created_at DESC
       LIMIT 30`
    )
    .bind(
      ctx.actorUserId,
      ctx.actorUserId,
      ctx.actorUserId,
      now,
      ctx.actorUserId,
      ctx.actorUserId,
      ctx.actorUserId,
      ctx.actorUserId
    )
    .all<{
      invite_id: string;
      game_id: 'hokm';
      room_code: string;
      inviter_id: string;
      invitee_id: string;
      status: GameInviteStatus;
      created_at: number;
      expires_at: number;
      responded_at: number | null;
      user_id: string;
      username: string;
      display_name: string;
      avatar_code: string;
      avatar_url: string | null;
    }>();

  const incoming: GameInviteItem[] = [];
  const outgoing: GameInviteItem[] = [];

  for (const row of res.results ?? []) {
    const direction =
      row.invitee_id === ctx.actorUserId ? 'incoming' : 'outgoing';
    const item: GameInviteItem = {
      inviteId: row.invite_id,
      gameId: row.game_id,
      roomCode: row.room_code,
      status: row.status,
      direction,
      otherUser: {
        userId: row.user_id,
        username: row.username,
        displayName: row.display_name,
        avatarCode: row.avatar_code,
        avatarUrl: row.avatar_url,
      },
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      respondedAt: row.responded_at,
    };
    if (direction === 'incoming') incoming.push(item);
    else outgoing.push(item);
  }

  return { incoming, outgoing };
}

export type RespondGameInviteResult =
  | {
      readonly ok: true;
      readonly status: 200;
      readonly inviteId: string;
      readonly decision: 'accept' | 'decline';
      readonly roomCode: string;
      readonly gameId: 'hokm';
      readonly message: string;
    }
  | SocialErrorResult;

/**
 * Accepts or declines an incoming game invite strictly owned by `ctx.actorUserId`.
 * On `'accept'`, re-verifies the live Hokm room is still open & WAITING before committing.
 */
export async function respondToGameInvite(
  db: D1DatabaseLike,
  rawInviteId: unknown,
  decision: 'accept' | 'decline',
  roomLookup: GameRoomLookupFn,
  ctx: SocialRequestContext
): Promise<RespondGameInviteResult> {
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
      message: 'تعداد درخواست‌های پاسخ به دعوت بیش از حد مجاز است. لطفاً کمی صبر کنید.',
      retryAfterSec: rl.retryAfterSec,
    };
  }

  const inviteId =
    typeof rawInviteId === 'string' ? rawInviteId.trim() : '';
  if (!INVITE_ID_RE.test(inviteId)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'شناسه دعوت بازی نامعتبر است.',
    };
  }

  const row = await db
    .prepare(
      `SELECT invite_id, game_id, room_code, inviter_id, invitee_id, status, expires_at
       FROM game_invites
       WHERE invite_id = ?
       LIMIT 1`
    )
    .bind(inviteId)
    .first<{
      invite_id: string;
      game_id: 'hokm';
      room_code: string;
      inviter_id: string;
      invitee_id: string;
      status: GameInviteStatus;
      expires_at: number;
    }>();

  if (!row || row.invitee_id !== ctx.actorUserId) {
    return {
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      message: 'دعوت بازی مورد نظر یافت نشد.',
    };
  }

  if (row.status !== 'pending') {
    return {
      ok: false,
      status: 409,
      code: 'INVITE_NOT_PENDING',
      message: 'این دعوت قبلاً پاسخ داده شده یا لغو شده است.',
    };
  }

  if (row.expires_at <= now) {
    await db
      .prepare(
        `UPDATE game_invites
         SET status = 'expired', updated_at = ?
         WHERE invite_id = ? AND status = 'pending'`
      )
      .bind(now, inviteId)
      .run();
    return {
      ok: false,
      status: 410,
      code: 'INVITE_EXPIRED',
      message: 'مهلت این دعوت بازی به پایان رسیده است.',
    };
  }

  const blocked = await isBlockedEitherWay(db, ctx.actorUserId, row.inviter_id);
  if (blocked) {
    await db
      .prepare(
        `UPDATE game_invites
         SET status = 'canceled', updated_at = ?, responded_at = ?
         WHERE invite_id = ? AND status = 'pending'`
      )
      .bind(now, now, inviteId)
      .run();
    return {
      ok: false,
      status: 403,
      code: 'USER_BLOCKED',
      message: 'امکان پاسخ به این دعوت به دلیل مسدودیت وجود ندارد.',
    };
  }

  if (decision === 'accept') {
    const friends = await areAcceptedFriends(db, ctx.actorUserId, row.inviter_id);
    if (!friends) {
      await db
        .prepare(
          `UPDATE game_invites
           SET status = 'canceled', updated_at = ?, responded_at = ?
           WHERE invite_id = ? AND status = 'pending'`
        )
        .bind(now, now, inviteId)
        .run();
      return {
        ok: false,
        status: 403,
        code: 'NOT_FRIENDS',
        message: 'پذیرش دعوت بازی فقط برای دوستان تأییدشده مجاز است.',
      };
    }

    const roomSummary = await roomLookup(row.room_code);
    if (!roomSummary || roomSummary.status !== 'WAITING') {
      await db
        .prepare(
          `UPDATE game_invites
           SET status = 'expired', updated_at = ?
           WHERE invite_id = ? AND status = 'pending'`
        )
        .bind(now, inviteId)
        .run();
      return {
        ok: false,
        status: 409,
        code: 'ROOM_NOT_AVAILABLE',
        message: 'اتاق بازی دیگر فعال نیست یا بازی آغاز شده است.',
      };
    }
    if (roomSummary.playerCount >= roomSummary.maxPlayers) {
      return {
        ok: false,
        status: 409,
        code: 'ROOM_NOT_AVAILABLE',
        message: 'ظرفیت اتاق بازی تکمیل شده است.',
      };
    }
  }

  const nextStatus: GameInviteStatus =
    decision === 'accept' ? 'accepted' : 'declined';
  const pairKey = buildCanonicalPairKey(ctx.actorUserId, row.inviter_id);

  // For 'accept', enforce accepted friendship + non-blocked atomically inside the UPDATE
  // so a concurrent `removeFriend` / `blockUser` can NEVER allow accepting a stale invite.
  const updRes =
    decision === 'accept'
      ? await db
          .prepare(
            `UPDATE game_invites
             SET status = 'accepted', updated_at = ?, responded_at = ?
             WHERE invite_id = ?
               AND invitee_id = ?
               AND status = 'pending'
               AND expires_at > ?
               AND EXISTS (
                 SELECT 1 FROM friendships f
                 WHERE f.pair_key = ? AND f.status = 'accepted'
               )
               AND NOT EXISTS (
                 SELECT 1 FROM user_blocks ub
                 WHERE (ub.blocker_id = ? AND ub.blocked_id = ?)
                    OR (ub.blocker_id = ? AND ub.blocked_id = ?)
               )`
          )
          .bind(
            now,
            now,
            inviteId,
            ctx.actorUserId,
            now,
            pairKey,
            ctx.actorUserId,
            row.inviter_id,
            row.inviter_id,
            ctx.actorUserId
          )
          .run()
      : await db
          .prepare(
            `UPDATE game_invites
             SET status = ?, updated_at = ?, responded_at = ?
             WHERE invite_id = ? AND invitee_id = ? AND status = 'pending' AND expires_at > ?`
          )
          .bind(nextStatus, now, now, inviteId, ctx.actorUserId, now)
          .run();

  if (Number(updRes.meta?.changes ?? 0) !== 1) {
    if (decision === 'accept') {
      const [nowBlocked, nowFriends] = await Promise.all([
        isBlockedEitherWay(db, ctx.actorUserId, row.inviter_id),
        areAcceptedFriends(db, ctx.actorUserId, row.inviter_id),
      ]);
      if (nowBlocked) {
        return {
          ok: false,
          status: 403,
          code: 'USER_BLOCKED',
          message: 'امکان پاسخ به این دعوت به دلیل مسدودیت وجود ندارد.',
        };
      }
      if (!nowFriends) {
        return {
          ok: false,
          status: 403,
          code: 'NOT_FRIENDS',
          message: 'پذیرش دعوت بازی فقط برای دوستان تأییدشده مجاز است.',
        };
      }
    }
    return {
      ok: false,
      status: 409,
      code: 'INVITE_NOT_PENDING',
      message: 'وضعیت این دعوت قبلاً تغییر کرده است.',
    };
  }

  return {
    ok: true,
    status: 200,
    inviteId,
    decision,
    roomCode: row.room_code,
    gameId: row.game_id,
    message:
      decision === 'accept'
        ? `دعوت بازی پذیرفته شد. در حال ورود به اتاق ${row.room_code}...`
        : 'دعوت بازی رد شد.',
  };
}

export type CancelGameInviteResult =
  | {
      readonly ok: true;
      readonly status: 200;
      readonly inviteId: string;
      readonly message: string;
    }
  | SocialErrorResult;

/**
 * Cancels an outgoing pending invite strictly owned by `ctx.actorUserId`.
 */
export async function cancelGameInvite(
  db: D1DatabaseLike,
  rawInviteId: unknown,
  ctx: SocialRequestContext
): Promise<CancelGameInviteResult> {
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
      message: 'تعداد درخواست‌های لغو دعوت بیش از حد مجاز است. لطفاً کمی صبر کنید.',
      retryAfterSec: rl.retryAfterSec,
    };
  }

  const inviteId =
    typeof rawInviteId === 'string' ? rawInviteId.trim() : '';
  if (!INVITE_ID_RE.test(inviteId)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'شناسه دعوت بازی نامعتبر است.',
    };
  }

  const updRes = await db
    .prepare(
      `UPDATE game_invites
       SET status = 'canceled', updated_at = ?, responded_at = ?
       WHERE invite_id = ? AND inviter_id = ? AND status = 'pending'`
    )
    .bind(now, now, inviteId, ctx.actorUserId)
    .run();

  if (Number(updRes.meta?.changes ?? 0) !== 1) {
    return {
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      message: 'دعوت در حال انتظاری برای لغو یافت نشد.',
    };
  }

  return {
    ok: true,
    status: 200,
    inviteId,
    message: 'دعوت بازی لغو شد.',
  };
}

/**
 * Bounded periodic maintenance for `game_invites` (Cron Trigger + Express maintenance):
 * 1) Marks overdue `pending` invites as `'expired'` using `idx_game_invites_status_expires_at` (0012)
 *    so stale pending rows never pollute the partial UNIQUE index even for inactive users.
 * 2) Prunes old terminal invites (`expired` / `declined` / `canceled` / `accepted`) older than
 *    `retentionGraceMs` (default 7 days) using `idx_game_invites_status_updated_at` (0012).
 */
export async function pruneExpiredGameInvitesBatched(
  db: D1DatabaseLike | undefined,
  options?: { now?: number; retentionGraceMs?: number; batchSize?: number; maxBatches?: number }
): Promise<{ expiredMarked: number; deletedHistorical: number }> {
  if (!db) {
    return { expiredMarked: 0, deletedHistorical: 0 };
  }
  const now = options?.now ?? Date.now();
  const retentionGraceMs = Math.max(
    60_000,
    options?.retentionGraceMs ?? 7 * 24 * 60 * 60 * 1000
  );
  const cutoff = now - retentionGraceMs;
  const batchSize = Math.max(10, Math.min(500, options?.batchSize ?? 200));
  const maxBatches = Math.max(1, Math.min(20, options?.maxBatches ?? 5));

  let expiredMarked = 0;
  for (let i = 0; i < maxBatches; i++) {
    const res = await db
      .prepare(
        `UPDATE game_invites
         SET status = 'expired', updated_at = ?
         WHERE invite_id IN (
           SELECT invite_id
           FROM game_invites
           WHERE status = 'pending' AND expires_at <= ?
           ORDER BY expires_at ASC
           LIMIT ?
         )`
      )
      .bind(now, now, batchSize)
      .run();
    const changed = Number(res.meta?.changes ?? 0);
    expiredMarked += changed;
    if (changed < batchSize) break;
  }

  let deletedHistorical = 0;
  const terminalStatuses: readonly GameInviteStatus[] = [
    'expired',
    'declined',
    'canceled',
    'accepted',
  ];
  for (const terminalStatus of terminalStatuses) {
    for (let i = 0; i < maxBatches; i++) {
      const res = await db
        .prepare(
          `DELETE FROM game_invites
           WHERE invite_id IN (
             SELECT invite_id
             FROM game_invites
             WHERE status = ? AND updated_at <= ?
             ORDER BY updated_at ASC
             LIMIT ?
           )`
        )
        .bind(terminalStatus, cutoff, batchSize)
        .run();
      const deleted = Number(res.meta?.changes ?? 0);
      deletedHistorical += deleted;
      if (deleted < batchSize) break;
    }
  }

  return { expiredMarked, deletedHistorical };
}

