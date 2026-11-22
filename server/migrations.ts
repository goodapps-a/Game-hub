import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export interface MigrationRunResult {
  applied: string[];
  skipped: string[];
  baselineRecorded: string[];
}

export interface RunMigrationsOptions {
  migrationsDir?: string;
  /** Optional upper bound (inclusive) e.g. '0003_username_canonical_key.sql' for testing legacy upgrades */
  upTo?: string;
}

export const DEFAULT_MIGRATIONS_DIR = path.resolve(
  process.cwd(),
  'cloudflare/migrations'
);

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
  return cols.some((col) => col.name === columnName);
}

function indexExists(db: Database.Database, indexName: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1`
    )
    .get(indexName);
  return Boolean(row);
}

/**
 * Detects migrations that were already applied to a pre-existing local SQLite database
 * before `schema_migrations` tracking existed, preventing duplicate `ALTER TABLE` errors
 * while never skipping genuinely unapplied migrations.
 */
function detectLegacyBaselineMigrations(
  db: Database.Database,
  availableFiles: string[]
): string[] {
  const detected: string[] = [];

  const has0001 =
    tableExists(db, 'users') &&
    tableExists(db, 'matches') &&
    tableExists(db, 'match_players') &&
    tableExists(db, 'player_stats');

  if (has0001 && availableFiles.includes('0001_init.sql')) {
    detected.push('0001_init.sql');
  }

  const has0002 =
    has0001 &&
    indexExists(db, 'idx_matches_room_code') &&
    indexExists(db, 'idx_users_last_seen_at');

  if (has0002 && availableFiles.includes('0002_indexes.sql')) {
    detected.push('0002_indexes.sql');
  }

  // Note: If 0004 already upgraded `users`, `users` has `user_id` instead of `display_username`,
  // while `player_stats.display_username` and `match_players.username_key` remain present.
  const has0003 =
    has0001 &&
    columnExists(db, 'player_stats', 'display_username') &&
    columnExists(db, 'match_players', 'username_key') &&
    (columnExists(db, 'users', 'display_username') ||
      columnExists(db, 'users', 'user_id'));

  if (has0003 && availableFiles.includes('0003_username_canonical_key.sql')) {
    detected.push('0003_username_canonical_key.sql');
  }

  const has0004 =
    has0003 &&
    columnExists(db, 'users', 'user_id') &&
    columnExists(db, 'users', 'username_key') &&
    tableExists(db, 'auth_identities') &&
    tableExists(db, 'auth_sessions') &&
    tableExists(db, 'user_cleanup_archive');

  if (has0004 && availableFiles.includes('0004_accounts_auth.sql')) {
    detected.push('0004_accounts_auth.sql');
  }

  const has0005 =
    has0004 &&
    tableExists(db, 'friendships') &&
    tableExists(db, 'conversations') &&
    tableExists(db, 'messages');

  if (has0005 && availableFiles.includes('0005_social_chat.sql')) {
    detected.push('0005_social_chat.sql');
  }

  const has0006 =
    has0005 &&
    tableExists(db, 'user_game_stats') &&
    indexExists(db, 'idx_match_players_user_id_match_id');

  if (has0006 && availableFiles.includes('0006_stats_user_id_binding.sql')) {
    detected.push('0006_stats_user_id_binding.sql');
  }

  const has0007 =
    has0006 &&
    tableExists(db, 'user_presence_sessions') &&
    columnExists(db, 'users', 'presence_preference');

  if (has0007 && availableFiles.includes('0007_social_presence_d1.sql')) {
    detected.push('0007_social_presence_d1.sql');
  }

  const has0008 =
    has0007 &&
    tableExists(db, 'stats_identity_audit_log') &&
    columnExists(db, 'users', 'username_changed_at');

  if (has0008 && availableFiles.includes('0008_stage0_identity_audit_and_guards.sql')) {
    detected.push('0008_stage0_identity_audit_and_guards.sql');
  }

  const has0009 =
    has0008 &&
    tableExists(db, 'guest_sessions') &&
    tableExists(db, 'game_invites') &&
    columnExists(db, 'oauth_states', 'flow_mode');

  if (
    has0009 &&
    availableFiles.includes('0009_guest_identity_and_game_invites.sql')
  ) {
    detected.push('0009_guest_identity_and_game_invites.sql');
  }

  return detected;
}

/**
 * Lists all numbered `.sql` migration files in deterministic ascending order.
 */
export function listMigrationFiles(
  migrationsDir = DEFAULT_MIGRATIONS_DIR
): string[] {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => /^\d+_.*\.sql$/i.test(file))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Applies all unapplied Cloudflare D1 / SQLite migrations in order inside individual
 * transactions, tracking applied filenames in `schema_migrations`.
 *
 * Guarantees:
 * - 100% idempotent when called repeatedly on an up-to-date database.
 * - Safely baselines pre-existing local SQLite databases (created before `schema_migrations`).
 * - Shares the exact same `cloudflare/migrations/*.sql` source of truth as Cloudflare D1.
 */
export function runDatabaseMigrations(
  db: Database.Database,
  options: RunMigrationsOptions = {}
): MigrationRunResult {
  const migrationsDir = options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  let files = listMigrationFiles(migrationsDir);
  if (options.upTo) {
    files = files.filter((f) => f.localeCompare(options.upTo!) <= 0);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const appliedSet = new Set<string>(
    (
      db.prepare(`SELECT name FROM schema_migrations`).all() as Array<{
        name: string;
      }>
    ).map((r) => r.name)
  );

  const baselineRecorded: string[] = [];

  // If schema_migrations is empty on a non-empty legacy DB, record already-present schema baseline.
  if (appliedSet.size === 0) {
    const legacyBaseline = detectLegacyBaselineMigrations(db, files);
    if (legacyBaseline.length > 0) {
      const insertBaseline = db.prepare(
        `INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)`
      );
      const now = Date.now();
      const recordBaselineTx = db.transaction((names: string[]) => {
        for (const name of names) {
          insertBaseline.run(name, now);
        }
      });
      recordBaselineTx(legacyBaseline);
      for (const name of legacyBaseline) {
        appliedSet.add(name);
        baselineRecorded.push(name);
      }
    }
  }

  const applied: string[] = [];
  const skipped: string[] = [];
  const insertMigration = db.prepare(
    `INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`
  );

  for (const fileName of files) {
    if (appliedSet.has(fileName)) {
      skipped.push(fileName);
      continue;
    }

    const fullPath = path.join(migrationsDir, fileName);
    const sql = fs.readFileSync(fullPath, 'utf8');

    const applyTx = db.transaction(() => {
      db.exec(sql);
      insertMigration.run(fileName, Date.now());
    });

    applyTx();
    applied.push(fileName);
    appliedSet.add(fileName);
  }

  return { applied, skipped, baselineRecorded };
}
