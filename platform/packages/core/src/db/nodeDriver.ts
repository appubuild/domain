import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { SqlDriver, SqlValue } from './types.js';

/**
 * `node:sqlite` is loaded through createRequire rather than a static import so that
 * bundlers (Vite/Vitest/Rollup) do not try to resolve this Node builtin. It is only ever
 * constructed in Node contexts; the desktop build uses the Rust driver instead.
 */
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as { DatabaseSync: new (path: string) => DatabaseSyncType };

/**
 * Synchronous driver backed by Node 22's built-in SQLite (FTS5 enabled).
 * Used by the local server, CLI tooling and tests. The same SQL runs on the
 * desktop through `TauriSqlDriver` (rusqlite).
 */
export class NodeSqlDriver implements SqlDriver {
  private db: DatabaseSyncType;
  private txDepth = 0;

  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, params: readonly SqlValue[] = []): void {
    this.db.prepare(sql).run(...(params as SqlValue[]));
  }

  all<T = Record<string, unknown>>(sql: string, params: readonly SqlValue[] = []): T[] {
    return this.db.prepare(sql).all(...(params as SqlValue[])) as T[];
  }

  get<T = Record<string, unknown>>(sql: string, params: readonly SqlValue[] = []): T | undefined {
    const row = this.db.prepare(sql).get(...(params as SqlValue[]));
    return row as T | undefined;
  }

  transaction<T>(fn: () => T): T {
    if (this.txDepth > 0) {
      this.txDepth++;
      try {
        return fn();
      } finally {
        this.txDepth--;
      }
    }
    this.db.exec('BEGIN IMMEDIATE');
    this.txDepth = 1;
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* rollback best-effort */
      }
      throw err;
    } finally {
      this.txDepth = 0;
    }
  }

  close(): void {
    this.db.close();
  }
}
