/**
 * Industry taxonomy seed data.
 *
 * An industry carries the vocabulary the semantic engine may draw on: keywords that
 * identify it, related terms for expansion, and preferred prefix/suffix sets. The admin
 * industry manager edits these records in `industries` / `industry_terms`; this file is
 * the offline default and the seed source.
 */

export type PatternTemplate =
  | "prefix-root"
  | "root-suffix"
  | "industry-root"
  | "root-industry"
  | "root-concept"
  | "root-action"
  | "root-audience"
  | "root-product";

export type NamingPattern = {
  id: string;
  template: PatternTemplate;
  /** Human description used in the admin playground. */
  label: string;
  /** Which word pool fills the non-root slot. */
  pool: "prefix" | "suffix" | "industry" | "concept" | "action" | "audience" | "product";
};

export type Industry = {
  id: string;
  name: string;
  slug: string;
  description: string;
  /** Terms whose presence in a root implies this industry. */
  keywords: string[];
  /** Words that may be appended/prepended when expanding semantically. */
  relatedTerms: string[];
  prefixes: string[];
  suffixes: string[];
  patterns: NamingPattern[];
  /** Industry-specific words that should not be combined with a root. */
  avoid: string[];
  /** Default weights for relevance scoring in brandable ranking. */
  semanticWeight: number;
};

const defaultPatterns: NamingPattern[] = [
  { id: "p-prefix-root", template: "prefix-root", label: "Brand modifier + root", pool: "prefix" },
  { id: "p-root-suffix", template: "root-suffix", label: "Root + brand suffix", pool: "suffix" },
  { id: "p-industry-root", template: "industry-root", label: "Industry term + root", pool: "industry" },
  { id: "p-root-industry", template: "root-industry", label: "Root + industry term", pool: "industry" },
  { id: "p-root-concept", template: "root-concept", label: "Root + related concept", pool: "concept" },
  { id: "p-root-action", template: "root-action", label: "Root + action", pool: "action" },
  { id: "p-root-audience", template: "root-audience", label: "Root + audience", pool: "audience" },
  { id: "p-root-product", template: "root-product", label: "Root + product type", pool: "product" },
];

export const INDUSTRIES: Industry[] = [
  {
    id: "fintech",
    name: "Fintech & Payments",
    slug: "fintech",
    description:
      "Payments, wallets, billing, invoicing, merchant services, lending and personal finance tools.",
    keywords: ["pay", "payment", "wallet", "bank", "banking", "finance", "financial", "money", "cash", "credit", "invoice", "billing", "ledger", "loan", "lend", "invest", "wealth", "tax", "accounting", "fintech"],
    relatedTerms: ["wallet", "ledger", "billing", "invoice", "checkout", "merchant", "remit", "settle", "treasury", "yield", "credit", "debit", "transfer", "balance", "escrow", "capital"],
    prefixes: ["ledger", "vault", "capital", "mint", "trust", "swift", "prime", "clear"],
    suffixes: ["pay", "payments", "finance", "capital", "ledger", "vault", "wallet", "billing"],
    patterns: defaultPatterns,
    avoid: ["free", "cheap"],
    semanticWeight: 1,
  },
  {
    id: "ai",
    name: "AI & Machine Learning",
    slug: "ai",
    description: "Models, agents, inference platforms, data labelling and applied AI tooling.",
    keywords: ["ai", "ml", "machine", "learning", "neural", "model", "agent", "llm", "prompt", "inference", "intelligence", "neural", "deep", "token", "vector", "embedding"],
    relatedTerms: ["agent", "model", "inference", "prompt", "neural", "cognition", "reason", "vector", "token", "train", "eval", "synthesis", "assistant", "copilot", "oracle", "mind"],
    prefixes: ["neural", "cognita", "synapse", "axon", "qubit", "logic", "reason", "synthesis"],
    suffixes: ["ai", "labs", "mind", "logic", "models", "agents", "brain", "intelligence"],
    patterns: defaultPatterns,
    avoid: ["fake", "auto"],
    semanticWeight: 1.05,
  },
  {
    id: "saas",
    name: "SaaS & Software",
    slug: "saas",
    description: "B2B software, workflow tools, dashboards and vertical SaaS products.",
    keywords: ["saas", "software", "app", "platform", "dashboard", "workflow", "crm", "erp", "tool", "team", "workspace", "productivity", "automation", "analytics", "report"],
    relatedTerms: ["workspace", "workflow", "dashboard", "automate", "insight", "report", "board", "task", "project", "pipeline", "suite", "ops"],
    prefixes: ["flow", "stack", "suite", "ops", "workspace", "grid", "canvas"],
    suffixes: ["app", "hq", "works", "suite", "desk", "board", "flow", "stack"],
    patterns: defaultPatterns,
    avoid: [],
    semanticWeight: 1,
  },
  {
    id: "cloud",
    name: "Cloud & Infrastructure",
    slug: "cloud",
    description: "Hosting, storage, networking, observability and developer infrastructure.",
    keywords: ["cloud", "host", "hosting", "server", "infra", "infrastructure", "storage", "network", "deploy", "kubernetes", "container", "compute", "backup", "cdn", "devops"],
    relatedTerms: ["compute", "storage", "deploy", "cluster", "node", "edge", "scale", "uptime", "latency", "backup", "snapshot", "region", "mesh", "gateway"],
    prefixes: ["nimbus", "stratus", "cirrus", "azure", "core", "node"],
    suffixes: ["cloud", "host", "stack", "ops", "infra", "compute", "deploy"],
    patterns: defaultPatterns,
    avoid: ["cheap"],
    semanticWeight: 1.05,
  },
  {
    id: "developer-tools",
    name: "Developer Tools",
    slug: "developer-tools",
    description: "SDKs, CI/CD, testing, code review, terminals and API platforms.",
    keywords: ["dev", "developer", "code", "api", "sdk", "git", "repo", "build", "deploy", "test", "debug", "terminal", "cli", "lint", "compile"],
    relatedTerms: ["commit", "branch", "merge", "build", "deploy", "debug", "runtime", "syntax", "parse", "query", "schema", "script", "kit", "shell"],
    prefixes: ["code", "byte", "syntax", "kernel", "shell", "proto"],
    suffixes: ["dev", "sdk", "api", "cli", "kit", "labs", "runtime", "tools"],
    patterns: defaultPatterns,
    avoid: [],
    semanticWeight: 1,
  },
  {
    id: "ecommerce",
    name: "E-commerce & Retail",
    slug: "ecommerce",
    description: "Online stores, marketplaces, checkout, dropshipping and retail brands.",
    keywords: ["shop", "store", "ecommerce", "commerce", "cart", "checkout", "retail", "market", "marketplace", "product", "order", "catalog", "sell", "buy", "merchant"],
    relatedTerms: ["cart", "checkout", "catalog", "order", "fulfil", "inventory", "shelf", "boutique", "supply", "vendor", "basket", "deal"],
    prefixes: ["cart", "shelf", "bazaar", "market", "vendor", "retail"],
    suffixes: ["shop", "store", "market", "cart", "boutique", "outlet", "goods", "deals"],
    patterns: defaultPatterns,
    avoid: [],
    semanticWeight: 1,
  },
  {
    id: "real-estate",
    name: "Real Estate & Property",
    slug: "real-estate",
    description: "Property listings, rentals, proptech, interiors and home services.",
    keywords: ["home", "estate", "property", "realty", "rent", "rental", "lease", "house", "apartment", "interior", "mortgage", "landlord", "tenant", "room", "nest"],
    relatedTerms: ["property", "estate", "realty", "dwelling", "abode", "nest", "hearth", "manor", "villa", "lot", "deed", "tenant", "landlord", "listing"],
    prefixes: ["casa", "domus", "hearth", "manor", "villa", "terra"],
    suffixes: ["home", "house", "estate", "realty", "property", "nest", "abode", "dwell"],
    patterns: defaultPatterns,
    avoid: [],
    semanticWeight: 1,
  },
  {
    id: "health",
    name: "Health & Wellness",
    slug: "health",
    description: "Clinical tools, telehealth, wellness, fitness and mental health.",
    keywords: ["health", "medical", "clinic", "care", "doctor", "patient", "therapy", "mental", "wellness", "fitness", "gym", "nutrition", "diet", "sleep", "meditate"],
    relatedTerms: ["care", "clinic", "vital", "recovery", "therapy", "balance", "pulse", "breath", "wellness", "strength", "clarity", "restore"],
    prefixes: ["vital", "vita", "pulse", "heal", "serene", "calm"],
    suffixes: ["health", "care", "clinic", "wellness", "fit", "vital", "med", "therapy"],
    patterns: defaultPatterns,
    avoid: ["cure", "guaranteed"],
    semanticWeight: 1,
  },
  {
    id: "education",
    name: "Education & Learning",
    slug: "education",
    description: "Schools, courses, tutoring, assessment and corporate learning.",
    keywords: ["edu", "education", "learn", "learning", "school", "course", "teach", "tutor", "study", "academy", "student", "exam", "skill", "training", "lesson"],
    relatedTerms: ["academy", "course", "lesson", "study", "tutor", "campus", "skill", "quiz", "mentor", "cohort", "syllabus", "practice"],
    prefixes: ["scholar", "lumen", "sage", "campus", "mentor"],
    suffixes: ["academy", "learn", "school", "course", "ed", "campus", "study", "tutor"],
    patterns: defaultPatterns,
    avoid: ["exam-pass"],
    semanticWeight: 1,
  },
  {
    id: "travel",
    name: "Travel & Hospitality",
    slug: "travel",
    description: "Booking, itineraries, stays, flights and experiences.",
    keywords: ["travel", "trip", "tour", "hotel", "stay", "flight", "booking", "vacation", "holiday", "destination", "journey", "resort", "hostel", "itinerary"],
    relatedTerms: ["journey", "voyage", "route", "itinerary", "destination", "stay", "lodge", "escape", "wander", "compass", "harbor", "trail"],
    prefixes: ["voyage", "compass", "nomad", "wander", "terra"],
    suffixes: ["travel", "trip", "stay", "tour", "voyage", "escape", "journey", "lodge"],
    patterns: defaultPatterns,
    avoid: [],
    semanticWeight: 1,
  },
  {
    id: "food",
    name: "Food & Beverage",
    slug: "food",
    description: "Restaurants, delivery, recipes, hospitality supply and food brands.",
    keywords: ["food", "restaurant", "kitchen", "recipe", "cook", "cafe", "coffee", "delivery", "meal", "menu", "chef", "bakery", "bar", "brew", "eat"],
    relatedTerms: ["kitchen", "table", "plate", "harvest", "spice", "brew", "feast", "bistro", "pantry", "grill", "roast"],
    prefixes: ["harvest", "pantry", "spice", "ember", "grove"],
    suffixes: ["kitchen", "eats", "table", "cafe", "grill", "market", "foods", "pantry"],
    patterns: defaultPatterns,
    avoid: [],
    semanticWeight: 1,
  },
  {
    id: "marketing",
    name: "Marketing & Growth",
    slug: "marketing",
    description: "SEO, content, advertising, CRM, email and analytics platforms.",
    keywords: ["marketing", "seo", "content", "growth", "brand", "ads", "advertise", "campaign", "email", "social", "audience", "traffic", "funnel", "convert", "lead"],
    relatedTerms: ["campaign", "audience", "funnel", "brand", "reach", "engage", "convert", "signal", "insight", "growth", "pulse", "lift"],
    prefixes: ["signal", "reach", "lift", "brand", "spark"],
    suffixes: ["growth", "marketing", "media", "reach", "ads", "studio", "agency", "labs"],
    patterns: defaultPatterns,
    avoid: [],
    semanticWeight: 1,
  },
  {
    id: "security",
    name: "Security & Privacy",
    slug: "security",
    description: "Cybersecurity, identity, compliance, monitoring and privacy tooling.",
    keywords: ["security", "secure", "cyber", "privacy", "identity", "auth", "encrypt", "threat", "compliance", "audit", "guard", "firewall", "vpn", "shield", "risk"],
    relatedTerms: ["shield", "guard", "vault", "sentinel", "watch", "trust", "cipher", "audit", "defense", "integrity", "perimeter"],
    prefixes: ["cipher", "sentinel", "vault", "guard", "aegis"],
    suffixes: ["guard", "shield", "secure", "defense", "vault", "sentry", "trust", "safe"],
    patterns: defaultPatterns,
    avoid: ["hack"],
    semanticWeight: 1.05,
  },
  {
    id: "crypto",
    name: "Crypto & Web3",
    slug: "crypto",
    description: "Blockchains, wallets, exchanges, DeFi and NFTs.",
    keywords: ["crypto", "blockchain", "chain", "token", "defi", "wallet", "nft", "web3", "mining", "stake", "ledger", "dex", "swap", "dao"],
    relatedTerms: ["chain", "token", "stake", "mint", "ledger", "node", "swap", "vault", "protocol", "genesis", "block", "hash"],
    prefixes: ["chain", "block", "genesis", "hash", "mint"],
    suffixes: ["chain", "token", "swap", "dao", "labs", "protocol", "wallet", "dex"],
    patterns: defaultPatterns,
    avoid: ["guaranteed", "profit"],
    semanticWeight: 1,
  },
  {
    id: "gaming",
    name: "Gaming & Esports",
    slug: "gaming",
    description: "Game studios, streaming, esports teams and player tools.",
    keywords: ["game", "gaming", "gamer", "esports", "play", "player", "stream", "twitch", "arena", "quest", "level", "pixel", "arcade", "console"],
    relatedTerms: ["arena", "quest", "level", "pixel", "arcade", "combo", "loot", "guild", "league", "spawn", "respawn"],
    prefixes: ["pixel", "arcade", "quest", "arena", "combo"],
    suffixes: ["games", "arena", "play", "guild", "quest", "arcade", "league", "studio"],
    patterns: defaultPatterns,
    avoid: [],
    semanticWeight: 1,
  },
  {
    id: "logistics",
    name: "Logistics & Delivery",
    slug: "logistics",
    description: "Shipping, freight, last-mile delivery and supply chain.",
    keywords: ["logistics", "shipping", "freight", "delivery", "courier", "fleet", "warehouse", "supply", "chain", "route", "dispatch", "cargo", "track", "parcel"],
    relatedTerms: ["route", "fleet", "dispatch", "parcel", "cargo", "depot", "freight", "transit", "track", "haul", "lane"],
    prefixes: ["route", "fleet", "cargo", "transit", "depot"],
    suffixes: ["logistics", "shipping", "delivery", "freight", "route", "fleet", "dispatch", "cargo"],
    patterns: defaultPatterns,
    avoid: [],
    semanticWeight: 1,
  },
  {
    id: "media",
    name: "Media & Publishing",
    slug: "media",
    description: "News, newsletters, podcasts, video and creator platforms.",
    keywords: ["media", "news", "publish", "publishing", "blog", "podcast", "video", "audio", "stream", "creator", "newsletter", "magazine", "channel", "editorial"],
    relatedTerms: ["press", "story", "column", "editorial", "broadcast", "channel", "studio", "feed", "signal", "voice", "report"],
    prefixes: ["press", "story", "signal", "voice", "studio"],
    suffixes: ["media", "press", "news", "studio", "daily", "journal", "feed", "post"],
    patterns: defaultPatterns,
    avoid: [],
    semanticWeight: 1,
  },
];

export const INDUSTRY_INDEX: Map<string, Industry> = new Map(INDUSTRIES.map((industry) => [industry.id, industry]));

export function getIndustry(id: string): Industry | undefined {
  return INDUSTRY_INDEX.get(id);
}

/** Action words used by the `root-action` pattern. */
export const ACTION_WORDS: string[] = [
  "go", "run", "flow", "build", "make", "grow", "send", "find", "track", "sync", "lift", "spark",
  "connect", "launch", "shift", "boost", "move", "start", "scale", "craft",
];

/** Audience words used by the `root-audience` pattern. */
export const AUDIENCE_WORDS: string[] = [
  "for", "pro", "team", "teams", "people", "makers", "builders", "founders", "creators", "parents",
  "students", "owners", "experts", "everyone", "business", "shops",
];

/** Product-type words used by the `root-product` pattern. */
export const PRODUCT_WORDS: string[] = [
  "app", "kit", "suite", "cloud", "api", "studio", "desk", "board", "engine", "platform",
  "portal", "toolkit", "console", "workspace", "dashboard", "service",
];
