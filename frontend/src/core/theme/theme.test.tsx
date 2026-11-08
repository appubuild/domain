// @vitest-environment jsdom
/** Applying a theme: to an element, and to a window through the provider.
 *
 *  The property being pinned is **applying is total and reversible**. A theme
 *  that half-applies is the bug where a panel is unreadable in the theme you
 *  just picked, because the previous theme's tokens are still on the element and
 *  the new theme never mentioned them. Every test below that switches themes and
 *  reads the element back is that property, from a different angle.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyTheme,
  clearTheme,
  readAppliedTheme,
  readAppliedTokens,
  themeDeclarations,
} from './apply';
import { memoryThemeStorage, useTheme } from './context';
import { BUILT_IN_THEMES, findTheme, NOVA_DARK, NOVA_LIGHT } from './themes';
import { ThemeProvider } from './ThemeProvider';

const root = (): HTMLElement => document.documentElement;

beforeEach(() => {
  clearTheme(root());
});

afterEach(() => {
  clearTheme(root());
});

describe('applying to an element', () => {
  it('writes what the theme says and nothing else', () => {
    applyTheme(root(), NOVA_LIGHT);

    const applied = readAppliedTokens(root());
    expect(applied['--color-surface-0']).toBe(NOVA_LIGHT.tokens['--color-surface-0']);
    // `nova-light` says nothing about radii, so nothing about radii is written.
    expect(applied['--radius-panel']).toBeUndefined();
  });

  it('records which theme it applied, as data rather than a class', () => {
    applyTheme(root(), NOVA_LIGHT);
    expect(readAppliedTheme(root())).toBe('nova-light');
  });

  it('switching leaves nothing of the previous theme behind', () => {
    applyTheme(root(), NOVA_LIGHT);
    applyTheme(root(), NOVA_DARK);

    // `nova-dark` sets every token, so the check that matters is the other
    // direction — see the next test — but this one pins that a light override is
    // fully replaced rather than merged.
    expect(readAppliedTokens(root())['--color-surface-0']).toBe(
      NOVA_DARK.tokens['--color-surface-0'],
    );
    expect(readAppliedTheme(root())).toBe('nova-dark');
  });

  it('a theme that omits a token removes the previous theme’s value for it', () => {
    applyTheme(root(), NOVA_DARK);
    expect(readAppliedTokens(root())['--shadow-panel']).toBe(NOVA_DARK.tokens['--shadow-panel']);

    // `nova-light` does set shadows, so use a theme that truly omits one: the
    // property being pinned is that an omission is a removal, not a keep.
    applyTheme(root(), { id: 'test-empty', label: 'Empty', tokens: {} });
    expect(readAppliedTokens(root())['--shadow-panel']).toBeUndefined();
    expect(readAppliedTokens(root())['--color-surface-0']).toBeUndefined();
  });

  it('applying twice is the same as applying once', () => {
    applyTheme(root(), NOVA_LIGHT);
    const once = readAppliedTokens(root());
    applyTheme(root(), NOVA_LIGHT);
    expect(readAppliedTokens(root())).toEqual(once);
  });

  it('clearing returns the element to the stylesheet', () => {
    applyTheme(root(), NOVA_LIGHT);
    clearTheme(root());

    expect(readAppliedTokens(root())).toEqual({});
    expect(readAppliedTheme(root())).toBeUndefined();
  });

  it('the declarations are the theme, in token order and nothing more', () => {
    const declarations = themeDeclarations(NOVA_LIGHT);
    expect(Object.fromEntries(declarations.map(([k, v]) => [k, v]))).toEqual(NOVA_LIGHT.tokens);
  });
});

describe('a window with a theme provider', () => {
  function ThemeMenu(): React.JSX.Element {
    const { theme, themes, setThemeById } = useTheme();
    return (
      <div>
        <span data-testid="current">{theme.id}</span>
        <span data-testid="offered">{themes.map((candidate) => candidate.id).join(',')}</span>
        <button
          type="button"
          onClick={() => {
            setThemeById('nova-light');
          }}
        >
          light
        </button>
      </div>
    );
  }

  it('applies the default when nothing has been chosen', () => {
    render(
      <ThemeProvider storage={memoryThemeStorage()}>
        <ThemeMenu />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('current').textContent).toBe('nova-dark');
    expect(readAppliedTheme(root())).toBe('nova-dark');
  });

  it('applies what was chosen last time', () => {
    render(
      <ThemeProvider storage={memoryThemeStorage('nova-light')}>
        <ThemeMenu />
      </ThemeProvider>,
    );

    expect(readAppliedTheme(root())).toBe('nova-light');
  });

  it('a stored theme this build does not have falls back rather than failing', () => {
    // The realistic version: a plugin theme that has since been uninstalled.
    render(
      <ThemeProvider storage={memoryThemeStorage('plugin-midnight')}>
        <ThemeMenu />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('current').textContent).toBe('nova-dark');
    expect(readAppliedTheme(root())).toBe('nova-dark');
  });

  it('remembering the choice is the storage’s job, and the provider does it', async () => {
    const user = userEvent.setup();
    const storage = memoryThemeStorage();
    render(
      <ThemeProvider storage={storage}>
        <ThemeMenu />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'light' }));

    expect(readAppliedTheme(root())).toBe('nova-light');
    expect(storage.read()).toBe('nova-light');
  });

  it('an unknown id is ignored rather than applied as nothing', async () => {
    const user = userEvent.setup();
    const storage = memoryThemeStorage();
    function Pick(): React.JSX.Element {
      const { setThemeById } = useTheme();
      return (
        <button
          type="button"
          onClick={() => {
            setThemeById('no-such-theme');
          }}
        >
          gone
        </button>
      );
    }
    render(
      <ThemeProvider storage={storage}>
        <Pick />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'gone' }));

    expect(readAppliedTheme(root())).toBe('nova-dark');
    expect(storage.read()).toBeNull();
  });

  it('a preview writes to the element it was given and not to the window', () => {
    const panel = document.createElement('div');
    document.body.append(panel);
    render(
      <ThemeProvider element={panel}>
        <ThemeMenu />
      </ThemeProvider>,
    );

    expect(readAppliedTheme(panel)).toBe('nova-dark');
    expect(readAppliedTheme(root())).toBeUndefined();
    panel.remove();
  });

  it('`apply={false}` observes without painting', () => {
    render(
      <ThemeProvider storage={memoryThemeStorage('nova-light')} apply={false}>
        <ThemeMenu />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('current').textContent).toBe('nova-light');
    expect(readAppliedTheme(root())).toBeUndefined();
  });

  it('offers every theme the build ships, in order', () => {
    render(
      <ThemeProvider>
        <ThemeMenu />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('offered').textContent).toBe(
      BUILT_IN_THEMES.map((theme) => theme.id).join(','),
    );
  });
});

describe('finding a theme', () => {
  it('is by id, and absence is an answer rather than a default', () => {
    expect(findTheme('nova-light')?.id).toBe('nova-light');
    expect(findTheme('gone')).toBeUndefined();
  });
});
