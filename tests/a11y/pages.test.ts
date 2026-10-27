/**
 * Automated accessibility audit of the built site.
 *
 * This runs axe-core against every prerendered page in `out/` — the real HTML a visitor
 * receives, not a component in isolation — and fails on any violation of WCAG 2.0/2.1 A and AA
 * plus the common best-practice rules.
 *
 * Two honest limits, both stated in docs/phase-13-report.md:
 *
 *  - jsdom has no layout engine, so `color-contrast` cannot run. Contrast is verified
 *    arithmetically in `tests/a11y/contrast.test.ts` against the design tokens instead.
 *  - axe checks what a machine can check. Keyboard-only traversal, focus order inside overlays
 *    and screen-reader phrasing were reviewed by hand; those notes live in the phase report.
 *
 * The suite needs a build: `npm run build` then `npm run test:a11y`. Without `out/` it skips
 * with a message rather than passing silently on nothing.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import axe from "axe-core";
import { JSDOM, VirtualConsole } from "jsdom";
import { describe, expect, it } from "vitest";

const OUT_DIR = path.resolve("out");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

async function htmlFiles(dir: string, acc: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await htmlFiles(full, acc);
    else if (entry.name.endsWith(".html")) acc.push(full);
  }
  return acc;
}

function routeOf(file: string): string {
  const rel = path.relative(OUT_DIR, file);
  if (rel === "index.html") return "/";
  if (rel === "404.html") return "/404.html";
  return `/${rel.replace(/index\.html$/, "")}`;
}

export type Violation = { id: string; impact: string | null; help: string; nodes: string[] };

export async function auditHtml(html: string, url: string): Promise<Violation[]> {
  // jsdom reports unimplemented canvas as a "jsdomError"; axe probes for it while loading.
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  try {
    dom.window.eval(axe.source);
    const results = await (dom.window as unknown as { axe: typeof axe }).axe.run(dom.window.document, {
      runOnly: { type: "tag", values: TAGS },
      rules: { "color-contrast": { enabled: false } },
    });
    return results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? null,
      help: violation.help,
      nodes: violation.nodes.map((node) => node.html),
    }));
  } finally {
    dom.window.close();
  }
}

const hasBuild = await stat(path.join(OUT_DIR, "index.html")).then(
  () => true,
  () => false,
);

describe.skipIf(!hasBuild)("built pages are accessible", async () => {
  const files = (await htmlFiles(OUT_DIR)).sort();
  const cases = files.map((file) => [routeOf(file), file] as const);

  it("found pages to audit", () => {
    // A silent zero-page run would look like a pass and mean nothing.
    expect(cases.length).toBeGreaterThan(40);
  });

  it.each(cases)("%s", async (route, file) => {
    const html = await readFile(file, "utf8");
    const violations = await auditHtml(html, `https://domainfits.example${route}`);
    const summary = violations
      .map((v) => `${v.id} (${v.impact ?? "n/a"}) — ${v.help}\n    ${v.nodes.slice(0, 3).join("\n    ")}`)
      .join("\n");
    expect(violations, `${route}\n${summary}`).toHaveLength(0);
  });
});

if (!hasBuild) {
  describe("built pages are accessible", () => {
    it.skip("skipped: out/ has no build — run `npm run build` first", () => {});
  });
}
