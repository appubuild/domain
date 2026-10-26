import { describe, expect, it } from "vitest";
import {
  countSyllables,
  longestConsonantCluster,
  normalizeKeyword,
  normalizeTld,
  toAscii,
  validateLabel,
  vowelRatio,
} from "@/lib/brain/normalize";

describe("normalizeKeyword", () => {
  it("trims, lower-cases and keeps the raw form", () => {
    const keyword = normalizeKeyword("  Pay  ");
    expect(keyword.valid).toBe(true);
    expect(keyword.raw).toBe("  Pay  ");
    expect(keyword.ascii).toBe("pay");
    expect(keyword.unicode).toBe("pay");
    expect(keyword.hasNonAscii).toBe(false);
  });

  it("strips diacritics for the ASCII label", () => {
    const keyword = normalizeKeyword("Café");
    expect(keyword.valid).toBe(true);
    expect(keyword.ascii).toBe("cafe");
    expect(keyword.hasNonAscii).toBe(true);
  });

  it("rejects symbols and whitespace-only input", () => {
    expect(normalizeKeyword("pay me").valid).toBe(false);
    expect(normalizeKeyword("!!!").valid).toBe(false);
    expect(normalizeKeyword("   ").valid).toBe(false);
  });

  it("rejects too-short and too-long keywords", () => {
    expect(normalizeKeyword("a").valid).toBe(false);
    expect(normalizeKeyword("x".repeat(41)).valid).toBe(false);
    expect(normalizeKeyword("xy").valid).toBe(true);
  });

  it("converts non-Latin scripts into an explicit failure rather than nonsense", () => {
    const keyword = normalizeKeyword("支払");
    expect(keyword.valid).toBe(false);
    expect(keyword.reason).toBeTruthy();
  });
});

describe("toAscii", () => {
  it("transliterates special Latin letters, preserving case", () => {
    expect(toAscii("Straße")).toBe("Strasse");
    expect(toAscii("Ærø")).toBe("Aero");
    expect(toAscii("Łódź")).toBe("Lodz");
    expect(toAscii("Straße").toLowerCase()).toBe("strasse");
  });
});

describe("validateLabel", () => {
  const rules = { minLength: 3, maxLength: 12, allowHyphens: false, allowNumbers: false };

  it("accepts a normal label", () => {
    expect(validateLabel("paynest", rules).valid).toBe(true);
  });

  it("enforces length bounds", () => {
    expect(validateLabel("ab", rules).valid).toBe(false);
    expect(validateLabel("abcdefghijklm", rules).valid).toBe(false);
  });

  it("rejects hyphens and numbers unless enabled", () => {
    expect(validateLabel("pay-nest", rules).valid).toBe(false);
    expect(validateLabel("pay2", rules).valid).toBe(false);
    expect(
      validateLabel("pay-nest", { ...rules, allowHyphens: true }).valid,
    ).toBe(true);
    expect(validateLabel("pay2", { ...rules, allowNumbers: true }).valid).toBe(true);
  });

  it("rejects leading, trailing and doubled hyphens", () => {
    const hyphenated = { ...rules, allowHyphens: true };
    expect(validateLabel("-pay", hyphenated).valid).toBe(false);
    expect(validateLabel("pay-", hyphenated).valid).toBe(false);
    expect(validateLabel("pay--nest", hyphenated).valid).toBe(false);
  });

  it("rejects characters outside the host alphabet", () => {
    expect(validateLabel("pay_nest", rules).valid).toBe(false);
    expect(validateLabel("pay nest", rules).valid).toBe(false);
  });
});

describe("normalizeTld", () => {
  it("accepts plain and dotted extensions", () => {
    expect(normalizeTld("COM")).toBe("com");
    expect(normalizeTld(".io")).toBe("io");
    expect(normalizeTld("xn--p1ai")).toBe("xn--p1ai");
  });

  it("rejects invalid extensions", () => {
    expect(normalizeTld("c0m")).toBeNull();
    expect(normalizeTld("")).toBeNull();
    expect(normalizeTld("toolongtldthatisnotvalid")).toBeNull();
  });
});

describe("phonetic helpers", () => {
  it("estimates syllables", () => {
    expect(countSyllables("pay")).toBe(1);
    expect(countSyllables("nexus")).toBe(2);
    expect(countSyllables("quantumly")).toBe(3);
    expect(countSyllables("")).toBe(0);
  });

  it("measures vowel ratio", () => {
    expect(vowelRatio("aeiou")).toBe(1);
    expect(vowelRatio("bcdfg")).toBe(0);
    expect(vowelRatio("paynest")).toBeCloseTo(0.28, 1);
  });

  it("finds the longest consonant cluster", () => {
    expect(longestConsonantCluster("strike")).toBe(3);
    expect(longestConsonantCluster("paynest")).toBe(2);
    expect(longestConsonantCluster("aeiou")).toBe(0);
  });
});
