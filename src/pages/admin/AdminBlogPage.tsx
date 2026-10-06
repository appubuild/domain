import * as React from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Pencil, Plus, Search, Star, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Separator, Switch, Textarea } from '@/components/ui/primitives';
import { Modal, useConfirm } from '@/components/ui/overlays';
import { EmptyState, StatCard } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { useBlogPosts, keys } from '@/hooks/queries';
import { cmsService } from '@/services';
import { formatDate, formatNumber, timeAgo } from '@/lib/format';
import { slugify } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { useAdminAction, FilterInput, FilterSelect, StatusPill, Toolbar } from './shared';
import type { BlogPost } from '@/types/domain';

export default function AdminBlogPage() {
  const confirm = useConfirm();
  const { success } = useToast();
  const qc = useQueryClient();
  const { data: posts, isLoading, refetch } = useBlogPosts(true);
  const [query, setQuery] = React.useState('');
  const [status, setStatus] = React.useState('all');
  const [sort, setSort] = React.useState<'recent' | 'title' | 'read'>('recent');
  const [editing, setEditing] = React.useState<Partial<BlogPost> | null>(null);

  const save = useAdminAction(
    (post: Partial<BlogPost>) => {
      const result = post.id ? cmsService.updatePost(post.id, post) : cmsService.createPost(post);
      qc.invalidateQueries({ queryKey: keys.blogPosts(true) });
      return result;
    },
    { success: 'Post saved', detail: 'The blog index updates immediately.', invalidate: [keys.blogPosts()] },
  );

  const rows = ((posts ?? []) as BlogPost[])
    .filter((post) => (status === 'all' || post.status === status) && (!query || `${post.title} ${post.category} ${post.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())))
    .sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title);
      if (sort === 'read') return b.readMinutes - a.readMinutes;
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });

  return (
    <div>
      <PageHeader title="Blog" description="Editorial content that feeds organic search and the resources menu.">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => setEditing({ title: '', excerpt: '', body: '', category: 'Craft', status: 'draft', tags: [], coverGradient: 'linear-gradient(135deg,#6366f1,#0ea5e9)', author: 'Scriptora team', authorAvatar: '', readMinutes: 5 })}><Plus className="h-3.5 w-3.5" /> New post</Button>
          <Button size="sm" variant="ghost" onClick={() => void refetch()}>Refresh</Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Posts" value={formatNumber(rows.length)} />
        <StatCard label="Published" value={formatNumber(rows.filter((post) => post.status === 'published').length)} />
        <StatCard label="Drafts" value={formatNumber(rows.filter((post) => post.status === 'draft').length)} />
        <StatCard label="Featured" value={formatNumber(rows.filter((post) => post.featured).length)} icon={<Star className="h-4 w-4" />} />
      </div>

      <Toolbar className="mt-4">
        <FilterInput label="Search posts" value={query} onChange={setQuery} placeholder="Search title, category or tag" />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, { value: 'published', label: 'Published' }, { value: 'draft', label: 'Drafts' }]} />
        <FilterSelect label="Sort" value={sort} onChange={(value) => setSort(value as typeof sort)} options={[{ value: 'recent', label: 'Newest' }, { value: 'title', label: 'Title' }, { value: 'read', label: 'Longest read' }]} />
      </Toolbar>

      {isLoading && <div className="space-y-2">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-lg bg-muted" />)}</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((post) => (
          <Card key={post.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start gap-3">
                <div className="h-14 w-20 shrink-0 rounded" style={{ background: post.coverGradient }} />
                <div className="min-w-0 flex-1">
                  <CardTitle className="truncate text-sm">{post.title}</CardTitle>
                  <CardDescription className="truncate text-2xs">{post.category} · {post.readMinutes} min read · {post.status === 'published' ? formatDate(post.publishedAt) : `draft · ${timeAgo(post.publishedAt)}`}</CardDescription>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <StatusPill value={post.status} />
                    {post.featured && <Badge variant="accent" className="text-2xs">featured</Badge>}
                    {post.tags.slice(0, 3).map((tag) => <Badge key={tag} variant="outline" className="text-2xs">{tag}</Badge>)}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="line-clamp-2 text-2xs text-muted-foreground">{post.excerpt}</p>
              <div className="flex flex-wrap gap-1">
                <Button size="xs" variant="outline" onClick={() => setEditing(post)}><Pencil className="h-3 w-3" /> Edit</Button>
                <Button size="xs" variant="outline" onClick={() => { cmsService.updatePost(post.id, { status: post.status === 'published' ? 'draft' : 'published' }); success(post.status === 'published' ? 'Moved back to draft' : 'Post published'); void refetch(); }}>{post.status === 'published' ? 'Unpublish' : 'Publish'}</Button>
                <Button size="xs" variant="ghost" onClick={() => { cmsService.updatePost(post.id, { featured: !post.featured }); success(post.featured ? 'Removed from featured' : 'Featured on the blog index'); void refetch(); }}>{post.featured ? 'Unfeature' : 'Feature'}</Button>
                <Link to={`/blog/${post.slug}`} className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-2xs hover:bg-muted"><ExternalLink className="h-3 w-3" /> Read</Link>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={async () => {
                    const ok = await confirm({ title: `Delete “${post.title}”?`, description: 'The public post URL stops resolving.', destructive: true, confirmLabel: 'Delete post' });
                    if (ok) { cmsService.removePost(post.id); success('Post deleted'); void refetch(); }
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!isLoading && rows.length === 0 && <EmptyState icon={<Search className="h-5 w-5" />} title="No posts match" description="Adjust the filters or write something new." actions={<Button onClick={() => setEditing({ title: '', excerpt: '', body: '', category: 'Craft', status: 'draft', tags: [] })}>New post</Button>} />}

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Categories in use</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">
          {Array.from(new Set(((posts ?? []) as BlogPost[]).map((post) => post.category))).map((category) => (
            <Badge key={category} variant="outline" className="text-2xs">{category}: {((posts ?? []) as BlogPost[]).filter((post) => post.category === category).length}</Badge>
          ))}
        </CardContent>
      </Card>

      <Modal
        open={Boolean(editing)}
        onOpenChange={(next) => !next && setEditing(null)}
        title={editing?.id ? `Edit “${editing.title}”` : 'New post'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!editing?.title || editing.title.length < 3) return;
                save.mutate({ ...editing, slug: editing.slug || slugify(editing.title) });
                setEditing(null);
              }}
            >
              Save post
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="b-title" className="text-xs">Title</Label><Input id="b-title" value={editing.title ?? ''} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="b-category" className="text-xs">Category</Label><Input id="b-category" value={editing.category ?? ''} onChange={(event) => setEditing({ ...editing, category: event.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="b-slug" className="text-xs">Slug</Label><Input id="b-slug" value={editing.slug ?? ''} onChange={(event) => setEditing({ ...editing, slug: event.target.value })} placeholder="auto from title" /></div>
              <div className="space-y-1.5"><Label htmlFor="b-read" className="text-xs">Read time (minutes)</Label><Input id="b-read" type="number" value={editing.readMinutes ?? 5} onChange={(event) => setEditing({ ...editing, readMinutes: Number(event.target.value) })} /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="b-excerpt" className="text-xs">Excerpt</Label><Textarea id="b-excerpt" rows={2} value={editing.excerpt ?? ''} onChange={(event) => setEditing({ ...editing, excerpt: event.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="b-body" className="text-xs">Body (HTML allowed)</Label><Textarea id="b-body" rows={8} value={editing.body ?? ''} onChange={(event) => setEditing({ ...editing, body: event.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="b-tags" className="text-xs">Tags (comma separated)</Label><Input id="b-tags" value={(editing.tags ?? []).join(', ')} onChange={(event) => setEditing({ ...editing, tags: event.target.value.split(',').map((entry) => entry.trim()).filter(Boolean) })} /></div>
            <div className="space-y-1.5"><Label htmlFor="b-gradient" className="text-xs">Cover gradient (CSS)</Label><Input id="b-gradient" value={editing.coverGradient ?? 'linear-gradient(135deg,#6366f1,#0ea5e9)'} onChange={(event) => setEditing({ ...editing, coverGradient: event.target.value })} /></div>
            <div className="mt-1 h-16 rounded" style={{ background: editing.coverGradient }} />
            <Separator />
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs">Published <Switch checked={editing.status === 'published'} onCheckedChange={(checked) => setEditing({ ...editing, status: checked ? 'published' : 'draft' })} /></label>
              <label className="flex items-center gap-2 text-xs">Featured <Switch checked={Boolean(editing.featured)} onCheckedChange={(checked) => setEditing({ ...editing, featured: checked })} /></label>
              <span className="text-2xs text-muted-foreground">Saving writes through the CMS service — the public blog reads the same store.</span>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
