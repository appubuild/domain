/**
 * Industry detection, as the user experiences it.
 *
 * "pay → Fintech, cloud → Cloud/SaaS/DevOps, ai → AI/ML, chat → Communication, secure → Security"
 * is the promise. Each of those is asserted here, together with the three states the control can be
 * in and the promise that a manual choice is kept until the root changes.
 */

import { describe, expect, it } from "vitest";
import { CONFIDENT_THRESHOLD, industryStateFor, rankIndustries } from "@/lib/generator/industry";
import { createGenerationRequest, generate } from "@/lib/brain";

const expectTop = (root: string, ids: string[]) => {
  const state = industryStateFor(root, []);
  expect(state.mode, root).toBe("auto");
  expect(state.applied, root).not.toBeNull();
  expect(ids, root).toContain(state.applied!.id);
  expect(state.applied!.confidence).toBeGreaterThanOrEqual(CONFIDENT_THRESHOLD);
  return state;
};

describe("industry suggestions", () => {
  it("reads pay as fintech", () => {
    expectTop("pay", ["fintech"]);
  });

  it("reads cloud as cloud infrastructure, with SaaS and developer tools as runners-up", () => {
    const state = expectTop("cloud", ["cloud"]);
    const ids = state.suggestions.map((match) => match.id);
    expect(ids.some((id) => id === "saas" || id === "developer-tools")).toBe(true);
  });

  it("reads ai as AI & machine learning", () => {
    expectTop("ai", ["ai"]);
  });

  it("reads chat as communication", () => {
    expectTop("chat", ["communication"]);
  });

  it("reads secure as security", () => {
    expectTop("secure", ["security"]);
  });

  it("ranks suggestions best-first and caps them", () => {
    const ranked = rankIndustries("cloud");
    expect(ranked.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i]!.confidence).toBeLessThanOrEqual(ranked[i - 1]!.confidence);
    }
    // A confident detection is the only thing that can be applied automatically.
    expect(ranked[0]!.confidence).toBeGreaterThanOrEqual(CONFIDENT_THRESHOLD);
  });

  it("says so, in words, when nothing matched — and does not invent an industry", () => {
    const state = industryStateFor("zzzq", []);
    expect(state.mode).toBe("none");
    expect(state.applied).toBeNull();
    expect(state.summary).toMatch(/general partner words/i);
  });

  it("asks for a root when the field is empty", () => {
    const state = industryStateFor("", []);
    expect(state.mode).toBe("none");
    expect(state.summary).toMatch(/type a root/i);
  });
});

describe("manual override", () => {
  it("uses the chosen industry verbatim, even against the root's own vocabulary", () => {
    const auto = industryStateFor("pay", []);
    const manual = industryStateFor("pay", ["health"]);
    expect(auto.applied!.id).toBe("fintech");
    expect(manual.mode).toBe("override");
    expect(manual.applied!.id).toBe("health");
    // The detection is still shown, so the user can see what they are overriding.
    expect(manual.suggestions.map((match) => match.id)).toContain("fintech");
    expect(manual.summary).toContain("your selection");
  });

  it("falls back to auto for an id that no longer exists", () => {
    const state = industryStateFor("pay", ["not-an-industry"]);
    expect(state.mode).toBe("auto");
    expect(state.applied!.id).toBe("fintech");
  });

  it("changes the vocabulary that is actually generated", () => {
    const common = {
      roots: ["pay"],
      partnerLengths: [3, 4, 5],
      targetCount: 60,
      seed: 11,
    };
    const health = generate(createGenerationRequest({ ...common, industries: ["health"] }));
    const fintech = generate(createGenerationRequest({ ...common, industries: ["fintech"] }));

    expect(health.candidates.every((candidate) => candidate.industries.includes("health"))).toBe(true);
    expect(fintech.candidates.every((candidate) => candidate.industries.includes("fintech"))).toBe(true);
    const healthWords = new Set(health.candidates.map((candidate) => candidate.partner));
    const fintechWords = new Set(fintech.candidates.map((candidate) => candidate.partner));
    // The two pools are different vocabularies, not the same list relabelled.
    expect([...healthWords].filter((word) => fintechWords.has(word)).length).toBeLessThan(
      healthWords.size,
    );
  });

  it("keeps the manual choice out of an automatic run and vice versa", () => {
    const automatic = generate(
      createGenerationRequest({ roots: ["cloud"], partnerLengths: [4, 5], targetCount: 40, seed: 3 }),
    );
    expect(automatic.candidates[0]?.industries).toContain("cloud");

    const forced = generate(
      createGenerationRequest({
        roots: ["cloud"],
        industries: ["gaming"],
        partnerLengths: [4, 5],
        targetCount: 40,
        seed: 3,
      }),
    );
    expect(forced.candidates.every((candidate) => candidate.industries.includes("gaming"))).toBe(true);
  });
});
