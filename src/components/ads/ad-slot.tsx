"use client";

import { useEffect, useRef, useState } from "react";
import { DISABLED_ADS, adSlotView, type AdSlotConfig } from "@/lib/ads/config";
import { ensureAdSenseScript, loadAdConfig, readConsent, writeConsent, type AdLoadResult } from "@/lib/ads/use-ads";

/**
 * Renders one advertising placement.
 *
 * Behaviour when ads are not fully configured: **nothing is rendered** — no empty container,
 * no reserved height, no "advertisement" caption floating over blank space. The decision is
 * made by `resolveAdRender`, which requires the provider, global switch, publisher ID, a
 * matching enabled slot with a valid unit ID, and (by default) recorded consent.
 *
 * The only third-party script that can ever load here is AdSense's own loader; there is no
 * path for operator-supplied JavaScript.
 */
export function AdSlot({
  template,
  placement,
  className,
}: {
  template: AdSlotConfig["template"];
  placement: AdSlotConfig["placement"];
  className?: string;
}) {
  const [config, setConfig] = useState<AdLoadResult>({ config: DISABLED_ADS, source: "none" });
  const [consent, setConsent] = useState<boolean | null>(null);
  const [loaded, setLoaded] = useState(false);
  const pushed = useRef(false);

  useEffect(() => {
    void loadAdConfig().then(setConfig);
    setConsent(readConsent());
  }, []);

  /**
   * One pure decision drives this component (see `adSlotView`). Consent is evaluated after
   * the other gates, so a slot that *would* render asks for consent instead of disappearing.
   */
  const view = adSlotView(config.config, { template, placement, consent: consent });

  useEffect(() => {
    if (view.kind !== "ad" || loaded) return;
    // Push happens once per mount; re-pushing the same element is an AdSense error.
    if (pushed.current) return;
    pushed.current = true;
    if (ensureAdSenseScript(view.publisherId)) setLoaded(true);
  }, [loaded, view]);

  if (view.kind === "none") return null;

  if (view.kind === "prompt") {
    return (
      <aside
        className={className}
        aria-label="Advertising consent"
        data-ad-slot-key={view.slot.slotKey}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-border bg-surface-2/50 px-3 py-2 text-[12px] text-fg-muted">
          <span>This space is used for advertising. Allow personalised ads?</span>
          <span className="flex gap-1.5">
            <button
              type="button"
              onClick={() => {
                writeConsent(true);
                setConsent(true);
              }}
              className="rounded border border-border-strong px-2 py-1 font-medium text-fg hover:border-accent hover:text-accent"
            >
              Allow
            </button>
            <button
              type="button"
              onClick={() => {
                writeConsent(false);
                setConsent(false);
              }}
              className="rounded px-2 py-1 text-fg-subtle hover:text-fg"
            >
              No thanks
            </button>
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside className={className} aria-label={view.label} data-ad-slot-key={view.slot.slotKey}>
      <p className="mb-1 text-[10px] uppercase tracking-wide text-fg-subtle">
        {view.label}
        {view.testMode ? " · test placement" : ""}
      </p>
      <ins
        className="adsbygoogle block"
        style={{ display: "block" }}
        data-ad-client={view.publisherId}
        data-ad-slot={view.unitId}
        data-ad-format={view.slot.format}
        data-full-width-responsive="true"
        data-adtest={view.testMode ? "on" : undefined}
      />
    </aside>
  );
}
