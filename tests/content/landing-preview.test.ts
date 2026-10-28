/**
 * The landing preview is engine output, not a screenshot.
 *
 * It is generated at build time with a fixed seed, which makes it reproducible — and makes it
 * fragile in a useful way: if a future change stops the engine producing anything for the preview
 * root, the page silently renders an empty card. This pins the contract the page relies on.
 */

import { describe, expect, it } from "vitest";
import { createGenerationRequest, generate } from "@/lib/brain";

function preview(root = "pay", seed = 20260501, count = 3) {
  return generate(
    createGenerationRequest({ roots: [root], tlds: [".com"], targetCount: count, seed, styles: ["standard"] }),
    {},
  );
}

describe("landing preview", () => {
  it("returns the candidates the page shows", () => {
    const result = preview();
    expect(result.candidates.length).toBe(3);
    expect(result.diagnostics.requested).toBe(3);
    expect(new Set(result.candidates.map((c) => c.label)).size).toBe(3);
  });

  it("is reproducible, so a rebuild does not shuffle the page", () => {
    expect(preview().candidates.map((c) => c.label)).toEqual(preview().candidates.map((c) => c.label));
  });

  it("renders CamelCase next to a lower-case domain", () => {
    for (const candidate of preview().candidates) {
      expect(candidate.displayName).toMatch(/[A-Z]/);
      expect(candidate.label).toBe(candidate.label.toLowerCase());
      expect(candidate.domains[0]?.domain).toBe(`${candidate.label}.com`);
    }
  });
});
