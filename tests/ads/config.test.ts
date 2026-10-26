import { describe, expect, it } from "vitest";
import {
  DISABLED_ADS,
  adSlotView,
  parseAdSettings,
  parseAdSlotRow,
  resolveAdRender,
  type AdConfig,
  type AdSlotConfig,
} from "@/lib/ads/config";

/**
 * Ad gating.
 *
 * Advertising is the feature most likely to degrade into fake functionality ("advertisement"
 * caption over nothing, or a script loaded before consent). These tests treat every gate as
 * mandatory and assert that a refusal renders *nothing*.
 */

function slot(overrides: Partial<AdSlotConfig> = {}): AdSlotConfig {
  return {
    slotKey: "blog-post-mid",
    template: "blog-post",
    placement: "mid-content",
    adUnitId: "1234567890",
    format: "auto",
    enabled: true,
    label: "Advertisement",
    displayOrder: 10,
    ...overrides,
  };
}

function config(overrides: Partial<AdConfig> = {}): AdConfig {
  return {
    settings: {
      provider: "adsense",
      publisherId: "ca-pub-1234567890123456",
      scriptEnabled: true,
      globalEnabled: true,
      testMode: false,
      consentRequired: false,
    },
    slots: [slot()],
    ...overrides,
  };
}

const target = { template: "blog-post" as const, placement: "mid-content" as const };

describe("resolveAdRender", () => {
  it("renders when every gate is satisfied", () => {
    const decision = resolveAdRender(config(), target);
    expect(decision.render).toBe(true);
    if (!decision.render) return;
    expect(decision.publisherId).toBe("ca-pub-1234567890123456");
    expect(decision.unitId).toBe("1234567890");
    expect(decision.label).toBe("Advertisement");
  });

  it("refuses when advertising is disabled by default", () => {
    expect(resolveAdRender(DISABLED_ADS, target)).toEqual({ render: false, reason: "provider-none" });
  });

  it.each([
    ["global switch off", { settings: { ...config().settings, globalEnabled: false } }, "globally-disabled"],
    ["script disabled", { settings: { ...config().settings, scriptEnabled: false } }, "script-disabled"],
    ["provider none", { settings: { ...config().settings, provider: "none" as const } }, "provider-none"],
    [
      "malformed publisher id",
      { settings: { ...config().settings, publisherId: "pub-123" } },
      "invalid-publisher-id",
    ],
    ["missing publisher id", { settings: { ...config().settings, publisherId: null } }, "invalid-publisher-id"],
    ["no matching slot", { slots: [slot({ template: "page" })] }, "no-slot-for-template"],
    ["slot disabled", { slots: [slot({ enabled: false })] }, "slot-disabled"],
    ["missing unit id", { slots: [slot({ adUnitId: null })] }, "invalid-unit-id"],
    ["non-numeric unit id", { slots: [slot({ adUnitId: "abc123" })] }, "invalid-unit-id"],
  ])("refuses when %s", (_label, overrides, reason) => {
    const decision = resolveAdRender(config(overrides as Partial<AdConfig>), target);
    expect(decision).toEqual({ render: false, reason });
  });

  it("requires explicit consent when the setting is on", () => {
    const consenting = config({
      settings: { ...config().settings, consentRequired: true },
    });

    expect(resolveAdRender(consenting, target)).toEqual({ render: false, reason: "consent-missing" });
    expect(resolveAdRender(consenting, { ...target, consentGranted: false })).toEqual({
      render: false,
      reason: "consent-missing",
    });
    expect(resolveAdRender(consenting, { ...target, consentGranted: true }).render).toBe(true);
  });

  it("picks the lowest display order when several slots match", () => {
    const decision = resolveAdRender(
      config({
        slots: [
          slot({ adUnitId: "999999999", displayOrder: 50 }),
          slot({ adUnitId: "111111111", displayOrder: 5 }),
        ],
      }),
      target,
    );
    expect(decision.render).toBe(true);
    if (decision.render) expect(decision.unitId).toBe("111111111");
  });

  it("surfaces test mode so placements are not billed", () => {
    const decision = resolveAdRender(config({ settings: { ...config().settings, testMode: true } }), target);
    expect(decision.render).toBe(true);
    if (decision.render) expect(decision.testMode).toBe(true);
  });

  it("matches on template and placement together, never template alone", () => {
    const decision = resolveAdRender(config(), { template: "blog-post", placement: "sidebar" });
    expect(decision).toEqual({ render: false, reason: "no-slot-for-template" });
  });
});

describe("parsing database rows", () => {
  it("defaults to disabled settings when no row exists", () => {
    expect(parseAdSettings(undefined)).toEqual(DISABLED_ADS.settings);
  });

  it("treats missing booleans conservatively", () => {
    const settings = parseAdSettings({ provider: "adsense", publisher_id: "ca-pub-1234567890123456" });
    expect(settings.globalEnabled).toBe(false);
    expect(settings.scriptEnabled).toBe(false);
    expect(settings.consentRequired).toBe(true);
    expect(settings.testMode).toBe(true);
  });

  it("rejects slots with unknown templates or placements", () => {
    expect(parseAdSlotRow({ slot_key: "x", template: "popup", placement: "mid-content" })).toBeNull();
    expect(parseAdSlotRow({ slot_key: "x", template: "page", placement: "floating" })).toBeNull();
    expect(parseAdSlotRow({ template: "page", placement: "sidebar" })).toBeNull();
  });

  it("parses a valid slot row", () => {
    const parsed = parseAdSlotRow({
      slot_key: "page-end",
      template: "page",
      placement: "end-of-content",
      ad_unit_id: "1234567890",
      format: "horizontal",
      enabled: true,
      label: "Advertisement",
      display_order: 70,
    });

    expect(parsed).toEqual({
      slotKey: "page-end",
      template: "page",
      placement: "end-of-content",
      adUnitId: "1234567890",
      format: "horizontal",
      enabled: true,
      label: "Advertisement",
      displayOrder: 70,
    });
  });
});

describe("adSlotView", () => {
  const consenting = config({ settings: { ...config().settings, consentRequired: true } });

  it("shows a prompt when the slot would render but consent is undecided", () => {
    const view = adSlotView(consenting, { ...target, consent: null });
    expect(view.kind).toBe("prompt");
    if (view.kind === "prompt") expect(view.slot.slotKey).toBe("blog-post-mid");
  });

  it("renders the ad once consent is granted", () => {
    const view = adSlotView(consenting, { ...target, consent: true });
    expect(view.kind).toBe("ad");
  });

  it("renders nothing when consent was refused", () => {
    expect(adSlotView(consenting, { ...target, consent: false })).toEqual({
      kind: "none",
      reason: "consent-missing",
    });
  });

  it("does not prompt when consent is not required", () => {
    const view = adSlotView(config(), { ...target, consent: null });
    expect(view.kind).toBe("ad");
  });

  it("never prompts for a slot that is disabled, unconfigured or invalid", () => {
    const disabledSlot = config({
      slots: [slot({ enabled: false })],
      settings: { ...config().settings, consentRequired: true },
    });
    expect(adSlotView(disabledSlot, { ...target, consent: null })).toEqual({ kind: "none", reason: "slot-disabled" });

    const globallyOff = config({
      settings: { ...config().settings, globalEnabled: false, consentRequired: true },
    });
    expect(adSlotView(globallyOff, { ...target, consent: null })).toEqual({
      kind: "none",
      reason: "globally-disabled",
    });

    expect(adSlotView(DISABLED_ADS, { ...target, consent: null })).toEqual({
      kind: "none",
      reason: "provider-none",
    });
  });
});
