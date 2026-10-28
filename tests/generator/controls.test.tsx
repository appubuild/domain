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

function render(overrides: { root?: string; partnerLengths?: number[]; industries?: string[] } = {}) {
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
    />,
  );
}

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

  it("makes the control card sticky under the site header, and nothing else", () => {
    expect(workspace).toContain("sticky top-[var(--site-header-h)]");
    // The results column must not be sticky: only the generation controls are.
    expect(workspace).not.toMatch(/className="[^"]*\bsticky\b[^"]*"[^>]*>\s*\{diagnostics/);
    expect((workspace.match(/className="[^"]*\bsticky\b/g) ?? []).length).toBe(1);
  });

  it("collapses the secondary controls on a phone and shows them from `lg` up", () => {
    const html = render({ root: "pay" });
    // The Setup toggle is mobile-only; the panel it controls is closed on mobile, open on desktop.
    expect(html).toMatch(/<button[^>]*lg:hidden[^>]*aria-controls="generator-setup"/);
    expect(html).toMatch(/id="generator-setup" class="space-y-2\.5 hidden lg:block"/);
  });

  it("keeps Generate in the always-visible row, before the fold-away panel", () => {
    const html = render({ root: "pay" });
    const generate = html.indexOf("Generate names");
    const panel = html.indexOf('id="generator-setup"');
    expect(generate).toBeGreaterThan(-1);
    expect(generate).toBeLessThan(panel);
  });

  it("puts the sticky card directly around the controls, so the button scrolls with the page", () => {
    const workspace = readFileSync(
      path.join(process.cwd(), "src", "components", "generator", "generator-workspace.tsx"),
      "utf8",
    );
    const sticky = workspace.indexOf('className="sticky top-[var(--site-header-h)]');
    const controls = workspace.indexOf("<GeneratorControls", sticky);
    expect(sticky).toBeGreaterThan(-1);
    expect(controls).toBeGreaterThan(sticky);
    // Nothing that renders results sits between the sticky card and its controls.
    expect(workspace.slice(sticky, controls)).not.toContain("<ResultsPanel");
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

  it("does not park the industry selector in a permanent side panel", () => {
    // The panel is the root analysis, and it is a secondary column, not the industry control.
    expect(workspace).toContain("<RootAnalysisPanel");
    expect(workspace).not.toMatch(/Sidebar/);
  });
});
