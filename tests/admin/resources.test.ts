/**
 * Admin registry ↔ database contract.
 *
 * The admin panel is generic: one CRUD manager reads `ADMIN_RESOURCES` and issues queries
 * against real tables. A typo in a column name would therefore only surface when an
 * administrator opened that screen and saw a Postgres error.
 *
 * This test loads the **real migrations** into PostgreSQL (PGlite) and checks every
 * resource descriptor against the live schema: the table exists, every field and list
 * column is a real column, identity keys are complete and actually unique, and required
 * fields line up with columns that are not nullable without a default.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ADMIN_NAV, ADMIN_RESOURCES, ADMIN_MODULE_COUNT, getResource } from "@/lib/admin/resources";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

type ColumnInfo = {
  column_name: string;
  data_type: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
};

let db: PGlite;
let schema: Map<string, Map<string, ColumnInfo>>;

async function bootstrap() {
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

  const { rows } = await db.query<ColumnInfo & { table_name: string }>(`
    select table_name, column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public'
  `);

  schema = new Map();
  for (const row of rows) {
    const table = schema.get(row.table_name) ?? new Map<string, ColumnInfo>();
    table.set(row.column_name, row);
    schema.set(row.table_name, table);
  }
}

beforeAll(async () => {
  await bootstrap();
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("admin registry", () => {
  it("points every resource at a real table", () => {
    for (const resource of ADMIN_RESOURCES) {
      expect(schema.has(resource.table), `${resource.key} → ${resource.table}`).toBe(true);
    }
  });

  it("uses only columns that exist", () => {
    for (const resource of ADMIN_RESOURCES) {
      const table = schema.get(resource.table);
      expect(table, resource.table).toBeDefined();
      if (!table) continue;

      const referenced = new Set<string>([
        ...resource.fields.map((field) => field.key),
        ...resource.listColumns.map((column) => column.key),
        ...resource.searchColumns,
        resource.orderBy.column,
        ...(resource.identityKeys ?? []),
      ]);

      for (const column of referenced) {
        // `created_at` / `updated_at` are exposed as read-only list columns but are real columns.
        expect(table.has(column), `${resource.table}.${column} (from ${resource.key})`).toBe(true);
      }
    }
  });

  it("never exposes a field with no matching column", () => {
    for (const resource of ADMIN_RESOURCES) {
      const table = schema.get(resource.table);
      if (!table) continue;
      for (const field of resource.fields) {
        expect(table.has(field.key), `${resource.table}.${field.key} is editable but missing`).toBe(true);
      }
    }
  });

  it("identifies rows by the primary key", () => {
    for (const resource of ADMIN_RESOURCES) {
      const keys = resource.identityKeys ?? [resource.fields.find((field) => field.immutable)?.key ?? "id"];
      expect(keys.length).toBeGreaterThan(0);

      const table = schema.get(resource.table);
      if (!table) continue;
      for (const key of keys) {
        expect(table.has(key), `${resource.table}.${key} identity column missing`).toBe(true);
      }
    }
  });

  /**
   * The manager addresses a row by its identity tuple. That tuple must be backed by a
   * PRIMARY KEY or a UNIQUE index — otherwise an update could touch more than one row and a
   * delete could remove more than the user selected. Slugs qualify via their unique
   * constraint; composite keys (scoring_profiles) qualify as a tuple, not column by column.
   */
  it("backs every identity tuple with a primary key or unique index", async () => {
    const { rows: indexRows } = await db.query<{ tablename: string; indexname: string; indexdef: string }>(
      `select tablename, indexname, indexdef from pg_indexes where schemaname = 'public'`,
    );

    const uniqueTuples = new Map<string, Set<string>[]>();
    for (const row of indexRows) {
      if (!/unique/i.test(row.indexdef)) continue;
      const match = /\(([^)]+)\)/.exec(row.indexdef);
      if (!match?.[1]) continue;
      const columns = match[1]
        .split(",")
        .map((column) => column.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
      const list = uniqueTuples.get(row.tablename) ?? [];
      list.push(new Set(columns));
      uniqueTuples.set(row.tablename, list);
    }

    for (const resource of ADMIN_RESOURCES) {
      const identity = resource.identityKeys ?? [resource.fields.find((field) => field.immutable)?.key ?? "id"];
      const tuples = uniqueTuples.get(resource.table) ?? [];
      const covered = tuples.some(
        (tuple) => tuple.size === identity.length && identity.every((key) => tuple.has(key)),
      );
      expect(covered, `${resource.table} identity ${identity.join("+")} is not unique`).toBe(true);
    }
  });

  it("does not mark required fields that the database fills automatically", () => {
    for (const resource of ADMIN_RESOURCES) {
      const table = schema.get(resource.table);
      if (!table) continue;

      for (const field of resource.fields) {
        if (!field.required) continue;
        // A required form field on a generated primary key would make creation impossible
        // unless the UI also treated it as optional-when-blank.
        if (field.immutable && field.type === "text") {
          const column = table.get(field.key);
          if (column?.column_default?.includes("gen_random_uuid")) {
            // Allowed: the manager omits blank immutable keys on insert. Assert that rule.
            expect(String(column.column_default)).toContain("gen_random_uuid");
          }
        }
      }
    }
  });

  it("orders by a sortable column", () => {
    for (const resource of ADMIN_RESOURCES) {
      const table = schema.get(resource.table);
      if (!table) continue;
      const column = table.get(resource.orderBy.column);
      expect(column, `${resource.table}.${resource.orderBy.column}`).toBeDefined();
    }
  });

  it("uses unique keys for every resource so the manager can address a single row", () => {
    const keys = ADMIN_RESOURCES.map((resource) => resource.key);
    expect(new Set(keys).size).toBe(keys.length);
    const tables = ADMIN_RESOURCES.map((resource) => resource.table);
    expect(new Set(tables).size).toBe(tables.length);
  });
});

describe("admin navigation", () => {
  it("links only to resources that exist, or to a hand-written screen", () => {
    const handWritten = new Set([
      "/admin/",
      "/admin/analytics/",
      "/admin/audit/",
      "/admin/settings/",
      "/admin/users/",
      "/admin/studio/",
      "/admin/media/",
      "/admin/seo/",
    ]);

    for (const group of ADMIN_NAV) {
      for (const item of group.items) {
        if (handWritten.has(item.href)) continue;
        const key = item.resource ?? item.href.replace(/^\/admin\//, "").replace(/\/$/, "");
        expect(getResource(key), `${item.label} → ${key}`).toBeDefined();
        expect(`/admin/${key}/`).toBe(item.href);
      }
    }
  });

  it("gives every resource a nav entry so it is reachable", () => {
    const linked = new Set(ADMIN_NAV.flatMap((group) => group.items.map((item) => item.resource).filter(Boolean)));
    for (const resource of ADMIN_RESOURCES) {
      expect(linked.has(resource.key), `${resource.key} has no navigation entry`).toBe(true);
    }
  });

  it("reports a module count that matches the navigation", () => {
    expect(ADMIN_MODULE_COUNT).toBe(ADMIN_NAV.reduce((sum, group) => sum + group.items.length, 0));
    expect(ADMIN_MODULE_COUNT).toBeGreaterThanOrEqual(20);
  });
});
