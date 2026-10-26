"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { Badge, Button, Callout, Card, Field, Input, Skeleton, Switch, Textarea, useToast } from "@/components/ui";
import { formatDateTime } from "@/lib/utils/format";

type SettingsRow = { key: string; value: Record<string, unknown>; description: string; is_public: boolean; updated_at: string };

const BRAND_FIELDS = [
  { key: "name", label: "Brand name", type: "text" },
  { key: "shortName", label: "Short name", type: "text" },
  { key: "tagline", label: "Tagline", type: "text" },
  { key: "description", label: "Site description", type: "textarea" },
  { key: "logoMark", label: "Logo mark (2 characters)", type: "text" },
  { key: "contactEmail", label: "Contact email", type: "text" },
] as const;

const SEO_FIELDS = [
  { key: "defaultTitleSuffix", label: "Default title suffix", type: "text" },
  { key: "defaultDescription", label: "Default meta description", type: "textarea" },
  { key: "organizationName", label: "Organisation name (structured data)", type: "text" },
  { key: "twitterHandle", label: "Twitter/X handle", type: "text" },
] as const;

export default function AdminSettingsPage() {
  const { push } = useToast();
  const configured = isSupabaseConfigured();
  const [rows, setRows] = useState<SettingsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Record<string, unknown>>>({});

  const load = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from("site_settings")
      .select("key,value,description,is_public,updated_at")
      .order("key");
    if (loadError) setError(loadError.message);
    const list = (data ?? []) as SettingsRow[];
    setRows(list);
    setDrafts(Object.fromEntries(list.map((row) => [row.key, { ...row.value }])));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (key: string) => {
    const supabase = getSupabase();
    if (!supabase) return;
    setSavingKey(key);
    try {
      const { error: updateError } = await supabase
        .from("site_settings")
        .update({ value: drafts[key] ?? {}, updated_at: new Date().toISOString() })
        .eq("key", key);
      if (updateError) throw updateError;

      const { error: auditError } = await supabase.from("audit_logs").insert({
        action: "update",
        entity_type: "site_settings",
        entity_id: key,
        summary: `Updated ${key} settings`,
        payload: {},
      });
      if (auditError) push({ tone: "warn", title: "Saved, audit entry failed", description: auditError.message });
      else push({ tone: "success", title: "Settings saved", description: "Rebuild the site to publish branding and SEO changes." });
      await load();
    } catch (saveError) {
      push({ tone: "error", title: "Save failed", description: (saveError as Error).message });
    } finally {
      setSavingKey(null);
    }
  };

  const setField = (key: string, field: string, value: unknown) => {
    setDrafts((current) => ({ ...current, [key]: { ...(current[key] ?? {}), [field]: value } }));
  };

  if (!configured) {
    return (
      <Callout tone="warn" title="No database connection">
        Settings are stored in the <code>site_settings</code> table. Configure Supabase and apply the migrations
        to edit them. The public site falls back to the offline content pack in the meantime.
      </Callout>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          Brand, SEO and feature settings. Public values are readable by the browser; nothing secret belongs here.
        </p>
      </div>

      {error ? <Callout tone="danger" title="Could not load settings">{error}</Callout> : null}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      ) : (
        rows.map((row) => {
          const fields =
            row.key === "brand" ? BRAND_FIELDS : row.key === "seo" ? SEO_FIELDS : null;
          const draft = drafts[row.key] ?? {};

          return (
            <Card key={row.key} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold capitalize">{row.key}</h2>
                  <p className="text-[11px] text-fg-subtle">{row.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={row.is_public ? "accent" : "neutral"}>{row.is_public ? "public" : "private"}</Badge>
                  <span className="text-[10.5px] text-fg-subtle">{formatDateTime(row.updated_at)}</span>
                </div>
              </div>

              {fields ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {fields.map((field) => (
                    <Field key={field.key} label={field.label} htmlFor={`${row.key}-${field.key}`}>
                      {field.type === "textarea" ? (
                        <Textarea
                          id={`${row.key}-${field.key}`}
                          rows={3}
                          value={String(draft[field.key] ?? "")}
                          onChange={(event) => setField(row.key, field.key, event.target.value)}
                        />
                      ) : (
                        <Input
                          id={`${row.key}-${field.key}`}
                          value={String(draft[field.key] ?? "")}
                          onChange={(event) => setField(row.key, field.key, event.target.value)}
                        />
                      )}
                    </Field>
                  ))}
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  {Object.entries(draft).map(([fieldKey, value]) => (
                    <div key={fieldKey}>
                      {typeof value === "boolean" ? (
                        <Switch
                          checked={value}
                          onChange={(next) => setField(row.key, fieldKey, next)}
                          label={fieldKey}
                        />
                      ) : (
                        <Field label={fieldKey} htmlFor={`${row.key}-${fieldKey}`}>
                          <Input
                            id={`${row.key}-${fieldKey}`}
                            value={String(value ?? "")}
                            onChange={(event) => setField(row.key, fieldKey, event.target.value)}
                          />
                        </Field>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                <p className="text-[10.5px] text-fg-subtle">
                  Changes are validated by the database and apply after a rebuild.
                </p>
                <Button size="sm" onClick={() => void save(row.key)} loading={savingKey === row.key}>
                  Save {row.key}
                </Button>
              </div>
            </Card>
          );
        })
      )}

      <Callout tone="info" title="Where secrets live">
        Service-role keys, AI provider keys and registrar API keys must never be stored in these public settings.
        They belong in Supabase Edge Function secrets; see docs/security.md.
      </Callout>
    </div>
  );
}
