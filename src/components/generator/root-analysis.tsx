"use client";

import { useMemo } from "react";
import { Info, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui";
import { displayForm } from "@/lib/brain/pipeline";
import { evaluatePlacement } from "@/lib/brain/placement";
import { partnerWords } from "@/lib/brain/partners";
import { cn } from "@/lib/utils/format";
import { analyseRoot } from "@/lib/generator/root-insight";

/**
 * Root analysis.
 *
 * Everything shown here is derived from the engine's own data — the semantic profile, the
 * known-word set, the syllable counter and the placement scorer — so the panel cannot claim
 * anything the generator does not actually use. Where the dictionaries know nothing about a root
 * it says so rather than making something up.
 *
 * The industry shown here is the one the request will use. It is read-only on purpose: the single
 * control for changing it is the compact dropdown in the form, so there is one place to look and
 * no second, conflicting selector.
 */
export function RootAnalysisPanel({
  root,
  selectedIndustries,
  partnerLengths,
}: {
  root: string;
  selectedIndustries: string[];
  partnerLengths: number[];
}) {
  const analysis = useMemo(() => analyseRoot(root, selectedIndustries), [root, selectedIndustries]);

  // Three worked examples of the naming rule, produced by the same scorer the generator uses.
  const examples = useMemo(() => {
    const word = analysis.root;
    if (!word) return [];
    return partnerWords({
      lengths: partnerLengths.length > 0 ? partnerLengths : [3, 4, 5],
      industries: selectedIndustries,
      includeLibraries: true,
    })
      .filter((entry) => entry.word !== word && !entry.word.includes(word) && !word.includes(entry.word))
      .slice(0, 40)
      .map((entry) => {
        const placement = evaluatePlacement(word, entry, { industries: selectedIndustries });
        const components =
          placement.preferred === "root-partner" ? [word, entry.word] : [entry.word, word];
        return {
          display: displayForm(components),
          domain: `${components.join("")}.com`,
          label: components.join(""),
          score: placement.scores[placement.preferred],
        };
      })
      // Strongest pairings first; the list is a demonstration of the rule, not a ranking.
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }, [analysis.root, partnerLengths, selectedIndustries]);

  if (!root.trim()) {
    return (
      <section className="rounded-[var(--radius-lg)] border border-dashed border-border bg-surface/60 p-3">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
          <Info className="size-3" aria-hidden="true" /> Root analysis
        </h2>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
          Enter a root keyword to see how the engine reads it: whether it is a word, an abbreviation
          or a coined form, what vocabulary it touches, and how a partner word would join it.
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
        <dl className="grid grid-cols-3 gap-2 text-center [&>*]:min-w-0">
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
                <span
                  key={synonym}
                  className="rounded-full bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-fg-muted"
                >
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
          <p className="text-[11px] font-medium text-fg-muted">
            Industries{selectedIndustries.length > 0 ? " (your override)" : " (detected)"}
          </p>
          {analysis.industries.length === 0 ? (
            <p className="text-[11px] text-fg-subtle">
              No industry vocabulary matched this root, so the general partner words are used. Pick
              one in the Industry dropdown to expand from its terms.
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
          <p className="text-[10.5px] leading-relaxed text-fg-subtle">
            Match percentages come from the industry dictionaries; they are prompt material, not a market claim.
          </p>
        </div>

        {examples.length > 0 ? (
          <div className="space-y-1.5 border-t border-border pt-2">
            <p className="text-[11px] font-medium text-fg-muted">How this root pairs</p>
            <ul className="space-y-1">
              {examples.map((example) => (
                <li key={example.label} className="flex items-baseline justify-between gap-2 text-[11.5px]">
                  <span className="font-semibold text-fg">{example.display}</span>
                  <span className="font-mono text-[10.5px] text-fg-subtle">{example.domain}</span>
                </li>
              ))}
            </ul>
            <p className="text-[10.5px] leading-relaxed text-fg-subtle">
              Examples from the engine's own scorer, not availability claims. Pairs where both orders
              read well produce two names; the rest produce one.
            </p>
          </div>
        ) : null}

        <div className="space-y-1">
          <p className="text-[11px] font-medium text-fg-muted">Length</p>
          <p className="text-[11.5px] leading-relaxed text-fg-muted">{analysis.suitability}</p>
        </div>
      </div>
    </section>
  );
}
