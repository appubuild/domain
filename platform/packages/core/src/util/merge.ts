/**
 * Recursive merge for configuration objects.
 *
 * Patching one nested preference (e.g. `personality.humor`) must never silently erase
 * sibling fields. Arrays and primitives are replaced outright; `undefined` is skipped so
 * a sparse patch cannot wipe a value. Callers validate the *merged* result with Zod, so a
 * malformed patch still fails loudly instead of persisting junk.
 */
export function deepMerge<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const prev = out[key];
    if (isPlainObject(value) && isPlainObject(prev)) {
      out[key] = deepMerge(prev as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
