/**
 * Measure what a visitor actually downloads, page by page.
 *
 * Next writes a `/_next/static/...` script and stylesheet list into each prerendered HTML file.
 * That list *is* the first-load payload, so summing it is a real measurement rather than a
 * webpack report guess — no browser, no network, and it cannot silently drift from what ships.
 *
 *   npm run audit:size            # table for every route, sorted by weight
 *   npm run audit:size -- --json  # machine-readable
 *   npm run audit:size -- --check # exit 1 if a route breaks its budget (used by tests)
 */

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const OUT_DIR = path.resolve("out");

/**
 * Budgets are deliberately a little above today's numbers: they exist to catch a regression
 * (an accidentally imported server library, a second icon set), not to demand a rewrite.
 */
export const BUDGETS = {
  /**
   * Raw bytes of JS a single route loads before interaction.
   *
   * The heaviest non-exempt route is `/admin/monetization/` at ~711 kB raw / 206 kB gzip, and it
   * is heavy for one reason: the admin screens load `@supabase/supabase-js` plus the signing-in
   * shell, and Next puts shared modules used by the public pages into the same chunk those screens
   * fetch. The number therefore tracks the public site a little as well as the admin. 760 kB keeps
   * roughly 45 kB of headroom over today (about one extra icon set or a small library) while still
   * failing long before a second framework, a charting bundle or a duplicate date library lands.
   */
  firstLoadJs: 760_000,
  /** gzip of the same, which is closer to what crosses the wire (~206 kB today). */
  firstLoadJsGzip: 222_000,
  /** Raw bytes of CSS a single route loads. */
  css: 90_000,
};

/**
 * Per-route exceptions, with the reason attached.
 *
 * There is exactly one today: the content editor loads Tiptap (ProseMirror) to provide a real
 * writing surface. Shipping a rich-text engine costs roughly 430 kB raw / 135 kB gzip on top of
 * the admin shell, and no amount of tree-shaking removes it — the alternative is a plain
 * textarea, which is what the editor replaced. The exception is scoped to the route, so a heavy
 * import anywhere else — especially on a public page — still fails the check.
 */
export const BUDGET_OVERRIDES: Record<string, Partial<typeof BUDGETS> & { reason: string }> = {
  "/admin/editor/": {
    firstLoadJs: 1_200_000,
    firstLoadJsGzip: 360_000,
    reason: "Tiptap rich-text editor — the only route that ships a ProseMirror bundle.",
  },
};

export type RouteWeight = {
  route: string;
  js: number;
  jsGzip: number;
  css: number;
  cssGzip: number;
  chunks: number;
};

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, acc);
    else if (entry.name.endsWith(".html")) acc.push(full);
  }
  return acc;
}

function routeOf(file: string): string {
  const rel = path.relative(OUT_DIR, file);
  if (rel === "index.html") return "/";
  if (rel === "404.html") return "/404 (static fallback)";
  return `/${rel.replace(/index\.html$/, "").replace(/\.html$/, "/")}`;
}

function assetsIn(html: string): { scripts: string[]; styles: string[] } {
  const scripts = [...html.matchAll(/<script([^>]*)>/g)]
    // `noModule` polyfills are never fetched by a modern browser, so counting them would
    // overstate every route by ~110 kB and hide a real regression behind a fake one.
    .filter((match) => !/\bnoModule\b/i.test(match[1] ?? ""))
    .flatMap((match) => {
      const src = (match[1] ?? "").match(/\bsrc="([^"]+)"/);
      return src?.[1] ? [src[1]] : [];
    });
  const styles = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/g)].flatMap((m) => (m[1] ? [m[1]] : []));
  return {
    scripts: scripts.filter((src) => src.startsWith("/_next/")),
    styles: styles.filter((href) => href.startsWith("/_next/")),
  };
}

const sizes = new Map<string, { raw: number; gzip: number }>();

async function sizeOf(asset: string): Promise<{ raw: number; gzip: number }> {
  const cached = sizes.get(asset);
  if (cached) return cached;
  const file = path.join(OUT_DIR, asset.replace(/^\//, "").split("?")[0]!);
  try {
    const buffer = await readFile(file);
    const measured = { raw: buffer.byteLength, gzip: gzipSync(buffer, { level: 9 }).byteLength };
    sizes.set(asset, measured);
    return measured;
  } catch {
    const missing = { raw: 0, gzip: 0 };
    sizes.set(asset, missing);
    return missing;
  }
}

export async function measureRoutes(): Promise<RouteWeight[]> {
  const files = await walk(OUT_DIR);
  const routes: RouteWeight[] = [];
  for (const file of files) {
    const html = await readFile(file, "utf8");
    const { scripts, styles } = assetsIn(html);
    const weight: RouteWeight = { route: routeOf(file), js: 0, jsGzip: 0, css: 0, cssGzip: 0, chunks: scripts.length };
    for (const asset of new Set(scripts)) {
      const { raw, gzip } = await sizeOf(asset);
      weight.js += raw;
      weight.jsGzip += gzip;
    }
    for (const asset of new Set(styles)) {
      const { raw, gzip } = await sizeOf(asset);
      weight.css += raw;
      weight.cssGzip += gzip;
    }
    routes.push(weight);
  }
  return routes.sort((a, b) => b.js - a.js || a.route.localeCompare(b.route));
}

export function budgetFor(route: string): { firstLoadJs: number; firstLoadJsGzip: number; css: number } {
  const override = BUDGET_OVERRIDES[route];
  return {
    firstLoadJs: override?.firstLoadJs ?? BUDGETS.firstLoadJs,
    firstLoadJsGzip: override?.firstLoadJsGzip ?? BUDGETS.firstLoadJsGzip,
    css: override?.css ?? BUDGETS.css,
  };
}

export function overBudget(route: RouteWeight): string[] {
  const limit = budgetFor(route.route);
  const failures: string[] = [];
  if (route.js > limit.firstLoadJs) failures.push(`js ${route.js} > ${limit.firstLoadJs}`);
  if (route.jsGzip > limit.firstLoadJsGzip) failures.push(`js gzip ${route.jsGzip} > ${limit.firstLoadJsGzip}`);
  if (route.css > limit.css) failures.push(`css ${route.css} > ${limit.css}`);
  return failures;
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} kB`;

async function main() {
  const asJson = process.argv.includes("--json");
  const check = process.argv.includes("--check");
  try {
    await stat(path.join(OUT_DIR, "index.html"));
  } catch {
    console.error("[size] out/index.html is missing — run `npm run build` first.");
    process.exitCode = 1;
    return;
  }

  const routes = await measureRoutes();
  if (asJson) {
    console.log(JSON.stringify({ budgets: BUDGETS, routes }, null, 2));
    return;
  }

  const header = ["route", "js", "js gzip", "css", "chunks"];
  const rows = routes.map((r) => [r.route, kb(r.js), kb(r.jsGzip), kb(r.css), String(r.chunks)]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]!.length)));
  const format = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
  console.log(format(header));
  console.log(format(widths.map((w) => "".padEnd(w, "─"))));
  for (const row of rows) console.log(format(row));

  const failures = routes.flatMap((route) => overBudget(route).map((reason) => `${route.route}: ${reason}`));
  console.log(
    `\n[size] ${routes.length} route(s) · heaviest ${kb(routes[0]!.js)} raw / ${kb(routes[0]!.jsGzip)} gzip (${routes[0]!.route})`,
  );
  if (failures.length > 0) {
    console.error(`[size] ${failures.length} budget breach(es):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    if (check) process.exitCode = 1;
  } else {
    console.log("[size] every route is inside its budget.");
  }
}

// Only run when invoked as a script: tests import the measurement functions above.
if (process.argv[1]?.includes("audit-bundle")) {
  main().catch((error) => {
    console.error("[size] failed:", error);
    process.exitCode = 1;
  });
}
