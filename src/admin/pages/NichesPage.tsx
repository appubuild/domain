import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Tags, Trash2 } from 'lucide-react'
import { repository, type NewNiche } from '@/admin/data/repository'
import type { NicheRecord, ServiceRecord } from '@/admin/types/admin'
import { formatDate } from '@/admin/lib/format'
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
  SearchInput,
  Select,
  Textarea,
  cn,
} from '@/admin/components/ui'
import { useToast } from '@/admin/context/ToastContext'

const TONES: NicheRecord['tone'][] = ['brand', 'success', 'amber', 'violet', 'rose', 'slate']

interface NicheFormState {
  name: string
  slug: string
  description: string
  tone: NicheRecord['tone']
  status: NicheRecord['status']
}

const emptyForm: NicheFormState = {
  name: '',
  slug: '',
  description: '',
  tone: 'brand',
  status: 'active',
}

export const NichesPage = () => {
  const toast = useToast()
  const [niches, setNiches] = useState<NicheRecord[]>([])
  const [services, setServices] = useState<ServiceRecord[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<NicheRecord | null>(null)
  const [form, setForm] = useState<NicheFormState>(emptyForm)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<NicheRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    try {
      const [nicheRows, serviceRows] = await Promise.all([repository.listNiches(), repository.listServices()])
      setNiches(nicheRows)
      setServices(serviceRows)
    } catch {
      toast.error('Could not load niches')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const filtered = niches.filter((niche) =>
    `${niche.name} ${niche.slug} ${niche.description}`.toLowerCase().includes(query.trim().toLowerCase()),
  )

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  const openEdit = (niche: NicheRecord) => {
    setEditing(niche)
    setForm({
      name: niche.name,
      slug: niche.slug,
      description: niche.description,
      tone: niche.tone,
      status: niche.status,
    })
    setFormError(null)
    setModalOpen(true)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) {
      setFormError('A niche name is required.')
      return
    }
    setSaving(true)
    setFormError(null)
    const payload: NewNiche = {
      name: form.name.trim(),
      slug: form.slug.trim() || form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      description: form.description.trim(),
      tone: form.tone,
      status: form.status,
    }
    try {
      if (editing) {
        await repository.updateNiche(editing.id, payload)
        toast.success('Niche updated', `${payload.name} saved.`)
      } else {
        await repository.createNiche(payload)
        toast.success('Niche created', `${payload.name} added.`)
      }
      setModalOpen(false)
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save the niche.'
      setFormError(message)
      toast.error('Save failed', message)
    } finally {
      setSaving(false)
    }
  }

  const toggleStatus = async (niche: NicheRecord) => {
    const status: NicheRecord['status'] = niche.status === 'active' ? 'paused' : 'active'
    try {
      await repository.updateNiche(niche.id, { status })
      toast.success(status === 'active' ? 'Niche activated' : 'Niche paused', niche.name)
      await load()
    } catch {
      toast.error('Could not update the niche')
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await repository.deleteNiche(pendingDelete.id)
      toast.success('Niche deleted', `${pendingDelete.name} removed; its services are now unassigned.`)
      setPendingDelete(null)
      await load()
    } catch (error) {
      toast.error('Delete failed', error instanceof Error ? error.message : undefined)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Niches"
        description="Group related services into verticals so campaigns, reporting and call lines stay organised."
        meta={
          <>
            <Badge tone="brand">{niches.length} niches</Badge>
            <Badge tone="success">{niches.filter((niche) => niche.status === 'active').length} active</Badge>
          </>
        }
        actions={
          <Button size="sm" onClick={openCreate} iconLeft={<Plus className="h-4 w-4" />}>
            New niche
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          placeholder="Search niches…"
          aria-label="Search niches"
          className="w-full sm:w-72"
        />
        <p className="text-xs text-muted">{filtered.length} shown</p>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Card key={index} className="h-40 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((niche) => {
            const assigned = services.filter((service) => service.nicheId === niche.id)
            return (
              <Card key={niche.id} className="flex h-full flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Badge tone={niche.tone}>{niche.status === 'active' ? 'Active' : 'Paused'}</Badge>
                    <h2 className="mt-2 font-display text-base font-bold text-ink">{niche.name}</h2>
                    <p className="truncate font-mono text-2xs text-muted">/{niche.slug}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconButton label={`Edit ${niche.name}`} onClick={() => openEdit(niche)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton label={`Delete ${niche.name}`} tone="danger" onClick={() => setPendingDelete(niche)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                </div>

                <p className="mt-2 flex-1 text-xs leading-relaxed text-muted">{niche.description || 'No description yet.'}</p>

                <div className="mt-3 flex flex-wrap gap-1">
                  {assigned.slice(0, 4).map((service) => (
                    <span key={service.id} className="rounded-md bg-soft px-1.5 py-0.5 text-2xs font-medium text-muted">
                      {service.name}
                    </span>
                  ))}
                  {assigned.length > 4 ? (
                    <span className="rounded-md bg-soft px-1.5 py-0.5 text-2xs font-medium text-muted">
                      +{assigned.length - 4}
                    </span>
                  ) : null}
                  {assigned.length === 0 ? <span className="text-2xs text-muted">No services assigned</span> : null}
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5 text-2xs text-muted">
                  <span>Created {formatDate(niche.createdAt)}</span>
                  <button
                    type="button"
                    onClick={() => toggleStatus(niche)}
                    className={cn(
                      'font-semibold transition hover:underline',
                      niche.status === 'active' ? 'text-amber-700 dark:text-amber-300' : 'text-success-700 dark:text-success-300',
                    )}
                  >
                    {niche.status === 'active' ? 'Pause niche' : 'Activate niche'}
                  </button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {!loading && filtered.length === 0 ? (
        <Card className="flex items-center gap-3 px-5 py-6 text-sm text-muted">
          <Tags className="h-4 w-4" /> No niches match “{query}”.
        </Card>
      ) : null}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'New niche'}
        description="Niches group services for reporting; they never change the public URLs."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" form="niche-form" type="submit" loading={saving}>
              {editing ? 'Save changes' : 'Create niche'}
            </Button>
          </>
        }
      >
        <form id="niche-form" onSubmit={submit} className="space-y-4">
          {formError ? (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
              {formError}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="niche-name" required>
              <Input
                id="niche-name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                required
              />
            </Field>
            <Field label="Slug" htmlFor="niche-slug" hint="Lowercase, hyphenated.">
              <Input
                id="niche-slug"
                value={form.slug}
                onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
              />
            </Field>
          </div>

          <Field label="Description" htmlFor="niche-description">
            <Textarea
              id="niche-description"
              rows={3}
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Accent" htmlFor="niche-tone">
              <Select
                id="niche-tone"
                value={form.tone}
                onChange={(event) => setForm((current) => ({ ...current, tone: event.target.value as NicheRecord['tone'] }))}
              >
                {TONES.map((tone) => (
                  <option key={tone} value={tone}>
                    {tone}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" htmlFor="niche-status">
              <Select
                id="niche-status"
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as NicheRecord['status'] }))}
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </Select>
            </Field>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete niche?"
        description={`“${pendingDelete?.name ?? ''}” will be removed. Services in it become “Unassigned” — their pages and numbers are untouched.`}
        confirmLabel="Delete niche"
        loading={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
