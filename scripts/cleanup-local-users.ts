import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { runDatabaseMigrations } from '../server/migrations';

export const DEFAULT_LOCAL_DB_PATH = path.resolve(
  process.cwd(),
  'data/eyvan-hokm.sqlite'
);
export const DEFAULT_BACKUP_DIR = path.resolve(process.cwd(), 'data/backups');
export const DEFAULT_TEST_USERNAMES: readonly string[] = [
  'amir_rad',
  'sohrab_k',
  'parvin_sh',
  'farhad_n',
];

export interface DependencyCounts {
  matchPlayers: number;
  playerStats: number;
  authIdentities: number;
  authSessions: number;
  friendships: number;
  userBlocks: number;
  conversationMembers: number;
  messages: number;
  total: number;
}

export interface CleanupCandidateReport {
  usernameKey: string;
  userId: string | null;
  displayName: string;
  accountStatus: string;
  dependencies: DependencyCounts;
  eligible: boolean;
  skipReason: string | null;
}

export interface TableCountsSnapshot {
  users: number;
  matches: number;
  matchPlayers: number;
  playerStats: number;
  legacyUsersArchive: number;
  userCleanupArchive: number;
}

export interface CleanupExecutionReport {
  mode: 'dry-run' | 'apply';
  dbPath: string;
  backupPath: string | null;
  batchId: string | null;
  migrationsApplied: string[];
  before: TableCountsSnapshot;
  after: TableCountsSnapshot;
  candidates: CleanupCandidateReport[];
  archivedUsernames: string[];
  skippedUsernames: Array<{ usernameKey: string; reason: string }>;
  notFoundUsernames: string[];
}

export interface RestoreExecutionReport {
  dbPath: string;
  batchId: string;
  restoredUsernames: string[];
  alreadyPresentUsernames: string[];
  after: TableCountsSnapshot;
}

export interface CleanupOptions {
  dbPath?: string;
  backupDir?: string;
  usernames?: readonly string[];
  dryRun?: boolean;
  reason?: string;
}

export interface RestoreOptions {
  dbPath?: string;
  batchId?: string;
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`
    )
    .get(tableName);
  return Boolean(row);
}

function columnExists(
  db: Database.Database,
  tableName: string,
  columnName: string
): boolean {
  if (!tableExists(db, tableName)) return false;
  const cols = db
    .prepare(`PRAGMA table_info("${tableName}")`)
    .all() as Array<{ name: string }>;
  return cols.some((c) => c.name === columnName);
}

function countRows(db: Database.Database, tableName: string): number {
  if (!tableExists(db, tableName)) return 0;
  const row = db
    .prepare(`SELECT COUNT(*) AS cnt FROM "${tableName}"`)
    .get() as { cnt: number };
  return Number(row?.cnt ?? 0);
}

function captureSnapshot(db: Database.Database): TableCountsSnapshot {
  return {
    users: countRows(db, 'users'),
    matches: countRows(db, 'matches'),
    matchPlayers: countRows(db, 'match_players'),
    playerStats: countRows(db, 'player_stats'),
    legacyUsersArchive: countRows(db, 'legacy_users_archive'),
    userCleanupArchive: countRows(db, 'user_cleanup_archive'),
  };
}

function normalizeTargetKeys(usernames: readonly string[]): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const raw of usernames) {
    const key = raw.trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

function querySingleCount(
  db: Database.Database,
  sql: string,
  ...params: unknown[]
): number {
  const row = db.prepare(sql).get(...params) as { cnt: number } | undefined;
  return Number(row?.cnt ?? 0);
}

function inspectUserDependencies(
  db: Database.Database,
  usernameKey: string,
  userId: string | null
): DependencyCounts {
  let matchPlayers = 0;
  if (tableExists(db, 'match_players')) {
    const hasUserIdCol = columnExists(db, 'match_players', 'user_id');
    const hasKeyCol = columnExists(db, 'match_players', 'username_key');
    if (hasUserIdCol && userId) {
      matchPlayers = querySingleCount(
        db,
        `SELECT COUNT(*) AS cnt FROM match_players
         WHERE user_id = ? OR lower(COALESCE(username_key, username)) = ?`,
        userId,
        usernameKey
      );
    } else if (hasKeyCol) {
      matchPlayers = querySingleCount(
        db,
        `SELECT COUNT(*) AS cnt FROM match_players
         WHERE lower(COALESCE(username_key, username)) = ?`,
        usernameKey
      );
    } else {
      matchPlayers = querySingleCount(
        db,
        `SELECT COUNT(*) AS cnt FROM match_players WHERE lower(username) = ?`,
        usernameKey
      );
    }
  }

  let playerStats = 0;
  if (tableExists(db, 'player_stats')) {
    const hasUserIdCol = columnExists(db, 'player_stats', 'user_id');
    if (hasUserIdCol && userId) {
      playerStats = querySingleCount(
        db,
        `SELECT COUNT(*) AS cnt FROM player_stats
         WHERE user_id = ? OR lower(username) = ?`,
        userId,
        usernameKey
      );
    } else {
      playerStats = querySingleCount(
        db,
        `SELECT COUNT(*) AS cnt FROM player_stats WHERE lower(username) = ?`,
        usernameKey
      );
    }
  }

  const authIdentities =
    userId && tableExists(db, 'auth_identities')
      ? querySingleCount(
          db,
          `SELECT COUNT(*) AS cnt FROM auth_identities WHERE user_id = ?`,
          userId
        )
      : 0;

  const authSessions =
    userId && tableExists(db, 'auth_sessions')
      ? querySingleCount(
          db,
          `SELECT COUNT(*) AS cnt FROM auth_sessions WHERE user_id = ?`,
          userId
        )
      : 0;

  const friendships =
    userId && tableExists(db, 'friendships')
      ? querySingleCount(
          db,
          `SELECT COUNT(*) AS cnt FROM friendships
           WHERE requester_id = ? OR addressee_id = ?`,
          userId,
          userId
        )
      : 0;

  const userBlocks =
    userId && tableExists(db, 'user_blocks')
      ? querySingleCount(
          db,
          `SELECT COUNT(*) AS cnt FROM user_blocks
           WHERE blocker_id = ? OR blocked_id = ?`,
          userId,
          userId
        )
      : 0;

  const conversationMembers =
    userId && tableExists(db, 'conversation_members')
      ? querySingleCount(
          db,
          `SELECT COUNT(*) AS cnt FROM conversation_members WHERE user_id = ?`,
          userId
        )
      : 0;

  const messages =
    userId && tableExists(db, 'messages')
      ? querySingleCount(
          db,
          `SELECT COUNT(*) AS cnt FROM messages WHERE sender_id = ?`,
          userId
        )
      : 0;

  const total =
    matchPlayers +
    playerStats +
    authIdentities +
    authSessions +
    friendships +
    userBlocks +
    conversationMembers +
    messages;

  return {
    matchPlayers,
    playerStats,
    authIdentities,
    authSessions,
    friendships,
    userBlocks,
    conversationMembers,
    messages,
    total,
  };
}

interface RawUserRecord {
  user_id?: string;
  username: string;
  username_key?: string;
  display_name?: string;
  display_username?: string | null;
  account_status?: string;
  [key: string]: unknown;
}

function findUserRow(
  db: Database.Database,
  usernameKey: string
): RawUserRecord | undefined {
  if (!tableExists(db, 'users')) return undefined;
  const hasV2 = columnExists(db, 'users', 'user_id');
  if (hasV2) {
    return db
      .prepare(`SELECT * FROM users WHERE username_key = ? LIMIT 1`)
      .get(usernameKey) as RawUserRecord | undefined;
  }
  return db
    .prepare(`SELECT * FROM users WHERE lower(username) = ? LIMIT 1`)
    .get(usernameKey) as RawUserRecord | undefined;
}

function evaluateCandidate(
  db: Database.Database,
  row: RawUserRecord,
  usernameKey: string
): CleanupCandidateReport {
  const userId = typeof row.user_id === 'string' ? row.user_id : null;
  const displayName = String(
    row.display_name ?? row.display_username ?? row.username
  );
  const accountStatus = String(row.account_status ?? 'guest');
  const dependencies = inspectUserDependencies(db, usernameKey, userId);

  let skipReason: string | null = null;
  if (accountStatus !== 'guest') {
    skipReason = `account_status is '${accountStatus}' (only 'guest' test records may be cleaned)`;
  } else if (dependencies.total > 0) {
    skipReason = `non-zero dependencies detected (${dependencies.total} linked rows)`;
  }

  return {
    usernameKey,
    userId,
    displayName,
    accountStatus,
    dependencies,
    eligible: skipReason === null,
    skipReason,
  };
}

function buildBackupTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '');
}

/**
 * Controlled local SQLite test-user cleanup with:
 * - Strict read-only `--dry-run` (zero mutation to DB or filesystem)
 * - Full SQLite backup snapshot BEFORE any write or migration in `--apply`
 * - Dependency check across all match/stats/auth/social tables
 * - Reversible archival into `user_cleanup_archive`
 * - Structured Before/After report
 */
export async function runLocalUserCleanup(
  options: CleanupOptions = {}
): Promise<CleanupExecutionReport> {
  const dbPath = options.dbPath ?? DEFAULT_LOCAL_DB_PATH;
  const backupDir = options.backupDir ?? DEFAULT_BACKUP_DIR;
  const dryRun = options.dryRun ?? true;
  const reason =
    options.reason ?? 'stage_b_local_test_user_cleanup_zero_dependencies';
  const targetKeys = normalizeTargetKeys(
    options.usernames ?? DEFAULT_TEST_USERNAMES
  );

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Local SQLite database not found at: ${dbPath}`);
  }

  if (dryRun) {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const before = captureSnapshot(db);
      const candidates: CleanupCandidateReport[] = [];
      const notFoundUsernames: string[] = [];
      const skippedUsernames: Array<{ usernameKey: string; reason: string }> =
        [];

      for (const key of targetKeys) {
        const row = findUserRow(db, key);
        if (!row) {
          notFoundUsernames.push(key);
          continue;
        }
        const report = evaluateCandidate(db, row, key);
        candidates.push(report);
        if (!report.eligible && report.skipReason) {
          skippedUsernames.push({
            usernameKey: key,
            reason: report.skipReason,
          });
        }
      }

      return {
        mode: 'dry-run',
        dbPath,
        backupPath: null,
        batchId: null,
        migrationsApplied: [],
        before,
        after: before,
        candidates,
        archivedUsernames: [],
        skippedUsernames,
        notFoundUsernames,
      };
    } finally {
      db.close();
    }
  }

  // Apply mode: Step 1 — create guaranteed consistent backup BEFORE touching DB
  fs.mkdirSync(backupDir, { recursive: true });
  const baseName = path.basename(dbPath, path.extname(dbPath));
  const backupPath = path.join(
    backupDir,
    `${baseName}.${buildBackupTimestamp()}.backup.sqlite`
  );

  const db = new Database(dbPath);
  try {
    db.pragma('foreign_keys = ON');
    await db.backup(backupPath);

    // Step 2 — ensure schema is up to date (0001..0005)
    const migrationRes = runDatabaseMigrations(db);
    const before = captureSnapshot(db);

    const batchId = `cln_${crypto.randomBytes(6).toString('hex')}`;
    const candidates: CleanupCandidateReport[] = [];
    const notFoundUsernames: string[] = [];
    const skippedUsernames: Array<{ usernameKey: string; reason: string }> = [];
    const eligibleRows: Array<{ key: string; row: RawUserRecord }> = [];

    for (const key of targetKeys) {
      const row = findUserRow(db, key);
      if (!row) {
        notFoundUsernames.push(key);
        continue;
      }
      const report = evaluateCandidate(db, row, key);
      candidates.push(report);
      if (report.eligible) {
        eligibleRows.push({ key, row });
      } else if (report.skipReason) {
        skippedUsernames.push({
          usernameKey: key,
          reason: report.skipReason,
        });
      }
    }

    const archivedUsernames: string[] = [];
    if (eligibleRows.length > 0) {
      const insertArchive = db.prepare(`
        INSERT INTO user_cleanup_archive (
          archive_id, batch_id, user_id, username_key, reason, original_row_json, archived_at, restored_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
      `);
      const deleteUser = db.prepare(`DELETE FROM users WHERE user_id = ?`);

      const applyCleanupTx = db.transaction(() => {
        const now = Date.now();
        for (const { key, row } of eligibleRows) {
          const userId = String(row.user_id);
          const archiveId = `arc_${crypto.randomBytes(8).toString('hex')}`;
          insertArchive.run(
            archiveId,
            batchId,
            userId,
            key,
            reason,
            JSON.stringify(row),
            now
          );
          const delRes = deleteUser.run(userId);
          if (delRes.changes > 0) {
            archivedUsernames.push(key);
          }
        }
      });

      applyCleanupTx();
    }

    const after = captureSnapshot(db);

    return {
      mode: 'apply',
      dbPath,
      backupPath,
      batchId: archivedUsernames.length > 0 ? batchId : null,
      migrationsApplied: migrationRes.applied,
      before,
      after,
      candidates,
      archivedUsernames,
      skippedUsernames,
      notFoundUsernames,
    };
  } finally {
    db.close();
  }
}

/**
 * Restores a previously archived cleanup batch from `user_cleanup_archive` back into `users`.
 */
export function restoreArchivedUsers(
  options: RestoreOptions = {}
): RestoreExecutionReport {
  const dbPath = options.dbPath ?? DEFAULT_LOCAL_DB_PATH;
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Local SQLite database not found at: ${dbPath}`);
  }

  const db = new Database(dbPath);
  try {
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);

    let batchId = options.batchId;
    if (!batchId) {
      const latest = db
        .prepare(
          `SELECT batch_id FROM user_cleanup_archive
           WHERE restored_at IS NULL
           ORDER BY archived_at DESC
           LIMIT 1`
        )
        .get() as { batch_id: string } | undefined;

      if (!latest) {
        throw new Error('No un-restored cleanup batch found in user_cleanup_archive.');
      }
      batchId = latest.batch_id;
    }

    const archivedRows = db
      .prepare(
        `SELECT archive_id, user_id, username_key, original_row_json
         FROM user_cleanup_archive
         WHERE batch_id = ? AND restored_at IS NULL
         ORDER BY archived_at ASC`
      )
      .all(batchId) as Array<{
      archive_id: string;
      user_id: string;
      username_key: string;
      original_row_json: string;
    }>;

    if (archivedRows.length === 0) {
      throw new Error(
        `No un-restored rows found for batch '${batchId}'.`
      );
    }

    const insertUser = db.prepare(`
      INSERT OR IGNORE INTO users (
        user_id, username, username_key, display_name,
        email, email_key, email_verified,
        avatar_code, avatar_url,
        auth_provider, account_status,
        presence_preference, privacy_show_online,
        privacy_allow_friend_requests, privacy_allow_dm_from,
        created_at, last_seen_at, updated_at
      ) VALUES (
        @user_id, @username, @username_key, @display_name,
        @email, @email_key, @email_verified,
        @avatar_code, @avatar_url,
        @auth_provider, @account_status,
        @presence_preference, @privacy_show_online,
        @privacy_allow_friend_requests, @privacy_allow_dm_from,
        @created_at, @last_seen_at, @updated_at
      )
    `);
    const markRestored = db.prepare(
      `UPDATE user_cleanup_archive SET restored_at = ? WHERE archive_id = ?`
    );

    const restoredUsernames: string[] = [];
    const alreadyPresentUsernames: string[] = [];

    const restoreTx = db.transaction(() => {
      const now = Date.now();
      for (const entry of archivedRows) {
        const parsed = JSON.parse(entry.original_row_json) as Record<
          string,
          unknown
        >;
        const res = insertUser.run({
          user_id: parsed.user_id,
          username: parsed.username,
          username_key: parsed.username_key,
          display_name: parsed.display_name,
          email: parsed.email ?? null,
          email_key: parsed.email_key ?? null,
          email_verified: parsed.email_verified ?? 0,
          avatar_code: parsed.avatar_code ?? 'portrait',
          avatar_url: parsed.avatar_url ?? null,
          auth_provider: parsed.auth_provider ?? 'guest',
          account_status: parsed.account_status ?? 'guest',
          presence_preference: parsed.presence_preference ?? 'online',
          privacy_show_online: parsed.privacy_show_online ?? 1,
          privacy_allow_friend_requests:
            parsed.privacy_allow_friend_requests ?? 1,
          privacy_allow_dm_from: parsed.privacy_allow_dm_from ?? 'friends',
          created_at: parsed.created_at,
          last_seen_at: parsed.last_seen_at,
          updated_at: parsed.updated_at ?? parsed.last_seen_at,
        });
        if (res.changes > 0) {
          restoredUsernames.push(entry.username_key);
        } else {
          alreadyPresentUsernames.push(entry.username_key);
        }
        markRestored.run(now, entry.archive_id);
      }
    });

    restoreTx();

    return {
      dbPath,
      batchId,
      restoredUsernames,
      alreadyPresentUsernames,
      after: captureSnapshot(db),
    };
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const isRestore = args.includes('--restore');
  const dbArg = args.find((a) => a.startsWith('--db='));
  const batchArg = args.find((a) => a.startsWith('--batch='));
  const usersArg = args.find((a) => a.startsWith('--users='));

  const dbPath = dbArg ? path.resolve(dbArg.slice('--db='.length)) : DEFAULT_LOCAL_DB_PATH;

  if (isRestore) {
    const batchId = batchArg ? batchArg.slice('--batch='.length) : undefined;
    const report = restoreArchivedUsers({ dbPath, batchId });
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const usernames = usersArg
    ? usersArg.slice('--users='.length).split(',')
    : DEFAULT_TEST_USERNAMES;

  const report = await runLocalUserCleanup({
    dbPath,
    usernames,
    dryRun: !isApply,
  });
  console.log(JSON.stringify(report, null, 2));
}

const isDirectEntry =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectEntry) {
  main().catch((err) => {
    console.error('[cleanup-local-users] Failed:', err);
    process.exitCode = 1;
  });
}
