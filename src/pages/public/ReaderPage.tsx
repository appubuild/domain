import * as React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useBook, useLibrary } from '@/hooks/queries';
import { useAuth } from '@/providers/AuthProvider';
import { marketplaceService } from '@/services';
import { useToast } from '@/components/ui/toast';
import { Seo } from '@/components/shared/Seo';
import { Badge, Button, Slider, Skeleton } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/overlays';
import { ErrorState } from '@/components/ui/data';
import { cn, stripHtml } from '@/lib/utils';

type ReaderTheme = 'light' | 'dark' | 'sepia';

const THEMES: Record<ReaderTheme, { page: string; text: string; muted: string; chrome: string; border: string }> = {
  light: { page: 'bg-white', text: 'text-slate-900', muted: 'text-slate-500', chrome: 'bg-slate-100 text-slate-700', border: 'border-slate-200' },
  dark: { page: 'bg-slate-900', text: 'text-slate-100', muted: 'text-slate-400', chrome: 'bg-slate-950 text-slate-200', border: 'border-slate-800' },
  sepia: { page: 'bg-[#f6f0e4]', text: 'text-[#3b3127]', muted: 'text-[#7d6f5c]', chrome: 'bg-[#ece3d2] text-[#4a3f33]', border: 'border-[#ddd0b8]' },
};

export default function ReaderPage() {
  const { bookId } = useParams();
  const [params] = useSearchParams();
  const previewOnly = params.get('preview') === '1';
  const navigate = useNavigate();
  const { user } = useAuth();
  const { info, success } = useToast();

  const { data: book, isLoading, isError, refetch } = useBook(bookId);
  const { data: library } = useLibrary(user?.id);
  const libraryEntry = (library ?? []).find((entry) => entry.item.bookId === bookId);

  const [mode, setMode] = React.useState<'page' | 'scroll'>(libraryEntry?.item.readingMode === 'scroll' ? 'scroll' : 'page');
  const [theme, setTheme] = React.useState<ReaderTheme>('light');
  const [fontSize, setFontSize] = React.useState(libraryEntry?.item.fontSize ?? 18);
  const [pageIndex, setPageIndex] = React.useState(0);
  const [tocOpen, setTocOpen] = React.useState(false);
  const [bookmarks, setBookmarks] = React.useState<number[]>(libraryEntry?.item.bookmarkedPages ?? []);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [showChrome, setShowChrome] = React.useState(true);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (libraryEntry) {
      setBookmarks(libraryEntry.item.bookmarkedPages);
      setFontSize(libraryEntry.item.fontSize);
      setMode(libraryEntry.item.readingMode);
      setTheme(libraryEntry.item.readerTheme as ReaderTheme);
    }
  }, [libraryEntry]);

  const pages = React.useMemo(() => {
    if (!book) return [];
    return [...book.pages].sort((a, b) => {
      const indexA = book.sections.findIndex((section) => section.id === a.sectionId);
      const indexB = book.sections.findIndex((section) => section.id === b.sectionId);
      if (indexA !== indexB) return indexA - indexB;
      const section = book.sections.find((entry) => entry.id === a.sectionId);
      return (section?.pageIds.indexOf(a.id) ?? 0) - (section?.pageIds.indexOf(b.id) ?? 0);
    });
  }, [book]);

  const previewPages = previewOnly ? pages.slice(0, Math.min(6, pages.length)) : pages;
  const palette = THEMES[theme];

  const persistProgress = React.useCallback(
    (index: number) => {
      if (!user || !bookId || previewOnly) return;
      const progress = previewPages.length ? ((index + 1) / previewPages.length) * 100 : 0;
      marketplaceService.updateProgress(user.id, bookId, progress, index);
    },
    [user, bookId, previewOnly, previewPages.length],
  );

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault();
        setPageIndex((index) => Math.min(index + 1, previewPages.length - 1));
      }
      if (event.key === 'ArrowLeft') setPageIndex((index) => Math.max(index - 1, 0));
      if (event.key.toLowerCase() === 'b') toggleBookmark();
      if (event.key === 'Escape' && fullscreen) setFullscreen(false);
      if (event.key.toLowerCase() === 't') setTocOpen((open) => !open);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  React.useEffect(() => {
    persistProgress(pageIndex);
  }, [pageIndex, persistProgress]);

  const toggleBookmark = () => {
    setBookmarks((current) => (current.includes(pageIndex) ? current.filter((index) => index !== pageIndex) : [...current, pageIndex].sort((a, b) => a - b)));
    if (user && bookId) marketplaceService.setBookmark(user.id, bookId, pageIndex);
    info(bookmarks.includes(pageIndex) ? 'Bookmark removed' : `Page ${pageIndex + 1} bookmarked`);
  };

  const goFullscreen = async () => {
    setFullscreen((value) => !value);
    try {
      if (!fullscreen) await containerRef.current?.requestFullscreen?.();
      else await document.exitFullscreen?.();
    } catch {
      // Fullscreen may be blocked by the browser; the reader layout still expands.
    }
  };

  if (isLoading) {
    return (
      <div className="container space-y-4 py-10">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-[560px] w-full rounded-xl" />
      </div>
    );
  }

  if (isError || !book) {
    return (
      <div className="container py-16">
        <ErrorState title="This book is not available" description="It may have been unpublished by the author." onRetry={() => refetch()} />
      </div>
    );
  }

  const currentPage = previewPages[pageIndex];
  const progress = previewPages.length ? Math.round(((pageIndex + 1) / previewPages.length) * 100) : 0;

  const bodyText = (page: typeof currentPage) => {
    if (!page) return '';
    const elementText = page.elements
      .filter((element) => element.visible && element.text)
      .map((element) => stripHtml(element.text ?? ''))
      .join('\n\n');
    return stripHtml(page.content) || elementText;
  };

  return (
    <div ref={containerRef} className={cn('flex min-h-dvh flex-col', palette.chrome)}>
      <Seo
        title={`Reading ${book.title} — ${book.authorName}`}
        description={`Read ${book.title} by ${book.authorName} in the Scriptora reader.`}
        canonical={`/read/${book.id}`}
        noIndex
      />
      {showChrome && (
        <header className={cn('sticky top-0 z-40 border-b px-3 py-2.5 sm:px-5', palette.chrome, palette.border)}>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => navigate(`/marketplace/${book.id}`)}>
              ← Book page
            </Button>
            <div className="min-w-0 flex-1">
              <p className={cn('truncate text-sm font-semibold', palette.text)}>{book.title}</p>
              <p className={cn('truncate text-2xs', palette.muted)}>{book.authorName}</p>
            </div>
            {previewOnly && <Badge variant="accent">Free preview · 6 pages</Badge>}
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex items-center rounded-lg border border-current/20" role="group" aria-label="Reading mode">
                {(['page', 'scroll'] as const).map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => setMode(entry)}
                    aria-pressed={mode === entry}
                    className={cn('px-2.5 py-1.5 text-xs font-medium capitalize', mode === entry ? 'bg-black/10 dark:bg-white/10' : '')}
                  >
                    {entry}
                  </button>
                ))}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setTocOpen(true)} aria-label="Table of contents">
                Contents
              </Button>
              <Button size="sm" variant="ghost" onClick={toggleBookmark} aria-label="Toggle bookmark">
                {bookmarks.includes(pageIndex) ? '♥' : '♡'}
              </Button>
              <Button size="sm" variant="ghost" onClick={goFullscreen} aria-label="Toggle fullscreen">
                {fullscreen ? '⤡' : '⤢'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowChrome(false)} aria-label="Hide toolbar">
                ▲
              </Button>
              <select
                aria-label="Reader theme"
                value={theme}
                onChange={(event) => {
                  const next = event.target.value as ReaderTheme;
                  setTheme(next);
                  if (user && bookId) marketplaceService.updateReaderSettings(user.id, bookId, { readerTheme: next });
                }}
                className="h-8 rounded-lg border border-current/20 bg-transparent px-2 text-xs"
              >
                <option value="light">Light</option>
                <option value="sepia">Sepia</option>
                <option value="dark">Dark</option>
              </select>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <Slider
              min={12}
              max={28}
              value={fontSize}
              onChange={(next) => {
                setFontSize(next);
                if (user && bookId) marketplaceService.updateReaderSettings(user.id, bookId, { fontSize: next });
              }}
              className="w-[160px]"
              label="Font size"
              format={(value) => `${value}px`}
            />
            <div className="ml-auto flex flex-1 items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
              </div>
              <span className={cn('text-2xs tabular-nums', palette.muted)}>
                {pageIndex + 1} / {previewPages.length} · {progress}%
              </span>
            </div>
          </div>
        </header>
      )}

      {!showChrome && (
        <button
          type="button"
          onClick={() => setShowChrome(true)}
          className="fixed bottom-4 right-4 z-40 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-lift"
        >
          Show toolbar
        </button>
      )}

      <main ref={scrollRef} className={cn('flex-1 overflow-y-auto px-3 py-6 sm:px-6', theme === 'dark' && 'bg-slate-950')}>
        {mode === 'page' ? (
          <div className="mx-auto flex max-w-[900px] flex-col items-center gap-5">
            <article className={cn('w-full max-w-[680px] rounded-lg px-6 py-8 shadow-page ring-1 ring-black/5 sm:px-12 sm:py-14', palette.page, palette.text)}>
              <p className={cn('mb-6 text-2xs uppercase tracking-[0.2em]', palette.muted)}>
                {book.sections.find((section) => section.id === currentPage?.sectionId)?.title ?? book.title}
              </p>
              <h2 className="mb-5 font-serif text-xl font-semibold">{currentPage?.title ?? book.title}</h2>
              <div className="prose-scriptora whitespace-pre-line font-serif leading-[1.75]" style={{ fontSize: `${fontSize}px` }}>
                {bodyText(currentPage) || 'This page is intentionally blank.'}
              </div>
              <p className={cn('mt-10 text-center text-2xs tabular-nums', palette.muted)}>{pageIndex + 1}</p>
            </article>
            <div className="flex w-full max-w-[680px] items-center justify-between">
              <Button variant="outline" disabled={pageIndex === 0} onClick={() => setPageIndex((index) => Math.max(0, index - 1))}>
                ← Previous
              </Button>
              {bookmarks.includes(pageIndex) && <span className={cn('text-xs', palette.muted)}>Bookmarked</span>}
              <Button
                variant="outline"
                disabled={pageIndex >= previewPages.length - 1}
                onClick={() => setPageIndex((index) => Math.min(previewPages.length - 1, index + 1))}
              >
                Next →
              </Button>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-[680px] space-y-6">
            {previewPages.map((page, index) => (
              <article key={page.id} className={cn('rounded-lg px-6 py-8 shadow-page ring-1 ring-black/5 sm:px-10', palette.page, palette.text)}>
                <p className={cn('mb-4 text-2xs uppercase tracking-[0.2em]', palette.muted)}>
                  {book.sections.find((section) => section.id === page.sectionId)?.title ?? book.title}
                </p>
                <h2 className="mb-4 font-serif text-lg font-semibold">{page.title}</h2>
                <div className="prose-scriptora whitespace-pre-line font-serif leading-[1.75]" style={{ fontSize: `${fontSize}px` }}>
                  {bodyText(page) || 'This page is intentionally blank.'}
                </div>
                <div className="mt-6 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      setBookmarks((current) => (current.includes(index) ? current.filter((entry) => entry !== index) : [...current, index]));
                      if (user && bookId) marketplaceService.setBookmark(user.id, bookId, index);
                    }}
                    className={cn('text-xs', bookmarks.includes(index) ? 'text-primary' : palette.muted)}
                  >
                    {bookmarks.includes(index) ? '♥ Bookmarked' : '♡ Bookmark'}
                  </button>
                  <span className={cn('text-2xs tabular-nums', palette.muted)}>{index + 1}</span>
                </div>
              </article>
            ))}
          </div>
        )}

        {previewOnly && (
          <div className="mx-auto mt-8 max-w-[680px] rounded-xl border border-primary/30 bg-primary/5 p-5 text-center">
            <p className="text-sm font-semibold text-foreground">You have reached the end of the free preview</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {book.marketplace.price === 0 ? 'This book is free — add it to your library to keep reading.' : `Buy the full book for $${book.marketplace.price.toFixed(2)} to continue.`}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Button onClick={() => navigate(`/marketplace/${book.id}`)}>Get the full book</Button>
              <Button variant="outline" onClick={() => navigate('/marketplace')}>
                Keep browsing
              </Button>
            </div>
          </div>
        )}

        {!previewOnly && !libraryEntry && user && (
          <div className="mx-auto mt-8 max-w-[680px] rounded-xl border border-border bg-card p-5 text-center">
            <p className="text-sm text-foreground">This book is not in your library yet.</p>
            <Button className="mt-3" onClick={() => navigate(`/marketplace/${book.id}`)}>
              Go to the book page
            </Button>
          </div>
        )}
      </main>

      <Sheet open={tocOpen} onOpenChange={setTocOpen} side="right" size="md">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-foreground">Contents</p>
            <button type="button" onClick={() => setTocOpen(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
            {book.sections.map((section) => {
              const firstIndex = previewPages.findIndex((page) => page.sectionId === section.id);
              return (
                <div key={section.id} className="mb-2">
                  <button
                    type="button"
                    disabled={firstIndex < 0}
                    onClick={() => {
                      if (firstIndex >= 0) {
                        setPageIndex(firstIndex);
                        setTocOpen(false);
                      }
                    }}
                    className={cn(
                      'w-full rounded-lg px-3 py-2 text-left text-sm',
                      firstIndex < 0 ? 'cursor-not-allowed text-muted-foreground/50' : 'text-foreground hover:bg-muted',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate">{section.title}</span>
                      <span className="text-2xs text-muted-foreground">{firstIndex >= 0 ? firstIndex + 1 : '—'}</span>
                    </span>
                    <span className="mt-0.5 block text-2xs capitalize text-muted-foreground">
                      {section.kind.replace('-', ' ')} · {section.wordCount.toLocaleString()} words
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          {bookmarks.length > 0 && (
            <div className="border-t border-border p-3">
              <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Bookmarks</p>
              <div className="flex flex-wrap gap-1.5">
                {bookmarks.map((index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => {
                      setPageIndex(Math.min(index, previewPages.length - 1));
                      setTocOpen(false);
                    }}
                    className="rounded-full border border-border px-2.5 py-1 text-xs text-foreground hover:border-primary"
                  >
                    Page {index + 1}
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="mt-3 w-full"
                onClick={() => {
                  setBookmarks([]);
                  info('Bookmarks cleared for this session');
                }}
              >
                Clear bookmarks
              </Button>
            </div>
          )}
          <div className="border-t border-border p-3">
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => {
                const next = mode === 'page' ? 'scroll' : 'page';
                setMode(next);
                if (user && bookId) marketplaceService.updateReaderSettings(user.id, bookId, { readingMode: next });
                setTocOpen(false);
                success(`Switched to ${next} view`);
              }}
            >
              Switch to {mode === 'page' ? 'scroll' : 'page'} view
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
