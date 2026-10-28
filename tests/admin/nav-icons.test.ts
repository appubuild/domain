/**
 * Every admin route has an icon, and every icon comes from one library.
 *
 * The sidebar is generated from `ADMIN_NAV`, so a new screen appears there the moment it is
 * registered — and, without this test, would appear with a fallback icon that looks like an
 * unfinished row. The failure is silent in review and obvious to a user, which is exactly the
 * kind of thing a test is cheaper at than a reader.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { activeNavHref } from "@/lib/admin/resources";

import { ADMIN_NAV } from "@/lib/admin/resources";
import { NAV_ICON_SIZE, hasIcon, iconForHref } from "@/components/admin/nav-icons";

describe("admin navigation icons", () => {
  it("has an icon for every navigation entry", () => {
    const missing = ADMIN_NAV.flatMap((group) => group.items).filter((item) => !hasIcon(item.href));
    expect(missing.map((item) => item.href)).toEqual([]);
  });

  it("resolves every entry to a component, never to a bare string", () => {
    for (const item of ADMIN_NAV.flatMap((group) => group.items)) {
      const icon = iconForHref(item.href);
      expect(icon, item.href).toBeTruthy();
      expect(typeof icon).not.toBe("string");
    }
  });

  it("uses one icon size for the whole sidebar", () => {
    // A single utility class here is what keeps 30 rows visually aligned.
    expect(NAV_ICON_SIZE).toMatch(/^size-\d(\.\d)?$/);
  });

  it("draws every icon from the one library the rest of the UI uses", () => {
    const source = readFileSync(path.resolve("src/components/admin/nav-icons.tsx"), "utf8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)]
      .map((match) => match[1] ?? "")
      // Type-only imports carry no bundle weight and are not an icon source.
      .filter((specifier) => !specifier.startsWith("."));
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) {
      expect(specifier, "one icon library keeps stroke weight and sizing consistent").toBe("lucide-react");
    }
  });
});

describe("active nav for the full-page editor", () => {
  it("keeps the list the editor was opened from highlighted", () => {
    expect(activeNavHref("/admin/editor/", "post")).toBe("/admin/posts/");
    expect(activeNavHref("/admin/editor/", "page")).toBe("/admin/pages/");
    expect(activeNavHref("/admin/editor/", null)).toBe("/admin/posts/");
  });

  it("leaves every other route to the prefix match", () => {
    expect(activeNavHref("/admin/posts/", "post")).toBeNull();
    expect(activeNavHref("/admin/", null)).toBeNull();
  });
});
