import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Seo } from '@/components/shared/Seo';
import { Section, SectionHeading, CtaBand, BreadcrumbBar } from '@/components/shared/sections';
import { Badge, Button, Card, CardContent, Textarea } from '@/components/ui/primitives';
import { ProgressList } from '@/components/ui/data';
import { aiService } from '@/services';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/providers/AuthProvider';
import type { AiAction } from '@/services/aiService';
import { cn } from '@/lib/utils';

const ACTION_GROUPS: { title: string; description: string; actions: { action: AiAction; label: string; body: string }[] }[] = [
  {
    title: 'Write',
    description: 'Keep momentum when the next sentence is not obvious.',
    actions: [
      { action: 'continue', label: 'Continue', body: 'Pick up from the last line in your voice, matching tense and POV.' },
      { action: 'expand', label: 'Expand', body: 'Turn a sketch into a full page with sensory detail and interiority.' },
      { action: 'chapter', label: 'Draft chapter', body: 'Generate a chapter from a beat list and your book knowledge panel.' },
      { action: 'outline', label: 'Outline', body: 'Build a chapter-and-scene outline from your premise and genre.' },
    ],
  },
  {
    title: 'Revise',
    description: 'Four passes that authors actually use, in the order they use them.',
    actions: [
      { action: 'rewrite', label: 'Rewrite', body: 'Re-work the selection with instructions — tighten, warm up, de-jargon.' },
      { action: 'improve', label: 'Improve prose', body: 'Vary rhythm, split long sentences, cut filler.' },
      { action: 'simplify', label: 'Simplify', body: 'Reduce reading level while preserving meaning.' },
      { action: 'shorten', label: 'Shorten', body: 'Cut a passage to a target word count without losing the beat.' },
      { action: 'tone', label: 'Change tone', body: 'Warm, literary, clinical, playful, formal or plain.' },
      { action: 'grammar', label: 'Grammar pass', body: 'Consistency, punctuation and agreement corrections.' },
    ],
  },
  {
    title: 'Package',
    description: 'Everything the store page needs, generated from the book itself.',
    actions: [
      { action: 'title', label: 'Titles', body: 'Ten title options with your genre conventions in mind.' },
      { action: 'subtitle', label: 'Subtitle', body: 'A subtitle that does the selling work.' },
      { action: 'blurb', label: 'Blurb', body: 'Back-cover copy plus a short marketplace description.' },
      { action: 'description', label: 'Description', body: 'Long-form product description with structure.' },
      { action: 'keywords', label: 'Keywords', body: 'Marketplace keywords and category suggestions.' },
      { action: 'translate', label: 'Translate', body: 'Translate a passage with terminology locking.' },
    ],
  },
  {
    title: 'Characters & story bible',
    description: 'AI that knows who is in the room.',
    actions: [
      { action: 'character', label: 'Character profile', body: 'Draft a character with a want, a flaw and a contradiction.' },
      { action: 'dialogue', label: 'Dialogue', body: 'Write a scene of dialogue between two named characters.' },
      { action: 'summarize', label: 'Summarise', body: 'Chapter summaries that feed the timeline and TOC.' },
    ],
  },
];

export default function AiWritingPage() {
  const navigate = useNavigate();
  const [demoAction, setDemoAction] = React.useState<AiAction>('continue');
  const [prompt, setPrompt] = React.useState(
    'The morning the ledger arrived, Hana was already awake, watching the harbour turn from charcoal to grey.',
  );
  const [output, setOutput] = React.useState('');
  const [steps, setSteps] = React.useState<{ id: string; label: string; detail: string; status: 'pending' | 'active' | 'done' }[]>([]);
  const [running, setRunning] = React.useState(false);
  const { success, error, info } = useToast();
  const { userId } = useAuth();

  const run = async () => {
    setRunning(true);
    setOutput('');
    const plan = ['Reading book context', 'Loading style rules', 'Drafting suggestion', 'Checking consistency'];
    setSteps(plan.map((label, index) => ({ id: `step_${index}`, label, detail: index === 0 ? 'Working…' : 'Queued', status: index === 0 ? 'active' : 'pending' })));
    try {
      const response = await aiService.run({ action: demoAction, input: prompt, instructions: 'keep the voice plain and concrete' }, (progress) => {
        const index = Math.max(0, Math.min(plan.length - 1, Math.round((progress.progress / 92) * plan.length) - 1));
        setSteps(
          plan.map((label, stepIndex) => ({
            id: `step_${stepIndex}`,
            label,
            detail: stepIndex < index ? 'Complete' : stepIndex === index ? `${progress.step}…` : 'Queued',
            status: stepIndex < index ? 'done' : stepIndex === index ? 'active' : 'pending',
          })),
        );
      }, userId ?? undefined);
      setOutput(response.text);
      setSteps((current) => current.map((step) => ({ ...step, status: 'done', detail: 'Complete' })));
    } catch {
      error('The AI provider did not respond', 'Try again — no credits were spent.');
    } finally {
      setRunning(false);
    }
  };

  const cost = aiService.creditCost(demoAction);

  return (
    <>
      <Seo
        title="AI writing — assistance that reads your whole book"
        description="Continue, rewrite, expand, outline, translate and illustrate with AI that is grounded in your outline, characters, timeline and style rules."
        canonical="/ai-writing"
        keywords={['AI writing assistant', 'AI book outline', 'AI for authors']}
      />
      <section className="border-b border-border bg-muted/40 py-12">
        <div className="container">
          <BreadcrumbBar items={[{ label: 'Home', href: '/' }, { label: 'AI writing' }]} />
          <SectionHeading
            eyebrow="AI writing"
            title="An assistant with book context, not a text generator"
            description="Scriptora AI reads your outline, characters, timeline, glossary and style instructions before it writes a word. Try a real request below — it runs against the same action layer the editor uses."
            align="left"
          />
        </div>
      </section>

      <Section>
        <div className="grid gap-6 lg:grid-cols-[1.05fr_1fr]">
          <Card>
            <CardContent className="space-y-4">
              <div>
                <label htmlFor="ai-action" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Action
                </label>
                <select
                  id="ai-action"
                  value={demoAction}
                  onChange={(event) => setDemoAction(event.target.value as AiAction)}
                  className="mt-1.5 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground"
                >
                  {ACTION_GROUPS.map((group) => (
                    <optgroup key={group.title} label={group.title}>
                      {group.actions.map((entry) => (
                        <option key={entry.action} value={entry.action}>
                          {entry.label} · {aiService.creditCost(entry.action)} credits · {aiService.modelFor(entry.action)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="ai-input" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Selection
                </label>
                <Textarea id="ai-input" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={6} className="mt-1.5" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Costs <span className="font-semibold text-foreground">{cost} credits</span> · {aiService.modelFor(demoAction)}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPrompt('')}>
                    Clear
                  </Button>
                  <Button size="sm" onClick={run} loading={running}>
                    {running ? 'Generating…' : 'Run in the browser'}
                  </Button>
                </div>
              </div>
              {steps.length > 0 && (
                <ProgressList
                  items={steps.map((step, index) => ({
                    label: step.label,
                    value: step.status === 'done' ? 100 : step.status === 'active' ? 55 : index * 5,
                    hint: step.detail,
                  }))}
                />
              )}
            </CardContent>
          </Card>
          <div className="space-y-4">
            <Card className="h-full">
              <CardContent className="flex h-full flex-col">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-foreground">Suggestion</p>
                  {output && <Badge variant="success">Ready</Badge>}
                </div>
                <div className="min-h-[200px] flex-1 whitespace-pre-line rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm leading-relaxed text-foreground">
                  {output || 'Run an action to see a suggestion. In the editor you can insert it, replace your selection, or copy it.'}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" disabled={!output} onClick={() => success('Inserted into the draft', 'Open the editor to see it in context.')}>
                    Insert
                  </Button>
                  <Button size="sm" variant="outline" disabled={!output} onClick={() => info('Selection replaced', 'Undo with Ctrl+Z if you change your mind.')}>
                    Replace
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!output}
                    onClick={() => {
                      void navigator.clipboard?.writeText(output);
                      success('Copied to clipboard');
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <p className="text-sm font-semibold text-foreground">Book knowledge panel</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Every AI call is grounded in these six stores, editable per book:
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {['Characters', 'Locations', 'Timeline', 'Facts', 'Glossary', 'Style rules'].map((entry) => (
                    <span key={entry} className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-foreground">
                      {entry}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </Section>

      {ACTION_GROUPS.map((group, index) => (
        <Section key={group.title} tone={index % 2 === 0 ? 'muted' : 'default'}>
          <SectionHeading eyebrow="AI actions" title={group.title} description={group.description} />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.actions.map((entry) => (
              <Card key={entry.action} className={cn('transition-shadow hover:shadow-card')}>
                <CardContent>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{entry.label}</p>
                    <Badge variant="outline">{aiService.creditCost(entry.action)} cr</Badge>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{entry.body}</p>
                  <p className="mt-2 text-2xs text-muted-foreground">{aiService.modelFor(entry.action)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </Section>
      ))}

      <Section tone="paper">
        <SectionHeading eyebrow="Guardrails" title="How we keep AI from costing you your voice" description="Three deliberate product decisions, plus the generator wizard." />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {([
            ['Nothing is auto-applied', 'Every suggestion is insert, replace or copy. Scriptora never edits your manuscript without you.'],
            ['Credits shown up front', 'Each action declares its credit cost and model before it runs. No surprise spend.'],
            ['Context, not guesswork', 'Calls include your outline, characters, timeline and style rules — not just the paragraph.'],
            ['Editable outlines', 'The generator wizard produces an outline you can edit or delete before a single chapter is written.'],
          ] as const).map(([title, body]) => (
            <Card key={title}>
              <CardContent>
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button onClick={() => navigate('/dashboard/ai')}>Open AI Studio</Button>
          <Button variant="outline" onClick={() => navigate('/pricing')}>
            Compare AI credits
          </Button>
        </div>
        <p className="mx-auto mt-4 max-w-2xl text-center text-xs text-muted-foreground">
          This build ships a deterministic mock AI provider so you can exercise every flow without keys or spend. The execution layer is a single module:
          point it at a real provider and every panel above keeps working, including credits and usage metering.
        </p>
      </Section>

      <Section>
        <CtaBand
          title="Give the assistant a book to read"
          description="Create a project and the knowledge panel starts empty — it fills itself as you write, or you can seed it during onboarding."
        />
      </Section>
    </>
  );
}
