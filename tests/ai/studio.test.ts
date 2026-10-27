/**
 * AI studio request/response contract.
 *
 * The studio is the one place where the product could quietly fabricate content. These tests
 * pin the two guarantees: the browser never sends an invalid request, and a provider failure
 * is never rendered as generated text.
 */

import { describe, expect, it } from "vitest";
import {
  DRAFT_KINDS,
  STUDIO_DISCLOSURE,
  buildPayload,
  parseStudioResponse,
  previewText,
  validateRequest,
  type StudioRequest,
} from "@/lib/ai/studio";

function request(overrides: Partial<StudioRequest> = {}): StudioRequest {
  return { kind: "outline", topic: "Choosing an extension for a fintech brand", ...overrides };
}

describe("validateRequest", () => {
  it("accepts a well-formed outline request", () => {
    expect(validateRequest(request())).toEqual([]);
  });

  it("rejects an empty or too-short topic", () => {
    expect(validateRequest(request({ topic: "" }))).toEqual([{ field: "topic", message: "Enter a topic." }]);
    expect(validateRequest(request({ topic: "abc" }))[0]?.field).toBe("topic");
    // Six characters is the boundary: "domain" passes, "domai" does not.
    expect(validateRequest(request({ topic: "domain" }))).toEqual([]);
    expect(validateRequest(request({ topic: "domai" }))[0]?.field).toBe("topic");
    expect(validateRequest(request({ topic: "   " }))[0]?.message).toBe("Enter a topic.");
  });

  it("rejects an over-long topic", () => {
    const issues = validateRequest(request({ topic: "a".repeat(201) }));
    expect(issues[0]?.field).toBe("topic");
  });

  it("rejects an unknown draft kind", () => {
    const issues = validateRequest(request({ kind: "poem" as never }));
    expect(issues.some((issue) => issue.field === "kind")).toBe(true);
  });

  it("only constrains the word target for full drafts", () => {
    expect(validateRequest(request({ kind: "outline", wordTarget: 5 }))).toEqual([]);
    expect(validateRequest(request({ kind: "draft", wordTarget: 50 }))[0]?.field).toBe("wordTarget");
    expect(validateRequest(request({ kind: "draft", wordTarget: 5000 }))[0]?.field).toBe("wordTarget");
    expect(validateRequest(request({ kind: "draft", wordTarget: 800 }))).toEqual([]);
  });

  it("caps the keyword list", () => {
    const issues = validateRequest(request({ keywords: Array.from({ length: 13 }, (_, index) => `k${index}`) }));
    expect(issues[0]?.field).toBe("keywords");
  });
});

describe("buildPayload", () => {
  it("trims, normalises and caps what is sent", () => {
    const payload = buildPayload(
      request({
        topic: "  Naming a fintech  ",
        audience: "  founders ",
        tone: "",
        keywords: [" payments ", "", "ledger", ...Array.from({ length: 15 }, (_, index) => `extra${index}`)],
        kind: "draft",
        wordTarget: 900,
      }),
    );

    expect(payload.topic).toBe("Naming a fintech");
    expect(payload.audience).toBe("founders");
    expect(payload.tone).toBeNull();
    expect(payload.keywords).toHaveLength(12);
    expect(payload.keywords[0]).toBe("payments");
    expect(payload.wordTarget).toBe(900);
  });

  it("omits the word target for non-draft kinds", () => {
    expect(buildPayload(request({ kind: "faq", wordTarget: 900 })).wordTarget).toBeNull();
  });

  it("never sends a post id it was not given", () => {
    expect(buildPayload(request()).postId).toBeNull();
    expect(buildPayload(request({ postId: "abc" })).postId).toBe("abc");
  });
});

describe("parseStudioResponse", () => {
  const body = {
    content: "## Introduction\n\nA domain name is a commitment, not a decoration. Consider the registry.",
    provider: "openai",
    model: "gpt-4o-mini",
  };

  it("accepts a real completion", () => {
    expect(parseStudioResponse(200, body)).toEqual({
      ok: true,
      content: body.content,
      provider: "openai",
      model: "gpt-4o-mini",
    });
  });

  it.each([
    [503, "unconfigured"],
    [403, "flag-off"],
    [429, "rate-limited"],
    [502, "provider-error"],
    [500, "provider-error"],
  ] as const)("maps HTTP %i to %s", (status, reason) => {
    const result = parseStudioResponse(status, { error: "nope" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(reason);
  });

  it("treats an empty or truncated body as a failure, never as content", () => {
    for (const content of ["", "   ", "Too short."]) {
      const result = parseStudioResponse(200, { content, provider: "openai" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid-response");
    }
  });

  it("rejects a payload with no content field at all", () => {
    expect(parseStudioResponse(200, { provider: "openai" }).ok).toBe(false);
    expect(parseStudioResponse(200, null).ok).toBe(false);
    expect(parseStudioResponse(200, "plain string").ok).toBe(false);
  });

  it("defaults unknown provider metadata rather than inventing one", () => {
    const result = parseStudioResponse(200, { content: body.content });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe("unknown");
      expect(result.model).toBeNull();
    }
  });
});

describe("studio copy", () => {
  it("offers four draft kinds", () => {
    expect(DRAFT_KINDS.map((kind) => kind.value)).toEqual(["outline", "draft", "metadata", "faq"]);
  });

  it("says plainly that output is a draft", () => {
    expect(STUDIO_DISCLOSURE).toMatch(/draft/i);
    expect(STUDIO_DISCLOSURE).toMatch(/never/i);
  });

  it("previews long content without breaking words mid-ellipsis", () => {
    const long = "word ".repeat(200);
    const preview = previewText(long, 50);
    expect(preview.length).toBeLessThanOrEqual(50);
    expect(preview.endsWith("…")).toBe(true);
    expect(previewText("short", 50)).toBe("short");
  });
});
