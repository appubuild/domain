/** The command registry as a React resource: what a component asks for.
 *
 *  Split out of `CommandProvider.tsx` for the reason every context in this
 *  codebase is split out of its provider — a module that exports a component
 *  and something else breaks fast refresh — and because this is the half a
 *  panel wants: the commands, and the way to add its own.
 */

import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';

import {
  type Command,
  type CommandRegistry,
  isTypingTarget,
  matchesShortcut,
  parseShortcut,
} from './commands';

export const CommandsContext = createContext<CommandRegistry | undefined>(undefined);

function useRegistry(): CommandRegistry {
  const registry = useContext(CommandsContext);
  if (registry === undefined) {
    throw new Error('no command registry in context — wrap this tree in <CommandsProvider>');
  }
  return registry;
}

export function useCommandRegistry(): CommandRegistry {
  return useRegistry();
}

/** Every command registered in this window, in registration order. */
export function useCommands(): readonly Command[] {
  const registry = useRegistry();
  return useSyncExternalStore(registry.subscribe, registry.current, registry.current);
}

/** Put commands in the window's list, and take them out on unmount.
 *
 *  The array must be stable — `useMemo` it. A new array on every render is a
 *  registration on every render, and an effect that runs forever. */
export function useRegisterCommands(commands: readonly Command[]): void {
  const registry = useRegistry();
  useEffect(() => registry.register(commands), [commands, registry]);
}

/** Bind every command's shortcut to the window.
 *
 *  Two rules, both of them the kind a user notices when they are wrong:
 *
 *  * A key press **while typing** is the user's, not ours, unless it carries a
 *    modifier. `S` in a text field is the letter S.
 *  * A shortcut that matched is `preventDefault`ed, so `Ctrl+S` does not also
 *    open the browser's own save dialog.
 */
export function useCommandShortcuts(commands: readonly Command[]): void {
  useEffect(() => {
    const bindings = commands.map((command) => ({
      command,
      shortcut: command.shortcut === undefined ? null : parseShortcut(command.shortcut),
    }));

    function onKeyDown(event: KeyboardEvent): void {
      // Held keys repeat, and a command run sixty times a second is not what
      // holding a key down means.
      if (event.repeat) return;
      for (const { command, shortcut } of bindings) {
        if (shortcut === null || command.disabled) continue;
        if (!matchesShortcut(event, shortcut)) continue;
        if (!shortcut.ctrl && !shortcut.alt && isTypingTarget(event.target)) continue;
        event.preventDefault();
        command.run();
        return;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [commands]);
}
