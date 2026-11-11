/** The settings slice: what one project renders and mixes to.
 *
 *  The fourth slice, and the first one that *writes*. Four rules decide what it
 *  is allowed to do, and the first is the one that matters:
 *
 *  * **A change is a command, and the answer replaces what we held.** The panel
 *    never keeps a local copy of the settings it is about to post. A store that
 *    optimistically applied a new frame size would then have to reconcile it
 *    with the service's answer — and a store that reconciles needs to know which
 *    of the two is right, which is a merge algorithm, and a merge algorithm is
 *    where editors go to die.
 *  * **The patch is the whole request.** A panel names the settings it changed
 *    and nothing else, because two panels can hold two settings open at once
 *    and neither knows the other's values.
 *  * **The undo stack is the service's.** `can_undo` travels with every answer,
 *    so the panel's Ctrl+Z and the service's Ctrl+Z are the same Ctrl+Z. A
 *    store that tracked its own depth would disagree with the service after the
 *    first dropped event.
 *  * **A refusal is a value, not a throw.** A sample rate the service will not
 *    mix is an `ApiProblem` the panel prints, in the service's own words.
 *
 *  An event is a **notification, not a payload**: `command.*` means ask again.
 */

import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { ApiClient } from '../core/api/client';
import type {
  HistorySummary,
  SettingsCommandResponse,
  SettingsRedoResponse,
  SettingsSummary,
  SettingsUndoResponse,
} from '../core/api/contract';
import type { ApiProblem } from '../core/api/problem';
import type { EventEnvelope } from '../core/events/protocol';
import { err, ok, type Result } from '../core/result';

export type SettingsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface SettingsState {
  /** Whose settings these are. `null` before the first load. */
  readonly projectId: string | null;
  /** The settings, as the service last reported them. `null` until asked. */
  readonly settings: SettingsSummary | null;
  /** The settings stack: what the panel's undo and redo would do. */
  readonly history: HistorySummary | null;
  readonly dirty: boolean;
  readonly journalSequence: number;
  /** Changes since the last checkpoint — what a crash would lose. */
  readonly pendingCommands: number;
  readonly status: SettingsStatus;
  readonly error: ApiProblem | null;
  /** What the last change did, in the service's own words. Shown, because a
   *  change that says nothing looks like a change that did nothing. */
  readonly lastSummary: string | null;

  readonly load: (projectId: string) => Promise<Result<void, ApiProblem>>;
  readonly refresh: () => Promise<Result<void, ApiProblem>>;
  /** Change one or more settings. Only the fields given are sent. */
  readonly patch: (change: SettingsPatch) => Promise<Result<SettingsCommandResponse, ApiProblem>>;
  /** Undo the last settings change. */
  readonly undo: () => Promise<Result<boolean, ApiProblem>>;
  /** Redo the last undone settings change. */
  readonly redo: () => Promise<Result<boolean, ApiProblem>>;
  readonly applyEvent: (envelope: EventEnvelope) => void;
}

/** What a caller may change. Every field is optional, and one left out is one
 *  the caller has no opinion about — which is the whole point of a patch. */
export interface SettingsPatch {
  readonly frame_size?: { readonly width: number; readonly height: number };
  readonly sample_rate?: number;
  readonly channels?: number;
  readonly use_proxies?: boolean;
  readonly working_colour_space?: number;
}

export type SettingsStore = StoreApi<SettingsState>;

export function createSettingsStore(client: ApiClient): SettingsStore {
  /** One fetch per project, keyed by it: a request for the project the window
   *  has just moved to must not join the request for the project it left. */
  const inflight = new Map<string, Promise<Result<void, ApiProblem>>>();
  const askedAgain = new Set<string>();

  return createStore<SettingsState>()((set, get) => {
    function fetchFor(projectId: string): Promise<Result<void, ApiProblem>> {
      const existing = inflight.get(projectId);
      if (existing !== undefined) {
        askedAgain.add(projectId);
        return existing;
      }
      set({ status: 'loading' });
      const request = client
        .run('getSettings', { params: { project_id: projectId } })
        .then((result) => {
          if (!result.ok) {
            // Kept, not cleared: the settings we are showing are still the best
            // answer we have, and a failure is not evidence that they changed.
            set({ status: 'error', error: result.error });
            return err(result.error);
          }
          if (get().projectId !== projectId) return ok(undefined);
          set(whole(result.value));
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

    /** One write. Shared by `patch`, `undo` and `redo`, because the three do
     *  the same thing to the answer: replace what is held with what the
     *  service says is true now, and report the refusal when there is one. */
    async function write<Response extends SettingsResponseLike>(
      call: () => Promise<Result<Response, ApiProblem>>,
    ): Promise<Result<Response, ApiProblem>> {
      const projectId = get().projectId;
      if (projectId === null) {
        return err(staleProject());
      }
      const result = await call();
      if (!result.ok) {
        // Recorded and *kept*: a refusal is not a change, so the settings we
        // are showing are still the settings there are.
        set({ error: result.error, status: 'error' });
        return err(result.error);
      }
      if (get().projectId !== projectId) return err(staleProject());
      set({
        settings: result.value.settings,
        history: result.value.history,
        dirty: result.value.dirty,
        journalSequence: result.value.journal_sequence,
        pendingCommands: result.value.pending_commands,
        // Only the command answer carries a sentence about what it did; an undo
        // and a redo say what they did by what the settings are now.
        lastSummary: result.value.summary ?? null,
        status: 'ready',
        error: null,
      });
      return ok(result.value);
    }

    return {
      projectId: null,
      settings: null,
      history: null,
      dirty: false,
      journalSequence: 0,
      pendingCommands: 0,
      status: 'idle',
      error: null,
      lastSummary: null,

      async load(projectId) {
        if (get().projectId !== projectId) {
          set({
            projectId,
            settings: null,
            history: null,
            dirty: false,
            journalSequence: 0,
            pendingCommands: 0,
            status: 'idle',
            error: null,
            lastSummary: null,
          });
        }
        return await fetch();
      },

      refresh() {
        return fetch();
      },

      patch(change) {
        const projectId = get().projectId;
        if (projectId === null) {
          return Promise.resolve(err(staleProject()));
        }
        return write<SettingsCommandResponse>(() =>
          client.run('patchSettings', {
            params: { project_id: projectId },
            // A patch, not a replacement: fields the caller did not name stay
            // out of the body, and the service leaves them alone.
            body: { type: 'set-settings', ...change },
          }),
        );
      },

      async undo() {
        const projectId = get().projectId;
        if (projectId === null) return err(staleProject());
        const result = await write<SettingsUndoResponse>(() =>
          client.run('undoSettings', { params: { project_id: projectId } }),
        );
        return result.ok ? ok(result.value.undone) : err(result.error);
      },

      async redo() {
        const projectId = get().projectId;
        if (projectId === null) return err(staleProject());
        const result = await write<SettingsRedoResponse>(() =>
          client.run('redoSettings', { params: { project_id: projectId } }),
        );
        return result.ok ? ok(result.value.redone) : err(result.error);
      },

      applyEvent(envelope) {
        // `command.*` is the project changing. A settings change is one, which
        // is why the panel's undo and the timeline's undo share a topic: the
        // envelope says "ask again", never "here is the new state".
        if (!envelope.topic.startsWith('command.')) return;
        void fetch();
      },
    };
  });
}

/** One response, as the state it becomes. */
function whole(
  response: SettingsResponseLike,
): Pick<
  SettingsState,
  'settings' | 'history' | 'dirty' | 'journalSequence' | 'pendingCommands' | 'status' | 'error'
> {
  return {
    settings: response.settings,
    history: response.history,
    dirty: response.dirty,
    journalSequence: response.journal_sequence,
    pendingCommands: response.pending_commands,
    status: 'ready',
    error: null,
  };
}

/** What every settings answer carries, whichever endpoint sent it. The three
 *  write endpoints differ only in what they add on top: a sentence about what
 *  it did, or whether there was anything to undo. */
interface SettingsResponseLike {
  readonly settings: SettingsSummary;
  readonly history: HistorySummary;
  readonly dirty: boolean;
  readonly journal_sequence: number;
  readonly pending_commands: number;
  /** Only the command answer has it: a sentence about what it did. */
  readonly summary?: string;
}

/** The problem a write gets when no project has been loaded. */
function staleProject(): ApiProblem {
  return {
    kind: 'contract',
    status: 0,
    code: 'transport/missing-path-param',
    detail: 'change the settings of a project that has not been loaded',
  };
}

// -- the tree's view of it ---------------------------------------------------

export const SettingsStoreContext = createContext<SettingsStore | undefined>(undefined);

function useSettingsStoreInContext(): SettingsStore {
  const store = useContext(SettingsStoreContext);
  if (!store) {
    throw new Error(
      'no settings store in context — wrap this tree in <SettingsStoreContext.Provider>',
    );
  }
  return store;
}

/** Read from the settings store. Throws without a provider, for the same reason
 *  `useApi` does: a store that is not there is a silent no-op, and a silent
 *  no-op is the failure nobody traces. */
export function useSettingsStore<T>(selector: (state: SettingsState) => T): T {
  return useStore(useSettingsStoreInContext(), selector);
}

export function useSettingsStoreApi(): SettingsStore {
  return useSettingsStoreInContext();
}
