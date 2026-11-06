/** The window's shell: what is on screen before there is a project.
 *
 * Routing, the dock tree and the window chrome belong to `app/` once they
 * exist. Until then this file is deliberately three lines long, because a shell
 * that guessed at a layout is a layout somebody has to delete later.
 */

import { Splash } from './features/splash/Splash';

export function App(): React.JSX.Element {
  return <Splash />;
}
