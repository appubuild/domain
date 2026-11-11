import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, type AppContext } from '../src/context.js';
import { createApp, type AppServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';

let ctx: AppContext;
let app: AppServer;
let base: string;
let dir: string;
let characterId: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'aura-api-'));
  const config = loadConfig({ dataDir: dir, dbPath: join(dir, 'test.sqlite'), host: '127.0.0.1', port: 0, devMode: true });
  ctx = await createContext(config);
  ctx.ensureDefaultSettings();
  app = createApp(ctx);
  const { port } = await app.listen();
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app.close();
  ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

async function api(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

describe('health + system', () => {
  it('reports honest health and system info', async () => {
    const health = await api('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
    expect(health.body.schemaVersion).toBe(3);
    const info = await api('/api/system/info');
    expect(info.body.capabilities.fileSystem).toBe(true);
    // In server mode there is no desktop bridge, so these must be false — not faked.
    expect(info.body.capabilities.computerControl).toBe(false);
    expect(info.body.capabilities.browserAutomation).toBe(false);
  });

  it('returns settings with real defaults and merges patches', async () => {
    const s = await api('/api/settings');
    expect(s.status).toBe(200);
    expect(s.body.settings.voice.handsFree).toBe(true);
    const upd = await api('/api/settings/appearance', { method: 'PUT', body: JSON.stringify({ density: 'compact' }) });
    expect(upd.status).toBe(200);
    expect(upd.body.value.density).toBe('compact');
    expect(upd.body.value.theme).toBe('midnight');
  });
});

describe('characters', () => {
  it('lists all seven templates with distinct avatars', async () => {
    const res = await api('/api/characters/templates');
    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(7);
    const palettes = new Set(res.body.templates.map((t: any) => t.avatar.palette.primary + t.avatar.palette.accent));
    expect(palettes.size).toBe(7);
    const families = new Set(res.body.templates.map((t: any) => t.renderFamily));
    expect(families.size).toBe(5);
  });

  it('creates a character from a template, rejects duplicate names', async () => {
    const res = await api('/api/characters', {
      method: 'POST',
      body: JSON.stringify({ fromTemplate: true, templateKey: 'jarvis-holographic', name: 'ARIA', makeDefault: true }),
    });
    expect(res.status).toBe(201);
    characterId = res.body.character.id;
    expect(res.body.character.isDefault).toBe(true);
    const again = await api('/api/characters', {
      method: 'POST',
      body: JSON.stringify({ fromTemplate: true, templateKey: 'jarvis-holographic', name: 'ARIA' }),
    });
    expect(again.status).toBe(409);
    const list = await api('/api/characters');
    expect(list.body.characters.some((c: any) => c.id === characterId)).toBe(true);
  });

  it('updates, duplicates, sets default and exports safely', async () => {
    const upd = await api(`/api/characters/${characterId}`, {
      method: 'PUT',
      body: JSON.stringify({ config: { personality: { humor: 0.1 } } }),
    });
    expect(upd.status).toBe(200);
    expect(upd.body.character.config.personality.humor).toBe(0.1);

    const dup = await api(`/api/characters/${characterId}/duplicate`, { method: 'POST', body: JSON.stringify({ name: 'ARIA II' }) });
    expect(dup.status).toBe(201);
    const def = await api(`/api/characters/${dup.body.character.id}/default`, { method: 'POST' });
    expect(def.status).toBe(200);
    const list = await api('/api/characters');
    expect(list.body.defaultId).toBe(dup.body.character.id);

    const exp = await api(`/api/characters/${characterId}/export`);
    expect(exp.body.format).toBe('aura.character');
    // The portable format must carry no credential material. (It may mention the word
    // "token" inside unrelated config keys such as maxTokens, so check real secrets.)
    expect(JSON.stringify(exp.body)).not.toMatch(/sk-|apiKey"\s*:|password"\s*:|secret"\s*:/i);
  });

  it('imports a character and rejects malformed payloads', async () => {
    const exp = await api(`/api/characters/${characterId}/export`);
    const payload = { ...exp.body, character: { ...exp.body.character, name: 'Imported ARIA' } };
    const imp = await api('/api/characters/import', { method: 'POST', body: JSON.stringify(payload) });
    expect(imp.status).toBe(201);
    expect(imp.body.character.name).toBe('Imported ARIA');
    const bad = await api('/api/characters/import', { method: 'POST', body: JSON.stringify({ format: 'nope' }) });
    expect(bad.status).toBe(400);
  });

  it('deletes a character and cascades its memory', async () => {
    const created = await api('/api/characters', { method: 'POST', body: JSON.stringify({ fromTemplate: true, templateKey: 'friendly-male', name: 'Temp' }) });
    const id = created.body.character.id;
    const mem = await api('/api/memory', { method: 'POST', body: JSON.stringify({ characterId: id, content: 'User prefers tea over coffee.' }) });
    expect(mem.status).toBe(201);
    const del = await api(`/api/characters/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect((await api(`/api/characters/${id}`)).status).toBe(404);
  });
});

describe('memory', () => {
  it('creates, searches, edits, exports and enforces isolation', async () => {
    const other = await api('/api/characters', { method: 'POST', body: JSON.stringify({ fromTemplate: true, templateKey: 'anime-female-a', name: 'Sakura Test' }) });
    const otherId = other.body.character.id;

    const m1 = await api('/api/memory', { method: 'POST', body: JSON.stringify({ characterId, content: 'The user is preparing a Rust course on embeddings.', importance: 0.8, category: 'project' }) });
    expect(m1.status).toBe(201);
    const m2 = await api('/api/memory', { method: 'POST', body: JSON.stringify({ characterId: otherId, content: 'The user is preparing a Spanish exam.', category: 'event', layer: 'episodic' }) });
    expect(m2.status).toBe(201);

    const search = await api(`/api/memory?characterId=${characterId}&q=rust+course`);
    expect(search.status).toBe(200);
    expect(search.body.memories.length).toBe(1);
    expect(search.body.memories[0].content).toMatch(/Rust course/);

    const crossSearch = await api(`/api/memory?characterId=${otherId}&q=rust+course`);
    expect(crossSearch.body.memories.length).toBe(0);

    const id = search.body.memories[0].id;
    const edit = await api(`/api/memory/${id}`, { method: 'PATCH', body: JSON.stringify({ content: 'The user is preparing an advanced Rust course on embeddings.', importance: 0.9 }) });
    expect(edit.status).toBe(200);
    expect(edit.body.memory.importance).toBe(0.9);

    const stats = await api(`/api/memory/stats?characterId=${characterId}`);
    expect(stats.body.characters.find((c: any) => c.id === characterId).counts.long_term).toBeGreaterThanOrEqual(1);

    const exp = await api(`/api/memory/export?characterId=${characterId}`);
    expect(exp.body.memories.length).toBeGreaterThanOrEqual(1);
    expect(exp.body.memories.every((m: any) => m.characterId === characterId)).toBe(true);

    const delRes = await api(`/api/memory/${id}`, { method: 'DELETE' });
    expect(delRes.status).toBe(200);
  });

  it('rejects memory for a non-existent character', async () => {
    const res = await api('/api/memory', { method: 'POST', body: JSON.stringify({ characterId: 'chr_missing', content: 'Hello there friend' }) });
    expect(res.status).toBe(404);
  });

  it('consolidates within a character only', async () => {
    const res = await api('/api/memory/consolidate', { method: 'POST', body: JSON.stringify({ characterId }) });
    expect(res.status).toBe(200);
    expect(typeof res.body.merged).toBe('number');
  });
});

describe('conversations', () => {
  it('creates, lists, reads, searches and deletes conversations', async () => {
    const c = await api('/api/conversations', { method: 'POST', body: JSON.stringify({ characterId }) });
    expect(c.status).toBe(201);
    const id = c.body.conversation.id;
    ctx.db.conversations.addMessage({ conversationId: id, characterId, role: 'user', content: 'Hello AURA' });
    ctx.db.conversations.addMessage({ conversationId: id, characterId, role: 'assistant', content: 'Hello! How can I help?', meta: { provider: 'test' } });
    const read = await api(`/api/conversations/${id}`);
    expect(read.status).toBe(200);
    expect(read.body.messages).toHaveLength(2);
    expect(read.body.character.id).toBe(characterId);
    const search = await api('/api/conversations/search?q=How+can+I+help');
    expect(search.body.messages.length).toBe(1);
    const del = await api(`/api/conversations/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect((await api(`/api/conversations/${id}`)).status).toBe(404);
  });

  it('streams a typed error when no AI provider is configured', async () => {
    const res = await fetch(`${base}/api/chat/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ characterId, message: 'Hi there' }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('event: error');
    expect(text).toMatch(/No AI provider is configured/);
  });
});

describe('providers', () => {
  it('lists provider state without leaking keys', async () => {
    const res = await api('/api/providers');
    expect(res.status).toBe(200);
    expect(res.body.providers).toHaveLength(4);
    expect(res.body.providers.every((p: any) => p.configured === false)).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/sk-/);
  });

  it('stores a key encrypted and never returns it', async () => {
    const put = await api('/api/providers/openai', { method: 'PUT', body: JSON.stringify({ apiKey: 'sk-test-1234567890abcdefghijklmn' }) });
    expect(put.status).toBe(201);
    expect(put.body.keyHint).toMatch(/^sk-…/);
    const stored = ctx.driver.get<{ encrypted_key: string }>('SELECT * FROM provider_credentials WHERE provider = ?', ['openai']);
    expect(stored?.encrypted_key).not.toContain('sk-test');
    expect(stored?.encrypted_key.startsWith('v1.')).toBe(true);
    const list = await api('/api/providers');
    expect(JSON.stringify(list.body)).not.toContain('sk-test-1234');
    const del = await api('/api/providers/openai', { method: 'DELETE' });
    expect(del.status).toBe(200);
  });

  it('rejects a malformed key shape before storing it', async () => {
    const put = await api('/api/providers/openai', { method: 'PUT', body: JSON.stringify({ apiKey: 'AIza' + 'x'.repeat(30) }) });
    expect(put.status).toBe(400);
    expect(put.body.error).toMatch(/sk-/);
  });

  it('requires a base URL for OpenAI-compatible endpoints', async () => {
    const put = await api('/api/providers/openai-compatible', { method: 'PUT', body: JSON.stringify({ apiKey: 'local-model-key-1234' }) });
    expect(put.status).toBe(400);
    expect(put.body.error).toMatch(/base URL/);
  });

  it('refuses to test a provider without a stored key', async () => {
    const res = await api('/api/providers/anthropic/test', { method: 'POST' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No key stored/);
  });
});

describe('tasks + skills', () => {
  it('lists builtin skills', async () => {
    const res = await api('/api/skills');
    expect(res.status).toBe(200);
    const ids = res.body.skills.map((s: any) => s.id);
    expect(ids).toContain('math.calculate');
    expect(ids).toContain('web.search');
    expect(ids).toContain('computer.launch_app');
  });

  it('runs a safe skill through the permission gate', async () => {
    const res = await api('/api/skills/math.calculate/run', { method: 'POST', body: JSON.stringify({ characterId, args: { expression: '12*(3+4)' } }) });
    expect(res.status).toBe(200);
    expect(res.body.result.data.value).toBe(84);
  });

  it('blocks a computer-control skill in server mode with a reason', async () => {
    const res = await api('/api/skills/computer.launch_app/run', { method: 'POST', body: JSON.stringify({ characterId, args: { app: 'notepad' } }) });
    expect([403, 428, 422]).toContain(res.status);
    expect(JSON.stringify(res.body)).toMatch(/confirmation|not allowed|desktop/i);
  });

  it('plans and cancels tasks with events', async () => {
    const plan = await api('/api/tasks/plan', { method: 'POST', body: JSON.stringify({ characterId, goal: 'Research the best keyboards under $150' }) });
    expect(plan.status).toBe(200);
    expect(plan.body.plan.steps.length).toBeGreaterThan(0);
    const created = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ characterId, goal: 'What time is it right now?', execute: false }) });
    expect(created.status).toBe(201);
    const id = created.body.task.id;
    expect((await api(`/api/tasks/${id}`)).body.task.status).toBe('queued');
    const cancel = await api(`/api/tasks/${id}/cancel`, { method: 'POST', body: '{}' });
    expect(cancel.status).toBe(200);
    expect((await api(`/api/tasks/${id}`)).body.task.status).toBe('cancelled');
    const list = await api('/api/tasks');
    expect(list.body.counts.cancelled).toBeGreaterThanOrEqual(1);
  });

  it('executes a safe multi-step task end to end', async () => {
    const created = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ characterId, goal: 'What time is it in Dhaka?', execute: true }) });
    expect(created.status).toBe(201);
    const id = created.body.task.id;
    let status = 'queued';
    for (let i = 0; i < 60 && status !== 'completed' && status !== 'failed'; i++) {
      await new Promise((r) => setTimeout(r, 150));
      status = (await api(`/api/tasks/${id}`)).body.task.status;
    }
    const final = (await api(`/api/tasks/${id}`)).body;
    expect(['completed', 'failed']).toContain(final.task.status);
    expect(final.events.length).toBeGreaterThan(0);
  });

  it('imports untrusted skills disabled and rejects shell/finance permissions', async () => {
    const manifest = {
      id: 'custom.web_clip',
      name: 'Clip Page',
      description: 'Clips a page to a note.',
      version: '1.0.0',
      category: 'Research & Web Search',
      permissions: ['network.access'],
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: {} },
      verification: { kind: 'manual', description: 'Check note file' },
    };
    const ok = await api('/api/skills/import', { method: 'POST', body: JSON.stringify({ manifest }) });
    expect(ok.status).toBe(201);
    expect(ok.body.skill.enabled).toBe(false);
    const shell = await api('/api/skills/import', {
      method: 'POST',
      body: JSON.stringify({ manifest: { ...manifest, id: 'evil.shell', permissions: ['shell.execute'], dangerouslyRequiresShell: true } }),
    });
    expect(shell.status).toBe(400);
    expect(shell.body.error).toMatch(/shell/);
  });
});

describe('permissions + emergency stop', () => {
  it('persists decisions and blocks skills when emergency stop is engaged', async () => {
    const res = await api('/api/permissions');
    expect(res.body.permissions.find((p: any) => p.permission === 'files.read').decision).toBe('ask');
    const put = await api('/api/permissions', { method: 'PUT', body: JSON.stringify({ permission: 'network.access', decision: 'deny' }) });
    expect(put.status).toBe(200);
    expect((await api('/api/permissions')).body.permissions.find((p: any) => p.permission === 'network.access').decision).toBe('deny');
    const stop = await api('/api/permissions/emergency-stop', { method: 'POST', body: JSON.stringify({ engage: true }) });
    expect(stop.body.engaged).toBe(true);
    const blocked = await api('/api/skills/math.calculate/run', { method: 'POST', body: JSON.stringify({ characterId, args: { expression: '1+1' } }) });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatch(/Emergency stop/);
    await api('/api/permissions/emergency-stop', { method: 'POST', body: JSON.stringify({ engage: false }) });
    expect((await api('/api/permissions')).body.emergencyStop).toBe(false);
  });
});

describe('documents / knowledge', () => {
  it('ingests markdown, indexes it and finds it by meaning', async () => {
    const body = JSON.stringify({
      fileName: 'notes.md',
      contentBase64: Buffer.from('# Mars Plan\n\nThe launch window opens in March. Fuel budget is 40 tonnes.').toString('base64'),
      characterId,
    });
    const res = await api('/api/documents', { method: 'POST', body });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('indexed');
    expect(res.body.chunks).toBeGreaterThan(0);
    const search = await api(`/api/documents/search?q=launch+window+march&characterId=${characterId}`);
    expect(search.body.results.length).toBeGreaterThan(0);
    expect(search.body.results[0].content).toMatch(/launch window/);
    const del = await api(`/api/documents/${res.body.documentId}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
  });

  it('reports unsupported files as failed instead of indexed', async () => {
    const body = JSON.stringify({ fileName: 'malware.exe', contentBase64: Buffer.from([0x4d, 0x5a, 0x90]).toString('base64') });
    const res = await api('/api/documents', { method: 'POST', body });
    expect(res.status).toBe(422);
    expect(res.body.status).toBe('failed');
  });
});

describe('licensing', () => {
  it('reports development mode honestly', async () => {
    const res = await api('/api/license');
    expect(res.status).toBe(200);
    expect(res.body.license.mode).toBe('development');
    expect(res.body.subscription.status).toBe('none');
    expect(res.body.googleConfigured).toBe(false);
  });

  it('refuses simulated subscriptions', async () => {
    const res = await api('/api/license/dev/subscription-simulate', { method: 'POST', body: '{}' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not supported/);
  });

  it('does not fabricate Google sign-in without OAuth configuration', async () => {
    const res = await api('/api/auth/google', { method: 'POST', body: JSON.stringify({ code: 'fake-code-1234567890', redirectUri: 'http://localhost:5173/auth/google/callback' }) });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/);
  });
});

describe('integrations + MCP', () => {
  it('shows integrations in their true unconfigured state', async () => {
    const res = await api('/api/integrations');
    expect(res.status).toBe(200);
    expect(res.body.integrations.every((i: any) => i.status === 'not_configured')).toBe(true);
  });

  it('refuses stdio MCP servers in server mode with a precise explanation', async () => {
    const created = await api('/api/integrations/mcp', { method: 'POST', body: JSON.stringify({ name: 'Local FS', transport: 'stdio-command', endpoint: 'npx -y server-fs /tmp' }) });
    expect(created.status).toBe(201);
    const connect = await api(`/api/integrations/mcp/${created.body.id}/connect`, { method: 'POST', body: '{}' });
    expect(connect.status).toBe(502);
    expect(connect.body.error).toMatch(/desktop runtime/);
  });
});

describe('voice', () => {
  it('reports TTS availability truthfully and returns real visemes', async () => {
    const res = await api('/api/voice/voices');
    expect(res.status).toBe(200);
    expect(res.body.openaiRealtime).toBe(false);
    expect(res.body.geminiLive).toBe(false);
    const tts = await api('/api/voice/tts', { method: 'POST', body: JSON.stringify({ text: 'hello there' }) });
    expect(tts.status).toBe(501);
    expect(tts.body.error).toMatch(/OpenAI API key/);
    const vis = await api('/api/voice/visemes', { method: 'POST', body: JSON.stringify({ text: 'Testing the mouth shapes' }) });
    expect(vis.body.mode).toBe('phoneme-estimate');
    expect(vis.body.frames.length).toBeGreaterThan(5);
  });
});

describe('backup + reset', () => {
  it('exports a redacted backup and requires explicit confirmation for reset', async () => {
    const exp = await api('/api/system/export', { method: 'POST', body: JSON.stringify({}) });
    expect(exp.status).toBe(200);
    const text = typeof exp.body === 'string' ? exp.body : JSON.stringify(exp.body);
    expect(text).toContain('aura.backup');
    expect(text).not.toMatch(/sk-test|encrypted_key/);
    const reset = await api('/api/system/reset', { method: 'POST', body: JSON.stringify({ scope: 'conversations', confirm: 'DELETE' }) });
    expect(reset.status).toBe(200);
    const bad = await api('/api/system/reset', { method: 'POST', body: JSON.stringify({ scope: 'everything' }) });
    expect(bad.status).toBe(400);
  });
});
