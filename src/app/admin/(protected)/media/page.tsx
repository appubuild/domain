"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, ImagePlus, Pencil, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { PUBLIC_ENV } from "@/lib/config/env";
import {
  ACCEPT_ATTRIBUTE,
  ACCEPTED_TYPES,
  MAX_UPLOAD_BYTES,
  MAX_ALT_TEXT_LENGTH,
  MEDIA_BUCKET,
  buildStoragePath,
  describeRow,
  dimensionsLabel,
  formatBytes,
  mediaUsage,
  publicUrlFor,
  validateAltText,
  validateUpload,
  type MediaRow,
} from "@/lib/media/library";
import {
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  Input,
  Skeleton,
  Textarea,
  useToast,
} from "@/components/ui";
import { formatDateTime } from "@/lib/utils/format";

/**
 * Media library.
 *
 * Files go to the `media` bucket in Supabase Storage; `public.media` holds the metadata and
 * the alt text. The bucket is public because the exported site is static — see
 * `supabase/migrations/0007_media_storage.sql`.
 *
 * Two honesty rules shape this screen:
 *
 *  1. **Alt text is required before upload.** Not "saved for later": an image without alt
 *     text is an accessibility failure on the page it lands on, and asking after the fact is
 *     how it gets forgotten. Rows imported another way are flagged, not hidden.
 *  2. **Nothing is guessed.** Dimensions are read from the decoded file; when that fails the
 *     row says "dimensions not recorded" rather than showing a plausible size.
 */

type PendingUpload = {
  file: File;
  alt: string;
  caption: string;
  issues: { field: string; message: string }[];
};

const EMPTY_FORM = { alt: "", caption: "" };

export default function AdminMediaPage() {
  const { push } = useToast();
  const configured = isSupabaseConfigured();
  const inputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<MediaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [editing, setEditing] = useState<MediaRow | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editIssues, setEditIssues] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<MediaRow | null>(null);
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("media")
      .select("id,storage_path,file_name,mime_type,byte_size,width,height,alt_text,caption,created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) setLoadError(error.message);
    else {
      setLoadError(null);
      setRows((data ?? []) as MediaRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.file_name, row.alt_text, row.caption].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [rows, query]);

  const incomplete = rows.filter((row) => mediaUsage(row) !== "complete").length;

  /** Reads intrinsic size from the decoded file. Resolves nulls instead of inventing numbers. */
  const measure = (file: File): Promise<{ width: number | null; height: number | null }> =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      const finish = (width: number | null, height: number | null) => {
        URL.revokeObjectURL(url);
        resolve({ width, height });
      };
      image.onload = () => finish(image.naturalWidth || null, image.naturalHeight || null);
      image.onerror = () => finish(null, null);
      image.src = url;
    });

  const acceptFile = (file: File) => {
    const issues = validateUpload(
      { name: file.name, type: file.type, size: file.size },
      "",
    ).filter((issue) => issue.field === "file");

    if (issues.length > 0) {
      push({
        tone: "error",
        title: "That file cannot be uploaded",
        description: issues.map((issue) => issue.message).join(" "),
      });
      return;
    }
    setPending({ file, alt: "", caption: "", issues: [] });
  };

  const onFilesChosen = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    acceptFile(file);
  };

  const runUpload = async () => {
    if (!pending) return;

    const issues = validateUpload(
      { name: pending.file.name, type: pending.file.type, size: pending.file.size },
      pending.alt,
    );
    if (issues.length > 0) {
      setPending({ ...pending, issues });
      return;
    }

    const supabase = getSupabase();
    if (!supabase) return;

    setBusy(true);
    const storagePath = buildStoragePath(pending.file.name, pending.file.type);

    try {
      const dimensions = await measure(pending.file);

      const upload = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(storagePath, pending.file, { contentType: pending.file.type, upsert: false });

      if (upload.error) {
        push({
          tone: "error",
          title: "Upload failed",
          description: `${upload.error.message} If this mentions a policy, your account is not an administrator or the bucket is missing.`,
        });
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const insert = await supabase
        .from("media")
        .insert({
          storage_path: storagePath,
          file_name: pending.file.name,
          mime_type: pending.file.type,
          byte_size: pending.file.size,
          width: dimensions.width,
          height: dimensions.height,
          alt_text: pending.alt.trim(),
          caption: pending.caption.trim(),
          uploaded_by: sessionData.session?.user.id ?? null,
        })
        .select("id,storage_path,file_name,mime_type,byte_size,width,height,alt_text,caption,created_at")
        .single();

      if (insert.error) {
        // The object is already in the bucket; leaving it there would be an orphan with no
        // row, invisible on this screen and still publicly fetchable. Remove it.
        await supabase.storage.from(MEDIA_BUCKET).remove([storagePath]);
        push({
          tone: "error",
          title: "File uploaded but not recorded",
          description: `${insert.error.message} The upload was removed again so nothing is orphaned.`,
        });
        return;
      }

      setRows((current) => [insert.data as MediaRow, ...current]);
      setPending(null);
      if (inputRef.current) inputRef.current.value = "";
      push({ tone: "success", title: "Image added", description: pending.file.name });
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = async (row: MediaRow) => {
    const url = publicUrlFor(PUBLIC_ENV.supabaseUrl, row.storage_path);
    if (!url) {
      push({ tone: "warn", title: "No public URL", description: "Supabase is not configured for this build." });
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      push({ tone: "success", title: "URL copied", description: url });
    } catch {
      // Clipboard access can be denied; show the URL so it can be copied by hand.
      push({ tone: "info", title: "Copy this URL", description: url, duration: 12000 });
    }
  };

  const openEdit = (row: MediaRow) => {
    setEditing(row);
    setEditForm({ alt: row.alt_text, caption: row.caption });
    setEditIssues({});
  };

  const saveEdit = async () => {
    if (!editing) return;
    const altIssue = validateAltText(editForm.alt, editing.file_name);
    if (altIssue) {
      setEditIssues({ alt: altIssue.message });
      return;
    }
    const supabase = getSupabase();
    if (!supabase) return;

    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("media")
        .update({ alt_text: editForm.alt.trim(), caption: editForm.caption.trim() })
        .eq("id", editing.id)
        .select("id,storage_path,file_name,mime_type,byte_size,width,height,alt_text,caption,created_at")
        .single();

      if (error) {
        push({ tone: "error", title: "Could not save", description: error.message });
        return;
      }
      setRows((current) => current.map((row) => (row.id === editing.id ? (data as MediaRow) : row)));
      setEditing(null);
      push({ tone: "success", title: "Details updated" });
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const supabase = getSupabase();
    if (!supabase) return;

    setBusy(true);
    try {
      const { error } = await supabase.from("media").delete().eq("id", deleting.id);
      if (error) {
        push({ tone: "error", title: "Could not delete", description: error.message });
        return;
      }
      // Row first, object second: a stored file with no row is invisible here, whereas a row
      // pointing at a deleted file would render a broken image on the public site.
      const removal = await supabase.storage.from(MEDIA_BUCKET).remove([deleting.storage_path]);
      setRows((current) => current.filter((row) => row.id !== deleting.id));
      setDeleting(null);
      push({
        tone: removal.error ? "warn" : "success",
        title: removal.error ? "Record deleted, file kept" : "Image deleted",
        description: removal.error
          ? `The metadata row is gone but the object could not be removed: ${removal.error.message}`
          : deleting.file_name,
      });
    } finally {
      setBusy(false);
    }
  };

  const pendingIssues = pending?.issues ?? [];
  const pendingAltIssue = pending ? (pendingIssues.find((issue) => issue.field === "alt")?.message ?? null) : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="flex items-center gap-1.5 text-xl font-semibold tracking-tight">
            <ImagePlus className="size-4 text-accent" aria-hidden="true" /> Media library
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">
            Images for pages and posts. Files live in the <code>{MEDIA_BUCKET}</code> bucket; alt text is
            required, because an image without it fails whoever cannot see it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}>
            <RefreshCw className="size-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {!configured ? (
        <Callout tone="warn" title="Storage is not configured for this build">
          Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, run the
          migrations, and rebuild. Uploads are disabled until then — the form below will not pretend to
          succeed.
        </Callout>
      ) : null}

      {loadError ? (
        <Callout tone="danger" title="Could not read the media table">
          {loadError} Your account may not have the administrator role required by the{" "}
          <code>media_admin_write</code> policy.
        </Callout>
      ) : null}

      {configured ? (
        <Card className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Add an image</h2>
              <p className="mt-1 text-[13px] text-fg-muted">
                {ACCEPTED_TYPES.map((type) => type.label).join(", ")} · up to {formatBytes(MAX_UPLOAD_BYTES)}.
                SVG is refused: it can carry scripts.
              </p>
            </div>
          </div>

          <div
            className={`mt-3 flex flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed px-4 py-8 text-center transition-colors ${
              dragging ? "border-accent bg-accent-soft" : "border-border bg-surface-muted"
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              onFilesChosen(event.dataTransfer.files);
            }}
          >
            <Upload className="size-5 text-fg-subtle" aria-hidden="true" />
            <p className="text-[13px] text-fg-muted">Drop an image here, or</p>
            <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
              Choose a file
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT_ATTRIBUTE}
              className="sr-only"
              aria-label="Choose an image to upload"
              onChange={(event) => onFilesChosen(event.target.files)}
            />
          </div>
        </Card>
      ) : null}

      {pending ? (
        <Card className="p-4">
          <h2 className="text-sm font-semibold">Describe “{pending.file.name}”</h2>
          <p className="mt-1 text-[13px] text-fg-muted">
            {formatBytes(pending.file.size)} · {pending.file.type}
          </p>

          <div className="mt-3 space-y-3">
            <Field
              label="Alt text (required)"
              htmlFor="media-alt"
              hint="What the image shows, in a sentence. Screen readers read this instead of the image."
              error={pendingAltIssue ?? undefined}
            >
              <Textarea
                id="media-alt"
                rows={2}
                maxLength={MAX_ALT_TEXT_LENGTH}
                value={pending.alt}
                onChange={(event) => setPending({ ...pending, alt: event.target.value, issues: [] })}
                placeholder="A dark website header with the word DomainFits in white type"
              />
            </Field>

            <Field label="Caption (optional)" htmlFor="media-caption" hint="Displayed under the image when a page shows captions.">
              <Input
                id="media-caption"
                value={pending.caption}
                maxLength={200}
                onChange={(event) => setPending({ ...pending, caption: event.target.value })}
              />
            </Field>

            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPending(null);
                  if (inputRef.current) inputRef.current.value = "";
                }}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={() => void runUpload()} loading={busy}>
                <Upload className="size-3.5" /> Upload
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Library</h2>
          <Badge tone="neutral">{rows.length}</Badge>
          {incomplete > 0 ? <Badge tone="warn">{incomplete} without usable alt text</Badge> : null}
        </div>
        <label className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by name or alt text"
            aria-label="Filter media"
            className="w-64 pl-8"
          />
        </label>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-56" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ImagePlus className="size-5" />}
          title={rows.length === 0 ? "No images yet" : "No matches"}
          description={
            rows.length === 0
              ? configured
                ? "Upload the first image above. It will be available for page and post cover images."
                : "Connect Supabase Storage to start a library."
              : "No image matches that filter."
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((row) => {
            const url = publicUrlFor(PUBLIC_ENV.supabaseUrl, row.storage_path);
            const usage = mediaUsage(row);
            return (
              <Card as="li" key={row.id} className="overflow-hidden">
                <div className="flex h-36 items-center justify-center border-b border-border bg-surface-muted">
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- static export: next/image has no optimiser here
                    <img
                      src={url}
                      alt={row.alt_text || ""}
                      loading="lazy"
                      className="max-h-36 max-w-full object-contain"
                    />
                  ) : (
                    <span className="px-3 text-center text-xs text-fg-subtle">No storage URL in this build</span>
                  )}
                </div>
                <div className="space-y-1.5 p-3">
                  <p className="truncate text-[13px] font-medium" title={row.file_name}>
                    {row.file_name}
                  </p>
                  <p className="text-[11px] text-fg-subtle">{describeRow(row)}</p>
                  <p className="line-clamp-2 text-[12px] text-fg-muted">
                    {row.alt_text.trim() ? row.alt_text : <span className="text-warn">No alt text</span>}
                  </p>
                  {usage !== "complete" ? <Badge tone="warn">alt text needs work</Badge> : null}
                  <p className="text-[11px] text-fg-subtle">{formatDateTime(row.created_at)}</p>
                  <div className="flex items-center gap-1 pt-1">
                    <Button variant="ghost" size="sm" onClick={() => void copyUrl(row)}>
                      <Copy className="size-3.5" /> URL
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
                      <Pencil className="size-3.5" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto text-danger hover:bg-danger-soft"
                      onClick={() => setDeleting(row)}
                      aria-label={`Delete ${row.file_name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </ul>
      )}

      <Callout tone="info" title="What this screen does not do">
        There is no image resizing or cropping. Upload the size you need — the static site serves the
        original bytes, so a 4000-pixel photo stays 4000 pixels wide. {dimensionsLabel(1600, 900)} is a
        sensible hero size.
      </Callout>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit image details"
        description={editing?.file_name}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void saveEdit()} loading={busy}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Alt text (required)" htmlFor="media-edit-alt" error={editIssues.alt}>
            <Textarea
              id="media-edit-alt"
              rows={2}
              maxLength={MAX_ALT_TEXT_LENGTH}
              value={editForm.alt}
              onChange={(event) => {
                setEditForm({ ...editForm, alt: event.target.value });
                setEditIssues({});
              }}
            />
          </Field>
          <Field label="Caption" htmlFor="media-edit-caption">
            <Input
              id="media-edit-caption"
              value={editForm.caption}
              maxLength={200}
              onChange={(event) => setEditForm({ ...editForm, caption: event.target.value })}
            />
          </Field>
          <p className="text-[11px] text-fg-subtle">
            The storage path <code>{editing?.storage_path}</code> is permanent — links already using this
            file keep working.
          </p>
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        title="Delete this image?"
        body={
          deleting
            ? `“${deleting.file_name}” and its metadata row will be removed. Any page still referencing it will show a broken image until you edit that page.`
            : ""
        }
        confirmLabel="Delete"
        tone="danger"
        busy={busy}
      />
    </div>
  );
}
