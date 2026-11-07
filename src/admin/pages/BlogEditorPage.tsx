/**
 * Full-page blog editor.
 *
 * Replaces the small modal that Phase 1 shipped with: a dedicated route
 * (/admin/blog/new and /admin/blog/:id) with the TipTap editor in the main
 * column and every publishing/SEO control in the right sidebar.
 *
 * Saves go to the PHP API in API mode and to the local demo store otherwise, so
 * the same screen is testable without a server.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  CalendarClock,
  Eye,
  Image as ImageIcon,
  Loader2,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  IconButton,
  Input,
  Modal,
  Select,
  Switch,
  Textarea,
  cn,
} from '@/admin/components/ui'
import { RichTextEditor, type RichTextEditorHandle } from '@/admin/components/editor/RichTextEditor'
import { MediaPicker } from '@/admin/components/editor/MediaPicker'
import { useToast } from '@/admin/context/ToastContext'
import {
  contentApi,
  formatUtc,
  localInputToUtc,
  readingMinutes,
  slugify,
  utcToLocalInput,
  type ContentCategory,
  type ContentPost,
  type ContentTag,
  type PostInput,
} from '@/admin/data/contentApi'
import { ADMIN_CONFIG } from '@/admin/config/adminConfig'

const STATUS_TONE = {
  published: 'success',
  scheduled: 'amber',
  draft: 'slate',
} as const

const METADATA_FIELDS: Array<{ key: string; label: string; hint: string; rows?: number }> = [
  { key: 'search_intent', label: 'Search intent', hint: 'Informational, commercial investigation, transactional…' },
  { key: 'target_audience', label: 'Target audience', hint: 'Who this article is written for.' },
  { key: 'cta_target', label: 'CTA service', hint: 'Which service page the call-to-action sends readers to.' },
  { key: 'internal_links', label: 'Internal links', hint: 'Slugs of related services or articles, one per line.', rows: 3 },
  { key: 'visual_direction', label: 'Visual direction', hint: 'What the illustration or infographic should show.', rows: 2 },
  { key: 'editor_notes', label: 'Editor notes', hint: 'Private notes — never shown on the site.', rows: 2 },
]

const emptyInput = (): PostInput => ({
  title: '',
  slug: '',
  categoryId: null,
  status: 'draft',
  excerpt: '',
  body: '',
  featuredImage: '',
  featuredImageAlt: '',
  seoTitle: '',
  seoDescription: '',
  seoSummary: '',
  focusKeyword: '',
  secondaryKeywords: '',
  canonicalUrl: '',
  noindex: false,
  socialImage: '',
  author: 'Editorial team',
  publishedAt: '',
  scheduledAt: '',
  tagIds: [],
  metadata: {},
})

const counterTone = (length: number, max: number): string =>
  length === 0 ? 'text-muted' : length <= max ? 'text-emerald-600' : 'text-amber-600'

export const BlogEditorPage = () => {
  const { id } = useParams<{ id: string }>()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const toast = useToast()
  const editorRef = useRef<RichTextEditorHandle>(null)

  const [input, setInput] = useState<PostInput>(emptyInput)
  const [post, setPost] = useState<ContentPost | null>(null)
  const [categories, setCategories] = useState<ContentCategory[]>([])
  const [tags, setTags] = useState<ContentTag[]>([])
  const [tagDraft, setTagDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slugTouched, setSlugTouched] = useState(!isNew)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [pickerFor, setPickerFor] = useState<'featured' | 'social' | 'inline' | null>(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleValue, setScheduleValue] = useState('')
  const [dirty, setDirty] = useState(false)

  const timezone = ADMIN_CONFIG.publishing.timezone

  const patch = useCallback((changes: Partial<PostInput>) => {
    setInput((current) => ({ ...current, ...changes }))
    setDirty(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        const [categoryList, tagList] = await Promise.all([contentApi.listCategories(), contentApi.listTags()])
        if (cancelled) return
        setCategories(categoryList)
        setTags(tagList)

        if (!isNew && id) {
          const loaded = await contentApi.getPost(id)
          if (cancelled) return
          setPost(loaded)
          setInput({
            title: loaded.title,
            slug: loaded.slug,
            categoryId: loaded.categoryId,
            status: loaded.status,
            excerpt: loaded.excerpt,
            body: loaded.body,
            featuredImage: loaded.featuredImage,
            featuredImageAlt: loaded.featuredImageAlt,
            seoTitle: loaded.seoTitle,
            seoDescription: loaded.seoDescription,
            seoSummary: loaded.seoSummary,
            focusKeyword: loaded.focusKeyword,
            secondaryKeywords: loaded.secondaryKeywords,
            canonicalUrl: loaded.canonicalUrl,
            noindex: loaded.noindex,
            socialImage: loaded.socialImage,
            author: loaded.author,
            publishedAt: loaded.publishedAt,
            scheduledAt: loaded.scheduledAt,
            tagIds: loaded.tags.map((tag) => tag.id),
            metadata: loaded.metadata ?? {},
          })
          setScheduleValue(utcToLocalInput(loaded.scheduledAt || loaded.publishedAt, timezone))
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'The post could not be loaded.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id, isNew, timezone])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const titleChange = (value: string): void => {
    patch({ title: value, ...(slugTouched ? {} : { slug: slugify(value) }) })
  }

  const wordCount = useMemo(() => input.body.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length, [input.body])

  const save = async (status: PostInput['status'], scheduled?: string): Promise<void> => {
    if (!input.title.trim()) {
      toast.error('A title is required', 'Give the article a headline before saving.')
      return
    }
    if ((status === 'published' || status === 'scheduled') && readingMinutes(input.body) < 1) {
      toast.error('The article is empty', 'Add the content before publishing.')
      return
    }
    if (status === 'scheduled' && !scheduled) {
      toast.error('Pick a date and time', 'Scheduled posts need a publish time.')
      return
    }

    const payload: PostInput = {
      ...input,
      status,
      slug: input.slug || slugify(input.title),
      publishedAt:
        status === 'published' ? input.publishedAt || new Date().toISOString().slice(0, 19).replace('T', ' ') : input.publishedAt,
      scheduledAt: status === 'scheduled' ? (scheduled ?? input.scheduledAt) : '',
    }

    setSaving(true)
    setError(null)
    try {
      const saved = isNew ? await contentApi.createPost(payload) : await contentApi.updatePost(id as string, payload)
      setPost(saved)
      setDirty(false)
      toast.success(
        status === 'scheduled' ? 'Scheduled' : status === 'published' ? 'Published' : 'Draft saved',
        status === 'scheduled' ? `${saved.title} goes live ${formatUtc(saved.scheduledAt, timezone)}` : saved.title,
      )
      if (isNew) navigate(`/admin/blog/${saved.id}`, { replace: true })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The post could not be saved.'
      setError(message)
      toast.error('Not saved', message)
    } finally {
      setSaving(false)
    }
  }

  const addTag = async (): Promise<void> => {
    const name = tagDraft.trim()
    if (!name) return
    try {
      const tag = await contentApi.createTag(name)
      setTags((current) => (current.some((item) => item.id === tag.id) ? current : [...current, tag]))
      patch({ tagIds: Array.from(new Set([...input.tagIds, tag.id])) })
      setTagDraft('')
    } catch (cause) {
      toast.error('Tag not created', cause instanceof Error ? cause.message : 'Try a different name.')
    }
  }

  const remove = async (): Promise<void> => {
    if (!post) return
    if (!window.confirm(`Delete “${post.title}”? It moves to the trash and can be restored from the API.`)) return
    try {
      await contentApi.deletePost(post.id)
      toast.success('Post deleted', post.title)
      navigate('/admin/blog')
    } catch (cause) {
      toast.error('Not deleted', cause instanceof Error ? cause.message : 'Try again.')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 p-10 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the editor…
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-16">
      {/* ------------------------------- top bar ------------------------------ */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/admin/blog"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface text-muted transition hover:text-ink"
            aria-label="Back to posts"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted">
              {input.status === 'scheduled'
                ? `Scheduled · ${formatUtc(input.scheduledAt, timezone)}`
                : input.status === 'published'
                  ? `Published · ${formatUtc(input.publishedAt, timezone)}`
                  : 'Draft'}
            </p>
            <h1 className="font-display text-lg font-bold text-ink">{isNew ? 'New blog post' : input.title || 'Untitled post'}</h1>
          </div>
          <Badge tone={STATUS_TONE[input.status]}>{input.status}</Badge>
          {dirty ? <span className="text-2xs font-medium text-amber-600">Unsaved changes</span> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" iconLeft={<Eye className="h-4 w-4" />} onClick={() => setPreviewOpen(true)}>
            Preview
          </Button>
          {!isNew && post?.status === 'published' && post.slug ? (
            <a
              href={`/blog/${post.slug}`}
              target="_blank"
              rel="noreferrer"
              className="hidden text-xs font-semibold text-brand-700 hover:underline sm:inline"
            >
              View live ↗
            </a>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Save className="h-4 w-4" />}
            onClick={() => void save('draft')}
            loading={saving}
          >
            Save draft
          </Button>
          <Button
            size="sm"
            variant="secondary"
            iconLeft={<CalendarClock className="h-4 w-4" />}
            onClick={() => {
              setScheduleValue(scheduleValue || utcToLocalInput(new Date(Date.now() + 86_400_000).toISOString(), timezone))
              setScheduleOpen(true)
            }}
          >
            Schedule
          </Button>
          <Button
            size="sm"
            iconLeft={<Send className="h-4 w-4" />}
            loading={saving}
            onClick={() => void save('published')}
          >
            {post?.status === 'published' ? 'Update live' : 'Publish'}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* ------------------------------ main ------------------------------ */}
        <div className="space-y-4">
          <Card className="p-4">
            <label htmlFor="post-title" className="sr-only">
              Post title
            </label>
            <input
              id="post-title"
              value={input.title}
              onChange={(event) => titleChange(event.target.value)}
              placeholder="Article headline"
              className="w-full border-0 bg-transparent font-display text-2xl font-bold text-ink placeholder:text-muted focus:outline-none"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <span className="text-2xs font-semibold uppercase tracking-wide text-muted">Slug</span>
              <span className="text-xs text-muted">/blog/</span>
              <Input
                value={input.slug}
                onChange={(event) => {
                  setSlugTouched(true)
                  patch({ slug: slugify(event.target.value) })
                }}
                className="h-8 w-auto min-w-[220px] flex-1 text-xs"
                aria-label="Slug"
              />
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<Sparkles className="h-3.5 w-3.5" />}
                onClick={() => {
                  setSlugTouched(false)
                  patch({ slug: slugify(input.title) })
                }}
              >
                From title
              </Button>
            </div>
          </Card>

          <RichTextEditor
            ref={editorRef}
            value={input.body}
            onChange={(html) => patch({ body: html })}
            onRequestImage={() => setPickerFor('inline')}
            placeholder="Start writing. Use headings, lists, tables and images — all of it is saved as clean HTML."
          />

          <Card>
            <CardHeader title="Excerpt" description="Shown on the blog index and in search results fallbacks." />
            <div className="p-4 pt-0">
              <Textarea
                value={input.excerpt}
                onChange={(event) => patch({ excerpt: event.target.value })}
                rows={3}
                maxLength={500}
                placeholder="One or two sentences that tell a reader what this article answers."
              />
              <div className="mt-1 flex justify-between text-2xs text-muted">
                <span>Keep it under 300 characters for the best snippet.</span>
                <span className={counterTone(input.excerpt.length, 300)}>{input.excerpt.length}/500</span>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Editorial metadata"
              description="Internal context for this article. Not rendered on the public page."
            />
            <div className="grid gap-4 p-4 pt-0 md:grid-cols-2">
              {METADATA_FIELDS.map((field) => (
                <Field key={field.key} label={field.label} hint={field.hint} htmlFor={`meta-${field.key}`}>
                  <Textarea
                    id={`meta-${field.key}`}
                    rows={field.rows ?? 2}
                    value={input.metadata[field.key] ?? ''}
                    onChange={(event) =>
                      patch({ metadata: { ...input.metadata, [field.key]: event.target.value } })
                    }
                  />
                </Field>
              ))}
            </div>
          </Card>
        </div>

        {/* ----------------------------- sidebar ---------------------------- */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Publishing" description={`Times shown in ${ADMIN_CONFIG.publishing.timezoneLabel}, stored in UTC.`} />
            <div className="space-y-3 p-4 pt-0">
              <Field label="Status" htmlFor="post-status">
                <Select
                  id="post-status"
                  value={input.status}
                  onChange={(event) => {
                    const status = event.target.value as PostInput['status']
                    patch({ status })
                    if (status === 'scheduled') setScheduleOpen(true)
                  }}
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="scheduled">Scheduled</option>
                </Select>
              </Field>

              {input.status === 'scheduled' ? (
                <Field label="Publish at" htmlFor="post-schedule" hint="The cron job publishes it within five minutes of this time.">
                  <Input
                    id="post-schedule"
                    type="datetime-local"
                    value={scheduleValue}
                    onChange={(event) => {
                      setScheduleValue(event.target.value)
                      patch({ scheduledAt: localInputToUtc(event.target.value, timezone) })
                    }}
                  />
                </Field>
              ) : null}

              <Field label="Author" htmlFor="post-author">
                <Input id="post-author" value={input.author} onChange={(event) => patch({ author: event.target.value })} />
              </Field>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="secondary" onClick={() => void save('draft')} loading={saving} className="flex-1">
                  Draft
                </Button>
                <Button size="sm" onClick={() => void save('published')} loading={saving} className="flex-1">
                  Publish
                </Button>
              </div>
              {!isNew ? (
                <button
                  type="button"
                  onClick={() => void remove()}
                  className="inline-flex items-center gap-1 text-2xs font-semibold text-rose-600 hover:underline"
                >
                  <Trash2 className="h-3 w-3" /> Delete this post
                </button>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="Category & tags" />
            <div className="space-y-3 p-4 pt-0">
              <Field label="Category" htmlFor="post-category">
                <Select
                  id="post-category"
                  value={input.categoryId ?? ''}
                  onChange={(event) => patch({ categoryId: event.target.value || null })}
                >
                  <option value="">Uncategorised</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                      {category.postCount ? ` (${category.postCount})` : ''}
                    </option>
                  ))}
                </Select>
              </Field>

              <div>
                <p className="mb-1.5 text-xs font-semibold text-ink">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {input.tagIds.length === 0 ? <span className="text-xs text-muted">No tags yet.</span> : null}
                  {input.tagIds.map((tagId) => {
                    const tag = tags.find((item) => item.id === tagId)
                    if (!tag) return null
                    return (
                      <span
                        key={tagId}
                        className="inline-flex items-center gap-1 rounded-full bg-soft px-2 py-0.5 text-2xs font-medium text-ink ring-1 ring-inset ring-line"
                      >
                        {tag.name}
                        <button
                          type="button"
                          aria-label={`Remove ${tag.name}`}
                          onClick={() => patch({ tagIds: input.tagIds.filter((entry) => entry !== tagId) })}
                          className="text-muted hover:text-rose-600"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )
                  })}
                </div>
                <div className="mt-2 flex gap-2">
                  <Input
                    value={tagDraft}
                    onChange={(event) => setTagDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void addTag()
                      }
                    }}
                    placeholder="Add a tag"
                    aria-label="Add a tag"
                    className="h-8 text-xs"
                  />
                  <Button size="sm" variant="secondary" iconLeft={<Plus className="h-3.5 w-3.5" />} onClick={() => void addTag()}>
                    Add
                  </Button>
                </div>
                {tags.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {tags
                      .filter((tag) => !input.tagIds.includes(tag.id))
                      .slice(0, 12)
                      .map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => patch({ tagIds: [...input.tagIds, tag.id] })}
                          className="rounded-full border border-line px-2 py-0.5 text-2xs text-muted transition hover:border-brand-300 hover:text-brand-700"
                        >
                          + {tag.name}
                        </button>
                      ))}
                  </div>
                ) : null}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Featured image" />
            <div className="space-y-3 p-4 pt-0">
              {input.featuredImage ? (
                <div className="overflow-hidden rounded-xl border border-line">
                  {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
                  <img src={input.featuredImage} alt={input.featuredImageAlt || 'Featured image'} className="aspect-[16/9] w-full object-cover" />
                </div>
              ) : (
                <div className="flex aspect-[16/9] items-center justify-center rounded-xl border border-dashed border-line bg-soft/60 text-muted">
                  <ImageIcon className="h-6 w-6" />
                </div>
              )}
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" className="flex-1" onClick={() => setPickerFor('featured')}>
                  {input.featuredImage ? 'Replace' : 'Choose image'}
                </Button>
                {input.featuredImage ? (
                  <Button size="sm" variant="ghost" onClick={() => patch({ featuredImage: '', featuredImageAlt: '' })}>
                    Remove
                  </Button>
                ) : null}
              </div>
              <Field label="Alt text" htmlFor="featured-alt" hint="Describe the image for screen readers and image search.">
                <Input
                  id="featured-alt"
                  value={input.featuredImageAlt}
                  onChange={(event) => patch({ featuredImageAlt: event.target.value })}
                  placeholder="Illustration of a technician testing a wall outlet"
                />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="SEO" description="Leave a field blank to fall back to the title or excerpt." />
            <div className="space-y-3 p-4 pt-0">
              <Field label="SEO title" htmlFor="seo-title">
                <Input
                  id="seo-title"
                  value={input.seoTitle}
                  onChange={(event) => patch({ seoTitle: event.target.value })}
                  placeholder={input.title || 'Search result title'}
                />
                <p className={cn('mt-1 text-2xs', counterTone(input.seoTitle.length, 60))}>{input.seoTitle.length}/60 characters</p>
              </Field>

              <Field label="Meta description" htmlFor="seo-description">
                <Textarea
                  id="seo-description"
                  rows={3}
                  value={input.seoDescription}
                  onChange={(event) => patch({ seoDescription: event.target.value })}
                  placeholder={input.excerpt || 'What the reader gets from this article.'}
                />
                <p className={cn('mt-1 text-2xs', counterTone(input.seoDescription.length, 160))}>
                  {input.seoDescription.length}/160 characters
                </p>
              </Field>

              <Field label="SEO summary" htmlFor="seo-summary" hint="Internal one-liner used in the content map.">
                <Input id="seo-summary" value={input.seoSummary} onChange={(event) => patch({ seoSummary: event.target.value })} />
              </Field>

              <Field label="Focus keyword" htmlFor="seo-focus">
                <Input
                  id="seo-focus"
                  value={input.focusKeyword}
                  onChange={(event) => patch({ focusKeyword: event.target.value })}
                  placeholder="appliance repair service"
                />
              </Field>

              <Field label="Secondary keywords" htmlFor="seo-secondary" hint="Comma separated. One primary keyword per article avoids cannibalisation.">
                <Input
                  id="seo-secondary"
                  value={input.secondaryKeywords}
                  onChange={(event) => patch({ secondaryKeywords: event.target.value })}
                />
              </Field>

              <Field label="Canonical URL" htmlFor="seo-canonical" hint="Only set this when the article first appeared elsewhere.">
                <Input
                  id="seo-canonical"
                  value={input.canonicalUrl}
                  onChange={(event) => patch({ canonicalUrl: event.target.value })}
                  placeholder={`https://safehomenetwork.com/blog/${input.slug || 'article'}`}
                />
              </Field>

              <Field label="Social sharing image" htmlFor="seo-social">
                <div className="flex gap-2">
                  <Input id="seo-social" value={input.socialImage} onChange={(event) => patch({ socialImage: event.target.value })} placeholder="Defaults to the featured image" />
                  <Button size="sm" variant="secondary" onClick={() => setPickerFor('social')}>
                    Pick
                  </Button>
                </div>
              </Field>

              <Switch
                checked={input.noindex}
                onChange={(checked) => patch({ noindex: checked })}
                label="Noindex this article"
                description="Adds noindex, nofollow and removes it from the sitemap."
              />
            </div>
          </Card>

          <Card className="p-4">
            <p className="text-2xs leading-relaxed text-muted">
              {wordCount} words · about {readingMinutes(input.body)} min read · {input.status === 'published' ? 'live' : 'not yet public'}
            </p>
          </Card>
        </div>
      </div>

      {/* ------------------------------- modals ------------------------------ */}
      <MediaPicker
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        onSelect={(asset) => {
          if (pickerFor === 'inline') {
            editorRef.current?.insertImage(asset.path, asset.altText)
            return
          }
          if (pickerFor === 'social') {
            patch({ socialImage: asset.path })
            return
          }
          patch({ featuredImage: asset.path, featuredImageAlt: asset.altText || input.featuredImageAlt })
        }}
      />

      <Modal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        title="Schedule this article"
        description={`Pick a date and time in ${ADMIN_CONFIG.publishing.timezoneLabel}. It is stored in UTC and published by the cron job.`}
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button variant="ghost" onClick={() => setScheduleOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const utc = localInputToUtc(scheduleValue, timezone)
                if (!utc) {
                  toast.error('Pick a date and time', 'The schedule needs a value.')
                  return
                }
                setScheduleOpen(false)
                patch({ scheduledAt: utc, status: 'scheduled' })
                void save('scheduled', utc)
              }}
              loading={saving}
            >
              Schedule
            </Button>
          </div>
        }
      >
        <Field label="Publish at" htmlFor="schedule-input">
          <Input
            id="schedule-input"
            type="datetime-local"
            value={scheduleValue}
            onChange={(event) => setScheduleValue(event.target.value)}
          />
        </Field>
        <p className="mt-2 text-xs text-muted">
          Runs every five minutes: <code className="rounded bg-soft px-1">php api/cron/publish-scheduled.php</code>
        </p>
      </Modal>

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title="Preview" size="lg">
        <article className="shn-article">
          <h1 className="font-display text-2xl font-bold text-ink">{input.title || 'Untitled article'}</h1>
          <p className="mt-1 text-xs text-muted">
            {input.author} · {readingMinutes(input.body)} min read
            {input.categoryId ? ` · ${categories.find((category) => category.id === input.categoryId)?.name ?? ''}` : ''}
          </p>
          {input.featuredImage ? (
            <img src={input.featuredImage} alt={input.featuredImageAlt} className="mt-4 w-full rounded-xl" />
          ) : null}
          <div className="shn-prose mt-4" dangerouslySetInnerHTML={{ __html: input.body || '<p class="text-muted">Nothing written yet.</p>' }} />
        </article>
      </Modal>

      {!isNew ? (
        <div className="flex items-center gap-2 text-2xs text-muted">
          <IconButton label="Back" onClick={() => navigate('/admin/blog')}>
            <ArrowLeft className="h-4 w-4" />
          </IconButton>
          Post #{post?.id} · last saved {post?.updatedAt ? formatUtc(post.updatedAt, timezone) : '—'}
        </div>
      ) : null}
    </div>
  )
}

export default BlogEditorPage
