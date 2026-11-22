-- Migration 0011: Multi-Tab Google OAuth Flow Correlation, OAuth State Pruning Index,
-- and Deterministic Pending Game Invite Ordering.
-- Compatible with Cloudflare D1 and local SQLite (better-sqlite3).
-- Strictly additive & non-destructive:
--   * Never edits or drops historical migrations (0001..0010) or user/match/stat/chat records.
--   * Adds `flow_id` to `oauth_states` so concurrent Google OAuth tabs in one browser use
--     independent per-flow binding cookies (`eyvan_oauth_bind_<flowId>`) without overwriting
--     each other, while storing zero raw secrets in cookie names.
--   * Adds `idx_oauth_states_flow_id` and `idx_oauth_states_expires_at` for fast per-flow
--     cookie eviction checks and bounded periodic cleanup of expired OAuth states.
--   * Deterministically reconciles any pre-existing duplicate pending `game_invites` rows by
--     keeping strictly the newest row ordered by `(created_at DESC, rowid DESC)` (rather than
--     `rowid` alone) and re-asserts `uq_game_invites_pending_pair_room`.
-- Note: Do NOT wrap in explicit BEGIN/COMMIT (Cloudflare D1 and local migration runner manage transactions).

-- 1) Per-flow non-sensitive correlation identifier for concurrent multi-tab Google OAuth flows
ALTER TABLE oauth_states ADD COLUMN flow_id TEXT;

-- 2) Indexes for per-flow cookie correlation and bounded expiration pruning
CREATE INDEX IF NOT EXISTS idx_oauth_states_flow_id
  ON oauth_states(flow_id);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at
  ON oauth_states(expires_at);

-- 3) Deterministic pending-invite deduplication by (created_at DESC, rowid DESC)
--    Cancels any duplicate pending row for which a strictly newer pending row exists
--    with the same (room_code, inviter_id, invitee_id).
UPDATE game_invites
SET status = 'canceled',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
    responded_at = COALESCE(responded_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
WHERE status = 'pending'
  AND EXISTS (
    SELECT 1
    FROM game_invites newer
    WHERE newer.status = 'pending'
      AND newer.room_code = game_invites.room_code
      AND newer.inviter_id = game_invites.inviter_id
      AND newer.invitee_id = game_invites.invitee_id
      AND (
        newer.created_at > game_invites.created_at
        OR (
          newer.created_at = game_invites.created_at
          AND newer.rowid > game_invites.rowid
        )
      )
  );

-- 4) Re-assert DB-level partial UNIQUE constraint for pending invites per (room_code, inviter_id, invitee_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_game_invites_pending_pair_room
  ON game_invites(room_code, inviter_id, invitee_id)
  WHERE status = 'pending';
