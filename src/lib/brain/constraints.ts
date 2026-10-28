/**
 * Generation constraints: defaults, presets and the single validation function every
 * generated label must pass before it can be scored or shown.
 *
 * Keeping one implementation means the generator, the admin playground and the API all
 * reject exactly the same candidates — the rules cannot drift between surfaces.
 */

import {
  containsBannedFragment,
  isReservedLabel,
} from "./dictionaries/words";
import {
  countSyllables,
  longestConsonantCluster,
  validateLabel,
  vowelRatio,
} from "./normalize";
import type { ConstraintViolation, GenerationConstraints, LengthPreset } from "./types";

export const LENGTH_PRESETS: Array<{ id: LengthPreset; label: string; min: number; max: number }> = [
  { id: "2-3", label: "2–3", min: 2, max: 3 },
  { id: "2-4", label: "2–4", min: 2, max: 4 },
  { id: "3-5", label: "3–5", min: 3, max: 5 },
  { id: "4-6", label: "4–6", min: 4, max: 6 },
  { id: "4-8", label: "4–8", min: 4, max: 8 },
  { id: "9-12", label: "9–12", min: 9, max: 12 },
  { id: "any", label: "Any", min: 2, max: 24 },
];

export const ABSOLUTE_MIN_LENGTH = 2;
export const ABSOLUTE_MAX_LENGTH = 24;

/**
 * Defaults for a two-part name.
 *
 * `maxLength` is 18 because a name is now always `root + partner`: the longest partner the
 * interface offers is six letters and a long root is twelve, so a lower ceiling would silently
 * reject names the user asked for. There is no total-length control — the finished length is
 * whatever the two chosen parts add up to.
 */
export const DEFAULT_CONSTRAINTS: GenerationConstraints = {
  minLength: 4,
  maxLength: 18,
  maxWordLength: 10,
  maxComponents: 2,
  allowHyphens: false,
  allowNumbers: false,
  minVowelRatio: 0.22,
  maxConsonantCluster: 3,
  maxSyllables: 0,
  excludedSubstrings: [],
  excludedWords: [],
  preserveExactRoot: true,
  disallowRepeatedRoot: true,
};

export const SANE_LIMITS = {
  minLength: ABSOLUTE_MIN_LENGTH,
  maxLength: ABSOLUTE_MAX_LENGTH,
  maxWordLength: 16,
  maxComponents: 4,
  maxTarget: 5000,
  maxRoots: 12,
  maxExcluded: 100,
  maxCustomWords: 200,
} as const;

export function constraintsForPreset(preset: LengthPreset, base = DEFAULT_CONSTRAINTS): GenerationConstraints {
  const match = LENGTH_PRESETS.find((item) => item.id === preset);
  if (!match || preset === "custom") return { ...base };
  return { ...base, minLength: match.min, maxLength: match.max };
}

/** Clamps user-supplied constraints into safe ranges (server-side defence). */
export function normalizeConstraints(input: Partial<GenerationConstraints> | undefined): GenerationConstraints {
  const merged = { ...DEFAULT_CONSTRAINTS, ...(input ?? {}) };
  const minLength = clamp(Math.round(merged.minLength), ABSOLUTE_MIN_LENGTH, ABSOLUTE_MAX_LENGTH);
  const maxLength = clamp(Math.round(merged.maxLength), minLength, ABSOLUTE_MAX_LENGTH);
  return {
    ...merged,
    minLength,
    maxLength,
    maxWordLength: clamp(Math.round(merged.maxWordLength), 2, SANE_LIMITS.maxWordLength),
    maxComponents: clamp(Math.round(merged.maxComponents), 1, SANE_LIMITS.maxComponents),
    minVowelRatio: clamp(merged.minVowelRatio, 0, 0.6),
    maxConsonantCluster: clamp(Math.round(merged.maxConsonantCluster), 0, 6),
    maxSyllables: clamp(Math.round(merged.maxSyllables ?? 0), 0, 8),
    excludedSubstrings: sanitizeList(merged.excludedSubstrings),
    excludedWords: sanitizeList(merged.excludedWords),
    requiredSubstring: merged.requiredSubstring ? normalizeFragment(merged.requiredSubstring) : undefined,
    startsWith: merged.startsWith ? normalizeFragment(merged.startsWith) : undefined,
    endsWith: merged.endsWith ? normalizeFragment(merged.endsWith) : undefined,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function sanitizeList(values: string[] | undefined): string[] {
  if (!values) return [];
  return Array.from(
    new Set(
      values
        .map((value) => normalizeFragment(value))
        .filter((value) => value.length > 0)
        .slice(0, SANE_LIMITS.maxExcluded),
    ),
  );
}

function normalizeFragment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24);
}

export type CandidateShape = {
  label: string;
  components: string[];
  root: string;
};

/**
 * Validates a candidate label against every active constraint.
 * Returns an empty array when the label is acceptable.
 */
export function checkCandidate(
  shape: CandidateShape,
  constraints: GenerationConstraints,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const { label, components, root } = shape;

  if (isReservedLabel(label)) {
    violations.push({ rule: "reserved", message: "Reserved or infrastructure name." });
    return violations;
  }

  const labelCheck = validateLabel(label, {
    minLength: constraints.minLength,
    maxLength: constraints.maxLength,
    allowHyphens: constraints.allowHyphens,
    allowNumbers: constraints.allowNumbers,
  });
  if (!labelCheck.valid && labelCheck.reason) {
    violations.push({ rule: "label", message: labelCheck.reason });
  }

  const banned = containsBannedFragment(label);
  if (banned) {
    violations.push({ rule: "banned", message: `Contains the blocked fragment “${banned}”.` });
  }

  if (components.length > constraints.maxComponents) {
    violations.push({
      rule: "components",
      message: `Uses ${components.length} components; the limit is ${constraints.maxComponents}.`,
    });
  }

  const longComponent = components.find((component) => component.length > constraints.maxWordLength);
  if (longComponent) {
    violations.push({
      rule: "word-length",
      message: `Component “${longComponent}” exceeds ${constraints.maxWordLength} characters.`,
    });
  }

  if (constraints.minRootLength && root.length < constraints.minRootLength) {
    violations.push({ rule: "root-length", message: `Root is shorter than ${constraints.minRootLength}.` });
  }
  if (constraints.maxRootLength && root.length > constraints.maxRootLength) {
    violations.push({ rule: "root-length", message: `Root is longer than ${constraints.maxRootLength}.` });
  }

  if (constraints.disallowRepeatedRoot) {
    const rootOccurrences = components.filter((component) => component === root).length;
    if (rootOccurrences > 1) {
      violations.push({ rule: "repeated-root", message: "Repeats the root keyword." });
    }
  }

  if (constraints.preserveExactRoot && !components.includes(root)) {
    const embedded = label.includes(root);
    if (!embedded) {
      violations.push({ rule: "preserve-root", message: "Does not contain the root keyword." });
    }
  }

  if (constraints.requiredSubstring && !label.includes(constraints.requiredSubstring)) {
    violations.push({
      rule: "required-substring",
      message: `Must contain “${constraints.requiredSubstring}”.`,
    });
  }

  const excludedSubstring = constraints.excludedSubstrings.find((fragment) => label.includes(fragment));
  if (excludedSubstring) {
    violations.push({
      rule: "excluded-substring",
      message: `Contains the excluded text “${excludedSubstring}”.`,
    });
  }

  const excludedWord = constraints.excludedWords.find((word) => components.includes(word));
  if (excludedWord) {
    violations.push({ rule: "excluded-word", message: `Uses the excluded word “${excludedWord}”.` });
  }

  if (constraints.startsWith && !label.startsWith(constraints.startsWith)) {
    violations.push({ rule: "starts-with", message: `Must start with “${constraints.startsWith}”.` });
  }
  if (constraints.endsWith && !label.endsWith(constraints.endsWith)) {
    violations.push({ rule: "ends-with", message: `Must end with “${constraints.endsWith}”.` });
  }

  if (constraints.minVowelRatio > 0 && vowelRatio(label) < constraints.minVowelRatio) {
    violations.push({
      rule: "vowel-ratio",
      message: `Vowel ratio below ${Math.round(constraints.minVowelRatio * 100)}%.`,
    });
  }

  if (constraints.maxConsonantCluster > 0) {
    const cluster = longestConsonantCluster(label);
    if (cluster > constraints.maxConsonantCluster) {
      violations.push({
        rule: "consonant-cluster",
        message: `${cluster} consonants in a row; the limit is ${constraints.maxConsonantCluster}.`,
      });
    }
  }

  if (constraints.maxSyllables > 0) {
    const syllables = countSyllables(label);
    if (syllables > constraints.maxSyllables) {
      violations.push({
        rule: "syllables",
        message: `Estimated ${syllables} syllables; the limit is ${constraints.maxSyllables}.`,
      });
    }
  }

  return violations;
}

/** Human summary of the active constraints, shown in the UI next to results. */
export function describeConstraints(constraints: GenerationConstraints): string[] {
  const parts: string[] = [];
  parts.push(`${constraints.minLength}–${constraints.maxLength} characters`);
  parts.push(`up to ${constraints.maxComponents} components`);
  parts.push(constraints.allowHyphens ? "hyphens allowed" : "no hyphens");
  parts.push(constraints.allowNumbers ? "numbers allowed" : "no numbers");
  if (constraints.minVowelRatio > 0) parts.push(`vowels ≥ ${Math.round(constraints.minVowelRatio * 100)}%`);
  if (constraints.maxConsonantCluster > 0) parts.push(`max ${constraints.maxConsonantCluster} consonants in a row`);
  if (constraints.maxSyllables > 0) parts.push(`max ${constraints.maxSyllables} syllables`);
  if (constraints.requiredSubstring) parts.push(`contains “${constraints.requiredSubstring}”`);
  if (constraints.excludedSubstrings.length > 0) {
    parts.push(`excludes ${constraints.excludedSubstrings.length} fragment(s)`);
  }
  if (constraints.excludedWords.length > 0) parts.push(`excludes ${constraints.excludedWords.length} word(s)`);
  return parts;
}
