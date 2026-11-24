-- Stage F Migration 0014: Random 6-Digit Account IDs, Shop Item Gifting, Toman Top-Up Orders & Friend Groups
-- Compatible with Cloudflare D1 and local SQLite (better-sqlite3).
-- Note: Do NOT wrap in explicit BEGIN/COMMIT (Cloudflare D1 and local migration runner manage transactions).

ALTER TABLE users ADD COLUMN account_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_account_code
  ON users(account_code);

CREATE TABLE IF NOT EXISTS gift_transactions (
  gift_id TEXT PRIMARY KEY,
  sender_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL CHECK (length(trim(item_id)) >= 1),
  currency TEXT NOT NULL CHECK (currency IN ('coins', 'gems')),
  price_paid INTEGER NOT NULL DEFAULT 0 CHECK (price_paid >= 0),
  request_id TEXT NOT NULL CHECK (length(trim(request_id)) >= 1),
  created_at INTEGER NOT NULL,
  UNIQUE (sender_user_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_gift_transactions_recipient
  ON gift_transactions(recipient_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS toman_payment_orders (
  order_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  package_id TEXT NOT NULL CHECK (length(trim(package_id)) >= 1),
  amount_toman INTEGER NOT NULL CHECK (amount_toman > 0),
  coins_amount INTEGER NOT NULL DEFAULT 0 CHECK (coins_amount >= 0),
  gems_amount INTEGER NOT NULL DEFAULT 0 CHECK (gems_amount >= 0),
  gateway_provider TEXT NOT NULL DEFAULT 'sandbox' CHECK (gateway_provider IN ('zarinpal', 'sandbox')),
  authority TEXT NOT NULL CHECK (length(trim(authority)) >= 1),
  ref_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'FAILED')),
  created_at INTEGER NOT NULL,
  verified_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_toman_orders_authority
  ON toman_payment_orders(authority);

CREATE INDEX IF NOT EXISTS idx_toman_orders_user_created
  ON toman_payment_orders(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS friend_groups (
  group_id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) >= 2),
  owner_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_friend_groups_owner
  ON friend_groups(owner_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS friend_group_members (
  group_id TEXT NOT NULL REFERENCES friend_groups(group_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_group_members_user
  ON friend_group_members(user_id, joined_at DESC);

CREATE TABLE IF NOT EXISTS group_messages (
  message_id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES friend_groups(group_id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'game_invite')),
  body TEXT NOT NULL CHECK (length(trim(body)) >= 1),
  room_code TEXT,
  game_id TEXT,
  client_msg_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (group_id, sender_id, client_msg_id)
);

CREATE INDEX IF NOT EXISTS idx_group_messages_group_created
  ON group_messages(group_id, created_at ASC, message_id ASC);
