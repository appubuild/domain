/**
 * Industry detection for the generator's compact industry control.
 *
 * The engine already detects industries (`detectIndustries` in the brain). This module is the thin
 * layer the interface needs: a ranked, human-readable answer for the *current* root, and the rules
 * for when a manual choice survives.
 *
 * Three states, and the UI must show which one it is in:
 *
 *   auto      nobody chose an industry — the ranked suggestions are used, and the top one is
 *             applied to the generation request.
 *   override  the user picked one. It is used verbatim, including when it disagrees with the
 *             root's own vocabulary, and it is kept until the root changes or the user resets.
 *   none      no confident match and no choice: generation falls back to the general partner
 *             vocabulary. Never presented as a detection.
 *
 * Confidence is the engine's own 0–1 heuristic (curated root table, then keyword overlap, then
 * related-term overlap). It is not a probability and nothing here claims accuracy.
 */

import { INDUSTRIES } from "@/lib/brain/dictionaries/industries";
import { normalizeKeyword } from "@/lib/brain/normalize";
import { detectIndustries, type IndustryMatch } from "@/lib/brain/semantics";

/** Below this, a match is a hint rather than an answer, so the UI must say "not confident". */
export const CONFIDENT_THRESHOLD = 0.5;

export type IndustryMode = "auto" | "override" | "none";

export type IndustryState = {
  mode: IndustryMode;
  /** The industry the request will use, or null when generation is unrestricted. */
  applied: IndustryMatch | null;
  /** Ranked matches for the current root, best first. Empty when nothing matched. */
  suggestions: IndustryMatch[];
  /** What to print under the control. Plain language, no confidence theatre. */
  summary: string;
};

/** Ranked detection for one root. Returns an empty list for an empty or unusable root. */
export function rankIndustries(root: string, limit = 3): IndustryMatch[] {
  const keyword = normalizeKeyword(root);
  if (!keyword.valid || !keyword.ascii) return [];
  return detectIndustries(keyword.ascii).slice(0, Math.max(1, limit));
}

/**
 * Combines a root with the user's choice.
 *
 * `chosen` is the override list from the form: empty means auto. A stale id (an industry that no
 * longer exists) is treated as auto rather than silently filtering everything out.
 */
export function industryStateFor(root: string, chosen: string[]): IndustryState {
  const suggestions = rankIndustries(root);
  const confident = suggestions.filter((match) => match.confidence >= CONFIDENT_THRESHOLD);

  const override = chosen
    .map((id) => INDUSTRIES.find((industry) => industry.id === id))
    .filter((industry): industry is (typeof INDUSTRIES)[number] => Boolean(industry))
    .map((industry, index) => ({
      id: industry.id,
      name: industry.name,
      confidence: 1,
      reason: index === 0 ? "Selected by you." : "Selected by you.",
    }));

  if (override.length > 0) {
    return {
      mode: "override",
      applied: override[0] ?? null,
      suggestions,
      summary: `Using ${override[0]?.name ?? "your choice"} — your selection, not a detection.`,
    };
  }

  if (confident.length > 0) {
    const top = confident[0]!;
    return {
      mode: "auto",
      applied: top,
      suggestions,
      summary: `Detected from “${normalizeKeyword(root).ascii}”: ${top.name}. ${describeReason(top)}`,
    };
  }

  if (suggestions.length > 0) {
    const top = suggestions[0]!;
    return {
      mode: "none",
      applied: null,
      suggestions,
      summary: `No confident match for “${normalizeKeyword(root).ascii}”. Closest is ${top.name}, used only as a hint — generation uses the general vocabulary.`,
    };
  }

  return {
    mode: "none",
    applied: null,
    suggestions: [],
    summary: root
      ? `No industry vocabulary matched “${normalizeKeyword(root).ascii}”, so the general partner words are used.`
      : "Type a root keyword and the matching industry appears here.",
  };
}

function describeReason(match: IndustryMatch): string {
  // The engine's reason already reads as a sentence fragment; keep it, but drop the trailing full
  // stop so it composes with the summary.
  return match.reason.replace(/\.$/, "");
}

/** Up to three example partner words, so the industry chip is not just a label. */
export function industryExamples(industryId: string, limit = 3): string[] {
  const industry = INDUSTRIES.find((item) => item.id === industryId);
  if (!industry) return [];
  return industry.relatedTerms.slice(0, limit);
}
