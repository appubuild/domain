"use client";

import {
  Activity,
  BadgeDollarSign,
  BookMarked,
  BookOpen,
  Brush,
  ChartNoAxesColumn,
  CircleDollarSign,
  Compass,
  FileText,
  Flag,
  Gauge,
  Globe2,
  Handshake,
  ImageIcon,
  LayoutDashboard,
  LibraryBig,
  ListTree,
  Megaphone,
  Menu as MenuIcon,
  PanelTop,
  Radar,
  ReceiptText,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  TagIcon,
  Tags,
  UserCog,
  Waypoints,
  Webhook,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * One icon per admin route.
 *
 * Kept out of `src/lib/admin/resources.ts` on purpose: that module is imported by tests and by
 * server code, and it should stay plain data. Matching on the `href` means the navigation and
 * the icon table cannot drift apart silently — `tests/admin/nav-icons.test.ts` fails when a
 * route has no icon, so adding a screen to `ADMIN_NAV` is not finished until it is given one.
 *
 * `null` is a real answer for the two "example" entries a few resources use; every other route
 * must resolve, and every icon must come from the same library at the same size (see
 * `NavIcon`), which is what keeps the sidebar from looking assembled out of parts.
 */
const ICONS: Record<string, LucideIcon> = {
  "/admin/": LayoutDashboard,
  "/admin/analytics/": ChartNoAxesColumn,
  "/admin/audit/": ScrollText,

  "/admin/dictionary-terms/": BookMarked,
  "/admin/word-libraries/": LibraryBig,
  "/admin/phrase-templates/": ListTree,
  "/admin/industries/": Compass,

  "/admin/scoring-profiles/": Gauge,
  "/admin/brandable-profiles/": Brush,
  "/admin/excluded-rules/": ShieldCheck,

  "/admin/tlds/": Globe2,
  "/admin/availability-providers/": Radar,

  "/admin/monetization/": CircleDollarSign,
  "/admin/affiliates/": Handshake,
  "/admin/affiliate-rules/": Waypoints,
  "/admin/ad-slots/": Megaphone,
  "/admin/ad-settings/": BadgeDollarSign,

  "/admin/pages/": FileText,
  "/admin/media/": ImageIcon,
  "/admin/posts/": BookOpen,
  "/admin/post-categories/": Tags,
  "/admin/post-tags/": TagIcon,
  "/admin/studio/": Webhook,
  "/admin/redirects/": Activity,

  "/admin/nav-items/": PanelTop,
  "/admin/nav-menus/": MenuIcon,

  "/admin/seo/": Search,
  "/admin/seo-templates/": ReceiptText,

  "/admin/users/": UserCog,

  "/admin/settings/": Settings,
  "/admin/feature-flags/": Flag,

  // Reached from the sidebar's group headings rather than an item; exported for completeness.
};

export function iconForHref(href: string): LucideIcon {
  return ICONS[href] ?? FileText;
}

export function hasIcon(href: string): boolean {
  return href in ICONS;
}

export const NAV_ICON_SIZE = "size-4";

/** Consistent icon rendering: one size, one stroke width, decorative by default. */
export function NavIcon({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return <Icon className={className ?? NAV_ICON_SIZE} strokeWidth={1.75} aria-hidden="true" />;
}

export const NAV_ICON_ROUTES = Object.keys(ICONS);
