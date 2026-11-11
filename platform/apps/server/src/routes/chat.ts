import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { redactSecrets } from '@aura/core';
import type { AppContext } from '../context.js';
import { HttpError, json, notFound, parseBody, readJson, sseInit, sseSend, matchRoute } from '../http.js';

const chatBodySchema = z.object({
  characterId: z.string().min(1),
  conversationId: z.string().nullable().optional(),
  message: z.string().min(1).max(60_000),
  mode: z.enum(['companion', 'agent']).default('companion'),
});

export async function handleChat(ctx: AppContext, req: IncomingMessage, res: ServerResponse, pathname: string, method: string): Promise<boolean> {
  if (pathname === '/api/chat/stream' && method === 'POST') {
    const body = parseBody(chatBodySchema, await readJson(req));
    const character = ctx.db.characters.get(body.characterId);
    if (!character) throw new HttpError(404, 'Character not found');

    const abort = new AbortController();
    req.on('close', () => abort.abort());
    sseInit(res);
    const chat = ctx.chatFor(character);

    try {
      for await (const chunk of chat.streamChat({
        character,
        conversationId: body.conversationId ?? null,
        userText: body.message,
        mode: body.mode,
        signal: abort.signal,
      })) {
        if (res.writableEnded) break;
        sseSend(res, chunk.type, chunk);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sseSend(res, 'error', { type: 'error', message, kind: 'internal', retryable: false });
    } finally {
      if (!res.writableEnded) res.end();
    }
    return true;
  }

  if (pathname === '/api/conversations' && method === 'GET') {
    const url = new URL(req.url ?? '/', 'http://local');
    const characterId = url.searchParams.get('characterId') ?? undefined;
    json(res, 200, { conversations: ctx.db.conversations.list(characterId) });
    return true;
  }

  if (pathname === '/api/conversations' && method === 'POST') {
    const body = parseBody(
      z.object({ characterId: z.string(), title: z.string().max(120).optional(), mode: z.enum(['companion', 'agent']).default('companion') }),
      await readJson(req),
    );
    if (!ctx.db.characters.get(body.characterId)) throw new HttpError(404, 'Character not found');
    const conv = ctx.db.conversations.create(body.characterId, body.title ?? 'New conversation', body.mode);
    json(res, 201, { conversation: conv });
    return true;
  }

  if (pathname === '/api/conversations/search' && method === 'GET') {
    const url = new URL(req.url ?? '/', 'http://local');
    const q = url.searchParams.get('q') ?? '';
    const characterId = url.searchParams.get('characterId') ?? undefined;
    if (!q.trim()) {
      json(res, 200, { messages: [] });
      return true;
    }
    json(res, 200, { messages: ctx.db.conversations.searchMessages(q, characterId) });
    return true;
  }

  if (pathname === '/api/conversations/summarize' && method === 'POST') {
    const body = parseBody(z.object({ conversationId: z.string() }), await readJson(req));
    const conv = ctx.db.conversations.get(body.conversationId);
    if (!conv) throw new HttpError(404, 'Conversation not found');
    const character = ctx.db.characters.get(conv.characterId);
    if (!character) throw new HttpError(404, 'Character not found');
    const messages = ctx.db.conversations.messages(conv.id);
    const memory = ctx.memory.summarizeConversation({
      characterId: conv.characterId,
      conversationId: conv.id,
      messages,
      retentionDays: character.config.memory.retentionDays,
    });
    json(res, 200, { memory, created: memory !== null });
    return true;
  }

  const msgMatch = matchRoute('/api/conversations/:id', pathname);
  if (msgMatch) {
    const conv = ctx.db.conversations.get(msgMatch.id!);
    if (!conv) {
      notFound(res, 'Conversation');
      return true;
    }
    if (method === 'GET') {
      const messages = ctx.db.conversations.messages(conv.id).map((m) => ({
        ...m,
        meta: JSON.parse(redactSecrets(JSON.stringify(m.meta))) as Record<string, unknown>,
      }));
      json(res, 200, { conversation: conv, messages, character: ctx.db.characters.get(conv.characterId) });
      return true;
    }
    if (method === 'DELETE') {
      ctx.db.conversations.delete(conv.id);
      json(res, 200, { ok: true });
      return true;
    }
    if (method === 'PATCH') {
      const body = parseBody(z.object({ title: z.string().min(1).max(200) }), await readJson(req));
      ctx.db.conversations.rename(conv.id, body.title);
      json(res, 200, { ok: true });
      return true;
    }
  }

  return false;
}
