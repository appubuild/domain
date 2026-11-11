/** The provider that listens to the address.
 *
 *  `routes.ts` says what an address means; this is the component that hears one
 *  change. It is the only place in the app that reads `location`, and the only
 *  place that writes it:
 *
 *  * **`navigate` writes the address; the address is what changes the screen.**
 *    A click, the back button and a pasted link therefore all arrive by the same
 *    road — a screen that changed because a button was clicked without the
 *    address changing is a screen the back button cannot undo.
 *  * **A starting route is obeyed.** A test and a story both begin somewhere
 *    specific, and an address bar that says otherwise is not theirs to overrule.
 */

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import { RouterContext, type Router } from './router-context';
import { HOME, type Route, parseRoute, routeHref } from './routes';

export interface RouterProviderProps {
  readonly children: ReactNode;
  /** Where to start. Omitted, the address is the truth. */
  readonly initial?: Route;
}

export function RouterProvider({ children, initial }: RouterProviderProps): React.JSX.Element {
  const [route, setRoute] = useState<Route>(
    () => initial ?? (typeof window === 'undefined' ? HOME : parseRoute(window.location.hash)),
  );

  // Held in a ref and not read from the prop: this effect runs once.
  const started = useRef(initial !== undefined);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onHashChange = (): void => {
      setRoute(parseRoute(window.location.hash));
    };
    if (!started.current) onHashChange();
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  const navigate = useCallback((next: Route) => {
    if (typeof window === 'undefined') {
      setRoute(next);
      return;
    }
    if (window.location.hash === routeHref(next)) return;
    window.location.hash = routeHref(next);
    // Set here as well as in the listener: a hashchange is a task, and a click
    // that is not answered until the next tick is a click that feels ignored.
    setRoute(next);
  }, []);

  const value: Router = { route, navigate };

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}
