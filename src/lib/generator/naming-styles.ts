/**
 * Naming styles and root analysis, as data the UI can render.
 *
 * The engine speaks in word styles (`standard`, `compound`, …) and a keyword position; the
 * product speaks in naming styles ("root + partner", "shortened or coined"). This module is the
 * translation layer, and it is deliberately a pure function so the mapping can be tested without
 * a browser — the point of the controls is that each one changes what the engine actually does.
 */

import { ALL_KNOWN_WORDS, NEUTRAL_WORDS } from "@/lib/brain/dictionaries/words";
import { countSyllables, normalizeKeyword } from "@/lib/brain/normalize";
import { buildSemanticProfile } from "@/lib/brain/semantics";
import type { KeywordPosition, WordStyle } from "@/lib/brain";

export type NamingStyleId =
  | "root-partner"
  | "partner-root"
  | "prefix-root"
  | "root-suffix"
  | "compound"
  | "shortened";

export type NamingStyle = {
  id: NamingStyleId;
  label: string;
  /** One line shown in the control. */
  description: string;
  /** Concrete example using the current root, filled in by `exampleFor`. */
  example: (root: string) => string;
  engineStyles: WordStyle[];
  /** Directions this style needs; `null` means "whatever the other styles need". */
  direction: "prefix" | "suffix" | null;
};

export const NAMING_STYLES: NamingStyle[] = [
  {
    id: "root-partner",
    label: "Root + partner",
    description: "The root first, a clear English partner after it.",
    example: (root) => `PayNest`,
    engineStyles: ["standard"],
    direction: "suffix",
  },
  {
    id: "partner-root",
    label: "Partner + root",
    description: "The partner first, the root keeping the ending.",
    example: () => `NovaPay`,
    engineStyles: ["standard"],
    direction: "prefix",
  },
  {
    id: "prefix-root",
    label: "Prefix + root",
    description: "A brand modifier in front, from the prefix libraries.",
    example: () => `GoPay`,
    engineStyles: ["keyword-brand-prefix"],
    direction: "prefix",
  },
  {
    id: "root-suffix",
    label: "Root + suffix",
    description: "The root first, a brand suffix after it.",
    example: () => `PayHub`,
    engineStyles: ["keyword-brand-suffix"],
    direction: "suffix",
  },
  {
    id: "compound",
    label: "Compounds",
    description: "Two or three dictionary words around the root.",
    example: () => `PayWave`,
    engineStyles: ["compound", "natural-compound"],
    direction: null,
  },
  {
    id: "shortened",
    label: "Shortened / coined",
    description: "Blends and invented forms that keep the root recognisable.",
    example: () => `Payvo`,
    engineStyles: ["portmanteau", "short-abstract", "invented"],
    direction: null,
  },
];

export const NAMING_STYLE_IDS: NamingStyleId[] = NAMING_STYLES.map((style) => style.id);

/**
 * Naming styles → engine inputs.
 *
 * - every style contributes its word styles;
 * - the direction is the union of the directional styles, or `flexible` when only coinages are
 *   selected (blends sit on either side of the root);
 * - compounds are three parts by definition, so selecting them raises the component limit —
 *   otherwise `checkCandidate` would reject every compound and the control would do nothing.
 */
export function engineForNamingStyles(selected: NamingStyleId[]): {
  styles: WordStyle[];
  position: KeywordPosition;
  maxComponents: number;
} {
  const active = NAMING_STYLES.filter((style) => selected.includes(style.id));
  const styles = Array.from(new Set(active.flatMap((style) => style.engineStyles)));
  const needsPrefix = active.some((style) => style.direction === "prefix");
  const needsSuffix = active.some((style) => style.direction === "suffix");

  const position: KeywordPosition =
    needsPrefix && needsSuffix ? "both" : needsPrefix ? "prefix" : needsSuffix ? "suffix" : "flexible";

  const maxComponents = active.some((style) => style.id === "compound") ? 3 : 2;

  return {
    styles: styles.length > 0 ? styles : ["standard"],
    position,
    maxComponents,
  };
}

/** Which naming styles a root's shape suggests. Deterministic: same root, same advice. */
export function recommendNamingStyles(root: string): { styles: NamingStyleId[]; reason: string } {
  const keyword = normalizeKeyword(root);
  const word = keyword.ascii;
  if (!word) return { styles: [], reason: "Enter a root to see a recommendation." };

  const syllables = countSyllables(word);
  const isDictionaryWord = ALL_KNOWN_WORDS.has(word);
  const chosen: NamingStyleId[] = [];

  if (word.length <= 3) {
    // A short root needs lengthening on both sides; it also leaves room for compounds.
    chosen.push("root-partner", "partner-root", "compound");
    return {
      styles: chosen,
      reason: `“${word}” is only ${word.length} letters, so it needs a partner on either side to become a pronounceable brand.`,
    };
  }

  if (word.length >= 8) {
    // A long root will not survive another full word; shorten or blend it instead.
    chosen.push("shortened", "partner-root");
    return {
      styles: chosen,
      reason: `“${word}” is ${word.length} letters and ${syllables} syllable${syllables === 1 ? "" : "s"}; shortening or blending keeps the result usable as a domain.`,
    };
  }

  chosen.push("root-partner", "partner-root");
  if (isDictionaryWord) chosen.push("compound");
  if (!isDictionaryWord) chosen.push("shortened", "prefix-root");

  return {
    styles: Array.from(new Set(chosen)),
    reason: isDictionaryWord
      ? `“${word}” is a real word, so compounds and partner words around it read naturally.`
      : `“${word}” is not a dictionary word, so it combines best as a coined or prefixed form.`,
  };
}

/** Acronyms the engine recognises as such, even when a library also lists them. */
const KNOWN_ABBREVIATIONS = new Set([
  "ai", "hq", "b2b", "b2c", "saas", "api", "ui", "ux", "crm", "erp", "seo", "nft", "gpt",
  "ml", "vr", "ar", "iot", "hr", "pr", "qa", "it", "db", "os", "cdn", "sql", "css",
]);

export type RootAnalysis = {
  root: string;
  letters: number;
  syllables: number;
  /** `word`, `abbreviation`, `coined` or `phrase` — decided from the dictionaries, not guessed. */
  kind: "word" | "abbreviation" | "coined" | "phrase";
  kindExplanation: string;
  meaning: string;
  synonyms: string[];
  variants: string[];
  industries: Array<{ id: string; name: string; confidence: number }>;
  suitability: string;
};

/**
 * Root analysis panel data.
 *
 * Everything here comes from the engine's own dictionaries — the semantic profile, the known-word
 * set and the syllable counter — so the panel cannot claim a meaning the generator does not use.
 * Where nothing is known it says so instead of inventing an association.
 */
export function analyseRoot(root: string, selectedIndustries: string[] = []): RootAnalysis {
  const keyword = normalizeKeyword(root);
  const word = keyword.ascii;
  const letters = word.length;
  const syllables = countSyllables(word);

  const hasVowel = /[aeiouy]/.test(word);
  const kind: RootAnalysis["kind"] =
    !word
      ? "coined"
      : keyword.valid === false && /[^a-z0-9]/.test(root.trim())
        ? "phrase"
        : // Acronyms are recognised first: "AI" and "HQ" may also appear in a word library, but
          // they are still abbreviations, and calling them dictionary words would mislead.
          KNOWN_ABBREVIATIONS.has(word) || (letters <= 4 && !hasVowel)
          ? "abbreviation"
          : ALL_KNOWN_WORDS.has(word) || NEUTRAL_WORDS.includes(word)
            ? "word"
            : "coined";

  const kindExplanation =
    kind === "word"
      ? "Present in the engine's English dictionaries."
      : kind === "abbreviation"
        ? "Short and vowel-poor, or a recognised acronym (AI, HQ, B2B), so it reads as an abbreviation."
        : kind === "phrase"
          ? "The input contained spaces or punctuation; only the letters are used, concatenated."
          : "Not a dictionary word — the engine treats it as a coined root.";

  if (!word) {
    return {
      root: "",
      letters: 0,
      syllables: 0,
      kind: "coined",
      kindExplanation,
      meaning: "No root entered yet.",
      synonyms: [],
      variants: [],
      industries: [],
      suitability: "Enter a root keyword to see how the engine will treat it.",
    };
  }

  const profile = buildSemanticProfile(word, {
    industries: selectedIndustries,
    expandIndustries: true,
    limit: 12,
  });

  const synonyms = profile.synonyms
    .filter((synonym) => synonym !== word)
    .map((synonym) => synonym.toLowerCase())
    .slice(0, 6);

  const meaning =
    synonyms.length > 0
      ? `Used here in the sense of ${synonyms.slice(0, 3).join(", ")}.`
      : kind === "word"
        ? "A plain English word with no curated semantic link; the engine combines it literally."
        : "No curated meaning; the engine builds around its sound rather than a definition.";

  const variants = rootVariants(word, kind);
  const industries = profile.industries.slice(0, 4).map((match) => ({
    id: match.id,
    name: match.name,
    confidence: Math.round(match.confidence * 100),
  }));

  const suitability =
    letters <= 4
      ? `Short roots (${letters} letters) are the easiest to extend and the hardest to find available; expect heavy competition on .com and consider ${syllables <= 1 ? "two-part combinations" : "a partner word"}.`
      : letters >= 9
        ? `At ${letters} letters “${word}” is already long; pairing it with another word produces names that are hard to type. Shortening it is the safer route.`
        : `${letters} letters and ${syllables} syllable${syllables === 1 ? "" : "s"} — workable with a partner word, and still short enough to type from memory.`;

  return { root: word, letters, syllables, kind, kindExplanation, meaning, synonyms, variants, industries, suitability };
}

/**
 * Deterministic spelling variants of a root.
 *
 * These are *spelling* options, not new names: they exist so a user can search a plausible
 * alternative (double a consonant, drop a vowel) without the generator inventing one silently.
 */
export function rootVariants(word: string, kind: RootAnalysis["kind"] = "coined"): string[] {
  if (!word) return [];
  const variants = new Set<string>();

  // Double the final consonant when it is a single consonant after a short vowel ("pay" → none).
  const last = word.slice(-1);
  const penultimate = word.slice(-2, -1);
  if (/[bdgklmnprstvz]/.test(last) && /[aeiou]/.test(penultimate)) variants.add(`${word}${last}`);

  // Drop a trailing vowel ("pay" → "pa"), keeping at least 2 letters.
  if (/[aeiouy]$/.test(word) && word.length > 3) variants.add(word.slice(0, -1));

  // Close an open ending with a short suffix that is common in brand names.
  for (const suffix of ["ly", "io", "ify"]) {
    if (word.length + suffix.length <= 12) variants.add(`${word}${suffix}`);
  }

  // A recognised abbreviation reads better with its full form, not with added letters.
  if (kind === "abbreviation") {
    variants.add(`${word}hub`);
  }

  variants.delete(word);
  return Array.from(variants).slice(0, 6);
}

/**
 * Reverse-map engine inputs back onto naming-style chips.
 *
 * The chips are derived from the same fields the engine reads, so a link with hand-edited
 * `styles` parameters still highlights the chips it corresponds to.
 */
export function namingStylesInState(state: { styles: WordStyle[]; position: KeywordPosition }): NamingStyleId[] {
  const selected: NamingStyleId[] = [];
  const has = (style: WordStyle) => state.styles.includes(style);
  const prefix = state.position === "prefix" || state.position === "both" || state.position === "flexible";
  const suffix = state.position === "suffix" || state.position === "both" || state.position === "flexible";

  if (has("standard") && suffix) selected.push("root-partner");
  if (has("standard") && prefix) selected.push("partner-root");
  if (has("keyword-brand-prefix") && prefix) selected.push("prefix-root");
  if (has("keyword-brand-suffix") && suffix) selected.push("root-suffix");
  if (has("compound") || has("natural-compound")) selected.push("compound");
  if (has("portmanteau") || has("invented") || has("short-abstract") || has("pseudo-word")) selected.push("shortened");
  return selected;
}
