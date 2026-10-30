-- Phase 9 licensing foundation. No prices, plans, trials, or commercial limits
-- are seeded: these require explicit product/business decisions.

alter table public.land_expert_plans
  add column features jsonb not null default '{}'::jsonb
    check (jsonb_typeof(features) = 'object');

alter table public.land_expert_tenant_licenses
  add column valid_from timestamptz,
  add column valid_until timestamptz,
  add constraint land_expert_license_valid_window check (
    (valid_from is null and valid_until is null)
    or (valid_from is not null and (valid_until is null or valid_until > valid_from))
  ),
  add constraint land_expert_license_state_window check (
    (status = 'unconfigured' and plan_key is null and valid_from is null and valid_until is null)
    or (status <> 'unconfigured' and plan_key is not null and valid_from is not null)
  ) not valid;

-- Existing Phase 8 assignments lack an approved validity period and therefore
-- cannot authorize any feature until a platform administrator reissues them.
-- Block the old unbounded RPC; only the explicit windowed assignment is usable.
revoke all on function public.land_expert_assign_license(uuid, text, text) from public, anon, authenticated;

create function public.land_expert_assign_license_window(
  p_tenant_id uuid,
  p_plan_key text,
  p_status text,
  p_valid_from timestamptz,
  p_valid_until timestamptz
)
returns void
language plpgsql security definer
set search_path = pg_catalog
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.land_expert_is_platform_admin() then
    raise exception 'platform administrator required' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('trial', 'active', 'past_due', 'suspended', 'cancelled') then
    raise exception 'invalid license status' using errcode = '22023';
  end if;
  if p_valid_from is null or (p_valid_until is not null and p_valid_until <= p_valid_from) then
    raise exception 'invalid license validity window' using errcode = '22023';
  end if;
  if not exists (select 1 from public.land_expert_plans where plan_key = p_plan_key and enabled) then
    raise exception 'enabled plan not found' using errcode = '22023';
  end if;
  update public.land_expert_tenant_licenses
    set plan_key = p_plan_key, status = p_status, valid_from = p_valid_from,
        valid_until = p_valid_until, updated_by = v_actor, updated_at = now()
    where tenant_id = p_tenant_id;
  if not found then raise exception 'tenant license not found' using errcode = 'P0002'; end if;
  insert into public.land_expert_audit_log (tenant_id, actor_id, action, details)
    values (p_tenant_id, v_actor, 'license.assigned', jsonb_build_object(
      'plan_key', p_plan_key, 'status', p_status,
      'valid_from', p_valid_from, 'valid_until', p_valid_until
    ));
end;
$$;

-- Plan definitions become immutable once assigned. Operators must create a
-- new plan key for new limits/features rather than retroactively changing a
-- tenant's already-issued entitlement.
create function public.land_expert_protect_issued_plan()
returns trigger
language plpgsql security definer
set search_path = pg_catalog
as $$
begin
  if (new.plan_key, new.display_name, new.member_limit, new.project_limit, new.features)
      is distinct from
     (old.plan_key, old.display_name, old.member_limit, old.project_limit, old.features)
     and exists (
       select 1 from public.land_expert_tenant_licenses l where l.plan_key = old.plan_key
     ) then
    raise exception 'issued plan definitions are immutable; create a new plan key' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger land_expert_protect_issued_plan
  before update on public.land_expert_plans
  for each row execute function public.land_expert_protect_issued_plan();

-- This is an authorization primitive, not an application-wide feature gate:
-- tenant-owned resources must call it at their server/database boundary.
create function public.land_expert_can_use_feature(p_tenant_id uuid, p_feature_key text)
returns boolean
language sql stable security definer
set search_path = pg_catalog
as $$
  select coalesce((
    select p.features -> p_feature_key = 'true'::jsonb
    from public.land_expert_tenant_memberships m
    join public.land_expert_tenant_licenses l on l.tenant_id = m.tenant_id
    join public.land_expert_plans p on p.plan_key = l.plan_key
    where m.tenant_id = p_tenant_id
      and m.user_id = (select auth.uid())
      and p.enabled
      and l.status in ('trial', 'active')
      and l.valid_from is not null
      and l.valid_from <= statement_timestamp()
      and (l.valid_until is null or l.valid_until > statement_timestamp())
      and p_feature_key ~ '^[a-z][a-z0-9_.-]{0,63}$'
  ), false);
$$;

revoke all on function public.land_expert_assign_license_window(uuid, text, text, timestamptz, timestamptz),
  public.land_expert_can_use_feature(uuid, text),
  public.land_expert_protect_issued_plan() from public, anon;
grant execute on function public.land_expert_assign_license_window(uuid, text, text, timestamptz, timestamptz),
  public.land_expert_can_use_feature(uuid, text) to authenticated;
