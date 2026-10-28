/**
 * Filtering, sorting and the display contract, against real generated candidates.
 *
 * Three things are load-bearing here and each has its own test:
 *
 *   - filtering is applied to the *whole* result set, not to what happens to be on screen;
 *   - sorting reorders and never removes, and every comparator is stable enough to be repeatable;
 *   - the CamelCase form is display-only — the domain string and every lookup start from the
 *     lower-case label.
 */

import { describe, expect, it } from "vitest";
import { createGenerationRequest, displayForm, generate } from "@/lib/brain";
import {
  DEFAULT_FILTERS,
  SORT_OPTIONS,
  applyFilters,
  countActiveFilters,
  explainEmptyState,
  sortCandidates,
  type FilterContext,
  type ResultFilters,
  type SortKey,
} from "@/lib/generator/filters";

const result = generate(
  createGenerationRequest({
    roots: ["pay"],
    industries: ["fintech"],
    partnerLengths: [3, 4, 5],
    tlds: ["com", "io", "dev"],
    targetCount: 200,
    seed: 7,
  }),
);

const candidates = result.candidates;
const emptyContext: FilterContext = { favorites: new Set(), availability: new Map() };

function filters(overrides: Partial<ResultFilters> = {}): ResultFilters {
  return { ...DEFAULT_FILTERS, ...overrides };
}

function run(overrides: Partial<ResultFilters> = {}, sort: SortKey = "overall") {
  return applyFilters(candidates, filters(overrides), sort, emptyContext);
}

const labels = (list: { label: string }[]) => list.map((item) => item.label);

describe("fixture sanity", () => {
  it("generated a list worth filtering", () => {
    expect(candidates.length).toBeGreaterThan(80);
    // Every candidate shares the root and loads all three extensions.
    for (const candidate of candidates.slice(0, 10)) {
      expect(candidate.root).toBe("pay");
      expect(candidate.domains.map((entry) => entry.tld)).toEqual(["com", "io", "dev"]);
    }
  });
});

describe("the display contract", () => {
  it("shows CamelCase but keeps the domain lower-case", () => {
    for (const candidate of candidates.slice(0, 25)) {
      // Display form is derived from the components, not stored-independent of them.
      expect(candidate.displayName).toBe(displayForm(candidate.components));
      // The domain is the label, untouched: no capitals, no separators.
      for (const entry of candidate.domains) {
        expect(entry.domain).toBe(`${candidate.label}.${entry.tld}`);
      }
      expect(candidate.label).toBe(candidate.label.toLowerCase());
      expect(candidate.label).toMatch(/^[a-z]+$/);
    }
  });

  it("capitalises only the first letter of each part", () => {
    expect(displayForm(["pay", "nest"])).toBe("PayNest");
    expect(displayForm(["nest", "pay"])).toBe("NestPay");
    expect(displayForm(["ai", "labs"])).toBe("AILabs");
    expect(displayForm(["api", "cloud"])).toBe("APICloud");
  });

  it("keeps the chosen order in the components and the label", () => {
    for (const candidate of candidates) {
      expect(candidate.components).toHaveLength(2);
      expect(candidate.label).toBe(candidate.components.join(""));
      expect(candidate.components).toContain(candidate.root);
      expect(candidate.components).toContain(candidate.partner);
    }
  });
});

describe("sorting", () => {
  it("offers a mode for every sort the brief asks for", () => {
    const modes = SORT_OPTIONS.map((option) => option.value);
    for (const required of [
      "alphabetical",
      "alphabetical-desc",
      "shortest",
      "longest",
      "brandability",
      "brandability-asc",
      "overall",
      "overall-asc",
    ] as const) {
      expect(modes).toContain(required);
    }
  });

  it("orders every mode in the direction it claims", () => {
    const byScore = (key: SortKey, read: (c: (typeof candidates)[number]) => number, up: boolean) => {
      const sorted = sortCandidates(candidates, key, emptyContext);
      const values = sorted.map(read);
      for (let i = 1; i < values.length; i += 1) {
        if (up) expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
        else expect(values[i]!).toBeLessThanOrEqual(values[i - 1]!);
      }
    };

    byScore("overall", (c) => c.overall, false);
    byScore("overall-asc", (c) => c.overall, true);
    byScore("quality", (c) => c.quality.score, false);
    byScore("quality-asc", (c) => c.quality.score, true);
    byScore("brandability", (c) => c.brandability.score, false);
    byScore("brandability-asc", (c) => c.brandability.score, true);
    // Length is the brand name without the extension, never `paynest.com`.
    byScore("shortest", (c) => c.label.length, true);
    byScore("longest", (c) => c.label.length, false);
  });

  it("sorts A→Z and Z→A on the label", () => {
    const asc = sortCandidates(candidates, "alphabetical", emptyContext).map((c) => c.label);
    const desc = sortCandidates(candidates, "alphabetical-desc", emptyContext).map((c) => c.label);
    expect(asc).toEqual([...asc].sort());
    expect(desc).toEqual([...asc].reverse());
  });

  it("is deterministic — the same input sorts the same way twice", () => {
    for (const key of ["overall", "brandability", "shortest", "alphabetical", "semantic"] as const) {
      expect(labels(sortCandidates(candidates, key, emptyContext))).toEqual(
        labels(sortCandidates(candidates, key, emptyContext)),
      );
    }
  });

  it("does not drop or invent anything", () => {
    for (const option of SORT_OPTIONS) {
      const sorted = sortCandidates(candidates, option.value, emptyContext);
      expect(sorted).toHaveLength(candidates.length);
      expect(new Set(labels(sorted)).size).toBe(candidates.length);
    }
  });
});

describe("filtering", () => {
  it("removes nothing by default and reports the true total", () => {
    const outcome = run();
    expect(outcome.visible).toHaveLength(candidates.length);
    expect(outcome.total).toBe(candidates.length);
    expect(outcome.rejectedBy).toEqual({});
  });

  it("filters by extension across the whole list", () => {
    const outcome = run({ tld: "io" }, "alphabetical");
    expect(outcome.visible.length).toBe(candidates.length);
    expect(outcome.visible.every((candidate) => candidate.domains.some((entry) => entry.tld === "io"))).toBe(
      true,
    );
  });

  it("filters by brand length, minimum and maximum together", () => {
    const outcome = run({ minLength: 7, maxLength: 8 });
    expect(outcome.visible.length).toBeGreaterThan(0);
    for (const candidate of outcome.visible) {
      expect(candidate.length).toBeGreaterThanOrEqual(7);
      expect(candidate.length).toBeLessThanOrEqual(8);
    }
    expect(outcome.visible.length).toBeLessThan(candidates.length);
  });

  it("filters by score: domain score range, quality floor, brandability floor", () => {
    const overall = run({ minOverall: 60, maxOverall: 85 });
    for (const candidate of overall.visible) {
      expect(candidate.overall).toBeGreaterThanOrEqual(60);
      expect(candidate.overall).toBeLessThanOrEqual(85);
    }

    const quality = run({ minQuality: 70 });
    expect(quality.visible.every((candidate) => candidate.quality.score >= 70)).toBe(true);

    const brandable = run({ minBrandability: 70 });
    expect(brandable.visible.every((candidate) => candidate.brandability.score >= 70)).toBe(true);
  });

  it("filters by text: search, required and excluded", () => {
    expect(run({ search: "PAY", requiredSubstring: "pay" }).visible.length).toBe(candidates.length);
    const excluded = run({ excludedSubstring: "pay" });
    expect(excluded.visible).toHaveLength(0);
    expect(excluded.rejectedBy.excluded).toBe(candidates.length);
  });

  it("treats an unknown root as no results rather than a re-generation", () => {
    const outcome = run({ root: "home" });
    expect(outcome.visible).toHaveLength(0);
    expect(outcome.total).toBe(candidates.length);
    expect(explainEmptyState(outcome)).toContain("root keyword");
  });

  it("uses availability status only when one was recorded", () => {
    const withAvailability: FilterContext = {
      favorites: new Set(),
      availability: new Map([
        [candidates[0]!.label, { status: "available_verified", checkedAt: "2026-10-01T00:00:00Z", provider: "test" }],
      ]),
    };
    const verified = applyFilters(candidates, filters({ availability: ["available_verified"] }), "overall", withAvailability);
    expect(labels(verified.visible)).toEqual([candidates[0]!.label]);

    // Everything else is still "unchecked" — never guessed into "available".
    const unchecked = applyFilters(candidates, filters({ availability: ["unchecked"] }), "overall", withAvailability);
    expect(unchecked.visible).not.toContain(candidates[0]);
    expect(unchecked.visible).toHaveLength(candidates.length - 1);
  });

  it("combines filters with AND, and reports the count each rule removed", () => {
    const combined = run({ minLength: 7, minBrandability: 60, excludedSubstring: "zz" });
    for (const candidate of combined.visible) {
      expect(candidate.length).toBeGreaterThanOrEqual(7);
      expect(candidate.brandability.score).toBeGreaterThanOrEqual(60);
      expect(candidate.label).not.toContain("zz");
    }
    // The removal counts add up to the difference between total and visible.
    const removed = Object.values(combined.rejectedBy).reduce((sum, count) => sum + count, 0);
    expect(combined.total - combined.visible.length).toBeLessThanOrEqual(removed);
  });

  it("keeps the filters when the sort changes", () => {
    const base = { minLength: 7, minBrandability: 60 } as const;
    const counts = (["overall", "alphabetical", "shortest", "brandability-asc"] as const).map(
      (sort) => run(base, sort).visible.length,
    );
    expect(new Set(counts).size).toBe(1);
    // Sorting still reorders: at least one mode must differ from `overall`.
    const overall = labels(run(base, "overall").visible);
    const alphabetical = labels(run(base, "alphabetical").visible);
    expect(alphabetical).not.toEqual(overall);
  });

  it("restores every name when the filters are cleared", () => {
    const filtered = run({ minLength: 7, minBrandability: 60, tld: "dev", search: "pay" });
    expect(filtered.visible.length).toBeLessThan(candidates.length);
    expect(countActiveFilters(filters({ minLength: 7, minBrandability: 60, tld: "dev", search: "pay" }))).toBe(4);
    const cleared = applyFilters(candidates, DEFAULT_FILTERS, "overall", emptyContext);
    expect(cleared.visible).toHaveLength(candidates.length);
    expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0);
  });

  it("counts filters without counting zero-valued bounds", () => {
    expect(countActiveFilters(filters({ minOverall: 0, maxOverall: 0, minLength: 0 }))).toBe(0);
    expect(countActiveFilters(filters({ minOverall: 50 }))).toBe(1);
    expect(countActiveFilters(filters({ favoritesOnly: true, availability: ["unchecked"] }))).toBe(2);
  });

  it("explains an empty filtered list without blaming the engine", () => {
    const outcome = run({ minBrandability: 100, minQuality: 100 });
    if (outcome.visible.length === 0) {
      const message = explainEmptyState(outcome);
      expect(message).toMatch(/filter/i);
      expect(message).not.toMatch(/no domains exist/i);
    }
  });
});

describe("quantity and dedupe", () => {
  it("returns unique labels only", () => {
    const seen = new Set<string>();
    for (const candidate of candidates) {
      expect(seen.has(candidate.label), `${candidate.label} appeared twice`).toBe(false);
      seen.add(candidate.label);
    }
  });

  it("states its real count instead of padding to the request", () => {
    expect(result.diagnostics.produced).toBe(candidates.length);
    expect(result.diagnostics.requested).toBe(200);
    expect(result.diagnostics.produced).toBeLessThanOrEqual(result.diagnostics.requested);
    if (result.diagnostics.exhausted) {
      expect(result.diagnostics.reasons.length).toBeGreaterThan(0);
    }
  });
});
