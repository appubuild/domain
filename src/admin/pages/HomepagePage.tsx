import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Eye, EyeOff, LayoutTemplate, Pencil, Plus, Trash2 } from 'lucide-react'
import { repository } from '@/admin/data/repository'
import type { HomepageSection } from '@/admin/types/admin'
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
  Switch,
  Textarea,
  cn,
} from '@/admin/components/ui'
import { useToast } from '@/admin/context/ToastContext'

interface SectionFormState {
  name: string
  key: string
  heading: string
  subheading: string
}

const emptyForm: SectionFormState = { name: '', key: '', heading: '', subheading: '' }

export const HomepagePage = () => {
  const toast = useToast()
  const [sections, setSections] = useState<HomepageSection[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<HomepageSection | null>(null)
  const [form, setForm] = useState<SectionFormState>(emptyForm)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<HomepageSection | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    try {
      setSections(await repository.listSections())
    } catch {
      toast.error('Could not load homepage sections')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  const openEdit = (section: HomepageSection) => {
    setEditing(section)
    setForm({
      name: section.name,
      key: section.key,
      heading: section.heading,
      subheading: section.subheading,
    })
    setModalOpen(true)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (editing) {
        await repository.updateSection(editing.id, {
          name: form.name.trim(),
          key: form.key.trim() || editing.key,
          heading: form.heading.trim(),
          subheading: form.subheading.trim(),
        })
        toast.success('Section updated', form.name)
      } else {
        await repository.createSection({
          name: form.name.trim(),
          key: form.key.trim() || form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          heading: form.heading.trim(),
          subheading: form.subheading.trim(),
          visible: true,
          sortOrder: sections.length + 1,
        })
        toast.success('Section created', form.name)
      }
      setModalOpen(false)
      await load()
    } catch (error) {
      toast.error('Save failed', error instanceof Error ? error.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  const toggleVisible = async (section: HomepageSection) => {
    try {
      await repository.updateSection(section.id, { visible: !section.visible })
      toast.success(section.visible ? 'Section hidden' : 'Section shown', section.name)
      await load()
    } catch {
      toast.error('Could not change the section visibility')
    }
  }

  const move = async (section: HomepageSection, direction: 'up' | 'down') => {
    try {
      setSections(await repository.moveSection(section.id, direction))
    } catch {
      toast.error('Could not reorder the sections')
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await repository.deleteSection(pendingDelete.id)
      toast.success('Section deleted', pendingDelete.name)
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
        title="Homepage sections"
        description="Reorder the page, toggle sections on or off, and edit their headings."
        meta={
          <>
            <Badge tone="brand">{sections.length} sections</Badge>
            <Badge tone="success">{sections.filter((section) => section.visible).length} visible</Badge>
          </>
        }
        actions={
          <Button size="sm" onClick={openCreate} iconLeft={<Plus className="h-4 w-4" />}>
            New section
          </Button>
        }
      />

      {loading ? (
        <Card className="h-64 animate-pulse" />
      ) : (
        <div className="space-y-2.5">
          {sections.map((section, index) => (
            <Card
              key={section.id}
              className={cn('flex flex-wrap items-center gap-3 p-3.5 transition', !section.visible && 'opacity-70')}
            >
              <div className="flex flex-col gap-0.5">
                <IconButton
                  label={`Move ${section.name} up`}
                  onClick={() => move(section, 'up')}
                  disabled={index === 0}
                  className="h-6 w-6 disabled:opacity-40"
                >
                  <ArrowUp className="h-3 w-3" />
                </IconButton>
                <IconButton
                  label={`Move ${section.name} down`}
                  onClick={() => move(section, 'down')}
                  disabled={index === sections.length - 1}
                  className="h-6 w-6 disabled:opacity-40"
                >
                  <ArrowDown className="h-3 w-3" />
                </IconButton>
              </div>

              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-soft text-2xs font-bold text-muted">
                {index + 1}
              </span>

              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-display text-sm font-bold text-ink">
                  {section.name}
                  <Badge tone="slate">{section.key}</Badge>
                  {section.visible ? null : <Badge tone="amber">Hidden</Badge>}
                </p>
                <p className="truncate text-xs text-muted">{section.heading || 'No heading yet'}</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleVisible(section)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg border border-line px-2 py-1.5 text-2xs font-semibold transition',
                    section.visible ? 'text-success-700 hover:bg-soft dark:text-success-300' : 'text-muted hover:bg-soft',
                  )}
                >
                  {section.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  {section.visible ? 'Visible' : 'Hidden'}
                </button>
                <IconButton label={`Edit ${section.name}`} onClick={() => openEdit(section)}>
                  <Pencil className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton label={`Delete ${section.name}`} tone="danger" onClick={() => setPendingDelete(section)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            </Card>
          ))}
        </div>
      )}

      {!loading && sections.length === 0 ? (
        <Card className="flex items-center gap-3 px-5 py-6 text-sm text-muted">
          <LayoutTemplate className="h-4 w-4" /> No homepage sections yet.
        </Card>
      ) : null}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'New homepage section'}
        description="Headings and subheadings are stored here; the public homepage layout is compiled from the site source."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" form="section-form" type="submit" loading={saving}>
              {editing ? 'Save changes' : 'Create section'}
            </Button>
          </>
        }
      >
        <form id="section-form" onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Section name" htmlFor="section-name" required>
              <Input
                id="section-name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                required
              />
            </Field>
            <Field label="Key" htmlFor="section-key" hint="Stable identifier used by templates.">
              <Input
                id="section-key"
                value={form.key}
                onChange={(event) => setForm((current) => ({ ...current, key: event.target.value }))}
              />
            </Field>
          </div>
          <Field label="Heading" htmlFor="section-heading">
            <Input
              id="section-heading"
              value={form.heading}
              onChange={(event) => setForm((current) => ({ ...current, heading: event.target.value }))}
            />
          </Field>
          <Field label="Subheading" htmlFor="section-subheading">
            <Textarea
              id="section-subheading"
              rows={2}
              value={form.subheading}
              onChange={(event) => setForm((current) => ({ ...current, subheading: event.target.value }))}
            />
          </Field>
          {editing ? (
            <div className="rounded-xl border border-line bg-soft/60 px-3.5 py-3">
              <Switch
                checked={editing.visible}
                onChange={(visible) => {
                  setEditing({ ...editing, visible })
                  repository
                    .updateSection(editing.id, { visible })
                    .then(() => load())
                    .catch(() => toast.error('Could not update visibility'))
                }}
                label="Visible on the homepage"
              />
            </div>
          ) : null}
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete section?"
        description={`“${pendingDelete?.name ?? ''}” will be removed from the homepage layout.`}
        confirmLabel="Delete section"
        loading={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
