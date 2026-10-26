/**
 * Pronounceability, spelling and memorability heuristics.
 *
 * These are *heuristics*, documented as such in the UI: they are derived from letter
 * patterns, not from a pronunciation dictionary. They are stable and testable, which is
 * what the ranking engine needs; they are not linguistic research.
 */

import { countSyllables, isVowel, longestConsonantCluster, vowelRatio } from "./normalize";

/** Consonant pairs that are awkward or impossible at the start of an English word. */
const AWKWARD_ONSETS = [
  "bw", "cw", "dl", "dn", "fn", "gc", "gk", "hp", "hr", "jt", "kc", "kg", "km", "kn", "kp",
  "kv", "lb", "lk", "lr", "mb", "mn", "mr", "mt", "mw", "nb", "np", "pn", "ps", "pw", "rb",
  "rk", "rl", "rp", "sb", "sd", "sf", "sg", "sj", "sr", "sx", "sz", "tb", "tk", "tl", "tm",
  "tp", "vb", "vl", "vr", "vw", "wd", "wg", "wk", "wl", "wm", "wp", "wr", "xs", "zb", "zd",
];

/** Endings that read as truncated or un-English. */
const AWKWARD_ENDINGS = ["j", "q", "v", "fj", "gk", "hj", "hq", "kc", "kp", "pk", "qk", "vj", "xb", "xq"];

/** Letter pairs that are hard to type on a QWERTY keyboard in sequence. */
const HARD_TRANSITIONS = ["qwerty", "zx", "xq", "qx", "vz", "zv", "jw", "wj", "qx", "kq"];

export type PhoneticAssessment = {
  /** 0–100 pronounceability estimate. */
  pronounceability: number;
  /** 0–100 spelling simplicity estimate. */
  spellingSimplicity: number;
  /** 0–100 memorability estimate. */
  memorability: number;
  syllables: number;
  reasons: string[];
};

function hasAwkwardOnset(label: string): string | null {
  // Only the first three consonants matter for how a name is spoken.
  const head = label.slice(0, 3);
  return AWKWARD_ONSETS.find((pair) => head.startsWith(pair)) ?? null;
}

export function pronounceabilityScore(label: string): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 100;

  const letters = label.toLowerCase().replace(/[^a-z]/g, "");
  const cluster = longestConsonantCluster(letters);
  const ratio = vowelRatio(letters);
  const syllables = countSyllables(letters);

  if (cluster >= 5) {
    score -= 34;
    reasons.push(`${cluster} consonants in a row`);
  } else if (cluster === 4) {
    score -= 20;
    reasons.push("four-consonant cluster");
  } else if (cluster === 3) {
    score -= 8;
  }

  if (ratio < 0.18) {
    score -= 24;
    reasons.push("very few vowels");
  } else if (ratio < 0.25) {
    score -= 10;
    reasons.push("low vowel share");
  } else if (ratio > 0.62) {
    score -= 12;
    reasons.push("too many vowels in a row");
  }

  const onset = hasAwkwardOnset(letters);
  if (onset) {
    score -= 22;
    reasons.push(`awkward opening “${onset}”`);
  }

  const ending = AWKWARD_ENDINGS.find((suffix) => letters.endsWith(suffix));
  if (ending) {
    score -= 12;
    reasons.push(`awkward ending “${ending}”`);
  }

  const tripleVowel = /(aaa|eee|iii|ooo|uuu)/.test(letters);
  if (tripleVowel) {
    score -= 10;
    reasons.push("three identical vowels");
  }

  const tripleLetter = /(.)\1\1/.test(letters);
  if (tripleLetter) {
    score -= 14;
    reasons.push("repeated letter three times");
  }

  if (syllables >= 5) {
    score -= 14;
    reasons.push(`${syllables} syllables`);
  } else if (syllables === 4) {
    score -= 5;
  }

  if (syllables <= 2 && cluster <= 2 && !onset) {
    score += 4;
    reasons.push("simple syllable shape");
  }

  return { score: clampScore(score), reasons };
}

export function spellingSimplicityScore(label: string): { score: number; reasons: string[] } {
  const letters = label.toLowerCase().replace(/[^a-z0-9]/g, "");
  const reasons: string[] = [];
  let score = 100;

  if (letters.length > 12) {
    score -= 18;
    reasons.push("long to type");
  } else if (letters.length > 10) {
    score -= 8;
  }

  const doubles = letters.match(/(.)\1/g) ?? [];
  if (doubles.length > 0) {
    score -= doubles.length * 6;
    reasons.push(`${doubles.length} doubled letter${doubles.length === 1 ? "" : "s"}`);
  }

  if (letters.includes("-")) {
    score -= 16;
    reasons.push("hyphenated");
  }
  if (/[0-9]/.test(label)) {
    score -= 22;
    reasons.push("contains digits");
  }

  const hard = HARD_TRANSITIONS.find((pair) => letters.includes(pair));
  if (hard) {
    score -= 10;
    reasons.push(`awkward keystroke pair “${hard}”`);
  }

  // "ph" vs "f", "qu" and "x" are legitimate but easier to misspell.
  const ambiguous = (letters.match(/ph|gh|cq|qu|ckx|sph/g) ?? []).length;
  if (ambiguous > 0) {
    score -= ambiguous * 4;
    reasons.push("ambiguous spelling pattern");
  }

  if (letters.length <= 7 && doubles.length === 0) {
    score += 4;
    reasons.push("short and phonetic");
  }

  return { score: clampScore(score), reasons };
}

export function memorabilityScore(label: string): { score: number; reasons: string[] } {
  const letters = label.toLowerCase().replace(/[^a-z]/g, "");
  const reasons: string[] = [];
  const syllables = countSyllables(letters);
  let score = 60;

  if (letters.length <= 6) {
    score += 14;
    reasons.push("short enough to recall after one hearing");
  } else if (letters.length <= 8) {
    score += 9;
  } else if (letters.length > 12) {
    score -= 14;
    reasons.push("long to remember");
  }

  if (syllables === 2 || syllables === 3) {
    score += 12;
    reasons.push(`${syllables} syllables — an easy rhythm`);
  } else if (syllables === 1) {
    score += 4;
  } else if (syllables >= 5) {
    score -= 12;
    reasons.push("rhythm is long");
  }

  // Alliteration and repeated stems help recall.
  const words = splitRoughSyllables(letters);
  if (words.length >= 2) {
    const firsts = words.map((part) => part.charAt(0));
    if (new Set(firsts).size === 1) {
      score += 5;
      reasons.push("alliterative");
    }
  }

  // Distinctive letters make a name easier to distinguish from neighbours.
  const distinctive = (letters.match(/[kvxzjq]/g) ?? []).length;
  if (distinctive >= 1 && distinctive <= 2) {
    score += 4;
  }

  return { score: clampScore(score), reasons };
}

function splitRoughSyllables(word: string): string[] {
  return word.split(/(?=[aeiouy])/).filter((part) => part.length > 0);
}

export function assessPhonetics(label: string): PhoneticAssessment {
  const pro = pronounceabilityScore(label);
  const spell = spellingSimplicityScore(label);
  const mem = memorabilityScore(label);
  return {
    pronounceability: pro.score,
    spellingSimplicity: spell.score,
    memorability: mem.score,
    syllables: countSyllables(label),
    reasons: [...pro.reasons, ...spell.reasons, ...mem.reasons],
  };
}

/**
 * Builds a pronounceable invented word.
 * Pattern: onset + nucleus (+ coda) repeated, honouring the same awkwardness rules that
 * the scorer applies, so generated names are not penalised by the pipeline afterwards.
 */
export function composeInventedWord(
  onsets: readonly string[],
  nuclei: readonly string[],
  codas: readonly string[],
  random: { pick: <T>(items: readonly T[]) => T | undefined; int: (max: number) => number; chance: (p: number) => boolean },
  options: { syllables?: number; maxLength?: number } = {},
): string {
  const targetSyllables = options.syllables ?? 2 + random.int(2);
  const maxLength = options.maxLength ?? 12;
  let word = "";

  for (let index = 0; index < targetSyllables; index += 1) {
    const onset = random.pick(onsets) ?? "b";
    const nucleus = random.pick(nuclei) ?? "a";
    const coda = random.chance(0.55) ? (random.pick(codas) ?? "") : "";
    const candidateChunk = `${onset}${nucleus}${coda}`;
    if (word.length + candidateChunk.length > maxLength) break;
    // Avoid vowel-on-vowel collisions at syllable boundaries ("au" + "ao").
    const lastChar = word.charAt(word.length - 1);
    if (lastChar && isVowel(lastChar) && isVowel(onset.charAt(0) || nucleus.charAt(0))) {
      continue;
    }
    word += candidateChunk;
  }

  return word;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
