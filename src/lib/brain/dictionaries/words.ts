/**
 * Curated word data for the naming engine.
 *
 * This is a *seed* dataset committed to the repository so the engine is useful before
 * any database is configured. Once Supabase is connected, the admin dictionaries
 * (`prefixes`, `suffixes`, `dictionary_terms`, `brandable_profiles`) are loaded on top
 * of these defaults and can be edited, versioned and exported from the admin panel.
 *
 * Every word here is a normal English word or a common brand morpheme. Nothing in this
 * file asserts anything about trademarks or availability.
 */

export type PrefixLibraryId =
  | "modern"
  | "nature"
  | "premium"
  | "tech"
  | "fintech"
  | "friendly"
  | "latin-roots";

export type SuffixLibraryId =
  | "generic"
  | "startup"
  | "descriptive"
  | "commerce"
  | "tech"
  | "abstract";

export type WordLibrary = {
  id: string;
  name: string;
  description: string;
  words: string[];
};

export const PREFIX_LIBRARIES: WordLibrary[] = [
  {
    id: "modern",
    name: "Modern",
    description: "Short, confident modifiers popular in SaaS and consumer tech.",
    words: [
      "nova", "apex", "alto", "lumen", "vero", "zeno", "wave", "vertex", "north", "bright",
      "clear", "echo", "hyper", "omni", "astro", "pulse", "spark", "orbit", "signal", "surge",
      "vivid", "zenith", "zero", "flux", "glide", "shift", "swift", "prime", "rise", "tempo",
    ],
  },
  {
    id: "nature",
    name: "Nature",
    description: "Grounded, natural imagery — useful for wellness, travel and food.",
    words: [
      "terra", "aqua", "sol", "luna", "star", "ember", "forge", "tide", "trail", "pine",
      "oak", "jade", "coral", "copper", "quartz", "amber", "azure", "dawn", "dusk", "meadow",
      "river", "stone", "willow", "bloom", "cedar", "delta", "field", "grove", "harbor", "ridge",
    ],
  },
  {
    id: "premium",
    name: "Premium",
    description: "Restrained, high-end modifiers for professional positioning.",
    words: [
      "prime", "royal", "noble", "sterling", "silver", "golden", "velvet", "marble", "ivory", "onyx",
      "regal", "grand", "elite", "finest", "crown", "heritage", "atelier", "maison", "verity", "clarity",
    ],
  },
  {
    id: "tech",
    name: "Technical",
    description: "Developer- and infrastructure-flavoured modifiers.",
    words: [
      "byte", "cyber", "data", "pixel", "quantum", "stack", "cloud", "kernel", "logic", "node",
      "packet", "proto", "qubit", "runtime", "script", "server", "signal", "socket", "static", "vector",
      "binary", "cipher", "cluster", "daemon", "matrix", "module", "neural", "pipeline", "proxy", "shard",
    ],
  },
  {
    id: "fintech",
    name: "Financial",
    description: "Money, ledger and trust vocabulary for payments and finance.",
    words: [
      "capital", "coin", "ledger", "mint", "vault", "trust", "bond", "credit", "equity", "fund",
      "asset", "audit", "bank", "cash", "clearing", "deposit", "escrow", "fiscal", "invoice", "ledgerly",
      "margin", "merchant", "pay", "remit", "settle", "stake", "treasury", "yield", "fin", "quota",
    ],
  },
  {
    id: "friendly",
    name: "Friendly",
    description: "Approachable, human modifiers for consumer products.",
    words: [
      "happy", "cozy", "sunny", "buddy", "little", "everyday", "neighbor", "kind", "merry", "plain",
      "simple", "warm", "gentle", "bright", "playful", "cheery", "handy", "homely", "tidy", "eager",
    ],
  },
  {
    id: "latin-roots",
    name: "Latin roots",
    description: "Classical prefixes that read as established and precise.",
    words: [
      "vita", "lumen", "veritas", "nova", "prima", "altus", "fortis", "clarus", "magnus", "sanus",
      "solus", "terra", "unus", "velox", "brevis", "citius", "duo", "firma", "grandis", "liber",
    ],
  },
];

export const SUFFIX_LIBRARIES: WordLibrary[] = [
  {
    id: "generic",
    name: "Generic",
    description: "Neutral place-and-purpose suffixes that fit almost any industry.",
    words: [
      "hub", "base", "nest", "zone", "space", "spot", "point", "place", "central", "station",
      "world", "yard", "field", "ground", "room", "side", "way", "works", "corner", "trail",
    ],
  },
  {
    id: "startup",
    name: "Startup",
    description: "Modern product suffixes; some are morphemes rather than whole words.",
    words: [
      "ly", "ify", "sy", "zio", "ora", "ora", "va", "do", "mo", "ki",
      "labs", "hq", "app", "kit", "set", "suite", "stack", "studio", "collective", "company",
    ],
  },
  {
    id: "descriptive",
    name: "Descriptive",
    description: "Explains what the product does: bridges, flows, engines and forges.",
    words: [
      "bridge", "flow", "forge", "engine", "guard", "grid", "lane", "link", "loop", "path",
      "pilot", "port", "quest", "reach", "scale", "scope", "stream", "sync", "track", "vault",
    ],
  },
  {
    id: "commerce",
    name: "Commerce",
    description: "Retail and marketplace vocabulary.",
    words: [
      "shop", "store", "market", "cart", "buy", "deal", "boutique", "outlet", "bazaar", "depot",
      "supply", "trade", "goods", "shelf", "counter", "exchange", "marketplace", "merchant", "retail", "wholesale",
    ],
  },
  {
    id: "tech",
    name: "Technical",
    description: "Infrastructure and engineering suffixes.",
    words: [
      "labs", "dev", "ops", "stack", "cloud", "core", "edge", "mesh", "node", "pipe",
      "runtime", "scale", "shard", "signal", "stream", "sys", "tech", "works", "systems", "protocol",
    ],
  },
  {
    id: "abstract",
    name: "Abstract",
    description: "Evocative, non-literal suffixes for brandable names.",
    words: [
      "a", "eo", "ia", "io", "is", "ix", "on", "ora", "ova", "ux",
      "ara", "ella", "eno", "era", "essa", "ika", "ino", "ista", "ola", "ova",
    ],
  },
];

/** Industry-neutral words that can pair with any root. */
export const NEUTRAL_WORDS: string[] = [
  "anchor", "atlas", "beacon", "bridge", "canvas", "catalyst", "cipher", "compass", "cove", "crest",
  "dock", "drift", "engine", "fabric", "facet", "frame", "gauge", "gateway", "harbor", "haven",
  "helix", "horizon", "index", "lantern", "layer", "lever", "link", "locus", "matrix", "meridian",
  "mesh", "method", "mode", "mosaic", "nexus", "orbit", "origin", "pattern", "pivot", "platform",
  "prism", "pulse", "quarry", "radar", "relay", "saga", "scope", "signal", "source", "spark",
  "spire", "summit", "switch", "thread", "threshold", "trace", "trail", "vector", "vessel", "vista",
];

/** Words that read as a brand suffix despite being ordinary nouns. */
export const BRAND_SUFFIX_MORPHEMES: string[] = [
  "ly", "ify", "er", "ora", "io", "eo", "ix", "ia", "on", "va", "do", "sy", "za", "zo", "mo",
];

/** Onsets used to build pronounceable invented names. Ordered by natural frequency. */
export const PHONETIC_ONSETS: string[] = [
  "", "b", "br", "c", "cl", "cr", "d", "dr", "f", "fl", "fr", "g", "gl", "gr", "h", "j",
  "k", "kr", "l", "m", "n", "p", "pl", "pr", "qu", "r", "s", "sh", "sk", "sl", "sn", "sp",
  "st", "str", "t", "th", "tr", "v", "w", "z", "ch",
];

export const PHONETIC_NUCLEI: string[] = [
  "a", "e", "i", "o", "u", "ai", "au", "ea", "ee", "ei", "ia", "ie", "io", "oa", "oo", "ou", "ua", "y",
];

export const PHONETIC_CODAS: string[] = [
  "", "", "n", "r", "s", "t", "l", "m", "x", "nt", "st", "nd", "rk", "sh", "th", "ck", "ll", "ss", "ph", "ft",
];

/**
 * Fragments that must never appear inside a generated label. Deliberately conservative:
 * the goal is to catch obvious accidents, not to be an exhaustive profanity filter.
 */
export const BANNED_FRAGMENTS: string[] = [
  "nigg", "fagg", "cunt", "twat", "rape", "rapi", "paedo", "pedo", "jizz", "bollock",
  "wank", "shit", "fuck", "phuck", "fcuk", "arse", "bimbo", "retard", "spic", "kike",
  "tranny", "whore", "slut", "bastard", "damn", "hell", "piss", "cock", "tits", "boob",
  "anal", "semen", "dildo", "porn", "xxx", "nazi", "hitler", "isis", "kkk", "heroin",
  "cocaine", "cancer", "kill", "murder", "suicide", "corpse", "scam", "fraud",
];

/**
 * Labels that resolve to infrastructure or reserved names and must never be offered.
 * Domain label rules + reserved-name registries make these unregistrable in practice.
 */
export const RESERVED_LABELS: string[] = [
  "www", "mail", "email", "smtp", "pop", "imap", "ftp", "ns", "ns1", "ns2", "dns", "admin",
  "administrator", "root", "hostmaster", "postmaster", "webmaster", "abuse", "security",
  "support", "help", "billing", "payments", "api", "app", "apps", "dev", "test", "staging",
  "prod", "production", "internal", "intranet", "localhost", "example", "invalid", "local",
  "onion", "invalid", "system", "registry", "registrar", "whois", "rdap", "domainfits",
];

/** Words that are legal to combine but read badly as a product name. */
export const AWKWARD_COMBINATIONS: Array<[string, string]> = [
  ["pay", "pay"],
  ["shop", "shop"],
  ["app", "app"],
  ["data", "data"],
  ["cloud", "cloud"],
  ["home", "home"],
  ["stream", "stream"],
  ["host", "host"],
];

export const ALL_PREFIX_WORDS: string[] = dedupeWords(PREFIX_LIBRARIES.flatMap((library) => library.words));
export const ALL_SUFFIX_WORDS: string[] = dedupeWords(SUFFIX_LIBRARIES.flatMap((library) => library.words));
export const ALL_KNOWN_WORDS: Set<string> = new Set([
  ...ALL_PREFIX_WORDS,
  ...ALL_SUFFIX_WORDS,
  ...NEUTRAL_WORDS,
]);

function dedupeWords(words: string[]): string[] {
  return Array.from(new Set(words.map((word) => word.toLowerCase().trim()).filter(Boolean)));
}

export function wordsForPrefixLibraries(ids: string[]): string[] {
  const selected = PREFIX_LIBRARIES.filter((library) => ids.includes(library.id));
  return dedupeWords(selected.flatMap((library) => library.words));
}

export function wordsForSuffixLibraries(ids: string[]): string[] {
  const selected = SUFFIX_LIBRARIES.filter((library) => ids.includes(library.id));
  return dedupeWords(selected.flatMap((library) => library.words));
}

/** True when the label contains a banned fragment (checked on the flattened label). */
export function containsBannedFragment(label: string): string | null {
  const lower = label.toLowerCase();
  for (const fragment of BANNED_FRAGMENTS) {
    if (lower.includes(fragment)) return fragment;
  }
  return null;
}

export function isReservedLabel(label: string): boolean {
  return RESERVED_LABELS.includes(label.toLowerCase());
}
