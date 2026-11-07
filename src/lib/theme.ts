import { SITE } from '@/config/site'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = SITE.themeStorageKey

export const getStoredTheme = (): Theme | null => {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

export const getSystemTheme = (): Theme =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'

export const resolveInitialTheme = (): Theme => getStoredTheme() ?? getSystemTheme()

/** Applies the theme to the document without persisting a preference. */
export const applyThemeToDom = (theme: Theme): void => {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}

/** Persists an explicit visitor choice. */
export const persistTheme = (theme: Theme): void => {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* Storage can be unavailable in private mode — the theme still applies for the session. */
  }
}
