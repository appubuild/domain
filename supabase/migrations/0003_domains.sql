-- 0003_domains.sql — TLD directory, availability providers/checks, user workspace.

-- ---------------------------------------------------------------------------
-- TLD directory
-- ---------------------------------------------------------------------------
create table if not exists public.tlds (
  tld text primary key,
  display_name text not null,
  description text not null default '',
  category text not null default 'generic'
    check (category in ('generic', 'technology', 'business', 'country', 'media', 'social')),
  enabled boolean not null default true,
  checkability text not null default 'unknown'
    check (checkability in ('rdap', 'registrar-api', 'unknown', 'unsupported')),
  display_order int not null default 100,
  note text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tlds_enabled_idx on public.tlds(enabled, display_order);

-- ---------------------------------------------------------------------------
-- Availability providers. Capabilities are explicit; nothing is assumed.
-- ---------------------------------------------------------------------------
create table if not exists public.availability_providers (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('rdap', 'dns', 'registrar-api', 'edge-function', 'mock')),
  base_url text,
  endpoint_template text,
  supports_tlds text[] not null default '{}',
  enabled boolean not null default true,
  is_production boolean not null default true,
  priority int not null default 100,
  timeout_ms int not null default 8000,
  rate_limit_per_minute int not null default 30,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.availability_checks (
  id uuid primary key default gen_random_uuid(),
  domain text not null,
  tld text not null,
  status text not null check (status in (
    'available_verified', 'registered', 'unavailable', 'premium_or_special_pricing',
    'unknown', 'check_failed', 'rate_limited', 'unsupported_tld'
  )),
  provider_id text references public.availability_providers(id) on delete set null,
  provider_kind text not null default 'unknown',
  checked_at timestamptz not null default now(),
  expires_at timestamptz,
  cached boolean not null default false,
  confirmed boolean not null default false,
  http_status int,
  latency_ms int,
  error text,
  raw_excerpt text,
  created_at timestamptz not null default now()
);

create index if not exists availability_checks_domain_idx
  on public.availability_checks(domain, checked_at desc);

create table if not exists public.availability_cache (
  domain text primary key,
  status text not null,
  provider_id text references public.availability_providers(id) on delete set null,
  provider_kind text not null default 'unknown',
  confirmed boolean not null default false,
  checked_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists availability_cache_expiry_idx on public.availability_cache(expires_at);

-- ---------------------------------------------------------------------------
-- Workspace: favourites, collections, saved searches (authenticated users).
-- Anonymous favourites live in the browser only — see docs/privacy.md.
-- ---------------------------------------------------------------------------
create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  domain text not null,
  root text not null default '',
  note text not null default '',
  overall_score numeric(5, 2),
  created_at timestamptz not null default now()
);

create unique index if not exists favorites_user_domain_idx on public.favorites(user_id, lower(domain));

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  is_public boolean not null default false,
  share_slug text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collection_items (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  label text not null,
  domain text not null,
  note text not null default '',
  position int not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists collection_items_unique_idx
  on public.collection_items(collection_id, lower(domain));

create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  query jsonb not null,
  created_at timestamptz not null default now()
);

drop trigger if exists tlds_set_updated_at on public.tlds;
create trigger tlds_set_updated_at before update on public.tlds
for each row execute function public.set_updated_at();

drop trigger if exists availability_providers_set_updated_at on public.availability_providers;
create trigger availability_providers_set_updated_at before update on public.availability_providers
for each row execute function public.set_updated_at();

drop trigger if exists collections_set_updated_at on public.collections;
create trigger collections_set_updated_at before update on public.collections
for each row execute function public.set_updated_at();
