"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { sanitizeHtml } from "@/lib/content/sanitize";
import { PUBLIC_ENV } from "@/lib/config/env";
import type { AdminField, AdminMediaField, AdminReference, AdminResource } from "@/lib/admin/resources";
import {
  Badge,
  Button,
  Callout,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Input,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from "@/components/ui";
import { cn, formatDateTime } from "@/lib/utils/format";
import { MediaField } from "./media-field";

type Row = Record<string, unknown>;

const PAGE_SIZE = 25;

function primaryKey(resource: AdminResource): string {
  const immutable = resource.fields.find((field) => field.immutable);
  return immutable?.key ?? "id";
}

function defaultValueFor(field: AdminField): unknown {
  if (field.defaultValue !== undefined) return field.defaultValue;
  switch (field.type) {
    case "boolean":
      return false;
    case "number":
      return 0;
    case "tags":
      return [];
    case "json":
      return {};
    default:
      return "";
  }
}

function emptyDraft(resource: AdminResource): Row {
  const draft: Row = {};
  for (const field of resource.fields) draft[field.key] = defaultValueFor(field);
  return draft;
}

function coerce(field: AdminField, value: unknown): unknown {
  switch (field.type) {
    case "number": {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    case "boolean":
      return Boolean(value);
    case "tags": {
      if (Array.isArray(value)) return value;
      return String(value ?? "")
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    case "json": {
      if (typeof value === "string") {
        try {
          return JSON.parse(value);
        } catch {
          throw new Error(`${field.label} must be valid JSON.`);
        }
      }
      return value;
    }
    case "rich":
      return field.sanitize ? sanitizeHtml(String(value ?? "")) : String(value ?? "");
    default: {
      const text = typeof value === "string" ? value : String(value ?? "");
      // A nullable uuid column cannot accept "" — that is a type error, not "no parent".
      if (field.nullable && text.trim() === "") return null;
      return text;
    }
  }
}

export function ResourceManager({ resource }: { resource: AdminResource }) {
  const { push } = useToast();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Row | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState<Row>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const configured = isSupabaseConfigured();
  const pk = primaryKey(resource);
  const identityKeys = useMemo(() => resource.identityKeys ?? [pk], [resource.identityKeys, pk]);
  const rowKey = useCallback(
    (row: Row) => identityKeys.map((key) => String(row[key] ?? "")).join(":"),
    [identityKeys],
  );

  const load = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const selection = Array.from(
        new Set([
          ...identityKeys,
          ...resource.listColumns.map((column) => column.key),
          ...resource.fields.map((field) => field.key),
        ]),
      ).join(",");
      let query = supabase.from(resource.table).select(selection, { count: "exact" });
      if (search.trim()) {
        const term = search.trim().replace(/[%,]/g, "");
        query = query.or(resource.searchColumns.map((column) => `${column}.ilike.%${term}%`).join(","));
      }
      const from = page * PAGE_SIZE;
      const { data, error: queryError, count } = await query
        .order(resource.orderBy.column, { ascending: resource.orderBy.ascending })
        .range(from, from + PAGE_SIZE - 1);

      if (queryError) throw queryError;
      setRows((data ?? []) as unknown as Row[]);
      setTotal(count ?? 0);
    } catch (loadError) {
      setError((loadError as Error).message);
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [identityKeys, page, resource, search]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Content opens the full-page editor; everything else stays in a centred modal.
   *
   * The row is addressed by its identity key (a slug for posts and pages), not by an internal
   * id, so the editor URL is stable and readable, and a refresh lands on the same record.
   */
  const openNew = () => {
    if (resource.editor) {
      router.push(`${resource.editor.route}?type=${resource.editor.type}&slug=`);
      return;
    }
    setEditing(null);
    setIsNew(true);
    setDraft(emptyDraft(resource));
    setFormError(null);
  };

  const openEdit = (row: Row) => {
    if (resource.editor) {
      const key = row[pk];
      router.push(`${resource.editor.route}?type=${resource.editor.type}&slug=${encodeURIComponent(String(key ?? ""))}`);
      return;
    }
    setEditing(row);
    setIsNew(false);
    setDraft({ ...row });
    setFormError(null);
  };

  const closeEditor = () => {
    setEditing(null);
    setIsNew(false);
    setDraft({});
    setFormError(null);
  };

  const validate = (): string | null => {
    for (const field of resource.fields) {
      if (!field.required) continue;
      const value = draft[field.key];
      if (value === null || value === undefined || String(value).trim() === "") {
        return `${field.label} is required.`;
      }
    }
    if (resource.table === "affiliate_providers") {
      const template = String(draft.url_template ?? "");
      if (!template.startsWith("https://")) return "The URL template must use https://";
      if (!template.includes("{domain}")) return "The URL template must include the {domain} placeholder.";
      const hosts = draft.allowed_hosts;
      if (!Array.isArray(hosts) || hosts.length === 0) return "At least one allowed host is required.";
    }
    if (resource.table === "redirects") {
      if (!String(draft.source_path ?? "").startsWith("/")) return "The source path must start with /.";
      if (draft.source_path === draft.target_path) return "A redirect cannot target itself.";
    }
    if (resource.table === "posts" && draft.status === "published" && !String(draft.published_at ?? "").trim()) {
      return "A published post needs a publish date/time.";
    }
    return null;
  };

  const save = async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    const validationError = validate();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const payload: Row = {};
      for (const field of resource.fields) {
        if (!isNew && field.immutable) continue;
        // Immutable keys are database-generated when left blank (e.g. uuid primary keys).
        if (isNew && field.immutable && String(draft[field.key] ?? "").trim() === "") continue;
        payload[field.key] = coerce(field, draft[field.key]);
      }

      if (isNew) {
        const { error: insertError } = await supabase.from(resource.table).insert(payload);
        if (insertError) throw insertError;
      } else {
        if (!editing) throw new Error("Cannot update a row without an identifier.");
        let update = supabase.from(resource.table).update(payload);
        for (const key of identityKeys) {
          const value = editing[key];
          if (value === undefined || value === null) throw new Error(`Cannot update a row without its ${key}.`);
          update = update.eq(key, value as never);
        }
        const { error: updateError } = await update;
        if (updateError) throw updateError;
      }

      // Audit trail: best-effort, never blocks the mutation result being reported.
      const { error: auditError } = await supabase.from("audit_logs").insert({
        action: isNew ? "create" : "update",
        entity_type: resource.table,
        entity_id: String((isNew ? payload[pk] : editing?.[pk]) ?? ""),
        actor_email: null,
        summary: `${isNew ? "Created" : "Updated"} ${resource.singular}`,
        payload: { keys: Object.keys(payload) },
      });
      if (auditError) {
        push({ tone: "warn", title: "Saved, but the audit entry failed", description: auditError.message });
      } else {
        push({ tone: "success", title: `${resource.singular} saved` });
      }

      closeEditor();
      await load();
    } catch (saveError) {
      const message = (saveError as Error).message;
      setFormError(message);
      push({ tone: "error", title: "Save failed", description: message });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    const supabase = getSupabase();
    if (!supabase || !deleting) return;
    setDeleteBusy(true);
    try {
      let removal = supabase.from(resource.table).delete();
      for (const key of identityKeys) {
        const value = deleting[key];
        if (value === undefined || value === null) throw new Error(`Cannot delete a row without its ${key}.`);
        removal = removal.eq(key, value as never);
      }
      const { error: deleteError } = await removal;
      if (deleteError) throw deleteError;
      await supabase.from("audit_logs").insert({
        action: "delete",
        entity_type: resource.table,
        entity_id: String(deleting[pk] ?? ""),
        summary: `Deleted ${resource.singular}`,
        payload: {},
      });
      push({ tone: "success", title: `${resource.singular} deleted` });
      setDeleting(null);
      await load();
    } catch (deleteError) {
      push({ tone: "error", title: "Delete failed", description: (deleteError as Error).message });
    } finally {
      setDeleteBusy(false);
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const listFields = useMemo(() => resource.listColumns, [resource.listColumns]);

  if (!configured) {
    return (
      <div className="space-y-4">
        <Header resource={resource} onNew={openNew} disabled />
        <Callout tone="warn" title="Supabase is not configured for this build">
          The admin area cannot read or write data until a project is connected. Apply the migrations in
          <code className="mx-1 rounded bg-surface-2 px-1">supabase/migrations</code>, set
          <code className="mx-1 rounded bg-surface-2 px-1">NEXT_PUBLIC_SUPABASE_URL</code> and
          <code className="mx-1 rounded bg-surface-2 px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, then rebuild.
          Nothing here is simulated — no placeholder rows are shown and no writes are pretended to succeed.
        </Callout>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Header resource={resource} onNew={openNew} onRefresh={() => void load()} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <Input
            value={search}
            onChange={(event) => {
              setPage(0);
              setSearch(event.target.value);
            }}
            placeholder={`Search ${resource.label.toLowerCase()}…`}
            className="pl-8"
            aria-label={`Search ${resource.label}`}
          />
        </div>
        <span className="text-[12px] text-fg-subtle">
          {total.toLocaleString()} row{total === 1 ? "" : "s"}
        </span>
        <Button variant="ghost" size="sm" onClick={() => void load()} loading={loading}>
          <RefreshCw className="size-3.5" aria-hidden="true" /> Refresh
        </Button>
      </div>

      {error ? (
        <Callout tone="danger" title="Could not load rows">
          {error}
          <p className="mt-1 text-[11px]">
            Check that migrations were applied and that your account has an admin role (see docs/admin-guide.md).
          </p>
        </Callout>
      ) : null}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-10" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={`No ${resource.label.toLowerCase()} yet`}
          description={error ? "The query failed — see the message above." : "Create the first record, or adjust your search."}
          action={<Button onClick={openNew} size="sm"><Plus className="size-4" /> New {resource.singular}</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border bg-surface">
          <table className="w-full min-w-[36rem] text-left text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface-2/60">
                {listFields.map((column) => (
                  <th key={column.key} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                    {column.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={rowKey(row) || index} className="border-b border-border last:border-b-0 hover:bg-surface-2/40">
                  {listFields.map((column) => {
                    const value = row[column.key];
                    return (
                      <td key={column.key} className={cn("max-w-[18rem] truncate px-3 py-2", column.mono && "font-mono text-[12px]")}>
                        {column.badge && typeof value === "boolean" ? (
                          <Badge tone={value ? "success" : "neutral"}>{value ? "Yes" : "No"}</Badge>
                        ) : column.badge && typeof value === "string" ? (
                          <Badge tone={value === "published" ? "success" : value === "draft" ? "warn" : "neutral"}>{value}</Badge>
                        ) : column.key.endsWith("_at") ? (
                          <span className="text-fg-muted">{formatDateTime(String(value ?? ""))}</span>
                        ) : (
                          <span className="text-fg">{String(value ?? "—")}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-0.5">
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        aria-label={`Edit ${rowKey(row)}`}
                        className="rounded p-1.5 text-fg-subtle hover:bg-surface-2 hover:text-fg"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(row)}
                        aria-label={`Delete ${rowKey(row)}`}
                        className="rounded p-1.5 text-fg-subtle hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 ? (
        <div className="flex items-center justify-between text-[12px] text-fg-muted">
          <span>
            Page {page + 1} of {pageCount}
          </span>
          <div className="flex gap-1">
            <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page + 1 >= pageCount}
              onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog
        open={Boolean(editing) || isNew}
        onClose={closeEditor}
        size={resource.fields.length > 12 ? "xl" : resource.fields.length > 7 ? "lg" : "md"}
        title={isNew ? `New ${resource.singular}` : `Edit ${resource.singular}`}
        description={
          editing && pk in editing && String(editing[pk] ?? "").trim()
            ? `${resource.table} · ${String(editing[pk])}`
            : `Creates a row in ${resource.table}.`
        }
        footer={
          <div className="flex w-full items-center justify-end gap-2">
            <Button variant="secondary" onClick={closeEditor} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} loading={saving}>
              {isNew ? "Create" : "Save changes"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {resource.warning ? <Callout tone="warn">{resource.warning}</Callout> : null}
          {formError ? <Callout tone="danger" title="Not saved">{formError}</Callout> : null}
          {resource.fields.map((field) => (
            <FieldControl
              key={field.key}
              field={field}
              value={draft[field.key]}
              disabled={!isNew && Boolean(field.immutable)}
              onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value }))}
              onSiblingChange={(key, value) => setDraft((current) => ({ ...current, [key]: value }))}
              getSiblingValue={(key) => String(draft[key] ?? "")}
            />
          ))}
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        busy={deleteBusy}
        title={`Delete this ${resource.singular}?`}
        confirmLabel="Delete permanently"
        body={
          <span>
            This removes the row from <code>{resource.table}</code> immediately. Public pages only change after
            the next build. There is no undo.
          </span>
        }
      />
    </div>
  );
}

function Header({
  resource,
  onNew,
  onRefresh,
  disabled,
}: {
  resource: AdminResource;
  onNew: () => void;
  onRefresh?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold tracking-tight">{resource.label}</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">{resource.description}</p>
      </div>
      <div className="flex gap-1.5">
        {onRefresh ? (
          <Button variant="secondary" size="sm" onClick={onRefresh}>
            Refresh
          </Button>
        ) : null}
        <Button size="sm" onClick={onNew} disabled={disabled}>
          <Plus className="size-3.5" aria-hidden="true" /> New {resource.singular}
        </Button>
      </div>
    </div>
  );
}

function FieldControl({
  field,
  value,
  onChange,
  onSiblingChange,
  getSiblingValue,
  disabled,
}: {
  field: AdminField;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Lets a control fill a related field (a picked image fills its alt text). */
  onSiblingChange?: (key: string, value: string) => void;
  /** Reads a sibling field's current value, so a picker can avoid overwriting it. */
  getSiblingValue?: (key: string) => string;
  disabled?: boolean;
}) {
  const id = `field-${field.key}`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-[12px] font-medium text-fg">
        {field.label}
        {field.required ? <span className="ml-0.5 text-danger">*</span> : null}
      </label>

      {field.type === "media" ? (
        <MediaField
          field={field}
          value={value}
          disabled={disabled}
          onChange={onChange}
          onSiblingChange={onSiblingChange}
          getSiblingValue={getSiblingValue}
        />
      ) : field.type === "reference" ? (
        <ReferenceField field={field} value={value} disabled={disabled} onChange={onChange} />
      ) : field.type === "boolean" ? (
        <label className="flex items-center gap-2 text-[13px] text-fg-muted">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
            className="size-4 rounded border-border-strong accent-[var(--accent)]"
          />
          Enabled
        </label>
      ) : field.type === "select" ? (
        <Select id={id} value={String(value ?? "")} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      ) : field.type === "rich" || field.type === "textarea" ? (
        <Textarea
          id={id}
          value={String(value ?? "")}
          disabled={disabled}
          rows={field.type === "rich" ? 12 : 4}
          maxLength={field.maxLength}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          className={field.type === "rich" ? "font-mono text-[12px]" : undefined}
        />
      ) : field.type === "tags" ? (
        <Input
          id={id}
          value={Array.isArray(value) ? value.join(", ") : String(value ?? "")}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder="comma separated"
        />
      ) : (
        <Input
          id={id}
          type={field.type === "number" ? "number" : "text"}
          value={String(value ?? "")}
          disabled={disabled}
          min={field.min}
          max={field.max}
          maxLength={field.maxLength}
          onChange={(event) => onChange(field.type === "number" ? Number(event.target.value) : event.target.value)}
          placeholder={field.placeholder}
        />
      )}

      {field.help ? <p className="text-[11px] leading-relaxed text-fg-subtle">{field.help}</p> : null}
    </div>
  );
}

/** Small helper used by the settings screen for inline dialogs. */
export function SettingsDialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {children}
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Reference fields                                                           */
/* -------------------------------------------------------------------------- */

type ReferenceOption = { value: string; label: string };

type ReferenceState =
  | { status: "loading"; options: ReferenceOption[] }
  | { status: "ready"; options: ReferenceOption[] }
  | { status: "error"; options: ReferenceOption[]; message: string };

/**
 * Loads options for a foreign-key field.
 *
 * Failure is never silent: if the referenced table cannot be read, the control degrades to a
 * text input holding the current value (so the row can still be saved unchanged) and the
 * reason is shown underneath. Blanking the field or guessing an option would quietly corrupt
 * the relationship.
 */
function useReferenceOptions(reference: AdminReference | undefined): ReferenceState {
  const [state, setState] = useState<ReferenceState>({ status: "loading", options: [] });

  useEffect(() => {
    if (!reference) return;
    let cancelled = false;

    const supabase = getSupabase();
    if (!supabase) {
      setState({ status: "error", options: [], message: "Supabase is not configured." });
      return;
    }

    void (async () => {
      const selection = Array.from(new Set([reference.valueColumn, reference.labelColumn])).join(",");
      let query = supabase.from(reference.table).select(selection).limit(500);
      for (const [column, value] of Object.entries(reference.filter ?? {})) {
        query = query.eq(column, value);
      }
      if (reference.orderBy) {
        query = query.order(reference.orderBy.column, { ascending: reference.orderBy.ascending });
      }

      const { data, error } = await query;
      if (cancelled) return;
      if (error) {
        setState({ status: "error", options: [], message: error.message });
        return;
      }

      const options = ((data ?? []) as unknown as Array<Record<string, unknown>>)
        .map((row) => {
          const value = row[reference.valueColumn];
          const label = row[reference.labelColumn];
          if (value === null || value === undefined) return null;
          return { value: String(value), label: label ? String(label) : String(value) };
        })
        .filter((option): option is ReferenceOption => option !== null);

      setState({ status: "ready", options });
    })();

    return () => {
      cancelled = true;
    };
  }, [reference]);

  return state;
}

function ReferenceField({
  field,
  value,
  disabled,
  onChange,
}: {
  field: AdminField;
  value: unknown;
  disabled?: boolean;
  onChange: (value: unknown) => void;
}) {
  const reference = useReferenceOptions(field.reference);
  const current = value === null || value === undefined ? "" : String(value);

  if (!field.reference) {
    return (
      <Input value={current} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
    );
  }

  if (reference.status === "error") {
    return (
      <div className="space-y-1">
        <Input
          value={current}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-label={`${field.label} identifier`}
          className="font-mono text-[12px]"
        />
        <p className="text-[11px] text-warn">
          Could not load options from <code>{field.reference.table}</code>: {reference.message}. The stored
          identifier is shown instead — edit it only if you know the target row.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Select
        value={current}
        disabled={disabled || reference.status === "loading"}
        onChange={(event) => onChange(event.target.value)}
      >
        {field.nullable ? <option value="">— none —</option> : null}
        {current !== "" && !reference.options.some((option) => option.value === current) ? (
          // The referenced row may have been deleted or filtered out; keep the value visible.
          <option value={current}>{current} (not in the current list)</option>
        ) : null}
        {reference.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      {reference.status === "loading" ? (
        <p className="text-[11px] text-fg-subtle">Loading options…</p>
      ) : reference.options.length === 0 ? (
        <p className="text-[11px] text-fg-subtle">
          {field.reference.emptyHint ?? `No rows in ${field.reference.table} yet.`}
        </p>
      ) : null}
    </div>
  );
}
