import * as React from 'react';
import type { SiteTheme } from '@/types/domain';
import { cmsRepo, userRepo } from '@/repositories';
import { subscribeDatabase } from '@/store/db';
import { useSession } from '@/store/session';

type Mode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  mode: Mode;
  resolvedMode: 'light' | 'dark';
  setMode: (mode: Mode) => void;
  siteTheme: SiteTheme;
  updateSiteTheme: (patch: Partial<SiteTheme>) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);
const MODE_KEY = 'scriptora.theme.v1';

function hexToHsl(hex: string) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const userId = useSession((state) => state.userId);
  const [mode, setModeState] = React.useState<Mode>(() => {
    try {
      return (window.localStorage.getItem(MODE_KEY) as Mode) ?? cmsRepo.theme().defaultMode ?? 'system';
    } catch {
      return 'system';
    }
  });
  const [siteTheme, setSiteTheme] = React.useState<SiteTheme>(() => cmsRepo.theme());
  const [systemDark, setSystemDark] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  React.useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  // User preference (from settings) wins over the platform default.
  React.useEffect(() => {
    if (!userId) return;
    const user = userRepo.find(userId);
    if (user?.settings.theme) setModeState(user.settings.theme);
  }, [userId]);

  const resolvedMode: 'light' | 'dark' = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedMode === 'dark');
    root.classList.toggle('light', resolvedMode === 'light');
    root.style.colorScheme = resolvedMode;
  }, [resolvedMode]);

  React.useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--primary', hexToHsl(siteTheme.primary));
    root.style.setProperty('--accent', hexToHsl(siteTheme.accent));
    root.style.setProperty('--radius', `${siteTheme.radius}rem`);
    const existing = document.querySelector('link[rel="icon"]');
    if (existing) existing.setAttribute('href', siteTheme.favicon);
  }, [siteTheme]);

  const setMode = React.useCallback(
    (next: Mode) => {
      setModeState(next);
      try {
        window.localStorage.setItem(MODE_KEY, next);
      } catch {
        // ignore
      }
      if (userId) {
        const user = userRepo.find(userId);
        if (user) userRepo.updateSettings(userId, { theme: next });
      }
    },
    [userId],
  );

  const updateSiteTheme = React.useCallback((patch: Partial<SiteTheme>) => {
    const next = cmsRepo.updateTheme(patch);
    setSiteTheme({ ...next });
  }, []);

  // React to admin theme changes made in the admin panel. The mock database notifies
  // subscribers on every write, so this is push-based: no polling timer, no idle work.
  React.useEffect(() => {
    const unsubscribe = subscribeDatabase(() => {
      const current = cmsRepo.theme();
      setSiteTheme((previous) => (JSON.stringify(previous) === JSON.stringify(current) ? previous : { ...current }));
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const value = React.useMemo(
    () => ({ mode, resolvedMode, setMode, siteTheme, updateSiteTheme }),
    [mode, resolvedMode, setMode, siteTheme, updateSiteTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedMode, setMode, mode } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setMode(resolvedMode === 'dark' ? 'light' : 'dark')}
      aria-label={`Switch to ${resolvedMode === 'dark' ? 'light' : 'dark'} mode (currently ${mode})`}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${className ?? ''}`}
    >
      {resolvedMode === 'dark' ? '☀' : '☾'}
    </button>
  );
}
