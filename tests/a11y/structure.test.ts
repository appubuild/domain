/**
 * Structural checks that automated rule engines get only half-right.
 *
 * axe treats a missing `<h1>` or a missing skip-link target as "incomplete" rather than a
 * violation, because both can be filled in by script after load. For a static export that is
 * exactly the wrong leniency: the HTML is the page. These assertions pin the skeleton that the
 * screen reader meets first.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const OUT_DIR = path.resolve("out");

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, acc);
    else if (entry.name.endsWith(".html")) acc.push(full);
  }
  return acc;
}

function routeOf(file: string): string {
  const rel = path.relative(OUT_DIR, file);
  if (rel === "index.html") return "/";
  return `/${rel.replace(/index\.html$/, "")}`;
}

const files = (await walk(OUT_DIR)).sort();
const hasBuild = files.length > 0;
const publicFiles = files.filter((file) => !path.relative(OUT_DIR, file).startsWith("admin/"));

describe.skipIf(!hasBuild)("page skeleton", () => {
  it("routes are discoverable", () => {
    expect(publicFiles.length).toBeGreaterThan(20);
  });

  it.each(publicFiles.map((file) => [routeOf(file), file] as const))("%s has one main heading", async (route, file) => {
    const html = await readFile(file, "utf8");
    const h1s = html.match(/<h1[\s>]/g) ?? [];
    expect(h1s.length, `${route} should have exactly one <h1>`).toBe(1);
  });

  it.each(files.map((file) => [routeOf(file), file] as const))("%s declares a language and a skip target", async (route, file) => {
    const html = await readFile(file, "utf8");
    expect(html, route).toMatch(/<html[^>]+lang="en"/);
    expect(html, route).toContain('id="main"');
    // The skip link must come before the navigation it skips.
    const skip = html.indexOf("Skip to content");
    const nav = html.indexOf("<nav");
    expect(skip, `${route} has a skip link`).toBeGreaterThan(-1);
    if (nav > -1) expect(skip, `${route} skip link precedes nav`).toBeLessThan(nav);
  });

  it.each(files.map((file) => [routeOf(file), file] as const))("%s avoids focus-order traps", async (route, file) => {
    const html = await readFile(file, "utf8");
    // A positive tabindex removes an element from document order — the classic way to make a
    // keyboard user's focus jump around unpredictably.
    const positiveTabindex = [...html.matchAll(/tabindex="(\d+)"/gi)].filter((m) => Number(m[1]) > 0);
    expect(positiveTabindex.map((m) => m[0]), route).toHaveLength(0);
    // autofocus steals focus from wherever the user was.
    expect(html, route).not.toMatch(/<[^>]+\bautofocus\b/i);
  });

  it.each(publicFiles.map((file) => [routeOf(file), file] as const))("%s labels its landmarks", async (route, file) => {
    const html = await readFile(file, "utf8");
    // Every page has the site header nav and the footer nav; unlabelled navigation landmarks
    // are indistinguishable in a screen reader's landmark list.
    const navs = [...html.matchAll(/<nav([^>]*)>/g)].map((m) => m[1] ?? "");
    const unlabelled = navs.filter((attrs) => !/aria-label|aria-labelledby/.test(attrs));
    expect(unlabelled, `${route}: ${unlabelled.join(" | ")}`).toHaveLength(0);
  });
});

if (!hasBuild) {
  describe("page skeleton", () => {
    it.skip("skipped: out/ has no build — run `npm run build` first", () => {});
  });
}
