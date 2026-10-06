import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, Clock, Crown, Filter, Layers, Loader2, Search as SearchIcon, Sparkles, Star, Trash2, User, Users, X,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Separator } from '@/components/ui/primitives';
import { Tabs } from '@/components/ui/overlays';
import { EmptyState } from '@/components/ui/data';
import { useToast } from '@/components/ui/toast';
import { useSearch } from '@/hooks/queries';
import { searchService } from '@/services';
import { formatCurrency, formatNumber } from '@/lib/format';

type Scope = 'all' | 'books' | 'templates' | 'authors' | 'categories';

export default function SearchResultsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { success } = useToast();
  const qc = useQueryClient();
  const initial = params.get('q') ?? '';
  const [term, setTerm] = React.useState(initial);
  const [query, setQuery] = React.useState(initial);
  const [scope, setScope] = React.useState<Scope>('all');
  const [recent, setRecent] = React.useState<string[]>(() => searchService.recent());
  const [debouncing, setDebouncing] = React.useState(false);

  React.useEffect(() => {
    if (term === query) return;
    setDebouncing(true);
    const timer = window.setTimeout(() => {
      setQuery(term);
      setDebouncing(false);
      const next = new URLSearchParams(params);
      if (term.trim()) next.set('q', term);
      else next.delete('q');
      setParams(next, { replace: true });
      if (term.trim().length > 2) searchService.pushRecent(term.trim());
    }, 260);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const { data: results, isFetching } = useSearch(query);
  const suggestions = searchService.suggestions(term);

  const runSearch = (value: string) => {
    setTerm(value);
    setRecent(searchService.recent());
  };

  const total = results?.total ?? 0;
  const scopeCounts = {
    all: total,
    books: results?.books.length ?? 0,
    templates: results?.templates.length ?? 0,
    authors: results?.authors.length ?? 0,
    categories: results?.categories.length ?? 0,
  };

  const showBooks = scope === 'all' || scope === 'books';
  const showTemplates = scope === 'all' || scope === 'templates';
  const showAuthors = scope === 'all' || scope === 'authors';
  const showCategories = scope === 'all' || scope === 'categories';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-muted-foreground">Books, templates, authors and categories — searched across the whole workspace and marketplace.</p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="relative">
            {isFetching || debouncing ? (
              <Loader2 className="pointer-events-none absolute left-3 top-3 h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <SearchIcon className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            )}
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') runSearch(term); }}
              placeholder="Search books, templates, authors, categories…"
              className="h-10 pl-9 pr-9 text-sm"
              autoFocus
              aria-label="Search"
            />
            {term && (
              <button type="button" onClick={() => setTerm('')} className="absolute right-3 top-3 text-muted-foreground hover:text-foreground" aria-label="Clear search">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><Filter className="h-3.5 w-3.5" /> Scope</span>
            <Tabs
              value={scope}
              onValueChange={(value) => setScope(value as Scope)}
              tabs={[
                { value: 'all', label: 'All', count: scopeCounts.all },
                { value: 'books', label: 'Books', count: scopeCounts.books },
                { value: 'templates', label: 'Templates', count: scopeCounts.templates },
                { value: 'authors', label: 'Authors', count: scopeCounts.authors },
                { value: 'categories', label: 'Categories', count: scopeCounts.categories },
              ]}
            />
          </div>

          {suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Try:</span>
              {suggestions.slice(0, 6).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => runSearch(suggestion)}
                  className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {!query.trim() && (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Start typing to search</CardTitle>
              <CardDescription>Everything you can see in the app is searchable — your books, the template library, authors and marketplace categories.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {[
                { icon: <BookOpen className="h-4 w-4" />, title: 'Your books', detail: 'Titles, tags and descriptions across drafts and published work.' },
                { icon: <Layers className="h-4 w-4" />, title: 'Templates', detail: 'Search by name, style or tag to find a starting layout.' },
                { icon: <Users className="h-4 w-4" />, title: 'Authors', detail: 'Find other writers by name, handle or tagline.' },
                { icon: <Sparkles className="h-4 w-4" />, title: 'Categories', detail: 'Jump to a marketplace or template category.' },
              ].map((row) => (
                <div key={row.title} className="rounded-lg border p-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">{row.icon} {row.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{row.detail}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Recent searches</CardTitle>
                <CardDescription>Stored locally</CardDescription>
              </div>
              {recent.length > 0 && (
                <Button variant="ghost" size="xs" onClick={() => { searchService.clearRecent(); setRecent([]); success('Recent searches cleared'); }}>
                  <Trash2 className="h-3 w-3" /> Clear
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-1.5">
              {recent.length === 0 && <p className="text-sm text-muted-foreground">No recent searches yet.</p>}
              {recent.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  onClick={() => runSearch(entry)}
                  className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:border-primary/40"
                >
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" /> {entry}
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {query.trim() && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {isFetching ? 'Searching…' : total === 0 ? `No results for “${query}”` : `${formatNumber(total)} result${total === 1 ? '' : 's'} for “${query}”`}
            </p>
            {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          {total === 0 && !isFetching && (
            <EmptyState
              icon={<SearchIcon className="h-5 w-5" />}
              title={`Nothing matched “${query}”`}
              description="Check the spelling, try a broader term, or browse the marketplace and template gallery instead."
              actions={
                <>
                  <Button variant="outline" size="sm" onClick={() => navigate('/marketplace')}>Browse marketplace</Button>
                  <Button variant="outline" size="sm" onClick={() => navigate('/dashboard/templates')}>Browse templates</Button>
                </>
              }
            />
          )}

          <div className="space-y-6">
            {showBooks && (results?.books.length ?? 0) > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-serif text-lg font-semibold">Books</h2>
                  <Button variant="ghost" size="xs" onClick={() => setScope('books')}>See all {results?.books.length}</Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {(results?.books ?? []).map((book) => (
                    <Link key={book.id} to={`/books/${book.id}`} className="overflow-hidden rounded-xl border transition-colors hover:border-primary/50">
                      <div className="flex h-[150px] items-center justify-center bg-muted/40 p-3">
                        <div className="h-full w-[100px] overflow-hidden rounded shadow-page">
                          {book.cover.imageUrl ? <img src={book.cover.imageUrl} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full bg-brand-gradient" />}
                        </div>
                      </div>
                      <div className="p-3">
                        <p className="truncate text-sm font-medium">{book.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{book.authorName}</p>
                        <div className="mt-1.5 flex items-center justify-between text-xs">
                          <span className="font-medium">{book.marketplace.price === 0 ? 'Free' : formatCurrency(book.marketplace.price)}</span>
                          <span className="inline-flex items-center gap-1 text-muted-foreground"><Star className="h-3 w-3 fill-amber-400 text-amber-400" />{book.marketplace.rating.toFixed(1)}</span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {showTemplates && (results?.templates.length ?? 0) > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-serif text-lg font-semibold">Templates</h2>
                  <Button variant="ghost" size="xs" onClick={() => setScope('templates')}>See all {results?.templates.length}</Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {(results?.templates ?? []).map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => navigate('/dashboard/templates')}
                      className="flex items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:border-primary/50"
                    >
                      <div className="h-14 w-11 shrink-0 overflow-hidden rounded" style={{ background: template.accentColor }}>
                        <div className="h-full w-full bg-white/10" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{template.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{template.style} · {template.pageCount} pages</p>
                        <div className="mt-1 flex items-center gap-1.5">
                          {template.premium && <Badge variant="accent" className="text-2xs"><Crown className="h-2.5 w-2.5" /> Premium</Badge>}
                          <span className="text-2xs text-muted-foreground">{formatNumber(template.uses)} uses</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {showAuthors && (results?.authors.length ?? 0) > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-serif text-lg font-semibold">Authors</h2>
                  <Button variant="ghost" size="xs" onClick={() => setScope('authors')}>See all {results?.authors.length}</Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {(results?.authors ?? []).map((author) => (
                    <button
                      key={author.id}
                      type="button"
                      onClick={() => navigate(`/authors/${author.username}`)}
                      className="flex items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:border-primary/50"
                    >
                      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-muted">
                        {author.avatarUrl ? <img src={author.avatarUrl} alt="" className="h-full w-full object-cover" /> : <User className="m-2.5 h-6 w-6 text-muted-foreground" />}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{author.name}</p>
                        <p className="truncate text-xs text-muted-foreground">@{author.username}</p>
                        {author.tagline && <p className="truncate text-xs text-muted-foreground">{author.tagline}</p>}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {showCategories && (results?.categories.length ?? 0) > 0 && (
              <section className="space-y-3">
                <h2 className="font-serif text-lg font-semibold">Categories</h2>
                <div className="flex flex-wrap gap-2">
                  {(results?.categories ?? []).map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => navigate('/marketplace')}
                      className="rounded-full border px-3 py-1.5 text-sm transition-colors hover:border-primary/50"
                    >
                      {category.name}
                      <span className="ml-1.5 text-xs text-muted-foreground">{category.kind}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </>
      )}

      <Separator />
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <p>Search is powered by the same service layer as the command palette (⌘K).</p>
        <Button variant="ghost" size="xs" onClick={() => { qc.invalidateQueries({ queryKey: ['search'] }); success('Search index refreshed'); }}>
          Refresh index
        </Button>
      </div>
    </div>
  );
}
