/**
 * Results panel rendering.
 *
 * These are real component renders (`react-dom/server`), not string matching on source. They
 * exist to protect the product rule that matters most in this file: an unverified name must
 * never be presented as available, and a build with no provider must say so instead of
 * offering a button that silently does nothing.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Candidate, ScoreResult } from "@/lib/brain/types";
import type { AvailabilityResult } from "@/lib/availability/types";
import type { AvailabilityInfo } from "@/lib/generator/filters";
import { DEFAULT_FILTERS } from "@/lib/generator/filters";
import { ResultsPanel } from "@/components/generator/results-panel";
import { CandidateRow, STATUS_PRESENTATION } from "@/components/generator/candidate-row";

function score(total: number): ScoreResult {
  return {
    score: total,
    factors: [
      { key: "pronounceability", label: "Pronounceability", score: 80, weight: 0.5, contribution: 40, explanation: "Easy to say" },
      { key: "length", label: "Length", score: 70, weight: 0.5, contribution: 35, explanation: "Short" },
    ],
    profileId: "quality-default",
    profileVersion: 1,
  };
}

function candidate(label: string, tlds: string[] = ["com"]): Candidate {
  return {
    label,
    displayName: label.charAt(0).toUpperCase() + label.slice(1),
    root: label.slice(0, 3),
    partner: label.slice(3),
    order: "root-partner",
    placement: { scores: { "root-partner": 92, "partner-root": 51 }, confidence: 0.41, reasons: [] },
    components: [label.slice(0, 3), label.slice(3)],
    strategy: "partner-combination",
    industries: ["fintech"],
    length: label.length,
    syllables: 2,
    quality: score(78.5),
    brandability: score(71.2),
    overall: 75.6,
    domains: tlds.map((tld) => ({ tld, domain: `${label}.${tld}` })),
    preservesRoot: true,
    notes: [],
  };
}

function result(domain: string, status: AvailabilityResult["status"]): AvailabilityResult {
  return {
    domain,
    tld: domain.split(".").pop() ?? "com",
    status,
    providerId: "edge-function",
    providerKind: "edge-function",
    checkedAt: "2026-05-01T10:00:00.000Z",
    cached: false,
    confirmed: status === "available_verified" || status === "registered",
    guidance: "guidance",
  };
}

type PanelProps = Parameters<typeof ResultsPanel>[0];

function panelProps(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    candidates: [candidate("paynest"), candidate("ledgerly")],
    diagnostics: null,
    filters: { ...DEFAULT_FILTERS },
    onFiltersChange: vi.fn(),
    sort: "overall",
    onSortChange: vi.fn(),
    selected: new Set<string>(),
    onSelectionChange: vi.fn(),
    favorites: new Set<string>(),
    onToggleFavorite: vi.fn(),
    availability: new Map<string, AvailabilityInfo>(),
    domainResults: new Map<string, AvailabilityResult>(),
    onCheckAvailability: vi.fn(),
    onCheckDomains: vi.fn(),
    checkingAvailability: false,
    availabilityProgress: null,
    availabilityMode: "edge-function",
    availabilityNote: "Checks run through the DomainFits availability service.",
    onExport: vi.fn(),
    onCopy: vi.fn(),
    onRegenerate: vi.fn(),
    busy: false,
    ...overrides,
  };
}

describe("ResultsPanel availability controls", () => {
  it("offers a check action that names its scope", () => {
    const html = renderToStaticMarkup(<ResultsPanel {...panelProps()} />);
    expect(html).toContain("Check 2 names");
    expect(html).not.toContain("Check 0 names");
  });

  it("labels the action with the selection when rows are selected", () => {
    const html = renderToStaticMarkup(<ResultsPanel {...panelProps({ selected: new Set(["paynest"]) })} />);
    expect(html).toContain("Check 1 selected");
  });

  it("disables the action and explains why when no provider is configured", () => {
    const html = renderToStaticMarkup(
      <ResultsPanel {...panelProps({ availabilityMode: "none", availabilityNote: "No provider." })} />,
    );
    expect(html).toContain("Availability checking is unavailable in this build");
    expect(html).toContain("never");
    expect(html).toContain("disabled");
  });

  it("shows progress and the running status tally while checking", () => {
    const html = renderToStaticMarkup(
      <ResultsPanel
        {...panelProps({
          checkingAvailability: true,
          availabilityProgress: {
            completed: 3,
            total: 10,
            tally: { registered: 2, check_failed: 1 },
          },
        })}
      />,
    );
    expect(html).toContain("Checking 3 of 10");
    expect(html).toContain("2 registered");
    expect(html).toContain("1 check failed");
  });

  it("shows the transport note so users know where answers come from", () => {
    const html = renderToStaticMarkup(
      <ResultsPanel
        {...panelProps({ availabilityNote: "Checks query public RDAP services directly from your browser." })}
      />,
    );
    expect(html).toContain("public RDAP services directly from your browser");
  });
});

describe("CandidateRow availability presentation", () => {
  const noop = () => {};

  it("renders an unchecked name as not checked, never as available", () => {
    const html = renderToStaticMarkup(
      <CandidateRow
        candidate={candidate("paynest")}
        index={0}
        selected={false}
        favorite={false}
        onToggleSelect={noop}
        onToggleFavorite={noop}
      />,
    );
    expect(html).toContain("Not checked");
    expect(html.toLowerCase()).not.toContain("available (verified)");
  });

  it.each([
    ["check_failed", "Check failed"],
    ["unknown", "Unknown"],
    ["rate_limited", "Rate limited"],
    ["unsupported_tld", "Unsupported TLD"],
    ["registered", "Registered"],
    ["premium_or_special_pricing", "Premium pricing"],
  ] as const)("renders %s as %s", (status, label) => {
    const html = renderToStaticMarkup(
      <CandidateRow
        candidate={candidate("paynest")}
        index={0}
        selected={false}
        favorite={false}
        availability={{
          status,
          checkedAt: "2026-05-01T10:00:00.000Z",
          provider: "edge-function",
          cached: false,
          confirmed: false,
        }}
        onToggleSelect={noop}
        onToggleFavorite={noop}
      />,
    );
    expect(html).toContain(label);
  });

  it("only claims verified availability for verified results", () => {
    const html = renderToStaticMarkup(
      <CandidateRow
        candidate={candidate("paynest")}
        index={0}
        selected={false}
        favorite={false}
        availability={{
          status: "available_verified",
          checkedAt: "2026-05-01T10:00:00.000Z",
          provider: "edge-function",
          cached: false,
          confirmed: true,
        }}
        onToggleSelect={noop}
        onToggleFavorite={noop}
      />,
    );
    expect(html).toContain("Available (verified)");
    // The caveat lives in the shared presentation map (tooltip + detail panel).
    expect(STATUS_PRESENTATION.available_verified.hint).toContain("Confirm at a registrar");
  });

  it("never phrases an indeterminate status as availability", () => {
    for (const status of ["unknown", "check_failed", "rate_limited", "unsupported_tld"] as const) {
      const hint = STATUS_PRESENTATION[status].hint.toLowerCase();
      expect(hint, status).not.toContain("is available");
      expect(hint, status).not.toContain("this name is free");
    }
    expect(STATUS_PRESENTATION.registered.hint).toMatch(/registration record exists/i);
    expect(STATUS_PRESENTATION.check_failed.tone).toBe("danger");
    expect(STATUS_PRESENTATION.unknown.tone).not.toBe("success");
    expect(STATUS_PRESENTATION.unsupported_tld.tone).not.toBe("success");
  });

  it("carries per-domain results to the detail view input", () => {
    const byDomain = new Map([["paynest.io", result("paynest.io", "registered")]]);
    // The dialog only mounts in a browser, but the row must accept the map without throwing
    // and must not invent chips for domains that were never checked.
    const html = renderToStaticMarkup(
      <CandidateRow
        candidate={candidate("paynest", ["com", "io"])}
        index={0}
        selected={false}
        favorite={false}
        domainResults={byDomain}
        onCheckDomains={noop}
        onToggleSelect={noop}
        onToggleFavorite={noop}
      />,
    );
    expect(html).toContain("+1 TLD");
  });
});
