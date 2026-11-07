import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Eye, Save, Search, Tags } from 'lucide-react'
import { repository } from '@/admin/data/repository'
import type { SeoSettings } from '@/admin/types/admin'
import { formatDateTime } from '@/admin/lib/format'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  PageHeader,
  Select,
  Switch,
  Textarea,
} from '@/admin/components/ui'
import { useToast } from '@/admin/context/ToastContext'

export const SeoPage = () => {
  const toast = useToast()
  const [seo, setSeo] = useState<SeoSettings | null>(null)
  const [draft, setDraft] = useState<SeoSettings | null>(null)
  const [keywordText, setKeywordText] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const loaded = await repository.getSeo()
      setSeo(loaded)
      setDraft(loaded)
      setKeywordText(loaded.keywords.join(', '))
    } catch {
      toast.error('Could not load SEO settings')
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const update = <K extends keyof SeoSettings>(key: K, value: SeoSettings[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
  }

  const dirty = Boolean(draft && seo && JSON.stringify(draft) !== JSON.stringify(seo))

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!draft) return
    setSaving(true)
    try {
      const saved = await repository.updateSeo({
        ...draft,
        keywords: keywordText
          .split(',')
          .map((keyword) => keyword.trim())
          .filter(Boolean),
      })
      setSeo(saved)
      setDraft(saved)
      setKeywordText(saved.keywords.join(', '))
      toast.success('SEO settings saved', 'Global defaults updated in the demo workspace.')
    } catch (error) {
      toast.error('Save failed', error instanceof Error ? error.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  if (!draft) {
    return (
      <div className="space-y-4">
        <PageHeader title="SEO settings" description="Loading SEO defaults…" />
        <Card className="h-64 animate-pulse" />
      </div>
    )
  }

  const previewTitle = `${draft.defaultTitle.slice(0, 60)}`
  const previewDescription = draft.defaultDescription.slice(0, 158)

  return (
    <form onSubmit={save} className="space-y-4">
      <PageHeader
        title="SEO settings"
        description="Global metadata defaults, crawl rules and the tracking IDs used by the public site."
        meta={
          <>
            <Badge tone="slate">Updated {formatDateTime(draft.updatedAt)}</Badge>
            {dirty ? <Badge tone="amber">Unsaved changes</Badge> : <Badge tone="success">Saved</Badge>}
          </>
        }
        actions={
          <Button type="submit" size="sm" loading={saving} disabled={!dirty} iconLeft={<Save className="h-4 w-4" />}>
            Save changes
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Metadata defaults" description="Used when a page or post has no override." action={<Tags className="h-4 w-4 text-muted" />} />
            <div className="space-y-3 p-5">
              <Field label="Default title" htmlFor="seo-title" hint={`${draft.defaultTitle.length}/60 characters recommended`}>
                <Input id="seo-title" value={draft.defaultTitle} onChange={(event) => update('defaultTitle', event.target.value)} />
              </Field>
              <Field label="Title template" htmlFor="seo-template" hint="%s is replaced with the page title.">
                <Input id="seo-template" value={draft.titleTemplate} onChange={(event) => update('titleTemplate', event.target.value)} />
              </Field>
              <Field
                label="Default description"
                htmlFor="seo-description"
                hint={`${draft.defaultDescription.length}/160 characters`}
              >
                <Textarea
                  id="seo-description"
                  rows={3}
                  value={draft.defaultDescription}
                  onChange={(event) => update('defaultDescription', event.target.value.slice(0, 160))}
                />
              </Field>
              <Field label="Focus keywords" htmlFor="seo-keywords" hint="Comma separated. Stored for reference; not a ranking guarantee.">
                <Input
                  id="seo-keywords"
                  value={keywordText}
                  onChange={(event) => setKeywordText(event.target.value)}
                  placeholder="home services, call a contractor, roofing"
                />
              </Field>
              <div className="flex flex-wrap gap-1.5">
                {keywordText
                  .split(',')
                  .map((keyword) => keyword.trim())
                  .filter(Boolean)
                  .map((keyword) => (
                    <span key={keyword} className="rounded-md bg-soft px-2 py-0.5 text-2xs font-medium text-muted">
                      {keyword}
                    </span>
                  ))}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Crawl and indexing" description="How search engines treat the site." action={<Search className="h-4 w-4 text-muted" />} />
            <div className="space-y-3 p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Robots directive" htmlFor="seo-robots">
                  <Select
                    id="seo-robots"
                    value={draft.robots}
                    onChange={(event) => update('robots', event.target.value as SeoSettings['robots'])}
                  >
                    <option value="index,follow">index, follow</option>
                    <option value="noindex,nofollow">noindex, nofollow</option>
                  </Select>
                </Field>
                <Field label="Canonical base URL" htmlFor="seo-canonical">
                  <Input id="seo-canonical" value={draft.canonicalBase} onChange={(event) => update('canonicalBase', event.target.value)} />
                </Field>
              </div>
              <Switch
                checked={draft.sitemapEnabled}
                onChange={(value) => update('sitemapEnabled', value)}
                label="Publish sitemap.xml"
                description="Generated at build time from the service and page directories."
              />
              <Switch
                checked={draft.robots === 'index,follow'}
                onChange={(value) => update('robots', value ? 'index,follow' : 'noindex,nofollow')}
                label="Allow search engines to index the site"
                description="Turn this off for staging or maintenance."
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Verification and analytics" description="Optional IDs for third-party tools." />
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <Field label="Google verification" htmlFor="seo-google">
                <Input id="seo-google" value={draft.googleVerification} onChange={(event) => update('googleVerification', event.target.value)} />
              </Field>
              <Field label="Analytics measurement ID" htmlFor="seo-analytics">
                <Input id="seo-analytics" value={draft.analyticsId} onChange={(event) => update('analyticsId', event.target.value)} placeholder="G-XXXXXXX" />
              </Field>
              <Field label="Open Graph image" htmlFor="seo-og" className="sm:col-span-2">
                <Input id="seo-og" value={draft.ogImage} onChange={(event) => update('ogImage', event.target.value)} />
              </Field>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Search result preview" description="Approximation of a Google result." action={<Eye className="h-4 w-4 text-muted" />} />
            <div className="p-5">
              <div className="rounded-xl border border-line bg-surface p-4">
                <p className="flex items-center gap-1.5 text-2xs text-muted">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-soft text-[8px] font-bold">S</span>
                  {draft.canonicalBase || 'https://safehomenetwork.com'}
                </p>
                <p className="mt-1 text-base font-medium leading-snug text-[#1a0dab] dark:text-brand-300">{previewTitle}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{previewDescription}</p>
              </div>
              <ul className="mt-3 space-y-1.5 text-2xs text-muted">
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success-600" /> Title length {draft.defaultTitle.length} characters
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success-600" /> Description {draft.defaultDescription.length} characters
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success-600" /> Robots: {draft.robots}
                </li>
              </ul>
            </div>
          </Card>

          <Card>
            <CardHeader title="Per-page overrides" description="Managed from the pages and blog screens." />
            <ul className="divide-y divide-line text-xs">
              <li className="flex items-center justify-between px-5 py-2.5">
                <span className="text-muted">Pages</span>
                <span className="font-semibold text-ink">SEO title + description</span>
              </li>
              <li className="flex items-center justify-between px-5 py-2.5">
                <span className="text-muted">Blog posts</span>
                <span className="font-semibold text-ink">SEO title + description</span>
              </li>
              <li className="flex items-center justify-between px-5 py-2.5">
                <span className="text-muted">Services</span>
                <span className="font-semibold text-ink">Meta title + description</span>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </form>
  )
}
