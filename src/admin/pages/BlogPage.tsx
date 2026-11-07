/**
 * Blog index.
 *
 * The old version edited posts in a modal; the editor now lives on its own
 * route (/admin/blog/new and /admin/blog/:id) and this screen is the list:
 * filter by status/category, search, see the schedule, then jump into the
 * editor or flip a post live without leaving the table.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, Eye, EyeOff, ExternalLink, Loader2, Newspaper, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  PageHeader,
  SearchInput,
  Select,
  cn,
} from '@/admin/components/ui'
import { useToast } from '@/admin/context/ToastContext'
import { contentApi, formatUtc, type ContentCategory, type ContentPost } from '@/admin/data/contentApi'
import { ADMIN_CONFIG } from '@/admin/config/adminConfig'

const STATUS_TONE = { published: 'success', scheduled: 'amber', draft: 'slate' } as const

export const BlogPage = () => {
  const navigate = useNavigate()
  const toast = useToast()
  const [posts, setPosts] = useState<ContentPost[]>([])
  const [categories, setCategories] = useState<ContentCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('all')
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const [result, categoryList] = await Promise.all([
        contentApi.listPosts({ status, category, q: query, perPage: 100 }),
        contentApi.listCategories(),
      ])
      setPosts(result.items)
      setCategories(categoryList)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Posts could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [status, category, query])

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(
    () => ({
      published: posts.filter((post) => post.status === 'published').length,
      scheduled: posts.filter((post) => post.status === 'scheduled').length,
      draft: posts.filter((post) => post.status === 'draft').length,
    }),
    [posts],
  )

  const toggleStatus = async (post: ContentPost): Promise<void> => {
    setBusyId(post.id)
    try {
      const next = post.status === 'published' ? 'draft' : 'published'
      await contentApi.setStatus(post.id, next)
      toast.success(next === 'published' ? 'Post published' : 'Post moved to draft', post.title)
      await load()
    } catch (cause) {
      toast.error('Status not changed', cause instanceof Error ? cause.message : 'Try again.')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (post: ContentPost): Promise<void> => {
    if (!window.confirm(`Delete “${post.title}”?`)) return
    setBusyId(post.id)
    try {
      await contentApi.deletePost(post.id)
      toast.success('Post deleted', post.title)
      await load()
    } catch (cause) {
      toast.error('Not deleted', cause instanceof Error ? cause.message : 'Try again.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Blog"
        description={`${posts.length} posts · ${counts.published} published · ${counts.scheduled} scheduled · ${counts.draft} drafts`}
        actions={
          <Button size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={() => navigate('/admin/blog/new')}>
            New post
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery('')}
            placeholder="Search title, slug or excerpt"
            className="min-w-[220px] flex-1"
          />
          <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status" className="w-auto">
            <option value="all">All statuses</option>
            <option value="published">Published</option>
            <option value="scheduled">Scheduled</option>
            <option value="draft">Drafts</option>
          </Select>
          <Select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category" className="w-auto">
            <option value="all">All categories</option>
            {categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
          <Button variant="ghost" size="sm" iconLeft={<Search className="h-4 w-4" />} onClick={() => void load()}>
            Refresh
          </Button>
        </div>

        {error ? (
          <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">{error}</div>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 p-8 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading posts…
          </div>
        ) : posts.length === 0 ? (
          <EmptyState
            icon={<Newspaper className="h-5 w-5" />}
            title="No posts match these filters"
            description="Clear the filters, or start a new article in the full-page editor."
            action={
              <Button size="sm" onClick={() => navigate('/admin/blog/new')}>
                New post
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-soft/60 text-left text-2xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-semibold">Post</th>
                  <th className="px-4 py-2 font-semibold">Category</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold">Publish / schedule</th>
                  <th className="px-4 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => (
                  <tr key={post.id} className="border-b border-line last:border-0 hover:bg-soft/40">
                    <td className="max-w-[420px] px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => navigate(`/admin/blog/${post.id}`)}
                        className="block truncate text-left font-medium text-ink hover:text-brand-700"
                      >
                        {post.title}
                      </button>
                      <span className="block truncate font-mono text-2xs text-muted">/blog/{post.slug}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">
                      {categories.find((item) => item.id === post.categoryId)?.name ?? post.categoryName ?? '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={STATUS_TONE[post.status]}>{post.status}</Badge>
                      {post.focusKeyword ? (
                        <span className="mt-1 block truncate text-2xs text-muted" title={post.focusKeyword}>
                          {post.focusKeyword}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">
                      {post.status === 'scheduled'
                        ? formatUtc(post.scheduledAt || post.publishedAt, ADMIN_CONFIG.publishing.timezone)
                        : post.status === 'published'
                          ? formatUtc(post.publishedAt, ADMIN_CONFIG.publishing.timezone)
                          : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <IconButton label={`Edit ${post.title}`} onClick={() => navigate(`/admin/blog/${post.id}`)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton
                          label={post.status === 'published' ? `Unpublish ${post.title}` : `Publish ${post.title}`}
                          onClick={() => void toggleStatus(post)}
                          disabled={busyId === post.id}
                        >
                          {post.status === 'published' ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </IconButton>
                        {post.status === 'published' ? (
                          <a
                            href={`/blog/${post.slug}`}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`View ${post.title}`}
                            className={cn('inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-soft hover:text-ink')}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : null}
                        <IconButton label={`Delete ${post.title}`} tone="danger" onClick={() => void remove(post)} disabled={busyId === post.id}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="flex items-center gap-1.5 text-2xs text-muted">
        <CalendarClock className="h-3 w-3" /> Scheduled posts publish automatically within five minutes of their time.
      </p>
    </div>
  )
}

export default BlogPage
