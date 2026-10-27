import { describe, expect, it } from "vitest";
import { MIN_BLOCKS_FOR_SPLIT, splitArticleBody } from "@/lib/content/article";

/**
 * Mid-content splitting.
 *
 * The placement is only honest if the cut is genuinely between blocks and nothing is lost.
 * These tests pin both properties, plus the refusal to cut a short article at all.
 */

const short = "<p>One paragraph.</p><p>Two paragraphs.</p>";
const long = ["<h2>First</h2>", "<p>Alpha.</p>", "<p>Beta.</p>", "<p>Gamma.</p>", "<p>Delta.</p>", "<ul><li>x</li></ul>"].join("");

describe("splitArticleBody", () => {
  it("refuses to split a body with fewer than four blocks", () => {
    const result = splitArticleBody(short);
    expect(result.rest).toBe("");
    expect(result.lead).toBe(short);
  });

  it("splits a long body into two non-empty halves that rejoin exactly", () => {
    const result = splitArticleBody(long);
    expect(result.rest.length).toBeGreaterThan(0);
    expect(result.lead.length).toBeGreaterThan(0);
    expect(result.lead + result.rest).toBe(long);
  });

  it("cuts between blocks, never inside one", () => {
    const result = splitArticleBody(long);
    expect(result.lead.trimEnd().endsWith(">")).toBe(true);
    expect(result.rest.trimStart().startsWith("<")).toBe(true);
  });

  it("puts the cut near the middle rather than at an edge", () => {
    const result = splitArticleBody(long);
    const ratio = result.lead.length / long.length;
    expect(ratio).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(0.8);
  });

  it("keeps the whole body when there is nothing after the last block", () => {
    const fourBlocks = "<p>a</p><p>b</p><p>c</p><p>d</p>";
    const result = splitArticleBody(fourBlocks);
    // A valid split is still allowed here, but the halves must be real content, not whitespace.
    expect(result.lead + result.rest).toBe(fourBlocks);
    if (result.rest) expect(result.rest.trim().length).toBeGreaterThan(0);
  });

  it("uses a block count threshold that is at least four", () => {
    expect(MIN_BLOCKS_FOR_SPLIT).toBeGreaterThanOrEqual(4);
  });

  it("leaves plain text with no block tags alone", () => {
    const plain = "Just text, no markup at all.";
    expect(splitArticleBody(plain)).toEqual({ lead: plain, rest: "" });
  });
});
