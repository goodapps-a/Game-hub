-- Eyvan Stage P1: Canonical user_id Binding for Game Stats & Match Records
-- Non-destructive, additive migration compatible with both Cloudflare D1 and local SQLite.
--
-- Goals:
-- 1. Permanently bind game statistics to immutable `users.user_id` (`user_game_stats`),
--    so changing `username` 1, 2, or N times NEVER resets or splits player stats.
-- 2. Backfill `match_players.user_id` and `player_stats.user_id` wherever an exact
--    canonical `users.username_key` match exists — NEVER deleting or guessing unmatched rows.
-- 3. Consolidate any pre-existing split `player_stats` rows sharing the same `user_id`
--    into one authoritative row in `user_game_stats`.

-- 1) Backfill `match_players.user_id` for existing rows with exact canonical username match
UPDATE match_players
SET user_id = (
  SELECT u.user_id
  FROM users u
  WHERE u.username_key = lower(COALESCE(match_players.username_key, match_players.username))
  LIMIT 1
)
WHERE user_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM users u
    WHERE u.username_key = lower(COALESCE(match_players.username_key, match_players.username))
  );

-- 2) Backfill `player_stats.user_id` for existing rows with exact canonical username match
UPDATE player_stats
SET user_id = (
  SELECT u.user_id
  FROM users u
  WHERE u.username_key = lower(player_stats.username)
  LIMIT 1
)
WHERE user_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM users u
    WHERE u.username_key = lower(player_stats.username)
  );

-- 3) Authoritative permanent game statistics table keyed strictly by immutable `user_id`
CREATE TABLE IF NOT EXISTS user_game_stats (
  user_id TEXT PRIMARY KEY,
  matches_played INTEGER NOT NULL DEFAULT 0 CHECK (matches_played >= 0),
  wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
  kot_wins INTEGER NOT NULL DEFAULT 0 CHECK (kot_wins >= 0),
  hakem_kot_wins INTEGER NOT NULL DEFAULT 0 CHECK (hakem_kot_wins >= 0),
  last_played_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 4) Migrate & consolidate all linked `player_stats` rows into `user_game_stats` (zero data loss)
INSERT INTO user_game_stats (
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
  ps.user_id,
  SUM(ps.matches_played),
  SUM(ps.wins),
  SUM(ps.losses),
  SUM(ps.kot_wins),
  SUM(ps.hakem_kot_wins),
  MAX(ps.last_played_at),
  COALESCE(MAX(ps.last_played_at), 0)
FROM player_stats ps
INNER JOIN users u ON u.user_id = ps.user_id
WHERE ps.user_id IS NOT NULL
GROUP BY ps.user_id
ON CONFLICT(user_id) DO NOTHING;

-- 5) Performance indexes for permanent user_id stats & history queries
CREATE INDEX IF NOT EXISTS idx_user_game_stats_wins
  ON user_game_stats(wins DESC, matches_played DESC);

CREATE INDEX IF NOT EXISTS idx_match_players_user_id_match
  ON match_players(user_id, match_id);
