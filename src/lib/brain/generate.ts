/**
 * Candidate generation strategies.
 *
 * Every generator returns *raw* candidates — labels and their component breakdown — and
 * nothing is scored or shown until it passes `checkCandidate`. Generators are pure and
 * take an explicit RNG so identical requests produce identical output.
 *
 * Included strategies (Section 6.4 of the product spec):
 *   A. direct-combination   – root + curated prefix/suffix libraries
 *   B. semantic-combination – root + industry/semantic vocabulary
 *   C. phrase-template      – root + action / audience / product / concept pools
 *   D. portmanteau          – syllable-boundary blends that keep the root readable
 *   E. invented             – phonetic construction around a root fragment
 *   F. ai-assisted          – *provided externally*, validated by the same pipeline
 */

import { ACTION_WORDS, AUDIENCE_WORDS, INDUSTRIES, PRODUCT_WORDS } from "./dictionaries/industries";
import {
  ALL_PREFIX_WORDS,
  ALL_SUFFIX_WORDS,
  BRAND_SUFFIX_MORPHEMES,
  PHONETIC_CODAS,
  PHONETIC_NUCLEI,
  PHONETIC_ONSETS,
  wordsForPrefixLibraries,
  wordsForSuffixLibraries,
} from "./dictionaries/words";
import { composeInventedWord } from "./phonetics";
import type { Rng } from "./rng";
import type { SemanticProfile } from "./semantics";
import type {
  CandidateStrategy,
  GenerationRequest,
  KeywordPosition,
  WordStyle,
} from "./types";

export type RawCandidate = {
  label: string;
  components: string[];
  root: string;
  strategy: CandidateStrategy;
  styles: WordStyle[];
};

const VOWELS = "aeiou";

function allowsPrefix(position: KeywordPosition): boolean {
  return position === "prefix" || position === "both" || position === "flexible";
}

function allowsSuffix(position: KeywordPosition): boolean {
  return position === "suffix" || position === "both" || position === "flexible";
}

function allowsExact(position: KeywordPosition): boolean {
  return position === "exact" || position === "flexible" || position === "both";
}

function uniqWords(words: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      words
        .filter((word): word is string => Boolean(word))
        .map((word) => word.toLowerCase().replace(/[^a-z0-9]/g, ""))
        .filter((word) => word.length > 0),
    ),
  );
}

/* ------------------------------ A. direct ------------------------------ */

export function directCombinations(
  root: string,
  request: GenerationRequest,
  rng: Rng,
): RawCandidate[] {
  const out: RawCandidate[] = [];
  const styles = request.styles;
  const wantsPrefixStyle =
    styles.includes("standard") ||
    styles.includes("keyword-brand-prefix") ||
    styles.includes("compound");
  const wantsSuffixStyle =
    styles.includes("standard") ||
    styles.includes("keyword-brand-suffix") ||
    styles.includes("compound");

  const libraryPrefixes = request.autoExpand
    ? wordsForPrefixLibraries(request.prefixLibraries.length > 0 ? request.prefixLibraries : ["modern", "tech"])
    : [];
  const librarySuffixes = request.autoExpand
    ? wordsForSuffixLibraries(request.suffixLibraries.length > 0 ? request.suffixLibraries : ["generic", "descriptive"])
    : [];

  const prefixes = uniqWords([...request.customPrefixes, ...libraryPrefixes]);
  const suffixes = uniqWords([...request.customSuffixes, ...librarySuffixes]);

  if (allowsPrefix(positionOf(request)) && wantsPrefixStyle) {
    for (const word of rng.shuffle(prefixes)) {
      out.push({
        label: `${word}${root}`,
        components: [word, root],
        root,
        strategy: "direct-combination",
        styles: styles.filter((style) => style !== "keyword-brand-suffix"),
      });
    }
  }

  if (allowsSuffix(positionOf(request)) && wantsSuffixStyle) {
    for (const word of rng.shuffle(suffixes)) {
      out.push({
        label: `${root}${word}`,
        components: [root, word],
        root,
        strategy: "direct-combination",
        styles: styles.filter((style) => style !== "keyword-brand-prefix"),
      });
    }
  }

  // Keyword-only form (exact root) for short roots that fit the length rules.
  if (allowsExact(positionOf(request)) || styles.includes("exact-combination")) {
    out.push({
      label: root,
      components: [root],
      root,
      strategy: "keyword-only",
      styles: ["exact-combination"],
    });
    // Two-word exact combinations keep the root verbatim and add a short morpheme.
    if (styles.includes("exact-combination")) {
      for (const morpheme of rng.shuffle(BRAND_SUFFIX_MORPHEMES)) {
        out.push({
          label: `${root}${morpheme}`,
          components: [root, morpheme],
          root,
          strategy: "exact-combination",
          styles: ["exact-combination"],
        });
      }
    }
  }

  return out;
}

function positionOf(request: GenerationRequest): KeywordPosition {
  return request.position;
}

/* ----------------------------- B. semantic ----------------------------- */

export function semanticCombinations(
  root: string,
  profile: SemanticProfile,
  request: GenerationRequest,
): RawCandidate[] {
  const out: RawCandidate[] = [];
  const styles = request.styles;
  const wantsSemantic =
    styles.includes("keyword-industry") ||
    styles.includes("natural-compound") ||
    styles.includes("standard") ||
    styles.includes("compound");
  if (!wantsSemantic) return out;

  const terms = profile.relatedTerms.filter((term) => term.source !== "neutral");
  const neutral = profile.relatedTerms.filter((term) => term.source === "neutral");

  const push = (word: string, direction: "prefix" | "suffix") => {
    out.push({
      label: direction === "prefix" ? `${word}${root}` : `${root}${word}`,
      components: direction === "prefix" ? [word, root] : [root, word],
      root,
      strategy: "semantic-combination",
      styles: styles.includes("keyword-industry") ? ["keyword-industry"] : ["natural-compound"],
    });
  };

  for (const term of terms) {
    if (allowsPrefix(positionOf(request))) push(term.word, "prefix");
    if (allowsSuffix(positionOf(request))) push(term.word, "suffix");
  }
  for (const term of neutral) {
    if (allowsPrefix(positionOf(request))) push(term.word, "prefix");
    if (allowsSuffix(positionOf(request))) push(term.word, "suffix");
  }

  return out;
}

/* --------------------------- C. phrase templates ----------------------- */

export function phraseTemplates(
  root: string,
  profile: SemanticProfile,
  request: GenerationRequest,
): RawCandidate[] {
  if (!request.styles.includes("natural-compound")) return [];
  const out: RawCandidate[] = [];
  const industryIds = request.industries.length > 0
    ? request.industries
    : profile.industries.slice(0, 2).map((match) => match.id);

  const pools: Array<{ words: string[]; direction: "prefix" | "suffix" }> = [
    { words: ACTION_WORDS, direction: "suffix" },
    { words: AUDIENCE_WORDS, direction: "suffix" },
    { words: PRODUCT_WORDS, direction: "suffix" },
  ];

  for (const industry of INDUSTRIES) {
    if (!industryIds.includes(industry.id)) continue;
    pools.push({ words: industry.relatedTerms.slice(0, 12), direction: "prefix" });
    pools.push({ words: industry.prefixes, direction: "prefix" });
    pools.push({ words: industry.suffixes, direction: "suffix" });
  }

  for (const pool of pools) {
    const permitted = pool.direction === "prefix" ? allowsPrefix(positionOf(request)) : allowsSuffix(positionOf(request));
    if (!permitted) continue;
    for (const word of pool.words) {
      const clean = word.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!clean) continue;
      out.push({
        label: pool.direction === "prefix" ? `${clean}${root}` : `${root}${clean}`,
        components: pool.direction === "prefix" ? [clean, root] : [root, clean],
        root,
        strategy: "phrase-template",
        styles: ["natural-compound"],
      });
    }
  }

  return out;
}

/* ---------------------------- D. portmanteau --------------------------- */

/** Cuts a word after its first vowel-group + following consonant (CVC boundary). */
function headAtSyllableBoundary(word: string, syllables = 1): string {
  let groupsSeen = 0;
  let index = 0;
  while (index < word.length) {
    const char = word[index] ?? "";
    if (VOWELS.includes(char)) {
      groupsSeen += 1;
      // consume the vowel group
      while (index < word.length && VOWELS.includes(word[index] ?? "")) index += 1;
      // consume one trailing consonant so the head ends on a closed syllable
      if (index < word.length && !VOWELS.includes(word[index] ?? "")) index += 1;
      if (groupsSeen >= syllables) return word.slice(0, index);
    } else {
      index += 1;
    }
  }
  return word;
}

/** Returns the final syllable of a word, starting at its last vowel group. */
function tailFromLastSyllable(word: string): string {
  for (let index = word.length - 1; index >= 0; index -= 1) {
    const char = word[index] ?? "";
    const previous = word[index - 1] ?? "";
    if (VOWELS.includes(char) && !VOWELS.includes(previous)) {
      return word.slice(index, Math.min(word.length, index + 5));
    }
  }
  return word.slice(-4);
}

export function portmanteaus(
  root: string,
  profile: SemanticProfile,
  request: GenerationRequest,
  rng: Rng,
): RawCandidate[] {
  if (!request.styles.includes("portmanteau")) return [];
  const out: RawCandidate[] = [];
  const terms = profile.relatedTerms.filter((term) => term.source !== "neutral").slice(0, 40);
  const fallback = ALL_SUFFIX_WORDS.slice(0, 30);
  const pool = terms.length > 0 ? terms.map((term) => term.word) : fallback;

  for (const term of rng.shuffle(pool)) {
    if (term.length < 4 || term === root) continue;

    const termTail = tailFromLastSyllable(term);
    // A single-letter tail ("clouda", "cloudi") reads as truncation, not as a blend.
    if (termTail.length < 2) continue;

    // Keep the root fully readable when the user asked for exact preservation.
    const preserved = `${root}${termTail}`;
    out.push({
      label: preserved,
      components: [root, termTail],
      root,
      strategy: "portmanteau",
      styles: ["portmanteau"],
    });

    if (!request.constraints.preserveExactRoot) {
      const head = headAtSyllableBoundary(term, 1);
      const tail = tailFromLastSyllable(root);
      const blended = `${head}${tail}`;
      if (blended !== term && blended !== root && blended.length >= 4) {
        out.push({
          label: blended,
          components: [head, tail],
          root,
          strategy: "portmanteau",
          styles: ["portmanteau"],
        });
      }
      const rootHead = headAtSyllableBoundary(root, 1);
      const blended2 = `${rootHead}${termTail}`;
      if (blended2 !== blended && blended2 !== root && blended2 !== term && blended2.length >= 4) {
        out.push({
          label: blended2,
          components: [rootHead, termTail],
          root,
          strategy: "portmanteau",
          styles: ["portmanteau"],
        });
      }
    }
  }
  return out;
}

/* ----------------------------- E. invented ----------------------------- */

export function inventedNames(
  root: string,
  request: GenerationRequest,
  rng: Rng,
  count = 120,
): RawCandidate[] {
  const wanted: WordStyle[] = ["invented", "pseudo-word", "short-abstract"];
  if (!request.styles.some((style) => wanted.includes(style))) return [];

  const out: RawCandidate[] = [];
  const preserve = request.constraints.preserveExactRoot;
  // A root fragment that ends on a consonant reads better before a vowel tail.
  const fragment = root.slice(0, Math.min(root.length, root.length >= 5 ? 4 : root.length));

  for (let index = 0; index < count; index += 1) {
    const syllableCount = request.styles.includes("short-abstract") ? 2 : 2 + rng.int(2);
    const invented = composeInventedWord(
      PHONETIC_ONSETS,
      PHONETIC_NUCLEI,
      PHONETIC_CODAS,
      rng,
      { syllables: syllableCount, maxLength: 8 },
    );
    if (invented.length < 3) continue;

    if (preserve) {
      // Root + invented tail, or invented head + root — root stays intact.
      const label = rng.chance(0.5) ? `${root}${invented}` : `${invented}${root}`;
      out.push({
        label,
        components: label.startsWith(root) ? [root, invented] : [invented, root],
        root,
        strategy: request.styles.includes("short-abstract") ? "short-abstract" : "invented",
        styles: request.styles.filter((style) => wanted.includes(style)),
      });
    } else {
      const label = `${fragment}${invented}`;
      out.push({
        label,
        components: [fragment, invented],
        root,
        strategy: request.styles.includes("pseudo-word") ? "pseudo-word" : "invented",
        styles: request.styles.filter((style) => wanted.includes(style)),
      });
    }
  }
  return out;
}

/* --------------------------- AI-provided names -------------------------- */

/**
 * Normalises externally supplied names (an AI provider, an import, an API client) into
 * raw candidates. They are **not trusted**: the caller must pass them through the same
 * `checkCandidate` + scoring pipeline as generated names.
 */
export function externalCandidates(
  names: string[],
  root: string,
  request: GenerationRequest,
): RawCandidate[] {
  if (!request.styles.includes("ai-assisted")) return [];
  return names
    .map((name) => name.toLowerCase().replace(/[^a-z0-9-]/g, ""))
    .filter((name) => name.length >= 2 && name.length <= 40)
    .slice(0, 200)
    .map((label) => ({
      label,
      components: label.includes(root)
        ? label.split(root).filter(Boolean).length > 0
          ? [root, ...label.split(root).filter(Boolean)]
          : [label]
        : [label],
      root,
      strategy: "semantic-combination" as CandidateStrategy,
      styles: ["ai-assisted"] as WordStyle[],
    }));
}

export const GENERATION_STRATEGIES: Array<{ id: CandidateStrategy; label: string; description: string }> = [
  { id: "direct-combination", label: "Direct combination", description: "Root plus curated prefix/suffix library words." },
  { id: "semantic-combination", label: "Semantic combination", description: "Root plus industry and synonym vocabulary." },
  { id: "phrase-template", label: "Phrase templates", description: "Root plus action, audience, product and industry terms." },
  { id: "portmanteau", label: "Portmanteau", description: "Syllable-boundary blends that keep the root readable." },
  { id: "invented", label: "Invented", description: "Phonetic construction around a root fragment." },
  { id: "pseudo-word", label: "Pseudo-word", description: "Pronounceable non-words with vowel/consonant structure." },
  { id: "short-abstract", label: "Short abstract", description: "Four to six letter abstract forms." },
  { id: "exact-combination", label: "Exact keyword", description: "The root verbatim, optionally with a short morpheme." },
  { id: "keyword-only", label: "Keyword only", description: "The bare root keyword as the label." },
];

export { ALL_PREFIX_WORDS, ALL_SUFFIX_WORDS };
