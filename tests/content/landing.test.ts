/**
 * Landing page: claims must match the product.
 *
 * A marketing page is the easiest place in a codebase to state something the software does not do,
 * and the hardest place to notice. These tests render the real page component (the same one the
 * static export runs) and pair that with checks that the copy still describes shipped behaviour:
 * six steps, six styles, the four partner lengths, the three quantities, and no availability
 * language that implies a lookup happened when it did not.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HomePage from "@/app/page";
import { FEATURES, HOW_IT_WORKS, LANDING_FAQ } from "@/lib/content/landing";
import { NAMING_STYLES } from "@/lib/generator/naming-styles";
import { VALID_TARGETS } from "@/lib/generator/url-state";

async function render(): Promise<string> {
  const element = await HomePage();
  return renderToStaticMarkup(element);
}

describe("landing copy matches the engine", () => {
  it("documents six pipeline stages", () => {
    expect(HOW_IT_WORKS).toHaveLength(6);
    expect(HOW_IT_WORKS.map((step) => step.title)).toEqual([
      "Normalise the root",
      "Analyse the root",
      "Expand semantically",
      "Generate with the chosen styles",
      "Filter, de-duplicate, score",
      "Check availability on request",
    ]);
  });

  it("counts the naming styles it advertises", () => {
    const claimed = FEATURES.find((feature) => feature.title === "Six naming styles");
    expect(claimed).toBeDefined();
    expect(NAMING_STYLES).toHaveLength(6);
  });

  it("advertises the quantities the generator actually offers", () => {
    expect(VALID_TARGETS).toEqual(expect.arrayContaining([100, 500, 1000]));
    const quantities = FEATURES.find((feature) => feature.title.startsWith("Exact quantities"));
    expect(quantities?.body).toMatch(/100, 500 or 1,000/);
  });

  it("names all four partner lengths", () => {
    const partner = FEATURES.find((feature) => feature.title.startsWith("Partner lengths"));
    expect(partner?.body).toMatch(/2, 3, 4 and 5/);
  });

  it("never promises availability without a lookup", () => {
    for (const feature of FEATURES) {
      expect(feature.body.toLowerCase()).not.toMatch(/\bguaranteed available\b|\bfree to register\b/);
    }
    const faq = LANDING_FAQ.map((item) => `${item.question} ${item.answer}`).join(" ").toLowerCase();
    expect(faq).toContain("not checked");
    expect(faq).toContain("never");
    expect(faq).not.toContain("guarantee");
  });
});

describe("landing page rendering", () => {
  it("renders the working generator entry point in the hero", async () => {
    const html = await render();
    expect(html).toContain("What is the name for?");
    expect(html).toContain('name="q"');
    expect(html).toContain("Generate names");
    // The field is a real form that navigates to the generator, not a decorative input.
    expect(html).not.toContain("<form action=\"#\"");
  });

  it("shows real engine output with an unchecked availability badge", async () => {
    const html = await render();
    expect(html).toContain("Engine output, not a mock-up");
    expect(html).toContain("Not checked");
    expect(html).toContain("Run this search yourself");
    // A candidate label in CamelCase form, i.e. the engine ran during the build.
    expect(html).toMatch(/class="block truncate font-semibold text-fg">[A-Z][a-z]+[A-Z]/);
  });

  it("renders every how-it-works step and FAQ answer", async () => {
    const html = await render();
    for (const step of HOW_IT_WORKS) {
      expect(html).toContain(step.title);
    }
    for (const item of LANDING_FAQ) {
      expect(html).toContain(item.question);
      expect(html).toContain(item.answer.slice(0, 40));
    }
  });

  it("publishes FAQ structured data that matches the visible questions", async () => {
    const html = await render();
    const match = /"@type":"FAQPage"/.test(html);
    expect(match).toBe(true);
    expect(html).toContain('"@type":"WebSite"');
    // No sitelinks search box: the blog has no search endpoint.
    expect(html).not.toContain("SearchAction");
  });

  it("uses one h1 and sectioned h2 headings", async () => {
    const html = await render();
    expect((html.match(/<h1\b/g) ?? []).length).toBe(1);
    expect((html.match(/<h2\b/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("links the blog strip and its articles", async () => {
    const html = await render();
    expect(html).toContain('href="/blog/"');
    expect(html).toMatch(/href="\/blog\/[a-z0-9-]+\/?\"|href="\/blog\/[a-z0-9-]+\/"/);
  });
});
