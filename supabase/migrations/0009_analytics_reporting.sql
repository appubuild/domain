-- 0009_analytics_reporting.sql — aggregation that happens in Postgres, not in the browser.
--
-- Two problems this fixes.
--
-- 1. **The dashboard could not be exact.** It fetched up to 5,000 raw rows and aggregated
--    them in JavaScript, so a busy window silently became a *sample* and the page had to
--    print a truncation warning. Grouping belongs in the database: the admin now asks for
--    at most a few dozen rows and gets true totals.
--
-- 2. **The `analytics_daily` view was readable with the anon key.** A view owned by
--    `postgres` runs with the owner's rights unless told otherwise, so the aggregate query
--    inside it was not subject to the admin-only RLS policy on `analytics_events`. The
--    contents are only counts per day and event type — no paths, no payloads, no session
--    hashes — but it was still a read the policies were meant to refuse. The view is now
--    `security_invoker`, and `anon` loses its grant outright.
--
-- Everything here is `security invoker`: the caller's own RLS applies inside the function,
-- so a signed-in administrator gets their totals and anybody else gets zero rows.

-- ---------------------------------------------------------------------------
-- 1. The view reads as the caller, not as its owner.
-- ---------------------------------------------------------------------------
alter view public.analytics_daily set (security_invoker = true);

revoke all on public.analytics_daily from anon;
grant select on public.analytics_daily to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Grouped totals. All of these are stable, read-only and bounded.
-- ---------------------------------------------------------------------------

-- Totals per event type. Returns nothing at all for a caller who may not read events.
create or replace function public.analytics_event_totals(p_since timestamptz)
returns table (event_type text, events bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select e.event_type, count(*)::bigint as events
  from public.analytics_events e
  where e.created_at >= p_since
  group by e.event_type
  order by events desc, e.event_type asc;
$$;

-- One row per day, zero-days omitted (the client fills gaps so a hole is a visible zero).
create or replace function public.analytics_daily_totals(p_since date)
returns table (day date, events bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select (e.created_at at time zone 'UTC')::date as day, count(*)::bigint as events
  from public.analytics_events e
  where e.created_at >= p_since::timestamptz
  group by 1
  order by 1 asc;
$$;

-- Top paths, capped. `p_limit` is clamped rather than trusted.
create or replace function public.analytics_path_totals(p_since timestamptz, p_limit integer default 10)
returns table (path text, events bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(nullif(e.path, ''), '(none)') as path, count(*)::bigint as events
  from public.analytics_events e
  where e.created_at >= p_since
  group by 1
  order by events desc, path asc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

-- Which root keywords people actually generate from: the `roots` array inside the
-- `generation_run` payload, unnested. Rows without an array payload are skipped, not guessed.
create or replace function public.analytics_root_totals(p_since timestamptz, p_limit integer default 10)
returns table (root text, events bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select lower(root) as root, count(*)::bigint as events
  from public.analytics_events e
  cross join lateral jsonb_array_elements_text(
    case
      when jsonb_typeof(e.payload -> 'roots') = 'array' then e.payload -> 'roots'
      else '[]'::jsonb
    end
  ) as root
  where e.event_type = 'generation_run'
    and e.created_at >= p_since
  group by 1
  order by events desc, root asc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

-- Headline activity for a window: how many events, how many browser sessions, how fresh.
-- `sessions` is a per-tab id, not a person — the column is named for what it is.
create or replace function public.analytics_activity(p_since timestamptz)
returns table (events bigint, sessions bigint, newest timestamptz)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    count(*)::bigint as events,
    count(distinct e.session_hash)::bigint as sessions,
    max(e.created_at) as newest
  from public.analytics_events e
  where e.created_at >= p_since;
$$;

-- Nobody unauthenticated needs these. RLS already returns zero rows; denying EXECUTE makes
-- the refusal explicit instead of a shrug.
--
-- `from public` matters: PostgreSQL grants EXECUTE on a new function to PUBLIC, so revoking
-- from `anon` alone would leave the anon role holding the privilege through PUBLIC.
revoke execute on function public.analytics_event_totals(timestamptz) from public;
revoke execute on function public.analytics_daily_totals(date) from public;
revoke execute on function public.analytics_path_totals(timestamptz, integer) from public;
revoke execute on function public.analytics_root_totals(timestamptz, integer) from public;
revoke execute on function public.analytics_activity(timestamptz) from public;
revoke execute on function public.analytics_event_totals(timestamptz) from anon;
revoke execute on function public.analytics_daily_totals(date) from anon;
revoke execute on function public.analytics_path_totals(timestamptz, integer) from anon;
revoke execute on function public.analytics_root_totals(timestamptz, integer) from anon;
revoke execute on function public.analytics_activity(timestamptz) from anon;

grant execute on function public.analytics_event_totals(timestamptz) to authenticated;
grant execute on function public.analytics_daily_totals(date) to authenticated;
grant execute on function public.analytics_path_totals(timestamptz, integer) to authenticated;
grant execute on function public.analytics_root_totals(timestamptz, integer) to authenticated;
grant execute on function public.analytics_activity(timestamptz) to authenticated;
