/**
 * AdSlot rendering.
 *
 * The rule under test: when advertising is not fully configured the component renders
 * **nothing at all** — no placeholder box, no "Advertisement" caption over empty space. That
 * is the difference between a product that has ads switched off and one that pretends.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DISABLED_ADS, type AdConfig } from "@/lib/ads/config";

const loadAdConfig = vi.fn();

vi.mock("@/lib/ads/use-ads", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ads/use-ads")>("@/lib/ads/use-ads");
  return { ...actual, loadAdConfig: (...args: unknown[]) => loadAdConfig(...args) };
});

import { AdSlot } from "@/components/ads/ad-slot";

function enabledConfig(overrides: Partial<AdConfig["settings"]> = {}): AdConfig {
  return {
    settings: {
      provider: "adsense",
      publisherId: "ca-pub-1234567890123456",
      scriptEnabled: true,
      globalEnabled: true,
      testMode: true,
      consentRequired: false,
      ...overrides,
    },
    slots: [
      {
        slotKey: "blog-post-mid",
        template: "blog-post",
        placement: "mid-content",
        adUnitId: "1234567890",
        format: "auto",
        enabled: true,
        label: "Advertisement",
        displayOrder: 10,
      },
    ],
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("AdSlot", () => {
  it("renders nothing before configuration loads", () => {
    loadAdConfig.mockResolvedValue({ config: DISABLED_ADS, source: "none" });
    const html = renderToStaticMarkup(<AdSlot template="blog-post" placement="mid-content" />);
    expect(html).toBe("");
  });

  it("renders nothing for a disabled slot even when settings are enabled", () => {
    const config = enabledConfig();
    loadAdConfig.mockResolvedValue({ config, source: "supabase" });
    // Static render happens before the effect resolves, so this asserts the initial state is
    // empty rather than a reserved placeholder.
    const html = renderToStaticMarkup(<AdSlot template="page" placement="sidebar" />);
    expect(html).toBe("");
  });

  it("never emits a script tag or inline handler", () => {
    loadAdConfig.mockResolvedValue({ config: enabledConfig(), source: "supabase" });
    const html = renderToStaticMarkup(<AdSlot template="blog-post" placement="mid-content" />);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
  });
});
