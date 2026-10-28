"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageIcon, Search, X } from "lucide-react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { PUBLIC_ENV } from "@/lib/config/env";
import { altTextForPick, describeRow, publicUrlFor, type MediaRow } from "@/lib/media/library";
import type { AdminField, AdminMediaField } from "@/lib/admin/resources";
import { Button, Callout, Dialog, EmptyState, Input, Skeleton } from "@/components/ui";

/* -------------------------------------------------------------------------- */
/* Media fields                                                               */
/* -------------------------------------------------------------------------- */

export function MediaField({
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
  onSiblingChange?: (key: string, value: string) => void;
  getSiblingValue?: (key: string) => string;
  disabled?: boolean;
}) {
  const config: AdminMediaField = field.media ?? {};
  const id = `field-${field.key}`;
  const url = String(value ?? "");

  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const loadRows = useCallback(async () => {
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

  // Loaded on open, not on mount: the editor renders every field of every resource, and a
  // prefetch would issue this query for forms that never touch an image.
  useEffect(() => {
    if (open) void loadRows();
  }, [open, loadRows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.file_name, row.alt_text, row.caption].some((text) => text.toLowerCase().includes(needle)),
    );
  }, [rows, query]);

  // Any absolute URL is previewed, not just library paths: the field accepts pasted URLs and
  // showing what was pasted is the fastest way to catch a typo. A broken image is the honest
  // result, and the alt="" keeps it out of the accessibility tree.
  const preview = /^https?:\/\//i.test(url.trim()) ? url.trim() : null;

  const clear = () => {
    onChange("");
    if (config.altKey && onSiblingChange) onSiblingChange(config.altKey, "");
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-stretch gap-1.5">
        <Input
          id={id}
          value={url}
          disabled={disabled}
          placeholder="https://… or pick from the library"
          onChange={(event) => onChange(event.target.value)}
        />
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <ImageIcon className="size-3.5" /> Pick
        </Button>
        {url ? (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            disabled={disabled}
            onClick={clear}
            aria-label={`Clear ${field.label}`}
          >
            <X className="size-3.5" />
          </Button>
        ) : null}
      </div>

      {preview ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-surface-muted p-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- static export, no optimiser */}
          <img src={preview} alt="" className="h-10 w-16 rounded object-cover" loading="lazy" />
          <span className="min-w-0 flex-1 truncate text-[11px] text-fg-subtle">{url}</span>
        </div>
      ) : null}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Choose an image"
        description={
          config.recommended
            ? `From the media library. This field is used at ${config.recommended} — nothing is resized for you.`
            : "From the media library."
        }
        size="lg"
        footer={
          <>
            <a href="/admin/media/" className="mr-auto text-[12px] text-accent hover:underline">
              Open the media library
            </a>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {!isSupabaseConfigured() ? (
            <Callout tone="warn" title="Storage is not configured for this build">
              Paste an absolute image URL in the field instead; the picker has nothing to list.
            </Callout>
          ) : null}

          {loadError ? (
            <Callout tone="danger" title="Could not read the media library">
              {loadError} — paste a URL instead, or check your admin role.
            </Callout>
          ) : null}

          <label className="relative block">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by file name or alt text"
              aria-label="Filter media"
              className="pl-8"
            />
          </label>

          {loading ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-28" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<ImageIcon className="size-5" />}
              title={rows.length === 0 ? "No images yet" : "No matches"}
              description={
                rows.length === 0
                  ? "Upload one in the media library, or paste a URL directly."
                  : "Nothing matches that filter."
              }
            />
          ) : (
            <ul className="grid max-h-[50vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              {filtered.map((row) => {
                const thumb = publicUrlFor(PUBLIC_ENV.supabaseUrl, row.storage_path);
                const hasAlt = row.alt_text.trim().length > 0;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="group w-full overflow-hidden rounded-[var(--radius)] border border-border bg-surface text-left transition-colors hover:border-accent focus-visible:border-accent focus-visible:outline-none"
                      onClick={() => {
                        onChange(thumb ?? "");
                        // Only fills an empty altTextForPick returns null when the author has
                        // already written one, so picking again never rewrites their words.
                        if (config.altKey) {
                          const currentAlt = config.altKey ? (getSiblingValue?.(config.altKey) ?? "") : "";
                          const picked = altTextForPick(row, currentAlt);
                          if (picked) onSiblingChange?.(config.altKey, picked);
                        }
                        setOpen(false);
                      }}
                    >
                      <span className="flex h-24 items-center justify-center bg-surface-muted">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element -- static export
                          <img
                            src={thumb}
                            alt=""
                            loading="lazy"
                            className="max-h-24 max-w-full object-contain"
                          />
                        ) : (
                          <span className="px-2 text-center text-[11px] text-fg-subtle">No URL</span>
                        )}
                      </span>
                      <span className="block space-y-0.5 p-2">
                        <span className="block truncate text-[12px] font-medium" title={row.file_name}>
                          {row.file_name}
                        </span>
                        <span className="block text-[10px] text-fg-subtle">{describeRow(row)}</span>
                        <span className="block line-clamp-2 text-[11px] text-fg-muted">
                          {hasAlt ? row.alt_text : <span className="text-warn">No alt text</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {config.altKey ? (
            <p className="text-[11px] text-fg-subtle">
              Selecting an image fills <code>{config.altKey}</code> when that field is empty. Images
              without alt text are listed, but the SEO diagnostics screen will flag them.
            </p>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
