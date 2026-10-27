/**
 * Media library rules: what may be uploaded, how it is named, and when alt text is
 * acceptable.
 *
 * Everything here is pure so it can be unit-tested, and so the same rules run in the
 * browser and in the admin screen's tests. Note the division of labour:
 *
 *   * this module is a *usability* gate — it stops a 40 MB TIFF from being sent at all;
 *   * the real security boundary is the bucket policy in
 *     `supabase/migrations/0007_media_storage.sql` (only administrators may write) plus the
 *     `media_mime_type_allowed` constraint.
 *
 * A client-side check can always be bypassed by calling the Storage API directly, so it is
 * never described as protection.
 */

/** Bucket name. Must match `0007_media_storage.sql`; pinned by a test. */
export const MEDIA_BUCKET = "media";

/** 5 MiB. Comfortably above a full-width hero JPEG, far below anything that stalls an upload. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const MAX_ALT_TEXT_LENGTH = 160;
export const MIN_ALT_TEXT_LENGTH = 8;

export type AcceptedType = {
  mime: string;
  ext: string;
  label: string;
  /** Shown in the admin hint — an operator should know what each format is for. */
  note: string;
};

/**
 * Accepted formats. Deliberately short.
 *
 * SVG is **not** here: it is a script-capable document, and on a public static origin an
 * uploaded SVG is stored cross-site scripting waiting for someone to open its URL directly.
 * It cannot be fixed with a MIME check because the browser will happily parse the file.
 * GIF is excluded too — animation in a CMS is usually a size accident, and there is no
 * image pipeline to flatten it.
 */
export const ACCEPTED_TYPES: readonly AcceptedType[] = [
  { mime: "image/jpeg", ext: "jpg", label: "JPEG", note: "photographs, hero images" },
  { mime: "image/png", ext: "png", label: "PNG", note: "screenshots, flat graphics" },
  { mime: "image/webp", ext: "webp", label: "WebP", note: "smaller photographs" },
  { mime: "image/avif", ext: "avif", label: "AVIF", note: "smallest photographs, newer browsers" },
] as const;

/** Value for an `<input type="file" accept="…">`. */
export const ACCEPT_ATTRIBUTE = ACCEPTED_TYPES.map((type) => type.mime).join(",");

export function acceptedType(mime: string): AcceptedType | null {
  const normalised = mime.trim().toLowerCase();
  return ACCEPTED_TYPES.find((type) => type.mime === normalised) ?? null;
}

export function isAcceptedMime(mime: string): boolean {
  return acceptedType(mime) !== null;
}

export function typeLabel(mime: string): string {
  return acceptedType(mime)?.label ?? mime;
}

/** Human-readable list for error messages: "JPEG, PNG, WebP or AVIF". */
export function acceptedTypeSentence(): string {
  const labels = ACCEPTED_TYPES.map((type) => type.label);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib < 10 ? kib.toFixed(1) : Math.round(kib)} KB`;
  const mib = kib / 1024;
  return `${mib < 10 ? mib.toFixed(1) : Math.round(mib)} MB`;
}

/* ------------------------------------------------------------------------------------ *
 * Alt text
 *
 * Alt text is required and is checked for *meaning*, not just presence. A field that
 * accepts "image" or a filename satisfies the validator and helps nobody — screen-reader
 * users hear noise and search engines index noise.
 * ------------------------------------------------------------------------------------ */

/** Placeholders that look filled-in but carry no information. */
const PLACEHOLDER_ALT = new Set([
  "image",
  "photo",
  "picture",
  "pic",
  "img",
  "graphic",
  "screenshot",
  "banner",
  "hero",
  "logo",
  "icon",
  "alt",
  "alt text",
  "todo",
  "tbd",
  "n/a",
  "none",
  "untitled",
]);

export type AltIssue = { code: "empty" | "too-short" | "too-long" | "placeholder" | "filename"; message: string };

export function validateAltText(alt: string, fileName?: string): AltIssue | null {
  const value = alt.trim();

  if (value.length === 0) {
    return { code: "empty", message: "Describe the image for people who cannot see it." };
  }
  // Checked before the length rule: "image" is also short, but telling an operator to add
  // characters invites "image!!" rather than a description.
  if (PLACEHOLDER_ALT.has(value.toLowerCase().replace(/[.!]+$/, ""))) {
    return {
      code: "placeholder",
      message: "That is a label, not a description. Say what the image shows.",
    };
  }
  if (value.length < MIN_ALT_TEXT_LENGTH) {
    return {
      code: "too-short",
      message: `Too short to be useful — write at least ${MIN_ALT_TEXT_LENGTH} characters.`,
    };
  }
  if (value.length > MAX_ALT_TEXT_LENGTH) {
    return {
      code: "too-long",
      message: `Shorten this to ${MAX_ALT_TEXT_LENGTH} characters or fewer.`,
    };
  }
  if (fileName) {
    // Compare in one normal form: separators and case are the only difference an operator is
    // likely to introduce when pasting a file name back into the field.
    const normalise = (text: string) => text.toLowerCase().replace(/[-_\s]+/g, " ").trim();
    const stem = normalise(fileName.replace(/\.[^.]+$/, ""));
    if (stem.length > 0 && normalise(value) === stem) {
      return { code: "filename", message: "Use words a person would say, not the file name." };
    }
  }
  return null;
}

/* ------------------------------------------------------------------------------------ *
 * Storage paths
 *
 * Paths are generated, never taken from the upload: a user-supplied name can contain `..`,
 * a leading slash, control characters, or a homoglyph that collides with another file.
 * Shape is `YYYY/MM/<stem>-<token>.<ext>`, which keeps buckets browsable by month and makes
 * every path unique without a database round-trip.
 * ------------------------------------------------------------------------------------ */

export function sanitiseStem(name: string): string {
  const withoutExt = name.replace(/\.[^./\\]+$/, "");
  const folded = withoutExt
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const trimmed = folded.slice(0, 60).replace(/-+$/, "");
  return trimmed.length > 0 ? trimmed : "image";
}

function randomToken(random: () => number): string {
  // 6 hex characters ≈ 16.7 M combinations; collision odds are negligible at CMS scale and
  // the unique index on `media.storage_path` is the backstop.
  let token = "";
  for (let index = 0; index < 6; index += 1) {
    token += Math.floor(random() * 16).toString(16);
  }
  return token;
}

/**
 * Builds the object path for a new upload.
 *
 * @param fileName original name, used only for the human-readable stem
 * @param mime     the accepted MIME type
 * @param now      clock, injected for tests
 * @param random   0–1 generator, injected for tests
 */
export function buildStoragePath(
  fileName: string,
  mime: string,
  now: Date = new Date(),
  random: () => number = Math.random,
): string {
  const type = acceptedType(mime);
  if (!type) throw new Error(`Unsupported media type: ${mime}`);

  const year = String(now.getUTCFullYear()).padStart(4, "0");
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}/${month}/${sanitiseStem(fileName)}-${randomToken(random)}.${type.ext}`;
}

/** Path shape enforced by the `media_storage_path_shape` constraint. */
export const STORAGE_PATH_PATTERN = /^[0-9]{4}\/[0-9]{2}\/[a-z0-9][a-z0-9-]*\.[a-z0-9]+$/;

export function isValidStoragePath(path: string): boolean {
  return STORAGE_PATH_PATTERN.test(path);
}

/** Public object URL. Returns null rather than a half-built URL when Supabase is unconfigured. */
export function publicUrlFor(supabaseUrl: string | null | undefined, storagePath: string): string | null {
  if (!supabaseUrl) return null;
  const base = supabaseUrl.replace(/\/+$/, "");
  const encoded = storagePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${base}/storage/v1/object/public/${MEDIA_BUCKET}/${encoded}`;
}

/* ------------------------------------------------------------------------------------ *
 * Upload validation
 * ------------------------------------------------------------------------------------ */

export type UploadCandidate = { name: string; type: string; size: number };

export type UploadIssue = { field: "file" | "alt"; message: string };

/**
 * Validates a file plus its alt text before anything is sent.
 *
 * Returns every problem, not the first one, so an operator fixes the form in one pass.
 */
export function validateUpload(candidate: UploadCandidate, altText: string): UploadIssue[] {
  const issues: UploadIssue[] = [];

  if (candidate.type.trim().toLowerCase() === "image/svg+xml") {
    issues.push({
      field: "file",
      message: "SVG is not accepted — it can carry scripts. Export a PNG or WebP instead.",
    });
  } else if (!isAcceptedMime(candidate.type)) {
    issues.push({
      field: "file",
      message: `Unsupported file type. Upload ${acceptedTypeSentence()}.`,
    });
  }

  if (candidate.size <= 0) {
    issues.push({ field: "file", message: "That file is empty." });
  } else if (candidate.size > MAX_UPLOAD_BYTES) {
    // The exact byte count is included because megabyte formatting rounds: a file one byte
    // over the limit would otherwise read "5.0 MB is over the 5.0 MB limit".
    issues.push({
      field: "file",
      message: `${formatBytes(candidate.size)} is over the ${formatBytes(MAX_UPLOAD_BYTES)} limit (${MAX_UPLOAD_BYTES.toLocaleString("en-US")} bytes). Resize it first.`,
    });
  }

  const altIssue = validateAltText(altText, candidate.name);
  if (altIssue) issues.push({ field: "alt", message: altIssue.message });

  return issues;
}

/* ------------------------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------------------------ */

export type MediaRow = {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  alt_text: string;
  caption: string;
  created_at: string;
};

export type MediaUsage = "complete" | "missing-alt";

/**
 * Whether a media row is usable in content. Rows with no alt text are flagged rather than
 * hidden: the fix is to write the description, and hiding them would lose the upload.
 */
export function mediaUsage(row: Pick<MediaRow, "alt_text" | "file_name">): MediaUsage {
  return validateAltText(row.alt_text, row.file_name) === null ? "complete" : "missing-alt";
}

/** "1600 × 900" or "dimensions not recorded" — never a guess. */
export function dimensionsLabel(width: number | null, height: number | null): string {
  if (!width || !height) return "dimensions not recorded";
  return `${width} × ${height}`;
}

export function describeRow(row: Pick<MediaRow, "mime_type" | "byte_size" | "width" | "height">): string {
  return [typeLabel(row.mime_type), formatBytes(row.byte_size), dimensionsLabel(row.width, row.height)].join(" · ");
}

/* ------------------------------------------------------------------------------------ *
 * Picking an image for a content field
 * ------------------------------------------------------------------------------------ */

/**
 * The alt text to write into a sibling field when an image is picked from the library.
 *
 * Returns `null` when the field must be left alone — that is the important case. An author
 * who has already described their own image should not have that replaced by whatever the
 * library row happens to say, and re-selecting the same image must not churn the form.
 *
 * A row with no usable alt text also yields `null` rather than an empty string, so the
 * caller cannot accidentally blank a description that was already correct.
 */
export function altTextForPick(row: Pick<MediaRow, "alt_text">, currentAlt: string | null | undefined): string | null {
  if ((currentAlt ?? "").trim().length > 0) return null;
  const candidate = row.alt_text.trim();
  return candidate.length > 0 ? candidate : null;
}
