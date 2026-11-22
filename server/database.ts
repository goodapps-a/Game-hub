import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  CompletedMatchRecord,
  PlayerOnlineStats,
  normalizeUsernameKey,
} from '../src/games/hokm/online/protocol';
import { Seat, TeamId } from '../src/games/hokm/engine/types';
import { D1DatabaseLike } from '../cloudflare/src/lib/types';
import { runDatabaseMigrations } from './migrations';
import { SqliteD1Adapter } from './sqliteD1Adapter';

function generateUserId(): string {
  return `usr_${crypto.randomBytes(12).toString('hex')}`;
}

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
  user_id: string | null;
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

interface UserGameStatsRow {
  user_id: string;
  matches_played: number;
  wins: number;
  losses: number;
  kot_wins: number;
  hakem_kot_wins: number;
  last_played_at: number | null;
}

interface UserLookupRow {
  user_id: string;
  username: string;
}

/**
 * SQLite persistence layer aligned 1:1 with Cloudflare D1 migrations (0001–0006+).
 * Runs the exact same SQL migration files as D1 via `runDatabaseMigrations`,
 * uses canonical lowercase `username_key` on `users` without downgrading registered accounts,
 * and binds match players and cumulative statistics permanently to immutable `users.user_id`.
 */
export class EyvanDatabase {
  private readonly db: Database.Database;
  private readonly d1Adapter: SqliteD1Adapter;

  private readonly stmtUpsertUser: Database.Statement;
  private readonly stmtFindUserById: Database.Statement;
  private readonly stmtFindUserByKey: Database.Statement;
  private readonly stmtInsertMatch: Database.Statement;
  private readonly stmtInsertMatchPlayer: Database.Statement;
  private readonly stmtUpsertUserGameStats: Database.Statement;
  private readonly stmtUpsertLegacyStats: Database.Statement;
  private readonly stmtRecentMatches: Database.Statement;
  private readonly stmtUserMatches: Database.Statement;
  private readonly stmtMatchPlayers: Database.Statement;
  private readonly stmtGetUserGameStats: Database.Statement;
  private readonly stmtGetUnlinkedLegacyStats: Database.Statement;

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
    runDatabaseMigrations(this.db);
    this.d1Adapter = new SqliteD1Adapter(this.db);

    this.stmtUpsertUser = this.db.prepare(`
      INSERT INTO users (
        user_id, username, username_key, display_name,
        avatar_code, auth_provider, account_status,
        created_at, last_seen_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'guest', 'guest', ?, ?, ?)
      ON CONFLICT(username_key) DO UPDATE SET
        username = CASE WHEN users.account_status = 'guest' THEN excluded.username ELSE users.username END,
        display_name = CASE WHEN users.account_status = 'guest' THEN excluded.display_name ELSE users.display_name END,
        avatar_code = CASE WHEN users.account_status = 'guest' THEN excluded.avatar_code ELSE users.avatar_code END,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at
    `);

    this.stmtFindUserById = this.db.prepare(`
      SELECT user_id, username FROM users WHERE user_id = ? LIMIT 1
    `);

    this.stmtFindUserByKey = this.db.prepare(`
      SELECT user_id, username FROM users WHERE username_key = ? LIMIT 1
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
        match_id, player_id, username, username_key, user_id, canonical_seat, team, won
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtUpsertUserGameStats = this.db.prepare(`
      INSERT INTO user_game_stats (
        user_id, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at, updated_at
      ) VALUES (?, 1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        matches_played = matches_played + 1,
        wins = wins + excluded.wins,
        losses = losses + excluded.losses,
        kot_wins = kot_wins + excluded.kot_wins,
        hakem_kot_wins = hakem_kot_wins + excluded.hakem_kot_wins,
        last_played_at = CASE
          WHEN user_game_stats.last_played_at IS NULL OR excluded.last_played_at >= user_game_stats.last_played_at
            THEN excluded.last_played_at
          ELSE user_game_stats.last_played_at
        END,
        updated_at = excluded.updated_at
    `);

    this.stmtUpsertLegacyStats = this.db.prepare(`
      INSERT INTO player_stats (
        username, display_username, user_id, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        display_username = excluded.display_username,
        user_id = CASE
          WHEN excluded.user_id IS NOT NULL THEN excluded.user_id
          ELSE player_stats.user_id
        END,
        matches_played = CASE
          WHEN player_stats.user_id IS NOT NULL AND excluded.user_id IS NOT NULL AND player_stats.user_id != excluded.user_id
            THEN 1
          ELSE player_stats.matches_played + 1
        END,
        wins = CASE
          WHEN player_stats.user_id IS NOT NULL AND excluded.user_id IS NOT NULL AND player_stats.user_id != excluded.user_id
            THEN excluded.wins
          ELSE player_stats.wins + excluded.wins
        END,
        losses = CASE
          WHEN player_stats.user_id IS NOT NULL AND excluded.user_id IS NOT NULL AND player_stats.user_id != excluded.user_id
            THEN excluded.losses
          ELSE player_stats.losses + excluded.losses
        END,
        kot_wins = CASE
          WHEN player_stats.user_id IS NOT NULL AND excluded.user_id IS NOT NULL AND player_stats.user_id != excluded.user_id
            THEN excluded.kot_wins
          ELSE player_stats.kot_wins + excluded.kot_wins
        END,
        hakem_kot_wins = CASE
          WHEN player_stats.user_id IS NOT NULL AND excluded.user_id IS NOT NULL AND player_stats.user_id != excluded.user_id
            THEN excluded.hakem_kot_wins
          ELSE player_stats.hakem_kot_wins + excluded.hakem_kot_wins
        END,
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

    this.stmtUserMatches = this.db.prepare(`
      SELECT DISTINCT
        m.match_id, m.room_code, m.started_at, m.finished_at,
        m.winning_team, m.team_a_score, m.team_b_score, m.target_score,
        m.last_win_type, m.hands_played
      FROM matches m
      INNER JOIN match_players mp ON mp.match_id = m.match_id
      WHERE mp.user_id = ?
      ORDER BY m.finished_at DESC
      LIMIT ?
    `);

    this.stmtMatchPlayers = this.db.prepare(`
      SELECT match_id, player_id, user_id, username, canonical_seat, team, won
      FROM match_players
      WHERE match_id = ?
      ORDER BY canonical_seat ASC
    `);

    this.stmtGetUserGameStats = this.db.prepare(`
      SELECT
        user_id, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at
      FROM user_game_stats
      WHERE user_id = ?
      LIMIT 1
    `);

    this.stmtGetUnlinkedLegacyStats = this.db.prepare(`
      SELECT
        username, display_username, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at
      FROM player_stats
      WHERE username = ? AND user_id IS NULL
      LIMIT 1
    `);
  }

  public upsertUser(username: string, avatarCode: string, now = Date.now()): string {
    const key = normalizeUsernameKey(username);
    const displayName = username.trim();
    this.stmtUpsertUser.run(
      generateUserId(),
      displayName,
      key,
      displayName,
      avatarCode,
      now,
      now,
      now
    );
    const row = this.stmtFindUserByKey.get(key) as UserLookupRow;
    return row.user_id;
  }

  private resolveCanonicalUserIdForPlayer(
    player: CompletedMatchRecord['players'][number],
    now: number
  ): string {
    if (player.userId && typeof player.userId === 'string') {
      const byId = this.stmtFindUserById.get(player.userId) as UserLookupRow | undefined;
      if (byId) return byId.user_id;
    }

    const key = normalizeUsernameKey(player.username);
    const byKey = this.stmtFindUserByKey.get(key) as UserLookupRow | undefined;
    if (byKey) return byKey.user_id;

    return this.upsertUser(player.username, 'portrait', now);
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
        const userId = this.resolveCanonicalUserIdForPlayer(p, rec.finishedAt);

        const wonInt = p.won ? 1 : 0;
        const lossInt = p.won ? 0 : 1;
        const kotInt = p.won && rec.lastWinType === 'kot' ? 1 : 0;
        const hakemKotInt = p.won && rec.lastWinType === 'hakem_kot' ? 1 : 0;

        this.stmtInsertMatchPlayer.run(
          rec.matchId,
          p.playerId,
          displayName,
          key,
          userId,
          p.canonicalSeat,
          p.team,
          wonInt
        );

        this.stmtUpsertUserGameStats.run(
          userId,
          wonInt,
          lossInt,
          kotInt,
          hakemKotInt,
          rec.finishedAt,
          rec.finishedAt
        );

        this.stmtUpsertLegacyStats.run(
          key,
          displayName,
          userId,
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

  private hydrateMatches(rows: MatchRow[]): CompletedMatchRecord[] {
    return rows.map((row) => {
      const players = (
        this.stmtMatchPlayers.all(row.match_id) as MatchPlayerRow[]
      ).map((p) => ({
        playerId: p.player_id,
        ...(p.user_id ? { userId: p.user_id } : {}),
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

  public getRecentMatches(limit = 10): CompletedMatchRecord[] {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const rows = this.stmtRecentMatches.all(safeLimit) as MatchRow[];
    return this.hydrateMatches(rows);
  }

  public getPlayerMatchHistoryByUserId(
    userId: string,
    limit = 20
  ): CompletedMatchRecord[] {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const rows = this.stmtUserMatches.all(userId, safeLimit) as MatchRow[];
    return this.hydrateMatches(rows);
  }

  public getPlayerStatsByUserId(userId: string): PlayerOnlineStats | null {
    const userRow = this.stmtFindUserById.get(userId) as UserLookupRow | undefined;
    if (!userRow) return null;

    const statsRow = this.stmtGetUserGameStats.get(userId) as
      | UserGameStatsRow
      | undefined;

    if (!statsRow) {
      return {
        userId: userRow.user_id,
        username: userRow.username,
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        kotWins: 0,
        hakemKotWins: 0,
        lastPlayedAt: null,
      };
    }

    return {
      userId: userRow.user_id,
      username: userRow.username,
      matchesPlayed: statsRow.matches_played,
      wins: statsRow.wins,
      losses: statsRow.losses,
      kotWins: statsRow.kot_wins,
      hakemKotWins: statsRow.hakem_kot_wins,
      lastPlayedAt: statsRow.last_played_at,
    };
  }

  public getPlayerStats(username: string): PlayerOnlineStats {
    const key = normalizeUsernameKey(username);
    const userRow = this.stmtFindUserByKey.get(key) as UserLookupRow | undefined;
    if (userRow) {
      const byId = this.getPlayerStatsByUserId(userRow.user_id);
      if (byId) return byId;
    }

    // Fallback ONLY for legacy pre-0004 unlinked rows (`user_id IS NULL`)
    const legacyRow = this.stmtGetUnlinkedLegacyStats.get(key) as
      | PlayerStatsRow
      | undefined;
    if (!legacyRow) {
      return {
        userId: null,
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
      userId: null,
      username: legacyRow.display_username ?? legacyRow.username,
      matchesPlayed: legacyRow.matches_played,
      wins: legacyRow.wins,
      losses: legacyRow.losses,
      kotWins: legacyRow.kot_wins,
      hakemKotWins: legacyRow.hakem_kot_wins,
      lastPlayedAt: legacyRow.last_played_at,
    };
  }

  public getD1Adapter(): D1DatabaseLike {
    return this.d1Adapter;
  }

  public close(): void {
    this.db.close();
  }
}
