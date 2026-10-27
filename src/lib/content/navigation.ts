/**
 * Navigation resolution.
 *
 * The header and footer used to render straight from `PRIMARY_NAV`/`FOOTER_NAV` in
 * `src/lib/config/site.ts`, while `nav_menus`/`nav_items` sat in the database doing nothing.
 * That is the worst of both worlds: a table that looks editable but is not, and copy that
 * requires a code change to fix a typo.
 *
 * This module turns database rows into the two shapes the components already understand, and
 * decides when to ignore them. The rules matter more than the mapping:
 *
 *  - an **empty** table is not an instruction to delete the menu. Falls back to the code
 *    defaults, because a half-seeded database should not produce a site with no navigation;
 *  - a **partially** usable set is still used, but only if at least one menu has at least one
 *    enabled item;
 *  - ordering is explicit (`position`, then `id`) so two identical databases produce identical
 *    HTML — a static export that changes on every build is a diff nobody can review;
 *  - external and mailto links are allowed, because a footer usually needs one, but they are
 *    passed through untouched rather than normalised into paths.
 */

import { FOOTER_NAV, PRIMARY_NAV, type NavItem } from "@/lib/config/site";

export type NavMenuRow = {
  id: string;
  name: string;
  location?: string | null;
  position?: number | null;
  enabled?: boolean | null;
};

export type NavItemRow = {
  id?: string;
  menu_id: string;
  label: string;
  href: string;
  description?: string | null;
  position?: number | null;
  enabled?: boolean | null;
  parent_id?: string | null;
};

export type FooterColumn = { heading: string; items: NavItem[] };

export type Navigation = { primary: NavItem[]; footer: FooterColumn[] };

export type NavigationResult = Navigation & {
  /** Where the rendered navigation came from. Surfaced so a build can report it. */
  source: "database" | "defaults";
  /** Why the database was not used, when it was not. */
  reason: string | null;
};

function isExternal(href: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(href.trim());
}

function usableHref(href: string): boolean {
  const value = href.trim();
  if (value.length === 0) return false;
  if (isExternal(value)) return true;
  return value.startsWith("/") || value.startsWith("#");
}

function toItem(row: NavItemRow): NavItem {
  return {
    label: row.label.trim(),
    href: row.href.trim(),
    ...(row.description && row.description.trim().length > 0
      ? { description: row.description.trim() }
      : {}),
  } as NavItem;
}

function sortKey<T extends { position?: number | null; id?: string }>(row: T, index: number): string {
  const position = typeof row.position === "number" ? row.position : 100;
  return `${String(position).padStart(5, "0")}:${row.id ?? String(index).padStart(5, "0")}`;
}

/**
 * Maps database rows onto the navigation the site renders.
 *
 * @param menus rows from `nav_menus`
 * @param items rows from `nav_items`
 */
export function buildNavigation(
  menus: NavMenuRow[],
  items: NavItemRow[],
): NavigationResult {
  const activeMenus = menus
    .filter((menu) => menu.enabled !== false)
    .slice()
    .sort((a, b) => sortKey(a, menus.indexOf(a)).localeCompare(sortKey(b, menus.indexOf(b))));

  const itemsFor = (menuId: string): NavItem[] =>
    items
      .filter((item) => item.menu_id === menuId && item.enabled !== false && !item.parent_id)
      .map((item, index) => ({ item, index }))
      .sort((a, b) => sortKey(a.item, a.index).localeCompare(sortKey(b.item, b.index)))
      .map(({ item }) => item)
      .filter((item) => item.label.trim().length > 0 && usableHref(item.href))
      .map(toItem);

  const primaryMenu =
    activeMenus.find((menu) => (menu.location ?? "") === "primary") ??
    activeMenus.find((menu) => menu.id === "primary");

  const primary = primaryMenu ? itemsFor(primaryMenu.id) : [];

  const footer = activeMenus
    .filter((menu) => menu.location === "footer")
    .map((menu) => ({ heading: menu.name.trim(), items: itemsFor(menu.id) }))
    .filter((column) => column.heading.length > 0 && column.items.length > 0);

  if (primary.length === 0 && footer.length === 0) {
    return {
      primary: PRIMARY_NAV,
      footer: FOOTER_NAV.map((column) => ({ heading: column.heading, items: column.items })),
      source: "defaults",
      reason:
        menus.length === 0
          ? "nav_menus is empty"
          : "no enabled menu item with a usable href and label",
    };
  }

  return {
    primary: primary.length > 0 ? primary : PRIMARY_NAV,
    footer: footer.length > 0 ? footer : FOOTER_NAV.map((column) => ({ heading: column.heading, items: column.items })),
    source: "database",
    reason: null,
  };
}
