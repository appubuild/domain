/**
 * The partner lexicon.
 *
 * The generator can only be as good as its word data, so the data is tested like code: every
 * entry must be lower-case letters, carry a length that matches its spelling, and declare at
 * least one role. The datasets are merged, not duplicated, and the length filter applies to the
 * partner alone.
 */

import { describe, expect, it } from "vitest";
import { INDUSTRIES } from "@/lib/brain/dictionaries/industries";
import {
  PARTNER_DATASETS,
  PARTNER_INDEX,
  PARTNER_LEXICON,
  PARTNER_LENGTH_CHOICES,
  buildPartnerIndex,
  partnerWordLength,
  partnerWords,
} from "@/lib/brain/partners";

describe("partner lexicon integrity", () => {
  it("holds a usable number of words at every offered length", () => {
    expect(PARTNER_LEXICON.length).toBeGreaterThan(300);
    for (const length of PARTNER_LENGTH_CHOICES) {
      const words = partnerWords({ lengths: [length] });
      expect(words.length, `length ${length}`).toBeGreaterThan(10);
    }
  });

  it("only contains lower-case letters, with lengths that match the spelling", () => {
    for (const entry of PARTNER_LEXICON) {
      expect(entry.word).toMatch(/^[a-z]{2,12}$/);
      expect(entry.length).toBe(entry.word.length);
      expect(entry.length).toBe(partnerWordLength(entry.word));
      expect(entry.roles.length).toBeGreaterThan(0);
      for (const role of entry.roles) expect(["modifier", "anchor"]).toContain(role);
    }
  });

  it("merges words that appear in more than one dataset instead of duplicating them", () => {
    const words = PARTNER_LEXICON.map((entry) => entry.word);
    expect(new Set(words).size).toBe(words.length);
    // "cloud" ships in a prefix library and is also cloud-industry vocabulary.
    const cloud = PARTNER_INDEX.get("cloud");
    expect(cloud?.sources.length).toBeGreaterThan(1);
    expect(cloud?.industries).toContain("cloud");
  });

  it("tags industry words with a real industry id", () => {
    const ids = new Set(INDUSTRIES.map((industry) => industry.id));
    for (const entry of PARTNER_LEXICON) {
      for (const industry of entry.industries) {
        expect(ids.has(industry), `${entry.word} → ${industry}`).toBe(true);
      }
    }
  });

  it("keeps the two built-in datasets separate and reproducible", () => {
    expect(PARTNER_DATASETS.map((dataset) => dataset.id)).toEqual(["builtin", "core"]);
    const rebuilt = buildPartnerIndex();
    expect(rebuilt.map((entry) => entry.word)).toEqual(PARTNER_LEXICON.map((entry) => entry.word));
  });

  it("accepts an extra dataset without touching the engine", () => {
    const merged = buildPartnerIndex([
      ...PARTNER_DATASETS,
      {
        id: "test-extra",
        name: "Test additions",
        description: "A dataset added at runtime.",
        kind: "json",
        entries: [
          {
            word: "zephyr",
            length: 6,
            roles: ["modifier"],
            category: "test",
            industries: ["travel"],
            sources: ["core"],
          },
        ],
      },
    ]);
    const zephyr = merged.find((entry) => entry.word === "zephyr");
    expect(zephyr?.length).toBe(6);
    expect(zephyr?.industries).toEqual(["travel"]);
  });
});

describe("partner selection", () => {
  it("filters on the partner length only", () => {
    const fours = partnerWords({ lengths: [4] });
    expect(fours.length).toBeGreaterThan(20);
    for (const entry of fours) expect(entry.word).toHaveLength(4);
  });

  it("returns every length when the filter is empty", () => {
    const all = partnerWords({});
    expect(all.length).toBe(PARTNER_LEXICON.length);
  });

  it("puts industry vocabulary first when an industry is chosen", () => {
    const fintech = partnerWords({ lengths: [4], industries: ["fintech"] });
    const first = fintech.slice(0, 5).map((entry) => entry.word);
    expect(first.some((word) => PARTNER_INDEX.get(word)?.industries.includes("fintech"))).toBe(true);
  });

  it("adds user-supplied partner words, still under the length rule", () => {
    const withCustom = partnerWords({ lengths: [4], extraWords: ["quiz", "bloom"] });
    const words = withCustom.map((entry) => entry.word);
    expect(words).toContain("quiz");
    expect(words).not.toContain("bloom");
  });

  it("can exclude the shipped libraries", () => {
    const words = partnerWords({ lengths: [4], includeLibraries: false }).map((entry) => entry.word);
    expect(words.length).toBeGreaterThan(0);
    // Every surviving word comes from an industry, the neutral list or the curated list.
    for (const word of words) {
      const sources = PARTNER_INDEX.get(word)?.sources ?? [];
      expect(sources.some((source) => ["industry", "neutral", "core"].includes(source))).toBe(true);
    }
  });
});
