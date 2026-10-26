-- 0005_monetization.sql — advertising configuration, affiliate routing, analytics events.

-- ---------------------------------------------------------------------------
-- Advertising (Google AdSense and future providers)
-- ---------------------------------------------------------------------------
create table if not exists public.ad_settings (
  id text primary key default 'global',
  provider text not null default 'adsense' check (provider in ('adsense', 'none')),
  publisher_id text,
  script_enabled boolean not null default false,
  global_enabled boolean not null default false,
  test_mode boolean not null default true,
  consent_required boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  -- Publisher IDs must look like ca-pub-<digits>; anything else is rejected by the database,
  -- not just by the form.
  constraint ad_settings_publisher_format check (
    publisher_id is null or publisher_id ~ '^ca-pub-[0-9]{10,20}$'
  )
);

create table if not exists public.ad_slots (
  id uuid primary key default gen_random_uuid(),
  slot_key text not null unique,
  template text not null check (template in (
    'home', 'generator', 'industry', 'blog-index', 'blog-post', 'page', 'tld'
  )),
  placement text not null check (placement in (
    'after-intro', 'mid-content', 'before-faq', 'end-of-content', 'sidebar'
  )),
  ad_unit_id text,
  format text not null default 'auto' check (format in ('auto', 'horizontal', 'rectangle', 'vertical')),
  enabled boolean not null default false,
  display_order int not null default 100,
  label text not null default 'Advertisement',
  updated_at timestamptz not null default now(),
  constraint ad_slots_unit_format check (ad_unit_id is null or ad_unit_id ~ '^[0-9]{6,25}$')
);

-- ---------------------------------------------------------------------------
-- Affiliate routing
-- ---------------------------------------------------------------------------
create table if not exists public.affiliate_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  enabled boolean not null default false,
  priority int not null default 100,
  -- Template must contain {domain}; it is validated in the app before any redirect.
  url_template text not null,
  allowed_hosts text[] not null default '{}',
  supported_tlds text[] not null default '{}',
  disclosure text not null default '',
  is_fallback boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliate_url_template_https check (url_template like 'https://%'),
  constraint affiliate_url_template_domain_token check (url_template like '%{domain}%')
);

create table if not exists public.affiliate_tld_rules (
  id uuid primary key default gen_random_uuid(),
  tld text not null,
  provider_id uuid not null references public.affiliate_providers(id) on delete cascade,
  enabled boolean not null default true,
  unique (tld, provider_id)
);

create table if not exists public.click_events (
  id bigserial primary key,
  provider_id uuid references public.affiliate_providers(id) on delete set null,
  domain text not null,
  tld text not null default '',
  source_path text not null default '',
  -- Privacy: a rotating, salted hash of the visitor session — no IP, no user agent.
  session_hash text,
  created_at timestamptz not null default now()
);

create index if not exists click_events_created_idx on public.click_events(created_at desc);

-- ---------------------------------------------------------------------------
-- Analytics: first-party, event-level, no third-party identifiers.
-- ---------------------------------------------------------------------------
create table if not exists public.analytics_events (
  id bigserial primary key,
  event_type text not null check (event_type in (
    'generation_run', 'filter_applied', 'export_created', 'favorite_added',
    'availability_check', 'availability_failure', 'affiliate_click',
    'page_view', 'signup', 'login', 'ai_generation'
  )),
  path text not null default '',
  payload jsonb not null default '{}'::jsonb,
  session_hash text,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_type_idx on public.analytics_events(event_type, created_at desc);
create index if not exists analytics_events_created_idx on public.analytics_events(created_at desc);

-- Aggregate view used by the admin dashboard. Security invoker so RLS still applies.
create or replace view public.analytics_daily as
select
  date_trunc('day', created_at) as day,
  event_type,
  count(*)::bigint as events
from public.analytics_events
group by 1, 2;

-- ---------------------------------------------------------------------------
-- Public API keys (optional module; disabled unless an admin creates a key)
-- ---------------------------------------------------------------------------
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_prefix text not null unique,
  key_hash text not null,
  scopes text[] not null default '{}',
  enabled boolean not null default true,
  rate_limit_per_hour int not null default 60,
  last_used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

drop trigger if exists ad_settings_set_updated_at on public.ad_settings;
create trigger ad_settings_set_updated_at before update on public.ad_settings
for each row execute function public.set_updated_at();

drop trigger if exists ad_slots_set_updated_at on public.ad_slots;
create trigger ad_slots_set_updated_at before update on public.ad_slots
for each row execute function public.set_updated_at();

drop trigger if exists affiliate_providers_set_updated_at on public.affiliate_providers;
create trigger affiliate_providers_set_updated_at before update on public.affiliate_providers
for each row execute function public.set_updated_at();
