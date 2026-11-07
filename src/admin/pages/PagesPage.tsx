import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, Eye, EyeOff, FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { repository, type NewPage } from '@/admin/data/repository'
import type { ContentStatus, PageRecord } from '@/admin/types/admin'
import { contentStatusTone } from '@/admin/lib/selectors'
import { formatDate } from '@/admin/lib/format'
import { DataTable, type Column } from '@/admin/components/DataTable'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Select,
  Textarea,
} from '@/admin/components/ui'
import { useToast } from '@/admin/context/ToastContext'

interface PageFormState {
  title: string
  slug: string
  template: PageRecord['template']
  status: ContentStatus
  excerpt: string
  seoTitle: string
  seoDescription: string
}

const emptyForm: PageFormState = {
  title: '',
  slug: '/',
  template: 'standard',
  status: 'draft',
  excerpt: '',
  seoTitle: '',
  seoDescription: '',
}

export const PagesPage = () => {
  const toast = useToast()
  const [pages, setPages] = useState<PageRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [editing, setEditing] = useState<PageRecord | null>(null)
  const [form, setForm] = useState<PageFormState>(emptyForm)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PageRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    try {
      setPages(await repository.listPages())
    } catch {
      toast.error('Could not load pages')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(
    () => pages.filter((page) => (statusFilter === 'all' ? true : page.status === statusFilter)),
    [pages, statusFilter],
  )

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  const openEdit = (page: PageRecord) => {
    setEditing(page)
    setForm({
      title: page.title,
      slug: page.slug,
      template: page.template,
      status: page.status,
      excerpt: page.excerpt,
      seoTitle: page.seoTitle,
      seoDescription: page.seoDescription,
    })
    setFormError(null)
    setModalOpen(true)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.title.trim()) {
      setFormError('A page title is required.')
      return
    }
    setSaving(true)
    setFormError(null)
    const payload: NewPage = {
      title: form.title.trim(),
      slug: form.slug.trim(),
      template: form.template,
      status: form.status,
      excerpt: form.excerpt.trim(),
      seoTitle: form.seoTitle.trim() || form.title.trim(),
      seoDescription: form.seoDescription.trim(),
    }
    try {
      if (editing) {
        await repository.updatePage(editing.id, payload)
        toast.success('Page updated', `${payload.title} saved.`)
      } else {
        await repository.createPage(payload)
        toast.success('Page created', `${payload.title} added as ${payload.status}.`)
      }
      setModalOpen(false)
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save the page.'
      setFormError(message)
      toast.error('Save failed', message)
    } finally {
      setSaving(false)
    }
  }

  const togglePublish = async (page: PageRecord) => {
    const status: ContentStatus = page.status === 'published' ? 'draft' : 'published'
    try {
      await repository.updatePage(page.id, { status })
      toast.success(status === 'published' ? 'Page published' : 'Page unpublished', page.title)
      await load()
    } catch {
      toast.error('Could not change the page status')
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await repository.deletePage(pendingDelete.id)
      toast.success('Page deleted', `${pendingDelete.title} removed.`)
      setPendingDelete(null)
      await load()
    } catch (error) {
      toast.error('Delete failed', error instanceof Error ? error.message : undefined)
    } finally {
      setDeleting(false)
    }
  }

  const columns: Column<PageRecord>[] = [
    {
      key: 'title',
      header: 'Page',
      render: (row) => (
        <div className="min-w-0">
          <p className="font-semibold text-ink">{row.title}</p>
          <p className="truncate font-mono text-2xs text-muted">{row.slug}</p>
        </div>
      ),
      sortValue: (row) => row.title,
    },
    {
      key: 'template',
      header: 'Template',
      hideBelow: 'sm',
      render: (row) => <Badge tone="slate">{row.template}</Badge>,
      sortValue: (row) => row.template,
    },
    {
      key: 'seo',
      header: 'SEO title',
      hideBelow: 'lg',
      render: (row) => <span className="block max-w-[16rem] truncate text-xs text-muted">{row.seoTitle}</span>,
      sortValue: (row) => row.seoTitle,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <Badge tone={contentStatusTone(row.status)}>{row.status}</Badge>,
      sortValue: (row) => row.status,
    },
    {
      key: 'updated',
      header: 'Updated',
      hideBelow: 'md',
      render: (row) => (
        <div>
          <p className="text-xs text-ink">{formatDate(row.updatedAt)}</p>
          <p className="text-2xs text-muted">{row.updatedBy}</p>
        </div>
      ),
      sortValue: (row) => row.updatedAt,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          <IconButton
            label={row.status === 'published' ? `Unpublish ${row.title}` : `Publish ${row.title}`}
            onClick={() => togglePublish(row)}
          >
            {row.status === 'published' ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </IconButton>
          <IconButton label={`Edit ${row.title}`} onClick={() => openEdit(row)}>
            <Pencil className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label={`Delete ${row.title}`} tone="danger" onClick={() => setPendingDelete(row)}>
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pages"
        description="Manage the site's static pages: publish, unpublish and edit their SEO metadata."
        meta={
          <>
            <Badge tone="brand">{pages.length} pages</Badge>
            <Badge tone="success">{pages.filter((page) => page.status === 'published').length} published</Badge>
            <Badge tone="slate">{pages.filter((page) => page.status === 'draft').length} drafts</Badge>
          </>
        }
        actions={
          <>
            <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status" className="w-36">
              <option value="all">All statuses</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
            </Select>
            <Button size="sm" onClick={openCreate} iconLeft={<Plus className="h-4 w-4" />}>
              New page
            </Button>
          </>
        }
      />

      <Card>
        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          searchText={(row) => `${row.title} ${row.slug} ${row.seoTitle}`}
          searchPlaceholder="Search pages…"
          pageSize={8}
          initialSort={{ key: 'title', direction: 'asc' }}
          emptyTitle="No pages match"
          emptyDescription="Create a page or clear the status filter."
        />
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.title}` : 'New page'}
        description="Demo content only — the public pages are compiled from the site source until Phase 2."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" form="page-form" type="submit" loading={saving}>
              {editing ? 'Save changes' : 'Create page'}
            </Button>
          </>
        }
      >
        <form id="page-form" onSubmit={submit} className="space-y-4">
          {formError ? (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
              {formError}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title" htmlFor="page-title" required>
              <Input
                id="page-title"
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                required
              />
            </Field>
            <Field label="Path" htmlFor="page-slug" hint="Start with a slash, e.g. /about">
              <Input
                id="page-slug"
                value={form.slug}
                onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Template" htmlFor="page-template">
              <Select
                id="page-template"
                value={form.template}
                onChange={(event) => setForm((current) => ({ ...current, template: event.target.value as PageRecord['template'] }))}
              >
                <option value="standard">Standard</option>
                <option value="landing">Landing</option>
                <option value="legal">Legal</option>
              </Select>
            </Field>
            <Field label="Status" htmlFor="page-status">
              <Select
                id="page-status"
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as ContentStatus }))}
              >
                <option value="published">Published</option>
                <option value="draft">Draft</option>
              </Select>
            </Field>
          </div>

          <Field label="Summary" htmlFor="page-excerpt">
            <Textarea
              id="page-excerpt"
              rows={2}
              value={form.excerpt}
              onChange={(event) => setForm((current) => ({ ...current, excerpt: event.target.value }))}
            />
          </Field>

          <Field label="SEO title" htmlFor="page-seo-title">
            <Input
              id="page-seo-title"
              value={form.seoTitle}
              onChange={(event) => setForm((current) => ({ ...current, seoTitle: event.target.value }))}
            />
          </Field>

          <Field label="SEO description" htmlFor="page-seo-description" hint={`${form.seoDescription.length}/160 characters`}>
            <Textarea
              id="page-seo-description"
              rows={2}
              value={form.seoDescription}
              onChange={(event) => setForm((current) => ({ ...current, seoDescription: event.target.value.slice(0, 160) }))}
            />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete page?"
        description={`“${pendingDelete?.title ?? ''}” will be removed from the demo workspace.`}
        confirmLabel="Delete page"
        loading={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />

      {!loading && pages.length === 0 ? (
        <Card className="flex items-center gap-3 px-5 py-4 text-sm text-muted">
          <FileText className="h-4 w-4" /> No pages yet.
          <ExternalLink className="ml-auto h-4 w-4" />
        </Card>
      ) : null}
    </div>
  )
}
