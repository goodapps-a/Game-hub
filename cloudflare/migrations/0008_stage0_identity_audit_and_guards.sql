-- ============================================================================
-- Eyvan Platform — Stage 0: Identity Audit, Rename Tracking & Legacy Guards
-- Non-destructive, additive, idempotent migration (SQLite + Cloudflare D1)
--
-- Goals:
-- 1. Track when a user changes their username (`users.username_changed_at`)
--    so username rename/recycling history is auditable without altering `user_id`.
-- 2. Create `stats_identity_audit_log` to record provably invalid or ambiguous
--    legacy `match_players` / `player_stats` records without deleting any data.
-- 3. Quarantine (detach `user_id = NULL`, preserving all rows and usernames)
--    any legacy `match_players` or `player_stats` row whose match/play timestamp
--    predates the linked user's `users.created_at` (provable username-recycling
--    misattribution).
-- 4. Deterministically recalculate `user_game_stats` ONLY for `user_id`s that
--    had a provably invalid record detached in step 3, leaving all other users
--    and all historical rows completely intact.
-- ============================================================================

-- 1) Track username rename timestamp on `users` (NULL until first rename)
ALTER TABLE users ADD COLUMN username_changed_at INTEGER;

-- 2) Dedicated audit log for ambiguous / quarantined legacy identity records
CREATE TABLE IF NOT EXISTS stats_identity_audit_log (
  audit_id TEXT PRIMARY KEY,
  source_table TEXT NOT NULL CHECK (source_table IN ('match_players', 'player_stats')),
  record_key TEXT NOT NULL,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL,
  previous_user_id TEXT,
  reason TEXT NOT NULL CHECK (reason IN (
    'match_finished_before_user_created',
    'stats_played_before_user_created',
    'unlinked_legacy_match_player',
    'unlinked_legacy_player_stats'
  )),
  record_timestamp INTEGER,
  user_created_at INTEGER,
  recorded_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stats_identity_audit_table_reason
  ON stats_identity_audit_log(source_table, reason);

CREATE INDEX IF NOT EXISTS idx_stats_identity_audit_prev_user
  ON stats_identity_audit_log(previous_user_id);

-- 3A) Audit provably invalid `match_players` links where the match finished
--     STRICTLY BEFORE the linked `users` account was created.
INSERT OR IGNORE INTO stats_identity_audit_log (
  audit_id,
  source_table,
  record_key,
  username,
  username_key,
  previous_user_id,
  reason,
  record_timestamp,
  user_created_at,
  recorded_at
)
SELECT
  'mp:' || mp.match_id || ':' || mp.player_id,
  'match_players',
  mp.match_id || ':' || mp.player_id,
  mp.username,
  COALESCE(mp.username_key, lower(trim(mp.username))),
  mp.user_id,
  'match_finished_before_user_created',
  m.finished_at,
  u.created_at,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM match_players mp
INNER JOIN matches m ON m.match_id = mp.match_id
INNER JOIN users u ON u.user_id = mp.user_id
WHERE mp.user_id IS NOT NULL
  AND m.finished_at < u.created_at;

-- Detach provably invalid `match_players.user_id` without deleting the match record
UPDATE match_players
SET user_id = NULL
WHERE user_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM matches m
    INNER JOIN users u ON u.user_id = match_players.user_id
    WHERE m.match_id = match_players.match_id
      AND m.finished_at < u.created_at
  );

-- 3B) Audit provably invalid `player_stats` links where `last_played_at`
--     predates the linked `users` account creation time.
INSERT OR IGNORE INTO stats_identity_audit_log (
  audit_id,
  source_table,
  record_key,
  username,
  username_key,
  previous_user_id,
  reason,
  record_timestamp,
  user_created_at,
  recorded_at
)
SELECT
  'ps:' || ps.username,
  'player_stats',
  ps.username,
  COALESCE(ps.display_username, ps.username),
  lower(trim(ps.username)),
  ps.user_id,
  'stats_played_before_user_created',
  ps.last_played_at,
  u.created_at,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM player_stats ps
INNER JOIN users u ON u.user_id = ps.user_id
WHERE ps.user_id IS NOT NULL
  AND ps.last_played_at IS NOT NULL
  AND ps.last_played_at < u.created_at;

-- Detach provably invalid `player_stats.user_id` without deleting the legacy row
UPDATE player_stats
SET user_id = NULL
WHERE user_id IS NOT NULL
  AND last_played_at IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM users u
    WHERE u.user_id = player_stats.user_id
      AND player_stats.last_played_at < u.created_at
  );

-- 3C) Record all remaining unlinked legacy rows (`user_id IS NULL`) for operator visibility
--     (`INSERT OR IGNORE` ensures rows already logged as provably invalid above are not duplicated)
INSERT OR IGNORE INTO stats_identity_audit_log (
  audit_id,
  source_table,
  record_key,
  username,
  username_key,
  previous_user_id,
  reason,
  record_timestamp,
  user_created_at,
  recorded_at
)
SELECT
  'mp:' || mp.match_id || ':' || mp.player_id,
  'match_players',
  mp.match_id || ':' || mp.player_id,
  mp.username,
  COALESCE(mp.username_key, lower(trim(mp.username))),
  NULL,
  'unlinked_legacy_match_player',
  m.finished_at,
  NULL,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM match_players mp
LEFT JOIN matches m ON m.match_id = mp.match_id
WHERE mp.user_id IS NULL;

INSERT OR IGNORE INTO stats_identity_audit_log (
  audit_id,
  source_table,
  record_key,
  username,
  username_key,
  previous_user_id,
  reason,
  record_timestamp,
  user_created_at,
  recorded_at
)
SELECT
  'ps:' || ps.username,
  'player_stats',
  ps.username,
  COALESCE(ps.display_username, ps.username),
  lower(trim(ps.username)),
  NULL,
  'unlinked_legacy_player_stats',
  ps.last_played_at,
  NULL,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM player_stats ps
WHERE ps.user_id IS NULL;

-- 4) Recalculate `user_game_stats` ONLY for `user_id`s that actually had a provably
--    invalid record quarantined above, strictly from their valid remaining `match_players`.
DELETE FROM user_game_stats
WHERE user_id IN (
  SELECT DISTINCT previous_user_id
  FROM stats_identity_audit_log
  WHERE previous_user_id IS NOT NULL
    AND reason IN ('match_finished_before_user_created', 'stats_played_before_user_created')
);

INSERT OR REPLACE INTO user_game_stats (
  user_id,
  matches_played,
  wins,
  losses,
  kot_wins,
  hakem_kot_wins,
  last_played_at,
  updated_at
)
SELECT
  mp.user_id,
  COUNT(DISTINCT mp.match_id) AS matches_played,
  SUM(CASE WHEN mp.won = 1 THEN 1 ELSE 0 END) AS wins,
  SUM(CASE WHEN mp.won = 0 THEN 1 ELSE 0 END) AS losses,
  SUM(CASE WHEN mp.won = 1 AND m.last_win_type = 'kot' THEN 1 ELSE 0 END) AS kot_wins,
  SUM(CASE WHEN mp.won = 1 AND m.last_win_type = 'hakem_kot' THEN 1 ELSE 0 END) AS hakem_kot_wins,
  MAX(m.finished_at) AS last_played_at,
  MAX(m.finished_at) AS updated_at
FROM match_players mp
INNER JOIN matches m ON m.match_id = mp.match_id
WHERE mp.user_id IN (
  SELECT DISTINCT previous_user_id
  FROM stats_identity_audit_log
  WHERE previous_user_id IS NOT NULL
    AND reason IN ('match_finished_before_user_created', 'stats_played_before_user_created')
)
GROUP BY mp.user_id;
