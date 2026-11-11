/** The media slice: what has been imported into one project, and which row is
 *  selected.
 *
 *  A store rather than a hook, because **two panes read it at once**: the bin
 *  lists the assets and the inspector describes the one that is selected. Two
 *  hooks would be two fetches of the same list, and two copies of it — which is
 *  the copy that goes stale first when the other one imports something.
 *
 *  Three rules, the same three the project slice keeps:
 *
 *  * **A failed read never empties the bin.** A refresh that failed keeps the
 *    assets it had and records the problem. A network hiccup is not the same as
 *    "you imported nothing", and a panel that shows the second for the first is
 *    a panel that makes people re-import.
 *  * **An import is a report, not a verdict.** The service answers with what came
 *    in, what was already there and what failed, because a batch of forty files
 *    cannot fail as a batch. The report is kept here; the panel decides how to
 *    say it.
 *  * **The selection is an id, not an asset.** A selected asset is *the thing in
 *    the list*, and holding the summary instead would be holding a second answer
 *    to "what is this file" that survives the file being relinked.
 *
 *  Refetches coalesce, and one that is already in flight is joined rather than
 *  started again: otherwise the last answer to arrive wins, and "last" is not
 *  always "newest".
 */

import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { ApiClient } from '../core/api/client';
import type { ImportResponse, MediaAssetSummary } from '../core/api/contract';
import type { ApiProblem } from '../core/api/problem';
import type { EventEnvelope } from '../core/events/protocol';
import { err, ok, type Result } from '../core/result';

export type MediaStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface MediaState {
  /** Whose bin this is. `null` before the first load, and reset when the
   *  window moves to another project. */
  readonly projectId: string | null;
  readonly assets: readonly MediaAssetSummary[];
  /** How many no longer resolve to a file. Shown, because a bin that says "12
   *  items" when two of them are gone is a bin that lies. */
  readonly missing: number;
  readonly status: MediaStatus;
  /** Whether an import is in flight. Separate from `status`: a refresh and an
   *  import are different waits, and one spinner for both is a lie about which
   *  one is running. */
  readonly importing: boolean;
  readonly error: ApiProblem | null;
  /** What the last import did, if there has been one. */
  readonly lastImport: ImportResponse | null;
  /** The asset the inspector is describing. `null` for "nothing selected". */
  readonly selectedId: string | null;

  /** Load another project's bin. A different project empties this one first:
   *  showing the previous project's files under a new project's name is worse
   *  than showing nothing for the moment it takes to ask. */
  readonly load: (projectId: string) => Promise<Result<void, ApiProblem>>;
  /** Ask again. Keeps what it has if the answer does not come. */
  readonly refresh: () => Promise<Result<void, ApiProblem>>;
  /** Import paths, and report rather than throw. */
  readonly importPaths: (paths: readonly string[]) => Promise<Result<ImportResponse, ApiProblem>>;
  /** Select an asset, or nothing. */
  readonly select: (assetId: string | null) => void;
  /** One event, as a notification: `media.*` and `asset.*` mean ask again. */
  readonly applyEvent: (envelope: EventEnvelope) => void;
}

export type MediaStore = StoreApi<MediaState>;

export function createMediaStore(client: ApiClient): MediaStore {
  /** One fetch per project, keyed by it.
   *
   *  Keyed, and not one slot for the store: a request for the project the
   *  window has just moved to must not *join* the request for the project it
   *  left. Joining is right for two asks about the same bin — the failure it
   *  prevents is an older answer landing last — and wrong across projects,
   *  where it would leave the new project's bin waiting on the old project's
   *  slow answer, which is then thrown away. */
  const inflight = new Map<string, Promise<Result<void, ApiProblem>>>();
  const askedAgain = new Set<string>();

  return createStore<MediaState>()((set, get) => {
    function fetchFor(projectId: string): Promise<Result<void, ApiProblem>> {
      const existing = inflight.get(projectId);
      if (existing !== undefined) {
        askedAgain.add(projectId);
        return existing;
      }
      set({ status: 'loading' });
      const request = client
        .run('listMedia', { params: { project_id: projectId } })
        .then((result) => {
          if (!result.ok) {
            // Kept, not cleared: what we have is still the best answer we have.
            set({ status: 'error', error: result.error });
            return err(result.error);
          }
          if (get().projectId !== projectId) return ok(undefined);
          const selected = get().selectedId;
          set({
            assets: result.value.assets,
            missing: result.value.missing,
            status: 'ready',
            error: null,
            // A selection that has been imported away is not a selection: the
            // inspector would describe a file that is no longer in the project.
            ...(selected !== null &&
            !result.value.assets.some((asset) => asset.asset_id === selected)
              ? { selectedId: null }
              : {}),
          });
          return ok(undefined);
        })
        .then(async (answer) => {
          inflight.delete(projectId);
          if (askedAgain.delete(projectId)) return await fetchFor(projectId);
          return answer;
        });
      inflight.set(projectId, request);
      return request;
    }

    function fetch(): Promise<Result<void, ApiProblem>> {
      const projectId = get().projectId;
      if (projectId === null) return Promise.resolve(ok(undefined));
      return fetchFor(projectId);
    }

    return {
      projectId: null,
      assets: [],
      missing: 0,
      status: 'idle',
      importing: false,
      error: null,
      lastImport: null,
      selectedId: null,

      async load(projectId) {
        if (get().projectId === projectId) return await fetch();
        set({
          projectId,
          assets: [],
          missing: 0,
          status: 'idle',
          error: null,
          selectedId: null,
        });
        return await fetch();
      },

      refresh() {
        return fetch();
      },

      async importPaths(paths) {
        const projectId = get().projectId;
        if (projectId === null) {
          return err({
            kind: 'contract',
            status: 0,
            code: 'transport/missing-path-param',
            detail: 'import into a project that has not been loaded',
          });
        }
        set({ importing: true });
        const result = await client.run('importMedia', {
          params: { project_id: projectId },
          body: { paths: [...paths] },
        });
        set({ importing: false });
        if (!result.ok) {
          set({ error: result.error });
          return err(result.error);
        }
        set({ lastImport: result.value });
        // Asked again rather than spliced in: the service decides what an asset
        // is, and a panel that invented the summary would be a second opinion.
        await fetch();
        return ok(result.value);
      },

      select(assetId) {
        set({ selectedId: assetId });
      },

      applyEvent(envelope) {
        if (!envelope.topic.startsWith('media.') && !envelope.topic.startsWith('asset.')) {
          return;
        }
        void fetch();
      },
    };
  });
}

// -- the tree's view of it ---------------------------------------------------

export const MediaStoreContext = createContext<MediaStore | undefined>(undefined);

function useMediaStoreInContext(): MediaStore {
  const store = useContext(MediaStoreContext);
  if (!store) {
    throw new Error('no media store in context — wrap this tree in <MediaStoreContext.Provider>');
  }
  return store;
}

/** Read from the media store. Throws without a provider, for the same reason
 *  `useApi` does: a store that is not there is a silent no-op, and a silent
 *  no-op is the failure nobody traces. */
export function useMediaStore<T>(selector: (state: MediaState) => T): T {
  return useStore(useMediaStoreInContext(), selector);
}

/** The store itself, for a view-model that wants its actions as well as its
 *  state. */
export function useMediaStoreApi(): MediaStore {
  return useMediaStoreInContext();
}
