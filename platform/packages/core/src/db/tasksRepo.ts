import type { SqlDriver } from './types.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';
import { safeParse, toJson } from '../util/json.js';

export const TASK_STATUSES = ['queued', 'planning', 'awaiting_confirmation', 'running', 'paused', 'completed', 'failed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type PlanStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export type PlanStep = {
  id: string;
  title: string;
  description: string;
  skillId: string | null;
  args: Record<string, unknown>;
  risk: 'low' | 'medium' | 'high';
  requiresConfirmation: boolean;
  verify: { kind: 'assertion' | 'manual' | 'none'; expression?: string; description?: string };
  status: PlanStepStatus;
  result?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
};

export type Task = {
  id: string;
  characterId: string;
  conversationId: string | null;
  title: string;
  goal: string;
  mode: 'agent';
  status: TaskStatus;
  plan: PlanStep[];
  result: Record<string, unknown> | null;
  error: string | null;
  progress: number;
  requiresConfirmation: boolean;
  scheduledFor: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type TaskEvent = {
  id: string;
  taskId: string;
  stepId: string | null;
  level: 'info' | 'warn' | 'error' | 'success';
  type: string;
  message: string;
  data: Record<string, unknown>;
  createdAt: string;
};

type TaskRow = {
  id: string;
  character_id: string;
  conversation_id: string | null;
  title: string;
  goal: string;
  mode: string;
  status: string;
  plan_json: string;
  result_json: string | null;
  error: string | null;
  progress: number;
  requires_confirmation: number;
  scheduled_for: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};

type EventRow = {
  id: string;
  task_id: string;
  step_id: string | null;
  level: string;
  type: string;
  message: string;
  data_json: string;
  created_at: string;
};

export class TasksRepo {
  constructor(private readonly db: SqlDriver) {}

  private task(r: TaskRow): Task {
    return {
      id: r.id,
      characterId: r.character_id,
      conversationId: r.conversation_id,
      title: r.title,
      goal: r.goal,
      mode: 'agent',
      status: (TASK_STATUSES as readonly string[]).includes(r.status) ? (r.status as TaskStatus) : 'queued',
      plan: safeParse<PlanStep[]>(r.plan_json, []),
      result: safeParse<Record<string, unknown> | null>(r.result_json, null),
      error: r.error,
      progress: r.progress,
      requiresConfirmation: r.requires_confirmation === 1,
      scheduledFor: r.scheduled_for,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
    };
  }

  create(input: {
    characterId: string;
    conversationId?: string | null;
    title: string;
    goal: string;
    plan?: PlanStep[];
    requiresConfirmation?: boolean;
    scheduledFor?: string | null;
    status?: TaskStatus;
  }): Task {
    const id = newId('tsk');
    const now = nowIso();
    this.db.run(
      `INSERT INTO tasks (id, character_id, conversation_id, title, goal, mode, status, plan_json, result_json, error, progress,
        requires_confirmation, scheduled_for, created_at, updated_at, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, 'agent', ?, ?, NULL, NULL, 0, ?, ?, ?, ?, NULL, NULL)`,
      [
        id,
        input.characterId,
        input.conversationId ?? null,
        input.title,
        input.goal,
        input.status ?? 'queued',
        toJson(input.plan ?? []),
        input.requiresConfirmation ? 1 : 0,
        input.scheduledFor ?? null,
        now,
        now,
      ],
    );
    this.event(id, { level: 'info', type: 'task.created', message: `Task created: ${input.title}` });
    return this.get(id)!;
  }

  get(id: string): Task | null {
    const row = this.db.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', [id]);
    return row ? this.task(row) : null;
  }

  list(filter: { status?: TaskStatus[]; characterId?: string; limit?: number } = {}): Task[] {
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (filter.status?.length) {
      where.push(`status IN (${filter.status.map(() => '?').join(',')})`);
      args.push(...filter.status);
    }
    if (filter.characterId) {
      where.push('character_id = ?');
      args.push(filter.characterId);
    }
    args.push(filter.limit ?? 100);
    return this.db
      .all<TaskRow>(
        `SELECT * FROM tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`,
        args,
      )
      .map((r) => this.task(r));
  }

  update(id: string, patch: Partial<Pick<Task, 'title' | 'status' | 'plan' | 'result' | 'error' | 'progress' | 'startedAt' | 'finishedAt' | 'requiresConfirmation' | 'scheduledFor'>>): Task {
    const current = this.get(id);
    if (!current) throw new Error('Task not found');
    const next = { ...current, ...patch };
    this.db.run(
      `UPDATE tasks SET title = ?, status = ?, plan_json = ?, result_json = ?, error = ?, progress = ?, requires_confirmation = ?,
       scheduled_for = ?, started_at = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
      [
        next.title,
        next.status,
        toJson(next.plan),
        next.result ? toJson(next.result) : null,
        next.error,
        next.progress,
        next.requiresConfirmation ? 1 : 0,
        next.scheduledFor,
        next.startedAt,
        next.finishedAt,
        nowIso(),
        id,
      ],
    );
    return this.get(id)!;
  }

  event(taskId: string, input: { level?: TaskEvent['level']; type: string; message: string; stepId?: string | null; data?: Record<string, unknown> }): TaskEvent {
    const id = newId('evt');
    const created = nowIso();
    this.db.run(
      'INSERT INTO task_events (id, task_id, step_id, level, type, message, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, taskId, input.stepId ?? null, input.level ?? 'info', input.type, input.message, toJson(input.data ?? {}), created],
    );
    return { id, taskId, stepId: input.stepId ?? null, level: input.level ?? 'info', type: input.type, message: input.message, data: input.data ?? {}, createdAt: created };
  }

  events(taskId: string, limit = 500): TaskEvent[] {
    return this.db
      .all<EventRow>('SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?', [taskId, limit])
      .map((r) => ({
        id: r.id,
        taskId: r.task_id,
        stepId: r.step_id,
        level: r.level as TaskEvent['level'],
        type: r.type,
        message: r.message,
        data: safeParse<Record<string, unknown>>(r.data_json, {}),
        createdAt: r.created_at,
      }));
  }

  dueScheduled(now = nowIso()): Task[] {
    return this.db
      .all<TaskRow>("SELECT * FROM tasks WHERE status = 'queued' AND scheduled_for IS NOT NULL AND scheduled_for <= ?", [now])
      .map((r) => this.task(r));
  }

  counts(): Record<string, number> {
    const rows = this.db.all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status');
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = Number(r.n);
    return out;
  }
}
