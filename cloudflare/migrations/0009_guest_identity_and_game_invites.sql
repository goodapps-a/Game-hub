-- Migration 0009: Independent Server-Side Guest Sessions, OAuth Linking Metadata & Real-Room Game Invites
-- Compatible with Cloudflare D1 and local SQLite (better-sqlite3).
-- Strictly additive & non-destructive:
--   * Never deletes or overwrites historical users, matches, match_players, or stats.
--   * Adds `guest_sessions` for server-verified HttpOnly guest identity isolation.
--   * Extends `oauth_states` with flow mode (`login` | `link`) and initiator metadata for C3 Google OAuth.
--   * Adds `game_invites` for Stage D3 real-room Hokm invitations with TTL & atomic state transitions.
-- Note: Do NOT wrap in explicit BEGIN/COMMIT (Cloudflare D1 and local migration runner manage transactions).

-- 1) Independent server-issued guest sessions (stores ONLY SHA-256 token hashes)
CREATE TABLE IF NOT EXISTS guest_sessions (
  guest_session_id TEXT PRIMARY KEY,
  guest_user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  CHECK (expires_at > created_at),
  FOREIGN KEY (guest_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_guest_sessions_user_id
  ON guest_sessions(guest_user_id);

CREATE INDEX IF NOT EXISTS idx_guest_sessions_expires_at
  ON guest_sessions(expires_at);

-- 2) Extend `oauth_states` for PKCE login + authenticated account linking + guest upgrade binding
ALTER TABLE oauth_states ADD COLUMN flow_mode TEXT NOT NULL DEFAULT 'login';
ALTER TABLE oauth_states ADD COLUMN initiator_user_id TEXT;
ALTER TABLE oauth_states ADD COLUMN guest_user_id TEXT;
ALTER TABLE oauth_states ADD COLUMN redirect_uri TEXT;

-- 3) Real-room game invitations (Stage D3 — linked strictly to permanent `users.user_id` & real room codes)
CREATE TABLE IF NOT EXISTS game_invites (
  invite_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL DEFAULT 'hokm' CHECK (game_id IN ('hokm')),
  room_code TEXT NOT NULL CHECK (length(room_code) BETWEEN 4 AND 8),
  inviter_id TEXT NOT NULL,
  invitee_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'accepted', 'declined', 'canceled', 'expired')
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  responded_at INTEGER,
  CHECK (inviter_id != invitee_id),
  CHECK (expires_at > created_at),
  FOREIGN KEY (inviter_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (invitee_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_game_invites_invitee
  ON game_invites(invitee_id, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_game_invites_inviter
  ON game_invites(inviter_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_game_invites_room
  ON game_invites(room_code, invitee_id, status);
