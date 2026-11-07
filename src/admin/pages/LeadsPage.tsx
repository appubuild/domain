import { useCallback, useEffect, useMemo, useState } from 'react'
import { Inbox, Mail, Phone, Trash2, UserRoundCheck } from 'lucide-react'
import { repository } from '@/admin/data/repository'
import type { LeadRecord, LeadStatus } from '@/admin/types/admin'
import { leadStatusTone } from '@/admin/lib/selectors'
import { formatDateTime, initialsOf, timeAgo } from '@/admin/lib/format'
import { DataTable, type Column } from '@/admin/components/DataTable'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Modal,
  PageHeader,
  Segmented,
  Select,
  Textarea,
} from '@/admin/components/ui'
import { useToast } from '@/admin/context/ToastContext'
import { useAdminAuth } from '@/admin/context/AdminAuthContext'

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'closed', label: 'Closed' },
]

export const LeadsPage = () => {
  const toast = useToast()
  const { user } = useAdminAuth()
  const [leads, setLeads] = useState<LeadRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | LeadStatus>('all')
  const [active, setActive] = useState<LeadRecord | null>(null)
  const [reply, setReply] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<LeadRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    try {
      setLeads(await repository.listLeads())
    } catch {
      toast.error('Could not load leads')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const counts = useMemo(
    () =>
      STATUS_OPTIONS.reduce<Record<string, number>>((acc, option) => {
        acc[option.value] = leads.filter((lead) => lead.status === option.value).length
        return acc
      }, {}),
    [leads],
  )

  const filtered = useMemo(
    () => leads.filter((lead) => (statusFilter === 'all' ? true : lead.status === statusFilter)),
    [leads, statusFilter],
  )

  const updateLead = async (lead: LeadRecord, patch: Partial<LeadRecord>) => {
    setSaving(true)
    try {
      const updated = await repository.updateLead(lead.id, patch)
      setActive((current) => (current && current.id === updated.id ? updated : current))
      toast.success('Lead updated', `${lead.name} · ${updated.status}`)
      await load()
    } catch (error) {
      toast.error('Update failed', error instanceof Error ? error.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await repository.deleteLead(pendingDelete.id)
      toast.success('Lead deleted', pendingDelete.name)
      setPendingDelete(null)
      setActive(null)
      await load()
    } catch (error) {
      toast.error('Delete failed', error instanceof Error ? error.message : undefined)
    } finally {
      setDeleting(false)
    }
  }

  const columns: Column<LeadRecord>[] = [
    {
      key: 'name',
      header: 'Contact',
      render: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-soft text-2xs font-bold text-muted">
            {initialsOf(row.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">{row.name}</p>
            <p className="truncate text-2xs text-muted">{row.email}</p>
          </div>
        </div>
      ),
      sortValue: (row) => row.name,
    },
    {
      key: 'service',
      header: 'Service',
      render: (row) => <span className="text-xs text-ink">{row.service}</span>,
      sortValue: (row) => row.service,
    },
    {
      key: 'source',
      header: 'Source',
      hideBelow: 'md',
      render: (row) => <Badge tone="slate">{row.source}</Badge>,
      sortValue: (row) => row.source,
    },
    {
      key: 'priority',
      header: 'Priority',
      hideBelow: 'lg',
      render: (row) => (
        <Badge tone={row.priority === 'high' ? 'rose' : row.priority === 'normal' ? 'brand' : 'slate'}>
          {row.priority}
        </Badge>
      ),
      sortValue: (row) => row.priority,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <Badge tone={leadStatusTone[row.status]}>{row.status}</Badge>,
      sortValue: (row) => row.status,
    },
    {
      key: 'created',
      header: 'Received',
      hideBelow: 'sm',
      render: (row) => <span className="text-xs text-muted">{timeAgo(row.createdAt)}</span>,
      sortValue: (row) => row.createdAt,
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Leads & support"
        description="Every contact-form enquiry and support message, with triage status and assignment."
        meta={
          <>
            <Badge tone="brand">{counts.new ?? 0} new</Badge>
            <Badge tone="amber">{counts.contacted ?? 0} contacted</Badge>
            <Badge tone="violet">{counts.qualified ?? 0} qualified</Badge>
            <Badge tone="slate">{counts.closed ?? 0} closed</Badge>
          </>
        }
        actions={
          <Segmented
            options={[{ value: 'all' as const, label: 'All' }, ...STATUS_OPTIONS]}
            value={statusFilter}
            onChange={(value) => setStatusFilter(value)}
            ariaLabel="Filter leads by status"
            size="sm"
          />
        }
      />

      <Card>
        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          searchText={(row) => `${row.name} ${row.email} ${row.phone} ${row.service} ${row.message}`}
          searchPlaceholder="Search name, email, service or message…"
          pageSize={8}
          initialSort={{ key: 'created', direction: 'desc' }}
          onRowClick={(row) => {
            setActive(row)
            setReply('')
          }}
          emptyTitle="No leads in this view"
          emptyDescription="New enquiries from the contact form will appear here."
        />
      </Card>

      <Modal
        open={Boolean(active)}
        onClose={() => setActive(null)}
        title={active ? `${active.name} · ${active.service}` : 'Lead'}
        description={active ? `${active.source} · received ${formatDateTime(active.createdAt)}` : undefined}
        footer={
          active ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPendingDelete(active)}
                iconLeft={<Trash2 className="h-3.5 w-3.5" />}
              >
                Delete
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={saving}
                onClick={() => updateLead(active, { assignedTo: active.assignedTo ? null : user?.name ?? 'Admin' })}
                iconLeft={<UserRoundCheck className="h-3.5 w-3.5" />}
              >
                {active.assignedTo ? 'Unassign' : 'Assign to me'}
              </Button>
              <Button
                size="sm"
                loading={saving}
                onClick={() => updateLead(active, { status: active.status === 'new' ? 'contacted' : 'closed' })}
              >
                {active.status === 'new' ? 'Mark contacted' : 'Mark closed'}
              </Button>
            </>
          ) : null
        }
      >
        {active ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <a
                href={`mailto:${active.email}`}
                className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-xs font-medium text-ink transition hover:bg-soft"
              >
                <Mail className="h-3.5 w-3.5 text-muted" /> {active.email}
              </a>
              <a
                href={`tel:${active.phone.replace(/[^\d+]/g, '')}`}
                className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-xs font-medium text-ink transition hover:bg-soft"
              >
                <Phone className="h-3.5 w-3.5 text-muted" /> {active.phone}
              </a>
            </div>

            <div className="rounded-xl bg-soft px-3.5 py-3">
              <p className="text-2xs font-semibold uppercase tracking-wide text-muted">Message</p>
              <p className="mt-1 text-sm leading-relaxed text-ink">{active.message}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Status" htmlFor="lead-status">
                <Select
                  id="lead-status"
                  value={active.status}
                  onChange={(event) => updateLead(active, { status: event.target.value as LeadStatus })}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Assigned to" htmlFor="lead-assignee">
                <Select
                  id="lead-assignee"
                  value={active.assignedTo ?? ''}
                  onChange={(event) => updateLead(active, { assignedTo: event.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {user ? <option value={user.name}>{user.name}</option> : null}
                  <option value="Support queue">Support queue</option>
                </Select>
              </Field>
            </div>

            <Field label="Reply (opens your email app)" htmlFor="lead-reply" hint="Opens your email app — nothing is sent from the browser.">
              <Textarea
                id="lead-reply"
                rows={3}
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder={`Hi ${active.name.split(' ')[0]}, thanks for reaching out about ${active.service.toLowerCase()}…`}
              />
            </Field>
            <a
              href={`mailto:${active.email}?subject=${encodeURIComponent(`Re: your ${active.service} enquiry`)}&body=${encodeURIComponent(reply)}`}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              <Mail className="h-4 w-4" /> Compose reply
            </a>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete lead?"
        description={`The enquiry from ${pendingDelete?.name ?? ''} will be removed from the inbox.`}
        confirmLabel="Delete lead"
        loading={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />

      {!loading && leads.length === 0 ? (
        <Card className="flex items-center gap-3 px-5 py-4 text-sm text-muted">
          <Inbox className="h-4 w-4" /> The inbox is empty.
        </Card>
      ) : null}
    </div>
  )
}
