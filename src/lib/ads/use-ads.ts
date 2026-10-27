"use client";

/**
 * Loads ad configuration at run time and tracks consent.
 *
 * Configuration is read from the public tables (`ad_settings` has a public read policy, and
 * `ad_slots` is public too) so an operator can switch ads on without a rebuild. Consent is
 * stored per browser and is required before any provider script is loaded.
 */

import { PUBLIC_ENV } from "@/lib/config/env";
import {
  CONSENT_STORAGE_KEY,
  DISABLED_ADS,
  parseAdSettings,
  parseAdSlotRow,
  resolveAdRender,
  type AdConfig,
  type AdDecision,
  type AdSlotConfig,
} from "./config";

export type AdLoadResult = { config: AdConfig; source: "supabase" | "none" };

let cache: { at: number; result: AdLoadResult } | null = null;
const TTL_MS = 5 * 60 * 1000;

export function resetAdCache(): void {
  cache = null;
}

export async function loadAdConfig(options: { force?: boolean } = {}): Promise<AdLoadResult> {
  if (!options.force && cache && Date.now() - cache.at < TTL_MS) return cache.result;

  if (!PUBLIC_ENV.supabaseUrl || !PUBLIC_ENV.supabaseAnonKey) {
    const result: AdLoadResult = { config: DISABLED_ADS, source: "none" };
    cache = { at: Date.now(), result };
    return result;
  }

  const headers = {
    apikey: PUBLIC_ENV.supabaseAnonKey,
    authorization: `Bearer ${PUBLIC_ENV.supabaseAnonKey}`,
    accept: "application/json",
  };

  try {
    const [settingsResponse, slotsResponse, flagResponse] = await Promise.all([
      fetch(`${PUBLIC_ENV.supabaseUrl}/rest/v1/ad_settings?id=eq.global&select=*`, { headers }),
      fetch(`${PUBLIC_ENV.supabaseUrl}/rest/v1/ad_slots?select=*&order=display_order.asc`, { headers }),
      fetch(`${PUBLIC_ENV.supabaseUrl}/rest/v1/feature_flags?key=eq.advertising&select=key,enabled`, {
        headers,
      }),
    ]);

    if (!settingsResponse.ok || !slotsResponse.ok || !flagResponse.ok) {
      const result: AdLoadResult = { config: DISABLED_ADS, source: "none" };
      cache = { at: Date.now(), result };
      return result;
    }

    const settingsRows = (await settingsResponse.json()) as Array<Record<string, unknown>>;
    const slotRows = (await slotsResponse.json()) as Array<Record<string, unknown>>;
    const flagRows = (await flagResponse.json()) as Array<Record<string, unknown>>;

    const result: AdLoadResult = {
      config: {
        // A missing flag row is not consent to serve ads: only an explicit `true` counts.
        flagEnabled: flagRows[0]?.enabled === true,
        settings: parseAdSettings(settingsRows[0]),
        slots: slotRows.map(parseAdSlotRow).filter((slot): slot is AdSlotConfig => slot !== null),
      },
      source: "supabase",
    };
    cache = { at: Date.now(), result };
    return result;
  } catch {
    const result: AdLoadResult = { config: DISABLED_ADS, source: "none" };
    cache = { at: Date.now(), result };
    return result;
  }
}

export function readConsent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CONSENT_STORAGE_KEY) === "granted";
  } catch {
    // Storage blocked: without a durable choice we cannot claim consent.
    return false;
  }
}

export function writeConsent(granted: boolean): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, granted ? "granted" : "denied");
    return true;
  } catch {
    return false;
  }
}

/**
 * Convenience wrapper used by tests and non-component callers. Pass `consent` explicitly to
 * model a specific visitor state; omit it to read the stored choice.
 */
export function decide(
  template: AdSlotConfig["template"],
  placement: AdSlotConfig["placement"],
  config: AdConfig,
  consent?: boolean,
): AdDecision {
  return resolveAdRender(config, { template, placement, consentGranted: consent ?? readConsent() });
}

/** Injects the AdSense loader once. Returns false when it could not be added. */
export function ensureAdSenseScript(publisherId: string): boolean {
  if (typeof document === "undefined") return false;
  const id = "domainfits-adsense-loader";
  if (document.getElementById(id)) return true;
  if (!/^ca-pub-[0-9]{10,20}$/.test(publisherId)) return false;

  const script = document.createElement("script");
  script.id = id;
  script.async = true;
  script.crossOrigin = "anonymous";
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(publisherId)}`;
  document.head.appendChild(script);
  return true;
}
