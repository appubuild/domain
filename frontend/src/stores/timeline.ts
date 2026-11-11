/** The timeline slice, read half: the edit as it stands.
 *
 *  Stage 6 needs two numbers out of the edit that no other slice can give it —
 *  **the frame rate** and **how long the project is** — because a timecode
 *  without a rate is a number and a transport without an end is a play button
 *  that never stops. Stage 7 adds the other half: the commands, the selection of
 *  clips, and the undo stack's view of history.
 *
 *  What is deliberately not here:
 *
 *  * **No editing.** A change to the edit is a command, posted through the
 *    timeline router, and the answer replaces what is held. A store that moved a
 *    clip locally and reconciled later would need a merge algorithm, and a merge
 *    algorithm is where editors go to die.
 *  * **No optimistic updates.** An edit is acknowledged by the service, and it
 *    is the service that says what the timeline is now. A timeline drawn from a
 *    guess is a timeline the user has already started cutting against.
 *
 *  An event is a **notification, not a payload**: `command.*` means ask again.
 *  The socket carries small envelopes by design (`api.md` §6), and a store that
 *  treated them as data would be wrong whenever one is dropped.
 */

import { createContext, useContext, useMemo } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { ApiClient } from '../core/api/client';
import type { HistorySummary, TimelineResponse, TimelineSummary } from '../core/api/contract';
import type { ApiProblem } from '../core/api/problem';
import type { EventEnvelope } from '../core/events/protocol';
import { err, ok, type Result } from '../core/result';
import { DEFAULT_TIMEBASE, type Timebase } from '../core/timecode/timebase';

export type TimelineStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface TimelineState {
  readonly projectId: string | null;
  /** The edit: its rate, its tracks, how long it is. `null` until asked. */
  readonly timeline: TimelineSummary | null;
  /** What undo and redo would do, which the Edit menu and the status bar read
   *  off the same answer rather than each asking for their own. */
  readonly history: HistorySummary | null;
  readonly dirty: boolean;
  readonly journalSequence: number;
  /** Edits since the last checkpoint — what a crash would lose. */
  readonly pendingCommands: number;
  readonly status: TimelineStatus;
  readonly error: ApiProblem | null;

  readonly load: (projectId: string) => Promise<Result<void, ApiProblem>>;
  readonly refresh: () => Promise<Result<void, ApiProblem>>;
  readonly applyEvent: (envelope: EventEnvelope) => void;
}

export type TimelineStore = StoreApi<TimelineState>;

export function createTimelineStore(client: ApiClient): TimelineStore {
  /** One fetch per project, keyed by it: a request for the project the window
   *  has just moved to must not join the request for the project it left. */
  const inflight = new Map<string, Promise<Result<void, ApiProblem>>>();
  const askedAgain = new Set<string>();

  return createStore<TimelineState>()((set, get) => {
    function fetchFor(projectId: string): Promise<Result<void, ApiProblem>> {
      const existing = inflight.get(projectId);
      if (existing !== undefined) {
        askedAgain.add(projectId);
        return existing;
      }
      set({ status: 'loading' });
      const request = client
        .run('getTimeline', { params: { project_id: projectId } })
        .then((result) => {
          if (!result.ok) {
            // Kept, not cleared: the edit we drew is still the best answer we
            // have, and a failure is not evidence that the project is empty.
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

    return {
      projectId: null,
      timeline: null,
      history: null,
      dirty: false,
      journalSequence: 0,
      pendingCommands: 0,
      status: 'idle',
      error: null,

      async load(projectId) {
        if (get().projectId !== projectId) {
          set({
            projectId,
            timeline: null,
            history: null,
            dirty: false,
            journalSequence: 0,
            pendingCommands: 0,
            status: 'idle',
            error: null,
          });
        }
        return await fetch();
      },

      refresh() {
        return fetch();
      },

      applyEvent(envelope) {
        // `command.*` is the edit changing: a clip moved, an undo, a caption
        // track replaced. Anything else is a project lifecycle event, which the
        // project slice already handles.
        if (!envelope.topic.startsWith('command.')) return;
        void fetch();
      },
    };
  });
}

/** One response, as the state it becomes. Spread rather than assigned field by
 *  field, so a field the contract grows is a field this store holds. */
function whole(
  response: TimelineResponse,
): Pick<
  TimelineState,
  'timeline' | 'history' | 'dirty' | 'journalSequence' | 'pendingCommands' | 'status' | 'error'
> {
  return {
    timeline: response.timeline,
    history: response.history,
    dirty: response.dirty,
    journalSequence: response.journal_sequence,
    pendingCommands: response.pending_commands,
    status: 'ready',
    error: null,
  };
}

// -- the tree's view of it ---------------------------------------------------

export const TimelineStoreContext = createContext<TimelineStore | undefined>(undefined);

function useTimelineStoreInContext(): TimelineStore {
  const store = useContext(TimelineStoreContext);
  if (!store) {
    throw new Error(
      'no timeline store in context — wrap this tree in <TimelineStoreContext.Provider>',
    );
  }
  return store;
}

export function useTimelineStore<T>(selector: (state: TimelineState) => T): T {
  return useStore(useTimelineStoreInContext(), selector);
}

export function useTimelineStoreApi(): TimelineStore {
  return useTimelineStoreInContext();
}

// -- what a pane actually asks for -------------------------------------------

/** The project's frame rate, as the exact rational the service sent.
 *
 *  `DEFAULT_TIMEBASE` only until the first answer arrives, and never after: a
 *  timecode formatted at the wrong rate is a timecode that is wrong in a way
 *  nobody notices until the export does not match. */
export function useTimebase(): Timebase {
  // Selected as two numbers and put back together here, rather than selected as
  // an object: a selector that built a new object on every call would make the
  // component re-render on every store write that was not a rate change.
  const num = useTimelineStore((state) => state.timeline?.timebase.num ?? DEFAULT_TIMEBASE.num);
  const den = useTimelineStore((state) => state.timeline?.timebase.den ?? DEFAULT_TIMEBASE.den);
  return useMemo(() => ({ num, den }), [num, den]);
}

/** How long the edit is, in frames. `0` before the first answer — which is also
 *  how long an empty timeline is, and that is not a coincidence. */
export function useDurationFrames(): number {
  return useTimelineStore((state) => state.timeline?.duration_frames ?? 0);
}
