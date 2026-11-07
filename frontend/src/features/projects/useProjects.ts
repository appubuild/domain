/** The project list's view-model.
 *
 *  This is the whole of MVVM in about thirty lines: the view (`ProjectList`)
 *  renders these fields and calls these actions, and neither knows how the
 *  answers were obtained. Which is what lets the view be rendered against a
 *  store built on a client double, with no service running.
 *
 *  Actions are read from `getState()` and not selected, because they never
 *  change: selecting them would re-render the panel on every write to the store.
 */

import { useCallback, useEffect, useMemo } from 'react';

import type { ApiProblem } from '../../core/api/problem';
import type { ProjectSummary } from '../../core/api/contract';
import type { Result } from '../../core/result';
import { useProjectStore, useProjectStoreApi, type ProjectStatus } from '../../stores/project';

export interface ProjectsView {
  readonly projects: readonly ProjectSummary[];
  readonly currentId: string | null;
  readonly status: ProjectStatus;
  /** The last failure, for as long as nothing has succeeded since. */
  readonly error: ApiProblem | null;
  /** Whether there is anything to show yet, which is not the same as empty. */
  readonly loading: boolean;
  readonly refresh: () => void;
  readonly create: (name: string) => Promise<Result<string, ApiProblem>>;
  readonly close: (projectId: string) => Promise<Result<void, ApiProblem>>;
  readonly select: (projectId: string | null) => void;
}

export function useProjects(): ProjectsView {
  const store = useProjectStoreApi();
  const projects = useProjectStore((state) => state.projects);
  const currentId = useProjectStore((state) => state.currentId);
  const status = useProjectStore((state) => state.status);
  const error = useProjectStore((state) => state.error);

  const refresh = useCallback(() => {
    void store.getState().refresh();
  }, [store]);

  // Asked on mount as well as by the provider that owns this store: a panel that
  // assumed somebody else had filled it is a panel that is empty when it is
  // rendered on its own — in a test, or in a second window. The store coalesces,
  // so asking twice is one request.
  useEffect(() => {
    void store.getState().refresh();
  }, [store]);

  const create = useCallback((name: string) => store.getState().create(name), [store]);

  const close = useCallback((projectId: string) => store.getState().close(projectId), [store]);

  const select = useCallback(
    (projectId: string | null) => {
      store.getState().select(projectId);
    },
    [store],
  );

  return useMemo(
    () => ({
      projects,
      currentId,
      status,
      error,
      loading: status === 'idle' || status === 'loading',
      refresh,
      create,
      close,
      select,
    }),
    [projects, currentId, status, error, refresh, create, close, select],
  );
}
