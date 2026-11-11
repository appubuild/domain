/** Commands: the one list of things the window can be told to do.
 *
 *  A command is a name, a shortcut and a `run`, and it is the seam a keyboard
 *  shortcut, a menu item, a button and the command palette all reach through —
 *  so "Save" is one thing that appears in four places rather than four things
 *  that can disagree about whether saving is allowed right now.
 *
 *  Two things live here and nowhere else:
 *
 *  * **Shortcut grammar.** A shortcut is a string (`Ctrl+Shift+P`) so it can
 *    live in data — a plugin's manifest, a settings row the user edited — and
 *    `parseShortcut` turns that string into something comparable. `Ctrl` means
 *    *either* control or the command key: a Mac user pressing Cmd+S is not
 *    pressing a different shortcut, and an editor that told them to learn both
 *    would be an editor for one platform.
 *  * **Fuzzy matching.** The palette ranks by what the user typed, and the
 *    ranking is a pure function — a test can say that `sa` finds "Save" before
 *    it finds "Save as…", which is a thing a substring search gets wrong.
 *
 *  The registry is deliberately not a global: a window makes one, the tree is
 *  handed it through context, and a test makes its own.
 */

import type { IconName } from '../ui/icons';

export interface Command {
  /** Stable, and unique: it is the key an unregister and a test both use. */
  readonly id: string;
  /** Already translated. A command does not know what language it is in. */
  readonly title: string;
  /** A sentence about what it does, shown beside it in the palette. */
  readonly hint?: string;
  /** `Ctrl+S`, `Ctrl+Shift+P`, `F5`. Parsed, never compared as text. */
  readonly shortcut?: string;
  readonly icon?: IconName;
  /** Greyed out rather than hidden: a command that vanishes from the palette
   *  when it does not apply teaches the user that the palette is unreliable. */
  readonly disabled?: boolean;
  readonly run: () => void;
}

// -- shortcuts ---------------------------------------------------------------

export interface Shortcut {
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  /** The key, upper case, or a name like `F5`. */
  readonly key: string;
}

const MODIFIERS = new Set(['ctrl', 'control', 'shift', 'alt', 'option', 'meta', 'cmd', 'command']);

/** Read a shortcut out of data. `null` when it is not one — an empty string, a
 *  bare `Ctrl+`, a key nobody pressed. */
export function parseShortcut(text: string): Shortcut | null {
  const parts = text
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0) return null;

  const shortcut = {
    ctrl: false,
    shift: false,
    alt: false,
    key: '',
  };

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (MODIFIERS.has(lower)) {
      if (lower === 'shift') shortcut.shift = true;
      else if (lower === 'alt' || lower === 'option') shortcut.alt = true;
      else shortcut.ctrl = true;
      continue;
    }
    // Two keys with no modifier between them is not a shortcut.
    if (shortcut.key !== '') return null;
    shortcut.key = part.length === 1 ? part.toUpperCase() : part.toUpperCase();
  }

  return shortcut.key === '' ? null : shortcut;
}

/** The shortcut a key event *is*, in the same shape as `parseShortcut`. */
export function shortcutOfEvent(event: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}): Shortcut {
  return {
    // Cmd on a Mac and Ctrl everywhere else are the same gesture to a hand that
    // has used both, and one `ctrl` flag is what lets a command say it once.
    ctrl: event.ctrlKey || event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
    key: event.key.length === 1 ? event.key.toUpperCase() : event.key.toUpperCase(),
  };
}

export function sameShortcut(a: Shortcut, b: Shortcut): boolean {
  return a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt && a.key === b.key;
}

/** Whether a command's shortcut is the one being pressed. */
export function matchesShortcut(
  event: Parameters<typeof shortcutOfEvent>[0],
  shortcut: Shortcut,
): boolean {
  return sameShortcut(shortcutOfEvent(event), shortcut);
}

/** Whether a key press happened while the user was typing — a shortcut with no
 *  modifier must not steal the letter they were writing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

// -- finding a command by name ----------------------------------------------

/** How well a command matches what was typed, or `null` when it does not.
 *
 *  Higher is better. What is being approximated is the order a person expects:
 *  the thing that *starts* with what you typed first, then the thing whose word
 *  starts with it, then the thing that merely contains the letters. */
export function scoreCommand(command: Command, query: string): number | null {
  const words = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');
  if (words.length === 0) return 0;

  let total = 0;
  for (const word of words) {
    const inTitle = subsequenceScore(command.title, word);
    const inHint = command.hint === undefined ? null : subsequenceScore(command.hint, word);
    const best = Math.max(inTitle ?? Number.NEGATIVE_INFINITY, inHint ?? Number.NEGATIVE_INFINITY);
    // Every word has to be found somewhere, or the command is not a match: a
    // palette that answered "save" to "sv ae" is a palette that answers noise.
    if (best === Number.NEGATIVE_INFINITY) return null;
    total += best;
  }
  return total;
}

/** Where in `haystack` the letters of `needle` appear, and how good that is. */
function subsequenceScore(haystack: string, needle: string): number | null {
  const hay = haystack.toLowerCase();
  const nee = needle.toLowerCase();
  if (nee === '') return 0;

  const at = hay.indexOf(nee);
  if (at === 0) return 1_000;
  if (at > 0) {
    // A word start is what the user means nine times out of ten.
    const boundary = /\s|[^\p{L}\p{N}]/u.test(hay[at - 1] ?? '');
    return boundary ? 800 : Math.max(400 - at, 1);
  }

  // Not contiguous: walk it as a subsequence, charging for every gap.
  let from = 0;
  let gaps = 0;
  let previous = -1;
  let score = 200;
  for (const char of nee) {
    const found = hay.indexOf(char, from);
    if (found === -1) return null;
    if (previous >= 0 && found !== previous + 1) gaps += 1;
    previous = found;
    from = found + 1;
  }
  score -= gaps * 5;
  return score > 0 ? score : 1;
}

/** The commands matching `query`, best first. Ties keep registration order, so
 *  a palette does not reshuffle itself as the user types. */
export function filterCommands(commands: readonly Command[], query: string): readonly Command[] {
  const scored: { readonly command: Command; readonly score: number; readonly index: number }[] =
    [];
  commands.forEach((command, index) => {
    const score = scoreCommand(command, query);
    if (score !== null) scored.push({ command, score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((entry) => entry.command);
}

// -- the registry ------------------------------------------------------------

export interface CommandRegistry {
  /** Add commands, and get back the way to take them away. Registering the
   *  same id twice replaces the earlier one: a panel that re-renders with a new
   *  `run` closure is not leaking a second copy of itself. */
  readonly register: (commands: readonly Command[]) => () => void;
  readonly current: () => readonly Command[];
  readonly subscribe: (listener: () => void) => () => void;
}

export function createCommandRegistry(): CommandRegistry {
  // One array, replaced on every change and never mutated: `useSyncExternalStore`
  // and every selector that reads `current()` need a value they can hold.
  let commands: readonly Command[] = [];
  const listeners = new Set<() => void>();

  function changed(): void {
    for (const listener of listeners) listener();
  }

  return {
    register(next) {
      commands = [...commands.filter((command) => !next.some((n) => n.id === command.id)), ...next];
      changed();
      return () => {
        const ids = new Set(next.map((command) => command.id));
        commands = commands.filter((command) => !ids.has(command.id));
        changed();
      };
    },
    current() {
      return commands;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
