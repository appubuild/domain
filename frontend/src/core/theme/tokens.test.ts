/** The token contract, and the stylesheet it has to agree with.
 *
 *  The interesting test here is the last one. `themes.ts` declares the reference
 *  theme and `styles/theme.css` declares the same values in CSS, and the two are
 *  only the same thing while somebody keeps them that way. Nobody will — not
 *  through malice, but because the CSS is edited by whoever is fixing a contrast
 *  ratio and the TS is edited by whoever is adding a token. So the stylesheet is
 *  parsed and compared, and the drift is a failing test rather than a panel that
 *  quietly went transparent in one theme only.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isThemeToken, THEME_TOKENS, validateTheme, type ThemeToken } from './tokens';
import { NOVA_DARK, NOVA_LIGHT } from './themes';

const THEME_CSS = fileURLToPath(new URL('../../styles/theme.css', import.meta.url));

/** The custom properties the stylesheet's `@theme` block declares. */
function stylesheetTokens(css: string): Record<string, string> {
  // `static` is optional here and required there: Tailwind emits only the
  // variables a generated utility uses unless the block says otherwise, and
  // these are read by hand as well as by class.
  const block = /@theme(?:\s+static)?\s*\{([\s\S]*?)\n\}/.exec(css);
  if (block?.[1] === undefined) throw new Error('theme.css has no @theme block');
  const tokens: Record<string, string> = {};
  for (const [, name, value] of block[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    tokens[name as string] = (value as string).trim();
  }
  return tokens;
}

describe('the token list', () => {
  it('has no duplicates, because a duplicate is two tokens with one name', () => {
    expect(new Set(THEME_TOKENS).size).toBe(THEME_TOKENS.length);
  });

  it('knows which names are its own', () => {
    expect(isThemeToken('--color-ink')).toBe(true);
    expect(isThemeToken('--nova-brand')).toBe(false);
    expect(isThemeToken('')).toBe(false);
  });
});

describe('a theme document', () => {
  it('one that is not an object is refused rather than guessed at', () => {
    for (const value of [null, 42, 'dark', [], undefined]) {
      const result = validateTheme(value);
      expect(result.ok).toBe(false);
    }
  });

  it('one with no id is refused: an id is what a stored choice names', () => {
    const result = validateTheme({ id: '   ', label: 'Nameless', tokens: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[0]?.kind).toBe('empty-id');
  });

  it('a token nobody reads is refused, because it is a stylesheet with extra steps', () => {
    const result = validateTheme({
      id: 'plugin-theme',
      label: 'Plugin',
      tokens: { '--color-ink': 'white', '--nova-brand': 'purple' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.map((problem) => problem.token)).toContain('--nova-brand');
    }
  });

  it('every problem is reported, not just the first', () => {
    const result = validateTheme({
      id: 'plugin-theme',
      tokens: { '--nope': 'x', '--also-nope': 'y', '--color-ink': '   ' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.map((problem) => problem.kind).sort()).toEqual([
        'empty-value',
        'unknown-token',
        'unknown-token',
      ]);
    }
  });

  it('a name without its `--` prefix still means the token', () => {
    const result = validateTheme({ id: 't', tokens: { 'color-ink': 'white' } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tokens['--color-ink']).toBe('white');
  });

  it('a missing label falls back to the id rather than failing', () => {
    const result = validateTheme({ id: 'midnight', tokens: {} });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.label).toBe('midnight');
  });
});

describe('the themes that ship', () => {
  it('the reference theme sets every token', () => {
    for (const token of THEME_TOKENS) {
      expect(NOVA_DARK.tokens[token], token).toBeDefined();
    }
  });

  it('the light theme overrides only what changes between rooms', () => {
    // Everything it sets is a colour or a shadow: a light theme is not a
    // different shape, a different type stack or a different speed.
    for (const token of Object.keys(NOVA_LIGHT.tokens) as ThemeToken[]) {
      expect(token.startsWith('--color-') || token.startsWith('--shadow-'), token).toBe(true);
    }
  });

  it('both survive validation, because shipping a theme that is not a theme is a bug', () => {
    expect(validateTheme(NOVA_DARK).ok).toBe(true);
    expect(validateTheme(NOVA_LIGHT).ok).toBe(true);
  });
});

describe('the stylesheet and the reference theme', () => {
  const css = readFileSync(THEME_CSS, 'utf8');
  const declared = stylesheetTokens(css);

  it('declares every token the contract names', () => {
    const missing = THEME_TOKENS.filter((token) => declared[token] === undefined);
    expect(missing).toEqual([]);
  });

  it('declares nothing the contract does not name', () => {
    const extra = Object.keys(declared).filter((name) => !isThemeToken(name));
    expect(extra).toEqual([]);
  });

  it('gives each token the value the reference theme says it has', () => {
    // The one test that makes the duplication in `themes.ts` safe: a plugin
    // author needs the reference theme as readable data, and this is what stops
    // that copy from becoming a lie.
    for (const token of THEME_TOKENS) {
      expect(declared[token], token).toBe(NOVA_DARK.tokens[token]);
    }
  });
});
