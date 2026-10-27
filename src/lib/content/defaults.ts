/**
 * Default CMS content.
 *
 * This is the *offline content pack*: what the site renders before a Supabase project is
 * configured, and what `supabase/seed/seed.sql` inserts. The admin CMS edits the database;
 * these defaults remain the fallback for static builds that cannot reach it.
 *
 * The text is original product copy written for this build. It contains no invented
 * statistics, testimonials, ratings or claims.
 */

export type DefaultPage = {
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  seoTitle: string;
  metaDescription: string;
};

export const LEGAL_DISCLAIMER = `<p><em>Last reviewed: this document is part of the product build and must be reviewed by a qualified professional before you rely on it publicly. It is a working draft, not legal advice.</em></p>`;

export const DEFAULT_PAGES: DefaultPage[] = [
  {
    slug: "about",
    title: "About DomainFits",
    excerpt: "A naming tool built around explainable rules instead of random word lists.",
    seoTitle: "About DomainFits — explained domain naming",
    metaDescription:
      "DomainFits combines deterministic naming rules, industry dictionaries and documented scoring so you can understand why a domain name works.",
    body: `<h2>Why we built this</h2>
<p>Most domain generators produce a pile of names and no explanation. You are left guessing which ones are pronounceable, which ones mean something in your industry, and which ones are simply two random words glued together.</p>
<p>DomainFits takes the opposite approach. Every candidate is produced by a documented strategy — direct combination, semantic expansion, phrase templates, syllable-boundary blending or phonetic construction — and every score is broken into named factors with visible weights.</p>
<h2>What we do not claim</h2>
<ul>
<li>A high score is not an appraisal, valuation, or investment recommendation.</li>
<li>A name being unregistered is not advice that you should register it.</li>
<li>We do not provide trademark clearance. Screening signals are heuristic only.</li>
<li>Availability changes constantly. Every result states when it was checked and by which provider.</li>
</ul>
<h2>How the product is built</h2>
<p>The naming engine is plain TypeScript with no external dependencies, so it runs in your browser and can be reused by an API. The site is a static frontend deployed to shared hosting, with Postgres (Supabase) powering content, accounts and administration.</p>`,
  },
  {
    slug: "contact",
    title: "Contact",
    excerpt: "How to reach the team, and what we can and cannot help with.",
    seoTitle: "Contact DomainFits — support and feedback",
    metaDescription: "Contact the DomainFits team about naming data, corrections, privacy requests or partnership enquiries.",
    body: `<h2>Get in touch</h2>
<p>Email <a href="mailto:hello@example.com">hello@example.com</a> and we will respond within five working days. Replace this address with your own before launch — it is seeded as a placeholder.</p>
<h2>What we can help with</h2>
<ul>
<li>Corrections to dictionary, industry or extension data.</li>
<li>Privacy requests, including deletion of account data.</li>
<li>Reporting a bug with a reproducible example.</li>
<li>Reporting a name the engine should never generate.</li>
</ul>
<h2>What we cannot help with</h2>
<p>We cannot register domains, act as a registrar, provide legal or trademark advice, or guarantee that a name will be approved by any advertising programme.</p>`,
  },
  {
    slug: "privacy",
    title: "Privacy policy",
    excerpt: "What we collect, why, and how to remove it.",
    seoTitle: "Privacy policy — DomainFits",
    metaDescription: "How DomainFits handles data: anonymous usage by default, first-party analytics, no advertising trackers by default.",
    body: `${LEGAL_DISCLAIMER}
<h2>Anonymous first</h2>
<p>You can generate names without an account. In that mode your keywords, results and favourites stay in your browser's local storage and are never sent to our servers.</p>
<h2>What we collect when you use the site</h2>
<ul>
<li><strong>Usage events:</strong> event type, page path and non-identifying counts (for example, how many names a generation produced). These are stored in our own database, not a third-party tracker.</li>
<li><strong>Technical logs:</strong> our hosting provider records standard request logs including IP address, as any web server does.</li>
</ul>
<h2>Accounts</h2>
<p>If you create an account we store your email address, a hashed password handled by our authentication provider, your saved names and collections. You can export or delete this data at any time.</p>
<h2>Advertising and affiliate links</h2>
<p>Advertising is disabled unless an administrator enables it. When enabled, the advertising provider may set cookies or read identifiers; a consent prompt is shown where required by law. Affiliate clicks are recorded as an aggregate count without storing your IP address.</p>
<h2>Internationalised names</h2>
<p>Unicode keywords are converted to an ASCII approximation in your browser. The original text is not transmitted unless you save it to an account.</p>
<h2>Your choices</h2>
<p>Clear your browser storage to delete anonymous data. Contact us to request deletion of account data.</p>`,
  },
  {
    slug: "terms",
    title: "Terms of service",
    excerpt: "The rules for using the generator, data and exports.",
    seoTitle: "Terms of service — DomainFits",
    metaDescription: "Terms covering acceptable use, scoring disclaimers, availability accuracy and affiliate disclosure for DomainFits.",
    body: `${LEGAL_DISCLAIMER}
<h2>Service description</h2>
<p>DomainFits provides naming suggestions, heuristic quality scores and optional availability lookups. It is a research tool, not a registrar, broker, appraiser or legal adviser.</p>
<h2>No guarantee of availability or registration</h2>
<p>Domain availability changes constantly. A result reported as available may be registered at any moment. Always confirm with a registrar before paying for anything.</p>
<h2>Acceptable use</h2>
<ul>
<li>Do not use the service to generate names intended to impersonate people or brands.</li>
<li>Do not attempt to overload, scrape at scale, or bypass rate limits.</li>
<li>Do not use the optional API in violation of the limits attached to your key.</li>
</ul>
<h2>Intellectual property</h2>
<p>Names generated by the engine are yours to use; you are responsible for checking that they do not infringe existing rights. The dictionaries, scoring model and interface remain our property.</p>
<h2>Limitation of liability</h2>
<p>The service is provided "as is". To the extent permitted by law we exclude liability for lost profits or for decisions made using the tool.</p>`,
  },
  {
    slug: "affiliate-disclosure",
    title: "Affiliate disclosure",
    excerpt: "How registrar links work and how they are labelled.",
    seoTitle: "Affiliate disclosure — DomainFits",
    metaDescription: "DomainFits may earn a commission when you register a domain through a labelled registrar link. Availability is never influenced by commission.",
    body: `<h2>The short version</h2>
<p>Some registrar links on this site are affiliate links. If you register a domain after clicking one, we may receive a commission at no extra cost to you.</p>
<h2>What that does not affect</h2>
<ul>
<li><strong>Availability results.</strong> Checks go to registry data, not to whoever pays the most. A domain is never marked "available" because of an affiliate relationship.</li>
<li><strong>Ranking.</strong> Our scoring model has no commercial input. Registrar routing is applied only after you click a name.</li>
<li><strong>Labels.</strong> Affiliate destinations are labelled as such, and only configured providers with validated URL templates are ever used.</li>
</ul>
<h2>Where links appear</h2>
<p>On result rows and detail panels, but only for extensions where an administrator has configured a provider. If no provider is configured, no link is shown.</p>`,
  },
  {
    slug: "how-it-works",
    title: "How the naming engine works",
    excerpt: "The strategies, constraints and scoring model behind every suggestion.",
    seoTitle: "How the DomainFits naming engine works",
    metaDescription:
      "A walkthrough of the naming pipeline: normalisation, semantic expansion, generation strategies, constraint filtering and explainable scoring.",
    body: `<h2 id="pipeline">The pipeline</h2>
<ol>
<li><strong>Normalise.</strong> Keywords are trimmed, lower-cased and transliterated to ASCII. Invalid input is rejected with a reason instead of being silently rewritten.</li>
<li><strong>Expand.</strong> The engine detects industries from your keyword and adds industry vocabulary, synonyms and neutral concepts. Expansion can be switched off.</li>
<li><strong>Generate.</strong> Six complementary strategies propose candidates: direct combination, semantic combination, phrase templates, portmanteau blending, invented forms and external (AI) suggestions.</li>
<li><strong>Filter.</strong> Every candidate must pass label rules, your length and character constraints, exclusion lists and position rules. Reserved names and blocked fragments are always rejected.</li>
<li><strong>De-duplicate.</strong> Candidates are compared on a normalised key so spelling variants cannot appear twice.</li>
<li><strong>Score and rank.</strong> Quality and brandability are computed separately from named factors, then combined for ordering.</li>
</ol>
<h2 id="scoring">Scoring</h2>
<p>Quality weighs semantic relevance (22%), pronounceability (16%), word quality (14%), spelling simplicity (12%), length suitability (12%), industry relevance (10%), memorability (8%) and constraint fit (6%). Brandability weighs pronounceability and memorability at 20% each, spelling and distinctiveness at 15% each, semantic relevance at 15%, length at 10% and profile fit at 5%.</p>
<p>Every factor exposes its raw score, weight, contribution and a one-line explanation. Weights live in a versioned profile so a ranking change can always be traced.</p>
<p>These are heuristics derived from letter patterns and dictionary membership. They are not linguistic research, appraisals, or predictions of commercial success.</p>
<h2 id="availability">Availability</h2>
<p>Availability is a separate engine with provider adapters. It distinguishes <em>available_verified</em>, <em>registered</em>, <em>unavailable</em>, <em>premium_or_special_pricing</em>, <em>unknown</em>, <em>check_failed</em>, <em>rate_limited</em> and <em>unsupported_tld</em>.</p>
<p>A missing RDAP record or absent DNS answer is never treated as proof that a domain can be registered. Unknown is reported as unknown, and every result carries its provider and timestamp.</p>`,
  },
  {
    slug: "faq",
    title: "Frequently asked questions",
    excerpt: "Short answers about scores, availability, accounts and exports.",
    seoTitle: "DomainFits FAQ — scores, availability and exports",
    metaDescription: "Answers about naming scores, availability statuses, exports, accounts and advertising on DomainFits.",
    body: `<h2>Does a high score mean the domain is available?</h2>
<p>No. Quality and brandability are computed without any availability data. A name scoring 95 may already be registered; an available name may score 20.</p>
<h2>Why does a name say "not checked"?</h2>
<p>Because no registry lookup has run for it yet. We would rather show "not checked" than guess.</p>
<h2>Can I export my results?</h2>
<p>Yes — TXT (one domain per line), CSV with spreadsheet-safe escaping, and JSON with the full score breakdown.</p>
<h2>Do I need an account?</h2>
<p>No. Generation, filters and exports work anonymously, and favourites are stored in your browser. An account adds cross-device saving and collections.</p>
<h2>Is the AI wording literal?</h2>
<p>No. AI-assisted suggestions are optional, require a configured provider, and always pass through the same validation and scoring as deterministic candidates.</p>`,
  },
  {
    slug: "cookies",
    title: "Cookies and local storage",
    excerpt: "What is stored in your browser and how to clear it.",
    seoTitle: "Cookies and local storage — DomainFits",
    metaDescription: "DomainFits stores your theme preference, favourites and recent searches in your browser. Advertising cookies only appear if enabled with consent.",
    body: `<h2>Strictly necessary</h2>
<p>If you sign in, an authentication session is stored by our auth provider. Without it the admin area cannot function.</p>
<h2>Preferences</h2>
<ul>
<li><code>domainfits.theme</code> — your light/dark/system choice.</li>
<li><code>domainfits.favorites.v1</code> — names you saved while anonymous.</li>
<li><code>domainfits.recent-searches.v1</code> — your last few searches, used to reopen them.</li>
</ul>
<h2>Advertising</h2>
<p>Advertising is off by default. If an administrator enables it, a consent prompt appears before any advertising script loads where the law requires consent.</p>
<h2>Clearing</h2>
<p>Clearing site data in your browser removes all of the above. Account data is deleted separately on request.</p>`,
  },
];

