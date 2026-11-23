import {
  CompletedMatchRecord,
  PlayerOnlineStats,
  normalizeUsernameKey,
} from '../../../src/games/hokm/online/protocol';
import { Seat, TeamId } from '../../../src/games/hokm/engine/types';
import { D1DatabaseLike, D1PreparedStatementLike } from './types';

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
  user_id?: string | null;
  username: string;
  canonical_seat: Seat;
  team: TeamId;
  won: number;
}

interface D1PlayerStatsRow {
  user_id?: string | null;
  username: string;
  display_username?: string | null;
  matches_played: number;
  wins: number;
  losses: number;
  kot_wins: number;
  hakem_kot_wins: number;
  last_played_at: number | null;
}

interface D1UserLookupRow {
  user_id: string;
  username: string;
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
 * Non-fatal parameterized guest user upsert in Cloudflare D1 (aligned with migration 0004 & Stage 0).
 * Uses canonical lowercase `username_key` strictly for guest rows (`account_status = 'guest'`).
 * NEVER touches, mutates (`last_seen_at`/`updated_at`), downgrades, or returns the `user_id`
 * of any registered (non-guest) account if a guest happens to type that username.
 */
export async function upsertUserInD1(
  db: D1DatabaseLike | undefined,
  username: string,
  avatarCode: string,
  now = Date.now()
): Promise<string | null> {
  if (!db) return null;
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
         username = excluded.username,
         display_name = excluded.display_name,
         avatar_code = excluded.avatar_code,
         last_seen_at = excluded.last_seen_at,
         updated_at = excluded.updated_at
       WHERE users.account_status = 'guest'`
    )
    .bind(newUserId, displayName, canonicalKey, displayName, avatarCode, now, now, now)
    .run();

  const row = await db
    .prepare(
      `SELECT user_id
       FROM users
       WHERE username_key = ? AND account_status = 'guest'
       LIMIT 1`
    )
    .bind(canonicalKey)
    .first<{ user_id: string }>();

  return row?.user_id ?? null;
}

/**
 * Updates `last_seen_at` strictly by server-verified `user_id` (never by username lookup).
 */
export async function touchVerifiedUserLastSeenInD1(
  db: D1DatabaseLike | undefined,
  userId: string,
  now = Date.now()
): Promise<void> {
  if (!db || !userId) return;
  await db
    .prepare(`UPDATE users SET last_seen_at = ? WHERE user_id = ?`)
    .bind(now, userId)
    .run();
}

async function resolveCanonicalUserIdForMatchPlayer(
  db: D1DatabaseLike,
  player: CompletedMatchRecord['players'][number],
  now: number
): Promise<string | null> {
  // 1) Authenticated/verified seat: bind STRICTLY to the verified `user_id` if it exists.
  //    Never fall back to username lookup when an explicit `userId` was supplied.
  if (player.userId && typeof player.userId === 'string') {
    const byId = await db
      .prepare(`SELECT user_id FROM users WHERE user_id = ? LIMIT 1`)
      .bind(player.userId)
      .first<{ user_id: string }>();
    return byId?.user_id ?? null;
  }

  // 2) Unauthenticated guest seat (`player.userId == null`):
  //    A guest may ONLY bind to an existing `'guest'` account (preserving guest history &
  //    in-place upgrade flow). If `username_key` belongs to ANY registered/non-guest account,
  //    we MUST return `null` so guest matches NEVER attach to registered accounts!
  const canonicalKey = normalizeUsernameKey(player.username);
  const byKey = await db
    .prepare(
      `SELECT user_id, account_status
       FROM users
       WHERE username_key = ?
       LIMIT 1`
    )
    .bind(canonicalKey)
    .first<{ user_id: string; account_status: string }>();

  if (byKey) {
    return byKey.account_status === 'guest' ? byKey.user_id : null;
  }

  // 3) Brand-new guest username: create a dedicated guest identity (`account_status = 'guest'`)
  return upsertUserInD1(db, player.username, 'portrait', now);
}

/**
 * Strictly idempotent, atomic match completion persistence for Cloudflare D1.
 *
 * Guarantees:
 * - Only persists genuinely completed matches (caller enforces MATCH_COMPLETE + 4 players).
 * - Checks whether `match_id` already exists BEFORE updating `user_game_stats` / `player_stats`,
 *   so retries after network glitches or DO restarts NEVER double-count stats!
 * - Permanently binds match players and cumulative stats (`user_game_stats`) to immutable
 *   `users.user_id`, while preserving historical display `username` on `match_players`.
 * - Keeps legacy `player_stats` mirrored safely without ever colliding with or corrupting
 *   another `user_id`'s row if an old username is later recycled.
 * - Executes `matches`, `match_players`, `user_game_stats`, and `player_stats` in one atomic
 *   `db.batch(...)` transaction.
 */
export async function persistCompletedMatchToD1(
  db: D1DatabaseLike | undefined,
  record: CompletedMatchRecord
): Promise<{ persisted: boolean; alreadyExisted: boolean }> {
  if (!db) {
    return { persisted: false, alreadyExisted: false };
  }

  // Idempotency check: if this match_id was already committed, do NOT re-increment stats!
  const existing = await db
    .prepare(`SELECT match_id FROM matches WHERE match_id = ? LIMIT 1`)
    .bind(record.matchId)
    .first<{ match_id: string }>();

  if (existing) {
    return { persisted: true, alreadyExisted: true };
  }

  const resolvedPlayers: Array<{
    player: CompletedMatchRecord['players'][number];
    canonicalKey: string;
    displayName: string;
    userId: string | null;
  }> = [];

  for (const p of record.players) {
    const canonicalKey = normalizeUsernameKey(p.username);
    const displayName = p.username.trim();
    const userId = await resolveCanonicalUserIdForMatchPlayer(
      db,
      p,
      record.finishedAt
    );
    resolvedPlayers.push({ player: p, canonicalKey, displayName, userId });
  }

  const stmts: D1PreparedStatementLike[] = [
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

  for (const item of resolvedPlayers) {
    const { player: p, canonicalKey, displayName, userId } = item;
    const wonInt = p.won ? 1 : 0;
    const lossInt = p.won ? 0 : 1;
    const isKotWin = p.won && record.lastWinType === 'kot' ? 1 : 0;
    const isHakemKotWin = p.won && record.lastWinType === 'hakem_kot' ? 1 : 0;

    // Preserve historical display username AND permanent user_id on match_players
    stmts.push(
      db
        .prepare(
          `INSERT INTO match_players
           (match_id, player_id, username, username_key, user_id, canonical_seat, team, won)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          record.matchId,
          p.playerId,
          displayName,
          canonicalKey,
          userId,
          p.canonicalSeat,
          p.team,
          wonInt
        )
    );

    // Authoritative permanent stats keyed strictly by immutable `user_id`
    if (userId) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO user_game_stats (
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
               updated_at = excluded.updated_at`
          )
          .bind(
            userId,
            wonInt,
            lossInt,
            isKotWin,
            isHakemKotWin,
            record.finishedAt,
            record.finishedAt
          )
      );

      // Legacy compatibility mirror in `player_stats`:
      // Strictly updated ONLY when `userId` is verified/resolved (`userId !== null`),
      // so an unauthenticated guest using a registered user's username NEVER touches
      // or contaminates that registered user's `player_stats` row!
      stmts.push(
        db
          .prepare(
            `INSERT INTO player_stats
             (username, display_username, user_id, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at)
             VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
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
               last_played_at = excluded.last_played_at`
          )
          .bind(
            canonicalKey,
            displayName,
            userId,
            wonInt,
            lossInt,
            isKotWin,
            isHakemKotWin,
            record.finishedAt
          )
      );
    }
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
      `SELECT match_id, player_id, user_id, username, canonical_seat, team, won
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
      ...(p.user_id ? { userId: p.user_id } : {}),
      username: p.username,
      canonicalSeat: p.canonical_seat,
      team: p.team,
      won: p.won === 1,
    })),
  }));
}

/**
 * Fetches match history for a permanent `user_id` across ALL past & current usernames,
 * preserving the historical `username` played in each match.
 */
export async function fetchPlayerMatchHistoryByUserIdFromD1(
  db: D1DatabaseLike,
  userId: string,
  limit = 20
): Promise<CompletedMatchRecord[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const matchesRes = await db
    .prepare(
      `SELECT DISTINCT
         m.match_id, m.room_code, m.started_at, m.finished_at,
         m.winning_team, m.team_a_score, m.team_b_score, m.target_score,
         m.last_win_type, m.hands_played
       FROM matches m
       INNER JOIN match_players mp ON mp.match_id = m.match_id
       WHERE mp.user_id = ?
       ORDER BY m.finished_at DESC
       LIMIT ?`
    )
    .bind(userId, safeLimit)
    .all<D1MatchRow>();

  const rows = matchesRes.results ?? [];
  if (rows.length === 0) return [];

  const placeholders = rows.map(() => '?').join(', ');
  const matchIds = rows.map((r) => r.match_id);
  const playersRes = await db
    .prepare(
      `SELECT match_id, player_id, user_id, username, canonical_seat, team, won
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
      ...(p.user_id ? { userId: p.user_id } : {}),
      username: p.username,
      canonicalSeat: p.canonical_seat,
      team: p.team,
      won: p.won === 1,
    })),
  }));
}

/**
 * Fetches authoritative game statistics strictly by permanent immutable `user_id`.
 * Immune to username renames (1, 2, or N times).
 */
export async function fetchPlayerStatsByUserIdFromD1(
  db: D1DatabaseLike,
  userId: string
): Promise<PlayerOnlineStats | null> {
  const userRow = await db
    .prepare(`SELECT user_id, username FROM users WHERE user_id = ? LIMIT 1`)
    .bind(userId)
    .first<D1UserLookupRow>();

  if (!userRow) return null;

  const statsRow = await db
    .prepare(
      `SELECT
         user_id, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at
       FROM user_game_stats
       WHERE user_id = ?
       LIMIT 1`
    )
    .bind(userId)
    .first<Omit<D1PlayerStatsRow, 'username'>>();

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

/**
 * Fetches player stats by current username, resolving strictly through `users.username_key -> user_id -> user_game_stats`.
 * Falls back to unlinked legacy `player_stats` rows (`user_id IS NULL`) ONLY when no `users` row matches,
 * ensuring renamed users' stats follow their current username and never leak under abandoned names.
 */
export async function fetchPlayerStatsFromD1(
  db: D1DatabaseLike,
  username: string
): Promise<PlayerOnlineStats> {
  const canonicalKey = normalizeUsernameKey(username);
  const userRow = await db
    .prepare(`SELECT user_id, username FROM users WHERE username_key = ? LIMIT 1`)
    .bind(canonicalKey)
    .first<D1UserLookupRow>();

  if (userRow) {
    const byId = await fetchPlayerStatsByUserIdFromD1(db, userRow.user_id);
    if (byId) return byId;
  }

  // Fallback ONLY for unlinked legacy rows (`user_id IS NULL`) OR independent guest rows (`u.account_status = 'guest'`).
  // Never matches any registered/non-guest user's abandoned username after a rename.
  const legacyRow = await db
    .prepare(
      `SELECT
         ps.user_id, ps.username, ps.display_username,
         ps.matches_played, ps.wins, ps.losses, ps.kot_wins, ps.hakem_kot_wins, ps.last_played_at
       FROM player_stats ps
       LEFT JOIN users u ON u.user_id = ps.user_id
       WHERE ps.username = ?
         AND (ps.user_id IS NULL OR u.account_status = 'guest')
       LIMIT 1`
    )
    .bind(canonicalKey)
    .first<D1PlayerStatsRow>();

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
    userId: legacyRow.user_id ?? null,
    username: legacyRow.display_username ?? legacyRow.username,
    matchesPlayed: legacyRow.matches_played,
    wins: legacyRow.wins,
    losses: legacyRow.losses,
    kotWins: legacyRow.kot_wins,
    hakemKotWins: legacyRow.hakem_kot_wins,
    lastPlayedAt: legacyRow.last_played_at,
  };
}

export interface D1HokmLeaderboardEntry {
  userId: string;
  username: string;
  avatarCode: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  kotWins: number;
  hakemKotWins: number;
  lastPlayedAt: number | null;
}

/**
 * Fetches top Hokm players directly from permanent `user_game_stats` joined with `users`.
 */
export async function fetchHokmLeaderboardFromD1(
  db: D1DatabaseLike,
  limit = 20
): Promise<D1HokmLeaderboardEntry[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const res = await db
    .prepare(
      `SELECT
         u.user_id,
         u.username,
         u.avatar_code,
         s.matches_played,
         s.wins,
         s.losses,
         s.kot_wins,
         s.hakem_kot_wins,
         s.last_played_at
       FROM user_game_stats s
       INNER JOIN users u ON u.user_id = s.user_id
       WHERE s.matches_played > 0
         AND u.account_status != 'suspended'
       ORDER BY s.wins DESC, (s.kot_wins * 2 + s.hakem_kot_wins * 3) DESC, s.matches_played DESC, s.last_played_at DESC
       LIMIT ?`
    )
    .bind(safeLimit)
    .all<{
      user_id: string;
      username: string;
      avatar_code: string | null;
      matches_played: number;
      wins: number;
      losses: number;
      kot_wins: number;
      hakem_kot_wins: number;
      last_played_at: number | null;
    }>();

  return (res.results ?? []).map((row) => ({
    userId: row.user_id,
    username: row.username,
    avatarCode: row.avatar_code ?? 'portrait',
    matchesPlayed: row.matches_played,
    wins: row.wins,
    losses: row.losses,
    kotWins: row.kot_wins,
    hakemKotWins: row.hakem_kot_wins,
    lastPlayedAt: row.last_played_at,
  }));
}
