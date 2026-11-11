import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, Ban, CheckCircle2, ChevronRight, CircleDashed, Clock, Pause, Play, Plus, RefreshCw, RotateCcw, ShieldQuestion, Sparkles, XCircle, Zap, Radio, GraduationCap } from 'lucide-react';
import { useActiveCharacter, useApp } from '@/store/app';
import { apiGet, apiPost } from '@/lib/api';
import type { Task, TaskEvent } from '@/lib/types';
import { Badge, Button, EmptyState, ErrorState, Field, Modal, Panel, ProgressBar, Skeleton, Tabs } from '@/components/ui';
import { useEventStream } from '@/lib/useEventStream';
import { cn, formatMs, relativeTime, untilTime } from '@/lib/utils';

const STATUS_TONE: Record<Task['status'], 'neutral' | 'good' | 'warn' | 'bad' | 'accent'> = {
  queued: 'neutral',
  planning: 'accent',
  awaiting_confirmation: 'warn',
  running: 'accent',
  paused: 'warn',
  completed: 'good',
  failed: 'bad',
  cancelled: 'neutral',
};

const STATUS_ICON: Record<Task['status'], React.ReactNode> = {
  queued: <Clock className="h-3 w-3" />,
  planning: <Sparkles className="h-3 w-3" />,
  awaiting_confirmation: <ShieldQuestion className="h-3 w-3" />,
  running: <Activity className="h-3 w-3 animate-pulse" />,
  paused: <Pause className="h-3 w-3" />,
  completed: <CheckCircle2 className="h-3 w-3" />,
  failed: <XCircle className="h-3 w-3" />,
  cancelled: <Ban className="h-3 w-3" />,
};

export function TasksPage() {
  const character = useActiveCharacter();
  const { toast, emergencyStop } = useApp();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('t');
  const [filter, setFilter] = React.useState<'all' | 'active' | 'done' | 'failed'>('all');
  const [createOpen, setCreateOpen] = React.useState(false);

  const tasks = useQuery({
    queryKey: ['tasks', character?.id],
    queryFn: () => apiGet<{ tasks: Task[]; counts: Record<string, number> }>(`/tasks?characterId=${character?.id}`),
    enabled: Boolean(character),
    refetchInterval: 10_000,
  });

  const detail = useQuery({
    queryKey: ['task', selectedId],
    queryFn: () => apiGet<{ task: Task; events: TaskEvent[]; running: boolean }>(`/tasks/${selectedId}`),
    enabled: Boolean(selectedId),
    refetchInterval: 4000,
  });

  const { connected } = useEventStream((evt) => {
    if (evt.type.startsWith('task.')) {
      void tasks.refetch();
      if (evt.type === 'task.updated' && (evt.task as { id?: string } | undefined)?.id === selectedId) void detail.refetch();
    }
  });

  const act = async (task: Task, action: 'cancel' | 'pause' | 'resume' | 'retry' | 'confirm') => {
    try {
      await apiPost(`/tasks/${task.id}/${action}`, {});
      toast({ title: `Task ${action}${action === 'cancel' ? 'led' : 'd'}`, tone: 'success' });
      await tasks.refetch();
      if (selectedId) await detail.refetch();
    } catch (err) {
      toast({ title: `Could not ${action} task`, description: err instanceof Error ? err.message : '', tone: 'error' });
    }
  };

  const teach = async (task: Task) => {
    try {
      const res = await apiPost<{ proposal?: { id: string; name: string } }>('/tasks/teach', { taskId: task.id });
      toast({ title: 'Skill proposal created', description: res.proposal ? `"${res.proposal.name}" is waiting for your approval in Skills.` : 'Review the proposal before enabling.', tone: 'success' });
    } catch (err) {
      toast({ title: 'Could not propose a skill', description: err instanceof Error ? err.message : '', tone: 'error' });
    }
  };

  if (!character) {
    return <div className="px-6 py-12"><EmptyState title="No character selected" description="Tasks run under a character so permissions and memory stay scoped." /></div>;
  }

  const list = tasks.data?.tasks ?? [];
  const filtered = list.filter((t) => {
    if (filter === 'active') return ['queued', 'planning', 'running', 'awaiting_confirmation', 'paused'].includes(t.status);
    if (filter === 'done') return t.status === 'completed';
    if (filter === 'failed') return t.status === 'failed' || t.status === 'cancelled';
    return true;
  });
  const task = detail.data?.task ?? list.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col border-r border-white/[0.06]">
        <div className="space-y-2 p-4">
          <Button variant="primary" className="w-full" onClick={() => setCreateOpen(true)} disabled={emergencyStop}>
            <Plus className="h-4 w-4" /> New task
          </Button>
          <div className="flex items-center justify-between">
            <span className={cn('flex items-center gap-1.5 text-[10px]', connected ? 'text-emerald-400' : 'text-slate-500')}>
              <Radio className="h-3 w-3" /> {connected ? 'live updates' : 'polling every 10s'}
            </span>
            <Button size="sm" variant="subtle" onClick={() => void tasks.refetch()} aria-label="Refresh tasks"><RefreshCw className="h-3 w-3" /></Button>
          </div>
          <Tabs value={filter} onChange={setFilter} items={[{ value: 'all', label: 'All', count: list.length }, { value: 'active', label: 'Active' }, { value: 'done', label: 'Done' }, { value: 'failed', label: 'Failed' }]} />
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-4">
          {tasks.isLoading ? <div className="space-y-2 px-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div> : filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-slate-600">{list.length === 0 ? 'No tasks yet. Describe a multi-step goal.' : 'Nothing in this filter.'}</p>
          ) : filtered.map((t) => (
            <button key={t.id} onClick={() => setParams({ t: t.id })} className={cn('w-full rounded-xl p-3 text-left transition-colors', t.id === selectedId ? 'bg-holo-500/[0.1]' : 'hover:bg-white/[0.04]')}>
              <div className="flex items-start justify-between gap-2">
                <p className={cn('line-clamp-2 text-[11px] font-medium', t.id === selectedId ? 'text-holo-100' : 'text-slate-300')}>{t.title}</p>
                <Badge tone={STATUS_TONE[t.status]} className="shrink-0 px-1.5 py-0 text-[8px]">{STATUS_ICON[t.status]}{t.status.replace('_', ' ')}</Badge>
              </div>
              <p className="mt-1 line-clamp-1 text-[10px] text-slate-500">{t.goal}</p>
              <div className="mt-1.5 flex items-center gap-2 text-[9px] text-slate-600">
                <ProgressBar value={t.progress} className="h-1 flex-1" tone={t.status === 'failed' ? 'bad' : t.status === 'completed' ? 'good' : 'accent'} />
                <span>{Math.round(t.progress * 100)}%</span>
                <span>{t.scheduledFor ? `fires ${untilTime(t.scheduledFor)}` : relativeTime(t.createdAt)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto">
        {!task ? (
          <div className="flex h-full items-center justify-center p-8">
            <div className="max-w-md text-center">
              <Zap className="mx-auto h-8 w-8 text-slate-700" />
              <h2 className="mt-3 text-sm font-semibold text-slate-300">Agent tasks</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Give {character.name} a goal with several steps. The orchestrator produces a plan, checks permissions, executes each verified step, and logs everything. High-risk steps pause for your approval.
              </p>
              <div className="mt-4 grid gap-1.5 text-left">
                {['Summarise the files in my workspace and write a brief', 'Research three options and compare them', 'Draft a plan for the week from my notes'].map((g) => (
                  <button key={g} onClick={() => setCreateOpen(true)} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] text-slate-400 hover:border-holo-500/25 hover:text-holo-200">
                    {g}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl space-y-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge tone={STATUS_TONE[task.status]}>{STATUS_ICON[task.status]}{task.status.replace('_', ' ')}</Badge>
                  {task.scheduledFor ? <Badge tone="accent"><Clock className="h-3 w-3" />starts {untilTime(task.scheduledFor)}</Badge> : null}
                  <span className="text-[10px] text-slate-600">created {relativeTime(task.createdAt)}</span>
                  {detail.data?.running ? <Badge tone="accent">executing</Badge> : null}
                </div>
                <h2 className="mt-1.5 text-base font-semibold text-slate-100">{task.title}</h2>
                <p className="mt-0.5 text-xs text-slate-400">{task.goal}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {task.status === 'running' || task.status === 'planning' ? <Button size="sm" variant="ghost" onClick={() => void act(task, 'pause')}><Pause className="h-3 w-3" /> Pause</Button> : null}
                {task.status === 'paused' ? <Button size="sm" variant="ghost" onClick={() => void act(task, 'resume')}><Play className="h-3 w-3" /> Resume</Button> : null}
                {['failed', 'cancelled'].includes(task.status) ? <Button size="sm" variant="ghost" onClick={() => void act(task, 'retry')}><RotateCcw className="h-3 w-3" /> Retry</Button> : null}
                {['failed', 'completed'].includes(task.status) ? <Button size="sm" variant="ghost" onClick={() => void teach(task)}><GraduationCap className="h-3 w-3" /> Teach</Button> : null}
                {!['completed', 'cancelled'].includes(task.status) ? <Button size="sm" variant="danger" onClick={() => void act(task, 'cancel')}><Ban className="h-3 w-3" /> Cancel</Button> : null}
              </div>
            </div>

            <Panel className="p-4">
              <div className="mb-3 flex items-center justify-between text-[11px]"><span className="text-slate-500">Progress</span><span className="font-mono text-slate-300">{Math.round(task.progress * 100)}%</span></div>
              <ProgressBar value={task.progress} tone={task.status === 'failed' ? 'bad' : task.status === 'completed' ? 'good' : 'accent'} />
              {task.error ? <p className="mt-2 rounded-lg border border-rose-500/20 bg-rose-500/[0.05] p-2 text-[11px] text-rose-200">{task.error}</p> : null}
              {task.status === 'awaiting_confirmation' ? (
                <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] p-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-200"><AlertTriangle className="h-3.5 w-3.5" /> Approval required</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-amber-200/70">A step needs a permission this character does not hold. Review the step, then grant it once to continue.</p>
                  <Button size="sm" variant="primary" className="mt-2" onClick={() => void act(task, 'confirm')}>Grant &amp; continue</Button>
                </div>
              ) : null}
            </Panel>

            <Panel className="p-4">
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Plan</h3>
              {detail.isLoading ? <Skeleton className="h-24" /> : (
                <ol className="space-y-1.5">
                  {(detail.data?.task.plan ?? task.plan).map((step, i) => (
                    <li key={step.id} className={cn('rounded-xl border p-2.5', step.status === 'running' ? 'border-holo-500/30 bg-holo-500/[0.05]' : step.status === 'failed' ? 'border-rose-500/25 bg-rose-500/[0.04]' : 'border-white/[0.06] bg-white/[0.02]')}>
                      <div className="flex items-start gap-2.5">
                        <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold', step.status === 'done' ? 'bg-emerald-500/15 text-emerald-300' : step.status === 'failed' ? 'bg-rose-500/15 text-rose-300' : step.status === 'running' ? 'bg-holo-500/20 text-holo-200' : 'bg-white/5 text-slate-500')}>
                          {step.status === 'done' ? <CheckCircle2 className="h-3 w-3" /> : step.status === 'failed' ? <XCircle className="h-3 w-3" /> : step.status === 'running' ? <Activity className="h-3 w-3 animate-pulse" /> : i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-[11px] font-medium text-slate-200">{step.title}</p>
                            {step.risk !== 'low' ? <Badge tone={step.risk === 'high' ? 'bad' : 'warn'} className="px-1 py-0 text-[8px]">{step.risk} risk</Badge> : null}
                            {step.skillId ? <span className="rounded bg-white/5 px-1 font-mono text-[9px] text-slate-500">{step.skillId}</span> : null}
                          </div>
                          <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{step.description}</p>
                          {step.result ? <p className="mt-1 rounded bg-emerald-500/[0.06] px-1.5 py-1 text-[10px] text-emerald-200/70">{step.result.slice(0, 300)}</p> : null}
                          {step.error ? <p className="mt-1 rounded bg-rose-500/[0.06] px-1.5 py-1 text-[10px] text-rose-200/80">{step.error}</p> : null}
                          {step.verify.kind !== 'none' ? <p className="mt-1 text-[9px] text-slate-600">verify: {step.verify.description ?? step.verify.kind}</p> : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>

            <Panel className="p-4">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Execution log</h3>
              <div className="max-h-64 space-y-0.5 overflow-y-auto font-mono text-[10px]">
                {(detail.data?.events ?? []).length === 0 ? <p className="text-slate-600">No events yet.</p> : (detail.data?.events ?? []).map((e) => (
                  <div key={e.id} className="flex gap-2 py-0.5">
                    <span className="shrink-0 text-slate-600">{new Date(e.createdAt).toLocaleTimeString()}</span>
                    <span className={cn('shrink-0 uppercase', e.level === 'error' ? 'text-rose-400' : e.level === 'warn' ? 'text-amber-400' : e.level === 'success' ? 'text-emerald-400' : 'text-slate-500')}>{e.level}</span>
                    <span className="text-slate-400">{e.message}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        )}
      </div>

      <CreateTaskModal open={createOpen} onClose={() => setCreateOpen(false)} characterId={character.id} onCreated={async (id) => { await tasks.refetch(); setParams({ t: id }); }} />
    </div>
  );
}

function CreateTaskModal({ open, onClose, characterId, onCreated }: { open: boolean; onClose: () => void; characterId: string; onCreated: (id: string) => Promise<void> }) {
  const [goal, setGoal] = React.useState('');
  const [schedule, setSchedule] = React.useState('');
  const [plan, setPlan] = React.useState<{ title: string; steps: Array<{ title: string; risk: string; skillId: string | null }>; notes: string[] } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const preview = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ plan: typeof plan }>('/tasks/plan', { characterId, goal });
      setPlan(res.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not plan');
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ task: Task }>('/tasks', { characterId, goal, scheduledFor: schedule ? new Date(schedule).toISOString() : null, execute: !schedule });
      onClose();
      setGoal('');
      setPlan(null);
      setSchedule('');
      await onCreated(res.task.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create task');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New agent task" description="Describe the outcome you want. The planner picks skills from what this character is permitted to use." width="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="ghost" onClick={() => void preview()} loading={busy} disabled={goal.trim().length < 4}>Preview plan</Button><Button variant="primary" onClick={() => void create()} loading={busy} disabled={goal.trim().length < 4}>Create &amp; run</Button></>}>
      {error ? <div className="mb-2"><ErrorState message={error} /></div> : null}
      <Field label="Goal">
        <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={3} className="input" placeholder="e.g. Summarise every markdown file in my workspace and write brief.md with the key points" maxLength={2000} />
      </Field>
      <div className="mt-3">
        <Field label="Schedule for later (optional)" hint="Leave empty to run immediately. The task waits in the queue until the scheduled time.">
          <input type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} className="input" />
        </Field>
      </div>
      {plan ? (
        <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-[11px] font-medium text-slate-200">{plan.title}</p>
          <ol className="mt-2 space-y-1">
            {plan.steps.map((s, i) => (
              <li key={i} className="flex items-center gap-2 text-[10px] text-slate-400">
                <span className="text-slate-600">{i + 1}.</span>
                <span className="flex-1">{s.title}</span>
                {s.skillId ? <span className="rounded bg-white/5 px-1 font-mono text-[9px]">{s.skillId}</span> : null}
                {s.risk !== 'low' ? <span className="text-amber-400">{s.risk}</span> : null}
              </li>
            ))}
          </ol>
          {plan.notes.length ? <ul className="mt-2 space-y-0.5">{plan.notes.map((n, i) => <li key={i} className="text-[10px] text-amber-200/60">• {n}</li>)}</ul> : null}
        </div>
      ) : null}
    </Modal>
  );
}
