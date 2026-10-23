#!/usr/bin/env python3
"""Render static article pages, editorial packs, and local SVG covers from blog sources.

Uses only the Python standard library. It deliberately preserves every published
flag in blog/blog-config.json; publication status is edited by the site owner.
"""
from __future__ import annotations

from html import escape
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import re
import textwrap
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "blog" / "blog-config.json"
ARTICLE_DIR = ROOT / "blog" / "articles"
PACK_DIR = ROOT / "blog" / "editorial-packs"
IMAGE_DIR = ROOT / "assets" / "img" / "blog"

VISUALS = {
    31: ("AGENTIC WEB", ["Human goal", "Agent + tools", "Website / API"]),
    32: ("AI SEARCH", ["Crawl + index", "Retrieve sources", "Answer + links"]),
    33: ("MODEL CONTEXT PROTOCOL", ["AI host", "MCP client", "Tools + data"]),
    34: ("CRAWLER ACCESS", ["Bot request", "Policy signal", "Access control"]),
    35: ("AI CODING AGENTS", ["Requirements", "Code + tests", "Human release"]),
    36: ("SERVERLESS", ["HTTPS request", "Function / event", "Data provider"]),
    37: ("EDGE COMPUTING", ["Visitor", "Edge cache / code", "Origin service"]),
    38: ("CONTAINERS", ["Source + recipe", "Image registry", "Running app"]),
    39: ("API TRAFFIC", ["Reverse proxy", "API gateway", "Backend pool"]),
    40: ("OBSERVABILITY", ["Metrics", "Logs + traces", "Diagnosis"]),
    41: ("REST API DESIGN", ["HTTP method", "JSON contract", "Status + result"]),
    42: ("RELIABLE SEARCH", ["Rate limit", "Cache / retry", "Known result"]),
    43: ("DATA MODELS", ["Relational rows", "Document model", "Query pattern"]),
    44: ("STORAGE ARCHITECTURE", ["Object storage", "Block / file", "CDN + recovery"]),
    45: ("WEBHOOKS", ["Polling API", "Signed event", "Safe worker"]),
    46: ("PASSKEYS", ["Challenge", "Device key", "Server verifies"]),
    47: ("EMAIL AUTHENTICATION", ["SPF + DKIM", "DMARC alignment", "Receiver policy"]),
    48: ("DUAL-STACK WEB", ["A + AAAA", "IPv4 / IPv6", "Web service"]),
    49: ("THREAT MODELING", ["Assets", "Trust boundaries", "Controls + evidence"]),
    50: ("DISASTER RECOVERY", ["Primary service", "Backup copy", "Restore + failover"]),
}

PALETTES = {
    "AI & Emerging Web": ("#6248d8", "#edeaff", "#f7f6ff"),
    "Web Infrastructure & APIs": ("#087f8c", "#dff7f5", "#f2fbfa"),
    "Security & Reliability": ("#b35f18", "#fff0d9", "#fffaf2"),
}

SOURCES = {
    31: [("HTTP Semantics, RFC 9110", "https://www.rfc-editor.org/rfc/rfc9110"), ("Model Context Protocol specification repository", "https://github.com/modelcontextprotocol/specification"), ("OpenAPI Specification", "https://spec.openapis.org/oas/v3.1.0")],
    32: [("Robots Exclusion Protocol, RFC 9309", "https://www.rfc-editor.org/rfc/rfc9309"), ("Google Search crawling and indexing documentation", "https://developers.google.com/search/docs/crawling-indexing"), ("Schema.org Article", "https://schema.org/Article")],
    33: [("Model Context Protocol specification repository", "https://github.com/modelcontextprotocol/specification"), ("HTTP Semantics, RFC 9110", "https://www.rfc-editor.org/rfc/rfc9110"), ("OpenAPI Specification", "https://spec.openapis.org/oas/v3.1.0")],
    34: [("Robots Exclusion Protocol, RFC 9309", "https://www.rfc-editor.org/rfc/rfc9309"), ("Google robots.txt documentation", "https://developers.google.com/search/docs/crawling-indexing/robots/intro"), ("HTTP Semantics, RFC 9110", "https://www.rfc-editor.org/rfc/rfc9110")],
    35: [("NIST Secure Software Development Framework, SP 800-218", "https://csrc.nist.gov/pubs/sp/800/218/final"), ("OWASP Secure Coding Practices Quick Reference Guide", "https://owasp.org/www-project-secure-coding-practices-quick-reference-guide/")],
    36: [("NIST The NIST Definition of Cloud Computing, SP 800-145", "https://csrc.nist.gov/pubs/sp/800/145/final"), ("HTTP Semantics, RFC 9110", "https://www.rfc-editor.org/rfc/rfc9110")],
    37: [("HTTP Caching, RFC 9111", "https://www.rfc-editor.org/rfc/rfc9111"), ("HTTP Semantics, RFC 9110", "https://www.rfc-editor.org/rfc/rfc9110")],
    38: [("Docker documentation: containers", "https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-container/"), ("Open Container Initiative image specification", "https://github.com/opencontainers/image-spec"), ("Open Container Initiative runtime specification", "https://github.com/opencontainers/runtime-spec")],
    39: [("HTTP Semantics, RFC 9110", "https://www.rfc-editor.org/rfc/rfc9110"), ("TLS 1.3, RFC 8446", "https://www.rfc-editor.org/rfc/rfc8446"), ("HTTP Caching, RFC 9111", "https://www.rfc-editor.org/rfc/rfc9111")],
    40: [("OpenTelemetry observability concepts", "https://opentelemetry.io/docs/concepts/"), ("W3C Trace Context", "https://www.w3.org/TR/trace-context/")],
    41: [("HTTP Semantics, RFC 9110", "https://www.rfc-editor.org/rfc/rfc9110"), ("HTTP Caching, RFC 9111", "https://www.rfc-editor.org/rfc/rfc9111"), ("OpenAPI Specification", "https://spec.openapis.org/oas/v3.1.0")],
    42: [("Additional HTTP Status Codes, RFC 6585", "https://www.rfc-editor.org/rfc/rfc6585"), ("HTTP Caching, RFC 9111", "https://www.rfc-editor.org/rfc/rfc9111"), ("HTTP Semantics, RFC 9110", "https://www.rfc-editor.org/rfc/rfc9110")],
    43: [("PostgreSQL documentation", "https://www.postgresql.org/docs/current/"), ("MongoDB data modeling documentation", "https://www.mongodb.com/docs/manual/data-modeling/")],
    44: [("Amazon S3 user guide", "https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html"), ("NIST cloud computing definition, SP 800-145", "https://csrc.nist.gov/pubs/sp/800/145/final")],
    45: [("HTTP Semantics, RFC 9110", "https://www.rfc-editor.org/rfc/rfc9110"), ("HTTP Message Signatures, RFC 9421", "https://www.rfc-editor.org/rfc/rfc9421"), ("Stripe webhook documentation", "https://docs.stripe.com/webhooks")],
    46: [("Web Authentication: An API for accessing Public Key Credentials, Level 3", "https://www.w3.org/TR/webauthn-3/"), ("NIST Digital Identity Guidelines, SP 800-63B", "https://pages.nist.gov/800-63-4/sp800-63b.html"), ("FIDO Alliance passkeys overview", "https://fidoalliance.org/passkeys/")],
    47: [("Sender Policy Framework (SPF), RFC 7208", "https://www.rfc-editor.org/rfc/rfc7208"), ("DomainKeys Identified Mail (DKIM), RFC 6376", "https://www.rfc-editor.org/rfc/rfc6376"), ("IETF DMARC working-group documents; verify the current published standard", "https://datatracker.ietf.org/wg/dmarc/documents/")],
    48: [("Internet Protocol, Version 6 (IPv6), RFC 8200", "https://www.rfc-editor.org/rfc/rfc8200"), ("DNS Extensions to Support IP Version 6, RFC 3596", "https://www.rfc-editor.org/rfc/rfc3596"), ("Internet Protocol, RFC 791", "https://www.rfc-editor.org/rfc/rfc791")],
    49: [("OWASP Threat Modeling Cheat Sheet", "https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html"), ("NIST Secure Software Development Framework, SP 800-218", "https://csrc.nist.gov/pubs/sp/800/218/final")],
    50: [("NIST Contingency Planning Guide for Federal Information Systems, SP 800-34 Rev. 1", "https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final"), ("CISA StopRansomware Guide", "https://www.cisa.gov/stopransomware/ransomware-guide")],
}


def word_count(text: str) -> int:
    return len(re.findall(r"\b[\w’'-]+\b", text, flags=re.UNICODE))


def slug_id(text: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return value or "section"


def inline_markup(text: str) -> str:
    token_re = re.compile(r"(`[^`]+`|\*\*.+?\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))")
    out = []
    cursor = 0
    for match in token_re.finditer(text):
        out.append(escape(text[cursor:match.start()]))
        token = match.group(0)
        if token.startswith("`"):
            out.append(f"<code>{escape(token[1:-1])}</code>")
        elif token.startswith("**"):
            out.append(f"<strong>{escape(token[2:-2])}</strong>")
        elif token.startswith("*"):
            out.append(f"<em>{escape(token[1:-1])}</em>")
        else:
            link = re.fullmatch(r"\[([^\]]+)\]\(([^)]+)\)", token)
            label, href = link.group(1), link.group(2)
            if href.startswith(("https://", "http://", "/", "#")):
                out.append(f'<a href="{escape(href, quote=True)}">{escape(label)}</a>')
            else:
                out.append(escape(token))
        cursor = match.end()
    out.append(escape(text[cursor:]))
    return "".join(out)


def table_cells(line: str) -> list[str]:
    value = line.strip().strip("|")
    return [cell.strip() for cell in value.split("|")]


def markdown_to_html(markdown: str, expected_title: str) -> str:
    lines = markdown.splitlines()
    if lines and lines[0].startswith("# "):
        h1 = lines.pop(0)[2:].strip()
        if h1 != expected_title:
            raise ValueError(f"Markdown H1 mismatch: {h1!r} != {expected_title!r}")
    else:
        raise ValueError(f"Missing H1 for {expected_title}")

    output: list[str] = []
    paragraph: list[str] = []
    list_kind: str | None = None
    heading_ids: set[str] = set()

    def flush_paragraph() -> None:
        if paragraph:
            output.append(f"<p>{inline_markup(' '.join(part.strip() for part in paragraph))}</p>")
            paragraph.clear()

    def flush_list() -> None:
        nonlocal list_kind
        if list_kind:
            output.append(f"</{list_kind}>")
            list_kind = None

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            flush_paragraph(); flush_list(); i += 1; continue

        if stripped.startswith("```"):
            flush_paragraph(); flush_list()
            language = stripped[3:].strip()
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            class_attr = f' class="language-{escape(language, quote=True)}"' if language else ""
            output.append(f"<pre><code{class_attr}>{escape(chr(10).join(code_lines))}</code></pre>")
            i += 1
            continue

        if stripped.startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|?\s*:?-{3,}", lines[i + 1]):
            flush_paragraph(); flush_list()
            headers = table_cells(stripped)
            i += 2
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(table_cells(lines[i].strip()))
                i += 1
            head = "".join(f"<th scope=\"col\">{inline_markup(cell)}</th>" for cell in headers)
            body_rows = []
            for row in rows:
                cells = row + [""] * max(0, len(headers) - len(row))
                body_rows.append("<tr>" + "".join(f"<td>{inline_markup(cell)}</td>" for cell in cells[:len(headers)]) + "</tr>")
            output.append(f"<div class=\"table-scroll\"><table><thead><tr>{head}</tr></thead><tbody>{''.join(body_rows)}</tbody></table></div>")
            continue

        if stripped.startswith(">"):
            flush_paragraph(); flush_list()
            quote_lines = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote_lines.append(lines[i].strip()[1:].strip())
                i += 1
            quote = inline_markup(" ".join(quote_lines))
            output.append(f"<blockquote><p>{quote}</p></blockquote>")
            continue

        heading = re.match(r"^(#{2,3})\s+(.+)$", stripped)
        if heading:
            flush_paragraph(); flush_list()
            level = len(heading.group(1))
            label = heading.group(2).strip()
            base = slug_id(re.sub(r"[`*_]", "", label))
            anchor = base
            suffix = 2
            while anchor in heading_ids:
                anchor = f"{base}-{suffix}"; suffix += 1
            heading_ids.add(anchor)
            output.append(f'<h{level} id="{anchor}">{inline_markup(label)}</h{level}>')
            i += 1
            continue

        bullet = re.match(r"^[-*]\s+(.+)$", stripped)
        ordered = re.match(r"^\d+\.\s+(.+)$", stripped)
        if bullet or ordered:
            flush_paragraph()
            kind = "ul" if bullet else "ol"
            if list_kind != kind:
                flush_list(); output.append(f"<{kind}>"); list_kind = kind
            content = (bullet or ordered).group(1)
            output.append(f"<li>{inline_markup(content)}</li>")
            i += 1
            continue

        if stripped == "---":
            flush_paragraph(); flush_list(); output.append("<hr>"); i += 1; continue
        flush_list()
        paragraph.append(stripped)
        i += 1

    flush_paragraph(); flush_list()
    return "\n".join(output)


class PlainText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(); self.parts: list[str] = []; self.skip = 0
    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("script", "style", "noscript"): self.skip += 1
    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "noscript") and self.skip: self.skip -= 1
    def handle_data(self, data: str) -> None:
        if not self.skip: self.parts.append(data)


def display_date(value: str) -> str:
    from datetime import date
    return date.fromisoformat(value).strftime("%B %-d, %Y")


def article_template(post: dict, body_html: str) -> str:
    title = escape(post["title"])
    excerpt = escape(post["excerpt"], quote=True)
    slug = escape(post["slug"], quote=True)
    category = escape(post["category"])
    file = escape(post["file"], quote=True)
    date = escape(post["date"], quote=True)
    date_label = escape(display_date(post["date"]))
    read_time = int(post["readTime"])
    robots_content = "index,follow,max-image-preview:large" if post.get("published") is True else "noindex,nofollow"
    image = escape(post["image"], quote=True)
    image_abs = "https://example.com" + post["image"]
    image_alt = escape(post["imageAlt"], quote=True)
    tags = "".join(f'<span class="tag">{escape(tag)}</span>' for tag in post.get("tags", []))
    schema = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "headline": post["title"],
        "description": post["excerpt"],
        "datePublished": post["date"],
        "dateModified": post["date"],
        "author": {"@type": "Organization", "name": "DomainCraft Editorial"},
        "publisher": {"@type": "Organization", "name": "DomainCraft"},
        "image": [image_abs],
        "mainEntityOfPage": {"@type": "WebPage", "@id": f"https://example.com/blog/{post['file']}"},
        "articleSection": post["category"],
        "keywords": post.get("tags", []),
        "inLanguage": "en"
    }
    breadcrumb = {
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://example.com/"},
            {"@type": "ListItem", "position": 2, "name": "Blog", "item": "https://example.com/blog/index.html"},
            {"@type": "ListItem", "position": 3, "name": post["title"], "item": f"https://example.com/blog/{post['file']}"}
        ]
    }
    schema_json = json.dumps(schema, ensure_ascii=False, indent=2).replace("</", "<\\/")
    breadcrumb_json = json.dumps(breadcrumb, ensure_ascii=False, indent=2).replace("</", "<\\/")
    related = (
        '<a href="/blog/blog-31.html">Building Trust on a Domain Tools Website</a>'
        '<a href="/blog/blog-32.html">How to Build a Long-Term Domain Knowledge Website</a>'
        '<hr><a href="/blog/index.html">All published articles</a>'
        '<a href="/tools/domain-generator.html">Domain name generator</a>'
        '<a href="/pages/disclaimer.html">Editorial disclaimer</a>'
    )
    return f'''<!doctype html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title} | DomainCraft</title>
  <meta name="description" content="{excerpt}">
  <meta name="robots" content="{robots_content}">
  <link rel="canonical" href="https://example.com/blog/{file}">
  <link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
  <meta property="og:type" content="article"><meta property="og:site_name" content="DomainCraft">
  <meta property="og:title" content="{title}"><meta property="og:description" content="{excerpt}">
  <meta property="og:url" content="https://example.com/blog/{file}">
  <meta property="og:image" content="{escape(image_abs, quote=True)}"><meta property="og:image:alt" content="{image_alt}">
  <meta property="article:published_time" content="{date}"><meta property="article:modified_time" content="{date}">
  <meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{title}"><meta name="twitter:description" content="{excerpt}">
  <!-- Replace example.com with the production domain before deployment. Draft pages stay noindex until blog-config.json marks them published. -->
  <link rel="stylesheet" href="/assets/css/style.css?v=20261023-5">
  <script src="/assets/js/main.js?v=20261023-4" defer></script>
  <script src="/assets/js/reveal.js" defer></script>
  <script src="/assets/js/blog-publish-guard.js?v=20261023-1" defer></script>
  <script type="application/ld+json">{schema_json}</script>
  <script type="application/ld+json">{breadcrumb_json}</script>
</head>
<body id="top">
  <a class="skip-link" href="#main-content">Skip to content</a>
  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="/index.html" aria-label="DomainCraft home"><img src="/assets/img/logo.svg" width="38" height="38" alt="DomainCraft logo"><span>DomainCraft</span></a>
      <button class="menu-toggle" type="button" data-menu-toggle aria-expanded="false" aria-controls="site-navigation" aria-label="Open navigation"><span></span><span></span><span></span></button>
      <nav class="site-nav" id="site-navigation" aria-label="Main navigation"><a href="/index.html">Home</a><a href="/tools/domain-generator.html">Generator</a><a href="/blog/index.html" aria-current="page">Blog</a><a href="/pages/about.html">About</a><a href="/pages/contact.html">Contact</a></nav>
      <div class="header-actions"><a class="button button-small button-primary" href="/tools/domain-generator.html">Try the tool <span aria-hidden="true">↗</span></a><button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch to dark theme" title="Switch theme"><span aria-hidden="true">◐</span></button></div>
    </div>
  </header>
  <main id="main-content" class="page-main">
    <section class="container draft-notice" data-draft-notice role="status">This article is currently an unpublished draft. Return to the blog archive for available articles.</section>
    <div class="container article-layout" data-publish-guard data-post-slug="{slug}" hidden>
      <article>
        <div class="breadcrumbs article-breadcrumbs"><a href="/index.html">Home</a> / <a href="/blog/index.html">Blog</a> / {title}</div>
        <header class="article-header">
          <p class="eyebrow">{category} · Practical guide</p>
          <h1>{title}</h1>
          <div class="article-meta"><time datetime="{date}">{date_label}</time><span>DomainCraft Editorial</span><span>{read_time} minute read</span></div>
          <div class="tag-list">{tags}</div>
        </header>
        <figure class="article-figure article-featured"><img src="{image}" alt="{image_alt}" width="1200" height="675" fetchpriority="high"><figcaption>Original local vector schematic. It is explanatory artwork, not measured performance or market data.</figcaption></figure>
        <div class="article-body">{body_html}</div>
      </article>
      <aside class="article-sidebar" aria-label="Related guides"><h2>Related guides</h2>{related}</aside>
    </div>
    <section class="container section-tight" data-publish-guard-cta hidden><div class="cta-band"><div><h2>Continue your domain research.</h2><p>Explore naming ideas, then verify registration, renewal, and legal details with the appropriate providers.</p></div><a class="button" href="/tools/domain-generator.html">Try the generator →</a></div></section>
  </main>
  <footer class="site-footer">
    <div class="container footer-main"><div class="footer-brand-block"><a class="brand brand-footer" href="/index.html"><img src="/assets/img/logo.svg" width="34" height="34" alt="DomainCraft logo"><span>DomainCraft</span></a><p>Practical tools and clear guidance for exploring memorable domain-name ideas.</p></div><div class="footer-links-group"><h2>Explore</h2><a href="/tools/domain-generator.html">Domain generator</a><a href="/blog/index.html">Articles</a><a href="/pages/about.html">About us</a><a href="/pages/contact.html">Contact</a></div><div class="footer-links-group"><h2>Information</h2><a href="/pages/privacy-policy.html">Privacy policy</a><a href="/pages/terms-and-conditions.html">Terms &amp; conditions</a><a href="/pages/disclaimer.html">Disclaimer</a></div></div>
    <div class="container footer-bottom"><p>© <span data-current-year>2026</span> DomainCraft. Domain ideas are not availability or trademark checks.</p><a href="#top">Back to top ↑</a></div>
  </footer>
</body>
</html>
'''


def make_svg(post: dict, day: int) -> str:
    label, stages = VISUALS[day]
    accent, soft, bg = PALETTES.get(post["category"], ("#5746e8", "#eeecff", "#f7f8fc"))
    short_title = post["title"].split(":", 1)[0]
    title_lines = textwrap.wrap(short_title, width=43)[:2]
    title_markup = "".join(f'<text x="82" y="{164 + index*43}" class="title">{escape(line)}</text>' for index, line in enumerate(title_lines))
    x_positions = [68, 442, 816]
    stage_markup = []
    for idx, (x, stage) in enumerate(zip(x_positions, stages), 1):
        stage_lines = textwrap.wrap(stage, width=20)[:2]
        stage_text = "".join(f'<text x="{x+26}" y="{420 + j*31}" class="node-label">{escape(line)}</text>' for j, line in enumerate(stage_lines))
        stage_markup.append(f'''<g>
          <rect x="{x}" y="330" width="316" height="160" rx="22" fill="#ffffff" stroke="{soft}" stroke-width="3"/>
          <circle cx="{x+48}" cy="376" r="18" fill="{soft}"/><text x="{x+48}" y="382" text-anchor="middle" class="number">{idx}</text>
          {stage_text}
          <path d="M{x+26} 462 H{x+286}" stroke="{accent}" stroke-opacity=".18" stroke-width="5" stroke-linecap="round"/>
        </g>''')
    arrows = ''.join(f'<path d="M{pos} 410 h32 m-10 -10 10 10 -10 10" fill="none" stroke="{accent}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>' for pos in (393, 767))
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img" aria-labelledby="svg-title svg-desc">
<title id="svg-title">{escape(post['title'])}</title>
<desc id="svg-desc">{escape(post['imageAlt'])}</desc>
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{bg}"/><stop offset="1" stop-color="{soft}"/></linearGradient><filter id="shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#172033" flood-opacity=".09"/></filter></defs>
<rect width="1200" height="675" rx="34" fill="url(#bg)"/>
<circle cx="1090" cy="104" r="140" fill="{accent}" opacity=".07"/><circle cx="115" cy="560" r="115" fill="{accent}" opacity=".06"/>
<g filter="url(#shadow)"><rect x="48" y="38" width="1104" height="598" rx="28" fill="none" stroke="#ffffff" stroke-opacity=".72" stroke-width="2"/></g>
<text x="82" y="101" class="eyebrow" fill="{accent}">DOMAINCRAFT · {escape(label)}</text>
{title_markup}
<text x="82" y="276" class="caption">A practical architecture, not a performance chart</text>
{''.join(stage_markup)}{arrows}
<text x="82" y="574" class="footer">Explore the workflow · verify the details · protect the user</text>
<style>
  text {{ font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }}
  .eyebrow {{ font-size: 20px; font-weight: 800; letter-spacing: 2px; }}
  .title {{ font-size: 36px; font-weight: 800; fill: #172033; letter-spacing: -1.3px; }}
  .caption {{ font-size: 18px; font-weight: 550; fill: #65708a; }}
  .node-label {{ font-size: 22px; font-weight: 750; fill: #172033; }}
  .number {{ font-size: 15px; font-weight: 850; fill: {accent}; }}
  .footer {{ font-size: 17px; font-weight: 650; fill: #65708a; letter-spacing: .2px; }}
</style>
</svg>
'''


def article_pack(post: dict, day: int, words: int) -> str:
    source_lines = "\n".join(f"- [{label}]({url}) — recommended for verification; not live-fetched during drafting." for label, url in SOURCES[day])
    main_related = "[`Building Trust on a Domain Tools Website`](../blog-31.html) and [`How to Build a Long-Term Domain Knowledge Website`](../blog-32.html)."
    if day in (31, 32):
        main_related = "[`Building Trust on a Domain Tools Website`](../blog-31.html), [`How to Build a Long-Term Domain Knowledge Website`](../blog-32.html), and the [domain generator](../../tools/domain-generator.html)."
    return f'''# Day {day:02d} editorial pack — {post['category']}

## A. Editorial brief

- **Audience:** website owners, developers, and readers who need a practical explanation of {post['title'].split(':')[0].lower()}.
- **Reader problem:** understand the topic and make a safe, informed design or operating decision without mistaking a conceptual example for a live test or provider guarantee.
- **Search intent:** informational / practical decision support.
- **Unique angle:** connect the core concept to implementation boundaries, failure cases, and a domain-tool example without claiming unverified service behavior.
- **Research status:** No external pages were live-fetched for this draft. References below are suggested further reading, not sources claimed to have been consulted. Check current standards, provider limits, policies, and jurisdiction-specific rules before publication.

## B. SEO metadata

- **SEO title:** {post['title']} | DomainCraft
- **H1:** {post['title']}
- **Slug:** `{post['slug']}`
- **Static article file:** [`{post['file']}`](../{post['file']}) — remains hidden until `published: true`.
- **Meta description:** {post['excerpt']}
- **Target topics:** {', '.join(tag for tag in post.get('tags', []))}
- **Category:** {post['category']}
- **Draft date in config:** {post['date']}; change to the intended publication date before publishing.
- **Featured image:** `{post['image']}`
- **Image alt:** {post['imageAlt']}
- **Estimated reading time:** {int(post['readTime'])} minutes; calculated from the draft at approximately 200 words per minute.

## C. Complete article

- Markdown source: [`day-{day:02d}.md`](../articles/day-{day:02d}.md).
- Generated static page: [`{post['file']}`](../{post['file']}).
- **Draft length:** {words:,} words (headings, tables, and code examples included in the count).
- The page is marked `noindex` and gated by the client-side publish controller while unpublished. This is a presentation and indexing control, not confidentiality for files deployed to a public static host.

## D. Visual plan and implementation

- **Featured visual:** original, local 1200 × 675 SVG workflow illustration at `{post['image']}`; it is conceptual, not measured data.
- **Alt text:** {post['imageAlt']}
- **In-article visual:** architecture diagrams, examples, tables, and checklists are explicitly illustrative; no fictional dashboard data or test results are presented as observations.
- **Production note:** verify legibility at card size, contrast, screen-reader description, and SVG rendering on the target host. The asset has no external runtime dependency.

## E. Internal linking plan

- Related live guides: {main_related}
- Link to the [published archive](../index.html) for the wider collection.
- Link to the [editorial disclaimer](../../pages/disclaimer.html) wherever readers might mistake an example for a live result or professional advice.
- Do not link to another unpublished draft until its status is changed and its page is verified.

## F. Sources and verification

**Actually consulted:** none; no live external pages were fetched for this draft. The following are recommended starting points for a source review, not consulted sources:
{source_lines}

Before publication, follow each reference, confirm its current version and relevance, and add a date or scope note when the guidance can change. Check provider-specific pricing, limits, authentication behavior, and terms directly with the provider. Do not add market statistics, quotes, or first-hand testing unless they are real and documented.

## G. Final editorial audit

- The draft uses a plain-language structure with practical examples, headings, lists, a summary, and a conclusion.
- Hypothetical services and workflows are labeled as examples; no provider integration, measured performance, quote, customer outcome, or test run is invented.
- Technical limitations and security/privacy considerations are stated; availability, legal safety, rankings, revenue, and commercial outcomes are not guaranteed.
- The local cover has descriptive alt text; page metadata and structured data use the same title, description, date, and image.
- **Before production:** verify the recommended sources and current implementation details, update the publication date and byline, replace the `example.com` canonical origin, check internal links and accessibility, and review the page on the deployed host. Obtain specialist security, legal, financial, or privacy review where the subject warrants it.
'''


def sync_sitemap(config: dict) -> None:
    sitemap_path = ROOT / "sitemap.xml"
    if not sitemap_path.exists():
        return
    namespace = "http://www.sitemaps.org/schemas/sitemap/0.9"
    ET.register_namespace("", namespace)
    tree = ET.parse(sitemap_path)
    sitemap = tree.getroot()
    url_tag = f"{{{namespace}}}url"
    loc_tag = f"{{{namespace}}}loc"
    lastmod_tag = f"{{{namespace}}}lastmod"
    managed_files = {post["file"] for post in config["posts"] if isinstance(post.get("day"), int) and 31 <= post["day"] <= 50}
    live_files = {post["file"] for post in config["posts"] if post.get("published") is True and isinstance(post.get("day"), int) and 31 <= post["day"] <= 50}

    origin = "https://example.com"
    for url_node in sitemap.findall(url_tag):
        loc = url_node.findtext(loc_tag, default="")
        if loc:
            parsed = urlsplit(loc)
            origin = f"{parsed.scheme}://{parsed.netloc}"
            break

    by_file: dict[str, ET.Element] = {}
    for url_node in list(sitemap.findall(url_tag)):
        loc = url_node.findtext(loc_tag, default="")
        filename = loc.rsplit("/", 1)[-1]
        if filename in managed_files:
            if filename not in live_files:
                sitemap.remove(url_node)
            else:
                by_file[filename] = url_node

    for post in config["posts"]:
        filename = post.get("file")
        day = post.get("day")
        if not (isinstance(day, int) and 31 <= day <= 50 and post.get("published") is True):
            continue
        node = by_file.get(filename)
        if node is None:
            node = ET.SubElement(sitemap, url_tag)
            ET.SubElement(node, loc_tag).text = f"{origin}/blog/{filename}"
            ET.SubElement(node, f"{{{namespace}}}changefreq").text = "monthly"
            ET.SubElement(node, f"{{{namespace}}}priority").text = "0.7"
        lastmod = node.find(lastmod_tag)
        if lastmod is None:
            lastmod = ET.SubElement(node, lastmod_tag)
        lastmod.text = post["date"]

    tree.write(sitemap_path, encoding="utf-8", xml_declaration=True)


def main() -> None:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    if config.get("schemaVersion") != 1 or not isinstance(config.get("posts"), list):
        raise SystemExit("Unsupported blog config schema")
    drafts = [post for post in config["posts"] if isinstance(post.get("day"), int) and 31 <= post["day"] <= 50]
    if len(drafts) != 20:
        raise SystemExit(f"Expected 20 Day 31–50 entries; found {len(drafts)}")
    by_day = {post["day"]: post for post in drafts}
    if len(by_day) != 20:
        raise SystemExit("Duplicate day number in draft config")

    for day in range(31, 51):
        post = by_day[day]
        source_path = ARTICLE_DIR / f"day-{day:02d}.md"
        if not source_path.exists():
            raise SystemExit(f"Missing article source: {source_path}")
        source = source_path.read_text(encoding="utf-8")
        words = word_count(source)
        if not 2000 <= words <= 2800:
            raise SystemExit(f"Day {day} has {words} words; expected 2,000–2,800")
        post["readTime"] = max(1, math.ceil(words / 200))
        body_html = markdown_to_html(source, post["title"])
        (ROOT / "blog" / post["file"]).write_text(article_template(post, body_html), encoding="utf-8")
        IMAGE_DIR.mkdir(parents=True, exist_ok=True)
        (IMAGE_DIR / Path(post["image"]).name).write_text(make_svg(post, day), encoding="utf-8")
        PACK_DIR.mkdir(parents=True, exist_ok=True)
        (PACK_DIR / f"day-{day:02d}.md").write_text(article_pack(post, day, words), encoding="utf-8")

    sync_sitemap(config)
    CONFIG_PATH.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Built {len(drafts)} gated article pages, SVG covers, editorial packs, and published sitemap entries.")
    print("Preserved existing published flags; every Day 31–50 draft remains controlled by blog-config.json.")


if __name__ == "__main__":
    main()
