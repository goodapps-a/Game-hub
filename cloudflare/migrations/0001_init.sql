-- Eyvan Hokm Online — Cloudflare D1 / SQLite Schema (Optimized for D1 Free/Paid Limits)
-- Writes occur ONLY when users join/register or when a full match completes.
-- Live in-hand state lives strictly inside the Durable Object / Room Controller memory.

CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  avatar_code TEXT NOT NULL DEFAULT 'portrait',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  match_id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  winning_team TEXT NOT NULL CHECK (winning_team IN ('myTeam', 'opponentTeam')),
  team_a_score INTEGER NOT NULL,
  team_b_score INTEGER NOT NULL,
  target_score INTEGER NOT NULL,
  last_win_type TEXT NOT NULL CHECK (last_win_type IN ('normal', 'kot', 'hakem_kot')),
  hands_played INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS match_players (
  match_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  username TEXT NOT NULL,
  canonical_seat TEXT NOT NULL CHECK (canonical_seat IN ('south', 'east', 'north', 'west')),
  team TEXT NOT NULL CHECK (team IN ('myTeam', 'opponentTeam')),
  won INTEGER NOT NULL CHECK (won IN (0, 1)),
  PRIMARY KEY (match_id, canonical_seat),
  FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS player_stats (
  username TEXT PRIMARY KEY,
  matches_played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  kot_wins INTEGER NOT NULL DEFAULT 0,
  hakem_kot_wins INTEGER NOT NULL DEFAULT 0,
  last_played_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_matches_finished_at ON matches(finished_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_players_username ON match_players(username);
