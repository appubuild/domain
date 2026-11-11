import type { SqlDriver } from './types.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';

export type DocumentRecord = {
  id: string;
  characterId: string | null;
  title: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  storagePath: string | null;
  status: 'pending' | 'indexed' | 'failed';
  error: string | null;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ChunkRecord = {
  id: string;
  documentId: string;
  characterId: string | null;
  chunkIndex: number;
  content: string;
  embedding: number[] | null;
};

type DocRow = {
  id: string;
  character_id: string | null;
  title: string;
  mime_type: string;
  file_name: string;
  size_bytes: number;
  storage_path: string | null;
  status: string;
  error: string | null;
  chunk_count: number;
  created_at: string;
  updated_at: string;
};

export class DocumentsRepo {
  constructor(private readonly db: SqlDriver) {}

  private doc(r: DocRow): DocumentRecord {
    return {
      id: r.id,
      characterId: r.character_id,
      title: r.title,
      mimeType: r.mime_type,
      fileName: r.file_name,
      sizeBytes: r.size_bytes,
      storagePath: r.storage_path,
      status: r.status as DocumentRecord['status'],
      error: r.error,
      chunkCount: r.chunk_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  create(input: { characterId?: string | null; title: string; mimeType: string; fileName: string; sizeBytes: number; storagePath: string | null }): DocumentRecord {
    const id = newId('doc');
    const now = nowIso();
    this.db.run(
      `INSERT INTO documents (id, character_id, title, mime_type, file_name, size_bytes, storage_path, status, error, chunk_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, 0, ?, ?)`,
      [id, input.characterId ?? null, input.title, input.mimeType, input.fileName, input.sizeBytes, input.storagePath, now, now],
    );
    return this.get(id)!;
  }

  get(id: string): DocumentRecord | null {
    const row = this.db.get<DocRow>('SELECT * FROM documents WHERE id = ?', [id]);
    return row ? this.doc(row) : null;
  }

  list(): DocumentRecord[] {
    return this.db.all<DocRow>('SELECT * FROM documents ORDER BY created_at DESC').map((r) => this.doc(r));
  }

  saveChunks(documentId: string, characterId: string | null, chunks: Array<{ content: string; embedding: number[] }>): void {
    this.db.transaction(() => {
      const existing = this.db.all<{ id: string; rowid: number }>(
        'SELECT id, rowid FROM document_chunks WHERE document_id = ?',
        [documentId],
      );
      for (const e of existing) this.db.run('DELETE FROM document_chunks_fts WHERE rowid = ?', [e.rowid]);
      this.db.run('DELETE FROM document_chunks WHERE document_id = ?', [documentId]);
      const now = nowIso();
      chunks.forEach((c, i) => {
        const id = newId('chk');
        this.db.run(
          'INSERT INTO document_chunks (id, document_id, character_id, chunk_index, content, embedding_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [id, documentId, characterId, i, c.content, JSON.stringify(c.embedding), now],
        );
        const rowid = this.db.get<{ rowid: number }>('SELECT rowid FROM document_chunks WHERE id = ?', [id])?.rowid;
        if (rowid !== undefined) this.db.run('INSERT INTO document_chunks_fts (rowid, content) VALUES (?, ?)', [rowid, c.content]);
      });
      this.db.run("UPDATE documents SET status = 'indexed', chunk_count = ?, error = NULL, updated_at = ? WHERE id = ?", [
        chunks.length,
        now,
        documentId,
      ]);
    });
  }

  markFailed(id: string, error: string): void {
    this.db.run("UPDATE documents SET status = 'failed', error = ?, updated_at = ? WHERE id = ?", [error.slice(0, 500), nowIso(), id]);
  }

  remove(id: string): void {
    this.db.transaction(() => {
      const rows = this.db.all<{ rowid: number }>('SELECT rowid FROM document_chunks WHERE document_id = ?', [id]);
      for (const r of rows) this.db.run('DELETE FROM document_chunks_fts WHERE rowid = ?', [r.rowid]);
      this.db.run('DELETE FROM document_chunks WHERE document_id = ?', [id]);
      this.db.run('DELETE FROM documents WHERE id = ?', [id]);
    });
  }

  chunks(documentId: string): ChunkRecord[] {
    return this.db
      .all<{ id: string; document_id: string; character_id: string | null; chunk_index: number; content: string; embedding_json: string | null }>(
        'SELECT * FROM document_chunks WHERE document_id = ? ORDER BY chunk_index',
        [documentId],
      )
      .map((r) => ({
        id: r.id,
        documentId: r.document_id,
        characterId: r.character_id,
        chunkIndex: r.chunk_index,
        content: r.content,
        embedding: r.embedding_json ? (JSON.parse(r.embedding_json) as number[]) : null,
      }));
  }

  /** FTS over knowledge chunks, restricted to global docs or the given character's docs. */
  searchChunks(query: string, characterId: string | null, limit = 10): Array<ChunkRecord & { score: number }> {
    const tokens = query
      .toLowerCase()
      .match(/[\p{L}\p{N}]{3,}/gu)
      ?.slice(0, 16)
      .map((t) => `"${t.replace(/"/g, '""')}"`);
    if (!tokens?.length) return [];
    const rows = this.db.all<{ id: string; document_id: string; character_id: string | null; chunk_index: number; content: string; embedding_json: string | null; rank: number }>(
      `SELECT c.*, bm25(document_chunks_fts) AS rank
       FROM document_chunks_fts JOIN document_chunks c ON c.rowid = document_chunks_fts.rowid
       WHERE document_chunks_fts MATCH ? AND (c.character_id IS NULL OR c.character_id = ?)
       ORDER BY rank LIMIT ?`,
      [tokens.join(' '), characterId, limit],
    );
    return rows.map((r) => ({
      id: r.id,
      documentId: r.document_id,
      characterId: r.character_id,
      chunkIndex: r.chunk_index,
      content: r.content,
      embedding: r.embedding_json ? (JSON.parse(r.embedding_json) as number[]) : null,
      score: Math.min(1, -r.rank / 6),
    }));
  }
}
