"use client";

/**
 * Landing-page generator entry point.
 *
 * The hero input has to *do* something, so it is the real generator's front door rather than a
 * decorative field: submitting navigates to `/generator/?q=<word>`, which is exactly the URL the
 * generator parses on load (`src/lib/generator/url-state.ts`). Nothing is duplicated here — no
 * second form state model, no second generation path — so what the visitor sees after pressing
 * "Generate" is the product, pre-filled with their word.
 *
 * The form is a real `GET` form rather than a `router.push` call: it works before hydration and
 * with JavaScript disabled, and a navigation into a different route is a document load anyway.
 * The script only adds the two things a native form cannot do — telling you why a one-letter root
 * will not work, and filling the field from the suggestion chips.
 */

import { useId, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/utils/format";

const SUGGESTIONS = ["pay", "cloud", "fit", "nest"];

export function HeroSearch({ autoFocus = false }: { autoFocus?: boolean }) {
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    const root = value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (root.length < 2) {
      // Only block the native submission when there is something to explain.
      event.preventDefault();
      setError("Use at least two letters — that is the root the generator builds from.");
      return;
    }
    setError(null);
  };

  return (
    <div className="w-full max-w-xl">
      <form action="/generator/" method="get" onSubmit={submit} noValidate className="space-y-2">
        <label htmlFor={inputId} className="block text-[13px] font-medium text-fg">
          What is the name for?
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={inputId}
            name="q"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
            placeholder="e.g. pay, cloud, fit"
            autoComplete="off"
            autoFocus={autoFocus}
            inputMode="text"
            maxLength={48}
            invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            className="h-11 sm:flex-1"
          />
          <Button type="submit" size="lg" className="h-11 shrink-0">
            <Sparkles className="size-4" aria-hidden="true" />
            Generate names
          </Button>
        </div>
        {error ? (
          <p id={errorId} role="alert" className="text-xs font-medium text-danger">
            {error}
          </p>
        ) : (
          <p className="text-xs text-fg-subtle">
            One root is enough. Add a second word, styles, letter lengths and extensions once the
            generator opens — everything there is a real control, not a mock-up.
          </p>
        )}
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wide text-fg-subtle">Try</span>
        {SUGGESTIONS.map((word) => (
          <button
            key={word}
            type="button"
            onClick={() => {
              setValue(word);
              setError(null);
            }}
            className={cn(
              "rounded-full border border-border px-2.5 py-0.5 text-xs text-fg-muted transition-colors",
              "hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
            )}
          >
            {word}
          </button>
        ))}
        <a
          href="/generator/"
          className="ml-1 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
        >
          Open the full generator
          <ArrowRight className="size-3" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
