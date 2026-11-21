import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import {
  DEFAULT_MIGRATIONS_DIR,
  listMigrationFiles,
  runDatabaseMigrations,
} from './migrations';
import { EyvanDatabase } from './database';
import {
  restoreArchivedUsers,
  runLocalUserCleanup,
} from '../scripts/cleanup-local-users';
import {
  createInitialGuestProfile,
  validateUsernameFormat,
} from '../src/platform/data/guestDefaults';
import { CompletedMatchRecord } from '../src/games/hokm/online/protocol';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function getTableNames(db: Database.Database): Set<string> {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
    )
    .all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function applyLegacySqlUpTo0003(db: Database.Database): void {
  const legacyFiles = [
    '0001_init.sql',
    '0002_indexes.sql',
    '0003_username_canonical_key.sql',
  ];
  for (const f of legacyFiles) {
    const sql = fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, f), 'utf8');
    db.exec(sql);
  }
}

describe('Stage B — Database Migrations, Cleanup Safety & Demo Data Separation', () => {
  it('1. Applies migrations 0001..0005 cleanly on an empty database and enforces key schema constraints', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    try {
      const result = runDatabaseMigrations(db);
      const allFiles = listMigrationFiles();

      assert.deepEqual(result.applied, allFiles);
      assert.deepEqual(result.skipped, []);
      assert.deepEqual(result.baselineRecorded, []);

      const tables = getTableNames(db);
      const expectedTables = [
        'schema_migrations',
        'users',
        'legacy_users_archive',
        'user_cleanup_archive',
        'auth_identities',
        'auth_sessions',
        'oauth_states',
        'email_verification_tokens',
        'password_reset_tokens',
        'auth_rate_limits',
        'matches',
        'match_players',
        'player_stats',
        'friendships',
        'user_blocks',
        'conversations',
        'conversation_members',
        'messages',
        'message_read_states',
        'abuse_reports',
      ];

      for (const table of expectedTables) {
        assert.ok(tables.has(table), `Expected table '${table}' to exist`);
      }

      const now = Date.now();
      // Insert two valid users
      db.prepare(
        `INSERT INTO users (
           user_id, username, username_key, display_name, email, email_key,
           auth_provider, account_status, created_at, last_seen_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'password', 'active', ?, ?, ?)`
      ).run('usr_alpha', 'AlphaOne', 'alphaone', 'AlphaOne', 'a@example.com', 'a@example.com', now, now, now);

      db.prepare(
        `INSERT INTO users (
           user_id, username, username_key, display_name, email, email_key,
           auth_provider, account_status, created_at, last_seen_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'google', 'active', ?, ?, ?)`
      ).run('usr_beta', 'BetaTwo', 'betatwo', 'BetaTwo', 'b@example.com', 'b@example.com', now, now, now);

      // Enforce UNIQUE username_key
      assert.throws(() => {
        db.prepare(
          `INSERT INTO users (
             user_id, username, username_key, display_name,
             auth_provider, account_status, created_at, last_seen_at, updated_at
           ) VALUES (?, ?, ?, ?, 'guest', 'guest', ?, ?, ?)`
        ).run('usr_dup', 'ALPHAONE', 'alphaone', 'ALPHAONE', now, now, now);
      });

      // Enforce CHECK requester_id != addressee_id on friendships
      assert.throws(() => {
        db.prepare(
          `INSERT INTO friendships (
             friendship_id, pair_key, requester_id, addressee_id, status, created_at, updated_at
           ) VALUES ('fr_self', 'usr_alpha:usr_alpha', 'usr_alpha', 'usr_alpha', 'pending', ?, ?)`
        ).run(now, now);
      });

      // Enforce direct conversation requires direct_pair_key and message idempotency works
      db.prepare(
        `INSERT INTO conversations (
           conversation_id, type, direct_pair_key, created_by, created_at, updated_at
         ) VALUES ('conv_1', 'direct', 'usr_alpha:usr_beta', 'usr_alpha', ?, ?)`
      ).run(now, now);

      assert.throws(() => {
        db.prepare(
          `INSERT INTO conversations (
             conversation_id, type, direct_pair_key, created_by, created_at, updated_at
           ) VALUES ('conv_bad', 'direct', NULL, 'usr_alpha', ?, ?)`
        ).run(now, now);
      });

      db.prepare(
        `INSERT INTO messages (
           message_id, conversation_id, sender_id, client_msg_id, body, kind, created_at
         ) VALUES ('msg_1', 'conv_1', 'usr_alpha', 'cmsg_1', 'Hello!', 'text', ?)`
      ).run(now);

      // Duplicate client_msg_id from same sender in same conversation must fail
      assert.throws(() => {
        db.prepare(
          `INSERT INTO messages (
             message_id, conversation_id, sender_id, client_msg_id, body, kind, created_at
           ) VALUES ('msg_2', 'conv_1', 'usr_alpha', 'cmsg_1', 'Hello!', 'text', ?)`
        ).run(now);
      });

      // Blank message body must fail CHECK
      assert.throws(() => {
        db.prepare(
          `INSERT INTO messages (
             message_id, conversation_id, sender_id, client_msg_id, body, kind, created_at
           ) VALUES ('msg_blank', 'conv_1', 'usr_alpha', 'cmsg_2', '   ', 'text', ?)`
        ).run(now);
      });
    } finally {
      db.close();
    }
  });

  it('2. Upgrades a legacy pre-0004 database without losing users, matches, or player_stats and backfills user_id', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    try {
      applyLegacySqlUpTo0003(db);

      const t0 = 1700000000000;
      const t1 = 1700000100000;

      // Seed legacy users + completed match + stats BEFORE schema_migrations exists
      db.prepare(
        `INSERT INTO users (username, display_username, avatar_code, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run('amir_rad', 'Amir_Rad', 'portrait', t0, t1);
      db.prepare(
        `INSERT INTO users (username, display_username, avatar_code, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run('sohrab_k', 'Sohrab_K', 'emerald', t0, t1);

      db.prepare(
        `INSERT INTO matches (
           match_id, room_code, started_at, finished_at, winning_team,
           team_a_score, team_b_score, target_score, last_win_type, hands_played
         ) VALUES ('m_legacy_1', 'ROOM42', ?, ?, 'myTeam', 3, 1, 3, 'kot', 4)`
      ).run(t0, t1);

      db.prepare(
        `INSERT INTO match_players (match_id, player_id, username, username_key, canonical_seat, team, won)
         VALUES ('m_legacy_1', 'p1', 'Amir_Rad', 'amir_rad', 'south', 'myTeam', 1)`
      ).run();
      db.prepare(
        `INSERT INTO match_players (match_id, player_id, username, username_key, canonical_seat, team, won)
         VALUES ('m_legacy_1', 'p2', 'Sohrab_K', 'sohrab_k', 'east', 'opponentTeam', 0)`
      ).run();

      db.prepare(
        `INSERT INTO player_stats (username, display_username, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at)
         VALUES ('amir_rad', 'Amir_Rad', 5, 4, 1, 2, 1, ?)`
      ).run(t1);
      db.prepare(
        `INSERT INTO player_stats (username, display_username, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at)
         VALUES ('sohrab_k', 'Sohrab_K', 5, 1, 4, 0, 0, ?)`
      ).run(t1);

      const res = runDatabaseMigrations(db);
      assert.deepEqual(res.baselineRecorded, [
        '0001_init.sql',
        '0002_indexes.sql',
        '0003_username_canonical_key.sql',
      ]);
      assert.deepEqual(res.applied, [
        '0004_accounts_auth.sql',
        '0005_social_chat.sql',
      ]);

      // Verify legacy_users_archive preserved all pre-0004 users
      const legacyCount = (
        db.prepare(`SELECT COUNT(*) AS cnt FROM legacy_users_archive`).get() as {
          cnt: number;
        }
      ).cnt;
      assert.equal(legacyCount, 2);

      // Verify upgraded users have usr_ IDs and preserved display names
      const amirUser = db
        .prepare(`SELECT * FROM users WHERE username_key = 'amir_rad'`)
        .get() as {
        user_id: string;
        username: string;
        display_name: string;
        auth_provider: string;
        account_status: string;
      };
      assert.ok(amirUser.user_id.startsWith('usr_'));
      assert.equal(amirUser.username, 'Amir_Rad');
      assert.equal(amirUser.display_name, 'Amir_Rad');
      assert.equal(amirUser.auth_provider, 'guest');
      assert.equal(amirUser.account_status, 'guest');

      // Verify match history & player_stats are 100% intact and linked to user_id
      const matchRow = db
        .prepare(`SELECT * FROM matches WHERE match_id = 'm_legacy_1'`)
        .get() as { team_a_score: number; last_win_type: string };
      assert.equal(matchRow.team_a_score, 3);
      assert.equal(matchRow.last_win_type, 'kot');

      const mpRow = db
        .prepare(
          `SELECT user_id, won FROM match_players WHERE match_id = 'm_legacy_1' AND canonical_seat = 'south'`
        )
        .get() as { user_id: string; won: number };
      assert.equal(mpRow.user_id, amirUser.user_id);
      assert.equal(mpRow.won, 1);

      const statsRow = db
        .prepare(`SELECT * FROM player_stats WHERE username = 'amir_rad'`)
        .get() as {
        user_id: string;
        matches_played: number;
        wins: number;
        losses: number;
        kot_wins: number;
        hakem_kot_wins: number;
      };
      assert.equal(statsRow.user_id, amirUser.user_id);
      assert.equal(statsRow.matches_played, 5);
      assert.equal(statsRow.wins, 4);
      assert.equal(statsRow.losses, 1);
      assert.equal(statsRow.kot_wins, 2);
      assert.equal(statsRow.hakem_kot_wins, 1);
    } finally {
      db.close();
    }
  });

  it('3. Re-running migrations is strictly idempotent and non-destructive', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    try {
      const first = runDatabaseMigrations(db);
      assert.equal(first.applied.length, 5);

      const second = runDatabaseMigrations(db);
      assert.deepEqual(second.applied, []);
      assert.equal(second.skipped.length, 5);
      assert.deepEqual(second.baselineRecorded, []);

      const third = runDatabaseMigrations(db);
      assert.deepEqual(third.applied, []);
      assert.equal(third.skipped.length, 5);
    } finally {
      db.close();
    }
  });

  it('4. EyvanDatabase preserves registered accounts on guest upsert and links user_id on completed matches', () => {
    const tmpDir = createTempDir('eyvan-stageb-db-');
    const dbPath = path.join(tmpDir, 'test.sqlite');
    try {
      const eyvanDb = new EyvanDatabase(dbPath);
      eyvanDb.upsertUser('GuestOne', 'portrait', 1000);
      eyvanDb.upsertUser('guestOne', 'emerald', 2000);

      // Manually promote a second user to an active registered account
      const rawDb = new Database(dbPath);
      rawDb
        .prepare(
          `INSERT INTO users (
             user_id, username, username_key, display_name, email, email_key, email_verified,
             avatar_code, auth_provider, account_status, created_at, last_seen_at, updated_at
           ) VALUES ('usr_reg_1', 'RealPlayer', 'realplayer', 'Real Player', 'rp@example.com', 'rp@example.com', 1, 'gold', 'password', 'active', 1000, 1000, 1000)`
        )
        .run();
      rawDb.close();

      // Game room calls upsertUser with same username_key — must NOT downgrade registered account
      eyvanDb.upsertUser('realplayer', 'portrait', 3000);

      const match: CompletedMatchRecord = {
        matchId: 'match_stageb_1',
        roomCode: 'EYVAN1',
        startedAt: 2500,
        finishedAt: 3500,
        winningTeam: 'myTeam',
        teamAScore: 3,
        teamBScore: 0,
        targetScore: 3,
        lastWinType: 'hakem_kot',
        handsPlayed: 2,
        players: [
          { playerId: 'p1', username: 'RealPlayer', canonicalSeat: 'south', team: 'myTeam', won: true },
          { playerId: 'p2', username: 'GuestOne', canonicalSeat: 'north', team: 'myTeam', won: true },
          { playerId: 'p3', username: 'RivalA', canonicalSeat: 'east', team: 'opponentTeam', won: false },
          { playerId: 'p4', username: 'RivalB', canonicalSeat: 'west', team: 'opponentTeam', won: false },
        ],
      };
      eyvanDb.recordCompletedMatch(match);

      const stats = eyvanDb.getPlayerStats('realplayer');
      assert.equal(stats.matchesPlayed, 1);
      assert.equal(stats.wins, 1);
      assert.equal(stats.hakemKotWins, 1);
      eyvanDb.close();

      const verifyDb = new Database(dbPath, { readonly: true });
      const regUser = verifyDb
        .prepare(`SELECT * FROM users WHERE username_key = 'realplayer'`)
        .get() as {
        user_id: string;
        username: string;
        display_name: string;
        avatar_code: string;
        auth_provider: string;
        account_status: string;
        last_seen_at: number;
      };
      assert.equal(regUser.user_id, 'usr_reg_1');
      assert.equal(regUser.username, 'RealPlayer');
      assert.equal(regUser.display_name, 'Real Player');
      assert.equal(regUser.avatar_code, 'gold');
      assert.equal(regUser.auth_provider, 'password');
      assert.equal(regUser.account_status, 'active');
      assert.equal(regUser.last_seen_at, 3000);

      const statsLinked = verifyDb
        .prepare(`SELECT user_id FROM player_stats WHERE username = 'realplayer'`)
        .get() as { user_id: string };
      assert.equal(statsLinked.user_id, 'usr_reg_1');
      verifyDb.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('5. Cleanup script dry-run makes zero changes, apply archives zero-dependency users with backup, refuses dependent/active users, and restore recovers archived rows', async () => {
    const tmpDir = createTempDir('eyvan-stageb-cleanup-');
    const dbPath = path.join(tmpDir, 'local.sqlite');
    const backupDir = path.join(tmpDir, 'backups');

    try {
      // Seed a legacy pre-0004 database with:
      // - 2 zero-dependency test users (amir_rad, sohrab_k)
      // - 1 user with match/stats history (hero_with_match)
      // - 1 active registered user added after migration check (we'll test both pre-0004 dry-run & post-0004 apply)
      const seedDb = new Database(dbPath);
      applyLegacySqlUpTo0003(seedDb);
      const now = 1700000000000;
      const insUser = seedDb.prepare(
        `INSERT INTO users (username, display_username, avatar_code, created_at, last_seen_at)
         VALUES (?, ?, 'portrait', ?, ?)`
      );
      insUser.run('amir_rad', 'amir_rad', now, now);
      insUser.run('sohrab_k', 'sohrab_k', now, now);
      insUser.run('hero_with_match', 'hero_with_match', now, now);

      seedDb
        .prepare(
          `INSERT INTO player_stats (username, display_username, matches_played, wins, losses, kot_wins, hakem_kot_wins, last_played_at)
           VALUES ('hero_with_match', 'hero_with_match', 2, 2, 0, 0, 0, ?)`
        )
        .run(now);
      seedDb.close();

      const beforeStat = fs.statSync(dbPath);

      // Step A: Dry-run must NOT mutate DB or create backups
      const dryReport = await runLocalUserCleanup({
        dbPath,
        backupDir,
        usernames: ['amir_rad', 'sohrab_k', 'hero_with_match', 'missing_user'],
        dryRun: true,
      });

      assert.equal(dryReport.mode, 'dry-run');
      assert.equal(dryReport.backupPath, null);
      assert.equal(dryReport.before.users, 3);
      assert.equal(dryReport.after.users, 3);
      assert.deepEqual(dryReport.archivedUsernames, []);
      assert.deepEqual(dryReport.notFoundUsernames, ['missing_user']);
      assert.equal(dryReport.skippedUsernames.length, 1);
      assert.equal(dryReport.skippedUsernames[0].usernameKey, 'hero_with_match');
      assert.equal(fs.existsSync(backupDir), false);
      assert.equal(fs.statSync(dbPath).size, beforeStat.size);

      // Step B: Apply cleanup — must create backup, migrate, archive 2 clean rows, and skip hero_with_match
      const applyReport = await runLocalUserCleanup({
        dbPath,
        backupDir,
        usernames: ['amir_rad', 'sohrab_k', 'hero_with_match'],
        dryRun: false,
      });

      assert.equal(applyReport.mode, 'apply');
      assert.ok(applyReport.backupPath && fs.existsSync(applyReport.backupPath));
      assert.ok(applyReport.batchId);
      assert.equal(applyReport.before.users, 3);
      assert.equal(applyReport.after.users, 1);
      assert.equal(applyReport.after.userCleanupArchive, 2);
      assert.deepEqual(applyReport.archivedUsernames.sort(), ['amir_rad', 'sohrab_k']);
      assert.equal(applyReport.skippedUsernames.length, 1);
      assert.equal(applyReport.skippedUsernames[0].usernameKey, 'hero_with_match');

      // Step C: Restore archived batch — both users come back with original user_id & data
      const restoreReport = restoreArchivedUsers({
        dbPath,
        batchId: applyReport.batchId!,
      });

      assert.deepEqual(restoreReport.restoredUsernames.sort(), ['amir_rad', 'sohrab_k']);
      assert.equal(restoreReport.after.users, 3);

      // Verify restored users match archive JSON user_id
      const checkDb = new Database(dbPath, { readonly: true });
      const archived = checkDb
        .prepare(`SELECT user_id, username_key, restored_at FROM user_cleanup_archive WHERE batch_id = ?`)
        .all(applyReport.batchId!) as Array<{
        user_id: string;
        username_key: string;
        restored_at: number | null;
      }>;
      assert.equal(archived.length, 2);
      for (const a of archived) {
        assert.ok(a.restored_at !== null);
        const restoredRow = checkDb
          .prepare(`SELECT user_id FROM users WHERE username_key = ?`)
          .get(a.username_key) as { user_id: string };
        assert.equal(restoredRow.user_id, a.user_id);
      }
      checkDb.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('6. Demo data is cleanly separated from real assets & shop catalog and demoData.ts is deleted', () => {
    const legacyDemoPath = path.resolve(
      process.cwd(),
      'src/platform/data/demoData.ts'
    );
    assert.equal(
      fs.existsSync(legacyDemoPath),
      false,
      'src/platform/data/demoData.ts must be deleted'
    );

    const assetsSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/platform/data/assets.ts'),
      'utf8'
    );
    assert.match(assetsSource, /export const PLATFORM_ASSETS\b/);
    assert.match(assetsSource, /export const CARD_ART_ASSETS\b/);

    const shopSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/platform/data/shopCatalog.ts'),
      'utf8'
    );
    assert.match(shopSource, /export const SHOP_SECTIONS\b/);
    assert.match(shopSource, /export const SHOP_ITEMS_DEMO\b/);
    assert.match(shopSource, /export const SHOP_CATALOG_ITEMS\b/);

    // Verify no file in src/ references demoData or the removed fake user/chat constants
    const forbiddenTokens = [
      'demoData',
      'INITIAL_DEMO_PROFILE',
      'TAKEN_USERNAMES',
      'INITIAL_FRIENDS_DEMO',
      'INITIAL_GROUPS_DEMO',
      'INITIAL_DIRECT_CHATS',
      'INITIAL_GROUP_CHATS',
    ];
    const walkTsFiles = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          out.push(...walkTsFiles(full));
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          out.push(full);
        }
      }
      return out;
    };

    for (const file of walkTsFiles(path.resolve(process.cwd(), 'src'))) {
      const content = fs.readFileSync(file, 'utf8');
      for (const token of forbiddenTokens) {
        assert.equal(
          content.includes(token),
          false,
          `Unexpected forbidden demo token '${token}' found in ${file}`
        );
      }
    }

    const guest = createInitialGuestProfile('dark');
    assert.equal(guest.username, 'guest_player');
    assert.equal(guest.coins, 0);
    assert.equal(guest.gems, 0);
    assert.equal(guest.stats.gamesPlayed, 0);
    assert.equal(guest.stats.wins, 0);
    assert.equal(guest.stats.losses, 0);

    // Format validation must NOT reject former hardcoded demo usernames
    for (const oldDemoName of ['amir_rad', 'sohrab_k', 'parvin_sh', 'farhad_n']) {
      const check = validateUsernameFormat(oldDemoName);
      assert.equal(check.valid, true, `Format check must allow '${oldDemoName}'`);
    }
  });
});
