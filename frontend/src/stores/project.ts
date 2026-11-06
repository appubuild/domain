/** The project slice: the file menu, as state.
 *
 *  Three rules decide what this store is allowed to do:
 *
 *  * **The service is the source of truth.** Every mutation here is a command
 *    or a call, and the answer that comes back replaces what we guessed. Nothing
 *    writes a project except the service, so there is no reconciling two truths —
 *    a store that kept its own copy of the timeline would need a merge
 *    algorithm, and a merge algorithm is where editors go to die.
 *  * **A failed read never empties the list.** A refresh that failed keeps the
 *    projects it had and records the problem: a network hiccup is not the same
 *    as "you have no projects", and a UI that shows the second for the first is
 *    a UI that lies about the user's work.
 *  * **An event is a notification, not a payload.** `project.*` means "ask
 *    again", never "here is the new state": the socket carries small envelopes by
 *    design (`api.md` §6), and a store that treated them as data would be a
 *    store that is wrong whenever one is dropped.
 *
 *  Refreshes coalesce. Two events in one tick produce one request, and a request
 *  already in flight is joined rather than started again — otherwise the last
 *  answer to arrive wins, and "last" is not always "newest".
 */

import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { ApiClient } from '../core/api/client';
import type {
  CheckpointResponse,
  OpenProjectResponse,
  ProjectSummary,
  SaveProjectResponse,
} from '../core/api/contract';
import type { ApiProblem } from '../core/api/problem';
import type { EventEnvelope } from '../core/events/protocol';
import { err, ok, type Result } from '../core/result';

/** Where the store is in its own life — separate from the socket's. */
export type ProjectStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ProjectState {
  /** Every project open in this session, in the order the service listed them. */
  readonly projects: readonly ProjectSummary[];
  /** The project the window is showing, when it is showing one. */
  readonly currentId: string | null;
  readonly status: ProjectStatus;
  /** The last failure, kept until the next success clears it. */
  readonly error: ApiProblem | null;

  /** Ask the service what is open, and replace the list with the answer. */
  readonly refresh: () => Promise<Result<void, ApiProblem>>;
  /** Create a project and make it the current one. */
  readonly create: (name: string, path?: string | null) => Promise<Result<string, ApiProblem>>;
  /** Open a `.nova` file. Warnings come back with it; they are the user's to read. */
  readonly open: (path: string) => Promise<Result<OpenProjectResponse, ApiProblem>>;
  /** Close a project without saving it. */
  readonly close: (projectId: string) => Promise<Result<void, ApiProblem>>;
  /** Save to the file it came from. */
  readonly save: (projectId: string) => Promise<Result<SaveProjectResponse, ApiProblem>>;
  /** Save to a new file, and make that its home. */
  readonly saveAs: (
    projectId: string,
    path: string,
  ) => Promise<Result<SaveProjectResponse, ApiProblem>>;
  /** Write a checkpoint now rather than waiting for autosave to owe one. */
  readonly checkpoint: (projectId: string) => Promise<Result<CheckpointResponse, ApiProblem>>;
  /** Which project the window is showing. */
  readonly select: (projectId: string | null) => void;
  /** One event, as a notification: `project.*` means ask again. */
  readonly applyEvent: (envelope: EventEnvelope) => void;
}

export type ProjectStore = StoreApi<ProjectState>;

export function createProjectStore(client: ApiClient): ProjectStore {
  let inflight: Promise<Result<void, ApiProblem>> | null = null;
  let askedAgain = false;

  return createStore<ProjectState>()((set, get) => {
    /** Upsert one summary, keeping the list's order. */
    function upsert(summary: ProjectSummary): void {
      const projects = get().projects;
      const index = projects.findIndex((item) => item.project_id === summary.project_id);
      set({
        projects:
          index === -1
            ? [...projects, summary]
            : projects.map((item) => (item.project_id === summary.project_id ? summary : item)),
      });
    }

    /** One refresh, and at most one more if somebody asked while it ran. */
    function refresh(): Promise<Result<void, ApiProblem>> {
      if (inflight) {
        askedAgain = true;
        return inflight;
      }
      set({ status: 'loading' });
      const request = client.run('listProjects');
      inflight = request
        .then((result) => {
          if (!result.ok) {
            // Kept, not cleared: the list we have is still the best answer we
            // have, and a failure is not evidence that it is empty.
            set({ status: 'error', error: result.error });
            return err(result.error);
          }
          set({ projects: result.value.projects, status: 'ready', error: null });
          return ok(undefined);
        })
        .then(async (answer) => {
          inflight = null;
          if (askedAgain) {
            askedAgain = false;
            await refresh();
          }
          return answer;
        });
      return inflight;
    }

    return {
      projects: [],
      currentId: null,
      status: 'idle',
      error: null,

      refresh,

      async create(name, path) {
        const result = await client.run('createProject', {
          body: { name, ...(path ? { path } : {}) },
        });
        if (!result.ok) {
          set({ status: 'error', error: result.error });
          return err(result.error);
        }
        const { project } = result.value;
        upsert(project);
        set({ currentId: project.project_id, status: 'ready', error: null });
        return ok(project.project_id);
      },

      async open(path) {
        const result = await client.run('openProject', { body: { path } });
        if (!result.ok) {
          set({ status: 'error', error: result.error });
          return err(result.error);
        }
        upsert(result.value.project);
        set({ currentId: result.value.project.project_id, status: 'ready', error: null });
        return ok(result.value);
      },

      async close(projectId) {
        const result = await client.run('closeProject', { params: { project_id: projectId } });
        if (!result.ok) {
          set({ status: 'error', error: result.error });
          return err(result.error);
        }
        set((state) => ({
          projects: state.projects.filter((item) => item.project_id !== projectId),
          ...(state.currentId === projectId ? { currentId: null } : {}),
          error: null,
        }));
        return ok(undefined);
      },

      async save(projectId) {
        const result = await client.run('saveProject', { params: { project_id: projectId } });
        if (!result.ok) {
          set({ status: 'error', error: result.error });
          return err(result.error);
        }
        // The save response names the file, not the project's new state: `dirty`
        // and the checkpoint counters live in the summary, and a store that
        // flipped them itself would be guessing at numbers the service owns.
        await refresh();
        set({ error: null });
        return ok(result.value);
      },

      async saveAs(projectId, path) {
        const result = await client.run('saveProjectAs', {
          params: { project_id: projectId },
          body: { path },
        });
        if (!result.ok) {
          set({ status: 'error', error: result.error });
          return err(result.error);
        }
        await refresh();
        set({ error: null });
        return ok(result.value);
      },

      async checkpoint(projectId) {
        const result = await client.run('checkpointProject', { params: { project_id: projectId } });
        if (!result.ok) {
          set({ status: 'error', error: result.error });
          return err(result.error);
        }
        // The checkpoint changes the counters, not the identity: ask for the
        // summary rather than inventing the numbers here.
        await refresh();
        return ok(result.value);
      },

      select(projectId) {
        set({ currentId: projectId });
      },

      applyEvent(envelope: EventEnvelope) {
        if (!envelope.topic.startsWith('project.')) return;
        void refresh();
      },
    };
  });
}

// -- the tree's view of it ---------------------------------------------------

export const ProjectStoreContext = createContext<ProjectStore | undefined>(undefined);

/** Read from the project store. Throws without a provider, for the same reason
 *  `useApi` does: a store that is not there is a silent no-op, and a silent
 *  no-op is the failure nobody traces. */
export function useProjectStore<T>(selector: (state: ProjectState) => T): T {
  const store = useContext(ProjectStoreContext);
  if (!store) {
    throw new Error(
      'no project store in context — wrap this tree in <ProjectStoreContext.Provider>',
    );
  }
  return useStore(store, selector);
}
