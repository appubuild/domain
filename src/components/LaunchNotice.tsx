import type { ReactNode } from 'react'
import { Info } from 'lucide-react'

interface LaunchNoticeProps {
  title?: string
  children: ReactNode
}

/**
 * Small, clearly-labeled setup note. Controlled by SITE.showLaunchNotices so it
 * disappears once the owner finalizes business details and compliance review.
 */
export const LaunchNotice = ({ title = 'Before launch', children }: LaunchNoticeProps) => (
  <aside className="not-prose my-8 rounded-xl border border-amber-500/30 bg-amber-50/70 p-4 sm:p-5 dark:border-amber-400/25 dark:bg-amber-400/10">
    <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-amber-800 dark:text-amber-200">
      <Info className="h-4 w-4" aria-hidden="true" />
      {title}
    </p>
    <div className="mt-2 space-y-2 text-sm leading-6 text-amber-900/90 dark:text-amber-100/90">{children}</div>
  </aside>
)
