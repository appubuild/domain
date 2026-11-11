/** Unicode-aware word tokens, lower-cased, stop-words removed. */
const STOP = new Set(
  ('a an and are as at be but by for from has have he her his i if in into is it its me my no not of on or our ' +
    'she so that the their them then there these they this to was we were what when where which who will with ' +
    'you your do does did can could should would just about also very really').split(' '),
);

export function tokenize(text: string, keepStop = false): string[] {
  const raw = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  const out: string[] = [];
  for (const t of raw) {
    const clean = t.replace(/['’]s$/, '').replace(/['’]/g, '');
    if (!clean) continue;
    if (!keepStop && (STOP.has(clean) || clean.length < 2)) continue;
    out.push(clean);
  }
  return out;
}

/** Stable hash used for dedupe + FTS ids. Uses FNV-1a 64-bit. */
export function fnv1a(text: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const bytes = new TextEncoder().encode(text);
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

export function normalizeForHash(text: string): string {
  return tokenize(text, true).join(' ').replace(/\s+/g, ' ').trim();
}

export function truncate(text: string, max: number, suffix = '…'): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - suffix.length)).trimEnd() + suffix;
}

/** Convert free text into a safe FTS5 MATCH expression (AND of quoted terms, prefix on last). */
export function toFtsQuery(text: string): string {
  const tokens = tokenize(text).slice(0, 24);
  if (tokens.length === 0) return '';
  return tokens
    .map((t, i) => {
      const safe = t.replace(/"/g, '""');
      return i === tokens.length - 1 && tokens.length > 1 ? `"${safe}"*` : `"${safe}"`;
    })
    .join(' ');
}

export function estimateTokens(text: string): number {
  // ~4 chars/token heuristic, clamped. Documented approximation, not a billing figure.
  return Math.max(1, Math.ceil(text.length / 4));
}
