/**
 * Pages index.
 *
 * Creating or editing a page opens the full-page builder (/admin/pages/new,
 * /admin/pages/:id). This screen groups pages by their `page_group`, filters by
 * status and shows which ones are scheduled or noindex.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExternalLink, FileText, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  PageHeader,
  SearchInput,
  Select,
} from '@/admin/components/ui'
import { useToast } from '@/admin/context/ToastContext'
import { contentApi, formatUtc, type ContentPage } from '@/admin/data/contentApi'
import { ADMIN_CONFIG } from '@/admin/config/adminConfig'

const STATUS_TONE = { published: 'success', scheduled: 'amber', draft: 'slate' } as const

export const PagesPage = () => {
  const navigate = useNavigate()
  const toast = useToast()
  const [pages, setPages] = useState<ContentPage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('all')
  const [group, setGroup] = useState('all')
  const [query, setQuery] = useState('')

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const result = await contentApi.listPages({ status, q: query })
      setPages(result.items)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pages could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [status, query])

  useEffect(() => {
    void load()
  }, [load])

  const groups = useMemo(() => Array.from(new Set(pages.map((page) => page.pageGroup).filter(Boolean))).sort(), [pages])

  const visible = useMemo(() => (group === 'all' ? pages : pages.filter((page) => page.pageGroup === group)), [pages, group])

  const remove = async (page: ContentPage): Promise<void> => {
    if (!window.confirm(`Delete “${page.title}”?`)) return
    try {
      await contentApi.deletePage(page.id)
      toast.success('Page deleted', page.title)
      await load()
    } catch (cause) {
      toast.error('Not deleted', cause instanceof Error ? cause.message : 'Try again.')
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pages"
        description={`${pages.length} pages · drafts, published and scheduled — each with its own SEO fields and rich-text body.`}
        actions={
          <Button size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={() => navigate('/admin/pages/new')}>
            New page
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery('')}
            placeholder="Search title or path"
            className="min-w-[220px] flex-1"
          />
          <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status" className="w-auto">
            <option value="all">All statuses</option>
            <option value="published">Published</option>
            <option value="scheduled">Scheduled</option>
            <option value="draft">Drafts</option>
          </Select>
          <Select value={group} onChange={(event) => setGroup(event.target.value)} aria-label="Filter by group" className="w-auto">
            <option value="all">All groups</option>
            {groups.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
          <Button variant="ghost" size="sm" iconLeft={<Search className="h-4 w-4" />} onClick={() => void load()}>
            Refresh
          </Button>
        </div>

        {error ? <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">{error}</div> : null}

        {loading ? (
          <div className="flex items-center gap-2 p-8 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading pages…
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-5 w-5" />}
            title="No pages match these filters"
            description="Create a page to publish long-form content, legal copy or a landing page."
            action={
              <Button size="sm" onClick={() => navigate('/admin/pages/new')}>
                New page
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-soft/60 text-left text-2xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-semibold">Page</th>
                  <th className="px-4 py-2 font-semibold">Group</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold">Updated</th>
                  <th className="px-4 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((page) => (
                  <tr key={page.id} className="border-b border-line last:border-0 hover:bg-soft/40">
                    <td className="max-w-[420px] px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => navigate(`/admin/pages/${page.id}`)}
                        className="block truncate text-left font-medium text-ink hover:text-brand-700"
                      >
                        {page.title}
                      </button>
                      <span className="block truncate font-mono text-2xs text-muted">
                        {page.slug}
                        {page.noindex ? ' · noindex' : ''}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">{page.pageGroup || '—'}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={STATUS_TONE[page.status]}>{page.status}</Badge>
                      {page.status === 'scheduled' ? (
                        <span className="mt-1 block text-2xs text-muted">{formatUtc(page.scheduledAt, ADMIN_CONFIG.publishing.timezone)}</span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">{formatUtc(page.updatedAt)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <IconButton label={`Edit ${page.title}`} onClick={() => navigate(`/admin/pages/${page.id}`)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </IconButton>
                        {page.status === 'published' ? (
                          <a
                            href={page.slug}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`View ${page.title}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-soft hover:text-ink"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : null}
                        <IconButton label={`Delete ${page.title}`} tone="danger" onClick={() => void remove(page)}>
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
    </div>
  )
}

export default PagesPage
