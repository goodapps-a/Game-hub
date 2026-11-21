-- Stage B Migration 0004: Platform Accounts, Authentication & Security Tables
-- Compatible with Cloudflare D1 and local SQLite (better-sqlite3).
-- Additive & non-destructive:
--   * Archives pre-0004 `users` rows into `legacy_users_archive` before upgrading `users`.
--   * Preserves all existing `matches`, `match_players`, and `player_stats` records untouched.
--   * Backfills `user_id` links onto `match_players` and `player_stats`.
-- Note: Do NOT wrap in explicit BEGIN/COMMIT (Cloudflare D1 and local migration runner manage transactions).

-- 1) Archive any pre-existing legacy `users` rows before upgrading the `users` table structure
CREATE TABLE IF NOT EXISTS legacy_users_archive (
  username TEXT PRIMARY KEY,
  display_username TEXT,
  avatar_code TEXT NOT NULL DEFAULT 'portrait',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  archived_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO legacy_users_archive (
  username,
  display_username,
  avatar_code,
  created_at,
  last_seen_at,
  archived_at
)
SELECT
  username,
  display_username,
  avatar_code,
  created_at,
  last_seen_at,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM users;

-- 2) Upgrade `users` table to stable UUID-style `user_id` PK + canonical `username_key` UNIQUE
CREATE TABLE users_v2 (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL CHECK (length(trim(username)) >= 1),
  username_key TEXT NOT NULL UNIQUE CHECK (length(username_key) >= 1 AND username_key = lower(trim(username_key))),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) >= 1),
  email TEXT,
  email_key TEXT UNIQUE CHECK (email_key IS NULL OR (length(email_key) >= 3 AND email_key = lower(trim(email_key)))),
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  avatar_code TEXT NOT NULL DEFAULT 'portrait',
  avatar_url TEXT,
  auth_provider TEXT NOT NULL DEFAULT 'guest' CHECK (auth_provider IN ('guest', 'password', 'google', 'hybrid')),
  account_status TEXT NOT NULL DEFAULT 'guest' CHECK (account_status IN ('guest', 'pending_verification', 'active', 'suspended', 'deleted')),
  presence_preference TEXT NOT NULL DEFAULT 'online' CHECK (presence_preference IN ('online', 'away', 'invisible')),
  privacy_show_online INTEGER NOT NULL DEFAULT 1 CHECK (privacy_show_online IN (0, 1)),
  privacy_allow_friend_requests INTEGER NOT NULL DEFAULT 1 CHECK (privacy_allow_friend_requests IN (0, 1)),
  privacy_allow_dm_from TEXT NOT NULL DEFAULT 'friends' CHECK (privacy_allow_dm_from IN ('friends', 'everyone', 'nobody')),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO users_v2 (
  user_id,
  username,
  username_key,
  display_name,
  email,
  email_key,
  email_verified,
  avatar_code,
  avatar_url,
  auth_provider,
  account_status,
  presence_preference,
  privacy_show_online,
  privacy_allow_friend_requests,
  privacy_allow_dm_from,
  created_at,
  last_seen_at,
  updated_at
)
SELECT
  'usr_' || lower(hex(randomblob(12))),
  COALESCE(NULLIF(trim(display_username), ''), trim(username)),
  lower(trim(username)),
  COALESCE(NULLIF(trim(display_username), ''), trim(username)),
  NULL,
  NULL,
  0,
  COALESCE(NULLIF(trim(avatar_code), ''), 'portrait'),
  NULL,
  'guest',
  'guest',
  'online',
  1,
  1,
  'friends',
  created_at,
  last_seen_at,
  last_seen_at
FROM users;

DROP TABLE users;
ALTER TABLE users_v2 RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_users_last_seen_at ON users(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_account_status ON users(account_status, last_seen_at DESC);

-- 3) Reversible archive table for controlled user cleanup batches
CREATE TABLE IF NOT EXISTS user_cleanup_archive (
  archive_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  original_row_json TEXT NOT NULL,
  archived_at INTEGER NOT NULL,
  restored_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_user_cleanup_archive_batch ON user_cleanup_archive(batch_id);
CREATE INDEX IF NOT EXISTS idx_user_cleanup_archive_username_key ON user_cleanup_archive(username_key);

-- 4) Authentication identities (Password & Google OAuth — linked to platform users)
CREATE TABLE IF NOT EXISTS auth_identities (
  identity_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('password', 'google')),
  provider_subject TEXT NOT NULL,
  password_hash TEXT,
  password_salt TEXT,
  password_algo TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (provider, provider_subject),
  UNIQUE (user_id, provider),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_identities_user_id ON auth_identities(user_id);

-- 5) Server-validated account sessions (stores ONLY SHA-256 token hashes)
CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  ip_hash TEXT,
  user_agent_hash TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  CHECK (expires_at > created_at),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

-- 6) Short-lived PKCE + state + nonce records for OAuth flows
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('google')),
  code_verifier_encrypted TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  redirect_path TEXT NOT NULL DEFAULT '/',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);

-- 7) Single-use email verification tokens (hashed at rest)
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  CHECK (expires_at > created_at),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_email_verification_user_id ON email_verification_tokens(user_id, expires_at DESC);

-- 8) Single-use password reset tokens (hashed at rest)
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  CHECK (expires_at > created_at),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_password_reset_user_id ON password_reset_tokens(user_id, expires_at DESC);

-- 9) Persistent brute-force & abuse rate-limit buckets for auth endpoints
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  rate_key TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  window_started_at INTEGER NOT NULL,
  blocked_until INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_updated_at ON auth_rate_limits(updated_at);

-- 10) Link historical match_players and player_stats to `users.user_id` non-destructively
ALTER TABLE match_players ADD COLUMN user_id TEXT;
UPDATE match_players
SET user_id = (
  SELECT u.user_id
  FROM users u
  WHERE u.username_key = lower(COALESCE(match_players.username_key, match_players.username))
  LIMIT 1
)
WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_match_players_user_id ON match_players(user_id);

ALTER TABLE player_stats ADD COLUMN user_id TEXT;
UPDATE player_stats
SET user_id = (
  SELECT u.user_id
  FROM users u
  WHERE u.username_key = lower(player_stats.username)
  LIMIT 1
)
WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_player_stats_user_id ON player_stats(user_id);
