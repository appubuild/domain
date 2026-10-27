/**
 * Emit the hosting configuration a static export cannot carry in code.
 *
 * A static build has no server, so three things that normally live in middleware have to be
 * written as files the host reads at request time:
 *
 *   out/.htaccess      Apache / LiteSpeed (most shared PHP hosting)
 *   out/_redirects     Netlify / Cloudflare Pages — redirect rules
 *   out/_headers       Netlify / Cloudflare Pages — security + caching headers
 *   out/redirects.json machine-readable audit copy of the redirect set
 *
 * Source of truth for redirects is the `redirects` table. Source of truth for whether the CSP
 * may include ad origins is `ad_settings.global_enabled`: if that read fails we leave them out,
 * because a CSP that silently permits a third-party script is worth less than one that blocks it
 * and produces a visible console error.
 *
 * The build must never ship *pretend* configuration, so every degraded path prints why.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { apacheConfig, buildCsp, netlifyHeaders, netlifyRedirects, type RedirectRow } from "./lib/hosting-config";

const OUT_DIR = path.resolve("out");
const RESERVED_PREFIXES = ["/_next", "/admin", "/api"];

async function loadDotEnv(): Promise<void> {
  for (const file of [".env.local", ".env"]) {
    try {
      const raw = await readFile(path.resolve(file), "utf8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = value;
      }
      return;
    } catch {
      // try the next candidate
    }
  }
}

function supabaseEndpoint(table: string, query: string): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url: `${url.replace(/\/$/, "")}/rest/v1/${table}?${query}`, key };
}

async function fetchRedirects(): Promise<{ rows: RedirectRow[]; source: string; warning?: string }> {
  const endpoint = supabaseEndpoint("redirects", "select=source_path,target_path,status_code,enabled&enabled=eq.true&order=source_path");
  if (!endpoint) {
    return {
      rows: [],
      source: "none",
      warning: "Supabase env vars are absent, so no database redirects were compiled.",
    };
  }
  try {
    const response = await fetch(endpoint.url, {
      headers: { apikey: endpoint.key, Authorization: `Bearer ${endpoint.key}` },
    });
    if (!response.ok) {
      return {
        rows: [],
        source: "supabase",
        warning: `Redirect fetch returned HTTP ${response.status}; only the default rules were written.`,
      };
    }
    return { rows: (await response.json()) as RedirectRow[], source: "supabase" };
  } catch (error) {
    return {
      rows: [],
      source: "supabase",
      warning: `Redirect fetch failed (${(error as Error).message}); only the default rules were written.`,
    };
  }
}

async function fetchAdsEnabled(): Promise<{ enabled: boolean; note: string }> {
  const endpoint = supabaseEndpoint("ad_settings", "select=global_enabled&limit=1");
  if (!endpoint) return { enabled: false, note: "no Supabase env; ad origins omitted from the CSP" };
  try {
    const response = await fetch(endpoint.url, {
      headers: { apikey: endpoint.key, Authorization: `Bearer ${endpoint.key}` },
    });
    if (!response.ok) return { enabled: false, note: `ad_settings read returned HTTP ${response.status}; ad origins omitted` };
    const rows = (await response.json()) as { global_enabled?: boolean }[];
    const enabled = rows.length > 0 && rows[0]?.global_enabled === true;
    return { enabled, note: enabled ? "ad_settings.global_enabled is true; ad origins allowed" : "ads are off; ad origins omitted" };
  } catch (error) {
    return { enabled: false, note: `ad_settings read failed (${(error as Error).message}); ad origins omitted` };
  }
}

function valid(rows: RedirectRow[]): RedirectRow[] {
  const seen = new Set<string>();
  const result: RedirectRow[] = [];
  for (const row of rows) {
    const source = row.source_path?.trim();
    const target = row.target_path?.trim();
    if (!source || !target) continue;
    if (!source.startsWith("/") || seen.has(source)) continue;
    if (RESERVED_PREFIXES.some((prefix) => source === prefix || source.startsWith(`${prefix}/`))) continue;
    if (!target.startsWith("/") && !target.startsWith("https://")) continue;
    if (target === source) continue;
    if (![301, 302, 307, 308].includes(Number(row.status_code))) continue;
    seen.add(source);
    result.push({ source_path: source, target_path: target, status_code: Number(row.status_code), enabled: true });
  }
  return result;
}

async function main() {
  await loadDotEnv();
  const [{ rows, source, warning }, ads] = await Promise.all([fetchRedirects(), fetchAdsEnabled()]);
  const redirects = valid(rows);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? null;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;

  const csp = buildCsp({ supabaseUrl, appUrl, ads: ads.enabled });

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, ".htaccess"), apacheConfig(redirects, appUrl, csp), "utf8");
  await writeFile(path.join(OUT_DIR, "_redirects"), netlifyRedirects(redirects), "utf8");
  await writeFile(path.join(OUT_DIR, "_headers"), netlifyHeaders(csp, appUrl), "utf8");
  await writeFile(
    path.join(OUT_DIR, "redirects.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source,
        canonicalHost: appUrl ? new URL(appUrl).host : null,
        skippedForReservedRoutes: rows.length - redirects.length,
        redirects,
        headers: {
          contentSecurityPolicy: csp,
          adsAllowed: ads.enabled,
          note: ads.note,
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  if (warning) console.warn(`[hosting] ${warning}`);
  console.log(`[hosting] ${redirects.length} redirect rule(s) compiled (source: ${source}).`);
  console.log(`[hosting] security headers written to out/.htaccess and out/_headers — ${ads.note}.`);
  if (!appUrl) console.warn("[hosting] NEXT_PUBLIC_APP_URL is unset: no canonical-host redirect and no HSTS were emitted.");
}

main().catch((error) => {
  console.error("[hosting] failed:", error);
  process.exitCode = 1;
});
