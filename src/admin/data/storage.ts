/**
 * Storage adapter.
 *
 * The admin console persists its demo state in `localStorage`. During SSR and in
 * the test harness there is no `localStorage`, so the adapter falls back to an
 * in-memory map — every repository method therefore works in both environments.
 *
 * Phase 2 swaps this for the REST API client; the exported surface is small on
 * purpose so callers never touch `window` directly.
 */

const memory = new Map<string, string>()

const hasLocalStorage = (): boolean => {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
  } catch {
    return false
  }
}

export const storage = {
  get(key: string): string | null {
    if (hasLocalStorage()) {
      try {
        return window.localStorage.getItem(key)
      } catch {
        return memory.get(key) ?? null
      }
    }
    return memory.get(key) ?? null
  },

  set(key: string, value: string): void {
    if (hasLocalStorage()) {
      try {
        window.localStorage.setItem(key, value)
        return
      } catch {
        /* quota or privacy mode — fall through to memory */
      }
    }
    memory.set(key, value)
  },

  remove(key: string): void {
    if (hasLocalStorage()) {
      try {
        window.localStorage.removeItem(key)
      } catch {
        /* ignore */
      }
    }
    memory.delete(key)
  },

  clear(prefix: string): void {
    if (hasLocalStorage()) {
      try {
        Object.keys(window.localStorage)
          .filter((key) => key.startsWith(prefix))
          .forEach((key) => window.localStorage.removeItem(key))
      } catch {
        /* ignore */
      }
    }
    Array.from(memory.keys())
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => memory.delete(key))
  },
}

export const readJSON = <T>(key: string, fallback: T): T => {
  const raw = storage.get(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export const writeJSON = (key: string, value: unknown): void => {
  try {
    storage.set(key, JSON.stringify(value))
  } catch {
    /* serialisation guard — never throw from a write */
  }
}

/** Small, stable id generator for demo records (`<prefix>_<base36>`). */
export const makeId = (prefix: string): string => {
  const stamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 7)
  return `${prefix}_${stamp}${random}`
}

/** Async delay so loading states are visible with the mock repository. */
export const delay = (ms = 140): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
