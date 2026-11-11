import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import {
  CHARACTER_TEMPLATES,
  characterInputSchema,
  characterExportSchema,
  requireTemplate,
  characterConfigSchema,
  avatarSpecSchema,
  TEMPLATE_KEYS,
  deepMerge,
} from '@aura/core';
import type { AppContext } from '../context.js';
import { HttpError, json, notFound, parseBody, readJson, matchRoute } from '../http.js';

export async function handleCharacters(ctx: AppContext, req: IncomingMessage, res: ServerResponse, pathname: string, method: string): Promise<boolean> {
  if (pathname === '/api/characters/templates' && method === 'GET') {
    json(res, 200, {
      templates: CHARACTER_TEMPLATES.map((t) => ({
        key: t.key,
        name: t.name,
        tagline: t.tagline,
        visualStyle: t.visualStyle,
        accent: t.accent,
        renderFamily: t.renderFamily,
        avatar: t.avatar,
        suggestedSkills: t.suggestedSkills,
        personalityPreview: {
          traits: t.config.personality.traits,
          communicationStyle: t.config.personality.communicationStyle,
          responseLength: t.config.personality.responseLength,
          humor: t.config.personality.humor,
          formality: t.config.personality.formality,
        },
        defaultVoice: { name: t.config.voice.voiceName, style: t.config.voice.style },
        expertise: t.config.expertise,
        characterType: t.config.characterType,
      })),
    });
    return true;
  }

  if (pathname === '/api/characters' && method === 'GET') {
    json(res, 200, { characters: ctx.db.characters.list(), defaultId: ctx.db.characters.getDefault()?.id ?? null });
    return true;
  }

  if (pathname === '/api/characters' && method === 'POST') {
    const body = await readJson(req);
    if (typeof body === 'object' && body !== null && (body as Record<string, unknown>).fromTemplate) {
      const { templateKey, name, makeDefault } = parseBody(
        z.object({ fromTemplate: z.literal(true), templateKey: z.enum(TEMPLATE_KEYS), name: z.string().min(1).max(60).optional(), makeDefault: z.boolean().optional() }),
        body,
      );
      const t = requireTemplate(templateKey);
      const finalName = name ?? t.name;
      const clash = ctx.db.characters.list(true).find((c) => c.name.toLowerCase() === finalName.toLowerCase());
      if (clash) throw new HttpError(409, `A character named "${finalName}" already exists. Choose another name.`);
      const character = ctx.db.characters.create(
        characterInputSchema.parse({
          name: finalName,
          templateKey: t.key,
          avatarModel: 'procedural',
          avatarVariant: t.key,
          avatarSpec: t.avatar,
          profileImage: null,
          config: characterConfigSchema.parse(t.config),
        }),
        { makeDefault },
      );
      ctx.db.audit.log({ actor: 'user', action: 'character.create_from_template', target: character.id, outcome: 'success', detail: { templateKey } });
      json(res, 201, { character });
      return true;
    }
    const input = parseBody(characterInputSchema, body);
    const existing = ctx.db.characters.list().find((c) => c.name.toLowerCase() === input.name.toLowerCase());
    if (existing) throw new HttpError(409, `A character named "${input.name}" already exists. Choose another name.`);
    const character = ctx.db.characters.create(input);
    ctx.db.audit.log({ actor: 'user', action: 'character.create', target: character.id, outcome: 'success' });
    json(res, 201, { character });
    return true;
  }

  if (pathname === '/api/characters/import' && method === 'POST') {
    const body = await readJson(req);
    const parsed = parseBody(characterExportSchema, body);
    const nameBase = parsed.character.name;
    let name = nameBase;
    let i = 2;
    while (ctx.db.characters.list(true).some((c) => c.name.toLowerCase() === name.toLowerCase())) name = `${nameBase} (${i++})`;
    const character = ctx.db.characters.create(characterInputSchema.parse({ ...parsed.character, name }));
    ctx.db.audit.log({ actor: 'user', action: 'character.import', target: character.id, outcome: 'success' });
    json(res, 201, { character, renamed: name !== nameBase });
    return true;
  }

  const idMatch = matchRoute('/api/characters/:id', pathname);
  if (idMatch) {
    const id = idMatch.id!;
    if (method === 'GET') {
      const character = ctx.db.characters.get(id);
      if (!character) return notFound(res, 'Character'), true;
      json(res, 200, {
        character,
        stats: {
          memories: ctx.db.memories.countsByLayer(id),
          conversations: ctx.db.conversations.list(id).length,
          skillsDisabled: character.config.permissions.disabledSkillIds,
        },
      });
      return true;
    }
    if (method === 'PUT') {
      const body = await readJson(req);
      const existing = ctx.db.characters.get(id);
      if (!existing) {
        notFound(res, 'Character');
        return true;
      }
      const input = parseBody(
        z.object({
          name: z.string().min(1).max(60).optional(),
          templateKey: z.enum(TEMPLATE_KEYS).optional(),
          avatarModel: z.enum(['procedural', 'vrm']).optional(),
          avatarVariant: z.string().max(80).optional(),
          avatarSpec: avatarSpecSchema.optional(),
          profileImage: z.string().max(2_000_000).nullable().optional(),
          config: z.record(z.unknown()).optional(),
        }),
        body,
      );
      if (input.name && input.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
        const clash = ctx.db.characters.list(true).find((c) => c.id !== id && c.name.toLowerCase() === input.name!.trim().toLowerCase());
        if (clash) throw new HttpError(409, `A character named "${input.name.trim()}" already exists. Choose another name.`);
      }
      // Validate the *merged* config so a partial patch can never persist an invalid shape.
      const nextConfig = input.config ? deepMerge(existing.config as unknown as Record<string, unknown>, input.config) : existing.config;
      const parsedConfig = characterConfigSchema.safeParse(nextConfig);
      if (!parsedConfig.success) {
        throw new HttpError(400, 'Invalid configuration patch', parsedConfig.error.issues);
      }
      const character = ctx.db.characters.update(id, { ...input, config: parsedConfig.data } as never);
      ctx.events.emit('character.updated', { character });
      json(res, 200, { character });
      return true;
    }
    if (method === 'DELETE') {
      ctx.db.characters.remove(id);
      ctx.db.audit.log({ actor: 'user', action: 'character.delete', target: id, outcome: 'success' });
      json(res, 200, { ok: true });
      return true;
    }
  }

  const dupMatch = matchRoute('/api/characters/:id/duplicate', pathname);
  if (dupMatch && method === 'POST') {
    const body = parseBody(z.object({ name: z.string().min(1).max(60).optional() }), (await readJson(req)) ?? {});
    const character = ctx.db.characters.duplicate(dupMatch.id!, body.name);
    json(res, 201, { character });
    return true;
  }

  const defMatch = matchRoute('/api/characters/:id/default', pathname);
  if (defMatch && method === 'POST') {
    ctx.db.characters.setDefault(defMatch.id!);
    json(res, 200, { ok: true, defaultId: defMatch.id });
    return true;
  }

  const exportMatch = matchRoute('/api/characters/:id/export', pathname);
  if (exportMatch && method === 'GET') {
    const character = ctx.db.characters.get(exportMatch.id!);
    if (!character) {
      notFound(res, 'Character');
      return true;
    }
    const { id: _id, isDefault: _d, archived: _a, createdAt: _c, updatedAt: _u, stats: _s, ...portable } = character;
    json(res, 200, {
      format: 'aura.character',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      character: portable,
    });
    return true;
  }

  return false;
}
