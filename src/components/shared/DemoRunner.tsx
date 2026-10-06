import * as React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Compass, LogIn, RotateCcw, Sparkles, X } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Progress } from '@/components/ui/primitives';
import { StatCard } from '@/components/ui/data';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/providers/AuthProvider';
import { cn } from '@/lib/utils';
import {
  ADMIN_FLOW_STEPS,
  FIRST_RUN_STEPS,
  demoStore,
  normalizePath,
  useDemoState,
  type DemoRunKey,
  type DemoStep,
} from '@/lib/demo';

interface DemoRunnerProps {
  run: DemoRunKey;
  title: string;
  intro: string;
  steps: DemoStep[];
  signIn?: { role: 'user' | 'admin'; label: string };
  deepCuts?: { label: string; to: string }[];
}

export function DemoRunner({ run, title, intro, steps, signIn, deepCuts }: DemoRunnerProps) {
  const state = useDemoState(run);
  const navigate = useNavigate();
  const location = useLocation();
  const { success, info } = useToast();
  const { user, isAuthenticated, login } = useAuth();
  const [signingIn, setSigningIn] = React.useState(false);
  const here = normalizePath(location.pathname);

  React.useEffect(() => {
    const match = steps.find((step) => normalizePath(step.to.split('?')[0]) === here);
    if (match && !demoStore.getState(run).done.includes(match.id)) {
      demoStore.markDone(run, match.id);
    }
  }, [here, run, steps]);

  const doneCount = state.done.length;
  const percent = Math.round((doneCount / steps.length) * 100);
  const nextStep = steps.find((step) => !state.done.includes(step.id)) ?? null;

  const needsSignIn = Boolean(signIn) && (!isAuthenticated || (signIn?.role === 'admin' && user?.role === 'user'));

  const signInAsDemo = async () => {
    setSigningIn(true);
    try {
      await login(signIn?.role === 'admin' ? 'admin@scriptora.app' : 'demo@scriptora.app', 'password123');
      success('Signed in', signIn?.role === 'admin' ? 'You are now an administrator.' : 'You are now the demo author.');
      if (!state.active) demoStore.start(run);
    } catch {
      info('Sign-in failed', 'Use demo@scriptora.app or admin@scriptora.app with password123.');
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="container space-y-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl space-y-1.5">
          <Badge variant="secondary" className="gap-1"><Compass className="h-3 w-3" /> Guided demo</Badge>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{intro}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {needsSignIn && (
            <Button size="sm" onClick={() => void signInAsDemo()} disabled={signingIn}>
              <LogIn className="h-3.5 w-3.5" /> {signingIn ? 'Signing in…' : signIn?.label}
            </Button>
          )}
          {state.active ? (
            <Button size="sm" variant="outline" onClick={() => { demoStore.stop(run); info('Guided run paused', 'Progress is saved — resume whenever you like.'); }}>
              <X className="h-3.5 w-3.5" /> Pause run
            </Button>
          ) : (
            <Button size="sm" onClick={() => { demoStore.start(run); success('Guided run started', 'A floating bar follows you through every step.'); }}>
              <Sparkles className="h-3.5 w-3.5" /> Start guided run
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              demoStore.reset(run);
              info('Progress reset', 'All steps are unchecked again.');
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Steps complete" value={`${doneCount} / ${steps.length}`} hint={`${percent}% of the flow`} tone={percent === 100 ? 'success' : 'default'} />
        <StatCard label="Progress" value={`${percent}%`} hint={state.startedAt ? `started ${new Date(state.startedAt).toLocaleDateString()}` : 'not started yet'} />
        <StatCard label="Next up" value={nextStep ? `${steps.indexOf(nextStep) + 1}. ${nextStep.title}` : 'Flow complete'} hint={nextStep ? nextStep.to : 'Reset to run it again'} icon={<CheckCircle2 className="h-4 w-4" />} />
        <StatCard label="Run state" value={state.active ? 'Guided' : 'Browsing'} hint={state.active ? 'the bar follows each step' : 'step links still work'} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Flow</CardTitle>
          <CardDescription className="text-xs">Follow in order or jump around — every step is a real screen with working controls.</CardDescription>
          <Progress value={percent} className="mt-2" />
        </CardHeader>
        <CardContent className="space-y-2">
          {steps.map((step, index) => {
            const done = state.done.includes(step.id);
            const isCurrent = state.active && state.currentIndex === index;
            return (
              <div
                key={step.id}
                className={cn(
                  'flex flex-wrap items-start gap-3 rounded-lg border p-2.5 transition-colors',
                  done && 'border-emerald-400/50 bg-emerald-50/50 dark:bg-emerald-500/5',
                  isCurrent && 'ring-1 ring-primary',
                )}
              >
                <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-2xs font-semibold', done ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground')}>
                  {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="text-xs text-muted-foreground">{step.description}</p>
                  {step.tip && <p className="mt-0.5 text-2xs text-primary">Tip: {step.tip}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  <Button
                    size="xs"
                    variant={done ? 'ghost' : 'default'}
                    onClick={() => {
                      demoStore.setIndex(run, index);
                      if (state.active) demoStore.markDone(run, step.id);
                      navigate(step.to);
                    }}
                  >
                    Open step {index + 1}
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => { demoStore.toggleDone(run, step.id); if (!done) success(`Step ${index + 1} checked off`); }}>
                    {done ? 'Undo' : 'Mark done'}
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {deepCuts && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Also worth opening</CardTitle>
            <CardDescription className="text-xs">Screens outside the numbered flow — all live.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {deepCuts.map((entry) => (
              <Link key={entry.to} to={entry.to} className="rounded border px-2 py-1 text-2xs hover:border-primary/50 hover:text-primary">
                {entry.label}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-2xs text-muted-foreground">
        Progress is stored in your browser ({'scriptora.demo.' + run + '.v1'}) so a refresh never loses your place.
      </p>
    </div>
  );
}

export function DemoBar() {
  const run = useSyncRun();
  const location = useLocation();
  const navigate = useNavigate();
  const { success } = useToast();
  const state = useDemoState(run ?? 'first-run');
  const steps = run === 'admin' ? ADMIN_FLOW_STEPS : FIRST_RUN_STEPS;
  const announced = React.useRef<Set<string>>(new Set());

  const here = normalizePath(location.pathname);
  const index = React.useMemo(() => steps.findIndex((step) => normalizePath(step.to.split('?')[0]) === here), [here, steps]);
  const current = index >= 0 ? steps[index] : steps[Math.min(state.currentIndex, steps.length - 1)];

  React.useEffect(() => {
    if (!run || index < 0) return;
    const step = steps[index];
    const key = `${run}:${step.id}`;
    if (demoStore.getState(run).done.includes(step.id) || announced.current.has(key)) return;
    announced.current.add(key);
    demoStore.markDone(run, step.id);
    demoStore.setIndex(run, index);
    success(`Demo step ${index + 1} of ${steps.length} complete`, step.title);
  }, [run, index, steps, success]);

  if (!run || !state.active) return null;

  const next = steps[Math.min(index + 1, steps.length - 1)];
  const previous = steps[Math.max(index - 1, 0)];
  const doneCount = state.done.length;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-50 flex justify-center px-3">
      <div className="pointer-events-auto flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-full border bg-background/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
        <Badge variant="secondary" className="gap-1"><Sparkles className="h-3 w-3" /> {doneCount}/{steps.length}</Badge>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{index >= 0 ? `Step ${index + 1}: ${current.title}` : `Next: ${current.title}`}</span>
        </span>
        <div className="flex items-center gap-1">
          <Button size="xs" variant="ghost" onClick={() => navigate(previous.to)} disabled={index <= 0}><ArrowLeft className="h-3 w-3" /> Prev</Button>
          {index >= 0 && <Button size="xs" variant="outline" onClick={() => { demoStore.markDone(run, current.id); success('Marked done'); }}><Check className="h-3 w-3" /> Done</Button>}
          <Button size="xs" onClick={() => navigate(next.to)} disabled={index >= steps.length - 1}>Next <ArrowRight className="h-3 w-3" /></Button>
          <Button size="xs" variant="ghost" aria-label="Exit guided run" onClick={() => { demoStore.stop(run); success('Guided run ended', 'Progress is saved in your browser.'); }}><X className="h-3 w-3" /></Button>
        </div>
      </div>
    </div>
  );
}

function useSyncRun(): DemoRunKey | null {
  const location = useLocation();
  const run = React.useSyncExternalStore(demoStore.subscribe, demoStore.getRun, () => null);
  if (run) return run;
  return location.pathname.startsWith('/admin') ? 'admin' : null;
}
