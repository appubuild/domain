/**
 * Colour contrast, computed rather than eyeballed.
 *
 * axe in jsdom cannot evaluate contrast — it needs layout and computed paint, neither of which
 * a headless DOM provides — so the token pairs are checked arithmetically instead. This is
 * stricter than checking rendered pixels: it fails on the *design system*, before a page that
 * happens to use the wrong pair is ever built.
 *
 * The pairs below are the ones the UI actually composes. WCAG 2.2 AA asks 4.5:1 for normal
 * text and 3:1 for large text and for the boundary of a form control (1.4.11).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = path.resolve("src/app/globals.css");

type Tokens = Record<string, string>;

/** Read `--name: value;` declarations from one CSS block starting at `selector`. */
function readBlock(css: string, selector: string): Tokens {
  const start = css.indexOf(`${selector} {`);
  expect(start, `selector ${selector} present in globals.css`).toBeGreaterThan(-1);
  const body = css.slice(start, css.indexOf("\n}", start));
  const tokens: Tokens = {};
  for (const match of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    tokens[match[1]!] = match[2]!.trim();
  }
  return tokens;
}

function parseColor(value: string): [number, number, number] {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16)) as [number, number, number];
  }
  throw new Error(`unsupported colour value: ${value}`);
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(parseColor(a)), relativeLuminance(parseColor(b))].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

/** Every surface a piece of text can legitimately sit on. */
const SURFACES = ["surface", "bg", "surface-2", "surface-3"];

/** Text pairs that must clear 4.5:1. */
const TEXT_PAIRS: [string, string][] = [
  ...SURFACES.flatMap((surface) => [
    ["fg", surface] as [string, string],
    ["fg-muted", surface] as [string, string],
    ["fg-subtle", surface] as [string, string],
  ]),
  ["accent-soft-fg", "accent-soft"],
  ["violet-soft-fg", "violet-soft"],
  ["success", "success-soft"],
  ["warn", "warn-soft"],
  ["danger", "danger-soft"],
  ["info", "info-soft"],
  ["success", "surface"],
  ["warn", "surface"],
  ["danger", "surface"],
  ["info", "surface"],
  ["accent", "surface"],
  ["accent-fg", "accent"],
];

/** Non-text boundaries and fills: 3:1 (WCAG 1.4.11). */
const UI_PAIRS: [string, string][] = SURFACES.flatMap((surface) => [["border-strong", surface] as [string, string]]);

const themes: [string, string][] = [
  ["light", ":root"],
  ["dark", '[data-theme="dark"]'],
];

describe("globals.css contrast", () => {
  const cache = new Map<string, Tokens>();

  async function tokensFor(selector: string): Promise<Tokens> {
    const cached = cache.get(selector);
    if (cached) return cached;
    const css = await readFile(CSS, "utf8");
    const tokens = readBlock(css, selector);
    cache.set(selector, tokens);
    return tokens;
  }

  it.each(themes)("%s theme: body and label text clears 4.5:1 on every surface", async (_name, selector) => {
    const tokens = await tokensFor(selector);
    const failures: string[] = [];
    for (const [fg, bg] of TEXT_PAIRS) {
      const fgValue = tokens[fg];
      const bgValue = tokens[bg];
      expect(fgValue, `--${fg} is defined`).toBeDefined();
      expect(bgValue, `--${bg} is defined`).toBeDefined();
      const ratio = contrast(fgValue!, bgValue!);
      if (ratio < 4.5) failures.push(`${fg} on ${bg} = ${ratio.toFixed(2)}:1`);
    }
    expect(failures, failures.join("; ")).toHaveLength(0);
  });

  it.each(themes)("%s theme: control borders clear 3:1 (WCAG 1.4.11)", async (_name, selector) => {
    const tokens = await tokensFor(selector);
    const failures: string[] = [];
    for (const [fg, bg] of UI_PAIRS) {
      const ratio = contrast(tokens[fg]!, tokens[bg]!);
      if (ratio < 3) failures.push(`${fg} on ${bg} = ${ratio.toFixed(2)}:1`);
    }
    expect(failures, failures.join("; ")).toHaveLength(0);
  });

  it("keeps the three text levels distinguishable from one another", async () => {
    // A contrast fix that collapses --fg-subtle into --fg-muted would pass the checks above
    // while destroying the hierarchy the design depends on.
    for (const [, selector] of themes) {
      const tokens = await tokensFor(selector);
      expect(tokens["fg"]).not.toBe(tokens["fg-muted"]);
      expect(tokens["fg-muted"]).not.toBe(tokens["fg-subtle"]);
      const step = contrast(tokens["fg"]!, tokens["fg-subtle"]!);
      expect(step).toBeGreaterThan(2.5);
    }
  });
});
