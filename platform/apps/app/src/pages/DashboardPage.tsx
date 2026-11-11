import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowUpRight, AudioLines, Brain, Clock, Cpu, HardDrive, ListChecks, MessagesSquare, ShieldCheck, ShieldAlert, Sparkles, Wrench } from 'lucide-react';
import { useApp, useActiveCharacter } from '@/store/app';
import { apiGet } from '@/lib/api';
import type { Conversation, Message, Task, UsageSummary } from '@/lib/types';
import { AvatarStage } from '@/components/avatar/AvatarStage';
import { AvatarOrb } from '@/components/avatar/AvatarOrb';
import { Badge, Button, EmptyState, Panel, PanelHeader, ProgressBar, Skeleton, Stat } from '@/components/ui';
import { formatCost, formatMs, formatNumber, nowClock, relativeTime, truncate } from '@/lib/utils';
import { useInstalledStatus } from '@/lib/hooks';

export function DashboardPage() {
  const { health, system, usage, refreshUsage, characters } = useApp();
  const character = useActiveCharacter();
  const clock = useClock();

  const conversations = useQuery({
    queryKey: ['conversations', character?.id],
    queryFn: () => apiGet<{ conversations: Conversation[] }>(`/conversations?characterId=${character?.id}`),
    enabled: Boolean(character?.id),
  });
  const tasks = useQuery({
    queryKey: ['tasks', 'recent', character?.id],
    queryFn: () => apiGet<{ tasks: Task[] }>(`/tasks?characterId=${character?.id}&limit=6`),
    enabled: Boolean(character?.id),
    refetchInterval: 8000,
  });
  const recentMessages = useQuery({
    queryKey: ['messages', 'recent', conversations.data?.conversations[0]?.id],
    queryFn: () => apiGet<{ messages: Message[] }>(`/conversations/${conversations.data?.conversations[0]?.id}/messages?limit=4`),
    enabled: Boolean(conversations.data?.conversations[0]?.id),
  });
  const installed = useInstalledStatus();

  React.useEffect(() => {
    void refreshUsage();
  }, [refreshUsage]);

  const activeTasks = (tasks.data?.tasks ?? []).filter((t) => ['queued', 'planning', 'running', 'awaiting_confirmation', 'paused'].includes(t.status));

  if (!character) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12">
        <EmptyState
          title="Create your first character"
          description="AURA is local-first: pick one of seven character templates, then talk to it with your voice or type. Nothing leaves your machine unless you connect a provider key."
          icon={<Sparkles className="h-5 w-5" />}
          action={
            <Link to="/studio">
              <Button variant="primary">
                Open Character Studio <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 px-6 py-6">
      {/* hero */}
      <Panel className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-0 opacity-40 scanline" />
        <div className="relative grid gap-6 lg:grid-cols-[1fr_400px]">
          <div className="flex flex-col justify-between gap-5 p-6">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">{character.config.characterType}</Badge>
                <Badge>{character.templateKey}</Badge>
                {character.isDefault ? <Badge tone="good">default</Badge> : null}
                <span className="text-[11px] text-slate-500">updated {relativeTime(character.updatedAt)}</span>
              </div>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-50">
                Good {greeting()}, I&apos;m <span className="holo-text">{character.name}</span>
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">{character.config.description}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {character.config.expertise.slice(0, 6).map((e) => (
                  <span key={e} className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-slate-400">
                    {e}
                  </span>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <MiniStat icon={<Clock className="h-3.5 w-3.5" />} label="Local time" value={clock.time} hint={`${clock.date} ${clock.zone}`} />
              <MiniStat icon={<Cpu className="h-3.5 w-3.5" />} label="Brain" value={character.config.intelligence.provider} hint={character.config.intelligence.model || 'auto'} />
              <MiniStat icon={<Brain className="h-3.5 w-3.5" />} label="Memories" value={character.stats ? formatNumber(character.stats.memoryCount) : '—'} hint={`${character.config.memory.retentionDays}d retention`} />
              <MiniStat icon={<MessagesSquare className="h-3.5 w-3.5" />} label="Chats" value={character.stats ? formatNumber(character.stats.conversationCount) : String(conversations.data?.conversations.length ?? '—')} hint="local only" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/voice">
                <Button variant="primary">
                  <AudioLines className="h-4 w-4" /> Talk with voice
                </Button>
              </Link>
              <Link to="/conversations">
                <Button variant="ghost">
                  <MessagesSquare className="h-4 w-4" /> Open chat
                </Button>
              </Link>
              <Link to={`/studio/${character.id}`}>
                <Button variant="ghost">
                  <Sparkles className="h-4 w-4" /> Customise
                </Button>
              </Link>
            </div>
          </div>
          <div className="relative min-h-[320px]">
            <AvatarStage spec={character.avatarSpec} height="100%" className="h-full rounded-none border-0" mode="compact" quality="medium" />
            <div className="absolute bottom-3 left-4 flex items-center gap-2">
              <AvatarOrb state="IDLE" accent={character.avatarSpec.palette.accent} size={22} />
              <span className="text-[11px] text-slate-400">Idle · {character.config.voice.autoSpeak ? 'voice on' : 'voice off'}</span>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-3">
        {/* left column */}
        <div className="space-y-5 xl:col-span-2">
          <Panel>
            <PanelHeader
              title="Active agent tasks"
              subtitle={`${activeTasks.length} running · ${(tasks.data?.tasks ?? []).length} recent`}
              icon={<ListChecks className="h-4 w-4" />}
              action={
                <Link to="/tasks" className="text-[11px] text-holo-300 hover:text-holo-200">
                  View all
                </Link>
              }
            />
            <div className="space-y-2 p-5">
              {tasks.isLoading ? (
                <>
                  <Skeleton className="h-14" />
                  <Skeleton className="h-14" />
                </>
              ) : activeTasks.length === 0 ? (
                <EmptyState
                  title="No agent tasks in flight"
                  description="Ask your character to do multi-step work — like preparing a report or reorganising a folder — and the orchestrator will plan, execute and verify each step here."
                  icon={<Wrench className="h-5 w-5" />}
                  action={
                    <Link to="/tasks">
                      <Button size="sm" variant="ghost">
                        Open Agent Tasks
                      </Button>
                    </Link>
                  }
                />
              ) : (
                activeTasks.slice(0, 4).map((task) => (
                  <Link key={task.id} to={`/tasks?t=${task.id}`} className="block rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition-colors hover:border-holo-500/25">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-xs font-medium text-slate-200">{task.title}</p>
                      <Badge tone={task.status === 'running' ? 'accent' : task.status === 'failed' ? 'bad' : task.status === 'awaiting_confirmation' ? 'warn' : 'neutral'}>{task.status.replace('_', ' ')}</Badge>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-slate-500">{task.goal}</p>
                    <ProgressBar className="mt-2" value={task.progress} tone={task.status === 'failed' ? 'bad' : 'accent'} />
                  </Link>
                ))
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Recent conversation"
              subtitle={conversations.data?.conversations[0]?.title ?? 'No conversation yet'}
              icon={<MessagesSquare className="h-4 w-4" />}
              action={
                <Link to="/conversations" className="text-[11px] text-holo-300 hover:text-holo-200">
                  All chats
                </Link>
              }
            />
            <div className="space-y-2.5 p-5">
              {recentMessages.isLoading ? <Skeleton className="h-24" /> : null}
              {(recentMessages.data?.messages ?? []).map((m) => (
                <div key={m.id} className="flex gap-2.5">
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${m.role === 'user' ? 'bg-slate-500' : 'bg-holo-400'}`} />
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-slate-600">{m.role === 'user' ? 'You' : character.name}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-300">{truncate(m.content, 240)}</p>
                  </div>
                </div>
              ))}
              {!recentMessages.isLoading && (recentMessages.data?.messages ?? []).length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">No messages yet. Start a voice call or open a chat.</p>
              ) : null}
            </div>
          </Panel>
        </div>

        {/* right column */}
        <div className="space-y-5">
          <Panel>
            <PanelHeader title="System" subtitle="Local runtime truth" icon={<Activity className="h-4 w-4" />} />
            <div className="space-y-2.5 p-5">
              <Row label="Server" value={health?.ok ? 'Healthy' : 'Unreachable'} tone={health?.ok ? 'good' : 'bad'} />
              <Row label="Database" value={health ? `v${health.schemaVersion}` : '—'} />
              <Row label="Uptime" value={health ? `${Math.round(health.uptimeSeconds / 60)}m` : '—'} />
              <Row label="Node" value={system?.node ?? '—'} />
              <Row label="Memory" value={system ? `${formatNumber(system.freeMemMb)} / ${formatNumber(system.totalMemMb)} MB free` : '—'} />
              <Row label="Data dir" value={<span className="break-all font-mono text-[10px]">{health?.dataDir ?? '—'}</span>} />
              <div className="hairline my-2" />
              <CapabilityRow label="Computer control" on={Boolean(system?.capabilities.computerControl)} note="Windows desktop build" />
              <CapabilityRow label="Browser automation" on={Boolean(system?.capabilities.browserAutomation)} note="Desktop bridge" />
              <CapabilityRow label="File sandbox" on={Boolean(system?.capabilities.fileSystem)} note="Always on" />
              <CapabilityRow label="Knowledge base" on={Boolean(system?.capabilities.knowledge)} note="Local documents" />
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="API spend today"
              subtitle="Measured from real provider responses"
              icon={<HardDrive className="h-4 w-4" />}
              action={
                <Link to="/billing" className="text-[11px] text-holo-300 hover:text-holo-200">
                  Details
                </Link>
              }
            />
            <div className="grid grid-cols-2 gap-2.5 p-5">
              <Stat label="Requests" value={usage ? formatNumber(usage.today.requests) : '—'} />
              <Stat label="Cost" value={usage ? formatCost(usage.today.costUsd) : '—'} hint="your provider account" />
              <Stat label="Input" value={usage ? formatNumber(usage.today.inputTokens) : '—'} hint="tokens" />
              <Stat label="Output" value={usage ? formatNumber(usage.today.outputTokens) : '—'} hint="tokens" />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Quick actions" icon={<Sparkles className="h-4 w-4" />} />
            <div className="grid grid-cols-2 gap-2 p-5">
              <QuickAction to="/voice" icon={<AudioLines className="h-4 w-4" />} label="Voice call" />
              <QuickAction to="/memory" icon={<Brain className="h-4 w-4" />} label="Memory" />
              <QuickAction to="/skills" icon={<Wrench className="h-4 w-4" />} label="Skills" />
              <QuickAction to="/models" icon={<Cpu className="h-4 w-4" />} label="Models" />
            </div>
            {installed.data ? (
              <p className="px-5 pb-4 text-[10px] leading-relaxed text-slate-500">
                {installed.data.skills} built-in skills · {characters.length} characters · {installed.data.templates} templates
              </p>
            ) : null}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function useClock() {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return React.useMemo(() => nowClock(new Date()), [tick]);
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

function MiniStat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-2.5">
      <div className="flex items-center gap-1.5 text-slate-500">
        {icon}
        <span className="text-[9px] uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-1 truncate text-sm font-medium capitalize text-slate-100">{value}</p>
      {hint ? <p className="truncate text-[10px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className={tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-rose-300' : 'text-slate-300'}>{value}</span>
    </div>
  );
}

function CapabilityRow({ label, on, note }: { label: string; on: boolean; note: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="flex items-center gap-1.5 text-slate-400">
        {on ? <ShieldCheck className="h-3 w-3 text-emerald-400" /> : <ShieldAlert className="h-3 w-3 text-amber-500" />}
        {label}
      </span>
      <span className={on ? 'text-[10px] text-emerald-300' : 'text-[10px] text-amber-400/80'}>{on ? 'available' : note}</span>
    </div>
  );
}

function QuickAction({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link to={to} className="flex flex-col gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-slate-400 transition-all hover:border-holo-500/25 hover:text-holo-200">
      <span className="text-holo-400">{icon}</span>
      <span className="text-[11px]">{label}</span>
    </Link>
  );
}
