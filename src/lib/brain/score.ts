/**
 * The ranking engine.
 *
 * Two independent dimensions are computed for every candidate:
 *   - **quality**: does this name serve the requested keyword and constraints well?
 *   - **brandability**: would this work as a memorable product/company name?
 *
 * They are never merged with availability. A registered domain can score 95; an
 * available domain can score 20. Section 7.3 of the product spec is enforced by keeping
 * availability out of this module entirely.
 *
 * Every factor records its raw score, weight and contribution so the UI can explain a
 * ranking instead of asserting one.
 */

import { INDUSTRIES } from "./dictionaries/industries";
import { ALL_KNOWN_WORDS, containsBannedFragment } from "./dictionaries/words";
import { countSyllables, vowelRatio } from "./normalize";
import { assessPhonetics } from "./phonetics";
import { semanticRelevance } from "./semantics";
import {
  DEFAULT_BRANDABILITY_PROFILE,
  DEFAULT_QUALITY_PROFILE,
  getBrandableDefinition,
  type BrandabilityProfile,
  type BrandableProfileDefinition,
  type QualityProfile,
  type ScoringFactorDefinition,
  validateWeights,
} from "./scoring-profiles";
import { explainRoot } from "./semantics";
import type {
  BrandableProfileId,
  CandidateStrategy,
  GenerationConstraints,
  ScoreFactor,
  ScoreResult,
  WordStyle,
} from "./types";

export type ScoreInput = {
  label: string;
  root: string;
  components: string[];
  strategy: CandidateStrategy;
  industries: string[];
  styles: WordStyle[];
  constraints: GenerationConstraints;
  brandableProfiles: BrandableProfileId[];
  qualityProfile?: QualityProfile;
  brandabilityProfile?: BrandabilityProfile;
};

export type ScoredCandidate = {
  quality: ScoreResult;
  brandability: ScoreResult;
  overall: number;
  syllables: number;
  notes: string[];
};

function lengthFitScore(length: number, ideal: [number, number]): { score: number; explanation: string } {
  const [min, max] = ideal;
  if (length >= min && length <= max) {
    return { score: 100, explanation: `${length} characters sits inside the ideal ${min}–${max} range.` };
  }
  const distance = length < min ? min - length : length - max;
  const score = Math.max(10, 100 - distance * 14);
  return {
    score,
    explanation: `${length} characters is ${distance} outside the ideal ${min}–${max} range.`,
  };
}

function industryRelevance(
  components: string[],
  root: string,
  industryIds: string[],
): { score: number; explanation: string } {
  if (industryIds.length === 0) {
    return { score: 50, explanation: "No industry selected, so industry fit is neutral." };
  }
  const otherComponents = components.filter((component) => component !== root);
  if (otherComponents.length === 0) {
    return { score: 55, explanation: "The root alone carries no industry vocabulary." };
  }
  const vocab = new Set<string>();
  for (const industry of INDUSTRIES) {
    if (!industryIds.includes(industry.id)) continue;
    for (const word of [...industry.relatedTerms, ...industry.keywords, ...industry.prefixes, ...industry.suffixes]) {
      vocab.add(word);
    }
  }
  const hits = otherComponents.filter((component) => vocab.has(component));
  const ratio = hits.length / otherComponents.length;
  return {
    score: Math.round(30 + ratio * 70),
    explanation:
      hits.length > 0
        ? `${hits.join(", ")} ${hits.length === 1 ? "is" : "are"} in the selected industry vocabulary.`
        : "No component comes from the selected industry vocabulary.",
  };
}

function wordQuality(
  components: string[],
  strategy: CandidateStrategy,
): { score: number; explanation: string } {
  if (strategy === "invented" || strategy === "short-abstract" || strategy === "pseudo-word") {
    return {
      score: 72,
      explanation: "Invented form: phonetic rather than dictionary-based.",
    };
  }
  if (strategy === "portmanteau") {
    return { score: 68, explanation: "Blended word: recognisable fragments, not full words." };
  }
  const known = components.filter((component) => ALL_KNOWN_WORDS.has(component));
  const ratio = components.length === 0 ? 0 : known.length / components.length;
  return {
    score: Math.round(35 + ratio * 65),
    explanation: `${known.length} of ${components.length} components are recognised words.`,
  };
}

function distinctivenessScore(
  label: string,
  components: string[],
  strategy: CandidateStrategy,
): { score: number; explanation: string } {
  const invented = strategy === "invented" || strategy === "pseudo-word" || strategy === "short-abstract";
  const blended = strategy === "portmanteau";
  const allCommon = components.every((component) => ALL_KNOWN_WORDS.has(component));

  let score = 45;
  const reasons: string[] = [];

  if (invented) {
    score += 35;
    reasons.push("invented form is unlikely to duplicate an existing word");
  } else if (blended) {
    score += 25;
    reasons.push("blended spelling stands apart from dictionary terms");
  } else if (allCommon) {
    score -= 10;
    reasons.push("made only of common words");
  }

  // Longer labels using unusual letters are more distinctive, but harder to spell.
  const rare = (label.match(/[kjvxzq]/g) ?? []).length;
  if (rare >= 1 && rare <= 3) {
    score += 6;
    reasons.push("contains a distinctive letter");
  }

  if (label.length <= 4) {
    score -= 8;
    reasons.push("very short labels collide with existing names more often");
  }

  return {
    score: clamp(score),
    explanation: reasons.length > 0 ? `${reasons.join("; ")}.` : "Ordinary word combination.",
  };
}

function ruleFitScore(
  label: string,
  constraints: GenerationConstraints,
  syllables: number,
): { score: number; explanation: string } {
  let score = 100;
  const notes: string[] = [];

  const upperMargin = constraints.maxLength - label.length;
  if (upperMargin <= 1) {
    score -= 12;
    notes.push("sits at the maximum length");
  }
  const lowerMargin = label.length - constraints.minLength;
  if (lowerMargin <= 0) {
    score -= 8;
    notes.push("sits at the minimum length");
  }
  if (constraints.maxSyllables > 0 && syllables >= constraints.maxSyllables) {
    score -= 6;
    notes.push("uses the full syllable budget");
  }
  if (vowelRatio(label) < constraints.minVowelRatio + 0.04) {
    score -= 8;
    notes.push("vowel ratio is near the floor");
  }

  return {
    score: clamp(score),
    explanation: notes.length > 0 ? notes.join("; ") : "Comfortably inside every active rule.",
  };
}

function profileMatch(
  label: string,
  components: string[],
  strategy: CandidateStrategy,
  styles: WordStyle[],
  definition: BrandableProfileDefinition,
): { score: number; explanation: string } {
  let score = 55;
  const notes: string[] = [];

  const [minLength, maxLength] = definition.idealLength;
  if (label.length >= minLength && label.length <= maxLength) {
    score += 20;
    notes.push(`fits the ${minLength}–${maxLength} character shape`);
  } else {
    score -= 15;
    notes.push(`outside the ${minLength}–${maxLength} character shape`);
  }

  const syllables = countSyllables(label);
  const [minSyllables, maxSyllables] = definition.idealSyllables;
  if (syllables >= minSyllables && syllables <= maxSyllables) {
    score += 15;
    notes.push(`${syllables} syllables suits the profile`);
  } else {
    score -= 8;
  }

  const styleMatch = styles.some((style) => definition.preferredStyles.includes(style));
  if (styleMatch) {
    score += 10;
    notes.push("style is a preferred fit");
  }

  const isOriginal = strategy === "invented" || strategy === "pseudo-word" || strategy === "short-abstract" || strategy === "portmanteau";
  if (isOriginal && definition.originalityBias > 0.6) {
    score += 8;
    notes.push("originality is rewarded by this profile");
  } else if (!isOriginal && definition.originalityBias < 0.4) {
    score += 6;
    notes.push("literal naming is rewarded by this profile");
  }

  return {
    score: clamp(score),
    explanation: notes.join("; ") || "Neutral for this profile.",
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildFactors(
  definitions: ScoringFactorDefinition[],
  raw: Record<string, { score: number; explanation: string }>,
): { score: number; factors: ScoreFactor[] } {
  const weights = validateWeights(
    Object.fromEntries(definitions.map((definition) => [definition.key, definition.weight])),
    definitions.map((definition) => definition.key),
  ).normalized;

  const factors: ScoreFactor[] = definitions.map((definition) => {
    const value = raw[definition.key] ?? { score: 0, explanation: "Not measured." };
    const weight = weights[definition.key] ?? 0;
    return {
      key: definition.key,
      label: definition.label,
      score: clamp(value.score),
      weight: Number(weight.toFixed(4)),
      contribution: Number((clamp(value.score) * weight).toFixed(2)),
      explanation: value.explanation,
    };
  });

  const total = factors.reduce((sum, factor) => sum + factor.contribution, 0);
  return { score: Number(total.toFixed(1)), factors };
}

function collisionRisk(label: string, strategy: CandidateStrategy): { score: number; explanation: string } {
  // This is NOT a registry lookup. It estimates how likely a name is to already exist
  // based on its shape, and the UI labels it as a heuristic.
  const invented = strategy === "invented" || strategy === "pseudo-word";
  let score = 50;
  if (invented) score -= 20;
  if (label.length <= 5) score += 25;
  else if (label.length <= 7) score += 12;
  if (/^(app|get|the|my|go|pro|hub|lab)/.test(label)) score += 12;
  return {
    score: clamp(score),
    explanation: invented
      ? "Invented spellings are less likely to collide, but this is a shape heuristic only."
      : "Common word shapes collide more often; this is a heuristic, not a registry check.",
  };
}

/** Scores a single candidate. Pure function: same input always yields the same output. */
export function scoreCandidate(input: ScoreInput): ScoredCandidate {
  const qualityProfile = input.qualityProfile ?? DEFAULT_QUALITY_PROFILE;
  const brandabilityProfile = input.brandabilityProfile ?? DEFAULT_BRANDABILITY_PROFILE;
  const phonetics = assessPhonetics(input.label);
  const semantic = semanticRelevance(input.label, input.root, input.industries, input.components);
  const industry = industryRelevance(input.components, input.root, input.industries);
  const words = wordQuality(input.components, input.strategy);
  const distinctive = distinctivenessScore(input.label, input.components, input.strategy);
  const risk = collisionRisk(input.label, input.strategy);
  const definition = getBrandableDefinition(
    input.brandableProfiles[0] ?? ("startup" as BrandableProfileId),
  );

  const qualityLength = lengthFitScore(input.label.length, qualityProfile.idealLength);
  const brandLength = lengthFitScore(input.label.length, brandabilityProfile.idealLength);

  const quality = buildFactors(qualityProfile.factors, {
    semantic: semantic,
    industry,
    wordQuality: words,
    pronounceability: {
      score: phonetics.pronounceability,
      explanation:
        phonetics.reasons.length > 0
          ? `Heuristic: ${phonetics.reasons.slice(0, 3).join("; ")}.`
          : "Heuristic: simple, speakable letter patterns.",
    },
    spelling: {
      score: phonetics.spellingSimplicity,
      explanation:
        phonetics.spellingSimplicity >= 85
          ? "Easy to spell after hearing it once."
          : "Some spelling ambiguity or length penalty applies.",
    },
    lengthFit: qualityLength,
    memorability: {
      score: phonetics.memorability,
      explanation: `${phonetics.syllables} syllable(s); ${phonetics.memorability >= 75 ? "strong" : "moderate"} recall rhythm.`,
    },
    ruleFit: ruleFitScore(input.label, input.constraints, phonetics.syllables),
  });

  const brandability = buildFactors(brandabilityProfile.factors, {
    pronounceability: {
      score: phonetics.pronounceability,
      explanation: `Pronounceability heuristic ${phonetics.pronounceability}/100 from letter patterns.`,
    },
    memorability: {
      score: phonetics.memorability,
      explanation: `Memorability heuristic ${phonetics.memorability}/100.`,
    },
    spelling: {
      score: phonetics.spellingSimplicity,
      explanation: `Spelling simplicity heuristic ${phonetics.spellingSimplicity}/100.`,
    },
    distinctiveness: distinctive,
    semantic: {
      score: semantic.score,
      explanation: semantic.explanation,
    },
    lengthFit: brandLength,
    profileMatch: profileMatch(
      input.label,
      input.components,
      input.strategy,
      input.styles,
      definition,
    ),
  });

  const notes: string[] = [];
  if (containsBannedFragment(input.label)) notes.push("Blocked-fragment match — should have been filtered.");
  if (risk.score >= 70) notes.push("High collision-risk shape (heuristic).");
  if (input.industries.length === 0) {
    const detected = explainRoot(input.root).industries.slice(0, 2);
    if (detected.length > 0) {
      notes.push(`Detected industry: ${detected.map((item) => item.name).join(", ")}.`);
    }
  }

  const overall = Number((quality.score * 0.6 + brandability.score * 0.4).toFixed(1));

  return {
    quality: { score: quality.score, factors: quality.factors, profileId: qualityProfile.id, profileVersion: qualityProfile.version },
    brandability: {
      score: brandability.score,
      factors: brandability.factors,
      profileId: brandabilityProfile.id,
      profileVersion: brandabilityProfile.version,
    },
    overall,
    syllables: phonetics.syllables,
    notes,
  };
}

/** Convenience for tests and the admin playground. */
export function topFactors(result: ScoreResult, count = 3): ScoreFactor[] {
  return [...result.factors]
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, count);
}
