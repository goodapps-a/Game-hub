import { sanitizeRoomCode } from '../../../../src/games/hokm/online/protocol';
import { generatePrefixedId } from '../auth/crypto';
import {
  CHAT_CONVERSATION_MUTATION_USER_RATE_LIMIT,
  consumeRateLimitSlot,
} from '../auth/rateLimit';
import { getPublicAppearancesForUsers } from '../items/inventoryService';
import type { PublicAppearanceSnapshot } from '../../../../src/platform/items/itemTypes';
import type { D1DatabaseLike } from '../types';
import { CHAT_SEND_USER_RATE_LIMIT } from './chatService';
import type {
  FriendGroupMemberSummary,
  FriendGroupSummary,
  GameRoomLookupFn,
  GroupMessageItem,
  PresenceStatus,
  SocialErrorResult,
  SocialRequestContext,
} from './types';
import { buildCanonicalPairKey, validateTargetUserId } from './validation';

const GROUP_ID_RE = /^grp_[a-zA-Z0-9_-]{6,64}$/;
const CLIENT_MSG_ID_RE = /^[a-zA-Z0-9_.:-]{4,80}$/;
const MAX_GROUP_NAME_LEN = 40;
const MAX_GROUP_MESSAGE_LEN = 2000;
const MAX_GROUP_MEMBERS = 25;

function sanitizeGroupName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (cleaned.length < 2 || cleaned.length > MAX_GROUP_NAME_LEN) return null;
  return cleaned;
}

function sanitizeMessageBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  if (cleaned.length < 1 || cleaned.length > MAX_GROUP_MESSAGE_LEN) return null;
  return cleaned;
}

function buildPreview(body: string): string {
  const single = body.replace(/\s+/g, ' ').trim();
  return single.length > 96 ? `${single.slice(0, 93)}...` : single;
}

function resolveOnline(
  hasPresence: number,
  privacyShowOnline: number,
  presencePref: string
): PresenceStatus {
  if (privacyShowOnline !== 1 || presencePref === 'invisible') return 'offline';
  return hasPresence === 1 ? 'online' : 'offline';
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

async function buildGroupSummary(
  db: D1DatabaseLike,
  groupId: string,
  actorUserId: string,
  now: number
): Promise<FriendGroupSummary | null> {
  const groupRow = await db
    .prepare(
      `SELECT group_id, name, owner_user_id, created_at
       FROM friend_groups
       WHERE group_id = ?
       LIMIT 1`
    )
    .bind(groupId)
    .first<{
      group_id: string;
      name: string;
      owner_user_id: string;
      created_at: number;
    }>();
  if (!groupRow) return null;

  const [memberRes, lastMsgRow, friendRes] = await Promise.all([
    db
      .prepare(
        `SELECT
           fgm.user_id,
           fgm.role,
           u.username,
           u.display_name,
           u.account_code,
           u.avatar_code,
           u.avatar_url,
           u.privacy_show_online,
           u.presence_preference,
           CASE
             WHEN EXISTS (
               SELECT 1 FROM user_presence_sessions ups
               WHERE ups.user_id = u.user_id AND ups.expires_at > ?
             ) THEN 1 ELSE 0
           END AS has_active_presence
         FROM friend_group_members fgm
         INNER JOIN users u ON u.user_id = fgm.user_id
         WHERE fgm.group_id = ?
           AND u.account_status = 'active'
           AND u.email_verified = 1
         ORDER BY CASE WHEN fgm.role = 'owner' THEN 0 ELSE 1 END ASC, fgm.joined_at ASC`
      )
      .bind(now, groupId)
      .all<{
        user_id: string;
        role: 'owner' | 'member';
        username: string;
        display_name: string;
        account_code: string | null;
        avatar_code: string;
        avatar_url: string | null;
        privacy_show_online: number;
        presence_preference: string;
        has_active_presence: number;
      }>(),
    db
      .prepare(
        `SELECT body, created_at
         FROM group_messages
         WHERE group_id = ?
         ORDER BY created_at DESC, message_id DESC
         LIMIT 1`
      )
      .bind(groupId)
      .first<{ body: string; created_at: number }>(),
    db
      .prepare(
        `SELECT
           CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS friend_id
         FROM friendships
         WHERE status = 'accepted'
           AND (requester_id = ? OR addressee_id = ?)`
      )
      .bind(actorUserId, actorUserId, actorUserId)
      .all<{ friend_id: string }>(),
  ]);

  const friendIdSet = new Set((friendRes.results ?? []).map((r) => r.friend_id));
  const rawMembers = memberRes.results ?? [];
  let appearanceMap = new Map<string, PublicAppearanceSnapshot>();
  try {
    appearanceMap = await getPublicAppearancesForUsers(
      db,
      rawMembers.map((m) => m.user_id)
    );
  } catch {
    // Non-fatal
  }

  const members: FriendGroupMemberSummary[] = rawMembers.map((m) => {
    const canSeeOnline = m.user_id === actorUserId || friendIdSet.has(m.user_id);
    const appearance = appearanceMap.get(m.user_id);
    return {
      userId: m.user_id,
      username: m.username,
      displayName: m.display_name,
      accountCode: m.account_code ?? null,
      avatarCode: m.avatar_code,
      avatarUrl: m.avatar_url,
      role: m.role,
      onlineStatus: canSeeOnline
        ? resolveOnline(m.has_active_presence, m.privacy_show_online, m.presence_preference)
        : 'offline',
      ...(appearance ? { appearance } : {}),
    };
  });

  return {
    groupId: groupRow.group_id,
    name: groupRow.name,
    ownerUserId: groupRow.owner_user_id,
    memberCount: members.length,
    members,
    lastMessagePreview: lastMsgRow ? buildPreview(lastMsgRow.body) : null,
    lastMessageAt: lastMsgRow ? Number(lastMsgRow.created_at) : null,
    createdAt: Number(groupRow.created_at),
  };
}

export async function listUserGroups(
  db: D1DatabaseLike,
  ctx: SocialRequestContext
): Promise<FriendGroupSummary[]> {
  const now = ctx.now ?? Date.now();
  const groupRows = await db
    .prepare(
      `SELECT fg.group_id
       FROM friend_groups fg
       INNER JOIN friend_group_members fgm
         ON fgm.group_id = fg.group_id AND fgm.user_id = ?
       ORDER BY fg.updated_at DESC, fg.created_at DESC
       LIMIT 30`
    )
    .bind(ctx.actorUserId)
    .all<{ group_id: string }>();

  const out: FriendGroupSummary[] = [];
  for (const row of groupRows.results ?? []) {
    const summary = await buildGroupSummary(db, row.group_id, ctx.actorUserId, now);
    if (summary) out.push(summary);
  }
  return out;
}

export async function createFriendGroup(
  db: D1DatabaseLike,
  payload: Record<string, unknown>,
  ctx: SocialRequestContext
): Promise<
  | { readonly ok: true; readonly status: 201; readonly group: FriendGroupSummary }
  | SocialErrorResult
> {
  const now = ctx.now ?? Date.now();
  const rl = await consumeRateLimitSlot(
    db,
    `group_mut:user:${ctx.actorUserId}`,
    CHAT_CONVERSATION_MUTATION_USER_RATE_LIMIT,
    now
  );
  if (!rl.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'تعداد درخواست‌های ساخت گروه بیش از حد مجاز است. لطفاً کمی صبر کنید.',
      retryAfterSec: rl.retryAfterSec,
    };
  }

  const cleanName = sanitizeGroupName(payload.name);
  if (!cleanName) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'نام گروه باید بین ۲ تا ۴۰ کاراکتر باشد.',
    };
  }

  const rawMemberIds = Array.isArray(payload.memberIds) ? payload.memberIds : [];
  const memberIds: string[] = [];
  const seen = new Set<string>([ctx.actorUserId]);
  for (const rawId of rawMemberIds.slice(0, MAX_GROUP_MEMBERS)) {
    const val = validateTargetUserId(rawId);
    if (val.ok === false) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_INPUT',
        message: val.message,
      };
    }
    if (!seen.has(val.userId)) {
      seen.add(val.userId);
      memberIds.push(val.userId);
    }
  }

  for (const memberId of memberIds) {
    const [blocked, friends, activeRow] = await Promise.all([
      isBlockedEitherWay(db, ctx.actorUserId, memberId),
      areAcceptedFriends(db, ctx.actorUserId, memberId),
      db
        .prepare(
          `SELECT 1 AS ok FROM users WHERE user_id = ? AND account_status = 'active' AND email_verified = 1 LIMIT 1`
        )
        .bind(memberId)
        .first<{ ok: number }>(),
    ]);
    if (blocked) {
      return {
        ok: false,
        status: 403,
        code: 'USER_BLOCKED',
        message: 'امکان افزودن کاربر مسدودشده به گروه وجود ندارد.',
      };
    }
    if (!friends || !activeRow) {
      return {
        ok: false,
        status: 403,
        code: 'NOT_FRIENDS',
        message: 'فقط دوستان تأییدشده را می‌توانید به گروه اضافه کنید.',
      };
    }
  }

  const groupId = generatePrefixedId('grp', 12);
  await db.batch([
    db
      .prepare(
        `INSERT INTO friend_groups (group_id, name, owner_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(groupId, cleanName, ctx.actorUserId, now, now),
    db
      .prepare(
        `INSERT INTO friend_group_members (group_id, user_id, role, joined_at)
         VALUES (?, ?, 'owner', ?)`
      )
      .bind(groupId, ctx.actorUserId, now),
    ...memberIds.map((mId) =>
      db
        .prepare(
          `INSERT INTO friend_group_members (group_id, user_id, role, joined_at)
           VALUES (?, ?, 'member', ?)`
        )
        .bind(groupId, mId, now)
    ),
  ]);

  const group = await buildGroupSummary(db, groupId, ctx.actorUserId, now);
  if (!group) {
    return {
      ok: false,
      status: 500,
      code: 'DATABASE_ERROR',
      message: 'خطا در ایجاد گروه دوستان.',
    };
  }

  return {
    ok: true,
    status: 201,
    group,
  };
}

export async function addMemberToFriendGroup(
  db: D1DatabaseLike,
  rawGroupId: string,
  payload: Record<string, unknown>,
  ctx: SocialRequestContext
): Promise<
  | { readonly ok: true; readonly status: 200; readonly group: FriendGroupSummary }
  | SocialErrorResult
> {
  const now = ctx.now ?? Date.now();
  const groupId = rawGroupId.trim();
  if (!GROUP_ID_RE.test(groupId)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'شناسه گروه نامعتبر است.',
    };
  }

  const actorMember = await db
    .prepare(
      `SELECT 1 AS hit FROM friend_group_members WHERE group_id = ? AND user_id = ? LIMIT 1`
    )
    .bind(groupId, ctx.actorUserId)
    .first<{ hit: number }>();

  if (!actorMember) {
    return {
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'شما عضو این گروه نیستید.',
    };
  }

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
    const group = await buildGroupSummary(db, groupId, ctx.actorUserId, now);
    if (!group) {
      return { ok: false, status: 404, code: 'NOT_FOUND', message: 'گروه یافت نشد.' };
    }
    return { ok: true, status: 200, group };
  }

  const [blocked, friends, activeRow, countRow] = await Promise.all([
    isBlockedEitherWay(db, ctx.actorUserId, targetUserId),
    areAcceptedFriends(db, ctx.actorUserId, targetUserId),
    db
      .prepare(
        `SELECT 1 AS ok FROM users WHERE user_id = ? AND account_status = 'active' AND email_verified = 1 LIMIT 1`
      )
      .bind(targetUserId)
      .first<{ ok: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS cnt FROM friend_group_members WHERE group_id = ?`)
      .bind(groupId)
      .first<{ cnt: number }>(),
  ]);

  if (blocked) {
    return {
      ok: false,
      status: 403,
      code: 'USER_BLOCKED',
      message: 'امکان افزودن این کاربر به گروه وجود ندارد.',
    };
  }
  if (!friends || !activeRow) {
    return {
      ok: false,
      status: 403,
      code: 'NOT_FRIENDS',
      message: 'فقط دوستان تأییدشده را می‌توانید به گروه اضافه کنید.',
    };
  }
  if (Number(countRow?.cnt ?? 0) >= MAX_GROUP_MEMBERS) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: `حداکثر ظرفیت هر گروه ${MAX_GROUP_MEMBERS} نفر است.`,
    };
  }

  await db
    .prepare(
      `INSERT OR IGNORE INTO friend_group_members (group_id, user_id, role, joined_at)
       VALUES (?, ?, 'member', ?)`
    )
    .bind(groupId, targetUserId, now)
    .run();

  const group = await buildGroupSummary(db, groupId, ctx.actorUserId, now);
  if (!group) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'گروه یافت نشد.' };
  }
  return { ok: true, status: 200, group };
}

export async function listGroupMessages(
  db: D1DatabaseLike,
  rawGroupId: string,
  rawLimit: unknown,
  ctx: SocialRequestContext
): Promise<
  | {
      readonly ok: true;
      readonly status: 200;
      readonly groupId: string;
      readonly messages: GroupMessageItem[];
    }
  | SocialErrorResult
> {
  const groupId = rawGroupId.trim();
  if (!GROUP_ID_RE.test(groupId)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'شناسه گروه نامعتبر است.',
    };
  }

  const actorMember = await db
    .prepare(
      `SELECT 1 AS hit FROM friend_group_members WHERE group_id = ? AND user_id = ? LIMIT 1`
    )
    .bind(groupId, ctx.actorUserId)
    .first<{ hit: number }>();

  if (!actorMember) {
    return {
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'شما مجوز مشاهده پیام‌های این گروه را ندارید.',
    };
  }

  const parsedLimit = Number(rawLimit);
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(60, Math.floor(parsedLimit)))
    : 40;

  const res = await db
    .prepare(
      `SELECT
         gm.message_id,
         gm.group_id,
         gm.sender_id,
         u.username AS sender_username,
         u.display_name AS sender_display_name,
         gm.kind,
         gm.body,
         gm.room_code,
         gm.game_id,
         gm.client_msg_id,
         gm.created_at
       FROM group_messages gm
       INNER JOIN users u ON u.user_id = gm.sender_id
       WHERE gm.group_id = ?
       ORDER BY gm.created_at DESC, gm.message_id DESC
       LIMIT ?`
    )
    .bind(groupId, limit)
    .all<{
      message_id: string;
      group_id: string;
      sender_id: string;
      sender_username: string;
      sender_display_name: string;
      kind: 'text' | 'game_invite';
      body: string;
      room_code: string | null;
      game_id: string | null;
      client_msg_id: string | null;
      created_at: number;
    }>();

  const messages: GroupMessageItem[] = (res.results ?? [])
    .reverse()
    .map((r) => ({
      messageId: r.message_id,
      groupId: r.group_id,
      senderId: r.sender_id,
      senderUsername: r.sender_username,
      senderDisplayName: r.sender_display_name,
      kind: r.kind,
      body: r.body,
      roomCode: r.room_code,
      gameId: r.game_id,
      clientMsgId: r.client_msg_id,
      createdAt: Number(r.created_at),
    }));

  return {
    ok: true,
    status: 200,
    groupId,
    messages,
  };
}

export async function sendGroupMessage(
  db: D1DatabaseLike,
  rawGroupId: string,
  payload: Record<string, unknown>,
  roomLookup: GameRoomLookupFn,
  ctx: SocialRequestContext
): Promise<
  | {
      readonly ok: true;
      readonly status: number;
      readonly message: GroupMessageItem;
      readonly deduplicated: boolean;
    }
  | SocialErrorResult
> {
  const now = ctx.now ?? Date.now();
  const groupId = rawGroupId.trim();
  if (!GROUP_ID_RE.test(groupId)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'شناسه گروه نامعتبر است.',
    };
  }

  const actorInfo = await db
    .prepare(
      `SELECT u.username, u.display_name
       FROM friend_group_members fgm
       INNER JOIN users u ON u.user_id = fgm.user_id
       WHERE fgm.group_id = ? AND fgm.user_id = ?
       LIMIT 1`
    )
    .bind(groupId, ctx.actorUserId)
    .first<{ username: string; display_name: string }>();

  if (!actorInfo) {
    return {
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'شما عضو این گروه نیستید.',
    };
  }

  const kind: 'text' | 'game_invite' =
    payload.kind === 'game_invite' ? 'game_invite' : 'text';
  let roomCode: string | null = null;
  let gameId: string | null = null;
  let cleanBody = sanitizeMessageBody(payload.body);

  if (kind === 'game_invite') {
    const rawGameId =
      typeof payload.gameId === 'string' && payload.gameId.trim()
        ? payload.gameId.trim().toLowerCase()
        : 'hokm';
    if (!['hokm', 'chess', 'backgammon', 'pasoor', 'ludo'].includes(rawGameId)) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_INPUT',
        message: 'شناسه بازی برای دعوت گروهی نامعتبر است.',
      };
    }
    gameId = rawGameId;

    if (gameId === 'hokm') {
      const sanitizedCode = sanitizeRoomCode(payload.roomCode);
      if (!sanitizedCode) {
        return {
          ok: false,
          status: 400,
          code: 'INVALID_INPUT',
          message: 'برای دعوت گروهی به حکم، کد اتاق معتبر الزامی است.',
        };
      }
      const roomSummary = await roomLookup(sanitizedCode);
      if (!roomSummary || roomSummary.status !== 'WAITING') {
        return {
          ok: false,
          status: 409,
          code: 'ROOM_NOT_AVAILABLE',
          message: 'اتاق حکم مورد نظر باز یا در انتظار بازیکن نیست.',
        };
      }
      if (roomSummary.playerCount >= roomSummary.maxPlayers) {
        return {
          ok: false,
          status: 409,
          code: 'ROOM_NOT_AVAILABLE',
          message: 'ظرفیت این اتاق حکم تکمیل شده است.',
        };
      }
      const actorLower = actorInfo.username.trim().toLowerCase();
      const seatedUsernames = (roomSummary.playerUsernames ?? []).map((u) =>
        u.trim().toLowerCase()
      );
      if (
        seatedUsernames.length > 0 &&
        !seatedUsernames.includes(actorLower) &&
        roomSummary.hostUsername?.trim().toLowerCase() !== actorLower
      ) {
        return {
          ok: false,
          status: 403,
          code: 'FORBIDDEN',
          message: 'شما در این اتاق حضور ندارید و نمی‌توانید دعوت ارسال کنید.',
        };
      }
      roomCode = sanitizedCode;
      cleanBody = cleanBody ?? `دعوت به میز حکم آنلاین · کد اتاق ${roomCode}`;
    } else {
      cleanBody = cleanBody ?? `دعوت به بازی ${gameId}`;
    }
  }

  if (!cleanBody) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: `متن پیام باید بین ۱ تا ${MAX_GROUP_MESSAGE_LEN} کاراکتر باشد.`,
    };
  }

  let clientMsgId: string | null = null;
  if (payload.clientMsgId !== undefined && payload.clientMsgId !== null) {
    if (
      typeof payload.clientMsgId !== 'string' ||
      !CLIENT_MSG_ID_RE.test(payload.clientMsgId.trim())
    ) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_INPUT',
        message: 'شناسه پیام نامعتبر است.',
      };
    }
    clientMsgId = payload.clientMsgId.trim();

    const existing = await db
      .prepare(
        `SELECT message_id, group_id, sender_id, kind, body, room_code, game_id, client_msg_id, created_at
         FROM group_messages
         WHERE group_id = ? AND sender_id = ? AND client_msg_id = ?
         LIMIT 1`
      )
      .bind(groupId, ctx.actorUserId, clientMsgId)
      .first<{
        message_id: string;
        group_id: string;
        sender_id: string;
        kind: 'text' | 'game_invite';
        body: string;
        room_code: string | null;
        game_id: string | null;
        client_msg_id: string | null;
        created_at: number;
      }>();
    if (existing) {
      return {
        ok: true,
        status: 200,
        deduplicated: true,
        message: {
          messageId: existing.message_id,
          groupId: existing.group_id,
          senderId: existing.sender_id,
          senderUsername: actorInfo.username,
          senderDisplayName: actorInfo.display_name,
          kind: existing.kind,
          body: existing.body,
          roomCode: existing.room_code,
          gameId: existing.game_id,
          clientMsgId: existing.client_msg_id,
          createdAt: Number(existing.created_at),
        },
      };
    }
  }

  const rl = await consumeRateLimitSlot(
    db,
    `group_send:user:${ctx.actorUserId}`,
    CHAT_SEND_USER_RATE_LIMIT,
    now
  );
  if (!rl.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'سرعت ارسال پیام در گروه بیش از حد مجاز است. لطفاً کمی صبر کنید.',
      retryAfterSec: rl.retryAfterSec,
    };
  }

  const messageId = generatePrefixedId('gmsg', 12);
  await db.batch([
    db
      .prepare(
        `INSERT INTO group_messages (
           message_id, group_id, sender_id, kind, body, room_code, game_id, client_msg_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        messageId,
        groupId,
        ctx.actorUserId,
        kind,
        cleanBody,
        roomCode,
        gameId,
        clientMsgId,
        now
      ),
    db
      .prepare(`UPDATE friend_groups SET updated_at = ? WHERE group_id = ?`)
      .bind(now, groupId),
  ]);

  return {
    ok: true,
    status: 201,
    deduplicated: false,
    message: {
      messageId,
      groupId,
      senderId: ctx.actorUserId,
      senderUsername: actorInfo.username,
      senderDisplayName: actorInfo.display_name,
      kind,
      body: cleanBody,
      roomCode,
      gameId,
      clientMsgId,
      createdAt: now,
    },
  };
}
