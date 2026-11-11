// @vitest-environment jsdom
/** The shell, wired: the whole window against a client double.
 *
 *  Every other test in this folder is a component on its own. This one is the
 *  window, and what it pins is what only the whole can show:
 *
 *  * **A command is one thing with several doors.** `Ctrl+N` and the home
 *    screen's button open the same dialog; `Ctrl+S` saves whatever the window is
 *    showing and says so when it cannot.
 *  * **An address that does not make sense is the home screen.** A route naming
 *    a project this session has not got is not an error the user can act on.
 *  * **Every answer is reported.** A save that failed silently is a save the
 *    user believes happened, so the toast is part of the contract.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { CommandsProvider } from '../../app/CommandProvider';
import { ApiContext } from '../../core/api/context';
import { RouterProvider } from '../../app/router';
import { HOME } from '../../app/routes';
import { WorkspaceProviders } from '../../app/providers';
import type { ApiClient } from '../../core/api/client';
import type { ProjectSummary } from '../../core/api/contract';
import type { ApiProblem } from '../../core/api/problem';
import type { SocketLike } from '../../core/events/bridge';
import { I18nProvider } from '../../core/i18n/I18nProvider';
import { err, ok } from '../../core/result';
import { ThemeProvider } from '../../core/theme/ThemeProvider';
import { ToastProvider } from '../../ui/ToastProvider';
import { Shell } from './Shell';

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

interface Script {
  readonly projects?: readonly ProjectSummary[];
  readonly create?: { id: string } | { error: ApiProblem };
  readonly open?: { id: string; warnings?: string[] } | { error: ApiProblem };
  readonly save?: { error: ApiProblem } | null;
  readonly media?: { assets?: number } | { error: ApiProblem };
  readonly calls?: string[];
}

function problem(code: string): ApiProblem {
  return { kind: 'server', code, status: 500, remedy: '', detail: '' } as unknown as ApiProblem;
}

/** A client double that answers what the window asks and records what it asked. */
function scripted(script: Script): ApiClient {
  const calls: string[] = script.calls ?? [];
  return {
    run: (
      id: string,
      request?: { body?: Record<string, unknown>; params?: Record<string, string> },
    ) => {
      calls.push(id);
      switch (id) {
        case 'listProjects':
          return Promise.resolve(ok({ projects: [...(script.projects ?? [])] }));
        case 'createProject': {
          const answer = script.create;
          if (!answer || 'error' in answer) return Promise.resolve(err(problem('NS-TEST-0001')));
          return Promise.resolve(
            ok({
              project: summary(answer.id, {
                // `unknown` in the body, so it is narrowed rather than
                // stringified: a name that arrived as a number is a bug worth
                // seeing, not a project called "[object Object]".
                name: typeof request?.body?.name === 'string' ? request.body.name : answer.id,
              }),
            }),
          );
        }
        case 'openProject': {
          const answer = script.open;
          if (!answer || 'error' in answer) return Promise.resolve(err(problem('NS-TEST-0002')));
          return Promise.resolve(
            ok({
              project: summary(answer.id, { name: `opened ${answer.id}` }),
              warnings: answer.warnings ?? [],
            }),
          );
        }
        case 'saveProject': {
          const answer = script.save;
          return Promise.resolve(
            answer && 'error' in answer ? err(answer.error) : ok({ path: '/tmp/p.nova' }),
          );
        }
        case 'listMedia': {
          const answer = script.media;
          if (answer && 'error' in answer) return Promise.resolve(err(answer.error));
          const total = (answer as { assets?: number } | undefined)?.assets ?? 0;
          return Promise.resolve(
            ok({
              project_id: request?.params?.['project_id'] ?? '',
              assets: Array.from({ length: total }, (_, index) => ({
                asset_id: `a${index}`,
                name: `clip ${index}.mp4`,
                path: `/videos/clip ${index}.mp4`,
                kind: 'video',
                duration_seconds: 12.5,
                linked: true,
                probed: true,
                warnings: [],
                video: [],
                audio: [],
              })),
              missing: 0,
              total,
            }),
          );
        }
        default:
          return Promise.resolve(err(problem('NS-TEST-0000')));
      }
    },
    url: () => '',
  } as unknown as ApiClient;
}

class FakeSocket implements SocketLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(readonly url: string) {}

  send(): void {}

  close(): void {}
}

function renderShell(script: Script, route = HOME): { readonly calls: string[] } {
  const calls: string[] = script.calls ?? [];
  // One client, given twice: the API context is what a panel reaches for, and
  // `WorkspaceProviders` is what builds the store around it. In the window both
  // come from `main.tsx`, and they are the same object.
  const client = scripted({ ...script, calls });
  render(
    <I18nProvider>
      <ThemeProvider>
        <ToastProvider>
          <CommandsProvider>
            <RouterProvider initial={route}>
              <ApiContext.Provider value={client}>
                <WorkspaceProviders
                  client={client}
                  socketFactory={(url: string) => new FakeSocket(url)}
                >
                  <Shell version="1.2.3" />
                </WorkspaceProviders>
              </ApiContext.Provider>
            </RouterProvider>
          </CommandsProvider>
        </ToastProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  return { calls };
}

afterEach(async () => {
  // Cleared, and then given a tick: jsdom queues the `hashchange` for a later
  // task, and one that lands in the middle of the next test would move that
  // test's window to the home screen while it was looking elsewhere.
  window.location.hash = '';
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
});

describe('a window with nothing open', () => {
  it('starts on the home screen and says what it is', async () => {
    renderShell({ projects: [summary('a', { name: 'Holiday edit' })] });
    expect(await screen.findByText('Holiday edit')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Projects', level: 1 })).toBeTruthy();
    // The title bar and the status bar both say it, for two different reasons:
    // one is what the window is showing, the other is what is safe.
    expect(screen.getAllByText('No project open').length).toBe(2);
  });

  it('offers a command to make one, by key as well as by button', async () => {
    const user = userEvent.setup();
    renderShell({});

    await user.keyboard('{Control>}n{/Control}');

    expect(screen.getByRole('dialog', { name: 'New project' })).toBeTruthy();
    // And the same dialog from the home screen's own button.
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'New project' }));
    expect(screen.getByRole('dialog', { name: 'New project' })).toBeTruthy();
  });
});

describe('making a project', () => {
  it('creates it, says so, and goes there', async () => {
    const user = userEvent.setup();
    renderShell({ create: { id: 'new-1' } });

    await user.click(screen.getByRole('button', { name: 'New project' }));
    const dialog = screen.getByRole('dialog', { name: 'New project' });
    await user.type(within(dialog).getByLabelText('Project name'), 'Birthday');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(window.location.hash).toBe('#/editor/new-1');
    });
    expect(await screen.findByText('Created Birthday.')).toBeTruthy();
    // The title bar and the status bar both follow.
    expect(screen.getAllByText('Birthday').length).toBeGreaterThan(0);
  });

  it('says what happened when it did not', async () => {
    const user = userEvent.setup();
    renderShell({ create: { error: problem('NS-TEST-0001') } });

    await user.click(screen.getByRole('button', { name: 'New project' }));
    const dialog = screen.getByRole('dialog', { name: 'New project' });
    await user.type(within(dialog).getByLabelText('Project name'), 'Birthday');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    // Said twice, and that is deliberate: the toast is what you notice, and the
    // panel's own error is what is still there a minute later.
    expect((await screen.findAllByText(/NS-TEST-0001/)).length).toBeGreaterThan(0);
    // Still on the home screen: a failed create is not a project.
    expect(window.location.hash).toBe('');
  });
});

describe('an address that means nothing', () => {
  it('is the home screen rather than an error', async () => {
    renderShell({ projects: [summary('a')] }, { name: 'editor', projectId: 'gone' });

    // A bookmark, a reload, or a project closed while this window looked away.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Projects', level: 1 })).toBeTruthy();
    });
  });

  it('is a project when the session has it', async () => {
    renderShell(
      { projects: [summary('a', { name: 'Holiday edit' })], media: { assets: 2 } },
      { name: 'editor', projectId: 'a' },
    );

    // The editor's one pane today, drawing real rows from the service.
    expect(await screen.findByText('clip 0.mp4')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Media', level: 2 })).toBeTruthy();
  });
});

describe('the window’s commands', () => {
  it('saves the project on screen and says so', async () => {
    const user = userEvent.setup();
    renderShell({ projects: [summary('a', { name: 'Holiday edit' })], media: { assets: 0 } });

    // The way a user gets there: open the project, which is what makes it the
    // one on screen rather than merely one that exists.
    await user.click(await screen.findByRole('button', { name: 'Open Holiday edit' }));
    await screen.findByRole('heading', { name: 'Media', level: 2 });

    await user.keyboard('{Control>}s{/Control}');

    expect(await screen.findByText('Saved Holiday edit.')).toBeTruthy();
  });

  it('says nothing was saved when the save failed, and stays put', async () => {
    const user = userEvent.setup();
    renderShell({
      projects: [summary('a', { name: 'Holiday edit' })],
      media: { assets: 0 },
      save: { error: problem('NS-TEST-0003') },
    });

    await user.click(await screen.findByRole('button', { name: 'Open Holiday edit' }));
    await screen.findByRole('heading', { name: 'Media', level: 2 });

    await user.keyboard('{Control>}s{/Control}');

    // Reported, and it stays: a danger toast is the one kind that does not
    // expire, because a failure the user missed is a failure they cannot fix.
    expect(await screen.findByText(/NS-TEST-0003/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Media', level: 2 })).toBeTruthy();
  });

  it('finds a command by typing, and runs it', async () => {
    const user = userEvent.setup();
    renderShell({ projects: [] });

    await user.keyboard('{Control>}{Shift>}p{/Shift}{/Control}');
    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    await user.type(within(dialog).getByRole('combobox'), 'open pro');
    await user.keyboard('{Enter}');

    expect(screen.getByRole('dialog', { name: 'Open project' })).toBeTruthy();
  });

  it('will not offer to save when there is nothing to save', async () => {
    const user = userEvent.setup();
    renderShell({ projects: [] });

    await user.keyboard('{Control>}{Shift>}p{/Shift}{/Control}');

    // "Close project" is there, greyed out and left out of the list: a palette
    // is for finding something, not for showing what is forbidden.
    expect(screen.queryByRole('option', { name: /Save project/ })).toBeNull();
  });

  it('goes back to the projects screen when asked to', async () => {
    const user = userEvent.setup();
    renderShell({ projects: [summary('a')], media: { assets: 0 } });
    await user.click(await screen.findByRole('button', { name: 'Open project a' }));
    await screen.findByRole('heading', { name: 'Media', level: 2 });

    await user.keyboard('{Control>}{Shift>}p{/Shift}{/Control}');
    await user.type(screen.getByRole('combobox'), 'go to projects');
    await user.keyboard('{Enter}');

    expect(screen.getByRole('heading', { name: 'Projects', level: 1 })).toBeTruthy();
  });
});
