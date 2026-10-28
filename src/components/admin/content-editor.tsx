"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  ImageIcon,
  Loader2,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  ConfirmDialog,
  Dialog,
  Field,
  Input,
  SegmentedControl,
  Select,
  Switch,
  TagInput,
  Textarea,
  useToast,
} from "@/components/ui";
import { RichTextEditor } from "./rich-text-editor";
import { MediaField } from "./media-field";
import { getSupabase } from "@/lib/supabase/client";
import { sanitizeHtml } from "@/lib/content/sanitize";
import { cn, formatDateTime } from "@/lib/utils/format";
import { PUBLIC_ENV } from "@/lib/config/env";
import type { AdminField } from "@/lib/admin/resources";
import {
  applyPublishDefaults,
  buildPayload,
  draftFromRow,
  emptyDraft,
  normalizeTags,
  publicPath,
  redirectForSlugChange,
  searchPreview,
  slugify,
  toLocalInputValue,
  validateDraft,
  type ContentDraft,
  type ContentStatus,
  type ContentType,
  type ValidationIssue,
} from "@/lib/admin/content-editor";

const COVER_FIELD: AdminField = {
  key: "cover_image_url",
  label: "Cover image",
  type: "media",
  media: { altKey: "cover_image_alt", recommended: "1600 × 900" },
};

const SOCIAL_FIELD: AdminField = {
  key: "og_image_url",
  label: "Social share image",
  type: "media",
  media: { recommended: "1200 × 630" },
};

type CategoryRow = { id: string; name: string; slug: string };

type SaveState =
  | { kind: "idle" }
  | { kind: "saving"; label: string }
  | { kind: "saved"; at: Date; status: ContentStatus }
  | { kind: "error"; message: string };

/**
 * Full-page editor for blog posts and pages.
 *
 * This exists because the generic resource manager — correctly — puts every table behind one
 * form-in-a-modal. That shape is right for a category or an ad slot and wrong for an article:
 * the writing surface needs room, the publishing controls need to stay visible while the body
 * scrolls, and the SEO fields need to be visible next to the text they describe. The list screen
 * therefore links here instead of opening a modal for `posts` and `pages`.
 *
 * The saved record is still a plain row in `posts`/`pages`, written with the same anon client and
 * the same RLS policies as the rest of the admin: nothing about publishing bypasses Postgres.
 */
export function ContentEditor() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { push } = useToast();

  const type: ContentType = searchParams.get("type") === "page" ? "page" : "post";
  const slugParam = searchParams.get("slug") ?? "";
  const table = type === "post" ? "posts" : "pages";

  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ContentDraft>(() => emptyDraft("post"));
  const [baseline, setBaseline] = useState<string>("");
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [loadedSlug, setLoadedSlug] = useState<string | null>(null);
  const [savedStatus, setSavedStatus] = useState<ContentStatus>("draft");
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  /**
   * The `type:slug` currently in state. After the first save of a new record the URL is rewritten
   * to its real slug; without this the load effect would treat that as a navigation and blank the
   * editor with a second fetch of the row it already holds.
   */
  const loadedKey = useRef<string | null>(null);

  const dirty = useMemo(() => JSON.stringify(draft) !== baseline, [draft, baseline]);
  const issueFor = useCallback(
    (field: ValidationIssue["field"]) => issues.find((issue) => issue.field === field)?.message ?? null,
    [issues],
  );

  const update = useCallback(<K extends keyof ContentDraft>(key: K, value: ContentDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setIssues((current) => current.filter((issue) => issue.field !== key));
    setSaveState((current) => (current.kind === "error" ? { kind: "idle" } : current));
  }, []);

  /* ---------------------------------------------------------------- loading */

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabase();

    async function load() {
      if (slugParam && loadedKey.current === `${type}:${slugParam}`) {
        setState("ready");
        return;
      }
      if (!supabase) {
        setLoadError("Supabase is not configured for this build, so content cannot be loaded or saved.");
        setState("error");
        return;
      }
      setState("loading");
      setLoadError(null);

      const [categoryResult, tagResult, sessionResult] = await Promise.all([
        type === "post"
          ? supabase.from("post_categories").select("id,name,slug").order("name", { ascending: true })
          : Promise.resolve({ data: [], error: null }),
        type === "post"
          ? supabase.from("post_tags").select("name").order("name", { ascending: true }).limit(200)
          : Promise.resolve({ data: [], error: null }),
        supabase.auth.getUser(),
      ]);

      if (cancelled) return;

      if (categoryResult.error) {
        setLoadError(`Categories could not be loaded: ${categoryResult.error.message}`);
        setState("error");
        return;
      }
      setCategories((categoryResult.data ?? []) as CategoryRow[]);
      setKnownTags(((tagResult.data ?? []) as Array<{ name: string }>).map((row) => row.name));

      const fallbackAuthor =
        sessionResult.data?.user?.user_metadata?.full_name ||
        sessionResult.data?.user?.email?.split("@")[0] ||
        "";

      if (!slugParam) {
        const fresh = emptyDraft(type, String(fallbackAuthor));
        setDraft(fresh);
        setBaseline(JSON.stringify(fresh));
        setLoadedSlug(null);
        loadedKey.current = `${type}:`;
        setSavedStatus("draft");
        setIssues([]);
        setSaveState({ kind: "idle" });
        setState("ready");
        window.setTimeout(() => titleRef.current?.focus(), 50);
        return;
      }

      const { data: row, error } = await supabase.from(table).select("*").eq("slug", slugParam).maybeSingle();
      if (cancelled) return;

      if (error) {
        setLoadError(`${type === "post" ? "Post" : "Page"} "${slugParam}" could not be loaded: ${error.message}`);
        setState("error");
        return;
      }
      if (!row) {
        setLoadError(
          `No ${type === "post" ? "post" : "page"} has the slug "${slugParam}". It may have been renamed or deleted.`,
        );
        setState("error");
        return;
      }

      let tagNames: string[] = [];
      if (type === "post") {
        const { data: tagRows } = await supabase
          .from("post_tags_map")
          .select("post_tags(name)")
          .eq("post_id", String((row as Record<string, unknown>).id));
        tagNames = ((tagRows ?? []) as Array<{ post_tags?: { name?: string } | null }>)
          .map((entry) => entry.post_tags?.name ?? "")
          .filter(Boolean);
      }

      if (cancelled) return;
      const loaded = draftFromRow(type, row as Record<string, unknown>, tagNames);
      if (!loaded.authorName) loaded.authorName = String(fallbackAuthor);
      setDraft(loaded);
      setBaseline(JSON.stringify(loaded));
      setLoadedSlug(loaded.slug);
      loadedKey.current = `${type}:${loaded.slug}`;
      setSavedStatus(loaded.status);
      setSaveState(
        loaded.status === "published"
          ? { kind: "saved", at: new Date(), status: "published" }
          : { kind: "idle" },
      );
      setState("ready");
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [slugParam, table, type]);

  /* ------------------------------------------------------- unsaved changes */

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Browsers ignore the message but still require `returnValue` to be set.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  /* ------------------------------------------------------------------ save */

  const persist = useCallback(
    async (status: ContentStatus, options: { silent?: boolean } = {}) => {
      const supabase = getSupabase();
      if (!supabase) return;

      // A draft with no slug yet derives one from the title, so the first save never fails on a
      // field the author has not been asked about. Editing the slug afterwards still wins.
      let candidate: ContentDraft = { ...draft, status };
      if (!candidate.slug.trim() && candidate.title.trim()) {
        candidate = { ...candidate, slug: slugify(candidate.title) };
      }
      // Publishing with an empty date means "now": the tables require a published_at for a
      // published row, and the public policy hides anything without one.
      candidate = applyPublishDefaults(candidate);

      const found = validateDraft(candidate);
      const firstIssue = found[0];
      if (firstIssue) {
        setIssues(found);
        setSaveState({ kind: "error", message: firstIssue.message });
        if (!options.silent) {
          push({ tone: "error", title: "Not saved", description: firstIssue.message });
        }
        return;
      }

      setSaveState({ kind: "saving", label: status === "draft" ? "Saving draft…" : "Saving…" });
      setIssues([]);

      try {
        const { data: clash, error: clashError } = await supabase
          .from(table)
          .select("id")
          .eq("slug", candidate.slug.trim())
          .maybeSingle();
        if (clashError) throw clashError;
        if (clash && String((clash as { id: string }).id) !== candidate.id) {
          const message = `The slug "${candidate.slug}" is already used by another ${type === "post" ? "post" : "page"}.`;
          setIssues([{ field: "slug", message }]);
          setSaveState({ kind: "error", message });
          if (!options.silent) push({ tone: "error", title: "Duplicate slug", description: message });
          return;
        }

        const body = sanitizeHtml(candidate.body);
        const payload = buildPayload({ ...candidate, body });

        let row: Record<string, unknown>;
        if (candidate.id) {
          const { data, error } = await supabase
            .from(table)
            .update(payload)
            .eq("id", candidate.id)
            .select("*")
            .single();
          if (error) throw error;
          row = data as Record<string, unknown>;
        } else {
          const { data, error } = await supabase.from(table).insert(payload).select("*").single();
          if (error) throw error;
          row = data as Record<string, unknown>;
        }

        const savedId = String(row.id);

        // Tags live in a join table; for posts they are replaced wholesale so removing a tag in
        // the editor actually removes it, rather than leaving an orphaned link behind.
        if (type === "post") {
          const tagRows = normalizeTags(candidate.tags);
          let tagIds: string[] = [];
          if (tagRows.length > 0) {
            const { error: tagError } = await supabase
              .from("post_tags")
              .upsert(tagRows, { onConflict: "slug" });
            if (tagError) throw tagError;
            const { data: stored, error: storedError } = await supabase
              .from("post_tags")
              .select("id,slug")
              .in(
                "slug",
                tagRows.map((tag) => tag.slug),
              );
            if (storedError) throw storedError;
            tagIds = ((stored ?? []) as Array<{ id: string }>).map((tag) => tag.id);
          }

          const { error: clearError } = await supabase.from("post_tags_map").delete().eq("post_id", savedId);
          if (clearError) throw clearError;
          if (tagIds.length > 0) {
            const { error: mapError } = await supabase
              .from("post_tags_map")
              .insert(tagIds.map((tagId) => ({ post_id: savedId, tag_id: tagId })));
            if (mapError) throw mapError;
          }
        }

        // A published URL that changes leaves a redirect behind, so inbound links keep working.
        const redirect = redirectForSlugChange({
          type,
          previousSlug: loadedSlug ?? "",
          nextSlug: candidate.slug,
          wasPublished: savedStatus === "published",
        });
        let redirectNote: string | undefined;
        if (redirect) {
          const { error: redirectError } = await supabase
            .from("redirects")
            .upsert(
              redirect,
              { onConflict: "source_path" },
            );
          if (redirectError) {
            redirectNote = `The slug changed, but the redirect could not be saved: ${redirectError.message}`;
          } else {
            redirectNote = `${redirect.source_path} now redirects to ${redirect.target_path}.`;
          }
        }

        const stored = draftFromRow(type, row, candidate.tags);
        setDraft(stored);
        setBaseline(JSON.stringify(stored));
        setLoadedSlug(stored.slug);
        loadedKey.current = `${type}:${stored.slug}`;
        setSavedStatus(stored.status);
        setSaveState({ kind: "saved", at: new Date(), status: stored.status });

        // First save of a new record: put its real slug in the URL so a refresh reopens it.
        if (!candidate.id) {
          router.replace(`/admin/editor/?type=${type}&slug=${encodeURIComponent(stored.slug)}`);
        }

        if (!options.silent) {
          push({
            tone: redirectNote && redirectNote.includes("could not") ? "warn" : "success",
            title:
              stored.status === "published"
                ? "Published"
                : stored.status === "scheduled"
                  ? "Scheduled"
                  : "Draft saved",
            description: redirectNote,
          });
        }
      } catch (error) {
        const message = (error as Error).message;
        setSaveState({ kind: "error", message });
        if (!options.silent) push({ tone: "error", title: "Save failed", description: message });
      }
    },
    [draft, loadedSlug, push, router, savedStatus, table, type],
  );

  /* --------------------------------------------------------- keyboard save */

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (state === "ready") void persist(draft.status);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [draft.status, persist, state]);

  /* -------------------------------------------------------------- actions */

  const leaveToList = () => {
    router.push(`/admin/${type === "post" ? "posts" : "pages"}/`);
  };

  const handleBack = () => {
    if (dirty) setLeaveOpen(true);
    else leaveToList();
  };

  const remove = async () => {
    const supabase = getSupabase();
    if (!supabase || !draft.id) return;
    setDeleting(true);
    try {
      if (type === "post") {
        await supabase.from("post_tags_map").delete().eq("post_id", draft.id);
      }
      const { error } = await supabase.from(table).delete().eq("id", draft.id);
      if (error) throw error;
      setBaseline(JSON.stringify(draft));
      push({ tone: "success", title: `${type === "post" ? "Post" : "Page"} deleted` });
      leaveToList();
    } catch (error) {
      push({ tone: "error", title: "Delete failed", description: (error as Error).message });
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  const createCategory = async (name: string, slug: string) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Supabase is not configured.");
    const { data, error } = await supabase
      .from("post_categories")
      .insert({ name: name.trim(), slug: slug.trim() })
      .select("id,name,slug")
      .single();
    if (error) throw error;
    const created = data as CategoryRow;
    setCategories((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
    update("categoryId", created.id);
    push({ tone: "success", title: "Category created", description: created.name });
  };

  /* ------------------------------------------------------------------ view */

  if (state === "loading") {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-fg-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading editor…
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-6">
        <Callout tone="danger" title="This record could not be opened">
          {loadError}
        </Callout>
        <Button variant="secondary" onClick={() => router.push(`/admin/${type === "post" ? "posts" : "pages"}/`)}>
          <ArrowLeft className="size-4" /> Back to the list
        </Button>
      </div>
    );
  }

  const isPost = type === "post";
  const permalink = publicPath(type, draft.slug || "your-slug");
  const wordCount = draft.body.replace(/<[^>]*>/g, " ").trim().split(/\s+/).filter(Boolean).length;
  // Both the copy and the characters of the result preview come from the same helper the tests
  // cover, so the preview cannot drift from what the sitemap/metadata build will emit.
  const preview = searchPreview({
    kind: type,
    slug: draft.slug,
    title: draft.title,
    seoTitle: draft.seoTitle,
    metaDescription: draft.metaDescription,
    excerpt: draft.excerpt,
    siteUrl: PUBLIC_ENV.appUrl || (typeof window === "undefined" ? "" : window.location.origin),
    noindex: draft.noindex,
  });

  return (
    <div className="flex min-h-full flex-col">
      {/* Sticky action bar: the only thing that stays put while editing, and it sits below the
          site header rather than over the title. */}
      <div className="sticky top-0 z-20 border-b border-border bg-bg/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-bg/80 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleBack} aria-label="Back to the list">
              <ArrowLeft className="size-4" />
            </Button>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-fg">
                {draft.title.trim() || (isPost ? "Untitled post" : "Untitled page")}
              </p>
              <div className="flex items-center gap-2 text-[11px] text-fg-subtle">
                <StatusBadge status={draft.status} />
                <span aria-hidden="true">·</span>
                <SaveIndicator saveState={saveState} dirty={dirty} />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {draft.status === "published" && draft.slug ? (
              <a
                href={permalink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] px-2 text-xs text-fg-muted hover:text-accent"
              >
                <ExternalLink className="size-3.5" aria-hidden="true" /> View
              </a>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => void persist("draft")} loading={saveState.kind === "saving" && draft.status === "draft"}>
              Save draft
            </Button>
            <Button size="sm" onClick={() => void persist(draft.status === "scheduled" ? "scheduled" : "published")} loading={saveState.kind === "saving" && draft.status !== "draft"}>
              {draft.status === "scheduled" ? "Schedule" : "Publish"}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_21rem] xl:grid-cols-[minmax(0,1fr)_23rem]">
        {/* ---------------------------------------------------- main column */}
        <div className="min-w-0 space-y-4">
          <div>
            <label htmlFor="content-title" className="sr-only">
              Title
            </label>
            <textarea
              id="content-title"
              ref={titleRef}
              value={draft.title}
              onChange={(event) => update("title", event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  document.getElementById("content-body-anchor")?.focus();
                }
              }}
              placeholder={isPost ? "Article title" : "Page title"}
              rows={2}
              aria-invalid={Boolean(issueFor("title"))}
              aria-describedby={issueFor("title") ? "title-error" : undefined}
              className="w-full resize-none border-0 bg-transparent px-1 text-2xl font-semibold leading-tight text-fg focus-visible:outline-none"
            />
            {issueFor("title") ? (
              <p id="title-error" role="alert" className="mt-1 px-1 text-xs font-medium text-danger">
                {issueFor("title")}
              </p>
            ) : null}
          </div>

          <div className="space-y-1 px-1">
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">
              <span className="font-medium text-fg-muted">Permalink</span>
              <div className="flex min-w-0 flex-1 items-center gap-1">
                <span className="shrink-0 font-mono text-[11px] text-fg-subtle">
                  {isPost ? "/blog/" : "/"}
                </span>
                <Input
                  value={draft.slug}
                  onChange={(event) => update("slug", event.target.value.replace(/\s+/g, "-").toLowerCase())}
                  onBlur={(event) => update("slug", slugify(event.target.value))}
                  placeholder="url-slug"
                  aria-label="Slug"
                  invalid={Boolean(issueFor("slug"))}
                  className={cn("h-8 max-w-md font-mono text-xs")}
                />
                <span className="shrink-0 font-mono text-[11px] text-fg-subtle">/</span>
                {draft.title.trim() && !draft.slug.trim() ? (
                  <Button variant="ghost" size="sm" onClick={() => update("slug", slugify(draft.title))}>
                    Use title
                  </Button>
                ) : null}
              </div>
            </div>
            {issueFor("slug") ? (
              <p role="alert" className="text-xs font-medium text-danger">
                {issueFor("slug")}
              </p>
            ) : (
              <p className="text-[11px] text-fg-subtle">
                Editing the slug of a published {isPost ? "post" : "page"} adds a 301 redirect from the old URL.
              </p>
            )}
          </div>

          <div id="content-body-anchor" tabIndex={-1} className="scroll-mt-24 pt-1">
            <RichTextEditor
              value={draft.body}
              onChange={(html) => update("body", html)}
              label={isPost ? "Post body" : "Page body"}
              placeholder={isPost ? "Start writing the article…" : "Write the page…"}
              toolbarStickyTop="3.25rem"
              error={issueFor("body")}
            />
          </div>

          <Field
            label="Excerpt"
            htmlFor="content-excerpt"
            description={
              isPost
                ? "Shown on the blog index and as the fallback meta description. Plain text."
                : "Shown when this page is listed or shared. Plain text."
            }
          >
            <Textarea
              id="content-excerpt"
              value={draft.excerpt}
              onChange={(event) => update("excerpt", event.target.value)}
              rows={3}
              maxLength={320}
              placeholder="One or two sentences that summarise this content."
            />
          </Field>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-border bg-surface-2/40 px-3 py-2 text-[11px] text-fg-subtle">
            <span>
              {wordCount.toLocaleString()} words · {draft.body.length.toLocaleString()} characters of HTML
            </span>
            <span>
              Saved content is sanitised: only headings, lists, quotes, links, code and emphasis survive.
            </span>
          </div>

          {draft.id ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-danger/40 bg-danger-soft/30 px-3 py-2">
              <p className="text-xs text-fg-muted">
                Deleting removes the row from the database. Historical redirects are kept.
              </p>
              <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="size-3.5" /> Delete {isPost ? "post" : "page"}
              </Button>
            </div>
          ) : null}
        </div>

        {/* ------------------------------------------------------- sidebar */}
        <aside className="min-w-0 lg:sticky lg:top-14 lg:max-h-[calc(100dvh-var(--site-header-h)-1.5rem)] lg:self-start lg:overflow-y-auto lg:pb-4 scroll-thin">
          <div className="space-y-3">
            <Panel title="Status" icon={<CalendarClock className="size-3.5" />}>
              <SegmentedControl<ContentStatus>
                label="Publication status"
                value={draft.status}
                onChange={(value) => {
                  update("status", value);
                  // Keep the publish date honest the moment the status changes, so the field shows
                  // exactly what will be written rather than an empty input that means "now".
                  if (value === "published") {
                    setDraft((current) => applyPublishDefaults(current));
                  }
                }}
                options={[
                  { value: "draft", label: "Draft" },
                  { value: "scheduled", label: "Scheduled" },
                  { value: "published", label: "Published" },
                  { value: "archived", label: "Archived" },
                ]}
                size="sm"
                className="w-full justify-between"
              />

              {draft.status === "published" ? (
                <Field
                  label="Publish date"
                  htmlFor="content-published-at"
                  error={issueFor("publishedAt")}
                  description="Defaults to now. Set an earlier date to back-date this content."
                >
                  <Input
                    id="content-published-at"
                    type="datetime-local"
                    value={draft.publishedAt}
                    onChange={(event) => update("publishedAt", event.target.value)}
                    invalid={Boolean(issueFor("publishedAt"))}
                  />
                </Field>
              ) : null}

              {draft.status === "scheduled" ? (
                <Field
                  label="Go live at"
                  htmlFor="content-scheduled-for"
                  required
                  error={issueFor("scheduledFor")}
                  description="A database job publishes scheduled rows every minute; the static site shows the result after its next rebuild."
                >
                  <Input
                    id="content-scheduled-for"
                    type="datetime-local"
                    value={draft.scheduledFor}
                    onChange={(event) => update("scheduledFor", event.target.value)}
                    invalid={Boolean(issueFor("scheduledFor"))}
                  />
                </Field>
              ) : null}

              {draft.status === "archived" ? (
                <Callout tone="info">
                  Archived content stays in the database but leaves the public site on the next rebuild.
                </Callout>
              ) : null}

              {saveState.kind === "saved" ? (
                <p className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
                  <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />
                  Saved {saveState.at.toLocaleTimeString()}
                  {saveState.status === "scheduled" && draft.scheduledFor
                    ? ` · goes live ${formatDateTime(new Date(draft.scheduledFor).toISOString())}`
                    : ""}
                </p>
              ) : null}
              {saveState.kind === "error" ? (
                <p className="flex items-start gap-1.5 text-[11px] font-medium text-danger">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  {saveState.message}
                </p>
              ) : null}
            </Panel>

            {isPost ? (
              <Panel title="Organisation" icon={<Plus className="size-3.5" />}>
                <Field
                  label="Category"
                  htmlFor="content-category"
                  labelAction={
                    <button
                      type="button"
                      onClick={() => setCategoryDialogOpen(true)}
                      className="text-[11px] font-medium text-accent hover:underline"
                    >
                      New category
                    </button>
                  }
                >
                  <Select
                    id="content-category"
                    value={draft.categoryId ?? ""}
                    onChange={(event) => update("categoryId", event.target.value)}
                  >
                    <option value="">No category</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Tags" htmlFor="content-tags" description="Enter or comma adds a tag. Tags are created when they do not exist yet.">
                  <TagInput
                    id="content-tags"
                    label="Tags"
                    value={draft.tags}
                    onChange={(next) => update("tags", next)}
                    placeholder="naming, branding…"
                    max={12}
                    maxLength={32}
                  />
                </Field>
                {knownTags.length > 0 ? (
                  <p className="text-[11px] text-fg-subtle">
                    Existing: {knownTags.slice(0, 8).join(", ")}
                    {knownTags.length > 8 ? "…" : ""}
                  </p>
                ) : null}
              </Panel>
            ) : null}

            <Panel title={isPost ? "Featured image" : "Share image"} icon={<ImageIcon className="size-3.5" />}>
              <Field label={isPost ? "Cover image" : "Social share image"} htmlFor="field-cover_image_url">
                <MediaField
                  field={isPost ? COVER_FIELD : SOCIAL_FIELD}
                  value={isPost ? draft.coverImageUrl : draft.ogImageUrl}
                  onChange={(value) => update(isPost ? "coverImageUrl" : "ogImageUrl", String(value ?? ""))}
                  onSiblingChange={(_key, value) => update("coverImageAlt", value)}
                  getSiblingValue={() => draft.coverImageAlt}
                />
              </Field>
              {isPost ? (
                <Field
                  label="Alt text"
                  htmlFor="content-cover-alt"
                  error={issueFor("coverImageAlt")}
                  description="Describes the image for screen readers and search engines."
                >
                  <Input
                    id="content-cover-alt"
                    value={draft.coverImageAlt}
                    onChange={(event) => update("coverImageAlt", event.target.value)}
                    maxLength={160}
                    invalid={Boolean(issueFor("coverImageAlt"))}
                  />
                </Field>
              ) : null}
              {!isPost ? (
                <Field label="Author name" htmlFor="content-author-hidden" className="hidden">
                  <input id="content-author-hidden" type="hidden" value={draft.authorName} readOnly />
                </Field>
              ) : null}
              {isPost ? (
                <Field label="Author name" htmlFor="content-author" description="Shown in the byline.">
                  <Input
                    id="content-author"
                    value={draft.authorName}
                    onChange={(event) => update("authorName", event.target.value)}
                    maxLength={80}
                  />
                </Field>
              ) : null}
            </Panel>

            <Panel title="Search engines" icon={<Search className="size-3.5" />}>
              <Field
                label="SEO title"
                htmlFor="content-seo-title"
                hint={`${draft.seoTitle.length}/70 characters`}
              >
                <Input
                  id="content-seo-title"
                  value={draft.seoTitle}
                  onChange={(event) => update("seoTitle", event.target.value)}
                  maxLength={70}
                  placeholder={draft.title || "Defaults to the title"}
                />
              </Field>
              <Field
                label="Meta description"
                htmlFor="content-meta-description"
                error={issueFor("metaDescription")}
                hint={`${draft.metaDescription.length}/170 characters`}
              >
                <Textarea
                  id="content-meta-description"
                  value={draft.metaDescription}
                  onChange={(event) => update("metaDescription", event.target.value)}
                  rows={3}
                  placeholder={draft.excerpt || "Defaults to the excerpt"}
                  invalid={Boolean(issueFor("metaDescription"))}
                />
              </Field>
              <Field
                label="Canonical URL"
                htmlFor="content-canonical"
                error={issueFor("canonicalUrl")}
                description="Only needed when this content first appeared elsewhere."
              >
                <Input
                  id="content-canonical"
                  value={draft.canonicalUrl}
                  onChange={(event) => update("canonicalUrl", event.target.value)}
                  placeholder="https://example.com/original"
                  invalid={Boolean(issueFor("canonicalUrl"))}
                />
              </Field>
              <Switch
                checked={draft.noindex}
                onChange={(value) => update("noindex", value)}
                label="Exclude from search engines"
                description="Adds noindex and removes the page from the sitemap."
              />

              {/* Search preview: what the saved fields would look like in a result. */}
              <div className="rounded-[var(--radius)] border border-border bg-surface p-3">
                <p className="text-[10px] uppercase tracking-wide text-fg-subtle">Search preview</p>
                <p className="mt-1 line-clamp-1 text-[13px] font-medium text-info">{preview.title}</p>
                <p className="line-clamp-1 break-all text-[11px] text-success">{preview.url}</p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-fg-muted">{preview.description}</p>
                {preview.warning ? (
                  <p className="mt-1 text-[10px] font-medium text-warn">{preview.warning}</p>
                ) : null}
              </div>
            </Panel>

            <p className="px-1 text-[11px] leading-relaxed text-fg-subtle">
              Publishing writes to Supabase immediately. The public site is a static export, so it serves the
              new content after the next build — the deployment pipeline is what makes it visible.
            </p>
          </div>
        </aside>
      </div>

      <NewCategoryDialog
        open={categoryDialogOpen}
        onClose={() => setCategoryDialogOpen(false)}
        onCreate={createCategory}
        existingSlugs={categories.map((category) => category.slug)}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={remove}
        busy={deleting}
        title={`Delete this ${isPost ? "post" : "page"}?`}
        body={
          <>
            <strong className="text-fg">{draft.title || "Untitled"}</strong> will be removed from the database. This
            cannot be undone, and any redirect pointing at it is left in place.
          </>
        }
        confirmLabel="Delete permanently"
      />

      <ConfirmDialog
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        onConfirm={() => {
          setLeaveOpen(false);
          setBaseline(JSON.stringify(draft));
          leaveToList();
        }}
        tone="primary"
        title="Leave without saving?"
        body="This record has unsaved changes. Leaving discards them."
        confirmLabel="Discard changes"
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Small presentational pieces                                                */
/* -------------------------------------------------------------------------- */

function Panel({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-surface">
      <h2 className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
        {icon}
        {title}
      </h2>
      <div className="space-y-3 p-3">{children}</div>
    </section>
  );
}

function StatusBadge({ status }: { status: ContentDraft["status"] }) {
  const tone = status === "published" ? "success" : status === "scheduled" ? "info" : status === "archived" ? "warn" : "neutral";
  return (
    <Badge tone={tone} className="capitalize">
      {status}
    </Badge>
  );
}

function SaveIndicator({ saveState, dirty }: { saveState: SaveState; dirty: boolean }) {
  if (saveState.kind === "saving") {
    return (
      <span className="inline-flex items-center gap-1">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        {saveState.label}
      </span>
    );
  }
  if (saveState.kind === "error") {
    return <span className="font-medium text-danger">Not saved</span>;
  }
  if (dirty) return <span className="text-warn">Unsaved changes</span>;
  if (saveState.kind === "saved") {
    return <span>Saved {saveState.at.toLocaleTimeString()}</span>;
  }
  return <span>No changes yet</span>;
}

/**
 * Category creation, in a centred modal.
 *
 * The slug is derived from the name until the author edits it, so the common case is one field
 * and a button. Validation is local (pattern plus an existing-slug check) because the unique
 * index would otherwise surface as a raw Postgres error message.
 */
function NewCategoryDialog({
  open,
  onClose,
  onCreate,
  existingSlugs,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, slug: string) => Promise<void>;
  existingSlugs: string[];
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setSlug("");
      setSlugTouched(false);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const derived = slugTouched ? slug : slugify(name);

  const submit = async () => {
    if (!name.trim()) return setError("A name is required.");
    if (!derived.trim()) return setError("A slug is required.");
    if (existingSlugs.includes(derived.trim())) return setError("That slug is already used by another category.");
    setBusy(true);
    setError(null);
    try {
      await onCreate(name, derived);
      onClose();
    } catch (createError) {
      setError((createError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="New category"
      description="Categories group posts on the blog index and appear as the badge on a post."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            Create category
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Name" htmlFor="new-category-name" required error={error}>
          <Input
            id="new-category-name"
            value={name}
            autoFocus
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            invalid={Boolean(error)}
          />
        </Field>
        <Field label="Slug" htmlFor="new-category-slug" required description="Used in the category URL.">
          <Input
            id="new-category-slug"
            value={derived}
            maxLength={60}
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(event.target.value);
            }}
            onBlur={() => setSlugTouched(true)}
          />
        </Field>
      </form>
    </Dialog>
  );
}
