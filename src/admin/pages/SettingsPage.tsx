import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Building2, Globe2, RotateCcw, Save, Share2, SlidersHorizontal } from 'lucide-react'
import { repository } from '@/admin/data/repository'
import type { SiteSettings } from '@/admin/types/admin'
import { formatDateTime } from '@/admin/lib/format'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Field,
  Input,
  PageHeader,
  Switch,
  Textarea,
} from '@/admin/components/ui'
import { useToast } from '@/admin/context/ToastContext'

export const SettingsPage = () => {
  const toast = useToast()
  const [settings, setSettings] = useState<SiteSettings | null>(null)
  const [draft, setDraft] = useState<SiteSettings | null>(null)
  const [addressText, setAddressText] = useState('')
  const [saving, setSaving] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)

  const load = useCallback(async () => {
    try {
      const loaded = await repository.getSettings()
      setSettings(loaded)
      setDraft(loaded)
      setAddressText(loaded.addressLines.join('\n'))
    } catch {
      toast.error('Could not load settings')
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const update = <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
  }

  const updateSocial = (key: keyof SiteSettings['socials'], value: string) => {
    setDraft((current) => (current ? { ...current, socials: { ...current.socials, [key]: value } } : current))
  }

  const dirty = Boolean(draft && settings && JSON.stringify(draft) !== JSON.stringify(settings))

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!draft) return
    setSaving(true)
    try {
      const saved = await repository.updateSettings({
        ...draft,
        addressLines: addressText
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      })
      setSettings(saved)
      setDraft(saved)
      setAddressText(saved.addressLines.join('\n'))
      toast.success('Settings saved', 'The demo workspace has been updated.')
    } catch (error) {
      toast.error('Save failed', error instanceof Error ? error.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  const resetDemo = async () => {
    setResetting(true)
    try {
      await repository.resetDemoData()
      await load()
      setResetOpen(false)
      toast.success('Demo data reset', 'Services, numbers, content and leads are back to the seeded state.')
    } catch (error) {
      toast.error('Reset failed', error instanceof Error ? error.message : undefined)
    } finally {
      setResetting(false)
    }
  }

  if (!draft) {
    return (
      <div className="space-y-4">
        <PageHeader title="Website settings" description="Loading the demo workspace…" />
        <Card className="h-64 animate-pulse" />
      </div>
    )
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <PageHeader
        title="Website settings"
        description="Business details, contact routes and operational switches."
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

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Business details" description="Shown in the footer and legal pages." action={<Building2 className="h-4 w-4 text-muted" />} />
          <div className="space-y-3 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Site name" htmlFor="settings-name">
                <Input id="settings-name" value={draft.siteName} onChange={(event) => update('siteName', event.target.value)} />
              </Field>
              <Field label="Legal entity" htmlFor="settings-legal">
                <Input id="settings-legal" value={draft.legalName} onChange={(event) => update('legalName', event.target.value)} />
              </Field>
            </div>
            <Field label="Primary domain" htmlFor="settings-domain" hint="Used for canonical URLs and the sitemap.">
              <div className="relative">
                <Globe2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input
                  id="settings-domain"
                  className="pl-9"
                  value={draft.domain}
                  onChange={(event) => update('domain', event.target.value)}
                />
              </div>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Timezone" htmlFor="settings-timezone">
                <Input id="settings-timezone" value={draft.timezone} onChange={(event) => update('timezone', event.target.value)} />
              </Field>
              <Field label="Currency" htmlFor="settings-currency">
                <Input id="settings-currency" value={draft.currency} onChange={(event) => update('currency', event.target.value)} />
              </Field>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Contact routing" description="Where enquiries and calls are directed." action={<Share2 className="h-4 w-4 text-muted" />} />
          <div className="space-y-3 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Support email" htmlFor="settings-email">
                <Input id="settings-email" type="email" value={draft.supportEmail} onChange={(event) => update('supportEmail', event.target.value)} />
              </Field>
              <Field label="Office phone (optional)" htmlFor="settings-phone">
                <Input id="settings-phone" value={draft.supportPhone} onChange={(event) => update('supportPhone', event.target.value)} />
              </Field>
            </div>
            <Field label="Business hours" htmlFor="settings-hours">
              <Input id="settings-hours" value={draft.hours} onChange={(event) => update('hours', event.target.value)} />
            </Field>
            <Field label="Address lines" htmlFor="settings-address" hint="One line per row. Leave empty to omit the address.">
              <Textarea
                id="settings-address"
                rows={3}
                value={addressText}
                onChange={(event) => setAddressText(event.target.value)}
                placeholder={'123 Main Street\nAtlanta, GA 30301'}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Social profiles" description="Leave blank to hide an icon in the footer." />
          <div className="space-y-3 p-5">
            <Field label="Facebook URL" htmlFor="settings-facebook">
              <Input id="settings-facebook" value={draft.socials.facebook} onChange={(event) => updateSocial('facebook', event.target.value)} />
            </Field>
            <Field label="X (Twitter) URL" htmlFor="settings-x">
              <Input id="settings-x" value={draft.socials.x} onChange={(event) => updateSocial('x', event.target.value)} />
            </Field>
            <Field label="YouTube URL" htmlFor="settings-youtube">
              <Input id="settings-youtube" value={draft.socials.youtube} onChange={(event) => updateSocial('youtube', event.target.value)} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Operations" description="Feature switches for the public site." action={<SlidersHorizontal className="h-4 w-4 text-muted" />} />
          <div className="space-y-4 p-5">
            <Switch
              checked={draft.callTrackingEnabled}
              onChange={(value) => update('callTrackingEnabled', value)}
              label="Call tracking enabled"
              description="Shows the published service lines on the site."
            />
            <Switch
              checked={draft.leadNotifications}
              onChange={(value) => update('leadNotifications', value)}
              label="Lead notifications"
              description="Email the support address whenever a new enquiry arrives."
            />
            <Switch
              checked={draft.maintenanceMode}
              onChange={(value) => update('maintenanceMode', value)}
              label="Maintenance mode"
              description="Replaces the public site with a holding page (Phase 2 behaviour)."
            />
            <p className="rounded-lg bg-soft px-3 py-2 text-2xs leading-relaxed text-muted">
              These switches are stored in the demo workspace. They do not affect the compiled public site
              until the Phase 2 API can persist them.
            </p>
          </div>
        </Card>
      </div>

      <Card className="border-rose-200 dark:border-rose-900/60">
        <CardHeader
          title="Demo data"
          description="Restore every service, number, page, post, lead and setting to the seeded snapshot."
          action={<AlertTriangle className="h-4 w-4 text-rose-500" />}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="max-w-xl text-xs leading-relaxed text-muted">
            Resetting clears anything you created in this browser and reloads the demo records. It does not
            touch the public website or the production phone directory.
          </p>
          <Button variant="danger" size="sm" onClick={() => setResetOpen(true)} iconLeft={<RotateCcw className="h-4 w-4" />}>
            Reset demo data
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={resetOpen}
        title="Reset all demo data?"
        description="Every change made in this browser will be discarded and the seeded demo workspace restored."
        confirmLabel="Reset demo data"
        loading={resetting}
        onCancel={() => setResetOpen(false)}
        onConfirm={resetDemo}
      />
    </form>
  )
}
