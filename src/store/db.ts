/**
 * Mock persistence layer.
 *
 * The rest of the application never touches storage directly — it goes through
 * repositories, which read and write this in-memory database. The database is
 * hydrated from localStorage (when available) and fell back to the generated
 * seed data. Swapping this for real API calls means replacing repositories only.
 */
import { buildSeedDatabase, SEED_VERSION, type Database } from '@/data/database';

const STORAGE_KEY = `scriptora.db.v${SEED_VERSION}`;
const LITE_KEYS = ['versions', 'auditLogs', 'aiUsage', 'emailEvents', 'viewEvents'] as const;

type Listener = () => void;

let database: Database = buildSeedDatabase();
let hydrated = false;
let persistenceDisabled = false;
let memoryOnly = false;

const listeners = new Set<Listener>();

function storageAvailable(): boolean {
  try {
    const probe = '__scriptora_probe__';
    window.sessionStorage.setItem(probe, '1');
    window.sessionStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  if (typeof window === 'undefined') return;

  for (const store of [window.sessionStorage, window.localStorage]) {
    try {
      const raw = store.getItem(STORAGE_KEY) ?? store.getItem(`${STORAGE_KEY}.lite`);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { version: number; data: Partial<Database>; lite?: boolean };
      if (parsed.version !== SEED_VERSION) continue;
      if (parsed.lite) {
        const fresh = buildSeedDatabase();
        database = { ...fresh, ...parsed.data } as Database;
      } else {
        database = { ...buildSeedDatabase(), ...parsed.data } as Database;
      }
      return;
    } catch {
      // Corrupt payload — fall through and keep the freshly generated seed.
    }
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function persist() {
  if (typeof window === 'undefined' || persistenceDisabled) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const payload = { version: SEED_VERSION, data: database as Partial<Database> };
    const attempt = (data: Partial<Database>, lite: boolean, store: Storage) => {
      store.setItem(
        lite ? `${STORAGE_KEY}.lite` : STORAGE_KEY,
        JSON.stringify({ version: SEED_VERSION, lite, data }),
      );
    };

    const stores = storageAvailable() ? [window.localStorage, window.sessionStorage] : [window.sessionStorage];
    for (const store of stores) {
      try {
        attempt(database, false, store);
        return;
      } catch {
        try {
          const liteData: Partial<Database> = { ...database };
          LITE_KEYS.forEach((key) => {
            delete (liteData as Record<string, unknown>)[key];
          });
          attempt(liteData, true, store);
          return;
        } catch {
          memoryOnly = true;
          continue;
        }
      }
    }
    persistenceDisabled = true;
  }, 350);
}

export function getDatabase(): Database {
  hydrate();
  return database;
}

/** Mutates the database and notifies subscribers. */
export function mutateDatabase<T>(mutator: (db: Database) => T): T {
  hydrate();
  const result = mutator(database);
  database = { ...database };
  persist();
  listeners.forEach((listener) => listener());
  return result;
}

export function subscribeDatabase(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetDatabase() {
  database = buildSeedDatabase();
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(`${STORAGE_KEY}.lite`);
    window.sessionStorage.removeItem(STORAGE_KEY);
    window.sessionStorage.removeItem(`${STORAGE_KEY}.lite`);
  } catch {
    // ignore
  }
  persist();
  listeners.forEach((listener) => listener());
}

export function isMemoryOnly() {
  return memoryOnly;
}

export function databaseSizeBytes() {
  try {
    return JSON.stringify(database).length;
  } catch {
    return 0;
  }
}

if (typeof window !== 'undefined') {
  // Debug hook used by the demo and by support: window.scriptora.reset()
  (window as unknown as Record<string, unknown>).scriptora = {
    reset: resetDatabase,
    export: () => JSON.stringify(database),
    size: databaseSizeBytes,
  };
}
