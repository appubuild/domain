"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { trackEvent } from "@/lib/analytics/events";

/**
 * Public page-view counter.
 *
 * One event per path change, written to `analytics_events` through the public client (RLS
 * allows inserts from the browser and reads only for administrators). It is a counter, not a
 * tracker: the row carries the path, a per-tab random id and nothing else — no IP, no user
 * agent, no referrer, no cookie that survives the tab.
 *
 * Two deliberate exclusions:
 *
 *   - `/admin/*` is not counted. Internal use would drown the signal, and the admin area
 *     already has an audit log for real actions.
 *   - an explicit `Do Not Track` opt-out is honoured. A first-party counter can still respect
 *     a stated preference, so it does.
 *
 * Static export means this runs entirely in the browser; the layout is prerendered with this
 * component returning `null`.
 */

const SKIP_PREFIXES = ["/admin"];

function doNotTrackRequested(): boolean {
  if (typeof navigator === "undefined") return false;
  const legacy = (navigator as Navigator & { doNotTrack?: string | null }).doNotTrack;
  return navigator.doNotTrack === "1" || legacy === "1";
}

export function PageViewCounter() {
  const pathname = usePathname();
  const lastRecorded = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    if (SKIP_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return;
    if (doNotTrackRequested()) return;
    // Client-side navigation can re-run this effect with the same path; count it once.
    if (lastRecorded.current === pathname) return;
    lastRecorded.current = pathname;
    trackEvent("page_view", { path: pathname });
  }, [pathname]);

  return null;
}
