-- 0001_core.sql — extensions, shared helpers, roles, settings, audit.
--
-- Target: Supabase Postgres (production) and PostgreSQL 17+/PGlite (verification).
-- Auth is Supabase Auth: `auth.uid()` is provided by the platform. Nothing here creates
-- its own password table; application-level credentials never live in these tables.

-- gen_random_uuid() is built into PostgreSQL 13+, so pgcrypto is optional. Supabase has it
-- enabled; a bare PostgreSQL/PGlite instance may not, and that must not break the schema.
do $$
begin
  begin
    create extension if not exists pgcrypto;
  exception when others then
    raise notice 'pgcrypto unavailable — using built-in gen_random_uuid()';
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Roles & permissions (RBAC). A user may hold several roles.
-- ---------------------------------------------------------------------------
create table if not exists public.app_roles (
  id text primary key,
  name text not null,
  description text not null default '',
  rank int not null default 10,
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_id text not null references public.app_roles(id) on delete cascade,
  permission text not null,
  primary key (role_id, permission)
);

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  locale text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id text not null references public.app_roles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null,
  primary key (user_id, role_id)
);

create index if not exists user_roles_role_idx on public.user_roles(role_id);

/**
 * True when the current JWT belongs to an administrator.
 * SECURITY DEFINER so RLS policies can call it without recursive policy evaluation.
 */
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.app_roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and r.rank >= 80
  );
$$;

create or replace function public.has_permission(permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.app_roles r on r.id = ur.role_id
    join public.role_permissions rp on rp.role_id = r.id
    where ur.user_id = auth.uid()
      and (r.rank >= 100 or rp.permission = permission)
  );
$$;

-- ---------------------------------------------------------------------------
-- Site settings: single logical document per key, versioned for rollback.
-- ---------------------------------------------------------------------------
create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  description text not null default '',
  is_public boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.config_versions (
  id bigserial primary key,
  entity_type text not null,
  entity_id text not null,
  version int not null,
  snapshot jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (entity_type, entity_id, version)
);

create index if not exists config_versions_entity_idx
  on public.config_versions(entity_type, entity_id, version desc);

-- ---------------------------------------------------------------------------
-- Audit log: append-only. Written by the app for admin mutations.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id bigserial primary key,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null,
  entity_type text not null,
  entity_id text,
  summary text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);

-- ---------------------------------------------------------------------------
-- Feature flags + jobs (bounded background work such as bulk availability).
-- ---------------------------------------------------------------------------
create table if not exists public.feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  total int not null default 0,
  completed int not null default 0,
  failed int not null default 0,
  payload jsonb not null default '{}'::jsonb,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_status_idx on public.jobs(status, created_at desc);

drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at before update on public.jobs
for each row execute function public.set_updated_at();

drop trigger if exists user_profiles_set_updated_at on public.user_profiles;
create trigger user_profiles_set_updated_at before update on public.user_profiles
for each row execute function public.set_updated_at();
