import type { TaskOrchestrator, Db, Character } from '@aura/core';

/**
 * Minimal, honest task scheduler.
 *
 * Tasks created with `scheduledFor` are persisted with that timestamp. This loop is the only
 * thing that turns them into executions — without it the UI's "schedule" control would be a
 * decorative field. There is no cron syntax: a task is a one-shot at an absolute time.
 *
 * Ticks are cheap (one indexed query per 15s) and the loop is unref'd so it never keeps the
 * process alive on shutdown.
 */
export interface SchedulerHandle {
  stop(): void;
  /** Run one tick immediately — used on boot and by tests. */
  tick(): number;
}

export interface SchedulerDeps {
  tasks: TaskOrchestrator;
  db: Db;
  runTask(taskId: string, character: Character): void;
}

export function startScheduler(ctx: SchedulerDeps, intervalMs = 15_000): SchedulerHandle {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const tick = (): number => {
    if (stopped) return 0;
    const due = ctx.tasks.dueScheduled();
    for (const task of due) {
      const character = ctx.db.characters.get(task.characterId);
      if (!character) {
        ctx.db.tasks.update(task.id, {
          status: 'failed',
          error: 'The character that owns this task no longer exists.',
          finishedAt: new Date().toISOString(),
        });
        continue;
      }
      ctx.runTask(task.id, character);
    }
    return due.length;
  };

  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  // First tick on the next macrotask: a task that came due while the app was closed should not
  // wait a full interval, and `recoverOrphans` must have run first.
  setTimeout(tick, 0).unref?.();

  return {
    tick,
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
