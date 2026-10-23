# DomainCraft static website

A dependency-free static-site project built around the supplied **Smart AI Domain Generator** HTML (the generator is rules-based and does not call an AI model). It includes the landing page, generator, a config-driven blog archive, 30 existing series articles plus two naming guides, 20 additional long-form technical drafts, local featured illustrations, editorial packs, publisher-information pages, SEO metadata, structured data, a sitemap, `robots.txt`, and inactive AdSense/analytics setup notes.

## Architecture

```text
/
├── index.html                         Landing page, SEO guide, FAQ schema
├── tools/domain-generator.html        Integrated domain generator
├── blog/
│   ├── index.html                     Client-rendered archive, filters, pagination
│   ├── blog-01.html … blog-32.html    Existing live guides
│   ├── blog-33.html … blog-52.html    Day 31–50 static articles; publication-gated
│   ├── blog-config.json               Single source of post metadata and publish flags
│   ├── articles/day-02.md … day-50.md Markdown article sources
│   ├── editorial-packs/day-02.md … day-50.md Editorial briefs, SEO, sources and audits
│   └── editorial-calendar.md          Editorial plan and status for Days 1–50
├── tools/
│   ├── domain-generator.html          (see /tools) — integrated generator page
│   └── build_draft_blog.py            Standard-library renderer / pack / sitemap helper
├── assets/
│   ├── css/style.css                  Responsive pure CSS; no framework CDN
│   ├── js/blog.js                     Renders only entries with published === true
│   ├── js/blog-publish-guard.js       Reveals a new article only when its flag is true
│   ├── js/domain-generator.js         Generator behavior and colored length badges
│   ├── js/domain-generator-data.js    Curated and creative word lists
│   ├── js/main.js                     Navigation, theme, contact form
│   ├── js/reveal.js                   IntersectionObserver scroll reveals
│   └── img/                           Local logo, favicon, diagrams, blog covers
├── pages/                             About, contact, privacy, terms, disclaimer
├── includes/                          Shared reference fragments and inactive snippets
├── ads.txt
├── robots.txt
└── sitemap.xml
```

The header and footer are embedded in each static page so navigation works without JavaScript includes. `includes/header.html` and `includes/footer.html` are reference fragments. Root-relative links assume deployment at the root of a domain; update them before deploying under a subdirectory.

## Length badges

Generated result cards show a colored badge for the **partner word length only**, excluding the user-entered root keyword: **2L amber/gold**, **3L violet**, **4L emerald/cyan**, **5L slate**, and **6L+ indigo**. The partner-word filter includes a **7+ letters** option (seven or more); the original 2–6 length lists and exact-match filters are unchanged. Each badge has an accessible label and tooltip that identify the partner-word length and the total domain-label character count, including the root keyword but excluding the extension. These counts do not assess rarity, market value, availability, or trademark status.

## Blog publishing controller

`blog/blog-config.json` is the single metadata and publication source for the archive. Every post record includes `id`, `slug`, `title`, `excerpt`, ISO `date`, integer `readTime`, `tags`, and a strict boolean `published`, along with the article filename, category, and local featured image. `defaultPublished` is `false`; a missing, malformed, or non-boolean publication flag is never treated as published.

The 32 existing live posts are explicitly marked `published: true` so adding the controller does not unexpectedly remove them. All 20 new Day 31–50 posts are **drafts** with `published: false`.

### Publish a new draft

1. Open `blog/blog-config.json` and find the post by its `day` or `slug`.
2. Review its Markdown source in `blog/articles/day-NN.md` and editorial pack in `blog/editorial-packs/day-NN.md`.
3. Verify the article, source references, byline, date, links, image, and production canonical URL. The references in the new packs are recommendations for verification, not sources claimed to have been consulted.
4. Set that post’s `published` value to the boolean `true` (not the string `"true"`) and set its actual publication date.
5. Run `python3 tools/build_draft_blog.py`. This regenerates the static article page, updates its read time, adds/removes its sitemap entry according to the flag, and preserves all `published` values.
6. Deploy the changed config, page, image, and sitemap together. The archive fetches the config without a persistent browser cache; a new published card links to the full article page.

Set `published` back to `false` and run the helper again to remove a new post from the archive and sitemap. Search and category filters apply only to published posts; pagination remains nine cards per page.

### Static-site privacy limitation

This is a **client-side publishing controller**, not access control. With a plain static host, files deployed under the public site root can be requested directly. The archive omits unpublished posts, the new article page is visually gated and marked `noindex` while unpublished, and draft URLs are kept out of the sitemap—but the JSON config, Markdown sources, and static HTML source may still be downloadable by someone who knows or guesses their URLs. Do not put confidential drafts, private user data, credentials, or unreleased sensitive information in a public static deployment. For genuinely private drafts, keep them out of the public deployment output or use an authenticated preview/backend.

## Article series and editorial status

Days 31–50 are full English-language drafts based on the supplied outlines. Each Markdown article is 2,000–2,800 words (including headings, tables, and code examples in the local count), with a structured article page, local SVG cover, descriptive alt text, reading-time metadata, internal links, and an editorial pack covering audience, search intent, SEO metadata, visual plan, sources to verify, and an audit. The draft pages remain unpublished by default. Their technical references have **not** been live-fetched during drafting; the editorial packs say so and list them as further reading to verify before publication. No invented tests, quotations, provider prices, or market outcomes are presented as observed facts.

The new article set covers:

- Day 31–35: agentic web, AI search, MCP, AI crawlers/robots.txt, and coding agents.
- Day 36–40: serverless, edge computing, Docker/containers, gateways/proxies/load balancers, and observability.
- Day 41–45: REST APIs, rate limits/caching/retries, SQL vs NoSQL, storage models, and webhooks.
- Day 46–50: passkeys, SPF/DKIM/DMARC, IPv4/IPv6, threat modeling, and disaster recovery.

## Run locally

The archive and article gate use `fetch`, so serve the directory over HTTP instead of opening pages with `file://`:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

Open `http://localhost:8000/`. The site has no package installation or runtime framework dependency. To regenerate Day 31–50 article HTML, editorial packs, SVG covers, reading times, and sitemap entries from the current config and Markdown sources, run:

```sh
python3 tools/build_draft_blog.py
python3 tools/validate_blog.py
node tools/test_blog.js
```

The build helper uses only Python’s standard library and intentionally preserves manually edited publication flags. The validator checks config schema, article lengths, local assets and links, JSON-LD, publication gates, category setup, and sitemap consistency.

## Required before production

1. **Choose the real site name and publisher.** Replace starter publisher notes and bracketed identity/jurisdiction fields in About, Privacy, Terms, and Disclaimer. Supply truthful publisher and editorial information.
2. **Replace `https://example.com`.** Set the production origin in canonical and Open Graph URLs, structured data, `sitemap.xml`, and `robots.txt`; update generated article pages by rerunning the helper after source/template changes.
3. **Configure the contact form.** Replace `REPLACE_WITH_YOUR_FORM_ID` in `pages/contact.html` with a real Formspree endpoint or implement a backend. The current UI intentionally does not send messages until configured.
4. **Configure AdSense only after approval.** Replace the placeholder publisher ID in `/ads.txt` with the exact account ID. `pub-0000000000000000` is not a valid publisher ID. Use the official script and ad-unit code; approval and revenue are not guaranteed.
5. **Configure privacy/consent and analytics.** Analytics and ads are inactive. Follow `/includes/analytics-ads.html`, disclose actual vendors and data practices, and configure an appropriate consent platform where required.
6. **Review articles and sources.** Verify primary references and changing provider behavior, update the byline/date, check accessibility and links, and obtain specialist security, legal, financial, or privacy review where appropriate. These templates do not guarantee AdSense approval or legal compliance.
7. **Test the deployed origin.** Check navigation, saved theme, generator copy and TXT/CSV exports, blog config loading, only-published rendering, draft gating, category filters, nine-card pagination, form delivery, HTTPS, favicon, `ads.txt`, robots.txt, sitemap, and canonical URLs.
8. **Set up Search Console.** Verify domain ownership and submit the production sitemap. Structured data and SEO code cannot guarantee indexing, rankings, AI citations, or sitelinks.

## Generator notes

The generator’s original flow and word lists are retained: root keyword combinations, curated/creative modes, word-length filters, prefix/suffix placement, camel-case display, live filtering, clipboard actions, and TXT/CSV exports. The refactor adds input sanitization, text-safe DOM rendering, clipboard fallback and CSV quoting, distinct colored length badges, and clear limits: suggestions are not availability checks, dictionary certification, trademark clearance, or valuations.
