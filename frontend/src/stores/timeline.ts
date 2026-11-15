/** The timeline slice: the edit as it stands, and the edits that change it.
 *
 *  Stage 6 needed two numbers out of the edit that no other slice can give it —
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
 *    guess is a timeline the user has already started cutting against. A drag
 *    therefore feels immediate because the panel *draws* the drag, not because
 *    the store believes it.
 *  * **No selection model beyond "which clips".** Which clip is under the
 *    cursor, whether a marquee is being drawn, which end of a clip is grabbed —
 *    all of that is the panel's, because it is about a pointer that exists in
 *    one window for a second. What is shared is *what is selected*, since three
 *    panes act on it.
 *
 *  Two decisions worth the ink:
 *
 *  * **A command's answer is not a timeline.** `CommandResponse` carries the
 *    history, the counters and a sentence; it does not carry the edit. So a
 *    command refetches, and the answer's `history` is applied on the way — the
 *    Edit menu is right before the edit has finished arriving.
 *  * **A gesture is one undo.** A drag posts a move (or a trim) per pointer
 *    event; without a shared `gesture` id the user's undo stack would hold a
 *    hundred entries for one gesture. The id is minted here, per drag, because
 *    it is the store that knows the command names it collapses.
 *
 *  An event is a **notification, not a payload**: `command.*` means ask again.
 *  The socket carries small envelopes by design (`api.md` §6), and a store that
 *  treated them as data would be wrong whenever one is dropped.
 */

import { createContext, useContext, useMemo } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { ApiClient } from '../core/api/client';
import type {
  ApplyCommandBody,
  ClipSpec,
  CommandResponse,
  HistorySummary,
  RedoResponse,
  TimelineResponse,
  TimelineSummary,
  TrackKind,
  UndoResponse,
} from '../core/api/contract';
import type { ApiProblem } from '../core/api/problem';
import type { EventEnvelope } from '../core/events/protocol';
import { err, ok, type Result } from '../core/result';
import { DEFAULT_TIMEBASE, type Timebase } from '../core/timecode/timebase';

export type TimelineStatus = 'idle' | 'loading' | 'ready' | 'error';

/** What one edit did, for the status bar and the toast that follows it. */
export interface CommandOutcome {
  readonly commandId: string;
  readonly name: string;
  /** One sentence, written by the command that knows what it changed. */
  readonly summary: string;
  readonly affected: readonly string[];
  /** Cache namespaces the service says must be dropped; the preview listens. */
  readonly invalidate: readonly string[];
  readonly rerender: boolean;
}

/** How a click in the timeline changes the selection. */
export type SelectMode = 'replace' | 'toggle' | 'add';

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

  /** The clips the next edit applies to. A `Set`, so "is this one selected" is
   *  a lookup and not a scan of the edit on every render. */
  readonly selectedClipIds: ReadonlySet<string>;
  /** The drag in progress, whose id every move and trim in it carries so the
   *  whole gesture undoes as one. `null` between gestures. */
  readonly gesture: string | null;
  /** Edits posted and not yet answered. The panel dims on it, so a command that
   *  is refused is visibly a refusal rather than a slow edit. */
  readonly inFlight: number;
  /** The last edit that landed, as the sentence the service wrote. */
  readonly lastCommand: CommandOutcome | null;
  /** The last edit that was refused. Cleared by the next edit, so a refusal is
   *  about *this* attempt and not a permanent accusation. */
  readonly refusal: ApiProblem | null;

  readonly load: (projectId: string) => Promise<Result<void, ApiProblem>>;
  readonly refresh: () => Promise<Result<void, ApiProblem>>;
  readonly applyEvent: (envelope: EventEnvelope) => void;

  readonly select: (clipId: string, mode?: SelectMode) => void;
  readonly selectMany: (clipIds: readonly string[], mode?: SelectMode) => void;
  readonly clearSelection: () => void;

  /** Mint the id one drag carries. A gesture is never reused: a second drag
   *  that re-used the first one's id would collapse into its undo entry. */
  readonly beginGesture: () => string;
  readonly endGesture: () => void;

  readonly move: (request: {
    clipId: string;
    toStartFrame: number;
    toTrackId?: string;
    gesture?: string;
  }) => Promise<Result<CommandOutcome, ApiProblem>>;
  readonly trim: (request: {
    clipId: string;
    toFrame: number;
    edge?: 'start' | 'end';
    gesture?: string;
  }) => Promise<Result<CommandOutcome, ApiProblem>>;
  readonly slip: (request: {
    clipId: string;
    deltaFrames: number;
    gesture?: string;
  }) => Promise<Result<CommandOutcome, ApiProblem>>;
  readonly split: (request: {
    clipId: string;
    atFrame: number;
    newClipId?: string;
  }) => Promise<Result<CommandOutcome, ApiProblem>>;
  readonly lift: (clipId: string) => Promise<Result<CommandOutcome, ApiProblem>>;
  readonly rippleDelete: (clipId: string) => Promise<Result<CommandOutcome, ApiProblem>>;
  /** What a whole track should hold, in order.
   *
   *  The way a clip gets *onto* a timeline at all, and the way the caption
   *  engine will write a caption track: one command, one answer, one undo.
   *  `create` makes the track when it is not there yet. */
  readonly replaceTrackClips: (request: {
    trackId: string;
    clips: readonly ClipSpec[];
    kind?: TrackKind;
    create?: boolean;
    trackName?: string;
  }) => Promise<Result<CommandOutcome, ApiProblem>>;

  readonly undo: () => Promise<Result<UndoResponse, ApiProblem>>;
  readonly redo: () => Promise<Result<RedoResponse, ApiProblem>>;
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

    /** One edit, and the answer to "what is the edit now".
     *
     *  The counters and the history come back on the command's own answer, so
     *  they are applied the moment it lands; the timeline is refetched, because
     *  a `CommandResponse` deliberately does not carry the edit — one screen's
     *  worth of tracks is not a thing to send on every drag.
     *
     *  The refusal is kept, not thrown: `move`, `trim` and their friends return
     *  it so the caller can say what happened in the user's own words, and the
     *  store remembers it so a panel mounted later can say it too.
     */
    async function run(body: ApplyCommandBody): Promise<Result<CommandOutcome, ApiProblem>> {
      const projectId = get().projectId;
      if (projectId === null) return err(NO_PROJECT);
      set((state) => ({ inFlight: state.inFlight + 1, refusal: null }));
      try {
        const result = await client.run('applyCommand', {
          params: { project_id: projectId },
          body,
        });
        if (!result.ok) {
          set({ refusal: result.error });
          return err(result.error);
        }
        if (get().projectId !== projectId) return err(LEFT_PROJECT);
        set(counters(result.value));
        const outcome: CommandOutcome = {
          commandId: result.value.command_id,
          name: result.value.name,
          summary: result.value.summary,
          affected: result.value.affected,
          invalidate: result.value.invalidate,
          rerender: result.value.rerender,
        };
        set({ lastCommand: outcome });
        // Not awaited into the answer's shape: the edit has landed whether or
        // not the refetch does, and awaiting it would make every drag wait for
        // two round trips instead of one.
        void fetch();
        return ok(outcome);
      } finally {
        set((state) => ({ inFlight: state.inFlight - 1 }));
      }
    }

    /** One undo or redo. They are commands in their own right — journalled,
     *  answerable, and refused for the same reasons — but their answer is a
     *  different shape, so they do not go through `run`. */
    async function step<Response extends UndoResponse | RedoResponse>(
      operation: 'undoCommand' | 'redoCommand',
    ): Promise<Result<Response, ApiProblem>> {
      const projectId = get().projectId;
      if (projectId === null) return err(NO_PROJECT);
      set((state) => ({ inFlight: state.inFlight + 1, refusal: null }));
      try {
        const result = await client.run(operation, { params: { project_id: projectId } });
        if (!result.ok) {
          set({ refusal: result.error });
          return err(result.error);
        }
        if (get().projectId !== projectId) return err(LEFT_PROJECT);
        set(counters(result.value));
        // An undo is not an edit, so the status bar's sentence is retired: what
        // it would say after an undo is already in `history.undo_label`, and
        // leaving the old sentence up would describe an edit that is gone.
        set({ lastCommand: null });
        void fetch();
        return ok(result.value as Response);
      } finally {
        set((state) => ({ inFlight: state.inFlight - 1 }));
      }
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
      selectedClipIds: EMPTY_SELECTION,
      gesture: null,
      inFlight: 0,
      lastCommand: null,
      refusal: null,

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
            selectedClipIds: EMPTY_SELECTION,
            gesture: null,
            inFlight: 0,
            lastCommand: null,
            refusal: null,
          });
        }
        return await fetch();
      },

      refresh() {
        return fetch();
      },

      select(clipId, mode = 'replace') {
        set((state) => ({ selectedClipIds: withSelection(state.selectedClipIds, [clipId], mode) }));
      },

      selectMany(clipIds, mode = 'replace') {
        set((state) => ({ selectedClipIds: withSelection(state.selectedClipIds, clipIds, mode) }));
      },

      clearSelection() {
        set({ selectedClipIds: EMPTY_SELECTION });
      },

      beginGesture() {
        const gesture = newGestureId();
        set({ gesture });
        return gesture;
      },

      endGesture() {
        set({ gesture: null });
      },

      move({ clipId, toStartFrame, toTrackId, gesture }) {
        return run({
          type: 'move-clip',
          clip_id: clipId,
          to_start_frame: toStartFrame,
          ...(toTrackId === undefined ? {} : { to_track_id: toTrackId }),
          ...(gesture === undefined ? {} : { gesture }),
        });
      },

      trim({ clipId, toFrame, edge, gesture }) {
        return run({
          type: 'trim-clip',
          clip_id: clipId,
          to_frame: toFrame,
          ...(edge === undefined ? {} : { edge }),
          ...(gesture === undefined ? {} : { gesture }),
        });
      },

      slip({ clipId, deltaFrames, gesture }) {
        return run({
          type: 'slip-clip',
          clip_id: clipId,
          delta_frames: deltaFrames,
          ...(gesture === undefined ? {} : { gesture }),
        });
      },

      split({ clipId, atFrame, newClipId }) {
        return run({
          type: 'split-clip',
          clip_id: clipId,
          at_frame: atFrame,
          ...(newClipId === undefined ? {} : { new_clip_id: newClipId }),
        });
      },

      async lift(clipId) {
        const result = await run({ type: 'lift-clip', clip_id: clipId });
        if (result.ok) {
          // A clip that is no longer in the edit cannot be selected: a selected
          // id with nothing behind it is a Delete that silently does nothing,
          // and the next edit would go to the clip the user cannot see.
          set((state) => ({ selectedClipIds: without(state.selectedClipIds, clipId) }));
        }
        return result;
      },

      replaceTrackClips({ trackId, clips, kind, create, trackName }) {
        return run({
          type: 'replace-track-clips',
          track_id: trackId,
          clips: clips.map((clip) => ({ ...clip })),
          ...(kind === undefined ? {} : { kind }),
          ...(create === undefined ? {} : { create }),
          ...(trackName === undefined ? {} : { track_name: trackName }),
        });
      },

      async rippleDelete(clipId) {
        const result = await run({ type: 'ripple-delete', clip_id: clipId });
        if (result.ok) {
          set((state) => ({ selectedClipIds: without(state.selectedClipIds, clipId) }));
        }
        return result;
      },

      undo() {
        return step<UndoResponse>('undoCommand');
      },

      redo() {
        return step<RedoResponse>('redoCommand');
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

/** The counters an edit's answer carries, which are the same three fields the
 *  read carries plus the history. Applied on the command's answer rather than
 *  waited for on the refetch, so the Edit menu cannot disagree with the edit
 *  that was just made. */
function counters(
  response: Pick<
    CommandResponse | UndoResponse | RedoResponse,
    'history' | 'dirty' | 'journal_sequence' | 'pending_commands'
  >,
): Pick<TimelineState, 'history' | 'dirty' | 'journalSequence' | 'pendingCommands'> {
  return {
    history: response.history,
    dirty: response.dirty,
    journalSequence: response.journal_sequence,
    pendingCommands: response.pending_commands,
  };
}

/** One empty selection, shared by every store that has none: a fresh `Set` per
 *  reset would make "is anything selected" a comparison that is always true. */
const EMPTY_SELECTION: ReadonlySet<string> = new Set();

/** An edit asked of a store that has no project: the window is showing nothing,
 *  so there is nothing the service could say. */
const NO_PROJECT: ApiProblem = {
  kind: 'api',
  status: 409,
  code: 'NS-TIMELINE-0001',
  detail: 'no project is open, so there is no edit to change',
};

/** An edit that landed after the window moved to another project. The service
 *  did what it was asked; it is this store that no longer cares. */
const LEFT_PROJECT: ApiProblem = {
  kind: 'api',
  status: 409,
  code: 'NS-TIMELINE-0002',
  detail: 'the window moved to another project while the edit was in flight',
};

/** A selection, with `clipIds` brought into it.
 *
 *  `add` is not `replace` with a list: shift-click that replaced the selection
 *  with itself would be a no-op, and the point of shift-click is to grow. */
function withSelection(
  current: ReadonlySet<string>,
  clipIds: readonly string[],
  mode: SelectMode,
): ReadonlySet<string> {
  if (mode === 'replace') return new Set(clipIds);
  const next = new Set(current);
  for (const clipId of clipIds) {
    if (mode === 'toggle' && next.has(clipId)) next.delete(clipId);
    else next.add(clipId);
  }
  return next;
}

function without(current: ReadonlySet<string>, clipId: string): ReadonlySet<string> {
  if (!current.has(clipId)) return current;
  const next = new Set(current);
  next.delete(clipId);
  return next;
}

/** A gesture id: random, not sequential. Two windows editing one project must
 *  not mint the same id, or their drags would collapse into one undo entry. */
function newGestureId(): string {
  return `g-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
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

/** What is selected, as a length and a membership test.
 *
 *  Returned as the set itself plus a bound predicate rather than as the set, so
 *  a pane that only wants to know whether *one* clip is selected subscribes to
 *  one boolean and re-renders when that clip's answer changes — not whenever
 *  anything anywhere is selected. */
export interface TimelineSelection {
  readonly ids: ReadonlySet<string>;
  readonly count: number;
  readonly has: (clipId: string) => boolean;
}

export function useTimelineSelection(): TimelineSelection {
  const ids = useTimelineStore((state) => state.selectedClipIds);
  return useMemo(() => ({ ids, count: ids.size, has: (clipId: string) => ids.has(clipId) }), [ids]);
}

/** Whether one clip is selected. One boolean, so a pane holding two hundred
 *  clips re-renders two hundred times on a select-all and once otherwise. */
export function useIsClipSelected(clipId: string): boolean {
  return useTimelineStore((state) => state.selectedClipIds.has(clipId));
}

/** What undo and redo would do, for the Edit menu and the status bar. */
export function useHistory(): HistorySummary | null {
  return useTimelineStore((state) => state.history);
}

/** The last edit that landed, as the sentence the service wrote about it. */
export function useLastCommand(): CommandOutcome | null {
  return useTimelineStore((state) => state.lastCommand);
}

/** The last edit that was refused, or `null` when the last one landed.
 *
 *  Read by the panel that tried and by the toast that reports it, off the same
 *  answer: a refusal shown in one place and remembered in another is a refusal
 *  the user reads twice. */
export function useRefusal(): ApiProblem | null {
  return useTimelineStore((state) => state.refusal);
}

/** Whether an edit is in flight. The timeline dims on it and ignores a second
 *  drag rather than queueing one, which is why it is a count and not a flag. */
export function useCommandsInFlight(): number {
  return useTimelineStore((state) => state.inFlight);
}
