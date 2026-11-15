/** The timeline slice, read half.
 *
 *  What is pinned is the pair of promises the rest of the window is built on:
 *
 *  * **The frame rate is the service's, exactly.** A timecode formatted at 30
 *    for a project that is 29.97 is a number nobody can check, and the drift is
 *    three and a half seconds an hour. So the store holds `30000/1001` and hands
 *    it out as a fraction.
 *  * **A failed read keeps the edit it drew.** A dropped refresh is not an empty
 *    timeline, and a store that emptied it would be telling the user their edit
 *    is gone.
 *
 *  And the one that is easy to get wrong when a window can hold two projects:
 *  an answer that arrives after the window has moved on is **dropped**, because
 *  it belongs to a project that is no longer the one on screen.
 */

import { describe, expect, it } from 'vitest';

import type { ApiClient } from '../core/api/client';
import type {
  CommandResponse,
  RedoResponse,
  TimelineResponse,
  TimelineSummary,
  UndoResponse,
} from '../core/api/contract';
import type { ApiProblem } from '../core/api/problem';
import type { EventEnvelope } from '../core/events/protocol';
import { err, ok, type Result } from '../core/result';
import { createTimelineStore, type TimelineStore } from './timeline';

const NTSC = { num: 30_000, den: 1_001 };

function edit(over: Partial<TimelineSummary> = {}): TimelineSummary {
  return {
    timebase: { num: 30, den: 1, fps: 30 },
    tracks: [],
    track_count: 0,
    clip_count: 0,
    duration_frames: 300,
    ...over,
  };
}

function answered(over: Partial<TimelineResponse> = {}): TimelineResponse {
  return {
    project_id: 'p1',
    timeline: edit(),
    history: {
      can_undo: false,
      can_redo: false,
      undo_label: '',
      redo_label: '',
      undo_depth: 0,
      redo_depth: 0,
      recent: [],
    },
    journal_sequence: 4,
    pending_commands: 2,
    dirty: true,
    ...over,
  };
}

function problem(code: string): ApiProblem {
  return { kind: 'api', status: 500, code, detail: code };
}

/** An answer, or a promise of one: a test that holds an answer back and hands it
 *  over later is how a slow answer for the project the window left gets pinned. */
type Answer =
  Result<TimelineResponse, ApiProblem> | PromiseLike<Result<TimelineResponse, ApiProblem>>;

function fakeClient(answers: ReadonlyArray<Answer>): {
  client: ApiClient;
  calls: string[];
} {
  const calls: string[] = [];
  let index = 0;
  const client = {
    run: (id: string) => {
      calls.push(id);
      if (id !== 'getTimeline') return Promise.resolve(err(problem('NS-TEST-0000')));
      const answer = answers[Math.min(index, answers.length - 1)] ?? ok(answered());
      index += 1;
      return Promise.resolve(answer);
    },
    url: () => '',
  } as unknown as ApiClient;
  return { client, calls };
}

function envelope(topic: string): EventEnvelope {
  return { topic } as unknown as EventEnvelope;
}

describe('reading the edit', () => {
  it('holds the rate as a fraction, not as a rounded number', async () => {
    const { client } = fakeClient([
      ok(answered({ timeline: edit({ timebase: { ...NTSC, fps: 29.97 } }) })),
    ]);
    const store = createTimelineStore(client);

    await store.getState().load('p1');

    expect(store.getState().timeline?.timebase.num).toBe(30_000);
    expect(store.getState().timeline?.timebase.den).toBe(1_001);
  });

  it('holds the history and the counters, because the status bar reads them', async () => {
    const { client } = fakeClient([ok(answered({ pending_commands: 7, dirty: true }))]);
    const store = createTimelineStore(client);

    await store.getState().load('p1');

    expect(store.getState().pendingCommands).toBe(7);
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().journalSequence).toBe(4);
  });

  it('a failed read keeps the edit it had', async () => {
    const { client } = fakeClient([ok(answered()), err(problem('NS-TRANSPORT-5030'))]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');

    const second = await store.getState().refresh();

    expect(second.ok).toBe(false);
    expect(store.getState().timeline?.duration_frames).toBe(300);
    expect(store.getState().status).toBe('error');
  });

  it('drops an answer that arrives after the window moved to another project', async () => {
    // The answer is handed over by the test, so it is resolved with whatever
    // the caller hands it — a value, or another promise.
    let release: (answer: Answer) => void = () => {};
    const pending = new Promise<Result<TimelineResponse, ApiProblem>>((resolve) => {
      release = resolve;
    });
    const { client } = fakeClient([
      pending,
      ok(answered({ timeline: edit({ duration_frames: 60 }) })),
    ]);
    const store = createTimelineStore(client);

    const first = store.getState().load('p1');
    await store.getState().load('p2');
    expect(store.getState().timeline?.duration_frames).toBe(60);

    release(ok(answered({ timeline: edit({ duration_frames: 9_000 }) })));
    await first;

    expect(store.getState().timeline?.duration_frames).toBe(60);
  });

  it('joins a refresh that is in flight, then asks once more for the ask it joined', async () => {
    const { client, calls } = fakeClient([ok(answered())]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');
    expect(calls.filter((id) => id === 'getTimeline').length).toBe(1);

    await Promise.all([store.getState().refresh(), store.getState().refresh()]);

    // Two asks while one request is running: they join it rather than racing it
    // — "last to arrive" is not "newest" — and the joined ask is then honoured
    // with exactly one more request, because an ask made mid-flight may have
    // been about an edit the answer does not include.
    expect(calls.filter((id) => id === 'getTimeline').length).toBe(3);
  });
});

describe('hearing about an edit', () => {
  it('a command is a notification to ask again, not a payload to trust', async () => {
    const { client } = fakeClient([
      ok(answered()),
      ok(answered({ timeline: edit({ duration_frames: 900 }) })),
    ]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');

    store.getState().applyEvent(envelope('command.executed'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.getState().timeline?.duration_frames).toBe(900);
  });

  it('ignores a topic that is not an edit', async () => {
    const { client } = fakeClient([ok(answered())]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');

    store.getState().applyEvent(envelope('project.saved'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.getState().timeline?.duration_frames).toBe(300);
  });
});

// -- the editing half --------------------------------------------------------

/** An answer for any operation, or a promise of one. */
type AnyAnswer =
  | Result<TimelineResponse | CommandResponse | UndoResponse | RedoResponse, ApiProblem>
  | PromiseLike<
      Result<TimelineResponse | CommandResponse | UndoResponse | RedoResponse, ApiProblem>
    >;

interface ScriptedCall {
  readonly id: string;
  readonly answer: AnyAnswer;
}

interface Recorder {
  readonly client: ApiClient;
  readonly calls: Array<{ id: string; params?: unknown; body?: unknown }>;
}

/** A client that answers a scripted list of operations and remembers what it
 *  was asked: the bodies are the assertion, because a command is what the user
 *  did and the wire is the only place it is written down. */
function fakeApi(script: ReadonlyArray<ScriptedCall>): Recorder {
  const calls: Array<{ id: string; params?: unknown; body?: unknown }> = [];
  let index = 0;
  const client = {
    run: (id: string, init?: { params?: unknown; body?: unknown }) => {
      calls.push({
        id,
        ...(init?.params === undefined ? {} : { params: init.params }),
        ...(init?.body === undefined ? {} : { body: init.body }),
      });
      const step = script[Math.min(index, script.length - 1)];
      index += 1;
      return Promise.resolve(step?.answer ?? err(problem('NS-TEST-0000')));
    },
    url: () => '',
  } as unknown as ApiClient;
  return { client, calls };
}

function command(over: Partial<CommandResponse> = {}): CommandResponse {
  return {
    project_id: 'p1',
    command_id: 'cmd-1',
    name: 'move-clip',
    summary: 'moved one clip',
    affected: ['c1'],
    invalidate: ['preview'],
    rerender: true,
    history: {
      can_undo: true,
      can_redo: false,
      undo_label: 'Undo move clip',
      redo_label: '',
      undo_depth: 1,
      redo_depth: 0,
      recent: ['move-clip'],
    },
    journal_sequence: 5,
    pending_commands: 3,
    dirty: true,
    marks_dirty: true,
    ...over,
  };
}

function undoAnswer(over: Partial<UndoResponse> = {}): UndoResponse {
  return {
    project_id: 'p1',
    command_id: 'cmd-1',
    name: 'move-clip',
    undone: true,
    history: {
      can_undo: false,
      can_redo: true,
      undo_label: '',
      redo_label: 'Redo move clip',
      undo_depth: 0,
      redo_depth: 1,
      recent: [],
    },
    journal_sequence: 6,
    pending_commands: 4,
    dirty: true,
    ...over,
  };
}

function bodies(calls: Recorder['calls'], id: string): unknown[] {
  return calls.filter((call) => call.id === id).map((call) => call.body);
}

describe('editing the edit', () => {
  it('posts what the user did, in the domain’s own words', async () => {
    const { client, calls } = fakeApi([
      { id: 'getTimeline', answer: ok(answered()) },
      { id: 'applyCommand', answer: ok(command()) },
      { id: 'getTimeline', answer: ok(answered()) },
    ]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');

    const result = await store.getState().move({ clipId: 'c1', toStartFrame: 240 });

    expect(result.ok).toBe(true);
    expect(bodies(calls, 'applyCommand')).toEqual([
      { type: 'move-clip', clip_id: 'c1', to_start_frame: 240 },
    ]);
  });

  it('asks again after an edit, because a command answer is not an edit', async () => {
    // The edit is not in `CommandResponse`: sending a screen's worth of tracks
    // on every drag would make a drag cost two screens' worth of JSON.
    const { client, calls } = fakeApi([
      { id: 'getTimeline', answer: ok(answered()) },
      { id: 'applyCommand', answer: ok(command()) },
      { id: 'getTimeline', answer: ok(answered({ timeline: edit({ duration_frames: 900 }) })) },
    ]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');

    await store.getState().move({ clipId: 'c1', toStartFrame: 240 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls.filter((call) => call.id === 'getTimeline').length).toBe(2);
    expect(store.getState().timeline?.duration_frames).toBe(900);
  });

  it('takes the history off the answer before the edit arrives', async () => {
    // The Edit menu must not disagree with the edit that was just made, and a
    // disagreement is otherwise a refetch and a fast typist. The refetch is
    // held back by the test, because what is being pinned is the half second
    // before it lands.
    let release: (answer: Result<TimelineResponse, ApiProblem>) => void = () => {};
    const pending = new Promise<Result<TimelineResponse, ApiProblem>>((resolve) => {
      release = resolve;
    });
    const landed = command({ pending_commands: 3 });
    const { client } = fakeApi([
      { id: 'getTimeline', answer: ok(answered()) },
      { id: 'applyCommand', answer: ok(landed) },
      { id: 'getTimeline', answer: pending },
    ]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');

    await store.getState().move({ clipId: 'c1', toStartFrame: 240 });

    expect(store.getState().history?.can_undo).toBe(true);
    expect(store.getState().history?.undo_label).toBe('Undo move clip');
    expect(store.getState().pendingCommands).toBe(3);
    expect(store.getState().journalSequence).toBe(5);

    // And the refetch, when it does land, says the same thing about the
    // history and the newer thing about the edit — the two answers are not two
    // opinions, they are one truth seen from two ends.
    release(ok(answered({ timeline: edit({ duration_frames: 900 }), history: landed.history })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getState().timeline?.duration_frames).toBe(900);
    expect(store.getState().history?.can_undo).toBe(true);
  });

  it('keeps the sentence the service wrote about what it did', async () => {
    const { client } = fakeApi([
      { id: 'getTimeline', answer: ok(answered()) },
      { id: 'applyCommand', answer: ok(command({ summary: 'moved A roll to 00:00:08:00' })) },
      { id: 'getTimeline', answer: ok(answered()) },
    ]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');

    await store.getState().move({ clipId: 'c1', toStartFrame: 240 });

    expect(store.getState().lastCommand?.summary).toBe('moved A roll to 00:00:08:00');
    expect(store.getState().lastCommand?.affected).toEqual(['c1']);
    expect(store.getState().lastCommand?.rerender).toBe(true);
  });

  it('sends a whole drag as one undo', async () => {
    const { client, calls } = fakeApi([
      { id: 'getTimeline', answer: ok(answered()) },
      { id: 'applyCommand', answer: ok(command()) },
      { id: 'applyCommand', answer: ok(command()) },
      { id: 'getTimeline', answer: ok(answered()) },
    ]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');

    const gesture = store.getState().beginGesture();
    await store.getState().move({ clipId: 'c1', toStartFrame: 100, gesture });
    await store.getState().move({ clipId: 'c1', toStartFrame: 140, gesture });
    store.getState().endGesture();

    const sent = bodies(calls, 'applyCommand') as Array<{ gesture?: string }>;
    expect(sent).toHaveLength(2);
    // One id for the drag, so the journal collapses it: a hundred moves per
    // gesture would be a hundred Ctrl+Zs to undo one drag.
    expect(sent[0]?.gesture).toBe(sent[1]?.gesture);
    expect(sent[0]?.gesture).toBeTruthy();
    expect(store.getState().gesture).toBeNull();
  });

  it('never gives a second drag the first drag’s id', async () => {
    const { client, calls } = fakeApi([
      { id: 'getTimeline', answer: ok(answered()) },
      { id: 'applyCommand', answer: ok(command()) },
      { id: 'applyCommand', answer: ok(command()) },
      { id: 'getTimeline', answer: ok(answered()) },
    ]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');

    const first = store.getState().beginGesture();
    await store.getState().move({ clipId: 'c1', toStartFrame: 100, gesture: first });
    const second = store.getState().beginGesture();
    await store.getState().move({ clipId: 'c1', toStartFrame: 200, gesture: second });

    expect(second).not.toBe(first);
    const sent = bodies(calls, 'applyCommand') as Array<{ gesture?: string }>;
    expect(sent[0]?.gesture).not.toBe(sent[1]?.gesture);
  });

  it('leaves a gesture out when none is being dragged', async () => {
    // A move from the keyboard is not a drag, and a body with `gesture: ""`
    // would be a drag the service has to treat as real.
    const { client, calls } = fakeApi([
      { id: 'getTimeline', answer: ok(answered()) },
      { id: 'applyCommand', answer: ok(command()) },
      { id: 'getTimeline', answer: ok(answered()) },
    ]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');

    await store.getState().move({ clipId: 'c1', toStartFrame: 100 });

    expect(bodies(calls, 'applyCommand')).toEqual([
      { type: 'move-clip', clip_id: 'c1', to_start_frame: 100 },
    ]);
  });

  it('says which end a trim moves, and to where', async () => {
    const { client, calls } = fakeApi([
      { id: 'getTimeline', answer: ok(answered()) },
      { id: 'applyCommand', answer: ok(command({ name: 'trim-clip' })) },
      { id: 'getTimeline', answer: ok(answered()) },
    ]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');

    await store.getState().trim({ clipId: 'c1', edge: 'start', toFrame: 40, gesture: 'g1' });

    expect(bodies(calls, 'applyCommand')).toEqual([
      { type: 'trim-clip', clip_id: 'c1', to_frame: 40, edge: 'start', gesture: 'g1' },
    ]);
  });

  it('splits at a frame, and lifts by id', async () => {
    const { client, calls } = fakeApi([
      { id: 'getTimeline', answer: ok(answered()) },
      { id: 'applyCommand', answer: ok(command({ name: 'split-clip' })) },
      { id: 'applyCommand', answer: ok(command({ name: 'lift-clip' })) },
      { id: 'getTimeline', answer: ok(answered()) },
    ]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');

    await store.getState().split({ clipId: 'c1', atFrame: 60 });
    await store.getState().lift('c2');

    expect(bodies(calls, 'applyCommand')).toEqual([
      { type: 'split-clip', clip_id: 'c1', at_frame: 60 },
      { type: 'lift-clip', clip_id: 'c2' },
    ]);
  });

  it('writes a whole track at once, which is how a clip arrives at all', async () => {
    const { client, calls } = fakeApi([
      { id: 'getTimeline', answer: ok(answered()) },
      { id: 'applyCommand', answer: ok(command({ name: 'replace-track-clips' })) },
      { id: 'getTimeline', answer: ok(answered()) },
    ]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');

    await store.getState().replaceTrackClips({
      trackId: 'captions',
      kind: 'caption',
      create: true,
      trackName: 'Captions',
      clips: [{ asset_id: 'a1', name: 'first', start_frame: 0, source_frames: 90 }],
    });

    expect(bodies(calls, 'applyCommand')).toEqual([
      {
        type: 'replace-track-clips',
        track_id: 'captions',
        kind: 'caption',
        create: true,
        track_name: 'Captions',
        clips: [{ asset_id: 'a1', name: 'first', start_frame: 0, source_frames: 90 }],
      },
    ]);
  });

  it('leaves out what the caller did not ask for, so the service decides', async () => {
    // `create` and `kind` have defaults on the service, and a client that sent
    // them anyway would drift from those defaults the moment they changed.
    const { client, calls } = fakeApi([
      { id: 'getTimeline', answer: ok(answered()) },
      { id: 'applyCommand', answer: ok(command({ name: 'replace-track-clips' })) },
      { id: 'getTimeline', answer: ok(answered()) },
    ]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');

    await store.getState().replaceTrackClips({
      trackId: 'v1',
      clips: [{ asset_id: 'a1' }],
    });

    expect(bodies(calls, 'applyCommand')).toEqual([
      { type: 'replace-track-clips', track_id: 'v1', clips: [{ asset_id: 'a1' }] },
    ]);
  });

  it('refuses an edit in the service’s own words and changes nothing', async () => {
    const overlap = problem('NS-COMMAND-4104');
    const { client } = fakeApi([
      { id: 'getTimeline', answer: ok(answered()) },
      { id: 'applyCommand', answer: err(overlap) },
    ]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');

    const result = await store.getState().move({ clipId: 'c1', toStartFrame: 240 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NS-COMMAND-4104');
    expect(store.getState().refusal).toEqual(overlap);
    // No sentence about an edit that did not happen, and no history for one.
    expect(store.getState().lastCommand).toBeNull();
    expect(store.getState().history?.undo_depth).toBe(0);
  });

  it('forgets a refusal once an edit lands', async () => {
    const { client } = fakeApi([
      { id: 'getTimeline', answer: ok(answered()) },
      { id: 'applyCommand', answer: err(problem('NS-COMMAND-4104')) },
      { id: 'applyCommand', answer: ok(command()) },
      { id: 'getTimeline', answer: ok(answered()) },
    ]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');

    await store.getState().move({ clipId: 'c1', toStartFrame: 240 });
    expect(store.getState().refusal).not.toBeNull();

    await store.getState().move({ clipId: 'c1', toStartFrame: 100 });

    expect(store.getState().refusal).toBeNull();
  });

  it('counts the edits in flight, and stops counting when they land', async () => {
    // A count, not a flag: two drags in flight is two, and the second one
    // landing must not undim a timeline the first one is still holding.
    const { client } = fakeApi([
      { id: 'getTimeline', answer: ok(answered()) },
      { id: 'applyCommand', answer: ok(command()) },
      { id: 'getTimeline', answer: ok(answered()) },
    ]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');
    expect(store.getState().inFlight).toBe(0);

    const first = store.getState().move({ clipId: 'c1', toStartFrame: 10 });
    const second = store.getState().move({ clipId: 'c1', toStartFrame: 20 });
    expect(store.getState().inFlight).toBe(2);

    await Promise.all([first, second]);
    expect(store.getState().inFlight).toBe(0);
  });

  it('drops an edit that lands after the window moved on', async () => {
    const { client } = fakeApi([
      { id: 'getTimeline', answer: ok(answered()) },
      { id: 'applyCommand', answer: ok(command({ pending_commands: 99 })) },
      { id: 'getTimeline', answer: ok(answered()) },
    ]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');
    const edit1 = store.getState().move({ clipId: 'c1', toStartFrame: 10 });
    await store.getState().load('p2');

    await edit1;

    // The service did what it was asked; it is this window that has moved on,
    // and a counter for the project it left is a lie about the one on screen.
    expect(store.getState().pendingCommands).not.toBe(99);
  });

  it('asks nothing when no project is open', async () => {
    const { client, calls } = fakeApi([{ id: 'applyCommand', answer: ok(command()) }]);
    const store = createTimelineStore(client);

    const result = await store.getState().move({ clipId: 'c1', toStartFrame: 10 });

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('undoing and redoing', () => {
  it('posts an undo and takes the answer’s history', async () => {
    const { client, calls } = fakeApi([
      { id: 'getTimeline', answer: ok(answered()) },
      { id: 'undoCommand', answer: ok(undoAnswer()) },
      { id: 'getTimeline', answer: ok(answered({ history: undoAnswer().history })) },
    ]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');

    const result = await store.getState().undo();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.undone).toBe(true);
    expect(calls.map((call) => call.id)).toContain('undoCommand');
    expect(store.getState().history?.can_redo).toBe(true);
    expect(store.getState().history?.redo_label).toBe('Redo move clip');
  });

  it('retires the sentence about the edit an undo undid', async () => {
    const { client } = fakeApi([
      { id: 'getTimeline', answer: ok(answered()) },
      { id: 'applyCommand', answer: ok(command()) },
      { id: 'getTimeline', answer: ok(answered()) },
      { id: 'undoCommand', answer: ok(undoAnswer()) },
      { id: 'getTimeline', answer: ok(answered({ history: undoAnswer().history })) },
    ]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');
    await store.getState().move({ clipId: 'c1', toStartFrame: 240 });
    expect(store.getState().lastCommand).not.toBeNull();

    await store.getState().undo();

    // A status bar still describing an edit that is gone is worse than an empty
    // one: what undo did is already in `history.undo_label`.
    expect(store.getState().lastCommand).toBeNull();
  });

  it('redoes in the same shape', async () => {
    const { client, calls } = fakeApi([
      { id: 'getTimeline', answer: ok(answered()) },
      { id: 'redoCommand', answer: ok({ ...undoAnswer(), undone: false, redone: true }) },
      { id: 'getTimeline', answer: ok(answered({ history: undoAnswer().history })) },
    ]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');

    await store.getState().redo();

    expect(calls.map((call) => call.id)).toContain('redoCommand');
    expect(store.getState().history?.redo_label).toBe('Redo move clip');
  });

  it('says what went wrong when an undo is refused', async () => {
    const { client } = fakeApi([
      { id: 'getTimeline', answer: ok(answered()) },
      { id: 'undoCommand', answer: err(problem('NS-COMMAND-4104')) },
    ]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');

    const result = await store.getState().undo();

    expect(result.ok).toBe(false);
    expect(store.getState().refusal?.code).toBe('NS-COMMAND-4104');
  });
});

describe('the selection', () => {
  function loaded(): TimelineStore {
    const { client } = fakeApi([{ id: 'getTimeline', answer: ok(answered()) }]);
    const store = createTimelineStore(client);
    return store;
  }

  it('replaces, because a click is not a shift-click', async () => {
    const store = loaded();
    await store.getState().load('p1');

    store.getState().select('c1');
    store.getState().select('c2');

    expect([...store.getState().selectedClipIds]).toEqual(['c2']);
  });

  it('grows on an additive click and takes back on a second one', async () => {
    const store = loaded();
    await store.getState().load('p1');

    store.getState().select('c1');
    store.getState().select('c2', 'add');
    expect([...store.getState().selectedClipIds].sort()).toEqual(['c1', 'c2']);

    store.getState().select('c2', 'toggle');
    expect([...store.getState().selectedClipIds]).toEqual(['c1']);
  });

  it('takes a whole list at once, for select-all', async () => {
    const store = loaded();
    await store.getState().load('p1');

    store.getState().selectMany(['c1', 'c2', 'c3']);

    expect(store.getState().selectedClipIds.size).toBe(3);
  });

  it('empties, and an empty selection is one nobody has to compare against', async () => {
    const store = loaded();
    await store.getState().load('p1');

    store.getState().selectMany(['c1', 'c2']);
    store.getState().clearSelection();

    expect(store.getState().selectedClipIds.size).toBe(0);
  });

  it('forgets a clip that is no longer in the edit', async () => {
    // A selected id with no clip behind it is a Delete that does nothing, and
    // the next edit would go to a clip the user cannot see.
    const { client } = fakeApi([
      { id: 'getTimeline', answer: ok(answered()) },
      { id: 'applyCommand', answer: ok(command({ name: 'lift-clip' })) },
      { id: 'getTimeline', answer: ok(answered()) },
    ]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');
    store.getState().selectMany(['c1', 'c2']);

    await store.getState().lift('c1');

    expect([...store.getState().selectedClipIds]).toEqual(['c2']);
  });

  it('starts again when the window moves to another project', async () => {
    const { client } = fakeApi([
      { id: 'getTimeline', answer: ok(answered()) },
      { id: 'getTimeline', answer: ok(answered()) },
    ]);
    const store = createTimelineStore(client);
    await store.getState().load('p1');
    store.getState().select('c1');

    await store.getState().load('p2');

    // A selection from the project the window left would be an edit applied to
    // whatever clip happens to be second in a different edit.
    expect(store.getState().selectedClipIds.size).toBe(0);
  });
});
