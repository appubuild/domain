# DomainCraft static website

A dependency-free static-site project built around the supplied **Smart AI Domain Generator** HTML (the supplied implementation itself is rules-based and does not call an AI model). It includes the landing page, integrated generator, client-rendered blog archive with local featured illustrations, a complete 30-article editorial series plus two sample guides, per-article source/editorial packs, publisher information pages, SEO metadata and structured data, sitemap, robots.txt, and AdSense/analytics setup notes.

## Architecture

```text
/
├── index.html                         Landing page, SEO guide, FAQ schema
├── tools/domain-generator.html        Integrated generator page
├── blog/
│   ├── index.html                     Fetches and renders the post manifest
│   ├── blog-01.html                   Original domain naming checklist
│   ├── blog-02.html                   Original TLD selection guide
│   ├── blog-03.html … blog-32.html    Published 30-part series
│   ├── day-01-article.md              Day 01 Markdown article source
│   ├── articles/day-02.md … day-30.md Markdown sources for the series
│   ├── editorial-packs/               Per-article brief, visuals, sources and audit
│   ├── day-01-editorial-pack.md       Day 01 editorial pack
│   ├── editorial-calendar.md          30-day plan and publication status
│   └── posts-manifest.json            Post metadata and featured images
├── pages/
│   ├── about.html
│   ├── contact.html                   Formspree-ready contact form
│   ├── privacy-policy.html
│   ├── terms-and-conditions.html
│   └── disclaimer.html
├── includes/
│   ├── header.html                    Shared header reference fragment
│   ├── footer.html                    Shared footer reference fragment
│   └── analytics-ads.html             Inactive GA4 / AdSense examples
├── assets/
│   ├── css/style.css                  Responsive pure CSS; no framework CDN
│   ├── js/main.js                     Navigation, theme, contact form
│   ├── js/reveal.js                   IntersectionObserver scroll reveals
│   ├── js/blog.js                     Client-side manifest pipeline
│   ├── js/domain-generator-data.js    Curated and creative word lists
│   ├── js/domain-generator.js         Generator logic and rendering
│   └── img/                           SVG logo, favicon and DNS diagram; JPEG blog covers
├── ads.txt
├── robots.txt
└── sitemap.xml
```

The page header and footer are written into each static HTML page so navigation and important links remain present in the source without requiring JavaScript includes. `includes/header.html` and `includes/footer.html` are reference fragments for keeping those copies in sync. The blog archive is intentionally client-side: add a static post file, then add its title, slug, file, excerpt, date, tags, featured-image path, and descriptive image alt text to `blog/posts-manifest.json`. Every page has canonical/OG/Twitter metadata, a shared `SiteNavigationElement` schema, and a page-specific `BreadcrumbList`; the home page also has FAQ schema. Scroll reveals use the browser's `IntersectionObserver` and honor `prefers-reduced-motion`.

## Why Tailwind and Font Awesome were removed

The attachment loaded Tailwind and Font Awesome from third-party CDNs. The original request allowed either pure CSS or Tailwind, so this version uses local CSS and lightweight text/CSS icons to avoid two external requests, a runtime stylesheet dependency, and an unnecessary third-party asset dependency on every page. The generator's core behavior and word lists were retained. This is a deployment/performance choice, not a limitation of static hosting; Tailwind or Font Awesome can be restored if you prefer those libraries.

## Run locally

The blog manifest uses `fetch`, so serve the directory over HTTP rather than opening pages with `file://`:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. The site is static and has no package installation or build step. Deploy the files at the root of a domain; site links are root-relative (for example, `/tools/domain-generator.html`). If deploying under a subdirectory, update those paths first.

## Required before production

1. **Choose the real site name and publisher.** Replace the starter publisher notes and the bracketed identity/jurisdiction fields in About, Privacy, Terms, and Disclaimer. Supply truthful publisher and editorial information; do not publish placeholder credentials.
2. **Replace the domain placeholder.** Search all files for `https://example.com` and replace it with the production origin. Update canonical and Open Graph URLs, `sitemap.xml`, and the `Sitemap:` line in `robots.txt`.
3. **Configure the contact form.** Replace `REPLACE_WITH_YOUR_FORM_ID` in `pages/contact.html` with a real Formspree endpoint (or implement a different backend). The current UI validates input but intentionally does not send messages until a real endpoint is configured.
4. **Configure AdSense only after approval.** Replace the placeholder publisher ID in `/ads.txt` with the exact ID supplied by your AdSense account. `pub-0000000000000000` is a placeholder and is not a valid publisher ID. Use the official script and ad-unit code from the account, not a guessed ID.
5. **Configure privacy/consent and analytics.** Analytics and advertising snippets are deliberately inactive. Follow `/includes/analytics-ads.html`; disclose the actual vendors and data practices in the privacy policy. Where required by Google policy or law (including EEA, UK, and Switzerland consent requirements), configure an appropriate Google-certified CMP before serving ads.
6. **Review editorial and legal content.** Update the sample author/publisher identity, confirm every statement reflects your actual site configuration, review local legal requirements, check links, and keep articles accurate and useful. These templates do not guarantee AdSense approval or legal compliance.
7. **Test the live origin.** Check mobile navigation, theme preference, generator copy and TXT/CSV exports, manifest loading, form delivery, HTTPS, favicon, `ads.txt`, robots.txt, sitemap, canonical URLs, and all internal links.
8. **Set up Search Console.** Verify domain ownership using the method Google gives you, then submit the production `/sitemap.xml` URL and review indexing reports. No schema, sitemap priority, or code change can force Google to show sitelinks or guarantee rankings; Google chooses those automatically.

## Generator notes

The attached generator's core flow and word lists have been retained: root keyword combinations, curated/creative modes, word-length filters, prefix/suffix placement, camel-case display, live filtering, clipboard actions, and TXT/CSV exports. The refactor also removes Tailwind/Font Awesome/CDN dependencies, sanitizes root/TLD input, renders result cards with text-safe DOM APIs, improves clipboard fallback and CSV quoting, and avoids claiming that suggestions are available or legally clear. Curated mode is a built-in list, not a certified dictionary or verification service.
