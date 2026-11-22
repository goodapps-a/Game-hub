/**
 * Stage D2 — Private 1-on-1 Direct Messaging Service for Eyvan.
 * Shared 1:1 between Cloudflare Workers (D1) and Express/SQLite via SqliteD1Adapter.
 *
 * Uses existing `0005_social_chat.sql` tables:
 * - `conversations` (direct pair uniqueness via `direct_pair_key`)
 * - `conversation_members` (strict membership authorization)
 * - `messages` (`UNIQUE(conversation_id, sender_id, client_msg_id)` idempotency)
 * - `message_read_states` (unread tracking & read receipts)
 *
 * Security & Integrity Guarantees:
 * - Direct messaging is strictly limited to accepted, active, non-blocked friends.
 * - Every read/write verifies active `conversation_members` membership for `ctx.actorUserId`.
 * - Bidirectional block check (`user_blocks`) immediately forbids sending/opening/listing.
 * - Message length strictly bounded (1..2000 trimmed chars), control chars scrubbed, plain text only.
 * - Per-user persistent rate limiting (`CHAT_SEND_USER_RATE_LIMIT`) prevents message spam.
 * - `clientMsgId` guarantees idempotent retries on unstable mobile networks (never duplicates rows).
 */

import { generatePrefixedId } from '../auth/crypto';
import { RateLimitPolicy, consumeRateLimitSlot } from '../auth/rateLimit';
import { D1DatabaseLike } from '../types';
import {
  ChatConversationItem,
  ChatMessageItem,
  PresenceStatus,
  SocialErrorResult,
  SocialRequestContext,
} from './types';
import { buildCanonicalPairKey, validateTargetUserId } from './validation';

const MAX_MESSAGE_BODY_LENGTH = 2000;
const DEFAULT_MESSAGES_LIMIT = 30;
const MAX_MESSAGES_LIMIT = 60;
const CONVERSATION_ID_RE = /^cnv_[a-zA-Z0-9_-]{8,64}$/;
const MESSAGE_ID_RE = /^msg_[a-zA-Z0-9_-]{8,64}$/;
const CLIENT_MSG_ID_RE = /^[a-zA-Z0-9_.:-]{4,80}$/;

export const CHAT_SEND_USER_RATE_LIMIT: RateLimitPolicy = {
  action: 'chat_send_user',
  maxAttempts: 30,
  windowMs: 60 * 1000,
  blockMs: 60 * 1000,
};

function isUniqueConstraintError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(msg);
}

function sanitizeMessageBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Strip NUL and non-printable control chars except newline & tab
  const cleaned = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  if (cleaned.length < 1 || cleaned.length > MAX_MESSAGE_BODY_LENGTH) {
    return null;
  }
  return cleaned;
}

function buildMessagePreview(body: string): string {
  const singleLine = body.replace(/\s+/g, ' ').trim();
  return singleLine.length > 96 ? `${singleLine.slice(0, 93)}...` : singleLine;
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

async function findDirectConversationPartner(
  db: D1DatabaseLike,
  conversationId: string,
  actorUserId: string
): Promise<{
  isMember: boolean;
  partnerUserId: string | null;
}> {
  const rows = await db
    .prepare(
      `SELECT cm.user_id, cm.left_at
       FROM conversation_members cm
       INNER JOIN conversations c ON c.conversation_id = cm.conversation_id
       WHERE cm.conversation_id = ? AND c.type = 'direct'`
    )
    .bind(conversationId)
    .all<{ user_id: string; left_at: number | null }>();

  const members = rows.results ?? [];
  const actorRow = members.find(
    (m) => m.user_id === actorUserId && m.left_at === null
  );
  if (!actorRow) {
    return { isMember: false, partnerUserId: null };
  }
  const partnerRow = members.find((m) => m.user_id !== actorUserId);
  return {
    isMember: true,
    partnerUserId: partnerRow?.user_id ?? null,
  };
}

export type OpenDirectConversationResult =
  | {
      readonly ok: true;
      readonly status: number;
      readonly conversation: ChatConversationItem;
    }
  | SocialErrorResult;

/**
 * Opens an existing direct 1-on-1 conversation or creates one atomically
 * between `ctx.actorUserId` and an accepted, non-blocked friend `targetUserId`.
 */
export async function openOrCreateDirectConversation(
  db: D1DatabaseLike,
  rawTargetUserId: unknown,
  ctx: SocialRequestContext
): Promise<OpenDirectConversationResult> {
  const now = ctx.now ?? Date.now();
  const targetVal = validateTargetUserId(rawTargetUserId);
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
      message: 'امکان ایجاد گفتگوی خصوصی با خودتان وجود ندارد.',
    };
  }

  const [blocked, friends] = await Promise.all([
    isBlockedEitherWay(db, ctx.actorUserId, targetUserId),
    areAcceptedFriends(db, ctx.actorUserId, targetUserId),
  ]);

  if (blocked) {
    return {
      ok: false,
      status: 403,
      code: 'USER_BLOCKED',
      message: 'امکان گفتگو با این کاربر به دلیل مسدودیت وجود ندارد.',
    };
  }

  if (!friends) {
    return {
      ok: false,
      status: 403,
      code: 'NOT_FRIENDS',
      message: 'گفتگوی خصوصی فقط با دوستان تأییدشده امکان‌پذیر است.',
    };
  }

  const partner = await db
    .prepare(
      `SELECT
         u.user_id, u.username, u.display_name, u.avatar_code, u.avatar_url,
         u.privacy_show_online, u.presence_preference,
         CASE
           WHEN EXISTS (
             SELECT 1 FROM user_presence_sessions ups
             WHERE ups.user_id = u.user_id AND ups.expires_at > ?
           ) THEN 1 ELSE 0
         END AS has_active_presence
       FROM users u
       WHERE u.user_id = ? AND u.account_status = 'active' AND u.email_verified = 1
       LIMIT 1`
    )
    .bind(now, targetUserId)
    .first<{
      user_id: string;
      username: string;
      display_name: string;
      avatar_code: string;
      avatar_url: string | null;
      privacy_show_online: number;
      presence_preference: string;
      has_active_presence: number;
    }>();

  if (!partner) {
    return {
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      message: 'کاربر مورد نظر یافت نشد.',
    };
  }

  const directPairKey = buildCanonicalPairKey(ctx.actorUserId, targetUserId);
  let existing = await db
    .prepare(
      `SELECT conversation_id, last_message_preview, last_message_at, created_at
       FROM conversations
       WHERE direct_pair_key = ?
       LIMIT 1`
    )
    .bind(directPairKey)
    .first<{
      conversation_id: string;
      last_message_preview: string | null;
      last_message_at: number | null;
      created_at: number;
    }>();

  if (!existing) {
    const conversationId = generatePrefixedId('cnv', 12);
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO conversations (
               conversation_id, type, direct_pair_key, title, created_by,
               last_message_at, last_message_preview, created_at, updated_at
             ) VALUES (?, 'direct', ?, NULL, ?, NULL, NULL, ?, ?)`
          )
          .bind(conversationId, directPairKey, ctx.actorUserId, now, now),
        db
          .prepare(
            `INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, left_at)
             VALUES (?, ?, 'member', ?, NULL)`
          )
          .bind(conversationId, ctx.actorUserId, now),
        db
          .prepare(
            `INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, left_at)
             VALUES (?, ?, 'member', ?, NULL)`
          )
          .bind(conversationId, targetUserId, now),
      ]);
      existing = {
        conversation_id: conversationId,
        last_message_preview: null,
        last_message_at: null,
        created_at: now,
      };
    } catch {
      // Concurrent creation race: re-fetch canonical direct conversation
      existing = await db
        .prepare(
          `SELECT conversation_id, last_message_preview, last_message_at, created_at
           FROM conversations
           WHERE direct_pair_key = ?
           LIMIT 1`
        )
        .bind(directPairKey)
        .first<{
          conversation_id: string;
          last_message_preview: string | null;
          last_message_at: number | null;
          created_at: number;
        }>();
    }
  }

  if (!existing) {
    return {
      ok: false,
      status: 500,
      code: 'DATABASE_ERROR',
      message: 'خطا در ایجاد گفتگوی خصوصی.',
    };
  }

  const unreadRow = await db
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM messages m
       LEFT JOIN message_read_states rs
         ON rs.conversation_id = m.conversation_id AND rs.user_id = ?
       WHERE m.conversation_id = ?
         AND m.sender_id != ?
         AND m.deleted_at IS NULL
         AND m.created_at > COALESCE(rs.last_read_at, 0)`
    )
    .bind(ctx.actorUserId, existing.conversation_id, ctx.actorUserId)
    .first<{ cnt: number }>();

  return {
    ok: true,
    status: 200,
    conversation: {
      conversationId: existing.conversation_id,
      partner: {
        userId: partner.user_id,
        username: partner.username,
        displayName: partner.display_name,
        avatarCode: partner.avatar_code,
        avatarUrl: partner.avatar_url,
        onlineStatus: resolveOnline(
          partner.has_active_presence,
          partner.privacy_show_online,
          partner.presence_preference
        ),
      },
      lastMessagePreview: existing.last_message_preview,
      lastMessageAt: existing.last_message_at,
      unreadCount: Number(unreadRow?.cnt ?? 0),
      createdAt: existing.created_at,
    },
  };
}

/**
 * Lists all active direct conversations for `ctx.actorUserId`, strictly excluding blocked counterparties.
 */
export async function listDirectConversations(
  db: D1DatabaseLike,
  ctx: SocialRequestContext
): Promise<ChatConversationItem[]> {
  const now = ctx.now ?? Date.now();
  const res = await db
    .prepare(
      `SELECT
         c.conversation_id,
         c.last_message_preview,
         c.last_message_at,
         c.created_at,
         u.user_id,
         u.username,
         u.display_name,
         u.avatar_code,
         u.avatar_url,
         u.privacy_show_online,
         u.presence_preference,
         CASE
           WHEN EXISTS (
             SELECT 1 FROM friendships f
             WHERE f.status = 'accepted'
               AND ((f.requester_id = ? AND f.addressee_id = u.user_id)
                 OR (f.requester_id = u.user_id AND f.addressee_id = ?))
           )
           AND EXISTS (
             SELECT 1 FROM user_presence_sessions ups
             WHERE ups.user_id = u.user_id AND ups.expires_at > ?
           ) THEN 1 ELSE 0
         END AS has_active_presence,
         (
           SELECT COUNT(*)
           FROM messages m
           LEFT JOIN message_read_states rs
             ON rs.conversation_id = m.conversation_id AND rs.user_id = ?
           WHERE m.conversation_id = c.conversation_id
             AND m.sender_id != ?
             AND m.deleted_at IS NULL
             AND m.created_at > COALESCE(rs.last_read_at, 0)
         ) AS unread_count
       FROM conversations c
       INNER JOIN conversation_members cm_self
         ON cm_self.conversation_id = c.conversation_id
        AND cm_self.user_id = ?
        AND cm_self.left_at IS NULL
       INNER JOIN conversation_members cm_other
         ON cm_other.conversation_id = c.conversation_id
        AND cm_other.user_id != ?
       INNER JOIN users u
         ON u.user_id = cm_other.user_id
        AND u.account_status = 'active'
        AND u.email_verified = 1
       WHERE c.type = 'direct'
         AND NOT EXISTS (
           SELECT 1
           FROM user_blocks ub
           WHERE (ub.blocker_id = ? AND ub.blocked_id = u.user_id)
              OR (ub.blocker_id = u.user_id AND ub.blocked_id = ?)
         )
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
       LIMIT 50`
    )
    .bind(
      ctx.actorUserId,
      ctx.actorUserId,
      now,
      ctx.actorUserId,
      ctx.actorUserId,
      ctx.actorUserId,
      ctx.actorUserId,
      ctx.actorUserId,
      ctx.actorUserId
    )
    .all<{
      conversation_id: string;
      last_message_preview: string | null;
      last_message_at: number | null;
      created_at: number;
      user_id: string;
      username: string;
      display_name: string;
      avatar_code: string;
      avatar_url: string | null;
      privacy_show_online: number;
      presence_preference: string;
      has_active_presence: number;
      unread_count: number;
    }>();

  return (res.results ?? []).map((row) => ({
    conversationId: row.conversation_id,
    partner: {
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      avatarCode: row.avatar_code,
      avatarUrl: row.avatar_url,
      onlineStatus: resolveOnline(
        row.has_active_presence,
        row.privacy_show_online,
        row.presence_preference
      ),
    },
    lastMessagePreview: row.last_message_preview,
    lastMessageAt: row.last_message_at,
    unreadCount: Number(row.unread_count ?? 0),
    createdAt: row.created_at,
  }));
}

export type ListMessagesResult =
  | {
      readonly ok: true;
      readonly status: 200;
      readonly conversationId: string;
      readonly messages: ChatMessageItem[];
      readonly hasMore: boolean;
      readonly nextBefore: number | null;
      readonly partnerLastReadAt: number | null;
    }
  | SocialErrorResult;

/**
 * Fetches paginated messages for a direct conversation (chronological ascending inside page).
 * Enforces strict membership & bidirectional block checks.
 */
export async function listConversationMessages(
  db: D1DatabaseLike,
  rawConversationId: string,
  rawBefore: unknown,
  rawLimit: unknown,
  ctx: SocialRequestContext
): Promise<ListMessagesResult> {
  const conversationId = rawConversationId.trim();
  if (!CONVERSATION_ID_RE.test(conversationId)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'شناسه گفتگو نامعتبر است.',
    };
  }

  const membership = await findDirectConversationPartner(
    db,
    conversationId,
    ctx.actorUserId
  );
  if (!membership.isMember) {
    return {
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'شما مجوز دسترسی به این گفتگو را ندارید.',
    };
  }

  if (membership.partnerUserId) {
    const blocked = await isBlockedEitherWay(
      db,
      ctx.actorUserId,
      membership.partnerUserId
    );
    if (blocked) {
      return {
        ok: false,
        status: 403,
        code: 'USER_BLOCKED',
        message: 'دسترسی به این گفتگو به دلیل مسدودیت غیرفعال است.',
      };
    }
  }

  const parsedLimit = Number(rawLimit);
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(MAX_MESSAGES_LIMIT, Math.floor(parsedLimit)))
    : DEFAULT_MESSAGES_LIMIT;

  const parsedBefore =
    rawBefore !== undefined && rawBefore !== null && String(rawBefore).trim() !== ''
      ? Number(rawBefore)
      : null;
  const hasBefore =
    parsedBefore !== null && Number.isFinite(parsedBefore) && parsedBefore > 0;

  const query = hasBefore
    ? db
        .prepare(
          `SELECT message_id, conversation_id, sender_id, kind, body, client_msg_id, created_at
           FROM messages
           WHERE conversation_id = ?
             AND deleted_at IS NULL
             AND created_at < ?
           ORDER BY created_at DESC, message_id DESC
           LIMIT ?`
        )
        .bind(conversationId, Math.floor(parsedBefore!), limit + 1)
    : db
        .prepare(
          `SELECT message_id, conversation_id, sender_id, kind, body, client_msg_id, created_at
           FROM messages
           WHERE conversation_id = ?
             AND deleted_at IS NULL
           ORDER BY created_at DESC, message_id DESC
           LIMIT ?`
        )
        .bind(conversationId, limit + 1);

  const [msgRes, partnerReadRow] = await Promise.all([
    query.all<{
      message_id: string;
      conversation_id: string;
      sender_id: string;
      kind: 'text' | 'system' | 'game_invite';
      body: string;
      client_msg_id: string | null;
      created_at: number;
    }>(),
    membership.partnerUserId
      ? db
          .prepare(
            `SELECT last_read_at
             FROM message_read_states
             WHERE conversation_id = ? AND user_id = ?
             LIMIT 1`
          )
          .bind(conversationId, membership.partnerUserId)
          .first<{ last_read_at: number }>()
      : Promise.resolve(null),
  ]);

  const rawRows = msgRes.results ?? [];
  const hasMore = rawRows.length > limit;
  const sliced = hasMore ? rawRows.slice(0, limit) : rawRows;
  // Return oldest -> newest within the page for natural chat rendering
  const chronological: ChatMessageItem[] = sliced
    .reverse()
    .map((r) => ({
      messageId: r.message_id,
      conversationId: r.conversation_id,
      senderId: r.sender_id,
      kind: r.kind,
      body: r.body,
      clientMsgId: r.client_msg_id,
      createdAt: r.created_at,
    }));

  return {
    ok: true,
    status: 200,
    conversationId,
    messages: chronological,
    hasMore,
    nextBefore: chronological.length > 0 ? chronological[0].createdAt : null,
    partnerLastReadAt: partnerReadRow?.last_read_at ?? null,
  };
}

export type SendMessageResult =
  | {
      readonly ok: true;
      readonly status: number;
      readonly message: ChatMessageItem;
      readonly deduplicated: boolean;
    }
  | SocialErrorResult;

/**
 * Sends a text message inside an authorized direct conversation with:
 * - Strict membership, accepted-friendship, and bidirectional block checks.
 * - Per-user persistent rate limiting.
 * - Full idempotency via `(conversation_id, sender_id, client_msg_id)`.
 */
export async function sendDirectMessage(
  db: D1DatabaseLike,
  rawConversationId: string,
  payload: Record<string, unknown>,
  ctx: SocialRequestContext
): Promise<SendMessageResult> {
  const now = ctx.now ?? Date.now();
  const conversationId = rawConversationId.trim();
  if (!CONVERSATION_ID_RE.test(conversationId)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'شناسه گفتگو نامعتبر است.',
    };
  }

  const membership = await findDirectConversationPartner(
    db,
    conversationId,
    ctx.actorUserId
  );
  if (!membership.isMember || !membership.partnerUserId) {
    return {
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'شما عضو این گفتگو نیستید.',
    };
  }

  const [blocked, friends] = await Promise.all([
    isBlockedEitherWay(db, ctx.actorUserId, membership.partnerUserId),
    areAcceptedFriends(db, ctx.actorUserId, membership.partnerUserId),
  ]);

  if (blocked) {
    return {
      ok: false,
      status: 403,
      code: 'USER_BLOCKED',
      message: 'ارسال پیام به این کاربر به دلیل مسدودیت مجاز نیست.',
    };
  }

  if (!friends) {
    return {
      ok: false,
      status: 403,
      code: 'NOT_FRIENDS',
      message: 'ارسال پیام فقط به دوستان تأییدشده امکان‌پذیر است.',
    };
  }

  const cleanBody = sanitizeMessageBody(payload.body);
  if (!cleanBody) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: `متن پیام باید بین ۱ تا ${MAX_MESSAGE_BODY_LENGTH} کاراکتر باشد.`,
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
        message: 'شناسه یکتای پیام (clientMsgId) نامعتبر است.',
      };
    }
    clientMsgId = payload.clientMsgId.trim();

    // Idempotency fast-path: if retry of same clientMsgId, return existing message without double-counting rate limit
    const existing = await db
      .prepare(
        `SELECT message_id, conversation_id, sender_id, kind, body, client_msg_id, created_at
         FROM messages
         WHERE conversation_id = ? AND sender_id = ? AND client_msg_id = ?
         LIMIT 1`
      )
      .bind(conversationId, ctx.actorUserId, clientMsgId)
      .first<{
        message_id: string;
        conversation_id: string;
        sender_id: string;
        kind: 'text' | 'system' | 'game_invite';
        body: string;
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
          conversationId: existing.conversation_id,
          senderId: existing.sender_id,
          kind: existing.kind,
          body: existing.body,
          clientMsgId: existing.client_msg_id,
          createdAt: existing.created_at,
        },
      };
    }
  }

  const rl = await consumeRateLimitSlot(
    db,
    `chat_send:user:${ctx.actorUserId}`,
    CHAT_SEND_USER_RATE_LIMIT,
    now
  );
  if (!rl.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'سرعت ارسال پیام بیش از حد مجاز است. لطفاً کمی صبر کنید.',
      retryAfterSec: rl.retryAfterSec,
    };
  }

  const messageId = generatePrefixedId('msg', 12);
  const preview = buildMessagePreview(cleanBody);

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO messages (
             message_id, conversation_id, sender_id, kind, body, client_msg_id, created_at, deleted_at
           ) VALUES (?, ?, ?, 'text', ?, ?, ?, NULL)`
        )
        .bind(messageId, conversationId, ctx.actorUserId, cleanBody, clientMsgId, now),
      db
        .prepare(
          `UPDATE conversations
           SET last_message_at = ?, last_message_preview = ?, updated_at = ?
           WHERE conversation_id = ?`
        )
        .bind(now, preview, now, conversationId),
      db
        .prepare(
          `INSERT INTO message_read_states (
             conversation_id, user_id, last_read_message_id, last_read_at
           ) VALUES (?, ?, ?, ?)
           ON CONFLICT(conversation_id, user_id) DO UPDATE SET
             last_read_message_id = excluded.last_read_message_id,
             last_read_at = CASE
               WHEN excluded.last_read_at >= message_read_states.last_read_at
                 THEN excluded.last_read_at
               ELSE message_read_states.last_read_at
             END`
        )
        .bind(conversationId, ctx.actorUserId, messageId, now),
    ]);
  } catch (err) {
    // Handle concurrent duplicate clientMsgId race cleanly
    if (clientMsgId && isUniqueConstraintError(err)) {
      const existing = await db
        .prepare(
          `SELECT message_id, conversation_id, sender_id, kind, body, client_msg_id, created_at
           FROM messages
           WHERE conversation_id = ? AND sender_id = ? AND client_msg_id = ?
           LIMIT 1`
        )
        .bind(conversationId, ctx.actorUserId, clientMsgId)
        .first<{
          message_id: string;
          conversation_id: string;
          sender_id: string;
          kind: 'text' | 'system' | 'game_invite';
          body: string;
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
            conversationId: existing.conversation_id,
            senderId: existing.sender_id,
            kind: existing.kind,
            body: existing.body,
            clientMsgId: existing.client_msg_id,
            createdAt: existing.created_at,
          },
        };
      }
    }
    throw err;
  }

  return {
    ok: true,
    status: 201,
    deduplicated: false,
    message: {
      messageId,
      conversationId,
      senderId: ctx.actorUserId,
      kind: 'text',
      body: cleanBody,
      clientMsgId,
      createdAt: now,
    },
  };
}

export type MarkReadResult =
  | {
      readonly ok: true;
      readonly status: 200;
      readonly conversationId: string;
      readonly lastReadAt: number;
    }
  | SocialErrorResult;

/**
 * Marks messages in `conversationId` as read up to `lastReadMessageId` (or `now`).
 */
export async function markConversationRead(
  db: D1DatabaseLike,
  rawConversationId: string,
  payload: Record<string, unknown>,
  ctx: SocialRequestContext
): Promise<MarkReadResult> {
  const now = ctx.now ?? Date.now();
  const conversationId = rawConversationId.trim();
  if (!CONVERSATION_ID_RE.test(conversationId)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'شناسه گفتگو نامعتبر است.',
    };
  }

  const membership = await findDirectConversationPartner(
    db,
    conversationId,
    ctx.actorUserId
  );
  if (!membership.isMember) {
    return {
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'شما عضو این گفتگو نیستید.',
    };
  }

  if (membership.partnerUserId) {
    const blocked = await isBlockedEitherWay(
      db,
      ctx.actorUserId,
      membership.partnerUserId
    );
    if (blocked) {
      return {
        ok: false,
        status: 403,
        code: 'USER_BLOCKED',
        message: 'دسترسی به این گفتگو به دلیل مسدودیت غیرفعال است.',
      };
    }
  }

  let lastReadMessageId: string | null = null;
  let readTimestamp = now;
  if (
    payload.lastReadMessageId !== undefined &&
    payload.lastReadMessageId !== null &&
    payload.lastReadMessageId !== ''
  ) {
    if (
      typeof payload.lastReadMessageId !== 'string' ||
      !MESSAGE_ID_RE.test(payload.lastReadMessageId.trim())
    ) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_INPUT',
        message: 'شناسه پیام نامعتبر است.',
      };
    }
    const candidate = payload.lastReadMessageId.trim();
    const msgRow = await db
      .prepare(
        `SELECT message_id, created_at
         FROM messages
         WHERE message_id = ? AND conversation_id = ? AND deleted_at IS NULL
         LIMIT 1`
      )
      .bind(candidate, conversationId)
      .first<{ message_id: string; created_at: number }>();
    if (!msgRow) {
      return {
        ok: false,
        status: 404,
        code: 'NOT_FOUND',
        message: 'پیام مورد نظر در این گفتگو یافت نشد.',
      };
    }
    lastReadMessageId = msgRow.message_id;
    readTimestamp = Math.max(now, msgRow.created_at);
  }

  await db
    .prepare(
      `INSERT INTO message_read_states (
         conversation_id, user_id, last_read_message_id, last_read_at
       ) VALUES (?, ?, ?, ?)
       ON CONFLICT(conversation_id, user_id) DO UPDATE SET
         last_read_message_id = COALESCE(excluded.last_read_message_id, message_read_states.last_read_message_id),
         last_read_at = CASE
           WHEN excluded.last_read_at >= message_read_states.last_read_at
             THEN excluded.last_read_at
           ELSE message_read_states.last_read_at
         END`
    )
    .bind(conversationId, ctx.actorUserId, lastReadMessageId, readTimestamp)
    .run();

  return {
    ok: true,
    status: 200,
    conversationId,
    lastReadAt: readTimestamp,
  };
}
