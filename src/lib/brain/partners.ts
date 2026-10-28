/**
 * Partner-root lexicon.
 *
 * The generator builds every name from exactly two parts: the user's primary root and one
 * *partner root*. This module is the partner side of that contract — the words, their metadata,
 * and the lookup the engine and the UI share.
 *
 * Where the words come from
 * -------------------------
 * Nothing here is a second, parallel dictionary. The lexicon is **derived** from the word data
 * the project already ships, so editing `dictionaries/words.ts` or `dictionaries/industries.ts`
 * immediately changes the generator:
 *
 *   - prefix libraries      → modifiers  (nova, swift, cloud…)
 *   - suffix libraries      → anchors    (hub, nest, land, base…)
 *   - industry prefixes     → modifiers  (ledger, sentinel…)
 *   - industry suffixes     → anchors    (payments, shield…)
 *   - industry relatedTerms → anchors    (wallet, kitchen, route…)
 *   - neutral words         → anchors    (atlas, beacon, harbor…)
 *   - CORE_PARTNERS         → curated additions with explicit role/industry tags
 *
 * Each entry carries the metadata the placement scorer (see `placement.ts`) needs: the word,
 * its alphabetic length, the roles it can play, the semantic category it came from, and the
 * industries it belongs to. The structure is a list of `PartnerDataset` objects, so another
 * dataset (a JSON file imported later, or rows from `dictionary_terms`) can be appended without
 * touching the engine — see `buildPartnerIndex`.
 *
 * Nothing in this file claims anything about availability, trademarks or market value.
 */

import {
  NEUTRAL_WORDS,
  PREFIX_LIBRARIES,
  SUFFIX_LIBRARIES,
} from "./dictionaries/words";
import { INDUSTRIES } from "./dictionaries/industries";

/**
 * What a partner root naturally does in a two-part name.
 *
 * - `modifier` reads in front of a noun: NovaPay, SwiftHome, CloudDesk.
 * - `anchor`   reads behind a noun: HomeLand, PayHub, CloudBase.
 *
 * Role is a *preference*, not a rule: the placement scorer weighs it against the actual sound
 * of both orders, and a word with both roles (it appears in both libraries) is neutral.
 */
export type PartnerRole = "modifier" | "anchor";

export type PartnerSource = "prefix-library" | "suffix-library" | "industry" | "neutral" | "core";

export type PartnerWord = {
  /** Lower-case, letters only. */
  word: string;
  /** Alphabetic length — the value the partner-length control filters on. */
  length: number;
  /** Every role observed for this word; one role means a clear preference. */
  roles: PartnerRole[];
  /** Semantic category: a library id, an industry id, or "core"/"neutral". */
  category: string;
  /** Industry ids this word belongs to (empty when it is generic). */
  industries: string[];
  sources: PartnerSource[];
};

export type PartnerDataset = {
  id: string;
  name: string;
  description: string;
  /** `builtin` datasets are derived from the shipped dictionaries; others are added later. */
  kind: "builtin" | "curated" | "json" | "database";
  entries: PartnerWord[];
};

/** Word length used by the partner-length control: letters only, no separators. */
export function partnerWordLength(word: string): number {
  return word.replace(/[^a-z]/gi, "").length;
}

function clean(word: string): string {
  return word.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Curated partner roots that the libraries do not cover.
 *
 * These are ordinary English words and established brand morphemes chosen because they pair
 * well with a short root. The role is explicit here because the lists above cannot express it:
 * "land", "nest" and "base" are places that follow a noun, while "stay", "quick" and "neo"
 * belong in front. Adding a word is a one-line change; nothing else needs to know about it.
 */
const CORE_PARTNERS: Array<{ word: string; role: PartnerRole; category: string; industries?: string[] }> = [
  // Places and containers — follow the root.
  { word: "land", role: "anchor", category: "place" },
  { word: "yard", role: "anchor", category: "place" },
  { word: "house", role: "anchor", category: "place" },
  { word: "home", role: "anchor", category: "place" },
  { word: "den", role: "anchor", category: "place" },
  { word: "loft", role: "anchor", category: "place" },
  { word: "nook", role: "anchor", category: "place" },
  { word: "porch", role: "anchor", category: "place" },
  { word: "roof", role: "anchor", category: "place" },
  { word: "gate", role: "anchor", category: "place" },
  { word: "dock", role: "anchor", category: "place" },
  { word: "camp", role: "anchor", category: "place" },
  { word: "park", role: "anchor", category: "place" },
  { word: "farm", role: "anchor", category: "place" },
  { word: "mill", role: "anchor", category: "place" },
  { word: "works", role: "anchor", category: "place" },
  { word: "shop", role: "anchor", category: "place" },
  { word: "store", role: "anchor", category: "place" },
  { word: "mart", role: "anchor", category: "place" },
  { word: "cafe", role: "anchor", category: "place" },
  { word: "club", role: "anchor", category: "place" },
  { word: "suite", role: "anchor", category: "place" },
  { word: "desk", role: "anchor", category: "place" },
  { word: "bay", role: "anchor", category: "place" },
  { word: "port", role: "anchor", category: "place" },
  { word: "inn", role: "anchor", category: "place" },
  // Tools and objects — follow the root.
  { word: "kit", role: "anchor", category: "tool" },
  { word: "box", role: "anchor", category: "tool" },
  { word: "pod", role: "anchor", category: "tool" },
  { word: "bag", role: "anchor", category: "tool" },
  { word: "card", role: "anchor", category: "tool" },
  { word: "book", role: "anchor", category: "tool" },
  { word: "note", role: "anchor", category: "tool" },
  { word: "list", role: "anchor", category: "tool" },
  { word: "map", role: "anchor", category: "tool" },
  { word: "feed", role: "anchor", category: "tool" },
  { word: "cast", role: "anchor", category: "tool" },
  { word: "log", role: "anchor", category: "tool" },
  { word: "scan", role: "anchor", category: "tool" },
  { word: "track", role: "anchor", category: "tool" },
  { word: "shop", role: "anchor", category: "tool" },
  // Money and trust — follow the root.
  { word: "cash", role: "anchor", category: "finance", industries: ["fintech"] },
  { word: "bank", role: "anchor", category: "finance", industries: ["fintech"] },
  { word: "pay", role: "anchor", category: "finance", industries: ["fintech"] },
  { word: "fund", role: "anchor", category: "finance", industries: ["fintech"] },
  { word: "coin", role: "anchor", category: "finance", industries: ["fintech", "crypto"] },
  { word: "mint", role: "anchor", category: "finance", industries: ["fintech", "crypto"] },
  { word: "vault", role: "anchor", category: "finance", industries: ["fintech", "security"] },
  { word: "ledger", role: "anchor", category: "finance", industries: ["fintech"] },
  { word: "credit", role: "anchor", category: "finance", industries: ["fintech"] },
  { word: "trust", role: "anchor", category: "finance", industries: ["fintech", "security"] },
  // Technology nouns — follow the root.
  { word: "byte", role: "anchor", category: "tech", industries: ["developer-tools"] },
  { word: "code", role: "anchor", category: "tech", industries: ["developer-tools"] },
  { word: "node", role: "anchor", category: "tech", industries: ["developer-tools", "cloud"] },
  { word: "core", role: "anchor", category: "tech", industries: ["developer-tools"] },
  { word: "grid", role: "anchor", category: "tech", industries: ["cloud"] },
  { word: "mesh", role: "anchor", category: "tech", industries: ["cloud"] },
  { word: "stack", role: "anchor", category: "tech", industries: ["developer-tools"] },
  { word: "sync", role: "anchor", category: "tech" },
  { word: "hub", role: "anchor", category: "tech" },
  { word: "labs", role: "anchor", category: "tech" },
  { word: "lens", role: "anchor", category: "tech" },
  // People and groups — follow the root.
  { word: "crew", role: "anchor", category: "people" },
  { word: "team", role: "anchor", category: "people", industries: ["communication"] },
  { word: "guild", role: "anchor", category: "people", industries: ["gaming"] },
  { word: "folk", role: "anchor", category: "people" },
  { word: "co", role: "anchor", category: "people" },
  // Modifiers that read in front of a noun.
  { word: "stay", role: "modifier", category: "verb", industries: ["travel"] },
  { word: "quick", role: "modifier", category: "adjective" },
  { word: "smart", role: "modifier", category: "adjective" },
  { word: "neo", role: "modifier", category: "modern" },
  { word: "open", role: "modifier", category: "adjective" },
  { word: "true", role: "modifier", category: "adjective" },
  { word: "fair", role: "modifier", category: "adjective", industries: ["fintech"] },
  { word: "fresh", role: "modifier", category: "adjective", industries: ["food"] },
  { word: "urban", role: "modifier", category: "adjective", industries: ["real-estate"] },
  { word: "rural", role: "modifier", category: "adjective", industries: ["real-estate"] },
  { word: "meta", role: "modifier", category: "modern", industries: ["ai"] },
  { word: "auto", role: "modifier", category: "modern", industries: ["saas", "ai"] },
  { word: "chat", role: "modifier", category: "verb", industries: ["communication"] },
  { word: "talk", role: "modifier", category: "verb", industries: ["communication"] },
  { word: "meet", role: "modifier", category: "verb", industries: ["communication"] },
  { word: "send", role: "modifier", category: "verb", industries: ["communication"] },
  { word: "call", role: "modifier", category: "verb", industries: ["communication"] },
  { word: "ship", role: "modifier", category: "verb", industries: ["logistics"] },
  { word: "book", role: "modifier", category: "verb", industries: ["travel"] },
  { word: "cook", role: "modifier", category: "verb", industries: ["food"] },
  { word: "grow", role: "modifier", category: "verb", industries: ["marketing"] },
  { word: "learn", role: "modifier", category: "verb", industries: ["education"] },
  { word: "teach", role: "modifier", category: "verb", industries: ["education"] },
  { word: "care", role: "modifier", category: "verb", industries: ["health"] },
  { word: "cure", role: "modifier", category: "verb", industries: ["health"] },
  { word: "play", role: "modifier", category: "verb", industries: ["gaming"] },
  { word: "win", role: "modifier", category: "verb", industries: ["gaming"] },
  { word: "trade", role: "modifier", category: "verb", industries: ["fintech", "crypto"] },
  { word: "save", role: "modifier", category: "verb", industries: ["fintech"] },
  { word: "spend", role: "modifier", category: "verb", industries: ["fintech"] },
  { word: "earn", role: "modifier", category: "verb", industries: ["fintech"] },
  { word: "build", role: "modifier", category: "verb", industries: ["developer-tools"] },
  { word: "code", role: "modifier", category: "verb", industries: ["developer-tools"] },
  { word: "test", role: "modifier", category: "verb", industries: ["developer-tools"] },
  { word: "deploy", role: "modifier", category: "verb", industries: ["developer-tools", "cloud"] },
  { word: "host", role: "modifier", category: "verb", industries: ["cloud"] },
  { word: "guard", role: "modifier", category: "verb", industries: ["security"] },
  { word: "shield", role: "modifier", category: "verb", industries: ["security"] },
  { word: "watch", role: "modifier", category: "verb", industries: ["security", "media"] },
  { word: "list", role: "modifier", category: "verb", industries: ["ecommerce"] },
  { word: "sell", role: "modifier", category: "verb", industries: ["ecommerce"] },
  { word: "buy", role: "modifier", category: "verb", industries: ["ecommerce"] },
  { word: "find", role: "modifier", category: "verb" },
  { word: "give", role: "modifier", category: "verb" },
  { word: "make", role: "modifier", category: "verb" },
  { word: "move", role: "modifier", category: "verb", industries: ["logistics"] },
  { word: "ride", role: "modifier", category: "verb", industries: ["travel", "logistics"] },
  { word: "fly", role: "modifier", category: "verb", industries: ["travel"] },
];

/**
 * Role overrides for words whose provenance gives the wrong impression.
 *
 * `stay`, for instance, arrives from the travel industry's noun list but reads as a verb in front
 * of a root ("StayHome"), and `cloud` appears in a prefix library while "HomeCloud" is the more
 * natural order. An override replaces the derived role.
 */
const ROLE_OVERRIDES: Record<string, PartnerRole> = {
  stay: "modifier",
  book: "modifier",
  cloud: "modifier",
  signal: "modifier",
  data: "modifier",
  node: "anchor",
  mesh: "anchor",
  core: "anchor",
  edge: "anchor",
  scale: "modifier",
  stream: "modifier",
  prime: "modifier",
  smart: "modifier",
  home: "anchor",
  pay: "anchor",
  shop: "anchor",
  store: "anchor",
  land: "anchor",
};

/** Lower-cased, letters-only key used for merging and lookups. */
function makeEntry(
  raw: string,
  role: PartnerRole,
  source: PartnerSource,
  category: string,
  industries: string[] = [],
): PartnerWord | null {
  const word = clean(raw);
  if (word.length < 2 || word.length > 12) return null;
  return {
    word,
    length: partnerWordLength(word),
    roles: [role],
    category,
    industries: Array.from(new Set(industries)),
    sources: [source],
  };
}

function mergeEntry(into: Map<string, PartnerWord>, entry: PartnerWord | null): void {
  if (!entry) return;
  const existing = into.get(entry.word);
  if (!existing) {
    into.set(entry.word, entry);
    return;
  }
  for (const role of entry.roles) if (!existing.roles.includes(role)) existing.roles.push(role);
  for (const industry of entry.industries) {
    if (!existing.industries.includes(industry)) existing.industries.push(industry);
  }
  for (const source of entry.sources) if (!existing.sources.includes(source)) existing.sources.push(source);
}

function sorted(map: Map<string, PartnerWord>): PartnerWord[] {
  return Array.from(map.values()).sort((a, b) => a.word.localeCompare(b.word));
}

/** Dataset 1 — everything the project already ships in its word and industry dictionaries. */
function builtinEntries(): PartnerWord[] {
  const map = new Map<string, PartnerWord>();
  for (const library of PREFIX_LIBRARIES) {
    for (const word of library.words) mergeEntry(map, makeEntry(word, "modifier", "prefix-library", library.id));
  }
  for (const library of SUFFIX_LIBRARIES) {
    for (const word of library.words) mergeEntry(map, makeEntry(word, "anchor", "suffix-library", library.id));
  }
  for (const word of NEUTRAL_WORDS) mergeEntry(map, makeEntry(word, "anchor", "neutral", "neutral"));
  for (const industry of INDUSTRIES) {
    for (const word of industry.prefixes) {
      mergeEntry(map, makeEntry(word, "modifier", "industry", industry.id, [industry.id]));
    }
    for (const word of industry.suffixes) {
      mergeEntry(map, makeEntry(word, "anchor", "industry", industry.id, [industry.id]));
    }
    for (const word of industry.relatedTerms) {
      mergeEntry(map, makeEntry(word, "anchor", "industry", industry.id, [industry.id]));
    }
  }
  return sorted(map);
}

/** Dataset 2 — the curated list above, with the role overrides applied. */
function curatedEntries(): PartnerWord[] {
  const map = new Map<string, PartnerWord>();
  for (const entry of CORE_PARTNERS) {
    mergeEntry(map, makeEntry(entry.word, entry.role, "core", entry.category, entry.industries ?? []));
  }
  return sorted(map);
}

/**
 * Every partner dataset, in priority order.
 *
 * `buildPartnerIndex` walks this list and merges by word, so another dataset (a JSON file, or
 * rows read from `dictionary_terms`) only has to be appended here — or passed to
 * `buildPartnerIndex` directly — to take part in generation.
 */
export const PARTNER_DATASETS: PartnerDataset[] = [
  {
    id: "builtin",
    name: "Shipped dictionaries",
    description: "Prefix, suffix, neutral and industry vocabulary from the engine's own data files.",
    kind: "builtin",
    entries: builtinEntries(),
  },
  {
    id: "core",
    name: "Curated partners",
    description: "Hand-checked partner roots with an explicit natural side and industry tags.",
    kind: "curated",
    entries: curatedEntries(),
  },
];

function applyRoleOverrides(entries: PartnerWord[]): PartnerWord[] {
  for (const entry of entries) {
    const override = ROLE_OVERRIDES[entry.word];
    if (override) entry.roles = [override];
  }
  return entries;
}

/**
 * Merges datasets into one indexed lexicon.
 *
 * Exported so a caller can build a lexicon from extra data (a JSON file, or rows fetched from
 * `dictionary_terms`) without the engine knowing where the words came from. The first dataset
 * that mentions a word sets its category; later ones add roles, industries and sources.
 */
export function buildPartnerIndex(datasets: PartnerDataset[] = PARTNER_DATASETS): PartnerWord[] {
  const merged = new Map<string, PartnerWord>();
  for (const dataset of datasets) {
    for (const entry of dataset.entries) {
      mergeEntry(merged, {
        word: clean(entry.word),
        length: partnerWordLength(entry.word),
        roles: [...entry.roles],
        category: entry.category,
        industries: [...entry.industries],
        sources: [...entry.sources],
      });
    }
  }
  return applyRoleOverrides(sorted(merged));
}

/** The shipped lexicon. Built once per module load; immutable by convention. */
export const PARTNER_LEXICON: PartnerWord[] = buildPartnerIndex();

/** Lookup used by placement scoring and by the UI's "why this word" note. */
export const PARTNER_INDEX: Map<string, PartnerWord> = new Map(
  PARTNER_LEXICON.map((entry) => [entry.word, entry]),
);

/** All partner lengths the lexicon can actually supply, for the UI's chips. */
export const SUPPORTED_PARTNER_LENGTHS: number[] = Array.from(
  new Set(PARTNER_LEXICON.map((entry) => entry.length)),
).sort((a, b) => a - b);

/**
 * Partner word lengths offered by the generator.
 *
 * Short partners are what makes a two-part name usable: two six-letter words make a twelve-letter
 * domain nobody types. Six letters is included because the longest useful anchors ("stream",
 * "ledger", "shield", "domain") are six, and a curated list is not a reason to hide a length.
 */
export const PARTNER_LENGTH_CHOICES = [2, 3, 4, 5, 6] as const;

export type PartnerQuery = {
  /** Allowed alphabetic lengths of the partner. Empty = any length. */
  lengths?: number[];
  /** Industry ids whose vocabulary should be included first (empty = all). */
  industries?: string[];
  /** Words supplied by the user; they take part whatever their provenance. */
  extraWords?: string[];
  /** When false, only industry and neutral vocabulary is used (no library words). */
  includeLibraries?: boolean;
  /** Restrict to these dataset ids. Defaults to every dataset. */
  datasets?: string[];
  /** Library ids whose words may be used; empty = every library. */
  libraries?: string[];
};

/**
 * The partner words a request may draw on.
 *
 * Ordering is deliberate: industry words first, then curated, then library, then neutral. The
 * engine walks the list in order, so a request that can only produce 40 names still returns the
 * most relevant 40 rather than a random slice of the dictionary.
 *
 * A length filter applies to the partner **alone** — the root's letters are never counted.
 */
export function partnerWords(query: PartnerQuery = {}): PartnerWord[] {
  const lengths = query.lengths && query.lengths.length > 0 ? new Set(query.lengths) : null;
  const industries = new Set(query.industries ?? []);
  const includeLibraries = query.includeLibraries !== false;
  const libraries = query.libraries && query.libraries.length > 0 ? new Set(query.libraries) : null;

  const fromAllowedLibrary = (entry: PartnerWord): boolean => {
    if (!entry.sources.includes("prefix-library") && !entry.sources.includes("suffix-library")) return true;
    return libraries === null || libraries.has(entry.category);
  };

  const score = (entry: PartnerWord): number => {
    if (industries.size > 0 && entry.industries.some((id) => industries.has(id))) return 0;
    if (entry.sources.includes("core")) return 1;
    if (industries.size > 0) return 2;
    if (entry.sources.includes("industry")) return 2;
    if (entry.sources.includes("neutral")) return 4;
    return includeLibraries ? 3 : 5;
  };

  const filtered = PARTNER_LEXICON.filter((entry) => {
    if (lengths && !lengths.has(entry.length)) return false;
    // A word can belong to a library and an industry at once; the industry provenance is what
    // survives a library restriction, which is why the check is per-source.
    if (!fromAllowedLibrary(entry) && entry.sources.every((source) => source === "prefix-library" || source === "suffix-library")) {
      return false;
    }
    if (!includeLibraries && (entry.sources.includes("prefix-library") || entry.sources.includes("suffix-library"))) {
      // A word that only exists in a library disappears when libraries are off; a word that also
      // came from an industry or the curated list stays.
      return (
        entry.sources.includes("industry") ||
        entry.sources.includes("neutral") ||
        entry.sources.includes("core")
      );
    }
    return true;
  });

  const extra: PartnerWord[] = [];
  for (const raw of query.extraWords ?? []) {
    const word = clean(raw);
    if (word.length < 2) continue;
    if (lengths && !lengths.has(partnerWordLength(word))) continue;
    if (filtered.some((entry) => entry.word === word)) continue;
    extra.push({
      word,
      length: partnerWordLength(word),
      roles: PARTNER_INDEX.get(word)?.roles ?? ["anchor", "modifier"],
      category: "custom",
      industries: [],
      sources: ["core"],
    });
  }

  return [...extra, ...filtered].sort(
    (a, b) => score(a) - score(b) || a.length - b.length || a.word.localeCompare(b.word),
  );
}
