"use client";

/**
 * Affiliate runtime for the static site.
 *
 * Providers and per-TLD rules are read from Supabase at run time (RLS exposes only enabled
 * rows). Nothing is cached forever: a config change in the admin panel applies to the next
 * page load, which matters because a stale URL template would send users to a dead link.
 *
 * When Supabase is not configured, or the `affiliate_routing` flag is off, the result is an
 * empty config — and the UI shows no registrar links at all. There is no built-in provider,
 * no hard-coded registrar and no "demo" destination.
 */

import { PUBLIC_ENV } from "@/lib/config/env";
import { EMPTY_AFFILIATE_CONFIG, parseProviderRow, type AffiliateConfig, type AffiliateRule } from "./links";

export type AffiliateLoadResult = {
  config: AffiliateConfig;
  source: "supabase" | "none";
  /** Human explanation surfaced by the UI / logged once. */
  note: string;
};

const CONFIG_TTL_MS = 5 * 60 * 1000;
let cached: { at: number; result: AffiliateLoadResult } | null = null;

export function resetAffiliateCache(): void {
  cached = null;
}

function isConfigured(): boolean {
  return Boolean(PUBLIC_ENV.supabaseUrl && PUBLIC_ENV.supabaseAnonKey);
}

async function restGet(path: string): Promise<unknown[] | null> {
  if (!PUBLIC_ENV.supabaseUrl || !PUBLIC_ENV.supabaseAnonKey) return null;
  try {
    const response = await fetch(`${PUBLIC_ENV.supabaseUrl}/rest/v1/${path}`, {
      headers: {
        apikey: PUBLIC_ENV.supabaseAnonKey,
        authorization: `Bearer ${PUBLIC_ENV.supabaseAnonKey}`,
        accept: "application/json",
      },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as unknown;
    return Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

/**
 * Loads and assembles the affiliate configuration.
 *
 * The feature flag gates everything: providers may be configured and enabled in the admin
 * panel, but no link is generated until `affiliate_routing` is turned on deliberately.
 */
export async function loadAffiliateConfig(options: { force?: boolean } = {}): Promise<AffiliateLoadResult> {
  if (!options.force && cached && Date.now() - cached.at < CONFIG_TTL_MS) {
    return cached.result;
  }

  if (!isConfigured()) {
    const result: AffiliateLoadResult = {
      config: EMPTY_AFFILIATE_CONFIG,
      source: "none",
      note: "No affiliate backend is configured, so registrar links are disabled.",
    };
    cached = { at: Date.now(), result };
    return result;
  }

  const [flagRows, providerRows, ruleRows] = await Promise.all([
    restGet("feature_flags?key=eq.affiliate_routing&select=key,enabled"),
    restGet(
      "affiliate_providers?enabled=eq.true&select=id,name,slug,enabled,priority,url_template,allowed_hosts,supported_tlds,disclosure,is_fallback&order=priority.asc",
    ),
    restGet("affiliate_tld_rules?enabled=eq.true&select=tld,provider_id,enabled"),
  ]);

  const flagRow = (flagRows ?? []).find((row) => (row as { key?: string }).key === "affiliate_routing") as
    | { enabled?: boolean }
    | undefined;
  const enabled = flagRow?.enabled === true;

  const providers = (providerRows ?? [])
    .map((row) => parseProviderRow(row as Record<string, unknown>))
    .filter((provider): provider is NonNullable<typeof provider> => provider !== null);

  const rules: AffiliateRule[] = (ruleRows ?? [])
    .map((row) => {
      const record = row as { tld?: unknown; provider_id?: unknown; enabled?: unknown };
      if (typeof record.tld !== "string" || typeof record.provider_id !== "string") return null;
      return { tld: record.tld, providerId: record.provider_id, enabled: record.enabled === true };
    })
    .filter((rule): rule is AffiliateRule => rule !== null);

  const result: AffiliateLoadResult = {
    config: { providers, rules, enabled },
    source: "supabase",
    note: !enabled
      ? "Affiliate routing is switched off, so no registrar links are shown."
      : providers.length === 0
        ? "Affiliate routing is on, but no provider is enabled."
        : `${providers.length} affiliate provider${providers.length === 1 ? "" : "s"} configured.`,
  };

  cached = { at: Date.now(), result };
  return result;
}

export type ClickOutcome = {
  recorded: boolean;
  reason?: "not-configured" | "unroutable" | "error";
  error?: string;
};

function sessionHash(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const key = "domainfits.analytics.session";
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const generated =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "").slice(0, 24)
        : Math.random().toString(36).slice(2, 26);
    window.sessionStorage.setItem(key, generated);
    return generated;
  } catch {
    return null;
  }
}

/**
 * Records an affiliate click.
 *
 * `click_events` is insert-only for anonymous users (no read policy), so this is a
 * best-effort counter — the return value says whether it was actually stored, and the UI
 * never claims a click was tracked when it was not.
 */
export async function recordAffiliateClick(input: {
  domain: string;
  tld: string;
  providerId: string;
  sourcePath?: string;
  sink?: (row: {
    provider_id: string | null;
    domain: string;
    tld: string;
    source_path: string;
    session_hash: string | null;
  }) => Promise<{ error: { message: string } | null }>;
}): Promise<ClickOutcome> {
  const row = {
    provider_id: input.providerId || null,
    domain: input.domain.slice(0, 253),
    tld: input.tld.slice(0, 18),
    source_path: (input.sourcePath ?? (typeof window !== "undefined" ? window.location.pathname : "")).slice(0, 300),
    session_hash: sessionHash(),
  };

  if (input.sink) {
    try {
      const { error } = await input.sink(row);
      return error ? { recorded: false, reason: "error", error: error.message } : { recorded: true };
    } catch (error) {
      return { recorded: false, reason: "error", error: (error as Error).message };
    }
  }

  if (!isConfigured()) return { recorded: false, reason: "not-configured" };

  try {
    const { getSupabase } = await import("@/lib/supabase/client");
    const supabase = getSupabase();
    if (!supabase) return { recorded: false, reason: "not-configured" };
    const { error } = await supabase.from("click_events").insert(row);
    if (error) return { recorded: false, reason: "error", error: error.message };
    return { recorded: true };
  } catch (error) {
    return { recorded: false, reason: "error", error: (error as Error).message };
  }
}

/** Whether clicks can be recorded in this build (used for the disclosure wording). */
export function isClickTrackingAvailable(): boolean {
  return isConfigured();
}
