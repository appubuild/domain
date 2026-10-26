-- 0006_policies.sql — Row Level Security.
--
-- Security model: the browser holds only the Supabase anon key, so **RLS is the
-- authorization boundary**. UI route guards are convenience only. Every table is locked
-- down here; nothing is readable or writable unless a policy grants it.

-- Enable RLS everywhere (idempotent).
do $$
declare
  t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Publicly readable configuration (must never contain secrets)
-- ---------------------------------------------------------------------------
drop policy if exists site_settings_public_read on public.site_settings;
create policy site_settings_public_read on public.site_settings
  for select using (is_public = true);

drop policy if exists site_settings_admin_all on public.site_settings;
create policy site_settings_admin_all on public.site_settings
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists tlds_public_read on public.tlds;
create policy tlds_public_read on public.tlds for select using (true);

drop policy if exists tlds_admin_write on public.tlds;
create policy tlds_admin_write on public.tlds
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists industries_public_read on public.industries;
create policy industries_public_read on public.industries
  for select using (enabled = true or public.is_admin());

drop policy if exists industries_admin_write on public.industries;
create policy industries_admin_write on public.industries
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists industry_terms_public_read on public.industry_terms;
create policy industry_terms_public_read on public.industry_terms for select using (true);

drop policy if exists industry_terms_admin_write on public.industry_terms;
create policy industry_terms_admin_write on public.industry_terms
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists dictionaries_public_read on public.dictionary_terms;
create policy dictionaries_public_read on public.dictionary_terms
  for select using (enabled = true or public.is_admin());

drop policy if exists dictionaries_admin_write on public.dictionary_terms;
create policy dictionaries_admin_write on public.dictionary_terms
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists libraries_public_read on public.word_libraries;
create policy libraries_public_read on public.word_libraries for select using (true);

drop policy if exists libraries_admin_write on public.word_libraries;
create policy libraries_admin_write on public.word_libraries
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists brandable_profiles_public_read on public.brandable_profiles;
create policy brandable_profiles_public_read on public.brandable_profiles for select using (true);

drop policy if exists brandable_profiles_admin_write on public.brandable_profiles;
create policy brandable_profiles_admin_write on public.brandable_profiles
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists scoring_profiles_public_read on public.scoring_profiles;
create policy scoring_profiles_public_read on public.scoring_profiles
  for select using (is_active = true or public.is_admin());

drop policy if exists scoring_profiles_admin_write on public.scoring_profiles;
create policy scoring_profiles_admin_write on public.scoring_profiles
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists templates_public_read on public.phrase_templates;
create policy templates_public_read on public.phrase_templates for select using (enabled = true);

drop policy if exists templates_admin_write on public.phrase_templates;
create policy templates_admin_write on public.phrase_templates
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists providers_public_read on public.availability_providers;
create policy providers_public_read on public.availability_providers
  for select using (enabled = true and is_production = true);

drop policy if exists providers_admin_write on public.availability_providers;
create policy providers_admin_write on public.availability_providers
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists ad_settings_public_read on public.ad_settings;
create policy ad_settings_public_read on public.ad_settings for select using (true);

drop policy if exists ad_settings_admin_write on public.ad_settings;
create policy ad_settings_admin_write on public.ad_settings
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists ad_slots_public_read on public.ad_slots;
create policy ad_slots_public_read on public.ad_slots for select using (true);

drop policy if exists ad_slots_admin_write on public.ad_slots;
create policy ad_slots_admin_write on public.ad_slots
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists affiliate_public_read on public.affiliate_providers;
create policy affiliate_public_read on public.affiliate_providers
  for select using (enabled = true);

drop policy if exists affiliate_admin_write on public.affiliate_providers;
create policy affiliate_admin_write on public.affiliate_providers
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists affiliate_rules_public_read on public.affiliate_tld_rules;
create policy affiliate_rules_public_read on public.affiliate_tld_rules
  for select using (enabled = true);

drop policy if exists affiliate_rules_admin_write on public.affiliate_tld_rules;
create policy affiliate_rules_admin_write on public.affiliate_tld_rules
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists seo_templates_public_read on public.seo_templates;
create policy seo_templates_public_read on public.seo_templates for select using (true);

drop policy if exists seo_templates_admin_write on public.seo_templates;
create policy seo_templates_admin_write on public.seo_templates
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists redirects_public_read on public.redirects;
create policy redirects_public_read on public.redirects
  for select using (enabled = true);

drop policy if exists redirects_admin_write on public.redirects;
create policy redirects_admin_write on public.redirects
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Published content is public; drafts are not even readable without admin rights.
-- ---------------------------------------------------------------------------
drop policy if exists pages_public_read on public.pages;
create policy pages_public_read on public.pages
  for select using (status = 'published' or public.is_admin());

drop policy if exists pages_admin_write on public.pages;
create policy pages_admin_write on public.pages
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists page_sections_public_read on public.page_sections;
create policy page_sections_public_read on public.page_sections
  for select using (
    public.is_admin()
    or exists (select 1 from public.pages p where p.id = page_id and p.status = 'published')
  );

drop policy if exists page_sections_admin_write on public.page_sections;
create policy page_sections_admin_write on public.page_sections
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists posts_public_read on public.posts;
create policy posts_public_read on public.posts
  for select using (
    (status = 'published' and published_at <= now()) or public.is_admin()
  );

drop policy if exists posts_admin_write on public.posts;
create policy posts_admin_write on public.posts
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists post_categories_public_read on public.post_categories;
create policy post_categories_public_read on public.post_categories for select using (true);

drop policy if exists post_categories_admin_write on public.post_categories;
create policy post_categories_admin_write on public.post_categories
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists post_tags_public_read on public.post_tags;
create policy post_tags_public_read on public.post_tags for select using (true);

drop policy if exists post_tags_admin_write on public.post_tags;
create policy post_tags_admin_write on public.post_tags
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists post_tags_map_public_read on public.post_tags_map;
create policy post_tags_map_public_read on public.post_tags_map for select using (true);

drop policy if exists post_tags_map_admin_write on public.post_tags_map;
create policy post_tags_map_admin_write on public.post_tags_map
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists media_public_read on public.media;
create policy media_public_read on public.media for select using (true);

drop policy if exists media_admin_write on public.media;
create policy media_admin_write on public.media
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists nav_public_read on public.nav_menus;
create policy nav_public_read on public.nav_menus for select using (true);

drop policy if exists nav_admin_write on public.nav_menus;
create policy nav_admin_write on public.nav_menus
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists nav_items_public_read on public.nav_items;
create policy nav_items_public_read on public.nav_items
  for select using (enabled = true or public.is_admin());

drop policy if exists nav_items_admin_write on public.nav_items;
create policy nav_items_admin_write on public.nav_items
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Workspace: users own their rows. Nothing is readable across accounts.
-- ---------------------------------------------------------------------------
drop policy if exists favorites_owner_all on public.favorites;
create policy favorites_owner_all on public.favorites
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists collections_owner_read on public.collections;
create policy collections_owner_read on public.collections
  for select using (auth.uid() = user_id or (is_public = true and share_slug is not null));

drop policy if exists collections_owner_write on public.collections;
create policy collections_owner_write on public.collections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists collection_items_read on public.collection_items;
create policy collection_items_read on public.collection_items
  for select using (
    exists (
      select 1 from public.collections c
      where c.id = collection_id
        and (c.user_id = auth.uid() or (c.is_public = true and c.share_slug is not null))
    )
  );

drop policy if exists collection_items_write on public.collection_items;
create policy collection_items_write on public.collection_items
  for all using (
    exists (select 1 from public.collections c where c.id = collection_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.collections c where c.id = collection_id and c.user_id = auth.uid())
  );

drop policy if exists saved_searches_owner_all on public.saved_searches;
create policy saved_searches_owner_all on public.saved_searches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Analytics: anybody may insert events (append-only), only admins may read them.
-- Abuse is bounded by rate limits in the client/Edge Function and by the event_type check.
-- ---------------------------------------------------------------------------
drop policy if exists analytics_insert_any on public.analytics_events;
create policy analytics_insert_any on public.analytics_events
  for insert with check (true);

drop policy if exists analytics_admin_read on public.analytics_events;
create policy analytics_admin_read on public.analytics_events
  for select using (public.is_admin());

drop policy if exists clicks_insert_any on public.click_events;
create policy clicks_insert_any on public.click_events
  for insert with check (true);

drop policy if exists clicks_admin_read on public.click_events;
create policy clicks_admin_read on public.click_events
  for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Admin-only tables: no policies for anon, explicit admin policies.
-- ---------------------------------------------------------------------------
drop policy if exists audit_admin_read on public.audit_logs;
create policy audit_admin_read on public.audit_logs for select using (public.is_admin());

drop policy if exists audit_admin_insert on public.audit_logs;
create policy audit_admin_insert on public.audit_logs for insert with check (public.is_admin());

drop policy if exists config_versions_admin on public.config_versions;
create policy config_versions_admin on public.config_versions
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists roles_admin_read on public.app_roles;
create policy roles_admin_read on public.app_roles for select using (true);

drop policy if exists roles_admin_write on public.app_roles;
create policy roles_admin_write on public.app_roles
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists role_permissions_read on public.role_permissions;
create policy role_permissions_read on public.role_permissions for select using (public.is_admin());

drop policy if exists role_permissions_write on public.role_permissions;
create policy role_permissions_write on public.role_permissions
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists user_profiles_self on public.user_profiles;
create policy user_profiles_self on public.user_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists user_profiles_admin_read on public.user_profiles;
create policy user_profiles_admin_read on public.user_profiles for select using (public.is_admin());

drop policy if exists user_roles_self_read on public.user_roles;
create policy user_roles_self_read on public.user_roles for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists user_roles_admin_write on public.user_roles;
create policy user_roles_admin_write on public.user_roles
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists jobs_admin_all on public.jobs;
create policy jobs_admin_all on public.jobs
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists feature_flags_public_read on public.feature_flags;
create policy feature_flags_public_read on public.feature_flags for select using (true);

drop policy if exists feature_flags_admin_write on public.feature_flags;
create policy feature_flags_admin_write on public.feature_flags
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists excluded_rules_public_read on public.excluded_rules;
create policy excluded_rules_public_read on public.excluded_rules
  for select using (enabled = true or public.is_admin());

drop policy if exists excluded_rules_admin_write on public.excluded_rules;
create policy excluded_rules_admin_write on public.excluded_rules
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists availability_checks_admin_all on public.availability_checks;
create policy availability_checks_admin_all on public.availability_checks
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists availability_cache_public_read on public.availability_cache;
create policy availability_cache_public_read on public.availability_cache for select using (true);

drop policy if exists ai_drafts_admin_all on public.ai_drafts;
create policy ai_drafts_admin_all on public.ai_drafts
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists api_keys_admin_all on public.api_keys;
create policy api_keys_admin_all on public.api_keys
  for all using (public.is_admin()) with check (public.is_admin());

-- No policy at all = no access, for anon and authenticated alike (defence in depth).

-- ---------------------------------------------------------------------------
-- Privileges. Supabase already grants anon/authenticated access to public tables via its
-- default privileges; this block keeps the same behaviour for a plain PostgreSQL instance
-- (including the PGlite test harness). RLS still restricts which rows are visible.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant usage on schema public to anon, authenticated';
    execute 'grant select, insert, update, delete on all tables in schema public to anon, authenticated';
    execute 'grant usage, select on all sequences in schema public to anon, authenticated';
  end if;
end;
$$;
