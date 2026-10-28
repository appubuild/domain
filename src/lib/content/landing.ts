/**
 * Landing-page copy.
 *
 * Kept as data (not JSX) for one reason: the FAQ is rendered twice — once as visible text and
 * once as `FAQPage` structured data — and Google treats a mismatch between the two as a
 * structured-data error. One array means one source. It also gives the tests something to assert
 * against, which matters here because this page must not advertise anything the product does not
 * do: `tests/content/landing.test.ts` checks every claim against the shipped capabilities.
 */

export type LandingStep = { title: string; body: string };

/** The six stages the engine actually runs, in order. Mirrors `src/lib/brain/pipeline.ts`. */
export const HOW_IT_WORKS: LandingStep[] = [
  {
    title: "Normalise the root",
    body: "Your word is folded to ASCII, lower-cased and checked against the label rules. Exactly one primary root is accepted — a second one is rejected with a reason, because two roots produce names that belong to neither.",
  },
  {
    title: "Analyse the root",
    body: "The engine classifies it as a word, an abbreviation or a coined form, then reads meaning, variants, syllables and the industries it points at. Every conclusion is shown, and you can override the industry and the style.",
  },
  {
    title: "Expand semantically",
    body: "Dictionaries add industry vocabulary, synonyms and neutral concepts. Expansion can be disabled, and a manual override replaces the automatic read entirely.",
  },
  {
    title: "Generate with the chosen styles",
    body: "Root + partner, partner + root, prefix + root, root + suffix, three-part compounds and shortened or coined forms. Partner length is filtered on the partner word only, and 2, 3, 4 and 5 letters can be selected at the same time.",
  },
  {
    title: "Filter, de-duplicate, score",
    body: "Every candidate passes label rules, your length and character constraints and the exclusion lists. Duplicates collapse on a normalised key. Quality and brandability are then scored from named factors with visible weights.",
  },
  {
    title: "Check availability on request",
    body: "Nothing is assumed. A lookup returns the registry's own answer and is labelled available, registered, premium, unknown, failed or unsupported — and the label always carries its provider, timestamp and cache state.",
  },
];

export type LandingFeature = { title: string; body: string };

/** Only shipped behaviour. Anything removed from the product must be removed from here. */
export const FEATURES: LandingFeature[] = [
  {
    title: "One analysed root",
    body: "A single primary root, classified and expanded with dictionaries you can inspect — not a black box. Multiple roots are refused rather than silently merged.",
  },
  {
    title: "Partner lengths 2 · 3 · 4 · 5",
    body: "Filter the partner word by its own alphabetic length — 2, 3, 4 and 5 letters, with any combination of the four active at once. The length of the finished name stays a separate constraint.",
  },
  {
    title: "Six naming styles",
    body: "Root + partner, partner + root, prefix + root, root + suffix, compounds and shortened or coined forms — each mapped to the strategies that produce it, with a recommendation based on your root.",
  },
  {
    title: "Exact quantities, honest failures",
    body: "Ask for 100, 500 or 1,000 names. The engine dedupes without discarding alternatives, and if a constraint combination cannot reach the number it says so and explains which constraint is the ceiling.",
  },
  {
    title: "Reproducible by seed",
    body: "Every run is deterministic and the inputs are encoded in the URL, so a shared link reproduces the same list — and the same scores — instead of a different sample.",
  },
  {
    title: "Explained scores",
    body: "Quality and brandability are broken into pronounceability, spelling simplicity, memorability, semantic relevance, length fit and more, each with its weight and contribution.",
  },
  {
    title: "Availability without guesswork",
    body: "Checks run through our registry service. Statuses that mean \"no answer\" are never displayed as available, and each result records the provider and the time it was checked.",
  },
  {
    title: "Export and continue",
    body: "Copy or export the filtered list as CSV, TXT or JSON, favourites kept in your browser, and shareable URLs for every search.",
  },
];

export type LandingFaq = { question: string; answer: string };

/** Answers must match the product. See tests/content/landing.test.ts. */
export const LANDING_FAQ: LandingFaq[] = [
  {
    question: "Does a high score mean the domain is available?",
    answer:
      "No. Scoring never looks at availability. A name can score 95 and already be registered, or score 30 and be free. Availability is only ever reported after a registry lookup, and never inferred from a failed one.",
  },
  {
    question: "Why does a name say “not checked”?",
    answer:
      "Because no lookup has run for it yet. Checks are started explicitly — per name or for the whole filtered list — so the page never implies a name is free when nothing was asked.",
  },
  {
    question: "Can I really get exactly 1,000 names?",
    answer:
      "Yes, when your constraints leave at least 1,000 distinct valid candidates. If they do not, the engine returns everything it could build and tells you which constraint is limiting the count — adding partner lengths, enabling compounds or widening the length range raises it.",
  },
  {
    question: "Do I need an account?",
    answer:
      "No. Generation, filtering, exports and availability checks work without signing in, and favourites stay in your browser. An account exists for the admin CMS and for saved searches across devices.",
  },
  {
    question: "Can I use two roots at once?",
    answer:
      "No — the generator takes one primary root. A second root makes the output read like two unrelated names glued together, so the form rejects it and suggests a partner word instead.",
  },
  {
    question: "Where does the availability answer come from?",
    answer:
      "From public RDAP registry data, queried by our Supabase Edge Function and cached in Postgres. Premium and reserved names are reported separately, and a timeout is reported as a failed check, not as availability.",
  },
];
