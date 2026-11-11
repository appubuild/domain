import { existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync, inflateRawSync } from 'node:zlib';
import { chunkText, embedText, extractText, type Db } from '@aura/core';
import type { ServerConfig } from '../config.js';
import type { WorkspaceKnowledge } from './knowledge.js';

/**
 * Knowledge Base ingestion: stores the original file untouched under
 * data/knowledge/<id>/<name>, extracts text, chunks it, embeds each chunk and indexes
 * it. Original files are never overwritten by generated summaries.
 */
export class DocumentService {
  constructor(
    private readonly db: Db,
    private readonly knowledge: WorkspaceKnowledge,
    private readonly config: ServerConfig,
  ) {}

  private dir(id: string): string {
    const d = join(this.config.dataDir, 'knowledge', id);
    mkdirSync(d, { recursive: true });
    return d;
  }

  ingest(input: { characterId: string | null; fileName: string; mimeType: string; bytes: Buffer }): { documentId: string; status: string; chunks: number; warning?: string } {
    const doc = this.db.documents.create({
      characterId: input.characterId,
      title: input.fileName.replace(/\.[^.]+$/, ''),
      mimeType: input.mimeType || 'application/octet-stream',
      fileName: input.fileName,
      sizeBytes: input.bytes.length,
      storagePath: null,
    });
    const dir = this.dir(doc.id);
    const original = join(dir, input.fileName.replace(/[^\w.\- ]+/g, '_').slice(0, 120));
    writeFileSync(original, input.bytes);
    const extracted = extractText(input.fileName, new Uint8Array(input.bytes), {
      inflate: (d) => new Uint8Array(inflateSync(d)),
      inflateRaw: (d) => new Uint8Array(inflateRawSync(d)),
    });
    if (extracted.format === 'unsupported' || (!extracted.text && extracted.warning)) {
      this.db.documents.markFailed(doc.id, extracted.warning ?? 'No extractable text.');
      return { documentId: doc.id, status: 'failed', chunks: 0, warning: extracted.warning };
    }
    const chunks = chunkText(extracted.text, { maxChars: 1400, overlap: 180 });
    if (chunks.length === 0) {
      this.db.documents.markFailed(doc.id, 'Document contained no usable text.');
      return { documentId: doc.id, status: 'failed', chunks: 0, warning: 'No usable text' };
    }
    this.db.documents.saveChunks(doc.id, input.characterId, chunks.map((content) => ({ content, embedding: embedText(content) })));
    // Index a short knowledge-layer memory so the doc shows up in memory search too
    // (only for character-scoped documents; global docs stay in the document index).
    if (input.characterId) {
      this.db.memories.insert({
        characterId: input.characterId,
        layer: 'knowledge',
        category: 'knowledge',
        content: `Imported document "${doc.title}" (${chunks.length} sections, ${Math.round(input.bytes.length / 1024)} KB).`,
        importance: 0.4,
        confidence: 1,
        source: 'document',
        tags: ['document', extracted.format],
        embedding: embedText(doc.title),
      });
    }
    return { documentId: doc.id, status: 'indexed', chunks: chunks.length, warning: extracted.warning };
  }

  readOriginal(documentId: string): { path: string; name: string } | null {
    const doc = this.db.documents.get(documentId);
    if (!doc) return null;
    const dir = join(this.config.dataDir, 'knowledge', doc.id);
    if (!existsSync(dir)) return null;
    const files = readdirSync(dir) as string[];
    const first = files[0];
    return first ? { path: join(dir, first), name: first } : null;
  }

  remove(documentId: string): void {
    const doc = this.db.documents.get(documentId);
    if (doc) {
      const dir = join(this.config.dataDir, 'knowledge', doc.id);
      try {
        for (const f of readdirSync(dir) as string[]) unlinkSync(join(dir, f));
      } catch {
        /* directory may not exist */
      }
    }
    this.db.documents.remove(documentId);
  }
}
