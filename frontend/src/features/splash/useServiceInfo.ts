/** The splash's view-model: one question, asked once, answered honestly.
 *
 * MVVM in the shape `ARCHITECTURE.md` §4.1 asks for: the view renders state,
 * the view-model owns it, and the service is behind an interface so this file
 * can be tested with a stub instead of a running editor.
 *
 * The one interesting decision is **what "connecting" means to the user**. The
 * service is local, so a failure is almost always "it has not started yet" —
 * which is why the state machine has a `connecting` state that is not an error
 * and an `unreachable` state that names the remedy. A splash that showed a
 * red error after two milliseconds of boot is a splash that lies.
 */

import { useEffect, useState } from 'react';
import type { ApiClient } from '../../core/api/client';
import type { ApiProblem } from '../../core/api/problem';
import type { SystemInfoResponse } from '../../core/api/contract';

export type ServiceState =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'ready'; readonly info: SystemInfoResponse }
  | { readonly kind: 'unreachable'; readonly problem: ApiProblem };

/** Ask the service who it is. Cancels on unmount, because a component that
 *  outlives its request must not set state on a tree that is gone. */
export function useServiceInfo(client: ApiClient): ServiceState {
  const [state, setState] = useState<ServiceState>({ kind: 'connecting' });

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    void client.run('systemInfo', { signal: controller.signal }).then((result) => {
      if (!live) return;
      setState(
        result.ok
          ? { kind: 'ready', info: result.value }
          : { kind: 'unreachable', problem: result.error },
      );
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [client]);

  return state;
}
