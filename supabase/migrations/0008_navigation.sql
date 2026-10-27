-- 0008_navigation.sql — make `nav_menus`/`nav_items` renderable and re-runnable.
--
-- The header and footer now read their links from these tables at build time. Three things
-- were missing for that to be safe:
--
--   * `position` on menus — without it, column order depends on physical row order, so two
--     identical databases could export different HTML;
--   * `enabled` on menus — hide a whole column without deleting its items;
--   * a natural key on items — `nav_items` previously had none, so re-running the seed
--     (which claims to be idempotent) duplicated every link. `(menu_id, href)` is that key:
--     the same destination twice in one menu is a mistake, never a feature.

alter table public.nav_menus
  add column if not exists position int not null default 100;

alter table public.nav_menus
  add column if not exists enabled boolean not null default true;

create index if not exists nav_items_menu_position_idx
  on public.nav_items(menu_id, position);

-- Collapse any duplicates left by an earlier, non-idempotent seed before adding the key.
delete from public.nav_items a
using public.nav_items b
where a.menu_id = b.menu_id
  and a.href = b.href
  and a.created_at > b.created_at;

create unique index if not exists nav_items_menu_href_idx
  on public.nav_items(menu_id, href);
