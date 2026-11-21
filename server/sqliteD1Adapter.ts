import Database from 'better-sqlite3';
import {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1RunResult,
} from '../cloudflare/src/lib/types';

interface BoundSqliteStmt extends D1PreparedStatementLike {
  readonly __query: string;
  readonly __params: unknown[];
}

/**
 * Wraps a `better-sqlite3` database behind Cloudflare's `D1DatabaseLike` interface
 * so local Express routes execute the EXACT same SQL and auth logic as Cloudflare Workers.
 */
export class SqliteD1Adapter implements D1DatabaseLike {
  constructor(private readonly sqlite: Database.Database) {}

  prepare(query: string): D1PreparedStatementLike {
    return this.createBoundStmt(query, []);
  }

  private createBoundStmt(query: string, params: unknown[]): BoundSqliteStmt {
    const sqlite = this.sqlite;
    return {
      __query: query,
      __params: params,
      bind: (...values: unknown[]) => this.createBoundStmt(query, values),
      async run(): Promise<D1RunResult> {
        const info = sqlite.prepare(query).run(...params);
        return {
          success: true,
          meta: {
            changes: info.changes,
            last_row_id: Number(info.lastInsertRowid ?? 0),
          },
        };
      },
      async all<T = unknown>(): Promise<{ results: T[]; success?: boolean }> {
        const rows = sqlite.prepare(query).all(...params) as T[];
        return { results: rows, success: true };
      },
      async first<T = unknown>(): Promise<T | null> {
        const row = sqlite.prepare(query).get(...params) as T | undefined;
        return row ?? null;
      },
    };
  }

  async batch(statements: D1PreparedStatementLike[]): Promise<D1RunResult[]> {
    const bound = statements as BoundSqliteStmt[];
    const tx = this.sqlite.transaction((items: BoundSqliteStmt[]) => {
      const results: D1RunResult[] = [];
      for (const item of items) {
        const info = this.sqlite.prepare(item.__query).run(...item.__params);
        results.push({
          success: true,
          meta: {
            changes: info.changes,
            last_row_id: Number(info.lastInsertRowid ?? 0),
          },
        });
      }
      return results;
    });
    return tx(bound);
  }
}
