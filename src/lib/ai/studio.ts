/**
 * AI content studio — request shaping and response validation.
 *
 * Rules this module exists to enforce:
 *
 *  - the studio is **off by default**; `ai_studio` is seeded false and the UI checks it;
 *  - output is always a **draft** (`ai_drafts`, status `pending_review`) — nothing here can
 *    create or publish a post, and there is no code path from generation to `posts.status`;
 *  - the provider is never called from the browser: the key lives in the Edge Function, and
 *    this module only builds the request and validates the reply;
 *  - when no function is configured the honest answer is "not available", not a canned
 *    article attributed to a model that never ran.
 */

export type DraftKind = "outline" | "draft" | "metadata" | "faq";

export type StudioRequest = {
  kind: DraftKind;
  topic: string;
  /** Target audience / angle, optional. */
  audience?: string;
  tone?: string;
  /** Existing post this draft belongs to, when refining. */
  postId?: string | null;
  keywords?: string[];
  /** Word target for a `draft`. */
  wordTarget?: number;
};

export type ValidationIssue = { field: string; message: string };

export const DRAFT_KINDS: Array<{ value: DraftKind; label: string; hint: string }> = [
  { value: "outline", label: "Outline", hint: "Headings and talking points to review before writing." },
  { value: "draft", label: "Article draft", hint: "Full draft prose. Always saved as pending review." },
  { value: "metadata", label: "SEO metadata", hint: "Title and description variants to choose between." },
  { value: "faq", label: "FAQ block", hint: "Question/answer pairs you can paste into a post." },
];

const MAX_TOPIC = 200;
const MIN_TOPIC = 6;

/**
 * Validates a studio request before it is sent.
 *
 * Deliberately strict: an empty or one-word topic produces generic filler, which is worse than
 * refusing. The UI shows these messages inline.
 */
export function validateRequest(request: StudioRequest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const topic = request.topic.trim();

  if (topic.length === 0) {
    issues.push({ field: "topic", message: "Enter a topic." });
  } else if (topic.length < MIN_TOPIC) {
    issues.push({ field: "topic", message: `Give a little more detail — at least ${MIN_TOPIC} characters.` });
  } else if (topic.length > MAX_TOPIC) {
    issues.push({ field: "topic", message: `Keep the topic under ${MAX_TOPIC} characters.` });
  }

  if (!DRAFT_KINDS.some((kind) => kind.value === request.kind)) {
    issues.push({ field: "kind", message: "Choose what to generate." });
  }

  if (request.kind === "draft") {
    const target = request.wordTarget ?? 700;
    if (!Number.isFinite(target) || target < 200 || target > 3000) {
      issues.push({ field: "wordTarget", message: "Word target must be between 200 and 3000." });
    }
  }

  if (request.keywords && request.keywords.length > 12) {
    issues.push({ field: "keywords", message: "At most 12 keywords." });
  }

  return issues;
}

export type StudioPayload = {
  kind: DraftKind;
  topic: string;
  audience: string | null;
  tone: string | null;
  postId: string | null;
  keywords: string[];
  wordTarget: number | null;
};

export function buildPayload(request: StudioRequest): StudioPayload {
  return {
    kind: request.kind,
    topic: request.topic.trim(),
    audience: request.audience?.trim() || null,
    tone: request.tone?.trim() || null,
    postId: request.postId ?? null,
    keywords: (request.keywords ?? []).map((keyword) => keyword.trim()).filter(Boolean).slice(0, 12),
    wordTarget: request.kind === "draft" ? (request.wordTarget ?? 700) : null,
  };
}

export type StudioResult =
  | { ok: true; content: string; provider: string; model: string | null }
  | { ok: false; reason: StudioFailure; message: string };

export type StudioFailure =
  | "unconfigured"
  | "flag-off"
  | "rate-limited"
  | "provider-error"
  | "invalid-response"
  | "network";

/**
 * Validates the function's reply.
 *
 * An empty or implausibly short body is treated as a failure: presenting "content" that is
 * actually an error string from a provider is exactly the kind of fabricated output the
 * studio must not produce.
 */
export function parseStudioResponse(status: number, body: unknown): StudioResult {
  if (status === 429) {
    return { ok: false, reason: "rate-limited", message: "The studio is busy. Try again in a minute." };
  }
  if (status === 503) {
    return {
      ok: false,
      reason: "unconfigured",
      message: "No AI provider key is configured on the server, so the studio cannot generate anything.",
    };
  }
  if (status === 403) {
    return { ok: false, reason: "flag-off", message: "The AI content studio is switched off for this site." };
  }
  if (status >= 400) {
    const detail =
      body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string"
        ? String((body as { error: string }).error).slice(0, 200)
        : `HTTP ${status}`;
    return { ok: false, reason: "provider-error", message: `The provider rejected the request (${detail}).` };
  }

  if (!body || typeof body !== "object") {
    return { ok: false, reason: "invalid-response", message: "The studio returned no usable payload." };
  }

  const record = body as Record<string, unknown>;
  const content = typeof record.content === "string" ? record.content.trim() : "";
  if (content.length < 40) {
    return {
      ok: false,
      reason: "invalid-response",
      message: "The studio returned an empty or truncated result. Nothing was saved.",
    };
  }

  return {
    ok: true,
    content,
    provider: typeof record.provider === "string" ? record.provider : "unknown",
    model: typeof record.model === "string" ? record.model : null,
  };
}

/** Plain-text preview used in the review table (markdown is kept verbatim in the draft). */
export function previewText(content: string, max = 240): string {
  const flattened = content.replace(/[#*_>`]/g, "").replace(/\s+/g, " ").trim();
  return flattened.length > max ? `${flattened.slice(0, max - 1)}…` : flattened;
}

export const STUDIO_DISCLOSURE =
  "Generated text is a starting point, not a published article. It is saved as a draft, never posted automatically, and must be reviewed and edited before use.";
