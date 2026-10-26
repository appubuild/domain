import { PUBLIC_ENV } from "./env";

/**
 * Branding defaults.
 *
 * Everything here is a *fallback*. Once the CMS/settings module is live, the values
 * come from the `site_settings` table (admin → Appearance) and are merged over these
 * defaults, so the brand name, tagline, logo and colours are configurable without a
 * code change. `BRAND_DEFAULTS` must never be treated as the source of truth at
 * runtime — always read through `SiteBrand` provided by the settings loader.
 */

export type SiteBrand = {
  name: string;
  shortName: string;
  tagline: string;
  description: string;
  /** Text logo mark; the admin can replace this with an uploaded logo later. */
  logoMark: string;
  contactEmail: string;
  url: string;
};

export const BRAND_DEFAULTS: SiteBrand = {
  name: PUBLIC_ENV.siteName,
  shortName: PUBLIC_ENV.siteName,
  tagline: "Name intelligence, not name roulette.",
  description:
    "Generate brandable domain candidates with real naming logic, understand why each one scores the way it does, and check availability honestly.",
  logoMark: "DF",
  contactEmail: "hello@example.com",
  url: PUBLIC_ENV.appUrl,
};

export type NavItem = {
  label: string;
  href: string;
  description?: string;
  /** Shown in the mobile menu, hidden from the compact desktop bar. */
  secondary?: boolean;
};

export const PRIMARY_NAV: NavItem[] = [
  { label: "Generator", href: "/generator", description: "Build and filter candidate names" },
  { label: "Industries", href: "/industries", description: "Naming dictionaries by niche" },
  { label: "Extensions", href: "/extensions", description: "TLDs and what we can verify" },
  { label: "Blog", href: "/blog", description: "Naming research and guides" },
  { label: "How it works", href: "/how-it-works", description: "The engine, explained" },
];

export const FOOTER_NAV: Array<{ heading: string; items: NavItem[] }> = [
  {
    heading: "Product",
    items: [
      { label: "Domain generator", href: "/generator" },
      { label: "Brandable mode", href: "/generator?mode=brandable" },
      { label: "Industry directory", href: "/industries" },
      { label: "Extension directory", href: "/extensions" },
    ],
  },
  {
    heading: "Resources",
    items: [
      { label: "How it works", href: "/how-it-works" },
      { label: "Naming scores", href: "/how-it-works#scoring" },
      { label: "Availability checks", href: "/how-it-works#availability" },
      { label: "Blog", href: "/blog" },
    ],
  },
  {
    heading: "Company",
    items: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
      { label: "FAQ", href: "/faq" },
    ],
  },
  {
    heading: "Legal",
    items: [
      { label: "Privacy policy", href: "/privacy" },
      { label: "Terms of service", href: "/terms" },
      { label: "Affiliate disclosure", href: "/affiliate-disclosure" },
      { label: "Cookie preferences", href: "/cookies" },
    ],
  },
];
