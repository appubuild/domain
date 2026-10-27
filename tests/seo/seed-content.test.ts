/**
 * The shipped seed content must survive its own SEO rules.
 *
 * This is a regression guard with teeth: the seed in `supabase/seed/seed.sql` is what a new
 * installation starts with, so if someone adds a page without a description or a redirect
 * that points at a deleted slug, the product launches with that defect baked in.
 *
 * Errors fail the build. Warnings and notices are printed — they are legitimate editorial
 * choices in seed copy and should be visible, not fatal.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { runDiagnostics, type RedirectRecord, type SeoRecord } from "@/lib/seo/diagnostics";
import { FOOTER_NAV, PRIMARY_NAV } from "@/lib/config/site";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const SEED_FILE = path.join(process.cwd(), "supabase", "seed", "seed.sql");

let db: PGlite;
let report: ReturnType<typeof runDiagnostics>;

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

  // `pages` has no cover image columns — only posts do. Selecting one here would be a
  // Postgres error, which is exactly what the admin registry test guards against elsewhere.
  const pages = await db.query<SeoRecord>(`
    select id, slug, title, body, excerpt, seo_title, meta_description, canonical_url,
           noindex, og_image_url, published_at, status, updated_at
    from public.pages
  `);
  const posts = await db.query<SeoRecord>(`
    select id, slug, title, body, excerpt, seo_title, meta_description, canonical_url,
           noindex, cover_image_url, cover_image_alt, published_at, status, updated_at
    from public.posts
  `);
  const redirects = await db.query<RedirectRecord>(`
    select id, source_path, target_path, status_code, enabled from public.redirects
  `);
  const industries = await db.query<{ slug: string }>(`select slug from public.industries`);
  const nav = await db.query<{ href: string }>(`select href from public.nav_items where enabled = true`);

  // Same merge the admin screen performs: what the header/footer actually render, plus the
  // rows in `nav_items`.
  const navPaths = [
    ...PRIMARY_NAV.map((item) => item.href),
    ...FOOTER_NAV.flatMap((column) => column.items.map((item) => item.href)),
    ...nav.rows.map((row) => row.href),
  ].filter((href) => href.startsWith("/"));

  report = runDiagnostics({
    pages: pages.rows,
    posts: posts.rows,
    redirects: redirects.rows,
    industries: industries.rows,
    navPaths,
  });
});

afterAll(async () => {
  await db?.close();
});

describe("seed content", () => {
  it("loads enough content for the diagnostics to be meaningful", () => {
    expect(report.summary.scanned.pages).toBeGreaterThan(0);
    expect(report.summary.indexable).toBeGreaterThan(0);
    // The seed ships no blog posts on purpose (an empty blog is an honest empty state, not
    // filler copy), so this cannot assert posts > 0.
  });

  it("contains no errors", () => {
    const errors = report.findings.filter((finding) => finding.severity === "error");
    const detail = errors.map((finding) => `${finding.code} ${finding.path}: ${finding.message}`).join("\n  ");
    expect(errors, `seed content has ${errors.length} SEO error(s):\n  ${detail}`).toHaveLength(0);
  });

  it("prints its warnings and notices rather than hiding them", () => {
    const rest = report.findings.filter((finding) => finding.severity !== "error");
    if (rest.length > 0) {
      // Surfaced in the vitest output so an editor sees editorial debt in the seed.
      console.info(
        `[seo] seed content: ${report.summary.warnings} warning(s), ${report.summary.notices} notice(s)\n` +
          rest
            .map((finding) => `  ${finding.severity} ${finding.code} ${finding.path ?? ""} — ${finding.message}`)
            .join("\n"),
      );
    }
    expect(report.summary.total).toBe(report.findings.length);
  });
});
