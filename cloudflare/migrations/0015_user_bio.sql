-- Stage F Migration 0015: User Profile Bio
-- Compatible with Cloudflare D1 and local SQLite (better-sqlite3).
-- Strictly additive; does not alter any existing rows.

ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
