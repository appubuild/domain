/**
 * Weight budgets for the shipped site.
 *
 * The measurement reads the script and stylesheet list out of each prerendered HTML file —
 * exactly what a browser fetches before it can interact — so it cannot drift from reality the
 * way a hand-maintained table does. Budgets sit slightly above today's numbers: they exist to
 * catch an accidental heavy import, not to force a rewrite.
 */

import { stat } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { BUDGETS, measureRoutes, overBudget, type RouteWeight } from "../../scripts/audit-bundle";

const hasBuild = await stat(path.resolve("out/index.html")).then(
  () => true,
  () => false,
);

describe.skipIf(!hasBuild)("first-load weight", () => {
  let routes: RouteWeight[] = [];

  beforeAll(async () => {
    routes = await measureRoutes();
  });

  it("measures every prerendered route", () => {
    expect(routes.length).toBeGreaterThan(40);
    // Every page must actually reference its JS; a zero would mean the parser stopped working.
    expect(routes.every((route) => route.js > 0)).toBe(true);
  });

  it("keeps every route inside its budget", () => {
    const breaches = routes.flatMap((route) => overBudget(route).map((reason) => `${route.route}: ${reason}`));
    expect(breaches, breaches.join("\n")).toHaveLength(0);
  });

  it("keeps the CSS payload small enough to be shared by every route", () => {
    expect(BUDGETS.css).toBeGreaterThan(0);
    for (const route of routes) expect(route.css).toBeLessThanOrEqual(BUDGETS.css);
  });

  it("does not ship the admin bundle to public pages", () => {
    // The admin screens pull in the Supabase auth helpers and the reference editor; a public
    // page that suddenly weighs as much as /admin/posts/ means a shared import went wrong.
    const publicRoutes = routes.filter((route) => !route.route.startsWith("/admin"));
    const heaviestPublic = Math.max(...publicRoutes.map((route) => route.js));
    const adminRoutes = routes.filter((route) => route.route.startsWith("/admin"));
    const heaviestAdmin = Math.max(...adminRoutes.map((route) => route.js));
    expect(heaviestPublic).toBeLessThanOrEqual(heaviestAdmin);
  });
});

if (!hasBuild) {
  describe("first-load weight", () => {
    it.skip("skipped: out/ has no build — run `npm run build` first", () => {});
  });
}
