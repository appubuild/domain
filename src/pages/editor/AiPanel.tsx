import * as React from 'react';
import {
  BookOpen, Brain, Check, Copy, Loader2, Plus, RefreshCcw, Sparkles, Trash2, Wand2, Wand2 as Wand,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Separator, Textarea } from '@/components/ui/primitives';
import { Modal, Tabs } from '@/components/ui/overlays';
import { ProgressList } from '@/components/ui/data';
import { useToast } from '@/components/ui/toast';
import { aiService, bookService, type AiAction } from '@/services';
import { useAuth } from '@/providers/AuthProvider';
import { AI_STYLES, AI_TONES } from '@/data/constants';
import { cn } from '@/lib/utils';
import type { AiBookBrief, Book, MemoryEntry } from '@/types/domain';

const ACTIONS: { action: AiAction; label: string; hint: string }[] = [
  { action: 'continue', label: 'Continue', hint: 'Extend from the cursor' },
  { action: 'rewrite', label: 'Rewrite', hint: 'Same meaning, new words' },
  { action: 'improve', label: 'Improve', hint: 'Tighter, clearer prose' },
  { action: 'simplify', label: 'Simplify', hint: 'Plain language' },
  { action: 'expand', label: 'Expand', hint: 'Add detail' },
  { action: 'shorten', label: 'Shorten', hint: 'Trim the fat' },
  { action: 'tone', label: 'Tone', hint: 'Shift the register' },
  { action: 'summarize', label: 'Summarise', hint: 'Key beats only' },
  { action: 'grammar', label: 'Grammar', hint: 'Mechanics pass' },
  { action: 'translate', label: 'Translate', hint: 'Switch language' },
  { action: 'outline', label: 'Outline', hint: 'Notes → structure' },
  { action: 'chapter', label: 'Draft chapter', hint: 'Summary → chapter' },
];

export interface AiPanelProps {
  book: Book;
  activePageContent: string;
  selectionText: string;
  onInsert: (text: string) => void;
  onReplace: (text: string) => void;
  onInsertNote: (text: string) => void;
  onChapterCreated: (sectionId: string) => void;
}

export function AiPanel({ book, activePageContent, selectionText, onInsert, onReplace, onInsertNote, onChapterCreated }: AiPanelProps) {
  const { user, entitlements } = useAuth();
  const { success, error, warning } = useToast();
  const [tab, setTab] = React.useState('assist');
  const [action, setAction] = React.useState<AiAction>('continue');
  const [instructions, setInstructions] = React.useState('');
  const [tone, setTone] = React.useState(book.theme.palette ? AI_TONES[0] : AI_TONES[0]);
  const [language, setLanguage] = React.useState('English');
  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState<{ step: string; progress: number } | null>(null);
  const [result, setResult] = React.useState<{ text: string; alternatives: string[]; credits: number; model: string; notes: string[] } | null>(null);
  const [memory, setMemory] = React.useState<MemoryEntry[]>(() => bookService.memory(book.id));
  const [memoryOpen, setMemoryOpen] = React.useState(false);
  const [newMemory, setNewMemory] = React.useState({ type: 'character' as MemoryEntry['type'], name: '', detail: '' });

  const input = selectionText || activePageContent.replace(/<[^>]+>/g, ' ').slice(-1400);

  const run = async () => {
    if (!input.trim()) {
      warning('Nothing to work with', 'Write a paragraph first, or select the text you want the assistant to work on.');
      return;
    }
    if (!entitlements.canUseAI()) {
      warning('AI credits used up', entitlements.upgradeReason('ai'));
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const response = await aiService.run(
        { action, input, tone, language, instructions: instructions || undefined, bookId: book.id },
        (event) => setProgress(event),
        user?.id,
      );
      setResult({ text: response.text, alternatives: response.alternatives, credits: response.credits, model: response.model, notes: response.notes });
      success('Draft ready', `${response.credits} credits · ${response.model}`);
    } catch (e) {
      error('Generation failed', (e as Error).message);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const refreshMemory = () => setMemory(bookService.memory(book.id));

  return (
    <div className="space-y-4">
      <Tabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: 'assist', label: 'Assist' },
          { value: 'generate', label: 'Book' },
          { value: 'memory', label: 'Memory', count: memory.length },
        ]}
        size="sm"
      />

      {tab === 'assist' && (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            {ACTIONS.map((entry) => (
              <button
                key={entry.action}
                type="button"
                onClick={() => setAction(entry.action)}
                className={cn(
                  'rounded-lg border p-2 text-left transition-colors',
                  action === entry.action ? 'border-primary bg-primary/5' : 'hover:border-primary/40',
                )}
              >
                <span className="block text-xs font-medium">{entry.label}</span>
                <span className="block text-2xs text-muted-foreground">{entry.hint}</span>
                <span className="mt-0.5 block text-2xs text-muted-foreground">{aiService.creditCost(entry.action)} cr</span>
              </button>
            ))}
          </div>
          <Separator />
          <div className="grid gap-2">
            <label className="text-xs font-medium" htmlFor="ai-panel-tone">Tone</label>
            <select id="ai-panel-tone" value={tone} onChange={(event) => setTone(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
              {AI_TONES.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
            <label className="text-xs font-medium" htmlFor="ai-panel-language">Language</label>
            <select id="ai-panel-language" value={language} onChange={(event) => setLanguage(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
              {['English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian'].map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
            <label className="text-xs font-medium" htmlFor="ai-panel-instructions">Extra instructions</label>
            <Input id="ai-panel-instructions" value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="e.g. keep the first-person voice" className="h-8 text-xs" />
          </div>
          <Button size="sm" className="w-full" onClick={run} disabled={running}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {running ? 'Generating…' : `${selectionText ? 'Rewrite selection' : 'Generate'} · ${aiService.creditCost(action)} credits`}
          </Button>
          {progress && <ProgressList items={[{ label: progress.step, value: progress.progress }]} />}
          {result && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Suggestion</CardTitle>
                <CardDescription className="text-2xs">{result.model} · {result.credits} credits</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/30 p-2 text-xs leading-relaxed" dangerouslySetInnerHTML={{ __html: result.text }} />
                <div className="grid grid-cols-2 gap-1.5">
                  <Button size="xs" onClick={() => { onInsert(result.text); success('Inserted at the cursor'); }}>
                    <Plus className="h-3 w-3" /> Insert
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => { onReplace(result.text); success('Selection replaced'); }}>
                    <RefreshCcw className="h-3 w-3" /> Replace
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => { void navigator.clipboard?.writeText(result.text.replace(/<[^>]+>/g, '')); success('Copied'); }}>
                    <Copy className="h-3 w-3" /> Copy
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => { onInsertNote(result.text); success('Saved as a note'); }}>
                    <BookOpen className="h-3 w-3" /> To notes
                  </Button>
                </div>
                {result.alternatives.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-2xs font-medium text-muted-foreground">Alternatives</p>
                    {result.alternatives.map((alternative, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => setResult({ ...result, text: alternative, alternatives: [result.text, ...result.alternatives.filter((entry) => entry !== alternative)] })}
                        className="w-full rounded-md border p-1.5 text-left text-2xs text-muted-foreground hover:border-primary/40"
                      >
                        {alternative.replace(/<[^>]+>/g, '').slice(0, 150)}…
                      </button>
                    ))}
                  </div>
                )}
                {result.notes.length > 0 && (
                  <ul className="space-y-0.5 text-2xs text-muted-foreground">
                    {result.notes.map((note) => <li key={note}>· {note}</li>)}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
          <p className="text-2xs text-muted-foreground">
            {entitlements.usage.aiCredits.used} / {entitlements.usage.aiCredits.limit} credits used this period.
          </p>
        </>
      )}

      {tab === 'generate' && <BookGenerator book={book} onChapterCreated={onChapterCreated} />}

      {tab === 'memory' && (
        <>
          <Button size="sm" variant="outline" className="w-full" onClick={() => setMemoryOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add memory entry
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={async () => {
              const suggestions = await aiService.suggestMemory(book);
              suggestions.forEach((suggestion) => bookService.addMemory(book.id, { ...suggestion, tags: ['ai-suggested'] }));
              refreshMemory();
              success(`${suggestions.length} suggestions added`, 'Review them in Book memory.');
            }}
          >
            <Wand className="h-3.5 w-3.5" /> Suggest from manuscript
          </Button>
          <Separator />
          {memory.length === 0 && <p className="text-xs text-muted-foreground">No memory entries yet. Add characters, places, facts, style rules and glossary terms so the assistant stays consistent.</p>}
          {memory.map((entry) => (
            <div key={entry.id} className="rounded-lg border p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{entry.name} <Badge variant="secondary" className="ml-1 text-2xs">{entry.type}</Badge></p>
                  <p className="text-2xs text-muted-foreground">{entry.detail}</p>
                </div>
                <Button variant="ghost" size="xs" onClick={() => { bookService.removeMemory(entry.id); refreshMemory(); }} aria-label={`Remove ${entry.name}`}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
          <Modal
            open={memoryOpen}
            onOpenChange={setMemoryOpen}
            title="Add to book memory"
            description="The assistant uses memory entries to keep names, places and rules consistent."
            footer={
              <>
                <Button variant="outline" onClick={() => setMemoryOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => {
                    if (newMemory.name.trim().length < 2) return;
                    bookService.addMemory(book.id, { ...newMemory, tags: ['manual'] });
                    refreshMemory();
                    setNewMemory({ type: 'character', name: '', detail: '' });
                    setMemoryOpen(false);
                    success('Memory updated');
                  }}
                >
                  Add entry
                </Button>
              </>
            }
          >
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="memory-type">Type</label>
                <select
                  id="memory-type"
                  value={newMemory.type}
                  onChange={(event) => setNewMemory((current) => ({ ...current, type: event.target.value as MemoryEntry['type'] }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {['character', 'location', 'timeline', 'fact', 'style', 'glossary', 'instruction'].map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="memory-name">Name</label>
                <Input id="memory-name" value={newMemory.name} onChange={(event) => setNewMemory((current) => ({ ...current, name: event.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="memory-detail">Detail</label>
                <Textarea id="memory-detail" rows={3} value={newMemory.detail} onChange={(event) => setNewMemory((current) => ({ ...current, detail: event.target.value }))} />
              </div>
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------- book generator */

function BookGenerator({ book, onChapterCreated }: { book: Book; onChapterCreated: (sectionId: string) => void }) {
  const { user, entitlements } = useAuth();
  const { success, error, warning } = useToast();
  const [brief, setBrief] = React.useState<AiBookBrief>({
    idea: `${book.title} — companion volume: a short, warm book on everyday attention and the craft of noticing.`,
    genre: 'Literary nonfiction',
    audience: 'General readers',
    language: 'English',
    tone: AI_TONES[0],
    length: 'medium',
    chapterCount: 6,
    includeIllustrations: false,
    protagonist: 'The narrator',
    setting: 'A coastal town in autumn',
    outline: [],
  });
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<{ step: string; progress: number } | null>(null);
  const [generating, setGenerating] = React.useState<{ index: number; total: number; chapter: string } | null>(null);

  const generateOutline = async () => {
    if (!entitlements.canUseAI()) {
      warning('AI credits used up', entitlements.upgradeReason('ai'));
      return;
    }
    setBusy(true);
    try {
      const outline = await aiService.generateOutline(brief, (event) => setProgress(event));
      setBrief((current) => ({ ...current, outline }));
      success('Outline ready', `${outline.length} chapters drafted for review.`);
    } catch (e) {
      error('Could not build an outline', (e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const generateAll = async () => {
    if (brief.outline.length === 0) {
      warning('Generate an outline first');
      return;
    }
    setBusy(true);
    try {
      for (let index = 0; index < brief.outline.length; index += 1) {
        const entry = brief.outline[index];
        setGenerating({ index: index + 1, total: brief.outline.length, chapter: entry.title });
        const content = await aiService.generateChapter(brief, entry.title, entry.summary, (event) => setProgress(event));
        const created = bookService.addChapter(book.id, entry.title);
        if (created?.section) {
          const pages = created.book?.pages.filter((page) => page.sectionId === created.section?.id) ?? [];
          const target = pages.find((page) => page.layout === 'flow');
          if (target) bookService.updatePage(book.id, target.id, { content });
          bookService.updateSection(book.id, created.section.id, { summary: entry.summary, aiGenerated: true, status: 'drafting' });
          onChapterCreated(created.section.id);
        }
      }
      success('Book drafted', `${brief.outline.length} chapters written. Review them in the Pages panel.`);
    } catch (e) {
      error('Generation stopped', (e as Error).message);
    } finally {
      setBusy(false);
      setGenerating(null);
      setProgress(null);
    }
  };

  const steps = aiService.generationSteps(brief);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-2 text-2xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        Multi-chapter generation writes directly into this book. A checkpoint is saved before it starts.
      </div>
      <div className="grid gap-2">
        <Input value={brief.idea} onChange={(event) => setBrief((current) => ({ ...current, idea: event.target.value }))} placeholder="Premise" className="h-8 text-xs" aria-label="Premise" />
        <Input value={brief.genre} onChange={(event) => setBrief((current) => ({ ...current, genre: event.target.value }))} placeholder="Genre" className="h-8 text-xs" aria-label="Genre" />
        <Input value={brief.setting} onChange={(event) => setBrief((current) => ({ ...current, setting: event.target.value }))} placeholder="Setting" className="h-8 text-xs" aria-label="Setting" />
        <Input value={brief.protagonist} onChange={(event) => setBrief((current) => ({ ...current, protagonist: event.target.value }))} placeholder="Protagonist" className="h-8 text-xs" aria-label="Protagonist" />
        <Input value={brief.audience} onChange={(event) => setBrief((current) => ({ ...current, audience: event.target.value }))} placeholder="Audience" className="h-8 text-xs" aria-label="Audience" />
        <label className="text-xs text-muted-foreground" htmlFor="gen-chapters">Chapters: {brief.chapterCount}</label>
        <input
          id="gen-chapters"
          type="range"
          min={3}
          max={24}
          value={brief.chapterCount}
          onChange={(event) => setBrief((current) => ({ ...current, chapterCount: Number(event.target.value) }))}
          className="accent-primary"
        />
        <label className="text-xs text-muted-foreground" htmlFor="gen-length">Length</label>
        <select
          id="gen-length"
          value={brief.length}
          onChange={(event) => setBrief((current) => ({ ...current, length: event.target.value as AiBookBrief['length'] }))}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="short">Short (under 15k words)</option>
          <option value="medium">Medium (15–40k words)</option>
          <option value="long">Long (40k+ words)</option>
        </select>
        <label className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Include illustrations</span>
          <input type="checkbox" checked={brief.includeIllustrations} onChange={(event) => setBrief((current) => ({ ...current, includeIllustrations: event.target.checked }))} className="accent-primary" />
        </label>
      </div>
      <Button size="sm" className="w-full" variant="outline" onClick={generateOutline} disabled={busy}>
        {busy && !generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />} Generate outline
      </Button>
      {progress && <ProgressList items={[{ label: progress.step, value: progress.progress }]} />}

      {brief.outline.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Outline review · {brief.outline.length} chapters</p>
          {brief.outline.map((entry, index) => (
            <div key={`${entry.title}-${index}`} className="rounded-lg border p-2">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-medium">{index + 1}. {entry.title}</p>
                <div className="flex items-center gap-0.5">
                  <Button variant="ghost" size="xs" disabled={index === 0} onClick={() => setBrief((current) => ({ ...current, outline: move(current.outline, index, index - 1) }))} aria-label="Move up">↑</Button>
                  <Button variant="ghost" size="xs" disabled={index === brief.outline.length - 1} onClick={() => setBrief((current) => ({ ...current, outline: move(current.outline, index, index + 1) }))} aria-label="Move down">↓</Button>
                  <Button variant="ghost" size="xs" onClick={() => setBrief((current) => ({ ...current, outline: current.outline.filter((_, position) => position !== index) }))} aria-label="Remove chapter">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <Textarea
                rows={2}
                value={entry.summary}
                onChange={(event) => setBrief((current) => ({ ...current, outline: current.outline.map((row, position) => (position === index ? { ...row, summary: event.target.value } : row)) }))}
                className="mt-1 text-2xs"
              />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-1.5">
            <Button size="xs" variant="outline" onClick={() => setBrief((current) => ({ ...current, outline: [...current.outline, { id: `outline_${current.outline.length + 1}_${Date.now()}`, title: `Chapter ${current.outline.length + 1}`, summary: 'Outline this chapter…', approved: false }] }))}>
              <Plus className="h-3 w-3" /> Add
            </Button>
            <Button size="xs" onClick={() => { bookService.createVersion(book.id, { id: user?.id ?? 'user_demo', name: user?.name ?? 'Author' }, 'Before AI generation', 'Checkpoint captured before generated chapters were written'); void generateAll(); }} disabled={busy}>
              {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />} Write chapters
            </Button>
          </div>
          {generating && (
            <p className="text-2xs text-muted-foreground">
              Writing {generating.index} of {generating.total}: {generating.chapter}
            </p>
          )}
          <p className="text-2xs text-muted-foreground">{steps.length} pipeline steps · {steps[0]?.label} → {steps[steps.length - 1]?.label}</p>
          <Button
            size="xs"
            variant="ghost"
            className="w-full"
            onClick={() => {
              if (!user) return;
              bookService.createVersion(book.id, { id: user.id, name: user.name }, 'Outline approved', `${brief.outline.length} chapter outline approved`);
              success('Outline approved', 'A checkpoint was saved.');
            }}
          >
            <Check className="h-3 w-3" /> Approve outline (save checkpoint)
          </Button>
        </div>
      )}
      <p className="text-2xs text-muted-foreground">{entitlements.usage.aiCredits.used} / {entitlements.usage.aiCredits.limit} credits used.</p>
    </div>
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
