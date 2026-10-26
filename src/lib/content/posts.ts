/**
 * Default blog content (offline pack).
 *
 * One genuinely useful article so the blog, its listing page, the sitemap and the article
 * structured data can all be verified end to end. The admin CMS creates further posts in
 * the database; this default remains the fallback for builds without database access.
 */

export type DefaultPost = {
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  category: string;
  tags: string[];
  authorName: string;
  publishedAt: string;
  seoTitle: string;
  metaDescription: string;
  faq: Array<{ question: string; answer: string }>;
};

export const DEFAULT_POSTS: DefaultPost[] = [
  {
    slug: "how-to-judge-a-domain-name",
    title: "How to judge a domain name without guessing",
    excerpt:
      "A practical framework for evaluating a name: pronounceability, spelling risk, length, distinctiveness and semantic fit — with the trade-offs each one creates.",
    category: "Naming",
    tags: ["brandability", "scoring", "methodology"],
    authorName: "DomainFits",
    publishedAt: "2026-10-01T09:00:00.000Z",
    seoTitle: "How to judge a domain name without guessing",
    metaDescription:
      "A practical, explainable framework for evaluating domain names: pronounceability, spelling risk, length, distinctiveness and semantic fit.",
    body: `<p>Most domain advice collapses into taste. “Say it out loud”, “keep it short”, “make it memorable” — all reasonable, none of it actionable when you have two hundred candidates and an afternoon. This article turns those instincts into five checks you can apply consistently, including the cases where the checks fight each other.</p>

<h2>1. Can somebody spell it after hearing it once?</h2>
<p>This is the check that most names fail. Read the candidate to somebody who cannot see it and ask them to type it. Names with ambiguous sounds — “ph” versus “f”, doubled consonants, silent letters, “c” versus “k” — leak traffic permanently, because a misspelt attempt either reaches a competitor or reaches nothing.</p>
<p>Heuristics that help: prefer one obvious spelling of every sound, avoid strings of more than two vowels, and be sceptical of names whose second half only works in writing.</p>

<h2>2. Does it survive being said in a noisy room?</h2>
<p>Short names with clear consonant boundaries are easier to repeat. A three-syllable name with two stressed vowels is harder than a two-syllable name with one stressed vowel, even when both are the same length on paper. This is why syllable count is a better predictor than character count once you pass seven characters.</p>

<h2>3. Is it distinctive enough to be remembered?</h2>
<p>Distinctiveness is the trade-off against clarity. A name built from two common dictionary words is immediately understandable and almost impossible to protect or recall distinctly. An invented form is distinctive but carries no meaning until you spend money teaching it.</p>
<p>The practical middle: keep one meaningful component and let the other be unusual — <em>root-preserving</em> and <em>root-inspired</em> strategies in our engine exist precisely for this.</p>

<h2>4. Does the length match how it will be used?</h2>
<p>A name that appears in a mobile address bar, a podcast ad and a terminal prompt has three different length budgets. If your primary channel is spoken, every character has a cost; if it is written in a purchase flow, mild length is tolerable. Decide the channel before you judge the name.</p>

<h2>5. Is the meaning still true after the product changes?</h2>
<p>Descriptive names age badly when products expand. A name that encodes “invoices” becomes a liability when you sell cash-flow forecasting. Prefer a name tied to the customer’s problem rather than to your current feature set.</p>

<h2>Where the checks conflict</h2>
<ul>
<li><strong>Distinctive versus pronounceable.</strong> Invented names can be pleasant or hostile depending on their sound shape; the difference is usually a single awkward consonant cluster.</li>
<li><strong>Short versus meaningful.</strong> Every removed character removes information.</li>
<li><strong>Descriptive versus durable.</strong> Clarity today can become baggage in two years.</li>
</ul>
<p>No score can resolve these for you, which is why our tool exposes each factor separately with its weight, rather than presenting a single authoritative number. The number is a sorting device; the factors are the decision.</p>

<h2>What a score cannot tell you</h2>
<p>Three things worth stating plainly:</p>
<ol>
<li><strong>Availability.</strong> Quality and availability are independent. A brilliant name is often already registered, and an available name can be weak.</li>
<li><strong>Trademark risk.</strong> Screening is not clearance. A name that passes a heuristic check can still infringe.</li>
<li><strong>Resale value.</strong> Nothing about a naming score predicts what somebody would pay for a domain.</li>
</ol>
<p>Use the score to order the list. Use the checks above to choose from the top of it.</p>`,
    faq: [
      {
        question: "Should I always choose the shortest name?",
        answer:
          "No. Short names are easier to type but often less distinctive and more likely to be registered. Length is one factor among several, and it should be judged against the channel where the name will be used.",
      },
      {
        question: "Is a brandability score a prediction of success?",
        answer:
          "No. It is a documented heuristic based on letter patterns, length and memorability cues. It cannot predict traction, availability, trademark conflicts or commercial value.",
      },
    ],
  },
];
