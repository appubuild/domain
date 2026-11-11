const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Cryptographically-random URL-safe id, optionally prefixed (e.g. `chr_8f3k2...`). */
export function newId(prefix: string, length = 20): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}

/** Short, human-sortable id for logs. */
export function shortId(): string {
  return newId('x', 6);
}
