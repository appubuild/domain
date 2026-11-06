import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/components/ThemeProvider'

interface ThemeToggleProps {
  className?: string
  /** Full-width label variant used inside the mobile drawer. */
  withLabel?: boolean
}

export const ThemeToggle = ({ className = '', withLabel = false }: ThemeToggleProps) => {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode'

  if (withLabel) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        className={`flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm font-semibold text-ink transition-colors hover:bg-soft ${className}`}
      >
        <span className="flex items-center gap-2.5">
          {isDark ? <Moon className="h-4 w-4" aria-hidden="true" /> : <Sun className="h-4 w-4" aria-hidden="true" />}
          {isDark ? 'Dark mode' : 'Light mode'}
        </span>
        <span
          className={`relative h-6 w-11 rounded-full transition-colors ${isDark ? 'bg-brand-600' : 'bg-navy-200'}`}
          aria-hidden="true"
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${
              isDark ? 'left-[1.375rem]' : 'left-0.5'
            }`}
          />
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={`flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:text-brand-700 dark:hover:border-brand-500/50 dark:hover:text-brand-300 ${className}`}
    >
      {isDark ? (
        <Sun className="h-[1.15rem] w-[1.15rem]" aria-hidden="true" />
      ) : (
        <Moon className="h-[1.15rem] w-[1.15rem]" aria-hidden="true" />
      )}
    </button>
  )
}
