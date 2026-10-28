/**
 * Root insight: what the engine can honestly say about the word you typed.
 *
 * This survived the naming-style refactor deliberately. The style recommendations could go
 * because the styles no longer exist, but the analysis behind them was real: which dictionary a
 * root comes from, whether it reads as an abbreviation, which industry vocabulary it touches, and
 * what its length costs you. All of it is derived from the engine's own data — the semantic
 * profile, the known-word set, the syllable counter — so the panel cannot claim a meaning the
 * generator does not use. Where nothing is known it says so.
 */

import { ALL_KNOWN_WORDS, NEUTRAL_WORDS } from "@/lib/brain/dictionaries/words";
import { countSyllables, normalizeKeyword } from "@/lib/brain/normalize";
import { buildSemanticProfile } from "@/lib/brain/semantics";

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
 * Panel data for a root.
 *
 * `selectedIndustries` is the manual override, so the industry list shown here matches what the
 * generator would use rather than what detection would have said.
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
        : KNOWN_ABBREVIATIONS.has(word) || (letters <= 4 && !hasVowel)
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

  // Each name is now the root plus exactly one partner, so the length advice is about how much
  // room a partner has left rather than about which style to pick.
  const suitability =
    letters <= 4
      ? `Short roots (${letters} letters) leave the most room for a partner word, and are the hardest to find available; expect heavy competition on .com.`
      : letters >= 9
        ? `At ${letters} letters “${word}” is already long, so a partner word pushes the domain past 13 characters. A shorter root usually produces the more usable list.`
        : `${letters} letters and ${syllables} syllable${syllables === 1 ? "" : "s"} — a two- to five-letter partner keeps the finished name easy to type.`;

  return { root: word, letters, syllables, kind, kindExplanation, meaning, synonyms, variants, industries, suitability };
}

/**
 * Deterministic spelling variants of a root.
 *
 * These are *spelling* options, not names: they exist so a user can search a plausible alternative
 * (double a consonant, drop a vowel) without the generator inventing one silently.
 */
export function rootVariants(word: string, kind: RootAnalysis["kind"] = "coined"): string[] {
  if (!word) return [];
  const variants = new Set<string>();

  const last = word.slice(-1);
  const penultimate = word.slice(-2, -1);
  if (/[bdgklmnprstvz]/.test(last) && /[aeiou]/.test(penultimate)) variants.add(`${word}${last}`);

  if (/[aeiouy]$/.test(word) && word.length > 3) variants.add(word.slice(0, -1));

  for (const suffix of ["ly", "io", "ify"]) {
    if (word.length + suffix.length <= 12) variants.add(`${word}${suffix}`);
  }

  if (kind === "abbreviation") variants.add(`${word}hub`);

  variants.delete(word);
  return Array.from(variants).slice(0, 6);
}
