/**
 * Generation pipeline.
 *
 *   normalise root → partner pool → both word orders → naming rules → de-duplicate
 *   → score → rank → take the requested count
 *
 * The shape of a candidate is fixed by `partner-engine.ts`: the primary root plus exactly one
 * partner root. Everything this file does is decide *which* of those are worth returning and in
 * what order.
 *
 * Bounds are deliberate — an attempt cap, a wall-clock budget and a scoring cap — so a browser tab
 * cannot lock up on a large request. When the target cannot be reached the diagnostics say why,
 * with the constraint that is actually the ceiling, instead of padding the list.
 */

import { SANE_LIMITS, checkCandidate, normalizeConstraints } from "./constraints";
import { dedupeKey, normalizeKeyword, normalizeTld } from "./normalize";
import { buildPartnerCandidates, type PartnerCandidate } from "./partner-engine";
import { hashString } from "./rng";
import { scoreCandidate } from "./score";
import { DEFAULT_QUALITY_PROFILE, DEFAULT_BRANDABILITY_PROFILE } from "./scoring-profiles";
import { buildSemanticProfile } from "./semantics";
import {
  ENGINE_VERSION,
  type Candidate,
  type GenerationDiagnostics,
  type GenerationRequest,
  type GenerationResult,
} from "./types";

const DEFAULT_MAX_ATTEMPTS = 60_000;
const DEFAULT_BUDGET_MS = 2_500;

/** How many candidates to score. Scoring is the expensive step, so it is bounded separately. */
const SCORE_FLOOR = 4_000;
const SCORE_PER_TARGET = 8;

export type GenerationOptions = {
  /** Overrides for tests / API callers. */
  now?: () => number;
};

export function createGenerationRequest(partial: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    roots: partial.roots ?? [],
    // Empty means "detect from the root"; the pipeline fills it in per root.
    industries: partial.industries ?? [],
    expandIndustries: partial.expandIndustries ?? true,
    customPartners: partial.customPartners ?? [],
    // Empty means "every library" — a hard-coded subset here silently overrode the caller.
    partnerLibraries: partial.partnerLibraries ?? [],
    partnerLengths: (partial.partnerLengths ?? []).filter(
      (length) => Number.isInteger(length) && length >= 2 && length <= 12,
    ),
    autoExpand: partial.autoExpand ?? true,
    targetCount: clampTarget(partial.targetCount ?? 100),
    constraints: normalizeConstraints(partial.constraints),
    brandable: partial.brandable ?? false,
    brandableProfiles: partial.brandableProfiles ?? ["startup"],
    tlds: (partial.tlds ?? ["com"])
      .map((tld) => normalizeTld(tld))
      .filter((tld): tld is string => Boolean(tld)),
    seed: partial.seed ?? 1,
    maxAttempts: partial.maxAttempts,
    budgetMs: partial.budgetMs,
  };
}

function clampTarget(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(SANE_LIMITS.maxTarget, Math.max(1, Math.round(value)));
}

export function generate(request: GenerationRequest, options: GenerationOptions = {}): GenerationResult {
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  const budgetMs = request.budgetMs ?? DEFAULT_BUDGET_MS;
  const maxAttempts = Math.min(request.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS * 4);

  const constraints = normalizeConstraints(request.constraints);
  const target = clampTarget(request.targetCount);
  const reasons: string[] = [];
  const rejections = new Map<string, number>();
  let budgetHit = false;

  const normalizedRoots = request.roots
    .map((root) => normalizeKeyword(root))
    .filter((keyword) => keyword.valid && keyword.ascii.length > 0);

  if (normalizedRoots.length === 0) {
    return {
      candidates: [],
      diagnostics: emptyDiagnostics(target, request.seed, "No valid root keyword was supplied."),
    };
  }

  if (request.roots.length > normalizedRoots.length) {
    reasons.push(
      `${request.roots.length - normalizedRoots.length} keyword(s) were ignored because they are not usable domain labels.`,
    );
  }

  /**
   * The industries a root expands from.
   *
   * A manual choice wins verbatim; otherwise the top detected sectors are used, so the partner
   * vocabulary matches the root without the user having to pick anything. Computed once per root —
   * scoring needs the same list for every candidate of that root.
   */
  const industriesForRoot = new Map<string, string[]>();
  for (const keyword of normalizedRoots) {
    industriesForRoot.set(
      keyword.ascii,
      request.industries.length > 0
        ? request.industries
        : buildSemanticProfile(keyword.ascii, { industries: [], expandIndustries: false, limit: 3 })
            .industries.slice(0, 3)
            .map((match) => match.id),
    );
  }

  /* ---- 1. candidates: every partner in both orders, then the naming rules ---- */

  const valid: PartnerCandidate[] = [];
  const seen = new Set<string>();
  let duplicatesRemoved = 0;
  let rejectedByConstraint = 0;
  let considered = 0;
  let partnerPool = 0;
  let partnerRuleRejections = 0;

  for (const keyword of normalizedRoots) {
    if (now() - startedAt > budgetMs) {
      budgetHit = true;
      break;
    }
    const root = keyword.ascii;
    const industries = industriesForRoot.get(root) ?? [];

    const built = buildPartnerCandidates(root, {
      ...request,
      industries: request.expandIndustries ? industries : [],
    });
    partnerPool += built.partnerPool;
    partnerRuleRejections += built.rejections.length;
    for (const rejection of built.rejections) {
      rejections.set(rejection.rule, (rejections.get(rejection.rule) ?? 0) + 1);
    }

    for (const candidate of built.candidates) {
      considered += 1;
      if (considered > maxAttempts) {
        budgetHit = true;
        break;
      }
      const violations = checkCandidate(
        { label: candidate.label, components: candidate.components, root: candidate.root },
        constraints,
      );
      if (violations.length > 0) {
        rejectedByConstraint += 1;
        for (const violation of violations) {
          rejections.set(violation.rule, (rejections.get(violation.rule) ?? 0) + 1);
        }
        continue;
      }
      const key = `${candidate.root}:${dedupeKey(candidate.label)}`;
      if (seen.has(key)) {
        duplicatesRemoved += 1;
        continue;
      }
      seen.add(key);
      valid.push(candidate);
    }
  }

  /* ---- 2. score, rank, cut ------------------------------------------------- */

  const scoreLimit = Math.min(valid.length, Math.max(target * SCORE_PER_TARGET, SCORE_FLOOR));
  const scored: Array<{ raw: PartnerCandidate; result: ReturnType<typeof scoreCandidate> }> = [];

  for (const raw of valid.slice(0, scoreLimit)) {
    if (now() - startedAt > budgetMs * 3) {
      budgetHit = true;
      break;
    }
    const result = scoreCandidate({
      label: raw.label,
      root: raw.root,
      components: raw.components,
      strategy: "partner-combination",
      industries: industriesForRoot.get(raw.root) ?? [],
      constraints,
      brandableProfiles: request.brandableProfiles,
      qualityProfile: DEFAULT_QUALITY_PROFILE,
      brandabilityProfile: DEFAULT_BRANDABILITY_PROFILE,
    });
    scored.push({ raw, result });
  }

  // The seed decides the order of names that score identically — a real, reproducible effect and
  // the only thing it does. It never changes which names exist for a given request.
  const tieKey = (candidate: PartnerCandidate): string =>
    `${hashString(`${request.seed}:${candidate.label}`)}:${candidate.label}`;

  const ranked = [...scored].sort((a, b) => {
    if (request.brandable) {
      return (
        b.result.brandability.score - a.result.brandability.score ||
        b.result.quality.score - a.result.quality.score ||
        tieKey(a.raw).localeCompare(tieKey(b.raw))
      );
    }
    return (
      b.result.overall - a.result.overall ||
      a.raw.label.length - b.raw.label.length ||
      tieKey(a.raw).localeCompare(tieKey(b.raw))
    );
  });

  const selected = ranked.slice(0, target);

  const tlds = request.tlds.length > 0 ? request.tlds : ["com"];
  const candidates: Candidate[] = selected.map(({ raw, result }) => ({
    label: raw.label,
    displayName: displayForm(raw.components),
    root: raw.root,
    partner: raw.partner,
    order: raw.order,
    placement: {
      scores: raw.placement.scores,
      confidence: raw.placement.confidence,
      reasons: raw.placement.reasons,
    },
    components: raw.components,
    strategy: "partner-combination",
    industries: industriesForRoot.get(raw.root) ?? [],
    length: raw.label.length,
    syllables: result.syllables,
    quality: result.quality,
    brandability: result.brandability,
    overall: result.overall,
    domains: tlds.map((tld) => ({ tld, domain: `${raw.label}.${tld}` })),
    preservesRoot: true,
    notes: result.notes,
  }));

  /* ---- 3. diagnostics ------------------------------------------------------ */

  const exhaustion = valid.length < target && !budgetHit;
  const placementSplit = candidates.reduce(
    (tally, candidate) => {
      tally[candidate.order] += 1;
      return tally;
    },
    { "root-partner": 0, "partner-root": 0 } as { "root-partner": number; "partner-root": number },
  );

  if (candidates.length < target) {
    if (budgetHit) {
      reasons.push(
        `Stopped after the ${Math.round(budgetMs)} ms budget to keep the interface responsive. Ask for fewer names to search faster.`,
      );
    }
    if (exhaustion) {
      reasons.push(
        `This root and vocabulary can produce at most ${valid.length} unique two-part name${valid.length === 1 ? "" : "s"} under the active rules; no other combination exists.`,
      );
    }
    if (request.partnerLengths.length > 0) {
      const lengths = [...request.partnerLengths].sort((a, b) => a - b);
      reasons.push(
        `Only partner roots of ${lengths.join(", ")} letters are allowed; a partner of another length is excluded before scoring. Add a length to widen the pool.`,
      );
    }
    if (!request.autoExpand) {
      reasons.push(
        "Dictionary partner words are switched off, so only your custom partners and industry vocabulary were available.",
      );
    }
    if (partnerRuleRejections > 0) {
      reasons.push(
        `${partnerRuleRejections} partner word${partnerRuleRejections === 1 ? "" : "s"} were skipped because they repeat the root or are flagged as an awkward pairing.`,
      );
    }
    const topRejection = [...rejections.entries()]
      .filter(([rule]) => !["partner-is-root", "partner-contains-root", "awkward-pair"].includes(rule))
      .sort((a, b) => b[1] - a[1])[0];
    if (topRejection) {
      reasons.push(
        `Most rejected names failed the “${describeRule(topRejection[0])}” rule (${topRejection[1]} of ${rejectedByConstraint} rejections).`,
      );
    }
    if (request.targetCount > SANE_LIMITS.maxTarget) {
      reasons.push(`Targets above ${SANE_LIMITS.maxTarget} are capped by the engine.`);
    }
  }

  return {
    candidates,
    diagnostics: {
      requested: target,
      produced: candidates.length,
      considered: valid.length,
      rejectedByConstraint,
      duplicatesRemoved,
      exhausted: exhaustion,
      reasons,
      elapsedMs: Math.max(0, Math.round(now() - startedAt)),
      partnerWords: partnerPool,
      spaceEstimate: partnerPool * 2,
      placementSplit,
      strategiesRun: ["partner-combination"],
      seed: request.seed,
      engineVersion: ENGINE_VERSION,
    },
  };
}

function emptyDiagnostics(target: number, seed: number, reason: string): GenerationDiagnostics {
  return {
    requested: target,
    produced: 0,
    considered: 0,
    rejectedByConstraint: 0,
    duplicatesRemoved: 0,
    exhausted: true,
    reasons: [reason],
    elapsedMs: 0,
    partnerWords: 0,
    spaceEstimate: 0,
    placementSplit: { "root-partner": 0, "partner-root": 0 },
    strategiesRun: [],
    seed,
    engineVersion: ENGINE_VERSION,
  };
}

/**
 * CamelCase display form: `home` + `land` → `HomeLand`.
 *
 * Display only. The domain label stays lower-case everywhere it is used as a domain — see
 * `Candidate.label` and `Candidate.domains`. Acronyms keep their capitals so `ai` + `labs` reads
 * as `AILabs` rather than `AiLabs`.
 */
const ACRONYMS = new Set(["ai", "hq", "io", "api", "ui", "ux", "ml", "seo", "crm", "nft", "gpt", "vr", "ar", "os", "db"]);

export function displayForm(components: string[]): string {
  return components
    .map((component) => {
      const clean = component.toLowerCase();
      if (ACRONYMS.has(clean)) return clean.toUpperCase();
      return clean.charAt(0).toUpperCase() + clean.slice(1);
    })
    .join("");
}

function describeRule(rule: string): string {
  const map: Record<string, string> = {
    label: "label format",
    reserved: "reserved name",
    banned: "blocked word",
    components: "component count",
    "word-length": "partner length",
    "root-length": "root length",
    "repeated-root": "repeated root",
    "preserve-root": "root preservation",
    "required-substring": "required text",
    "excluded-substring": "excluded text",
    "excluded-word": "excluded word",
    "starts-with": "starting letters",
    "ends-with": "ending letters",
    "vowel-ratio": "vowel ratio",
    "consonant-cluster": "consonant cluster",
    syllables: "syllable count",
    "partner-is-root": "partner equals the root",
    "partner-contains-root": "partner repeats the root",
    "awkward-pair": "awkward pairing",
    "partner-length": "partner length",
  };
  return map[rule] ?? rule;
}
