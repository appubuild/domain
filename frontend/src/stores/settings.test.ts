/** The settings slice, against a client double.
 *
 *  The fourth slice and the first that writes, so what is pinned here is what a
 *  writing store has to get right that a reading one does not:
 *
 *  * **A patch sends only what it names.** Two panels can hold two settings
 *    open at once; a body that carried the whole object would be one of them
 *    telling the service to undo the other's work.
 *  * **A refusal keeps what it had.** A sample rate the service will not mix is
 *    not evidence that the settings changed, and a store that dropped them
 *    would leave the panel describing a project that does not exist.
 *  * **The undo depth is the service's, not ours.** Every answer replaces it, so
 *    the panel's Ctrl+Z and the service's Ctrl+Z cannot disagree.
 *  * **Switching projects empties it first.** The previous project's frame size
 *    must never be shown as this project's — which is exactly what you would
 *    see, for half a second, without this.
 */

import { describe, expect, it } from 'vitest';

import type { ApiClient } from '../core/api/client';
import type {
  HistorySummary,
  SettingsCommandResponse,
  SettingsRedoResponse,
  SettingsResponse,
  SettingsSummary,
  SettingsUndoResponse,
} from '../core/api/contract';
import type { ApiProblem } from '../core/api/problem';
import { err, ok, type Result } from '../core/result';
import { createSettingsStore } from './settings';

function problem(code: string): ApiProblem {
  return { kind: 'api', status: 409, code, detail: code };
}

function summary(over: Partial<SettingsSummary> = {}): SettingsSummary {
  return {
    frame_size: { width: 1920, height: 1080 },
    aspect_ratio: 16 / 9,
    even_dimensions: true,
    sample_rate: 48000,
    channels: 2,
    use_proxies: true,
    working_colour_space: 1,
    ...over,
  };
}

function history(over: Partial<HistorySummary> = {}): HistorySummary {
  return {
    can_undo: false,
    can_redo: false,
    undo_label: '',
    redo_label: '',
    undo_depth: 0,
    redo_depth: 0,
    recent: [],
    ...over,
  };
}

function read(over: Partial<SettingsResponse> = {}): SettingsResponse {
  return {
    project_id: 'p1',
    settings: summary(),
    history: history(),
    journal_sequence: 0,
    pending_commands: 0,
    dirty: false,
    ...over,
  };
}

function changed(over: Partial<SettingsCommandResponse> = {}): SettingsCommandResponse {
  return {
    project_id: 'p1',
    settings: summary(),
    history: history({ can_undo: true, undo_depth: 1, undo_label: 'command.project.set_settings' }),
    journal_sequence: 1,
    pending_commands: 1,
    dirty: true,
    command_id: 'project.set-settings',
    name: 'set-settings',
    summary: 'changed 6 channels (was 2)',
    affected: ['settings'],
    invalidate: ['settings', 'preview', 'export'],
    rerender: true,
    marks_dirty: true,
    ...over,
  };
}

interface Call {
  readonly id: string;
  readonly body: unknown;
}

/** A client that answers from a script and remembers every body it was sent. */
function fakeClient(answers: {
  readonly get?: Result<SettingsResponse, ApiProblem>;
  readonly patch?: Result<SettingsCommandResponse, ApiProblem>;
  readonly undo?: Result<SettingsUndoResponse, ApiProblem>;
  readonly redo?: Result<SettingsRedoResponse, ApiProblem>;
}): { client: ApiClient; calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    run: (id: string, init?: { readonly body?: unknown }) => {
      calls.push({ id, body: init?.body });
      switch (id) {
        case 'getSettings':
          return Promise.resolve(answers.get ?? ok(read()));
        case 'patchSettings':
          return Promise.resolve(answers.patch ?? ok(changed()));
        case 'undoSettings':
          return Promise.resolve(
            answers.undo ??
              ok<SettingsUndoResponse>({
                ...read(),
                undone: true,
                command_id: 'project.set-settings',
                name: 'set-settings',
              }),
          );
        case 'redoSettings':
          return Promise.resolve(
            answers.redo ??
              ok<SettingsRedoResponse>({
                ...read(),
                redone: true,
                command_id: 'project.set-settings',
                name: 'set-settings',
              }),
          );
        default:
          return Promise.resolve(err(problem('NS-TEST-0000')));
      }
    },
    url: () => '',
  } as unknown as ApiClient;
  return { client, calls };
}

describe('reading the settings', () => {
  it('asks for them when a project is loaded', async () => {
    const { client } = fakeClient({});
    const store = createSettingsStore(client);

    await store.getState().load('p1');

    expect(store.getState().status).toBe('ready');
    expect(store.getState().settings?.channels).toBe(2);
    expect(store.getState().projectId).toBe('p1');
  });

  it('empties itself when the window moves to another project', async () => {
    const { client } = fakeClient({ get: ok(read({ settings: summary({ channels: 6 }) })) });
    const store = createSettingsStore(client);
    await store.getState().load('p1');

    // Synchronous, before the answer comes back: the previous project's frame
    // size must not be on screen under the new project's name.
    const pending = store.getState().load('p2');
    expect(store.getState().settings).toBeNull();
    expect(store.getState().projectId).toBe('p2');
    await pending;
  });

  it('keeps what it has when a refresh fails', async () => {
    // A client that answers once and then stops, which is the shape of a
    // transport that has gone wrong rather than a project that is gone.
    let down = false;
    const calls: Call[] = [];
    const client = {
      run: (id: string) => {
        calls.push({ id, body: undefined });
        return down
          ? Promise.resolve(err(problem('NS-TEST-0001')))
          : Promise.resolve(ok(read({ settings: summary({ channels: 6 }) })));
      },
      url: () => '',
    } as unknown as ApiClient;
    const store = createSettingsStore(client);

    await store.getState().load('p1');
    const before = store.getState().settings;
    down = true;
    const result = await store.getState().refresh();

    expect(result.ok).toBe(false);
    expect(store.getState().status).toBe('error');
    expect(store.getState().error?.code).toBe('NS-TEST-0001');
    // The point: a failed read is not evidence that the settings changed.
    expect(store.getState().settings).toEqual(before);
    expect(store.getState().settings?.channels).toBe(6);
  });
});

describe('changing one setting', () => {
  it('sends only the field that was named', async () => {
    const { client, calls } = fakeClient({});
    const store = createSettingsStore(client);
    await store.getState().load('p1');

    await store.getState().patch({ channels: 6 });

    const body = calls.at(-1)?.body as Record<string, unknown>;
    expect(body).toEqual({ type: 'set-settings', channels: 6 });
  });

  it('names the command it is, because the journal records that name', async () => {
    const { client, calls } = fakeClient({});
    const store = createSettingsStore(client);
    await store.getState().load('p1');

    await store.getState().patch({ sample_rate: 44_100 });

    const body = calls.at(-1)?.body as Record<string, unknown>;
    expect(body.type).toBe('set-settings');
  });

  it('replaces what it held with what the service says is true now', async () => {
    const { client } = fakeClient({
      patch: ok(changed({ settings: summary({ channels: 6 }), summary: 'changed 6 channels' })),
    });
    const store = createSettingsStore(client);
    await store.getState().load('p1');

    const result = await store.getState().patch({ channels: 6 });

    expect(result.ok).toBe(true);
    expect(store.getState().settings?.channels).toBe(6);
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().pendingCommands).toBe(1);
  });

  it('keeps the sentence the service sent about what it did', async () => {
    const { client } = fakeClient({
      patch: ok(changed({ summary: 'changed 6 channels (was 2)' })),
    });
    const store = createSettingsStore(client);
    await store.getState().load('p1');

    await store.getState().patch({ channels: 6 });

    expect(store.getState().lastSummary).toBe('changed 6 channels (was 2)');
  });

  it('holds the depth the service reports, not one it counted itself', async () => {
    const { client } = fakeClient({
      patch: ok(changed({ history: history({ can_undo: true, undo_depth: 3 }) })),
    });
    const store = createSettingsStore(client);
    await store.getState().load('p1');

    await store.getState().patch({ channels: 6 });

    expect(store.getState().history?.undo_depth).toBe(3);
  });

  it('reports a refusal and keeps the settings it had', async () => {
    const { client } = fakeClient({ patch: err(problem('NS-COMMAND-4104')) });
    const store = createSettingsStore(client);
    await store.getState().load('p1');
    const before = store.getState().settings;

    const result = await store.getState().patch({ channels: 3 });

    expect(result.ok).toBe(false);
    expect(store.getState().error?.code).toBe('NS-COMMAND-4104');
    expect(store.getState().settings).toEqual(before);
  });

  it('refuses to change the settings of a project it has not loaded', async () => {
    const { client, calls } = fakeClient({});
    const store = createSettingsStore(client);

    const result = await store.getState().patch({ channels: 6 });

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('undo and redo', () => {
  it('says whether there was anything to undo', async () => {
    const { client } = fakeClient({});
    const store = createSettingsStore(client);
    await store.getState().load('p1');

    const result = await store.getState().undo();

    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toBe(true);
  });

  it('says so when the stack was empty', async () => {
    const { client } = fakeClient({
      undo: ok({ ...read(), undone: false, command_id: '', name: '' }),
    });
    const store = createSettingsStore(client);
    await store.getState().load('p1');

    const result = await store.getState().undo();

    expect(result.ok && result.value).toBe(false);
    // An empty stack is not a failure, and a store that reported one would have
    // the panel explaining an error the user did not cause.
    expect(store.getState().error).toBeNull();
  });

  it('takes the settings back from the answer, not from a local memory', async () => {
    const { client } = fakeClient({
      undo: ok({
        ...read({ settings: summary({ channels: 2 }), dirty: true }),
        undone: true,
        command_id: 'project.set-settings',
        name: 'set-settings',
      }),
    });
    const store = createSettingsStore(client);
    await store.getState().load('p1');
    await store.getState().patch({ channels: 6 });

    await store.getState().undo();

    expect(store.getState().settings?.channels).toBe(2);
  });

  it('redoes, the same way', async () => {
    const { client, calls } = fakeClient({
      redo: ok({
        ...read({ settings: summary({ channels: 6 }) }),
        redone: true,
        command_id: 'project.set-settings',
        name: 'set-settings',
      }),
    });
    const store = createSettingsStore(client);
    await store.getState().load('p1');

    const result = await store.getState().redo();

    expect(result.ok && result.value).toBe(true);
    expect(store.getState().settings?.channels).toBe(6);
    expect(calls.at(-1)?.id).toBe('redoSettings');
  });

  it('does not claim an undo worked when the request failed', async () => {
    const { client } = fakeClient({ undo: err(problem('NS-TEST-0002')) });
    const store = createSettingsStore(client);
    await store.getState().load('p1');

    const result = await store.getState().undo();

    expect(result.ok).toBe(false);
    expect(store.getState().error?.code).toBe('NS-TEST-0002');
  });

  it('refuses when no project has been loaded', async () => {
    const { client } = fakeClient({});
    const store = createSettingsStore(client);

    expect((await store.getState().undo()).ok).toBe(false);
    expect((await store.getState().redo()).ok).toBe(false);
  });
});

describe('events', () => {
  it('asks again when the project changes', async () => {
    const { client, calls } = fakeClient({});
    const store = createSettingsStore(client);
    await store.getState().load('p1');
    const before = calls.filter((call) => call.id === 'getSettings').length;

    store.getState().applyEvent({
      topic: 'command.executed',
      at_ms: 0,
      data: {},
    } as never);

    expect(calls.filter((call) => call.id === 'getSettings').length).toBe(before + 1);
  });

  it('ignores a topic that is not the project changing', async () => {
    const { client, calls } = fakeClient({});
    const store = createSettingsStore(client);
    await store.getState().load('p1');
    const before = calls.filter((call) => call.id === 'getSettings').length;

    store.getState().applyEvent({ topic: 'media.imported', at_ms: 0, data: {} } as never);

    expect(calls.filter((call) => call.id === 'getSettings').length).toBe(before);
  });
});
