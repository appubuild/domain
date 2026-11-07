import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Plus, PhoneCall, Trash2, Wrench } from 'lucide-react'
import { repository, type NewService } from '@/admin/data/repository'
import type { NicheRecord, ServiceRecord, TrackingNumber } from '@/admin/types/admin'
import { DIRECTORY_GROUPS, contentStatusTone, groupName, numbersForService } from '@/admin/lib/selectors'
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
  Switch,
  Textarea,
} from '@/admin/components/ui'
import { useToast } from '@/admin/context/ToastContext'

const CATEGORY_OPTIONS = [
  { value: 'exterior', label: 'Roofing & Exterior' },
  { value: 'systems', label: 'Home Systems' },
  { value: 'remodeling', label: 'Remodeling' },
  { value: 'restoration', label: 'Restoration' },
  { value: 'specialty', label: 'Specialty Services' },
]

interface ServiceFormState {
  name: string
  slug: string
  nicheId: string
  groupId: string
  category: string
  icon: string
  status: ServiceRecord['status']
  featured: boolean
  shortDescription: string
  metaTitle: string
  metaDescription: string
}

const emptyForm: ServiceFormState = {
  name: '',
  slug: '',
  nicheId: '',
  groupId: '',
  category: 'exterior',
  icon: 'Wrench',
  status: 'draft',
  featured: false,
  shortDescription: '',
  metaTitle: '',
  metaDescription: '',
}

export const ServicesPage = () => {
  const toast = useToast()
  const [services, setServices] = useState<ServiceRecord[]>([])
  const [numbers, setNumbers] = useState<TrackingNumber[]>([])
  const [niches, setNiches] = useState<NicheRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [nicheFilter, setNicheFilter] = useState('all')
  const [editing, setEditing] = useState<ServiceRecord | null>(null)
  const [form, setForm] = useState<ServiceFormState>(emptyForm)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ServiceRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    try {
      const [serviceRows, numberRows, nicheRows] = await Promise.all([
        repository.listServices(),
        repository.listNumbers(),
        repository.listNiches(),
      ])
      setServices(serviceRows.sort((a, b) => a.sortOrder - b.sortOrder))
      setNumbers(numberRows)
      setNiches(nicheRows)
    } catch {
      toast.error('Could not load services')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(
    () =>
      services.filter((service) => {
        if (statusFilter !== 'all' && service.status !== statusFilter) return false
        if (nicheFilter !== 'all' && service.nicheId !== nicheFilter) return false
        return true
      }),
    [services, statusFilter, nicheFilter],
  )

  const openCreate = () => {
    setEditing(null)
    setForm({ ...emptyForm, nicheId: niches[0]?.id ?? '' })
    setFormError(null)
    setModalOpen(true)
  }

  const openEdit = (service: ServiceRecord) => {
    setEditing(service)
    setForm({
      name: service.name,
      slug: service.slug,
      nicheId: service.nicheId ?? '',
      groupId: service.groupId ?? '',
      category: service.category,
      icon: service.icon,
      status: service.status,
      featured: service.featured,
      shortDescription: service.shortDescription,
      metaTitle: service.metaTitle,
      metaDescription: service.metaDescription,
    })
    setFormError(null)
    setModalOpen(true)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.name.trim() || !form.slug.trim()) {
      setFormError('A service name and slug are both required.')
      return
    }
    setSaving(true)
    setFormError(null)
    const payload: NewService = {
      name: form.name.trim(),
      slug: form.slug.trim(),
      nicheId: form.nicheId || null,
      groupId: form.groupId || null,
      category: form.category,
      icon: form.icon || 'Wrench',
      featured: form.featured,
      status: form.status,
      sortOrder: editing?.sortOrder ?? services.length + 1,
      shortDescription: form.shortDescription,
      metaTitle: form.metaTitle,
      metaDescription: form.metaDescription,
    }
    try {
      if (editing) {
        await repository.updateService(editing.id, payload)
        toast.success('Service updated', `${payload.name} saved.`)
      } else {
        await repository.createService(payload)
        toast.success('Service created', `${payload.name} added to the directory.`)
      }
      setModalOpen(false)
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save the service.'
      setFormError(message)
      toast.error('Save failed', message)
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await repository.deleteService(pendingDelete.id)
      toast.success('Service deleted', `${pendingDelete.name} removed from the directory.`)
      setPendingDelete(null)
      await load()
    } catch (error) {
      toast.error('Delete failed', error instanceof Error ? error.message : undefined)
    } finally {
      setDeleting(false)
    }
  }

  const columns: Column<ServiceRecord>[] = [
    {
      key: 'name',
      header: 'Service',
      render: (row) => (
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold text-ink">
            {row.name}
            {row.featured ? <span className="text-2xs font-bold uppercase text-amber-600">★</span> : null}
          </p>
          <p className="truncate font-mono text-2xs text-muted">/services/{row.slug}</p>
        </div>
      ),
      sortValue: (row) => row.name,
    },
    {
      key: 'niche',
      header: 'Niche',
      hideBelow: 'md',
      render: (row) => {
        const niche = niches.find((entry) => entry.id === row.nicheId)
        return niche ? <Badge tone={niche.tone}>{niche.name}</Badge> : <span className="text-2xs text-muted">Unassigned</span>
      },
      sortValue: (row) => niches.find((entry) => entry.id === row.nicheId)?.name ?? '',
    },
    {
      key: 'numbers',
      header: 'Call numbers',
      render: (row) => {
        const rows = numbersForService(numbers, row)
        if (rows.length === 0) return <Badge tone="amber">No line</Badge>
        const active = rows.filter((entry) => entry.status === 'active').length
        return (
          <div className="flex items-center gap-1.5">
            <PhoneCall className="h-3.5 w-3.5 text-muted" />
            <span className="text-xs font-semibold text-ink">{active}</span>
            <span className="text-2xs text-muted">/ {rows.length} active</span>
          </div>
        )
      },
      sortValue: (row) => numbersForService(numbers, row).length,
    },
    {
      key: 'group',
      header: 'Directory group',
      hideBelow: 'lg',
      render: (row) => <span className="font-mono text-2xs text-muted">{row.groupId ?? '—'}</span>,
      sortValue: (row) => row.groupId ?? '',
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
      hideBelow: 'sm',
      render: (row) => <span className="text-xs text-muted">{formatDate(row.updatedAt)}</span>,
      sortValue: (row) => row.updatedAt,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          <Link
            to={`/admin/numbers?group=${encodeURIComponent(row.groupId ?? '')}`}
            aria-label={`View numbers for ${row.name}`}
            title={`View numbers for ${row.name}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-muted transition hover:bg-soft hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <PhoneCall className="h-3.5 w-3.5" />
          </Link>
          <IconButton label={`Edit ${row.name}`} onClick={() => openEdit(row)}>
            <Pencil className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label={`Delete ${row.name}`} tone="danger" onClick={() => setPendingDelete(row)}>
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Services"
        description="Create and manage the service categories that power the website directory, cards and call lines."
        meta={
          <>
            <Badge tone="brand">{services.length} services</Badge>
            <Badge tone="success">{services.filter((service) => service.status === 'published').length} published</Badge>
            <Badge tone="amber">{services.filter((service) => numbersForService(numbers, service).length === 0).length} without a line</Badge>
          </>
        }
        actions={
          <Button size="sm" onClick={openCreate} iconLeft={<Plus className="h-4 w-4" />}>
            New service
          </Button>
        }
      />

      <Card>
        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          searchText={(row) => `${row.name} ${row.slug} ${row.groupId ?? ''} ${groupName(row.groupId)}`}
          searchPlaceholder="Search services…"
          pageSize={8}
          initialSort={{ key: 'name', direction: 'asc' }}
          emptyTitle="No services match the filters"
          emptyDescription="Clear the filters or create a new service."
          toolbar={
            <>
              <Select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                aria-label="Filter by status"
                className="w-36"
              >
                <option value="all">All statuses</option>
                <option value="published">Published</option>
                <option value="draft">Draft</option>
              </Select>
              <Select
                value={nicheFilter}
                onChange={(event) => setNicheFilter(event.target.value)}
                aria-label="Filter by niche"
                className="w-40"
              >
                <option value="all">All niches</option>
                {niches.map((niche) => (
                  <option key={niche.id} value={niche.id}>
                    {niche.name}
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
        title={editing ? `Edit ${editing.name}` : 'New service'}
        description="Changes apply to the demo workspace; the public site reads its own config file until Phase 2."
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" form="service-form" type="submit" loading={saving}>
              {editing ? 'Save changes' : 'Create service'}
            </Button>
          </>
        }
      >
        <form id="service-form" onSubmit={submit} className="space-y-4">
          {formError ? (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
              {formError}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Service name" htmlFor="service-name" required>
              <Input
                id="service-name"
                value={form.name}
                onChange={(event) => {
                  const name = event.target.value
                  setForm((current) => ({
                    ...current,
                    name,
                    slug:
                      editing || current.slug !== current.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
                        ? current.slug
                        : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
                  }))
                }}
                placeholder="Solar panel installation"
                required
              />
            </Field>
            <Field label="Slug" htmlFor="service-slug" hint="Used as /services/<slug>" required>
              <Input
                id="service-slug"
                value={form.slug}
                onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
                placeholder="solar-panel-installation"
                required
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Niche" htmlFor="service-niche">
              <Select
                id="service-niche"
                value={form.nicheId}
                onChange={(event) => setForm((current) => ({ ...current, nicheId: event.target.value }))}
              >
                <option value="">Unassigned</option>
                {niches.map((niche) => (
                  <option key={niche.id} value={niche.id}>
                    {niche.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Website category" htmlFor="service-category">
              <Select
                id="service-category"
                value={form.category}
                onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
              >
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field
            label="Phone directory group"
            htmlFor="service-group"
            hint="The numbers assigned to this group are the ones shown for the service."
          >
            <Select
              id="service-group"
              value={form.groupId}
              onChange={(event) => setForm((current) => ({ ...current, groupId: event.target.value }))}
            >
              <option value="">No call group (shows contact message)</option>
              {DIRECTORY_GROUPS.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name} · {group.numberCount} numbers
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Status" htmlFor="service-status">
              <Select
                id="service-status"
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as ServiceRecord['status'] }))}
              >
                <option value="published">Published</option>
                <option value="draft">Draft</option>
              </Select>
            </Field>
            <Field label="Icon key" htmlFor="service-icon" hint="Lucide icon name used on cards.">
              <Input
                id="service-icon"
                value={form.icon}
                onChange={(event) => setForm((current) => ({ ...current, icon: event.target.value }))}
                placeholder="Home"
              />
            </Field>
          </div>

          <div className="rounded-xl border border-line bg-soft/60 px-3.5 py-3">
            <Switch
              checked={form.featured}
              onChange={(featured) => setForm((current) => ({ ...current, featured }))}
              label="Featured on the homepage"
              description="Featured services appear in the popular categories grid."
            />
          </div>

          <Field label="Short description" htmlFor="service-short">
            <Textarea
              id="service-short"
              rows={2}
              value={form.shortDescription}
              onChange={(event) => setForm((current) => ({ ...current, shortDescription: event.target.value }))}
              placeholder="One or two sentences shown on the service card."
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="SEO title" htmlFor="service-seo-title">
              <Input
                id="service-seo-title"
                value={form.metaTitle}
                onChange={(event) => setForm((current) => ({ ...current, metaTitle: event.target.value }))}
              />
            </Field>
            <Field label="SEO description" htmlFor="service-seo-description">
              <Input
                id="service-seo-description"
                value={form.metaDescription}
                onChange={(event) => setForm((current) => ({ ...current, metaDescription: event.target.value }))}
              />
            </Field>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete service?"
        description={`“${pendingDelete?.name ?? ''}” will be removed from the demo directory. Its tracking numbers stay in the phone directory.`}
        confirmLabel="Delete service"
        loading={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />

      {!loading && services.length === 0 ? (
        <Card className="flex items-center gap-3 px-5 py-4 text-sm text-muted">
          <Wrench className="h-4 w-4" /> No services yet — create the first category.
        </Card>
      ) : null}
    </div>
  )
}
