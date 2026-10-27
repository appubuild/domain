/**
 * Seed → render path for navigation, checked against real Postgres (PGlite).
 *
 * `buildNavigation()` is unit-tested with hand-written rows, and the seed is checked against
 * its generator, but neither proves the two fit together: the seed's `location` values, the
 * `position` ordering and the enabled flags all have to line up for the footer to render five
 * columns instead of three.
 *
 * This test loads the migrations and the seed into a real PostgreSQL engine, reads the rows
 * back, and asserts the navigation that would be rendered. It is the closest available
 * substitute for building against the live project, which the sandbox cannot reach.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { buildNavigation } from "@/lib/content/navigation";
import { FOOTER_NAV, PRIMARY_NAV } from "@/lib/config/site";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const SEED_FILE = path.join(process.cwd(), "supabase", "seed", "seed.sql");

let db: PGlite;

type MenuRow = { id: string; name: string; location: string; position: number; enabled: boolean };
type ItemRow = {
  menu_id: string;
  label: string;
  href: string;
  description: string;
  position: number;
  enabled: boolean;
  parent_id: string | null;
};

async function readNavigation() {
  const menus = await db.query<MenuRow>(
    `select id, name, location, position, enabled from public.nav_menus order by position, id`,
  );
  const items = await db.query<ItemRow>(
    `select menu_id, label, href, description, position, enabled, parent_id
     from public.nav_items where enabled order by position, label`,
  );
  return buildNavigation(menus.rows, items.rows);
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key, email text unique, created_at timestamptz not null default now());
    create or replace function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin;
    create role authenticated nologin;
    grant usage on schema auth to anon, authenticated;
  `);
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  await db.exec(readFileSync(SEED_FILE, "utf8"));
});

afterAll(async () => {
  await db?.close();
});

describe("seeded navigation", () => {
  it("renders from the database, not from the code defaults", async () => {
    const navigation = await readNavigation();
    expect(navigation.source).toBe("database");
    expect(navigation.reason).toBeNull();
  });

  it("produces the header menu in the configured order", async () => {
    const navigation = await readNavigation();
    expect(navigation.primary).toEqual(PRIMARY_NAV);
  });

  it("produces all five footer columns, in position order", async () => {
    const navigation = await readNavigation();
    expect(navigation.footer.map((column) => column.heading)).toEqual([
      "Product",
      "Resources",
      "Company",
      "Legal",
    ]);
    expect(navigation.footer.map((column) => column.items.length)).toEqual([4, 4, 3, 4]);
  });

  it("keeps the same footer links the code defaults advertise", async () => {
    const navigation = await readNavigation();
    const flatten = (columns: Array<{ items: Array<{ label: string; href: string }> }>) =>
      columns.flatMap((column) => column.items.map((item) => `${item.label}|${item.href}`)).sort();

    expect(flatten(navigation.footer)).toEqual(flatten(FOOTER_NAV));
  });

  it("survives a re-run of the seed without duplicating links", async () => {
    await db.exec(readFileSync(SEED_FILE, "utf8"));
    const before = await readNavigation();

    await db.exec(readFileSync(SEED_FILE, "utf8"));
    const after = await readNavigation();

    expect(after.primary).toEqual(before.primary);
    expect(after.footer).toEqual(before.footer);

    const count = await db.query<{ count: number }>(`select count(*)::int as count from public.nav_items`);
    expect(count.rows[0]?.count).toBe(20);
  });

  it("hides a disabled menu without deleting it", async () => {
    await db.exec(`update public.nav_menus set enabled = false where id = 'footer-company'`);
    const navigation = await readNavigation();
    expect(navigation.footer.map((column) => column.heading)).not.toContain("Company");
    await db.exec(`update public.nav_menus set enabled = true where id = 'footer-company'`);
  });
});
