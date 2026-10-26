/**
 * Generation pipeline.
 *
 *   normalise roots → semantic profiles → strategies → constraint filter → de-duplicate
 *   → score → rank → slice to the requested count
 *
 * The pipeline is bounded three ways so a browser tab can never lock up: a hard attempt
 * cap, a wall-clock budget, and a server-side target cap. When it cannot reach the
 * requested count it says so — with the reasons — instead of padding the list.
 */

import { SANE_LIMITS, checkCandidate, normalizeConstraints, respectsPosition } from "./constraints";
import {
  directCombinations,
  externalCandidates,
  inventedNames,
  phraseTemplates,
  portmanteaus,
  semanticCombinations,
  type RawCandidate,
} from "./generate";
import { dedupeKey, normalizeKeyword, normalizeTld } from "./normalize";
import { createRng } from "./rng";
import { scoreCandidate, type ScoredCandidate } from "./score";
import { buildSemanticProfile } from "./semantics";
import { DEFAULT_QUALITY_PROFILE, DEFAULT_BRANDABILITY_PROFILE } from "./scoring-profiles";
import {
  ENGINE_VERSION,
  type Candidate,
  type CandidateStrategy,
  type GenerationRequest,
  type GenerationResult,
  type GenerationConstraints,
} from "./types";

const DEFAULT_MAX_ATTEMPTS = 60_000;
const DEFAULT_BUDGET_MS = 2_500;

export type GenerationOptions = {
  /** Names supplied by an external source (AI provider, import). Still fully validated. */
  externalNames?: string[];
  /** Overrides for tests / API callers. */
  now?: () => number;
};

export function createGenerationRequest(partial: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    roots: partial.roots ?? [],
    position: partial.position ?? "both",
    styles: partial.styles ?? ["standard", "keyword-industry", "compound"],
    grammar: partial.grammar ?? "recognized",
    industries: partial.industries ?? [],
    expandIndustries: partial.expandIndustries ?? true,
    customPrefixes: partial.customPrefixes ?? [],
    customSuffixes: partial.customSuffixes ?? [],
    prefixLibraries: partial.prefixLibraries ?? ["modern", "tech"],
    suffixLibraries: partial.suffixLibraries ?? ["generic", "descriptive"],
    autoExpand: partial.autoExpand ?? true,
    targetCount: clampTarget(partial.targetCount ?? 100),
    constraints: normalizeConstraints(partial.constraints),
    brandable: partial.brandable ?? false,
    brandableProfiles: partial.brandableProfiles ?? ["startup"],
    tlds: (partial.tlds ?? ["com"]).map((tld) => normalizeTld(tld)).filter((tld): tld is string => Boolean(tld)),
    seed: partial.seed ?? 1,
    maxAttempts: partial.maxAttempts,
    budgetMs: partial.budgetMs,
  };
}

function clampTarget(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(SANE_LIMITS.maxTarget, Math.max(1, Math.round(value)));
}

type RejectionCounts = Map<string, number>;

export function generate(request: GenerationRequest, options: GenerationOptions = {}): GenerationResult {
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  const budgetMs = request.budgetMs ?? DEFAULT_BUDGET_MS;
  const maxAttempts = Math.min(request.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS * 4);

  const constraints: GenerationConstraints = normalizeConstraints(request.constraints);
  const target = clampTarget(request.targetCount);
  const reasons: string[] = [];
  const rejections: RejectionCounts = new Map();
  const strategiesRun = new Set<CandidateStrategy>();

  const normalizedRoots = request.roots
    .map((root) => normalizeKeyword(root))
    .filter((keyword) => keyword.valid && keyword.ascii.length > 0);

  if (normalizedRoots.length === 0) {
    return {
      candidates: [],
      diagnostics: {
        requested: target,
        produced: 0,
        considered: 0,
        rejectedByConstraint: 0,
        duplicatesRemoved: 0,
        exhausted: true,
        reasons: ["No valid root keyword was supplied."],
        elapsedMs: 0,
        spaceEstimate: 0,
        strategiesRun: [],
        seed: request.seed,
        engineVersion: ENGINE_VERSION,
      },
    };
  }

  if (request.roots.length > normalizedRoots.length) {
    reasons.push(
      `${request.roots.length - normalizedRoots.length} keyword(s) were ignored because they are not usable domain labels.`,
    );
  }

  // ---- 1. gather raw candidates, grouped by strategy -----------------------
  const byStrategy = new Map<CandidateStrategy, RawCandidate[]>();
  let attempts = 0;
  let spaceEstimate = 0;
  let budgetHit = false;

  const collect = (items: RawCandidate[]) => {
    for (const item of items) {
      attempts += 1;
      spaceEstimate += 1;
      if (attempts > maxAttempts) return;
      const bucket = byStrategy.get(item.strategy) ?? [];
      bucket.push(item);
      byStrategy.set(item.strategy, bucket);
      strategiesRun.add(item.strategy);
    }
  };

  for (const keyword of normalizedRoots) {
    if (budgetHit) break;
    const root = keyword.ascii;
    const rng = createRng(`${request.seed}:${root}:${request.styles.join(",")}`);
    const profile = buildSemanticProfile(root, {
      industries: request.industries,
      expandIndustries: request.expandIndustries,
      limit: 160,
    });

    collect(directCombinations(root, request, rng));
    if (now() - startedAt > budgetMs) {
      budgetHit = true;
      break;
    }

    collect(semanticCombinations(root, profile, request));
    collect(phraseTemplates(root, profile, request));
    collect(portmanteaus(root, profile, request, rng));
    collect(inventedNames(root, request, rng));

    if (options.externalNames && options.externalNames.length > 0) {
      collect(externalCandidates(options.externalNames, root, request));
    }

    if (now() - startedAt > budgetMs) {
      budgetHit = true;
      break;
    }
  }

  // ---- 2. constraint filter ----------------------------------------------
  const seen = new Set<string>();
  const valid: RawCandidate[] = [];
  let rejectedByConstraint = 0;
  let duplicatesRemoved = 0;

  const interleaved = interleave(byStrategy);
  for (const candidate of interleaved) {
    if (!respectsPosition(candidate.label, candidate.root, request.position)) {
      rejectedByConstraint += 1;
      rejections.set("position", (rejections.get("position") ?? 0) + 1);
      continue;
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

  // ---- 3. score (bounded) -------------------------------------------------
  // Scoring is the expensive step; cap it but keep representation from every strategy.
  const scoreLimit = Math.min(valid.length, Math.max(target * 10, 1200));
  const toScore = valid.slice(0, scoreLimit);

  const scored: Array<{ raw: RawCandidate; scored: ScoredCandidate }> = [];
  for (const raw of toScore) {
    if (now() - startedAt > budgetMs * 3) {
      budgetHit = true;
      break;
    }
    const profileForRoot = buildSemanticProfile(raw.root, {
      industries: request.industries,
      expandIndustries: false,
      limit: 1,
    });
    const industries =
      request.industries.length > 0
        ? request.industries
        : profileForRoot.industries.slice(0, 3).map((match) => match.id);

    const result = scoreCandidate({
      label: raw.label,
      root: raw.root,
      components: raw.components,
      strategy: raw.strategy,
      industries,
      styles: raw.styles,
      constraints,
      brandableProfiles: request.brandableProfiles,
      qualityProfile: DEFAULT_QUALITY_PROFILE,
      brandabilityProfile: DEFAULT_BRANDABILITY_PROFILE,
    });
    scored.push({ raw, scored: result });
  }

  // ---- 4. rank ------------------------------------------------------------
  const ranked = request.brandable
    ? [...scored].sort(
        (a, b) =>
          b.scored.brandability.score - a.scored.brandability.score ||
          b.scored.quality.score - a.scored.quality.score ||
          a.raw.label.localeCompare(b.raw.label),
      )
    : [...scored].sort(
        (a, b) =>
          b.scored.overall - a.scored.overall ||
          a.raw.label.length - b.raw.label.length ||
          a.raw.label.localeCompare(b.raw.label),
      );

  const selected = diversify(ranked, target);

  const tlds = request.tlds.length > 0 ? request.tlds : ["com"];
  const candidates: Candidate[] = selected.map(({ raw, scored: result }) => {
    const industries =
      request.industries.length > 0
        ? request.industries
        : buildSemanticProfile(raw.root, { industries: [], expandIndustries: false, limit: 1 })
            .industries.slice(0, 3)
            .map((match) => match.id);
    return {
      label: raw.label,
      displayName: displayForm(raw.components, raw.label),
      root: raw.root,
      components: raw.components,
      strategy: raw.strategy,
      styles: raw.styles,
      industries,
      length: raw.label.length,
      syllables: result.syllables,
      quality: result.quality,
      brandability: result.brandability,
      overall: result.overall,
      domains: tlds.map((tld) => ({ tld, domain: `${raw.label}.${tld}` })),
      preservesRoot: raw.components.includes(raw.root),
      notes: result.notes,
    };
  });

  // ---- 5. diagnostics ----------------------------------------------------
  const exhausted = valid.length <= target && !budgetHit;
  if (candidates.length < target) {
    if (budgetHit) {
      reasons.push(
        `Stopped after the ${Math.round(budgetMs)} ms budget to keep the interface responsive. Narrow the filters or lower the target to search faster.`,
      );
    }
    if (exhausted) {
      reasons.push(
        `The search space produced ${valid.length} unique name${valid.length === 1 ? "" : "s"} that satisfy every active rule; no more combinations remain for this seed.`,
      );
    }
    const topRejection = [...rejections.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topRejection) {
      reasons.push(
        `Most rejected candidates failed the “${describeRule(topRejection[0])}” rule (${topRejection[1]} of ${rejectedByConstraint} rejections).`,
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
      exhausted,
      reasons,
      elapsedMs: Math.max(0, Math.round(now() - startedAt)),
      spaceEstimate,
      strategiesRun: [...strategiesRun],
      seed: request.seed,
      engineVersion: ENGINE_VERSION,
    },
  };
}

/** Round-robin across strategies so a single strategy cannot dominate the sample. */
function interleave(byStrategy: Map<CandidateStrategy, RawCandidate[]>): RawCandidate[] {
  const entries = [...byStrategy.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const output: RawCandidate[] = [];
  let index = 0;
  let remaining = entries.reduce((sum, [, items]) => sum + items.length, 0);
  while (remaining > 0) {
    for (const [, items] of entries) {
      const item = items[index];
      if (item) {
        output.push(item);
        remaining -= 1;
      }
    }
    index += 1;
    if (index > 100_000) break; // defensive bound
  }
  return output;
}

/**
 * Takes `target` items from a ranked list while keeping strategy variety: the list is
 * walked in ranked order, but no strategy may exceed `cap` selections until the others
 * have had their turn.
 */
function diversify<T extends { raw: RawCandidate }>(ranked: T[], target: number): T[] {
  if (ranked.length <= target) return ranked;
  const perStrategyCap = Math.max(3, Math.ceil(target / 4));
  const counts = new Map<string, number>();
  const chosen: T[] = [];
  const overflow: T[] = [];

  for (const item of ranked) {
    if (chosen.length >= target) break;
    const key = item.raw.strategy;
    const used = counts.get(key) ?? 0;
    if (used >= perStrategyCap) {
      overflow.push(item);
      continue;
    }
    counts.set(key, used + 1);
    chosen.push(item);
  }

  for (const item of overflow) {
    if (chosen.length >= target) break;
    chosen.push(item);
  }

  return chosen;
}

function displayForm(components: string[], label: string): string {
  if (components.length <= 1) return label;
  return components
    .map((component, index) => {
      const clean = component.toLowerCase();
      if (index === 0) return clean.charAt(0).toUpperCase() + clean.slice(1);
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
    "word-length": "word length",
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
    position: "keyword position",
  };
  return map[rule] ?? rule;
}
