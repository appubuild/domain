import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { PROVIDER_KEYS, keyHint, validateKeyShape, estimatedCost } from '@aura/core';
import type { AppContext } from '../context.js';
import { HttpError, json, parseBody, readJson, matchRoute } from '../http.js';

const providerParam = z.object({ provider: z.enum(PROVIDER_KEYS) });

export async function handleProviders(ctx: AppContext, req: IncomingMessage, res: ServerResponse, pathname: string, method: string): Promise<boolean> {
  if (pathname.startsWith('/api/providers/')) {
    const m = matchRoute('/api/providers/:provider/:action', pathname) ?? matchRoute('/api/providers/:provider', pathname);
    if (!m) return false;
    const parsed = providerParam.safeParse({ provider: m.provider });
    if (!parsed.success) throw new HttpError(404, `Unknown provider "${m.provider}"`);
    const provider = parsed.data.provider;

    if (method === 'PUT' && !m.action) {
      const body = parseBody(
        z.object({
          apiKey: z.string().min(8).max(500),
          baseUrl: z.string().url().max(500).nullable().optional(),
        }),
        await readJson(req),
      );
      const shape = validateKeyShape(provider, body.apiKey);
      if (!shape.ok) throw new HttpError(400, shape.message ?? 'Invalid key shape');
      if (provider === 'openai-compatible' && !body.baseUrl) throw new HttpError(400, 'An OpenAI-compatible provider needs a base URL.');
      const encrypted = await ctx.vault.encrypt(body.apiKey.trim());
      const rec = ctx.db.credentials.save({
        provider,
        encryptedKey: encrypted,
        keyHint: keyHint(body.apiKey.trim()),
        baseUrl: body.baseUrl ?? null,
      });
      ctx.db.audit.log({ actor: 'user', action: 'provider.credential.saved', target: provider, outcome: 'success', detail: { keyHint: rec.keyHint } });
      json(res, 201, { provider, keyHint: rec.keyHint, configured: true });
      return true;
    }

    if (method === 'DELETE' && !m.action) {
      ctx.db.credentials.remove(provider);
      ctx.db.audit.log({ actor: 'user', action: 'provider.credential.removed', target: provider, outcome: 'success' });
      json(res, 200, { ok: true });
      return true;
    }

    if (m.action === 'test' && method === 'POST') {
      const key = await ctx.getApiKey(provider);
      if (!key) throw new HttpError(400, 'No key stored for this provider. Save a key first.');
      const started = Date.now();
      try {
        const adapter = await ctx.router.provider(provider);
        const result = await adapter.testConnection();
        ctx.db.credentials.markVerified(provider, result.status === 'unsupported' ? 'invalid' : result.status);
        json(res, 200, { ...result, latencyMs: result.latencyMs ?? Date.now() - started, models: (result.models ?? []).slice(0, 80) });
      } catch (err) {
        ctx.db.credentials.markVerified(provider, 'network_error');
        json(res, 200, { ok: false, status: 'network_error', message: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    if (m.action === 'models' && method === 'GET') {
      const key = await ctx.getApiKey(provider);
      if (!key) throw new HttpError(400, 'No key stored for this provider.');
      try {
        const adapter = await ctx.router.provider(provider);
        const models = await adapter.listModels();
        json(res, 200, { models });
      } catch (err) {
        throw new HttpError(502, `Could not list models: ${err instanceof Error ? err.message : String(err)}`);
      }
      return true;
    }
    return false;
  }

  if (pathname === '/api/models/available' && method === 'GET') {
    const configured = (await ctx.router.availableProviders()).map((p) => ({ provider: p, configured: true }));
    json(res, 200, {
      providers: configured,
      note: configured.length === 0 ? 'No providers configured. Chat requires at least one API key.' : 'Provider keys are configured. Use /api/providers/:provider/models to fetch model lists.',
      defaults: { openai: 'gpt-4.1-mini', anthropic: 'claude-sonnet-4-5', google: 'gemini-2.5-flash' },
    });
    return true;
  }

  if (pathname === '/api/models/pricing' && method === 'GET') {
    json(res, 200, {
      note: 'Public list prices for estimation only. Verify with your provider billing.',
      examples: ['gpt-4.1-mini', 'claude-sonnet-4-5', 'gemini-2.5-flash'].map((m) => ({ model: m, cost100kMixed: Number(estimatedCost(m, 50_000, 50_000).toFixed(4)) })),
    });
    return true;
  }

  return false;
}
