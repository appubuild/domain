/**
 * The naming rule, enforced.
 *
 * Every name is the primary root plus exactly one partner root, in the order the placement scorer
 * preferred. These tests exist because that sentence is the product: the previous engine also
 * emitted three-part compounds, prefixes and invented tails, and no amount of copy could make
 * "one root, one partner" true while those existed.
 */

import { describe, expect, it } from "vitest";
import { BOTH_PLACEMENTS_THRESHOLD } from "@/lib/brain/placement";
import { checkCandidate, normalizeConstraints } from "@/lib/brain/constraints";
import { createGenerationRequest, generate } from "@/lib/brain";

function request(overrides: Record<string, unknown> = {}) {
  return createGenerationRequest({
    roots: ["pay"],
    partnerLengths: [2, 3, 4, 5, 6],
    industries: ["fintech"],
    targetCount: 60,
    tlds: ["com", "io"],
    seed: 42,
    ...overrides,
  });
}

describe("generate — the two-part rule", () => {
  it("produces candidates for a single root", () => {
    const result = generate(request());
    expect(result.candidates.length).toBeGreaterThan(20);
    expect(result.diagnostics.produced).toBe(result.candidates.length);
    expect(result.diagnostics.strategiesRun).toEqual(["partner-combination"]);
  });

  it("builds every name from exactly one primary root and one partner root", () => {
    const result = generate(request({ targetCount: 200 }));
    for (const candidate of result.candidates) {
      expect(candidate.components, candidate.label).toHaveLength(2);
      // The root appears once, as one of the two components — never twice, never inside the other.
      expect(candidate.components.filter((component) => component === candidate.root)).toHaveLength(1);
      const partner = candidate.components.find((component) => component !== candidate.root) ?? "";
      expect(partner).toBe(candidate.partner);
      expect(partner.includes(candidate.root)).toBe(false);
      expect(candidate.root.includes(partner)).toBe(false);
      expect(candidate.label).toBe(candidate.components.join(""));
    }
  });

  it("never puts a partner root on both sides of the primary root", () => {
    const result = generate(request({ targetCount: 300 }));
    for (const candidate of result.candidates) {
      const rootIndex = candidate.components.indexOf(candidate.root);
      const partnerIndex = candidate.components.findIndex((component) => component !== candidate.root);
      // Exactly one of each, on opposite sides: the two indices can never both be 0 or both be 1.
      expect(rootIndex).not.toBe(-1);
      expect(partnerIndex).not.toBe(-1);
      expect(rootIndex).not.toBe(partnerIndex);
      expect(candidate.components).toHaveLength(2);
    }
  });

  it("matches the documented shape for the root “home”", () => {
    const result = generate(
      createGenerationRequest({ roots: ["home"], partnerLengths: [4], targetCount: 400 }),
    );
    const labels = new Set(result.candidates.map((candidate) => candidate.label));

    // The examples from the brief, where the partner data supplies a 4-letter partner.
    expect(labels.has("homeland")).toBe(true);
    expect(labels.has("homebase")).toBe(true);
    // "nest" and "stay" are 4 letters too.
    expect(labels.has("homenest")).toBe(true);
    expect(labels.has("stayhome")).toBe(true);

    for (const candidate of result.candidates) {
      expect(candidate.partner).toHaveLength(4);
      expect(candidate.industries.length === 0 || candidate.industries.includes("real-estate")).toBe(true);
    }
  });

  it("keeps the reverse order only when it clears the quality threshold on its own", () => {
    const result = generate(
      createGenerationRequest({ roots: ["home"], partnerLengths: [3, 4, 5], targetCount: 500 }),
    );
    const byLabel = new Map(result.candidates.map((candidate) => [candidate.label, candidate]));
    for (const candidate of result.candidates) {
      const reverse = byLabel.get([...candidate.components].reverse().join(""));
      if (!reverse) continue;
      // Both directions exist for this partner — so both must have scored at least the threshold.
      expect(candidate.placement.scores[candidate.order]).toBeGreaterThanOrEqual(BOTH_PLACEMENTS_THRESHOLD);
      expect(reverse.placement.scores[reverse.order]).toBeGreaterThanOrEqual(BOTH_PLACEMENTS_THRESHOLD);
      // And they are two different names, not one name counted twice.
      expect(reverse.label).not.toBe(candidate.label);
    }
    // A one-sided pair appears once only: "homeland" has no "landhome" beside it.
    const single = result.candidates.filter((candidate) => candidate.partner === "land");
    expect(single).toHaveLength(1);
    expect(single[0]?.label).toBe("homeland");
  });

  it("reports how many names put the partner first or last", () => {
    const result = generate(request({ targetCount: 100 }));
    const { "root-partner": rootFirst, "partner-root": partnerFirst } = result.diagnostics.placementSplit;
    expect(rootFirst + partnerFirst).toBe(result.candidates.length);
    expect(rootFirst).toBeGreaterThan(0);
    expect(partnerFirst).toBeGreaterThan(0);
  });
});

describe("generate — inputs behave", () => {
  it("is deterministic for the same seed", () => {
    const a = generate(request());
    const b = generate(request());
    expect(a.candidates.map((c) => c.label)).toEqual(b.candidates.map((c) => c.label));
  });

  it("changes output when the seed changes", () => {
    const a = generate(request({ seed: 1 }));
    const b = generate(request({ seed: 99 }));
    expect(a.candidates.map((c) => c.label)).not.toEqual(b.candidates.map((c) => c.label));
  });

  it("never returns duplicates", () => {
    const result = generate(request({ targetCount: 200 }));
    const labels = result.candidates.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("applies the partner length to the partner alone", () => {
    for (const length of [2, 3, 4, 5, 6]) {
      const result = generate(
        createGenerationRequest({ roots: ["pay"], partnerLengths: [length], targetCount: 50 }),
      );
      expect(result.candidates.length, `length ${length}`).toBeGreaterThan(0);
      for (const candidate of result.candidates) {
        expect(candidate.partner, `${candidate.label} at length ${length}`).toHaveLength(length);
        // The finished name is root + partner, not a fixed length.
        expect(candidate.length).toBe(candidate.root.length + candidate.partner.length);
        expect(candidate.label).toHaveLength(length + 3);
      }
    }
  });

  it("searches several partner lengths at once", () => {
    const result = generate(createGenerationRequest({ roots: ["pay"], partnerLengths: [3, 5], targetCount: 80 }));
    const lengths = new Set(result.candidates.map((candidate) => candidate.partner.length));
    expect(lengths).toEqual(new Set([3, 5]));
  });

  it("every candidate satisfies the active constraints", () => {
    const req = request({
      constraints: {
        minLength: 7,
        maxLength: 10,
        maxComponents: 2,
        allowHyphens: false,
        allowNumbers: false,
        minVowelRatio: 0.25,
        maxConsonantCluster: 3,
        preserveExactRoot: true,
        disallowRepeatedRoot: true,
        excludedSubstrings: ["hub"],
        excludedWords: ["zoo"],
        maxWordLength: 10,
        maxSyllables: 0,
      },
    });
    const constraints = normalizeConstraints(req.constraints);
    const result = generate(req);
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      const violations = checkCandidate(
        { label: candidate.label, components: candidate.components, root: candidate.root },
        constraints,
      );
      expect(violations, `${candidate.label} violated ${JSON.stringify(violations)}`).toEqual([]);
      expect(candidate.label.length).toBeGreaterThanOrEqual(7);
      expect(candidate.label.length).toBeLessThanOrEqual(10);
      expect(candidate.label.includes("pay")).toBe(true);
      expect(candidate.label).not.toContain("hub");
    }
  });

  it("honours custom partner words, including their length filter", () => {
    const result = generate(
      request({
        customPartners: ["quiz", "bloom"],
        partnerLengths: [4],
        autoExpand: false,
        industries: [],
        targetCount: 200,
      }),
    );
    const partners = new Set(result.candidates.map((candidate) => candidate.partner));
    expect(partners.has("quiz")).toBe(true);
    // "bloom" is five letters, so the length control excludes it even though it was typed in.
    expect(partners.has("bloom")).toBe(false);
  });

  it("attaches every requested TLD and keeps the label lower-case", () => {
    const result = generate(request({ tlds: ["com", "io", "dev"], targetCount: 10 }));
    expect(result.candidates[0]?.domains.map((d) => d.tld)).toEqual(["com", "io", "dev"]);
    for (const candidate of result.candidates) {
      expect(candidate.domains[0]?.domain).toBe(`${candidate.label}.com`);
      expect(candidate.label).toBe(candidate.label.toLowerCase());
      expect(candidate.displayName).toMatch(/^[A-Z]/);
      // The CamelCase form never leaks into a domain.
      for (const domain of candidate.domains) {
        expect(domain.domain).not.toMatch(/[A-Z]/);
      }
    }
  });

  it("reports exhaustion honestly when the space is small", () => {
    const result = generate(
      request({
        customPartners: ["nest", "hub"],
        autoExpand: false,
        industries: [],
        targetCount: 500,
      }),
    );
    expect(result.candidates.length).toBeLessThan(500);
    expect(result.diagnostics.exhausted).toBe(true);
    expect(result.diagnostics.reasons.join(" ")).toMatch(/two-part name|partner roots|at most/i);
  });

  it("returns an empty result with a reason when no root is valid", () => {
    const result = generate(request({ roots: ["!!!", "  "] }));
    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.reasons[0]).toMatch(/no valid root/i);
  });

  it("caps the target count at the engine limit", () => {
    const result = generate(request({ targetCount: 999_999 }));
    expect(result.diagnostics.requested).toBeLessThanOrEqual(5000);
  });

  it("stops within the time budget", () => {
    const started = Date.now();
    const result = generate(
      request({ targetCount: 2000, budgetMs: 60, roots: ["pay", "home", "cloud", "shop"] }),
    );
    expect(Date.now() - started).toBeLessThan(3000);
    expect(result.diagnostics.elapsedMs).toBeLessThan(3000);
  });

  it("can never emit reserved or banned labels", () => {
    const result = generate(request({ targetCount: 300 }));
    for (const candidate of result.candidates) {
      expect(["api", "admin", "www"]).not.toContain(candidate.label);
      expect(candidate.label).not.toContain("shit");
    }
  });
});

describe("generate — scoring and industry", () => {
  it("scores in the 0–100 range with factor breakdowns that sum to 1", () => {
    const result = generate(request({ targetCount: 20 }));
    for (const candidate of result.candidates) {
      expect(candidate.quality.score).toBeGreaterThanOrEqual(0);
      expect(candidate.quality.score).toBeLessThanOrEqual(100);
      expect(candidate.brandability.score).toBeGreaterThanOrEqual(0);
      expect(candidate.brandability.score).toBeLessThanOrEqual(100);
      const weightSum = candidate.quality.factors.reduce((sum, factor) => sum + factor.weight, 0);
      expect(weightSum).toBeCloseTo(1, 2);
    }
  });

  it("ranks brandable order differently from quality order", () => {
    const quality = generate(request({ targetCount: 30, brandable: false }));
    const brandable = generate(request({ targetCount: 30, brandable: true }));
    expect(quality.candidates.map((c) => c.label)).not.toEqual(brandable.candidates.map((c) => c.label));
  });

  it("detects an industry when none is chosen", () => {
    const detected = generate(
      createGenerationRequest({ roots: ["chat"], partnerLengths: [3, 4, 5], targetCount: 20 }),
    );
    expect(detected.candidates.length).toBeGreaterThan(0);
    // "chat" is communication vocabulary, not fintech.
    const partners = detected.candidates.map((candidate) => candidate.partner);
    expect(partners).toContain("room");
    expect(detected.candidates[0]?.industries).toContain("communication");
  });

  it("lets a manual industry override change what is generated", () => {
    const auto = generate(
      createGenerationRequest({ roots: ["chat"], partnerLengths: [3, 4], targetCount: 40 }),
    );
    const forced = generate(
      createGenerationRequest({
        roots: ["chat"],
        partnerLengths: [3, 4],
        industries: ["fintech"],
        targetCount: 40,
      }),
    );
    expect(auto.candidates.map((c) => c.label)).not.toEqual(forced.candidates.map((c) => c.label));
    for (const candidate of forced.candidates) {
      expect(candidate.industries).toEqual(["fintech"]);
    }
    // The override is visible in the vocabulary, not just the metadata.
    expect(forced.candidates.map((c) => c.partner)).toContain("bank");
  });

  it("handles multiple roots without mixing them up", () => {
    const result = generate(request({ roots: ["pay", "home"], targetCount: 80 }));
    const roots = new Set(result.candidates.map((c) => c.root));
    expect(roots.size).toBe(2);
    for (const candidate of result.candidates) {
      expect(candidate.label.includes(candidate.root)).toBe(true);
      expect(candidate.components).toContain(candidate.root);
    }
  });
});
