/**
 * Client-side filtering and sorting for generated candidates.
 *
 * Two rules govern everything here:
 *
 *   1. **Sorting never changes the result set.** It reorders whatever the filters left, so a sort
 *      change cannot make a name appear or disappear.
 *   2. **Filtering never regenerates.** The candidate list is generated once; filters only decide
 *      which of those names are visible, across the whole list rather than the current page.
 *
 * Every comparator ends in a deterministic tie-breaker, so two runs over the same data always
 * produce the same order (the interface shows the same list after a reload).
 *
 * The scores used for sorting are the engine's own quality/brandability figures. They say nothing
 * about availability or market value, and they are never presented as if they did.
 */

import type { Candidate } from "@/lib/brain/types";

export type SortKey =
  | "overall"
  | "overall-asc"
  | "brandability"
  | "brandability-asc"
  | "quality"
  | "quality-asc"
  | "shortest"
  | "longest"
  | "alphabetical"
  | "alphabetical-desc"
  | "semantic"
  | "recently-checked";

export const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "overall", label: "Domain score: high → low" },
  { value: "overall-asc", label: "Domain score: low → high" },
  { value: "brandability", label: "Brandability: high → low" },
  { value: "brandability-asc", label: "Brandability: low → high" },
  { value: "alphabetical", label: "A → Z" },
  { value: "alphabetical-desc", label: "Z → A" },
  { value: "shortest", label: "Shortest → longest" },
  { value: "longest", label: "Longest → shortest" },
  { value: "semantic", label: "Semantic relevance" },
  { value: "quality", label: "Quality: high → low" },
  { value: "quality-asc", label: "Quality: low → high" },
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
  /**
   * Extension filter. A candidate can carry several extensions, so the rule is "keep the name
   * when at least one of its extensions is selected" — the name is not duplicated per extension
   * and its other extensions stay visible in the row.
   */
  tld: string;
  minLength: number;
  maxLength: number;
  /** Domain-score (overall) bounds; 0 disables the bound. */
  minOverall: number;
  maxOverall: number;
  minQuality: number;
  minBrandability: number;
  availability: AvailabilityStatus[];
  favoritesOnly: boolean;
  requiredSubstring: string;
  excludedSubstring: string;
  search: string;
};

export const DEFAULT_FILTERS: ResultFilters = {
  root: "",
  tld: "",
  minLength: 0,
  maxLength: 0,
  minOverall: 0,
  maxOverall: 0,
  minQuality: 0,
  minBrandability: 0,
  availability: [],
  favoritesOnly: false,
  requiredSubstring: "",
  excludedSubstring: "",
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

function availabilityFor(candidate: Candidate, context: FilterContext): AvailabilityInfo | undefined {
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
    if (filters.minOverall > 0 && candidate.overall < filters.minOverall) {
      reject("overall-min");
      return false;
    }
    if (filters.maxOverall > 0 && candidate.overall > filters.maxOverall) {
      reject("overall-max");
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

/** Case-insensitive A→Z with a stable numeric tie-breaker. */
function compareLabels(a: Candidate, b: Candidate): number {
  const left = a.label.toLowerCase();
  const right = b.label.toLowerCase();
  if (left !== right) return left < right ? -1 : 1;
  // Same letters, different length is impossible for equal lowercase strings, but the numeric
  // fallback keeps the order total if two candidates ever collide.
  return a.length - b.length || a.overall - b.overall;
}

function semanticFactor(candidate: Candidate): number {
  const factor = candidate.quality.factors.find((item) => item.key === "semantic");
  return factor?.score ?? 0;
}

export function sortCandidates(
  candidates: Candidate[],
  sort: SortKey,
  context: FilterContext,
): Candidate[] {
  const copy = [...candidates];
  switch (sort) {
    case "brandability":
      return copy.sort(
        (a, b) => b.brandability.score - a.brandability.score || b.overall - a.overall || compareLabels(a, b),
      );
    case "brandability-asc":
      return copy.sort(
        (a, b) => a.brandability.score - b.brandability.score || a.overall - b.overall || compareLabels(a, b),
      );
    case "quality":
      return copy.sort((a, b) => b.quality.score - a.quality.score || b.overall - a.overall || compareLabels(a, b));
    case "quality-asc":
      return copy.sort((a, b) => a.quality.score - b.quality.score || a.overall - b.overall || compareLabels(a, b));
    case "overall-asc":
      return copy.sort((a, b) => a.overall - b.overall || compareLabels(a, b));
    case "shortest":
      // Length of the brand name without its extension: `PayNest` is 7, not `paynest.com`.
      return copy.sort((a, b) => a.label.length - b.label.length || b.overall - a.overall || compareLabels(a, b));
    case "longest":
      return copy.sort((a, b) => b.label.length - a.label.length || b.overall - a.overall || compareLabels(a, b));
    case "alphabetical":
      return copy.sort(compareLabels);
    case "alphabetical-desc":
      return copy.sort((a, b) => -compareLabels(a, b));
    case "semantic":
      return copy.sort((a, b) => semanticFactor(b) - semanticFactor(a) || b.overall - a.overall || compareLabels(a, b));
    case "recently-checked":
      return copy.sort((a, b) => {
        const aTime = availabilityFor(a, context)?.checkedAt ?? "";
        const bTime = availabilityFor(b, context)?.checkedAt ?? "";
        return bTime.localeCompare(aTime) || b.overall - a.overall || compareLabels(a, b);
      });
    case "overall":
    default:
      return copy.sort((a, b) => b.overall - a.overall || compareLabels(a, b));
  }
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
    "overall-min": "minimum domain score",
    "overall-max": "maximum domain score",
    quality: "quality score floor",
    brandability: "brandability floor",
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
  parts.push("Relax those filters or generate again with different rules.");
  return parts.join(" ");
}

export function countActiveFilters(filters: ResultFilters): number {
  let count = 0;
  if (filters.root) count += 1;
  if (filters.tld) count += 1;
  if (filters.minLength > 0) count += 1;
  if (filters.maxLength > 0) count += 1;
  if (filters.minOverall > 0) count += 1;
  if (filters.maxOverall > 0) count += 1;
  if (filters.minQuality > 0) count += 1;
  if (filters.minBrandability > 0) count += 1;
  if (filters.availability.length > 0) count += 1;
  if (filters.favoritesOnly) count += 1;
  if (filters.requiredSubstring) count += 1;
  if (filters.excludedSubstring) count += 1;
  if (filters.search) count += 1;
  return count;
}
