"use client";

/**
 * A real slice of the results table, rendered on the landing page.
 *
 * The candidates come from the same engine the generator runs (`generate()` executed at build
 * time with a fixed seed), and the availability badge is the product's own `AvailabilityChip` —
 * with no lookup performed, so it says "Not checked" rather than inventing an answer. That is the
 * point of showing it: the preview demonstrates the honesty rule instead of a slogan about it.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Candidate } from "@/lib/brain/types";
import { AvailabilityChip } from "@/components/generator/availability-chip";
import { Badge } from "@/components/ui";

export function ResultPreview({ candidates, query }: { candidates: Candidate[]; query: string }) {
  if (candidates.length === 0) {
    return (
      <p className="p-4 text-sm text-fg-muted">
        The engine produced no candidates for this example seed, which should not happen — open the
        generator and try a root instead.
      </p>
    );
  }

  return (
    <div className="divide-y divide-border">
      {candidates.map((candidate) => (
        <div key={candidate.label} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-fg">{candidate.displayName}</span>
            <span className="block truncate font-mono text-[11px] text-fg-subtle">
              {candidate.domains.map((entry) => entry.domain).join(" · ")}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <Badge tone="accent" className="tnum">
              {candidate.overall.toFixed(1)}
            </Badge>
            <span className="text-[10px] uppercase tracking-wide text-fg-subtle">overall</span>
          </span>
          <AvailabilityChip />
        </div>
      ))}
      <div className="px-3.5 py-2.5">
        <Link
          href={`/generator/?q=${encodeURIComponent(query)}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
        >
          Run this search yourself
          <ArrowRight className="size-3" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
