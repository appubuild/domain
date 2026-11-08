/** The current theme, as a context — and the storage a choice survives in.
 *
 *  Three pieces, deliberately separate:
 *
 *  * **`ThemeStorage`** is a port. A theme choice is install state, and install
 *    state belongs in the service's `settings` table — but the API that reaches
 *    it arrives with the settings panel (stage 6), so today it is
 *    `localStorage` and tomorrow it is a row. The window never knows which,
 *    because it only ever sees this interface.
 *  * **`ThemeContext`** carries what a component may ask for: the theme in
 *    force, the themes it may pick from, and how to pick one.
 *  * **`ThemeProvider`** (`ThemeProvider.tsx`) is the only thing that *writes*.
 *
 *  A component that imported a singleton theme could not be rendered in a test,
 *  and a component that wrote to `localStorage` directly could not be rendered
 *  in a test either — which is the whole of why both are behind this file.
 */

import { createContext, useContext, type Context } from 'react';

import type { Theme } from './tokens';

/** Where a theme choice is kept between launches.
 *
 *  Deliberately synchronous: the theme has to be right on the first paint, and
 *  a window that flashed white before remembering you chose dark is a window
 *  that has already lost. Reading it is therefore a blocking call, which is
 *  cheap for `localStorage` and will be a preloaded value for the settings row.
 */
export interface ThemeStorage {
  /** The stored theme id, or `null` when nothing has been chosen yet. */
  read(): string | null;
  write(id: string): void;
}

/** The theme in force, and the way a component asks for a different one. */
export interface ThemeController {
  /** The theme applied to the window right now. */
  readonly theme: Theme;
  /** Every theme this build offers, in menu order. */
  readonly themes: readonly Theme[];
  /** Apply one, by identity.
   *
   *  Properties rather than methods: these travel — into a menu item's handler,
   *  into a test's assertion — and a method passed as a value has no `this`
   *  when it arrives. */
  readonly setTheme: (theme: Theme) => void;
  /** Apply one, by id. An id that is not offered is ignored, because a stored
   *  id may name a theme from a build that is no longer installed, and losing
   *  the user's preference over a missing plugin is worse than the default. */
  readonly setThemeById: (id: string) => void;
}

export const ThemeContext: Context<ThemeController | undefined> = createContext<
  ThemeController | undefined
>(undefined);

/** The theme controller this tree was given.
 *
 *  Throws when there is none, like `useApi`: a component that silently painted
 *  itself with the reference theme instead of the user's is a component whose
 *  bug report says "the colours are wrong sometimes".
 */
export function useTheme(): ThemeController {
  const controller = useContext(ThemeContext);
  if (!controller) {
    throw new Error('no ThemeController in context — wrap this tree in <ThemeProvider>');
  }
  return controller;
}

/** `localStorage`, behind the port and behind a guard.
 *
 *  The guard is not paranoia: a packaged window can be started with storage
 *  disabled, and `localStorage` throws on access in that case rather than
 *  returning `null`. A theme that failed to load because storage is off would
 *  take the whole window down with it, and the window's job is to edit video.
 */
export function localStorageThemeStorage(key = 'nova.theme'): ThemeStorage {
  return {
    read(): string | null {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    write(id: string): void {
      try {
        window.localStorage.setItem(key, id);
      } catch {
        // Remembering a preference is a nicety. Not crashing is a requirement.
      }
    },
  };
}

/** Storage that forgets: for tests, and for a build that must not persist. */
export function memoryThemeStorage(initial: string | null = null): ThemeStorage {
  let value = initial;
  return {
    read(): string | null {
      return value;
    },
    write(id: string): void {
      value = id;
    },
  };
}
