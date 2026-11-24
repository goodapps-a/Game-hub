-- Stage E Migration 0013: Universal Items, Server-Authoritative Inventory, Wallets & Equipped Slots
-- Compatible with Cloudflare D1 and local SQLite (better-sqlite3).
-- Note: Do NOT wrap in explicit BEGIN/COMMIT (Cloudflare D1 and local migration runner manage transactions).

CREATE TABLE IF NOT EXISTS user_wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
  gems INTEGER NOT NULL DEFAULT 0 CHECK (gems >= 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_inventory (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL CHECK (length(trim(item_id)) >= 1),
  source TEXT NOT NULL DEFAULT 'shop_claim' CHECK (source IN ('default', 'shop_claim', 'test_mode', 'reward', 'system')),
  acquired_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_inventory_user_id
  ON user_inventory(user_id, acquired_at DESC);

CREATE TABLE IF NOT EXISTS user_equipped_items (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK (
    slot IN (
      'banner',
      'avatar',
      'avatar_frame',
      'profile_badge',
      'nameplate',
      'card_deck',
      'card_back',
      'game_effect',
      'table_skin',
      'table_background'
    )
  ),
  item_id TEXT NOT NULL CHECK (length(trim(item_id)) >= 1),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_user_equipped_items_user_id
  ON user_equipped_items(user_id);

CREATE TABLE IF NOT EXISTS user_wallet_claims (
  claim_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  request_id TEXT NOT NULL CHECK (length(trim(request_id)) >= 1),
  item_id TEXT NOT NULL CHECK (length(trim(item_id)) >= 1),
  currency TEXT NOT NULL CHECK (currency IN ('coins', 'gems')),
  effective_price INTEGER NOT NULL DEFAULT 0 CHECK (effective_price >= 0),
  reward_coins INTEGER NOT NULL DEFAULT 0 CHECK (reward_coins >= 0),
  reward_gems INTEGER NOT NULL DEFAULT 0 CHECK (reward_gems >= 0),
  test_mode INTEGER NOT NULL DEFAULT 0 CHECK (test_mode IN (0, 1)),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_user_wallet_claims_user_created
  ON user_wallet_claims(user_id, created_at DESC);
