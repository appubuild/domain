// @vitest-environment jsdom
/** The project panel, against a store built on a client double.
 *
 *  What is being pinned is that the panel is a *view*: it renders what the store
 *  holds and calls what the store offers, and every expectation below is written
 *  in terms of what the user sees — a row appearing after a create, a row
 *  disappearing after a close, a failure naming itself by its `NS-*` code.
 *
 *  No service is running and no socket is open, because none is needed: the
 *  store is a parameter, and the parameter here is a double.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { ApiClient } from '../../core/api/client';
import type { ProjectSummary } from '../../core/api/contract';
import type { ApiProblem } from '../../core/api/problem';
import { I18nProvider } from '../../core/i18n/I18nProvider';
import { err, ok } from '../../core/result';
import { createProjectStore, ProjectStoreContext } from '../../stores/project';
import { ProjectList } from './ProjectList';

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

interface Scripted {
  list?: { projects: ProjectSummary[] } | { error: ApiProblem };
  create?: { id: string } | { error: ApiProblem };
  close?: { error: ApiProblem } | null;
}

function client(script: Scripted): ApiClient {
  return {
    run: (id: string, request?: { body?: { name?: string } }) => {
      switch (id) {
        case 'listProjects': {
          const answer = script.list ?? { projects: [] };
          return Promise.resolve(
            'error' in answer ? err(answer.error) : ok({ projects: answer.projects }),
          );
        }
        case 'createProject': {
          const answer = script.create;
          if (!answer) return Promise.resolve(err(problem('NS-TEST-0000')));
          if ('error' in answer) return Promise.resolve(err(answer.error));
          return Promise.resolve(
            ok({ project: summary(answer.id, { name: request?.body?.name ?? answer.id }) }),
          );
        }
        case 'closeProject': {
          const answer = script.close;
          return Promise.resolve(answer && 'error' in answer ? err(answer.error) : ok(undefined));
        }
        default:
          return Promise.resolve(err(problem('NS-TEST-0000')));
      }
    },
    url: () => '',
  } as unknown as ApiClient;
}

function problem(code: string): ApiProblem {
  return { kind: 'api', status: 500, code, detail: code };
}

function renderPanel(script: Scripted, locale = 'en'): void {
  const store = createProjectStore(client(script));
  render(
    <I18nProvider locale={locale}>
      <ProjectStoreContext.Provider value={store}>
        <ProjectList />
      </ProjectStoreContext.Provider>
    </I18nProvider>,
  );
}

describe('the list', () => {
  it('shows what the service says is open', async () => {
    renderPanel({ list: { projects: [summary('a', { name: 'Holiday' })] } });

    await waitFor(() => {
      expect(screen.queryByText('Holiday')).not.toBeNull();
    });
    expect(screen.getByText(/never saved/)).toBeTruthy();
  });

  it('says when there is nothing open, rather than showing nothing', async () => {
    renderPanel({ list: { projects: [] } });

    await waitFor(() => {
      expect(screen.queryByText('No projects open.')).not.toBeNull();
    });
  });

  it('names a failure by its code rather than staying empty', async () => {
    renderPanel({ list: { error: problem('NS-TRANSPORT-5030') } });

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeNull();
    });
    expect(screen.getByRole('alert').textContent).toContain('NS-TRANSPORT-5030');
  });

  it('an unsaved project says so', async () => {
    renderPanel({
      list: { projects: [summary('a', { name: 'Holiday', dirty: true, clip_count: 3 })] },
    });

    await waitFor(() => {
      expect(screen.queryByText(/unsaved/)).not.toBeNull();
    });
    expect(screen.getByText(/3 clips/)).toBeTruthy();
  });
});

describe('creating', () => {
  it('a created project appears in the list', async () => {
    const user = userEvent.setup();
    renderPanel({ list: { projects: [] }, create: { id: 'new' } });

    await waitFor(() => {
      expect(screen.queryByText('No projects open.')).not.toBeNull();
    });
    await user.type(screen.getByLabelText('New project name'), 'Holiday');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(screen.queryByText('Holiday')).not.toBeNull();
    });
    // The field is emptied, because a form that kept its text is a form that
    // gets submitted twice.
    expect(screen.getByLabelText<HTMLInputElement>('New project name').value).toBe('');
  });

  it('an empty name cannot be submitted at all', async () => {
    renderPanel({ list: { projects: [] } });
    await waitFor(() => {
      expect(screen.queryByText('No projects open.')).not.toBeNull();
    });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Create' }).disabled).toBe(true);
  });

  it('a failure is shown where the user is looking', async () => {
    const user = userEvent.setup();
    renderPanel({ list: { projects: [] }, create: { error: problem('NS-PROJECT-4001') } });

    await user.type(screen.getByLabelText('New project name'), 'Holiday');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeNull();
    });
    expect(screen.getByRole('alert').textContent).toContain('NS-PROJECT-4001');
  });
});

describe('closing', () => {
  it('a closed project leaves the list', async () => {
    const user = userEvent.setup();
    renderPanel({ list: { projects: [summary('a', { name: 'Holiday' })] }, close: null });

    await waitFor(() => {
      expect(screen.queryByText('Holiday')).not.toBeNull();
    });
    await user.click(screen.getByRole('button', { name: 'Close Holiday' }));

    await waitFor(() => {
      expect(screen.queryByText('Holiday')).toBeNull();
    });
    expect(screen.getByText('No projects open.')).toBeTruthy();
  });

  it('a close the service refused leaves the row where it is', async () => {
    const user = userEvent.setup();
    renderPanel({
      list: { projects: [summary('a', { name: 'Holiday' })] },
      close: { error: problem('NS-PROJECT-4041') },
    });

    await waitFor(() => {
      expect(screen.queryByText('Holiday')).not.toBeNull();
    });
    await user.click(screen.getByRole('button', { name: 'Close Holiday' }));

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeNull();
    });
    expect(screen.queryByText('Holiday')).not.toBeNull();
  });
});

describe('in another language', () => {
  it('a count is pluralised by that language, not by English', async () => {
    renderPanel({ list: { projects: [summary('a', { name: 'Holiday', clip_count: 1 })] } }, 'bn');

    await waitFor(() => {
      expect(screen.queryByText('Holiday')).not.toBeNull();
    });
    // One clip, and the Bangla bundle's `one` form, not a hardcoded "clips".
    expect(screen.getByText(/1 ক্লিপ/)).toBeTruthy();
  });
});
