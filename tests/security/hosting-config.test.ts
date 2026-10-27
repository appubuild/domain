/**
 * The hosting configuration is code, so it gets tested like code.
 *
 * A wrong CSP is invisible until something breaks in a browser, and an over-permissive one is
 * invisible forever. These assertions pin the parts that must not drift: no wildcard script
 * origins, Supabase named in connect-src, ad origins only when ads are actually enabled, and
 * HSTS only behind HTTPS.
 */

import { describe, expect, it } from "vitest";
import {
  apacheConfig,
  buildCsp,
  netlifyHeaders,
  netlifyRedirects,
  type RedirectRow,
} from "../../scripts/lib/hosting-config";

const SUPABASE = "https://abcdefghijklmnop.supabase.co";
const APP = "https://domainfits.example";

function directive(csp: string, name: string): string[] {
  const found = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  if (!found) return [];
  return found.split(/\s+/).slice(1);
}

describe("content security policy", () => {
  const csp = buildCsp({ supabaseUrl: SUPABASE, appUrl: APP, ads: false });

  it("never allows a wildcard or protocol-relative source", () => {
    expect(csp).not.toMatch(/\*/);
    expect(csp).not.toContain("// ");
  });

  it("locks down the directives that matter for injection", () => {
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "frame-ancestors")).toEqual(["'self'"]);
    // Inline event handlers are blocked even though inline <script> cannot be.
    expect(directive(csp, "script-src-attr")).toEqual(["'none'"]);
  });

  it("names the Supabase origin in connect-src, in both schemes", () => {
    const connect = directive(csp, "connect-src");
    expect(connect).toContain(SUPABASE);
    expect(connect).toContain("wss://abcdefghijklmnop.supabase.co");
  });

  it("omits ad origins while advertising is off", () => {
    expect(csp).not.toContain("googlesyndication");
    expect(directive(csp, "frame-src")).toHaveLength(0);
  });

  it("adds ad origins — and only ad origins — when advertising is on", () => {
    const withAds = buildCsp({ supabaseUrl: SUPABASE, appUrl: APP, ads: true });
    expect(directive(withAds, "script-src")).toContain("https://pagead2.googlesyndication.com");
    expect(directive(withAds, "frame-src")).toContain("https://googleads.g.doubleclick.net");
    // Still no wildcards, and 'self' is still first.
    expect(withAds).not.toMatch(/\*/);
    expect(directive(withAds, "script-src")[0]).toBe("'self'");
  });

  it("still produces a valid policy with no Supabase configured", () => {
    const bare = buildCsp({ supabaseUrl: null, appUrl: null, ads: false });
    expect(directive(bare, "connect-src")).toEqual(["'self'"]);
    // No empty directives — `frame-src ;` is a syntax error browsers discard the whole
    // policy over.
    expect(bare).not.toMatch(/;\s*;/);
    expect(bare).not.toMatch(/[a-z-]+ ;/);
  });

  it("cannot be escaped by a crafted Supabase URL", () => {
    const hostile = buildCsp({ supabaseUrl: 'https://x.supabase.co"; script-src *; "', appUrl: APP, ads: false });
    expect(hostile).not.toMatch(/\*/);
    expect(hostile).not.toContain('";');
    // The unparseable URL is dropped rather than embedded.
    expect(directive(hostile, "connect-src")).toEqual(["'self'"]);
  });
});

describe("apache configuration", () => {
  const rows: RedirectRow[] = [
    { source_path: "/old-page", target_path: "/new-page", status_code: 301, enabled: true },
    { source_path: "/temp", target_path: "https://example.com/x", status_code: 302, enabled: true },
  ];
  const config = apacheConfig(rows, APP, buildCsp({ supabaseUrl: SUPABASE, appUrl: APP, ads: false }));

  it("sets every security header exactly once", () => {
    for (const header of [
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Strict-Transport-Security",
    ]) {
      const occurrences = config.split(`Header always set ${header} `).length - 1;
      expect(occurrences, header).toBe(1);
    }
  });

  it("only sends HSTS when the canonical URL is https", () => {
    const insecure = apacheConfig([], "http://domainfits.example", buildCsp({ supabaseUrl: null, appUrl: null, ads: false }));
    expect(insecure).not.toContain("Strict-Transport-Security");
  });

  it("caches hashed assets forever and HTML not at all", () => {
    expect(config).toContain("max-age=31536000, immutable");
    expect(config).toContain("max-age=0, must-revalidate");
  });

  it("keeps the redirect rules and the fallbacks", () => {
    expect(config).toContain("RewriteRule ^old-page/?$ /new-page [R=301,L]");
    expect(config).toContain("RewriteRule ^temp/?$ https://example.com/x [R=302,L]");
    expect(config).toContain("ErrorDocument 404 /404.html");
    expect(config).toContain("DirectoryIndex index.html");
    expect(config).toContain("Options -Indexes");
  });

  it("redirects to the canonical host before anything else", () => {
    const canonical = config.indexOf("RewriteCond %{HTTPS} off");
    const firstRule = config.indexOf("RewriteRule ^old-page");
    expect(canonical).toBeGreaterThan(-1);
    expect(canonical).toBeLessThan(firstRule);
  });

  it("quotes header values with single quotes only", () => {
    const cspLine = config.split("\n").find((line) => line.includes("Content-Security-Policy"))!;
    const value = cspLine.slice(cspLine.indexOf('"') + 1, cspLine.lastIndexOf('"'));
    expect(value).not.toContain('"');
  });
});

describe("netlify configuration", () => {
  const csp = buildCsp({ supabaseUrl: SUPABASE, appUrl: APP, ads: false });

  it("carries the same policy as the Apache file", () => {
    expect(netlifyHeaders(csp, APP)).toContain(`Content-Security-Policy: ${csp}`);
  });

  it("writes a redirects file with a header even when there is nothing to redirect", () => {
    const empty = netlifyRedirects([]);
    expect(empty.startsWith("#")).toBe(true);
    expect(empty.trim().split("\n")).toHaveLength(1);
  });

  it("formats rules as source, destination, status", () => {
    const file = netlifyRedirects([{ source_path: "/a", target_path: "/b", status_code: 301, enabled: true }]);
    expect(file).toContain("/a  /b  301");
  });
});
