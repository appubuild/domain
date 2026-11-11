import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { DEFAULT_SETTINGS, PROVIDER_META, PROVIDER_KEYS, RISK_BY_PERMISSION, PERMISSIONS, MEMORY_LAYERS } from '@aura/core';
import type { AppContext } from '../context.js';
import { HttpError, json, parseBody, readJson } from '../http.js';
import { defaultDataDir } from '../config.js';
import { hostname, platform, release, cpus, totalmem, freemem } from 'node:os';
import { statSync } from 'node:fs';

const settingsKeySchema = z.enum(['appearance', 'general', 'voice', 'memory', 'privacy', 'hotkeys', 'worldMonitor', 'onboarding']);

export async function handleSystem(ctx: AppContext, req: IncomingMessage, res: ServerResponse, pathname: string, method: string): Promise<boolean> {
  if (pathname === '/api/health' && method === 'GET') {
    json(res, 200, {
      ok: true,
      app: 'AURA',
      version: '0.1.0',
      schemaVersion: ctx.schemaVersion,
      uptimeSeconds: Math.round(process.uptime()),
      dataDir: ctx.config.dataDir,
      database: { path: ctx.config.dbPath, sizeBytes: safeSize(ctx.config.dbPath) },
      workspaceRoot: ctx.config.workspaceRoot,
      vaultKeyPath: ctx.config.keyPath,
    });
    return true;
  }

  if (pathname === '/api/system/info' && method === 'GET') {
    const desktopBridge = ctx.config.capabilityMode === 'desktop' && Boolean(process.env.AURA_DESKTOP_BRIDGE_URL);
    json(res, 200, {
      platform: platform(),
      release: release(),
      hostname: hostname(),
      cpuCount: cpus().length,
      totalMemMb: Math.round(totalmem() / 1024 / 1024),
      freeMemMb: Math.round(freemem() / 1024 / 1024),
      node: process.version,
      dataDir: ctx.config.dataDir,
      capabilityMode: ctx.config.capabilityMode,
      capabilities: {
        // Platform-level truth. The workspace sandbox always exists; OS-level automation is
        // only real when the Tauri shell is hosting us and exposing its bridge endpoint.
        browserAutomation: desktopBridge,
        computerControl: desktopBridge,
        fileSystem: true,
        knowledge: true,
      },
      desktopBridgeUrl: process.env.AURA_DESKTOP_BRIDGE_URL ?? null,
      devMode: ctx.config.devMode,
      recommendedDataDir: defaultDataDir(),
    });
    return true;
  }

  if (pathname === '/api/system/export' && method === 'POST') {
    const raw = await readJson(req);
    const body = parseBody(z.object({ includeConversations: z.boolean().default(true), includeMemories: z.boolean().default(true) }), raw ?? {});
    const characters = ctx.db.characters.list(true);
    const payload = {
      format: 'aura.backup',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      redacted: ['provider API keys (encrypted vault is not exported)', 'license signature'],
      settings: ctx.db.settings.all(),
      characters: characters.map((c) => ({ ...c, stats: undefined })),
      conversations: body.includeConversations
        ? characters.flatMap((c) =>
            ctx.db.conversations.list(c.id, 1000).map((conv) => ({
              ...conv,
              messages: ctx.db.conversations.messages(conv.id),
            })),
          )
        : [],
      memories: body.includeMemories
        ? characters.flatMap((c) => ctx.db.memories.list({ characterId: c.id, limit: 10000 }))
        : [],
      skills: ctx.db.skills.list().filter((s) => s.origin !== 'builtin'),
      docs: ctx.db.documents.list().map((d) => ({ id: d.id, title: d.title, fileName: d.fileName, status: d.status, chunkCount: d.chunkCount })),
    };
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="aura-backup-${new Date().toISOString().slice(0, 10)}.aura.json"`,
    });
    res.end(JSON.stringify(payload, null, 2));
    return true;
  }

  if (pathname === '/api/system/reset' && method === 'POST') {
    const body = parseBody(
      z.object({
        scope: z.enum(['conversations', 'memories', 'characters', 'everything']),
        characterId: z.string().optional(),
        confirm: z.literal('DELETE'),
      }),
      await readJson(req),
    );
    const scopes = body.scope === 'everything' ? ['conversations', 'memories', 'characters'] : [body.scope];
    for (const scope of scopes) {
      if (scope === 'conversations') ctx.db.conversations.deleteHistory(body.characterId);
      if (scope === 'memories') {
        if (body.characterId) ctx.db.memories.removeAllForCharacter(body.characterId);
        else for (const c of ctx.db.characters.list(true)) ctx.db.memories.removeAllForCharacter(c.id);
      }
      if (scope === 'characters') for (const c of ctx.db.characters.list(true)) ctx.db.characters.remove(c.id);
    }
    ctx.db.audit.log({ actor: 'user', action: `data.reset.${body.scope}`, outcome: 'success', detail: { characterId: body.characterId, scopes } });
    json(res, 200, { ok: true, reset: scopes });
    return true;
  }

  if (pathname.startsWith('/api/settings') && method === 'GET') {
    json(res, 200, { settings: ctx.settings(), defaults: DEFAULT_SETTINGS });
    return true;
  }

  if (pathname.startsWith('/api/settings/') && method === 'PUT') {
    const key = pathname.slice('/api/settings/'.length);
    const parsedKey = settingsKeySchema.safeParse(key);
    if (!parsedKey.success) throw new HttpError(400, `Unknown settings section "${key}"`);
    const body = await readJson(req);
    const prev = ctx.db.settings.get(parsedKey.data) as unknown as Record<string, unknown>;
    if (typeof body !== 'object' || body === null) throw new HttpError(400, 'Settings patch must be an object');
    const merged = { ...prev, ...(body as Record<string, unknown>) };
    const saved = ctx.db.settings.set(parsedKey.data, merged as never);
    ctx.events.emit('settings.changed', { key: parsedKey.data, value: saved });
    json(res, 200, { key: parsedKey.data, value: saved });
    return true;
  }

  if (pathname === '/api/providers' && method === 'GET') {
    const list = [];
    for (const key of PROVIDER_KEYS) {
      const cred = ctx.db.credentials.get(key);
      list.push({
        key,
        label: PROVIDER_META[key].label,
        configured: cred !== null,
        keyHint: cred?.keyHint ?? null,
        baseUrl: cred?.baseUrl ?? null,
        lastStatus: cred?.lastStatus ?? 'unconfigured',
        lastVerifiedAt: cred?.lastVerifiedAt ?? null,
        docsUrl: PROVIDER_META[key].docsUrl,
        keyUrl: PROVIDER_META[key].keyUrl,
        requiresBaseUrl: key === 'openai-compatible',
      });
    }
    json(res, 200, { providers: list });
    return true;
  }

  if (pathname === '/api/usage' && method === 'GET') {
    json(res, 200, { usage: ctx.db.usage.summary(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
    return true;
  }

  if (pathname === '/api/audit' && method === 'GET') {
    json(res, 200, { entries: ctx.db.audit.recent(200) });
    return true;
  }

  if (pathname === '/api/permissions' && method === 'GET') {
    const rows = ctx.driver.all<{ permission: string; decision: string }>('SELECT permission, decision FROM permissions');
    const map = new Map(rows.map((r) => [r.permission, r.decision]));
    json(res, 200, {
      permissions: PERMISSIONS.map((p) => ({ permission: p, decision: map.get(p) ?? 'ask', risk: RISK_BY_PERMISSION[p] })),
      emergencyStop: ctx.permissions.isStopped,
    });
    return true;
  }

  if (pathname === '/api/permissions' && method === 'PUT') {
    const body = parseBody(
      z.object({ permission: z.enum(PERMISSIONS), decision: z.enum(['allow', 'ask', 'deny']) }),
      await readJson(req),
    );
    ctx.driver.run(
      'INSERT INTO permissions (permission, decision, scope_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(permission) DO UPDATE SET decision = excluded.decision, updated_at = excluded.updated_at',
      [body.permission, body.decision, '{}', new Date().toISOString()],
    );
    ctx.db.audit.log({ actor: 'user', action: 'permission.set', target: body.permission, outcome: 'success', detail: { decision: body.decision } });
    json(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/permissions/emergency-stop' && method === 'POST') {
    const body = parseBody(z.object({ engage: z.boolean() }), await readJson(req));
    if (body.engage) ctx.permissions.engageEmergencyStop();
    else ctx.permissions.releaseEmergencyStop();
    ctx.events.emit('emergency-stop', { engaged: ctx.permissions.isStopped });
    json(res, 200, { engaged: ctx.permissions.isStopped });
    return true;
  }

  if (pathname === '/api/memory/layers' && method === 'GET') {
    json(res, 200, { layers: MEMORY_LAYERS });
    return true;
  }

  if (pathname === '/api/skills/catalog' && method === 'GET') {
    json(res, 200, {
      skills: ctx.registry.list().map((s) => ({ ...s })),
      runtime: {
        browserAvailable: ctx.capabilities.forCharacter(null).browser !== null,
        computerAvailable: ctx.capabilities.forCharacter(null).computer !== null,
        filesAvailable: ctx.capabilities.forCharacter(null).files !== null,
      },
    });
    return true;
  }

  return false;
}

function safeSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
