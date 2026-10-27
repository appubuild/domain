/**
 * Monetization readiness — what would actually happen on the next page load, and why not.
 *
 * The admin already has forms for ad settings, ad placements, affiliate providers and
 * per-extension rules. What it did not have was an answer to the only question an operator
 * asks: *"is any of this working?"* Advertising has seven hard gates and registrar routing has
 * three, so "configured" and "live" are different states, and a form that saves successfully
 * says nothing about either.
 *
 * Everything here is a pure function over data already loaded by the public runtime
 * (`AdConfig`, `AffiliateConfig`), so the panel cannot drift from the site: it calls the same
 * `resolveAdRender` the `<AdSlot>` component calls. There are no estimates, no scores and no
 * "health percentage" — a placement either would render for a consenting visitor or it
 * reports the first gate that stops it.
 */

import { resolveAdRender, type AdBlockReason, type AdConfig, type AdSettings, type AdSlotConfig } from "@/lib/ads/config";
import type { AffiliateConfig } from "@/lib/affiliate/links";

/**
 * Placements that exist in the page markup.
 *
 * Kept as data so a test can assert that every entry is genuinely wired, and so the panel can
 * spot both directions of drift: a slot in the database with no page to render it, and a page
 * waiting for a slot nobody created.
 */
export type WiredPlacement = {
  template: AdSlotConfig["template"];
  placement: AdSlotConfig["placement"];
  /** Where it renders. `null` means no page uses this template yet. */
  page: string | null;
};

export const WIRED_PLACEMENTS: WiredPlacement[] = [
  { template: "home", placement: "after-intro", page: "/" },
  { template: "generator", placement: "sidebar", page: "/generator/" },
  { template: "industry", placement: "after-intro", page: "/industries/[slug]/" },
  { template: "blog-index", placement: "mid-content", page: "/blog/" },
  { template: "blog-post", placement: "after-intro", page: "/blog/[slug]/" },
  { template: "blog-post", placement: "mid-content", page: "/blog/[slug]/" },
  { template: "blog-post", placement: "end-of-content", page: "/blog/[slug]/" },
  { template: "page", placement: "end-of-content", page: "/[slug]/" },
  // The schema and the admin form allow a per-extension template, but no page of that shape
  // is built yet. Listed as unwired rather than quietly deleted: an operator who creates a
  // `tld` slot deserves to be told it will never render.
  { template: "tld", placement: "after-intro", page: null },
];

const PLACEMENT_LABEL: Record<AdSlotConfig["placement"], string> = {
  "after-intro": "after the intro",
  "mid-content": "mid-content",
  "before-faq": "before the FAQ",
  "end-of-content": "at the end",
  sidebar: "in the sidebar",
};

export const BLOCK_REASON_TEXT: Record<AdBlockReason, string> = {
  "flag-off": "The advertising feature flag is off, so nothing renders whatever the settings say.",
  "provider-none": "No provider is selected — the provider must be AdSense.",
  "globally-disabled": "“Serve ads site-wide” is off in the ad settings.",
  "script-disabled": "“Load provider script” is off, so AdSense would never be loaded.",
  "invalid-publisher-id": "The publisher ID is missing or not in ca-pub-<digits> form.",
  "no-slot-for-template": "No placement row exists for this template and position.",
  "slot-disabled": "This placement is not enabled.",
  "invalid-unit-id": "The placement has no valid numeric ad unit ID.",
  "consent-missing": "The visitor has not granted consent (evaluated as granted here).",
};

export type SlotStatus = {
  slot: AdSlotConfig;
  /** Page that renders it, or `null` when no page uses this template/position pair. */
  page: string | null;
  /** True when every gate passes for a visitor who has granted consent. */
  wouldRender: boolean;
  reason: AdBlockReason | null;
  /**
   * Slot key that wins the same template/position pair, when this row can never be used.
   * Two rows for one position are legal in the database and only the lowest `display_order`
   * ever renders — a row that looks configured but is dead is exactly what this panel is for.
   */
  shadowedBy: string | null;
};

export type AdReadiness = {
  flagOn: boolean;
  settings: AdSettings;
  slots: SlotStatus[];
  wouldRender: number;
  /** Distinct blockers across all slots, in the order the gates are evaluated. */
  blockers: AdBlockReason[];
  summary: string;
};

function pageFor(template: AdSlotConfig["template"], placement: AdSlotConfig["placement"]): string | null {
  const match = WIRED_PLACEMENTS.find((entry) => entry.template === template && entry.placement === placement);
  return match ? match.page : null;
}

/**
 * Evaluates every placement row for a visitor who has granted consent.
 *
 * Consent is assumed deliberately: the panel answers "is my configuration correct?", and a
 * visitor's local choice is not part of that. The prompt itself is covered by the ad settings
 * row, which is displayed alongside.
 */
export function adReadiness(config: AdConfig): AdReadiness {
  // The slot that wins each template/position pair — same rule the renderer uses.
  const winnerFor = new Map<string, string>();
  for (const slot of config.slots) {
    const key = `${slot.template}:${slot.placement}`;
    const current = winnerFor.get(key);
    if (current === undefined) {
      winnerFor.set(key, slot.slotKey);
      continue;
    }
    const currentSlot = config.slots.find((entry) => entry.slotKey === current);
    if (currentSlot && slot.displayOrder < currentSlot.displayOrder) winnerFor.set(key, slot.slotKey);
  }

  const slots: SlotStatus[] = config.slots.map((slot) => {
    const decision = resolveAdRender(config, {
      template: slot.template,
      placement: slot.placement,
      consentGranted: true,
    });
    const page = pageFor(slot.template, slot.placement);
    const winner = winnerFor.get(`${slot.template}:${slot.placement}`) ?? null;
    const shadowedBy = winner && winner !== slot.slotKey ? winner : null;
    // A valid slot on a template no page renders is not "working", however green the rest is.
    const wouldRender = decision.render && page !== null && shadowedBy === null;
    return {
      slot,
      page,
      wouldRender,
      reason: decision.render ? (page === null ? "no-slot-for-template" : null) : decision.reason,
      shadowedBy,
    };
  });

  const wouldRender = slots.filter((entry) => entry.wouldRender).length;
  const order: AdBlockReason[] = [
    "flag-off",
    "provider-none",
    "globally-disabled",
    "script-disabled",
    "invalid-publisher-id",
    "no-slot-for-template",
    "slot-disabled",
    "invalid-unit-id",
    "consent-missing",
  ];
  const blockers = [
    ...new Set(
      slots
        .filter((entry) => entry.reason && entry.shadowedBy === null)
        .map((entry) => entry.reason as AdBlockReason),
    ),
  ].sort(
    (left, right) => order.indexOf(left) - order.indexOf(right),
  );

  let summary: string;
  if (config.slots.length === 0) {
    summary = "No advertising placements exist, so no page has an ad container to fill.";
  } else if (wouldRender > 0) {
    summary =
      `${wouldRender} of ${config.slots.length} placement${config.slots.length === 1 ? "" : "s"} would render` +
      (config.settings.testMode ? " — in test mode, so impressions are not billable." : ".");
  } else {
    const first = blockers[0];
    summary = first
      ? `No placement would render. The first gate to fix: ${BLOCK_REASON_TEXT[first].replace(/\.$/, "")}.`
      : "No placement would render.";
  }

  return { flagOn: config.flagEnabled, settings: config.settings, slots, wouldRender, blockers, summary };
}

export type PlacementGap = {
  template: AdSlotConfig["template"];
  placement: AdSlotConfig["placement"];
  page: string;
};

/**
 * Pages that are wired but have no placement row. The reverse of a `SlotStatus` with a null
 * page — worth surfacing because an empty slot key is an omission, not a decision.
 */
export function unwiredPlacements(config: AdConfig): PlacementGap[] {
  return WIRED_PLACEMENTS.filter(
    (entry) =>
      entry.page !== null &&
      !config.slots.some((slot) => slot.template === entry.template && slot.placement === entry.placement),
  ).map((entry) => ({ template: entry.template, placement: entry.placement, page: entry.page as string }));
}

export type AffiliateCounts = {
  /** Clicks recorded in the last 30 days, or `null` when the count could not be read. */
  clicksLast30Days: number | null;
};

export type AffiliateReadiness = {
  flagOn: boolean;
  providers: number;
  enabledProviders: number;
  rules: number;
  clicksLast30Days: number | null;
  summary: string;
};

/**
 * Registrar routing state.
 *
 * `clicksLast30Days` is nullable on purpose: "we could not read the counter" and "nobody
 * clicked" are different facts, and the panel prints them differently.
 */
export function affiliateReadiness(config: AffiliateConfig, counts: AffiliateCounts): AffiliateReadiness {
  const providers = config.providers.length;
  const enabledProviders = config.providers.filter((provider) => provider.enabled).length;
  const rules = config.rules.length;
  const clicks = counts.clicksLast30Days;

  let summary: string;
  if (!config.enabled) {
    summary =
      "The affiliate_routing flag is off, so no registrar link is rendered — even for an enabled provider.";
  } else if (providers === 0) {
    summary = "The flag is on but no affiliate provider exists, so the generator shows its honest empty state instead of a link.";
  } else if (enabledProviders === 0) {
    summary = `${providers} provider${providers === 1 ? " exists" : "s exist"} but none is enabled.`;
  } else if (rules === 0) {
    summary = `${enabledProviders} provider${enabledProviders === 1 ? " is" : "s are"} enabled with no per-extension rule; their supported-TLD lists decide routing.`;
  } else {
    summary = `${enabledProviders} enabled provider${enabledProviders === 1 ? "" : "s"}, ${rules} extension rule${rules === 1 ? "" : "s"}.`;
  }

  if (clicks === null) {
    summary += " Click counts could not be read (not configured, or no admin session).";
  } else if (clicks === 0) {
    summary += " No clicks recorded in the last 30 days.";
  } else {
    summary += ` ${clicks} click${clicks === 1 ? "" : "s"} recorded in the last 30 days.`;
  }

  return { flagOn: config.enabled, providers, enabledProviders, rules, clicksLast30Days: clicks, summary };
}

/** Human label for a placement row, e.g. `home · after the intro`. */
export function describeSlot(slot: AdSlotConfig): string {
  return `${slot.template} · ${PLACEMENT_LABEL[slot.placement]}`;
}

/**
 * Whether a change in this panel is expected to appear immediately.
 *
 * Ads and registrar links are read by the browser at run time, so they do not need a rebuild.
 * (Content does — that is a separate, documented rule.) Saying so once, in a function, stops
 * the panel from repeating a claim it has not checked.
 */
export const MONETIZATION_NEEDS_REBUILD = false;
