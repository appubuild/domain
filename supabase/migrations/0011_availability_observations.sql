-- 0011_availability_observations.sql
--
-- Retention for the availability observation store.
--
-- `availability_checks` has existed since 0003 but nothing wrote to it: the cache table answered
-- the next visitor, and the history table stayed empty, so the admin dashboard's "checks in the
-- last 24 hours" tile was structurally always zero. The edge function now appends one row per
-- domain+status per day (see `OBSERVATION_DEDUPE_HOURS` in supabase/functions/availability), which
-- makes that tile real — and makes retention necessary, because an append-only table with no
-- prune is a slow leak.
--
-- Decision, recorded here rather than in a chat: the store is worth keeping.
--   * It answers a question the cache cannot: did this name change state, and when?
--   * It is the only place provider health (timeouts per TLD, latency) can be observed, because
--     a static frontend has no server logs of its own.
--   * Per-IP data is deliberately absent: the row records the domain and the answer, never who
--     asked, so the table is not a visitor log.
--
-- Retention is 90 days, pruned daily. Both the function and the schedule are guarded so the
-- migration applies unchanged to a database without pg_cron (the PGlite harness).

create or replace function public.prune_availability_observations(retain_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer := 0;
begin
  if retain_days is null or retain_days < 1 then
    raise exception 'retain_days must be a positive integer';
  end if;

  delete from public.availability_checks
   where checked_at < now() - make_interval(days => retain_days);

  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function public.prune_availability_observations(integer) is
  'Deletes availability observations older than the retention window (default 90 days) and returns the number of rows removed. Called daily by pg_cron (job availability_prune_observations).';

-- The function is a maintenance task, not a public API.
revoke all on function public.prune_availability_observations(integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.prune_availability_observations(integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.prune_availability_observations(integer) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.prune_availability_observations(integer) to service_role';
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is unavailable on this server; availability observations will not be pruned automatically.';
    return;
  end if;

  execute 'create extension if not exists pg_cron with schema extensions';

  if exists (select 1 from cron.job where jobname = 'availability_prune_observations') then
    perform cron.unschedule('availability_prune_observations');
  end if;

  perform cron.schedule(
    'availability_prune_observations',
    '17 3 * * *',
    $job$select public.prune_availability_observations();$job$
  );
end;
$$;
