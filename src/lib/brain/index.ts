/**
 * Public entry point for the naming engine.
 *
 * Consumers: the generator UI, the Web Worker, the admin playground, tests, and the
 * optional Edge Function API. Import from `@/lib/brain` rather than deep paths so the
 * module boundary stays stable.
 */

export * from "./types";
export {
  createGenerationRequest,
  generate,
  type GenerationOptions,
} from "./pipeline";
export {
  DEFAULT_CONSTRAINTS,
  LENGTH_PRESETS,
  ABSOLUTE_MAX_LENGTH,
  ABSOLUTE_MIN_LENGTH,
  SANE_LIMITS,
  checkCandidate,
  constraintsForPreset,
  describeConstraints,
  normalizeConstraints,
} from "./constraints";
export {
  countSyllables,
  dedupeKey,
  normalizeKeyword,
  normalizeTld,
  toAscii,
  toPunycode,
  validateLabel,
  vowelRatio,
  longestConsonantCluster,
} from "./normalize";
export { assessPhonetics, pronounceabilityScore, spellingSimplicityScore } from "./phonetics";
export { scoreCandidate, topFactors } from "./score";
export {
  BRANDABLE_PROFILE_DEFINITIONS,
  BRANDABILITY_PROFILES,
  DEFAULT_BRANDABILITY_PROFILE,
  DEFAULT_QUALITY_PROFILE,
  QUALITY_PROFILES,
  getBrandableDefinition,
  validateWeights,
} from "./scoring-profiles";
export { buildSemanticProfile, detectIndustries, explainRoot, semanticRelevance } from "./semantics";
export { INDUSTRIES, getIndustry, ACTION_WORDS, AUDIENCE_WORDS, PRODUCT_WORDS } from "./dictionaries/industries";
export {
  PREFIX_LIBRARIES,
  SUFFIX_LIBRARIES,
  BANNED_FRAGMENTS,
  RESERVED_LABELS,
} from "./dictionaries/words";
export { GENERATION_STRATEGIES } from "./generate";
export { TLD_DIRECTORY, DEFAULT_TLDS, tldRecord, checkabilityLabel } from "./tlds";
export { createRng, hashString } from "./rng";
