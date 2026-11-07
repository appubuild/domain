/** The window's shell, and the only place the window's pieces are bound.
 *
 *  Two states, and the difference between them is the whole of the boot
 *  sequence: the service is either answering, or the user is waiting for it to.
 *  Until it answers there is nothing to compose a workspace around — no store
 *  can be filled and no socket can be opened — so the splash is the window.
 *
 *  Dependency injection happens here rather than in a module: `useApi` gives the
 *  client `main.tsx` chose, and everything below takes what it needs from
 *  context. A component that imported its client, its store or its socket could
 *  not be rendered in a test.
 */

import { Splash } from './features/splash/Splash';
import { ProjectList } from './features/projects/ProjectList';
import { useServiceInfo } from './features/splash/useServiceInfo';
import { useApi } from './core/api/context';
import { WorkspaceProviders } from './app/providers';

export function App(): React.JSX.Element {
  const client = useApi();
  const service = useServiceInfo(client);

  if (service.kind !== 'ready') {
    return <Splash state={service} />;
  }

  return (
    <WorkspaceProviders client={client}>
      <ProjectList />
    </WorkspaceProviders>
  );
}
