/**
 * Local, deterministic embedding model (feature hashing over word + bigram tokens).
 *
 * Why not a transformer embedding? Bundling a local model requires hundreds of MB of
 * weights and native inference; calling a provider embedding API would break the
 * "works fully offline" requirement for long-term memory. Feature hashing gives
 * real semantic-ish similarity (shared vocabulary + bigrams), zero network, and is
 * versioned so stored vectors can be re-indexed when a better model ships.
 *
 * When a provider embedding key is configured, `ProviderEmbedder` supersedes this and
 * rows are re-embedded lazily (see `embedding_model` metadata on each vector).
 */
export const EMBEDDING_DIM = 256;
export const EMBEDDING_MODEL = 'aura-hash-v1';

function hash32(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function embedText(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const lower = text.toLowerCase();
  const words = lower.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  const push = (tok: string, weight: number) => {
    const h = hash32(tok, 0x811c9dc5);
    const idx = h % EMBEDDING_DIM;
    const sign = (h >>> 31) & 1 ? 1 : -1;
    vec[idx] = (vec[idx] ?? 0) + sign * weight;
  };
  for (const w of words) push(w, 1);
  for (let i = 0; i < words.length - 1; i++) push(`${words[i]} ${words[i + 1]}`, 0.6);
  // L2 normalise
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
