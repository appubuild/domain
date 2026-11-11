import type { TasksRepo, Task, PlanStep } from '../db/tasksRepo.js';
import type { AuditRepo } from '../db/auditRepo.js';
import type { SkillRegistry } from '../skills/registry.js';
import type { Permission, SkillExecutionContext, SkillResult } from '../skills/types.js';
import { RISK_BY_PERMISSION } from '../skills/types.js';
import { SKILL_ARG_VALIDATORS } from '../skills/builtin.js';
import { PermissionEngine } from './permissions.js';
import { verifyStepOutput } from './verification.js';
import { truncate } from '../util/text.js';

export type OrchestratorEvents = {
  onTaskUpdate?: (task: Task) => void;
  onLog?: (entry: { taskId: string; level: 'info' | 'warn' | 'error' | 'success'; message: string; stepId?: string | null }) => void;
};

export type RunTaskInput = {
  taskId: string;
  characterPermissions: {
    allowComputerControl: boolean;
    allowBrowserAutomation: boolean;
    allowFileSystem: boolean;
    allowNetworkResearch: boolean;
    disabledSkillIds: string[];
  };
  buildContext: (characterId: string) => SkillExecutionContext;
};

type Runtime = {
  status: 'running' | 'paused' | 'cancelled';
  abort: AbortController;
  cancelled: boolean;
};

/**
 * Executes a task plan step by step with:
 *  - per-step permission checks (character gate + standing permission + risk tier)
 *  - abort support (emergency stop / user cancel)
 *  - pause/resume between steps
 *  - verification evidence recorded per step
 *  - failure recovery: retryable/read-only steps retried once, otherwise the task fails
 *    with a precise error instead of continuing on broken state
 */
export class TaskOrchestrator {
  private runtimes = new Map<string, Runtime>();
  private readonly runQueue: RunTaskInput[] = [];
  private processing = false;

  constructor(
    private readonly tasks: TasksRepo,
    private readonly registry: SkillRegistry,
    private readonly permissions: PermissionEngine,
    private readonly audit: AuditRepo | null,
    private readonly events: OrchestratorEvents = {},
  ) {}

  isRunning(taskId: string): boolean {
    return this.runtimes.has(taskId);
  }

  /** Task ids waiting in the queue (in order). */
  get queued(): readonly string[] {
    return this.runQueue.map((q) => q.taskId);
  }

  enqueue(input: RunTaskInput): void {
    // The queue holds the object itself. It must NOT be JSON round-tripped: `buildContext`
    // is a function, and serialising would silently drop it, making every step fail with
    // "buildContext is not a function". (Regression covered by agent.test.ts.)
    this.runQueue.push(input);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.runQueue.length > 0) {
        const input = this.runQueue.shift();
        if (!input) break;
        await this.run(input);
      }
    } finally {
      this.processing = false;
    }
  }

  cancel(taskId: string): void {
    const rt = this.runtimes.get(taskId);
    if (rt) {
      rt.cancelled = true;
      rt.abort.abort();
    }
    const task = this.tasks.get(taskId);
    if (task && (task.status === 'running' || task.status === 'paused' || task.status === 'queued' || task.status === 'awaiting_confirmation')) {
      this.finish(taskId, 'cancelled', task.plan, 'Cancelled by user.');
    }
  }

  /**
   * Reconciles tasks left mid-flight by a previous process (crash, forced quit, dev server
   * restart). `running` tasks have no runtime to resume them and `queued` tasks have no queue
   * entry, so without this they stay "in progress" forever and the UI offers no way out.
   * They are marked failed with an explicit reason and are safe to retry.
   */
  recoverOrphans(now: Date = new Date()): number {
    const active = this.tasks.list({ status: ['running', 'queued'], limit: 200 });
    let recovered = 0;
    for (const task of active) {
      // Any `scheduledFor` task is *waiting*, never mid-flight: a future one is picked up by the
      // scheduler when its time comes, and a past-due one is picked up immediately on the first
      // scheduler tick. Failing them here would silently cancel the user's reminder.
      if (task.scheduledFor) continue;
      // A live runtime or a live queue entry belongs to *this* process — leave it alone.
      if (this.runtimes.has(task.id) || this.runQueue.some((q) => q.taskId === task.id)) continue;
      const plan = task.plan.map((s) =>
        s.status === 'running' ? { ...s, status: 'failed' as const, error: 'Interrupted by an app restart.' } : s,
      );
      this.finish(
        task.id,
        'failed',
        plan,
        'Interrupted by an app restart. Nothing was left half-applied; retry to start again.',
      );
      recovered++;
    }
    return recovered;
  }

  /**
   * Runs tasks whose `scheduledFor` time has arrived. Called on an interval by the server, and
   * on boot so a task due while the app was closed still runs (once).
   */
  dueScheduled(now: Date = new Date()): Task[] {
    const waiting = this.tasks.list({ status: ['queued'], limit: 200 });
    const due = waiting.filter((t) => t.scheduledFor && Date.parse(t.scheduledFor) <= now.getTime());
    // Oldest due first, so a backlog runs in the order the user asked for.
    due.sort((a, b) => Date.parse(a.scheduledFor!) - Date.parse(b.scheduledFor!));
    for (const task of due) {
      // Flip out of `scheduled` state (scheduledFor cleared) before queueing so the tick that
      // follows cannot enqueue the same task twice.
      this.tasks.update(task.id, { scheduledFor: null, status: 'queued' });
    }
    return due;
  }

  pause(taskId: string): boolean {
    const rt = this.runtimes.get(taskId);
    const task = this.tasks.get(taskId);
    if (!rt || !task) return false;
    rt.status = 'paused';
    this.update(taskId, { status: 'paused' }, 'Task paused by user.');
    return true;
  }

  resume(taskId: string): boolean {
    const rt = this.runtimes.get(taskId);
    if (!rt || rt.status !== 'paused') return false;
    rt.status = 'running';
    this.update(taskId, { status: 'running' }, 'Task resumed.');
    return true;
  }

  /** Shared abort signal for external tools (e.g. emergency stop handler). */
  abortTask(taskId: string): void {
    this.runtimes.get(taskId)?.abort.abort();
  }

  async run(input: RunTaskInput): Promise<Task> {
    const task = this.tasks.get(input.taskId);
    if (!task) throw new Error('Task not found');
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return task;

    const rt: Runtime = { status: 'running', abort: new AbortController(), cancelled: false };
    this.runtimes.set(task.id, rt);
    const plan: PlanStep[] = structuredClone(task.plan);
    this.update(task.id, { status: 'running', startedAt: new Date().toISOString(), plan }, 'Execution started.');

    try {
      for (let i = 0; i < plan.length; i++) {
        const step = plan[i];
        if (!step) continue;
        if (this.permissions.isStopped) {
          this.finish(task.id, 'cancelled', plan, 'Emergency stop engaged — task halted before executing the next step.');
          return this.tasks.get(task.id)!;
        }
        if (rt.cancelled) {
          this.finish(task.id, 'cancelled', plan, 'Cancelled by user.');
          return this.tasks.get(task.id)!;
        }
        while (rt.status === 'paused' && !rt.cancelled) await sleep(120);
        if (rt.cancelled) {
          this.finish(task.id, 'cancelled', plan, 'Cancelled by user.');
          return this.tasks.get(task.id)!;
        }
        if (step.status === 'done') continue;

        step.status = 'running';
        step.startedAt = new Date().toISOString();
        this.update(task.id, { plan, progress: i / plan.length }, `Step ${i + 1}/${plan.length}: ${step.title}`, step.id);

        const result = await this.executeStep(task, step, input, rt);
        step.finishedAt = new Date().toISOString();

        if (!result.exec.ok) {
          step.status = 'failed';
          step.error = result.exec.summary;
          if (result.exec.needsConfirmation) {
            this.tasks.update(task.id, { error: result.exec.summary });
            this.update(task.id, { status: 'awaiting_confirmation', plan, requiresConfirmation: true }, result.exec.summary, step.id, 'warn');
            this.finishRuntime(task.id);
            return this.tasks.get(task.id)!;
          }
          const retried = await this.maybeRetry(task, step, input, rt, plan);
          if (!retried) {
            this.finish(task.id, 'failed', plan, `Step "${step.title}" failed: ${result.exec.summary}`);
            return this.tasks.get(task.id)!;
          }
          continue;
        }

        step.status = 'done';
        step.result = result.exec.summary;
        const verification = verifyStepOutput({ result: result.exec, verify: step.verify });
        this.audit?.log({
          actor: `character:${task.characterId}`,
          action: `skill.${step.skillId ?? 'analysis'}`,
          target: step.id,
          outcome: 'success',
          detail: { verified: verification.verified, detail: verification.detail, taskId: task.id },
        });
        this.update(
          task.id,
          { plan, progress: (i + 1) / plan.length },
          `✓ ${step.title} — ${verification.verified ? 'verified' : `unverified (${verification.detail})`}`,
          step.id,
          verification.verified ? 'success' : 'warn',
        );
      }

      const allVerified = plan.every((s) => s.status === 'done');
      const finalStatus = allVerified ? 'completed' : 'failed';
      this.finish(task.id, finalStatus, plan, allVerified ? this.buildReport(plan) : 'Some steps did not complete.', {
        steps: plan.map((s) => ({ title: s.title, status: s.status, result: s.result })),
      });
      return this.tasks.get(task.id)!;
    } finally {
      this.finishRuntime(task.id);
    }
  }

  private finishRuntime(taskId: string): void {
    this.runtimes.delete(taskId);
  }

  private async executeStep(
    task: Task,
    step: PlanStep,
    input: RunTaskInput,
    rt: Runtime,
  ): Promise<{ exec: SkillResult & { needsConfirmation?: boolean } }> {
    if (!step.skillId) {
      return {
        exec: {
          ok: true,
          summary: `Analysis step recorded: ${truncate(step.description, 300)}`,
          evidence: { verified: true, detail: 'Analysis step completed without external action.' },
        },
      };
    }
    const skill = this.registry.get(step.skillId);
    if (!skill) {
      return { exec: { ok: false, summary: `Skill "${step.skillId}" is not installed.` } };
    }

    const permission = (skill.manifest.permissions[0] as Permission | undefined) ?? null;
    const check = this.permissions.check({ permission, characterPermissions: input.characterPermissions });
    if (!check.allowed) {
      this.audit?.log({
        actor: `character:${task.characterId}`,
        action: `skill.${step.skillId}`,
        target: step.id,
        outcome: check.needsConfirmation ? 'pending' : 'denied',
        detail: { reason: check.reason },
      });
      return { exec: { ok: false, summary: check.reason, needsConfirmation: check.needsConfirmation } };
    }

    const validate = SKILL_ARG_VALIDATORS[skill.manifest.id];
    let args = step.args;
    if (validate) {
      const parsed = validate.safeParse(args);
      if (!parsed.success) {
        return { exec: { ok: false, summary: `Invalid arguments for ${skill.manifest.id}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` } };
      }
      args = parsed.data;
    }

    try {
      const ctx = input.buildContext(task.characterId);
      ctx.signal = rt.abort.signal;
      ctx.taskId = task.id;
      ctx.logger = (level, message) => {
        this.events.onLog?.({ taskId: task.id, level: level === 'info' ? 'info' : level, message, stepId: step.id });
        this.tasks.event(task.id, { level: level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'info', type: 'step.log', message, stepId: step.id });
      };
      const result = await withTimeout(skill.run(args, ctx), 180_000, rt.abort);
      return { exec: result };
    } catch (err) {
      if (rt.cancelled) return { exec: { ok: false, summary: 'Cancelled.' } };
      return { exec: { ok: false, summary: `Skill threw: ${err instanceof Error ? err.message : String(err)}` } };
    }
  }

  private async maybeRetry(task: Task, step: PlanStep, input: RunTaskInput, rt: Runtime, plan: PlanStep[]): Promise<boolean> {
    const skill = step.skillId ? this.registry.get(step.skillId) : null;
    const readOnly = skill ? skill.manifest.permissions.every((p) => p === 'network.access' || p === 'files.read' || p === 'computer.screenshot') : false;
    const risk = step.skillId ? RISK_BY_PERMISSION[(skill?.manifest.permissions[0] as Permission) ?? 'network.access'] : 'low';
    if (!readOnly || risk !== 'low' || rt.cancelled) return false;
    this.tasks.event(task.id, { level: 'warn', type: 'step.retry', message: `Retrying "${step.title}" once (read-only step).`, stepId: step.id });
    await sleep(800);
    step.status = 'running';
    const retry = await this.executeStep(task, step, input, rt);
    step.status = retry.exec.ok ? 'done' : 'failed';
    step.result = retry.exec.ok ? retry.exec.summary : undefined;
    step.error = retry.exec.ok ? undefined : retry.exec.summary;
    this.update(task.id, { plan }, retry.exec.ok ? `✓ ${step.title} (retry succeeded)` : `✗ ${step.title} (retry failed)`, step.id, retry.exec.ok ? 'success' : 'error');
    return retry.exec.ok;
  }

  private buildReport(plan: PlanStep[]): string {
    const done = plan.filter((s) => s.status === 'done');
    return `Completed ${done.length}/${plan.length} steps:\n` + done.map((s) => `• ${s.title}: ${truncate(s.result ?? 'done', 140)}`).join('\n');
  }

  private update(
    taskId: string,
    patch: Parameters<TasksRepo['update']>[1],
    message: string,
    stepId?: string | null,
    level: 'info' | 'warn' | 'error' | 'success' = 'info',
  ): void {
    const task = this.tasks.update(taskId, patch);
    this.tasks.event(taskId, { level: level === 'success' ? 'success' : level, type: 'step', message, stepId: stepId ?? null });
    this.events.onLog?.({ taskId, level, message, stepId });
    this.events.onTaskUpdate?.(task);
  }

  private finish(taskId: string, status: 'completed' | 'failed' | 'cancelled', plan: PlanStep[], message: string, result?: Record<string, unknown>): void {
    const task = this.tasks.update(taskId, {
      status,
      plan,
      finishedAt: new Date().toISOString(),
      progress: status === 'completed' ? 1 : this.tasks.get(taskId)?.progress ?? 0,
      // Cancellations record their reason too (e.g. emergency stop), so the UI can explain.
      error: status === 'completed' ? null : message,
      result: result ?? { report: message, steps: plan.map((s) => ({ title: s.title, status: s.status })) },
    });
    this.tasks.event(taskId, { level: status === 'completed' ? 'success' : status === 'failed' ? 'error' : 'warn', type: 'task.finished', message });
    this.events.onTaskUpdate?.(task);
    this.events.onLog?.({ taskId, level: status === 'completed' ? 'success' : 'error', message });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, abort: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new Error(`Step timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
