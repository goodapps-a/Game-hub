-- Additive non-destructive indexes for faster D1 lookups across rooms, stats, and users.
-- Safe to apply on top of 0001_init.sql without modifying any existing table definitions.

CREATE INDEX IF NOT EXISTS idx_matches_room_code ON matches(room_code);
CREATE INDEX IF NOT EXISTS idx_player_stats_lower_username ON player_stats(lower(username));
CREATE INDEX IF NOT EXISTS idx_users_last_seen_at ON users(last_seen_at DESC);
