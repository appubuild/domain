import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Pencil, PhoneCall, PhoneOff, Plus, Power, Trash2 } from 'lucide-react'
import { repository, type NewNumber } from '@/admin/data/repository'
import type { PhoneStatus, ServiceRecord, TrackingNumber } from '@/admin/types/admin'
import {
  DIRECTORY_GROUPS,
  groupName,
  phoneStatusTone,
  roleLabel,
  servicesForGroup,
} from '@/admin/lib/selectors'
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

interface NumberFormState {
  serviceId: string
  groupId: string
  number: string
  label: string
  priority: number
  status: PhoneStatus
  network: string
  campaign: string
  notes: string
}

const emptyForm: NumberFormState = {
  serviceId: '',
  groupId: '',
  number: '',
  label: '',
  priority: 1,
  status: 'pending-verification',
  network: '',
  campaign: '',
  notes: '',
}

export const NumbersPage = () => {
  const toast = useToast()
  const [params] = useSearchParams()
  const [numbers, setNumbers] = useState<TrackingNumber[]>([])
  const [services, setServices] = useState<ServiceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [groupFilter, setGroupFilter] = useState(params.get('group') ?? 'all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [editing, setEditing] = useState<TrackingNumber | null>(null)
  const [form, setForm] = useState<NumberFormState>(emptyForm)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<TrackingNumber | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    try {
      const [numberRows, serviceRows] = await Promise.all([repository.listNumbers(), repository.listServices()])
      setNumbers(numberRows)
      setServices(serviceRows)
    } catch {
      toast.error('Could not load tracking numbers')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(
    () =>
      numbers
        .filter((row) => (groupFilter === 'all' ? true : row.groupId === groupFilter))
        .filter((row) => (statusFilter === 'all' ? true : row.status === statusFilter))
        .sort((a, b) => a.groupId.localeCompare(b.groupId) || a.priority - b.priority),
    [numbers, groupFilter, statusFilter],
  )

  const counts = useMemo(
    () => ({
      total: numbers.length,
      active: numbers.filter((row) => row.status === 'active').length,
      pending: numbers.filter((row) => row.status === 'pending-verification').length,
      inactive: numbers.filter((row) => row.status === 'inactive').length,
    }),
    [numbers],
  )

  const openCreate = () => {
    setEditing(null)
    setForm({ ...emptyForm })
    setFormError(null)
    setModalOpen(true)
  }

  const openEdit = (row: TrackingNumber) => {
    setEditing(row)
    setForm({
      serviceId: services.find((service) => service.groupId === row.groupId)?.id ?? '',
      groupId: row.groupId,
      number: row.number,
      label: row.label,
      priority: row.priority,
      status: row.status,
      network: row.network,
      campaign: row.campaign,
      notes: row.notes,
    })
    setFormError(null)
    setModalOpen(true)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.groupId) {
      setFormError('Choose the service (or its directory group) this number belongs to.')
      return
    }
    if (!form.number.trim()) {
      setFormError('A phone number is required.')
      return
    }
    setSaving(true)
    setFormError(null)
    const payload: NewNumber = {
      groupId: form.groupId,
      number: form.number.trim(),
      label: form.label.trim() || `${groupName(form.groupId)} line`,
      priority: Number.isFinite(form.priority) ? Math.max(1, Math.round(form.priority)) : 1,
      status: form.status,
      network: form.network.trim(),
      campaign: form.campaign.trim(),
      notes: form.notes.trim(),
    }
    try {
      if (editing) {
        await repository.updateNumber(editing.id, payload)
        toast.success('Number updated', `${payload.number} saved.`)
      } else {
        await repository.createNumber(payload)
        toast.success('Number added', `${payload.number} assigned to ${groupName(payload.groupId)}.`)
      }
      setModalOpen(false)
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save the number.'
      setFormError(message)
      toast.error('Save failed', message)
    } finally {
      setSaving(false)
    }
  }

  const toggleStatus = async (row: TrackingNumber) => {
    const next: PhoneStatus = row.status === 'active' ? 'inactive' : 'active'
    try {
      await repository.updateNumber(row.id, { status: next })
      toast.success(next === 'active' ? 'Number activated' : 'Number paused', `${row.number} is now ${next}.`)
      await load()
    } catch (error) {
      toast.error('Update failed', error instanceof Error ? error.message : undefined)
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await repository.deleteNumber(pendingDelete.id)
      toast.success('Number deleted', `${pendingDelete.number} removed from the directory.`)
      setPendingDelete(null)
      await load()
    } catch (error) {
      toast.error('Delete failed', error instanceof Error ? error.message : undefined)
    } finally {
      setDeleting(false)
    }
  }

  const columns: Column<TrackingNumber>[] = [
    {
      key: 'number',
      header: 'Number',
      render: (row) => (
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold text-ink">{row.number}</p>
          <p className="truncate text-2xs text-muted">{row.label}</p>
        </div>
      ),
      sortValue: (row) => row.number,
    },
    {
      key: 'group',
      header: 'Service / group',
      render: (row) => {
        const linked = servicesForGroup(services, row.groupId)
        return (
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-ink">{groupName(row.groupId)}</p>
            <p className="truncate text-2xs text-muted">
              {linked.length > 0 ? linked.map((service) => service.name).join(', ') : 'No website page'}
            </p>
          </div>
        )
      },
      sortValue: (row) => row.groupId,
    },
    {
      key: 'role',
      header: 'Role',
      render: (row) => (
        <Badge tone={row.priority === 1 ? 'brand' : 'slate'}>
          {roleLabel(row.priority)} · P{row.priority}
        </Badge>
      ),
      sortValue: (row) => row.priority,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <Badge tone={phoneStatusTone[row.status]}>{row.status.replace('-', ' ')}</Badge>,
      sortValue: (row) => row.status,
    },
    {
      key: 'network',
      header: 'Network / campaign',
      hideBelow: 'md',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-xs text-ink">{row.network || '—'}</p>
          <p className="truncate text-2xs text-muted">{row.campaign || 'No campaign'}</p>
        </div>
      ),
      sortValue: (row) => row.network,
    },
    {
      key: 'updated',
      header: 'Updated',
      hideBelow: 'lg',
      render: (row) => <span className="text-xs text-muted">{formatDate(row.updatedAt)}</span>,
      sortValue: (row) => row.updatedAt,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          <IconButton
            label={row.status === 'active' ? `Pause ${row.number}` : `Activate ${row.number}`}
            onClick={() => toggleStatus(row)}
          >
            <Power className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label={`Edit ${row.number}`} onClick={() => openEdit(row)}>
            <Pencil className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label={`Delete ${row.number}`} tone="danger" onClick={() => setPendingDelete(row)}>
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tracking numbers"
        description="Every line that can appear on the website. Priority 1 is the “Call Now” button; higher priorities become “Call Alternate”."
        meta={
          <>
            <Badge tone="brand">{counts.total} numbers</Badge>
            <Badge tone="success">{counts.active} active</Badge>
            <Badge tone="amber">{counts.pending} pending</Badge>
            <Badge tone="slate">{counts.inactive} inactive</Badge>
          </>
        }
        actions={
          <Button size="sm" onClick={openCreate} iconLeft={<Plus className="h-4 w-4" />}>
            Add number
          </Button>
        }
      />

      <Card>
        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          searchText={(row) => `${row.number} ${row.label} ${row.network} ${row.campaign} ${groupName(row.groupId)}`}
          searchPlaceholder="Search number, service or network…"
          pageSize={10}
          emptyTitle="No numbers match the filters"
          emptyDescription="Add a line or clear the filters to see the full directory."
          toolbar={
            <>
              <Select
                value={groupFilter}
                onChange={(event) => setGroupFilter(event.target.value)}
                aria-label="Filter by service group"
                className="w-44"
              >
                <option value="all">All groups</option>
                {DIRECTORY_GROUPS.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
              <Select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                aria-label="Filter by status"
                className="w-40"
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="pending-verification">Pending</option>
                <option value="inactive">Inactive</option>
              </Select>
            </>
          }
        />
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.number}` : 'Add tracking number'}
        description="Numbers are grouped by service so each trade only ever shows its own lines."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" form="number-form" type="submit" loading={saving}>
              {editing ? 'Save changes' : 'Add number'}
            </Button>
          </>
        }
      >
        <form id="number-form" onSubmit={submit} className="space-y-4">
          {formError ? (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
              {formError}
            </p>
          ) : null}

          <Field label="Service" htmlFor="number-service" hint="The service determines which directory group the number joins.">
            <Select
              id="number-service"
              value={form.serviceId}
              onChange={(event) => {
                const service = services.find((entry) => entry.id === event.target.value)
                setForm((current) => ({
                  ...current,
                  serviceId: event.target.value,
                  groupId: service?.groupId ?? current.groupId,
                  label: service ? `${service.name} line` : current.label,
                }))
              }}
            >
              <option value="">Choose a service…</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                  {service.groupId ? '' : ' — no group'}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Directory group" htmlFor="number-group" required hint="Several services can share one group (e.g. roofing + roof repair).">
            <Select
              id="number-group"
              value={form.groupId}
              onChange={(event) => setForm((current) => ({ ...current, groupId: event.target.value }))}
              required
            >
              <option value="">Choose a group…</option>
              {DIRECTORY_GROUPS.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone number" htmlFor="number-value" required hint="Format: 800-555-0100">
              <Input
                id="number-value"
                value={form.number}
                onChange={(event) => setForm((current) => ({ ...current, number: event.target.value }))}
                placeholder="800-555-0100"
                required
              />
            </Field>
            <Field label="Priority" htmlFor="number-priority" hint="1 = Call Now, 2+ = Call Alternate">
              <Input
                id="number-priority"
                type="number"
                min={1}
                max={9}
                value={form.priority}
                onChange={(event) => setForm((current) => ({ ...current, priority: Number(event.target.value) }))}
              />
            </Field>
          </div>

          <Field label="Description" htmlFor="number-label" hint="Shown in the admin table only.">
            <Input
              id="number-label"
              value={form.label}
              onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
              placeholder="Roofing — primary line"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Status" htmlFor="number-status">
              <Select
                id="number-status"
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as PhoneStatus }))}
              >
                <option value="active">Active (published)</option>
                <option value="pending-verification">Pending verification</option>
                <option value="inactive">Inactive (hidden)</option>
              </Select>
            </Field>
            <Field label="Network" htmlFor="number-network">
              <Input
                id="number-network"
                value={form.network}
                onChange={(event) => setForm((current) => ({ ...current, network: event.target.value }))}
                placeholder="CallRail / Ringba / direct"
              />
            </Field>
          </div>

          <Field label="Campaign" htmlFor="number-campaign">
            <Input
              id="number-campaign"
              value={form.campaign}
              onChange={(event) => setForm((current) => ({ ...current, campaign: event.target.value }))}
              placeholder="Q4 roofing nationwide"
            />
          </Field>

          <Field label="Notes" htmlFor="number-notes">
            <Textarea
              id="number-notes"
              rows={3}
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Confirmation details, restrictions or billing notes."
            />
          </Field>

          <p className="flex items-start gap-2 rounded-lg bg-soft px-3 py-2 text-2xs text-muted">
            <PhoneCall className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Only `active` numbers are published. Pending and inactive lines stay hidden on the public site.
          </p>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete tracking number?"
        description={`${pendingDelete?.number ?? ''} will be removed from ${groupName(pendingDelete?.groupId ?? null)}. This cannot be undone in the demo workspace.`}
        confirmLabel="Delete number"
        loading={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />

      {!loading && numbers.length === 0 ? (
        <Card className="flex items-center gap-3 px-5 py-4 text-sm text-muted">
          <PhoneOff className="h-4 w-4" /> No numbers in the directory yet.
        </Card>
      ) : null}
    </div>
  )
}
