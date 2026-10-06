import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import { useTemplates, useTemplateCategories } from '@/hooks/queries';
import { aiService, bookService, templateService } from '@/services';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/overlays';
import { Seo } from '@/components/shared/Seo';
import { PageHeader } from '@/components/layout/AdminLayout';
import { Badge, Button, Card, CardContent, Checkbox, Input, Progress, Select, Slider, Skeleton, Textarea } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/overlays';
import { ProgressList } from '@/components/ui/data';
import { BOOK_KINDS, FONTS, LANGUAGES, PAGE_PALETTES, TRIM_SIZES } from '@/data/constants';
import { cn } from '@/lib/utils';
import type { AiBookBrief, BookKind, Template } from '@/types/domain';
import { BOOK_KIND_LABELS } from '@/lib/format';

type Source = 'blank' | 'template' | 'ai' | 'import';

const SOURCES: { id: Source; label: string; icon: string; description: string; bullets: string[] }[] = [
  {
    id: 'blank',
    label: 'Blank book',
    icon: '▱',
    description: 'Start from an empty project with sensible defaults you can change at any time.',
    bullets: ['Chapter 1 and 2 pre-created', 'Front matter and TOC enabled', 'Your theme applied to every page'],
  },
  {
    id: 'template',
    label: 'From a template',
    icon: '▦',
    description: 'Pick a designed interior with the right trim size and typography for your genre.',
    bullets: ['22 professional templates', 'Correct print geometry included', 'Swap typography later without redesigning'],
  },
  {
    id: 'ai',
    label: 'AI book generator',
    icon: '✦',
    description: 'Describe your idea and let Scriptora draft an editable outline, then generate chapters.',
    bullets: ['Editable outline before writing', 'Chapter-by-chapter generation', 'Book memory seeded automatically'],
  },
  {
    id: 'import',
    label: 'Import a manuscript',
    icon: '⇧',
    description: 'Bring in DOCX, HTML, EPUB or plain text and Scriptora rebuilds the chapter structure.',
    bullets: ['DOCX, HTML, EPUB and TXT', 'Chapter detection', 'Typography applied on import'],
  },
];

const DEFAULT_FORM = {
  title: '',
  subtitle: '',
  author: '',
  description: '',
  kind: 'fiction' as BookKind,
  language: 'en',
  trimSizeId: '6x9',
  orientation: 'portrait' as 'portrait' | 'landscape',
  margins: { top: 0.75, right: 0.6, bottom: 0.75, left: 0.6 },
  gutter: 0.5,
  bleed: 0,
  headingFont: FONTS.headings[0],
  bodyFont: FONTS.body[0],
  palette: PAGE_PALETTES[0]?.id ?? 'ink',
  theme: 'light' as 'light' | 'dark' | 'warm' | 'classic',
};

export default function CreateBookPage() {
  const navigate = useNavigate();
  const { user, entitlements } = useAuth();
  const { success, error: errorToast, info } = useToast();
  const confirm = useConfirm();

  const [source, setSource] = React.useState<Source>('blank');
  const [step, setStep] = React.useState<'choose' | 'configure'>('choose');
  const [form, setForm] = React.useState({ ...DEFAULT_FORM, author: user?.name ?? '' });
  const [templateId, setTemplateId] = React.useState<string | null>(null);
  const [templateQuery, setTemplateQuery] = React.useState('');
  const [templateCategory, setTemplateCategory] = React.useState('all');
  const [importFile, setImportFile] = React.useState<File | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [previewTemplate, setPreviewTemplate] = React.useState<Template | null>(null);

  const [brief, setBrief] = React.useState<AiBookBrief>({
    idea: '',
    genre: 'Literary fiction',
    audience: 'Adult general readers',
    language: 'English',
    tone: 'Warm and literary',
    length: 'medium',
    chapterCount: 12,
    includeIllustrations: false,
    protagonist: '',
    setting: '',
    outline: [],
  });
  const [outlineBusy, setOutlineBusy] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [genProgress, setGenProgress] = React.useState<{ step: string; progress: number }>({ step: '', progress: 0 });
  const [genSteps, setGenSteps] = React.useState<{ label: string; value: number; hint?: string }[]>([]);

  const { data: templates, isLoading: templatesLoading } = useTemplates({
    published: true,
    query: templateQuery || undefined,
    categoryIds: templateCategory === 'all' ? undefined : [templateCategory],
    sort: 'popular',
  });
  const { data: categories } = useTemplateCategories();

  const restrictedTemplate = previewTemplate?.premium && !entitlements.canUsePremiumTemplates;

  const chooseSource = (id: Source) => {
    if (!entitlements.canCreateBook()) {
      errorToast('You have reached your book limit', entitlements.upgradeReason('book'));
      navigate('/dashboard/subscription');
      return;
    }
    setSource(id);
    setStep('configure');
  };

  const generateOutline = async () => {
    if (!brief.idea.trim()) {
      errorToast('Describe the idea first', 'One or two sentences is enough for a useful outline.');
      return;
    }
    setOutlineBusy(true);
    try {
      const outline = await aiService.generateOutline(brief, (progress) => setGenProgress(progress));
      setBrief((current) => ({ ...current, outline: outline.map((entry) => ({ ...entry, approved: true })) }));
      success('Outline generated', `${outline.length} chapters drafted. Edit or remove any of them before generating.`);
    } catch {
      errorToast('Outline generation failed', 'No credits were spent. Try again.');
    } finally {
      setOutlineBusy(false);
      setGenProgress({ step: '', progress: 0 });
    }
  };

  const create = async () => {
    if (!user) return;
    if (!form.title.trim()) {
      errorToast('Your book needs a title', 'You can rename it later, but a working title helps.');
      return;
    }
    if (source === 'blank' || source === 'ai') {
      if (!entitlements.canCreateBook()) {
        errorToast('Book limit reached', entitlements.upgradeReason('book'));
        return;
      }
    }
    setCreating(true);
    try {
      if (source === 'template' && templateId) {
        const template = (templates ?? []).find((entry) => entry.id === templateId);
        if (template?.premium && !entitlements.canUsePremiumTemplates) {
          errorToast('Premium template', 'Upgrade to Pro to use premium interiors.');
          navigate('/dashboard/subscription');
          return;
        }
        const { book } = await templateService.use(templateId, user.id, form.author || user.name, form.title.trim());
        success('Book created from template', `“${book.title}” is ready in the editor.`);
        navigate(`/dashboard/books/${book.id}/editor`);
        return;
      }

      if (source === 'import' && importFile) {
        const { book, detected } = await bookService.importDocument(importFile, user.id, form.author || user.name, form.title.trim());
        success(
          'Manuscript imported',
          detected.parsed
            ? `${detected.chapters} chapters detected and rebuilt from the file.`
            : `We could not parse ${detected.fileName} in the browser, so a ${detected.chapters}-chapter structure was simulated for this demo.`,
        );
        navigate(`/dashboard/books/${book.id}/editor`);
        return;
      }

      if (source === 'import' && !importFile) {
        errorToast('Choose a file to import', 'DOCX, HTML, EPUB or TXT.');
        setCreating(false);
        return;
      }

      const book = await bookService.create(
        {
          ...form,
          title: form.title.trim(),
          author: form.author || user.name,
          source,
          templateId: undefined,
          aiBrief: source === 'ai' ? brief : undefined,
        },
        user.id,
        form.author || user.name,
      );

      if (source === 'ai' && brief.outline.length > 0) {
        success('AI project created', `${brief.outline.length} chapters drafted from your outline.`);
      } else {
        success('Book created', `“${book.title}” is ready.`);
      }
      navigate(`/dashboard/books/${book.id}/editor`);
    } catch (caught) {
      errorToast('We could not create that book', caught instanceof Error ? caught.message : undefined);
    } finally {
      setCreating(false);
    }
  };

  const generateWithProgress = async () => {
    if (!user || !form.title.trim()) {
      errorToast('Add a working title first', 'The generator names the project file from it.');
      return;
    }
    if (brief.outline.length === 0) {
      errorToast('Generate an outline first', 'You can edit it before any chapter is written.');
      return;
    }
    const ok = await confirm({
      title: `Generate ${brief.outline.length} chapters?`,
      description: `This costs ${brief.outline.length * 4} AI credits and writes directly into your new project. You can edit or delete any chapter afterwards.`,
      confirmLabel: 'Generate the book',
    });
    if (!ok) return;

    setGenerating(true);
    const steps = aiService.generationSteps(brief);
    setGenSteps(steps.map((step) => ({ label: step.label, value: 0, hint: step.detail })));

    try {
      const book = await bookService.create({ ...form, title: form.title.trim(), author: form.author || user.name, source: 'ai', aiBrief: brief }, user.id, form.author || user.name);
      let index = 0;
      for (const entry of brief.outline) {
        index += 1;
        await aiService.generateChapter(brief, entry.title, entry.summary, (progress) => {
          setGenProgress(progress);
          setGenSteps((current) =>
            current.map((step, stepIndex) =>
              stepIndex < index * 2
                ? { ...step, value: 100 }
                : stepIndex === index * 2
                  ? { ...step, value: progress.progress, hint: `${progress.step}…` }
                  : step,
            ),
          );
        });
        setGenSteps((current) => current.map((step, stepIndex) => (stepIndex < index * 2 ? { ...step, value: 100 } : step)));
      }
      success('Book generated', `${brief.outline.length} chapters written. Review them in the editor.`);
      navigate(`/dashboard/books/${book.id}/editor`);
    } catch {
      errorToast('Generation stopped', 'Your project was still created — open it from My books.');
    } finally {
      setGenerating(false);
    }
  };

  const activeTrim = TRIM_SIZES.find((entry) => entry.id === form.trimSizeId) ?? TRIM_SIZES[0];

  return (
    <>
      <Seo title="Create a book" noIndex />
      <PageHeader
        title="Create a book"
        description={step === 'choose' ? 'Choose how you want to start. You can change every setting later.' : `Configuring your ${source === 'import' ? 'import' : source} project.`}
        actions={
          step === 'configure' ? (
            <Button variant="ghost" onClick={() => setStep('choose')}>
              ← Change starting point
            </Button>
          ) : null
        }
      />

      {step === 'choose' ? (
        <>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {SOURCES.map((entry) => (
              <Card key={entry.id} className="flex flex-col">
                <CardContent className="flex flex-1 flex-col">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-lg text-primary" aria-hidden>
                    {entry.icon}
                  </span>
                  <h2 className="mt-3 text-sm font-semibold text-foreground">{entry.label}</h2>
                  <p className="mt-1 flex-1 text-sm leading-relaxed text-muted-foreground">{entry.description}</p>
                  <ul className="mt-3 space-y-1.5">
                    {entry.bullets.map((bullet) => (
                      <li key={bullet} className="flex gap-2 text-2xs text-muted-foreground">
                        <span className="text-primary" aria-hidden>
                          ✓
                        </span>
                        {bullet}
                      </li>
                    ))}
                  </ul>
                  <Button className="mt-4 w-full" onClick={() => chooseSource(entry.id)}>
                    Start with {entry.label.toLowerCase()}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="mt-5">
            <CardContent>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Not sure yet?</h2>
                  <p className="text-xs text-muted-foreground">
                    Open the demo workspace to see finished examples of every starting point, in every state.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => navigate('/templates')}>
                    Browse templates
                  </Button>
                  <Button variant="ghost" onClick={() => info('Tip', 'Press ⌘K anywhere to jump straight to a book you already have.')}>
                    Show a tip
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-5">
            {source === 'template' && (
              <Card>
                <CardContent>
                  <h2 className="text-sm font-semibold text-foreground">Choose a template</h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Input
                      value={templateQuery}
                      onChange={(event) => setTemplateQuery(event.target.value)}
                      placeholder="Search templates…"
                      aria-label="Search templates"
                      className="max-w-[220px]"
                    />
                    <Select
                      value={templateCategory}
                      onChange={(event) => setTemplateCategory(event.target.value)}
                      aria-label="Filter templates by category"
                      className="max-w-[200px]"
                    >
                      <option value="all">All categories</option>
                      {(categories ?? []).map((entry) => (
                        <option key={entry.category.id} value={entry.category.id}>
                          {entry.category.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {templatesLoading ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      {Array.from({ length: 3 }).map((_, index) => (
                        <Skeleton key={index} className="h-40 rounded-lg" />
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      {(templates ?? []).slice(0, 9).map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => {
                            setTemplateId(template.id);
                            setPreviewTemplate(template);
                            setForm((current) => ({
                              ...current,
                              title: current.title || `${template.name} book`,
                              kind: template.kind,
                              trimSizeId: template.trimSize.id,
                              palette: template.palette,
                              headingFont: template.headingFont,
                              bodyFont: template.bodyFont,
                            }));
                          }}
                          className={cn(
                            'rounded-lg border p-3 text-left transition-colors',
                            templateId === template.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
                          )}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-foreground">{template.name}</span>
                            {template.premium && <Badge variant="accent">Premium</Badge>}
                          </span>
                          <span className="mt-1 block text-2xs text-muted-foreground">
                            {template.style} · {template.trimSize.label} · {template.pageCount}p
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {templateId && (
                    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
                      <span className="text-muted-foreground">
                        Applying: <span className="font-medium text-foreground">{previewTemplate?.name}</span>
                      </span>
                      <Button size="xs" variant="ghost" onClick={() => setTemplateId(null)}>
                        Clear selection
                      </Button>
                      {restrictedTemplate && <Badge variant="warning">Needs Pro</Badge>}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {source === 'import' && (
              <Card>
                <CardContent>
                  <h2 className="text-sm font-semibold text-foreground">Import a manuscript</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    DOCX and EPUB are parsed for chapter headings where the browser can; otherwise a realistic structure is simulated so you can
                    exercise the import flow end to end.
                  </p>
                  <label
                    htmlFor="import-file"
                    className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/30 px-4 py-8 text-center transition-colors hover:border-primary/50"
                  >
                    <span className="text-2xl text-muted-foreground" aria-hidden>
                      ⇧
                    </span>
                    <span className="mt-2 text-sm font-medium text-foreground">{importFile ? importFile.name : 'Choose a file or drop it here'}</span>
                    <span className="mt-1 text-2xs text-muted-foreground">DOCX, HTML, EPUB, TXT or MD · up to 40 MB</span>
                    <input
                      id="import-file"
                      type="file"
                      accept=".docx,.html,.htm,.epub,.txt,.md"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        setImportFile(file);
                        if (file && !form.title) {
                          setForm((current) => ({ ...current, title: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') }));
                        }
                      }}
                    />
                  </label>
                  {importFile && (
                    <div className="mt-3 flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs">
                      <span className="text-foreground">
                        {importFile.name} · {(importFile.size / 1024).toFixed(0)} KB
                      </span>
                      <Button size="xs" variant="ghost" onClick={() => setImportFile(null)}>
                        Remove
                      </Button>
                    </div>
                  )}
                  <div className="mt-4 rounded-lg bg-info/10 px-3 py-2 text-2xs text-muted-foreground">
                    Nothing is uploaded. Parsing happens in your browser and the result is stored locally.
                  </div>
                </CardContent>
              </Card>
            )}

            {source === 'ai' && (
              <Card>
                <CardContent>
                  <h2 className="text-sm font-semibold text-foreground">AI book generator</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Answer six questions, review the outline, then generate. Nothing is written until you approve the outline.
                  </p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label htmlFor="ai-idea" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                        What is the idea?
                      </label>
                      <Textarea
                        id="ai-idea"
                        rows={3}
                        value={brief.idea}
                        onChange={(event) => setBrief((current) => ({ ...current, idea: event.target.value }))}
                        placeholder="A harbour clerk discovers a ledger that records every small kindness in a drowning town…"
                      />
                    </div>
                    <div>
                      <label htmlFor="ai-genre" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                        Genre
                      </label>
                      <Input id="ai-genre" value={brief.genre} onChange={(event) => setBrief((current) => ({ ...current, genre: event.target.value }))} />
                    </div>
                    <div>
                      <label htmlFor="ai-audience" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                        Audience
                      </label>
                      <Input id="ai-audience" value={brief.audience} onChange={(event) => setBrief((current) => ({ ...current, audience: event.target.value }))} />
                    </div>
                    <div>
                      <label htmlFor="ai-tone" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                        Tone
                      </label>
                      <Input id="ai-tone" value={brief.tone} onChange={(event) => setBrief((current) => ({ ...current, tone: event.target.value }))} />
                    </div>
                    <div>
                      <label htmlFor="ai-length" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                        Target length
                      </label>
                      <Select id="ai-length" value={brief.length} onChange={(event) => setBrief((current) => ({ ...current, length: event.target.value as AiBookBrief['length'] }))}>
                        <option value="short">Short · 25k words</option>
                        <option value="medium">Medium · 60k words</option>
                        <option value="long">Long · 100k words</option>
                      </Select>
                    </div>
                    <div>
                      <label htmlFor="ai-protagonist" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                        Protagonist
                      </label>
                      <Input id="ai-protagonist" value={brief.protagonist} onChange={(event) => setBrief((current) => ({ ...current, protagonist: event.target.value }))} placeholder="Hana Okada, harbour clerk" />
                    </div>
                    <div>
                      <label htmlFor="ai-setting" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                        Setting
                      </label>
                      <Input id="ai-setting" value={brief.setting} onChange={(event) => setBrief((current) => ({ ...current, setting: event.target.value }))} placeholder="A northern fishing town, 1962" />
                    </div>
                    <div>
                      <label htmlFor="ai-chapters" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                        Chapters: {brief.chapterCount}
                      </label>
                      <Slider min={3} max={24} label="Chapters" value={brief.chapterCount} onChange={(value) => setBrief((current) => ({ ...current, chapterCount: value }))} />
                    </div>
                    <label className="flex items-center gap-2.5 text-sm text-muted-foreground">
                      <Checkbox
                        checked={brief.includeIllustrations}
                        onCheckedChange={(checked) => setBrief((current) => ({ ...current, includeIllustrations: checked }))}
                        aria-label="Include illustrations"
                      />
                      Include illustration placeholders
                    </label>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button onClick={generateOutline} loading={outlineBusy}>
                      {brief.outline.length ? 'Regenerate outline' : 'Generate outline'}
                    </Button>
                    <span className="self-center text-2xs text-muted-foreground">
                      Outline generation costs {aiService.creditCost('outline')} credits · {aiService.modelFor('outline')}
                    </span>
                  </div>
                  {outlineBusy && (
                    <div className="mt-3">
                      <Progress value={genProgress.progress} />
                      <p className="mt-1 text-2xs text-muted-foreground">{genProgress.step || 'Thinking…'}</p>
                    </div>
                  )}

                  {brief.outline.length > 0 && (
                    <div className="mt-5">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-foreground">Editable outline</h3>
                        <span className="text-2xs text-muted-foreground">
                          {brief.outline.filter((entry) => entry.approved).length} of {brief.outline.length} approved
                        </span>
                      </div>
                      <ul className="mt-3 space-y-2">
                        {brief.outline.map((entry, index) => (
                          <li key={entry.id} className="rounded-lg border border-border p-3">
                            <div className="flex items-start gap-3">
                              <Checkbox
                                checked={entry.approved}
                                onCheckedChange={(checked) =>
                                  setBrief((current) => ({
                                    ...current,
                                    outline: current.outline.map((item) => (item.id === entry.id ? { ...item, approved: checked } : item)),
                                  }))
                                }
                                aria-label={`Include ${entry.title}`}
                                className="mt-1"
                              />
                              <div className="min-w-0 flex-1">
                                <Input
                                  value={entry.title}
                                  onChange={(event) =>
                                    setBrief((current) => ({
                                      ...current,
                                      outline: current.outline.map((item) => (item.id === entry.id ? { ...item, title: event.target.value } : item)),
                                    }))
                                  }
                                  aria-label={`Chapter ${index + 1} title`}
                                  className="h-8 text-sm font-medium"
                                />
                                <Textarea
                                  rows={2}
                                  value={entry.summary}
                                  onChange={(event) =>
                                    setBrief((current) => ({
                                      ...current,
                                      outline: current.outline.map((item) => (item.id === entry.id ? { ...item, summary: event.target.value } : item)),
                                    }))
                                  }
                                  aria-label={`Chapter ${index + 1} summary`}
                                  className="mt-2 text-xs"
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  aria-label={`Move chapter ${index + 1} up`}
                                  disabled={index === 0}
                                  onClick={() =>
                                    setBrief((current) => {
                                      const next = [...current.outline];
                                      [next[index - 1], next[index]] = [next[index], next[index - 1]];
                                      return { ...current, outline: next };
                                    })
                                  }
                                >
                                  ↑
                                </Button>
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  aria-label={`Remove chapter ${index + 1}`}
                                  onClick={() =>
                                    setBrief((current) => ({ ...current, outline: current.outline.filter((item) => item.id !== entry.id) }))
                                  }
                                >
                                  ×
                                </Button>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3">
                        <p className="text-xs text-foreground">
                          Generating all approved chapters costs{' '}
                          <strong>{brief.outline.filter((entry) => entry.approved).length * aiService.creditCost('chapter')} credits</strong> and runs in one
                          pass with progress you can watch.
                        </p>
                        <Button className="mt-3" onClick={generateWithProgress} disabled={generating}>
                          {generating ? 'Generating…' : `Generate ${brief.outline.filter((entry) => entry.approved).length} chapters`}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent>
                <h2 className="text-sm font-semibold text-foreground">Book details</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label htmlFor="book-title" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Title
                    </label>
                    <Input
                      id="book-title"
                      value={form.title}
                      onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                      placeholder="The Ledger of Small Things"
                      maxLength={120}
                    />
                  </div>
                  <div>
                    <label htmlFor="book-subtitle" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Subtitle <span className="font-normal">(optional)</span>
                    </label>
                    <Input
                      id="book-subtitle"
                      value={form.subtitle}
                      onChange={(event) => setForm((current) => ({ ...current, subtitle: event.target.value }))}
                    />
                  </div>
                  <div>
                    <label htmlFor="book-author" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Author name on the cover
                    </label>
                    <Input
                      id="book-author"
                      value={form.author}
                      onChange={(event) => setForm((current) => ({ ...current, author: event.target.value }))}
                    />
                  </div>
                  <div>
                    <label htmlFor="book-kind" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Book type
                    </label>
                    <Select id="book-kind" value={form.kind} onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value as BookKind }))}>
                      {BOOK_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {BOOK_KIND_LABELS[kind] ?? kind}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label htmlFor="book-language" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Language
                    </label>
                    <Select
                      id="book-language"
                      value={form.language}
                      onChange={(event) => setForm((current) => ({ ...current, language: event.target.value }))}
                    >
                      {LANGUAGES.map((language) => (
                        <option key={language.code} value={language.code}>
                          {language.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="book-description" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Description
                    </label>
                    <Textarea
                      id="book-description"
                      rows={3}
                      value={form.description}
                      onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                      placeholder="What is this book about? Used on the marketplace listing and the back cover."
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <h2 className="text-sm font-semibold text-foreground">Print configuration</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  These become your project defaults. Everything is editable per book, per section and per page later.
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="book-trim" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Trim size
                    </label>
                    <Select
                      id="book-trim"
                      value={form.trimSizeId}
                      onChange={(event) => {
                        const trim = TRIM_SIZES.find((entry) => entry.id === event.target.value);
                        setForm((current) => ({
                          ...current,
                          trimSizeId: event.target.value,
                          orientation: trim && trim.widthIn > trim.heightIn ? 'landscape' : current.orientation,
                        }));
                      }}
                    >
                      {TRIM_SIZES.map((trim) => (
                        <option key={trim.id} value={trim.id}>
                          {trim.label} — {trim.widthIn}×{trim.heightIn}in
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label htmlFor="book-orientation" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Orientation
                    </label>
                    <Select
                      id="book-orientation"
                      value={form.orientation}
                      onChange={(event) => setForm((current) => ({ ...current, orientation: event.target.value as 'portrait' | 'landscape' }))}
                    >
                      <option value="portrait">Portrait</option>
                      <option value="landscape">Landscape</option>
                    </Select>
                  </div>

                  <div className="sm:col-span-2">
                    <p className="text-xs font-medium text-muted-foreground">Margins (inches)</p>
                    <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                        <div key={side}>
                          <label htmlFor={`margin-${side}`} className="block text-2xs capitalize text-muted-foreground">
                            {side}
                          </label>
                          <Input
                            id={`margin-${side}`}
                            type="number"
                            min={0.25}
                            max={2}
                            step={0.05}
                            value={form.margins[side]}
                            onChange={(event) =>
                              setForm((current) => ({ ...current, margins: { ...current.margins, [side]: Number(event.target.value) } }))
                            }
                            className="mt-1 h-9"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="book-gutter" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Inside gutter: {form.gutter}in
                    </label>
                    <Slider min={0.25} max={1.5} step={0.05} label="Inside gutter (inches)" format={(value) => `${value.toFixed(2)} in`} value={form.gutter} onChange={(value) => setForm((current) => ({ ...current, gutter: value }))} />
                    <p className="mt-1 text-2xs text-muted-foreground">The gutter is added to the inside margin of every facing page.</p>
                  </div>
                  <div>
                    <label htmlFor="book-bleed" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Bleed: {form.bleed}in
                    </label>
                    <Slider min={0} max={0.25} step={0.025} label="Bleed (inches)" format={(value) => (value === 0 ? "None" : `${value.toFixed(3)} in`)} value={form.bleed} onChange={(value) => setForm((current) => ({ ...current, bleed: value }))} />
                    <p className="mt-1 text-2xs text-muted-foreground">Set 0.125in for full-bleed interiors and covers.</p>
                  </div>

                  <div>
                    <label htmlFor="book-heading-font" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Heading font
                    </label>
                    <Select
                      id="book-heading-font"
                      value={form.headingFont}
                      onChange={(event) => setForm((current) => ({ ...current, headingFont: event.target.value }))}
                    >
                      {FONTS.headings.map((font) => (
                        <option key={font} value={font}>
                          {font}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label htmlFor="book-body-font" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Body font
                    </label>
                    <Select id="book-body-font" value={form.bodyFont} onChange={(event) => setForm((current) => ({ ...current, bodyFont: event.target.value }))}>
                      {FONTS.body.map((font) => (
                        <option key={font} value={font}>
                          {font}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="sm:col-span-2">
                    <p className="text-xs font-medium text-muted-foreground">Interior palette</p>
                    <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-8">
                      {PAGE_PALETTES.map((palette) => (
                        <button
                          key={palette.id}
                          type="button"
                          onClick={() => setForm((current) => ({ ...current, palette: palette.id }))}
                          aria-pressed={form.palette === palette.id}
                          title={palette.name}
                          className={cn(
                            'overflow-hidden rounded-lg border-2 transition-colors',
                            form.palette === palette.id ? 'border-primary' : 'border-transparent',
                          )}
                        >
                          <span className="flex h-8 w-full">
                            {[palette.accent, palette.paper, palette.accent, palette.paper].map((color, index) => (
                              <span key={`${color}-${index}`} className="h-full flex-1" style={{ background: color }} />
                            ))}
                          </span>
                          <span className="block truncate bg-card px-1 py-1 text-[9px] text-muted-foreground">{palette.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="book-theme" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Theme mood
                    </label>
                    <Select
                      id="book-theme"
                      value={form.theme}
                      onChange={(event) => setForm((current) => ({ ...current, theme: event.target.value as 'light' | 'dark' | 'warm' | 'classic' }))}
                    >
                      <option value="light">Light · clean and modern</option>
                      <option value="dark">Dark · dramatic</option>
                      <option value="warm">Warm · cream paper</option>
                      <option value="classic">Classic · traditional serif</option>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <Card>
              <CardContent>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview</p>
                <div
                  className={cn(
                    'mx-auto mt-3 rounded-lg bg-white p-4 shadow-page ring-1 ring-border',
                    form.orientation === 'landscape' ? 'aspect-[4/3] w-full' : 'aspect-[2/3] w-[190px]',
                  )}
                >
                  <p className="font-serif text-sm font-semibold text-slate-800" style={{ fontFamily: form.headingFont }}>
                    {form.title || 'Untitled book'}
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-500">{form.author || 'Author name'}</p>
                  <div className="mt-3 space-y-1">
                    {Array.from({ length: form.orientation === 'landscape' ? 8 : 14 }).map((_, index) => (
                      <div key={index} className="h-1 rounded bg-slate-200" style={{ width: `${100 - (index % 4) * 9}%` }} />
                    ))}
                  </div>
                </div>
                <dl className="mt-4 space-y-2 text-xs">
                  {[
                    ['Trim size', `${activeTrim.label} (${activeTrim.widthIn}×${activeTrim.heightIn} in)`],
                    ['Orientation', form.orientation],
                    ['Margins', `${form.margins.top} / ${form.margins.right} / ${form.margins.bottom} / ${form.margins.left} in`],
                    ['Gutter', `${form.gutter} in`],
                    ['Bleed', form.bleed === 0 ? 'None (digital)' : `${form.bleed} in`],
                    ['Palette', PAGE_PALETTES.find((entry) => entry.id === form.palette)?.name ?? form.palette],
                    ['Fonts', `${form.headingFont} + ${form.bodyFont}`],
                    ['Estimated pages', `${Math.max(24, Math.round((form.bodyFont ? 1 : 1) * (form.trimSizeId === '6x9' ? 24 : 20)))} to start`],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-3 border-b border-border pb-1.5 last:border-0">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="text-right font-medium capitalize text-foreground">{value}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Plan check</p>
                  <Badge variant={entitlements.canCreateBook() ? 'success' : 'danger'}>
                    {entitlements.canCreateBook() ? 'Allowed' : 'Limit reached'}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {entitlements.usage.books.limit < 0
                    ? 'Your plan allows unlimited books.'
                    : `${entitlements.usage.books.used} of ${entitlements.usage.books.limit} book projects used on the ${entitlements.plan.name} plan.`}
                </p>
                <Button className="mt-4 w-full" size="lg" loading={creating} onClick={create}>
                  {source === 'import' ? 'Import and open' : 'Create book'}
                </Button>
                <Button variant="ghost" className="mt-2 w-full" onClick={() => navigate('/dashboard/books')}>
                  Cancel
                </Button>
                {!entitlements.canCreateBook() && (
                  <Button variant="outline" className="mt-2 w-full" onClick={() => navigate('/dashboard/subscription')}>
                    Compare plans
                  </Button>
                )}
              </CardContent>
            </Card>

            {source === 'ai' && brief.outline.length > 0 && (
              <Card>
                <CardContent>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cost estimate</p>
                  <p className="mt-1 font-display text-2xl font-bold text-foreground">
                    {aiService.creditCost('outline') + brief.outline.filter((entry) => entry.approved).length * aiService.creditCost('chapter')} credits
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Includes outline generation. Images add 12 credits each.
                  </p>
                </CardContent>
              </Card>
            )}

            {generating && (
              <Card>
                <CardContent>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Generating</p>
                  <div className="mt-3">
                    <ProgressList items={genSteps} />
                  </div>
                  <p className="mt-2 text-2xs text-muted-foreground">You can close this page — the project is created first and generation resumes from My books.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      <Modal
        open={Boolean(previewTemplate && templateId)}
        onOpenChange={(open) => !open && setPreviewTemplate(null)}
        title={previewTemplate?.name ?? 'Template'}
        description={previewTemplate ? `${previewTemplate.style} · ${previewTemplate.trimSize.label} · ${previewTemplate.pageCount} pages` : undefined}
        footer={
          <Button onClick={() => setPreviewTemplate(null)}>Use this configuration</Button>
        }
      >
        {previewTemplate && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{previewTemplate.kind.replace('-', ' ')}</Badge>
              <Badge variant="outline">{previewTemplate.language}</Badge>
              {previewTemplate.premium ? <Badge variant="accent">Premium</Badge> : <Badge variant="success">Free</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{previewTemplate.description}</p>
            <ol className="space-y-1.5">
              {previewTemplate.structure.map((row, index) => (
                <li key={`${row.title}-${index}`} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                  <span className="text-foreground">
                    {index + 1}. {row.title}
                  </span>
                  <span className="text-xs text-muted-foreground">{row.pages}p</span>
                </li>
              ))}
            </ol>
            {restrictedTemplate && (
              <p className="rounded-lg bg-warning/15 px-3 py-2 text-xs text-warning-foreground dark:text-warning">
                This is a premium template. Creating the book requires the Pro plan — you will be prompted to upgrade.
              </p>
            )}
          </div>
        )}
      </Modal>

      <p className="mt-6 text-2xs text-muted-foreground">
        Projects created here are stored locally in your browser. Nothing is uploaded and no payment is taken.
      </p>
    </>
  );
}
