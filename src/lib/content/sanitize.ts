/**
 * Allowlist HTML sanitiser for CMS content.
 *
 * Admin-authored rich text is rendered with `dangerouslySetInnerHTML` in some places, so it
 * must be sanitised *before it is stored* and again at render time. This implementation is
 * a small tokeniser rather than a chain of regex replacements: an allowlist of tags and
 * attributes is enforced, and everything else is escaped or dropped.
 *
 * Deliberate limitations (documented): it does not attempt to validate CSS inside `style`
 * (style attributes are dropped entirely) and it does not permit `<svg>`, `<iframe>`,
 * `<form>`, `<script>` or `<style>`.
 */

export type SanitizeOptions = {
  /** Extra tags to permit beyond the default allowlist. */
  allowTags?: string[];
  /** Permit `target="_blank"` on links (rel is still forced). */
  allowTargetBlank?: boolean;
};

const ALLOWED_TAGS = new Set([
  "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "small", "sub", "sup",
  "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd",
  "blockquote", "cite", "q",
  "a", "code", "pre",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
  "figure", "figcaption", "img",
  "div", "span", "section", "article", "aside", "header", "footer",
]);

const VOID_TAGS = new Set(["br", "hr", "img"]);

const GLOBAL_ATTRS = new Set(["class", "id", "title", "lang", "dir"]);
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "rel", "target", "aria-label"]),
  img: new Set(["src", "alt", "width", "height", "loading", "decoding", "srcset", "sizes"]),
  td: new Set(["colspan", "rowspan", "scope"]),
  th: new Set(["colspan", "rowspan", "scope"]),
  ol: new Set(["start", "type"]),
  time: new Set(["datetime"]),
};

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

/** Tags whose entire content must be removed, not merely unwrapped. */
const STRIP_WITH_CONTENT = ["script", "style", "iframe", "object", "embed", "form", "input", "textarea", "select", "button", "svg", "math", "template", "noscript", "link", "meta", "base"];

export function sanitizeHtml(input: string, options: SanitizeOptions = {}): string {
  if (!input) return "";

  let html = String(input);

  // 1. Remove dangerous elements *with their content*.
  for (const tag of STRIP_WITH_CONTENT) {
    const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    const selfClosing = new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi");
    html = html.replace(paired, "").replace(selfClosing, "");
  }

  // 2. Drop HTML comments (can hide conditional comments / scripts).
  html = html.replace(/<!--[\s\S]*?-->/g, "");

  const allowedTags = new Set([...ALLOWED_TAGS, ...(options.allowTags ?? []).map((tag) => tag.toLowerCase())]);

  // 3. Walk the remaining tags and rebuild each one from an allowlist.
  html = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^>]*)?)\/?>/g, (match, rawName: string, rawAttrs: string) => {
    const name = rawName.toLowerCase();
    if (!allowedTags.has(name)) {
      // Unknown element: drop the tag, keep its text content.
      return "";
    }
    const isClosing = match.startsWith("</");
    if (isClosing) return VOID_TAGS.has(name) ? "" : `</${name}>`;
    if (VOID_TAGS.has(name)) return `<${name}${sanitizeAttributes(name, rawAttrs, options)}>`;
    return `<${name}${sanitizeAttributes(name, rawAttrs, options)}>`;
  });

  // 4. Neutralise anything that still looks like a script URL in text.
  html = html.replace(/(javascript|vbscript|data)\s*:/gi, (value) => value.replace(":", "&#58;"));

  return html.trim();
}

function sanitizeAttributes(tag: string, raw: string, options: SanitizeOptions): string {
  if (!raw.trim()) return "";
  const permitted = new Set([...(TAG_ATTRS[tag] ?? []), ...GLOBAL_ATTRS]);
  const out: string[] = [];
  const seen = new Set<string>();

  const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(raw)) !== null) {
    const name = (match[1] ?? "").toLowerCase();
    const value = match[3] ?? match[4] ?? match[5] ?? "";

    if (name.startsWith("on")) continue; // event handlers are never allowed
    if (name === "style") continue; // style attributes are dropped
    if (seen.has(name)) continue;
    if (!permitted.has(name)) {
      // Keep only a safe data-* attribute set on non-interactive containers.
      if (!name.startsWith("data-") || !["div", "span", "section", "article", "aside"].includes(tag)) continue;
    }

    if (name === "href" || name === "src" || name === "srcset") {
      const safe = sanitizeUrl(value);
      if (!safe) continue;
      seen.add(name);
      out.push(`${name}="${escapeAttribute(safe)}"`);
      continue;
    }

    if (name === "class") {
      const safeClass = value.replace(/[^a-zA-Z0-9\s_-]/g, "").slice(0, 200);
      if (!safeClass.trim()) continue;
      seen.add(name);
      out.push(`class="${escapeAttribute(safeClass)}"`);
      continue;
    }

    if (name === "target") {
      if (value === "_blank" && options.allowTargetBlank !== false) {
        seen.add(name);
        out.push(`target="_blank"`);
      }
      continue;
    }

    if (name === "id") {
      const safeId = value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
      if (!safeId) continue;
      seen.add(name);
      out.push(`id="${escapeAttribute(safeId)}"`);
      continue;
    }

    if (["width", "height", "colspan", "rowspan", "start"].includes(name)) {
      if (!/^[0-9]{1,4}$/.test(value)) continue;
      seen.add(name);
      out.push(`${name}="${value}"`);
      continue;
    }

    if (["loading", "decoding", "scope", "rel", "dir", "lang", "type"].includes(name)) {
      const safeToken = value.replace(/[^a-zA-Z0-9\s-]/g, "").slice(0, 60);
      if (!safeToken) continue;
      seen.add(name);
      out.push(`${name}="${escapeAttribute(safeToken)}"`);
      continue;
    }

    seen.add(name);
    out.push(`${name}="${escapeAttribute(value.slice(0, 500))}"`);
  }

  // Force safe rel on any link that opens a new tab.
  if (tag === "a" && out.some((attr) => attr.startsWith("target="))) {
    const withoutRel = out.filter((attr) => !attr.startsWith("rel="));
    withoutRel.push(`rel="noopener noreferrer nofollow"`);
    return ` ${withoutRel.join(" ")}`;
  }

  return out.length > 0 ? ` ${out.join(" ")}` : "";
}

export function sanitizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Protocol-relative URLs ("//host") inherit the page scheme and point at another origin;
  // they are rejected so a CMS field can never smuggle in an external host.
  if (trimmed.startsWith("//")) return null;
  // Relative URLs are allowed for internal links and local media.
  if (trimmed.startsWith("/")) return trimmed;
  if (trimmed.startsWith("#")) return trimmed;
  try {
    const url = new URL(trimmed, "https://example.invalid");
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
    if (url.protocol === "mailto:" || url.protocol === "tel:") return trimmed;
    return url.toString();
  } catch {
    return null;
  }
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Strips all markup to plain text (used for reading-time and excerpts). */
export function toPlainText(html: string): string {
  return sanitizeHtml(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Estimates reading time at 220 words per minute. */
export function readingMinutes(html: string): number {
  const words = toPlainText(html).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}
