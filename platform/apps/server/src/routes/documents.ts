import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { HttpError, json, notFound, readBuffer, readJson, matchRoute, parseBody } from '../http.js';

/**
 * Knowledge base ingestion. Body is either raw file bytes (application/octet-stream with
 * X-File-Name header) or JSON with base64 content, so the browser and desktop can both use it.
 */
export async function handleDocuments(ctx: AppContext, req: IncomingMessage, res: ServerResponse, pathname: string, method: string): Promise<boolean> {
  if (pathname === '/api/documents' && method === 'GET') {
    json(res, 200, { documents: ctx.db.documents.list() });
    return true;
  }

  if (pathname === '/api/documents' && method === 'POST') {
    const contentType = String(req.headers['content-type'] ?? '');
    let fileName: string;
    let characterId: string | null = (req.headers['x-character-id'] as string) || null;
    let bytes: Buffer;
    let mimeType = 'application/octet-stream';
    if (contentType.includes('application/json')) {
      const body = parseBody(
        z.object({ fileName: z.string().min(1).max(200), contentBase64: z.string().min(4), characterId: z.string().nullable().optional(), mimeType: z.string().optional() }),
        await readJson(req),
      );
      fileName = body.fileName;
      characterId = body.characterId ?? null;
      mimeType = body.mimeType ?? mimeType;
      bytes = Buffer.from(body.contentBase64, 'base64');
    } else {
      fileName = String(req.headers['x-file-name'] ?? '').trim();
      if (!fileName) throw new HttpError(400, 'X-File-Name header is required for raw uploads.');
      mimeType = contentType || mimeType;
      bytes = await readBuffer(req);
    }
    if (characterId && !ctx.db.characters.get(characterId)) throw new HttpError(404, 'Character not found');
    const result = ctx.documents.ingest({ characterId, fileName, mimeType, bytes });
    ctx.db.audit.log({ actor: 'user', action: 'document.import', target: result.documentId, outcome: result.status === 'indexed' ? 'success' : 'failure', detail: { chunks: result.chunks } });
    json(res, result.status === 'indexed' ? 201 : 422, { ...result, document: ctx.db.documents.get(result.documentId) });
    return true;
  }

  if (pathname === '/api/documents/search' && method === 'GET') {
    const url = new URL(req.url ?? '/', 'http://local');
    const q = url.searchParams.get('q') ?? '';
    const characterId = url.searchParams.get('characterId');
    if (!q.trim()) {
      json(res, 200, { results: [] });
      return true;
    }
    json(res, 200, { results: ctx.knowledge.chunks(characterId, q, 10) });
    return true;
  }

  const idMatch = matchRoute('/api/documents/:id', pathname);
  if (idMatch) {
    const doc = ctx.db.documents.get(idMatch.id!);
    if (!doc) {
      notFound(res, 'Document');
      return true;
    }
    if (method === 'GET') {
      json(res, 200, { document: doc, chunks: ctx.db.documents.chunks(doc.id).map((c) => ({ index: c.chunkIndex, preview: c.content.slice(0, 220) })) });
      return true;
    }
    if (method === 'DELETE') {
      ctx.documents.remove(doc.id);
      json(res, 200, { ok: true });
      return true;
    }
  }

  return false;
}
