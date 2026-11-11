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
import type { TimelineResponse, TimelineSummary } from '../core/api/contract';
import type { ApiProblem } from '../core/api/problem';
import type { EventEnvelope } from '../core/events/protocol';
import { err, ok, type Result } from '../core/result';
import { createTimelineStore } from './timeline';

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
