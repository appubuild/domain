/**
 * Rich text editor ←→ sanitiser contract.
 *
 * The editor toolbar only offers marks that survive `sanitizeHtml`. That claim is cheap to state
 * and easy to break (add an alignment control and every save silently drops it), so it is pinned
 * here: every node/mark the toolbar can produce is passed through the sanitiser and must come out
 * byte-identical. The component's HTML is faked from Tiptap's documented output rather than by
 * mounting the editor, because the test environment has no DOM — the shapes below are exactly what
 * StarterKit emits for each toolbar button.
 */

import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "@/lib/content/sanitize";
import { RICH_TEXT_EXTENSIONS, sanitizeEditorHtml } from "@/components/admin/rich-text-editor";

/** Attribute order is not meaningful in HTML; compare the set instead of the string. */
function attributesOf(html: string, tag: string): string[] {
  const match = new RegExp(`<${tag}\\b([^>]*)>`).exec(html);
  if (!match) return [];
  return (match[1]!.match(/[a-zA-Z-]+="[^"]*"/g) ?? []).sort();
}

const SAMPLES: Array<{ mark: string; html: string }> = [
  { mark: "bold", html: "<p><strong>bold</strong></p>" },
  { mark: "italic", html: "<p><em>italic</em></p>" },
  { mark: "underline", html: "<p><u>under</u></p>" },
  { mark: "strike", html: "<p><s>struck</s></p>" },
  { mark: "code", html: "<p><code>inline</code></p>" },
  { mark: "heading", html: "<h2>Two</h2><h3>Three</h3>" },
  { mark: "bulletList", html: "<ul><li><p>one</p></li><li><p>two</p></li></ul>" },
  { mark: "orderedList", html: "<ol><li><p>one</p></li></ol>" },
  { mark: "blockquote", html: "<blockquote><p>quoted</p></blockquote>" },
  {
    mark: "link",
    // Tiptap emits rel/target on links configured with HTMLAttributes; the sanitiser rewrites rel.
    html: '<p><a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com/">link</a></p>',
  },
];

describe("rich text editor output", () => {
  it.each(SAMPLES)("keeps $mark intact", ({ mark, html }) => {
    const cleaned = sanitizeHtml(html);
    if (mark === "link") {
      // The sanitiser appends its forced rel last and rewrites the target order; the attribute
      // values must be identical, the order must not matter.
      expect(attributesOf(cleaned, "a")).toEqual(attributesOf(html, "a"));
      expect(cleaned.replace(/<a [^>]*>/, "<a>")).toBe(html.replace(/<a [^>]*>/, "<a>"));
    } else {
      expect(cleaned).toBe(html);
    }
  });

  it("lists only marks the editor actually ships", () => {
    // StarterKit 3 bundles all of these; the list exists so a removed extension cannot leave a
    // toolbar button behind that does nothing.
    expect(new Set(RICH_TEXT_EXTENSIONS)).toEqual(
      new Set(["bold", "italic", "underline", "strike", "code", "heading", "bulletList", "orderedList", "blockquote", "link"]),
    );
    expect(SAMPLES.map((sample) => sample.mark)).toEqual(RICH_TEXT_EXTENSIONS);
  });

  it("strips the attributes a paste could smuggle in", () => {
    const pasted = '<p style="color:red" onclick="alert(1)">hey <span style="font-size:40px">big</span></p>';
    // The span tag itself is harmless once its style is gone, so the sanitiser keeps the element
    // and drops the attribute rather than reflowing the markup.
    expect(sanitizeEditorHtml(pasted)).toBe("<p>hey <span>big</span></p>");
    // A dangerous URL loses its href; the anchor itself is inert and keeps its text.
    expect(sanitizeEditorHtml('<p><a href="javascript:alert(1)">x</a></p>')).toBe("<p><a>x</a></p>");
    // Relative links are legitimate internal links and must survive.
    expect(sanitizeHtml('<p><a href="/blog/">x</a></p>')).toBe('<p><a href="/blog/">x</a></p>');
  });

  it("is idempotent, so a second save cannot change the stored body", () => {
    for (const { html } of SAMPLES) {
      expect(sanitizeHtml(sanitizeHtml(html))).toBe(sanitizeHtml(html));
    }
  });
});
