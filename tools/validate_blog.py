#!/usr/bin/env python3
"""Validate DomainFits's static blog config, drafts, assets, links, and sitemap."""
from __future__ import annotations

from datetime import date
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "blog" / "blog-config.json"
SITEMAP = ROOT / "sitemap.xml"
REQUIRED = {"id", "slug", "title", "excerpt", "date", "readTime", "tags", "published", "file", "category", "image", "imageAlt"}
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
FILE_RE = re.compile(r"^blog-[a-z0-9-]+\.html$")
IMAGE_RE = re.compile(r"^/assets/img/blog/feature-[a-z0-9-]+\.(?:jpe?g|png|webp|svg)$", re.I)
WORD_RE = re.compile(r"\b[\w’'-]+\b", re.UNICODE)


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tags: list[tuple[str, dict[str, str | None]]] = []
        self.links: list[str] = []
        self.json_ld: list[str] = []
        self._current_json: list[str] | None = None
        self._current_type = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        self.tags.append((tag, attributes))
        if tag in ("a", "link") and attributes.get("href"):
            self.links.append(str(attributes["href"]))
        if tag == "img" and attributes.get("src"):
            self.links.append(str(attributes["src"]))
        if tag == "script":
            self._current_type = str(attributes.get("type") or "")
            if self._current_type == "application/ld+json":
                self._current_json = []

    def handle_data(self, data: str) -> None:
        if self._current_json is not None:
            self._current_json.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._current_json is not None:
            self.json_ld.append("".join(self._current_json))
            self._current_json = None
            self._current_type = ""


def fail(message: str) -> None:
    raise AssertionError(message)


def local_target(value: str) -> Path | None:
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc or not parsed.path.startswith("/"):
        return None
    if not parsed.path:
        return None
    return ROOT / parsed.path.lstrip("/")


def main() -> int:
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    if config.get("schemaVersion") != 1 or config.get("defaultPublished") is not False:
        fail("blog-config.json must use schemaVersion 1 and defaultPublished false")
    posts = config.get("posts")
    if not isinstance(posts, list) or not posts:
        fail("blog config posts must be a non-empty array")

    ids: set[str] = set()
    slugs: set[str] = set()
    files: set[str] = set()
    for index, post in enumerate(posts, 1):
        missing = REQUIRED - set(post)
        if missing:
            fail(f"post #{index} is missing fields: {sorted(missing)}")
        if not isinstance(post["published"], bool):
            fail(f"{post['slug']}: published must be a JSON boolean")
        if not isinstance(post["id"], str) or not post["id"].strip() or post["id"] in ids:
            fail(f"duplicate or invalid post id: {post['id']!r}")
        if not isinstance(post["slug"], str) or not SLUG_RE.fullmatch(post["slug"]) or post["slug"] in slugs:
            fail(f"duplicate or invalid post slug: {post['slug']!r}")
        if not isinstance(post["file"], str) or not FILE_RE.fullmatch(post["file"]) or post["file"] in files:
            fail(f"duplicate or unsafe article filename: {post['file']!r}")
        try:
            date.fromisoformat(post["date"])
        except (TypeError, ValueError):
            fail(f"{post['slug']}: date must be an ISO calendar date")
        if not isinstance(post["readTime"], int) or post["readTime"] < 1:
            fail(f"{post['slug']}: readTime must be a positive integer")
        if not isinstance(post["tags"], list) or not all(isinstance(tag, str) for tag in post["tags"]):
            fail(f"{post['slug']}: tags must be a string array")
        if not isinstance(post["title"], str) or not post["title"].strip() or not isinstance(post["excerpt"], str):
            fail(f"{post['slug']}: title and excerpt must be strings")
        if not isinstance(post["category"], str) or not post["category"].strip():
            fail(f"{post['slug']}: category is required")
        if not isinstance(post["image"], str) or not IMAGE_RE.fullmatch(post["image"]):
            fail(f"{post['slug']}: image must be a local feature image")
        image_path = ROOT / post["image"].lstrip("/")
        if not image_path.is_file():
            fail(f"{post['slug']}: missing featured image {image_path.relative_to(ROOT)}")
        if not (ROOT / "blog" / post["file"]).is_file():
            fail(f"{post['slug']}: missing static article {post['file']}")
        ids.add(post["id"]); slugs.add(post["slug"]); files.add(post["file"])

    drafts = [post for post in posts if isinstance(post.get("day"), int) and 31 <= post["day"] <= 50]
    if len(drafts) != 20 or {post["day"] for post in drafts} != set(range(31, 51)):
        fail("expected exactly one configured article for each Day 31 through Day 50")

    sitemap_root = ET.parse(SITEMAP).getroot()
    sitemap_ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    sitemap_urls = {node.text for node in sitemap_root.findall("s:url/s:loc", sitemap_ns) if node.text}
    origin = "https://example.com"
    if sitemap_urls:
        parsed_origin = urlsplit(next(iter(sitemap_urls)))
        if parsed_origin.scheme and parsed_origin.netloc:
            origin = f"{parsed_origin.scheme}://{parsed_origin.netloc}"
    for post in drafts:
        source_path = ROOT / "blog" / "articles" / f"day-{post['day']:02d}.md"
        pack_path = ROOT / "blog" / "editorial-packs" / f"day-{post['day']:02d}.md"
        if not source_path.is_file() or not pack_path.is_file():
            fail(f"Day {post['day']}: missing article source or editorial pack")
        source = source_path.read_text(encoding="utf-8")
        words = len(WORD_RE.findall(source))
        if not 2000 <= words <= 2800:
            fail(f"Day {post['day']}: {words} words, outside 2,000–2,800")
        if not source.startswith(f"# {post['title']}\n"):
            fail(f"Day {post['day']}: H1 does not match config title")

        page_path = ROOT / "blog" / post["file"]
        parser = PageParser(); parser.feed(page_path.read_text(encoding="utf-8"))
        meta = [attrs for tag, attrs in parser.tags if tag == "meta" and attrs.get("name") == "robots"]
        expected_robots = "index,follow,max-image-preview:large" if post["published"] else "noindex,nofollow"
        if not meta or meta[0].get("content") != expected_robots:
            fail(f"{post['file']}: run tools/build_draft_blog.py to sync robots metadata")
        article_gates = [attrs for tag, attrs in parser.tags if "data-publish-guard" in attrs]
        if not article_gates or article_gates[0].get("data-post-slug") != post["slug"]:
            fail(f"{post['file']}: missing publication gate or slug mismatch")
        if not any("blog-publish-guard.js" in url for url in [str(attrs.get("src")) for tag, attrs in parser.tags if tag == "script"]):
            fail(f"{post['file']}: missing publication guard script")
        for json_ld in parser.json_ld:
            try:
                json.loads(json_ld)
            except json.JSONDecodeError as error:
                fail(f"{post['file']}: invalid JSON-LD: {error}")
        for link in parser.links:
            target = local_target(link)
            if target is not None and not target.exists():
                fail(f"{post['file']}: broken local URL {link}")
        image_file = ROOT / post["image"].lstrip("/")
        if image_file.suffix.lower() == ".svg":
            ET.parse(image_file)
        sitemap_url = f"{origin}/blog/{post['file']}"
        if (post["published"] is True) != (sitemap_url in sitemap_urls):
            fail(f"{post['file']}: sitemap publication state is out of sync; run the build helper")

    blog_js = (ROOT / "assets/js/blog.js").read_text(encoding="utf-8")
    if "fetch('./blog-config.json'" not in blog_js or "post.published === true" not in blog_js:
        fail("blog.js must fetch blog-config.json and strictly filter published === true")
    generator_js = (ROOT / "assets/js/domain-generator.js").read_text(encoding="utf-8")
    generator_html = (ROOT / "tools/domain-generator.html").read_text(encoding="utf-8")
    generator_data = (ROOT / "assets/js/domain-generator-data.js").read_text(encoding="utf-8")
    css = (ROOT / "assets/css/style.css").read_text(encoding="utf-8")
    for tier in (2, 3, 4, 5, 6):
        if f".length-pill--{tier}" not in css:
            fail(f"missing visual style for partner-word length tier {tier}")
    if "length-pill length-pill--${lengthTier}" not in generator_js or "6L+'" not in generator_js:
        fail("generator does not render dynamic partner-word length badges")
    if "const lengthTier = partnerLength >= 6 ? 6 : partnerLength;" not in generator_js:
        fail("badge color tier must use partner-word length, not total domain-label length")
    if "Total domain label: ${labelLength} characters" not in generator_js:
        fail("generator tooltip must show the total domain-label character count")
    if "id=\"len7\" value=\"7\"" not in generator_html or "7+ letters" not in generator_html:
        fail("generator is missing the 7+ partner-word length filter")
    if "const LENGTHS = [2, 3, 4, 5, 6, 7];" not in generator_js or "word.length >= 7" not in generator_js:
        fail("generator must support filtering partner words with seven or more letters")
    if "const LONG_PARTNER_WORDS = [" not in generator_data:
        fail("7+ partner-word filter needs a supplemental word pool")
    archive = (ROOT / "blog/index.html").read_text(encoding="utf-8")
    if 'data-blog-pagination' not in archive or 'data-blog-category' not in archive:
        fail("blog archive is missing pagination or category filter")

    print(f"PASS: {len(posts)} config records ({sum(bool(p['published']) for p in posts)} published), {len(drafts)} complete Day 31–50 drafts.")
    print("PASS: article word counts, publication gates, JSON-LD, local links, images, categories, and sitemap status.")
    print("PASS: strict published-only archive loading, partner-word length badges, total-label tooltips, and the 7+ filter.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (AssertionError, KeyError, OSError, json.JSONDecodeError, ET.ParseError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)
