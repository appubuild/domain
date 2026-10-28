-- 0010_content_scheduling.sql
--
-- Scheduled publishing, made real — for posts and for pages.
--
-- `posts` has carried a `scheduled` status and a `scheduled_for` timestamp since 0004, but
-- nothing ever acted on them: a row set to `scheduled` stayed scheduled forever, and the public
-- read policy (`status = 'published' and published_at <= now()`) never saw it. Pages had no
-- scheduling column at all, and their read policy ignored dates entirely, so a page stamped
-- with a future date was live immediately. A stored date with no promoter is indistinguishable
-- from an unimplemented button, so this migration adds the promoter and closes the page gap.
--
-- Why pg_cron rather than a Vercel cron or a scheduled Edge Function:
--
--   * the site is a static export — there is no server in this project that could run a timer;
--   * the transition is a database fact, so it belongs next to the data, where it also applies
--     to rows written by SQL or the REST API rather than only to rows written by the admin UI;
--   * pg_cron runs inside Postgres, so there is no secret to store and no endpoint to expose.
--
-- The promoter only ever moves `scheduled` -> `published`, and it pins `published_at` to the
-- scheduled instant (not to "when the job happened to run"), so an article's byline date is the
-- one the author chose even if the job fires a minute late.
--
-- Everything here is written to be safe on a database without pg_cron (the offline PGlite test
-- harness, for instance): the tables, constraint and functions are plain SQL and always applied,
-- while the extension and the schedule are installed only when the extension is available.

-- 1. Pages gain the same scheduling column posts already had -------------------------------

alter table public.pages add column if not exists scheduled_for timestamptz;

-- The original status check predates scheduling and would reject 'scheduled' outright.
alter table public.pages drop constraint if exists pages_status_check;
alter table public.pages
  add constraint pages_status_check
  check (status in ('draft', 'scheduled', 'published', 'archived'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'pages_scheduled_requires_date'
       and conrelid = 'public.pages'::regclass
  ) then
    alter table public.pages
      add constraint pages_scheduled_requires_date
      check (status <> 'scheduled' or scheduled_for is not null);
  end if;
end;
$$;

-- 2. Public reads respect the date on pages, exactly as they already did on posts ----------

drop policy if exists pages_public_read on public.pages;
create policy pages_public_read on public.pages
  for select using (
    (status = 'published' and coalesce(published_at, created_at) <= now())
    or public.is_admin()
  );

-- 3. The promoter ---------------------------------------------------------------------------

create or replace function public.promote_scheduled_content()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  published_posts integer := 0;
  published_pages integer := 0;
begin
  update public.posts
     set status = 'published',
         published_at = coalesce(scheduled_for, now()),
         scheduled_for = null,
         updated_at = now()
   where status = 'scheduled'
     and scheduled_for is not null
     and scheduled_for <= now();
  get diagnostics published_posts = row_count;

  update public.pages
     set status = 'published',
         published_at = coalesce(scheduled_for, now()),
         scheduled_for = null,
         updated_at = now()
   where status = 'scheduled'
     and scheduled_for is not null
     and scheduled_for <= now();
  get diagnostics published_pages = row_count;

  return published_posts + published_pages;
end;
$$;

comment on function public.promote_scheduled_content() is
  'Publishes posts and pages whose scheduled_for has passed. Runs every minute from pg_cron (job content_promote_scheduled). Returns the number of rows published.';

-- Earlier revisions of this migration installed a posts-only promoter; keep upgrades clean.
drop function if exists public.promote_scheduled_posts();

-- Only the scheduler needs to call this; it is a security-definer write. Revoking keeps anon
-- and authenticated from flipping content live through PostgREST.
revoke all on function public.promote_scheduled_content() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.promote_scheduled_content() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.promote_scheduled_content() from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.promote_scheduled_content() to service_role';
  end if;
end;
$$;

-- 4. Extension and schedule -----------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is unavailable on this server; scheduled content will not promote automatically.';
    return;
  end if;

  execute 'create extension if not exists pg_cron with schema extensions';

  -- Idempotent: replace the schedule instead of stacking duplicates on re-run.
  if exists (select 1 from cron.job where jobname = 'content_promote_scheduled') then
    perform cron.unschedule('content_promote_scheduled');
  end if;

  perform cron.schedule(
    'content_promote_scheduled',
    '* * * * *',
    $job$select public.promote_scheduled_content();$job$
  );
end;
$$;
