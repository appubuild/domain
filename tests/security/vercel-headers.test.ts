/**
 * `vercel.json` is the one hosting config that must be committed rather than generated.
 *
 * The generated `.htaccess` and `_headers` files are written *after* `next build`, which is
 * too late: Vercel reads `vercel.json` from the repository before the build starts. So the
 * header policy for the production host exists in two places, and two places drift. These
 * tests keep them honest:
 *
 *   - the non-CSP header set must be identical to what the generator emits, so the host that
 *     ignores `.htaccess` is not silently less protected than the host that reads it
 *   - the **enforcing** CSP may only contain directives that cannot break rendering
 *   - the full policy ships as `Content-Security-Policy-Report-Only`, which reports instead of
 *     blocking, and must match the generator's policy exactly
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildCsp, securityHeaders } from "../../scripts/lib/hosting-config";

const PRODUCTION_SUPABASE_URL = "https://bjbbrgjiyoquacoypsia.supabase.co";
const PRODUCTION_APP_URL = "https://domainfits.vercel.app";

type Rule = { source: string; headers: { key: string; value: string }[] };
const config = JSON.parse(readFileSync(path.resolve("vercel.json"), "utf8")) as { headers: Rule[] };

const global = config.headers.find((rule) => rule.source === "/(.*)");
const headerValue = (key: string, rules: Rule[] = config.headers): string | undefined =>
  rules.flatMap((rule) => rule.headers).find((header) => header.key.toLowerCase() === key.toLowerCase())?.value;

function directives(policy: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of policy.split(";").map((value) => value.trim()).filter(Boolean)) {
    const [name, ...values] = part.split(/\s+/);
    if (name) map.set(name, values.join(" "));
  }
  return map;
}

/**
 * Directives that only gate features this site does not use. None of them can stop a script,
 * stylesheet, font or fetch from loading, which is why they are safe to enforce on day one
 * without watching a console for violations.
 */
const SAFE_TO_ENFORCE = new Set([
  "object-src",
  "base-uri",
  "form-action",
  "frame-ancestors",
  "upgrade-insecure-requests",
]);

describe("vercel.json", () => {
  it("applies a header rule to every path", () => {
    expect(global, "a `/(.*)` rule must exist — Vercel needs an explicit match").toBeDefined();
  });

  it("publishes exactly the header set the generator emits, minus the CSP split", () => {
    const generated = securityHeaders(buildCsp({ supabaseUrl: PRODUCTION_SUPABASE_URL, appUrl: PRODUCTION_APP_URL, ads: false }), PRODUCTION_APP_URL)
      .map(([name]) => name.toLowerCase())
      .filter((name) => name !== "content-security-policy" && name !== "strict-transport-security");

    const shipped = global!.headers
      .map((header) => header.key.toLowerCase())
      .filter((name) => name.startsWith("x-") || name.startsWith("referrer") || name.startsWith("permissions") || name.startsWith("cross-"));

    expect(new Set(shipped)).toEqual(new Set(generated));
  });

  it("enforces only the directives that cannot break rendering", () => {
    const enforcing = headerValue("Content-Security-Policy");
    expect(enforcing).toBeTruthy();
    const names = [...directives(enforcing!).keys()];
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(SAFE_TO_ENFORCE.has(name), `${name} would block a request; ship it report-only first`).toBe(true);
    }
    // A fetch directive here would take the site down; name the ones that must never appear.
    for (const forbidden of ["default-src", "script-src", "style-src", "connect-src", "img-src", "font-src"]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("ships the full policy as report-only, identical to the build's", () => {
    const expected = buildCsp({ supabaseUrl: PRODUCTION_SUPABASE_URL, appUrl: PRODUCTION_APP_URL, ads: false });
    const reported = headerValue("Content-Security-Policy-Report-Only");
    expect(reported).toBe(expected);
    // The Supabase origin is what makes the policy real for this project; without it every
    // admin request would be a violation the moment report-only is promoted.
    expect(directives(reported!).get("connect-src")).toContain(PRODUCTION_SUPABASE_URL);
  });

  it("caches content-hashed assets for a year, matching the .htaccess rule", () => {
    const assetRule = config.headers.find((rule) => rule.source.includes("_next/static"));
    expect(assetRule, "hashed chunks are immutable; the Apache config says so too").toBeDefined();
    expect(headerValue("Cache-Control", [assetRule!])).toBe("public, max-age=31536000, immutable");
  });
});
