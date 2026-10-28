/**
 * Versioned scoring configuration.
 *
 * Weights are data, not code: the admin panel writes new profile versions to
 * `scoring_profiles` and every candidate records which profile produced its score, so a
 * ranking change can always be traced back to a specific configuration.
 */

import type { BrandableProfileId } from "./types";

export type ScoringFactorDefinition = {
  key: string;
  label: string;
  weight: number;
  description: string;
};

export type QualityProfile = {
  id: string;
  version: number;
  name: string;
  description: string;
  idealLength: [number, number];
  factors: ScoringFactorDefinition[];
};

export type BrandabilityProfile = {
  id: string;
  version: number;
  name: string;
  description: string;
  idealLength: [number, number];
  factors: ScoringFactorDefinition[];
};

export const QUALITY_PROFILES: QualityProfile[] = [
  {
    id: "quality-default",
    version: 1,
    name: "Balanced quality",
    description:
      "Weights semantic relevance and pronounceability highest, with length and spelling as tie-breakers.",
    idealLength: [5, 9],
    factors: [
      { key: "semantic", label: "Semantic relevance", weight: 0.22, description: "How strongly the label expresses the root keyword." },
      { key: "industry", label: "Industry relevance", weight: 0.1, description: "Use of vocabulary from the matched industries." },
      { key: "wordQuality", label: "Word quality", weight: 0.14, description: "Whether components are recognised words rather than fragments." },
      { key: "pronounceability", label: "Pronounceability", weight: 0.16, description: "Letter patterns that are easy to say aloud." },
      { key: "spelling", label: "Spelling simplicity", weight: 0.12, description: "Likelihood of being typed correctly after hearing it." },
      { key: "lengthFit", label: "Length suitability", weight: 0.12, description: "Distance from the comfortable 5–9 character range." },
      { key: "memorability", label: "Memorability", weight: 0.08, description: "Rhythm, syllable count and recall cues." },
      { key: "ruleFit", label: "Constraint fit", weight: 0.06, description: "How comfortably the name sits inside your active rules." },
    ],
  },
];

export const BRANDABILITY_PROFILES: BrandabilityProfile[] = [
  {
    id: "brandable-default",
    version: 1,
    name: "Balanced brandability",
    description: "Equal weight on pronounceability and memorability, with distinctiveness as a differentiator.",
    idealLength: [4, 8],
    factors: [
      { key: "pronounceability", label: "Pronounceability", weight: 0.2, description: "Can a stranger say it after seeing it once?" },
      { key: "memorability", label: "Memorability", weight: 0.2, description: "Rhythm and recall strength." },
      { key: "spelling", label: "Spelling simplicity", weight: 0.15, description: "No ambiguity when spoken." },
      { key: "distinctiveness", label: "Distinctiveness", weight: 0.15, description: "Not just two common dictionary words." },
      { key: "semantic", label: "Semantic relevance", weight: 0.15, description: "Still connected to what the product does." },
      { key: "lengthFit", label: "Length suitability", weight: 0.1, description: "Brand-length rather than descriptive-length." },
      { key: "profileMatch", label: "Profile match", weight: 0.05, description: "Agreement with the selected brandable profile." },
    ],
  },
];

export type BrandableProfileDefinition = {
  id: BrandableProfileId;
  name: string;
  description: string;
  idealLength: [number, number];
  idealSyllables: [number, number];
};

export const BRANDABLE_PROFILE_DEFINITIONS: BrandableProfileDefinition[] = [
  { id: "short-abstract", name: "Short & abstract", description: "Four to six letters, no literal meaning.", idealLength: [4, 6], idealSyllables: [2, 2] },
  { id: "startup", name: "Startup", description: "Modern, product-ready, easy to say in a pitch.", idealLength: [5, 8], idealSyllables: [2, 3] },
  { id: "professional", name: "Professional & corporate", description: "Restrained and credible for B2B buyers.", idealLength: [6, 10], idealSyllables: [2, 3] },
  { id: "friendly", name: "Friendly & approachable", description: "Warm, human and easy for consumers.", idealLength: [5, 8], idealSyllables: [2, 3] },
  { id: "premium", name: "Premium & sophisticated", description: "Quiet confidence with a longer, smoother sound.", idealLength: [6, 10], idealSyllables: [2, 4] },
  { id: "technology", name: "Technology-oriented", description: "Crisp, engineered, slightly technical.", idealLength: [5, 9], idealSyllables: [2, 3] },
  { id: "fintech", name: "Fintech-oriented", description: "Trustworthy yet modern; money vocabulary helps.", idealLength: [5, 9], idealSyllables: [2, 3] },
  { id: "ai", name: "AI-oriented", description: "Intelligent, forward-looking, comfortable with invented forms.", idealLength: [4, 8], idealSyllables: [2, 3] },
  { id: "developer", name: "Developer-oriented", description: "Short, typeable, no ambiguity on a CLI.", idealLength: [4, 7], idealSyllables: [2, 2] },
  { id: "ecommerce", name: "E-commerce-oriented", description: "Inviting and commercial, explainable at a glance.", idealLength: [5, 9], idealSyllables: [2, 3] },
  { id: "playful", name: "Creative & playful", description: "Unexpected sounds, memorable rhythm.", idealLength: [5, 8], idealSyllables: [2, 3] },
  { id: "root-preserving", name: "Root-preserving brandable", description: "Keeps the keyword fully readable inside the name.", idealLength: [5, 10], idealSyllables: [2, 3] },
  { id: "root-inspired", name: "Root-inspired invented", description: "Keeps only a fragment of the keyword, then invents.", idealLength: [4, 8], idealSyllables: [2, 3] },
];

export const DEFAULT_QUALITY_PROFILE = QUALITY_PROFILES[0] as QualityProfile;
export const DEFAULT_BRANDABILITY_PROFILE = BRANDABILITY_PROFILES[0] as BrandabilityProfile;

export function getBrandableDefinition(id: BrandableProfileId): BrandableProfileDefinition {
  return (
    BRANDABLE_PROFILE_DEFINITIONS.find((profile) => profile.id === id) ??
    (BRANDABLE_PROFILE_DEFINITIONS[1] as BrandableProfileDefinition)
  );
}

/** Validates that a weights object sums to ~1 and contains only known factor keys. */
export function validateWeights(
  weights: Record<string, number>,
  knownKeys: string[],
): { valid: boolean; reason?: string; normalized: Record<string, number> } {
  const entries = Object.entries(weights).filter(([key]) => knownKeys.includes(key));
  if (entries.length === 0) return { valid: false, reason: "No known factor keys supplied.", normalized: {} };
  const total = entries.reduce((sum, [, value]) => sum + (Number.isFinite(value) ? value : 0), 0);
  if (total <= 0) return { valid: false, reason: "Weights must sum to more than zero.", normalized: {} };
  const normalized = Object.fromEntries(entries.map(([key, value]) => [key, value / total]));
  return { valid: true, normalized };
}
