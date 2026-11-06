/** The client as a React context, so no component has to be handed one.
 *
 * Dependency injection at the window's edge (`ARCHITECTURE.md` §5.2). A
 * component that imported a singleton client could not be rendered in a test
 * without a service, and a test that needs a service is a test nobody runs on a
 * laptop with the lid half closed.
 *
 * The context carries the *interface*, not the factory: `main.tsx` decides
 * which adapters to bind, and everything below it just asks for one.
 */

import { createContext, useContext, type Context } from 'react';
import type { ApiClient } from './client';

export const ApiContext: Context<ApiClient | undefined> = createContext<ApiClient | undefined>(
  undefined,
);

/** The client this tree was given.
 *
 * Throws when it was not — which sounds like the opposite of the house style
 * until you notice there is no sensible default: a component talking to a
 * service that was never configured would silently do nothing, and "nothing"
 * is the hardest failure to debug.
 */
export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) {
    throw new Error('no ApiClient in context — wrap this tree in <ApiContext.Provider>');
  }
  return client;
}
