import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  CompletedMatchRecord,
  PlayerOnlineStats,
  normalizeUsernameKey,
} from '../src/games/hokm/online/protocol';
import { Seat, TeamId } from '../src/games/hokm/engine/types';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  display_username TEXT,
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
  username_key TEXT,
  canonical_seat TEXT NOT NULL CHECK (canonical_seat IN ('south', 'east', 'north', 'west')),
  team TEXT NOT NULL CHECK (team IN ('myTeam', 'opponentTeam')),
  won INTEGER NOT NULL CHECK (won IN (0, 1)),
  PRIMARY KEY (match_id, canonical_seat),
  FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS player_stats (
  username TEXT PRIMARY KEY,
  display_username TEXT,
  matches_played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  kot_wins INTEGER NOT NULL DEFAULT 0,
  hakem_kot_wins INTEGER NOT NULL DEFAULT 0,
  last_played_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_matches_finished_at ON matches(finished_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_room_code ON matches(room_code);
CREATE INDEX IF NOT EXISTS idx_match_players_username ON match_players(username);
`;

interface MatchRow {
  match_id: string;
  room_code: string;
  started_at: number;
  finished_at: number;
  winning_team: TeamId;
  team_a_score: number;
  team_b_score: number;
  target_score: number;
  last_win_type: 'normal' | 'kot' | 'hakem_kot';
  hands_played: number;
}

interface MatchPlayerRow {
  match_id: string;
  player_id: string;
  username: string;
  canonical_seat: Seat;
  team: TeamId;
  won: number;
}

interface PlayerStatsRow {
  username: string;
  display_username: string | null;
  matches_played: number;
  wins: number;
  losses: number;
  kot_wins: number;
  hakem_kot_wins: number;
  last_played_at: number | null;
}

/**
 * SQLite persistence layer aligned 1:1 with Cloudflare D1 migrations 0001–0003.
 * Uses canonical lowercase `username` keys with preserved `display_username` so
 * case variants (`Amir` vs `amir`) never create split/duplicate stats.
 */
export class EyvanDatabase {
  private readonly db: Database.Database;

  private readonly stmtUpsertUser: Database.Statement;
  private readonly stmtInsertMatch: Database.Statement;
  private readonly stmtInsertMatchPlayer: Database.Statement;
  private readonly stmtUpsertStats: Database.Statement;
  private readonly stmtRecentMatches: Database.Statement;
  private readonly stmtMatchPlayers: Database.Statement;
  private readonly stmtGetStats: Database.Statement;

  constructor(dbFilePath: string) {
    if (dbFilePath !== ':memory:') {
      const dir = path.dirname(dbFilePath);
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbFilePath);
    if (dbFilePath !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
    }
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);
    this.ensureCanonicalUsernameColumns();

    this.stmtUpsertUser = this.db.prepare(`
      INSERT INTO users (username, display_username, avatar_code, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        display_username = excluded.display_username,
        avatar_code = excluded.avatar_code,
        last_seen_at = excluded.last_seen_at
    `);

    this.stmtInsertMatch = this.db.prepare(`
      INSERT OR IGNORE INTO matches (
        match_id, room_code, started_at, finished_at,
        winning_team, team_a_score, team_b_score, target_score,
        last_win_type, hands_played
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtInsertMatchPlayer = this.db.prepare(`
      INSERT OR IGNORE INTO match_players (
        match_id, player_id, username, username_key, canonical_seat, team, won
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtUpsertStats = this.db.prepare(`
      INSERT INTO player_stats (
        username, display_username, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        display_username = excluded.display_username,
        matches_played = matches_played + 1,
        wins = wins + excluded.wins,
        losses = losses + excluded.losses,
        kot_wins = kot_wins + excluded.kot_wins,
        hakem_kot_wins = hakem_kot_wins + excluded.hakem_kot_wins,
        last_played_at = excluded.last_played_at
    `);

    this.stmtRecentMatches = this.db.prepare(`
      SELECT
        match_id, room_code, started_at, finished_at,
        winning_team, team_a_score, team_b_score, target_score,
        last_win_type, hands_played
      FROM matches
      ORDER BY finished_at DESC
      LIMIT ?
    `);

    this.stmtMatchPlayers = this.db.prepare(`
      SELECT match_id, player_id, username, canonical_seat, team, won
      FROM match_players
      WHERE match_id = ?
      ORDER BY canonical_seat ASC
    `);

    this.stmtGetStats = this.db.prepare(`
      SELECT
        username, display_username, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at
      FROM player_stats
      WHERE username = ?
      LIMIT 1
    `);
  }

  /**
   * Non-destructive upgrade for pre-existing local SQLite databases created before
   * migration 0003 (adds missing columns and merges any mixed-case rows safely).
   */
  private ensureCanonicalUsernameColumns(): void {
    const hasColumn = (table: string, col: string): boolean => {
      const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
      }>;
      return cols.some((c) => c.name === col);
    };

    if (!hasColumn('users', 'display_username')) {
      this.db.exec(`ALTER TABLE users ADD COLUMN display_username TEXT;`);
    }
    if (!hasColumn('player_stats', 'display_username')) {
      this.db.exec(`ALTER TABLE player_stats ADD COLUMN display_username TEXT;`);
    }
    if (!hasColumn('match_players', 'username_key')) {
      this.db.exec(`ALTER TABLE match_players ADD COLUMN username_key TEXT;`);
    }

    this.db.exec(`
      UPDATE users SET display_username = username WHERE display_username IS NULL;
      UPDATE player_stats SET display_username = username WHERE display_username IS NULL;
      UPDATE match_players SET username_key = lower(username) WHERE username_key IS NULL;
      CREATE INDEX IF NOT EXISTS idx_match_players_username_key ON match_players(username_key);
    `);

    const hasMixedUsers = this.db
      .prepare(`SELECT 1 FROM users WHERE username != lower(username) LIMIT 1`)
      .get();
    if (hasMixedUsers) {
      this.db.exec(`
        CREATE TEMP TABLE users_canon_tmp AS
        SELECT
          lower(username) AS username,
          (SELECT u2.display_username FROM users u2 WHERE lower(u2.username) = lower(users.username) ORDER BY u2.last_seen_at DESC LIMIT 1) AS display_username,
          (SELECT u2.avatar_code FROM users u2 WHERE lower(u2.username) = lower(users.username) ORDER BY u2.last_seen_at DESC LIMIT 1) AS avatar_code,
          MIN(created_at) AS created_at,
          MAX(last_seen_at) AS last_seen_at
        FROM users GROUP BY lower(username);
        DELETE FROM users;
        INSERT INTO users (username, display_username, avatar_code, created_at, last_seen_at)
        SELECT username, display_username, avatar_code, created_at, last_seen_at FROM users_canon_tmp;
        DROP TABLE users_canon_tmp;
      `);
    }

    const hasMixedStats = this.db
      .prepare(`SELECT 1 FROM player_stats WHERE username != lower(username) LIMIT 1`)
      .get();
    if (hasMixedStats) {
      this.db.exec(`
        CREATE TEMP TABLE stats_canon_tmp AS
        SELECT
          lower(username) AS username,
          (SELECT s2.display_username FROM player_stats s2 WHERE lower(s2.username) = lower(player_stats.username) ORDER BY COALESCE(s2.last_played_at, 0) DESC LIMIT 1) AS display_username,
          SUM(matches_played) AS matches_played,
          SUM(wins) AS wins,
          SUM(losses) AS losses,
          SUM(kot_wins) AS kot_wins,
          SUM(hakem_kot_wins) AS hakem_kot_wins,
          MAX(last_played_at) AS last_played_at
        FROM player_stats GROUP BY lower(username);
        DELETE FROM player_stats;
        INSERT INTO player_stats (username, display_username, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at)
        SELECT username, display_username, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at FROM stats_canon_tmp;
        DROP TABLE stats_canon_tmp;
      `);
    }
  }

  public upsertUser(username: string, avatarCode: string, now = Date.now()): void {
    const key = normalizeUsernameKey(username);
    this.stmtUpsertUser.run(key, username.trim(), avatarCode, now, now);
  }

  public recordCompletedMatch(record: CompletedMatchRecord): void {
    const tx = this.db.transaction((rec: CompletedMatchRecord) => {
      const insertRes = this.stmtInsertMatch.run(
        rec.matchId,
        rec.roomCode,
        rec.startedAt,
        rec.finishedAt,
        rec.winningTeam,
        rec.teamAScore,
        rec.teamBScore,
        rec.targetScore,
        rec.lastWinType,
        rec.handsPlayed
      );

      if (insertRes.changes === 0) {
        return;
      }

      for (const p of rec.players) {
        const key = normalizeUsernameKey(p.username);
        const displayName = p.username.trim();
        this.stmtInsertMatchPlayer.run(
          rec.matchId,
          p.playerId,
          displayName,
          key,
          p.canonicalSeat,
          p.team,
          p.won ? 1 : 0
        );

        const wonInt = p.won ? 1 : 0;
        const lossInt = p.won ? 0 : 1;
        const kotInt = p.won && rec.lastWinType === 'kot' ? 1 : 0;
        const hakemKotInt = p.won && rec.lastWinType === 'hakem_kot' ? 1 : 0;

        this.stmtUpsertStats.run(
          key,
          displayName,
          wonInt,
          lossInt,
          kotInt,
          hakemKotInt,
          rec.finishedAt
        );
      }
    });

    tx(record);
  }

  public getRecentMatches(limit = 10): CompletedMatchRecord[] {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const rows = this.stmtRecentMatches.all(safeLimit) as MatchRow[];
    return rows.map((row) => {
      const players = (
        this.stmtMatchPlayers.all(row.match_id) as MatchPlayerRow[]
      ).map((p) => ({
        playerId: p.player_id,
        username: p.username,
        canonicalSeat: p.canonical_seat,
        team: p.team,
        won: p.won === 1,
      }));

      return {
        matchId: row.match_id,
        roomCode: row.room_code,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        winningTeam: row.winning_team,
        teamAScore: row.team_a_score,
        teamBScore: row.team_b_score,
        targetScore: row.target_score,
        lastWinType: row.last_win_type,
        handsPlayed: row.hands_played,
        players,
      };
    });
  }

  public getPlayerStats(username: string): PlayerOnlineStats {
    const key = normalizeUsernameKey(username);
    const row = this.stmtGetStats.get(key) as PlayerStatsRow | undefined;
    if (!row) {
      return {
        username: username.trim(),
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        kotWins: 0,
        hakemKotWins: 0,
        lastPlayedAt: null,
      };
    }
    return {
      username: row.display_username ?? row.username,
      matchesPlayed: row.matches_played,
      wins: row.wins,
      losses: row.losses,
      kotWins: row.kot_wins,
      hakemKotWins: row.hakem_kot_wins,
      lastPlayedAt: row.last_played_at,
    };
  }

  public close(): void {
    this.db.close();
  }
}
