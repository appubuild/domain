/** The media slice, against a client double.
 *
 *  The bin is the one list in the window that two panes read at once, so what is
 *  pinned here is what a shared list has to get right that a private one does
 *  not:
 *
 *  * **A failed read keeps what it had.** A refresh that failed is not evidence
 *    that the bin is empty, and a store that emptied it would make people
 *    re-import.
 *  * **Switching projects empties it first.** The answer to the previous
 *    project's question must never be shown as this project's bin — which is
 *    exactly what you would see, for half a second, without this.
 *  * **A selection that has been imported away is not a selection.** The
 *    inspector would otherwise describe a file that is no longer in the edit.
 */

import { describe, expect, it } from 'vitest';

import type { ApiClient } from '../core/api/client';
import type { ImportResponse, MediaAssetSummary, MediaListResponse } from '../core/api/contract';
import type { ApiProblem } from '../core/api/problem';
import { err, ok, type Result } from '../core/result';
import { createMediaStore } from './media';

function asset(id: string, over: Partial<MediaAssetSummary> = {}): MediaAssetSummary {
  return {
    asset_id: id,
    name: `clip ${id}.mp4`,
    path: `/videos/clip ${id}.mp4`,
    kind: 'video',
    duration_seconds: 30,
    linked: true,
    probed: true,
    warnings: [],
    video: [],
    audio: [],
    ...over,
  };
}

function problem(code: string): ApiProblem {
  return { kind: 'api', status: 500, code, detail: code };
}

function listed(assets: readonly MediaAssetSummary[], missing = 0): MediaListResponse {
  return { project_id: 'p1', assets: [...assets], missing, total: assets.length };
}

/** An answer, or a promise of one: a test that holds an answer back and hands it
 *  over later is how the ordering of two in-flight requests gets pinned. */
type Answer =
  Result<MediaListResponse, ApiProblem> | PromiseLike<Result<MediaListResponse, ApiProblem>>;

interface Script {
  /** One answer per call, in order; the last one repeats. */
  readonly list?: ReadonlyArray<Answer>;
  readonly import?: Result<ImportResponse, ApiProblem>;
}

function fakeClient(script: Script): { client: ApiClient; calls: { list: number } } {
  const calls = { list: 0 };
  let index = 0;
  const client = {
    run: (id: string) => {
      switch (id) {
        case 'listMedia': {
          calls.list += 1;
          const answers = script.list ?? [];
          const answer = answers[Math.min(index, answers.length - 1)] ?? ok(listed([]));
          index += 1;
          return Promise.resolve(answer);
        }
        case 'importMedia':
          return Promise.resolve(script.import ?? err(problem('NS-TEST-0000')));
        default:
          return Promise.resolve(err(problem('NS-TEST-0000')));
      }
    },
    url: () => '',
  } as unknown as ApiClient;
  return { client, calls };
}

function imported(assets: readonly MediaAssetSummary[]): ImportResponse {
  return {
    assets: [...assets],
    duplicates: [],
    failures: [],
    journal_sequence: 1,
    pending_commands: 1,
    project_id: 'p1',
    summary: 'Imported.',
  };
}

describe('reading the bin', () => {
  it('holds what the service said, and says it is ready', async () => {
    const { client } = fakeClient({ list: [ok(listed([asset('a'), asset('b')]))] });
    const store = createMediaStore(client);

    await store.getState().load('p1');

    expect(store.getState().assets.map((each) => each.asset_id)).toEqual(['a', 'b']);
    expect(store.getState().status).toBe('ready');
  });

  it('a failed read keeps the assets it had', async () => {
    const { client } = fakeClient({
      list: [ok(listed([asset('a')])), err(problem('NS-TRANSPORT-5030'))],
    });
    const store = createMediaStore(client);
    await store.getState().load('p1');

    const second = await store.getState().refresh();

    expect(second.ok).toBe(false);
    expect(store.getState().assets.map((each) => each.asset_id)).toEqual(['a']);
    expect(store.getState().error?.code).toBe('NS-TRANSPORT-5030');
  });

  it('empties the bin before asking for another project', async () => {
    const { client } = fakeClient({ list: [ok(listed([asset('a')]))] });
    const store = createMediaStore(client);
    await store.getState().load('p1');

    // Not awaited on purpose: the state between "asked" and "answered" is the
    // one being pinned, because it is the state a user can see.
    const pending = store.getState().load('p2');
    expect(store.getState().assets).toEqual([]);
    expect(store.getState().selectedId).toBeNull();
    await pending;
  });

  it('does not write a slow answer for the project it left into the new bin', async () => {
    // The bin is one store and many projects. An answer that arrives after the
    // window has moved on belongs to the project that was asked about, and
    // writing it anyway is how a bin ends up listing another edit's files.
    // The answer is handed over by the test, so it is resolved with whatever
    // the caller hands it — a value, or another promise.
    let release: (
      answer:
        Result<MediaListResponse, ApiProblem> | PromiseLike<Result<MediaListResponse, ApiProblem>>,
    ) => void = () => {};
    const pending = new Promise<Result<MediaListResponse, ApiProblem>>((resolve) => {
      release = resolve;
    });
    const { client } = fakeClient({ list: [pending, ok(listed([asset('second')]))] });
    const store = createMediaStore(client);

    const first = store.getState().load('p1');
    const second = store.getState().load('p2');
    await second;
    expect(store.getState().assets.map((each) => each.asset_id)).toEqual(['second']);

    release(ok(listed([asset('late')])));
    await first;

    expect(store.getState().assets.map((each) => each.asset_id)).toEqual(['second']);
  });
});

describe('importing', () => {
  it('asks again rather than inventing the summary', async () => {
    const { client, calls } = fakeClient({
      list: [ok(listed([])), ok(listed([asset('a')]))],
      import: ok(imported([asset('a')])),
    });
    const store = createMediaStore(client);
    await store.getState().load('p1');

    const result = await store.getState().importPaths(['/videos/a.mp4']);

    expect(result.ok).toBe(true);
    expect(store.getState().assets.map((each) => each.asset_id)).toEqual(['a']);
    expect(calls.list).toBe(2);
  });

  it('records the report, and the failure, without emptying the bin', async () => {
    const { client } = fakeClient({
      list: [ok(listed([asset('a')]))],
      import: err(problem('NS-MEDIA-4040')),
    });
    const store = createMediaStore(client);
    await store.getState().load('p1');

    const result = await store.getState().importPaths(['/gone.mp4']);

    expect(result.ok).toBe(false);
    expect(store.getState().error?.code).toBe('NS-MEDIA-4040');
    expect(store.getState().assets.map((each) => each.asset_id)).toEqual(['a']);
  });

  it('refuses to import into a project it has not loaded', async () => {
    const { client } = fakeClient({});
    const store = createMediaStore(client);

    const result = await store.getState().importPaths(['/videos/a.mp4']);

    expect(result.ok).toBe(false);
  });
});

describe('selecting', () => {
  it('holds an id, and drops a selection the bin no longer holds', async () => {
    const { client } = fakeClient({
      list: [ok(listed([asset('a')])), ok(listed([asset('b')]))],
    });
    const store = createMediaStore(client);
    await store.getState().load('p1');
    store.getState().select('a');

    await store.getState().refresh();

    expect(store.getState().selectedId).toBeNull();
  });

  it('keeps a selection that is still there', async () => {
    const { client } = fakeClient({ list: [ok(listed([asset('a')]))] });
    const store = createMediaStore(client);
    await store.getState().load('p1');
    store.getState().select('a');

    await store.getState().refresh();

    expect(store.getState().selectedId).toBe('a');
  });
});
