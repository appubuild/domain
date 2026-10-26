"use client";

import { useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn, shortId } from "@/lib/utils/format";
import { Badge } from "./primitives";

/* ------------------------------------------------------------------------------------
 * Field wrapper — provides the label/description/error plumbing for every control.
 * ---------------------------------------------------------------------------------- */

export function Field({
  label,
  htmlFor,
  description,
  error,
  hint,
  required,
  children,
  className,
  labelAction,
}: {
  label?: string;
  htmlFor?: string;
  description?: React.ReactNode;
  error?: string | null;
  hint?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
  labelAction?: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={htmlFor} className="text-[13px] font-medium text-fg">
            {label}
            {required ? (
              <span className="ml-0.5 text-danger" aria-hidden="true">
                *
              </span>
            ) : null}
          </label>
          {labelAction}
        </div>
      ) : null}
      {children}
      {description && !error ? (
        <p className="text-xs leading-relaxed text-fg-subtle">{description}</p>
      ) : null}
      {hint && !error ? <div className="text-xs text-fg-subtle">{hint}</div> : null}
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const controlBase =
  "w-full rounded-[var(--radius)] border bg-surface text-fg placeholder:text-fg-subtle " +
  "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 " +
  "focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]";

export function Input({
  className,
  invalid,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={cn(
        controlBase,
        "h-10 px-3 text-sm",
        invalid ? "border-danger focus-visible:outline-danger" : "border-border-strong hover:border-fg-subtle/50",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export function Textarea({
  className,
  invalid,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={cn(
        controlBase,
        "min-h-24 resize-y px-3 py-2 text-sm leading-relaxed",
        invalid ? "border-danger" : "border-border-strong hover:border-fg-subtle/50",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export function Select({
  className,
  invalid,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      className={cn(
        controlBase,
        "h-10 appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pl-3 pr-9 text-sm",
        "bg-[image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23888%22 stroke-width=%222%22><path d=%22M6 9l6 6 6-6%22/></svg>')]",
        invalid ? "border-danger" : "border-border-strong hover:border-fg-subtle/50",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    >
      {children}
    </select>
  );
}

export function Checkbox({
  label,
  description,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode; description?: string }) {
  const id = useId();
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <input
        id={props.id ?? id}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded-[4px] border-border-strong accent-[var(--accent)]"
        {...props}
      />
      <div className="min-w-0 space-y-0.5">
        <label
          htmlFor={props.id ?? id}
          className="cursor-pointer text-[13px] font-medium leading-5 text-fg"
        >
          {label}
        </label>
        {description ? <p className="text-xs text-fg-subtle">{description}</p> : null}
      </div>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: React.ReactNode;
  description?: string;
  disabled?: boolean;
  id?: string;
}) {
  const autoId = useId();
  const switchId = id ?? autoId;
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={switchId} className="cursor-pointer text-[13px] font-medium text-fg">
          {label}
        </label>
        {description ? <p className="mt-0.5 text-xs text-fg-subtle">{description}</p> : null}
      </div>
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-150 disabled:opacity-50",
          checked ? "border-transparent bg-accent" : "border-border-strong bg-surface-3",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-3.5 rounded-full bg-white shadow-xs transition-[left] duration-150",
            checked ? "left-[1.15rem]" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}

/** Segmented single-choice control (used for keyword position, sort, etc.). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
  size = "md",
}: {
  options: Array<{ value: T; label: string; icon?: React.ReactNode; title?: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex flex-wrap items-center gap-0.5 rounded-[var(--radius)] border border-border bg-surface-2 p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-sm font-medium transition-colors",
              size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-3 text-[13px]",
              active
                ? "bg-surface text-fg shadow-xs"
                : "text-fg-muted hover:bg-surface/60 hover:text-fg",
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Multi-select chips (word styles, industries, TLDs). */
export function ChipGroup<T extends string>({
  options,
  selected,
  onToggle,
  label,
  columns,
  disabledValues,
}: {
  options: Array<{ value: T; label: string; title?: string; count?: number }>;
  selected: T[];
  onToggle: (value: T) => void;
  label: string;
  columns?: boolean;
  disabledValues?: T[];
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex flex-wrap gap-1.5", columns && "grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap")}
    >
      {options.map((option) => {
        const active = selected.includes(option.value);
        const disabled = disabledValues?.includes(option.value) ?? false;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            title={option.title}
            onClick={() => onToggle(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              disabled && "cursor-not-allowed opacity-40",
              active
                ? "border-accent/40 bg-accent-soft text-accent-soft-fg"
                : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
            )}
          >
            {option.label}
            {typeof option.count === "number" ? (
              <span className="tnum text-[10px] opacity-70">{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Tag/chip input used for root keywords, custom prefixes/suffixes and excluded words.
 * Enter or comma commits a tag; Backspace on an empty field removes the last one.
 */
export function TagInput({
  value,
  onChange,
  placeholder,
  label,
  max = 24,
  maxLength = 40,
  validate,
  id,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  label: string;
  max?: number;
  maxLength?: number;
  validate?: (raw: string) => string | null;
  id?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const generatedId = useId();
  const inputId = id ?? generatedId;

  function commit(raw: string) {
    const pieces = raw
      .split(/[,\n]/)
      .map((piece) => piece.trim())
      .filter(Boolean);
    if (pieces.length === 0) return;

    const accepted: string[] = [];
    let firstError: string | null = null;

    for (const piece of pieces) {
      if (piece.length > maxLength) {
        firstError ??= `“${piece.slice(0, 12)}…” is longer than ${maxLength} characters.`;
        continue;
      }
      const message = validate?.(piece) ?? null;
      if (message) {
        firstError ??= message;
        continue;
      }
      const duplicate = [...value, ...accepted].some(
        (item) => item.toLowerCase() === piece.toLowerCase(),
      );
      if (duplicate) continue;
      if (value.length + accepted.length >= max) {
        firstError ??= `You can add at most ${max} entries.`;
        break;
      }
      accepted.push(piece);
    }

    if (accepted.length > 0) onChange([...value, ...accepted]);
    setError(firstError);
    setDraft(firstError ? raw : "");
    if (!firstError) setDraft("");
  }

  return (
    <div className="space-y-1.5">
      <div
        className={cn(
          "flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-[var(--radius)] border bg-surface px-2 py-1.5",
          "focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-[var(--ring)]",
          error ? "border-danger" : "border-border-strong",
          disabled && "opacity-60",
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <Badge key={tag} tone="accent" className="gap-1 py-0.5 pl-2 pr-1">
            <span className="max-w-[14rem] truncate font-mono text-[11px]">{tag}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={(event) => {
                event.stopPropagation();
                onChange(value.filter((item) => item !== tag));
              }}
              className="rounded-full p-0.5 hover:bg-accent-soft-fg/10"
              aria-label={`Remove ${tag}`}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        <input
          ref={inputRef}
          id={inputId}
          aria-label={label}
          value={draft}
          disabled={disabled}
          maxLength={maxLength * 4}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              commit(draft);
            } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (draft.trim()) commit(draft);
          }}
          placeholder={value.length === 0 ? placeholder : "Add another…"}
          className="h-7 min-w-[7rem] flex-1 bg-transparent px-1 text-sm text-fg outline-none placeholder:text-fg-subtle"
        />
      </div>
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : (
        <p className="text-xs text-fg-subtle">
          Press Enter or comma to add. {value.length}/{max} used.
        </p>
      )}
      <span className="hidden" data-tag-input-marker={shortId(4)} />
    </div>
  );
}

/** Small inline numeric stepper + range pair used by length constraints. */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  id,
  suffix,
}: {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  id?: string;
  suffix?: string;
}) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={inputId} className="text-xs text-fg-subtle">
        {label}
      </label>
      <input
        id={inputId}
        type="number"
        inputMode="numeric"
        className={cn(controlBase, "tnum h-8 w-16 px-2 text-sm", "border-border-strong")}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const raw = Number(event.target.value);
          if (Number.isNaN(raw)) return;
          onChange(Math.min(max, Math.max(min, Math.round(raw))));
        }}
      />
      {suffix ? <span className="text-xs text-fg-subtle">{suffix}</span> : null}
    </div>
  );
}
