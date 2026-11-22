-- Eyvan Stage D1: Multi-Device Online Presence Sessions & Search Index
-- Additive, non-destructive migration compatible with Cloudflare D1 and local SQLite.
-- Reuses existing `users` privacy columns (0004) and `friendships` / `user_blocks` (0005).

-- 1) Multi-device leased online presence table (no fake online status; strict TTL expiry)
CREATE TABLE IF NOT EXISTS user_presence_sessions (
  device_session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  auth_session_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'online'
    CHECK (status IN ('online', 'away', 'busy')),
  last_heartbeat_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (auth_session_id) REFERENCES auth_sessions(session_id) ON DELETE CASCADE
);

-- Fast online-status lookups across a user's active unexpired devices
CREATE INDEX IF NOT EXISTS idx_user_presence_user_expires
  ON user_presence_sessions(user_id, expires_at DESC);

-- Fast bounded pruning of expired leases (Worker Cron Trigger + server maintenance)
CREATE INDEX IF NOT EXISTS idx_user_presence_expires
  ON user_presence_sessions(expires_at);

-- Fast immediate presence cleanup when an auth session is revoked on logout
CREATE INDEX IF NOT EXISTS idx_user_presence_auth_session
  ON user_presence_sessions(auth_session_id);

-- 2) Composite index for fast active-account case-insensitive username search
CREATE INDEX IF NOT EXISTS idx_users_status_username_key
  ON users(account_status, username_key);
