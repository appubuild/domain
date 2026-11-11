import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { planDeterministic, newId, TASK_STATUSES, type PlanStep } from '@aura/core';
import type { AppContext } from '../context.js';
import { HttpError, json, notFound, parseBody, readJson, matchRoute } from '../http.js';

const createTaskSchema = z.object({
  characterId: z.string().min(1),
  goal: z.string().min(4).max(2000),
  conversationId: z.string().nullable().optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
  execute: z.boolean().default(true),
});

export async function handleTasks(ctx: AppContext, req: IncomingMessage, res: ServerResponse, pathname: string, method: string): Promise<boolean> {
  if (pathname === '/api/tasks' && method === 'GET') {
    const url = new URL(req.url ?? '/', 'http://local');
    const status = url.searchParams.getAll('status').filter((s): s is (typeof TASK_STATUSES)[number] => (TASK_STATUSES as readonly string[]).includes(s));
    json(res, 200, {
      tasks: ctx.db.tasks.list({ ...(status.length ? { status } : {}), ...(url.searchParams.get('characterId') ? { characterId: url.searchParams.get('characterId')! } : {}), limit: 100 }),
      counts: ctx.db.tasks.counts(),
    });
    return true;
  }

  if (pathname === '/api/tasks/plan' && method === 'POST') {
    const body = parseBody(z.object({ characterId: z.string(), goal: z.string().min(4).max(2000) }), await readJson(req));
    const character = ctx.db.characters.get(body.characterId);
    if (!character) throw new HttpError(404, 'Character not found');
    const plan = planDeterministic(body.goal, {
      availableSkills: ctx.registry.manifests(),
      characterPermissions: {
        ...character.config.permissions,
        disabledSkillIds: character.config.permissions.disabledSkillIds,
      },
    });
    json(res, 200, { plan });
    return true;
  }

  if (pathname === '/api/tasks' && method === 'POST') {
    const body = parseBody(createTaskSchema, await readJson(req));
    const character = ctx.db.characters.get(body.characterId);
    if (!character) throw new HttpError(404, 'Character not found');
    const plan = planDeterministic(body.goal, {
      availableSkills: ctx.registry.manifests(),
      characterPermissions: { ...character.config.permissions, disabledSkillIds: character.config.permissions.disabledSkillIds },
    });
    const task = ctx.db.tasks.create({
      characterId: character.id,
      conversationId: body.conversationId ?? null,
      title: plan.title,
      goal: body.goal,
      plan: plan.steps,
      scheduledFor: body.scheduledFor ?? null,
      status: body.scheduledFor ? 'queued' : 'queued',
    });
    if (body.execute && !body.scheduledFor) {
      ctx.tasks.enqueue({
        taskId: task.id,
        characterPermissions: { ...character.config.permissions, disabledSkillIds: character.config.permissions.disabledSkillIds },
        buildContext: (cid) => ctx.buildSkillContext(ctx.db.characters.get(cid)),
      });
    }
    json(res, 201, { task: ctx.db.tasks.get(task.id), notes: plan.notes });
    return true;
  }

  const idMatch = matchRoute('/api/tasks/:id', pathname);
  if (idMatch) {
    const task = ctx.db.tasks.get(idMatch.id!);
    if (!task) {
      notFound(res, 'Task');
      return true;
    }
    if (method === 'GET') {
      json(res, 200, { task, events: ctx.db.tasks.events(task.id), running: ctx.tasks.isRunning(task.id) });
      return true;
    }
    if (method === 'DELETE') {
      ctx.tasks.cancel(task.id);
      json(res, 200, { ok: true });
      return true;
    }
  }

  const actionMatch = matchRoute('/api/tasks/:id/:action', pathname);
  if (actionMatch && method === 'POST') {
    const task = ctx.db.tasks.get(actionMatch.id!);
    if (!task) {
      notFound(res, 'Task');
      return true;
    }
    const character = ctx.db.characters.get(task.characterId);
    if (!character) throw new HttpError(404, 'Character not found');
    const action = actionMatch.action;
    const perms = { ...character.config.permissions, disabledSkillIds: character.config.permissions.disabledSkillIds };
    switch (action) {
      case 'cancel':
        ctx.tasks.cancel(task.id);
        break;
      case 'pause':
        if (!ctx.tasks.pause(task.id)) throw new HttpError(409, 'Task is not running; nothing to pause.');
        break;
      case 'resume':
        if (!ctx.tasks.resume(task.id)) throw new HttpError(409, 'Task is not paused.');
        break;
      case 'retry': {
        const freshPlan: PlanStep[] = task.plan.map((s) => ({ ...s, status: s.status === 'failed' ? 'pending' : s.status, error: undefined }));
        ctx.db.tasks.update(task.id, { plan: freshPlan, status: 'queued', error: null, progress: 0 });
        ctx.tasks.enqueue({ taskId: task.id, characterPermissions: perms, buildContext: (cid) => ctx.buildSkillContext(ctx.db.characters.get(cid)) });
        break;
      }
      case 'confirm': {
        // The user approved the pending step: grant this permission for the run.
        const pending = task.plan.find((s) => s.status === 'failed');
        if (!pending) throw new HttpError(409, 'No step is waiting for confirmation.');
        const skill = pending.skillId ? ctx.registry.get(pending.skillId) : null;
        const permission = skill?.manifest.permissions[0];
        if (permission) {
          ctx.db.audit.log({ actor: 'user', action: 'permission.confirm_once', target: permission, outcome: 'allowed', detail: { taskId: task.id } });
          ctx.driver.run(
            'INSERT INTO permissions (permission, decision, scope_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(permission) DO UPDATE SET decision = excluded.decision, updated_at = excluded.updated_at',
            [permission, 'allow', JSON.stringify({ taskId: task.id }), new Date().toISOString()],
          );
        }
        const reset: PlanStep[] = task.plan.map((s) => (s.id === pending.id ? { ...s, status: 'pending', error: undefined } : s));
        ctx.db.tasks.update(task.id, { plan: reset, status: 'queued', error: null, requiresConfirmation: false });
        ctx.tasks.enqueue({ taskId: task.id, characterPermissions: perms, buildContext: (cid) => ctx.buildSkillContext(ctx.db.characters.get(cid)) });
        break;
      }
      default:
        throw new HttpError(400, `Unknown action "${action}"`);
    }
    json(res, 200, { task: ctx.db.tasks.get(task.id) });
    return true;
  }

  if (pathname === '/api/tasks/teach' && method === 'POST') {
    // "Teach My Agent": converts a completed/failed task plan into a PROPOSED skill.
    const body = parseBody(z.object({ taskId: z.string(), name: z.string().min(3).max(60), description: z.string().min(10).max(400) }), await readJson(req));
    const task = ctx.db.tasks.get(body.taskId);
    if (!task) throw new HttpError(404, 'Task not found');
    if (task.status !== 'completed') throw new HttpError(409, 'Only completed tasks can be taught as a workflow.');
    const id = `taught.${body.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}`;
    const proposed = {
      id,
      name: body.name,
      description: body.description,
      version: '0.1.0',
      origin: 'taught' as const,
      enabled: false,
      permissions: [...new Set(task.plan.filter((s) => s.skillId).map((s) => ctx.registry.get(s.skillId!)?.manifest.permissions[0]).filter(Boolean))] as string[],
      inputSchema: { type: 'object', properties: { goal: { type: 'string', description: 'Goal for this workflow' } }, required: ['goal'] },
      outputSchema: { type: 'object', properties: { report: { type: 'string' } } },
      config: {},
      source: { kind: 'taught', fromTaskId: task.id, steps: task.plan.map((s) => ({ title: s.title, skillId: s.skillId, args: s.args })) },
      approved: false,
      approvedAt: null,
    };
    json(res, 201, { proposed, requiresReview: true, note: 'Review the steps and approve before this workflow can run.' });
    return true;
  }

  if (pathname === '/api/tasks/teach/approve' && method === 'POST') {
    const body = parseBody(
      z.object({
        id: z.string(),
        name: z.string().min(3).max(60),
        description: z.string().min(10).max(400),
        steps: z.array(z.object({ title: z.string(), skillId: z.string().nullable(), args: z.record(z.unknown()) })),
        permissions: z.array(z.string()).default([]),
      }),
      await readJson(req),
    );
    const skill = ctx.db.skills.save({
      id: body.id,
      name: body.name,
      description: body.description,
      version: '1.0.0',
      category: 'Productivity',
      origin: 'taught',
      enabled: true,
      permissions: body.permissions ?? [],
      inputSchema: { type: 'object', properties: { goal: { type: 'string' } }, required: ['goal'] },
      outputSchema: { type: 'object', properties: { report: { type: 'string' } } },
      config: {},
      source: { kind: 'taught', steps: body.steps, approvedAt: new Date().toISOString() },
    });
    ctx.db.audit.log({ actor: 'user', action: 'skill.taught.approved', target: skill.id, outcome: 'success' });
    json(res, 201, { skill });
    return true;
  }

  return false;
}
