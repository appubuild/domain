import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, BadgeCheck, CheckCircle2, Circle, Loader2, Rocket, Save, Send, ShieldCheck, Undo2, XCircle, Eye, Globe, Lock, Store, Link2,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Separator, Switch } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/overlays';
import { EmptyState, ErrorState, ProgressList } from '@/components/ui/data';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/overlays';
import { useBook, useBooks, useCategories, usePreflight } from '@/hooks/queries';
import { publishingService, bookService } from '@/services';
import { useAuth } from '@/providers/AuthProvider';
import { BOOK_KINDS, PUBLISHING_PROFILES } from '@/data/constants';
import { BOOK_KIND_LABELS, formatCurrency, formatDateTime, formatNumber, timeAgo } from '@/lib/format';
import { cn, slugify } from '@/lib/utils';
import type { Book, BookVisibility, PublishingProfileId, PublishingSubmission } from '@/types/domain';

const VISIBILITY_OPTIONS: { value: BookVisibility; label: string; description: string; icon: React.ReactNode }[] = [
  { value: 'private', label: 'Private', description: 'Only you and your collaborators can open it. Never listed.', icon: <Lock className="h-4 w-4" /> },
  { value: 'unlisted', label: 'Unlisted', description: 'Anyone with the link can read it — it will not appear anywhere on the marketplace.', icon: <Link2 className="h-4 w-4" /> },
  { value: 'public', label: 'Public', description: 'Readable on your author page and in search, but not sold on the marketplace.', icon: <Globe className="h-4 w-4" /> },
  { value: 'marketplace', label: 'Marketplace', description: 'Listed for sale with checkout, reviews and revenue tracking. Requires review approval.', icon: <Store className="h-4 w-4" /> },
];

const KEYWORD_LIMIT = 7;

export default function PublishingCentrePage() {
  const { user, entitlements } = useAuth();
  const { success, error, warning, info } = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const { data: allBooks, isLoading } = useBooks({ ownerId: user?.id, status: 'all', sort: 'recent' });
  const bookId = params.get('book') ?? allBooks?.[0]?.id ?? '';
  const { data: book } = useBook(bookId);
  const { data: categories } = useCategories();
  const [step, setStep] = React.useState(0);
  const [profileId, setProfileId] = React.useState<PublishingProfileId>('kdp-ebook');
  const { data: report, isFetching: preflightRunning, refetch: rerunPreflight } = usePreflight(bookId, profileId, Boolean(bookId));
  const [submissionOpen, setSubmissionOpen] = React.useState(false);

  const [form, setForm] = React.useState({
    title: '',
    subtitle: '',
    authorName: '',
    language: 'en',
    description: '',
    visibility: 'unlisted' as BookVisibility,
    price: 4.99,
    keywords: [] as string[],
    keywordDraft: '',
    categories: [] as string[],
    isbn: '',
    publisher: 'Self-published',
    pubDate: new Date().toISOString().slice(0, 10),
    freePreviewPages: 3,
    acceptRefunds: true,
  });

  React.useEffect(() => {
    if (!book) return;
    setForm((current) => ({
      ...current,
      title: book.title,
      subtitle: book.subtitle,
      authorName: book.authorName,
      language: book.language,
      description: book.description,
      visibility: book.visibility,
      price: book.marketplace.price || 4.99,
      keywords: book.metadata.keywords,
      categories: book.categoryIds,
      isbn: book.metadata.isbn,
      publisher: book.metadata.publisher || 'Self-published',
      freePreviewPages: book.marketplace.freePreviewPages,
    }));
  }, [book]);

  const submission = bookId ? publishingService.submissionFor(bookId) : undefined;
  const completion = bookId ? publishingService.completion(bookId) : { done: 0, total: 0, percent: 0, checklist: [] };
  const openErrors = (report?.issues ?? []).filter((issue) => issue.status === 'open' && issue.severity === 'error').length;

  const save = useMutation({
    mutationFn: async () => {
      if (!book) throw new Error('No book selected.');
      bookService.update(book.id, {
        title: form.title,
        subtitle: form.subtitle,
        authorName: form.authorName,
        language: form.language,
        description: form.description,
        categoryIds: form.categories,
        metadata: { ...book.metadata, isbn: form.isbn, publisher: form.publisher },
        marketplace: { ...book.marketplace, price: form.price, freePreviewPages: form.freePreviewPages },
      });
      return publishingService.saveDraft(book.id, {
        visibility: form.visibility,
        price: form.price,
        bookTitle: form.title,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['book', bookId] });
      qc.invalidateQueries({ queryKey: ['publishing-checklist', bookId] });
      success('Draft saved', 'Your publishing details were stored against this book.');
    },
    onError: (e: Error) => error('Could not save', e.message),
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!book) throw new Error('No book selected.');
      if (!entitlements.canPublish()) throw new Error('Publishing is not available on your current plan.');
      if (form.visibility === 'marketplace' && !entitlements.canSellBook()) throw new Error('Selling on the marketplace requires a Pro plan.');
      await publishingService.saveDraft(book.id, { visibility: form.visibility, price: form.price });
      return publishingService.submit(book.id, form.visibility, form.price, user?.id);
    },
    onSuccess: (result) => {
      qc.invalidateQueries();
      setSubmissionOpen(false);
      const status = result.submission.status;
      if (status === 'published') success('Book published', 'It is live in your library and author page.');
      else success('Submitted for review', 'A reviewer will approve marketplace listing shortly. Track status here.');
      info('Preflight summary', `${result.report.passed} passed · ${result.report.warnings} warnings · ${result.report.errors} errors`);
    },
    onError: (e: Error) => error('Publishing failed', e.message),
  });

  const unpublish = useMutation({
    mutationFn: () => publishingService.unpublish(bookId),
    onSuccess: () => { qc.invalidateQueries(); success('Book unpublished', 'Readers can no longer access this title through the marketplace.'); },
    onError: (e: Error) => error('Could not unpublish', e.message),
  });

  if (isLoading) {
    return <div className="space-y-4"><div className="h-8 w-64 animate-pulse rounded bg-muted" /><div className="h-96 animate-pulse rounded-xl bg-muted" /></div>;
  }

  if (!allBooks || allBooks.length === 0) {
    return (
      <EmptyState
        icon={<Rocket className="h-5 w-5" />}
        title="Nothing to publish yet"
        description="Publishing starts with a finished manuscript. Create a book, then walk through this ten-step flow."
        actions={<Button onClick={() => navigate('/dashboard/books/new')}>Create a book</Button>}
      />
    );
  }

  if (!book) return <ErrorState title="Book not found" description="Pick another book from the selector." onRetry={() => navigate('/dashboard/publishing')} retryLabel="Reset" />;

  const toggleKeyword = (value: string) => {
    const keyword = value.trim().toLowerCase();
    if (!keyword) return;
    setForm((current) => {
      if (current.keywords.includes(keyword)) return { ...current, keywords: current.keywords.filter((entry) => entry !== keyword), keywordDraft: '' };
      if (current.keywords.length >= KEYWORD_LIMIT) {
        warning(`Up to ${KEYWORD_LIMIT} keywords`, 'Remove one before adding another.');
        return { ...current, keywordDraft: '' };
      }
      return { ...current, keywords: [...current.keywords, keyword], keywordDraft: '' };
    });
  };

  const stepsWithStatus = publishingService.steps.map((entry, index) => ({
    id: entry.id,
    label: entry.label,
    description: entry.description,
    done: index < step || (entry.id === 'preflight' && Boolean(report) && openErrors === 0),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Publishing centre</h1>
          <p className="text-sm text-muted-foreground">Ten steps from finished manuscript to a live, sellable book.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={bookId}
            onChange={(event) => { const next = new URLSearchParams(params); next.set('book', event.target.value); setParams(next); setStep(0); }}
            className="h-9 max-w-[240px] rounded-md border border-input bg-background px-3 text-sm"
            aria-label="Choose book"
          >
            {allBooks.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
          </select>
          <Button variant="outline" size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save draft
          </Button>
          <Button size="sm" onClick={() => setSubmissionOpen(true)} disabled={submit.isPending}>
            <Rocket className="h-4 w-4" /> {book.status === 'published' ? 'Update listing' : 'Publish'}
          </Button>
        </div>
      </div>

      {submission && (
        <Card className={cn('border-l-4', submission.status === 'published' ? 'border-l-emerald-500' : submission.status === 'rejected' ? 'border-l-rose-500' : 'border-l-amber-500')}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-start gap-3">
              {submission.status === 'published' ? <BadgeCheck className="mt-0.5 h-5 w-5 text-emerald-500" /> : <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />}
              <div>
                <p className="text-sm font-medium">
                  {submission.status === 'published' ? `Published ${submission.publishedAt ? timeAgo(submission.publishedAt) : ''}` : `Submission status: ${submission.status.replace('_', ' ')}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Visibility: {submission.visibility} · {submission.price > 0 ? formatCurrency(submission.price) : 'Free'}
                  {submission.submittedAt ? ` · submitted ${formatDateTime(submission.submittedAt)}` : ''}
                </p>
                {submission.reviewerNote && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">Reviewer note: {submission.reviewerNote}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={submission.status === 'published' ? 'success' : submission.status === 'rejected' ? 'danger' : 'warning'}>{submission.status.replace('_', ' ')}</Badge>
              {book.visibility !== 'private' && (
                <Button variant="outline" size="sm" onClick={() => navigate(`/read/${book.id}`)}><Eye className="h-4 w-4" /> View live book</Button>
              )}
              {submission.status === 'published' && (
                <Button variant="outline" size="sm" onClick={async () => {
                  const ok = await confirm({ title: 'Unpublish this book?', description: 'It stays in your library as a draft, and the marketplace listing is withdrawn.', confirmLabel: 'Unpublish', destructive: true });
                  if (ok) unpublish.mutate();
                }}>
                  <Undo2 className="h-4 w-4" /> Unpublish
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Progress</CardTitle>
              <CardDescription className="text-xs">{completion.done} of {completion.total} requirements complete</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ProgressList items={[{ label: 'Publishing readiness', value: completion.percent }]} />
              <Separator />
              <nav aria-label="Publishing steps" className="space-y-1">
                {stepsWithStatus.map((entry, index) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setStep(index)}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
                      index === step ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted',
                    )}
                    aria-current={index === step ? 'step' : undefined}
                  >
                    {entry.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0" />}
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{index + 1}. {entry.label}</span>
                    </span>
                  </button>
                ))}
              </nav>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Requirements</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {completion.checklist.map((item) => (
                <div key={item.id} className="flex items-start gap-2 text-xs">
                  {item.done ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />}
                  <div>
                    <p className={item.done ? 'text-muted-foreground line-through' : 'font-medium'}>{item.label}</p>
                    <p className="text-muted-foreground">{item.detail}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{publishingService.steps[step].label}</CardTitle>
            <CardDescription>{publishingService.steps[step].description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {step === 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Title" value={form.title} onChange={(value) => setForm((c) => ({ ...c, title: value }))} />
                <Field label="Subtitle" value={form.subtitle} onChange={(value) => setForm((c) => ({ ...c, subtitle: value }))} placeholder="Optional" />
                <Field label="Author name" value={form.authorName} onChange={(value) => setForm((c) => ({ ...c, authorName: value }))} />
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="pub-language">Language</label>
                  <select id="pub-language" value={form.language} onChange={(event) => setForm((c) => ({ ...c, language: event.target.value }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                    {[['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['pt', 'Portuguese'], ['it', 'Italian']].map(([code, label]) => (
                      <option key={code} value={code}>{label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-sm font-medium" htmlFor="pub-description">Description</label>
                  <textarea
                    id="pub-description"
                    value={form.description}
                    onChange={(event) => setForm((c) => ({ ...c, description: event.target.value }))}
                    rows={4}
                    placeholder="What is this book about? This appears on your listing."
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                  <p className="text-xs text-muted-foreground">{form.description.length} characters · aim for 400–800</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="pub-kind">Book type</label>
                  <select id="pub-kind" value={book.kind} onChange={(event) => { bookService.update(book.id, { kind: event.target.value as Book['kind'] }); qc.invalidateQueries({ queryKey: ['book', bookId] }); }} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                    {BOOK_KINDS.map((entry) => <option key={entry} value={entry}>{BOOK_KIND_LABELS[entry]}</option>)}
                  </select>
                </div>
                <Field label="ISBN" value={form.isbn} onChange={(value) => setForm((c) => ({ ...c, isbn: value }))} placeholder="978-…" />
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Metric label="Words" value={formatNumber(book.wordCount)} />
                  <Metric label="Pages" value={formatNumber(book.pageCount)} />
                  <Metric label="Sections" value={formatNumber(book.sections.length)} />
                </div>
                <div className="space-y-2">
                  {book.sections.map((section) => (
                    <div key={section.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{section.title}</p>
                        <p className="text-xs text-muted-foreground">{section.pageIds.length} pages · {formatNumber(section.wordCount)} words</p>
                      </div>
                      <Badge variant={section.status === 'complete' ? 'success' : section.status === 'drafting' ? 'warning' : 'outline'}>{section.status}</Badge>
                    </div>
                  ))}
                </div>
                <Button variant="outline" size="sm" onClick={() => navigate(`/dashboard/books/${book.id}/editor`)}>Continue writing in the editor</Button>
              </div>
            )}

            {step === 2 && (
              <div className="grid gap-5 sm:grid-cols-[200px_1fr]">
                <div className="flex justify-center rounded-lg bg-muted/40 p-4">
                  <div className="aspect-[2/3] w-[150px] overflow-hidden rounded shadow-page">
                    {book.cover.imageUrl
                      ? <img src={book.cover.imageUrl} alt={`Cover of ${book.title}`} className="h-full w-full object-cover" />
                      : <div className="flex h-full items-center justify-center bg-brand-gradient p-3 text-center text-sm font-semibold text-white">{book.title}</div>}
                  </div>
                </div>
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Retailers require a front cover of at least 1600 × 2560 px (1.6:1 aspect ratio) and a separate spine/back design for print.
                  </p>
                  <div className="flex items-center gap-2">
                    {book.cover.imageUrl ? <Badge variant="success"><CheckCircle2 className="mr-1 h-3 w-3" /> Artwork present</Badge> : <Badge variant="warning">No artwork yet</Badge>}
                    <Badge variant="outline">Spine: {bookService.spineWidth(book.id).widthIn.toFixed(3)} in</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => navigate(`/dashboard/books/${book.id}/editor?mode=cover`)}>Open cover designer</Button>
                    <Button variant="outline" size="sm" onClick={() => navigate(`/dashboard/books/${book.id}/editor`)}>Design in canvas</Button>
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Publisher" value={form.publisher} onChange={(value) => setForm((c) => ({ ...c, publisher: value }))} />
                <Field label="Publication date" type="date" value={form.pubDate} onChange={(value) => setForm((c) => ({ ...c, pubDate: value }))} />
                <Field label="ISBN" value={form.isbn} onChange={(value) => setForm((c) => ({ ...c, isbn: value }))} />
                <Field label="Edition" value={book.metadata.edition ?? ''} onChange={(value) => bookService.update(book.id, { metadata: { ...book.metadata, edition: value } })} />
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-sm font-medium" htmlFor="pub-rights">Rights statement</label>
                  <textarea
                    id="pub-rights"
                    rows={3}
                    defaultValue={book.metadata.rights ?? 'All rights reserved.'}
                    onBlur={(event) => { bookService.update(book.id, { metadata: { ...book.metadata, rights: event.target.value } }); success('Rights statement saved'); }}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Pick a primary category, then up to three secondary categories. These drive marketplace discovery.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(categories ?? []).map((category) => {
                    const selected = form.categories.includes(category.id);
                    const primary = form.categories[0] === category.id;
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => setForm((current) => {
                          const next = selected ? current.categories.filter((id) => id !== category.id) : [...current.categories, category.id].slice(0, 4);
                          return { ...current, categories: next };
                        })}
                        className={cn('rounded-lg border p-3 text-left transition-colors', selected ? 'border-primary bg-primary/5' : 'hover:border-primary/40')}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">{category.name}</p>
                          {primary && <Badge variant="info" className="text-2xs">Primary</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">{category.description}</p>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">{form.categories.length}/4 selected. The first selection becomes the primary category.</p>
              </div>
            )}

            {step === 5 && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {form.keywords.map((keyword) => (
                    <Badge key={keyword} variant="secondary" className="gap-1">
                      {keyword}
                      <button type="button" onClick={() => setForm((c) => ({ ...c, keywords: c.keywords.filter((entry) => entry !== keyword) }))} aria-label={`Remove ${keyword}`} className="ml-0.5 text-muted-foreground hover:text-foreground">×</button>
                    </Badge>
                  ))}
                  {form.keywords.length === 0 && <p className="text-sm text-muted-foreground">No keywords yet — add up to {KEYWORD_LIMIT}.</p>}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={form.keywordDraft}
                    onChange={(event) => setForm((c) => ({ ...c, keywordDraft: event.target.value }))}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); toggleKeyword(form.keywordDraft); } }}
                    placeholder="e.g. literary fiction"
                    aria-label="Add keyword"
                  />
                  <Button variant="outline" onClick={() => toggleKeyword(form.keywordDraft)}>Add</Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {['slow living', 'coastal', 'memoir', 'craft', 'nature writing', 'small business', 'habits', 'creative practice']
                    .filter((entry) => !form.keywords.includes(entry))
                    .slice(0, 6)
                    .map((suggestion) => (
                      <button key={suggestion} type="button" onClick={() => toggleKeyword(suggestion)} className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground">
                        + {suggestion}
                      </button>
                    ))}
                </div>
                <p className="text-xs text-muted-foreground">{form.keywords.length}/{KEYWORD_LIMIT} keywords · used for retail search matching.</p>
              </div>
            )}

            {step === 6 && (
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="pub-price">List price (USD)</label>
                    <Input id="pub-price" type="number" min={0} step={0.5} value={form.price} onChange={(event) => setForm((c) => ({ ...c, price: Math.max(0, Number(event.target.value)) }))} />
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">Reader pays</span><span>{form.price > 0 ? formatCurrency(form.price) : 'Free'}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Platform fee (15%)</span><span>{formatCurrency(form.price * 0.15)}</span></div>
                    <div className="flex justify-between font-medium"><span>You earn per sale</span><span>{formatCurrency(form.price * 0.85)}</span></div>
                  </div>
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>Offer readers a free preview</span>
                    <Switch checked={form.freePreviewPages > 0} onCheckedChange={(checked) => setForm((c) => ({ ...c, freePreviewPages: checked ? 3 : 0 }))} />
                  </label>
                  {form.freePreviewPages > 0 && (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium" htmlFor="preview-pages">Free preview pages: {form.freePreviewPages}</label>
                      <input
                        id="preview-pages"
                        type="range"
                        min={1}
                        max={Math.max(1, Math.min(10, book.pageCount))}
                        value={form.freePreviewPages}
                        onChange={(event) => setForm((c) => ({ ...c, freePreviewPages: Number(event.target.value) }))}
                        className="w-full accent-primary"
                      />
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  <label className="flex items-start justify-between gap-3 text-sm">
                    <span>
                      <span className="font-medium">Accept the refund policy</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">Digital sales are refundable within 14 days if the book has not been substantially read.</span>
                    </span>
                    <Switch checked={form.acceptRefunds} onCheckedChange={(checked) => setForm((c) => ({ ...c, acceptRefunds: checked }))} />
                  </label>
                  {!form.acceptRefunds && <p className="text-xs text-rose-600 dark:text-rose-400">You must accept the refund policy to sell on the marketplace.</p>}
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Price comparison</p>
                    {[0, 2.99, 4.99, 9.99].map((value) => (
                      <button key={value} type="button" onClick={() => setForm((c) => ({ ...c, price: value }))} className={cn('flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm', form.price === value ? 'border-primary bg-primary/5' : 'hover:border-primary/40')}>
                        <span>{value === 0 ? 'Free' : formatCurrency(value)}</span>
                        <span className="text-xs text-muted-foreground">{value === 0 ? 'Builds audience fastest' : value < 5 ? 'Sweet spot for indie ebooks' : 'Premium positioning'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {step === 7 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Readers see the first {form.freePreviewPages} pages free, then a purchase prompt. Check how the sample reads.</p>
                <div className="rounded-xl border bg-muted/30 p-6">
                  <div className="mx-auto max-w-md space-y-3 rounded-lg bg-card p-6 shadow-page">
                    <p className="text-center text-xs uppercase tracking-[0.2em] text-muted-foreground">Preview</p>
                    <h3 className="text-center font-serif text-xl font-semibold">{form.title}</h3>
                    <p className="text-center text-sm text-muted-foreground">{form.authorName}</p>
                    <Separator />
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {book.pages.find((page) => page.content)?.content?.replace(/<[^>]+>/g, ' ').slice(0, 320) ?? 'Your opening pages will appear here.'}…
                    </p>
                    <Button className="w-full" onClick={() => navigate(`/read/${book.id}`)}>Open the full reader</Button>
                  </div>
                </div>
              </div>
            )}

            {step === 8 && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="preflight-profile">Preflight profile</label>
                    <select
                      id="preflight-profile"
                      value={profileId}
                      onChange={(event) => setProfileId(event.target.value as PublishingProfileId)}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {PUBLISHING_PROFILES.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                    </select>
                  </div>
                  <Button variant="outline" className="self-end" onClick={() => rerunPreflight()} disabled={preflightRunning}>
                    {preflightRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Run preflight
                  </Button>
                </div>
                {report && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-4">
                      <Metric label="Passed" value={String(report.passed)} tone="success" />
                      <Metric label="Warnings" value={String(report.warnings)} tone="warning" />
                      <Metric label="Errors" value={String(report.errors)} tone={report.errors ? 'danger' : 'default'} />
                      <Metric label="Readiness" value={`${Math.round(report.readiness)}%`} />
                    </div>
                    <div className="space-y-2">
                      {report.issues.map((issue) => (
                        <div key={issue.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{issue.title}</p>
                            <p className="text-xs text-muted-foreground">{issue.detail}</p>
                          </div>
                          <Badge variant={issue.severity === 'error' ? 'danger' : issue.severity === 'warning' ? 'warning' : 'info'}>{issue.severity}</Badge>
                        </div>
                      ))}
                      {report.issues.length === 0 && (
                        <div className="flex items-center gap-2 rounded-lg border border-emerald-300/60 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                          <CheckCircle2 className="h-4 w-4" /> Preflight passed — nothing blocking.
                        </div>
                      )}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => navigate(`/dashboard/exports?book=${book.id}&profile=${profileId}`)}>Open export centre for detailed fixes</Button>
                  </>
                )}
              </div>
            )}

            {step === 9 && (
              <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  {VISIBILITY_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setForm((c) => ({ ...c, visibility: option.value }))}
                      className={cn('flex gap-3 rounded-lg border p-3 text-left transition-colors', form.visibility === option.value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-primary/40')}
                    >
                      <span className="mt-0.5 text-muted-foreground">{option.icon}</span>
                      <span>
                        <span className="block text-sm font-medium">{option.label}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
                {form.visibility === 'marketplace' && !entitlements.canSellBook() && (
                  <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    Selling requires a Pro plan. <button type="button" className="underline" onClick={() => navigate('/dashboard/subscription')}>Compare plans</button>
                  </div>
                )}
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-medium">Final check</p>
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    <li>· Preflight errors: {openErrors}</li>
                    <li>· Requirements met: {completion.done}/{completion.total}</li>
                    <li>· Visibility: {form.visibility}</li>
                    <li>· Price: {form.price > 0 ? formatCurrency(form.price) : 'Free'}</li>
                    <li>· URL: /books/{slugify(form.title)}</li>
                  </ul>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setSubmissionOpen(true)} disabled={submit.isPending}>
                    <Rocket className="h-4 w-4" /> Publish {form.visibility === 'marketplace' ? 'to marketplace' : ''}
                  </Button>
                  <Button variant="outline" onClick={() => save.mutate()}>Save as draft</Button>
                </div>
              </div>
            )}

            <Separator />
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>Back</Button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Step {step + 1} of {publishingService.steps.length}</span>
                {step < publishingService.steps.length - 1 && (
                  <Button size="sm" onClick={() => setStep((value) => Math.min(publishingService.steps.length - 1, value + 1))}>Next</Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Modal
        open={submissionOpen}
        onOpenChange={setSubmissionOpen}
        title="Publish this book"
        description="Confirm the details one last time. You can change everything later."
        footer={
          <>
            <Button variant="outline" onClick={() => setSubmissionOpen(false)}>Cancel</Button>
            <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
              {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {form.visibility === 'marketplace' ? 'Submit for review' : 'Publish now'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <SummaryRow label="Book" value={form.title} />
          <SummaryRow label="Author" value={form.authorName} />
          <SummaryRow label="Visibility" value={VISIBILITY_OPTIONS.find((option) => option.value === form.visibility)?.label ?? form.visibility} />
          <SummaryRow label="Price" value={form.price > 0 ? formatCurrency(form.price) : 'Free'} />
          <SummaryRow label="Preflight errors" value={String(openErrors)} />
          {openErrors > 0 && (
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              Open preflight errors will be reported to reviewers. You can still submit.
            </p>
          )}
          {form.visibility === 'marketplace' && (
            <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              Marketplace submissions are reviewed within 24 hours. You can sell once approved.
            </p>
          )}
        </div>
      </Modal>

      <p className="text-center text-xs text-muted-foreground">
        Book {book.status === 'published' ? 'live' : 'draft'} · last updated {formatDateTime(book.updatedAt)}
      </p>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  const id = `field-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium" htmlFor={id}>{label}</label>
      <Input id={id} type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function Metric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'success' | 'warning' | 'danger' }) {
  const toneClass = tone === 'success' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'warning' ? 'text-amber-600 dark:text-amber-400' : tone === 'danger' ? 'text-rose-600 dark:text-rose-400' : '';
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-lg font-semibold', toneClass)}>{value}</p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b pb-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

