// @vitest-environment jsdom
/** The title bar.
 *
 *  Tested against a stub theme controller, because what is being pinned is not
 *  how a theme is applied (`core/theme/theme.test.tsx` does that) but that the
 *  bar asks for the right one and names the menu after what it is for.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../core/i18n/I18nProvider';
import { ThemeContext, type ThemeController } from '../../core/theme/context';
import { BUILT_IN_THEMES, DEFAULT_THEME } from '../../core/theme/themes';
import { TitleBar } from './TitleBar';

function controller(onSet: (id: string) => void = () => undefined): ThemeController {
  // Destructured with a default rather than indexed with `!`: an empty list of
  // built-in themes is a build with no theme, and this test should fail on the
  // type, not on a bang.
  const [first = DEFAULT_THEME] = BUILT_IN_THEMES;
  return {
    theme: first,
    themes: BUILT_IN_THEMES,
    setTheme: (theme) => {
      onSet(theme.id);
    },
    setThemeById: onSet,
  };
}

function renderBar(
  over: Partial<React.ComponentProps<typeof TitleBar>> = {},
  onSet: (id: string) => void = () => undefined,
): void {
  render(
    <I18nProvider>
      <ThemeContext.Provider value={controller(onSet)}>
        <TitleBar projectName={null} onOpenPalette={() => undefined} {...over} />
      </ThemeContext.Provider>
    </I18nProvider>,
  );
}

describe('the title bar', () => {
  it('says what the application is', () => {
    renderBar();
    expect(screen.getByText('Nova Studio')).toBeTruthy();
  });

  it('says which project the window is showing, and that none is when none is', () => {
    const { unmount } = render(
      <I18nProvider>
        <ThemeContext.Provider value={controller()}>
          <TitleBar projectName={null} onOpenPalette={() => undefined} />
        </ThemeContext.Provider>
      </I18nProvider>,
    );
    expect(screen.getByText('No project open')).toBeTruthy();
    unmount();

    renderBar({ projectName: 'Holiday edit' });
    expect(screen.getByText('Holiday edit')).toBeTruthy();
  });

  it('marks unsaved work with a dot, and leaves the name legible', () => {
    renderBar({ projectName: 'Holiday edit', projectDirty: true });
    // A dot and not a red title: the name is how a project is found.
    expect(screen.getByTitle('Unsaved changes')).toBeTruthy();
    expect(screen.getByText('Holiday edit')).toBeTruthy();
  });

  it('offers the themes this build ships, and applies the one chosen', async () => {
    const user = userEvent.setup();
    const onSet = vi.fn();
    renderBar({}, onSet);

    await user.click(screen.getByRole('button', { name: 'Theme' }));
    const menu = screen.getByRole('menu', { name: 'Theme' });
    expect(menu.textContent).toContain('Nova Light');

    await user.click(screen.getByRole('menuitem', { name: 'Nova Light' }));
    expect(onSet).toHaveBeenCalledWith('nova-light');
  });

  it('opens the palette from the bar', async () => {
    const user = userEvent.setup();
    const onOpenPalette = vi.fn();
    renderBar({ onOpenPalette });

    await user.click(screen.getByRole('button', { name: 'Commands' }));
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
  });
});
