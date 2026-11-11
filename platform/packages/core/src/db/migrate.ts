import { MIGRATIONS } from './migrations.js';
import type { SqlDriver } from './types.js';

export type MigrationResult = { applied: number[]; currentVersion: number };

export class MigrationError extends Error {
  constructor(message: string, readonly version?: number) {
    super(message);
    this.name = 'MigrationError';
  }
}

export function currentSchemaVersion(db: SqlDriver): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const row = db.get<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations');
  return row?.v ?? 0;
}

/** Applies pending migrations in order. Idempotent and transactional per migration. */
export function migrate(db: SqlDriver, migrations: readonly typeof MIGRATIONS[number][] = MIGRATIONS): MigrationResult {
  const from = currentSchemaVersion(db);
  const pending = [...migrations].sort((a, b) => a.version - b.version).filter((m) => m.version > from);
  const applied: number[] = [];
  for (const m of pending) {
    try {
      db.transaction(() => {
        db.exec(m.up);
        db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
          m.version,
          m.name,
          new Date().toISOString(),
        ]);
      });
      applied.push(m.version);
    } catch (err) {
      throw new MigrationError(
        `Migration ${m.version} (${m.name}) failed: ${err instanceof Error ? err.message : String(err)}`,
        m.version,
      );
    }
  }
  return { applied, currentVersion: currentSchemaVersion(db) };
}
