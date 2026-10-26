/**
 * Availability Edge Function (Deno / Supabase).
 *
 * Why this exists: a static export runs entirely in the browser, and many registry RDAP
 * services do not send CORS headers. This function performs the lookup server-side, applies
 * a shared cache in Postgres, and returns the same result shape the client engine produces —
 * so `src/lib/availability/client.ts` can treat it as just another provider.
 *
 * Honesty rules baked into this file:
 *   - a network/provider failure returns `check_failed`, never `available_verified`
 *   - a 404 is only "available" when the answering service is authoritative for the TLD
 *   - rate limits surface as `rate_limited` so the UI can tell the user to retry later
 *
 * Deploy:
 *   supabase functions deploy availability --no-verify-jwt   # public, read-only lookups
 *   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform)
 *
 * Then set NEXT_PUBLIC_AVAILABILITY_FN_URL to
 *   https://<project-ref>.supabase.co/functions/v1/availability
 * and rebuild the site.
 */

// deno-lint-ignore-file no-explicit-any

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const VERIFIED_TTL_SECONDS = 6 * 60 * 60; // 6 hours for definitive answers
const INCONCLUSIVE_TTL_SECONDS = 10 * 60; // 10 minutes for failures
const FETCH_TIMEOUT_MS = 8000;

const ALLOWED_ORIGIN = Deno.env.get("AVAILABILITY_ALLOWED_ORIGIN") ?? "*";

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": ALLOWED_ORIGIN,
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-max-age": "86400",
  vary: "origin",
};

type Status =
  | "available_verified"
  | "registered"
  | "unavailable"
  | "premium_or_special_pricing"
  | "unknown"
  | "check_failed"
  | "rate_limited"
  | "unsupported_tld";

type Result = {
  domain: string;
  tld: string;
  status: Status;
  providerId: string;
  providerKind: "rdap";
  checkedAt: string;
  cached: boolean;
  confirmed: boolean;
  httpStatus?: number;
  latencyMs?: number;
  errorCode?: string;
  guidance: string;
  detail?: string;
};

const GUIDANCE: Record<Status, string> = {
  available_verified:
    "The registry returned no registration record. Registration is not guaranteed — confirm with a registrar before paying.",
  registered: "A registration record exists. This name is taken.",
  unavailable: "The registry reports this name cannot be registered.",
  premium_or_special_pricing: "The registry marks this name as reserved or premium-priced.",
  unknown: "The registry gave no usable answer. This is not evidence that the name is free.",
  check_failed: "The lookup failed (network, provider error or timeout). Try again later.",
  rate_limited: "The registry asked us to slow down. Retry after a short wait.",
  unsupported_tld: "No RDAP service is configured for this extension.",
};

/**
 * RDAP bootstrap. `rdap.org` redirects to the authoritative registry, so a 404 there means
 * "the registry has no record" for TLDs it covers; for everything else we downgrade to
 * `unknown` rather than claim availability.
 */
const BOOTSTRAP_URL = "https://rdap.org/domain/{domain}";
const AUTHORITATIVE_HOSTS = ["rdap.verisign.com", "rdap.org"];

const DOMAIN_PATTERN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,18}$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function db(path: string, init: RequestInit = {}): Promise<Response | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  try {
    return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: SERVICE_ROLE_KEY,
        authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal",
        ...(init.headers ?? {}),
      },
    });
  } catch {
    return null;
  }
}

async function readCache(domain: string): Promise<Result | null> {
  const response = await db(
    `availability_cache?domain=eq.${encodeURIComponent(domain)}&expires_at=gt.${new Date().toISOString()}&select=domain,status,provider_id,provider_kind,confirmed,checked_at`,
  );
  if (!response?.ok) return null;
  const rows = (await response.json()) as any[];
  const row = rows?.[0];
  if (!row) return null;
  return {
    domain: row.domain,
    tld: row.domain.split(".").pop() ?? "",
    status: row.status as Status,
    providerId: String(row.provider_id ?? "rdap-bootstrap"),
    providerKind: "rdap",
    checkedAt: row.checked_at,
    cached: true,
    confirmed: Boolean(row.confirmed),
    guidance: GUIDANCE[row.status as Status] ?? GUIDANCE.unknown,
  };
}

async function writeCache(result: Result): Promise<void> {
  const verified = result.status === "available_verified" || result.status === "registered";
  const ttl = verified ? VERIFIED_TTL_SECONDS : INCONCLUSIVE_TTL_SECONDS;
  await db("availability_cache", {
    method: "POST",
    body: JSON.stringify({
      domain: result.domain,
      status: result.status,
      provider_id: null, // kept null: provider rows are admin-managed, the id is informational
      provider_kind: "rdap",
      confirmed: result.confirmed,
      checked_at: result.checkedAt,
      expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
    }),
  });
}

function detectPremium(body: any): boolean {
  const text = JSON.stringify(body ?? {}).toLowerCase();
  return /"status"\s*:\s*\[[^\]]*"(reserved|premium|blocked)"/.test(text) || /premium|reserved/.test(text);
}

async function lookup(domain: string): Promise<Result> {
  const tld = domain.split(".").pop() ?? "";
  const startedAt = Date.now();
  const base = {
    domain,
    tld,
    providerId: "rdap-bootstrap",
    providerKind: "rdap" as const,
    checkedAt: new Date().toISOString(),
    cached: false,
    confirmed: false,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(BOOTSTRAP_URL.replace("{domain}", encodeURIComponent(domain)), {
      headers: { accept: "application/rdap+json, application/json" },
      redirect: "follow",
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    const host = new URL(response.url || BOOTSTRAP_URL).hostname;
    const authoritative = AUTHORITATIVE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));

    if (response.status === 404) {
      return {
        ...base,
        status: authoritative ? "available_verified" : "unknown",
        confirmed: authoritative,
        httpStatus: 404,
        latencyMs,
        guidance: authoritative ? GUIDANCE.available_verified : GUIDANCE.unknown,
        detail: `Answered by ${host}`,
      };
    }

    if (response.status === 429) {
      return { ...base, status: "rate_limited", httpStatus: 429, latencyMs, guidance: GUIDANCE.rate_limited };
    }

    if (response.status === 400 || response.status === 422) {
      return { ...base, status: "unsupported_tld", httpStatus: response.status, latencyMs, guidance: GUIDANCE.unsupported_tld };
    }

    if (response.status >= 500) {
      return {
        ...base,
        status: "check_failed",
        httpStatus: response.status,
        latencyMs,
        errorCode: `registry_${response.status}`,
        guidance: GUIDANCE.check_failed,
      };
    }

    if (response.ok) {
      const body = await response.json().catch(() => null);
      const premium = detectPremium(body);
      return {
        ...base,
        status: premium ? "premium_or_special_pricing" : "registered",
        confirmed: true,
        httpStatus: response.status,
        latencyMs,
        guidance: premium ? GUIDANCE.premium_or_special_pricing : GUIDANCE.registered,
        detail: `Answered by ${host}`,
      };
    }

    return {
      ...base,
      status: "unknown",
      httpStatus: response.status,
      latencyMs,
      guidance: GUIDANCE.unknown,
    };
  } catch (error) {
    return {
      ...base,
      status: "check_failed",
      latencyMs: Date.now() - startedAt,
      errorCode: (error as Error)?.name === "AbortError" ? "timeout" : "network",
      guidance: GUIDANCE.check_failed,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkOne(input: string): Promise<Result> {
  const domain = input.trim().toLowerCase();
  if (!DOMAIN_PATTERN.test(domain)) {
    return {
      domain,
      tld: domain.split(".").pop() ?? "",
      status: "unsupported_tld",
      providerId: "none",
      providerKind: "rdap",
      checkedAt: new Date().toISOString(),
      cached: false,
      confirmed: false,
      errorCode: "invalid_domain",
      guidance: "That is not a valid domain name.",
    };
  }

  const cached = await readCache(domain);
  if (cached) return cached;

  const result = await lookup(domain);
  await writeCache(result);
  return result;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const url = new URL(request.url);
  const domain = url.searchParams.get("domain");
  const list = url.searchParams.get("domains");

  if (!domain && !list) return json({ error: "Provide ?domain=<name> or ?domains=a.com,b.io" }, 400);

  const inputs = (list ? list.split(",") : [domain as string]).map((value) => value.trim()).filter(Boolean).slice(0, 10);
  if (inputs.length === 0) return json({ error: "No domains supplied" }, 400);

  const results = await Promise.all(inputs.map((input) => checkOne(input)));
  return json({ results, checkedAt: new Date().toISOString() });
});
