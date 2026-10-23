# Day 47 editorial pack — Security & Reliability

## A. Editorial brief

- **Audience:** website owners, developers, and readers who need a practical explanation of spf, dkim and dmarc explained.
- **Reader problem:** understand the topic and make a safe, informed design or operating decision without mistaking a conceptual example for a live test or provider guarantee.
- **Search intent:** informational / practical decision support.
- **Unique angle:** connect the core concept to implementation boundaries, failure cases, and a domain-tool example without claiming unverified service behavior.
- **Research status:** No external pages were live-fetched for this draft. References below are suggested further reading, not sources claimed to have been consulted. Check current standards, provider limits, policies, and jurisdiction-specific rules before publication.

## B. SEO metadata

- **SEO title:** SPF, DKIM and DMARC Explained: Protecting Your Domain From Email Spoofing | DomainCraft
- **H1:** SPF, DKIM and DMARC Explained: Protecting Your Domain From Email Spoofing
- **Slug:** `spf-dkim-dmarc-email-authentication`
- **Static article file:** [`blog-49.html`](../blog-49.html) — remains hidden until `published: true`.
- **Meta description:** Understand email authentication, DNS records, alignment, aggregate reports, staged policies, and a domain-owner audit checklist.
- **Target topics:** SPF, DKIM, DMARC
- **Category:** Security & Reliability
- **Draft date in config:** 2026-10-23; change to the intended publication date before publishing.
- **Featured image:** `/assets/img/blog/feature-spf-dkim-dmarc-email-authentication.svg`
- **Image alt:** Email authentication flow checking SPF, DKIM signatures, and DMARC alignment against DNS.
- **Estimated reading time:** 11 minutes; calculated from the draft at approximately 200 words per minute.

## C. Complete article

- Markdown source: [`day-47.md`](../articles/day-47.md).
- Generated static page: [`blog-49.html`](../blog-49.html).
- **Draft length:** 2,095 words (headings, tables, and code examples included in the count).
- The page is marked `noindex` and gated by the client-side publish controller while unpublished. This is a presentation and indexing control, not confidentiality for files deployed to a public static host.

## D. Visual plan and implementation

- **Featured visual:** original, local 1200 × 675 SVG workflow illustration at `/assets/img/blog/feature-spf-dkim-dmarc-email-authentication.svg`; it is conceptual, not measured data.
- **Alt text:** Email authentication flow checking SPF, DKIM signatures, and DMARC alignment against DNS.
- **In-article visual:** architecture diagrams, examples, tables, and checklists are explicitly illustrative; no fictional dashboard data or test results are presented as observations.
- **Production note:** verify legibility at card size, contrast, screen-reader description, and SVG rendering on the target host. The asset has no external runtime dependency.

## E. Internal linking plan

- Related live guides: [`Building Trust on a Domain Tools Website`](../blog-31.html) and [`How to Build a Long-Term Domain Knowledge Website`](../blog-32.html).
- Link to the [published archive](../index.html) for the wider collection.
- Link to the [editorial disclaimer](../../pages/disclaimer.html) wherever readers might mistake an example for a live result or professional advice.
- Do not link to another unpublished draft until its status is changed and its page is verified.

## F. Sources and verification

**Actually consulted:** none; no live external pages were fetched for this draft. The following are recommended starting points for a source review, not consulted sources:
- [Sender Policy Framework (SPF), RFC 7208](https://www.rfc-editor.org/rfc/rfc7208) — recommended for verification; not live-fetched during drafting.
- [DomainKeys Identified Mail (DKIM), RFC 6376](https://www.rfc-editor.org/rfc/rfc6376) — recommended for verification; not live-fetched during drafting.
- [IETF DMARC working-group documents; verify the current published standard](https://datatracker.ietf.org/wg/dmarc/documents/) — recommended for verification; not live-fetched during drafting.

Before publication, follow each reference, confirm its current version and relevance, and add a date or scope note when the guidance can change. Check provider-specific pricing, limits, authentication behavior, and terms directly with the provider. Do not add market statistics, quotes, or first-hand testing unless they are real and documented.

## G. Final editorial audit

- The draft uses a plain-language structure with practical examples, headings, lists, a summary, and a conclusion.
- Hypothetical services and workflows are labeled as examples; no provider integration, measured performance, quote, customer outcome, or test run is invented.
- Technical limitations and security/privacy considerations are stated; availability, legal safety, rankings, revenue, and commercial outcomes are not guaranteed.
- The local cover has descriptive alt text; page metadata and structured data use the same title, description, date, and image.
- **Before production:** verify the recommended sources and current implementation details, update the publication date and byline, replace the `example.com` canonical origin, check internal links and accessibility, and review the page on the deployed host. Obtain specialist security, legal, financial, or privacy review where the subject warrants it.
