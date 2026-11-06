/** The project slice, against a client double.
 *
 *  What is worth pinning is the difference between the store and a cache:
 *
 *  * **A failed read keeps what it had.** A refresh that fails is not evidence
 *    that the list is empty, and a store that emptied it would be telling the
 *    user their work is gone.
 *  * **Refreshes coalesce.** Two events in a tick are one request, and the
 *    second one still gets the newer answer — the failure mode being guarded
 *    against is the older of two in-flight responses landing last.
 *  * **The service's answer wins.** After a save, the summary in the store is
 *    the one the service returned, not the one we had with a flag flipped.
 */

import { describe, expect, it, vi } from 'vitest';

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
import { createProjectStore, type ProjectStore } from './project';

function summary(id: string, over: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    project_id: id,
    name: `project ${id}`,
    path: null,
    dirty: false,
    clip_count: 0,
    duration_frames: 0,
    pending_commands: 0,
    commands_until_checkpoint: 200,
    autosave_due: false,
    journal_sequence: 0,
    checkpoint_sequence: 0,
    ...over,
  };
}

function problem(code: string): ApiProblem {
  return { kind: 'api', status: 500, code, detail: code };
}

interface Calls {
  listProjects: number;
  bodies: unknown[];
}

/** A client double that answers what the test tells it to. */
function fakeClient(answers: {
  list?: Array<Result<{ projects: ProjectSummary[] }, ApiProblem>>;
  create?: Result<OpenProjectResponse, ApiProblem>;
  open?: Result<OpenProjectResponse, ApiProblem>;
  close?: Result<undefined, ApiProblem>;
  save?: Result<SaveProjectResponse, ApiProblem>;
  checkpoint?: Result<CheckpointResponse, ApiProblem>;
}): { client: ApiClient; calls: Calls; settle: () => Promise<void> } {
  const calls: Calls = { listProjects: 0, bodies: [] };
  let listIndex = 0;
  const client = {
    run: (id: string, request?: { body?: unknown }) => {
      calls.bodies.push(request?.body);
      switch (id) {
        case 'listProjects': {
          calls.listProjects += 1;
          const list = answers.list ?? [];
          const answer = list[Math.min(listIndex, list.length - 1)] ?? ok({ projects: [] });
          listIndex += 1;
          return Promise.resolve(answer);
        }
        case 'createProject':
          return Promise.resolve(answers.create ?? err(problem('NS-PROJECT-0000')));
        case 'openProject':
          return Promise.resolve(answers.open ?? err(problem('NS-PROJECT-0000')));
        case 'closeProject':
          return Promise.resolve(answers.close ?? ok(undefined));
        case 'saveProject':
        case 'saveProjectAs':
          return Promise.resolve(answers.save ?? err(problem('NS-PROJECT-0000')));
        case 'checkpointProject':
          return Promise.resolve(answers.checkpoint ?? err(problem('NS-PROJECT-0000')));
        default:
          return Promise.resolve(err(problem('NS-TEST-0000')));
      }
    },
    url: () => '',
  } as unknown as ApiClient;
  return { client, calls, settle: () => Promise.resolve() };
}

function saved(id: string, path: string): SaveProjectResponse {
  return {
    project_id: id,
    path,
    format_version: 2,
    saved_at_ms: 1_700_000_000_000,
  };
}

function opened(id: string, warnings: string[] = []): OpenProjectResponse {
  return { project: summary(id), warnings, recovered: false };
}

async function ready(store: ProjectStore): Promise<ProjectStore> {
  await store.getState().refresh();
  return store;
}

describe('refreshing', () => {
  it('the service answers with what is open, and the store holds exactly that', async () => {
    const { client } = fakeClient({ list: [ok({ projects: [summary('a'), summary('b')] })] });
    const store = await ready(createProjectStore(client));
    expect(store.getState().projects.map((p) => p.project_id)).toEqual(['a', 'b']);
    expect(store.getState().status).toBe('ready');
  });

  it('a failed refresh keeps the list it had and records why', async () => {
    const { client } = fakeClient({
      list: [ok({ projects: [summary('a')] }), err(problem('NS-TRANSPORT-5030'))],
    });
    const store = await ready(createProjectStore(client));
    const second = await store.getState().refresh();

    expect(second.ok).toBe(false);
    expect(store.getState().projects.map((p) => p.project_id)).toEqual(['a']);
    expect(store.getState().status).toBe('error');
    expect(store.getState().error?.code).toBe('NS-TRANSPORT-5030');
  });

  it('a success clears the last failure', async () => {
    const { client } = fakeClient({
      list: [err(problem('NS-TRANSPORT-5030')), ok({ projects: [summary('a')] })],
    });
    const store = createProjectStore(client);
    await store.getState().refresh();
    expect(store.getState().status).toBe('error');
    await store.getState().refresh();
    expect(store.getState().status).toBe('ready');
    expect(store.getState().error).toBeNull();
  });
});

describe('coalescing', () => {
  it('a refresh while one is running joins it instead of starting another', async () => {
    const { client, calls } = fakeClient({ list: [ok({ projects: [summary('a')] })] });
    const store = createProjectStore(client);
    const first = store.getState().refresh();
    const second = store.getState().refresh();
    // The same promise, so the caller awaiting the second is not told a
    // different story than the one awaiting the first.
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(calls.listProjects).toBe(2); // the one running, then one catch-up
  });

  it('a request made while one is in flight still gets the newer answer', async () => {
    const { client, calls } = fakeClient({
      list: [ok({ projects: [summary('a')] }), ok({ projects: [summary('a'), summary('b')] })],
    });
    const store = createProjectStore(client);
    const first = store.getState().refresh();
    const second = store.getState().refresh();
    await Promise.all([first, second]);
    expect(calls.listProjects).toBe(2);
    expect(store.getState().projects.map((p) => p.project_id)).toEqual(['a', 'b']);
  });
});

describe('creating, opening and closing', () => {
  it('a created project is added and becomes the one on screen', async () => {
    const { client, calls } = fakeClient({ create: ok(opened('new')) });
    const store = createProjectStore(client);
    const created = await store.getState().create('Holiday', null);

    expect(created.ok && created.value).toBe('new');
    expect(store.getState().currentId).toBe('new');
    expect(store.getState().projects).toHaveLength(1);
    expect(calls.bodies[0]).toEqual({ name: 'Holiday' });
  });

  it('a path is only sent when there is one', async () => {
    const { client, calls } = fakeClient({ create: ok(opened('new')) });
    const store = createProjectStore(client);
    await store.getState().create('Holiday', '/tmp/h.nova');
    expect(calls.bodies[0]).toEqual({ name: 'Holiday', path: '/tmp/h.nova' });
  });

  it('an open carries its warnings, which are the user’s to read', async () => {
    const { client } = fakeClient({
      open: ok({ project: summary('x'), warnings: ['two assets are missing'], recovered: true }),
    });
    const store = createProjectStore(client);
    const result = await store.getState().open('/tmp/x.nova');

    expect(result.ok && result.value.warnings).toEqual(['two assets are missing']);
    expect(result.ok && result.value.recovered).toBe(true);
    expect(store.getState().currentId).toBe('x');
  });

  it('a failed open is reported and changes nothing', async () => {
    const { client } = fakeClient({ open: err(problem('NS-PROJECT-4041')) });
    const store = createProjectStore(client);
    const result = await store.getState().open('/tmp/gone.nova');

    expect(result.ok).toBe(false);
    expect(store.getState().currentId).toBeNull();
    expect(store.getState().projects).toHaveLength(0);
    expect(store.getState().error?.code).toBe('NS-PROJECT-4041');
  });

  it('closing the current project clears what is on screen', async () => {
    const { client } = fakeClient({
      list: [ok({ projects: [summary('a'), summary('b')] })],
      close: ok(undefined),
    });
    const store = createProjectStore(client);
    await store.getState().refresh();
    store.getState().select('a');
    const closed = await store.getState().close('a');

    expect(closed.ok).toBe(true);
    expect(store.getState().projects.map((p) => p.project_id)).toEqual(['b']);
    expect(store.getState().currentId).toBeNull();
  });

  it('closing some other project leaves the current one alone', async () => {
    const { client } = fakeClient({
      list: [ok({ projects: [summary('a'), summary('b')] })],
      close: ok(undefined),
    });
    const store = createProjectStore(client);
    await store.getState().refresh();
    store.getState().select('a');
    await store.getState().close('b');
    expect(store.getState().currentId).toBe('a');
  });
});

describe('saving', () => {
  it('a save asks for the summary rather than flipping flags it does not own', async () => {
    const { client, calls } = fakeClient({
      list: [
        ok({ projects: [summary('a', { dirty: true })] }),
        ok({ projects: [summary('a', { path: '/tmp/a.nova', dirty: false })] }),
      ],
      save: ok(saved('a', '/tmp/a.nova')),
    });
    const store = createProjectStore(client);
    await store.getState().refresh();
    const result = await store.getState().save('a');

    expect(result.ok).toBe(true);
    expect(calls.listProjects).toBe(2); // the save response is not a summary
    const held = store.getState().projects[0];
    expect(held?.path).toBe('/tmp/a.nova');
    expect(held?.dirty).toBe(false);
  });

  it('save-as moves the project to the new file', async () => {
    const { client } = fakeClient({
      list: [
        ok({ projects: [summary('a', { path: '/tmp/old.nova' })] }),
        ok({ projects: [summary('a', { path: '/tmp/new.nova' })] }),
      ],
      save: ok(saved('a', '/tmp/new.nova')),
    });
    const store = createProjectStore(client);
    await store.getState().refresh();
    await store.getState().saveAs('a', '/tmp/new.nova');
    expect(store.getState().projects[0]?.path).toBe('/tmp/new.nova');
  });

  it('a checkpoint asks for the summary rather than guessing the counters', async () => {
    const { client, calls } = fakeClient({
      list: [
        ok({ projects: [summary('a', { pending_commands: 12 })] }),
        ok({ projects: [summary('a', { pending_commands: 0, checkpoint_sequence: 7 })] }),
      ],
      checkpoint: ok({
        project_id: 'a',
        sequence: 7,
        revision: 3,
        recorded_at_ms: 1_700_000_000_000,
        truncated: 0,
        taken: true,
      }),
    });
    const store = createProjectStore(client);
    await store.getState().refresh();
    await store.getState().checkpoint('a');
    expect(calls.listProjects).toBe(2);
    expect(store.getState().projects[0]?.pending_commands).toBe(0);
  });
});

describe('events', () => {
  function envelope(topic: string, seq = 1): EventEnvelope {
    return { type: 'event', topic, seq, ts: 1_700_000_000_000 };
  }

  it('a project event means ask again, and nothing else', async () => {
    const { client, calls } = fakeClient({
      list: [ok({ projects: [] }), ok({ projects: [summary('a')] })],
    });
    const store = createProjectStore(client);
    await store.getState().refresh();
    store.getState().applyEvent(envelope('project.opened'));
    await vi.waitFor(() => {
      expect(store.getState().projects).toHaveLength(1);
    });
    expect(calls.listProjects).toBe(2);
  });

  it('an event about something else is not ours to act on', async () => {
    const { client, calls } = fakeClient({ list: [ok({ projects: [] })] });
    const store = createProjectStore(client);
    await store.getState().refresh();
    store.getState().applyEvent(envelope('timeline.clip.moved'));
    await Promise.resolve();
    expect(calls.listProjects).toBe(1);
  });

  it('ten events in a tick are two requests, not ten', async () => {
    const { client, calls } = fakeClient({
      list: [ok({ projects: [] }), ok({ projects: [summary('a')] })],
    });
    const store = createProjectStore(client);
    await store.getState().refresh();
    for (let i = 2; i < 12; i += 1) store.getState().applyEvent(envelope('project.saved', i));
    await vi.waitFor(() => {
      expect(store.getState().projects).toHaveLength(1);
    });
    // The one the first event started, plus one catch-up for the nine that
    // arrived while it was in flight — an event that lands mid-request may or
    // may not be in the snapshot, so asking once more is the honest answer.
    expect(calls.listProjects).toBe(3);
  });
});

describe('selection', () => {
  it('is the store’s own business, and costs no request', async () => {
    const { client, calls } = fakeClient({ list: [ok({ projects: [summary('a')] })] });
    const store = createProjectStore(client);
    await store.getState().refresh();
    store.getState().select('a');
    store.getState().select(null);
    expect(store.getState().currentId).toBeNull();
    expect(calls.listProjects).toBe(1);
  });
});
