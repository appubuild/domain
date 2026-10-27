import { describe, expect, it } from "vitest";
import {
  BLOCK_REASON_TEXT,
  WIRED_PLACEMENTS,
  adReadiness,
  affiliateReadiness,
  describeSlot,
  unwiredPlacements,
} from "@/lib/monetization/status";
import { DISABLED_ADS, type AdConfig, type AdSlotConfig } from "@/lib/ads/config";
import type { AffiliateConfig, AffiliateProvider, AffiliateRule } from "@/lib/affiliate/links";

/**
 * Monetization readiness.
 *
 * This module exists because "the form saved" and "the feature is live" are different facts.
 * The tests therefore assert the *first blocking gate*, the count of placements that would
 * really render, and that an unreadable counter is never reported as zero.
 */

function slot(overrides: Partial<AdSlotConfig> = {}): AdSlotConfig {
  return {
    slotKey: "home-after-intro",
    template: "home",
    placement: "after-intro",
    adUnitId: "1234567890",
    format: "auto",
    enabled: true,
    label: "Advertisement",
    displayOrder: 10,
    ...overrides,
  };
}

function readyConfig(overrides: Partial<AdConfig> = {}): AdConfig {
  return {
    flagEnabled: true,
    settings: {
      provider: "adsense",
      publisherId: "ca-pub-1234567890123456",
      scriptEnabled: true,
      globalEnabled: true,
      testMode: false,
      consentRequired: true,
    },
    slots: [slot()],
    ...overrides,
  };
}

function provider(overrides: Partial<AffiliateProvider> = {}): AffiliateProvider {
  return {
    id: "p1",
    name: "Example Registrar",
    slug: "example",
    enabled: true,
    priority: 10,
    urlTemplate: "https://registrar.example/search?domain={domain}",
    allowedHosts: ["registrar.example"],
    supportedTlds: ["com"],
    disclosure: "We may earn a commission.",
    isFallback: false,
    ...overrides,
  };
}

const rule: AffiliateRule = { tld: "com", providerId: "p1", enabled: true };

describe("adReadiness", () => {
  it("reports the feature flag as the first gate when advertising is off", () => {
    const readiness = adReadiness(readyConfig({ flagEnabled: false }));
    expect(readiness.flagOn).toBe(false);
    expect(readiness.wouldRender).toBe(0);
    expect(readiness.blockers).toEqual(["flag-off"]);
    expect(readiness.summary).toContain("feature flag");
  });

  it("reports an empty configuration as having no placements, not as blocked", () => {
    const readiness = adReadiness(DISABLED_ADS);
    expect(readiness.slots).toEqual([]);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.summary).toContain("No advertising placements exist");
  });

  it("counts a fully configured, wired placement as rendering", () => {
    const readiness = adReadiness(readyConfig());
    expect(readiness.wouldRender).toBe(1);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.slots[0]?.reason).toBeNull();
    expect(readiness.slots[0]?.page).toBe("/");
    expect(readiness.summary).toContain("1 of 1 placement would render");
  });

  it("names test mode in the summary rather than hiding it", () => {
    const readiness = adReadiness(readyConfig({ settings: { ...readyConfig().settings, testMode: true } }));
    expect(readiness.summary).toContain("test mode");
  });

  it("does not count a valid slot that no page renders", () => {
    const readiness = adReadiness(readyConfig({ slots: [slot({ template: "tld", slotKey: "tld-top" })] }));
    expect(readiness.wouldRender).toBe(0);
    expect(readiness.slots[0]?.page).toBeNull();
    expect(readiness.slots[0]?.reason).toBe("no-slot-for-template");
  });

  it.each([
    ["disabled slot", { enabled: false }, "slot-disabled"],
    ["missing unit id", { adUnitId: null }, "invalid-unit-id"],
    ["malformed unit id", { adUnitId: "abc" }, "invalid-unit-id"],
  ])("reports %s as its own reason", (_label, overrides, reason) => {
    const readiness = adReadiness(readyConfig({ slots: [slot(overrides as Partial<AdSlotConfig>)] }));
    expect(readiness.slots[0]?.reason).toBe(reason);
    expect(readiness.wouldRender).toBe(0);
  });

  it("orders blockers by the gate that actually runs first", () => {
    const readiness = adReadiness(
      readyConfig({
        slots: [
          slot({ enabled: false }),
          slot({ slotKey: "page-end", template: "page", placement: "end-of-content", adUnitId: "abc" }),
        ],
      }),
    );
    expect(readiness.blockers).toEqual(["slot-disabled", "invalid-unit-id"]);
    expect(readiness.summary).toContain("first gate to fix");
  });

  it("lets a global gate mask the per-slot reasons it makes irrelevant", () => {
    const readiness = adReadiness(
      readyConfig({
        flagEnabled: false,
        settings: { ...readyConfig().settings, globalEnabled: false },
        slots: [slot({ enabled: false })],
      }),
    );
    expect(readiness.blockers).toEqual(["flag-off"]);
    expect(readiness.blockers).not.toContain("slot-disabled");
  });

  it("marks a second row for the same position as shadowed instead of live", () => {
    const readiness = adReadiness(
      readyConfig({
        slots: [slot(), slot({ slotKey: "home-duplicate", displayOrder: 50 })],
      }),
    );
    const duplicate = readiness.slots.find((entry) => entry.slot.slotKey === "home-duplicate");
    expect(duplicate?.shadowedBy).toBe("home-after-intro");
    expect(duplicate?.wouldRender).toBe(false);
    // The winner still renders, so the duplicate does not count as a blocker.
    expect(readiness.wouldRender).toBe(1);
    expect(readiness.blockers).toEqual([]);
  });

  it("says so when no placement exists at all", () => {
    const readiness = adReadiness(readyConfig({ slots: [] }));
    expect(readiness.wouldRender).toBe(0);
    expect(readiness.summary).toContain("No advertising placements exist");
  });

  it("has a plain-language explanation for every reason it can report", () => {
    for (const text of Object.values(BLOCK_REASON_TEXT)) {
      expect(text.length).toBeGreaterThan(10);
    }
  });
});

describe("unwiredPlacements", () => {
  it("lists every page position that has no placement row", () => {
    const gaps = unwiredPlacements(readyConfig({ slots: [] }));
    expect(gaps).toHaveLength(WIRED_PLACEMENTS.filter((entry) => entry.page !== null).length);
    expect(gaps.every((gap) => typeof gap.page === "string")).toBe(true);
  });

  it("drops a position once a matching slot exists", () => {
    const gaps = unwiredPlacements(readyConfig({ slots: [slot()] }));
    expect(gaps.some((gap) => gap.template === "home" && gap.placement === "after-intro")).toBe(false);
  });
});

describe("describeSlot", () => {
  it("describes the template and position in words", () => {
    expect(describeSlot(slot())).toBe("home · after the intro");
    expect(describeSlot(slot({ template: "generator", placement: "sidebar" }))).toBe("generator · in the sidebar");
  });
});

describe("affiliateReadiness", () => {
  const emptyConfig: AffiliateConfig = { providers: [], rules: [], enabled: false };

  it("says the flag is the reason nothing renders", () => {
    const readiness = affiliateReadiness({ ...emptyConfig, providers: [provider()] }, { clicksLast30Days: 0 });
    expect(readiness.flagOn).toBe(false);
    expect(readiness.summary).toContain("affiliate_routing flag is off");
  });

  it("distinguishes no provider from a disabled provider", () => {
    const none = affiliateReadiness({ ...emptyConfig, enabled: true }, { clicksLast30Days: 0 });
    expect(none.summary).toContain("no affiliate provider exists");

    const configured = affiliateReadiness(
      { providers: [provider({ enabled: false })], rules: [], enabled: true },
      { clicksLast30Days: 0 },
    );
    expect(configured.summary).toContain("none is enabled");
    expect(configured.enabledProviders).toBe(0);
  });

  it("counts rules and enabled providers", () => {
    const readiness = affiliateReadiness(
      { providers: [provider(), provider({ id: "p2", slug: "second" })], rules: [rule], enabled: true },
      { clicksLast30Days: 7 },
    );
    expect(readiness.providers).toBe(2);
    expect(readiness.enabledProviders).toBe(2);
    expect(readiness.rules).toBe(1);
    expect(readiness.summary).toContain("2 enabled providers, 1 extension rule");
    expect(readiness.summary).toContain("7 clicks recorded");
  });

  it("never turns an unreadable counter into zero", () => {
    const readiness = affiliateReadiness({ ...emptyConfig, enabled: true }, { clicksLast30Days: null });
    expect(readiness.clicksLast30Days).toBeNull();
    expect(readiness.summary).toContain("could not be read");
    expect(readiness.summary).not.toContain("No clicks recorded");
  });

  it("states a real zero plainly", () => {
    const readiness = affiliateReadiness({ ...emptyConfig, enabled: true }, { clicksLast30Days: 0 });
    expect(readiness.summary).toContain("No clicks recorded in the last 30 days");
  });

  it("mentions supported-TLD routing when no explicit rule exists", () => {
    const readiness = affiliateReadiness(
      { providers: [provider()], rules: [], enabled: true },
      { clicksLast30Days: 0 },
    );
    expect(readiness.summary).toContain("supported-TLD lists");
  });
});
