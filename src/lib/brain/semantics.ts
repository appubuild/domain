/**
 * Semantic expansion and industry detection.
 *
 * Deterministic by design: the engine must produce useful, explainable associations even
 * when no AI provider is configured (see docs/naming-engine.md). An AI provider can only
 * *add* suggestions that are then validated by this same pipeline.
 */

import { INDUSTRIES, type Industry } from "./dictionaries/industries";
import { NEUTRAL_WORDS } from "./dictionaries/words";

export type IndustryMatch = {
  id: string;
  name: string;
  confidence: number;
  reason: string;
};

export type RelatedTerm = {
  word: string;
  /** 0–1 relevance estimate used to order expansion candidates. */
  weight: number;
  /** Where the term came from, shown in the explanation panel. */
  source: "industry" | "neutral" | "synonym" | "category";
  category?: string;
  industryId?: string;
};

export type SemanticProfile = {
  root: string;
  industries: IndustryMatch[];
  relatedTerms: RelatedTerm[];
  synonyms: string[];
  categories: string[];
};

/**
 * Curated synonym/category map for common roots. This is intentionally small and honest:
 * where a root is unknown, the engine falls back to industry terminology only rather
 * than inventing associations.
 */
const ROOT_SEMANTICS: Record<
  string,
  { synonyms: string[]; categories: string[]; industries: string[] }
> = {
  pay: {
    synonyms: ["payment", "payments", "settle", "remit"],
    categories: ["payments", "wallets", "billing", "invoices", "transactions", "merchant services", "checkout", "remittance"],
    industries: ["fintech"],
  },
  home: {
    synonyms: ["house", "abode", "nest", "dwelling"],
    categories: ["property", "living", "nest", "estate", "realty", "interior", "household", "security", "home services"],
    industries: ["real-estate"],
  },
  cloud: {
    synonyms: ["nimbus", "stratus"],
    categories: ["hosting", "storage", "infrastructure", "compute", "devops"],
    industries: ["cloud", "developer-tools", "saas"],
  },
  host: {
    synonyms: ["hosting", "serve"],
    categories: ["hosting", "servers", "infrastructure", "uptime"],
    industries: ["cloud"],
  },
  domain: {
    synonyms: ["domains", "tld"],
    categories: ["registration", "naming", "dns", "branding"],
    industries: ["saas", "marketing"],
  },
  ai: {
    synonyms: ["artificial", "intelligence", "neural", "model"],
    categories: ["models", "agents", "inference", "assistants", "automation"],
    industries: ["ai"],
  },
  shop: {
    synonyms: ["store", "market", "boutique"],
    categories: ["retail", "commerce", "marketplace", "checkout"],
    industries: ["ecommerce"],
  },
  stream: {
    synonyms: ["live", "broadcast", "feed"],
    categories: ["media", "audio", "video", "publishing"],
    industries: ["media"],
  },
  data: {
    synonyms: ["dataset", "records", "analytics"],
    categories: ["analytics", "pipelines", "storage", "warehouse"],
    industries: ["saas", "developer-tools", "cloud"],
  },
  health: {
    synonyms: ["care", "wellness", "medical"],
    categories: ["clinical", "wellness", "telehealth", "fitness"],
    industries: ["health"],
  },
  learn: {
    synonyms: ["study", "teach", "tutor"],
    categories: ["courses", "tutoring", "skills", "academy"],
    industries: ["education"],
  },
  travel: {
    synonyms: ["trip", "journey", "voyage"],
    categories: ["booking", "stays", "experiences", "itineraries"],
    industries: ["travel"],
  },
  food: {
    synonyms: ["meal", "kitchen", "recipe"],
    categories: ["restaurants", "delivery", "recipes", "groceries"],
    industries: ["food"],
  },
  secure: {
    synonyms: ["security", "guard", "shield"],
    categories: ["identity", "compliance", "encryption", "monitoring"],
    industries: ["security"],
  },
  game: {
    synonyms: ["gaming", "play", "esports"],
    categories: ["studios", "esports", "player tools", "streaming"],
    industries: ["gaming"],
  },
};

function normalizeRoot(root: string): string {
  return root.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Detects industries for a root. Explicit user selections always win; the detector only
 * fills in suggestions and never overrides a user choice.
 */
export function detectIndustries(root: string, explicit: string[] = []): IndustryMatch[] {
  const key = normalizeRoot(root);
  const matches = new Map<string, IndustryMatch>();

  for (const industryId of explicit) {
    const industry = INDUSTRIES.find((item) => item.id === industryId);
    if (!industry) continue;
    matches.set(industry.id, {
      id: industry.id,
      name: industry.name,
      confidence: 1,
      reason: "Selected by you.",
    });
  }

  const curated = ROOT_SEMANTICS[key];
  if (curated) {
    for (const industryId of curated.industries) {
      const industry = INDUSTRIES.find((item) => item.id === industryId);
      if (!industry || matches.has(industry.id)) continue;
      matches.set(industry.id, {
        id: industry.id,
        name: industry.name,
        confidence: 0.9,
        reason: `“${key}” is a curated ${industry.name} root.`,
      });
    }
  }

  for (const industry of INDUSTRIES) {
    if (matches.has(industry.id)) continue;
    const keywordHit = industry.keywords.find(
      (keyword) => keyword === key || key.startsWith(keyword) || keyword.startsWith(key),
    );
    if (keywordHit) {
      matches.set(industry.id, {
        id: industry.id,
        name: industry.name,
        confidence: keywordHit === key ? 0.75 : 0.55,
        reason: `Keyword overlap with “${keywordHit}”.`,
      });
      continue;
    }
    const relatedHit = industry.relatedTerms.find((term) => term === key);
    if (relatedHit) {
      matches.set(industry.id, {
        id: industry.id,
        name: industry.name,
        confidence: 0.4,
        reason: `“${key}” appears in ${industry.name} vocabulary.`,
      });
    }
  }

  return Array.from(matches.values()).sort((a, b) => b.confidence - a.confidence);
}

function lengthPenalty(word: string): number {
  // Shorter words fit more labels; long words are kept but ranked lower.
  if (word.length <= 4) return 1;
  if (word.length <= 6) return 0.94;
  if (word.length <= 8) return 0.86;
  return 0.72;
}

/**
 * Builds the semantic expansion set for a root.
 *
 * `expandIndustries=false` returns only curated synonyms/categories, so the caller can
 * disable automatic keyword expansion without losing root-specific associations.
 */
export function buildSemanticProfile(
  root: string,
  options: { industries?: string[]; expandIndustries?: boolean; limit?: number } = {},
): SemanticProfile {
  const key = normalizeRoot(root);
  const explicit = options.industries ?? [];
  const expand = options.expandIndustries ?? true;
  const limit = options.limit ?? 120;

  const industries = detectIndustries(key, explicit);
  const curated = ROOT_SEMANTICS[key];
  const terms = new Map<string, RelatedTerm>();

  const addTerm = (term: RelatedTerm) => {
    const word = normalizeRoot(term.word);
    if (!word || word === key) return;
    const existing = terms.get(word);
    if (existing && existing.weight >= term.weight) return;
    terms.set(word, { ...term, word });
  };

  if (curated) {
    curated.synonyms.forEach((synonym) => {
      addTerm({ word: synonym, weight: 0.95 * lengthPenalty(synonym), source: "synonym" });
    });
    curated.categories.forEach((category) => {
      // Categories are descriptive phrases; the first word is the usable component.
      const head = normalizeRoot(category.split(" ")[0] ?? "");
      if (head) addTerm({ word: head, weight: 0.8 * lengthPenalty(head), source: "category", category });
    });
  }

  if (expand) {
    for (const match of industries) {
      const industry = INDUSTRIES.find((item) => item.id === match.id);
      if (!industry) continue;
      const weightBase = 0.85 * match.confidence * (industry.semanticWeight ?? 1);
      for (const term of industry.relatedTerms) {
        addTerm({
          word: term,
          weight: weightBase * lengthPenalty(term),
          source: "industry",
          industryId: industry.id,
        });
      }
      for (const term of [...industry.prefixes, ...industry.suffixes]) {
        addTerm({
          word: term,
          weight: weightBase * 0.9 * lengthPenalty(term),
          source: "industry",
          industryId: industry.id,
        });
      }
    }
    // Neutral words are always available but weighted lower so industry terms lead.
    NEUTRAL_WORDS.forEach((term) => {
      addTerm({ word: term, weight: 0.5 * lengthPenalty(term), source: "neutral" });
    });
  }

  const relatedTerms = Array.from(terms.values())
    .sort((a, b) => b.weight - a.weight || a.word.localeCompare(b.word))
    .slice(0, limit);

  return {
    root: key,
    industries,
    relatedTerms,
    synonyms: curated?.synonyms ?? [],
    categories: curated?.categories ?? [],
  };
}

/**
 * Semantic relevance of a generated label to its root, 0–100.
 *
 * The scale is deliberately coarse and documented as a heuristic:
 *  - contains the full root                    70 base
 *  - contains a curated synonym/category term  +10
 *  - every component from a matched industry   +10 (max +20)
 *  - unrelated dictionary words only           35
 */
export function semanticRelevance(
  label: string,
  root: string,
  industryIds: string[],
  components: string[],
): { score: number; explanation: string } {
  const key = normalizeRoot(root);
  const lower = label.toLowerCase();
  if (!lower.includes(key)) {
    const hasIndustryWord = components.some((component) =>
      INDUSTRIES.some(
        (industry) =>
          industryIds.includes(industry.id) &&
          (industry.relatedTerms.includes(component) || industry.keywords.includes(component)),
      ),
    );
    return hasIndustryWord
      ? { score: 45, explanation: "No root match, but an industry term is present." }
      : { score: 28, explanation: "Neither the root nor an industry term appears in the label." };
  }

  let score = 70;
  const reasons = ["Contains the full root keyword"];
  const curated = ROOT_SEMANTICS[key];
  const otherComponents = components.filter((component) => component !== key);

  if (curated) {
    const synonymHit = otherComponents.find((component) => curated.synonyms.includes(component));
    if (synonymHit) {
      score += 10;
      reasons.push(`includes the synonym “${synonymHit}”`);
    }
    const categoryHit = curated.categories.find((category) =>
      otherComponents.some((component) => category.includes(component)),
    );
    if (categoryHit) {
      score += 5;
      reasons.push(`relates to “${categoryHit}”`);
    }
  }

  const industryWordHits = otherComponents.filter((component) =>
    INDUSTRIES.some(
      (industry) =>
        industryIds.includes(industry.id) &&
        (industry.relatedTerms.includes(component) ||
          industry.keywords.includes(component) ||
          industry.suffixes.includes(component)),
    ),
  );
  if (industryWordHits.length > 0) {
    const bonus = Math.min(20, industryWordHits.length * 10);
    score += bonus;
    reasons.push(`uses ${industryWordHits.join(", ")} from the industry vocabulary`);
  }

  return { score: Math.min(100, score), explanation: reasons.join("; ") + "." };
}

/** Exposed for the admin playground: how a root maps to industries and terms. */
export function explainRoot(root: string): {
  industries: IndustryMatch[];
  profile: SemanticProfile;
  relatedIndustryNames: string[];
} {
  const profile = buildSemanticProfile(root, { expandIndustries: true, limit: 24 });
  return {
    industries: profile.industries,
    profile,
    relatedIndustryNames: profile.industries.map((match) => match.name),
  };
}

export type { Industry };
