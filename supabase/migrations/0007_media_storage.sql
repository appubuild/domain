-- 0007_media_storage.sql — Supabase Storage bucket backing the media library.
--
-- Uploaded files never touch the database; `public.media` holds only metadata and the
-- storage path. The bucket is public because the exported site is static HTML on shared
-- hosting: a public object URL is the only way an <img src> can resolve without a signed
-- URL that would expire inside a cached page.
--
-- Enforcement lives in two places, and both matter:
--   * the bucket policies below (only administrators may write);
--   * the client-side gate in `src/lib/media/library.ts` (file type and size), which is a
--     usability check, not a security boundary — the bucket policy is the boundary.

-- ---------------------------------------------------------------------------
-- Guarded definitions
--
-- On a real Supabase project the `storage` schema and both tables already exist with far
-- richer definitions, so everything below is a no-op there. They are present so the
-- migration suite can replay every migration against plain PostgreSQL (PGlite) instead of
-- skipping this file — a skipped migration is an untested migration.
-- ---------------------------------------------------------------------------
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  public boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Bucket
--
-- `on conflict` keeps this migration safe to re-run and lets an operator flip an existing
-- bucket to public without a manual dashboard step.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = excluded.public;

alter table storage.objects enable row level security;

-- Anyone may read the media bucket: these are public site assets. Listing is also open,
-- which exposes no secret (paths are already visible in the page source).
drop policy if exists media_bucket_public_read on storage.objects;
create policy media_bucket_public_read on storage.objects
  for select using (bucket_id = 'media');

-- Writes are administrator-only, using the same helper as every other admin policy.
drop policy if exists media_bucket_admin_insert on storage.objects;
create policy media_bucket_admin_insert on storage.objects
  for insert with check (bucket_id = 'media' and public.is_admin());

drop policy if exists media_bucket_admin_update on storage.objects;
create policy media_bucket_admin_update on storage.objects
  for update using (bucket_id = 'media' and public.is_admin())
  with check (bucket_id = 'media' and public.is_admin());

drop policy if exists media_bucket_admin_delete on storage.objects;
create policy media_bucket_admin_delete on storage.objects
  for delete using (bucket_id = 'media' and public.is_admin());

-- ---------------------------------------------------------------------------
-- Metadata integrity
--
-- The application already validates these, but a direct SQL insert or a future client
-- should not be able to register a row that no image tag could ever render.
-- ---------------------------------------------------------------------------
alter table public.media
  drop constraint if exists media_mime_type_allowed;
alter table public.media
  add constraint media_mime_type_allowed
  check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/avif'));

alter table public.media
  drop constraint if exists media_alt_text_length;
alter table public.media
  add constraint media_alt_text_length
  check (char_length(alt_text) <= 160);

alter table public.media
  drop constraint if exists media_storage_path_shape;
alter table public.media
  add constraint media_storage_path_shape
  check (storage_path ~ '^[0-9]{4}/[0-9]{2}/[a-z0-9][a-z0-9-]*\.[a-z0-9]+$');
