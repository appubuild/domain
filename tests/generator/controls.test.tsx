/**
 * The generator controls, rendered.
 *
 * These assertions are about the *absence* of controls as much as their presence. The naming-style
 * picker and the total-length picker were removed deliberately; a test that only checked for the
 * new fields would pass just as happily if both came back.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_CONSTRAINTS, createGenerationRequest } from "@/lib/brain";
import { PARTNER_LENGTH_CHOICES } from "@/lib/brain/partners";
import {
  GeneratorControls,
  formStateFromRequest,
  requestFromFormState,
} from "@/components/generator/generator-controls";

function renderWith(
  overrides: {
    root?: string;
    partnerLengths?: number[];
    industries?: string[];
    showActions?: boolean;
    idPrefix?: string;
  } = {},
) {
  const request = createGenerationRequest({
    roots: overrides.root ? [overrides.root] : ["pay"],
    partnerLengths: overrides.partnerLengths ?? [2, 3, 4, 5, 6],
    industries: overrides.industries ?? [],
    tlds: ["com", "io"],
    targetCount: 100,
  });
  const state = formStateFromRequest(request);
  return renderToStaticMarkup(
    <GeneratorControls
      state={state}
      onChange={vi.fn()}
      onGenerate={vi.fn()}
      onReset={vi.fn()}
      busy={false}
      error={null}
      showActions={overrides.showActions}
      idPrefix={overrides.idPrefix}
    />,
  );
}

const render = (overrides: { root?: string; partnerLengths?: number[]; industries?: string[] } = {}) =>
  renderWith(overrides);

describe("generator controls", () => {
  it("offers the five inputs the naming rule needs, in that order", () => {
    const html = render();
    const root = html.indexOf("Primary root");
    const extensions = html.indexOf("Extensions");
    const industry = html.indexOf("Industry");
    const lengths = html.indexOf("Partner root length");
    const quantity = html.indexOf("How many names");
    const generate = html.indexOf("Generate names");

    for (const [label, index] of Object.entries({ root, extensions, industry, lengths, quantity, generate })) {
      expect(index, `${label} is missing`).toBeGreaterThan(-1);
    }
    // Extensions sit in the top area, above the partner-length and quantity controls.
    expect(extensions).toBeLessThan(lengths);
    expect(root).toBeLessThan(extensions);
    // Generate sits next to the root in row 1 so it stays visible while the rest is folded away.
    expect(generate).toBeGreaterThan(root);
    expect(generate).toBeLessThan(extensions);
  });

  it("has removed the naming-style and total-length pickers", () => {
    const html = render();
    for (const gone of [
      "Naming styles",
      "Root + partner",
      "Partner + root",
      "Prefix + root",
      "Word styles",
      "Keyword position",
      "Name length",
      "Length presets",
      "Components",
    ]) {
      expect(html, `"${gone}" must not be rendered`).not.toContain(gone);
    }
  });

  it("offers exactly the partner lengths 2–6 as multi-select chips", () => {
    const html = render();
    expect(PARTNER_LENGTH_CHOICES).toEqual([2, 3, 4, 5, 6]);
    for (const length of PARTNER_LENGTH_CHOICES) {
      expect(html).toContain(`aria-checked="true"`);
      expect(html).toContain(`title="Partner words of exactly ${length} letters`);
    }
    // Multi-select, not a single choice: five checkboxes.
    expect((html.match(/role="checkbox"/g) ?? []).length).toBe(5);
  });

  it("computes the finished length instead of asking for it", () => {
    const html = render({ root: "pay", partnerLengths: [4] });
    // "pay" is three letters, the partner four: seven letters before the dot.
    expect(html).toContain("7 letters");
    expect(html).toContain("no separate setting for it");
  });

  it("shows the detected industry in the dropdown", () => {
    const html = render({ root: "pay" });
    expect(html).toContain("<select");
    expect(html).toContain("Automatic — Fintech &amp; Payments");
    expect(html).toContain("Detected from “pay”");
  });

  it("shows an explicit automatic option when nothing was detected", () => {
    const html = render({ root: "zzzq" });
    expect(html).toContain("Automatic — no confident match");
    expect(html).toContain("general partner words are used");
  });

  it("marks a manual override and offers a reset", () => {
    const html = render({ root: "pay", industries: ["health"] });
    expect(html).toContain("your selection, not a detection");
    expect(html).toContain("Reset to auto");
    expect(html).toContain('<option value="health" selected="">');
  });

  it("keeps the Generate button enabled for a usable root", () => {
    const html = render({ root: "pay" });
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>|<button[^>]*type="submit"/);
    expect(html).not.toMatch(/type="submit"[^>]*\sdisabled(?:="")?(?=[\s>])/);
  });
});

describe("form state ⇄ request", () => {
  it("round-trips the inputs that matter", () => {
    const request = createGenerationRequest({
      roots: ["home"],
      partnerLengths: [3, 5],
      industries: ["real-estate"],
      tlds: ["com", "dev"],
      targetCount: 250,
      customPartners: ["nest"],
    });
    const back = requestFromFormState(formStateFromRequest(request));
    expect(back.roots).toEqual(["home"]);
    expect(back.partnerLengths).toEqual([3, 5]);
    expect(back.industries).toEqual(["real-estate"]);
    expect(back.tlds).toEqual(["com", "dev"]);
    expect(back.targetCount).toBe(250);
    expect(back.customPartners).toEqual(["nest"]);
  });

  it("always sends exactly two components, whatever the form said", () => {
    const request = createGenerationRequest({
      roots: ["pay"],
      constraints: { ...DEFAULT_CONSTRAINTS, maxComponents: 4 },
    });
    const back = requestFromFormState(formStateFromRequest(request));
    expect(back.constraints.maxComponents).toBe(2);
  });
});

describe("layout contract", () => {
  const workspace = readFileSync(
    path.join(process.cwd(), "src", "components", "generator", "generator-workspace.tsx"),
    "utf8",
  );

  it("keeps the industry control on one line, with its explanation below the row", () => {
    const html = render({ root: "pay" });
    // One select, one label — the old control stacked a summary, a vocabulary line and chips
    // inside a 13rem column, which is what made it look like a panel again.
    expect((html.match(/id="industry"/g) ?? []).length).toBe(1);
    expect(html).not.toContain("w-full sm:w-52");
    expect(html).toContain("lg:grid-cols-[auto_minmax(0,15rem)_7.5rem_auto]");
    // The detection prose sits after the quantity control, i.e. under the whole rules row.
    const quantity = html.indexOf("How many names");
    const summary = html.indexOf("Detected from “pay”");
    expect(summary).toBeGreaterThan(quantity);
  });

  it("puts the configure panel in a left column and the results on the right", () => {
    expect(workspace).toContain("lg:grid-cols-[20rem_minmax(0,1fr)]");
    // The columns must stretch (no `items-start`): a sticky panel inside a shrink-to-fit grid item
    // has no track to travel along and would scroll away with the page.
    expect(workspace).toContain('<div className="grid gap-5 lg:grid-cols-[20rem');
    expect(workspace).not.toContain("grid items-start gap-5 lg:grid-cols-[20rem");
    // The panel comes first in source order, so it is the left column.
    const panel = workspace.indexOf('aria-label="Generator configuration"');
    const results = workspace.indexOf("<ResultsPanel");
    expect(panel).toBeGreaterThan(-1);
    expect(results).toBeGreaterThan(panel);
    expect(workspace).toContain('<aside className="hidden lg:block">');
  });

  it("keeps the panel sticky under the header with its own scroll, never over the results", () => {
    expect(workspace).toMatch(/sticky top-\[var\(--site-header-h\)\] max-h-\[calc\(100dvh/);
    expect(workspace).toContain("overflow-y-auto scroll-thin");
    // Only that one element is sticky.
    expect((workspace.match(/className="[^"]*\bsticky\b/g) ?? []).length).toBe(1);
    // It lives in the sidebar column, not inside the results column.
    const sticky = workspace.indexOf("sticky top-[var(--site-header-h)]");
    const results = workspace.indexOf("<ResultsPanel");
    expect(results).toBeGreaterThan(sticky);
    expect(workspace.slice(sticky, results)).toContain("<GeneratorControls");
  });

  it("offers a floating Configure button on a phone that opens the panel as a left drawer", () => {
    expect(workspace).toMatch(/fixed bottom-5 right-4[^"]*lg:hidden/);
    expect(workspace).toContain('aria-controls="generator-config"');
    expect(workspace).toMatch(/<Drawer[\s\S]{0,400}?side="left"/);
    expect(workspace).toContain('title="Configure generator"');
    // The drawer carries the action in its pinned footer, so the panel has no second submit.
    expect(workspace).toContain("showActions={false}");
    expect(workspace).toContain('idPrefix="drawer-"');
  });

  it("does not submit from inside the drawer panel — the footer does", () => {
    const html = renderWith({ root: "pay", showActions: false, idPrefix: "drawer-" });
    expect(html).not.toContain("Generate names");
    expect(html).toContain('id="drawer-root"');
    expect(html).toContain('id="drawer-industry"');
    // No duplicate ids when both mount points are on the page.
    expect(html).not.toContain('id="root"');
    expect(html).not.toContain('id="industry"');
  });

  it("pages long result lists instead of rendering everything at once", () => {
    const panel = readFileSync(
      path.join(process.cwd(), "src", "components", "generator", "results-panel.tsx"),
      "utf8",
    );
    expect(panel).toContain("export const PAGE_SIZE");
    // The page is a window over the filtered list, not a limit on what was filtered.
    expect(panel).toMatch(/visible\.slice\(/);
  });

  it("keeps the industry selector inside the panel, not in a separate permanent column", () => {
    // The left column is the whole configure panel; the industry select is one control in it and
    // the root analysis moved under the results.
    expect(workspace).toContain("<RootAnalysisPanel");
    const analysis = workspace.indexOf("<RootAnalysisPanel");
    const results = workspace.indexOf("<ResultsPanel");
    expect(analysis).toBeGreaterThan(results);
  });
});
