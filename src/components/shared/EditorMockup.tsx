import { cn } from '@/lib/utils';

/**
 * Static, presentation-only illustration of the editor workspace used on marketing pages.
 * The real editor lives in src/pages/editor and shares the same visual language.
 */
export function EditorMockup({ mode = 'write', className }: { mode?: 'write' | 'design' | 'preview'; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-xl border border-border bg-card shadow-page', className)} aria-hidden>
      <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-3 py-2">
        <span className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-destructive/50" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/50" />
        </span>
        <span className="ml-2 truncate text-2xs font-medium text-muted-foreground">The Ledger of Small Things · Part Two, Chapter 7</span>
        <span className="ml-auto rounded-md bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">Saved just now</span>
      </div>
      <div className="flex min-h-[300px]">
        <div className="hidden w-[168px] shrink-0 border-r border-border bg-sidebar p-3 sm:block">
          <div className="mb-3 flex gap-1">
            {['Pages', 'Chapters', 'Elements'].map((tab, index) => (
              <span key={tab} className={cn('rounded px-1.5 py-0.5 text-[10px]', index === 0 ? 'bg-primary/15 text-primary' : 'text-muted-foreground')}>
                {tab}
              </span>
            ))}
          </div>
          <ul className="space-y-1.5">
            {['Front matter', 'Chapter 1 — Arrivals', 'Chapter 2 — The Ledger', 'Chapter 3 — Small Things', 'Chapter 4 — Departures', 'Back matter'].map((entry, index) => (
              <li key={entry} className={cn('truncate rounded px-2 py-1 text-[10px]', index === 2 ? 'bg-sidebar-accent text-foreground' : 'text-muted-foreground')}>
                {index + 1}. {entry}
              </li>
            ))}
          </ul>
          <div className="mt-3 rounded-lg border border-border bg-card p-2">
            <p className="text-[10px] font-medium text-foreground">Chapter target</p>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full w-[68%] rounded-full bg-primary" />
            </div>
            <p className="mt-1 text-[9px] text-muted-foreground">2,040 / 3,000 words</p>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 items-start justify-center bg-muted/30 p-4 sm:p-6">
          {mode === 'design' ? (
            <div className="relative h-[260px] w-[190px] shrink-0 bg-white p-3 shadow-page ring-1 ring-border">
              <div className="absolute inset-x-3 top-3 h-10 rounded bg-primary/15" />
              <div className="absolute left-3 top-16 h-20 w-20 rounded bg-accent/25" />
              <div className="absolute right-3 top-16 h-20 w-16 rounded border border-dashed border-primary/50" />
              <div className="mt-24 space-y-1.5">
                {[92, 88, 96, 78, 90, 84].map((width, index) => (
                  <div key={index} className="h-1.5 rounded bg-slate-200" style={{ width: `${width}%` }} />
                ))}
              </div>
              <div className="absolute -left-1 top-14 h-5 w-5 rounded-sm border-2 border-primary bg-white" />
              <div className="absolute -left-px -top-px h-2 w-2 rounded-full border-2 border-primary bg-white" />
            </div>
          ) : mode === 'preview' ? (
            <div className="flex gap-2">
              {[0, 1].map((spread) => (
                <div key={spread} className="h-[260px] w-[168px] shrink-0 bg-white p-3 shadow-page ring-1 ring-border">
                  <p className="mb-2 text-[8px] uppercase tracking-widest text-slate-400">{spread === 0 ? 'Chapter Seven' : 'The Ledger of Small Things'}</p>
                  <div className="space-y-1.5">
                    {[96, 92, 88, 94, 70, 90, 84, 92, 60, 88, 76, 90, 82, 68].map((width, index) => (
                      <div key={index} className="h-1 rounded bg-slate-200" style={{ width: `${width}%` }} />
                    ))}
                  </div>
                  <p className="mt-2 text-center text-[8px] text-slate-400">{spread === 0 ? 84 : 85}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="w-full max-w-[430px] bg-white p-6 shadow-page ring-1 ring-border">
              <p className="mb-3 font-serif text-sm font-semibold text-slate-800">Chapter Seven — The Ledger of Small Things</p>
              <div className="space-y-2">
                {[100, 96, 92, 98, 88, 94, 90, 96, 62, 100, 94, 90, 86].map((width, index) => (
                  <div key={index} className={cn('h-1.5 rounded bg-slate-200', index === 6 && 'bg-primary/40')} style={{ width: `${width}%` }} />
                ))}
              </div>
              <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
                <span className="h-5 w-5 rounded-full bg-primary/20" />
                <span className="text-[10px] text-slate-400">Continue here — cursor at 2,040 words</span>
              </div>
            </div>
          )}
        </div>

        <div className="hidden w-[176px] shrink-0 border-l border-border bg-card p-3 lg:block">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Context</p>
          <div className="space-y-2">
            <div className="rounded-lg border border-border p-2">
              <p className="text-[10px] font-medium text-foreground">Text style</p>
              <p className="text-[9px] text-muted-foreground">Body · Source Serif 4 11/16pt</p>
            </div>
            <div className="rounded-lg border border-border p-2">
              <p className="text-[10px] font-medium text-foreground">Page geometry</p>
              <p className="text-[9px] text-muted-foreground">6×9in · gutter 0.75in · bleed 0.125in</p>
            </div>
            <div className="rounded-lg border border-border p-2">
              <p className="text-[10px] font-medium text-foreground">Preflight</p>
              <p className="text-[9px] text-success">22 checks passed · 1 warning</p>
            </div>
          </div>
          <div className="mt-3 rounded-lg bg-primary/5 p-2">
            <p className="text-[10px] font-medium text-primary">AI assistant</p>
            <p className="mt-0.5 text-[9px] leading-relaxed text-muted-foreground">
              “You have shifted tense twice in this scene. Rewrite in past tense?”
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
