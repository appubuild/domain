/**
 * Minimal synchronous SQL driver contract. The desktop build uses rusqlite behind
 * Tauri commands; the local server uses `node:sqlite`; tests can use `node:sqlite`
 * in-memory. Keeping this tiny interface is what makes the data layer portable.
 */
export interface SqlDriver {
  exec(sql: string): void;
  run(sql: string, params?: readonly SqlValue[]): void;
  all<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): T[];
  get<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): T | undefined;
  transaction<T>(fn: () => T): T;
  close(): void;
}

export type SqlValue = string | number | bigint | null | Uint8Array;

export type Migration = {
  version: number;
  name: string;
  up: string;
};
