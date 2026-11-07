/**
 * Full-page editor for static pages (Home, About, legal pages, landing pages).
 *
 * Same rich-text engine as the blog editor, plus page-specific controls:
 * template, group ("Legal", "Company", "Marketing"), path/slug, scheduling and
 * SEO. Saves through the PHP API in API mode, or the demo store otherwise.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarClock, Eye, Image as ImageIcon, Loader2, Save, Send, Sparkles, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
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
  type ContentPage,
  type PageInput,
} from '@/admin/data/contentApi'
import { ADMIN_CONFIG } from '@/admin/config/adminConfig'

const STATUS_TONE = { published: 'success', scheduled: 'amber', draft: 'slate' } as const

const emptyPage = (): PageInput => ({
  title: '',
  slug: '/',
  template: 'standard',
  status: 'draft',
  excerpt: '',
  body: '',
  seoTitle: '',
  seoDescription: '',
  focusKeyword: '',
  secondaryKeywords: '',
  canonicalUrl: '',
  noindex: false,
  ogImage: '',
  pageGroup: 'Company',
  sortOrder: 0,
  scheduledAt: '',
})

export const PageEditorPage = () => {
  const { id } = useParams<{ id: string }>()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const toast = useToast()
  const editorRef = useRef<RichTextEditorHandle>(null)

  const [input, setInput] = useState<PageInput>(emptyPage)
  const [page, setPage] = useState<ContentPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [pickerFor, setPickerFor] = useState<'og' | 'inline' | null>(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleValue, setScheduleValue] = useState('')
  const [slugTouched, setSlugTouched] = useState(!isNew)

  const timezone = ADMIN_CONFIG.publishing.timezone

  const patch = useCallback((changes: Partial<PageInput>) => {
    setInput((current) => ({ ...current, ...changes }))
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      if (isNew) {
        setLoading(false)
        return
      }
      try {
        const loaded = await contentApi.getPage(id as string)
        if (cancelled) return
        setPage(loaded)
        setInput({
          title: loaded.title,
          slug: loaded.slug,
          template: loaded.template,
          status: loaded.status,
          excerpt: loaded.excerpt,
          body: loaded.body,
          seoTitle: loaded.seoTitle,
          seoDescription: loaded.seoDescription,
          focusKeyword: loaded.focusKeyword,
          secondaryKeywords: loaded.secondaryKeywords,
          canonicalUrl: loaded.canonicalUrl,
          noindex: loaded.noindex,
          ogImage: loaded.ogImage,
          pageGroup: loaded.pageGroup || 'Company',
          sortOrder: loaded.sortOrder,
          scheduledAt: loaded.scheduledAt,
        })
        setScheduleValue(utcToLocalInput(loaded.scheduledAt || loaded.publishedAt, timezone))
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'The page could not be loaded.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id, isNew, timezone])

  const words = useMemo(() => input.body.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length, [input.body])

  const save = async (status: PageInput['status'], scheduled?: string): Promise<void> => {
    if (!input.title.trim()) {
      toast.error('A title is required', 'Add the page title before saving.')
      return
    }
    if (!input.slug.trim() || input.slug === '/') {
      toast.error('A path is required', 'Use something like /about or /legal/privacy.')
      return
    }
    if (status === 'scheduled' && !scheduled) {
      toast.error('Pick a date and time', 'Scheduled pages need a publish time.')
      return
    }

    const payload: PageInput = {
      ...input,
      status,
      slug: input.slug.startsWith('/') ? input.slug : `/${input.slug}`,
      scheduledAt: status === 'scheduled' ? (scheduled ?? input.scheduledAt) : '',
    }

    setSaving(true)
    setError(null)
    try {
      const saved = isNew ? await contentApi.createPage(payload) : await contentApi.updatePage(id as string, payload)
      setPage(saved)
      setInput((current) => ({ ...current, status: saved.status, scheduledAt: saved.scheduledAt }))
      toast.success(status === 'published' ? 'Page published' : status === 'scheduled' ? 'Page scheduled' : 'Draft saved', saved.title)
      if (isNew) navigate(`/admin/pages/${saved.id}`, { replace: true })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The page could not be saved.'
      setError(message)
      toast.error('Not saved', message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 p-10 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the page editor…
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/admin/pages"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface text-muted transition hover:text-ink"
            aria-label="Back to pages"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted">
              {input.status === 'scheduled' ? `Scheduled · ${formatUtc(input.scheduledAt, timezone)}` : input.status}
            </p>
            <h1 className="font-display text-lg font-bold text-ink">{isNew ? 'New page' : input.title || 'Untitled page'}</h1>
          </div>
          <Badge tone={STATUS_TONE[input.status]}>{input.status}</Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" iconLeft={<Eye className="h-4 w-4" />} onClick={() => setPreviewOpen(true)}>
            Preview
          </Button>
          <Button variant="secondary" size="sm" iconLeft={<Save className="h-4 w-4" />} loading={saving} onClick={() => void save('draft')}>
            Save draft
          </Button>
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<CalendarClock className="h-4 w-4" />}
            onClick={() => {
              setScheduleValue(scheduleValue || utcToLocalInput(new Date(Date.now() + 86_400_000).toISOString(), timezone))
              setScheduleOpen(true)
            }}
          >
            Schedule
          </Button>
          <Button size="sm" iconLeft={<Send className="h-4 w-4" />} loading={saving} onClick={() => void save('published')}>
            Publish
          </Button>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Card className="p-4">
            <label htmlFor="page-title" className="sr-only">
              Page title
            </label>
            <input
              id="page-title"
              value={input.title}
              onChange={(event) => patch({ title: event.target.value, ...(slugTouched ? {} : { slug: `/${slugify(event.target.value)}` }) })}
              placeholder="Page title"
              className="w-full border-0 bg-transparent font-display text-2xl font-bold text-ink placeholder:text-muted focus:outline-none"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <span className="text-2xs font-semibold uppercase tracking-wide text-muted">Path</span>
              <Input
                value={input.slug}
                onChange={(event) => {
                  setSlugTouched(true)
                  patch({ slug: event.target.value.startsWith('/') ? event.target.value : `/${event.target.value}` })
                }}
                className="h-8 min-w-[220px] flex-1 font-mono text-xs"
                aria-label="Page path"
              />
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<Sparkles className="h-3.5 w-3.5" />}
                onClick={() => {
                  setSlugTouched(false)
                  patch({ slug: `/${slugify(input.title)}` })
                }}
              >
                From title
              </Button>
            </div>
          </Card>

          <RichTextEditor ref={editorRef} value={input.body} onChange={(html) => patch({ body: html })} onRequestImage={() => setPickerFor('inline')} />

          <Card>
            <CardHeader title="Excerpt" description="Used for the meta description fallback and page listings." />
            <div className="p-4 pt-0">
              <Textarea rows={3} value={input.excerpt} onChange={(event) => patch({ excerpt: event.target.value })} maxLength={400} />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Publishing" description={`Times shown in ${ADMIN_CONFIG.publishing.timezoneLabel}.`} />
            <div className="space-y-3 p-4 pt-0">
              <Field label="Status" htmlFor="page-status">
                <Select
                  id="page-status"
                  value={input.status}
                  onChange={(event) => {
                    const status = event.target.value as PageInput['status']
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
                <Field label="Publish at" htmlFor="page-schedule" hint="Published by the cron job within five minutes.">
                  <Input
                    id="page-schedule"
                    type="datetime-local"
                    value={scheduleValue}
                    onChange={(event) => {
                      setScheduleValue(event.target.value)
                      patch({ scheduledAt: localInputToUtc(event.target.value, timezone) })
                    }}
                  />
                </Field>
              ) : null}
              <Field label="Template" htmlFor="page-template">
                <Select id="page-template" value={input.template} onChange={(event) => patch({ template: event.target.value as PageInput['template'] })}>
                  <option value="standard">Standard</option>
                  <option value="legal">Legal</option>
                  <option value="landing">Landing</option>
                </Select>
              </Field>
              <Field label="Group" htmlFor="page-group" hint="Organises the list — Company, Legal, Marketing…">
                <Input id="page-group" value={input.pageGroup} onChange={(event) => patch({ pageGroup: event.target.value })} />
              </Field>
              <Field label="Sort order" htmlFor="page-order">
                <Input
                  id="page-order"
                  type="number"
                  value={input.sortOrder}
                  onChange={(event) => patch({ sortOrder: Number(event.target.value) })}
                />
              </Field>
              {!isNew ? (
                <button
                  type="button"
                  onClick={async () => {
                    if (!page) return
                    if (!window.confirm(`Delete “${page.title}”?`)) return
                    try {
                      await contentApi.deletePage(page.id)
                      toast.success('Page deleted', page.title)
                      navigate('/admin/pages')
                    } catch (cause) {
                      toast.error('Not deleted', cause instanceof Error ? cause.message : 'Try again.')
                    }
                  }}
                  className="inline-flex items-center gap-1 text-2xs font-semibold text-rose-600 hover:underline"
                >
                  <Trash2 className="h-3 w-3" /> Delete this page
                </button>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="Social image" />
            <div className="space-y-3 p-4 pt-0">
              {input.ogImage ? (
                <img src={input.ogImage} alt="Social sharing preview" className="aspect-[1.91/1] w-full rounded-xl border border-line object-cover" />
              ) : (
                <div className="flex aspect-[1.91/1] items-center justify-center rounded-xl border border-dashed border-line bg-soft/60 text-muted">
                  <ImageIcon className="h-5 w-5" />
                </div>
              )}
              <Button size="sm" variant="secondary" className="w-full" onClick={() => setPickerFor('og')}>
                {input.ogImage ? 'Replace image' : 'Choose image'}
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader title="SEO" />
            <div className="space-y-3 p-4 pt-0">
              <Field label="SEO title" htmlFor="page-seo-title">
                <Input id="page-seo-title" value={input.seoTitle} onChange={(event) => patch({ seoTitle: event.target.value })} />
                <p className={cn('mt-1 text-2xs', input.seoTitle.length <= 60 ? 'text-emerald-600' : 'text-amber-600')}>
                  {input.seoTitle.length}/60
                </p>
              </Field>
              <Field label="Meta description" htmlFor="page-seo-description">
                <Textarea id="page-seo-description" rows={3} value={input.seoDescription} onChange={(event) => patch({ seoDescription: event.target.value })} />
                <p className={cn('mt-1 text-2xs', input.seoDescription.length <= 160 ? 'text-emerald-600' : 'text-amber-600')}>
                  {input.seoDescription.length}/160
                </p>
              </Field>
              <Field label="Focus keyword" htmlFor="page-focus">
                <Input id="page-focus" value={input.focusKeyword} onChange={(event) => patch({ focusKeyword: event.target.value })} />
              </Field>
              <Field label="Secondary keywords" htmlFor="page-secondary">
                <Input id="page-secondary" value={input.secondaryKeywords} onChange={(event) => patch({ secondaryKeywords: event.target.value })} />
              </Field>
              <Field label="Canonical URL" htmlFor="page-canonical">
                <Input id="page-canonical" value={input.canonicalUrl} onChange={(event) => patch({ canonicalUrl: event.target.value })} placeholder="Blank = this page" />
              </Field>
              <Switch
                checked={input.noindex}
                onChange={(checked) => patch({ noindex: checked })}
                label="Noindex this page"
                description="Keeps it out of search results and the sitemap."
              />
            </div>
          </Card>

          <Card className="p-4">
            <p className="text-2xs text-muted">
              {words} words · about {readingMinutes(input.body)} min read
            </p>
          </Card>
        </div>
      </div>

      <MediaPicker
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        onSelect={(asset) => {
          if (pickerFor === 'inline') {
            editorRef.current?.insertImage(asset.path, asset.altText)
            return
          }
          patch({ ogImage: asset.path })
        }}
      />

      <Modal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        title="Schedule this page"
        description={`Publish time is entered in ${ADMIN_CONFIG.publishing.timezoneLabel} and stored in UTC.`}
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button variant="ghost" onClick={() => setScheduleOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={saving}
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
            >
              Schedule
            </Button>
          </div>
        }
      >
        <Field label="Publish at" htmlFor="page-schedule-modal">
          <Input id="page-schedule-modal" type="datetime-local" value={scheduleValue} onChange={(event) => setScheduleValue(event.target.value)} />
        </Field>
      </Modal>

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title="Preview" size="lg">
        <article className="shn-article">
          <h1 className="font-display text-2xl font-bold text-ink">{input.title || 'Untitled page'}</h1>
          <div className="shn-prose mt-4" dangerouslySetInnerHTML={{ __html: input.body || '<p class="text-muted">Nothing written yet.</p>' }} />
        </article>
      </Modal>
    </div>
  )
}

export default PageEditorPage
