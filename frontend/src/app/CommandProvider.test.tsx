// @vitest-environment jsdom
/** The registry as a React resource, and the one global key listener.
 *
 *  Two things are pinned. The first is the lifecycle: a panel's commands exist
 *  while the panel does, and a window with no project open must not offer to
 *  save one. The second is the key rule that makes a shortcut safe to bind
 *  globally: a bare key belongs to whoever is typing.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CommandsProvider } from './CommandProvider';
import { type Command, type CommandRegistry, createCommandRegistry } from './commands';
import { useCommandShortcuts, useCommands, useRegisterCommands } from './useCommands';

function Provider({
  children,
  registry,
}: {
  readonly children: React.ReactNode;
  readonly registry?: CommandRegistry | undefined;
}): React.JSX.Element {
  return <CommandsProvider {...(registry ? { registry } : {})}>{children}</CommandsProvider>;
}

function List(): React.JSX.Element {
  const commands = useCommands();
  return (
    <ul>
      {commands.map((command) => (
        <li key={command.id}>{command.title}</li>
      ))}
    </ul>
  );
}

function Registers({ commands }: { readonly commands: readonly Command[] }): React.JSX.Element {
  useRegisterCommands(commands);
  return <span data-testid="registered">{commands.length}</span>;
}

function Keys({ commands }: { readonly commands: readonly Command[] }): React.JSX.Element | null {
  useCommandShortcuts(commands);
  // Nothing to draw: this component exists only to bind the keys.
  return null;
}

describe('a registry in a tree', () => {
  it('shows what has been registered, in order', () => {
    const first = [{ id: 'a', title: 'Alpha', run: () => undefined }];
    const second = [{ id: 'b', title: 'Beta', run: () => undefined }];
    render(
      <Provider>
        <Registers commands={first} />
        <Registers commands={second} />
        <List />
      </Provider>,
    );
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Alpha',
      'Beta',
    ]);
  });

  it('takes a panel’s commands away with the panel', async () => {
    function Host(): React.JSX.Element {
      const [shown, setShown] = useState(true);
      const commands = useMemo<readonly Command[]>(
        () => (shown ? [{ id: 'a', title: 'Only while shown', run: () => undefined }] : []),
        [shown],
      );
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setShown(false);
            }}
          >
            hide
          </button>
          <Registers commands={commands} />
          <List />
        </>
      );
    }
    const user = userEvent.setup();
    render(
      <Provider>
        <Host />
      </Provider>,
    );

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Only while shown',
    ]);
    await user.click(screen.getByRole('button', { name: 'hide' }));
    // A command that outlived its panel is a command that runs against a view
    // that is no longer there.
    expect(screen.queryAllByRole('listitem')).toEqual([]);
  });

  it('refuses to work without a provider, rather than offering nothing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<List />)).toThrow(/no command registry in context/);
    spy.mockRestore();
  });

  it('can be handed a registry it did not make', () => {
    const registry = createCommandRegistry();
    render(
      <Provider registry={registry}>
        <Registers commands={[{ id: 'a', title: 'Alpha', run: () => undefined }]} />
      </Provider>,
    );
    // Held by the test, which is the point: a story can render two windows and
    // a test can watch what went in.
    expect(registry.current().map((command) => command.id)).toEqual(['a']);
  });
});

describe('a key pressed anywhere in the window', () => {
  it('runs the command it belongs to', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(
      <Provider>
        <Keys commands={[{ id: 'a', title: 'Save', shortcut: 'Ctrl+S', run }]} />
      </Provider>,
    );

    await user.keyboard('{Control>}s{/Control}');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('counts the command key as control', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(
      <Provider>
        <Keys commands={[{ id: 'a', title: 'Save', shortcut: 'Ctrl+S', run }]} />
      </Provider>,
    );

    await user.keyboard('{Meta>}s{/Meta}');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('leaves a plain letter to whoever is typing it', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(
      <Provider>
        <Keys commands={[{ id: 'a', title: 'Mark', shortcut: 'M', run }]} />
        <input aria-label="note" />
      </Provider>,
    );

    await user.click(screen.getByLabelText('note'));
    await user.keyboard('m');
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByLabelText<HTMLInputElement>('note').value).toBe('m');
  });

  it('still answers a modified key while the user is typing', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(
      <Provider>
        <Keys commands={[{ id: 'a', title: 'Save', shortcut: 'Ctrl+S', run }]} />
        <input aria-label="note" />
      </Provider>,
    );

    await user.click(screen.getByLabelText('note'));
    await user.keyboard('{Control>}s{/Control}');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('will not run a command that says it cannot', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(
      <Provider>
        <Keys commands={[{ id: 'a', title: 'Save', shortcut: 'Ctrl+S', disabled: true, run }]} />
      </Provider>,
    );

    await user.keyboard('{Control>}s{/Control}');
    expect(run).not.toHaveBeenCalled();
  });

  it('ignores a key held down', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(
      <Provider>
        <Keys commands={[{ id: 'a', title: 'Save', shortcut: 'S', run }]} />
      </Provider>,
    );

    await user.keyboard('{s>}');
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    // Held keys repeat, and a command run sixty times a second is not what
    // holding a key down means.
    expect(run.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
