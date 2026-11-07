import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, ImageIcon, Newspaper, Pencil, Plus, Trash2 } from 'lucide-react'
import { repository, type NewPost } from '@/admin/data/repository'
import type { BlogPost, ContentStatus } from '@/admin/types/admin'
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

const CATEGORIES = ['Roofing', 'HVAC', 'Plumbing', 'Electrical', 'Restoration', 'Remodeling', 'Locksmith', 'Pest control', 'Windows', 'General']

interface PostFormState {
  title: string
  slug: string
  category: string
  status: ContentStatus
  excerpt: string
  featuredImage: string
  seoTitle: string
  seoDescription: string
  author: string
  publishedAt: string
}

const today = (): string => new Date().toISOString().slice(0, 10)

const emptyForm: PostFormState = {
  title: '',
  slug: '',
  category: 'General',
  status: 'draft',
  excerpt: '',
  featuredImage: '',
  seoTitle: '',
  seoDescription: '',
  author: 'Editorial team',
  publishedAt: today(),
}

export const BlogPage = () => {
  const toast = useToast()
  const [posts, setPosts] = useState<BlogPost[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [editing, setEditing] = useState<BlogPost | null>(null)
  const [form, setForm] = useState<PostFormState>(emptyForm)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<BlogPost | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    try {
      setPosts(await repository.listPosts())
    } catch {
      toast.error('Could not load blog posts')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(
    () =>
      posts.filter((post) => {
        if (statusFilter !== 'all' && post.status !== statusFilter) return false
        if (categoryFilter !== 'all' && post.category !== categoryFilter) return false
        return true
      }),
    [posts, statusFilter, categoryFilter],
  )

  const openCreate = () => {
    setEditing(null)
    setForm({ ...emptyForm, publishedAt: today() })
    setFormError(null)
    setModalOpen(true)
  }

  const openEdit = (post: BlogPost) => {
    setEditing(post)
    setForm({
      title: post.title,
      slug: post.slug,
      category: post.category,
      status: post.status,
      excerpt: post.excerpt,
      featuredImage: post.featuredImage,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      author: post.author,
      publishedAt: post.publishedAt.slice(0, 10),
    })
    setFormError(null)
    setModalOpen(true)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.title.trim()) {
      setFormError('A post title is required.')
      return
    }
    setSaving(true)
    setFormError(null)
    const payload: NewPost = {
      title: form.title.trim(),
      slug: form.slug.trim() || form.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      category: form.category,
      status: form.status,
      excerpt: form.excerpt.trim(),
      featuredImage: form.featuredImage.trim(),
      seoTitle: form.seoTitle.trim() || form.title.trim(),
      seoDescription: form.seoDescription.trim(),
      author: form.author.trim() || 'Editorial team',
      publishedAt: new Date(`${form.publishedAt}T09:00:00.000Z`).toISOString(),
    }
    try {
      if (editing) {
        await repository.updatePost(editing.id, payload)
        toast.success('Post updated', payload.title)
      } else {
        await repository.createPost(payload)
        toast.success('Post created', `${payload.title} saved as ${payload.status}.`)
      }
      setModalOpen(false)
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save the post.'
      setFormError(message)
      toast.error('Save failed', message)
    } finally {
      setSaving(false)
    }
  }

  const togglePublish = async (post: BlogPost) => {
    const status: ContentStatus = post.status === 'published' ? 'draft' : 'published'
    try {
      await repository.updatePost(post.id, { status })
      toast.success(status === 'published' ? 'Post published' : 'Post unpublished', post.title)
      await load()
    } catch {
      toast.error('Could not change the post status')
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await repository.deletePost(pendingDelete.id)
      toast.success('Post deleted', pendingDelete.title)
      setPendingDelete(null)
      await load()
    } catch (error) {
      toast.error('Delete failed', error instanceof Error ? error.message : undefined)
    } finally {
      setDeleting(false)
    }
  }

  const columns: Column<BlogPost>[] = [
    {
      key: 'title',
      header: 'Post',
      render: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-soft ring-1 ring-line">
            {row.featuredImage ? (
              // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
              <img src={row.featuredImage} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <ImageIcon className="h-4 w-4 text-muted" />
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">{row.title}</p>
            <p className="truncate font-mono text-2xs text-muted">/blog/{row.slug}</p>
          </div>
        </div>
      ),
      sortValue: (row) => row.title,
    },
    {
      key: 'category',
      header: 'Category',
      hideBelow: 'sm',
      render: (row) => <Badge tone="slate">{row.category}</Badge>,
      sortValue: (row) => row.category,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <Badge tone={contentStatusTone(row.status)}>{row.status}</Badge>,
      sortValue: (row) => row.status,
    },
    {
      key: 'publishedAt',
      header: 'Publish date',
      hideBelow: 'md',
      render: (row) => <span className="text-xs text-muted">{formatDate(row.publishedAt)}</span>,
      sortValue: (row) => row.publishedAt,
    },
    {
      key: 'author',
      header: 'Author',
      hideBelow: 'lg',
      render: (row) => <span className="text-xs text-muted">{row.author}</span>,
      sortValue: (row) => row.author,
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
        title="Blog"
        description="Write, categorise and schedule posts with their own featured image and SEO metadata."
        meta={
          <>
            <Badge tone="brand">{posts.length} posts</Badge>
            <Badge tone="success">{posts.filter((post) => post.status === 'published').length} published</Badge>
            <Badge tone="violet">{posts.filter((post) => post.status === 'scheduled').length} scheduled</Badge>
          </>
        }
        actions={
          <Button size="sm" onClick={openCreate} iconLeft={<Plus className="h-4 w-4" />}>
            New post
          </Button>
        }
      />

      <Card>
        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          searchText={(row) => `${row.title} ${row.slug} ${row.category} ${row.author}`}
          searchPlaceholder="Search posts…"
          pageSize={8}
          initialSort={{ key: 'publishedAt', direction: 'desc' }}
          emptyTitle="No posts match"
          emptyDescription="Create a post or clear the filters."
          toolbar={
            <>
              <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status" className="w-36">
                <option value="all">All statuses</option>
                <option value="published">Published</option>
                <option value="draft">Draft</option>
                <option value="scheduled">Scheduled</option>
              </Select>
              <Select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filter by category" className="w-36">
                <option value="all">All categories</option>
                {Array.from(new Set(posts.map((post) => post.category))).map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </Select>
            </>
          }
        />
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit “${editing.title}”` : 'New blog post'}
        description="Demo content only — no post is written to the public site until the Phase 2 API exists."
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" form="post-form" type="submit" loading={saving}>
              {editing ? 'Save changes' : 'Create post'}
            </Button>
          </>
        }
      >
        <form id="post-form" onSubmit={submit} className="space-y-4">
          {formError ? (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
              {formError}
            </p>
          ) : null}

          <Field label="Title" htmlFor="post-title" required>
            <Input
              id="post-title"
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              required
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Slug" htmlFor="post-slug" hint="Auto-generated from the title when empty.">
              <Input
                id="post-slug"
                value={form.slug}
                onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
              />
            </Field>
            <Field label="Category" htmlFor="post-category">
              <Select
                id="post-category"
                value={form.category}
                onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
              >
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Status" htmlFor="post-status">
              <Select
                id="post-status"
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as ContentStatus }))}
              >
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="scheduled">Scheduled</option>
              </Select>
            </Field>
            <Field label="Publish date" htmlFor="post-date">
              <Input
                id="post-date"
                type="date"
                value={form.publishedAt}
                onChange={(event) => setForm((current) => ({ ...current, publishedAt: event.target.value }))}
              />
            </Field>
            <Field label="Author" htmlFor="post-author">
              <Input
                id="post-author"
                value={form.author}
                onChange={(event) => setForm((current) => ({ ...current, author: event.target.value }))}
              />
            </Field>
          </div>

          <Field label="Featured image URL" htmlFor="post-image" hint="Path under /images or an absolute URL.">
            <div className="flex items-center gap-2">
              <Input
                id="post-image"
                value={form.featuredImage}
                onChange={(event) => setForm((current) => ({ ...current, featuredImage: event.target.value }))}
                placeholder="/images/services/roofing.jpg"
              />
              <span className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-soft ring-1 ring-line">
                {form.featuredImage ? (
                  <img src={form.featuredImage} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImageIcon className="h-4 w-4 text-muted" />
                )}
              </span>
            </div>
          </Field>

          <Field label="Excerpt" htmlFor="post-excerpt">
            <Textarea
              id="post-excerpt"
              rows={2}
              value={form.excerpt}
              onChange={(event) => setForm((current) => ({ ...current, excerpt: event.target.value }))}
            />
          </Field>

          <Field label="SEO title" htmlFor="post-seo-title">
            <Input
              id="post-seo-title"
              value={form.seoTitle}
              onChange={(event) => setForm((current) => ({ ...current, seoTitle: event.target.value }))}
            />
          </Field>

          <Field label="SEO description" htmlFor="post-seo-description" hint={`${form.seoDescription.length}/160 characters`}>
            <Textarea
              id="post-seo-description"
              rows={2}
              value={form.seoDescription}
              onChange={(event) => setForm((current) => ({ ...current, seoDescription: event.target.value.slice(0, 160) }))}
            />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete post?"
        description={`“${pendingDelete?.title ?? ''}” will be removed from the demo workspace.`}
        confirmLabel="Delete post"
        loading={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />

      {!loading && posts.length === 0 ? (
        <Card className="flex items-center gap-3 px-5 py-4 text-sm text-muted">
          <Newspaper className="h-4 w-4" /> No posts yet — write the first one.
        </Card>
      ) : null}
    </div>
  )
}
