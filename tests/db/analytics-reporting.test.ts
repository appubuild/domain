/**
 * Analytics reporting functions, replayed against real Postgres (PGlite).
 *
 * The dashboard now trusts these functions with its headline numbers, so three properties are
 * checked here rather than assumed:
 *
 *   1. they exist and are `security invoker` (the caller's RLS applies inside);
 *   2. `anon` may not execute them — and neither does `PUBLIC` hold the privilege by default;
 *   3. as an administrator they return the counts the UI shows, including the keyword
 *      unnesting, which is the easiest of them to get subtly wrong.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

let db: PGlite;

beforeAll(async () => {
  db = await PGlite.create();

  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (
      id uuid primary key,
      email text unique,
      created_at timestamptz not null default now()
    );
    create or replace function auth.uid() returns uuid
    language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin;
    create role authenticated nologin;
    grant usage on schema auth to anon, authenticated;
  `);

  await db.exec(`
    insert into auth.users (id, email) values
      ('${ADMIN_ID}', 'admin@example.com'),
      ('${USER_ID}', 'user@example.com');
  `);

  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort()) {
    try {
      await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }

  // Only the role row is needed here; the full seed brings content this test does not use.
  await db.exec(`
    insert into public.app_roles (id, name, description, rank)
    values ('owner', 'Owner', 'Full control including role management.', 100)
    on conflict (id) do nothing;
    insert into public.user_roles (user_id, role_id) values ('${ADMIN_ID}', 'owner');
  `);

  // Two real events, one with a keyword array and one without.
  await db.exec(`
    insert into public.analytics_events (event_type, path, payload, session_hash, created_at) values
      ('generation_run', '/generator/', '{"roots":["pay","home"]}'::jsonb, 'session-a', '2026-10-26T09:00:00Z'),
      ('generation_run', '/generator/', '{"roots":["pay"],"tlds":["com"]}'::jsonb, 'session-b', '2026-10-26T10:00:00Z'),
      ('page_view', '/', '{}'::jsonb, 'session-a', '2026-10-27T08:00:00Z'),
      ('availability_check', '/generator/', '{}'::jsonb, null, '2026-10-27T09:00:00Z');
  `);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

async function asUser<T>(userId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(`set role ${userId ? "authenticated" : "anon"}`);
  try {
    const result = await db.query<T>(sql, params as never[]);
    return result.rows;
  } finally {
    await db.exec("reset role");
  }
}

const SIGNATURES = [
  "analytics_event_totals(timestamp with time zone)",
  "analytics_daily_totals(date)",
  "analytics_path_totals(timestamp with time zone, integer)",
  "analytics_root_totals(timestamp with time zone, integer)",
  "analytics_activity(timestamp with time zone)",
];

describe("analytics reporting functions", () => {
  it("exists for every metric the dashboard reads", async () => {
    const { rows } = await db.query<{ name: string; security: string }>(`
      select p.proname as name, p.prosecdef::text as security
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'analytics\\_%'
      order by p.proname
    `);
    const names = rows.map((row) => row.name);
    for (const signature of SIGNATURES) {
      expect(names, `missing ${signature}`).toContain(signature.split("(")[0]);
    }
    // prosecdef = false everywhere: none of these may run with elevated rights.
    expect(rows.filter((row) => row.name !== "analytics_daily")).toHaveLength(SIGNATURES.length);
    expect(rows.every((row) => row.security === "false")).toBe(true);
  });

  it("refuses EXECUTE to anon, including through PUBLIC", async () => {
    const { rows: privileges } = await db.query<{ anon: boolean; authenticated: boolean; pub: boolean }>(`
      select
        has_function_privilege('anon', 'public.analytics_event_totals(timestamptz)', 'EXECUTE') as anon,
        has_function_privilege('authenticated', 'public.analytics_event_totals(timestamptz)', 'EXECUTE') as authenticated,
        coalesce((select bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'analytics\\_%'), false) as pub
    `);
    expect(privileges[0]?.anon).toBe(false);
    expect(privileges[0]?.authenticated).toBe(true);
    expect(privileges[0]?.pub).toBe(false);
  });

  it("rejects an anon call with a permission error rather than empty data", async () => {
    await expect(
      asUser(null, "select * from public.analytics_event_totals('2026-01-01T00:00:00Z')"),
    ).rejects.toThrow(/permission denied/i);
  });

  it("the daily view runs as its caller", async () => {
    const { rows } = await db.query<{ options: string | null }>(`
      select array_to_string(c.reloptions, ',') as options
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'analytics_daily'
    `);
    expect(rows[0]?.options ?? "").toContain("security_invoker=true");
  });

  it("returns nothing to a signed-in non-administrator", async () => {
    const rows = await asUser<{ event_type: string; events: number }>(
      USER_ID,
      "select * from public.analytics_event_totals('2026-01-01T00:00:00Z')",
    );
    expect(rows).toEqual([]);
  });

  it("returns real totals to an administrator", async () => {
    const rows = await asUser<{ event_type: string; events: number }>(
      ADMIN_ID,
      "select * from public.analytics_event_totals('2026-01-01T00:00:00Z')",
    );
    expect(rows).toEqual([
      { event_type: "generation_run", events: 2 },
      { event_type: "availability_check", events: 1 },
      { event_type: "page_view", events: 1 },
    ]);
  });

  it("groups the daily series by UTC date", async () => {
    const rows = await asUser<{ day: string | Date; events: number }>(
      ADMIN_ID,
      "select * from public.analytics_daily_totals('2026-10-20')",
    );
    // PGlite hands back a Date for a `date` column; PostgREST would send an ISO string.
    const isoDay = (value: string | Date) =>
      (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
    expect(rows.map((row) => ({ day: isoDay(row.day), events: Number(row.events) }))).toEqual([
      { day: "2026-10-26", events: 2 },
      { day: "2026-10-27", events: 2 },
    ]);
  });

  it("unnests keyword arrays and skips payloads without one", async () => {
    const rows = await asUser<{ root: string; events: number }>(
      ADMIN_ID,
      "select * from public.analytics_root_totals('2026-01-01T00:00:00Z', 10)",
    );
    expect(rows.map((row) => ({ root: row.root, events: Number(row.events) }))).toEqual([
      { root: "pay", events: 2 },
      { root: "home", events: 1 },
    ]);
  });

  it("clamps the row limit instead of trusting the caller", async () => {
    const rows = await asUser<unknown>(
      ADMIN_ID,
      "select * from public.analytics_root_totals('2026-01-01T00:00:00Z', 100000)",
    );
    expect(rows.length).toBeLessThanOrEqual(50);
    const negative = await asUser<unknown>(
      ADMIN_ID,
      "select * from public.analytics_root_totals('2026-01-01T00:00:00Z', -5)",
    );
    expect(negative.length).toBe(1);
  });

  it("counts sessions from the per-tab ids and reports the newest event", async () => {
    const rows = await asUser<{ events: number; sessions: number; newest: string }>(
      ADMIN_ID,
      "select events, sessions, newest from public.analytics_activity('2026-01-01T00:00:00Z')",
    );
    expect(Number(rows[0]?.events)).toBe(4);
    // Two distinct session hashes; the null session is not a session.
    expect(Number(rows[0]?.sessions)).toBe(2);
    expect(new Date(rows[0]?.newest ?? 0).toISOString()).toBe("2026-10-27T09:00:00.000Z");
  });
});
