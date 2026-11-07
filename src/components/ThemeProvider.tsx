import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { SITE } from '@/config/site'
import { applyThemeToDom, persistTheme, resolveInitialTheme, type Theme } from '@/lib/theme'

interface ThemeContextValue {
  theme: Theme
  toggle: () => void
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : resolveInitialTheme(),
  )

  useEffect(() => {
    // Render the theme, but only persist an explicit choice (see setTheme/toggle).
    applyThemeToDom(theme)
  }, [theme])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => {
      // Only follow the OS when the visitor has not made an explicit choice.
      let stored: string | null = null
      try {
        stored = localStorage.getItem(SITE.themeStorageKey)
      } catch {
        stored = null
      }
      if (!stored) setThemeState(event.matches ? 'dark' : 'light')
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const setTheme = useCallback((next: Theme) => {
    persistTheme(next)
    setThemeState(next)
  }, [])

  const toggle = useCallback(
    () =>
      setThemeState((current) => {
        const next = current === 'dark' ? 'light' : 'dark'
        persistTheme(next)
        return next
      }),
    [],
  )

  const value = useMemo(() => ({ theme, toggle, setTheme }), [theme, toggle, setTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
