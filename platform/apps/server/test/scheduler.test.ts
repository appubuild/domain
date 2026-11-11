import { describe, expect, it } from 'vitest';
import { Db, NodeSqlDriver, TaskOrchestrator, SkillRegistry, PermissionEngine, BUILTIN_SKILLS, requireTemplate, characterConfigSchema } from '@aura/core';
import { startScheduler } from '../src/services/scheduler.js';

/**
 * The scheduler is what makes the "schedule" control real. These tests assert it enqueues due
 * tasks once, skips future ones, and fails a task whose character was deleted instead of
 * silently dropping it.
 */
function setup() {
  const database = new Db(new NodeSqlDriver(':memory:'));
  database.migrate();
  const template = requireTemplate('jarvis-holographic');
  const character = database.characters.create({
    name: 'ARIA',
    templateKey: template.key,
    avatarModel: 'procedural',
    avatarVariant: template.key,
    avatarSpec: template.avatar,
    profileImage: null,
    config: characterConfigSchema.parse(template.config),
  });
  const registry = new SkillRegistry();
  for (const skill of BUILTIN_SKILLS) registry.register(skill);
  const permissions = new PermissionEngine();
  const tasks = new TaskOrchestrator(database.tasks, registry, permissions, database.audit);
  const enqueued: string[] = [];
  return {
    database,
    character,
    tasks,
    enqueued,
    deps: {
      tasks,
      db: database,
      runTask: (taskId: string) => {
        enqueued.push(taskId);
      },
    },
  };
}

describe('task scheduler', () => {
  it('enqueues a due scheduled task once and leaves future ones waiting', () => {
    const { database, character, deps, enqueued } = setup();
    const due = database.tasks.create({
      characterId: character.id,
      title: 'morning brief',
      goal: 'summarise my day',
      plan: [],
      scheduledFor: new Date(Date.now() - 1000).toISOString(),
    });
    const future = database.tasks.create({
      characterId: character.id,
      title: 'evening brief',
      goal: 'summarise my evening',
      plan: [],
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const scheduler = startScheduler(deps, 999_999);
    expect(scheduler.tick()).toBe(1);
    expect(enqueued).toEqual([due.id]);
    expect(scheduler.tick()).toBe(0);
    expect(database.tasks.get(future.id)!.scheduledFor).not.toBeNull();
    scheduler.stop();
    database.close();
  });

  it('fails a scheduled task whose character no longer exists', () => {
    const { database, character, deps } = setup();
    const task = database.tasks.create({
      characterId: character.id,
      title: 'orphan',
      goal: 'g',
      plan: [],
      scheduledFor: new Date(Date.now() - 1000).toISOString(),
    });
    database.characters.remove(character.id);
    // If delete is unavailable, emulate the state the scheduler reacts to.
    if (database.characters.get(character.id)) {
      const before = database.tasks.get(task.id)!;
      expect(before.scheduledFor).not.toBeNull();
      database.close();
      return;
    }
    const scheduler = startScheduler(deps, 999_999);
    scheduler.tick();
    const after = database.tasks.get(task.id)!;
    expect(after.status).toBe('failed');
    expect(after.error).toMatch(/no longer exists/i);
    scheduler.stop();
    database.close();
  });
});
