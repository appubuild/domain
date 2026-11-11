import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { validateImportedSkill, SKILL_CATEGORIES, PERMISSIONS } from '@aura/core';
import type { AppContext } from '../context.js';
import { HttpError, json, notFound, parseBody, readJson, matchRoute } from '../http.js';

export async function handleSkills(ctx: AppContext, req: IncomingMessage, res: ServerResponse, pathname: string, method: string): Promise<boolean> {
  if (pathname === '/api/skills' && method === 'GET') {
    const stored = new Map(ctx.db.skills.list().map((s) => [s.id, s]));
    const skills = ctx.registry.list().map((s) => {
      const row = stored.get(s.id);
      return { ...s, enabled: row?.enabled ?? s.enabledByDefault, config: row?.config ?? {}, origin: row?.origin ?? s.origin };
    });
    const custom = ctx.db.skills.list().filter((s) => s.origin !== 'builtin').map((s) => ({
      id: s.id, name: s.name, description: s.description, version: s.version, category: s.category, origin: s.origin,
      enabled: s.enabled, permissions: s.permissions, inputSchema: s.inputSchema, outputSchema: s.outputSchema,
      config: s.config, verification: { kind: 'manual' as const, description: 'User/taught skill — verify results manually.' },
      enabledByDefault: s.enabled, dangerouslyRequiresShell: false, canonicalId: s.id,
    }));
    json(res, 200, { skills: [...skills, ...custom], categories: SKILL_CATEGORIES, permissions: PERMISSIONS });
    return true;
  }

  const execMatch = matchRoute('/api/skills/:id/run', pathname);
  if (execMatch && method === 'POST') {
    const skillId = execMatch.id!.replace(/__/g, '.');
    const skill = ctx.registry.get(skillId);
    if (!skill) throw new HttpError(404, 'Skill not installed (only builtin skills are executable in this build).');
    const body = parseBody(z.object({ characterId: z.string(), args: z.record(z.unknown()).default({}) }), await readJson(req));
    const character = ctx.db.characters.get(body.characterId);
    if (!character) throw new HttpError(404, 'Character not found');
    const stored = ctx.db.skills.get(skillId);
    if (stored && !stored.enabled) throw new HttpError(409, 'Skill is disabled. Enable it in Skills & Tools first.');
    const permission = skill.manifest.permissions[0] ?? null;
    const check = ctx.permissions.check({
      permission: permission as never,
      characterPermissions: {
        allowComputerControl: character.config.permissions.allowComputerControl,
        allowBrowserAutomation: character.config.permissions.allowBrowserAutomation,
        allowFileSystem: character.config.permissions.allowFileSystem,
        allowNetworkResearch: character.config.permissions.allowNetworkResearch,
      },
    });
    if (!check.allowed) throw new HttpError(check.needsConfirmation ? 428 : 403, check.reason);
    const started = Date.now();
    const result = await skill.run(body.args ?? {}, ctx.buildSkillContext(character));
    ctx.db.audit.log({ actor: `character:${character.id}`, action: `skill.${skillId}`, outcome: result.ok ? 'success' : 'failure', detail: { ms: Date.now() - started } });
    json(res, result.ok ? 200 : 422, { result, ms: Date.now() - started });
    return true;
  }

  const idMatch = matchRoute('/api/skills/:id', pathname);
  if (idMatch) {
    const id = idMatch.id!;
    if (method === 'GET') {
      const builtin = ctx.registry.get(id);
      const stored = ctx.db.skills.get(id);
      if (!builtin && !stored) {
        notFound(res, 'Skill');
        return true;
      }
      json(res, 200, {
        skill: builtin
          ? { ...builtin.manifest, origin: stored?.origin ?? 'builtin', enabled: stored?.enabled ?? builtin.manifest.enabledByDefault, config: stored?.config ?? {} }
          : stored,
      });
      return true;
    }
    if (method === 'PATCH') {
      const body = parseBody(z.object({ enabled: z.boolean().optional(), config: z.record(z.unknown()).optional() }), await readJson(req));
      const current = ctx.db.skills.get(id);
      if (!current) {
        const manifest = ctx.registry.get(id)?.manifest;
        if (!manifest) {
          notFound(res, 'Skill');
          return true;
        }
        ctx.db.skills.upsertBuiltin({
          id: manifest.id,
          name: manifest.name,
          description: manifest.description,
          version: manifest.version,
          category: manifest.category,
          enabled: body.enabled ?? manifest.enabledByDefault,
          permissions: manifest.permissions,
          inputSchema: manifest.inputSchema,
          outputSchema: manifest.outputSchema,
          config: body.config ?? {},
          source: null,
        });
      } else {
        if (body.enabled !== undefined) ctx.db.skills.setEnabled(id, body.enabled);
        if (body.config) ctx.db.skills.updateConfig(id, body.config);
      }
      ctx.db.audit.log({ actor: 'user', action: 'skill.configure', target: id, outcome: 'success', detail: body });
      json(res, 200, { skill: ctx.db.skills.get(id) });
      return true;
    }
    if (method === 'DELETE') {
      const stored = ctx.db.skills.get(id);
      if (!stored) {
        notFound(res, 'Skill');
        return true;
      }
      if (stored.origin === 'builtin') throw new HttpError(400, 'Builtin skills cannot be deleted; disable them instead.');
      ctx.db.skills.remove(id);
      json(res, 200, { ok: true });
      return true;
    }
  }

  if (pathname === '/api/skills/import' && method === 'POST') {
    const body = await readJson(req);
    const validated = validateImportedSkill((body as Record<string, unknown>)?.manifest ?? body);
    if (!validated.ok) throw new HttpError(400, `Skill rejected: ${validated.errors.join('; ')}`);
    const manifest = validated.manifest;
    if (ctx.registry.has(manifest.id)) throw new HttpError(409, `A builtin skill with id "${manifest.id}" already exists.`);
    const skill = ctx.db.skills.save({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      category: manifest.category,
      origin: 'user',
      enabled: false,
      permissions: manifest.permissions,
      inputSchema: manifest.inputSchema,
      outputSchema: manifest.outputSchema,
      config: {},
      source: { kind: 'imported', manifest, handler: 'declarative-only' },
    });
    json(res, 201, { skill, note: 'Imported skills are disabled until you review and enable them. This build runs builtin handlers only.' });
    return true;
  }

  if (pathname === '/api/skills/export' && method === 'GET') {
    const url = new URL(req.url ?? '/', 'http://local');
    const id = url.searchParams.get('id');
    const stored = id ? ctx.db.skills.get(id) : null;
    if (!stored) throw new HttpError(404, 'Only custom/taught skills can be exported.');
    json(res, 200, { format: 'aura.skill', formatVersion: 1, manifest: { ...stored, origin: stored.origin } });
    return true;
  }

  return false;
}
