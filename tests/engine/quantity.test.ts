/**
 * Exact quantities, partner lengths and compounds.
 *
 * The generator used to answer "1000 names" with 252, because the search space was built from
 * two hard-coded libraries and a fixed set of combination shapes. These tests pin the three
 * behaviours that fixed it: the target is met exactly when the space allows it, the partner
 * length filter applies to the partner word only, and a count that cannot be met is explained
 * rather than padded.
 */

import { describe, expect, it } from "vitest";
import { createGenerationRequest, generate, type GenerationConstraints } from "@/lib/brain";
import { partnerLengthAllowed, partnerPools, partnerWordLength } from "@/lib/brain/generate";

/** Constraints are partial here; `createGenerationRequest` normalises them against the defaults. */
const COMPOUND_CONSTRAINTS = { maxComponents: 3, maxLength: 14 };
const BUDGET = 20_000;

function run(overrides: Parameters<typeof createGenerationRequest>[0], target: number) {
  return generate(
    createGenerationRequest({
      roots: ["pay"],
      targetCount: target,
      budgetMs: BUDGET,
      constraints: COMPOUND_CONSTRAINTS as GenerationConstraints,
      ...overrides,
    }),
    { now: () => Date.now() },
  );
}

describe("exact quantities", () => {
  for (const target of [100, 500, 1000]) {
    it(`returns exactly ${target} distinct names when the space allows it`, () => {
      const result = run({ styles: ["standard", "compound", "natural-compound"] }, target);
      expect(result.candidates).toHaveLength(target);
      const labels = new Set(result.candidates.map((candidate) => candidate.label));
      expect(labels.size).toBe(target);
      // Every returned name must be a valid label — padding with rejects is not an option.
      for (const candidate of result.candidates) {
        expect(candidate.label).toMatch(/^[a-z0-9]+$/);
        expect(candidate.displayName.length).toBeGreaterThan(0);
      }
    });
  }

  it("is deterministic: the same request twice yields the same names in the same order", () => {
    const first = run({ targetCount: 500, styles: ["standard", "compound"] } as never, 500);
    const second = run({ targetCount: 500, styles: ["standard", "compound"] } as never, 500);
    expect(first.candidates.map((candidate) => candidate.label)).toEqual(
      second.candidates.map((candidate) => candidate.label),
    );
  });

  it("does not report exhaustion when the target was met", () => {
    const result = run({ styles: ["standard", "compound"] }, 500);
    expect(result.candidates).toHaveLength(500);
    expect(result.diagnostics.exhausted).toBe(false);
  });
});

describe("partner root lengths", () => {
  it("measures the partner word, not the finished label", () => {
    expect(partnerWordLength("up")).toBe(2);
    expect(partnerWordLength("nova")).toBe(4);
    expect(partnerWordLength("pay-bay")).toBe(6);
    expect(partnerLengthAllowed("neo", [2, 3])).toBe(true);
    expect(partnerLengthAllowed("nova", [2, 3])).toBe(false);
    expect(partnerLengthAllowed("whatever", [])).toBe(true);
  });

  it("only offers partners of the selected lengths", () => {
    for (const lengths of [[2], [2, 3], [3, 4], [4, 5], [2, 3, 4, 5]]) {
      const request = createGenerationRequest({ roots: ["pay"], partnerLengths: lengths });
      const pools = partnerPools(request);
      expect(pools.prefixes.length, `prefixes for ${lengths.join("/")}`).toBeGreaterThan(0);
      expect(pools.suffixes.length, `suffixes for ${lengths.join("/")}`).toBeGreaterThan(0);
      for (const word of [...pools.prefixes, ...pools.suffixes]) {
        expect(lengths, `${word} is not ${lengths.join("/")} letters`).toContain(word.length);
      }
    }
  });

  it("keeps the partner length while still producing the full quantity", () => {
    for (const lengths of [[2, 3], [3, 4], [4, 5], [2, 3, 4, 5]]) {
      const result = run({ partnerLengths: lengths, styles: ["standard", "compound", "natural-compound"] }, 500);
      expect(result.candidates.length, `lengths ${lengths.join("/")}`).toBe(500);

      // Every candidate must contain a partner of an allowed length. Single-part keyword-only
      // forms are exempt: they have no partner at all.
      for (const candidate of result.candidates) {
        if (candidate.components.length < 2) continue;
        const partners = candidate.components.filter((component) => component !== candidate.root);
        expect(partners.length).toBeGreaterThan(0);
        for (const partner of partners) {
          expect(lengths, `${candidate.label} uses a ${partner.length}-letter partner`).toContain(
            partnerWordLength(partner),
          );
        }
      }
    }
  });
});

describe("library selection", () => {
  it("treats an empty library selection as every library", () => {
    const all = partnerPools(createGenerationRequest({ roots: ["pay"], autoExpand: true }));
    const modern = partnerPools(
      createGenerationRequest({ roots: ["pay"], autoExpand: true, prefixLibraries: ["modern"] }),
    );
    expect(all.prefixes.length).toBeGreaterThan(modern.prefixes.length);
    expect(modern.prefixes.every((word) => all.prefixes.includes(word))).toBe(true);
  });

  it("uses only custom partners when automatic expansion is off", () => {
    const pools = partnerPools(
      createGenerationRequest({
        roots: ["pay"],
        autoExpand: false,
        customPrefixes: ["neo", "zen"],
        customSuffixes: ["hub"],
      }),
    );
    expect(pools.prefixes.sort()).toEqual(["neo", "zen"]);
    expect(pools.suffixes).toEqual(["hub"]);
  });

  it("changes the result set when the library selection changes", () => {
    const modern = run({ prefixLibraries: ["modern"], suffixLibraries: ["generic"], styles: ["standard"] }, 100);
    const tech = run({ prefixLibraries: ["tech"], suffixLibraries: ["tech"], styles: ["standard"] }, 100);
    expect(modern.candidates.map((c) => c.label)).not.toEqual(tech.candidates.map((c) => c.label));
  });
});

describe("honest shortfalls", () => {
  it("explains a target the space cannot meet instead of padding the list", () => {
    const result = generate(
      createGenerationRequest({
        roots: ["pay"],
        targetCount: 1000,
        budgetMs: BUDGET,
        // A single 9-letter partner, two custom words: the space cannot reach 1000.
        constraints: { minLength: 12, maxLength: 12, maxComponents: 2 } as GenerationConstraints,
        autoExpand: false,
        customPrefixes: ["nova"],
        customSuffixes: ["hub"],
        styles: ["standard"],
      }),
    );
    expect(result.candidates.length).toBeLessThan(1000);
    expect(result.diagnostics.exhausted).toBe(true);
    expect(result.diagnostics.reasons.length).toBeGreaterThan(0);
    expect(result.diagnostics.reasons.join(" ")).toMatch(/search space|partner|component|expansion|budget/i);
  });

  it("names the partner-length filter when it is the limit", () => {
    const request = createGenerationRequest({
      roots: ["pay"],
      targetCount: 1000,
      partnerLengths: [2],
      autoExpand: false,
      customPrefixes: ["up"],
      customSuffixes: ["io"],
      styles: ["standard"],
      budgetMs: BUDGET,
    });
    const result = generate(request);
    expect(result.candidates.length).toBeLessThan(1000);
    expect(result.diagnostics.reasons.join(" ")).toMatch(/partner/i);
  });

  it("says so when the compound style cannot run because components are capped", () => {
    const result = generate(
      createGenerationRequest({
        roots: ["pay"],
        targetCount: 1000,
        styles: ["compound"],
        constraints: { maxComponents: 2 } as GenerationConstraints,
        autoExpand: false,
        customPrefixes: ["nova"],
        customSuffixes: ["hub"],
        budgetMs: BUDGET,
      }),
    );
    expect(result.candidates.length).toBeLessThan(1000);
    expect(result.diagnostics.reasons.join(" ")).toMatch(/component/i);
  });
});

describe("display form and availability key", () => {
  it("shows CamelCase from the real components while the label stays lower-case", () => {
    const result = run({ styles: ["standard", "compound"], roots: ["pay"] }, 50);
    const multi = result.candidates.find((candidate) => candidate.components.length >= 2)!;
    expect(multi.label).toBe(multi.label.toLowerCase());
    expect(multi.displayName).toBe(
      multi.components.map((component) => component.charAt(0).toUpperCase() + component.slice(1)).join(""),
    );
    expect(multi.domains[0]!.domain).toBe(`${multi.label}.${multi.domains[0]!.tld}`);
  });
});
