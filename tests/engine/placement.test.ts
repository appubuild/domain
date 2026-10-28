/**
 * Placement: which side of the root the partner goes.
 *
 * This is the whole "intelligence" of the new generator, and it is deliberately not magic: role
 * data plus a handful of spelling rules, scored the same way every time. The tests pin the
 * decision *and* the reasoning, because a placement change that nobody can explain is
 * indistinguishable from a random one.
 */

import { describe, expect, it } from "vitest";
import { PARTNER_INDEX } from "@/lib/brain/partners";
import { BOTH_PLACEMENTS_THRESHOLD, evaluatePlacement, junctionScore } from "@/lib/brain/placement";

function partner(word: string) {
  const entry = PARTNER_INDEX.get(word);
  if (!entry) throw new Error(`"${word}" is not in the partner lexicon`);
  return entry;
}

function decide(root: string, word: string) {
  return evaluatePlacement(root, partner(word), { industries: [] });
}

describe("junction scoring", () => {
  it("rewards a clean consonant→vowel join", () => {
    expect(junctionScore("home", "nest").delta).toBeGreaterThan(0);
    expect(junctionScore("pay", "nova").delta).toBeGreaterThan(0);
  });

  it("catches the awkward reverse that makes a two-part name hard to say", () => {
    // "nest" + "home" puts s-t-h together; "home" + "nest" does not. This is the kind of thing
    // the placement scorer exists to notice.
    expect(junctionScore("nest", "home").delta).toBeLessThan(0);
  });

  it("penalises a doubled letter at the join", () => {
    const result = junctionScore("pay", "yield");
    expect(result.delta).toBeLessThan(0);
    expect(result.reason).toMatch(/doubles the letter/);
  });

  it("penalises colliding vowel sounds but tolerates familiar pairs", () => {
    expect(junctionScore("ai", "air").delta).toBeLessThan(0);
    // "ea" reads as one sound, so it is only mildly penalised.
    expect(junctionScore("tide", "anchor").delta).toBeGreaterThan(junctionScore("ai", "air").delta);
  });

  it("penalises three consonants across the join", () => {
    expect(junctionScore("cloud", "stack").reason).toBe("joins three consonants");
  });
});

describe("word order", () => {
  it("puts a place or object behind the root", () => {
    for (const word of ["land", "nest", "base", "hub"]) {
      const decision = decide("home", word);
      expect(decision.preferred, word).toBe("root-partner");
      expect(decision.scores["root-partner"]).toBeGreaterThan(decision.scores["partner-root"]);
    }
  });

  it("puts a verb or adjective in front of the root", () => {
    for (const word of ["stay", "nova"]) {
      const decision = decide("home", word);
      expect(decision.preferred, word).toBe("partner-root");
      expect(decision.scores["partner-root"]).toBeGreaterThan(decision.scores["root-partner"]);
    }
  });

  it("gives the same answer every time", () => {
    const first = decide("pay", "nova");
    const second = decide("pay", "nova");
    expect(first.preferred).toBe(second.preferred);
    expect(first.scores).toEqual(second.scores);
  });

  it("keeps both orders only when the weaker one clears the threshold", () => {
    const hub = decide("home", "hub");
    // "hub" is a library suffix and a neutral word, so it reads either way.
    expect(hub.bothAcceptable).toBe(true);
    if (hub.bothAcceptable) {
      const other = hub.preferred === "root-partner" ? "partner-root" : "root-partner";
      expect(hub.scores[other]).toBeGreaterThanOrEqual(BOTH_PLACEMENTS_THRESHOLD);
    }

    const land = decide("home", "land");
    expect(land.bothAcceptable).toBe(false);
    expect(land.scores["partner-root"]).toBeLessThan(BOTH_PLACEMENTS_THRESHOLD);
  });

  it("explains itself in words the interface can print", () => {
    const decision = decide("home", "land");
    expect(decision.reasons.join(" ")).toMatch(/belongs behind the root/);
    const front = decide("home", "stay");
    expect(front.reasons.join(" ")).toMatch(/belongs in front/);
  });

  it("scores are whole numbers inside 0–100", () => {
    for (const word of ["land", "stay", "hub", "nova", "wallet"]) {
      const decision = decide("pay", word);
      for (const score of Object.values(decision.scores)) {
        expect(Number.isInteger(score)).toBe(true);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    }
  });
});
