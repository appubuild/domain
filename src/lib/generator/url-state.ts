/**
 * Shareable generator state ⇄ URL query string.
 *
 * Only the inputs are encoded (never results), so a shared link reproduces the same search
 * deterministically — the seed travels with it. Unknown or invalid values are ignored rather
 * than throwing, so links made before the naming-style refactor still open: `styles`, `pos`,
 * `len`, `min`, `max` and `mc` are simply dropped.
 */

import {
  DEFAULT_CONSTRAINTS,
  SANE_LIMITS,
  normalizeConstraints,
  normalizeTld,
  type BrandableProfileId,
  type GenerationRequest,
} from "@/lib/brain";
import { PARTNER_LENGTH_CHOICES } from "@/lib/brain/partners";
import { createGenerationRequest } from "@/lib/brain/pipeline";

/**
 * Result quantities offered by the interface.
 *
 * These are the *buttons*; the engine accepts any target up to `SANE_LIMITS.maxTarget`, so a
 * shared link with a larger `n` still reproduces its search even though the UI has no chip for
 * it. 1000 stays because a root with a broad partner pool can genuinely reach it; 5000 is the
 * engine ceiling and is not offered as a one-click target.
 */
export const VALID_TARGETS = [25, 50, 100, 250, 500, 1000] as const;

const DEFAULT_TARGET = 100;

export type GeneratorUrlState = {
  request: GenerationRequest;
};

function list(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeTarget(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TARGET;
  return Math.min(SANE_LIMITS.maxTarget, Math.round(value));
}

export function requestFromSearchParams(search: URLSearchParams): GeneratorUrlState {
  const roots = list(search.get("q")).slice(0, SANE_LIMITS.maxRoots);

  // Partner lengths: any length the control offers. An empty list means "any length", which is
  // what an older link without `pl` should now mean — it previously carried a style-based
  // default that no longer exists.
  const partnerLengths = list(search.get("pl"))
    .map((value) => Number(value))
    .filter(
      (value) =>
        Number.isInteger(value) &&
        value >= Math.min(...PARTNER_LENGTH_CHOICES) &&
        value <= Math.max(...PARTNER_LENGTH_CHOICES),
    );

  const tlds = list(search.get("tlds"))
    .map((tld) => normalizeTld(tld))
    .filter((tld): tld is string => Boolean(tld));

  const brandable = search.get("brand") === "1";
  const profiles = list(search.get("prof")).filter((id) =>
    ["short-abstract", "startup", "professional", "friendly", "premium", "technology", "fintech", "ai", "developer", "ecommerce", "playful", "root-preserving", "root-inspired"].includes(id),
  ) as BrandableProfileId[];

  const industries = list(search.get("ind"));
  const seedParam = Number(search.get("seed"));

  const request = createGenerationRequest({
    roots,
    partnerLengths,
    industries,
    targetCount: normalizeTarget(Number(search.get("n"))),
    seed: Number.isFinite(seedParam) && seedParam > 0 ? Math.floor(seedParam) : 1,
    tlds: tlds.length > 0 ? tlds : ["com"],
    brandable,
    brandableProfiles: profiles.length > 0 ? profiles : ["startup"],
    constraints: normalizeConstraints({ ...DEFAULT_CONSTRAINTS }),
    expandIndustries: search.get("expand") !== "0",
    autoExpand: search.get("auto") !== "0",
  });

  return { request };
}

export function searchParamsFromRequest(
  request: GenerationRequest,
  extra: Record<string, string> = {},
): URLSearchParams {
  const params = new URLSearchParams();
  if (request.roots.length > 0) params.set("q", request.roots.join(","));
  if (request.industries.length > 0) params.set("ind", request.industries.join(","));
  if (request.partnerLengths.length > 0) params.set("pl", request.partnerLengths.join(","));
  params.set("n", String(request.targetCount));
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
