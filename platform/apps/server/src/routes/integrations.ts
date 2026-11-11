import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { HttpError, json, notFound, parseBody, readJson, matchRoute } from '../http.js';

/**
 * Integration registry + MCP clients. Every integration reports its *real* state:
 * "not_configured", "configured_unverified", "connected" (after a successful live check),
 * or "error". Nothing is marked connected without a verified round-trip.
 */
const INTEGRATIONS = [
  { key: 'chrome', name: 'Google Chrome', category: 'Browser', how: 'Playwright launches your installed Chrome with a dedicated automation profile.', needs: 'Windows desktop app' },
  { key: 'edge', name: 'Microsoft Edge', category: 'Browser', how: 'Playwright channel="msedge" (no separate download needed).', needs: 'Windows desktop app' },
  { key: 'vscode', name: 'VS Code', category: 'Developer', how: 'Launch + workspace file access; deep commands via its extension API later.', needs: 'Windows desktop app' },
  { key: 'google-workspace', name: 'Google Workspace', category: 'Productivity', how: 'OAuth 2.0 with Gmail/Sheets/Docs scopes; tokens stored in the vault.', needs: 'Google OAuth client credentials' },
  { key: 'microsoft-365', name: 'Microsoft 365', category: 'Productivity', how: 'Microsoft Graph OAuth app registration.', needs: 'Azure app registration' },
  { key: 'telegram', name: 'Telegram', category: 'Communication', how: 'Bot API token for an account you control (user-account automation is not supported).', needs: 'Bot token' },
  { key: 'whatsapp', name: 'WhatsApp', category: 'Communication', how: 'WhatsApp Business Cloud API (official). Personal-account automation is not supported.', needs: 'Meta Business account + token' },
] as const;

export async function handleIntegrations(ctx: AppContext, req: IncomingMessage, res: ServerResponse, pathname: string, method: string): Promise<boolean> {
  if (pathname === '/api/integrations' && method === 'GET') {
    const stored = new Map(
      ctx.driver.all<{ key: string; status: string; config_json: string; last_error: string | null }>('SELECT * FROM integrations').map((r) => [r.key, r]),
    );
    json(res, 200, {
      integrations: INTEGRATIONS.map((i) => {
        const row = stored.get(i.key);
        return {
          ...i,
          status: row?.status ?? 'not_configured',
          lastError: row?.last_error ?? null,
          hasConfig: row ? row.config_json !== '{}' : false,
        };
      }),
    });
    return true;
  }

  if (pathname === '/api/integrations/mcp' && method === 'GET') {
    json(res, 200, { servers: ctx.driver.all('SELECT * FROM mcp_servers ORDER BY created_at DESC') });
    return true;
  }

  if (pathname === '/api/integrations/mcp' && method === 'POST') {
    const body = parseBody(
      z.object({
        name: z.string().min(2).max(60),
        transport: z.enum(['stdio-command', 'http-sse', 'websocket']),
        endpoint: z.string().min(3).max(500),
        bearerToken: z.string().max(500).optional(),
      }),
      await readJson(req),
    );
    const id = `mcp_${Date.now().toString(36)}`;
    const authJson = body.bearerToken ? JSON.stringify({ tokenCipher: await ctx.vault.encrypt(body.bearerToken) }) : '{}';
    ctx.driver.run(
      `INSERT INTO mcp_servers (id, name, transport, endpoint, auth_json, enabled, status, tools_json, last_error, last_connected_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 'disconnected', '[]', NULL, NULL, ?, ?)`,
      [id, body.name, body.transport, body.endpoint, authJson, new Date().toISOString(), new Date().toISOString()],
    );
    json(res, 201, { id, status: 'disconnected', note: 'Saved. Use "Connect" to verify the endpoint and discover tools.' });
    return true;
  }

  const mcpMatch = matchRoute('/api/integrations/mcp/:id/:action', pathname) ?? matchRoute('/api/integrations/mcp/:id', pathname);
  if (mcpMatch && method === 'POST') {
    const row = ctx.driver.get<{ id: string; name: string; transport: string; endpoint: string; auth_json: string }>('SELECT * FROM mcp_servers WHERE id = ?', [mcpMatch.id!]);
    if (!row) {
      notFound(res, 'MCP server');
      return true;
    }
    if (mcpMatch.action === 'connect') {
      const result = await connectMcp(ctx, row);
      ctx.driver.run('UPDATE mcp_servers SET status = ?, tools_json = ?, last_error = ?, last_connected_at = ?, updated_at = ? WHERE id = ?', [
        result.status,
        JSON.stringify(result.tools),
        result.error ?? null,
        result.status === 'connected' ? new Date().toISOString() : null,
        new Date().toISOString(),
        row.id,
      ]);
      const fresh = ctx.driver.get('SELECT * FROM mcp_servers WHERE id = ?', [row.id]);
      json(res, result.status === 'connected' ? 200 : 502, { server: fresh, ...result });
      return true;
    }
    if (mcpMatch.action === 'test-tool') {
      throw new HttpError(501, 'MCP tool invocation requires the desktop runtime (stdio transport) or a reachable HTTP MCP endpoint. Configure a reachable server and reconnect.');
    }
    if (mcpMatch.action === 'delete') {
      ctx.driver.run('DELETE FROM mcp_servers WHERE id = ?', [row.id]);
      json(res, 200, { ok: true });
      return true;
    }
  }

  const integrateMatch = matchRoute('/api/integrations/:key', pathname);
  if (integrateMatch) {
    const known = INTEGRATIONS.find((i) => i.key === integrateMatch.key);
    if (!known) {
      notFound(res, 'Integration');
      return true;
    }
    if (method === 'GET') {
      const row = ctx.driver.get('SELECT * FROM integrations WHERE key = ?', [known.key]);
      json(res, 200, { integration: { ...known, status: row ? (row as { status: string }).status : 'not_configured' }, config: row ? JSON.parse((row as { config_json: string }).config_json) : {} });
      return true;
    }
    if (method === 'PUT') {
      const body = parseBody(z.object({ config: z.record(z.unknown()).default({}) }), await readJson(req));
      const sanitized = { ...body.config };
      delete sanitized.token;
      delete sanitized.apiKey;
      ctx.driver.run(
        `INSERT INTO integrations (key, name, category, status, config_json, last_error, updated_at) VALUES (?, ?, ?, 'configured_unverified', ?, NULL, ?)
         ON CONFLICT(key) DO UPDATE SET config_json = excluded.config_json, status = 'configured_unverified', updated_at = excluded.updated_at`,
        [known.key, known.name, known.category, JSON.stringify(sanitized), new Date().toISOString()],
      );
      json(res, 200, { ok: true, status: 'configured_unverified', note: 'Configuration saved. Live verification happens in the desktop runtime.' });
      return true;
    }
  }

  return false;
}

/** Minimal MCP client: JSON-RPC `initialize` + `tools/list` over HTTP(S). */
async function connectMcp(
  ctx: AppContext,
  row: { id: string; name: string; transport: string; endpoint: string; auth_json: string },
): Promise<{ status: 'connected' | 'error'; tools: Array<{ name: string; description: string }>; error?: string }> {
  if (row.transport !== 'http-sse' && row.transport !== 'websocket') {
    return { status: 'error', tools: [], error: 'stdio MCP servers are launched by the desktop runtime, not the local server. Use an HTTP MCP endpoint here.' };
  }
  if (!/^https?:\/\//.test(row.endpoint)) return { status: 'error', tools: [], error: 'Endpoint must be an http(s) URL.' };
  let auth: { tokenCipher?: string } = {};
  try {
    auth = JSON.parse(row.auth_json) as { tokenCipher?: string };
  } catch {
    /* no auth */
  }
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (auth.tokenCipher) {
    try {
      headers.authorization = `Bearer ${await ctx.vault.decrypt(auth.tokenCipher)}`;
    } catch {
      return { status: 'error', tools: [], error: 'Stored MCP token could not be decrypted.' };
    }
  }
  try {
    const init = await fetch(row.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'aura', version: '0.1.0' } } }),
      signal: AbortSignal.timeout(8000),
    });
    if (!init.ok) return { status: 'error', tools: [], error: `initialize returned HTTP ${init.status}` };
    const tools = await fetch(row.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      signal: AbortSignal.timeout(8000),
    });
    if (!tools.ok) return { status: 'error', tools: [], error: `tools/list returned HTTP ${tools.status}` };
    const body = (await tools.json()) as { result?: { tools?: Array<{ name: string; description?: string }> } };
    const list = (body.result?.tools ?? []).map((t) => ({ name: t.name, description: t.description ?? '' }));
    ctx.db.audit.log({ actor: 'user', action: 'mcp.connect', target: row.name, outcome: 'success', detail: { tools: list.length } });
    return { status: 'connected', tools: list };
  } catch (err) {
    return { status: 'error', tools: [], error: `Connection failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
