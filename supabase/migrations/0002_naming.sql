-- 0002_naming.sql — dictionaries, industries, templates and scoring configuration.
--
-- Every row here is editable from the admin panel and versioned in `config_versions`.
-- The engine ships with equivalent seed data so it works with an empty database, but the
-- database is authoritative once populated (Phase 7 gate).

-- ---------------------------------------------------------------------------
-- Prefix / suffix libraries and their words
-- ---------------------------------------------------------------------------
create table if not exists public.word_libraries (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('prefix', 'suffix')),
  description text not null default '',
  enabled boolean not null default true,
  display_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dictionary_terms (
  id uuid primary key default gen_random_uuid(),
  word text not null,
  term_type text not null default 'word'
    check (term_type in ('word', 'prefix', 'suffix', 'morpheme', 'synonym', 'excluded')),
  library_id text references public.word_libraries(id) on delete set null,
  tone text not null default 'neutral',
  industries text[] not null default '{}',
  weight numeric(5, 2) not null default 1.0,
  enabled boolean not null default true,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists dictionary_terms_word_type_idx
  on public.dictionary_terms (lower(word), term_type, coalesce(library_id, ''));

create index if not exists dictionary_terms_type_idx on public.dictionary_terms(term_type, enabled);

-- ---------------------------------------------------------------------------
-- Industries, their vocabulary and naming patterns
-- ---------------------------------------------------------------------------
create table if not exists public.industries (
  id text primary key,
  name text not null,
  slug text not null unique,
  parent_id text references public.industries(id) on delete set null,
  description text not null default '',
  intro text not null default '',
  semantic_weight numeric(4, 2) not null default 1.0,
  enabled boolean not null default true,
  display_order int not null default 100,
  seo_title text,
  meta_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.industry_terms (
  id uuid primary key default gen_random_uuid(),
  industry_id text not null references public.industries(id) on delete cascade,
  term text not null,
  role text not null default 'related'
    check (role in ('keyword', 'related', 'prefix', 'suffix', 'avoid', 'category', 'audience', 'action', 'product')),
  weight numeric(5, 2) not null default 1.0,
  created_at timestamptz not null default now()
);

create unique index if not exists industry_terms_unique_idx
  on public.industry_terms(industry_id, lower(term), role);

create table if not exists public.phrase_templates (
  id text primary key,
  label text not null,
  template text not null check (template in ('prefix-root', 'root-suffix', 'industry-root', 'root-industry', 'root-concept', 'root-action', 'root-audience', 'root-product')),
  pool text not null check (pool in ('prefix', 'suffix', 'industry', 'concept', 'action', 'audience', 'product')),
  industry_id text references public.industries(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Scoring & brandable profiles (versioned, weights as JSON)
-- ---------------------------------------------------------------------------
create table if not exists public.scoring_profiles (
  id text not null,
  version int not null default 1,
  name text not null,
  kind text not null check (kind in ('quality', 'brandability')),
  description text not null default '',
  ideal_length_min int not null default 5,
  ideal_length_max int not null default 9,
  weights jsonb not null,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (id, version),
  constraint scoring_weights_object check (jsonb_typeof(weights) = 'object')
);

create table if not exists public.brandable_profiles (
  id text primary key,
  name text not null,
  description text not null default '',
  ideal_length_min int not null default 5,
  ideal_length_max int not null default 8,
  ideal_syllables_min int not null default 2,
  ideal_syllables_max int not null default 3,
  preferred_styles text[] not null default '{}',
  originality_bias numeric(4, 2) not null default 0.5,
  enabled boolean not null default true,
  display_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Excluded-word rules (kept separate: they change often and need their own audit trail)
-- ---------------------------------------------------------------------------
create table if not exists public.excluded_rules (
  id uuid primary key default gen_random_uuid(),
  pattern text not null,
  match_type text not null default 'substring' check (match_type in ('substring', 'word', 'regex')),
  reason text not null default '',
  severity text not null default 'block' check (severity in ('block', 'warn')),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists excluded_rules_unique_idx on public.excluded_rules(lower(pattern), match_type);

drop trigger if exists word_libraries_set_updated_at on public.word_libraries;
create trigger word_libraries_set_updated_at before update on public.word_libraries
for each row execute function public.set_updated_at();

drop trigger if exists dictionary_terms_set_updated_at on public.dictionary_terms;
create trigger dictionary_terms_set_updated_at before update on public.dictionary_terms
for each row execute function public.set_updated_at();

drop trigger if exists industries_set_updated_at on public.industries;
create trigger industries_set_updated_at before update on public.industries
for each row execute function public.set_updated_at();

drop trigger if exists brandable_profiles_set_updated_at on public.brandable_profiles;
create trigger brandable_profiles_set_updated_at before update on public.brandable_profiles
for each row execute function public.set_updated_at();
