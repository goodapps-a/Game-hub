import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { AUTH_COOKIE_NAME } from '../cloudflare/src/lib/auth/authCookie';
import { EmailSender } from '../cloudflare/src/lib/auth/emailService';
import { upgradeGuestAccountToRegistered } from '../cloudflare/src/lib/auth/authService';
import {
  fetchPlayerMatchHistoryByUserIdFromD1,
  fetchPlayerStatsByUserIdFromD1,
  fetchPlayerStatsFromD1,
  persistCompletedMatchToD1,
  upsertUserInD1,
} from '../cloudflare/src/lib/d1Persistence';
import { CompletedMatchRecord } from '../src/games/hokm/online/protocol';
import { createEyvanExpressApp } from './createExpressApp';
import { EyvanDatabase } from './database';
import { DEFAULT_MIGRATIONS_DIR, runDatabaseMigrations } from './migrations';
import { HokmRoomManager } from './roomManager';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function extractCookiePair(setCookie: string | null, name: string): string | null {
  if (!setCookie) return null;
  const first = setCookie.split(';')[0]?.trim() ?? '';
  return first.startsWith(`${name}=`) ? first : null;
}

function makeMatchRecord(opts: {
  matchId: string;
  roomCode?: string;
  finishedAt: number;
  lastWinType?: 'normal' | 'kot' | 'hakem_kot';
  playerUsername: string;
  playerUserId?: string;
  playerWon: boolean;
}): CompletedMatchRecord {
  const winningTeam = opts.playerWon ? 'myTeam' : 'opponentTeam';
  return {
    matchId: opts.matchId,
    roomCode: opts.roomCode ?? 'EYV123',
    startedAt: opts.finishedAt - 60_000,
    finishedAt: opts.finishedAt,
    winningTeam,
    teamAScore: opts.playerWon ? 3 : 1,
    teamBScore: opts.playerWon ? 1 : 3,
    targetScore: 3,
    lastWinType: opts.lastWinType ?? 'normal',
    handsPlayed: 4,
    players: [
      {
        playerId: `p_s_${opts.matchId}`,
        ...(opts.playerUserId ? { userId: opts.playerUserId } : {}),
        username: opts.playerUsername,
        canonicalSeat: 'south',
        team: 'myTeam',
        won: opts.playerWon,
      },
      {
        playerId: `p_n_${opts.matchId}`,
        username: 'Partner_One',
        canonicalSeat: 'north',
        team: 'myTeam',
        won: opts.playerWon,
      },
      {
        playerId: `p_e_${opts.matchId}`,
        username: 'Rival_East',
        canonicalSeat: 'east',
        team: 'opponentTeam',
        won: !opts.playerWon,
      },
      {
        playerId: `p_w_${opts.matchId}`,
        username: 'Rival_West',
        canonicalSeat: 'west',
        team: 'opponentTeam',
        won: !opts.playerWon,
      },
    ],
  };
}

describe('Part 1 — Permanent user_id Identity & Game Stats Linkage (All 12 Mandatory Tests + Recycling)', () => {
  it('1-10 & 13. Full lifecycle: register, record matches, rename #1, record match, rename #2, duplicate block, immutable user_id, match_id idempotency, username recycling', async () => {
    const tmpDir = createTempDir('eyvan-part1-lifecycle-');
    const dbPath = path.join(tmpDir, 'eyvan.sqlite');
    const db = new EyvanDatabase(dbPath);
    const roomManager = new HokmRoomManager({ db });
    const verifyTokens: string[] = [];

    const mockEmailSender: EmailSender = {
      async sendVerificationEmail(payload) {
        const hash = new URL(payload.verifyUrl).hash.replace(/^#/, '');
        const tok = new URLSearchParams(hash).get('verify-email');
        if (tok) verifyTokens.push(tok);
        return { configured: true, sent: true, provider: 'mock' };
      },
      async sendPasswordResetEmail() {
        return { configured: true, sent: true, provider: 'mock' };
      },
    };

    const { app } = createEyvanExpressApp({
      db,
      roomManager,
      emailSender: mockEmailSender,
      config: { isProduction: false },
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve())
    );
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      // [Test 1] Create central account Amir123 + another account RivalHero
      const regA = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({
          email: 'amir@example.com',
          username: 'Amir123',
          password: 'Password123',
          confirmPassword: 'Password123',
        }),
      });
      assert.equal(regA.status, 201);

      const regRival = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({
          email: 'rival@example.com',
          username: 'RivalHero',
          password: 'Password123',
          confirmPassword: 'Password123',
        }),
      });
      assert.equal(regRival.status, 201);
      assert.equal(verifyTokens.length, 2);

      // Verify & login Amir123
      const verA = await fetch(`${baseUrl}/api/auth/verify-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({ token: verifyTokens[0] }),
      });
      assert.equal(verA.status, 200);

      const loginA = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({
          identifier: 'Amir123',
          password: 'Password123',
        }),
      });
      assert.equal(loginA.status, 200);
      const loginJson = (await loginA.json()) as {
        user: { userId: string; username: string };
      };
      const permanentUserId = loginJson.user.userId;
      assert.ok(permanentUserId.startsWith('usr_'));
      const cookieA = extractCookiePair(
        loginA.headers.get('set-cookie'),
        AUTH_COOKIE_NAME
      );
      assert.ok(cookieA);

      // Unauthenticated `/api/stats/me` must return 401
      const unauthStatsMe = await fetch(`${baseUrl}/api/stats/me`);
      assert.equal(unauthStatsMe.status, 401);

      // Record 3 matches under initial username `Amir123` (2 wins including 1 kot, 1 loss)
      const m1 = makeMatchRecord({
        matchId: 'm_p1_001',
        finishedAt: 1_710_000_001_000,
        lastWinType: 'normal',
        playerUsername: 'Amir123',
        playerWon: true,
      });
      const m2 = makeMatchRecord({
        matchId: 'm_p1_002',
        finishedAt: 1_710_000_002_000,
        lastWinType: 'kot',
        playerUsername: 'Amir123',
        playerWon: true,
      });
      const m3 = makeMatchRecord({
        matchId: 'm_p1_003',
        finishedAt: 1_710_000_003_000,
        lastWinType: 'normal',
        playerUsername: 'Amir123',
        playerWon: false,
      });

      db.recordCompletedMatch(m1);
      db.recordCompletedMatch(m2);
      // Persist m3 through the Cloudflare D1 persistence function to prove 1:1 parity
      const d1Res3 = await persistCompletedMatchToD1(db.getD1Adapter(), m3);
      assert.equal(d1Res3.persisted, true);
      assert.equal(d1Res3.alreadyExisted, false);

      const statsBeforeRename = db.getPlayerStatsByUserId(permanentUserId);
      assert.ok(statsBeforeRename);
      assert.equal(statsBeforeRename.matchesPlayed, 3);
      assert.equal(statsBeforeRename.wins, 2);
      assert.equal(statsBeforeRename.losses, 1);
      assert.equal(statsBeforeRename.kotWins, 1);
      assert.equal(statsBeforeRename.hakemKotWins, 0);

      // [Test 10] Re-submitting same match_id MUST NOT double-count (both SQLite & D1 helpers)
      db.recordCompletedMatch(m1);
      const dupD1 = await persistCompletedMatchToD1(db.getD1Adapter(), m2);
      assert.equal(dupD1.alreadyExisted, true);
      const statsAfterDup = db.getPlayerStatsByUserId(permanentUserId);
      assert.equal(statsAfterDup?.matchesPlayed, 3);
      assert.equal(statsAfterDup?.wins, 2);
      assert.equal(statsAfterDup?.kotWins, 1);

      // [Test 2] Rename username #1: Amir123 -> AmirPro
      const rename1 = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Cookie: cookieA,
        },
        body: JSON.stringify({ username: 'AmirPro', avatarCode: 'turquoise' }),
      });
      assert.equal(rename1.status, 200);
      const rename1Json = (await rename1.json()) as {
        user: { userId: string; username: string };
      };
      // [Test 9] Permanent user_id never changes
      assert.equal(rename1Json.user.userId, permanentUserId);
      assert.equal(rename1Json.user.username, 'AmirPro');

      // [Test 3] Verify all previous stats are preserved under new username AND `/api/stats/me`
      const statsMe1 = await fetch(`${baseUrl}/api/stats/me`, {
        headers: { Cookie: cookieA },
      });
      assert.equal(statsMe1.status, 200);
      const statsMe1Json = (await statsMe1.json()) as {
        ok: boolean;
        stats: {
          userId: string;
          username: string;
          matchesPlayed: number;
          wins: number;
          losses: number;
          kotWins: number;
        };
      };
      assert.equal(statsMe1Json.stats.userId, permanentUserId);
      assert.equal(statsMe1Json.stats.username, 'AmirPro');
      assert.equal(statsMe1Json.stats.matchesPlayed, 3);
      assert.equal(statsMe1Json.stats.wins, 2);
      assert.equal(statsMe1Json.stats.losses, 1);
      assert.equal(statsMe1Json.stats.kotWins, 1);

      const statsByNewName = await fetch(`${baseUrl}/api/stats/AmirPro`);
      assert.equal(statsByNewName.status, 200);
      const statsByNewNameJson = (await statsByNewName.json()) as {
        userId: string;
        username: string;
        matchesPlayed: number;
        wins: number;
      };
      assert.equal(statsByNewNameJson.userId, permanentUserId);
      assert.equal(statsByNewNameJson.username, 'AmirPro');
      assert.equal(statsByNewNameJson.matchesPlayed, 3);
      assert.equal(statsByNewNameJson.wins, 2);

      // Old abandoned username `Amir123` must NOT leak Amir's stats
      const statsByOldName = await fetch(`${baseUrl}/api/stats/Amir123`);
      const statsByOldNameJson = (await statsByOldName.json()) as {
        matchesPlayed: number;
      };
      assert.equal(statsByOldNameJson.matchesPlayed, 0);

      // [Test 4 & 5] Record new match AFTER rename #1 -> must increment SAME account (`user_id`)
      const m4 = makeMatchRecord({
        matchId: 'm_p1_004',
        finishedAt: 1_710_000_004_000,
        lastWinType: 'hakem_kot',
        playerUsername: 'AmirPro',
        playerUserId: permanentUserId,
        playerWon: true,
      });
      db.recordCompletedMatch(m4);

      const d1StatsAfter4 = await fetchPlayerStatsByUserIdFromD1(
        db.getD1Adapter(),
        permanentUserId
      );
      assert.ok(d1StatsAfter4);
      assert.equal(d1StatsAfter4.userId, permanentUserId);
      assert.equal(d1StatsAfter4.username, 'AmirPro');
      assert.equal(d1StatsAfter4.matchesPlayed, 4);
      assert.equal(d1StatsAfter4.wins, 3);
      assert.equal(d1StatsAfter4.losses, 1);
      assert.equal(d1StatsAfter4.kotWins, 1);
      assert.equal(d1StatsAfter4.hakemKotWins, 1);

      // [Test 6] Rename username #2: AmirPro -> Amir.Master (also tests dot-username!)
      const rename2 = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Cookie: cookieA,
        },
        body: JSON.stringify({ username: 'Amir.Master', avatarCode: 'lapis' }),
      });
      assert.equal(rename2.status, 200);
      const rename2Json = (await rename2.json()) as {
        user: { userId: string; username: string };
      };
      assert.equal(rename2Json.user.userId, permanentUserId);
      assert.equal(rename2Json.user.username, 'Amir.Master');

      // [Test 7] Verify full stats & match history preserved after rename #2 + historical display names intact!
      const statsAfterRename2 = await fetch(`${baseUrl}/api/stats/Amir.Master`);
      assert.equal(statsAfterRename2.status, 200);
      const statsAfterRename2Json = (await statsAfterRename2.json()) as {
        userId: string;
        username: string;
        matchesPlayed: number;
        wins: number;
        losses: number;
        kotWins: number;
        hakemKotWins: number;
      };
      assert.equal(statsAfterRename2Json.userId, permanentUserId);
      assert.equal(statsAfterRename2Json.username, 'Amir.Master');
      assert.equal(statsAfterRename2Json.matchesPlayed, 4);
      assert.equal(statsAfterRename2Json.wins, 3);
      assert.equal(statsAfterRename2Json.losses, 1);
      assert.equal(statsAfterRename2Json.kotWins, 1);
      assert.equal(statsAfterRename2Json.hakemKotWins, 1);

      // Match history by permanent user_id returns ALL 4 matches AND preserves historical usernames
      const historySqlite = db.getPlayerMatchHistoryByUserId(permanentUserId, 10);
      const historyD1 = await fetchPlayerMatchHistoryByUserIdFromD1(
        db.getD1Adapter(),
        permanentUserId,
        10
      );
      assert.equal(historySqlite.length, 4);
      assert.equal(historyD1.length, 4);
      const histByMatch = new Map(
        historyD1.map((m) => [
          m.matchId,
          m.players.find((p) => p.canonicalSeat === 'south'),
        ])
      );
      assert.equal(histByMatch.get('m_p1_001')?.username, 'Amir123');
      assert.equal(histByMatch.get('m_p1_001')?.userId, permanentUserId);
      assert.equal(histByMatch.get('m_p1_004')?.username, 'AmirPro');
      assert.equal(histByMatch.get('m_p1_004')?.userId, permanentUserId);

      // [Test 8] Attempt duplicate username (case-insensitive against RivalHero -> 409)
      const dupRename = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          Cookie: cookieA,
        },
        body: JSON.stringify({ username: 'rivalhero', avatarCode: 'lapis' }),
      });
      assert.equal(dupRename.status, 409);

      // Verify Amir.Master & userId remain unchanged after rejected duplicate rename
      const meCheck = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: cookieA },
      });
      const meJson = (await meCheck.json()) as {
        user: { userId: string; username: string };
      };
      assert.equal(meJson.user.userId, permanentUserId);
      assert.equal(meJson.user.username, 'Amir.Master');

      // [Test 13 — Username Recycling Safety] Another new user registers Amir123 and plays 1 match:
      // must get their OWN independent stats without colliding with or corrupting Amir.Master!
      const regNewAmir123 = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
        },
        body: JSON.stringify({
          email: 'newamir@example.com',
          username: 'Amir123',
          password: 'Password123',
          confirmPassword: 'Password123',
        }),
      });
      assert.equal(regNewAmir123.status, 201);
      const newAmirData = (await regNewAmir123.json()) as {
        user: { userId: string };
      };
      const newUserId = newAmirData.user.userId;
      assert.notEqual(newUserId, permanentUserId);

      db.recordCompletedMatch(
        makeMatchRecord({
          matchId: 'm_p1_recycled_1',
          finishedAt: 1_710_000_009_000,
          playerUsername: 'Amir123',
          playerWon: false,
        })
      );

      const newUserStats = await fetchPlayerStatsFromD1(db.getD1Adapter(), 'Amir123');
      assert.equal(newUserStats.userId, newUserId);
      assert.equal(newUserStats.matchesPlayed, 1);
      assert.equal(newUserStats.wins, 0);
      assert.equal(newUserStats.losses, 1);

      const oldUserStatsStillIntact = await fetchPlayerStatsFromD1(
        db.getD1Adapter(),
        'Amir.Master'
      );
      assert.equal(oldUserStatsStillIntact.userId, permanentUserId);
      assert.equal(oldUserStatsStillIntact.matchesPlayed, 4);
      assert.equal(oldUserStatsStillIntact.wins, 3);
      assert.equal(oldUserStatsStillIntact.losses, 1);
    } finally {
      roomManager.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('11. Guest-to-registered upgrade preserves user_id & prior stats, and guest upsert never downgrades registered accounts', async () => {
    const tmpDir = createTempDir('eyvan-part1-guest-upgrade-');
    const dbPath = path.join(tmpDir, 'guest.sqlite');
    const db = new EyvanDatabase(dbPath);
    try {
      // Guest plays 2 matches before registering
      const guestUserId = db.upsertUser('GuestStar', 'portrait', 1_710_000_000_000);
      assert.ok(guestUserId.startsWith('usr_'));

      db.recordCompletedMatch(
        makeMatchRecord({
          matchId: 'm_guest_1',
          finishedAt: 1_710_000_001_000,
          playerUsername: 'GuestStar',
          playerUserId: guestUserId,
          playerWon: true,
          lastWinType: 'kot',
        })
      );
      db.recordCompletedMatch(
        makeMatchRecord({
          matchId: 'm_guest_2',
          finishedAt: 1_710_000_002_000,
          playerUsername: 'GuestStar',
          playerUserId: guestUserId,
          playerWon: false,
        })
      );

      // Upgrade THAT guest account in-place to a registered central account with a new username!
      const upgradeRes = await upgradeGuestAccountToRegistered(
        db.getD1Adapter(),
        guestUserId,
        {
          email: 'gueststar@example.com',
          username: 'StarRegistered',
          password: 'Password123',
          confirmPassword: 'Password123',
        },
        {
          clientIp: '127.0.0.1',
          userAgent: 'test-agent',
          now: 1_710_000_010_000,
        }
      );
      assert.equal(upgradeRes.ok, true);
      if (upgradeRes.ok) {
        assert.equal(upgradeRes.user.userId, guestUserId);
        assert.equal(upgradeRes.user.username, 'StarRegistered');
        assert.equal(upgradeRes.user.accountStatus, 'pending_verification');
      }

      // All prior guest stats & history MUST stay linked to the SAME user_id under the new username!
      const stats = db.getPlayerStats('StarRegistered');
      assert.equal(stats.userId, guestUserId);
      assert.equal(stats.matchesPlayed, 2);
      assert.equal(stats.wins, 1);
      assert.equal(stats.losses, 1);
      assert.equal(stats.kotWins, 1);

      const history = db.getPlayerMatchHistoryByUserId(guestUserId, 10);
      assert.equal(history.length, 2);

      // Subsequent guest upsert with same username must NEVER downgrade the registered account!
      const afterUpsertId = await upsertUserInD1(
        db.getD1Adapter(),
        'starregistered',
        'jade',
        1_710_000_020_000
      );
      assert.equal(afterUpsertId, guestUserId);

      const raw = new Database(dbPath, { readonly: true });
      const row = raw
        .prepare(
          `SELECT user_id, auth_provider, account_status, username FROM users WHERE user_id = ?`
        )
        .get(guestUserId) as {
        user_id: string;
        auth_provider: string;
        account_status: string;
        username: string;
      };
      raw.close();
      assert.equal(row.auth_provider, 'password');
      assert.equal(row.account_status, 'pending_verification');
      assert.equal(row.username, 'StarRegistered');
    } finally {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('12. Legacy pre-0006 migration consolidates split stats into user_game_stats without losing or guessing unlinked rows', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    try {
      // Apply only migrations 0001..0005 to simulate a pre-0006 production database
      const pre0006Files = [
        '0001_init.sql',
        '0002_indexes.sql',
        '0003_username_canonical_key.sql',
        '0004_accounts_auth.sql',
        '0005_social_chat.sql',
      ];
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name TEXT PRIMARY KEY,
          applied_at INTEGER NOT NULL
        );
      `);
      for (const f of pre0006Files) {
        const sql = fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, f), 'utf8');
        db.exec(sql);
        db.prepare(
          `INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`
        ).run(f, 1_700_000_000_000);
      }

      const now = 1_700_000_000_000;
      // Seed 1 active user who had already renamed from old_amir -> new_amir BEFORE 0006
      // leaving TWO split rows in `player_stats` (one with user_id set, one with user_id NULL matching new_amir)
      db.prepare(
        `INSERT INTO users (
           user_id, username, username_key, display_name, email, email_key, email_verified,
           avatar_code, auth_provider, account_status, created_at, last_seen_at, updated_at
         ) VALUES ('usr_legacy_amir', 'NewAmir', 'newamir', 'NewAmir', 'na@example.com', 'na@example.com', 1, 'portrait', 'password', 'active', ?, ?, ?)`
      ).run(now, now, now);

      // Split row 1 (from before rename, had user_id = usr_legacy_amir)
      db.prepare(
        `INSERT INTO player_stats (username, display_username, user_id, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at)
         VALUES ('oldamir', 'OldAmir', 'usr_legacy_amir', 3, 2, 1, 1, 0, ?)`
      ).run(now + 1000);

      // Split row 2 (from after rename, had user_id NULL, username = newamir)
      db.prepare(
        `INSERT INTO player_stats (username, display_username, user_id, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at)
         VALUES ('newamir', 'NewAmir', NULL, 2, 2, 0, 0, 1, ?)`
      ).run(now + 5000);

      // Orphaned legacy row with NO matching user in `users` — MUST NOT be deleted or guessed!
      db.prepare(
        `INSERT INTO player_stats (username, display_username, user_id, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at)
         VALUES ('ghost_legacy', 'Ghost_Legacy', NULL, 7, 5, 2, 0, 0, ?)`
      ).run(now + 2000);

      // Seed historical match + match_players (one matching user, one orphaned)
      db.prepare(
        `INSERT INTO matches (
           match_id, room_code, started_at, finished_at, winning_team,
           team_a_score, team_b_score, target_score, last_win_type, hands_played
         ) VALUES ('m_pre0006', 'OLD123', ?, ?, 'myTeam', 3, 0, 3, 'normal', 3)`
      ).run(now, now + 5000);

      db.prepare(
        `INSERT INTO match_players (match_id, player_id, username, username_key, user_id, canonical_seat, team, won)
         VALUES ('m_pre0006', 'p1', 'NewAmir', 'newamir', NULL, 'south', 'myTeam', 1)`
      ).run();
      db.prepare(
        `INSERT INTO match_players (match_id, player_id, username, username_key, user_id, canonical_seat, team, won)
         VALUES ('m_pre0006', 'p2', 'Ghost_Legacy', 'ghost_legacy', NULL, 'east', 'opponentTeam', 0)`
      ).run();

      const beforeCounts = {
        users: (db.prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number }).c,
        matches: (db.prepare(`SELECT COUNT(*) AS c FROM matches`).get() as { c: number }).c,
        matchPlayers: (db.prepare(`SELECT COUNT(*) AS c FROM match_players`).get() as { c: number }).c,
        playerStats: (db.prepare(`SELECT COUNT(*) AS c FROM player_stats`).get() as { c: number }).c,
      };

      // Run pending migrations (applies 0006+)
      const migRes = runDatabaseMigrations(db);
      assert.ok(migRes.applied.includes('0006_stats_user_id_binding.sql'));

      // Exact row counts of existing tables preserved (zero data deleted!)
      const afterCounts = {
        users: (db.prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number }).c,
        matches: (db.prepare(`SELECT COUNT(*) AS c FROM matches`).get() as { c: number }).c,
        matchPlayers: (db.prepare(`SELECT COUNT(*) AS c FROM match_players`).get() as { c: number }).c,
        playerStats: (db.prepare(`SELECT COUNT(*) AS c FROM player_stats`).get() as { c: number }).c,
      };
      assert.deepEqual(afterCounts, beforeCounts);

      // Consolidated stats for usr_legacy_amir in `user_game_stats`: 3+2=5 matches, 2+2=4 wins, 1 loss, 1 kot, 1 hakem_kot
      const consolidated = db
        .prepare(`SELECT * FROM user_game_stats WHERE user_id = 'usr_legacy_amir'`)
        .get() as {
        matches_played: number;
        wins: number;
        losses: number;
        kot_wins: number;
        hakem_kot_wins: number;
        last_played_at: number;
      };
      assert.ok(consolidated);
      assert.equal(consolidated.matches_played, 5);
      assert.equal(consolidated.wins, 4);
      assert.equal(consolidated.losses, 1);
      assert.equal(consolidated.kot_wins, 1);
      assert.equal(consolidated.hakem_kot_wins, 1);
      assert.equal(consolidated.last_played_at, now + 5000);

      // `match_players` backfilled `NewAmir` -> `usr_legacy_amir` while leaving `Ghost_Legacy` strictly NULL
      const mpAmir = db
        .prepare(`SELECT user_id FROM match_players WHERE match_id = 'm_pre0006' AND player_id = 'p1'`)
        .get() as { user_id: string | null };
      const mpGhost = db
        .prepare(`SELECT user_id FROM match_players WHERE match_id = 'm_pre0006' AND player_id = 'p2'`)
        .get() as { user_id: string | null };
      assert.equal(mpAmir.user_id, 'usr_legacy_amir');
      assert.equal(mpGhost.user_id, null);

      // Orphaned `player_stats` row remains untouched with `user_id IS NULL`
      const ghostStats = db
        .prepare(`SELECT user_id, matches_played, wins FROM player_stats WHERE username = 'ghost_legacy'`)
        .get() as { user_id: string | null; matches_played: number; wins: number };
      assert.equal(ghostStats.user_id, null);
      assert.equal(ghostStats.matches_played, 7);
      assert.equal(ghostStats.wins, 5);
    } finally {
      db.close();
    }
  });
});
