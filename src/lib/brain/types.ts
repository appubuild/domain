/**
 * Public contract of the DomainFits naming engine.
 *
 * The engine is pure TypeScript: no React, no DOM APIs, no database, no network.
 * It is imported by the browser UI (including a Web Worker), by tests, and by the
 * optional Supabase Edge Function that exposes a public API. Any change here is a
 * breaking change for those three consumers — keep it additive.
 */

/**
 * Engine generation. Bumped to 2.0.0 when naming styles were removed: a candidate is now always
 * the primary root plus exactly one partner root, in the order the placement scorer chose.
 */
export const ENGINE_VERSION = "2.0.0";

/* ---------------------------------- inputs --------------------------------- */

/**
 * Word order of a generated name.
 *
 * There are exactly two shapes, and no others: the primary root followed by one partner root, or
 * one partner root followed by the primary root. The engine picks the order per partner — the user
 * never chooses a "naming style".
 */
export type PlacementOrder = "root-partner" | "partner-root";

export type BrandableProfileId =
  | "short-abstract"
  | "startup"
  | "professional"
  | "friendly"
  | "premium"
  | "technology"
  | "fintech"
  | "ai"
  | "developer"
  | "ecommerce"
  | "playful"
  | "root-preserving"
  | "root-inspired";

export type LengthPreset =
  | "2-3"
  | "2-4"
  | "3-5"
  | "4-6"
  | "4-8"
  | "9-12"
  | "custom"
  | "any";

/** Every filter the generator can apply. All fields are optional; defaults are documented. */
export type GenerationConstraints = {
  /** Inclusive label length bounds (characters, excluding dot and TLD). */
  minLength: number;
  maxLength: number;
  /** Bounds for the root keyword itself when it appears in the label. */
  minRootLength?: number;
  maxRootLength?: number;
  /** Maximum characters in a single dictionary word component. */
  maxWordLength: number;
  /** Maximum number of word components in the label. */
  maxComponents: number;
  allowHyphens: boolean;
  allowNumbers: boolean;
  /** 0 disables the check. */
  minVowelRatio: number;
  /** 0 disables the check. Longest allowed consonant run inside a label. */
  maxConsonantCluster: number;
  /** 0 disables the check. */
  maxSyllables: number;
  requiredSubstring?: string;
  excludedSubstrings: string[];
  excludedWords: string[];
  /** Inclusive single-character bounds; empty string disables. */
  startsWith?: string;
  endsWith?: string;
  preserveExactRoot: boolean;
  /** Reject labels that merely repeat the root twice (paypay). */
  disallowRepeatedRoot: boolean;
};

export type ScoringWeights = Record<string, number>;

export type GenerationRequest = {
  /** Raw root keywords as typed by the user. The UI enforces exactly one. */
  roots: string[];
  /**
   * Industry ids the request expands from. Empty means "let the engine detect them from the root";
   * a non-empty list is a manual override and is used verbatim.
   */
  industries: string[];
  /** Industry ids whose extra terms are expanded into the partner pool. */
  expandIndustries: boolean;
  /** Partner words the user typed in; they join the pool regardless of the dictionaries. */
  customPartners: string[];
  /** Library ids to draw partner words from; empty means every shipped library. */
  partnerLibraries: string[];
  /**
   * Allowed alphabetic length of the *partner* word — the single component added to the root.
   * 2/3/4/5/6 are the UI's choices; an empty list means "any length".
   *
   * This is a length filter on the partner alone, not on the finished label: a 4-letter partner
   * next to a 3-letter root produces a 7-letter name. The finished length is never a separate
   * control; it is `root.length + partner.length`.
   */
  partnerLengths: number[];
  /** When false, only custom and industry partner words are used (library words are skipped). */
  autoExpand: boolean;
  targetCount: number;
  constraints: GenerationConstraints;
  brandable: boolean;
  brandableProfiles: BrandableProfileId[];
  /** TLDs to attach to each candidate (availability is a separate engine). */
  tlds: string[];
  /** Deterministic seed; the same request + seed always yields the same ordered output. */
  seed: number;
  /** Hard cap on evaluated combinations, protecting the browser from runaway loops. */
  maxAttempts?: number;
  /** Soft wall-clock budget in milliseconds (default 2500 in UI, 20000 in API). */
  budgetMs?: number;
};

/* --------------------------------- outputs -------------------------------- */

/** One strategy remains: root + one partner root. */
export type CandidateStrategy = "partner-combination";

export type Candidate = {
  /** Lower-case domain label without dot/TLD, e.g. `paynest`. */
  label: string;
  /** Readable CamelCase form, e.g. `PayNest`. Display only — never used in a lookup. */
  displayName: string;
  /** Root keyword this candidate was built from. */
  root: string;
  /** The single partner root added to it. */
  partner: string;
  /** Word order the engine chose for this candidate. */
  order: PlacementOrder;
  /** Why that order won, with the score of both orders. */
  placement: {
    scores: Record<PlacementOrder, number>;
    confidence: number;
    reasons: string[];
  };
  /** Components in order, e.g. `["pay","nest"]`. Always exactly two. */
  components: string[];
  strategy: CandidateStrategy;
  /** Matched industry ids (may be empty). */
  industries: string[];
  length: number;
  syllables: number;
  /** 0–100 quality score with component breakdown. */
  quality: ScoreResult;
  /** 0–100 brandability score. */
  brandability: ScoreResult;
  /** Convenience: quality.score * 0.6 + brandability.score * 0.4, rounded. */
  overall: number;
  /** TLD variants, first is the primary suggestion. */
  domains: Array<{ tld: string; domain: string }>;
  /** True when the label preserves the full root as a component. */
  preservesRoot: boolean;
  /** Machine-readable notes surfaced in the details panel. */
  notes: string[];
};

export type ScoreFactor = {
  /** Stable key, e.g. `pronounceability`. */
  key: string;
  /** Human label. */
  label: string;
  /** 0–100 raw factor score. */
  score: number;
  /** Weight used in the final score (normalised to sum to 1). */
  weight: number;
  /** Contribution to the final score (score * weight). */
  contribution: number;
  /** One-line explanation, shown in the UI. */
  explanation: string;
};

export type ScoreResult = {
  /** 0–100, rounded to one decimal. */
  score: number;
  factors: ScoreFactor[];
  /** Version of the scoring profile that produced this result. */
  profileId: string;
  profileVersion: number;
};

export type GenerationDiagnostics = {
  requested: number;
  produced: number;
  /** Distinct candidates evaluated before filtering. */
  considered: number;
  rejectedByConstraint: number;
  duplicatesRemoved: number;
  /** True when the engine stopped because the search space was exhausted. */
  exhausted: boolean;
  /** Human-readable reasons the target was not reached. */
  reasons: string[];
  elapsedMs: number;
  /** Partner words the pool contained, before any validity check. */
  partnerWords: number;
  /** Estimated size of the search space: both orders of every usable partner word. */
  spaceEstimate: number;
  /** How many returned names put the partner first / last. */
  placementSplit: { "root-partner": number; "partner-root": number };
  strategiesRun: CandidateStrategy[];
  seed: number;
  engineVersion: string;
};

export type GenerationResult = {
  candidates: Candidate[];
  diagnostics: GenerationDiagnostics;
};

/** Per-candidate validation used by both generation and the admin playground. */
export type ConstraintViolation = { rule: string; message: string };
