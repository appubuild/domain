"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { Badge, Button, Callout, EmptyState, Skeleton } from "@/components/ui";
import { formatDateTime } from "@/lib/utils/format";

type AuditRow = {
  id: number;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  created_at: string;
};

const PAGE_SIZE = 30;

/** Audit log viewer. Append-only: the UI offers no delete control by design. */
export default function AdminAuditPage() {
  const configured = isSupabaseConfigured();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const from = page * PAGE_SIZE;
    const { data, error: loadError } = await supabase
      .from("audit_logs")
      .select("id,actor_email,action,entity_type,entity_id,summary,created_at")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (loadError) setError(loadError.message);
    setRows((data ?? []) as AuditRow[]);
    setLoading(false);
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!configured) {
    return (
      <Callout tone="warn" title="No database connection">
        The audit log lives in the database. Configure Supabase to view it.
      </Callout>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Audit log</h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            Append-only record of administrative changes. Entries cannot be edited or deleted from this interface.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}>
          Refresh
        </Button>
      </div>

      {error ? <Callout tone="danger" title="Could not load the log">{error}</Callout> : null}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-9" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No entries yet"
          description="Creating, updating or deleting content records an entry here with the actor, entity and timestamp."
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border bg-surface">
          <table className="w-full min-w-[40rem] text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-border bg-surface-2/60 text-[10.5px] uppercase tracking-wide text-fg-subtle">
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Entity</th>
                <th className="px-3 py-2">Summary</th>
                <th className="px-3 py-2">Actor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-b-0">
                  <td className="whitespace-nowrap px-3 py-2 text-fg-muted">{formatDateTime(row.created_at)}</td>
                  <td className="px-3 py-2">
                    <Badge tone={row.action === "delete" ? "danger" : row.action === "create" ? "success" : "neutral"}>
                      {row.action}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11.5px] text-fg-muted">
                    {row.entity_type}
                    {row.entity_id ? `:${row.entity_id.slice(0, 12)}` : ""}
                  </td>
                  <td className="px-3 py-2 text-fg">{row.summary}</td>
                  <td className="px-3 py-2 text-fg-subtle">{row.actor_email ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-[12px] text-fg-muted">
        <span>Page {page + 1}</span>
        <div className="flex gap-1">
          <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>
            Previous
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={rows.length < PAGE_SIZE}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
