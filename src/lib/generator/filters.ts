/**
 * Client-side filtering and sorting for generated candidates.
 *
 * Filtering never mutates the underlying result set: favourites and selections are keyed
 * by label and survive filter changes, which is what Section 10.3 requires.
 */

import type { Candidate, CandidateStrategy } from "@/lib/brain/types";

export type SortKey =
  | "overall"
  | "brandability"
  | "quality"
  | "shortest"
  | "alphabetical"
  | "semantic"
  | "root-match"
  | "recently-checked";

export const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "overall", label: "Best overall" },
  { value: "brandability", label: "Most brandable" },
  { value: "quality", label: "Highest quality" },
  { value: "shortest", label: "Shortest first" },
  { value: "alphabetical", label: "A–Z" },
  { value: "semantic", label: "Semantic relevance" },
  { value: "root-match", label: "Best root match" },
  { value: "recently-checked", label: "Recently checked" },
];

export type AvailabilityStatus =
  | "unchecked"
  | "available_verified"
  | "registered"
  | "unavailable"
  | "premium_or_special_pricing"
  | "unknown"
  | "check_failed"
  | "rate_limited"
  | "unsupported_tld";

export type AvailabilityInfo = {
  status: AvailabilityStatus;
  checkedAt: string | null;
  provider: string | null;
  cached?: boolean;
  confirmed?: boolean;
};

export type ResultFilters = {
  root: string;
  tld: string;
  minLength: number;
  maxLength: number;
  minQuality: number;
  minBrandability: number;
  strategies: CandidateStrategy[];
  availability: AvailabilityStatus[];
  favoritesOnly: boolean;
  excludeHyphens: boolean;
  excludeNumbers: boolean;
  requiredSubstring: string;
  excludedSubstring: string;
  styleFilter: string;
  search: string;
};

export const DEFAULT_FILTERS: ResultFilters = {
  root: "",
  tld: "",
  minLength: 0,
  maxLength: 0,
  minQuality: 0,
  minBrandability: 0,
  strategies: [],
  availability: [],
  favoritesOnly: false,
  excludeHyphens: false,
  excludeNumbers: false,
  requiredSubstring: "",
  excludedSubstring: "",
  styleFilter: "",
  search: "",
};

export type FilterContext = {
  favorites: Set<string>;
  availability: Map<string, AvailabilityInfo>;
};

export type FilterOutcome = {
  visible: Candidate[];
  /** Number of candidates removed by each rule, used to explain empty states. */
  rejectedBy: Record<string, number>;
  total: number;
};

function availabilityFor(
  candidate: Candidate,
  context: FilterContext,
): AvailabilityInfo | undefined {
  return context.availability.get(candidate.label);
}

export function applyFilters(
  candidates: Candidate[],
  filters: ResultFilters,
  sort: SortKey,
  context: FilterContext,
): FilterOutcome {
  const rejectedBy: Record<string, number> = {};
  const reject = (rule: string) => {
    rejectedBy[rule] = (rejectedBy[rule] ?? 0) + 1;
  };

  const search = filters.search.trim().toLowerCase();
  const required = filters.requiredSubstring.trim().toLowerCase();
  const excluded = filters.excludedSubstring.trim().toLowerCase();

  const visible = candidates.filter((candidate) => {
    if (filters.root && candidate.root !== filters.root) {
      reject("root");
      return false;
    }
    if (filters.tld && !candidate.domains.some((entry) => entry.tld === filters.tld)) {
      reject("tld");
      return false;
    }
    if (filters.minLength > 0 && candidate.length < filters.minLength) {
      reject("min-length");
      return false;
    }
    if (filters.maxLength > 0 && candidate.length > filters.maxLength) {
      reject("max-length");
      return false;
    }
    if (filters.minQuality > 0 && candidate.quality.score < filters.minQuality) {
      reject("quality");
      return false;
    }
    if (filters.minBrandability > 0 && candidate.brandability.score < filters.minBrandability) {
      reject("brandability");
      return false;
    }
    if (filters.strategies.length > 0 && !filters.strategies.includes(candidate.strategy)) {
      reject("strategy");
      return false;
    }
    if (filters.styleFilter && !candidate.styles.includes(filters.styleFilter as Candidate["styles"][number])) {
      reject("style");
      return false;
    }
    if (filters.excludeHyphens && candidate.label.includes("-")) {
      reject("hyphens");
      return false;
    }
    if (filters.excludeNumbers && /[0-9]/.test(candidate.label)) {
      reject("numbers");
      return false;
    }
    if (required && !candidate.label.includes(required)) {
      reject("required");
      return false;
    }
    if (excluded && candidate.label.includes(excluded)) {
      reject("excluded");
      return false;
    }
    if (filters.favoritesOnly && !context.favorites.has(candidate.label)) {
      reject("favorites");
      return false;
    }
    if (filters.availability.length > 0) {
      const status = availabilityFor(candidate, context)?.status ?? "unchecked";
      if (!filters.availability.includes(status)) {
        reject("availability");
        return false;
      }
    }
    if (search && !candidate.label.includes(search) && !candidate.displayName.toLowerCase().includes(search)) {
      reject("search");
      return false;
    }
    return true;
  });

  return {
    visible: sortCandidates(visible, sort, context),
    rejectedBy,
    total: candidates.length,
  };
}

export function sortCandidates(
  candidates: Candidate[],
  sort: SortKey,
  context: FilterContext,
): Candidate[] {
  const copy = [...candidates];
  switch (sort) {
    case "brandability":
      return copy.sort((a, b) => b.brandability.score - a.brandability.score || a.label.localeCompare(b.label));
    case "quality":
      return copy.sort((a, b) => b.quality.score - a.quality.score || a.label.localeCompare(b.label));
    case "shortest":
      return copy.sort((a, b) => a.length - b.length || b.overall - a.overall || a.label.localeCompare(b.label));
    case "alphabetical":
      return copy.sort((a, b) => a.label.localeCompare(b.label));
    case "semantic":
      return copy.sort(
        (a, b) => semanticFactor(b) - semanticFactor(a) || b.overall - a.overall,
      );
    case "root-match":
      return copy.sort(
        (a, b) => Number(b.preservesRoot) - Number(a.preservesRoot) || b.overall - a.overall,
      );
    case "recently-checked":
      return copy.sort((a, b) => {
        const aTime = availabilityFor(a, context)?.checkedAt ?? "";
        const bTime = availabilityFor(b, context)?.checkedAt ?? "";
        return bTime.localeCompare(aTime) || b.overall - a.overall;
      });
    case "overall":
    default:
      return copy.sort((a, b) => b.overall - a.overall || a.label.localeCompare(b.label));
  }
}

function semanticFactor(candidate: Candidate): number {
  const factor = candidate.quality.factors.find((item) => item.key === "semantic");
  return factor?.score ?? 0;
}

/** Explains why a filter combination produced nothing. */
export function explainEmptyState(outcome: FilterOutcome): string {
  const entries = Object.entries(outcome.rejectedBy).sort((a, b) => b[1] - a[1]);
  if (outcome.total === 0) return "No names have been generated yet.";
  if (entries.length === 0) return "No candidate matched the active filters.";
  const labels: Record<string, string> = {
    root: "root keyword",
    tld: "extension",
    "min-length": "minimum length",
    "max-length": "maximum length",
    quality: "quality score floor",
    brandability: "brandability floor",
    strategy: "naming strategy",
    style: "naming style",
    hyphens: "hyphen exclusion",
    numbers: "number exclusion",
    required: "required text",
    excluded: "excluded text",
    favorites: "favourites only",
    availability: "availability status",
    search: "text search",
  };
  const [topRule, topCount] = entries[0] ?? ["", 0];
  const second = entries[1];
  const parts = [
    `The “${labels[topRule] ?? topRule}” filter removed ${topCount} of ${outcome.total} names.`,
  ];
  if (second) parts.push(`Next most restrictive: ${labels[second[0]] ?? second[0]} (${second[1]}).`);
  parts.push("Relax those filters or generate again with fewer constraints.");
  return parts.join(" ");
}

export function countActiveFilters(filters: ResultFilters): number {
  let count = 0;
  if (filters.root) count += 1;
  if (filters.tld) count += 1;
  if (filters.minLength > 0) count += 1;
  if (filters.maxLength > 0) count += 1;
  if (filters.minQuality > 0) count += 1;
  if (filters.minBrandability > 0) count += 1;
  if (filters.strategies.length > 0) count += 1;
  if (filters.availability.length > 0) count += 1;
  if (filters.favoritesOnly) count += 1;
  if (filters.excludeHyphens) count += 1;
  if (filters.excludeNumbers) count += 1;
  if (filters.requiredSubstring) count += 1;
  if (filters.excludedSubstring) count += 1;
  if (filters.styleFilter) count += 1;
  if (filters.search) count += 1;
  return count;
}
