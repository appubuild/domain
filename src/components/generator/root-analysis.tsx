"use client";

import { useMemo } from "react";
import { Info, Sparkles, TriangleAlert } from "lucide-react";
import { Badge, Callout } from "@/components/ui";
import { cn } from "@/lib/utils/format";
import { analyseRoot, recommendNamingStyles, NAMING_STYLES } from "@/lib/generator/naming-styles";
import { INDUSTRIES } from "@/lib/brain";

/**
 * Root analysis.
 *
 * Everything shown here is derived from the engine's own data — the semantic profile, the known
 * word set, the syllable counter — so the panel cannot claim a meaning the generator does not
 * actually use. Where the dictionaries know nothing about a root it says so rather than making
 * something up.
 *
 * The industry buttons are a manual override: they set the industries the request expands from,
 * which is exactly what the generation uses.
 */
export function RootAnalysisPanel({
  root,
  selectedIndustries,
  onToggleIndustry,
  onClearIndustries,
}: {
  root: string;
  selectedIndustries: string[];
  onToggleIndustry: (id: string) => void;
  onClearIndustries: () => void;
}) {
  const analysis = useMemo(() => analyseRoot(root, selectedIndustries), [root, selectedIndustries]);
  const recommendation = useMemo(() => recommendNamingStyles(root), [root]);

  if (!root.trim()) {
    return (
      <section className="rounded-[var(--radius-lg)] border border-dashed border-border bg-surface/60 p-3">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
          <Info className="size-3" aria-hidden="true" /> Root analysis
        </h2>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
          Enter a root keyword to see how the engine reads it: whether it is a word, an abbreviation or a
          coined form, what it is associated with, and which naming styles fit its shape.
        </p>
      </section>
    );
  }

  const kindTone = analysis.kind === "word" ? "success" : analysis.kind === "abbreviation" ? "info" : "neutral";

  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-surface">
      <h2 className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
        <span className="flex items-center gap-1.5">
          <Sparkles className="size-3" aria-hidden="true" /> Root analysis
        </span>
        <Badge tone={kindTone} className="capitalize">
          {analysis.kind === "word" ? "dictionary word" : analysis.kind}
        </Badge>
      </h2>

      <div className="space-y-3 p-3">
        <dl className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: "Letters", value: analysis.letters },
            { label: "Syllables", value: analysis.syllables },
            { label: "Variants", value: analysis.variants.length },
          ].map((item) => (
            <div key={item.label} className="rounded-[var(--radius-sm)] bg-surface-2/60 px-2 py-1.5">
              <dt className="text-[10px] uppercase tracking-wide text-fg-subtle">{item.label}</dt>
              <dd className="text-sm font-semibold tabular-nums text-fg">{item.value}</dd>
            </div>
          ))}
        </dl>

        <div className="space-y-1">
          <p className="text-[11px] font-medium text-fg-muted">Meaning</p>
          <p className="text-[11.5px] leading-relaxed text-fg-muted">{analysis.meaning}</p>
          <p className="text-[10.5px] leading-relaxed text-fg-subtle">{analysis.kindExplanation}</p>
        </div>

        {analysis.synonyms.length > 0 ? (
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-fg-muted">Related words used by the engine</p>
            <div className="flex flex-wrap gap-1">
              {analysis.synonyms.map((synonym) => (
                <span key={synonym} className="rounded-full bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-fg-muted">
                  {synonym}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {analysis.variants.length > 0 ? (
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-fg-muted">Spelling variants</p>
            <div className="flex flex-wrap gap-1">
              {analysis.variants.map((variant) => (
                <span
                  key={variant}
                  className={cn(
                    "rounded-full border border-border px-1.5 py-0.5 font-mono text-[10.5px] text-fg-muted",
                  )}
                >
                  {variant}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-fg-muted">Industries</p>
            {selectedIndustries.length > 0 ? (
              <button
                type="button"
                onClick={onClearIndustries}
                className="text-[10.5px] text-fg-subtle underline-offset-2 hover:text-fg hover:underline"
              >
                Use detected
              </button>
            ) : null}
          </div>
          {analysis.industries.length === 0 ? (
            <p className="text-[11px] text-fg-subtle">
              No industry vocabulary matched this root. Pick one below to expand from its terms.
            </p>
          ) : (
            <ul className="space-y-1">
              {analysis.industries.map((industry) => (
                <li key={industry.id} className="flex items-center justify-between gap-2 text-[11.5px]">
                  <span className="text-fg-muted">{industry.name}</span>
                  <span className="tabular-nums text-fg-subtle">{industry.confidence}% match</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-1 pt-0.5">
            {INDUSTRIES.filter((industry) => analysis.industries.some((match) => match.id === industry.id)).length ===
            0
              ? INDUSTRIES.slice(0, 6).map((industry) => (
                  <button
                    key={industry.id}
                    type="button"
                    onClick={() => onToggleIndustry(industry.id)}
                    className={cn(
                      "rounded-full border px-1.5 py-0.5 text-[10.5px]",
                      selectedIndustries.includes(industry.id)
                        ? "border-accent bg-accent-soft text-accent-soft-fg"
                        : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
                    )}
                  >
                    {industry.name}
                  </button>
                ))
              : null}
          </div>
          <p className="text-[10.5px] leading-relaxed text-fg-subtle">
            Match percentages come from the industry dictionaries; they are prompt material, not a market claim.
          </p>
        </div>

        <div className="space-y-1 border-t border-border pt-2">
          <p className="text-[11px] font-medium text-fg-muted">Suggested styles</p>
          <div className="flex flex-wrap gap-1">
            {recommendation.styles.map((id) => (
              <span key={id} className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10.5px] text-accent-soft-fg">
                {NAMING_STYLES.find((style) => style.id === id)?.label ?? id}
              </span>
            ))}
          </div>
          <p className="text-[10.5px] leading-relaxed text-fg-subtle">{recommendation.reason}</p>
        </div>

        <div className="space-y-1">
          <p className="text-[11px] font-medium text-fg-muted">Sector suitability</p>
          <p className="text-[11.5px] leading-relaxed text-fg-muted">{analysis.suitability}</p>
        </div>

        {selectedIndustries.length > 0 ? (
          <Callout tone="info" icon={<TriangleAlert className="size-3.5" />}>
            Industry override active: expansion uses {selectedIndustries.length} selected{" "}
            {selectedIndustries.length === 1 ? "industry" : "industries"} instead of the detected ones.
          </Callout>
        ) : null}
      </div>
    </section>
  );
}
