/**
 * The only candidate rule the generator has.
 *
 * A name is the primary root plus **exactly one** partner root, in the order the placement
 * scorer chose (`placement.ts`):
 *
 *     PrimaryRoot + PartnerRoot      HomeLand
 *     PartnerRoot + PrimaryRoot      StayHome
 *
 * Nothing else is generated. There is no prefix+root+partner shape, no invented tail, no
 * portmanteau: the previous engine could produce all of those, which is why it could not make the
 * promise the product now makes. Every rejection is counted and named, so a short list can be
 * explained instead of padded.
 */

import { AWKWARD_COMBINATIONS } from "./dictionaries/words";
import { partnerWordLength, partnerWords, type PartnerWord } from "./partners";
import { evaluatePlacement, type PlacementOrder } from "./placement";
import type { GenerationRequest } from "./types";

export type PartnerCandidate = {
  label: string;
  components: string[];
  root: string;
  partner: string;
  order: PlacementOrder;
  actor: PartnerWord;
  placement: ReturnType<typeof evaluatePlacement>;
};

export type PartnerRuleRejection = {
  rule: "partner-is-root" | "partner-contains-root" | "awkward-pair" | "partner-length";
  partner: string;
};

export type PartnerBuildResult = {
  candidates: PartnerCandidate[];
  rejections: PartnerRuleRejection[];
  partnerPool: number;
  /** Every partner that produced at least one candidate. */
  partnersUsed: number;
};

function awkwardPair(root: string, partner: string): boolean {
  return AWKWARD_COMBINATIONS.some(
    ([left, right]) =>
      (left === root && right === partner) || (left === partner && right === root),
  );
}

/**
 * Builds both orders for every usable partner and returns the ones that survive the naming rules.
 *
 * The two hard rules are enforced here rather than later, because they are properties of the
 * naming contract rather than user-facing filters:
 *
 *   - the partner may not be the root, or contain it (`pay` + `payroll` → "paypayroll" repeats
 *     the root and reads as a typo);
 *   - a partner that the dictionaries already flag as an awkward pairing is skipped.
 *
 * The length rule is asserted again for every partner: the pool is filtered upstream, and a
 * candidate that slipped past it would break the one control the user has over length.
 */
export function buildPartnerCandidates(
  root: string,
  request: GenerationRequest,
): PartnerBuildResult {
  const pool = partnerWords({
    lengths: request.partnerLengths,
    industries: request.industries,
    extraWords: request.customPartners,
    includeLibraries: request.autoExpand,
    libraries: request.partnerLibraries,
  });

  const candidates: PartnerCandidate[] = [];
  const rejections: PartnerRuleRejection[] = [];
  const usedPartners = new Set<string>();

  for (const partner of pool) {
    const word = partner.word;

    if (partnerWordLength(word) !== partner.length) {
      rejections.push({ rule: "partner-length", partner: word });
      continue;
    }
    if (word === root) {
      rejections.push({ rule: "partner-is-root", partner: word });
      continue;
    }
    if (word.includes(root) || root.includes(word)) {
      rejections.push({ rule: "partner-contains-root", partner: word });
      continue;
    }
    if (awkwardPair(root, word)) {
      rejections.push({ rule: "awkward-pair", partner: word });
      continue;
    }

    const placement = evaluatePlacement(root, partner, { industries: request.industries });

    /**
     * Two-letter partners only ever follow the root.
     *
     * A two-letter word in front of a noun is not a word, it is a prefix: `in` + `secure` reads as
     * "insecure", `ex` + `secure` as "ex-secure". The engine has no lexicon of unintended meanings
     * and must not pretend to, so it refuses that shape instead of shipping names whose meaning
     * contradicts the brand. After the root the same letters read as a brand ending (SecureIt).
     */
    const preferred: PlacementOrder =
      partner.length <= 2 ? "root-partner" : placement.preferred;
    const orders: PlacementOrder[] = [preferred];
    // The other order is kept only when it clears the absolute quality threshold on its own.
    if (placement.bothAcceptable && partner.length > 2) {
      orders.push(preferred === "root-partner" ? "partner-root" : "root-partner");
    }

    for (const order of orders) {
      const components = order === "root-partner" ? [root, word] : [word, root];
      candidates.push({
        label: components.join(""),
        components,
        root,
        partner: word,
        order,
        actor: partner,
        placement: preferred === placement.preferred ? placement : { ...placement, preferred },
      });
      usedPartners.add(word);
    }
  }

  return {
    candidates,
    rejections,
    partnerPool: pool.length,
    partnersUsed: usedPartners.size,
  };
}
