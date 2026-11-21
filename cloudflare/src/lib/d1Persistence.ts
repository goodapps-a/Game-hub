import {
  CompletedMatchRecord,
  PlayerOnlineStats,
  normalizeUsernameKey,
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
  display_username?: string | null;
  matches_played: number;
  wins: number;
  losses: number;
  kot_wins: number;
  hakem_kot_wins: number;
  last_played_at: number | null;
}

function generateD1UserId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return `usr_${hex}`;
}

/**
 * Non-fatal parameterized user upsert in Cloudflare D1 (aligned with migration 0004).
 * Uses canonical lowercase `username_key` as unique lookup key while preserving
 * `user_id` and NEVER overwriting/downgrading registered (non-guest) accounts.
 */
export async function upsertUserInD1(
  db: D1DatabaseLike | undefined,
  username: string,
  avatarCode: string,
  now = Date.now()
): Promise<void> {
  if (!db) return;
  const canonicalKey = normalizeUsernameKey(username);
  const displayName = username.trim();
  const newUserId = generateD1UserId();
  await db
    .prepare(
      `INSERT INTO users (
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
         updated_at = excluded.updated_at`
    )
    .bind(newUserId, displayName, canonicalKey, displayName, avatarCode, now, now, now)
    .run();
}

/**
 * Strictly idempotent, atomic match completion persistence for Cloudflare D1.
 *
 * Guarantees:
 * - Only persists genuinely completed matches (caller enforces MATCH_COMPLETE + 4 players).
 * - Checks whether `match_id` already exists BEFORE updating `player_stats`, so retries
 *   after network glitches or DO restarts NEVER double-count wins/losses/kot stats!
 * - Uses canonical lowercase `username` keys in `player_stats` (with `display_username`
 *   preserved) and links `user_id` non-destructively when a matching `users` row exists.
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
    const canonicalKey = normalizeUsernameKey(p.username);
    const displayName = p.username.trim();

    stmts.push(
      db
        .prepare(
          `INSERT INTO match_players
           (match_id, player_id, username, username_key, user_id, canonical_seat, team, won)
           VALUES (?, ?, ?, ?, (SELECT user_id FROM users WHERE username_key = ? LIMIT 1), ?, ?, ?)`
        )
        .bind(
          record.matchId,
          p.playerId,
          displayName,
          canonicalKey,
          canonicalKey,
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
           (username, display_username, user_id, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at)
           VALUES (?, ?, (SELECT user_id FROM users WHERE username_key = ? LIMIT 1), 1, ?, ?, ?, ?, ?)
           ON CONFLICT(username) DO UPDATE SET
             display_username = excluded.display_username,
             user_id = COALESCE(player_stats.user_id, excluded.user_id),
             matches_played = matches_played + 1,
             wins = wins + excluded.wins,
             losses = losses + excluded.losses,
             kot_wins = kot_wins + excluded.kot_wins,
             hakem_kot_wins = hakem_kot_wins + excluded.hakem_kot_wins,
             last_played_at = excluded.last_played_at`
        )
        .bind(
          canonicalKey,
          displayName,
          canonicalKey,
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
 * Fetches player stats by canonical lowercase username key, returning preserved `display_username`.
 */
export async function fetchPlayerStatsFromD1(
  db: D1DatabaseLike,
  username: string
): Promise<PlayerOnlineStats> {
  const canonicalKey = normalizeUsernameKey(username);
  const row = await db
    .prepare(
      `SELECT
         username, display_username, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at
       FROM player_stats
       WHERE username = ?
       LIMIT 1`
    )
    .bind(canonicalKey)
    .first<D1PlayerStatsRow>();

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
