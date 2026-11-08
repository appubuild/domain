/** The token contract: the names a theme is allowed to set, and nothing else.
 *
 *  A theme in Nova Studio is a **document that overrides CSS custom
 *  properties**, not a stylesheet — which is what lets a theme be data: shipped
 *  in a plugin, chosen from a menu, applied without a rebuild. That only works
 *  while there is an agreed list of names. A document that may set *any*
 *  property is not a theme, it is a stylesheet with extra steps, and the first
 *  plugin that invents `--nova-brand` has invented a token no component reads.
 *
 *  So the list is here, in TypeScript, and `applyTheme()` writes nothing that
 *  is not on it. The stylesheet (`styles/theme.css`) declares the same names
 *  with the same values — `tokens.test.ts` reads that file and fails if either
 *  side moves without the other.
 */

import { err, ok, type Result } from '../result';

/** Every token a theme may set. Each name is also a CSS custom property. */
export const THEME_TOKENS = [
  // Surfaces, lines and ink.
  '--color-surface-0',
  '--color-surface-1',
  '--color-surface-2',
  '--color-surface-3',
  '--color-line',
  '--color-ink',
  '--color-ink-dim',
  '--color-ink-faint',
  '--color-accent',
  '--color-accent-ink',
  '--color-danger',
  '--color-success',
  '--color-warning',
  '--color-info',
  '--color-scrim',
  '--color-focus',
  // Type and shape.
  '--font-ui',
  '--font-mono',
  '--radius-panel',
  '--radius-control',
  // Depth.
  '--shadow-panel',
  '--shadow-overlay',
  // Motion.
  '--duration-fast',
  '--duration-base',
  '--duration-slow',
  '--ease-out',
  '--ease-in-out',
  // Stacking.
  '--z-panel',
  '--z-overlay',
  '--z-modal',
  '--z-toast',
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];

/** A theme's overrides. Everything is optional: a theme says what it changes.
 *
 *  That is the whole difference between a theme and a stylesheet. `nova-light`
 *  overrides the colours and the two shadows and says nothing about radii,
 *  motion or the type stack, because a light theme is not a different shape.
 */
export type ThemeTokens = Readonly<Partial<Record<ThemeToken, string>>>;

/** A theme: a stable id, a name for the menu, and the overrides it carries. */
export interface Theme {
  readonly id: string;
  readonly label: string;
  /** Shown under the label in a theme menu; absent when there is nothing to say. */
  readonly description?: string;
  readonly tokens: ThemeTokens;
}

/** Why a theme document was refused. */
export interface ThemeProblem {
  readonly kind: 'empty-id' | 'empty-value' | 'unknown-token';
  /** The token refused, when the problem is about one. */
  readonly token?: string;
}

/** The full token set, as the stylesheet declares it. Used by the drift test. */
export type ThemeTokenSet = Readonly<Record<ThemeToken, string>>;

/** Whether a name is one of the tokens a theme may set. */
export function isThemeToken(name: string): name is ThemeToken {
  return (THEME_TOKENS as readonly string[]).includes(name);
}

/** Check a document — anything that arrived from outside this process — and
 *  answer a `Theme`, or every thing that is wrong with it.
 *
 *  A `Result` rather than an exception, for the same reason everything else in
 *  the window is one (`core/result.ts`): a theme arrives from *outside* — a
 *  plugin bundle, a file someone edited by hand, a settings row written by a
 *  build that is no longer installed — and "these two tokens are misspelled" is
 *  an answer, not a stack trace.
 *
 *  Every problem is reported, not just the first: a plugin author fixing three
 *  misspelled tokens one run at a time is not being helped.
 */
export function validateTheme(value: unknown): Result<Theme, readonly ThemeProblem[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return err([{ kind: 'empty-id' }]);
  }
  const candidate = value as {
    readonly id?: unknown;
    readonly label?: unknown;
    readonly description?: unknown;
    readonly tokens?: unknown;
  };

  const problems: ThemeProblem[] = [];
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
  if (id === '') problems.push({ kind: 'empty-id' });

  // A missing label is a default rather than a problem: the id is what a menu
  // falls back to, and refusing a theme over its own name helps nobody.
  const label =
    typeof candidate.label === 'string' && candidate.label.trim() !== '' ? candidate.label : id;
  const description = typeof candidate.description === 'string' ? candidate.description : undefined;

  const tokens: Record<string, string> = {};
  const raw = candidate.tokens;
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    for (const [name, tokenValue] of Object.entries(raw as Record<string, unknown>)) {
      // A document that says `surface-0` means `--color-surface-0`: the prefix
      // is ceremony in a file a human is writing.
      const token = name.startsWith('--') ? name : `--${name}`;
      if (!isThemeToken(token)) {
        problems.push({ kind: 'unknown-token', token });
        continue;
      }
      if (typeof tokenValue !== 'string' || tokenValue.trim() === '') {
        problems.push({ kind: 'empty-value', token });
        continue;
      }
      tokens[token] = tokenValue;
    }
  }

  if (problems.length > 0) return err(problems);
  return ok<Theme>({
    id,
    label,
    ...(description !== undefined ? { description } : {}),
    tokens,
  });
}
