/**
 * AI content studio (Deno / Supabase).
 *
 * Responsibilities, and the limits that make this safe to ship:
 *
 *  - **Draft only.** The function writes to `ai_drafts` with status `pending_review`. It never
 *    touches `posts`, so it cannot publish anything — publishing remains a human action in the
 *    admin panel, followed by a rebuild.
 *  - **Off by default.** It refuses unless the `ai_studio` feature flag is on, and refuses
 *    unless a provider key exists in the function's secrets.
 *  - **Server-side key.** `AI_API_KEY` never reaches the browser.
 *  - **Auth required.** The caller must present a valid Supabase JWT for an account with an
 *    admin role; there is no anonymous path to a paid API.
 *
 * Deploy (with JWT verification ON — this one is not public):
 *   supabase functions deploy ai-studio
 *   supabase secrets set AI_API_KEY=... AI_MODEL=gpt-4o-mini AI_PROVIDER=openai
 *
 * Then set NEXT_PUBLIC_AI_FN_URL to the function URL and turn the flag on in the admin panel.
 */

// deno-lint-ignore-file no-explicit-any

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const AI_API_KEY = Deno.env.get("AI_API_KEY") ?? "";
const AI_MODEL = Deno.env.get("AI_MODEL") ?? "gpt-4o-mini";
const AI_PROVIDER = Deno.env.get("AI_PROVIDER") ?? "openai";
const AI_BASE_URL = Deno.env.get("AI_BASE_URL") ?? "https://api.openai.com/v1";

const ALLOWED_ORIGIN = Deno.env.get("AI_ALLOWED_ORIGIN") ?? "*";

const CORS: Record<string, string> = {
  "access-control-allow-origin": ALLOWED_ORIGIN,
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_TOPIC = 200;
const KINDS = new Set(["outline", "draft", "metadata", "faq"]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function serviceHeaders(): Record<string, string> {
  return {
    apikey: SERVICE_ROLE_KEY,
    authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
  };
}

/** Verifies the caller's JWT and that the account holds an admin role. */
async function requireAdmin(request: Request): Promise<{ userId: string } | Response> {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return json({ error: "Missing bearer token" }, 401);

  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, authorization: header },
  });
  if (!userResponse.ok) return json({ error: "Invalid session" }, 401);
  const user = (await userResponse.json()) as { id?: string };
  if (!user.id) return json({ error: "Invalid session" }, 401);

  // `is_admin()` reads auth.uid() from the JWT claims; this function calls the REST API with
  // the service role, which has no `sub` claim, so the SQL helper would always answer false.
  // Membership is therefore read directly — the same rows the policies consult.
  const rolesResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${encodeURIComponent(user.id)}&select=role_id`,
    { headers: serviceHeaders() },
  );
  if (!rolesResponse.ok) return json({ error: "Could not verify role" }, 500);
  const roles = (await rolesResponse.json()) as Array<{ role_id?: string }>;
  if (!roles.some((role) => role.role_id === "admin")) return json({ error: "Administrator role required" }, 403);

  return { userId: user.id };
}

async function flagEnabled(): Promise<boolean> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/feature_flags?key=eq.ai_studio&select=enabled`, {
    headers: serviceHeaders(),
  });
  if (!response.ok) return false;
  const rows = (await response.json()) as Array<{ enabled?: boolean }>;
  return rows[0]?.enabled === true;
}

function systemPrompt(kind: string): string {
  const base =
    "You write for a domain-name research tool. Be concrete, avoid hype, never invent statistics, " +
    "never claim a domain is available, and never give legal or investment advice. " +
    "Write in plain English with short paragraphs.";
  switch (kind) {
    case "outline":
      return `${base} Produce a Markdown outline: an H1 and 4-7 H2 sections, each with two or three bullets. No prose paragraphs.`;
    case "draft":
      return `${base} Produce a complete Markdown article with an H1, short introduction, 4-6 H2 sections and a closing summary. Include a short note that availability and scores are heuristics.`;
    case "metadata":
      return `${base} Produce exactly three candidate SEO titles (max 60 characters each) and one meta description (max 155 characters), as a Markdown list. No other text.`;
    case "faq":
      return `${base} Produce 4-6 question and answer pairs as Markdown with "### question" headings and one-paragraph answers.`;
    default:
      return base;
  }
}

async function callProvider(payload: any): Promise<{ content: string } | Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);

  try {
    const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${AI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: AI_MODEL,
        temperature: payload.kind === "metadata" ? 0.4 : 0.7,
        max_tokens: payload.kind === "draft" ? 2000 : 900,
        messages: [
          { role: "system", content: systemPrompt(payload.kind) },
          {
            role: "user",
            content: [
              `Topic: ${payload.topic}`,
              payload.audience ? `Audience: ${payload.audience}` : null,
              payload.tone ? `Tone: ${payload.tone}` : null,
              payload.keywords.length ? `Keywords: ${payload.keywords.join(", ")}` : null,
              payload.wordTarget ? `Target length: about ${payload.wordTarget} words.` : null,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      }),
    });

    if (response.status === 429) return json({ error: "Provider rate limit" }, 429);
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return json({ error: `Provider HTTP ${response.status}: ${detail.slice(0, 200)}` }, 502);
    }

    const body = (await response.json()) as any;
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length < 40) {
      return json({ error: "Provider returned an empty completion" }, 502);
    }
    return { content: content.trim() };
  } catch (error) {
    const aborted = (error as Error)?.name === "AbortError";
    return json({ error: aborted ? "Provider timed out" : "Provider unreachable" }, 504);
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!AI_API_KEY) {
    // 503 is meaningful to the client: "no provider configured", not "try again later".
    return json({ error: "AI provider is not configured" }, 503);
  }
  if (!(await flagEnabled())) return json({ error: "AI content studio is disabled" }, 403);

  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const kind = String(payload?.kind ?? "");
  const topic = String(payload?.topic ?? "").trim();
  if (!KINDS.has(kind)) return json({ error: "Unknown draft kind" }, 400);
  if (topic.length < 6 || topic.length > MAX_TOPIC) return json({ error: "Topic must be 6–200 characters" }, 400);

  const generated = await callProvider({
    kind,
    topic,
    audience: payload.audience ? String(payload.audience).slice(0, 120) : null,
    tone: payload.tone ? String(payload.tone).slice(0, 60) : null,
    keywords: Array.isArray(payload.keywords) ? payload.keywords.slice(0, 12).map((k: unknown) => String(k).slice(0, 40)) : [],
    wordTarget: Number.isFinite(payload.wordTarget) ? Math.min(3000, Math.max(200, Number(payload.wordTarget))) : null,
    postId: typeof payload.postId === "string" ? payload.postId : null,
  });
  if (generated instanceof Response) return generated;

  // Persist as a draft awaiting review. This is the only write this function performs.
  const insert = await fetch(`${SUPABASE_URL}/rest/v1/ai_drafts`, {
    method: "POST",
    headers: { ...serviceHeaders(), prefer: "return=representation" },
    body: JSON.stringify({
      post_id: typeof payload.postId === "string" ? payload.postId : null,
      kind,
      prompt_summary: topic,
      provider: AI_PROVIDER,
      model: AI_MODEL,
      content: generated.content,
      status: "pending_review",
      created_by: auth.userId,
    }),
  });

  if (!insert.ok) return json({ error: "Could not save the draft" }, 500);
  const rows = (await insert.json()) as any[];

  return json({
    id: rows?.[0]?.id ?? null,
    content: generated.content,
    provider: AI_PROVIDER,
    model: AI_MODEL,
    status: "pending_review",
  });
});
