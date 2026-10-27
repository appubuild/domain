/**
 * The committed seed must match its generator.
 *
 * `supabase/seed/seed.sql` says "AUTO-GENERATED — do not edit by hand", and during phase 8
 * three SEO fixes were made to the file itself rather than to `src/lib/content/defaults.ts`.
 * Nothing failed: the file was correct, its source was not, and the next regeneration would
 * have silently reverted the fixes.
 *
 * This test closes that hole. It also checks the properties the deployment relies on: the
 * seed is re-runnable (every insert converges rather than duplicating) and it stays inside a
 * single transaction so a partial seed cannot be left behind.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildSeedSql } from "../../scripts/seed-sql";

const SEED_FILE = path.join(process.cwd(), "supabase", "seed", "seed.sql");
const committed = readFileSync(SEED_FILE, "utf8");
const generated = buildSeedSql();

describe("seed file", () => {
  it("matches the generator byte for byte", () => {
    expect(
      committed === generated,
      "supabase/seed/seed.sql is out of date — run `npm run db:seed:generate`",
    ).toBe(true);
  });

  it("regenerates deterministically", () => {
    expect(buildSeedSql()).toBe(generated);
  });

  it("runs inside one transaction", () => {
    expect(committed.trimStart().startsWith("-- AUTO-GENERATED")).toBe(true);
    expect(committed).toMatch(/^begin;$/m);
    expect(committed.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("never inserts without a conflict strategy", () => {
    const inserts = committed.split("\n").filter((line) => line.startsWith("insert into"));
    expect(inserts.length).toBeGreaterThan(10);
    // Every insert statement must be followed, within its statement, by an `on conflict`.
    const statements = committed.split(/;\s*\n/);
    for (const statement of statements) {
      if (!statement.trimStart().startsWith("insert into")) continue;
      expect(statement, `non-idempotent insert:\n${statement.slice(0, 120)}`).toMatch(/on conflict/i);
    }
  });

  it("gives every nav item a conflict target, because items have no natural id", () => {
    expect(committed).toContain("on conflict (menu_id, href) do update");
    expect(committed).toContain("on conflict (id) do update set\n  name = excluded.name");
  });

  it("seeds the five menus the site renders", () => {
    for (const id of ["primary", "footer-product", "footer-resources", "footer-company", "footer-legal"]) {
      expect(committed).toContain(`('${id}',`);
    }
  });

  it("ships feature flags off by default", () => {
    const flags = committed.slice(committed.indexOf("insert into public.feature_flags"));
    for (const flag of ["public_api", "ai_studio", "advertising", "affiliate_routing"]) {
      const line = flags.split("\n").find((row) => row.includes(`('${flag}',`));
      expect(line, `missing flag ${flag}`).toBeDefined();
      expect(line).toContain("false");
    }
  });
});
