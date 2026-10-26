-- 0004_content.sql — CMS pages, page sections, media, navigation, SEO, blog.

-- ---------------------------------------------------------------------------
-- Pages
-- ---------------------------------------------------------------------------
create table if not exists public.pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  excerpt text not null default '',
  body text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  template text not null default 'standard',
  seo_title text,
  meta_description text,
  canonical_url text,
  og_image_url text,
  noindex boolean not null default false,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint pages_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create index if not exists pages_status_idx on public.pages(status, updated_at desc);

-- Structured page sections: the page builder stores validated JSON per section.
create table if not exists public.page_sections (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages(id) on delete cascade,
  kind text not null check (kind in (
    'hero', 'features', 'steps', 'industries', 'faq', 'cta', 'blog-highlights',
    'text', 'ad-slot', 'footer-columns', 'generator-embed'
  )),
  position int not null default 0,
  enabled boolean not null default true,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint page_sections_heading_required check (kind <> 'text' or content ? 'heading')
);

create index if not exists page_sections_page_idx on public.page_sections(page_id, position);

-- ---------------------------------------------------------------------------
-- Media metadata (files themselves live in Supabase Storage)
-- ---------------------------------------------------------------------------
create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  width int,
  height int,
  alt_text text not null default '',
  caption text not null default '',
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Navigation
-- ---------------------------------------------------------------------------
create table if not exists public.nav_menus (
  id text primary key,
  name text not null,
  location text not null default 'primary' check (location in ('primary', 'footer', 'admin')),
  updated_at timestamptz not null default now()
);

create table if not exists public.nav_items (
  id uuid primary key default gen_random_uuid(),
  menu_id text not null references public.nav_menus(id) on delete cascade,
  label text not null,
  href text not null,
  description text not null default '',
  position int not null default 0,
  enabled boolean not null default true,
  parent_id uuid references public.nav_items(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- SEO templates, redirects
-- ---------------------------------------------------------------------------
create table if not exists public.seo_templates (
  id text primary key,
  entity text not null check (entity in ('home', 'page', 'post', 'industry', 'tld', 'generator', 'blog-index')),
  title_template text not null,
  description_template text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.redirects (
  id uuid primary key default gen_random_uuid(),
  source_path text not null unique,
  target_path text not null,
  status_code int not null default 301 check (status_code in (301, 302, 307, 308)),
  enabled boolean not null default true,
  hit_count bigint not null default 0,
  created_at timestamptz not null default now(),
  constraint redirects_source_format check (source_path like '/%'),
  constraint redirects_target_format check (target_path like '/%' or target_path like 'https://%'),
  constraint redirects_no_loop check (source_path <> target_path)
);

-- ---------------------------------------------------------------------------
-- Blog
-- ---------------------------------------------------------------------------
create table if not exists public.post_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.post_tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  excerpt text not null default '',
  body text not null default '',
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'published', 'archived')),
  category_id uuid references public.post_categories(id) on delete set null,
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null default '',
  cover_image_url text,
  cover_image_alt text not null default '',
  reading_minutes int not null default 0 check (reading_minutes >= 0),
  seo_title text,
  meta_description text,
  canonical_url text,
  og_image_url text,
  noindex boolean not null default false,
  faq jsonb not null default '[]'::jsonb,
  published_at timestamptz,
  scheduled_for timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posts_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint posts_published_requires_date check (status <> 'published' or published_at is not null),
  constraint posts_scheduled_requires_date check (status <> 'scheduled' or scheduled_for is not null)
);

create index if not exists posts_status_idx on public.posts(status, published_at desc);
create index if not exists posts_category_idx on public.posts(category_id);

create table if not exists public.post_tags_map (
  post_id uuid not null references public.posts(id) on delete cascade,
  tag_id uuid not null references public.post_tags(id) on delete cascade,
  primary key (post_id, tag_id)
);

-- ---------------------------------------------------------------------------
-- AI content studio drafts (review required before publishing)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_drafts (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id) on delete set null,
  kind text not null default 'outline' check (kind in ('outline', 'draft', 'metadata', 'faq')),
  prompt_summary text not null default '',
  provider text not null default 'none',
  model text,
  content text not null default '',
  status text not null default 'pending_review'
    check (status in ('pending_review', 'accepted', 'rejected', 'failed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

drop trigger if exists pages_set_updated_at on public.pages;
create trigger pages_set_updated_at before update on public.pages
for each row execute function public.set_updated_at();

drop trigger if exists page_sections_set_updated_at on public.page_sections;
create trigger page_sections_set_updated_at before update on public.page_sections
for each row execute function public.set_updated_at();

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at before update on public.posts
for each row execute function public.set_updated_at();
