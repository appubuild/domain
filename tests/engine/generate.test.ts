import { describe, expect, it } from "vitest";
import { createGenerationRequest, generate } from "@/lib/brain";
import { checkCandidate } from "@/lib/brain/constraints";
import { normalizeConstraints } from "@/lib/brain/constraints";

const ALL_STYLES = [
  "standard",
  "keyword-industry",
  "compound",
  "natural-compound",
  "portmanteau",
  "invented",
  "pseudo-word",
  "short-abstract",
  "exact-combination",
] as const;

function request(overrides: Record<string, unknown> = {}) {
  return createGenerationRequest({
    roots: ["pay"],
    position: "both",
    styles: [...ALL_STYLES],
    industries: ["fintech"],
    targetCount: 60,
    tlds: ["com", "io"],
    seed: 42,
    ...overrides,
  });
}

describe("generate — core behaviour", () => {
  it("produces candidates for a single root", () => {
    const result = generate(request());
    expect(result.candidates.length).toBeGreaterThan(20);
    expect(result.diagnostics.produced).toBe(result.candidates.length);
    expect(result.diagnostics.strategiesRun.length).toBeGreaterThan(1);
  });

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

  it("every candidate satisfies the active constraints", () => {
    const req = request({
      constraints: {
        minLength: 6,
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
      expect(candidate.label.length).toBeGreaterThanOrEqual(6);
      expect(candidate.label.length).toBeLessThanOrEqual(10);
      expect(candidate.label.includes("pay")).toBe(true);
    }
  });

  it("respects prefix-only and suffix-only positions", () => {
    const prefixes = generate(request({ position: "prefix", targetCount: 40 }));
    for (const candidate of prefixes.candidates) {
      if (candidate.components.length > 1) {
        expect(candidate.components.at(-1)).toBe("pay");
      }
    }
    const suffixes = generate(request({ position: "suffix", targetCount: 40 }));
    for (const candidate of suffixes.candidates) {
      if (candidate.components.length > 1) {
        expect(candidate.components[0]).toBe("pay");
      }
    }
  });

  it("attaches every requested TLD", () => {
    const result = generate(request({ tlds: ["com", "io", "dev"], targetCount: 10 }));
    expect(result.candidates[0]?.domains.map((d) => d.tld)).toEqual(["com", "io", "dev"]);
    expect(result.candidates[0]?.domains[0]?.domain).toBe(`${result.candidates[0]?.label}.com`);
  });

  it("reports exhaustion honestly when the space is small", () => {
    const result = generate(
      request({
        styles: ["standard"],
        position: "suffix",
        customSuffixes: ["nest", "hub"],
        customPrefixes: [],
        autoExpand: false,
        targetCount: 500,
      }),
    );
    expect(result.candidates.length).toBeLessThan(500);
    expect(result.diagnostics.exhausted).toBe(true);
    expect(result.diagnostics.reasons.length).toBeGreaterThan(0);
    expect(result.diagnostics.reasons.join(" ")).toMatch(/search space|rule/);
  });

  it("returns an empty result with a reason when no root is valid", () => {
    const result = generate(request({ roots: ["!!!", "  "] }));
    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.reasons[0]).toMatch(/no valid root/i);
  });

  it("caps the target count at the engine limit", () => {
    const result = generate(request({ targetCount: 999_999 }), {});
    expect(result.diagnostics.requested).toBeLessThanOrEqual(5000);
  });

  it("stops within the time budget", () => {
    const started = Date.now();
    const result = generate(
      request({ targetCount: 2000, budgetMs: 60, roots: ["pay", "home", "cloud", "shop"] }),
    );
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(3000);
    expect(result.diagnostics.elapsedMs).toBeLessThan(3000);
  });

  it("can never emit reserved or banned labels", () => {
    const result = generate(request({ targetCount: 300 }));
    const banned = ["api", "admin", "www", "paypayshit"];
    for (const candidate of result.candidates) {
      expect(banned).not.toContain(candidate.label);
    }
  });

  it("includes brandability scores in the 0–100 range with factor breakdowns", () => {
    const result = generate(request({ targetCount: 20 }));
    for (const candidate of result.candidates) {
      expect(candidate.quality.score).toBeGreaterThanOrEqual(0);
      expect(candidate.quality.score).toBeLessThanOrEqual(100);
      expect(candidate.brandability.score).toBeGreaterThanOrEqual(0);
      expect(candidate.brandability.score).toBeLessThanOrEqual(100);
      expect(candidate.quality.factors.length).toBeGreaterThan(3);
      const weightSum = candidate.quality.factors.reduce((sum, f) => sum + f.weight, 0);
      expect(weightSum).toBeCloseTo(1, 2);
    }
  });

  it("ranks brandable order differently from quality order", () => {
    const quality = generate(request({ targetCount: 30, brandable: false }));
    const brandable = generate(request({ targetCount: 30, brandable: true }));
    const qualityLabels = quality.candidates.map((c) => c.label);
    const brandableLabels = brandable.candidates.map((c) => c.label);
    expect(qualityLabels).not.toEqual(brandableLabels);
  });

  it("handles multiple roots without mixing them up", () => {
    const result = generate(request({ roots: ["pay", "home"], targetCount: 80 }));
    const roots = new Set(result.candidates.map((c) => c.root));
    expect(roots.size).toBe(2);
    for (const candidate of result.candidates) {
      expect(candidate.label.includes(candidate.root)).toBe(true);
    }
  });

  it("validates externally supplied (AI) names through the same rules", () => {
    const result = generate(
      request({
        styles: ["ai-assisted"],
        targetCount: 20,
        constraints: { ...request().constraints, minLength: 6, maxLength: 10 },
      }),
      { externalNames: ["payzen", "TOO--LONG--NAME", "pay", "api", "payorbit", "payorbit"] },
    );
    const labels = result.candidates.map((c) => c.label);
    expect(labels).toContain("payzen");
    expect(labels).toContain("payorbit");
    expect(labels).not.toContain("pay");
    expect(labels).not.toContain("api");
    expect(labels.filter((l) => l === "payorbit")).toHaveLength(1);
  });
});
