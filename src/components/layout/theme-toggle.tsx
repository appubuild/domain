"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeMode } from "@/components/theme/theme-provider";
import { cn } from "@/lib/utils/format";

const OPTIONS: Array<{ mode: ThemeMode; label: string; icon: React.ReactNode }> = [
  { mode: "light", label: "Light", icon: <Sun className="size-3.5" /> },
  { mode: "dark", label: "Dark", icon: <Moon className="size-3.5" /> },
  { mode: "system", label: "System", icon: <Monitor className="size-3.5" /> },
];

/** Three-way theme control (light / dark / follow system). */
export function ThemeToggle({ className }: { className?: string }) {
  const { mode, setMode } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-2 p-0.5",
        className,
      )}
    >
      {OPTIONS.map((option) => {
        const active = mode === option.mode;
        return (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${option.label} theme`}
            title={`${option.label} theme`}
            onClick={() => setMode(option.mode)}
            className={cn(
              "rounded-full p-1.5 transition-colors",
              active
                ? "bg-surface text-fg shadow-xs"
                : "text-fg-subtle hover:text-fg",
            )}
          >
            {option.icon}
          </button>
        );
      })}
    </div>
  );
}
