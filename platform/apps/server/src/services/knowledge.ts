import type { Db, DocumentsRepo } from '@aura/core';
import { embedText, cosineSimilarity, type MemoryEngine } from '@aura/core';

/**
 * Knowledge retrieval across imported document chunks. Uses FTS5 + embeddings inside
 * the character's isolation boundary: global docs are visible to everyone, a
 * character's private docs only to that character.
 */
export class WorkspaceKnowledge {
  constructor(
    private readonly documentsRepo: DocumentsRepo,
    private readonly db: Db,
    private readonly memory: MemoryEngine,
  ) {}

  chunks(characterId: string | null, query: string, limit: number): Array<{ documentId: string; content: string; score: number }> {
    const lexical = this.documentsRepo.searchChunks(query, characterId, limit * 3);
    const qv = embedText(query);
    const docs = this.documentsRepo.list();
    const semantic: Array<{ documentId: string; content: string; score: number }> = [];
    for (const doc of docs) {
      if (doc.status !== 'indexed') continue;
      if (doc.characterId && doc.characterId !== characterId) continue;
      for (const chunk of this.documentsRepo.chunks(doc.id)) {
        const score = cosineSimilarity(qv, chunk.embedding ?? embedText(chunk.content));
        if (score > 0.12) semantic.push({ documentId: doc.id, content: chunk.content, score });
      }
    }
    semantic.sort((a, b) => b.score - a.score);
    // Both sources must use the same key, otherwise a passage that scores in both the
    // lexical and the semantic pass appears twice instead of being boosted once.
    const keyOf = (c: { documentId: string; content: string }) => `${c.documentId}:${c.content.slice(0, 64)}`;
    const merged = new Map<string, { documentId: string; content: string; score: number }>();
    for (const c of lexical) merged.set(keyOf(c), { documentId: c.documentId, content: c.content, score: c.score + 0.5 });
    for (const c of semantic.slice(0, limit * 2)) {
      const prev = merged.get(keyOf(c));
      if (prev) prev.score += c.score;
      else merged.set(keyOf(c), { ...c });
    }
    return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Called after ingestion so knowledge is only trusted once indexed. */
  async prepareDocumentText(characterId: string | null, documentId: string): Promise<number> {
    const doc = this.documentsRepo.get(documentId);
    if (!doc) return 0;
    const chunks = this.documentsRepo.chunks(documentId);
    this.memory; // memory layer consumed by the document service for summaries
    return chunks.filter((c) => !characterId || c.characterId === characterId || c.characterId === null).length;
  }
}
