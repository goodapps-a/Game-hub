import {
  CompletedMatchRecord,
  PlayerOnlineStats,
} from '../../../src/games/hokm/online/protocol';
import { Seat, TeamId } from '../../../src/games/hokm/engine/types';
import { D1DatabaseLike } from './types';

interface D1MatchRow {
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

interface D1MatchPlayerRow {
  match_id: string;
  player_id: string;
  username: string;
  canonical_seat: Seat;
  team: TeamId;
  won: number;
}

interface D1PlayerStatsRow {
  username: string;
  matches_played: number;
  wins: number;
  losses: number;
  kot_wins: number;
  hakem_kot_wins: number;
  last_played_at: number | null;
}

/**
 * Non-fatal parameterized user upsert in Cloudflare D1.
 */
export async function upsertUserInD1(
  db: D1DatabaseLike | undefined,
  username: string,
  avatarCode: string,
  now = Date.now()
): Promise<void> {
  if (!db) return;
  await db
    .prepare(
      `INSERT INTO users (username, avatar_code, created_at, last_seen_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(username) DO UPDATE SET
         avatar_code = excluded.avatar_code,
         last_seen_at = excluded.last_seen_at`
    )
    .bind(username, avatarCode, now, now)
    .run();
}

/**
 * Strictly idempotent, atomic match completion persistence for Cloudflare D1.
 *
 * Guarantees:
 * - Only persists genuinely completed matches (caller enforces MATCH_COMPLETE + 4 players).
 * - Checks whether `match_id` already exists BEFORE updating `player_stats`, so retries
 *   after network glitches or DO restarts NEVER double-count wins/losses/kot stats!
 * - Executes `matches`, `match_players`, and `player_stats` in one atomic `db.batch(...)`
 *   transaction (all succeed or all roll back cleanly).
 */
export async function persistCompletedMatchToD1(
  db: D1DatabaseLike | undefined,
  record: CompletedMatchRecord
): Promise<{ persisted: boolean; alreadyExisted: boolean }> {
  if (!db) {
    return { persisted: false, alreadyExisted: false };
  }

  // Idempotency check: if this match_id was already committed, do NOT re-increment player_stats!
  const existing = await db
    .prepare(`SELECT match_id FROM matches WHERE match_id = ? LIMIT 1`)
    .bind(record.matchId)
    .first<{ match_id: string }>();

  if (existing) {
    return { persisted: true, alreadyExisted: true };
  }

  const stmts = [
    db
      .prepare(
        `INSERT INTO matches
         (match_id, room_code, started_at, finished_at, winning_team, team_a_score, team_b_score, target_score, last_win_type, hands_played)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        record.matchId,
        record.roomCode,
        record.startedAt,
        record.finishedAt,
        record.winningTeam,
        record.teamAScore,
        record.teamBScore,
        record.targetScore,
        record.lastWinType,
        record.handsPlayed
      ),
  ];

  for (const p of record.players) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO match_players
           (match_id, player_id, username, canonical_seat, team, won)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(
          record.matchId,
          p.playerId,
          p.username,
          p.canonicalSeat,
          p.team,
          p.won ? 1 : 0
        )
    );

    const isKotWin = p.won && record.lastWinType === 'kot' ? 1 : 0;
    const isHakemKotWin = p.won && record.lastWinType === 'hakem_kot' ? 1 : 0;
    stmts.push(
      db
        .prepare(
          `INSERT INTO player_stats
           (username, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at)
           VALUES (?, 1, ?, ?, ?, ?, ?)
           ON CONFLICT(username) DO UPDATE SET
             matches_played = matches_played + 1,
             wins = wins + excluded.wins,
             losses = losses + excluded.losses,
             kot_wins = kot_wins + excluded.kot_wins,
             hakem_kot_wins = hakem_kot_wins + excluded.hakem_kot_wins,
             last_played_at = excluded.last_played_at`
        )
        .bind(
          p.username,
          p.won ? 1 : 0,
          p.won ? 0 : 1,
          isKotWin,
          isHakemKotWin,
          record.finishedAt
        )
    );
  }

  await db.batch(stmts);
  return { persisted: true, alreadyExisted: false };
}

/**
 * Fetches recent completed matches with their 4-player rosters in the exact
 * camelCase `CompletedMatchRecord` shape expected by the frontend.
 */
export async function fetchRecentMatchesFromD1(
  db: D1DatabaseLike,
  limit = 10
): Promise<CompletedMatchRecord[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const matchesRes = await db
    .prepare(
      `SELECT
         match_id, room_code, started_at, finished_at,
         winning_team, team_a_score, team_b_score, target_score,
         last_win_type, hands_played
       FROM matches
       ORDER BY finished_at DESC
       LIMIT ?`
    )
    .bind(safeLimit)
    .all<D1MatchRow>();

  const rows = matchesRes.results ?? [];
  if (rows.length === 0) return [];

  // Batch-fetch players for all returned matches cleanly using parameterized IN (?, ?, ...)
  const placeholders = rows.map(() => '?').join(', ');
  const matchIds = rows.map((r) => r.match_id);
  const playersRes = await db
    .prepare(
      `SELECT match_id, player_id, username, canonical_seat, team, won
       FROM match_players
       WHERE match_id IN (${placeholders})
       ORDER BY canonical_seat ASC`
    )
    .bind(...matchIds)
    .all<D1MatchPlayerRow>();

  const playersByMatch = new Map<string, D1MatchPlayerRow[]>();
  for (const p of playersRes.results ?? []) {
    const list = playersByMatch.get(p.match_id) ?? [];
    list.push(p);
    playersByMatch.set(p.match_id, list);
  }

  return rows.map((row) => ({
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
    players: (playersByMatch.get(row.match_id) ?? []).map((p) => ({
      playerId: p.player_id,
      username: p.username,
      canonicalSeat: p.canonical_seat,
      team: p.team,
      won: p.won === 1,
    })),
  }));
}

/**
 * Fetches case-insensitive player stats in the exact `PlayerOnlineStats` camelCase shape.
 */
export async function fetchPlayerStatsFromD1(
  db: D1DatabaseLike,
  username: string
): Promise<PlayerOnlineStats> {
  const row = await db
    .prepare(
      `SELECT
         username, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at
       FROM player_stats
       WHERE lower(username) = lower(?)
       LIMIT 1`
    )
    .bind(username)
    .first<D1PlayerStatsRow>();

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
