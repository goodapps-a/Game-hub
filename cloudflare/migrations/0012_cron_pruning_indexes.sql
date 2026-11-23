-- Migration 0012: Additive Indexes for Bounded Cron / Maintenance Pruning
-- Compatible with Cloudflare D1 and local SQLite (better-sqlite3).
-- Strictly additive & non-destructive:
--   * Zero table drops, zero column alterations, zero data deletions.
--   * Adds range/partial indexes so Worker Cron Trigger (`scheduled()`) and
--     Express periodic maintenance can mark overdue pending game invites and
--     prune expired/revoked/consumed auth & invite records in bounded batches
--     without full-table scans in D1.
-- Note: Do NOT wrap in explicit BEGIN/COMMIT (Cloudflare D1 and local migration runner manage transactions).

-- 1) Partial index for pruning long-revoked auth sessions alongside existing `idx_auth_sessions_expires_at`
CREATE INDEX IF NOT EXISTS idx_auth_sessions_revoked_at
  ON auth_sessions(revoked_at)
  WHERE revoked_at IS NOT NULL;

-- 2) Partial index for pruning long-revoked guest sessions alongside existing `idx_guest_sessions_expires_at`
CREATE INDEX IF NOT EXISTS idx_guest_sessions_revoked_at
  ON guest_sessions(revoked_at)
  WHERE revoked_at IS NOT NULL;

-- 3) Partial index for pruning consumed OAuth states alongside existing `idx_oauth_states_expires_at`
CREATE INDEX IF NOT EXISTS idx_oauth_states_consumed_at
  ON oauth_states(consumed_at)
  WHERE consumed_at IS NOT NULL;

-- 4) Global expiration & consumed-at indexes for email verification & password reset tokens
CREATE INDEX IF NOT EXISTS idx_email_verification_expires_at
  ON email_verification_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_email_verification_consumed_at
  ON email_verification_tokens(consumed_at)
  WHERE consumed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_password_reset_expires_at
  ON password_reset_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_password_reset_consumed_at
  ON password_reset_tokens(consumed_at)
  WHERE consumed_at IS NOT NULL;

-- 5) Global status + timestamp indexes for overdue invite expiry & historical invite pruning
CREATE INDEX IF NOT EXISTS idx_game_invites_status_expires_at
  ON game_invites(status, expires_at);

CREATE INDEX IF NOT EXISTS idx_game_invites_status_updated_at
  ON game_invites(status, updated_at);
