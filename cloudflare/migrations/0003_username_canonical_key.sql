-- Additive, non-destructive migration:
-- Introduces canonical lowercase username keys across `users`, `player_stats`, and `match_players`
-- while preserving each player's display casing in `display_username` and safely merging any
-- pre-existing case-duplicate rows (e.g., `Amir` + `amir`) without losing historical records.

-- 1) Add display_username & username_key columns
ALTER TABLE users ADD COLUMN display_username TEXT;
UPDATE users SET display_username = username WHERE display_username IS NULL;

ALTER TABLE player_stats ADD COLUMN display_username TEXT;
UPDATE player_stats SET display_username = username WHERE display_username IS NULL;

ALTER TABLE match_players ADD COLUMN username_key TEXT;
UPDATE match_players SET username_key = lower(username) WHERE username_key IS NULL;

-- 2) Consolidate any pre-existing case-duplicate rows in `users` into canonical lowercase keys
CREATE TABLE users_canonical_tmp (
  username TEXT PRIMARY KEY,
  display_username TEXT NOT NULL,
  avatar_code TEXT NOT NULL DEFAULT 'portrait',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

INSERT INTO users_canonical_tmp (username, display_username, avatar_code, created_at, last_seen_at)
SELECT
  lower(username) AS username,
  (
    SELECT u2.display_username
    FROM users u2
    WHERE lower(u2.username) = lower(users.username)
    ORDER BY u2.last_seen_at DESC
    LIMIT 1
  ) AS display_username,
  (
    SELECT u2.avatar_code
    FROM users u2
    WHERE lower(u2.username) = lower(users.username)
    ORDER BY u2.last_seen_at DESC
    LIMIT 1
  ) AS avatar_code,
  MIN(created_at) AS created_at,
  MAX(last_seen_at) AS last_seen_at
FROM users
GROUP BY lower(username);

DELETE FROM users;

INSERT INTO users (username, display_username, avatar_code, created_at, last_seen_at)
SELECT username, display_username, avatar_code, created_at, last_seen_at
FROM users_canonical_tmp;

DROP TABLE users_canonical_tmp;

-- 3) Consolidate any pre-existing case-duplicate rows in `player_stats` without losing wins/losses
CREATE TABLE player_stats_canonical_tmp (
  username TEXT PRIMARY KEY,
  display_username TEXT NOT NULL,
  matches_played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  kot_wins INTEGER NOT NULL DEFAULT 0,
  hakem_kot_wins INTEGER NOT NULL DEFAULT 0,
  last_played_at INTEGER
);

INSERT INTO player_stats_canonical_tmp (
  username, display_username, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at
)
SELECT
  lower(username) AS username,
  (
    SELECT s2.display_username
    FROM player_stats s2
    WHERE lower(s2.username) = lower(player_stats.username)
    ORDER BY COALESCE(s2.last_played_at, 0) DESC
    LIMIT 1
  ) AS display_username,
  SUM(matches_played) AS matches_played,
  SUM(wins) AS wins,
  SUM(losses) AS losses,
  SUM(kot_wins) AS kot_wins,
  SUM(hakem_kot_wins) AS hakem_kot_wins,
  MAX(last_played_at) AS last_played_at
FROM player_stats
GROUP BY lower(username);

DELETE FROM player_stats;

INSERT INTO player_stats (
  username, display_username, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at
)
SELECT
  username, display_username, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at
FROM player_stats_canonical_tmp;

DROP TABLE player_stats_canonical_tmp;

-- 4) Index canonical username_key on match_players
CREATE INDEX IF NOT EXISTS idx_match_players_username_key ON match_players(username_key);
