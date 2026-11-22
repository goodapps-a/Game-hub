-- Migration 0010: Security & Concurrency Hardening for Google OAuth & Game Invites
-- Compatible with Cloudflare D1 and local SQLite (better-sqlite3).
-- Strictly additive & non-destructive:
--   * Never modifies or deletes historical users, matches, stats, messages, or invites.
--   * Adds browser-binding hash (`browser_binding_hash`) and validated opener origin
--     (`opener_origin`) to `oauth_states` to prevent cross-browser Login CSRF & wildcard postMessage.
--   * Deduplicates any pre-existing duplicate pending `game_invites` rows cleanly (marking
--     older duplicates 'canceled' while keeping the newest row) and enforces a DB-level
--     partial UNIQUE index on `(room_code, inviter_id, invitee_id) WHERE status = 'pending'`.
-- Note: Do NOT wrap in explicit BEGIN/COMMIT (Cloudflare D1 and local migration runner manage transactions).

-- 1) Browser-binding token hash (SHA-256) & strict opener origin for Google OAuth flows
ALTER TABLE oauth_states ADD COLUMN browser_binding_hash TEXT;
ALTER TABLE oauth_states ADD COLUMN opener_origin TEXT;

-- 2) Non-destructively reconcile any pre-existing duplicate pending invites before creating UNIQUE index
UPDATE game_invites
SET status = 'canceled',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE status = 'pending'
  AND rowid NOT IN (
    SELECT MAX(rowid)
    FROM game_invites
    WHERE status = 'pending'
    GROUP BY room_code, inviter_id, invitee_id
  );

-- 3) DB-level atomic uniqueness guarantee for pending invites per (room_code, inviter_id, invitee_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_game_invites_pending_pair_room
  ON game_invites(room_code, inviter_id, invitee_id)
  WHERE status = 'pending';
