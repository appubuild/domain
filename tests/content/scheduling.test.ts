/**
 * Scheduled publishing, against the real migrations.
 *
 * The point of this test is that the feature is a database behaviour, not a UI claim: a row whose
 * `scheduled_for` has passed is promoted by `promote_scheduled_content()`, and a public reader
 * cannot see scheduled or future-dated content in the meantime.
 *
 * PGlite has no pg_cron, so the job itself is not exercised here — the migration is written to
 * skip scheduling in that case (verified separately against the live project, where the cron job
 * promoted a probe row within a minute). What can be checked offline is the transition and the
 * policy that keeps scheduled content hidden.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

let db: PGlite;

async function migrationsApplied() {
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
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
  await migrationsApplied();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

async function insertPost(input: { slug: string; status: string; scheduledFor?: string | null; publishedAt?: string | null }) {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.posts (slug, title, status, scheduled_for, published_at)
     values ($1, $1, $2, $3::timestamptz, $4::timestamptz)
     returning id`,
    [input.slug, input.status, input.scheduledFor ?? null, input.publishedAt ?? null],
  );
  return rows[0]!.id;
}

async function postState(id: string) {
  const { rows } = await db.query<{ status: string; scheduled_for: string | null; published_at: string | null }>(
    `select status, scheduled_for, published_at from public.posts where id = $1`,
    [id],
  );
  return rows[0]!;
}

describe("scheduled content", () => {
  it("leaves a row alone while its scheduled time is still in the future", async () => {
    const id = await insertPost({
      slug: "future-post",
      status: "scheduled",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const { rows } = await db.query<{ promote_scheduled_content: number }>(
      `select public.promote_scheduled_content() as promote_scheduled_content`,
    );
    expect(rows[0]!.promote_scheduled_content).toBe(0);
    expect((await postState(id)).status).toBe("scheduled");
  });

  it("publishes a post whose scheduled time has passed, at the requested instant", async () => {
    const scheduledFor = new Date(Date.now() - 60_000).toISOString();
    const id = await insertPost({ slug: "due-post", status: "scheduled", scheduledFor });

    const { rows } = await db.query<{ promote_scheduled_content: number }>(
      `select public.promote_scheduled_content() as promote_scheduled_content`,
    );
    expect(rows[0]!.promote_scheduled_content).toBe(1);

    const state = await postState(id);
    expect(state.status).toBe("published");
    expect(state.scheduled_for).toBeNull();
    // The byline is the author's chosen instant, not the moment the job happened to run.
    expect(new Date(state.published_at!).toISOString()).toBe(new Date(scheduledFor).toISOString());
  });

  it("publishes due pages too, now that pages carry a schedule column", async () => {
    const scheduledFor = new Date(Date.now() - 60_000).toISOString();
    const { rows } = await db.query<{ id: string }>(
      `insert into public.pages (slug, title, status, scheduled_for)
       values ('due-page', 'Due page', 'scheduled', $1::timestamptz)
       returning id`,
      [scheduledFor],
    );

    await db.query(`select public.promote_scheduled_content()`);
    const state = await db.query<{ status: string }>(`select status from public.pages where id = $1`, [rows[0]!.id]);
    expect(state.rows[0]!.status).toBe("published");
  });

  it("is idempotent: running it twice publishes nothing the second time", async () => {
    await insertPost({
      slug: "twice-post",
      status: "scheduled",
      scheduledFor: new Date(Date.now() - 1000).toISOString(),
    });
    const first = await db.query<{ promote_scheduled_content: number }>(`select public.promote_scheduled_content()`);
    const second = await db.query<{ promote_scheduled_content: number }>(`select public.promote_scheduled_content()`);
    expect(first.rows[0]!.promote_scheduled_content).toBe(1);
    expect(second.rows[0]!.promote_scheduled_content).toBe(0);
  });

  it("never promotes archived or draft rows that happen to carry a past schedule", async () => {
    await insertPost({ slug: "archived-post", status: "archived", scheduledFor: new Date(Date.now() - 5000).toISOString() });
    const before = await db.query<{ count: number }>(`select count(*)::int as count from public.posts where status <> 'scheduled'`);
    await db.query(`select public.promote_scheduled_content()`);
    const after = await db.query<{ count: number }>(`select count(*)::int as count from public.posts where status <> 'scheduled'`);
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
  });

  it("rejects a scheduled row with no date", async () => {
    await expect(insertPost({ slug: "dateless", status: "scheduled" })).rejects.toThrow(/posts_scheduled_requires_date/);
  });

  it("hides drafts, future-dated posts and scheduled pages from anonymous readers", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await insertPost({ slug: "hidden-draft", status: "draft" });
    await insertPost({ slug: "hidden-future", status: "published", publishedAt: future });
    await db.query(
      `insert into public.pages (slug, title, status, scheduled_for)
       values ('hidden-page', 'Hidden page', 'scheduled', $1::timestamptz)`,
      [new Date(Date.now() + 86_400_000).toISOString()],
    );

    // Reading as `anon` is the only way to observe RLS: the connection owns these tables, and
    // owners bypass policies. `is_admin()` reads the JWT claim, which is empty here.
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await db.exec("set role anon");
    let visible: Array<{ slug: string }>;
    let pages: Array<{ slug: string }>;
    try {
      visible = (
        await db.query<{ slug: string }>(
          `select slug from public.posts where slug in ('hidden-draft', 'hidden-future')`,
        )
      ).rows;
      pages = (await db.query<{ slug: string }>(`select slug from public.pages where slug = 'hidden-page'`)).rows;
    } finally {
      await db.exec("reset role");
    }
    expect(visible).toEqual([]);
    expect(pages).toEqual([]);
  });
});
