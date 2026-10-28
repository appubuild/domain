"use client";

import { useMemo, useState } from "react";
import { ChevronDown, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import {
  BRANDABLE_PROFILE_DEFINITIONS,
  DEFAULT_TLDS,
  INDUSTRIES,
  LENGTH_PRESETS,
  PREFIX_LIBRARIES,
  SANE_LIMITS,
  SUFFIX_LIBRARIES,
  TLD_DIRECTORY,
  normalizeKeyword,
  type BrandableProfileId,
  type GenerationRequest,
  type KeywordPosition,
  type LengthPreset,
  type WordStyle,
} from "@/lib/brain";
import { Badge, Button, Callout } from "@/components/ui/primitives";
import {
  NAMING_STYLES,
  engineForNamingStyles,
  namingStylesInState,
  recommendNamingStyles,
  type NamingStyleId,
} from "@/lib/generator/naming-styles";
import {
  ChipGroup,
  Field,
  Input,
  NumberInput,
  SegmentedControl,
  Select,
  Switch,
  TagInput,
} from "@/components/ui/form";
import { cn } from "@/lib/utils/format";

const STYLE_OPTIONS: Array<{ value: WordStyle; label: string; title: string }> = [
  { value: "standard", label: "Standard words", title: "Root combined with curated English words." },
  { value: "natural-compound", label: "Natural compounds", title: "Reads like everyday English (PayNest, HomeRoom)." },
  { value: "keyword-industry", label: "Industry terms", title: "Root plus vocabulary from the selected industries." },
  { value: "keyword-brand-prefix", label: "Brand prefix", title: "Modifier first: NovaPay, CloudPay." },
  { value: "keyword-brand-suffix", label: "Brand suffix", title: "Modifier last: PayNest, PayPilot." },
  { value: "compound", label: "Compound words", title: "Two-word compounds built from the dictionaries." },
  { value: "portmanteau", label: "Portmanteau", title: "Syllable-boundary blends that keep the root readable." },
  { value: "invented", label: "Invented", title: "Phonetic construction around the root." },
  { value: "pseudo-word", label: "Pseudo-words", title: "Pronounceable non-words with vowel structure." },
  { value: "short-abstract", label: "Short abstract", title: "Four to six letter abstract forms." },
  { value: "exact-combination", label: "Exact keyword", title: "The root verbatim, optionally with a short morpheme." },
  { value: "ai-assisted", label: "AI-assisted", title: "Only runs when an AI provider is configured; results pass the same validation." },
];

const POSITION_OPTIONS: Array<{ value: KeywordPosition; label: string; title: string }> = [
  { value: "prefix", label: "Prefix", title: "Modifier before the root: NovaPay" },
  { value: "suffix", label: "Suffix", title: "Modifier after the root: PayNest" },
  { value: "both", label: "Both", title: "Generate both directions" },
  { value: "exact", label: "Exact", title: "The root on its own" },
  { value: "flexible", label: "Flexible", title: "Allow blends and mixed placements" },
];

/** Partner-length choices offered by the UI. 2–5 letters cover the useful range in practice. */
const PARTNER_LENGTHS = [2, 3, 4, 5] as const;

/** An example partner word for the tooltip on each length chip. */
function examplePartner(length: number): string {
  const samples: Record<number, string> = { 2: "up, io", 3: "hub, neo", 4: "nova, wave", 5: "spark, orbit" };
  return samples[length] ?? "";
}

export type GeneratorFormState = {
  /** Exactly one root. A single keyword produces a coherent result list; several produce
   *  interleaved lists where the quantity per root is impossible to reason about. */
  roots: string[];
  /** Allowed alphabetic length of the partner word (2/3/4/5). Empty = any length. */
  partnerLengths: number[];
  position: KeywordPosition;
  styles: WordStyle[];
  industries: string[];
  customPrefixes: string[];
  customSuffixes: string[];
  prefixLibraries: string[];
  suffixLibraries: string[];
  autoExpand: boolean;
  expandIndustries: boolean;
  targetCount: number;
  tlds: string[];
  lengthPreset: LengthPreset;
  minLength: number;
  maxLength: number;
  maxComponents: number;
  allowHyphens: boolean;
  allowNumbers: boolean;
  minVowelRatio: number;
  maxConsonantCluster: number;
  maxSyllables: number;
  requiredSubstring: string;
  excludedSubstringInput: string;
  excludedWordsInput: string;
  brandable: boolean;
  brandableProfiles: BrandableProfileId[];
};

export function formStateFromRequest(request: GenerationRequest, preset: LengthPreset): GeneratorFormState {
  return {
    roots: request.roots,
    partnerLengths: request.partnerLengths,
    position: request.position,
    styles: request.styles,
    industries: request.industries,
    customPrefixes: request.customPrefixes,
    customSuffixes: request.customSuffixes,
    prefixLibraries: request.prefixLibraries,
    suffixLibraries: request.suffixLibraries,
    autoExpand: request.autoExpand,
    expandIndustries: request.expandIndustries,
    targetCount: request.targetCount,
    tlds: request.tlds,
    lengthPreset: preset,
    minLength: request.constraints.minLength,
    maxLength: request.constraints.maxLength,
    maxComponents: request.constraints.maxComponents,
    allowHyphens: request.constraints.allowHyphens,
    allowNumbers: request.constraints.allowNumbers,
    minVowelRatio: request.constraints.minVowelRatio,
    maxConsonantCluster: request.constraints.maxConsonantCluster,
    maxSyllables: request.constraints.maxSyllables,
    requiredSubstring: request.constraints.requiredSubstring ?? "",
    excludedSubstringInput: request.constraints.excludedSubstrings.join(", "),
    excludedWordsInput: request.constraints.excludedWords.join(", "),
    brandable: request.brandable,
    brandableProfiles: request.brandableProfiles,
  };
}

export function requestFromFormState(state: GeneratorFormState): GenerationRequest {
  return {
    roots: state.roots.slice(0, 1),
    partnerLengths: state.partnerLengths,
    position: state.position,
    styles: state.styles.length > 0 ? state.styles : ["standard"],
    grammar: "recognized",
    industries: state.industries,
    expandIndustries: state.expandIndustries,
    customPrefixes: state.customPrefixes,
    customSuffixes: state.customSuffixes,
    prefixLibraries: state.prefixLibraries,
    suffixLibraries: state.suffixLibraries,
    autoExpand: state.autoExpand,
    targetCount: state.targetCount,
    constraints: {
      minLength: state.minLength,
      maxLength: state.maxLength,
      maxWordLength: 12,
      maxComponents: state.maxComponents,
      allowHyphens: state.allowHyphens,
      allowNumbers: state.allowNumbers,
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
    tlds: state.tlds.length > 0 ? state.tlds : ["com"],
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

export function GeneratorControls({
  state,
  onChange,
  onGenerate,
  onReset,
  busy,
  error,
}: {
  state: GeneratorFormState;
  onChange: (next: GeneratorFormState) => void;
  onGenerate: () => void;
  onReset: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const set = <K extends keyof GeneratorFormState>(key: K, value: GeneratorFormState[K]) =>
    onChange({ ...state, [key]: value });

  const industryOptions = useMemo(
    () => INDUSTRIES.map((industry) => ({ value: industry.id, label: industry.name, title: industry.description })),
    [],
  );

  const selectedTlds = TLD_DIRECTORY.filter((record) => state.tlds.includes(record.tld));

  const lengthError =
    state.minLength > state.maxLength
      ? "Minimum length cannot be greater than the maximum."
      : state.maxLength > 24
        ? "Labels longer than 24 characters are not valid."
        : null;

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        onGenerate();
      }}
    >
      <RootField state={state} onChange={onChange} />

      <NamingStyleField state={state} onChange={onChange} />

      <Field
        label="Partner root length"
        description="How many letters the added word may have — the root itself is not counted. Select several to search them together; leave empty for any length."
      >
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Partner root length">
          {PARTNER_LENGTHS.map((length) => {
            const active = state.partnerLengths.includes(length);
            return (
              <button
                key={length}
                type="button"
                role="checkbox"
                aria-checked={active}
                onClick={() => set("partnerLengths", toggle(state.partnerLengths, length))}
                title={`Partner words of exactly ${length} letters, e.g. ${examplePartner(length)}`}
                className={cn(
                  "h-8 min-w-11 rounded-[var(--radius-sm)] border px-2.5 text-xs font-medium tabular-nums transition-colors",
                  active
                    ? "border-accent bg-accent-soft text-accent-soft-fg"
                    : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
                )}
              >
                {length}
              </button>
            );
          })}
          {state.partnerLengths.length > 0 ? (
            <button
              type="button"
              onClick={() => set("partnerLengths", [])}
              className="h-8 rounded-[var(--radius-sm)] px-2 text-[11px] text-fg-subtle underline-offset-2 hover:text-fg hover:underline"
            >
              Any length
            </button>
          ) : null}
        </div>
      </Field>

      <Field
        label="Industries"
        description="Selecting industries limits semantic expansion to that vocabulary. Leave empty to let the engine detect industries from your keyword."
      >
        <ChipGroup
          label="Industries"
          options={industryOptions}
          selected={state.industries}
          onToggle={(value) => set("industries", toggle(state.industries, value))}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Name length"
          description="Label length in characters — the dot and TLD are excluded."
          error={lengthError}
        >
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {LENGTH_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    onChange({
                      ...state,
                      lengthPreset: preset.id,
                      minLength: preset.min,
                      maxLength: preset.max,
                    })
                  }
                  className={cn(
                    "rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs font-medium",
                    state.lengthPreset === preset.id
                      ? "border-accent bg-accent-soft text-accent-soft-fg"
                      : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <NumberInput
                label="Min"
                value={state.minLength}
                min={2}
                max={24}
                onChange={(value) => onChange({ ...state, minLength: value, lengthPreset: "custom" })}
              />
              <NumberInput
                label="Max"
                value={state.maxLength}
                min={2}
                max={24}
                onChange={(value) => onChange({ ...state, maxLength: value, lengthPreset: "custom" })}
              />
            </div>
          </div>
        </Field>

        <div className="space-y-3">
          <Field
            label="Number of names"
            description="The engine returns exactly this many when the active filters can supply them, and tells you why when they cannot."
          >
            <Select
              value={String(state.targetCount)}
              onChange={(event) => set("targetCount", Number(event.target.value))}
              aria-label="Target result count"
            >
              {[25, 50, 100, 250, 500, 1000].map((count) => (
                <option key={count} value={count}>
                  {count} names
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Extensions"
            description="Availability is checked separately and only for extensions with a working provider."
          >
            <ChipGroup
              label="Extensions"
              options={TLD_DIRECTORY.filter((record) => record.enabled || state.tlds.includes(record.tld)).map(
                (record) => ({ value: record.tld, label: record.displayName, title: record.description }),
              )}
              selected={state.tlds}
              onToggle={(value) => {
                const next = toggle(state.tlds, value);
                set("tlds", next.length > 0 ? next : ["com"]);
              }}
            />
          </Field>
        </div>
      </div>

      <div className="rounded-[var(--radius)] border border-border bg-surface-2/60 p-3">
        <Switch
          checked={state.brandable}
          onChange={(value) => set("brandable", value)}
          label="Brandable mode"
          description="Re-ranks results on brandability (pronounceability, memorability, distinctiveness) instead of descriptive quality."
        />
        {state.brandable ? (
          <div className="mt-3 space-y-2 border-t border-border pt-3">
            <p className="text-xs font-medium text-fg-muted">Brandable profiles</p>
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
            <Callout tone="info" className="mt-2">
              Brandability is a documented heuristic. It says nothing about availability, trademark
              clearance or resale value.
            </Callout>
          </div>
        ) : null}
      </div>

      <div className="rounded-[var(--radius)] border border-border">
        <button
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
          aria-expanded={advancedOpen}
          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[13px] font-medium text-fg"
        >
          <span className="flex items-center gap-2">
            <Wand2 className="size-4 text-fg-subtle" aria-hidden="true" />
            Advanced controls
          </span>
          <ChevronDown className={cn("size-4 text-fg-subtle transition-transform", advancedOpen && "rotate-180")} />
        </button>
        {advancedOpen ? (
          <div className="space-y-4 border-t border-border p-3">
            {/* The raw engine vocabulary lives here. The naming-style control above sets these
                two fields for you; editing them directly is the escape hatch for a precise
                combination the presets do not cover. */}
            <Field label="Keyword position" description="Where the root keyword sits inside each generated name.">
              <SegmentedControl
                label="Keyword position"
                value={state.position}
                onChange={(value) => set("position", value)}
                options={POSITION_OPTIONS}
              />
            </Field>

            <Field
              label="Word styles"
              description="Enable any combination. Styles that need an AI provider stay inactive until one is configured."
            >
              <ChipGroup
                label="Word styles"
                options={STYLE_OPTIONS}
                selected={state.styles}
                onToggle={(value) => set("styles", toggle(state.styles, value))}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Components" description="Maximum word components in a label.">
                <Select
                  value={String(state.maxComponents)}
                  onChange={(event) => set("maxComponents", Number(event.target.value))}
                  aria-label="Maximum components"
                >
                  {[1, 2, 3, 4].map((count) => (
                    <option key={count} value={count}>
                      {count} component{count === 1 ? "" : "s"}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Syllables" description="0 disables the check.">
                <NumberInput
                  label="Max"
                  value={state.maxSyllables}
                  min={0}
                  max={8}
                  onChange={(value) => set("maxSyllables", value)}
                />
              </Field>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Switch
                checked={state.allowHyphens}
                onChange={(value) => set("allowHyphens", value)}
                label="Allow hyphens"
                description="Off by default: hyphenated names are harder to say and type."
              />
              <Switch
                checked={state.allowNumbers}
                onChange={(value) => set("allowNumbers", value)}
                label="Allow numbers"
                description="Off by default."
              />
              <Switch
                checked={state.autoExpand}
                onChange={(value) => set("autoExpand", value)}
                label="Auto-expand dictionaries"
                description="When off, only your custom prefixes and suffixes are used."
              />
              <Switch
                checked={state.expandIndustries}
                onChange={(value) => set("expandIndustries", value)}
                label="Semantic expansion"
                description="Pull related industry vocabulary into the candidate pool."
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Minimum vowel ratio" description={`${Math.round(state.minVowelRatio * 100)}% — 0 disables the rule.`}>
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
              <Field label="Max consonant run" description="0 disables the check.">
                <NumberInput
                  label="Max"
                  value={state.maxConsonantCluster}
                  min={0}
                  max={6}
                  onChange={(value) => set("maxConsonantCluster", value)}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Custom prefixes" description="Added to the prefix pool.">
                <TagInput
                  label="Custom prefixes"
                  value={state.customPrefixes}
                  onChange={(next) => set("customPrefixes", next)}
                  placeholder="velo, kira…"
                  max={SANE_LIMITS.maxCustomWords}
                />
              </Field>
              <Field label="Custom suffixes" description="Added to the suffix pool.">
                <TagInput
                  label="Custom suffixes"
                  value={state.customSuffixes}
                  onChange={(next) => set("customSuffixes", next)}
                  placeholder="ly, ify…"
                  max={SANE_LIMITS.maxCustomWords}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Prefix libraries">
                <ChipGroup
                  label="Prefix libraries"
                  options={PREFIX_LIBRARIES.map((library) => ({ value: library.id, label: library.name, title: library.description }))}
                  selected={state.prefixLibraries}
                  onToggle={(value) => set("prefixLibraries", toggle(state.prefixLibraries, value))}
                />
              </Field>
              <Field label="Suffix libraries">
                <ChipGroup
                  label="Suffix libraries"
                  options={SUFFIX_LIBRARIES.map((library) => ({ value: library.id, label: library.name, title: library.description }))}
                  selected={state.suffixLibraries}
                  onToggle={(value) => set("suffixLibraries", toggle(state.suffixLibraries, value))}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
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
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-[13px] font-medium text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="lg" loading={busy} loadingLabel="Generating…" className="flex-1 sm:flex-none">
          <Sparkles className="size-4" aria-hidden="true" />
          Generate names
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={onReset}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Reset
        </Button>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-fg-subtle">
          <Badge tone="outline">{state.tlds.length} TLD{state.tlds.length === 1 ? "" : "s"}</Badge>
          <Badge tone="outline">
            {state.styles.length} style{state.styles.length === 1 ? "" : "s"}
          </Badge>
        </div>
      </div>
      {selectedTlds.length > 0 ? (
        <p className="text-[11px] leading-relaxed text-fg-subtle">
          Checking capability:{" "}
          {selectedTlds.map((record) => `${record.displayName} ${record.checkability === "rdap" ? "RDAP" : record.checkability}`).join(" · ")}.
          Availability is never inferred from this list.
        </p>
      ) : null}
      <p className="text-[11px] text-fg-subtle">
        Default extensions: {DEFAULT_TLDS.slice(0, 4).map((tld) => `.${tld}`).join(" ")} · engine runs entirely in your
        browser.
      </p>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Root keyword                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One root, enforced.
 *
 * The engine can process several roots, but a result list built from several keywords cannot
 * answer "how many good names does *this* word produce" — it interleaves lists, splits the
 * quantity between them and makes the partner-length filter meaningless. The field therefore
 * accepts exactly one keyword and says plainly what it did with the rest.
 */
function RootField({
  state,
  onChange,
}: {
  state: GeneratorFormState;
  onChange: (next: GeneratorFormState) => void;
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
      onChange({ ...state, roots: [tokens[0]!] });
      return;
    }
    onChange({ ...state, roots: tokens.length > 0 ? [tokens[0]!] : [] });
  };

  const keyword = normalizeKeyword(current);
  const error = current && !keyword.valid ? (keyword.reason ?? "Not a usable keyword.") : null;

  return (
    <div className="space-y-1.5">
      <Field
        label="Root keyword"
        htmlFor="root"
        required
        error={error}
        description="The word the names are built around. One root produces a coherent list and an exact count."
      >
        <Input
          id="root"
          value={current}
          onChange={(event) => commit(event.target.value)}
          placeholder="pay"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          invalid={Boolean(error)}
          className="h-11 text-base"
          aria-describedby={notice ? "root-notice" : undefined}
        />
      </Field>

      {notice ? (
        <p id="root-notice" role="status" className="text-xs font-medium text-warn">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {["pay", "home", "cloud", "ai", "shop", "stream"].map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => {
              setNotice(null);
              onChange({ ...state, roots: [example] });
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
/* Naming styles                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Naming styles, with a recommendation derived from the root's shape.
 *
 * The mapping into engine terms lives in `naming-styles.ts`: each chip sets real word styles and a
 * keyword position, and "compounds" raises the component limit to three because a compound is
 * three parts by definition. Selecting nothing is not allowed — an empty style list would make
 * the generator return only the bare root.
 */
function NamingStyleField({
  state,
  onChange,
}: {
  state: GeneratorFormState;
  onChange: (next: GeneratorFormState) => void;
}) {
  const root = state.roots[0] ?? "";
  const recommendation = useMemo(() => recommendNamingStyles(root), [root]);
  const selected = useMemo(() => namingStylesInState(state), [state]);

  const apply = (ids: NamingStyleId[]) => {
    const engine = engineForNamingStyles(ids);
    onChange({
      ...state,
      styles: engine.styles,
      position: engine.position,
      // Never lower a limit the user raised by hand; only raise it for compounds.
      maxComponents: Math.max(state.maxComponents, engine.maxComponents),
    });
  };

  return (
    <Field
      label="Naming styles"
      description="How each name is assembled. The chips set the word styles and keyword position used by the engine."
      labelAction={
        root && recommendation.styles.length > 0 ? (
          <button
            type="button"
            onClick={() => apply(recommendation.styles)}
            className="text-[11px] font-medium text-accent hover:underline"
            title={recommendation.reason}
          >
            Use recommended
          </button>
        ) : null
      }
    >
      <div className="space-y-2">
        <div className="grid gap-1.5 sm:grid-cols-2">
          {NAMING_STYLES.map((style) => {
            const active = selected.includes(style.id);
            const recommended = recommendation.styles.includes(style.id);
            return (
              <button
                key={style.id}
                type="button"
                role="checkbox"
                aria-checked={active}
                onClick={() => {
                  const next = active ? selected.filter((id) => id !== style.id) : [...selected, style.id];
                  apply(next.length > 0 ? next : [style.id]);
                }}
                className={cn(
                  "rounded-[var(--radius)] border px-2.5 py-2 text-left transition-colors",
                  active
                    ? "border-accent bg-accent-soft/60 text-fg"
                    : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">{style.label}</span>
                  {recommended ? (
                    <Badge tone="accent" className="text-[10px]">
                      Suggested
                    </Badge>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-fg-subtle">{style.description}</span>
                <span className="mt-1 block font-mono text-[11px] text-fg-muted">{style.example(root || "root")}</span>
              </button>
            );
          })}
        </div>
        {root && recommendation.reason ? (
          <p className="text-[11px] leading-relaxed text-fg-subtle">{recommendation.reason}</p>
        ) : null}
      </div>
    </Field>
  );
}
