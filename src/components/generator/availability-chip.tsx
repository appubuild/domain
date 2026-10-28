/**
 * Availability badge.
 *
 * Extracted from the result row so a screen that only needs the badge — the landing-page preview,
 * for instance — does not pull the whole row (affiliate link resolution, dialog, tooltip, copy
 * handling) into its bundle. `candidate-row.tsx` re-exports both symbols, so every existing import
 * keeps working and there is still exactly one definition of the status vocabulary.
 */

import { Badge, Tooltip } from "@/components/ui";
import type { AvailabilityInfo } from "@/lib/generator/filters";

export const STATUS_PRESENTATION: Record<
  AvailabilityInfo["status"],
  { label: string; tone: "neutral" | "success" | "danger" | "warn" | "info"; hint: string }
> = {
  unchecked: {
    label: "Not checked",
    tone: "neutral",
    hint: "No registry lookup has been performed for this name yet.",
  },
  available_verified: {
    label: "Available (verified)",
    tone: "success",
    hint: "The provider reported no registration record. Confirm at a registrar before purchasing.",
  },
  registered: {
    label: "Registered",
    tone: "danger",
    hint: "A registration record exists at the provider.",
  },
  unavailable: {
    label: "Unavailable",
    tone: "danger",
    hint: "The provider reported this name cannot be registered.",
  },
  premium_or_special_pricing: {
    label: "Premium pricing",
    tone: "warn",
    hint: "The registry marks this name as premium or reserved; registration cost differs from standard.",
  },
  unknown: {
    label: "Unknown",
    tone: "neutral",
    hint: "The provider returned no usable answer. This is not evidence of availability.",
  },
  check_failed: {
    label: "Check failed",
    tone: "danger",
    hint: "The lookup failed (network, provider error or timeout).",
  },
  rate_limited: {
    label: "Rate limited",
    tone: "warn",
    hint: "The provider asked us to slow down. Retry later.",
  },
  unsupported_tld: {
    label: "Unsupported TLD",
    tone: "neutral",
    hint: "No availability provider is configured for this extension.",
  },
};

export function AvailabilityChip({ info }: { info?: AvailabilityInfo }) {
  const status = info?.status ?? "unchecked";
  const presentation = STATUS_PRESENTATION[status];
  return (
    <Tooltip content={presentation.hint}>
      <Badge tone={presentation.tone}>{presentation.label}</Badge>
    </Tooltip>
  );
}

