/** The themes that ship with the editor.
 *
 *  `nova-dark` is the **reference theme**: it is the stylesheet
 *  (`styles/theme.css`), and its `tokens` below are a copy of what that file
 *  declares. The copy is deliberate and it is guarded — `tokens.test.ts` parses
 *  the CSS and fails if the two drift — because a plugin author needs the
 *  reference theme to be *readable data*: something to copy, change six values
 *  of and ship. A reference that says "it's whatever the CSS says" is a
 *  reference nobody can start from.
 *
 *  `nova-light` overrides the colours and the two shadows and nothing else.
 *  That is the demonstration: a light theme is not a different shape, a
 *  different type stack or a different speed.
 */

import type { Theme } from './tokens';

/** The reference theme — identical to `@theme` in `styles/theme.css`. */
export const NOVA_DARK: Theme = {
  id: 'nova-dark',
  label: 'Nova Dark',
  description: 'The default. Built for a dark suite.',
  tokens: {
    '--color-surface-0': 'oklch(0.16 0.01 265)',
    '--color-surface-1': 'oklch(0.21 0.012 265)',
    '--color-surface-2': 'oklch(0.26 0.014 265)',
    '--color-surface-3': 'oklch(0.32 0.016 265)',
    '--color-line': 'oklch(0.35 0.015 265)',
    '--color-ink': 'oklch(0.95 0.005 265)',
    '--color-ink-dim': 'oklch(0.72 0.012 265)',
    '--color-ink-faint': 'oklch(0.55 0.014 265)',
    '--color-accent': 'oklch(0.72 0.16 250)',
    '--color-accent-ink': 'oklch(0.16 0.02 250)',
    '--color-danger': 'oklch(0.66 0.19 25)',
    '--color-success': 'oklch(0.75 0.16 145)',
    '--color-warning': 'oklch(0.8 0.16 85)',
    '--color-info': 'oklch(0.75 0.14 230)',
    '--color-scrim': 'oklch(0.1 0.01 265 / 0.65)',
    '--color-focus': 'oklch(0.8 0.15 250)',
    '--font-ui': "'Inter var', system-ui, sans-serif",
    '--font-mono': "'JetBrains Mono', ui-monospace, monospace",
    '--radius-panel': '0.5rem',
    '--radius-control': '0.375rem',
    '--shadow-panel': '0 1px 2px oklch(0 0 0 / 0.4)',
    '--shadow-overlay': '0 16px 40px oklch(0 0 0 / 0.55)',
    '--duration-fast': '120ms',
    '--duration-base': '180ms',
    '--duration-slow': '260ms',
    '--ease-out': 'cubic-bezier(0.22, 1, 0.36, 1)',
    '--ease-in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
    '--z-panel': '10',
    '--z-overlay': '100',
    '--z-modal': '200',
    '--z-toast': '300',
  },
};

/** The light theme: what changes when the room is bright. */
export const NOVA_LIGHT: Theme = {
  id: 'nova-light',
  label: 'Nova Light',
  description: 'The same editor in a bright room.',
  tokens: {
    '--color-surface-0': 'oklch(0.96 0.004 265)',
    '--color-surface-1': 'oklch(1 0 0)',
    '--color-surface-2': 'oklch(0.94 0.005 265)',
    '--color-surface-3': 'oklch(0.9 0.007 265)',
    '--color-line': 'oklch(0.86 0.009 265)',
    '--color-ink': 'oklch(0.24 0.016 265)',
    '--color-ink-dim': 'oklch(0.46 0.016 265)',
    '--color-ink-faint': 'oklch(0.6 0.015 265)',
    // Darker, not lighter: the accent has to hold 4.5:1 against the *surface*
    // it sits on, and a light theme asking a light blue to do that is a light
    // theme with unreadable links.
    '--color-accent': 'oklch(0.54 0.19 256)',
    '--color-accent-ink': 'oklch(0.99 0.004 256)',
    '--color-danger': 'oklch(0.55 0.21 25)',
    '--color-success': 'oklch(0.52 0.15 145)',
    '--color-warning': 'oklch(0.64 0.15 75)',
    '--color-info': 'oklch(0.56 0.16 245)',
    '--color-scrim': 'oklch(0.2 0.01 265 / 0.45)',
    '--color-focus': 'oklch(0.54 0.19 256)',
    '--shadow-panel': '0 1px 2px oklch(0.2 0.02 265 / 0.1)',
    '--shadow-overlay': '0 16px 40px oklch(0.2 0.02 265 / 0.18)',
  },
};

/** Every theme this build knows about, in the order a menu shows them. */
export const BUILT_IN_THEMES: readonly Theme[] = [NOVA_DARK, NOVA_LIGHT];

/** The theme a window starts in when nothing has been chosen yet. */
export const DEFAULT_THEME: Theme = NOVA_DARK;

/** The theme with this id, or `undefined`. Unknown ids are a caller's problem
 *  to answer — a stored id may name a theme from a build that is gone — and
 *  `undefined` is an answer a caller can see, unlike a silent default here. */
export function findTheme(
  id: string,
  themes: readonly Theme[] = BUILT_IN_THEMES,
): Theme | undefined {
  return themes.find((theme) => theme.id === id);
}
