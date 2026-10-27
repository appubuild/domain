/**
 * Advertising configuration.
 *
 * Design constraints that come from the product spec (and from AdSense policy):
 *
 *  - **No arbitrary JavaScript.** Operators configure a publisher ID and unit IDs; they
 *    cannot paste a script. The only provider supported is AdSense, and the only thing that
 *    loads is AdSense's own script, once, and only when everything below is satisfied.
 *  - **Off by default.** `ad_settings.global_enabled` starts false and every slot starts
 *    disabled. A fresh install renders no ads and no empty boxes.
 *  - **Consent before loading.** When `consent_required` is true (the default) the script is
 *    not loaded until the visitor opts in. There is no "implied consent".
 *  - **Test mode** keeps requests from being billed: slots render with `data-adtest` hints
 *    and the UI labels them as test placements.
 */

export type AdProvider = "adsense" | "none";

export type AdSettings = {
  provider: AdProvider;
  publisherId: string | null;
  scriptEnabled: boolean;
  globalEnabled: boolean;
  testMode: boolean;
  consentRequired: boolean;
};

export type AdSlotConfig = {
  slotKey: string;
  template: "home" | "generator" | "industry" | "blog-index" | "blog-post" | "page" | "tld";
  placement: "after-intro" | "mid-content" | "before-faq" | "end-of-content" | "sidebar";
  adUnitId: string | null;
  format: "auto" | "horizontal" | "rectangle" | "vertical";
  enabled: boolean;
  label: string;
  displayOrder: number;
};

export type AdConfig = {
  settings: AdSettings;
  slots: AdSlotConfig[];
  /**
   * `feature_flags.advertising`. A separate intent switch from `settings.globalEnabled`:
   * the flag says "we intend to show ads", the settings say "the configuration is valid".
   * Both must be on — turning ads off in an emergency should be one toggle, not five.
   */
  flagEnabled: boolean;
};

export const DISABLED_ADS: AdConfig = {
  flagEnabled: false,
  settings: {
    provider: "none",
    publisherId: null,
    scriptEnabled: false,
    globalEnabled: false,
    testMode: true,
    consentRequired: true,
  },
  slots: [],
};

/** AdSense publish IDs are `ca-pub-` followed by 10–20 digits; enforced in the database too. */
const PUBLISHER_PATTERN = /^ca-pub-[0-9]{10,20}$/;
/** Ad unit IDs are numeric, 6–25 digits. */
const UNIT_PATTERN = /^[0-9]{6,25}$/;

export type AdDecision =
  | { render: false; reason: AdBlockReason }
  | { render: true; slot: AdSlotConfig; publisherId: string; unitId: string; testMode: boolean; label: string };

export type AdBlockReason =
  | "flag-off"
  | "provider-none"
  | "globally-disabled"
  | "script-disabled"
  | "invalid-publisher-id"
  | "no-slot-for-template"
  | "slot-disabled"
  | "invalid-unit-id"
  | "consent-missing";

/**
 * Decides whether a slot may render.
 *
 * Everything is a hard gate: a missing publisher ID, a disabled slot or an unrecorded
 * consent all produce "render: false" with a reason. The component renders nothing at all in
 * that case — no placeholder, no reserved space, no "advertisement" caption over emptiness.
 */
export function resolveAdRender(
  config: AdConfig,
  input: { template: AdSlotConfig["template"]; placement: AdSlotConfig["placement"]; consentGranted?: boolean },
): AdDecision {
  const { settings } = config;
  if (!config.flagEnabled) return { render: false, reason: "flag-off" };
  if (settings.provider !== "adsense") return { render: false, reason: "provider-none" };
  if (!settings.globalEnabled) return { render: false, reason: "globally-disabled" };
  if (!settings.scriptEnabled) return { render: false, reason: "script-disabled" };
  if (!settings.publisherId || !PUBLISHER_PATTERN.test(settings.publisherId)) {
    return { render: false, reason: "invalid-publisher-id" };
  }
  if (settings.consentRequired && input.consentGranted !== true) {
    return { render: false, reason: "consent-missing" };
  }

  const slot = config.slots
    .filter((candidate) => candidate.template === input.template && candidate.placement === input.placement)
    .sort((left, right) => left.displayOrder - right.displayOrder)[0];

  if (!slot) return { render: false, reason: "no-slot-for-template" };
  if (!slot.enabled) return { render: false, reason: "slot-disabled" };
  if (!slot.adUnitId || !UNIT_PATTERN.test(slot.adUnitId)) return { render: false, reason: "invalid-unit-id" };

  return {
    render: true,
    slot,
    publisherId: settings.publisherId,
    unitId: slot.adUnitId,
    testMode: settings.testMode,
    label: slot.label || "Advertisement",
  };
}

export function parseAdSettings(row: Record<string, unknown> | undefined): AdSettings {
  if (!row) return DISABLED_ADS.settings;
  return {
    provider: row.provider === "adsense" ? "adsense" : "none",
    publisherId: typeof row.publisher_id === "string" ? row.publisher_id : null,
    scriptEnabled: row.script_enabled === true,
    globalEnabled: row.global_enabled === true,
    testMode: row.test_mode !== false,
    consentRequired: row.consent_required !== false,
  };
}

export function parseAdSlotRow(row: Record<string, unknown>): AdSlotConfig | null {
  const slotKey = typeof row.slot_key === "string" ? row.slot_key : null;
  const template = typeof row.template === "string" ? row.template : null;
  const placement = typeof row.placement === "string" ? row.placement : null;
  if (!slotKey || !template || !placement) return null;

  const templates = ["home", "generator", "industry", "blog-index", "blog-post", "page", "tld"] as const;
  const placements = ["after-intro", "mid-content", "before-faq", "end-of-content", "sidebar"] as const;
  if (!(templates as readonly string[]).includes(template)) return null;
  if (!(placements as readonly string[]).includes(placement)) return null;

  const formats = ["auto", "horizontal", "rectangle", "vertical"] as const;
  const format = typeof row.format === "string" && (formats as readonly string[]).includes(row.format) ? row.format : "auto";

  return {
    slotKey,
    template: template as AdSlotConfig["template"],
    placement: placement as AdSlotConfig["placement"],
    adUnitId: typeof row.ad_unit_id === "string" ? row.ad_unit_id : null,
    format: format as AdSlotConfig["format"],
    enabled: row.enabled === true,
    label: typeof row.label === "string" ? row.label : "Advertisement",
    displayOrder: typeof row.display_order === "number" ? row.display_order : 100,
  };
}

export type AdSlotView =
  | { kind: "none"; reason: AdBlockReason }
  | { kind: "prompt"; slot: AdSlotConfig; label: string }
  | { kind: "ad"; slot: AdSlotConfig; publisherId: string; unitId: string; testMode: boolean; label: string };

/**
 * The three states a placement can be in, as one testable decision.
 *
 * `consent` is the visitor's stored choice (`true` granted, `false` refused, `null` unknown).
 * A refused visitor sees nothing; an undecided visitor sees the prompt *only* when the rest of
 * the configuration would otherwise render an ad. This is what stops a "would render" slot
 * from being swallowed silently when consent is required.
 */
export function adSlotView(
  config: AdConfig,
  input: { template: AdSlotConfig["template"]; placement: AdSlotConfig["placement"]; consent: boolean | null },
): AdSlotView {
  const withoutConsent = resolveAdRender(config, {
    template: input.template,
    placement: input.placement,
    consentGranted: true,
  });
  if (!withoutConsent.render) return { kind: "none", reason: withoutConsent.reason };

  if (config.settings.consentRequired) {
    if (input.consent === false) return { kind: "none", reason: "consent-missing" };
    if (input.consent === null) {
      return { kind: "prompt", slot: withoutConsent.slot, label: withoutConsent.label };
    }
  }

  return {
    kind: "ad",
    slot: withoutConsent.slot,
    publisherId: withoutConsent.publisherId,
    unitId: withoutConsent.unitId,
    testMode: withoutConsent.testMode,
    label: withoutConsent.label,
  };
}

export const CONSENT_STORAGE_KEY = "domainfits.ad-consent";
