import { Link } from 'react-router-dom'
import { ChevronRight, Home } from 'lucide-react'

export interface Crumb {
  label: string
  to?: string
}

export const Breadcrumbs = ({ items, className = '' }: { items: Crumb[]; className?: string }) => {
  const all: Crumb[] = [{ label: 'Home', to: '/' }, ...items]

  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted sm:text-[0.8125rem]">
        {all.map((item, index) => {
          const isLast = index === all.length - 1
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {index > 0 ? (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted/60" aria-hidden="true" />
              ) : null}
              {item.to && !isLast ? (
                <Link
                  to={item.to}
                  className="inline-flex items-center gap-1 rounded transition-colors hover:text-brand-700 dark:hover:text-brand-300"
                >
                  {index === 0 ? <Home className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                  <span className={index === 0 ? 'sr-only sm:not-sr-only' : ''}>{item.label}</span>
                </Link>
              ) : (
                <span aria-current={isLast ? 'page' : undefined} className="font-medium text-ink">
                  {item.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
