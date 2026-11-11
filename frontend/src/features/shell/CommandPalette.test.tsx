// @vitest-environment jsdom
/** The command palette.
 *
 *  What is pinned here is the promise — *find anything, by typing* — and the
 *  three ways it is usually broken: a search that is a substring match and so
 *  cannot tell "Save" from "Save as…", a list that silently stops being
 *  keyboard-navigable once it is virtualised, and a palette that leaves a
 *  dialog open behind the thing it just ran.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../core/i18n/I18nProvider';
import type { Command } from '../../app/commands';
import { CommandPalette } from './CommandPalette';

const COMMANDS: readonly Command[] = [
  { id: 'project.save', title: 'Save project', shortcut: 'Ctrl+S', run: () => undefined },
  { id: 'project.saveAs', title: 'Save project as…', run: () => undefined },
  { id: 'project.open', title: 'Open project…', shortcut: 'Ctrl+O', run: () => undefined },
  { id: 'view.theme', title: 'Next theme', hint: 'Cycle the themes', run: () => undefined },
  { id: 'project.close', title: 'Close project', disabled: true, run: () => undefined },
];

function renderPalette(
  commands: readonly Command[] = COMMANDS,
  onClose: () => void = () => undefined,
): void {
  render(
    <I18nProvider>
      <CommandPalette open commands={commands} onClose={onClose} />
    </I18nProvider>,
  );
}

function rows(): string[] {
  // `textContent` of an element is a string to the type checker and a `null` to
  // a browser that has not got one, so the fallback stays and the rule is told
  // why.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see above
  return screen.getAllByRole('option').map((option) => option.textContent ?? '-');
}

describe('an open palette', () => {
  it('is a named dialog with a combobox and a list of options', () => {
    renderPalette();
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
    expect(screen.getByRole('combobox')).toBeTruthy();
    // Four of the five: a command that cannot run is not offered.
    expect(rows().length).toBe(4);
    expect(screen.queryByRole('option', { name: /Close project/ })).toBeNull();
  });

  it('offers everything when nothing has been typed, in order', () => {
    renderPalette();
    expect(rows()[0]).toContain('Save project');
  });

  it('narrows as the user types, best match first', async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByRole('combobox'), 'save');
    const titles = rows();
    expect(titles.length).toBe(2);
    // "Save project" before "Save project as…": what the user typed is a prefix
    // of the first, and a palette that answered the other way round is a palette
    // that fights its user.
    expect(titles[0]).toContain('Save project');
  });

  it('finds a command by a word in what it does, not only in what it is called', async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByRole('combobox'), 'cycle');
    expect(rows()[0]).toContain('Next theme');
  });

  it('says so, rather than showing an empty list, when nothing matches', async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByRole('combobox'), 'zzz');
    expect(screen.queryAllByRole('option')).toEqual([]);
    expect(screen.getByText('No command matches.')).toBeTruthy();
  });
});

describe('running a command', () => {
  it('runs the highlighted one on Enter, and closes first', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    const onClose = vi.fn();
    const order: string[] = [];
    renderPalette(
      [
        {
          id: 'a',
          title: 'Save project',
          run: () => {
            order.push('run');
            run();
          },
        },
      ],
      () => {
        order.push('close');
        onClose();
      },
    );

    await user.keyboard('{Enter}');

    expect(run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    // Closed first: a command that opens a dialog inside a palette that is still
    // open is two modals fighting over focus.
    expect(order).toEqual(['close', 'run']);
  });

  it('moves the highlight with the arrows, and wraps', async () => {
    const user = userEvent.setup();
    renderPalette();

    const selected = (): string | undefined =>
      screen
        .getAllByRole('option')
        .find((option) => option.getAttribute('aria-selected') === 'true')?.textContent ??
      undefined;

    expect(selected()).toContain('Save project');
    await user.keyboard('{ArrowDown}');
    expect(selected()).toContain('Save project as…');
    await user.keyboard('{ArrowUp}{ArrowUp}');
    // Wrapped to the end rather than stopping at the top: a list that traps the
    // highlight is a list the user has to go all the way back through.
    expect(selected()).toContain('Next theme');
  });

  it('runs the one that was clicked', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    renderPalette([{ id: 'a', title: 'Open project…', run }]);

    await user.click(screen.getByText('Open project…'));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('starts empty next time it opens', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <I18nProvider>
        <CommandPalette open commands={COMMANDS} onClose={() => undefined} />
      </I18nProvider>,
    );
    await user.type(screen.getByRole('combobox'), 'save');
    expect(rows().length).toBe(2);

    rerender(
      <I18nProvider>
        <CommandPalette open={false} commands={COMMANDS} onClose={() => undefined} />
      </I18nProvider>,
    );
    rerender(
      <I18nProvider>
        <CommandPalette open commands={COMMANDS} onClose={() => undefined} />
      </I18nProvider>,
    );

    // A palette that remembered last time's search is a palette you have to
    // clear before you can use.
    expect(rows().length).toBe(4);
  });
});
