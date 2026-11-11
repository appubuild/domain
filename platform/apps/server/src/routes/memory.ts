import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { MEMORY_LAYERS, MEMORY_CATEGORIES } from '@aura/core';
import type { AppContext } from '../context.js';
import { HttpError, json, notFound, parseBody, readJson, matchRoute } from '../http.js';

const filterSchema = z.object({
  characterId: z.string().min(1),
  q: z.string().max(400).optional(),
  layers: z.array(z.enum(MEMORY_LAYERS)).optional(),
  categories: z.array(z.enum(MEMORY_CATEGORIES)).optional(),
  minImportance: z.coerce.number().min(0).max(1).optional(),
  pinnedOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(500).default(100),
});

export async function handleMemory(ctx: AppContext, req: IncomingMessage, res: ServerResponse, pathname: string, method: string): Promise<boolean> {
  if (pathname === '/api/memory' && method === 'GET') {
    const url = new URL(req.url ?? '/', 'http://local');
    const parsed = filterSchema.safeParse({
      characterId: url.searchParams.get('characterId') ?? '',
      q: url.searchParams.get('q') ?? undefined,
      layers: url.searchParams.getAll('layer').filter(Boolean),
      categories: url.searchParams.getAll('category').filter(Boolean),
      minImportance: url.searchParams.get('minImportance') ?? undefined,
      pinnedOnly: url.searchParams.get('pinnedOnly') === 'true' || undefined,
      limit: url.searchParams.get('limit') ?? 100,
    });
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join('; '));
    const { characterId, q, layers, categories, minImportance, pinnedOnly, limit } = parsed.data;
    if (!ctx.db.characters.get(characterId)) throw new HttpError(404, 'Character not found');
    const rows = q?.trim()
      ? ctx.memory.search({ characterId, query: q, limit, ...(layers?.length ? { layers } : {}) })
      : ctx.db.memories.list({ characterId, layers, categories, minImportance, pinnedOnly, limit });
    json(res, 200, {
      memories: rows,
      counts: ctx.db.memories.countsByLayer(characterId),
      total: ctx.db.memories.count(characterId),
    });
    return true;
  }

  if (pathname === '/api/memory' && method === 'POST') {
    const body = parseBody(
      z.object({
        characterId: z.string().min(1),
        content: z.string().min(3).max(4000),
        layer: z.enum(MEMORY_LAYERS).default('long_term'),
        category: z.enum(MEMORY_CATEGORIES).default('fact'),
        importance: z.number().min(0).max(1).default(0.6),
        confidence: z.number().min(0).max(1).default(1),
        tags: z.array(z.string()).default([]),
      }),
      await readJson(req),
    );
    if (!ctx.db.characters.get(body.characterId)) throw new HttpError(404, 'Character not found');
    const row = ctx.db.memories.insert({
      characterId: body.characterId,
      content: body.content,
      layer: body.layer ?? 'long_term',
      category: body.category ?? 'fact',
      importance: body.importance,
      confidence: body.confidence,
      tags: body.tags,
      source: 'manual',
      embedding: ctx.memory.embedFor(body.content),
    });
    json(res, 201, { memory: row, duplicate: row === null });
    return true;
  }

  if (pathname === '/api/memory/stats' && method === 'GET') {
    const url = new URL(req.url ?? '/', 'http://local');
    const characters = ctx.db.characters.list();
    json(res, 200, {
      characters: characters.map((c) => ({ id: c.id, name: c.name, counts: ctx.db.memories.countsByLayer(c.id) })),
      total: characters.reduce((s, c) => s + ctx.db.memories.count(c.id), 0),
      currentCharacterId: url.searchParams.get('characterId'),
    });
    return true;
  }

  if (pathname === '/api/memory/consolidate' && method === 'POST') {
    const body = parseBody(z.object({ characterId: z.string() }), await readJson(req));
    const result = ctx.memory.consolidate(body.characterId);
    ctx.db.audit.log({ actor: 'user', action: 'memory.consolidate', target: body.characterId, outcome: 'success', detail: result });
    json(res, 200, result);
    return true;
  }

  if (pathname === '/api/memory/retention' && method === 'POST') {
    const removed = ctx.memory.applyRetention();
    json(res, 200, { removed });
    return true;
  }

  if (pathname === '/api/memory/export' && method === 'GET') {
    const url = new URL(req.url ?? '/', 'http://local');
    const characterId = url.searchParams.get('characterId');
    if (!characterId) throw new HttpError(400, 'characterId is required');
    const rows = ctx.db.memories.list({ characterId, limit: 10000 });
    json(res, 200, {
      format: 'aura.memories',
      formatVersion: 1,
      characterId,
      exportedAt: new Date().toISOString(),
      memories: rows.map((m) => ({ ...m, embedding: undefined })),
    });
    return true;
  }

  if (pathname === '/api/memory/clear' && method === 'POST') {
    const body = parseBody(z.object({ characterId: z.string(), layer: z.enum(MEMORY_LAYERS).optional() }), await readJson(req));
    ctx.db.memories.removeAllForCharacter(body.characterId, body.layer);
    ctx.db.audit.log({ actor: 'user', action: 'memory.clear', target: body.characterId, outcome: 'success', detail: { layer: body.layer ?? 'all' } });
    json(res, 200, { ok: true });
    return true;
  }

  const idMatch = matchRoute('/api/memory/:id', pathname);
  if (idMatch) {
    const id = idMatch.id!;
    if (method === 'GET') {
      const row = ctx.db.memories.get(id);
      if (!row) {
        notFound(res, 'Memory');
        return true;
      }
      json(res, 200, { memory: row });
      return true;
    }
    if (method === 'PATCH') {
      const body = parseBody(
        z.object({
          content: z.string().min(3).max(4000).optional(),
          importance: z.number().min(0).max(1).optional(),
          confidence: z.number().min(0).max(1).optional(),
          category: z.enum(MEMORY_CATEGORIES).optional(),
          layer: z.enum(MEMORY_LAYERS).optional(),
          tags: z.array(z.string()).optional(),
          pinned: z.boolean().optional(),
        }),
        await readJson(req),
      );
      const updated = ctx.db.memories.update(id, body);
      json(res, 200, { memory: updated });
      return true;
    }
    if (method === 'DELETE') {
      ctx.db.memories.remove(id);
      json(res, 200, { ok: true });
      return true;
    }
  }

  return false;
}
