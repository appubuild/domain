import { describe, expect, it } from "vitest";
import {
  ABSOLUTE_MAX_LENGTH,
  DEFAULT_CONSTRAINTS,
  checkCandidate,
  constraintsForPreset,
  normalizeConstraints,
} from "@/lib/brain/constraints";

const base = { ...DEFAULT_CONSTRAINTS, minLength: 4, maxLength: 10, preserveExactRoot: true };

describe("normalizeConstraints", () => {
  it("clamps impossible length ranges", () => {
    const result = normalizeConstraints({ minLength: 40, maxLength: 2 });
    expect(result.minLength).toBe(ABSOLUTE_MAX_LENGTH);
    expect(result.maxLength).toBe(ABSOLUTE_MAX_LENGTH);
  });

  it("sanitises excluded fragments", () => {
    const result = normalizeConstraints({ excludedSubstrings: ["  Pay ", "PAY", "!!"] });
    expect(result.excludedSubstrings).toEqual(["pay"]);
  });

  it("caps component count and syllable settings", () => {
    const result = normalizeConstraints({ maxComponents: 99, maxSyllables: 40 });
    expect(result.maxComponents).toBe(4);
    expect(result.maxSyllables).toBe(8);
  });

  it("drops non-numeric weights safely", () => {
    const result = normalizeConstraints({ minVowelRatio: Number.NaN });
    expect(result.minVowelRatio).toBe(0);
  });
});

describe("constraintsForPreset", () => {
  it("applies the named preset", () => {
    expect(constraintsForPreset("4-6")).toMatchObject({ minLength: 4, maxLength: 6 });
    expect(constraintsForPreset("9-12")).toMatchObject({ minLength: 9, maxLength: 12 });
  });

  it("keeps custom values untouched", () => {
    const result = constraintsForPreset("custom", { ...base, minLength: 7, maxLength: 9 });
    expect(result).toMatchObject({ minLength: 7, maxLength: 9 });
  });
});

describe("checkCandidate", () => {
  const run = (label: string, components: string[], root = components[0] ?? label, constraints = base) =>
    checkCandidate({ label, components, root }, constraints);

  it("accepts a valid root-preserving label", () => {
    expect(run("paynest", ["pay", "nest"])).toEqual([]);
  });

  it("rejects labels shorter or longer than the range", () => {
    expect(run("pay", ["pay"]).some((v) => v.rule === "label")).toBe(true);
    expect(run("paymentsolutions", ["pay", "mentsolutions"]).some((v) => v.rule === "label")).toBe(true);
  });

  it("rejects a repeated root", () => {
    const violations = run("paypay", ["pay", "pay"]);
    expect(violations.some((v) => v.rule === "repeated-root")).toBe(true);
  });

  it("requires the root when preservation is on", () => {
    const violations = checkCandidate(
      { label: "nexora", components: ["nex", "ora"], root: "pay" },
      { ...base, minLength: 4, maxLength: 10 },
    );
    expect(violations.some((v) => v.rule === "preserve-root")).toBe(true);
  });

  it("allows invented labels when preservation is off", () => {
    const violations = checkCandidate(
      { label: "nexora", components: ["nex", "ora"], root: "pay" },
      { ...base, preserveExactRoot: false, minLength: 4, maxLength: 10 },
    );
    expect(violations).toEqual([]);
  });

  it("enforces excluded and required substrings", () => {
    expect(run("paynest", ["pay", "nest"]).length).toBe(0);
    expect(
      run("paynest", ["pay", "nest"], "pay", { ...base, excludedSubstrings: ["nest"] }).some(
        (v) => v.rule === "excluded-substring",
      ),
    ).toBe(true);
    expect(
      run("paynest", ["pay", "nest"], "pay", { ...base, requiredSubstring: "hub" }).some(
        (v) => v.rule === "required-substring",
      ),
    ).toBe(true);
  });

  it("enforces excluded words on components, not raw text", () => {
    const violations = run("paynest", ["pay", "nest"], "pay", { ...base, excludedWords: ["nest"] });
    expect(violations.some((v) => v.rule === "excluded-word")).toBe(true);
  });

  it("enforces the consonant-cluster limit", () => {
    const violations = run("paystr", ["pay", "str"], "pay", { ...base, maxConsonantCluster: 2 });
    expect(violations.some((v) => v.rule === "consonant-cluster")).toBe(true);
  });

  it("enforces the vowel-ratio floor", () => {
    const violations = run("paybcd", ["pay", "bcd"], "pay", { ...base, minVowelRatio: 0.4 });
    expect(violations.some((v) => v.rule === "vowel-ratio")).toBe(true);
  });

  it("blocks reserved infrastructure labels", () => {
    expect(run("api", ["api"], "api").some((v) => v.rule === "label" || v.rule === "reserved")).toBe(true);
  });

  it("blocks banned fragments", () => {
    const violations = run("payshit", ["pay", "shit"], "pay");
    expect(violations.some((v) => v.rule === "banned")).toBe(true);
  });

  it("honours start and end character rules", () => {
    const constraints = { ...base, startsWith: "pay", endsWith: "ly" };
    expect(run("paynest", ["pay", "nest"], "pay", constraints).some((v) => v.rule === "ends-with")).toBe(true);
    expect(run("paynestly", ["pay", "nestly"], "pay", constraints)).toEqual([]);
  });

  it("respects the component-count limit", () => {
    const violations = run("paynesthub", ["pay", "nest", "hub"], "pay", { ...base, maxComponents: 2 });
    expect(violations.some((v) => v.rule === "components")).toBe(true);
  });
});
