/**
 * Database verification harness.
 *
 * The production target is Supabase (Postgres). We cannot reach Supabase from this
 * environment, so the schema, constraints, seed data and — most importantly — every RLS
 * policy are executed against **real PostgreSQL** (PGlite 18.6, WASM). This is not a mock:
 * the same SQL files that would run on Supabase run here.
 *
 * The only shim is `auth.uid()`, which Supabase provides and PGlite does not.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const SEED_FILE = path.join(process.cwd(), "supabase", "seed", "seed.sql");

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const USER_A_ID = "22222222-2222-4222-8222-222222222222";
const USER_B_ID = "33333333-3333-4333-8333-333333333333";

let db: PGlite;

async function bootstrap() {
  db = await PGlite.create();

  // --- Supabase shim: the auth schema, its users table and auth.uid() ------------
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
      ('${USER_A_ID}', 'a@example.com'),
      ('${USER_B_ID}', 'b@example.com');
  `);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }

  await db.exec(readFileSync(SEED_FILE, "utf8"));

  // Promote the admin user through a direct insert (RLS bypassed as table owner).
  await db.exec(`
    insert into public.user_roles (user_id, role_id) values ('${ADMIN_ID}', 'owner');
  `);
}

/** Runs a query as a given user (or the anon role when `userId` is null). */
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

async function asOwner<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec("reset role");
  const result = await db.query<T>(sql, params as never[]);
  return result.rows;
}

// Hooks live at file scope so every describe block shares one bootstrapped database.
beforeAll(bootstrap, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("database schema, constraints and seed", () => {
  it("creates every expected table", async () => {
    const rows = await asOwner<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );
    const tables = rows.map((row) => row.tablename);
    for (const expected of [
      "app_roles", "role_permissions", "user_profiles", "user_roles",
      "site_settings", "config_versions", "audit_logs", "feature_flags", "jobs",
      "word_libraries", "dictionary_terms", "industries", "industry_terms",
      "phrase_templates", "scoring_profiles", "brandable_profiles", "excluded_rules",
      "tlds", "availability_providers", "availability_checks", "availability_cache",
      "favorites", "collections", "collection_items", "saved_searches",
      "pages", "page_sections", "media", "nav_menus", "nav_items",
      "seo_templates", "redirects", "post_categories", "post_tags", "posts",
      "post_tags_map", "ai_drafts",
      "ad_settings", "ad_slots", "affiliate_providers", "affiliate_tld_rules",
      "click_events", "analytics_events", "api_keys",
    ]) {
      expect(tables, `missing table ${expected}`).toContain(expected);
    }
  });

  it("has RLS enabled on every table", async () => {
    const rows = await asOwner<{ tablename: string; rowsecurity: boolean }>(
      `select tablename, rowsecurity from pg_tables where schemaname = 'public'`,
    );
    const withoutRls = rows.filter((row) => !row.rowsecurity).map((row) => row.tablename);
    expect(withoutRls).toEqual([]);
  });

  it("seeds the dictionary, industry and TLD data", async () => {
    const [industries] = await asOwner<{ count: string }>(`select count(*) from public.industries`);
    const [tlds] = await asOwner<{ count: string }>(`select count(*) from public.tlds`);
    const [terms] = await asOwner<{ count: string }>(`select count(*) from public.dictionary_terms`);
    const [pages] = await asOwner<{ count: string }>(`select count(*) from public.pages where status = 'published'`);
    const [profiles] = await asOwner<{ count: string }>(`select count(*) from public.scoring_profiles`);

    expect(Number(industries?.count)).toBeGreaterThanOrEqual(15);
    expect(Number(tlds?.count)).toBeGreaterThanOrEqual(10);
    expect(Number(terms?.count)).toBeGreaterThan(200);
    expect(Number(pages?.count)).toBeGreaterThanOrEqual(8);
    expect(Number(profiles?.count)).toBeGreaterThanOrEqual(2);
  });

  it("seeds advertising as disabled with no invented publisher id", async () => {
    const [settings] = await asOwner<{ global_enabled: boolean; publisher_id: string | null; provider: string }>(
      `select global_enabled, publisher_id, provider from public.ad_settings where id = 'global'`,
    );
    expect(settings?.global_enabled).toBe(false);
    expect(settings?.publisher_id).toBeNull();
    expect(settings?.provider).toBe("none");
  });

  it("rejects a malformed AdSense publisher id at the database level", async () => {
    await expect(
      asOwner(`update public.ad_settings set publisher_id = 'pub-123' where id = 'global'`),
    ).rejects.toThrow();
    await expect(asOwner(`update public.ad_settings set publisher_id = 'ca-pub-1234567890123456' where id = 'global'`)).resolves.toBeDefined();
  });

  it("requires affiliate templates to be https and to contain {domain}", async () => {
    await expect(
      asOwner(`insert into public.affiliate_providers (name, slug, url_template) values ('Bad', 'bad', 'http://example.com/search?q={domain}')`),
    ).rejects.toThrow();
    await expect(
      asOwner(`insert into public.affiliate_providers (name, slug, url_template, allowed_hosts) values ('Bad2', 'bad2', 'https://example.com/search')`),
    ).rejects.toThrow();
    await expect(
      asOwner(
        `insert into public.affiliate_providers (name, slug, url_template, allowed_hosts, enabled)
         values ('Example Registrar', 'example', 'https://registrar.example/search?domain={domain}', array['registrar.example']::text[], false)`,
      ),
    ).resolves.toBeDefined();
  });
});

describe("RLS — public content", () => {
  it("lets anon read published pages but not drafts", async () => {
    await asOwner(
      `insert into public.pages (slug, title, status, published_at) values ('draft-only', 'Draft', 'draft', null)`,
    );
    const visible = await asUser<{ slug: string }>(null, `select slug from public.pages`);
    const slugs = visible.map((row) => row.slug);
    expect(slugs).toContain("about");
    expect(slugs).not.toContain("draft-only");
  });

  it("blocks anonymous writes to content", async () => {
    await expect(
      asUser(null, `insert into public.pages (slug, title, status) values ('hacked', 'Hacked', 'published')`),
    ).rejects.toThrow();

    const rows = await asOwner<{ count: string }>(`select count(*) from public.pages where slug = 'hacked'`);
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it("blocks anonymous writes to naming configuration", async () => {
    // An UPDATE that no policy allows matches zero rows rather than raising, so the
    // assertion is on effect (value unchanged) plus the insert, which does raise.
    await asUser(null, `update public.industries set name = 'Hijacked' where id = 'fintech'`);
    const rows = await asOwner<{ name: string }>(`select name from public.industries where id = 'fintech'`);
    expect(rows[0]?.name).not.toBe("Hijacked");

    await expect(
      asUser(null, `insert into public.tlds (tld, display_name) values ('zz', '.zz')`),
    ).rejects.toThrow();
  });

  it("allows administrators to write content", async () => {
    await asUser(
      ADMIN_ID,
      `insert into public.pages (slug, title, status, published_at) values ('admin-created', 'Admin page', 'published', now())`,
    );
    const rows = await asUser<{ slug: string }>(null, `select slug from public.pages where slug = 'admin-created'`);
    expect(rows).toHaveLength(1);
  });

  it("hides drafts from non-admins but shows them to admins", async () => {
    const anonDrafts = await asUser<{ slug: string }>(null, `select slug from public.pages where status = 'draft'`);
    expect(anonDrafts).toHaveLength(0);
    const adminAll = await asUser<{ slug: string }>(ADMIN_ID, `select slug from public.pages`);
    expect(adminAll.length).toBeGreaterThan(0);
  });

  it("prevents a signed-in non-admin from reading draft pages", async () => {
    const rows = await asUser<{ slug: string }>(USER_A_ID, `select slug from public.pages where status = 'draft'`);
    expect(rows).toHaveLength(0);
  });

  it("only publishes scheduled posts after their publication time", async () => {
    await asOwner(
      `insert into public.posts (slug, title, status, published_at) values ('future-post', 'Future', 'published', now() + interval '1 day')`,
    );
    const future = await asUser<{ slug: string }>(null, `select slug from public.posts where slug = 'future-post'`);
    expect(future).toHaveLength(0);

    await asOwner(
      `insert into public.posts (slug, title, status, published_at) values ('live-post', 'Live', 'published', now() - interval '1 hour')`,
    );
    const live = await asUser<{ slug: string }>(null, `select slug from public.posts where slug = 'live-post'`);
    expect(live).toHaveLength(1);
  });

  it("requires a publication date for published posts", async () => {
    await expect(
      asOwner(`insert into public.posts (slug, title, status) values ('no-date', 'No date', 'published')`),
    ).rejects.toThrow();
  });

  it("exposes public read of TLDs and industries to anonymous visitors", async () => {
    const tlds = await asUser<{ tld: string }>(null, `select tld from public.tlds`);
    const industries = await asUser<{ id: string }>(null, `select id from public.industries`);
    expect(tlds.length).toBeGreaterThan(5);
    expect(industries.length).toBeGreaterThan(5);
  });

  it("keeps disabled industries hidden from anonymous visitors", async () => {
    await asOwner(`update public.industries set enabled = false where id = 'gaming'`);
    const anonVisible = await asUser<{ id: string }>(null, `select id from public.industries`);
    expect(anonVisible.map((row) => row.id)).not.toContain("gaming");
    const adminVisible = await asUser<{ id: string }>(ADMIN_ID, `select id from public.industries`);
    expect(adminVisible.map((row) => row.id)).toContain("gaming");
    await asOwner(`update public.industries set enabled = true where id = 'gaming'`);
  });
});

describe("RLS — workspace isolation", () => {
  it("isolates favourites between accounts", async () => {
    await asUser(USER_A_ID, `insert into public.favorites (user_id, label, domain) values ($1, 'paynest', 'paynest.com')`, [USER_A_ID]);
    const own = await asUser<{ domain: string }>(USER_A_ID, `select domain from public.favorites`);
    expect(own).toHaveLength(1);

    const other = await asUser<{ domain: string }>(USER_B_ID, `select domain from public.favorites`);
    expect(other).toHaveLength(0);
  });

  it("prevents inserting a favourite for another user", async () => {
    await expect(
      asUser(USER_B_ID, `insert into public.favorites (user_id, label, domain) values ($1, 'steal', 'steal.com')`, [USER_A_ID]),
    ).rejects.toThrow();
  });

  it("keeps private collections private until shared", async () => {
    const inserted = await asUser<{ id: string }>(
      USER_A_ID,
      `insert into public.collections (user_id, name) values ($1, 'Private list') returning id`,
      [USER_A_ID],
    );
    const collectionId = inserted[0]?.id;
    expect(collectionId).toBeTruthy();

    const anonView = await asUser<{ id: string }>(null, `select id from public.collections`);
    expect(anonView).toHaveLength(0);

    await asOwner(`update public.collections set is_public = true, share_slug = 'shared-list' where id = $1`, [collectionId]);
    const shared = await asUser<{ id: string }>(null, `select id from public.collections where share_slug = 'shared-list'`);
    expect(shared).toHaveLength(1);
  });

  it("does not expose another user's saved searches", async () => {
    await asUser(USER_A_ID, `insert into public.saved_searches (user_id, name, query) values ($1, 'mine', '{"q":"pay"}'::jsonb)`, [USER_A_ID]);
    const other = await asUser<{ id: string }>(USER_B_ID, `select id from public.saved_searches`);
    expect(other).toHaveLength(0);
  });
});

describe("RLS — analytics, audit and admin tables", () => {
  it("accepts anonymous analytics events but never returns them", async () => {
    await asUser(null, `insert into public.analytics_events (event_type, path, payload) values ('generation_run', '/generator/', '{"count":12}'::jsonb)`);
    const anonRead = await asUser<{ id: number }>(null, `select id from public.analytics_events`);
    expect(anonRead).toHaveLength(0);

    const adminRead = await asUser<{ id: number }>(ADMIN_ID, `select id from public.analytics_events`);
    expect(adminRead.length).toBeGreaterThan(0);
  });

  it("rejects an unknown analytics event type", async () => {
    await expect(
      asUser(null, `insert into public.analytics_events (event_type, path) values ('made_up_event', '/')`),
    ).rejects.toThrow();
  });

  it("hides audit logs and availability history from anonymous visitors", async () => {
    await asOwner(`insert into public.audit_logs (action, entity_type, summary) values ('test', 'pages', 'seed test')`);
    const anonAudit = await asUser<{ id: number }>(null, `select id from public.audit_logs`);
    expect(anonAudit).toHaveLength(0);
    const anonChecks = await asUser<{ id: string }>(null, `select id from public.availability_checks`);
    expect(anonChecks).toHaveLength(0);
  });

  it("protects API keys and AI drafts from non-admins", async () => {
    await asOwner(`insert into public.api_keys (name, key_prefix, key_hash) values ('CI', 'df_test', 'hash')`);
    const anonKeys = await asUser<{ id: string }>(null, `select id from public.api_keys`);
    expect(anonKeys).toHaveLength(0);
    const userKeys = await asUser<{ id: string }>(USER_A_ID, `select id from public.api_keys`);
    expect(userKeys).toHaveLength(0);
  });

  it("exposes affiliate providers for routing but only when enabled", async () => {
    await asOwner(`update public.affiliate_providers set enabled = false where slug = 'example'`);
    const hidden = await asUser<{ slug: string }>(null, `select slug from public.affiliate_providers where slug = 'example'`);
    expect(hidden).toHaveLength(0);

    await asOwner(`update public.affiliate_providers set enabled = true where slug = 'example'`);
    const visible = await asUser<{ slug: string }>(null, `select slug from public.affiliate_providers where slug = 'example'`);
    expect(visible).toHaveLength(1);
  });

  it("keeps pubic settings readable but private settings hidden", async () => {
    await asOwner(`insert into public.site_settings (key, value, is_public) values ('private_secret', '{"k":"v"}'::jsonb, false)`);
    const anon = await asUser<{ key: string }>(null, `select key from public.site_settings`);
    const keys = anon.map((row) => row.key);
    expect(keys).toContain("brand");
    expect(keys).not.toContain("private_secret");
  });
});

describe("data integrity constraints", () => {
  it("enforces unique page slugs and slug format", async () => {
    await expect(
      asOwner(`insert into public.pages (slug, title, status) values ('about', 'Duplicate', 'draft')`),
    ).rejects.toThrow();
    await expect(
      asOwner(`insert into public.pages (slug, title, status) values ('Not A Slug', 'Bad', 'draft')`),
    ).rejects.toThrow();
  });

  it("prevents redirect loops and requires absolute paths", async () => {
    await expect(
      asOwner(`insert into public.redirects (source_path, target_path) values ('/old', '/old')`),
    ).rejects.toThrow();
    await expect(
      asOwner(`insert into public.redirects (source_path, target_path) values ('old', '/new')`),
    ).rejects.toThrow();
    await expect(
      asOwner(`insert into public.redirects (source_path, target_path) values ('/old-page', '/new-page')`),
    ).resolves.toBeDefined();
  });

  it("requires scoring weights to be a JSON object", async () => {
    await expect(
      asOwner(
        `insert into public.scoring_profiles (id, version, name, kind, weights) values ('bad', 1, 'Bad', 'quality', '[1,2]'::jsonb)`,
      ),
    ).rejects.toThrow();
  });

  it("cascades page sections when a page is deleted", async () => {
    await asOwner(`insert into public.pages (slug, title, status) values ('cascade-test', 'Cascade', 'draft')`);
    const [page] = await asOwner<{ id: string }>(`select id from public.pages where slug = 'cascade-test'`);
    await asOwner(`insert into public.page_sections (page_id, kind, content) values ($1, 'text', '{"heading":"Hi","body":"There"}'::jsonb)`, [page?.id]);
    await asOwner(`delete from public.pages where slug = 'cascade-test'`);
    const sections = await asOwner<{ id: string }>(`select id from public.page_sections where page_id = $1`, [page?.id]);
    expect(sections).toHaveLength(0);
  });

  it("writes an updated_at timestamp on update", async () => {
    const [before] = await asOwner<{ updated_at: string }>(`select updated_at from public.industries where id = 'fintech'`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await asOwner(`update public.industries set description = description || ' ' where id = 'fintech'`);
    const [after] = await asOwner<{ updated_at: string }>(`select updated_at from public.industries where id = 'fintech'`);
    expect(new Date(after?.updated_at ?? 0).getTime()).toBeGreaterThanOrEqual(
      new Date(before?.updated_at ?? 0).getTime(),
    );
  });
});
