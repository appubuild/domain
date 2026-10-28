/**
 * Shareable generator state ⇄ URL query string.
 *
 * Only the inputs are encoded (never results), so a shared link reproduces the same
 * search deterministically — the seed travels with it. Unknown or invalid values are
 * ignored rather than throwing, so old links keep working.
 */

import {
  DEFAULT_CONSTRAINTS,
  SANE_LIMITS,
  normalizeConstraints,
  normalizeTld,
  type BrandableProfileId,
  type GenerationRequest,
  type KeywordPosition,
  type LengthPreset,
  type WordStyle,
} from "@/lib/brain";
import { createGenerationRequest } from "@/lib/brain/pipeline";

export const VALID_POSITIONS: KeywordPosition[] = ["prefix", "suffix", "both", "exact", "flexible"];

export const VALID_STYLES: WordStyle[] = [
  "standard",
  "natural-compound",
  "keyword-industry",
  "keyword-brand-prefix",
  "keyword-brand-suffix",
  "compound",
  "portmanteau",
  "invented",
  "pseudo-word",
  "short-abstract",
  "exact-combination",
  "ai-assisted",
];

export const VALID_TARGETS = [25, 50, 100, 250, 500, 1000] as const;

export type GeneratorUrlState = {
  request: GenerationRequest;
  /** Optional preset id so the form can show which length chip is active. */
  lengthPreset: LengthPreset;
};

function list(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function requestFromSearchParams(search: URLSearchParams): GeneratorUrlState {
  const roots = list(search.get("q")).slice(0, SANE_LIMITS.maxRoots);
  const positionParam = search.get("pos");
  const position = VALID_POSITIONS.includes(positionParam as KeywordPosition)
    ? (positionParam as KeywordPosition)
    : "both";

  const stylesParam = list(search.get("styles"));
  const styles = stylesParam.length
    ? (stylesParam.filter((style) => VALID_STYLES.includes(style as WordStyle)) as WordStyle[])
    : (["standard", "keyword-industry", "compound"] as WordStyle[]);

  const targetParam = Number(search.get("n"));
  const targetCount = VALID_TARGETS.includes(targetParam as (typeof VALID_TARGETS)[number])
    ? targetParam
    : 100;

  const minLength = Number(search.get("min"));
  const maxLength = Number(search.get("max"));
  const presetParam = search.get("len");
  const lengthPreset: LengthPreset =
    presetParam === "any" || presetParam === "custom" || /^\d+-\d+$/.test(presetParam ?? "")
      ? (presetParam as LengthPreset)
      : "custom";

  const tlds = list(search.get("tlds")).map((tld) => normalizeTld(tld)).filter((tld): tld is string => Boolean(tld));

  // Partner lengths travel with the link: they change which names are possible, so a shared
  // search that dropped them would not reproduce the same list.
  const partnerLengths = list(search.get("pl"))
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 2 && value <= 12);
  const maxComponentsParam = Number(search.get("mc"));

  const brandable = search.get("brand") === "1";
  const profiles = list(search.get("prof")).filter((id) =>
    ["short-abstract", "startup", "professional", "friendly", "premium", "technology", "fintech", "ai", "developer", "ecommerce", "playful", "root-preserving", "root-inspired"].includes(id),
  ) as BrandableProfileId[];

  const industries = list(search.get("ind"));
  const seedParam = Number(search.get("seed"));

  const request = createGenerationRequest({
    roots,
    partnerLengths,
    position,
    styles,
    industries,
    targetCount: Number.isFinite(targetCount) ? targetCount : 100,
    seed: Number.isFinite(seedParam) && seedParam > 0 ? Math.floor(seedParam) : 1,
    tlds: tlds.length > 0 ? tlds : ["com"],
    brandable,
    brandableProfiles: profiles.length > 0 ? profiles : ["startup"],
    constraints: normalizeConstraints({
      ...DEFAULT_CONSTRAINTS,
      minLength: Number.isFinite(minLength) && minLength > 0 ? minLength : DEFAULT_CONSTRAINTS.minLength,
      maxLength: Number.isFinite(maxLength) && maxLength > 0 ? maxLength : DEFAULT_CONSTRAINTS.maxLength,
      maxComponents:
        Number.isFinite(maxComponentsParam) && maxComponentsParam >= 1
          ? maxComponentsParam
          : DEFAULT_CONSTRAINTS.maxComponents,
    }),
    expandIndustries: search.get("expand") !== "0",
    autoExpand: search.get("auto") !== "0",
  });

  return { request, lengthPreset };
}

export function searchParamsFromRequest(
  request: GenerationRequest,
  extra: Record<string, string> = {},
): URLSearchParams {
  const params = new URLSearchParams();
  if (request.roots.length > 0) params.set("q", request.roots.join(","));
  if (request.position !== "both") params.set("pos", request.position);
  params.set("styles", request.styles.join(","));
  if (request.industries.length > 0) params.set("ind", request.industries.join(","));
  if (request.partnerLengths.length > 0) params.set("pl", request.partnerLengths.join(","));
  params.set("n", String(request.targetCount));
  params.set("min", String(request.constraints.minLength));
  params.set("max", String(request.constraints.maxLength));
  params.set("mc", String(request.constraints.maxComponents));
  if (request.tlds.length > 0) params.set("tlds", request.tlds.join(","));
  if (request.brandable) {
    params.set("brand", "1");
    params.set("prof", request.brandableProfiles.join(","));
  }
  if (request.seed !== 1) params.set("seed", String(request.seed));
  if (!request.expandIndustries) params.set("expand", "0");
  if (!request.autoExpand) params.set("auto", "0");
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return params;
}
