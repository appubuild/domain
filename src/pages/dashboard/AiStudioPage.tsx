import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Check, Copy, Cpu, Feather, Gauge, History, Image as ImageIcon, Lightbulb, Loader2, Palette, PenLine, RotateCcw, Sparkles, Undo2, Wand2, Zap,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Separator } from '@/components/ui/primitives';
import { Modal, Tabs } from '@/components/ui/overlays';
import { DataTable, EmptyState, ProgressList, StatCard, UsageMeter, type Column } from '@/components/ui/data';
import { useToast } from '@/components/ui/toast';
import { useAiUsage, useBooks } from '@/hooks/queries';
import { aiService, bookService, type AiAction } from '@/services';
import { useAuth } from '@/providers/AuthProvider';
import { AI_STYLES, AI_TONES } from '@/data/constants';
import { formatNumber, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { AiUsageRecord } from '@/types/domain';

const WRITING_ACTIONS: { action: AiAction; label: string; description: string; icon: React.ReactNode }[] = [
  { action: 'continue', label: 'Continue writing', description: 'Extend the passage in your voice.', icon: <Feather className="h-4 w-4" /> },
  { action: 'rewrite', label: 'Rewrite', description: 'Same meaning, fresh phrasing.', icon: <RotateCcw className="h-4 w-4" /> },
  { action: 'improve', label: 'Improve prose', description: 'Tighten rhythm and word choice.', icon: <Sparkles className="h-4 w-4" /> },
  { action: 'simplify', label: 'Simplify', description: 'Plain language, shorter sentences.', icon: <Lightbulb className="h-4 w-4" /> },
  { action: 'expand', label: 'Expand', description: 'Add sensory and structural detail.', icon: <Gauge className="h-4 w-4" /> },
  { action: 'shorten', label: 'Shorten', description: 'Trim without losing meaning.', icon: <Undo2 className="h-4 w-4" /> },
  { action: 'tone', label: 'Change tone', description: 'Rewrite for a different register.', icon: <Palette className="h-4 w-4" /> },
  { action: 'summarize', label: 'Summarise', description: 'Condense into key beats.', icon: <Zap className="h-4 w-4" /> },
  { action: 'grammar', label: 'Fix grammar', description: 'Correct mechanics and punctuation.', icon: <Check className="h-4 w-4" /> },
  { action: 'translate', label: 'Translate', description: 'Move the passage into another language.', icon: <Cpu className="h-4 w-4" /> },
  { action: 'outline', label: 'Outline', description: 'Turn notes into a chapter outline.', icon: <PenLine className="h-4 w-4" /> },
  { action: 'chapter', label: 'Draft chapter', description: 'Write a full chapter from a summary.', icon: <Wand2 className="h-4 w-4" /> },
];

const SAMPLE =
  'The harbour was quiet the morning my grandmother handed me the ledger. Gulls argued over the fish crates, and the tide pulled at the mooring ropes as if it had somewhere better to be.';

export default function AiStudioPage() {
  const { user, entitlements } = useAuth();
  const { success, error, warning } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: usage, isLoading } = useAiUsage(user?.id);
  const { data: books } = useBooks({ ownerId: user?.id, status: 'all' });
  const [tab, setTab] = React.useState('write');
  const [action, setAction] = React.useState<AiAction>('continue');
  const [input, setInput] = React.useState(SAMPLE);
  const [instructions, setInstructions] = React.useState('');
  const [tone, setTone] = React.useState(AI_TONES[0]);
  const [language, setLanguage] = React.useState('English');
  const [bookId, setBookId] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState<{ step: string; progress: number } | null>(null);
  const [result, setResult] = React.useState<{ text: string; alternatives: string[]; credits: number; model: string; tokens: number; latencyMs: number; notes: string[] } | null>(null);
  const [proofOpen, setProofOpen] = React.useState(false);
  const [proofBusy, setProofBusy] = React.useState(false);
  const [proof, setProof] = React.useState<Awaited<ReturnType<typeof aiService.proofread>> | null>(null);
  const [memoryOpen, setMemoryOpen] = React.useState(false);
  const [memoryBusy, setMemoryBusy] = React.useState(false);
  const [memorySuggestions, setMemorySuggestions] = React.useState<Awaited<ReturnType<typeof aiService.suggestMemory>>>([]);

  const selectedBook = (books ?? []).find((book) => book.id === bookId);
  const creditsUsed = usage?.reduce((total, record) => total + record.credits, 0) ?? 0;

  const run = async () => {
    if (!input.trim()) {
      warning('Add some text first', 'Paste or type the passage you want the assistant to work on.');
      return;
    }
    if (!entitlements.canUseAI()) {
      warning('AI limits reached', entitlements.upgradeReason('ai'));
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const response = await aiService.run(
        { action, input, tone, language, instructions: instructions || undefined, bookId: bookId || undefined },
        (event) => setProgress(event),
        user?.id,
      );
      setResult(response);
      qc.invalidateQueries({ queryKey: ['ai-usage'] });
      success('Draft ready', `${response.credits} credits · ${response.model}`);
    } catch (e) {
      error('Generation failed', (e as Error).message);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const columns: Column<AiUsageRecord & { id: string }>[] = [
    { key: 'feature', header: 'Action', render: (row) => <span className="text-sm font-medium capitalize">{row.feature}</span> },
    { key: 'model', header: 'Model', width: '140px', render: (row) => <Badge variant="outline">{row.model}</Badge> },
    { key: 'credits', header: 'Credits', width: '90px', align: 'right', render: (row) => formatNumber(row.credits) },
    { key: 'tokens', header: 'Tokens', width: '100px', align: 'right', render: (row) => formatNumber(row.tokens) },
    { key: 'created', header: 'When', width: '140px', render: (row) => <span className="text-xs text-muted-foreground">{timeAgo(row.createdAt)}</span> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">AI Studio</h1>
          <p className="text-sm text-muted-foreground">Draft, refine, illustrate and proofread — always with you in the loop.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setProofOpen(true)}>
            <Check className="h-4 w-4" /> Proofread a passage
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMemoryOpen(true)} disabled={!selectedBook}>
            <Lightbulb className="h-4 w-4" /> Suggest book memory
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Credits used" value={formatNumber(creditsUsed)} hint={`${formatNumber(usage?.length ?? 0)} generations this period`} icon={<Zap className="h-4 w-4" />} />
        <StatCard label="Text credits left" value={formatNumber(entitlements.usage.aiCredits.limit - entitlements.usage.aiCredits.used)} hint={`of ${formatNumber(entitlements.usage.aiCredits.limit)} on ${entitlements.plan.name}`} icon={<Sparkles className="h-4 w-4" />} tone={entitlements.usage.aiCredits.percent > 85 ? 'warning' : 'default'} onClick={() => navigate('/dashboard/subscription')} />
        <StatCard label="Image credits left" value={formatNumber(entitlements.usage.aiImages.limit - entitlements.usage.aiImages.used)} hint={`of ${formatNumber(entitlements.usage.aiImages.limit)}`} icon={<ImageIcon className="h-4 w-4" />} />
        <StatCard label="Book memory" value={formatNumber((books ?? []).reduce((total, book) => total + book.pages.length, 0) > 0 ? (books ?? []).length : 0)} hint="Books with AI context available" icon={<Cpu className="h-4 w-4" />} />
      </div>

      <UsageMeter
        label="AI credits"
        used={entitlements.usage.aiCredits.used}
        limit={entitlements.usage.aiCredits.limit}
        tone={entitlements.usage.aiCredits.percent > 85 ? 'warning' : 'primary'}
        action={<Button variant="outline" size="xs" onClick={() => navigate('/dashboard/subscription')}>Upgrade</Button>}
      />

      <Tabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: 'write', label: 'Writing assistant' },
          { value: 'image', label: 'Image studio' },
          { value: 'history', label: 'History', count: usage?.length },
        ]}
      />

      {tab === 'write' && (
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What should the assistant do?</CardTitle>
              <CardDescription>Pick an action, give it context, then insert the result into your manuscript.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {WRITING_ACTIONS.map((entry) => (
                  <button
                    key={entry.action}
                    type="button"
                    onClick={() => setAction(entry.action)}
                    className={cn('rounded-lg border p-2.5 text-left transition-colors', action === entry.action ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-primary/40')}
                  >
                    <span className="flex items-center gap-1.5 text-muted-foreground">{entry.icon}<span className="text-xs font-medium text-foreground">{entry.label}</span></span>
                    <span className="mt-1 block text-2xs text-muted-foreground">{entry.description}</span>
                    <span className="mt-1 block text-2xs text-muted-foreground">{aiService.creditCost(entry.action)} credits</span>
                  </button>
                ))}
              </div>
              <Separator />
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="ai-input">Passage</label>
                <textarea
                  id="ai-input"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  rows={6}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <p className="text-xs text-muted-foreground">{input.trim().split(/\s+/).filter(Boolean).length} words</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="ai-tone">Tone</label>
                  <select id="ai-tone" value={tone} onChange={(event) => setTone(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                    {AI_TONES.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="ai-language">Language</label>
                  <select id="ai-language" value={language} onChange={(event) => setLanguage(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                    {['English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian'].map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-sm font-medium" htmlFor="ai-book">Use book context (memory + style guide)</label>
                  <select id="ai-book" value={bookId} onChange={(event) => setBookId(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="">No book context</option>
                    {(books ?? []).map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-sm font-medium" htmlFor="ai-instructions">Custom instructions</label>
                  <input
                    id="ai-instructions"
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                    placeholder="e.g. keep sentences under 20 words, avoid adverbs"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={run} disabled={running}>
                  {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {running ? 'Generating…' : `Generate · ${aiService.creditCost(action)} credits`}
                </Button>
                <Button variant="outline" onClick={() => { setInput(SAMPLE); setResult(null); }}>Reset sample</Button>
                <span className="text-xs text-muted-foreground">Model: {aiService.modelFor(action)}</span>
              </div>
              {progress && <ProgressList items={[{ label: progress.step, value: progress.progress }]} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Result</CardTitle>
                <CardDescription>{result ? `${result.credits} credits · ${formatNumber(result.tokens)} tokens · ${result.latencyMs} ms` : 'Generated text appears here.'}</CardDescription>
              </div>
              {result && (
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="xs" onClick={() => { void navigator.clipboard?.writeText(result.text); success('Copied to clipboard'); }}>
                    <Copy className="h-3 w-3" /> Copy
                  </Button>
                  <Button variant="outline" size="xs" onClick={() => { setInput(result.text); success('Replaced the passage with the result'); }}>
                    <Undo2 className="h-3 w-3" /> Replace
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {!result && !running && (
                <EmptyState
                  icon={<Sparkles className="h-5 w-5" />}
                  title="Nothing generated yet"
                  description="Choose an action and generate a draft. You can insert it into your book from the editor’s AI panel."
                />
              )}
              {result && (
                <>
                  <div className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed">{result.text}</div>
                  {result.notes.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium">Assistant notes</p>
                      {result.notes.map((note) => (
                        <p key={note} className="flex items-start gap-1.5 text-xs text-muted-foreground"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {note}</p>
                      ))}
                    </div>
                  )}
                  {result.alternatives.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium">Alternatives</p>
                      {result.alternatives.map((alternative, index) => (
                        <div key={index} className="rounded-lg border p-3 text-xs">
                          <p className="text-muted-foreground">{alternative}</p>
                          <div className="mt-2 flex gap-1.5">
                            <Button variant="ghost" size="xs" onClick={() => setResult({ ...result, text: alternative, alternatives: [result.text, ...result.alternatives.filter((entry) => entry !== alternative)] })}>Use this</Button>
                            <Button variant="ghost" size="xs" onClick={() => { void navigator.clipboard?.writeText(alternative); success('Copied'); }}><Copy className="h-3 w-3" /></Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">Insert into your manuscript</p>
                    <p className="mt-1">The editor’s AI panel can insert this at the cursor, replace a selection, or save it as a note. Generation is simulated with the mock provider — swap in a real model in Phase 5.</p>
                    <Button variant="outline" size="xs" className="mt-2" onClick={() => navigate(selectedBook ? `/dashboard/books/${selectedBook.id}/editor` : '/dashboard/books')}>
                      Open editor
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'image' && <ImageStudio />}

      {tab === 'history' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generation history</CardTitle>
            <CardDescription>Every AI action recorded against your account this period.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading && <div className="h-40 animate-pulse rounded-lg bg-muted" />}
            {!isLoading && (usage ?? []).length === 0 && (
              <EmptyState icon={<History className="h-5 w-5" />} title="No generations yet" description="Run your first AI action and it will be tracked here with credits and token usage." />
            )}
            {!isLoading && (usage ?? []).length > 0 && (
              <DataTable columns={columns} rows={(usage ?? []).map((record) => ({ ...record, id: record.id }))} rowKey={(row) => row.id} dense />
            )}
          </CardContent>
        </Card>
      )}

      <Modal
        open={proofOpen}
        onOpenChange={setProofOpen}
        title="Proofread"
        description="Grammar, style and consistency checks against your book’s style guide."
        size="lg"
        footer={<Button variant="outline" onClick={() => setProofOpen(false)}>Close</Button>}
      >
        <div className="space-y-4">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            rows={5}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            aria-label="Text to proofread"
          />
          <Button
            onClick={async () => {
              setProofBusy(true);
              try {
                setProof(await aiService.proofread(input));
              } finally {
                setProofBusy(false);
              }
            }}
            disabled={proofBusy}
          >
            {proofBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Run proofread
          </Button>
          {proof && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Badge variant={proof.score > 90 ? 'success' : proof.score > 75 ? 'warning' : 'danger'}>Score {proof.score}</Badge>
                <span className="text-xs text-muted-foreground">{proof.issues.length} issues found</span>
              </div>
              <div className="space-y-2">
                {proof.issues.map((issue, index) => (
                  <div key={index} className="flex items-center justify-between gap-2 rounded-lg border p-3 text-xs">
                    <p className="text-muted-foreground">{issue}</p>
                    <Button variant="ghost" size="xs" onClick={() => { setInput(proof.corrected); success('Applied correction to the passage'); }}>Apply fix</Button>
                  </div>
                ))}
                {proof.issues.length === 0 && <p className="text-sm text-emerald-600 dark:text-emerald-400">No issues found — this passage reads cleanly.</p>}
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">{proof.corrected}</div>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={memoryOpen}
        onOpenChange={setMemoryOpen}
        title="Book memory suggestions"
        description="Characters, locations and facts the assistant noticed. Approve them to add to the book’s memory."
        size="lg"
        footer={<Button variant="outline" onClick={() => setMemoryOpen(false)}>Close</Button>}
      >
        <div className="space-y-4">
          <Button
            onClick={async () => {
              if (!selectedBook) return;
              setMemoryBusy(true);
              try {
                const suggestions = await aiService.suggestMemory(selectedBook);
                setMemorySuggestions(suggestions);
              } finally {
                setMemoryBusy(false);
              }
            }}
            disabled={memoryBusy || !selectedBook}
          >
            {memoryBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lightbulb className="h-4 w-4" />} Scan {selectedBook?.title ?? 'book'}
          </Button>
          {memorySuggestions.length === 0 && <p className="text-sm text-muted-foreground">Choose a book above, then scan to surface characters, locations and recurring facts.</p>}
          {memorySuggestions.map((suggestion) => (
            <div key={`${suggestion.type}-${suggestion.name}`} className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">{suggestion.name} <Badge variant="secondary" className="ml-1 text-2xs">{suggestion.type}</Badge></p>
                <p className="text-xs text-muted-foreground">{suggestion.detail}</p>
              </div>
              <Button
                variant="outline"
                size="xs"
                onClick={() => {
                  if (!selectedBook) return;
                  bookService.addMemory(selectedBook.id, { ...suggestion, tags: ['ai-suggested'] });
                  success(`${suggestion.name} added to book memory`);
                }}
              >
                Add
              </Button>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function ImageStudio() {
  const { user, entitlements } = useAuth();
  const { success, error, warning } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: books } = useBooks({ ownerId: user?.id, status: 'all' });
  const [prompt, setPrompt] = React.useState('A quiet harbour at dawn, muted teal and sand, textured gouache');
  const [style, setStyle] = React.useState(AI_STYLES[0]);
  const [aspect, setAspect] = React.useState<'square' | 'portrait' | 'landscape'>('portrait');
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<{ step: string; progress: number } | null>(null);
  const [images, setImages] = React.useState<{ url: string; prompt: string; credits: number }[]>([]);
  const [coverBookId, setCoverBookId] = React.useState('');
  const [concepts, setConcepts] = React.useState<{ id: string; url: string; label: string; paletteId: string }[]>([]);
  const [coverBusy, setCoverBusy] = React.useState(false);

  const generate = async () => {
    if (!user || prompt.trim().length < 6) return;
    if (!entitlements.canUseAiImages()) {
      warning('AI images are a Pro feature', 'Upgrade to generate illustrations.');
      return;
    }
    setBusy(true);
    try {
      const result = await aiService.generateImage({ prompt, style, userId: user.id, aspect }, (event) => setProgress(event));
      setImages((current) => [{ url: result.url, prompt, credits: result.credits }, ...current].slice(0, 6));
      qc.invalidateQueries({ queryKey: ['ai-usage'] });
      success('Image generated', `${result.credits} credits used`);
    } catch (e) {
      error('Generation failed', (e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const coverBook = (books ?? []).find((book) => book.id === coverBookId);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Illustration studio</CardTitle>
          <CardDescription>Generate images sized for your trim, then drop them straight into a page.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="studio-prompt">Prompt</label>
            <textarea id="studio-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="studio-style">Style</label>
              <select id="studio-style" value={style} onChange={(event) => setStyle(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                {AI_STYLES.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="studio-aspect">Aspect</label>
              <select id="studio-aspect" value={aspect} onChange={(event) => setAspect(event.target.value as typeof aspect)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="portrait">Portrait (page)</option>
                <option value="square">Square (social)</option>
                <option value="landscape">Landscape (spread)</option>
              </select>
            </div>
          </div>
          <Button onClick={generate} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />} Generate image
          </Button>
          {progress && <ProgressList items={[{ label: progress.step, value: progress.progress }]} />}
          <Separator />
          <div className="space-y-2">
            <p className="text-sm font-medium">Cover concepts</p>
            <p className="text-xs text-muted-foreground">Generate four cover directions for a book, then apply one in the cover designer.</p>
            <select value={coverBookId} onChange={(event) => setCoverBookId(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" aria-label="Book for cover concepts">
              <option value="">Select a book…</option>
              {(books ?? []).map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}
            </select>
            <Button
              variant="outline"
              disabled={!coverBook || coverBusy}
              onClick={async () => {
                if (!coverBook) return;
                if (!entitlements.canGenerateCover()) {
                  warning('Cover generation requires Pro', entitlements.upgradeReason('ai'));
                  return;
                }
                setCoverBusy(true);
                try {
                  setConcepts(await aiService.coverConcepts(coverBook.title, coverBook.authorName, AI_STYLES[0]));
                  success('Cover concepts ready');
                } finally {
                  setCoverBusy(false);
                }
              }}
            >
              {coverBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Palette className="h-4 w-4" />} Generate cover concepts
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Results</CardTitle>
          <CardDescription>{images.length} image{images.length === 1 ? '' : 's'} in this session</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {images.length === 0 && <EmptyState icon={<ImageIcon className="h-5 w-5" />} title="No images yet" description="Generated images appear here and are saved to your asset library." />}
          <div className="grid gap-3 sm:grid-cols-2">
            {images.map((image, index) => (
              <div key={index} className="overflow-hidden rounded-lg border">
                <img src={image.url} alt={image.prompt} className="h-40 w-full object-cover" />
                <div className="space-y-1.5 p-2">
                  <p className="line-clamp-2 text-xs text-muted-foreground">{image.prompt}</p>
                  <p className="text-2xs text-muted-foreground">{image.credits} credits</p>
                </div>
              </div>
            ))}
          </div>
          {concepts.length > 0 && (
            <>
              <Separator />
              <p className="text-sm font-medium">Cover concepts for {coverBook?.title}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {concepts.map((concept) => (
                  <button
                    key={concept.id}
                    type="button"
                    className="overflow-hidden rounded-lg border text-left transition-colors hover:border-primary"
                    onClick={() => {
                      if (!coverBook) return;
                      bookService.generateCoverArt(coverBook.id, concept.paletteId, 0);
                      qc.invalidateQueries({ queryKey: ['book', coverBook.id] });
                      success('Cover art applied', concept.label);
                      navigate(`/dashboard/books/${coverBook.id}/editor?mode=cover`);
                    }}
                  >
                    <img src={concept.url} alt={concept.label} className="h-32 w-full object-cover" />
                    <p className="p-1.5 text-2xs">{concept.label}</p>
                  </button>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
