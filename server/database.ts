import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  CompletedMatchRecord,
  PlayerOnlineStats,
} from '../src/games/hokm/online/protocol';
import { Seat, TeamId } from '../src/games/hokm/engine/types';

const SCHEMA_SQL = `
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
  matches_played: number;
  wins: number;
  losses: number;
  kot_wins: number;
  hakem_kot_wins: number;
  last_played_at: number | null;
}

/**
 * SQLite persistence layer sharing the exact D1 schema (`cloudflare/migrations/0001_init.sql`).
 * Strictly parameterized statements — writes occur ONLY on user registration/join
 * and full match completion (zero per-trick write chatter).
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

    this.stmtUpsertUser = this.db.prepare(`
      INSERT INTO users (username, avatar_code, created_at, last_seen_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
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
        match_id, player_id, username, canonical_seat, team, won
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.stmtUpsertStats = this.db.prepare(`
      INSERT INTO player_stats (
        username, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at
      ) VALUES (?, 1, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
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
        username, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at
      FROM player_stats
      WHERE lower(username) = lower(?)
      LIMIT 1
    `);
  }

  public upsertUser(username: string, avatarCode: string, now = Date.now()): void {
    this.stmtUpsertUser.run(username, avatarCode, now, now);
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

      // Idempotency guard: if match_id already existed, do not double-count player_stats
      if (insertRes.changes === 0) {
        return;
      }

      for (const p of rec.players) {
        this.stmtInsertMatchPlayer.run(
          rec.matchId,
          p.playerId,
          p.username,
          p.canonicalSeat,
          p.team,
          p.won ? 1 : 0
        );

        const wonInt = p.won ? 1 : 0;
        const lossInt = p.won ? 0 : 1;
        const kotInt = p.won && rec.lastWinType === 'kot' ? 1 : 0;
        const hakemKotInt = p.won && rec.lastWinType === 'hakem_kot' ? 1 : 0;

        this.stmtUpsertStats.run(
          p.username,
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
    const row = this.stmtGetStats.get(username) as PlayerStatsRow | undefined;
    if (!row) {
      return {
        username,
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        kotWins: 0,
        hakemKotWins: 0,
        lastPlayedAt: null,
      };
    }
    return {
      username: row.username,
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
