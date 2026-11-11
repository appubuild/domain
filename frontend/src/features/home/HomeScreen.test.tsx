// @vitest-environment jsdom
/** The home screen.
 *
 *  It owns the layout and nothing else, so the test is mostly about the seam:
 *  the two buttons ask the shell for its dialogs rather than growing their own,
 *  and opening a project is an address — the thing that makes a reload land
 *  where the user was.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../../core/api/client';
import { ApiContext } from '../../core/api/context';
import type { ProjectSummary } from '../../core/api/contract';
import { I18nProvider } from '../../core/i18n/I18nProvider';
import { ok } from '../../core/result';
import { createProjectStore, ProjectStoreContext } from '../../stores/project';
import { RouterProvider } from '../../app/router';
import { HomeScreen } from './HomeScreen';

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

function client(projects: readonly ProjectSummary[]): ApiClient {
  return {
    run: (id: string) =>
      id === 'listProjects'
        ? Promise.resolve(ok({ projects: [...projects] }))
        : Promise.resolve(ok(undefined)),
    url: () => '',
  } as unknown as ApiClient;
}

function renderHome(
  projects: readonly ProjectSummary[],
  handlers: { onNewProject?: () => void; onOpenProject?: () => void } = {},
): void {
  const api = client(projects);
  render(
    <I18nProvider>
      <RouterProvider>
        <ApiContext.Provider value={api}>
          <ProjectStoreContext.Provider value={createProjectStore(api)}>
            <HomeScreen
              onNewProject={handlers.onNewProject ?? (() => undefined)}
              onOpenProject={handlers.onOpenProject ?? (() => undefined)}
            />
          </ProjectStoreContext.Provider>
        </ApiContext.Provider>
      </RouterProvider>
    </I18nProvider>,
  );
}

afterEach(() => {
  window.location.hash = '';
});

describe('the home screen', () => {
  it('says where you are', () => {
    renderHome([]);
    expect(screen.getByRole('heading', { name: 'Projects', level: 1 })).toBeTruthy();
    expect(screen.getByText('What this session has open.')).toBeTruthy();
  });

  it('asks the shell for the dialogs rather than keeping its own', async () => {
    const user = userEvent.setup();
    const onNewProject = vi.fn();
    const onOpenProject = vi.fn();
    renderHome([], { onNewProject, onOpenProject });

    await user.click(screen.getByRole('button', { name: 'New project' }));
    await user.click(screen.getByRole('button', { name: /Open…/ }));

    // One new-project dialog for the whole window: two screens with their own
    // would be two dialogs to keep in step.
    expect(onNewProject).toHaveBeenCalledTimes(1);
    expect(onOpenProject).toHaveBeenCalledTimes(1);
  });

  it('shows what the session has open, and goes there by address', async () => {
    const user = userEvent.setup();
    renderHome([summary('a', { name: 'Holiday edit' })]);

    const row = await screen.findByRole('button', { name: 'Open Holiday edit' });
    await user.click(row);

    // An address and not a flag: a window that can be deep-linked to a project
    // is a window whose address means something.
    expect(window.location.hash).toBe('#/editor/a');
  });
});
