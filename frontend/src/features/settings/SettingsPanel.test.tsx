// @vitest-environment jsdom
/** The settings panel, against a client double.
 *
 *  What is pinned here is what a settings panel gets wrong, which is nearly
 *  always one of three things:
 *
 *  * **It posts on every keystroke.** A width typed one digit at a time would
 *    journal four undo entries for one decision. The number fields commit on
 *    blur, and only when the value changed.
 *  * **It decides what is allowed.** This panel does not: a refusal comes back
 *    from the service and is printed in the service's words.
 *  * **It lies after an undo.** The field has to show what the settings *are*,
 *    not what the user last typed, and that only happens if the draft is
 *    re-synced when the answer changes.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../../core/api/client';
import { ApiContext } from '../../core/api/context';
import type {
  HistorySummary,
  SettingsCommandResponse,
  SettingsResponse,
  SettingsSummary,
} from '../../core/api/contract';
import type { ApiProblem } from '../../core/api/problem';
import { I18nProvider } from '../../core/i18n/I18nProvider';
import { err, ok } from '../../core/result';
import { createSettingsStore, SettingsStoreContext } from '../../stores/settings';
import { ToastProvider } from '../../ui/ToastProvider';
import { SettingsPanel } from './SettingsPanel';

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
    settings: summary(over.settings === undefined ? {} : over.settings),
    history: history(),
    journal_sequence: 0,
    pending_commands: 0,
    dirty: false,
    ...over,
  };
}

interface Script {
  readonly get?: SettingsResponse | { readonly error: ApiProblem };
  readonly patch?: SettingsCommandResponse | { readonly error: ApiProblem };
  readonly undo?: { readonly undone: boolean };
}

function problem(code: string): ApiProblem {
  return {
    kind: 'server',
    code,
    status: 409,
    remedy: '',
    detail: 'not a rate we mix',
  } as unknown as ApiProblem;
}

function client(script: Script, calls: { readonly id: string; readonly body?: unknown }[]) {
  const answered = (value: SettingsCommandResponse | { readonly error: ApiProblem }) =>
    'error' in value ? err(value.error) : ok(value);

  return {
    run: (id: string, init?: { readonly body?: unknown }) => {
      calls.push({ id, ...(init?.body === undefined ? {} : { body: init.body }) });
      switch (id) {
        case 'getSettings': {
          const value = script.get ?? read();
          return Promise.resolve('error' in value ? err(value.error) : ok(value));
        }
        case 'patchSettings':
          return Promise.resolve(
            answered(
              script.patch ?? {
                ...read(),
                command_id: 'project.set-settings',
                name: 'set-settings',
                summary: 'changed',
                affected: ['settings'],
                invalidate: ['settings', 'preview'],
                rerender: true,
                marks_dirty: true,
                dirty: true,
                journal_sequence: 1,
                pending_commands: 1,
                history: history({ can_undo: true, undo_depth: 1 }),
              },
            ),
          );
        case 'undoSettings':
          return Promise.resolve(
            ok({
              ...read(),
              undone: script.undo?.undone ?? true,
              command_id: 'project.set-settings',
              name: 'set-settings',
            }),
          );
        case 'redoSettings':
          return Promise.resolve(
            ok({
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
}

/** A panel holding a real store, the way the window builds it. */
function Harness({
  script,
  calls = [],
}: {
  readonly script: Script;
  readonly calls?: { readonly id: string; readonly body?: unknown }[];
}): React.JSX.Element {
  const [api] = useState(() => client(script, calls));
  const [store] = useState(() => createSettingsStore(api));
  return (
    <I18nProvider>
      <ApiContext.Provider value={api}>
        <ToastProvider>
          <SettingsStoreContext.Provider value={store}>
            <SettingsPanel projectId="p1" />
          </SettingsStoreContext.Provider>
        </ToastProvider>
      </ApiContext.Provider>
    </I18nProvider>
  );
}

async function renderPanel(
  script: Script = {},
): Promise<{ readonly calls: { readonly id: string; readonly body?: unknown }[] }> {
  const calls: { readonly id: string; readonly body?: unknown }[] = [];
  render(<Harness script={script} calls={calls} />);
  await waitFor(() => {
    expect(screen.getByLabelText('Width')).toBeDefined();
  });
  return { calls };
}

describe('a settings panel', () => {
  it('asks for the settings and shows them', async () => {
    await renderPanel({ get: read({ settings: summary({ channels: 6 }) }) });

    expect(screen.getByLabelText<HTMLInputElement>('Width').value).toBe('1920');
    expect(screen.getByLabelText<HTMLInputElement>('Height').value).toBe('1080');
    expect(screen.getByLabelText<HTMLSelectElement>('Channels').value).toBe('6');
  });

  it('names the preset the frame is, because that is what the user chose', async () => {
    await renderPanel({
      get: read({ settings: summary({ frame_size: { width: 3840, height: 2160 } }) }),
    });

    expect(screen.getByLabelText<HTMLSelectElement>('Preset').value).toBe('3840x2160');
  });

  it("says the frame is one of the user's own when it is", async () => {
    await renderPanel({
      get: read({ settings: summary({ frame_size: { width: 1440, height: 1080 } }) }),
    });

    expect(screen.getByLabelText<HTMLSelectElement>('Preset').value).toBe('');
  });

  it('shows the aspect ratio in both the forms an editor says it', async () => {
    await renderPanel();

    expect(screen.getByText(/16:9 · 1\.778/)).toBeDefined();
  });

  it('says nothing while it is still asking', () => {
    render(<Harness script={{ get: read() }} />);
    expect(screen.getByText(/Reading the project/)).toBeDefined();
  });

  it('says which code failed when the settings cannot be read', async () => {
    render(<Harness script={{ get: { error: problem('NS-PROJECT-4091') } }} />);
    await waitFor(() => {
      expect(screen.getByText(/NS-PROJECT-4091/)).toBeDefined();
    });
  });
});

describe('changing a setting', () => {
  it('posts only the field that changed', async () => {
    const { calls } = await renderPanel();

    await userEvent.selectOptions(screen.getByLabelText('Channels'), '6');

    const body = calls.at(-1)?.body as Record<string, unknown>;
    expect(body).toEqual({ type: 'set-settings', channels: 6 });
  });

  it('posts a frame preset as two numbers, because that is what a frame is', async () => {
    const { calls } = await renderPanel();

    await userEvent.selectOptions(screen.getByLabelText('Preset'), '1280x720');

    const body = calls.at(-1)?.body as Record<string, unknown>;
    expect(body.frame_size).toEqual({ width: 1280, height: 720 });
    expect(body.channels).toBeUndefined();
  });

  it('commits a typed width on blur, and not before', async () => {
    const { calls } = await renderPanel();
    const before = calls.length;

    await userEvent.type(screen.getByLabelText('Width'), '0');
    // The point: three keystrokes, three letters of *draft*, and no request. A
    // panel that posted on every keystroke would journal four undo entries for
    // one decision.
    expect(calls.length).toBe(before);

    await userEvent.tab();

    const body = calls.at(-1)?.body as Record<string, unknown>;
    expect(body.frame_size).toEqual({ width: 19200, height: 1080 });
  });

  it('does not post when the value came back the same', async () => {
    const { calls } = await renderPanel();
    const field = screen.getByLabelText('Width');
    const before = calls.length;

    await userEvent.type(field, '1920');
    await userEvent.clear(field);
    await userEvent.type(field, '1920');
    await userEvent.tab();

    expect(calls.length).toBe(before);
  });

  it('puts the number back when what was typed is not a frame', async () => {
    const { calls } = await renderPanel();
    const field = screen.getByLabelText<HTMLInputElement>('Width');
    const before = calls.length;

    await userEvent.clear(field);
    await userEvent.type(field, '0');
    await userEvent.tab();

    expect(calls.length).toBe(before);
    // Not left showing something the settings are not.
    expect(field.value).toBe('1920');
  });

  it('shows the sentence the service sent about what it did', async () => {
    await renderPanel({
      patch: {
        ...read(),
        command_id: 'project.set-settings',
        name: 'set-settings',
        summary: 'changed 6 channels (was 2)',
        affected: ['settings'],
        invalidate: ['settings', 'preview'],
        rerender: true,
        marks_dirty: true,
      },
    });

    await userEvent.selectOptions(screen.getByLabelText('Channels'), '6');

    await waitFor(() => {
      expect(screen.getByText('changed 6 channels (was 2)')).toBeDefined();
    });
  });

  it("prints the service's refusal rather than deciding for itself", async () => {
    await renderPanel({ patch: { error: problem('NS-COMMAND-4104') } });

    await userEvent.selectOptions(screen.getByLabelText('Channels'), '6');

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('not a rate we mix');
    });
  });

  it('turns a proxy switch off with one click', async () => {
    const { calls } = await renderPanel();

    await userEvent.click(screen.getByLabelText('Decode from a proxy when one exists'));

    const body = calls.at(-1)?.body as Record<string, unknown>;
    expect(body.use_proxies).toBe(false);
  });
});

describe('undo and redo', () => {
  it('cannot be undone before anything has been changed', async () => {
    await renderPanel();

    expect(screen.getByLabelText<HTMLButtonElement>('Undo the last settings change').disabled).toBe(
      true,
    );
  });

  it('can be undone once something has', async () => {
    await renderPanel();

    await userEvent.selectOptions(screen.getByLabelText('Channels'), '6');

    await waitFor(() => {
      expect(
        screen.getByLabelText<HTMLButtonElement>('Undo the last settings change').disabled,
      ).toBe(false);
    });
  });

  it('asks the service to undo, rather than remembering the old value', async () => {
    const { calls } = await renderPanel();

    await userEvent.selectOptions(screen.getByLabelText('Channels'), '6');
    await waitFor(() => {
      expect(
        screen.getByLabelText<HTMLButtonElement>('Undo the last settings change').disabled,
      ).toBe(false);
    });
    await userEvent.click(screen.getByLabelText('Undo the last settings change'));

    expect(calls.at(-1)?.id).toBe('undoSettings');
  });

  it('says so when there was nothing to undo', async () => {
    const calls: { readonly id: string; readonly body?: unknown }[] = [];
    const store = createSettingsStore(client({ undo: { undone: false } }, calls));
    render(
      <I18nProvider>
        <ToastProvider>
          <SettingsStoreContext.Provider value={store}>
            <SettingsPanel projectId="p1" />
          </SettingsStoreContext.Provider>
        </ToastProvider>
      </I18nProvider>,
    );
    await waitFor(() => {
      expect(screen.getByLabelText('Width')).toBeDefined();
    });

    // Enabled by a history the test says can be undone, and the service then
    // says there was nothing — which is the stale-button case, and the reason
    // the answer is printed rather than assumed.
    act(() => {
      store.setState({
        settings: summary(),
        history: history({ can_undo: true, undo_depth: 1 }),
        status: 'ready',
      });
    });
    await userEvent.click(screen.getByLabelText('Undo the last settings change'));

    await waitFor(() => {
      expect(screen.getByText('There is no settings change to undo.')).toBeDefined();
    });
  });
});

describe('the draft and the answer', () => {
  it('shows what the settings are after an undo, not what was typed', async () => {
    const calls: { readonly id: string; readonly body?: unknown }[] = [];
    const script: Script = { get: read() };
    const store = createSettingsStore(client(script, calls));
    render(
      <I18nProvider>
        <ToastProvider>
          <SettingsStoreContext.Provider value={store}>
            <SettingsPanel projectId="p1" />
          </SettingsStoreContext.Provider>
        </ToastProvider>
      </I18nProvider>,
    );
    await waitFor(() => {
      expect(screen.getByLabelText('Width')).toBeDefined();
    });

    const field = screen.getAllByLabelText<HTMLInputElement>('Width')[0];
    if (field === undefined) throw new Error('no width field');
    // Typed but never committed, so the store still holds 1920.
    await userEvent.type(field, '9');
    expect(field.value).toBe('19209');

    // The service answers with a different frame — an undo, a load, an event.
    act(() => {
      store.setState({ settings: summary({ frame_size: { width: 1280, height: 720 } }) });
    });

    await waitFor(() => {
      expect(field.value).toBe('1280');
    });
  });

  it('warns about an odd frame instead of refusing it', async () => {
    await renderPanel({
      get: read({
        settings: summary({ frame_size: { width: 1080, height: 1919 }, even_dimensions: false }),
      }),
    });

    expect(screen.getByRole('status').textContent).toContain('4:2:0');
  });

  it('says nothing about an even frame', async () => {
    const spy = vi.spyOn(console, 'error');
    await renderPanel();
    expect(screen.queryByText(/4:2:0/)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
