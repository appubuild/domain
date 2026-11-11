/** The router as a context: what a component asks for.
 *
 *  Split out of `router.tsx` because a module that exports a component and
 *  something else breaks fast refresh, and because this is the half a panel
 *  actually wants — the address, and the way to change it — while the provider
 *  is the half that owns the listener.
 */

import { createContext, useContext } from 'react';

import type { Route } from './routes';

export interface Router {
  readonly route: Route;
  readonly navigate: (route: Route) => void;
}

export const RouterContext = createContext<Router | undefined>(undefined);

/** The router this tree was given.
 *
 *  Throws when there is none, like `useApi`: a component that silently rendered
 *  the wrong screen is a component that is wrong on every developer's machine
 *  and nowhere else.
 */
export function useRouter(): Router {
  const router = useContext(RouterContext);
  if (router === undefined) {
    throw new Error('no router in context — wrap this tree in <RouterProvider>');
  }
  return router;
}

/** The route, for a component that only reads it. */
export function useRoute(): Route {
  return useRouter().route;
}
