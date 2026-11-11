import type { SqlValue, SqlDriver } from './types.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';
import { safeParse, toJson } from '../util/json.js';
import { fnv1a, normalizeForHash, toFtsQuery } from '../util/text.js';

export const MEMORY_LAYERS = ['short_term', 'long_term', 'episodic', 'knowledge'] as const;
export type MemoryLayer = (typeof MEMORY_LAYERS)[number];
export const MEMORY_CATEGORIES = [
  'preference',
  'fact',
  'instruction',
  'relationship',
  'project',
  'event',
  'summary',
  'knowledge',
] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export type MemoryRow = {
  id: string;
  characterId: string;
  layer: MemoryLayer;
  category: MemoryCategory;
  content: string;
  importance: number;
  confidence: number;
  source: 'extraction' | 'summary' | 'manual' | 'consolidation' | 'document' | 'import';
  sourceConversationId: string | null;
  tags: string[];
  embedding: number[] | null;
  pinned: boolean;
  accessCount: number;
  lastAccessedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  id: string;
  character_id: string;
  layer: string;
  category: string;
  content: string;
  importance: number;
  confidence: number;
  source: string;
  source_conversation_id: string | null;
  tags_json: string;
  embedding_json: string | null;
  hash: string;
  pinned: number;
  access_count: number;
  last_accessed_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MemoryCreateInput = {
  characterId: string;
  layer: MemoryLayer;
  category: MemoryCategory;
  content: string;
  importance?: number;
  confidence?: number;
  source?: MemoryRow['source'];
  sourceConversationId?: string | null;
  tags?: string[];
  embedding?: number[] | null;
  pinned?: boolean;
  expiresAt?: string | null;
};

export type MemorySearchParams = {
  characterId: string;
  query?: string;
  layers?: MemoryLayer[];
  categories?: MemoryCategory[];
  minImportance?: number;
  pinnedOnly?: boolean;
  limit?: number;
  offset?: number;
};

const isLayer = (v: string): v is MemoryLayer => (MEMORY_LAYERS as readonly string[]).includes(v);
const isCategory = (v: string): v is MemoryCategory => (MEMORY_CATEGORIES as readonly string[]).includes(v);

export class MemoryRepo {
  constructor(private readonly db: SqlDriver) {}

  private toMemory(r: Row): MemoryRow {
    return {
      id: r.id,
      characterId: r.character_id,
      layer: isLayer(r.layer) ? r.layer : 'long_term',
      category: isCategory(r.category) ? r.category : 'fact',
      content: r.content,
      importance: r.importance,
      confidence: r.confidence,
      source: r.source as MemoryRow['source'],
      sourceConversationId: r.source_conversation_id,
      tags: safeParse<string[]>(r.tags_json, []),
      embedding: safeParse<number[] | null>(r.embedding_json, null),
      pinned: r.pinned === 1,
      accessCount: r.access_count,
      lastAccessedAt: r.last_accessed_at,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  /**
   * Inserts a memory. Uniqueness is per (character, normalized hash): duplicates are
   * rejected with `null` rather than merged silently, so the caller decides whether to
   * bump importance. Character isolation is enforced at every query site.
   */
  insert(input: MemoryCreateInput): MemoryRow | null {
    const content = input.content.trim();
    if (!content) throw new Error('Memory content cannot be empty');
    const hash = fnv1a(normalizeForHash(content));
    const existing = this.db.get<Row>('SELECT * FROM memories WHERE character_id = ? AND hash = ?', [input.characterId, hash]);
    if (existing) {
      this.db.run('UPDATE memories SET importance = MAX(importance, ?), confidence = MAX(confidence, ?), updated_at = ? WHERE id = ?', [
        input.importance ?? 0.5,
        input.confidence ?? 0.7,
        nowIso(),
        existing.id,
      ]);
      return null;
    }
    const id = newId('mem');
    const now = nowIso();
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO memories (id, character_id, layer, category, content, importance, confidence, source, source_conversation_id,
          tags_json, embedding_json, hash, pinned, access_count, last_accessed_at, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`,
        [
          id,
          input.characterId,
          input.layer,
          input.category,
          content,
          clamp01(input.importance ?? 0.5),
          clamp01(input.confidence ?? 0.7),
          input.source ?? 'extraction',
          input.sourceConversationId ?? null,
          toJson(input.tags ?? []),
          input.embedding ? toJson(input.embedding) : null,
          hash,
          input.pinned ? 1 : 0,
          input.expiresAt ?? null,
          now,
          now,
        ],
      );
      const rowid = this.db.get<{ rowid: number }>('SELECT rowid FROM memories WHERE id = ?', [id])?.rowid;
      if (rowid === undefined) throw new Error('Memory insert failed');
      this.db.run('INSERT INTO memories_fts (rowid, content, tags) VALUES (?, ?, ?)', [
        rowid,
        content,
        (input.tags ?? []).join(' '),
      ]);
    });
    return this.get(id);
  }

  get(id: string): MemoryRow | null {
    const row = this.db.get<Row>('SELECT * FROM memories WHERE id = ?', [id]);
    return row ? this.toMemory(row) : null;
  }

  update(
    id: string,
    patch: Partial<Pick<MemoryRow, 'content' | 'importance' | 'confidence' | 'category' | 'tags' | 'pinned' | 'layer' | 'expiresAt'>>,
  ): MemoryRow {
    const current = this.get(id);
    if (!current) throw new Error('Memory not found');
    const content = patch.content?.trim() ?? current.content;
    const tags = patch.tags ?? current.tags;
    const hash = fnv1a(normalizeForHash(content));
    this.db.transaction(() => {
      this.db.run(
        `UPDATE memories SET content = ?, importance = ?, confidence = ?, category = ?, tags_json = ?, pinned = ?, layer = ?,
         expires_at = ?, hash = ?, updated_at = ? WHERE id = ?`,
        [
          content,
          clamp01(patch.importance ?? current.importance),
          clamp01(patch.confidence ?? current.confidence),
          patch.category ?? current.category,
          toJson(tags),
          (patch.pinned ?? current.pinned) ? 1 : 0,
          patch.layer ?? current.layer,
          patch.expiresAt === undefined ? current.expiresAt : patch.expiresAt,
          hash,
          nowIso(),
          id,
        ],
      );
      const rowid = this.db.get<{ rowid: number }>('SELECT rowid FROM memories WHERE id = ?', [id])?.rowid;
      if (rowid !== undefined) {
        this.db.run('DELETE FROM memories_fts WHERE rowid = ?', [rowid]);
        this.db.run('INSERT INTO memories_fts (rowid, content, tags) VALUES (?, ?, ?)', [rowid, content, tags.join(' ')]);
      }
    });
    return this.get(id)!;
  }

  remove(id: string): void {
    this.db.transaction(() => {
      const rowid = this.db.get<{ rowid: number }>('SELECT rowid FROM memories WHERE id = ?', [id])?.rowid;
      if (rowid !== undefined) this.db.run('DELETE FROM memories_fts WHERE rowid = ?', [rowid]);
      this.db.run('DELETE FROM memories WHERE id = ?', [id]);
    });
  }

  removeAllForCharacter(characterId: string, layer?: MemoryLayer): void {
    this.db.transaction(() => {
      const rows = layer
        ? this.db.all<{ rowid: number }>('SELECT rowid FROM memories WHERE character_id = ? AND layer = ?', [characterId, layer])
        : this.db.all<{ rowid: number }>('SELECT rowid FROM memories WHERE character_id = ?', [characterId]);
      for (const r of rows) this.db.run('DELETE FROM memories_fts WHERE rowid = ?', [r.rowid]);
      if (layer) this.db.run('DELETE FROM memories WHERE character_id = ? AND layer = ?', [characterId, layer]);
      else this.db.run('DELETE FROM memories WHERE character_id = ?', [characterId]);
    });
  }

  /** Character-scoped listing with optional filters. */
  list(params: MemorySearchParams): MemoryRow[] {
    const where: string[] = ['character_id = ?'];
    const args: SqlValue[] = [params.characterId];
    if (params.layers?.length) {
      where.push(`layer IN (${params.layers.map(() => '?').join(',')})`);
      args.push(...params.layers);
    }
    if (params.categories?.length) {
      where.push(`category IN (${params.categories.map(() => '?').join(',')})`);
      args.push(...params.categories);
    }
    if (params.minImportance !== undefined) {
      where.push('importance >= ?');
      args.push(params.minImportance);
    }
    if (params.pinnedOnly) where.push('pinned = 1');
    args.push(params.limit ?? 200, params.offset ?? 0);
    return this.db
      .all<Row>(
        `SELECT * FROM memories WHERE ${where.join(' AND ')} ORDER BY pinned DESC, importance DESC, updated_at DESC LIMIT ? OFFSET ?`,
        args,
      )
      .map((r) => this.toMemory(r));
  }

  /** FTS5 full-text search, character-scoped. Returns BM25-normalised scores in [0,1]. */
  searchFts(characterId: string, query: string, limit = 20): Array<MemoryRow & { score: number }> {
    const match = toFtsQuery(query);
    if (!match) return [];
    const rows = this.db.all<Row & { rank: number }>(
      `SELECT m.*, bm25(memories_fts) AS rank
       FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid
       WHERE memories_fts MATCH ? AND m.character_id = ?
       ORDER BY rank LIMIT ?`,
      [match, characterId, limit],
    );
    return rows.map((r) => ({ ...this.toMemory(r), score: bm25ToScore(r.rank) }));
  }

  recordAccess(ids: string[]): void {
    if (ids.length === 0) return;
    const now = nowIso();
    for (const id of ids) {
      this.db.run('UPDATE memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?', [now, id]);
    }
  }

  pruneExpired(now = nowIso()): number {
    const rows = this.db.all<{ id: string }>('SELECT id FROM memories WHERE expires_at IS NOT NULL AND expires_at < ?', [now]);
    for (const r of rows) this.remove(r.id);
    return rows.length;
  }

  count(characterId?: string, layer?: MemoryLayer): number {
    if (characterId && layer) {
      return Number(
        this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM memories WHERE character_id = ? AND layer = ?', [characterId, layer])?.n ?? 0,
      );
    }
    if (characterId) {
      return Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM memories WHERE character_id = ?', [characterId])?.n ?? 0);
    }
    return Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM memories')?.n ?? 0);
  }

  /** Layer counts for a character. */
  countsByLayer(characterId: string): Record<MemoryLayer, number> {
    const out: Record<MemoryLayer, number> = { short_term: 0, long_term: 0, episodic: 0, knowledge: 0 };
    const rows = this.db.all<{ layer: string; n: number }>(
      'SELECT layer, COUNT(*) AS n FROM memories WHERE character_id = ? GROUP BY layer',
      [characterId],
    );
    for (const r of rows) if (isLayer(r.layer)) out[r.layer] = Number(r.n);
    return out;
  }
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** bm25() returns negative values closer to 0 for better matches. Map to (0,1]. */
export function bm25ToScore(rank: number): number {
  if (!Number.isFinite(rank)) return 0;
  const r = -rank;
  return Math.min(1, Math.max(0, r / (r + 4)));
}
