/**
 * Tracking numbers.
 *
 * One number, one service. The form asks for three things — the number, an
 * optional label and the service it belongs to — and nothing else. There are no
 * directory groups, no priorities and no "alternate line" concept any more: a
 * service shows exactly one line, and a line can only belong to one service.
 *
 * The same relationship can be set from the service form; both screens write
 * `services.phone_number_id`, so the two views can never disagree.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, PhoneCall, PhoneOff, Plus, Power, Trash2 } from 'lucide-react'
import { repository, type NewNumber } from '@/admin/data/repository'
import type { PhoneStatus, ServiceRecord, TrackingNumber } from '@/admin/types/admin'
import { phoneStatusTone } from '@/admin/lib/selectors'
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
} from '@/admin/components/ui'
import { useToast } from '@/admin/context/ToastContext'

interface NumberFormState {
  number: string
  label: string
  status: PhoneStatus
  serviceId: string
}

const emptyForm: NumberFormState = {
  number: '',
  label: '',
  status: 'active',
  serviceId: '',
}

export const NumbersPage = () => {
  const toast = useToast()
  const [numbers, setNumbers] = useState<TrackingNumber[]>([])
  const [services, setServices] = useState<ServiceRecord[]>([])
  const [loading, setLoading] = useState(true)
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
    void load()
  }, [load])

  const filtered = useMemo(
    () =>
      numbers
        .filter((row) => (statusFilter === 'all' ? true : row.status === statusFilter))
        .sort((a, b) => a.number.localeCompare(b.number)),
    [numbers, statusFilter],
  )

  const counts = useMemo(
    () => ({
      total: numbers.length,
      active: numbers.filter((row) => row.status === 'active').length,
      pending: numbers.filter((row) => row.status === 'pending-verification').length,
      inactive: numbers.filter((row) => row.status === 'inactive').length,
      unassigned: numbers.filter((row) => !row.serviceId).length,
    }),
    [numbers],
  )

  /** A service can only show one line, so a number already used elsewhere is hidden. */
  const availableServices = useMemo(
    () => services.filter((service) => !service.phoneNumberId || service.id === form.serviceId),
    [services, form.serviceId],
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
      number: row.number,
      label: row.label,
      status: row.status,
      serviceId: row.serviceId ?? '',
    })
    setFormError(null)
    setModalOpen(true)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.number.trim()) {
      setFormError('A phone number is required.')
      return
    }

    setSaving(true)
    setFormError(null)

    const service = services.find((entry) => entry.id === form.serviceId)
    const payload: NewNumber = {
      number: form.number.trim(),
      label: form.label.trim(),
      status: form.status,
      serviceId: form.serviceId || null,
      serviceName: service?.name ?? null,
      groupId: null,
      priority: 1,
      network: '',
      campaign: '',
      notes: '',
    }

    try {
      if (editing) {
        await repository.updateNumber(editing.id, payload)
        toast.success('Number updated', `${payload.number} saved.`)
      } else {
        await repository.createNumber(payload)
        toast.success(
          'Number added',
          service ? `${payload.number} is now the line for ${service.name}.` : `${payload.number} added. Assign it to a service when you are ready.`,
        )
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
      toast.success('Number deleted', `${pendingDelete.number} removed.`)
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
          <p className="truncate text-2xs text-muted">{row.label || 'No label'}</p>
        </div>
      ),
      sortValue: (row) => row.number,
    },
    {
      key: 'service',
      header: 'Service',
      render: (row) =>
        row.serviceName ? (
          <span className="text-xs font-medium text-ink">{row.serviceName}</span>
        ) : (
          <Badge tone="amber">Not assigned</Badge>
        ),
      sortValue: (row) => row.serviceName ?? '',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <Badge tone={phoneStatusTone[row.status]}>{row.status.replace('-', ' ')}</Badge>,
      sortValue: (row) => row.status,
    },
    {
      key: 'updated',
      header: 'Updated',
      hideBelow: 'md',
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
            onClick={() => void toggleStatus(row)}
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
        description="One line per service. Add the number, pick the service, done — the public call button uses it automatically."
        meta={
          <>
            <Badge tone="brand">{counts.total} numbers</Badge>
            <Badge tone="success">{counts.active} active</Badge>
            <Badge tone="amber">{counts.pending} pending</Badge>
            <Badge tone="slate">{counts.inactive} inactive</Badge>
            {counts.unassigned > 0 ? <Badge tone="violet">{counts.unassigned} unassigned</Badge> : null}
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
          searchText={(row) => `${row.number} ${row.label} ${row.serviceName ?? ''}`}
          searchPlaceholder="Search number or service…"
          pageSize={10}
          emptyTitle="No numbers match the filters"
          emptyDescription="Add a line, or clear the filter to see every number."
          toolbar={
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
          }
        />
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.number}` : 'Add phone number'}
        description="A number belongs to one service. Pick the service here, or assign the number from the service form later."
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

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone number" htmlFor="number-value" required hint="Format: 800-555-0100">
              <Input
                id="number-value"
                value={form.number}
                onChange={(event) => setForm((current) => ({ ...current, number: event.target.value }))}
                placeholder="800-555-0100"
                inputMode="tel"
                required
              />
            </Field>
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
          </div>

          <Field label="Service" htmlFor="number-service" hint="Optional. A service shows exactly one line.">
            <Select
              id="number-service"
              value={form.serviceId}
              onChange={(event) => {
                const service = services.find((entry) => entry.id === event.target.value)
                setForm((current) => ({
                  ...current,
                  serviceId: event.target.value,
                  label: current.label || (service ? `${service.name} line` : current.label),
                }))
              }}
            >
              <option value="">Not assigned yet</option>
              {availableServices.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Label" htmlFor="number-label" hint="Optional. Appears on the service page under the call button.">
            <Input
              id="number-label"
              value={form.label}
              onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
              placeholder="Roofing service line"
            />
          </Field>

          <p className="flex items-start gap-2 rounded-lg bg-soft px-3 py-2 text-2xs text-muted">
            <PhoneCall className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Only active numbers are published. Pending and inactive lines stay hidden on the public site.
          </p>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete phone number?"
        description={`${pendingDelete?.number ?? ''} will be removed${pendingDelete?.serviceName ? ` from ${pendingDelete.serviceName}` : ''}. This cannot be undone.`}
        confirmLabel="Delete number"
        loading={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />

      {!loading && numbers.length === 0 ? (
        <Card className="flex items-center gap-3 px-5 py-4 text-sm text-muted">
          <PhoneOff className="h-4 w-4" /> No numbers yet. Add one, then assign it to a service.
        </Card>
      ) : null}
    </div>
  )
}

export default NumbersPage
