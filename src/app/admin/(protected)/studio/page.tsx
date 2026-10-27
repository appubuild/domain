"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, ClipboardCheck, RefreshCw, Sparkles, X } from "lucide-react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { PUBLIC_ENV } from "@/lib/config/env";
import {
  DRAFT_KINDS,
  STUDIO_DISCLOSURE,
  buildPayload,
  parseStudioResponse,
  previewText,
  validateRequest,
  type DraftKind,
} from "@/lib/ai/studio";
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from "@/components/ui";
import { formatDateTime } from "@/lib/utils/format";

type DraftRow = {
  id: string;
  kind: DraftKind;
  prompt_summary: string;
  provider: string;
  model: string | null;
  content: string;
  status: "pending_review" | "accepted" | "rejected" | "failed";
  created_at: string;
  post_id: string | null;
};

/**
 * AI content studio.
 *
 * The studio can only produce **drafts**. There is no "publish" control on this screen: a
 * draft can be copied into a post (which opens as a normal draft post), and publishing remains
 * a separate, deliberate action in the posts module followed by a rebuild.
 *
 * When no function is deployed the screen says so and disables the form — it never fabricates
 * a generated article.
 */
export default function AdminStudioPage() {
  const { push } = useToast();
  const configured = isSupabaseConfigured();
  const fnUrl = PUBLIC_ENV.aiFunctionUrl;

  const [flagEnabled, setFlagEnabled] = useState<boolean | null>(null);
  const [flagError, setFlagError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    kind: "outline" as DraftKind,
    topic: "",
    audience: "",
    tone: "",
    keywords: "",
    wordTarget: 700,
  });
  const [reviewing, setReviewing] = useState<DraftRow | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const [flagResult, draftResult] = await Promise.all([
      supabase.from("feature_flags").select("key,enabled").eq("key", "ai_studio").maybeSingle(),
      supabase
        .from("ai_drafts")
        .select("id,kind,prompt_summary,provider,model,content,status,created_at,post_id")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    if (flagResult.error) setFlagError(flagResult.error.message);
    else setFlagEnabled(flagResult.data?.enabled === true);

    if (!draftResult.error) setDrafts((draftResult.data ?? []) as DraftRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async () => {
    const request = {
      kind: form.kind,
      topic: form.topic,
      audience: form.audience,
      tone: form.tone,
      keywords: form.keywords.split(/[,\n]/).map((keyword) => keyword.trim()).filter(Boolean),
      wordTarget: form.wordTarget,
    };

    const found = validateRequest(request);
    if (found.length > 0) {
      setIssues(Object.fromEntries(found.map((issue) => [issue.field, issue.message])));
      return;
    }
    setIssues({});

    const supabase = getSupabase();
    if (!supabase) return;

    setBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Your session expired. Sign in again.");

      const response = await fetch(fnUrl as string, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(buildPayload(request)),
      });

      const body = await response.json().catch(() => null);
      const parsed = parseStudioResponse(response.status, body);
      if (!parsed.ok) {
        push({
          tone: parsed.reason === "unconfigured" || parsed.reason === "flag-off" ? "warn" : "error",
          title: "Nothing was generated",
          description: parsed.message,
        });
        return;
      }

      push({
        tone: "success",
        title: "Draft created",
        description: "Saved with status “pending review”. Nothing was published.",
      });
      setForm((current) => ({ ...current, topic: "" }));
      await load();
    } catch (error) {
      push({ tone: "error", title: "Studio request failed", description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (draft: DraftRow, status: DraftRow["status"]) => {
    const supabase = getSupabase();
    if (!supabase) return;
    const { error } = await supabase.from("ai_drafts").update({ status }).eq("id", draft.id);
    if (error) {
      push({ tone: "error", title: "Could not update the draft", description: error.message });
      return;
    }
    await supabase.from("audit_logs").insert({
      action: "update",
      entity_type: "ai_drafts",
      entity_id: draft.id,
      summary: `Marked AI draft ${status}`,
      payload: { status },
    });
    push({ tone: "success", title: `Draft marked ${status.replace("_", " ")}` });
    await load();
  };

  const copyToClipboard = async (draft: DraftRow) => {
    try {
      await navigator.clipboard.writeText(draft.content);
      push({ tone: "success", title: "Copied", description: "Paste it into a post draft and edit before publishing." });
    } catch {
      setReviewing(draft);
    }
  };

  const unavailableReason = !configured
    ? "Supabase is not configured for this build."
    : !fnUrl
      ? "NEXT_PUBLIC_AI_FN_URL is not set, so there is no generator to call."
      : flagEnabled === false
        ? "The ai_studio feature flag is off."
        : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="flex items-center gap-1.5 text-xl font-semibold tracking-tight">
            <Sparkles className="size-4 text-accent" aria-hidden="true" /> AI content studio
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">{STUDIO_DISCLOSURE}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}>
          <RefreshCw className="size-3.5" /> Refresh
        </Button>
      </div>

      <Callout tone="info" title="Draft-only by design">
        Nothing here can publish. Generated text lands in <code>ai_drafts</code> with status
        <code className="mx-1">pending_review</code>; moving it into a post is a separate step, and
        publishing still requires a rebuild.
      </Callout>

      {flagError ? <Callout tone="danger" title="Could not read the feature flag">{flagError}</Callout> : null}

      {unavailableReason ? (
        <Callout tone="warn" title="Studio unavailable" icon={<Bot className="size-4" />}>
          {unavailableReason} The form below is disabled rather than pretending to generate text.
          {!fnUrl && configured ? (
            <span className="mt-1 block">
              Deploy <code>supabase/functions/ai-studio</code>, set its <code>AI_API_KEY</code> secret, then
              set <code>NEXT_PUBLIC_AI_FN_URL</code> and rebuild.
            </span>
          ) : null}
        </Callout>
      ) : null}

      <Card className="p-4">
        <h2 className="text-sm font-semibold">Generate a draft</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="What to produce" htmlFor="studio-kind">
            <Select
              id="studio-kind"
              value={form.kind}
              disabled={Boolean(unavailableReason) || busy}
              onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value as DraftKind }))}
            >
              {DRAFT_KINDS.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-[11px] text-fg-subtle">
              {DRAFT_KINDS.find((kind) => kind.value === form.kind)?.hint}
            </p>
          </Field>

          <Field label="Topic" htmlFor="studio-topic" error={issues.topic} required>
            <Input
              id="studio-topic"
              value={form.topic}
              disabled={Boolean(unavailableReason) || busy}
              onChange={(event) => setForm((current) => ({ ...current, topic: event.target.value }))}
              placeholder="How to choose an extension for a fintech brand"
              maxLength={200}
            />
          </Field>

          <Field label="Audience" htmlFor="studio-audience">
            <Input
              id="studio-audience"
              value={form.audience}
              disabled={Boolean(unavailableReason) || busy}
              onChange={(event) => setForm((current) => ({ ...current, audience: event.target.value }))}
              placeholder="Founders naming their first product"
            />
          </Field>

          <Field label="Tone" htmlFor="studio-tone">
            <Input
              id="studio-tone"
              value={form.tone}
              disabled={Boolean(unavailableReason) || busy}
              onChange={(event) => setForm((current) => ({ ...current, tone: event.target.value }))}
              placeholder="practical, no hype"
            />
          </Field>

          <Field label="Keywords" htmlFor="studio-keywords" hint="Comma separated, up to 12.">
            <Input
              id="studio-keywords"
              value={form.keywords}
              disabled={Boolean(unavailableReason) || busy}
              onChange={(event) => setForm((current) => ({ ...current, keywords: event.target.value }))}
            />
          </Field>

          {form.kind === "draft" ? (
            <Field label="Word target" htmlFor="studio-words" error={issues.wordTarget}>
              <Input
                id="studio-words"
                type="number"
                min={200}
                max={3000}
                value={form.wordTarget}
                disabled={Boolean(unavailableReason) || busy}
                onChange={(event) => setForm((current) => ({ ...current, wordTarget: Number(event.target.value) }))}
              />
            </Field>
          ) : null}
        </div>

        <div className="mt-3 flex justify-end">
          <Button onClick={() => void generate()} loading={busy} disabled={Boolean(unavailableReason)}>
            <Sparkles className="size-4" aria-hidden="true" /> Generate draft
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold">Drafts</h2>
        {loading ? (
          <div className="mt-3 space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-16" />
            ))}
          </div>
        ) : drafts.length === 0 ? (
          <EmptyState
            className="mt-3 border-0 py-8"
            title="No drafts yet"
            description="Generated outlines, drafts, metadata and FAQs appear here for review. Nothing is published automatically."
          />
        ) : (
          <ul className="mt-3 space-y-2">
            {drafts.map((draft) => (
              <li key={draft.id} className="rounded-[var(--radius)] border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{draft.kind}</Badge>
                  <Badge
                    tone={
                      draft.status === "accepted"
                        ? "success"
                        : draft.status === "rejected"
                          ? "danger"
                          : draft.status === "failed"
                            ? "danger"
                            : "warn"
                    }
                  >
                    {draft.status.replace("_", " ")}
                  </Badge>
                  <span className="text-[12px] font-medium text-fg">{draft.prompt_summary}</span>
                  <span className="ml-auto text-[10.5px] text-fg-subtle">
                    {draft.provider}
                    {draft.model ? ` · ${draft.model}` : ""} · {formatDateTime(draft.created_at)}
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-fg-muted">
                  {previewText(draft.content)}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button variant="ghost" size="sm" onClick={() => setReviewing(draft)}>
                    Read
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void copyToClipboard(draft)}>
                    <ClipboardCheck className="size-3.5" /> Copy into a post
                  </Button>
                  {draft.status === "pending_review" ? (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => void setStatus(draft, "accepted")}>
                        Accept
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void setStatus(draft, "rejected")}>
                        <X className="size-3.5" /> Reject
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {reviewing ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Draft preview"
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
        >
          <div className="max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-[var(--radius-lg)] border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">{reviewing.prompt_summary}</h2>
                <p className="text-[11px] text-fg-subtle">
                  {reviewing.status.replace("_", " ")} · {reviewing.provider}
                  {reviewing.model ? ` · ${reviewing.model}` : ""}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setReviewing(null)} aria-label="Close preview">
                <X className="size-4" />
              </Button>
            </div>
            <pre className="mt-3 whitespace-pre-wrap break-words rounded-[var(--radius)] bg-surface-2 p-3 font-mono text-[12px] leading-relaxed text-fg">
              {reviewing.content}
            </pre>
            <p className="mt-2 text-[11px] text-fg-subtle">
              Unreviewed model output. Check every factual claim before you reuse it.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
