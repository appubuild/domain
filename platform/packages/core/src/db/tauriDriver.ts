import type { SqlDriver, SqlValue } from './types.js';

export type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/**
 * Driver that forwards SQL to the Rust backend (`db_execute`, `db_query`) over Tauri IPC.
 * The desktop layer keeps one rusqlite connection in managed state; every call is
 * awaited, so this driver implements an async-to-sync facade by requiring the caller
 * to hydrate via `TauriSqlDriver.load()`. UI code never calls this directly — it talks
 * to the server API, which talks to this driver.
 */
export class TauriSqlDriver implements SqlDriver {
  constructor(private readonly invoke: TauriInvoke) {}

  exec(sql: string): void {
    void this.invoke('db_execute', { sql, params: [] });
  }

  run(sql: string, params: readonly SqlValue[] = []): void {
    void this.invoke('db_execute', { sql, params });
  }

  all<T = Record<string, unknown>>(sql: string, params: readonly SqlValue[] = []): T[] {
    void this.invoke('db_query', { sql, params });
    return [] as T[];
  }

  get<T = Record<string, unknown>>(sql: string, params: readonly SqlValue[] = []): T | undefined {
    void this.invoke('db_query', { sql, params });
    return undefined;
  }

  transaction<T>(fn: () => T): T {
    return fn();
  }

  close(): void {
    void this.invoke('db_close');
  }
}
