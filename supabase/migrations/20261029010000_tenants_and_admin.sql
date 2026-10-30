-- Phase 8 foundation: tenant isolation, role modelling, admin-only licensing
-- controls, and append-only audit events. Apply only after reviewing against
-- the explicitly selected Supabase project. No plans are seeded: plan names,
-- pricing and limits must be approved before licensing is enabled.

create table public.land_expert_tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.land_expert_tenant_memberships (
  tenant_id uuid not null references public.land_expert_tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'surveyor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index land_expert_memberships_user on public.land_expert_tenant_memberships (user_id, tenant_id);
create unique index land_expert_tenant_one_owner on public.land_expert_tenant_memberships (tenant_id) where role = 'owner';

-- Plan details and commercial limits intentionally remain empty until Phase 9.
-- Rows are provisioned only by a trusted database administrator.
create table public.land_expert_plans (
  plan_key text primary key check (plan_key ~ '^[a-z][a-z0-9_-]{0,39}$'),
  display_name text not null check (char_length(display_name) between 1 and 100),
  member_limit integer not null check (member_limit > 0),
  project_limit integer not null check (project_limit > 0),
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.land_expert_tenant_licenses (
  tenant_id uuid primary key references public.land_expert_tenants(id) on delete cascade,
  plan_key text references public.land_expert_plans(plan_key) on delete restrict,
  status text not null default 'unconfigured'
    check (status in ('unconfigured', 'trial', 'active', 'past_due', 'suspended', 'cancelled')),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check ((plan_key is null and status = 'unconfigured') or (plan_key is not null and status <> 'unconfigured'))
);

-- Never store passwords, tokens, backup contents, or arbitrary client metadata here.
create table public.land_expert_audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.land_expert_tenants(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('tenant.created', 'tenant.renamed', 'membership.role_changed', 'license.assigned')),
  target_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz not null default now()
);
create index land_expert_audit_tenant_time on public.land_expert_audit_log (tenant_id, occurred_at desc);

-- Platform admins are provisioned out-of-band by a trusted project operator.
-- No authenticated/anon table privileges or client RPC exist for self-promotion.
create table public.land_expert_platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.land_expert_tenants enable row level security;
alter table public.land_expert_tenant_memberships enable row level security;
alter table public.land_expert_plans enable row level security;
alter table public.land_expert_tenant_licenses enable row level security;
alter table public.land_expert_audit_log enable row level security;
alter table public.land_expert_platform_admins enable row level security;

create function public.land_expert_is_tenant_member(p_tenant_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1 from public.land_expert_tenant_memberships m
    where m.tenant_id = p_tenant_id and m.user_id = (select auth.uid())
  );
$$;

create function public.land_expert_is_tenant_manager(p_tenant_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1 from public.land_expert_tenant_memberships m
    where m.tenant_id = p_tenant_id and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

create function public.land_expert_is_tenant_owner(p_tenant_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1 from public.land_expert_tenant_memberships m
    where m.tenant_id = p_tenant_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

create function public.land_expert_is_platform_admin()
returns boolean
language sql stable security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1 from public.land_expert_platform_admins a where a.user_id = (select auth.uid())
  );
$$;

create policy tenant_members_read_tenant on public.land_expert_tenants
  for select to authenticated using (public.land_expert_is_tenant_member(id));
create policy tenant_memberships_read_tenant on public.land_expert_tenant_memberships
  for select to authenticated using (public.land_expert_is_tenant_member(tenant_id));
create policy published_plans_read on public.land_expert_plans
  for select to authenticated using (enabled);
create policy tenant_license_read_tenant on public.land_expert_tenant_licenses
  for select to authenticated using (public.land_expert_is_tenant_member(tenant_id));
create policy tenant_audit_read_managers_and_platform_admins on public.land_expert_audit_log
  for select to authenticated using (
    public.land_expert_is_tenant_manager(tenant_id) or public.land_expert_is_platform_admin()
  );
-- No client policies are intentionally defined for platform_admins or writes.

revoke all on public.land_expert_tenants, public.land_expert_tenant_memberships,
  public.land_expert_plans, public.land_expert_tenant_licenses,
  public.land_expert_audit_log, public.land_expert_platform_admins
  from public, anon, authenticated;
grant select on public.land_expert_tenants, public.land_expert_tenant_memberships,
  public.land_expert_plans, public.land_expert_tenant_licenses,
  public.land_expert_audit_log to authenticated;
revoke all on function public.land_expert_is_tenant_member(uuid),
  public.land_expert_is_tenant_manager(uuid),
  public.land_expert_is_tenant_owner(uuid),
  public.land_expert_is_platform_admin() from public, anon;
grant execute on function public.land_expert_is_tenant_member(uuid),
  public.land_expert_is_tenant_manager(uuid),
  public.land_expert_is_tenant_owner(uuid),
  public.land_expert_is_platform_admin() to authenticated;

create function public.land_expert_create_tenant(p_name text)
returns uuid
language plpgsql security definer
set search_path = pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 100 or p_name ~ '[[:cntrl:]]' then
    raise exception 'invalid tenant name' using errcode = '22023';
  end if;
  insert into public.land_expert_tenants (name, created_by) values (btrim(p_name), v_actor)
    returning id into v_tenant_id;
  insert into public.land_expert_tenant_memberships (tenant_id, user_id, role)
    values (v_tenant_id, v_actor, 'owner');
  insert into public.land_expert_tenant_licenses (tenant_id) values (v_tenant_id);
  insert into public.land_expert_audit_log (tenant_id, actor_id, action)
    values (v_tenant_id, v_actor, 'tenant.created');
  return v_tenant_id;
end;
$$;

create function public.land_expert_rename_tenant(p_tenant_id uuid, p_name text)
returns void
language plpgsql security definer
set search_path = pg_catalog
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.land_expert_is_tenant_manager(p_tenant_id) then
    raise exception 'tenant manager required' using errcode = '42501';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 100 or p_name ~ '[[:cntrl:]]' then
    raise exception 'invalid tenant name' using errcode = '22023';
  end if;
  update public.land_expert_tenants set name = btrim(p_name) where id = p_tenant_id;
  if not found then raise exception 'tenant not found' using errcode = 'P0002'; end if;
  insert into public.land_expert_audit_log (tenant_id, actor_id, action)
    values (p_tenant_id, v_actor, 'tenant.renamed');
end;
$$;

-- Only the existing owner can change a non-owner member's role. Ownership
-- transfer and invitations require separately designed, consentful flows.
create function public.land_expert_set_member_role(p_tenant_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql security definer
set search_path = pg_catalog
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.land_expert_is_tenant_owner(p_tenant_id) then
    raise exception 'tenant owner required' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('admin', 'surveyor', 'viewer') then
    raise exception 'invalid member role' using errcode = '22023';
  end if;
  update public.land_expert_tenant_memberships
    set role = p_role
    where tenant_id = p_tenant_id and user_id = p_user_id and role <> 'owner';
  if not found then raise exception 'non-owner membership not found' using errcode = 'P0002'; end if;
  insert into public.land_expert_audit_log (tenant_id, actor_id, action, target_user_id, details)
    values (p_tenant_id, v_actor, 'membership.role_changed', p_user_id, jsonb_build_object('role', p_role));
end;
$$;

-- Trusted platform administrators are inserted into land_expert_platform_admins
-- out-of-band. No tenant owner or ordinary authenticated user can call this.
create function public.land_expert_assign_license(p_tenant_id uuid, p_plan_key text, p_status text)
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
  if not exists (select 1 from public.land_expert_plans where plan_key = p_plan_key and enabled) then
    raise exception 'enabled plan not found' using errcode = '22023';
  end if;
  update public.land_expert_tenant_licenses
    set plan_key = p_plan_key, status = p_status, updated_by = v_actor, updated_at = now()
    where tenant_id = p_tenant_id;
  if not found then raise exception 'tenant license not found' using errcode = 'P0002'; end if;
  insert into public.land_expert_audit_log (tenant_id, actor_id, action, details)
    values (p_tenant_id, v_actor, 'license.assigned', jsonb_build_object('plan_key', p_plan_key, 'status', p_status));
end;
$$;

revoke all on function public.land_expert_create_tenant(text),
  public.land_expert_rename_tenant(uuid, text),
  public.land_expert_set_member_role(uuid, uuid, text),
  public.land_expert_assign_license(uuid, text, text) from public, anon;
grant execute on function public.land_expert_create_tenant(text),
  public.land_expert_rename_tenant(uuid, text),
  public.land_expert_set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.land_expert_assign_license(uuid, text, text) to authenticated;
