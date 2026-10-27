"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CircleCheck, CircleDollarSign, ExternalLink, Megaphone, RefreshCw, ShieldQuestion, XCircle } from "lucide-react";
import { Badge, Button, Callout, Card, EmptyState, SectionHeading, Skeleton, StatTile, useToast } from "@/components/ui";
import { isSupabaseConfigured, getSupabase } from "@/lib/supabase/client";
import { useAdminSession } from "@/lib/auth/use-session";
import { loadAdConfig, resetAdCache } from "@/lib/ads/use-ads";
import { loadAffiliateConfig, resetAffiliateCache } from "@/lib/affiliate/client";
import type { AdConfig } from "@/lib/ads/config";
import type { AffiliateConfig } from "@/lib/affiliate/links";
import {
  BLOCK_REASON_TEXT,
  adReadiness,
  affiliateReadiness,
  describeSlot,
  unwiredPlacements,
  type AdReadiness,
  type AffiliateReadiness,
} from "@/lib/monetization/status";

/**
 * Monetization status.
 *
 * Both money-making features in this product are off by default and heavily gated, which is
 * correct — and also means a saved form is very often *not* a live feature. This screen calls
 * the same decision functions the public site calls and reports what would actually happen on
 * the next page load, per placement, with the first blocking gate named.
 *
 * It never shows an estimate. A click count that cannot be read is `null` and printed as such,
 * not as zero.
 */
export default function AdminMonetizationPage() {
  const configured = isSupabaseConfigured();
  const { isAdmin } = useAdminSession();
  const { push } = useToast();

  const [ads, setAds] = useState<{ config: AdConfig; source: "supabase" | "none" } | null>(null);
  const [affiliates, setAffiliates] = useState<{ config: AffiliateConfig; note: string } | null>(null);
  const [clicks, setClicks] = useState<number | null>(null);
  const [clicksNote, setClicksNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (force = false) => {
      setLoading(true);
      if (force) {
        resetAdCache();
        resetAffiliateCache();
      }
      const [adResult, affiliateResult] = await Promise.all([loadAdConfig({ force }), loadAffiliateConfig({ force })]);
      setAds(adResult);
      setAffiliates({ config: affiliateResult.config, note: affiliateResult.note });

      const supabase = getSupabase();
      if (!supabase) {
        setClicks(null);
        setClicksNote("Supabase is not configured, so no click counter exists.");
      } else if (!isAdmin) {
        setClicks(null);
        setClicksNote("Click counts are readable only with an administrator role.");
      } else {
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { count, error } = await supabase
          .from("click_events")
          .select("id", { count: "exact", head: true })
          .gte("created_at", since);
        if (error) {
          setClicks(null);
          setClicksNote(`Click count could not be read: ${error.message}`);
        } else {
          setClicks(typeof count === "number" ? count : null);
          setClicksNote(typeof count === "number" ? null : "The counter returned no value.");
        }
      }
      setLoading(false);
    },
    [isAdmin],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const adState: AdReadiness | null = ads
    ? adReadiness(ads.config)
    : null;
  const affiliateState: AffiliateReadiness | null = affiliates
    ? affiliateReadiness(affiliates.config, { clicksLast30Days: clicks })
    : null;
  const gaps = ads ? unwiredPlacements(ads.config) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeading
          eyebrow="Revenue"
          headingLevel={1}
          title="Monetization status"
          description="What the public site would actually do with the current advertising and registrar configuration. Nothing here is a projection."
        />
        <Button variant="secondary" onClick={() => void load(true)} loading={loading}>
          <RefreshCw className="size-4" aria-hidden="true" /> Re-check
        </Button>
      </div>

      {!configured ? (
        <Callout tone="warn" title="Supabase is not configured">
          Advertising and registrar configuration live in the database. Without
          <code className="mx-1">NEXT_PUBLIC_SUPABASE_URL</code> and an anon key this screen can only report that
          nothing is readable — and the public site renders no ads and no registrar links.
        </Callout>
      ) : null}

      {loading && !adState ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      ) : null}

      {adState ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Megaphone className="size-4 text-fg-subtle" aria-hidden="true" /> Advertising
          </h2>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Feature flag"
              value={adState.flagOn ? "On" : "Off"}
              tone={adState.flagOn ? "success" : "warn"}
              hint="feature_flags.advertising"
            />
            <StatTile
              label="Publisher"
              value={adState.settings.publisherId ?? "Not set"}
              tone={adState.settings.publisherId ? "success" : "warn"}
              hint={`provider: ${adState.settings.provider}`}
            />
            <StatTile
              label="Placements ready"
              value={`${adState.wouldRender}/${adState.slots.length}`}
              tone={adState.wouldRender > 0 ? "success" : "warn"}
              hint="would render for a consenting visitor"
            />
            <StatTile
              label="Mode"
              value={adState.settings.testMode ? "Test" : "Live"}
              tone={adState.settings.testMode ? "neutral" : "danger"}
              hint={adState.settings.testMode ? "impressions are not billable" : "billable impressions"}
            />
          </div>

          <Callout tone={adState.wouldRender > 0 ? "success" : "warn"} title={adState.wouldRender > 0 ? "Working" : "Not serving"}>
            {adState.summary}
          </Callout>

          {adState.slots.length === 0 ? (
            <EmptyState
              title="No placements exist"
              description="Create a placement for a template before expecting an ad anywhere — a page with no placement row has nothing to fill."
              action={
                <Link
                  href="/admin/ad-slots/"
                  className="inline-flex rounded-[var(--radius)] border border-border-strong px-3 py-1.5 text-[13px] font-medium hover:border-accent hover:text-accent"
                >
                  Ad placements
                </Link>
              }
            />
          ) : (
            <Card className="overflow-hidden">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-border bg-surface-2 text-[11px] uppercase tracking-wide text-fg-subtle">
                  <tr>
                    <th className="px-3 py-2 font-medium">Placement</th>
                    <th className="px-3 py-2 font-medium">Slot key</th>
                    <th className="px-3 py-2 font-medium">Page</th>
                    <th className="px-3 py-2 font-medium">State</th>
                  </tr>
                </thead>
                <tbody>
                  {adState.slots.map((entry) => (
                    <tr key={entry.slot.slotKey} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">{describeSlot(entry.slot)}</td>
                      <td className="px-3 py-2 font-mono text-[12px] text-fg-muted">{entry.slot.slotKey}</td>
                      <td className="px-3 py-2 font-mono text-[12px] text-fg-muted">
                        {entry.page ?? "no page yet"}
                      </td>
                      <td className="px-3 py-2">
                        {entry.wouldRender ? (
                          <Badge tone="success">
                            <CircleCheck className="size-3" aria-hidden="true" /> renders
                          </Badge>
                        ) : entry.shadowedBy ? (
                          <span className="flex flex-col gap-1">
                            <Badge tone="neutral">shadowed</Badge>
                            <span className="text-[11.5px] leading-snug text-fg-subtle">
                              {entry.shadowedBy} wins this position (lower display order), so this row can never render.
                            </span>
                          </span>
                        ) : (
                          <span className="flex flex-col gap-1">
                            <Badge tone="warn">
                              <XCircle className="size-3" aria-hidden="true" /> {entry.reason}
                            </Badge>
                            <span className="text-[11.5px] leading-snug text-fg-subtle">
                              {entry.reason ? BLOCK_REASON_TEXT[entry.reason] : null}
                            </span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {gaps.length > 0 ? (
            <Callout tone="info" title="Pages waiting for a placement">
              These positions exist in the markup and have no placement row, so they can never fill:
              <ul className="mt-1 list-disc pl-4">
                {gaps.map((gap) => (
                  <li key={`${gap.template}:${gap.placement}`}>
                    <code>{gap.page}</code> — {gap.template} · {gap.placement}
                  </li>
                ))}
              </ul>
            </Callout>
          ) : null}

          <p className="text-[12px] leading-relaxed text-fg-subtle">
            Advertising is read by the browser at run time, so a change here applies on the next page load — no rebuild.
            Consent is a separate gate: a visitor who has not answered sees a prompt rather than an ad, and a visitor who
            refused sees nothing.
          </p>
        </section>
      ) : null}

      {affiliateState ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <CircleDollarSign className="size-4 text-fg-subtle" aria-hidden="true" /> Affiliate routing
          </h2>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Feature flag"
              value={affiliateState.flagOn ? "On" : "Off"}
              tone={affiliateState.flagOn ? "success" : "warn"}
              hint="feature_flags.affiliate_routing"
            />
            <StatTile
              label="Providers"
              value={`${affiliateState.enabledProviders}/${affiliateState.providers}`}
              tone={affiliateState.enabledProviders > 0 ? "success" : "warn"}
              hint="enabled / total"
            />
            <StatTile label="Extension rules" value={affiliateState.rules} hint="explicit per-TLD routing" />
            <StatTile
              label="Clicks (30d)"
              value={affiliateState.clicksLast30Days === null ? "—" : affiliateState.clicksLast30Days}
              tone={
                affiliateState.clicksLast30Days === null
                  ? "neutral"
                  : affiliateState.clicksLast30Days > 0
                    ? "success"
                    : "neutral"
              }
              hint={affiliateState.clicksLast30Days === null ? "not readable" : "click_events"}
            />
          </div>

          <Callout
            tone={affiliateState.flagOn && affiliateState.enabledProviders > 0 ? "success" : "warn"}
            title={affiliateState.flagOn && affiliateState.enabledProviders > 0 ? "Routing enabled" : "No registrar link"
            }
          >
            {affiliateState.summary}
          </Callout>

          {clicksNote ? <p className="text-[12px] text-fg-subtle">{clicksNote}</p> : null}

          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/affiliates/"
              className="inline-flex items-center gap-1 rounded-[var(--radius)] border border-border-strong px-3 py-1.5 text-[13px] font-medium hover:border-accent hover:text-accent"
            >
              Affiliate providers <ExternalLink className="size-3" aria-hidden="true" />
            </Link>
            <Link
              href="/admin/affiliate-rules/"
              className="inline-flex items-center gap-1 rounded-[var(--radius)] border border-border-strong px-3 py-1.5 text-[13px] font-medium hover:border-accent hover:text-accent"
            >
              Extension rules <ExternalLink className="size-3" aria-hidden="true" />
            </Link>
            <Link
              href="/admin/feature-flags/"
              className="inline-flex items-center gap-1 rounded-[var(--radius)] border border-border-strong px-3 py-1.5 text-[13px] font-medium hover:border-accent hover:text-accent"
            >
              Feature flags <ExternalLink className="size-3" aria-hidden="true" />
            </Link>
          </div>

          <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-fg-subtle">
            <ShieldQuestion className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Registrar links are never shown when routing is off, and the destination is re-validated against the
            provider&rsquo;s allowed hosts before any click leaves the browser. Availability is decided by registry data,
            never by commission.
          </p>
        </section>
      ) : null}

      {ads && affiliates ? (
        <p className="text-[12px] text-fg-subtle">
          Sources: ad configuration from{" "}
          <code>{ads.source === "supabase" ? "ad_settings + ad_slots + feature_flags" : "defaults (nothing loaded)"}</code>,
          affiliate configuration from{" "}
          <code>{affiliates.config.providers.length > 0 ? "affiliate_providers + affiliate_tld_rules" : "no provider rows"}</code>
          .
          {affiliates.note ? ` ${affiliates.note}` : ""}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            push({ tone: "info", title: "Re-reading configuration" });
            void load(true);
          }}
        >
          Refresh from database
        </Button>
      </div>
    </div>
  );
}
