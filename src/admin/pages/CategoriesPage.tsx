/**
 * Blog categories and tags.
 *
 * Categories carry their own SEO metadata and ordering (used on
 * /blog/category/<slug>), and each one shows how many posts it holds so a
 * delete can be planned before it is attempted (the API refuses to delete a
 * category that still has posts).
 */
import { useEffect, useMemo, useState } from 'react'
import { FolderPlus, Plus, RefreshCw, Tag as TagIcon, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Textarea,
} from '@/admin/components/ui'
import { useToast } from '@/admin/context/ToastContext'
import { contentApi, slugify, type ContentCategory, type ContentTag } from '@/admin/data/contentApi'

const blankCategory = (): Omit<ContentCategory, 'id' | 'postCount'> => ({
  slug: '',
  name: '',
  description: '',
  seoTitle: '',
  seoDescription: '',
  sortOrder: 0,
  noindex: false,
})

export const CategoriesPage = () => {
  const toast = useToast()
  const [categories, setCategories] = useState<ContentCategory[]>([])
  const [tags, setTags] = useState<ContentTag[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ContentCategory | null>(null)
  const [draft, setDraft] = useState(blankCategory())
  const [slugTouched, setSlugTouched] = useState(false)
  const [tagDraft, setTagDraft] = useState('')

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const [categoryList, tagList] = await Promise.all([contentApi.listCategories(), contentApi.listTags()])
      setCategories(categoryList)
      setTags(tagList)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Categories could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const totalPosts = useMemo(() => categories.reduce((sum, category) => sum + (category.postCount ?? 0), 0), [categories])

  const openCreate = (): void => {
    setEditing(null)
    setDraft(blankCategory())
    setSlugTouched(false)
    setDialogOpen(true)
  }

  const openEdit = (category: ContentCategory): void => {
    setEditing(category)
    setDraft({
      slug: category.slug,
      name: category.name,
      description: category.description,
      seoTitle: category.seoTitle,
      seoDescription: category.seoDescription,
      sortOrder: category.sortOrder,
      noindex: category.noindex,
    })
    setSlugTouched(true)
    setDialogOpen(true)
  }

  const submit = async (): Promise<void> => {
    if (!draft.name.trim()) {
      toast.error('A name is required', 'Give the category a name.')
      return
    }
    setSaving(true)
    try {
      const payload = { ...draft, slug: draft.slug || slugify(draft.name) }
      if (editing) {
        await contentApi.updateCategory(editing.id, payload)
        toast.success('Category updated', payload.name)
      } else {
        await contentApi.createCategory(payload)
        toast.success('Category created', payload.name)
      }
      setDialogOpen(false)
      await load()
    } catch (cause) {
      toast.error('Not saved', cause instanceof Error ? cause.message : 'Try again.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (category: ContentCategory): Promise<void> => {
    if (!window.confirm(`Delete the category “${category.name}”?`)) return
    try {
      await contentApi.deleteCategory(category.id)
      toast.success('Category deleted', category.name)
      await load()
    } catch (cause) {
      toast.error('Not deleted', cause instanceof Error ? cause.message : 'Move its posts first.')
    }
  }

  const addTag = async (): Promise<void> => {
    const name = tagDraft.trim()
    if (!name) return
    try {
      await contentApi.createTag(name)
      setTagDraft('')
      await load()
    } catch (cause) {
      toast.error('Tag not created', cause instanceof Error ? cause.message : 'Try a different name.')
    }
  }

  const removeTag = async (tag: ContentTag): Promise<void> => {
    if (!window.confirm(`Delete the tag “${tag.name}”?`)) return
    try {
      await contentApi.deleteTag(tag.id)
      await load()
    } catch (cause) {
      toast.error('Tag not deleted', cause instanceof Error ? cause.message : 'Try again.')
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Categories & tags"
        description="Group articles, give each category page its own SEO metadata, and keep the keyword map clean."
        actions={
          <>
            <Button variant="ghost" size="sm" iconLeft={<RefreshCw className="h-4 w-4" />} onClick={() => void load()} loading={loading}>
              Refresh
            </Button>
            <Button size="sm" iconLeft={<FolderPlus className="h-4 w-4" />} onClick={openCreate}>
              New category
            </Button>
          </>
        }
      />

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Categories"
            description={`${categories.length} categories holding ${totalPosts} posts.`}
          />
          {loading ? (
            <p className="p-6 text-sm text-muted">Loading…</p>
          ) : categories.length === 0 ? (
            <EmptyState icon={<FolderPlus className="h-5 w-5" />} title="No categories yet" description="Create one to start grouping articles." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-line bg-soft/60 text-left text-2xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-2 font-semibold">Category</th>
                    <th className="px-4 py-2 font-semibold">Slug</th>
                    <th className="px-4 py-2 text-right font-semibold">Posts</th>
                    <th className="px-4 py-2 text-right font-semibold">Order</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {categories.map((category) => (
                    <tr key={category.id} className="border-b border-line last:border-0 hover:bg-soft/40">
                      <td className="px-4 py-2.5">
                        <button type="button" onClick={() => openEdit(category)} className="text-left font-medium text-ink hover:text-brand-700">
                          {category.name}
                        </button>
                        <p className="max-w-sm truncate text-2xs text-muted">{category.description || 'No description'}</p>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-2xs text-muted">/blog/category/{category.slug}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Badge tone={category.postCount ? 'brand' : 'slate'}>{category.postCount ?? 0}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right text-2xs text-muted">{category.sortOrder}</td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex justify-end gap-1">
                          <IconButton label={`Edit ${category.name}`} onClick={() => openEdit(category)}>
                            <TagIcon className="h-3.5 w-3.5" />
                          </IconButton>
                          <IconButton label={`Delete ${category.name}`} tone="danger" onClick={() => void remove(category)}>
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

        <Card>
          <CardHeader title="Tags" description="Free-form labels shared across categories." />
          <div className="space-y-3 p-4 pt-0">
            <div className="flex gap-2">
              <Input
                value={tagDraft}
                onChange={(event) => setTagDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void addTag()
                  }
                }}
                placeholder="e.g. seasonal maintenance"
                aria-label="New tag name"
              />
              <Button size="sm" variant="secondary" iconLeft={<Plus className="h-3.5 w-3.5" />} onClick={() => void addTag()}>
                Add
              </Button>
            </div>
            {tags.length === 0 ? (
              <p className="text-xs text-muted">No tags yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {tags.map((tag) => (
                  <li key={tag.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-2.5 py-1.5">
                    <span className="truncate text-xs text-ink">{tag.name}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-2xs text-muted">{tag.postCount ?? 0}</span>
                      <IconButton label={`Delete ${tag.name}`} tone="danger" onClick={() => void removeTag(tag)}>
                        <Trash2 className="h-3 w-3" />
                      </IconButton>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <Modal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'New category'}
        description="The slug becomes /blog/category/<slug> and must be unique."
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} loading={saving}>
              {editing ? 'Save changes' : 'Create category'}
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="cat-name" required>
            <Input
              id="cat-name"
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                  ...(slugTouched ? {} : { slug: slugify(event.target.value) }),
                }))
              }
            />
          </Field>
          <Field label="Slug" htmlFor="cat-slug" required>
            <Input
              id="cat-slug"
              value={draft.slug}
              onChange={(event) => {
                setSlugTouched(true)
                setDraft((current) => ({ ...current, slug: slugify(event.target.value) }))
              }}
              className="font-mono text-xs"
            />
          </Field>
          <Field label="Description" htmlFor="cat-description" className="sm:col-span-2">
            <Textarea
              id="cat-description"
              rows={2}
              value={draft.description}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              maxLength={400}
            />
          </Field>
          <Field label="SEO title" htmlFor="cat-seo-title">
            <Input
              id="cat-seo-title"
              value={draft.seoTitle}
              onChange={(event) => setDraft((current) => ({ ...current, seoTitle: event.target.value }))}
              placeholder={draft.name}
            />
          </Field>
          <Field label="Sort order" htmlFor="cat-order">
            <Input
              id="cat-order"
              type="number"
              value={draft.sortOrder}
              onChange={(event) => setDraft((current) => ({ ...current, sortOrder: Number(event.target.value) }))}
            />
          </Field>
          <Field label="Meta description" htmlFor="cat-seo-description" className="sm:col-span-2">
            <Textarea
              id="cat-seo-description"
              rows={2}
              value={draft.seoDescription}
              onChange={(event) => setDraft((current) => ({ ...current, seoDescription: event.target.value }))}
              maxLength={320}
            />
          </Field>
        </div>
      </Modal>
    </div>
  )
}

export default CategoriesPage
