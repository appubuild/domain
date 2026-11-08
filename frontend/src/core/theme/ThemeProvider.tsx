/** The one component that writes a theme onto the window.
 *
 *  It does four things, and the order between them is the design:
 *
 *  1. **Resolve** the starting theme: whatever storage holds, if it is one this
 *     build still offers; the default otherwise. An id from a build that is gone
 *     is not an error, it is an absence.
 *  2. **Apply** it in a layout effect — before the browser paints, because a
 *     window that paints the reference theme and then switches is a flash, and
 *     a flash is the one kind of theme bug a user reports as "it flickers".
 *  3. **Remember** the choice through the `ThemeStorage` port, so the provider
 *     never learns whether a preference is in `localStorage` or in the
 *     service's `settings` table.
 *  4. **Offer** the set through context, so a component can change the theme
 *     without being able to write to an element or to storage itself.
 *
 *  Nothing here reads a colour. The theme is data all the way down.
 */

import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

import { applyTheme } from './apply';
import { ThemeContext, type ThemeController, type ThemeStorage } from './context';
import { BUILT_IN_THEMES, DEFAULT_THEME, findTheme } from './themes';
import type { Theme } from './tokens';

export interface ThemeProviderProps {
  readonly children: ReactNode;
  /** Where the choice is kept. Defaults to `localStorage` behind a guard. */
  readonly storage?: ThemeStorage;
  /** What may be chosen. Defaults to the themes this build ships. */
  readonly themes?: readonly Theme[];
  /** What is applied when storage holds nothing usable. */
  readonly fallback?: Theme;
  /** The element tokens are written to: the document element by default, a
   *  container when a panel is previewing a theme without changing the window. */
  readonly element?: HTMLElement | undefined;
  /** False to observe without writing — how a preview renders a theme in a
   *  swatch without repainting the editor behind it. */
  readonly apply?: boolean;
}

/** The theme a window starts in, from storage when storage has a usable answer. */
function resolveInitialTheme(
  storage: ThemeStorage | undefined,
  themes: readonly Theme[],
  fallback: Theme,
): Theme {
  if (storage === undefined) return fallback;
  const stored = storage.read();
  if (stored === null) return fallback;
  return findTheme(stored, themes) ?? fallback;
}

export function ThemeProvider({
  children,
  storage,
  themes = BUILT_IN_THEMES,
  fallback = DEFAULT_THEME,
  element,
  apply = true,
}: ThemeProviderProps): React.JSX.Element {
  const [theme, setThemeState] = useState<Theme>(() =>
    resolveInitialTheme(storage, themes, fallback),
  );

  // The element is resolved inside the effect rather than during render: in a
  // test without a document, reading `document.documentElement` while rendering
  // is a crash, and in a browser it is a value that can change under a provider
  // that was pointed at a container.
  //
  // A *layout* effect and not a passive one: a passive effect runs after the
  // browser has painted, which is exactly the flash this is here to prevent.
  useLayoutEffect(() => {
    if (!apply) return;
    const target =
      element ?? (typeof document === 'undefined' ? undefined : document.documentElement);
    if (target === undefined) return;
    applyTheme(target, theme);
  }, [apply, element, theme]);

  const setTheme = useCallback(
    (next: Theme): void => {
      setThemeState(next);
      storage?.write(next.id);
    },
    [storage],
  );

  const setThemeById = useCallback(
    (id: string): void => {
      const next = findTheme(id, themes);
      // Unknown ids are ignored rather than applied: a stale id is a preference
      // this build cannot honour, and honouring it as "no theme" is worse.
      if (next !== undefined) setTheme(next);
    },
    [setTheme, themes],
  );

  const controller = useMemo<ThemeController>(
    () => ({ theme, themes, setTheme, setThemeById }),
    [theme, themes, setTheme, setThemeById],
  );

  return <ThemeContext.Provider value={controller}>{children}</ThemeContext.Provider>;
}
