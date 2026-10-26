/**
 * Affiliate click-through Edge Function (Deno / Supabase).
 *
 * Purpose: the final redirect must be decided by the server, not by a URL the browser
 * assembled. This function:
 *
 *   1. loads the provider from the database (enabled rows only) and re-checks the host
 *      allowlist, the https scheme and the `{domain}` placeholder;
 *   2. refuses reserved/administrative paths so the endpoint cannot be used as an open
 *      redirect to arbitrary places;
 *   3. records the click (domain, tld, provider, source path, rotating session hash — no IP,
 *      no user agent) and answers with a 302 to the validated destination.
 *
 * A rejection returns 404 with a plain message — never a redirect to "something similar".
 *
 * Deploy:
 *   supabase functions deploy affiliate-click --no-verify-jwt
 *   set NEXT_PUBLIC_AFFILIATE_FN_URL=https://<ref>.supabase.co/functions/v1/affiliate-click
 */

// deno-lint-ignore-file no-explicit-any

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,18}$/;

const CORS: Record<string, string> = {
  "access-control-allow-origin": Deno.env.get("AFFILIATE_ALLOWED_ORIGIN") ?? "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { ...CORS, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

function hostMatches(host: string, allowed: string[]): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, "");
  return allowed.some((entry) => {
    const candidate = String(entry ?? "").trim().toLowerCase().replace(/\.$/, "");
    return Boolean(candidate) && (normalized === candidate || normalized.endsWith(`.${candidate}`));
  });
}

async function provider(id: string): Promise<any | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/affiliate_providers?id=eq.${encodeURIComponent(id)}&enabled=eq.true&select=id,name,url_template,allowed_hosts,supported_tlds,enabled`,
    {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        accept: "application/json",
      },
    },
  );
  if (!response.ok) return null;
  const rows = (await response.json()) as any[];
  return rows?.[0] ?? null;
}

async function routingEnabled(): Promise<boolean> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return false;
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/feature_flags?key=eq.affiliate_routing&select=enabled`,
    {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        accept: "application/json",
      },
    },
  );
  if (!response.ok) return false;
  const rows = (await response.json()) as any[];
  return rows?.[0]?.enabled === true;
}

async function recordClick(row: Record<string, unknown>): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/click_events`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  }).catch(() => {
    /* counting must never block the redirect */
  });
}

/** Rotating, salted, non-reversible session marker — no fingerprinting. */
async function hashSession(input: string): Promise<string | null> {
  if (!input) return null;
  try {
    const data = new TextEncoder().encode(`affiliate|${input}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest).slice(0, 12))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "GET") return text("Method not allowed", 405);

  const url = new URL(request.url);
  const domain = (url.searchParams.get("domain") ?? "").trim().toLowerCase();
  const providerId = (url.searchParams.get("provider") ?? "").trim();
  const sourcePath = (url.searchParams.get("src") ?? "").slice(0, 300);

  if (!DOMAIN_PATTERN.test(domain)) return text("Invalid domain", 400);
  if (providerId.length < 8 || providerId.length > 64) return text("Invalid provider", 400);

  if (!(await routingEnabled())) return text("Affiliate routing is disabled", 404);

  const row = await provider(providerId);
  if (!row) return text("Unknown provider", 404);

  const template = String(row.url_template ?? "");
  const allowedHosts: string[] = Array.isArray(row.allowed_hosts) ? row.allowed_hosts : [];

  if (!template.startsWith("https://") || !template.includes("{domain}")) {
    return text("Provider is misconfigured", 409);
  }

  let target: URL;
  try {
    target = new URL(template.split("{domain}").join(encodeURIComponent(domain)));
  } catch {
    return text("Provider is misconfigured", 409);
  }

  if (target.protocol !== "https:" || target.username || target.password || target.port) {
    return text("Provider is misconfigured", 409);
  }
  if (!hostMatches(target.hostname, allowedHosts)) return text("Destination host is not allowlisted", 409);

  const sessionHeader = request.headers.get("x-session-id") ?? "";
  const session = await hashSession(sessionHeader);

  await recordClick({
    provider_id: row.id,
    domain,
    tld: domain.split(".").pop() ?? "",
    source_path: sourcePath,
    session_hash: session,
  });

  return new Response(null, {
    status: 302,
    headers: {
      ...CORS,
      location: target.toString(),
      // Affiliate destinations must never receive a referrer containing user context.
      "referrer-policy": "no-referrer",
      "cache-control": "no-store",
    },
  });
});
