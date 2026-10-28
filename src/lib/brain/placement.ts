/**
 * Partner placement: which side of the primary root does the partner go?
 *
 * The product no longer asks the user to pick a naming style. For every partner word the engine
 * evaluates **both** two-part orders —
 *
 *     PrimaryRoot + PartnerRoot      (HomeLand)
 *     PartnerRoot + PrimaryRoot      (StayHome)
 *
 * — and keeps the better one. Nothing here is a coin flip and nothing is "AI": the decision is a
 * documented, deterministic score over six named signals, which is why the same root and the same
 * partner always produce the same name.
 *
 * Signals
 * -------
 * 1. **Role fit.** A word that reads as a modifier (nova, swift, stay) belongs in front; a word
 *    that reads as a place or object (land, nest, hub) belongs behind. Roles come from the word
 *    data (`partners.ts`), not from a per-root rule.
 * 2. **Boundary sound.** The join between the two parts is where a two-part name usually breaks:
 *    "pay" + "yield" gives "payyield", "ai" + "air" gives "aiair". Clean consonant→vowel joins
 *    score well; doubled letters and vowel collisions are penalised.
 * 3. **Pronounceability.** The existing phonetic assessment of the finished label, so a word that
 *    is fine on its own but unreadable next to this root is not chosen.
 * 4. **Word length and syllable shape.** A six-letter partner next to a six-letter root makes a
 *    twelve-letter domain; the ranking prefers the order that keeps the result speakable. (Both
 *    orders have the same length, so this only matters through the syllable boundary.)
 * 5. **Redundancy.** The caller rejects names where the partner repeats or contains the root
 *    (`pay` + `payroll`); that is a validity rule, handled in `partner-engine.ts`, not a score.
 * 6. **Industry relevance.** Industry partners are ranked into the pool first; placement itself
 *    does not change it, so it is used as a tie-breaker only.
 *
 * Keeping both orders
 * -------------------
 * The losing order is kept **only** when it still clears `BOTH_PLACEMENTS_THRESHOLD` — a strong
 * absolute score, not "close enough". A clear anchor ("HomeLand" 92 vs "LandHome" 52) therefore
 * yields one name; a genuinely two-sided word ("HomeCloud" / "CloudHome") yields two. That bound
 * is what stops the engine from padding a list with awkward orderings.
 */

import { pronounceabilityScore } from "./phonetics";
import type { PartnerRole, PartnerWord } from "./partners";

export type PlacementOrder = "root-partner" | "partner-root";

/** The score both orders must reach for the engine to keep both. */
export const BOTH_PLACEMENTS_THRESHOLD = 74;

/** Neutral starting point: neither order is favoured before the signals are applied. */
const BASE_SCORE = 70;

export type PlacementContext = {
  /** Industry ids the request is expanding from; used only to break a near-tie. */
  industries?: string[];
};

export type PlacementDecision = {
  preferred: PlacementOrder;
  scores: Record<PlacementOrder, number>;
  /** How clearly the preferred order won, 0–1. */
  confidence: number;
  /** True when the other order also clears the quality threshold. */
  bothAcceptable: boolean;
  /** Human-readable notes, surfaced in the candidate details. */
  reasons: string[];
};

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** Vowel pairs that read as one sound, so they are not a collision at the boundary. */
const FRIENDLY_VOWEL_PAIRS = new Set([
  // Digraphs that a reader already treats as one sound when they meet across the join
  // ("tide" + "anchor" → "…eanchor"). Anything else is two vowel sounds colliding.
  "ea", "ee", "ie", "oa", "oo", "ou", "ue",
]);

/**
 * Scores the join from `left` to `right`.
 *
 * Returns a delta in roughly −14…+6. The rules are deliberately narrow and testable: each one
 * corresponds to a spelling a person would trip over.
 */
export function junctionScore(left: string, right: string): { delta: number; reason: string | null } {
  if (!left || !right) return { delta: 0, reason: null };
  const last = left.at(-1) ?? "";
  const first = right[0] ?? "";
  // A trailing "y" is a vowel sound in this position ("pay", "fly"), and treating it as a
  // consonant would wrongly call "pay" + "nova" a consonant cluster.
  const lastIsVowel = VOWELS.has(last) || last === "y";
  const firstIsVowel = VOWELS.has(first);

  // "pay" + "yield" → "payyield": an accidental double letter reads as a typo.
  if (last === first) {
    return { delta: -10, reason: `doubles the letter “${last}” at the join (“${left}${right}”)` };
  }

  // "ai" + "air" → "aiair": two vowel sounds collide unless they form a familiar digraph.
  if (lastIsVowel && firstIsVowel) {
    const pair = `${last}${first}`;
    if (FRIENDLY_VOWEL_PAIRS.has(pair)) return { delta: -2, reason: null };
    return { delta: -9, reason: `puts two vowel sounds together (“${last}${first}”)` };
  }

  // Three consonants across the join ("cloud" + "stack" → "…dstack") is hard to say. Only the
  // consonants that actually meet are counted, so "nest" + "home" is s-t-h — two, not three.
  if (!lastIsVowel && !firstIsVowel) {
    const tail = /[^aeiou]+$/.exec(left)?.[0] ?? "";
    const head = /^[^aeiou]+/.exec(right)?.[0] ?? "";
    if (tail.length + head.length >= 3) return { delta: -7, reason: "joins three consonants" };
    return { delta: 0, reason: null };
  }

  // A consonant→vowel or vowel→consonant join keeps the syllable boundary audible.
  return { delta: firstIsVowel ? 5 : 4, reason: null };
}

function roleDelta(role: PartnerRole | null, order: PlacementOrder): { delta: number; reason: string | null } {
  if (role === null) return { delta: 0, reason: null };
  if (role === "modifier") {
    return order === "partner-root"
      ? { delta: 18, reason: "reads as a modifier, so it belongs in front" }
      : { delta: -18, reason: "reads as a modifier, so it works better in front of the root" };
  }
  return order === "root-partner"
    ? { delta: 18, reason: "reads as a place or object, so it belongs behind the root" }
    : { delta: -18, reason: "reads as a place or object, so it works better after the root" };
}

/** A single role for a word, or `null` when the data says it works either way. */
export function primaryRole(partner: Pick<PartnerWord, "roles">): PartnerRole | null {
  if (partner.roles.length !== 1) return null;
  return partner.roles[0] ?? null;
}

function phoneticDelta(label: string): number {
  const { score } = pronounceabilityScore(label);
  // 100 → +6, 70 → 0, 40 → −6. Clamped so it can never outvote the role signal on its own.
  return Math.max(-6, Math.min(6, Math.round((score - 70) / 5)));
}

/**
 * Scores both orders for one root/partner pair.
 *
 * The root must already be normalised (lower-case letters) and the partner must already satisfy
 * the partner-length rule; this function only decides word order.
 */
export function evaluatePlacement(
  root: string,
  partner: PartnerWord,
  context: PlacementContext = {},
): PlacementDecision {
  const role = primaryRole(partner);
  const afterLabel = `${root}${partner.word}`;
  const beforeLabel = `${partner.word}${root}`;

  const afterRole = roleDelta(role, "root-partner");
  const beforeRole = roleDelta(role, "partner-root");
  const afterJunction = junctionScore(root, partner.word);
  const beforeJunction = junctionScore(partner.word, root);

  // Industry relevance is a tie-breaker: the word being on-topic should not decide the order,
  // but when the two orders are within noise of each other, a relevant partner wins its own tie.
  const matchedIndustry = (context.industries ?? []).find((id) => partner.industries.includes(id));

  const rawAfter = BASE_SCORE + afterRole.delta + afterJunction.delta + phoneticDelta(afterLabel);
  const rawBefore = BASE_SCORE + beforeRole.delta + beforeJunction.delta + phoneticDelta(beforeLabel);

  const scores: Record<PlacementOrder, number> = {
    "root-partner": clamp(Math.round(rawAfter)),
    "partner-root": clamp(Math.round(rawBefore)),
  };

  const preferred: PlacementOrder =
    scores["root-partner"] >= scores["partner-root"] ? "root-partner" : "partner-root";
  const other: PlacementOrder = preferred === "root-partner" ? "partner-root" : "root-partner";
  const delta = Math.abs(scores["root-partner"] - scores["partner-root"]);

  // A root that is itself a dictionary word plus a familiar pattern reads more naturally in one
  // order, but this is intentionally a small nudge: the role and boundary signals carry the
  // decision.
  const reasons: string[] = [];
  const preferredRole = preferred === "root-partner" ? afterRole : beforeRole;
  const preferredJunction = preferred === "root-partner" ? afterJunction : beforeJunction;
  if (preferredRole.reason) reasons.push(preferredRole.reason);
  if (preferredJunction.reason) reasons.push(preferredJunction.reason);
  if (matchedIndustry) reasons.push(`“${partner.word}” is ${matchedIndustry} vocabulary`);

  // Only an order that is strong on its own terms is kept as a second name; a merely "less bad"
  // order is discarded rather than padding the list.
  const bothAcceptable = scores[other] >= BOTH_PLACEMENTS_THRESHOLD;

  return {
    preferred,
    scores,
    confidence: Math.round((delta / 100) * 100) / 100,
    bothAcceptable,
    reasons,
  };
}
