import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import { aiService, bookService, userService } from '@/services';
import { useToast } from '@/components/ui/toast';
import { Seo } from '@/components/shared/Seo';
import { Badge, Button, Card, CardContent, Checkbox, Input, Progress, Select, Textarea } from '@/components/ui/primitives';
import { Stepper } from '@/components/ui/data';
import { cn } from '@/lib/utils';
import { BOOK_KINDS } from '@/data/constants';
import { BOOK_KIND_LABELS } from '@/lib/format';
import type { BookKind } from '@/types/domain';

const STEPS = [
  { id: 'you', label: 'About you' },
  { id: 'writing', label: 'Your writing' },
  { id: 'first', label: 'Your first book' },
  { id: 'done', label: 'Pick up tips' },
];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user, refresh, updateUser } = useAuth();
  const { success, info } = useToast();
  const [step, setStep] = React.useState('you');
  const [busy, setBusy] = React.useState(false);

  const [answers, setAnswers] = React.useState({
    experience: 'first-book',
    genres: [] as BookKind[],
    goal: 'publish-and-sell',
    routine: 'evenings',
    wordTarget: '500',
    useAI: true,
    bookTitle: '',
    bookIdea: '',
    createNow: true,
  });

  const stepIndex = STEPS.findIndex((entry) => entry.id === step);
  const progress = Math.round(((stepIndex + 1) / STEPS.length) * 100);

  const finish = async (skipped = false) => {
    if (!user) return;
    setBusy(true);
    try {
      userService.updateProfile(user.id, {
        tagline: answers.genres.length ? `${answers.genres.map((genre) => BOOK_KIND_LABELS[genre] ?? genre).join(' · ')} writer` : 'Writer',
        onboarded: true,
      });
      updateUser({ onboarded: true });
      if (!skipped && answers.createNow && answers.bookTitle.trim()) {
        const book = await bookService.create(
          {
            title: answers.bookTitle.trim(),
            author: user.name,
            description: answers.bookIdea,
            kind: answers.genres[0] ?? 'fiction',
            language: 'en',
            trimSizeId: '6x9',
            orientation: 'portrait',
            margins: { top: 0.75, right: 0.6, bottom: 0.75, left: 0.6 },
            gutter: 0.5,
            bleed: 0,
            headingFont: 'Playfair Display',
            bodyFont: 'Source Serif 4',
            palette: 'ink',
            source: 'blank',
          },
          user.id,
          user.name,
        );
        success('Workspace ready', `Your first project “${book.title}” is open in the editor.`);
        refresh();
        navigate(`/dashboard/books/${book.id}/editor`);
        return;
      }
      success(skipped ? 'You can finish this later in Settings' : 'Welcome to Scriptora', 'Your workspace is ready.');
      refresh();
      navigate('/dashboard');
    } finally {
      setBusy(false);
    }
  };

  const toggleGenre = (genre: BookKind) => {
    setAnswers((current) => ({
      ...current,
      genres: current.genres.includes(genre) ? current.genres.filter((entry) => entry !== genre) : [...current.genres, genre],
    }));
  };

  return (
    <>
      <Seo title="Welcome to Scriptora" noIndex />
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Setup</p>
            <h1 className="mt-1 font-display text-2xl font-bold text-foreground">
              {step === 'you' ? `Welcome, ${user?.name.split(' ')[0] ?? 'writer'}` : STEP_TITLES[step]}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{STEP_SUBTITLES[step]}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => finish(true)}>
            Skip for now
          </Button>
        </div>

        <div className="mt-6">
          <Progress value={progress} />
          <div className="mt-2 flex items-center justify-between text-2xs text-muted-foreground">
            <span>
              Step {stepIndex + 1} of {STEPS.length}
            </span>
            <span>{progress}% complete</span>
          </div>
        </div>

        <div className="mt-4">
          <Stepper steps={STEPS} current={step} onSelect={setStep} />
        </div>

        <Card className="mt-6">
          <CardContent className="space-y-5">
            {step === 'you' && (
              <>
                <fieldset>
                  <legend className="text-sm font-semibold text-foreground">How much have you published before?</legend>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {([
                      ['first-book', 'This is my first book'],
                      ['some-experience', 'I have published one or two'],
                      ['experienced', 'I am an experienced author'],
                      ['professional', 'I publish professionally'],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setAnswers((current) => ({ ...current, experience: value }))}
                        aria-pressed={answers.experience === value}
                        className={cn(
                          'rounded-lg border px-3.5 py-3 text-left text-sm transition-colors',
                          answers.experience === value ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:border-primary/40',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="text-sm font-semibold text-foreground">What do you write?</legend>
                  <p className="text-xs text-muted-foreground">Pick as many as apply. This tunes your template suggestions.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {BOOK_KINDS.map((genre) => (
                      <button
                        key={genre}
                        type="button"
                        onClick={() => toggleGenre(genre)}
                        aria-pressed={answers.genres.includes(genre)}
                        className={cn(
                          'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                          answers.genres.includes(genre) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40',
                        )}
                      >
                        {BOOK_KIND_LABELS[genre] ?? genre}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </>
            )}

            {step === 'writing' && (
              <>
                <fieldset>
                  <legend className="text-sm font-semibold text-foreground">What is the outcome you want?</legend>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {([
                      ['finish', 'Finish a draft I keep starting'],
                      ['publish-and-sell', 'Publish and sell it'],
                      ['print-copy', 'Hold a printed copy in my hands'],
                      ['client-work', 'Deliver books for clients'],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setAnswers((current) => ({ ...current, goal: value }))}
                        aria-pressed={answers.goal === value}
                        className={cn(
                          'rounded-lg border px-3.5 py-3 text-left text-sm transition-colors',
                          answers.goal === value ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:border-primary/40',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="onb-routine" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      When do you usually write?
                    </label>
                    <Select id="onb-routine" value={answers.routine} onChange={(event) => setAnswers((current) => ({ ...current, routine: event.target.value }))}>
                      <option value="mornings">Early mornings</option>
                      <option value="evenings">Evenings</option>
                      <option value="weekends">Weekends</option>
                      <option value="stolen">Stolen minutes whenever</option>
                    </Select>
                  </div>
                  <div>
                    <label htmlFor="onb-target" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Daily word target
                    </label>
                    <Select id="onb-target" value={answers.wordTarget} onChange={(event) => setAnswers((current) => ({ ...current, wordTarget: event.target.value }))}>
                      <option value="250">250 · gentle</option>
                      <option value="500">500 · steady</option>
                      <option value="1000">1,000 · serious</option>
                      <option value="2000">2,000 · drafting sprint</option>
                    </Select>
                  </div>
                </div>
                <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <Checkbox
                    checked={answers.useAI}
                    onCheckedChange={(checked) => setAnswers((current) => ({ ...current, useAI: checked }))}
                    aria-label="Use AI assistance"
                    className="mt-0.5"
                  />
                  Show AI suggestions in the editor (continue, rewrite, outline). You can turn this off at any time.
                </label>
              </>
            )}

            {step === 'first' && (
              <>
                <div>
                  <label htmlFor="onb-title" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Working title for your first book
                  </label>
                  <Input
                    id="onb-title"
                    value={answers.bookTitle}
                    onChange={(event) => setAnswers((current) => ({ ...current, bookTitle: event.target.value }))}
                    placeholder="The Ledger of Small Things"
                  />
                </div>
                <div>
                  <label htmlFor="onb-idea" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    One or two sentences about it
                  </label>
                  <Textarea
                    id="onb-idea"
                    rows={3}
                    value={answers.bookIdea}
                    onChange={(event) => setAnswers((current) => ({ ...current, bookIdea: event.target.value }))}
                    placeholder="A harbour clerk finds a ledger that records every small kindness in a town about to flood."
                  />
                  <p className="mt-1 text-2xs text-muted-foreground">
                    This becomes the starting description. You can rewrite it later, or generate a blurb with AI.
                  </p>
                </div>
                <label className="flex items-center gap-2.5 text-sm text-muted-foreground">
                  <Checkbox
                    checked={answers.createNow}
                    onCheckedChange={(checked) => setAnswers((current) => ({ ...current, createNow: checked }))}
                    aria-label="Create the project now"
                  />
                  Create the project when I finish setup
                </label>
                {answers.useAI && answers.bookIdea.trim().length > 20 && (
                  <div className="rounded-lg border border-border bg-muted/40 p-3.5">
                    <p className="text-xs font-semibold text-foreground">Want a head start?</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      The AI generator can turn this idea into an editable outline before you write a word. It costs{' '}
                      {aiService.creditCost('outline')} credits and runs from the create-book screen.
                    </p>
                    <Button size="sm" variant="outline" className="mt-3" onClick={() => navigate('/dashboard/books/new')}>
                      Open the AI generator
                    </Button>
                  </div>
                )}
              </>
            )}

            {step === 'done' && (
              <>
                <div className="rounded-lg border border-border bg-muted/40 p-4">
                  <p className="text-sm font-semibold text-foreground">Your setup summary</p>
                  <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-muted-foreground">Experience</dt>
                      <dd className="text-foreground">{answers.experience.replace('-', ' ')}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Goal</dt>
                      <dd className="text-foreground">{answers.goal.replace('-', ' ')}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Writes</dt>
                      <dd className="text-foreground">
                        {answers.genres.length ? answers.genres.map((genre) => BOOK_KIND_LABELS[genre] ?? genre).join(', ') : 'Not specified'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Daily target</dt>
                      <dd className="text-foreground">{answers.wordTarget} words</dd>
                    </div>
                  </dl>
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Three things worth doing first</p>
                  <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                    <li>· Open your project and write one paragraph. Autosave protects everything from the first keystroke.</li>
                    <li>· Browse templates for your genre if the default typography is not quite right.</li>
                    <li>· Run preflight early — it is easier to fix twenty pages than two hundred.</li>
                  </ul>
                </div>
                <div className="flex flex-wrap gap-2">
                  {['Write', 'Design', 'Preflight', 'Export', 'Publish'].map((entry) => (
                    <Badge key={entry} variant="secondary">
                      {entry}
                    </Badge>
                  ))}
                </div>
                <p className="text-2xs text-muted-foreground">
                  Prefer to explore first? The demo workspace has books in every stage, marketplace sales and an admin panel.
                </p>
              </>
            )}

            <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
              <Button variant="ghost" disabled={stepIndex === 0} onClick={() => setStep(STEPS[stepIndex - 1].id)}>
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => finish(true)}>
                  Skip
                </Button>
                {stepIndex < STEPS.length - 1 ? (
                  <Button onClick={() => setStep(STEPS[stepIndex + 1].id)}>Continue</Button>
                ) : (
                  <Button loading={busy} onClick={() => finish(false)}>
                    {answers.createNow && answers.bookTitle.trim() ? 'Create my book' : 'Open my dashboard'}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-2xs text-muted-foreground">
          Your answers are stored with your account and used to tune suggestions only. Nothing is shared.{' '}
          <button type="button" className="text-primary hover:underline" onClick={() => info('No email will be sent', 'Provider sign-up email is simulated in this build.')}>
            Why do you ask?
          </button>
        </p>
      </div>
    </>
  );
}

const STEP_TITLES: Record<string, string> = {
  you: 'Welcome',
  writing: 'How you write',
  first: 'Your first project',
  done: 'You are ready',
};

const STEP_SUBTITLES: Record<string, string> = {
  you: 'Two questions so the workspace fits how you work.',
  writing: 'A target you set is a target you can actually hit.',
  first: 'Name it now, or leave it blank and decide in the editor.',
  done: 'Everything is set up. Here is where to start.',
};
