// @vitest-environment jsdom
/** Commands: the grammar of a shortcut, and the order a palette answers in.
 *
 *  Both halves are pure, so both are tested as data. The shortcut half is about
 *  the two ways a platform says the same thing — `Cmd` and `Ctrl`, `Option` and
 *  `Alt` — and about refusing the strings that are not shortcuts. The matching
 *  half is about the order a *person* expects, which is the thing a plain
 *  substring search gets wrong: "Save" before "Save as…", "Open project…"
 *  before "Close project" when you typed `op`.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  type Command,
  createCommandRegistry,
  filterCommands,
  isTypingTarget,
  matchesShortcut,
  parseShortcut,
  sameShortcut,
  scoreCommand,
  shortcutOfEvent,
} from './commands';

function command(id: string, title: string, over: Partial<Command> = {}): Command {
  return { id, title, run: () => undefined, ...over };
}

/** A shortcut that must parse: a test that wrote `?? {}` at every call site
 *  would be asserting against a value that is not a shortcut at all. */
function shortcut(text: string): ReturnType<typeof parseShortcut> & {} {
  const parsed = parseShortcut(text);
  if (parsed === null) throw new Error(`not a shortcut: ${text}`);
  return parsed;
}

describe('a shortcut written as text', () => {
  it('reads the modifiers and the key', () => {
    expect(parseShortcut('Ctrl+S')).toEqual({ ctrl: true, shift: false, alt: false, key: 'S' });
    expect(parseShortcut('Ctrl+Shift+P')).toEqual({
      ctrl: true,
      shift: true,
      alt: false,
      key: 'P',
    });
    expect(parseShortcut('ctrl+alt+t')).toEqual({ ctrl: true, shift: false, alt: true, key: 'T' });
    expect(parseShortcut('F5')).toEqual({ ctrl: false, shift: false, alt: false, key: 'F5' });
  });

  it('hears every name a platform uses for the same key', () => {
    // A Mac user pressing Cmd+S is not pressing a different shortcut, and a
    // shortcut table that made them learn both would be a table for one machine.
    const variants = ['Ctrl+S', 'Control+S', 'Cmd+S', 'Command+S', 'Meta+S'];
    for (const text of variants) {
      expect(parseShortcut(text), text).toEqual({
        ctrl: true,
        shift: false,
        alt: false,
        key: 'S',
      });
    }
    expect(parseShortcut('Option+T')).toEqual({ ctrl: false, shift: false, alt: true, key: 'T' });
  });

  it('refuses what is not one', () => {
    // `+S` is not here: a stray plus around a plain key is a typo for that key,
    // and `F5` with no modifier at all is a shortcut too.
    for (const text of ['', '   ', 'Ctrl+', 'Ctrl+S+P', 'Shift']) {
      expect(parseShortcut(text), JSON.stringify(text)).toBeNull();
    }
  });
});

describe('a shortcut pressed', () => {
  it('is the same shape as one written down', () => {
    const event = { key: 's', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false };
    expect(sameShortcut(shortcutOfEvent(event), shortcut('Ctrl+S'))).toBe(true);
  });

  it('counts the command key as control', () => {
    const event = { key: 's', ctrlKey: false, shiftKey: false, altKey: false, metaKey: true };
    expect(matchesShortcut(event, shortcut('Ctrl+S'))).toBe(true);
  });

  it('does not count a modifier that was not held', () => {
    const event = { key: 's', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false };
    expect(matchesShortcut(event, shortcut('Ctrl+S'))).toBe(false);
  });

  it('knows when the user is writing', () => {
    // `S` in a text field is the letter S, whatever command it happens to spell.
    expect(isTypingTarget(Object.assign(document.createElement('input'), {}))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('finding a command by typing', () => {
  const commands = [
    command('project.save', 'Save project'),
    command('project.saveAs', 'Save project as…'),
    command('project.open', 'Open project…'),
    command('project.close', 'Close project'),
    command('view.theme', 'Next theme', { hint: 'Cycle the themes this build ships' }),
  ];

  it('answers an empty query with everything, in order', () => {
    expect(filterCommands(commands, '').map((each) => each.id)).toEqual(commands.map((c) => c.id));
  });

  it('puts the thing that starts with what you typed first', () => {
    expect(filterCommands(commands, 'save')[0]?.id).toBe('project.save');
    // And a longer, more specific query does not change who wins.
    expect(filterCommands(commands, 'save as')[0]?.id).toBe('project.saveAs');
  });

  it('finds a word that is not the first one', () => {
    expect(filterCommands(commands, 'project').length).toBe(4);
    expect(filterCommands(commands, 'theme')[0]?.id).toBe('view.theme');
  });

  it('finds a command by its hint as well as its name', () => {
    // "Next theme" does not contain the word "cycle", and a palette that could
    // not find it would be a palette that only knows what it calls things.
    expect(filterCommands(commands, 'cycle')[0]?.id).toBe('view.theme');
  });

  it('matches letters in order even when they are not together', () => {
    const saveAs = commands[1];
    expect(saveAs === undefined ? null : scoreCommand(saveAs, 'svas')).not.toBeNull();
    expect(saveAs === undefined ? null : scoreCommand(saveAs, 'svq')).toBeNull();
  });

  it('needs every word, and not just one of them', () => {
    const save = commands[0];
    expect(save === undefined ? null : scoreCommand(save, 'save project')).not.toBeNull();
    expect(save === undefined ? null : scoreCommand(save, 'save zebra')).toBeNull();
  });

  it('leaves out what does not match at all, and keeps ties in order', () => {
    expect(filterCommands(commands, 'zzz')).toEqual([]);
    const tie = filterCommands([command('a', 'Alpha'), command('b', 'Beta')], '');
    expect(tie.map((each) => each.id)).toEqual(['a', 'b']);
  });
});

describe('the registry', () => {
  it('holds what was registered, in the order it arrived', () => {
    const registry = createCommandRegistry();
    registry.register([command('a', 'A')]);
    registry.register([command('b', 'B')]);
    expect(registry.current().map((each) => each.id)).toEqual(['a', 'b']);
  });

  it('replaces a command with the same id rather than adding a second one', () => {
    const registry = createCommandRegistry();
    registry.register([command('a', 'A', { run: () => 'first' })]);
    registry.register([command('a', 'A again', { run: () => 'second' })]);
    // A panel that re-rendered with a new closure is not leaking a second copy
    // of itself.
    expect(registry.current().length).toBe(1);
    expect(registry.current()[0]?.title).toBe('A again');
  });

  it('takes commands away again, and only those', () => {
    const registry = createCommandRegistry();
    registry.register([command('a', 'A'), command('b', 'B')]);
    const remove = registry.register([command('c', 'C')]);
    remove();
    expect(registry.current().map((each) => each.id)).toEqual(['a', 'b']);
  });

  it('tells its listeners, and stops telling the ones that left', () => {
    const registry = createCommandRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);

    registry.register([command('a', 'A')]);
    expect(listener).toHaveBeenCalledTimes(1);
    // The same array until something changes: a selector that reads `current()`
    // has to be able to hold the value without re-rendering.
    expect(registry.current()).toBe(registry.current());

    unsubscribe();
    registry.register([command('b', 'B')]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
