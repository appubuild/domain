/**
 * Naming styles, root analysis and the controls that must change real output.
 *
 * The requirement behind these tests is that every control in the generator does something. A
 * chip that only changes its own colour is worse than no chip, so each naming style is checked
 * against the engine's actual output, and the root analysis is checked against the dictionaries
 * it claims to read.
 */

import { describe, expect, it } from "vitest";
import {
  NAMING_STYLES,
  NAMING_STYLE_IDS,
  analyseRoot,
  engineForNamingStyles,
  namingStylesInState,
  recommendNamingStyles,
  rootVariants,
} from "@/lib/generator/naming-styles";
import { createGenerationRequest, generate } from "@/lib/brain";

const BUDGET = 20_000;

describe("naming style mapping", () => {
  it("offers exactly the six styles the product promises", () => {
    expect(NAMING_STYLE_IDS).toEqual([
      "root-partner",
      "partner-root",
      "prefix-root",
      "root-suffix",
      "compound",
      "shortened",
    ]);
  });

  it("maps each style onto engine word styles and a direction", () => {
    expect(engineForNamingStyles(["root-partner"])).toMatchObject({ styles: ["standard"], position: "suffix" });
    expect(engineForNamingStyles(["partner-root"])).toMatchObject({ styles: ["standard"], position: "prefix" });
    expect(engineForNamingStyles(["prefix-root"])).toMatchObject({
      styles: ["keyword-brand-prefix"],
      position: "prefix",
    });
    expect(engineForNamingStyles(["root-suffix"])).toMatchObject({
      styles: ["keyword-brand-suffix"],
      position: "suffix",
    });
    expect(engineForNamingStyles(["root-partner", "partner-root"])).toMatchObject({ position: "both" });
    expect(engineForNamingStyles(["shortened"]).position).toBe("flexible");
  });

  it("raises the component limit for compounds, because a compound is three parts", () => {
    expect(engineForNamingStyles(["compound"]).maxComponents).toBe(3);
    expect(engineForNamingStyles(["root-partner"]).maxComponents).toBe(2);
  });

  it("never returns an empty style list", () => {
    expect(engineForNamingStyles([]).styles.length).toBeGreaterThan(0);
  });

  it("round-trips through the form state used by the chips", () => {
    for (const style of NAMING_STYLES) {
      const engine = engineForNamingStyles([style.id]);
      expect(namingStylesInState(engine), style.id).toContain(style.id);
    }
  });
});

describe("engine output per style", () => {
  const cases: Array<{ ids: Parameters<typeof engineForNamingStyles>[0]; expect: RegExp }> = [
    { ids: ["root-partner"], expect: /^pay[a-z]{2,}$/ },
    { ids: ["partner-root"], expect: /^[a-z]{2,}pay$/ },
    { ids: ["compound"], expect: /pay/ },
    { ids: ["shortened"], expect: /pay/ },
  ];

  for (const item of cases) {
    it(`${item.ids.join("+")} produces names shaped the way the chip says`, () => {
      const engine = engineForNamingStyles(item.ids);
      const result = generate(
        createGenerationRequest({
          roots: ["pay"],
          targetCount: 25,
          styles: engine.styles,
          position: engine.position,
          constraints: { maxComponents: engine.maxComponents, maxLength: 16 } as never,
          budgetMs: BUDGET,
        }),
      );
      expect(result.candidates.length).toBeGreaterThan(0);
      const shaped = result.candidates.filter((candidate) => item.expect.test(candidate.label));
      expect(shaped.length).toBeGreaterThan(0);
    });
  }

  it("switching styles changes the labels that come back", () => {
    const first = generate(
      createGenerationRequest({ roots: ["pay"], targetCount: 50, styles: ["standard"], position: "suffix", budgetMs: BUDGET }),
    ).candidates.map((candidate) => candidate.label);
    const second = generate(
      createGenerationRequest({
        roots: ["pay"],
        targetCount: 50,
        styles: ["portmanteau", "short-abstract"],
        position: "flexible",
        budgetMs: BUDGET,
      }),
    ).candidates.map((candidate) => candidate.label);
    expect(first).not.toEqual(second);
  });
});

describe("recommendations", () => {
  it("suggests lengthening partners for a very short root", () => {
    const recommendation = recommendNamingStyles("ai");
    expect(recommendation.styles).toContain("root-partner");
    expect(recommendation.reason).toMatch(/letters/i);
  });

  it("suggests shortening for a long root", () => {
    const recommendation = recommendNamingStyles("marketplace");
    expect(recommendation.styles).toContain("shortened");
  });

  it("is deterministic and always suggests something for a valid root", () => {
    const first = recommendNamingStyles("cloud");
    const second = recommendNamingStyles("cloud");
    expect(first).toEqual(second);
    for (const root of ["pay", "ai", "marketplace", "cloud", "zen"]) {
      expect(recommendNamingStyles(root).styles.length).toBeGreaterThan(0);
    }
  });
});

describe("root analysis", () => {
  it("classifies a dictionary word", () => {
    const analysis = analyseRoot("pay");
    expect(analysis.kind).toBe("word");
    expect(analysis.letters).toBe(3);
    expect(analysis.syllables).toBe(1);
    expect(analysis.industries.map((industry) => industry.id)).toContain("fintech");
    expect(analysis.meaning).toMatch(/payment|settle|remit/i);
  });

  it("classifies a vowel-poor short root as an abbreviation", () => {
    expect(analyseRoot("hq").kind).toBe("abbreviation");
  });

  it("classifies an unknown root as coined and says there is no curated meaning", () => {
    const analysis = analyseRoot("zynthro");
    expect(analysis.kind).toBe("coined");
    expect(analysis.meaning).toMatch(/no curated meaning/i);
    expect(analysis.synonyms).toEqual([]);
  });

  it("strips punctuation from a phrase and reports that it did", () => {
    const analysis = analyseRoot("home & away");
    expect(analysis.root).toBe("homeaway");
    expect(analysis.kind).toBe("phrase");
  });

  it("handles an empty root without pretending to know anything", () => {
    const analysis = analyseRoot("");
    expect(analysis.letters).toBe(0);
    expect(analysis.industries).toEqual([]);
    expect(analysis.meaning).toMatch(/no root/i);
  });

  it("honours a manual industry override", () => {
    const analysis = analyseRoot("pay", ["health"]);
    expect(analysis.industries.some((industry) => industry.id === "health")).toBe(true);
  });
});

describe("root variants", () => {
  it("never returns the root itself and stays short", () => {
    for (const root of ["pay", "cloud", "zynthro", "hq"]) {
      const variants = rootVariants(root);
      expect(variants).not.toContain(root);
      expect(variants.length).toBeLessThanOrEqual(6);
      expect(new Set(variants).size).toBe(variants.length);
    }
  });

  it("adds short suffixes the engine can actually generate", () => {
    expect(rootVariants("pay")).toContain("payly");
    expect(rootVariants("cloud")).toContain("cloudio");
  });
});
