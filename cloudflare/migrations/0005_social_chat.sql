-- Stage B Migration 0005: Social Graph (Friends, Blocks) & Messaging Schema
-- Compatible with Cloudflare D1 and local SQLite (better-sqlite3).
-- Strictly additive; does not alter any existing game or account tables.

-- 1) Bidirectional friend relationships with canonical sorted `pair_key` (`min(a,b):max(a,b)`)
CREATE TABLE IF NOT EXISTS friendships (
  friendship_id TEXT PRIMARY KEY,
  pair_key TEXT NOT NULL UNIQUE,
  requester_id TEXT NOT NULL,
  addressee_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'canceled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  responded_at INTEGER,
  CHECK (requester_id != addressee_id),
  FOREIGN KEY (requester_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (addressee_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_friendships_requester_status ON friendships(requester_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee_status ON friendships(addressee_id, status, updated_at DESC);

-- 2) User blocks (directional: blocker -> blocked)
CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id != blocked_id),
  FOREIGN KEY (blocker_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (blocked_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked_id ON user_blocks(blocked_id);

-- 3) Direct and group conversations
CREATE TABLE IF NOT EXISTS conversations (
  conversation_id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('direct', 'group')),
  direct_pair_key TEXT UNIQUE,
  title TEXT,
  avatar_code TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_message_at INTEGER,
  last_message_preview TEXT,
  CHECK (
    (type = 'direct' AND direct_pair_key IS NOT NULL)
    OR (type = 'group' AND direct_pair_key IS NULL)
  ),
  FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON conversations(last_message_at DESC);

-- 4) Conversation membership & roles
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  muted_until INTEGER,
  PRIMARY KEY (conversation_id, user_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversation_members_user_active ON conversation_members(user_id, left_at);

-- 5) Persistent chat messages with idempotency key `(conversation_id, sender_id, client_msg_id)`
CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  client_msg_id TEXT,
  body TEXT NOT NULL CHECK (length(trim(body)) > 0 AND length(body) <= 2000),
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'system', 'game_invite')),
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  deleted_at INTEGER,
  UNIQUE (conversation_id, sender_id, client_msg_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at DESC, message_id DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender_created ON messages(sender_id, created_at DESC);

-- 6) Per-user read cursor per conversation (avoids O(messages * members) read receipts)
CREATE TABLE IF NOT EXISTS message_read_states (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_read_message_id TEXT,
  last_read_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, user_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (last_read_message_id) REFERENCES messages(message_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_message_read_states_user ON message_read_states(user_id, last_read_at DESC);

-- 7) Abuse & moderation reports
CREATE TABLE IF NOT EXISTS abuse_reports (
  report_id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  target_user_id TEXT,
  conversation_id TEXT,
  message_id TEXT,
  category TEXT NOT NULL CHECK (category IN ('spam', 'harassment', 'impersonation', 'cheating', 'other')),
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  CHECK (target_user_id IS NOT NULL OR message_id IS NOT NULL),
  FOREIGN KEY (reporter_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (target_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE SET NULL,
  FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_abuse_reports_status_created ON abuse_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_abuse_reports_target_user ON abuse_reports(target_user_id);
