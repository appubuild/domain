/**
 * Anonymous local persistence (favourites, recent searches, preferences).
 *
 * Deliberately tiny and defensive: storage can be unavailable (private mode, policy
 * blocks, quota), so every read/write is guarded and every accessor has an in-memory
 * fallback. Nothing security-sensitive is ever stored here — this is UX state only.
 */

const PREFIX = "domainfits.";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const probe = `${PREFIX}probe`;
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const store = storage();
  if (!store) return fallback;
  try {
    const raw = store.getItem(`${PREFIX}${key}`);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(`${PREFIX}${key}`, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(`${PREFIX}${key}`);
  } catch {
    /* ignore */
  }
}

export type FavoriteRecord = {
  label: string;
  domain: string;
  root: string;
  addedAt: string;
  overall?: number;
  note?: string;
};

const FAVORITES_KEY = "favorites.v1";

export function readFavorites(): FavoriteRecord[] {
  const stored = readJson<unknown>(FAVORITES_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((item): item is FavoriteRecord => {
    if (!item || typeof item !== "object") return false;
    const record = item as Partial<FavoriteRecord>;
    return typeof record.label === "string" && typeof record.domain === "string";
  });
}

export function writeFavorites(records: FavoriteRecord[]): boolean {
  return writeJson(FAVORITES_KEY, records.slice(0, 500));
}

/** Merges new favourites, de-duplicating on the domain string. */
export function mergeFavorites(existing: FavoriteRecord[], incoming: FavoriteRecord[]): FavoriteRecord[] {
  const map = new Map(existing.map((record) => [record.domain.toLowerCase(), record]));
  for (const record of incoming) {
    const key = record.domain.toLowerCase();
    if (!map.has(key)) map.set(key, record);
  }
  return Array.from(map.values()).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

export type RecentSearch = {
  roots: string[];
  href: string;
  ranAt: string;
  count: number;
};

const RECENT_KEY = "recent-searches.v1";

export function readRecentSearches(): RecentSearch[] {
  const stored = readJson<unknown>(RECENT_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((item): item is RecentSearch => {
      if (!item || typeof item !== "object") return false;
      const record = item as Partial<RecentSearch>;
      return Array.isArray(record.roots) && typeof record.href === "string";
    })
    .slice(0, 8);
}

export function pushRecentSearch(entry: RecentSearch): void {
  const existing = readRecentSearches().filter((item) => item.href !== entry.href);
  writeJson(RECENT_KEY, [entry, ...existing].slice(0, 8));
}

export type GeneratorPreferences = {
  view: "list" | "grid";
  showScores: boolean;
  autoCheckAvailability: boolean;
};

const PREFERENCES_KEY = "generator.preferences.v1";

export const DEFAULT_PREFERENCES: GeneratorPreferences = {
  view: "list",
  showScores: true,
  autoCheckAvailability: false,
};

export function readPreferences(): GeneratorPreferences {
  const stored = readJson<Partial<GeneratorPreferences>>(PREFERENCES_KEY, {});
  return { ...DEFAULT_PREFERENCES, ...stored };
}

export function writePreferences(next: GeneratorPreferences): void {
  writeJson(PREFERENCES_KEY, next);
}
