"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PUBLIC_ENV } from "@/lib/config/env";
import { loadAffiliateConfig, recordAffiliateClick, type AffiliateLoadResult } from "./client";
import { registrarLinks, type AffiliateConfig, type RegistrarLink } from "./links";

export type AffiliateApi = {
  config: AffiliateConfig;
  status: "loading" | "ready";
  note: string;
  /** Links for a candidate's domains; empty when nothing is configured. */
  linksFor: (domains: Array<{ domain: string }>) => RegistrarLink[];
  /**
   * Records a click. Called from the anchor's `onClick`, so navigation is handled by the
   * browser (middle-click, ctrl-click and "open in new tab" all keep working) and a failed
   * counter can never block the destination.
   */
  track: (link: RegistrarLink) => void;
};

/**
 * Affiliate hook.
 *
 * Deliberately conservative: configuration loads once per mount (with a short-lived cache in
 * the loader), and a click is recorded best-effort. The navigation is never blocked by a
 * failed counter — the user asked to go to a registrar, so they go.
 */
export function useAffiliates(): AffiliateApi {
  const [loaded, setLoaded] = useState<AffiliateLoadResult>({
    config: { providers: [], rules: [], enabled: false },
    source: "none",
    note: "",
  });
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void loadAffiliateConfig()
      .then((result) => {
        if (!mounted.current) return;
        setLoaded(result);
      })
      .finally(() => {
        if (mounted.current) setStatus("ready");
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  const linksFor = useCallback(
    (domains: Array<{ domain: string }>) => {
      if (!loaded.config.enabled) return [];
      const links = registrarLinks(loaded.config, domains);
      const proxy = PUBLIC_ENV.affiliateFunctionUrl;
      if (!proxy) return links;
      // With a click-through function deployed, the browser never sees the affiliate URL at
      // all: the function re-validates against the database and issues the redirect.
      return links.map((link) => ({
        ...link,
        url: `${proxy}?provider=${encodeURIComponent(link.providerId)}&domain=${encodeURIComponent(link.domain)}&src=${encodeURIComponent(
          typeof window === "undefined" ? "" : window.location.pathname,
        )}`,
        host: new URL(proxy).hostname,
      }));
    },
    [loaded.config],
  );

  const track = useCallback((link: RegistrarLink) => {
    // When clicks go through the function it records them server-side; counting twice would
    // inflate the numbers.
    if (PUBLIC_ENV.affiliateFunctionUrl) return;
    void recordAffiliateClick({
      domain: link.domain,
      tld: link.tld,
      providerId: link.providerId,
    }).catch(() => {
      /* counting is best-effort; navigation is the browser's job */
    });
  }, []);

  return useMemo(
    () => ({ config: loaded.config, status, note: loaded.note, linksFor, track }),
    [linksFor, loaded.config, loaded.note, status, track],
  );
}
