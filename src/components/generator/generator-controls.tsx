"use client";

import { useMemo, useState } from "react";
import { ChevronDown, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import {
  BRANDABLE_PROFILE_DEFINITIONS,
  DEFAULT_CONSTRAINTS,
  DEFAULT_TLDS,
  INDUSTRIES,
  PREFIX_LIBRARIES,
  SANE_LIMITS,
  SUFFIX_LIBRARIES,
  TLD_DIRECTORY,
  normalizeKeyword,
  type BrandableProfileId,
  type GenerationRequest,
} from "@/lib/brain";
import { PARTNER_LENGTH_CHOICES, partnerWordLength, partnerWords } from "@/lib/brain/partners";
import { Badge, Button, Callout } from "@/components/ui/primitives";
import { ChipGroup, Field, Input, NumberInput, Select, Switch, TagInput } from "@/components/ui/form";
import { VALID_TARGETS } from "@/lib/generator/url-state";
import { industryExamples, industryStateFor } from "@/lib/generator/industry";
import { cn } from "@/lib/utils/format";

/**
 * The generator's controls.
 *
 * Five inputs decide a search, in the order they appear:
 *
 *   1. the primary root — one word, enforced;
 *   2. the extensions each name is offered in;
 *   3. the industry (auto-detected, manually overridable);
 *   4. the partner-root length — the one length rule there is;
 *   5. how many names to return.
 *
 * Everything else is a refinement and lives behind "Advanced". There is no naming-style picker and
 * no total-name-length picker: the engine chooses the word order, and the finished length is the
 * root plus the partner, computed rather than configured.
 */

export type GeneratorFormState = {
  /** Exactly one root. */
  roots: string[];
  /**
   * Industry override. Empty means "use what the root implies" — the control shows the detection
   * separately so an empty list is never mistaken for "no industry".
   */
  industries: string[];
  /** Allowed alphabetic lengths of the partner root (2–6 in the UI). Empty = any. */
  partnerLengths: number[];
  targetCount: number;
  tlds: string[];
  customPartners: string[];
  partnerLibraries: string[];
  autoExpand: boolean;
  expandIndustries: boolean;
  brandable: boolean;
  brandableProfiles: BrandableProfileId[];
  /** Phonetic refinement; there is no total-length rule to configure. */
  minVowelRatio: number;
  maxConsonantCluster: number;
  maxSyllables: number;
  requiredSubstring: string;
  excludedSubstringInput: string;
  excludedWordsInput: string;
};

export function formStateFromRequest(request: GenerationRequest): GeneratorFormState {
  return {
    roots: request.roots,
    industries: request.industries,
    partnerLengths: request.partnerLengths,
    targetCount: request.targetCount,
    tlds: request.tlds,
    customPartners: request.customPartners,
    partnerLibraries: request.partnerLibraries,
    autoExpand: request.autoExpand,
    expandIndustries: request.expandIndustries,
    brandable: request.brandable,
    brandableProfiles: request.brandableProfiles,
    minVowelRatio: request.constraints.minVowelRatio,
    maxConsonantCluster: request.constraints.maxConsonantCluster,
    maxSyllables: request.constraints.maxSyllables,
    requiredSubstring: request.constraints.requiredSubstring ?? "",
    excludedSubstringInput: request.constraints.excludedSubstrings.join(", "),
    excludedWordsInput: request.constraints.excludedWords.join(", "),
  };
}

export function requestFromFormState(state: GeneratorFormState): GenerationRequest {
  return {
    roots: state.roots.slice(0, 1),
    industries: state.industries,
    expandIndustries: state.expandIndustries,
    customPartners: state.customPartners,
    partnerLibraries: state.partnerLibraries,
    partnerLengths: state.partnerLengths,
    autoExpand: state.autoExpand,
    targetCount: state.targetCount,
    constraints: {
      ...DEFAULT_CONSTRAINTS,
      // Two components, always: the naming rule decides the shape, not a control.
      maxComponents: 2,
      minVowelRatio: state.minVowelRatio,
      maxConsonantCluster: state.maxConsonantCluster,
      maxSyllables: state.maxSyllables,
      requiredSubstring: state.requiredSubstring || undefined,
      excludedSubstrings: splitList(state.excludedSubstringInput),
      excludedWords: splitList(state.excludedWordsInput),
      preserveExactRoot: true,
      disallowRepeatedRoot: true,
    },
    brandable: state.brandable,
    brandableProfiles: state.brandableProfiles,
    tlds: state.tlds.length > 0 ? state.tlds : [DEFAULT_TLDS[0] ?? "com"],
    seed: 1,
  };
}

function splitList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/** A real partner word of this length, used to make the length chips concrete. */
function examplePartners(length: number, industryId: string | null): string {
  const words = partnerWords({
    lengths: [length],
    industries: industryId ? [industryId] : [],
  })
    .slice(0, 2)
    .map((entry) => entry.word);
  return words.length > 0 ? words.join(", ") : "—";
}

export type GeneratorControlsProps = {
  state: GeneratorFormState;
  onChange: (next: GeneratorFormState) => void;
  onGenerate: () => void;
  onReset: () => void;
  busy: boolean;
  error: string | null;
  /**
   * Render the submit button. False inside the mobile drawer, where the drawer's own pinned
   * footer carries the action and the panel is free to be one column of inputs.
   */
  showActions?: boolean;
  /** Prefix for element ids so two mounted instances cannot collide (desktop panel + drawer). */
  idPrefix?: string;
};

export function GeneratorControls({
  state,
  onChange,
  onGenerate,
  onReset,
  busy,
  error,
  showActions = true,
  idPrefix = "",
}: GeneratorControlsProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const set = <K extends keyof GeneratorFormState>(key: K, value: GeneratorFormState[K]) =>
    onChange({ ...state, [key]: value });

  const root = state.roots[0] ?? "";
  const industry = useMemo(() => industryStateFor(root, state.industries), [root, state.industries]);
  const appliedIndustryId = industry.applied?.id ?? null;

  const libraryIds = useMemo(() => {
    const merged = new Map<string, { id: string; name: string; description: string }>();
    for (const library of [...PREFIX_LIBRARIES, ...SUFFIX_LIBRARIES]) {
      if (!merged.has(library.id)) {
        merged.set(library.id, { id: library.id, name: library.name, description: library.description });
      }
    }
    return Array.from(merged.values());
  }, []);

  const tldOptions = useMemo(
    () =>
      TLD_DIRECTORY.filter((record) => record.enabled || state.tlds.includes(record.tld)).map((record) => ({
        value: record.tld,
        label: record.displayName,
        title: record.description,
      })),
    [state.tlds],
  );

  // The finished length is arithmetic, not a setting: show the arithmetic.
  const rootLength = partnerWordLength(root);
  const selectedLengths = [...state.partnerLengths].sort((a, b) => a - b);
  const partnerRange = selectedLengths.length > 0 ? selectedLengths : [2, 6];
  const minTotal = rootLength > 0 ? rootLength + (partnerRange[0] ?? 2) : 0;
  const maxTotal = rootLength > 0 ? rootLength + (partnerRange.at(-1) ?? 6) : 0;
  const totalLabel =
    rootLength === 0
      ? null
      : minTotal === maxTotal
        ? `${minTotal} letters`
        : `${minTotal}–${maxTotal} letters`;

  return (
    <form
      className="space-y-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        onGenerate();
      }}
    >
      {/* Row 1 — the one input that matters, and the button that runs it. */}
      <div className="flex flex-col gap-2">
        <RootField
          state={state}
          onChange={onChange}
          idPrefix={idPrefix}
          detectedIndustry={industry.applied ? { name: industry.applied.name, mode: industry.mode } : null}
        />
        {showActions ? (
          <Button type="submit" size="lg" loading={busy} loadingLabel="Generating…" className="w-full">
            <Sparkles className="size-4" aria-hidden="true" />
            Generate names
          </Button>
        ) : null}
      </div>

      <div className="space-y-2.5">
        {/* Row 2 — extensions sit high in the card: they apply to every name that follows. */}
        <Field
          label="Extensions"
          description="Availability is checked per extension later — never inferred here."
        >
          <ChipGroup
            label="Extensions"
            options={tldOptions}
            selected={state.tlds}
            onToggle={(value) => {
              const next = toggle(state.tlds, value);
              set("tlds", next.length > 0 ? next : [DEFAULT_TLDS[0] ?? "com"]);
            }}
          />
        </Field>

        {/*
          The rules, stacked.

          This panel is ~20rem wide on a desktop and the full width of a phone drawer, so the
          multi-column rules row it used to have collapsed into overlapping columns: the partner
          chips stacked one per line and "Industry" ran into "How many names". One column, full
          width fields, and only the two short controls sharing a row.
        */}
        <div className="flex flex-col gap-3">
          <Field label="Partner root length" className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Partner root length">
              {PARTNER_LENGTH_CHOICES.map((length) => {
                const active = state.partnerLengths.includes(length);
                return (
                  <button
                    key={length}
                    type="button"
                    role="checkbox"
                    aria-checked={active}
                    onClick={() => set("partnerLengths", toggle(state.partnerLengths, length))}
                    title={`Partner words of exactly ${length} letters, e.g. ${examplePartners(length, appliedIndustryId)}`}
                    className={cn(
                      "h-8 min-w-9 rounded-[var(--radius-sm)] border px-2 text-xs font-medium tabular-nums transition-colors",
                      active
                        ? "border-accent bg-accent-soft text-accent-soft-fg"
                        : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
                    )}
                  >
                    {length}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => set("partnerLengths", [])}
                title="Allow any partner length the dictionaries contain"
                className={cn(
                  "h-8 rounded-[var(--radius-sm)] border px-2 text-[11px]",
                  state.partnerLengths.length === 0
                    ? "border-accent bg-accent-soft text-accent-soft-fg"
                    : "border-border text-fg-subtle hover:border-border-strong hover:text-fg",
                )}
              >
                Any
              </button>
            </div>
          </Field>

          <IndustryField state={state} onChange={onChange} idPrefix={idPrefix} />

          <div className="flex flex-col gap-3">
            <Field label="How many names" className="min-w-0">
              <Select
                value={String(state.targetCount)}
                onChange={(event) => set("targetCount", Number(event.target.value))}
                aria-label="Target result count"
                className="h-8 text-[13px]"
              >
                {VALID_TARGETS.map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="min-w-0">
              <Switch
                checked={state.brandable}
                onChange={(value) => set("brandable", value)}
                label="Brandable"
                description="Rank by brandability, not descriptive quality."
              />
            </div>
          </div>
        </div>

        <IndustryNotes
          root={root}
          industryScope={appliedIndustryId}
          summary={industry.summary}
          mode={industry.mode}
          suggestions={industry.suggestions}
        />

        {rootLength > 0 ? (
          <p className="text-[11px] leading-relaxed text-fg-subtle">
            <span className="font-medium text-fg-muted">
              {root.charAt(0).toUpperCase() + root.slice(1)}
            </span>{" "}
            ({rootLength} letters) + a {selectedLengths.length > 0 ? selectedLengths.join("/") : "2–6"}-letter
            partner → <span className="font-medium text-fg-muted">{totalLabel}</span> before the dot. Examples:{" "}
            {examplePartners(partnerRange[0] ?? 2, appliedIndustryId)}. Length is computed from the two
            parts; there is no separate setting for it.
          </p>
        ) : null}

        {state.brandable ? (
          <Field label="Brandable profile">
            <ChipGroup
              label="Brandable profiles"
              options={BRANDABLE_PROFILE_DEFINITIONS.map((profile) => ({
                value: profile.id,
                label: profile.name,
                title: profile.description,
              }))}
              selected={state.brandableProfiles}
              onToggle={(value) => {
                const next = toggle(state.brandableProfiles, value);
                set("brandableProfiles", next.length > 0 ? next : ["startup"]);
              }}
            />
          </Field>
        ) : null}

        <div className="rounded-[var(--radius)] border border-border">
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] font-medium text-fg"
          >
            <span className="flex items-center gap-2">
              <Wand2 className="size-4 text-fg-subtle" aria-hidden="true" />
              Advanced controls
            </span>
            <ChevronDown className={cn("size-4 text-fg-subtle transition-transform", advancedOpen && "rotate-180")} />
          </button>
          {advancedOpen ? (
            <div className="space-y-4 border-t border-border p-3">
              <Field
                label="Custom partner words"
                description="Added to the partner pool on top of the dictionaries. Lengths outside your selection are ignored."
              >
                <TagInput
                  label="Custom partner words"
                  value={state.customPartners}
                  onChange={(next) => set("customPartners", next)}
                  placeholder="nest, atlas…"
                  max={SANE_LIMITS.maxCustomWords}
                />
              </Field>

              <Field label="Word libraries" description="Leave empty to draw on every shipped library.">
                <ChipGroup
                  label="Word libraries"
                  options={libraryIds.map((library) => ({
                    value: library.id,
                    label: library.name,
                    title: library.description,
                  }))}
                  selected={state.partnerLibraries}
                  onToggle={(value) => set("partnerLibraries", toggle(state.partnerLibraries, value))}
                />
              </Field>

              <div className="flex flex-col gap-2">
                <Switch
                  checked={state.autoExpand}
                  onChange={(value) => set("autoExpand", value)}
                  label="Use dictionary words"
                  description="Off: only your custom words and industry vocabulary are used."
                />
                <Switch
                  checked={state.expandIndustries}
                  onChange={(value) => set("expandIndustries", value)}
                  label="Industry vocabulary"
                  description="Pull the matched industry's words into the partner pool."
                />
              </div>

              <div className="flex flex-col gap-3">
                <Field label="Syllables" description="0 disables the check.">
                  <NumberInput
                    label="Max syllables"
                    value={state.maxSyllables}
                    min={0}
                    max={8}
                    onChange={(value) => set("maxSyllables", value)}
                  />
                </Field>
                <Field label="Max consonant run" description="0 disables the check.">
                  <NumberInput
                    label="Max consonant run"
                    value={state.maxConsonantCluster}
                    min={0}
                    max={6}
                    onChange={(value) => set("maxConsonantCluster", value)}
                  />
                </Field>
                <Field
                  label="Minimum vowel share"
                  description={`${Math.round(state.minVowelRatio * 100)}% — 0 disables the rule.`}
                >
                  <input
                    type="range"
                    min={0}
                    max={60}
                    step={1}
                    value={Math.round(state.minVowelRatio * 100)}
                    onChange={(event) => set("minVowelRatio", Number(event.target.value) / 100)}
                    aria-label="Minimum vowel ratio"
                    className="w-full accent-[var(--accent)]"
                  />
                </Field>
              </div>

              <div className="flex flex-col gap-3">
                <Field label="Required text">
                  <Input
                    value={state.requiredSubstring}
                    onChange={(event) => set("requiredSubstring", event.target.value)}
                    placeholder="e.g. ly"
                    aria-label="Required substring"
                  />
                </Field>
                <Field label="Excluded text">
                  <Input
                    value={state.excludedSubstringInput}
                    onChange={(event) => set("excludedSubstringInput", event.target.value)}
                    placeholder="comma separated"
                    aria-label="Excluded substrings"
                  />
                </Field>
                <Field label="Excluded words">
                  <Input
                    value={state.excludedWordsInput}
                    onChange={(event) => set("excludedWordsInput", event.target.value)}
                    placeholder="comma separated"
                    aria-label="Excluded words"
                  />
                </Field>
              </div>

              <Callout tone="info">
                Custom words are checked by the same rules as dictionary words: letters only, no
                repeat of the root, and they must match your partner length if you picked one.
              </Callout>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onReset}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Reset
          </Button>
          <div className="ml-auto flex items-center gap-1.5 text-xs text-fg-subtle">
            <Badge tone="outline">
              {state.tlds.length} TLD{state.tlds.length === 1 ? "" : "s"}
            </Badge>
            <Badge tone="outline">
              {state.partnerLengths.length > 0 ? `${state.partnerLengths.length} lengths` : "any length"}
            </Badge>
          </div>
        </div>

        <p className="text-[11px] leading-relaxed text-fg-subtle">
          Every name is your root plus one partner word — never a partner on both sides. The engine
          picks the order; the domain is always the lower-case label and the CamelCase form is for
          reading only.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-[13px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Root keyword                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One root, enforced.
 *
 * Several roots interleave unrelated lists and make the quantity-per-root meaningless, so the
 * field accepts exactly one keyword and says what it did with the rest. Changing the root also
 * clears an industry override: a choice made for "pay" is not a choice for "home".
 */
function RootField({
  state,
  onChange,
  detectedIndustry,
  idPrefix = "",
}: {
  state: GeneratorFormState;
  onChange: (next: GeneratorFormState) => void;
  idPrefix?: string;
  /** Name of the industry that will be used, or null. Full reasoning lives in the industry field. */
  detectedIndustry: { name: string; mode: "auto" | "override" | "none" } | null;
}) {
  const current = state.roots[0] ?? "";
  const [notice, setNotice] = useState<string | null>(null);

  const commit = (raw: string) => {
    const tokens = raw
      .split(/[,\s]+/)
      .map((token) => token.trim())
      .filter(Boolean);

    if (tokens.length > 1) {
      setNotice(`One root keyword at a time — using “${tokens[0]!}” and ignoring the rest.`);
    } else {
      setNotice(null);
    }

    const keyword = normalizeKeyword(tokens[0] ?? "");
    if (tokens.length === 1 && !keyword.valid) {
      setNotice(keyword.reason ?? "That is not a usable domain keyword.");
      onChange({ ...state, roots: [tokens[0]!], industries: [] });
      return;
    }
    const nextRoot = tokens[0] ?? "";
    onChange({
      ...state,
      roots: nextRoot ? [nextRoot] : [],
      // A manual industry belongs to the root it was chosen for.
      industries: nextRoot === current ? state.industries : [],
    });
  };

  const keyword = normalizeKeyword(current);
  const error = current && !keyword.valid ? (keyword.reason ?? "Not a usable keyword.") : null;
  const rootId = `${idPrefix}root`;
  const noticeId = `${idPrefix}root-notice`;
  const hintId = `${idPrefix}root-industry-hint`;

  return (
    <div className="space-y-1.5">
      <Field
        label="Primary root"
        htmlFor={rootId}
        required
        error={error}
        description="The one word every name is built around."
      >
        <Input
          id={rootId}
          value={current}
          onChange={(event) => commit(event.target.value)}
          placeholder="pay"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          invalid={Boolean(error)}
          className="h-11 text-base"
          aria-describedby={notice ? noticeId : hintId}
        />
      </Field>

      {notice ? (
        <p id={noticeId} role="status" className="text-xs font-medium text-warn">
          {notice}
        </p>
      ) : null}

      <p id={hintId} className="text-[11px] leading-relaxed text-fg-subtle">
        {!current
          ? "Type a root and its industry is detected automatically."
          : detectedIndustry
            ? `${detectedIndustry.mode === "override" ? "Industry set by you" : "Detected industry"}: ${detectedIndustry.name}`
            : "No industry matched — general partner words will be used."}
      </p>

      <div className="flex flex-wrap gap-1.5">
        {["pay", "home", "cloud", "ai", "chat", "secure"].map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => {
              setNotice(null);
              onChange({ ...state, roots: [example], industries: [] });
            }}
            className="rounded-full border border-dashed border-border-strong px-2 py-0.5 text-[11px] text-fg-subtle hover:border-accent hover:text-accent"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Industry                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The industry control: one compact select.
 *
 * It must never be a large permanent panel, and it must not become a tall column either: the
 * select is a single line, and everything the detection has to say lives in `IndustryNotes` on the
 * line below the rules row, where it cannot stretch the layout.
 *
 * Keyboard, pointer and touch all work because the control is a native `<select>`.
 */
function IndustryField({
  state,
  onChange,
  idPrefix = "",
}: {
  state: GeneratorFormState;
  onChange: (next: GeneratorFormState) => void;
  idPrefix?: string;
}) {
  const industryId = `${idPrefix}industry`;
  const root = state.roots[0] ?? "";
  const industry = industryStateFor(root, state.industries);
  const appliedId = industry.applied?.id ?? null;

  const autoLabel = !root
    ? "Automatic"
    : industry.mode === "auto" && appliedId
      ? `Automatic — ${INDUSTRIES.find((entry) => entry.id === appliedId)?.name ?? appliedId}`
      : industry.mode === "override"
        ? "Automatic (re-detected from the root)"
        : "Automatic — no confident match";

  return (
    <Field label="Industry" htmlFor={industryId} className="min-w-0">
      <div className="flex items-center gap-1.5">
        <Select
          id={industryId}
          aria-label="Industry"
          value={state.industries[0] ?? ""}
          onChange={(event) => onChange({ ...state, industries: event.target.value ? [event.target.value] : [] })}
          className="h-8 min-w-0 text-[13px]"
        >
          <option value="">{autoLabel}</option>
          {INDUSTRIES.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </Select>
        {state.industries.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange({ ...state, industries: [] })}
            title="Go back to the industry detected from the root"
            className="shrink-0 rounded-[var(--radius-sm)] px-1.5 py-1 text-[11px] text-fg-subtle underline-offset-2 hover:text-fg hover:underline"
          >
            Reset to auto
          </button>
        ) : null}
      </div>
    </Field>
  );
}

/**
 * What the industry control detected, said in one line.
 *
 * The summary, the vocabulary sample and the runner-up chips were three stacked paragraphs inside
 * the select's column, which is what made the control look like a side panel again. They are one
 * wrapping line here, under the whole rules row, so the columns above stay aligned and short.
 */
function IndustryNotes({
  root,
  industryScope,
  summary,
  mode,
  suggestions,
}: {
  root: string;
  industryScope: string | null;
  summary: string;
  mode: "auto" | "override" | "none";
  suggestions: Array<{ id: string; name: string; confidence: number }>;
}) {
  const vocabulary = industryScope ? industryExamples(industryScope) : [];

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-relaxed text-fg-subtle">
      <span>{summary}</span>
      {vocabulary.length > 0 ? (
        <span className="text-fg-subtle">Vocabulary: {vocabulary.join(", ")}…</span>
      ) : null}
      {suggestions.length > 1 ? (
        <span className="flex flex-wrap items-center gap-1">
          <span>{root ? "Also matches:" : "Try:"}</span>
          {suggestions.slice(1).map((match) => (
            <span key={match.id} className="rounded-full border border-border px-1.5 py-0.5 text-fg-muted">
              {match.name} · {Math.round(match.confidence * 100)}%
            </span>
          ))}
        </span>
      ) : null}
      {mode === "auto" ? null : (
        <span className="text-fg-subtle">
          {mode === "override"
            ? "Your choice is used until you reset or change the root."
            : "General partner words are used when nothing matches."}
        </span>
      )}
    </div>
  );
}
