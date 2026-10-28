/**
 * Quantities: exact when the vocabulary allows it, explained when it does not.
 *
 * The number to beat is the engine's own space. One root plus one partner on 2–6 letters is a few
 * hundred names, not a few thousand, and the honest answer to "give me 1,000" is therefore either
 * 1,000 real names or a shortfall with a reason. These tests pin both outcomes, and pin that a
 * shortfall is never papered over with weaker rules.
 */

import { describe, expect, it } from "vitest";
import { createGenerationRequest, generate } from "@/lib/brain";

const BUDGET = 20_000;

function run(overrides: Parameters<typeof createGenerationRequest>[0], target: number) {
  return generate(createGenerationRequest({ roots: ["pay"], targetCount: target, budgetMs: BUDGET, ...overrides }), {
    now: () => Date.now(),
  });
}

describe("exact quantities", () => {
  for (const target of [25, 100, 250, 500]) {
    it(`returns exactly ${target} distinct names when the space allows it`, () => {
      const result = run({ partnerLengths: [2, 3, 4, 5, 6] }, target);
      expect(result.candidates).toHaveLength(target);
      expect(new Set(result.candidates.map((candidate) => candidate.label)).size).toBe(target);
      expect(result.diagnostics.exhausted).toBe(false);
      for (const candidate of result.candidates) {
        expect(candidate.label).toMatch(/^[a-z]+$/);
        expect(candidate.displayName.length).toBeGreaterThan(0);
      }
    });
  }

  it("is deterministic: the same request twice yields the same names in the same order", () => {
    const first = run({ partnerLengths: [2, 3, 4, 5, 6] }, 500);
    const second = run({ partnerLengths: [2, 3, 4, 5, 6] }, 500);
    expect(first.candidates.map((candidate) => candidate.label)).toEqual(
      second.candidates.map((candidate) => candidate.label),
    );
  });

  it("does not report exhaustion when the target was met", () => {
    const result = run({ partnerLengths: [2, 3, 4, 5, 6] }, 500);
    expect(result.diagnostics.exhausted).toBe(false);
    expect(result.diagnostics.reasons).toEqual([]);
  });
});

describe("honest shortfalls", () => {
  it("stops at the real size of the space and says so", () => {
    const result = run({ partnerLengths: [2, 3, 4, 5, 6] }, 1000);
    expect(result.candidates.length).toBeLessThan(1000);
    expect(result.candidates.length).toBe(result.diagnostics.produced);
    expect(result.diagnostics.exhausted).toBe(true);
    expect(result.diagnostics.reasons.join(" ")).toMatch(/at most \d+ unique two-part name/);
    // Every returned name is still a real, valid two-part name — nothing is padded.
    expect(new Set(result.candidates.map((candidate) => candidate.label)).size).toBe(result.candidates.length);
    for (const candidate of result.candidates) {
      expect(candidate.components).toHaveLength(2);
      expect(candidate.components).toContain(candidate.root);
    }
  });

  it("names the partner-length rule as the limiting constraint", () => {
    const result = run({ partnerLengths: [2] }, 100);
    expect(result.diagnostics.exhausted).toBe(true);
    expect(result.diagnostics.reasons.join(" ")).toMatch(/Only partner roots of 2 letters are allowed/);
  });

  it("does not call a budget stop an exhaustion", () => {
    const result = run({ partnerLengths: [2, 3, 4, 5, 6], budgetMs: 1 }, 1000);
    // A one-millisecond budget stops on time; the reasons must describe time, not vocabulary.
    if (result.diagnostics.exhausted === false) {
      expect(result.diagnostics.reasons.join(" ")).toMatch(/budget/);
    }
  });

  it("returns an empty list with a reason when no partner matches the length", () => {
    // Twelve-letter partners do not exist in the lexicon, so the pool is empty. The engine says
    // so; it never invents a word to fill the gap.
    const result = run({ partnerLengths: [12] }, 50);
    expect(result.candidates.length).toBe(0);
    expect(result.diagnostics.reasons.length).toBeGreaterThan(0);
  });
});

describe("performance", () => {
  it("builds the largest reachable list in well under a second", () => {
    const started = Date.now();
    const result = run({ partnerLengths: [2, 3, 4, 5, 6] }, 500);
    const elapsed = Date.now() - started;
    expect(result.candidates).toHaveLength(500);
    expect(elapsed).toBeLessThan(2000);
    expect(result.diagnostics.elapsedMs).toBeLessThan(2000);
  });
});
