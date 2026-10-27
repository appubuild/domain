/**
 * Database-driven navigation.
 *
 * The site used to render its menu from a TypeScript constant while `nav_menus`/`nav_items`
 * sat unused in Postgres — a table that looked editable and was not. Now the database is the
 * source, which makes these rules load-bearing:
 *
 *   - an empty or broken table must not produce a site with no navigation;
 *   - ordering must be deterministic, or the static export diff churns on every build;
 *   - a menu item with no label or an unusable href is dropped, not rendered as a blank link.
 */

import { describe, expect, it } from "vitest";
import { buildNavigation, type NavItemRow, type NavMenuRow } from "@/lib/content/navigation";
import { FOOTER_NAV, PRIMARY_NAV } from "@/lib/config/site";

const menus: NavMenuRow[] = [
  { id: "primary", name: "Primary navigation", location: "primary", position: 10 },
  { id: "footer-company", name: "Company", location: "footer", position: 20 },
  { id: "footer-product", name: "Product", location: "footer", position: 10 },
];

const items: NavItemRow[] = [
  { menu_id: "primary", label: "Generator", href: "/generator", position: 10 },
  { menu_id: "primary", label: "Blog", href: "/blog", position: 20 },
  { menu_id: "footer-company", label: "About", href: "/about", position: 10 },
  { menu_id: "footer-product", label: "Generator", href: "/generator", position: 10 },
  { menu_id: "footer-product", label: "Extensions", href: "/extensions", position: 20 },
];

describe("buildNavigation", () => {
  it("maps rows into header items and footer columns", () => {
    const result = buildNavigation(menus, items);
    expect(result.source).toBe("database");
    expect(result.primary.map((item) => item.label)).toEqual(["Generator", "Blog"]);
    expect(result.footer.map((column) => column.heading)).toEqual(["Product", "Company"]);
    expect(result.footer[0]?.items.map((item) => item.label)).toEqual(["Generator", "Extensions"]);
  });

  it("orders footer columns by position, not by id", () => {
    const result = buildNavigation(menus, items);
    // "footer-company" < "footer-product" alphabetically; position must win.
    expect(result.footer[0]?.heading).toBe("Product");
  });

  it("orders items by position, then id", () => {
    const tied: NavItemRow[] = [
      { id: "b", menu_id: "primary", label: "Second", href: "/b", position: 10 },
      { id: "a", menu_id: "primary", label: "First", href: "/a", position: 10 },
      { id: "c", menu_id: "primary", label: "Last", href: "/c", position: 20 },
    ];
    const result = buildNavigation([{ id: "primary", name: "Primary", location: "primary" }], tied);
    expect(result.primary.map((item) => item.label)).toEqual(["First", "Second", "Last"]);
  });

  it("is stable across input order", () => {
    const forward = buildNavigation(menus, items);
    const reversed = buildNavigation([...menus].reverse(), [...items].reverse());
    expect(reversed.primary).toEqual(forward.primary);
    expect(reversed.footer).toEqual(forward.footer);
  });

  it("drops disabled items and disabled menus", () => {
    const result = buildNavigation(
      [...menus, { id: "footer-legal", name: "Legal", location: "footer", position: 30, enabled: false }],
      [...items, { menu_id: "primary", label: "Hidden", href: "/hidden", position: 30, enabled: false }],
    );
    expect(result.primary.map((item) => item.label)).not.toContain("Hidden");
    expect(result.footer.map((column) => column.heading)).not.toContain("Legal");
  });

  it("drops items with no label or an unusable href", () => {
    const result = buildNavigation([{ id: "primary", name: "Primary", location: "primary" }], [
      { menu_id: "primary", label: "  ", href: "/blank", position: 10 },
      { menu_id: "primary", label: "No href", href: "", position: 20 },
      { menu_id: "primary", label: "Relative", href: "about", position: 30 },
      { menu_id: "primary", label: "Fine", href: "/fine", position: 40 },
    ]);
    expect(result.primary.map((item) => item.label)).toEqual(["Fine"]);
  });

  it("keeps external and mailto links", () => {
    const result = buildNavigation([{ id: "primary", name: "Primary", location: "primary" }], [
      { menu_id: "primary", label: "Status", href: "https://status.example.com", position: 10 },
      { menu_id: "primary", label: "Email", href: "mailto:hello@example.com", position: 20 },
    ]);
    expect(result.primary.map((item) => item.href)).toEqual([
      "https://status.example.com",
      "mailto:hello@example.com",
    ]);
  });

  it("carries descriptions through and omits empty ones", () => {
    const result = buildNavigation([{ id: "primary", name: "Primary", location: "primary" }], [
      { menu_id: "primary", label: "A", href: "/a", description: "Explained", position: 10 },
      { menu_id: "primary", label: "B", href: "/b", description: "   ", position: 20 },
    ]);
    expect(result.primary[0]?.description).toBe("Explained");
    expect(result.primary[1]?.description).toBeUndefined();
  });

  it("ignores nested items rather than flattening them into the top level", () => {
    const result = buildNavigation([{ id: "primary", name: "Primary", location: "primary" }], [
      { menu_id: "primary", label: "Parent", href: "/parent", position: 10 },
      { menu_id: "primary", label: "Child", href: "/child", position: 20, parent_id: "parent-id" },
    ]);
    expect(result.primary.map((item) => item.label)).toEqual(["Parent"]);
  });

  it("falls back to the code defaults when the tables are empty", () => {
    const result = buildNavigation([], []);
    expect(result.source).toBe("defaults");
    expect(result.reason).toMatch(/empty/i);
    expect(result.primary).toEqual(PRIMARY_NAV);
    expect(result.footer.map((column) => column.heading)).toEqual(FOOTER_NAV.map((column) => column.heading));
  });

  it("falls back when rows exist but none are usable", () => {
    const result = buildNavigation([{ id: "primary", name: "Primary", location: "primary" }], [
      { menu_id: "primary", label: "", href: "", position: 10 },
    ]);
    expect(result.source).toBe("defaults");
    expect(result.primary).toEqual(PRIMARY_NAV);
  });

  it("uses whichever half the database actually has", () => {
    // Header rows but no footer rows: keep the real header, fall back for the footer, and do
    // not claim the whole navigation came from the database.
    const result = buildNavigation([{ id: "primary", name: "Primary", location: "primary" }], [
      { menu_id: "primary", label: "Only", href: "/only", position: 10 },
    ]);
    expect(result.primary.map((item) => item.label)).toEqual(["Only"]);
    expect(result.footer.map((column) => column.heading)).toEqual(
      FOOTER_NAV.map((column) => column.heading),
    );
  });
});
