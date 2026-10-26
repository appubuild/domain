"use client";

import { useMemo, useState } from "react";
import { Check, Copy, CopyCheck, Info, Star } from "lucide-react";
import type { Candidate } from "@/lib/brain/types";
import { Badge, Button, Dialog, Tooltip } from "@/components/ui";
import { cn } from "@/lib/utils/format";
import type { AvailabilityInfo } from "@/lib/generator/filters";
import type { AvailabilityResult } from "@/lib/availability/types";

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

function ScorePill({ label, value, tone }: { label: string; value: number; tone: "quality" | "brand" }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{label}</span>
      <span
        className={cn(
          "tnum rounded px-1.5 py-0.5 text-[11px] font-semibold",
          tone === "quality" ? "bg-accent-soft text-accent-soft-fg" : "bg-violet-soft text-violet-soft-fg",
        )}
      >
        {value.toFixed(1)}
      </span>
    </div>
  );
}

export function CandidateRow({
  candidate,
  index,
  selected,
  favorite,
  availability,
  domainResults,
  onCheckDomains,
  onToggleSelect,
  onToggleFavorite,
}: {
  candidate: Candidate;
  index: number;
  selected: boolean;
  favorite: boolean;
  availability?: AvailabilityInfo;
  domainResults?: Map<string, AvailabilityResult>;
  onCheckDomains?: (domains: string[]) => void;
  onToggleSelect: (label: string) => void;
  onToggleFavorite: (candidate: Candidate) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const primaryDomain = candidate.domains[0]?.domain ?? candidate.label;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(candidate.domains.map((entry) => entry.domain).join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked by the browser; the detail dialog exposes a selectable field.
      setDetailsOpen(true);
    }
  };

  return (
    <li
      data-testid="candidate-row"
      className={cn(
        "group relative flex flex-col gap-2 border-b border-border px-3 py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-3",
        selected && "bg-accent-soft/40",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(candidate.label)}
          aria-label={`Select ${primaryDomain}`}
          className="size-4 shrink-0 rounded-[4px] border-border-strong accent-[var(--accent)]"
        />
        <span className="tnum hidden w-6 shrink-0 text-right text-[11px] text-fg-subtle sm:block">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              className="truncate font-mono text-[13.5px] font-medium text-fg hover:text-accent hover:underline"
              title="Show scoring details"
            >
              {primaryDomain}
            </button>
            {candidate.domains.length > 1 ? (
              <button
                type="button"
                onClick={() => setDetailsOpen(true)}
                className="text-[11px] text-fg-subtle hover:text-fg"
              >
                +{candidate.domains.length - 1} TLD{candidate.domains.length === 2 ? "" : "s"}
              </button>
            ) : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-fg-subtle">
            <span className="text-fg-muted">{candidate.displayName}</span>
            <span aria-hidden="true">·</span>
            <span className="tnum">{candidate.length} chars</span>
            <span aria-hidden="true">·</span>
            <span className="tnum">{candidate.syllables} syl</span>
            <span aria-hidden="true">·</span>
            <span className="truncate" title={describeStrategy(candidate.strategy)}>
              {humanStrategy(candidate.strategy)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <AvailabilityChip info={availability} />
        <ScorePill label="Q" value={candidate.quality.score} tone="quality" />
        <ScorePill label="B" value={candidate.brandability.score} tone="brand" />
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={copy}
            aria-label={`Copy ${primaryDomain}`}
            className="rounded p-1.5 text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            {copied ? <CopyCheck className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => onToggleFavorite(candidate)}
            aria-pressed={favorite}
            aria-label={favorite ? `Remove ${primaryDomain} from favourites` : `Save ${primaryDomain} to favourites`}
            className={cn(
              "rounded p-1.5 hover:bg-surface-2",
              favorite ? "text-warn" : "text-fg-subtle hover:text-fg",
            )}
          >
            <Star className={cn("size-3.5", favorite && "fill-current")} />
          </button>
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            aria-label={`Details for ${primaryDomain}`}
            className="rounded p-1.5 text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            <Info className="size-3.5" />
          </button>
        </div>
      </div>

      <CandidateDetail
        candidate={candidate}
        availability={availability}
        domainResults={domainResults}
        onCheckDomains={onCheckDomains}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
      />
    </li>
  );
}

export function CandidateDetail({
  candidate,
  availability,
  domainResults,
  onCheckDomains,
  open,
  onClose,
}: {
  candidate: Candidate;
  availability?: AvailabilityInfo;
  domainResults?: Map<string, AvailabilityResult>;
  onCheckDomains?: (domains: string[]) => void;
  open: boolean;
  onClose: () => void;
}) {
  const status = STATUS_PRESENTATION[availability?.status ?? "unchecked"];

  const tldList = useMemo(() => candidate.domains.map((entry) => entry.domain), [candidate.domains]);

  return (
    <Dialog open={open} onClose={onClose} title={candidate.domains[0]?.domain ?? candidate.label} size="lg">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">Quality {candidate.quality.score.toFixed(1)}</Badge>
          <Badge tone="violet">Brandability {candidate.brandability.score.toFixed(1)}</Badge>
          <Badge tone="neutral">Overall {candidate.overall.toFixed(1)}</Badge>
          <AvailabilityChip info={availability} />
        </div>

        <section className="space-y-1.5">
          <h3 className="text-[13px] font-semibold text-fg">How this name was built</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-3">
            {[
              ["Root", candidate.root],
              ["Components", candidate.components.join(" + ")],
              ["Strategy", humanStrategy(candidate.strategy)],
              ["Length", `${candidate.length} characters`],
              ["Syllables", `${candidate.syllables} (heuristic)`],
              ["Preserves root", candidate.preservesRoot ? "Yes" : "No (fragment)"],
            ].map(([term, value]) => (
              <div key={term}>
                <dt className="text-fg-subtle">{term}</dt>
                <dd className="font-medium text-fg">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <ScoreBreakdown title="Quality breakdown" result={candidate.quality} />
        <ScoreBreakdown title="Brandability breakdown" result={candidate.brandability} />

        <section className="space-y-1.5">
          <h3 className="text-[13px] font-semibold text-fg">Availability</h3>
          <p className="text-[12.5px] leading-relaxed text-fg-muted">
            <strong className="font-semibold text-fg">{status.label}.</strong> {status.hint}
          </p>
          {availability?.checkedAt ? (
            <p className="text-[11px] text-fg-subtle">
              Checked {new Date(availability.checkedAt).toLocaleString()}
              {availability.provider ? ` · provider: ${availability.provider}` : ""}
              {availability.cached ? " · cached result" : ""}
            </p>
          ) : (
            <p className="text-[11px] text-fg-subtle">
              Availability checking is a separate engine. Until a provider is configured and a check
              runs, this name is reported as unchecked — never as available.
            </p>
          )}
        </section>

        <section className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold text-fg">
              Domain{candidate.domains.length === 1 ? "" : "s"}
            </h3>
            {onCheckDomains ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onCheckDomains(tldList)}
                disabled={tldList.length === 0}
              >
                Check {tldList.length === 1 ? "this name" : `these ${tldList.length}`}
              </Button>
            ) : null}
          </div>
          <ul className="space-y-1">
            {tldList.map((domain) => {
              const result = domainResults?.get(domain.toLowerCase());
              return (
                <li key={domain} className="flex flex-wrap items-center gap-2">
                  <code className="rounded border border-border bg-surface-2 px-2 py-1 text-[12px]">{domain}</code>
                  <AvailabilityChip
                    info={
                      result
                        ? {
                            status: result.status,
                            checkedAt: result.checkedAt,
                            provider: result.providerId === "none" ? null : result.providerId,
                            cached: result.cached,
                            confirmed: result.confirmed,
                          }
                        : undefined
                    }
                  />
                  {result ? (
                    <span className="text-[11px] text-fg-subtle">
                      {new Date(result.checkedAt).toLocaleString()}
                      {result.cached ? " · cached" : ""}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-fg-subtle">
            Registrar links are only shown when an affiliate provider is configured for the extension.
            See the affiliate disclosure.
          </p>
        </section>

        {candidate.notes.length > 0 ? (
          <section className="space-y-1">
            <h3 className="text-[13px] font-semibold text-fg">Notes</h3>
            <ul className="list-disc space-y-0.5 pl-4 text-[12.5px] text-fg-muted">
              {candidate.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <input
          aria-label="Copyable domain list"
          readOnly
          value={tldList.join("\n")}
          onFocus={(event) => event.currentTarget.select()}
          className="w-full rounded-[var(--radius)] border border-border bg-surface-2 px-2.5 py-2 font-mono text-[12px] text-fg-muted"
        />

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            <Check className="size-4" aria-hidden="true" /> Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function ScoreBreakdown({
  title,
  result,
}: {
  title: string;
  result: Candidate["quality"];
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
        <span className="tnum text-[11px] text-fg-subtle">
          profile {result.profileId} v{result.profileVersion}
        </span>
      </div>
      <ul className="space-y-1.5">
        {result.factors.map((factor) => (
          <li key={factor.key}>
            <div className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className="font-medium text-fg">{factor.label}</span>
              <span className="tnum text-fg-subtle">
                {factor.score.toFixed(0)} × {(factor.weight * 100).toFixed(0)}% = {factor.contribution.toFixed(1)}
              </span>
            </div>
            <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-accent/70"
                style={{ width: `${Math.max(2, factor.score)}%` }}
                aria-hidden="true"
              />
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-fg-subtle">{factor.explanation}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function humanStrategy(strategy: Candidate["strategy"]): string {
  const map: Record<string, string> = {
    "direct-combination": "Direct combination",
    "semantic-combination": "Semantic combination",
    "phrase-template": "Phrase template",
    portmanteau: "Portmanteau",
    invented: "Invented",
    "pseudo-word": "Pseudo-word",
    "short-abstract": "Short abstract",
    "keyword-only": "Keyword only",
    "exact-combination": "Exact keyword",
  };
  return map[strategy] ?? strategy;
}

function describeStrategy(strategy: Candidate["strategy"]): string {
  return `${humanStrategy(strategy)} — see details for the full breakdown.`;
}
