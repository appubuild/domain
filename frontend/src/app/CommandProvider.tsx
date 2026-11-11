/** The one command registry in the window, and the only thing that owns one.
 *
 *  One per window, made here rather than imported, so a test can hold one and a
 *  story can render two. Everything a component does with it — reading the
 *  commands, registering its own, binding the keys — is in `useCommands.ts`.
 */

import { type ReactNode, useMemo } from 'react';

import { type CommandRegistry, createCommandRegistry } from './commands';
import { CommandsContext } from './useCommands';

export interface CommandsProviderProps {
  readonly children: ReactNode;
  /** Injected so a test can hold the registry it asserts against. */
  readonly registry?: CommandRegistry | undefined;
}

export function CommandsProvider({ children, registry }: CommandsProviderProps): React.JSX.Element {
  // Made once per provider and not per render: a registry rebuilt on every
  // render forgets every command sixty times a second.
  const owned = useMemo(() => registry ?? createCommandRegistry(), [registry]);
  return <CommandsContext.Provider value={owned}>{children}</CommandsContext.Provider>;
}
