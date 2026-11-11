/** The shell: the window, and the only place its pieces are put together.
 *
 *  What is composed here is everything a panel is allowed to assume exists — the
 *  title bar, the status bar, the route, the command palette and the two file
 *  dialogs — and what is *decided* here is what a command does. Panels
 *  register commands of their own and the shell's are the ones that belong to
 *  the window: create, open, save, close, change the theme, find a command.
 *
 *  Four rules hold it together:
 *
 *  * **A route that does not make sense is the home screen.** An address naming
 *    a project this session does not have — a bookmark, a reload, a project
 *    closed in another window — is not an error to show, it is a place to go.
 *  * **Every answer is reported.** A save that failed silently is a save the
 *    user believes happened, so each command's result becomes a toast: a success
 *    that expires, and a failure that stays until it is dismissed.
 *  * **Commands are the only way to do anything twice.** Save is one command with
 *    a shortcut, a palette entry and (later) a menu item; three copies of it
 *    would be three copies that disagree about when saving is allowed.
 *  * **The dialogs are here, not in the screens.** One new-project dialog for the
 *    whole window, opened by a button on the home screen or by `Ctrl+N`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Command } from '../../app/commands';
import { useCommandShortcuts, useCommands, useRegisterCommands } from '../../app/useCommands';
import { useRouter } from '../../app/router-context';
import { HOME } from '../../app/routes';
import type { OpenProjectResponse, ProjectSummary } from '../../core/api/contract';
import type { ApiProblem } from '../../core/api/problem';
import { useI18n } from '../../core/i18n/context';
import type { Result } from '../../core/result';
import { useStreamHealth } from '../../core/events/useEventStream';
import { useTheme } from '../../core/theme/context';
import { useProjectStore, useProjectStoreApi } from '../../stores/project';
import { useToastQueue } from '../../ui/toast-context';
import { HomeScreen } from '../home/HomeScreen';
import { Workspace } from '../editor/Workspace';
import { CommandPalette } from './CommandPalette';
import { NewProjectDialog, OpenProjectDialog } from './ProjectDialogs';
import { StatusBar } from './StatusBar';
import { TitleBar } from './TitleBar';

/** Which file dialog is open, if any. */
type Dialog = 'new' | 'open' | null;

export interface ShellProps {
  /** Who the service said it is, shown in the status bar. `null` when the
   *  window has not heard from it yet. */
  readonly version?: string | null | undefined;
}

export function Shell({ version }: ShellProps = {}): React.JSX.Element {
  const { t } = useI18n();
  const { route, navigate } = useRouter();
  const store = useProjectStoreApi();
  const projects = useProjectStore((state) => state.projects);
  const currentId = useProjectStore((state) => state.currentId);
  const status = useProjectStore((state) => state.status);
  const health = useStreamHealth();
  const toasts = useToastQueue();
  const { theme, themes, setThemeById } = useTheme();

  const [palette, setPalette] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);

  const current: ProjectSummary | null =
    projects.find((project) => project.project_id === currentId) ?? null;

  // A route that names a project this session does not have is the home screen:
  // a bookmark, or a project someone closed while this window was looking
  // elsewhere.
  //
  // Watched **until the store has answered at least once**, and not before: at
  // boot the list of open projects has not arrived yet, and a window that
  // bounced you out of `#/editor/a` while it was still asking is a window that
  // forgets where you were every time you open it.
  useEffect(() => {
    if (status !== 'ready') return;
    if (
      route.name === 'editor' &&
      !projects.some((project) => project.project_id === route.projectId)
    ) {
      navigate(HOME);
    }
  }, [navigate, projects, route, status]);

  const fail = useCallback(
    (problem: ApiProblem) => {
      toasts.push({ kind: 'danger', message: t('shell.toast.failed', { code: problem.code }) });
    },
    [t, toasts],
  );

  /** Say what happened. One place, because a command that forgot to report is
   *  the bug where the user discovers an hour later that nothing was saved. */
  const report = useCallback(
    (result: Result<unknown, ApiProblem>, message: string) => {
      if (result.ok) toasts.push({ kind: 'success', message });
      else fail(result.error);
    },
    [fail, toasts],
  );

  function openProject(projectId: string): void {
    store.getState().select(projectId);
    navigate({ name: 'editor', projectId });
  }

  const commands = useMemo<readonly Command[]>(() => {
    const found: ProjectSummary | null =
      currentId === null
        ? null
        : (store.getState().projects.find((project) => project.project_id === currentId) ?? null);

    return [
      {
        id: 'app.palette',
        title: t('shell.commands.palette'),
        hint: t('shell.commands.paletteHint'),
        shortcut: 'Ctrl+Shift+P',
        icon: 'search',
        run: () => {
          setPalette(true);
        },
      },
      {
        id: 'view.home',
        title: t('shell.commands.home'),
        hint: t('shell.commands.homeHint'),
        icon: 'grip',
        run: () => {
          navigate(HOME);
        },
      },
      {
        id: 'project.new',
        title: t('shell.commands.newProject'),
        // The standard shortcuts, because this is a desktop application: the
        // browser's own Ctrl+N is not there to steal in a window without tabs.
        shortcut: 'Ctrl+N',
        icon: 'plus',
        run: () => {
          setDialog('new');
        },
      },
      {
        id: 'project.open',
        title: t('shell.commands.openProject'),
        shortcut: 'Ctrl+O',
        icon: 'folder',
        run: () => {
          setDialog('open');
        },
      },
      {
        id: 'project.refresh',
        title: t('shell.commands.refresh'),
        hint: t('shell.commands.refreshHint'),
        icon: 'redo',
        run: () => {
          void store
            .getState()
            .refresh()
            .then((result) => {
              report(result, t('shell.toast.refreshed'));
            });
        },
      },
      {
        id: 'project.save',
        title: t('shell.commands.save'),
        shortcut: 'Ctrl+S',
        icon: 'download',
        disabled: found === null,
        run: () => {
          if (found === null) return;
          void store
            .getState()
            .save(found.project_id)
            .then((result) => {
              report(result, t('shell.toast.saved', { name: found.name }));
            });
        },
      },
      {
        id: 'project.close',
        title: t('shell.commands.closeProject'),
        icon: 'close',
        disabled: found === null,
        run: () => {
          if (found === null) return;
          void store
            .getState()
            .close(found.project_id)
            .then((result) => {
              if (result.ok) {
                toasts.push({
                  kind: 'info',
                  message: t('shell.toast.closed', { name: found.name }),
                });
                navigate(HOME);
                return;
              }
              fail(result.error);
            });
        },
      },
      {
        id: 'view.theme',
        title: t('shell.commands.nextTheme'),
        hint: t('shell.commands.nextThemeHint'),
        shortcut: 'Ctrl+Alt+T',
        icon: 'sparkles',
        run: () => {
          const at = themes.findIndex((candidate) => candidate.id === theme.id);
          const next = themes[(at + 1) % Math.max(1, themes.length)];
          if (next !== undefined) setThemeById(next.id);
        },
      },
    ];
  }, [currentId, fail, navigate, report, setThemeById, store, t, theme.id, themes, toasts]);

  useRegisterCommands(commands);
  // Every command, including the ones a panel registered: one listener for the
  // window, and one place to look when a key does something unexpected.
  const all = useCommands();
  useCommandShortcuts(all);

  async function createProject(name: string): Promise<void> {
    const result = await store.getState().create(name);
    if (result.ok) {
      toasts.push({ kind: 'success', message: t('shell.toast.created', { name }) });
      setDialog(null);
      openProject(result.value);
      return;
    }
    fail(result.error);
  }

  async function openFile(path: string): Promise<void> {
    const result = await store.getState().open(path);
    if (!result.ok) {
      fail(result.error);
      return;
    }
    const opened: OpenProjectResponse = result.value;
    const warnings = opened.warnings ?? [];
    setDialog(null);
    openProject(opened.project.project_id);
    // Warnings are not a failure (ADR-0015): the project opened, and what is
    // wrong with it is a sentence the user is entitled to read.
    if (warnings.length > 0) {
      toasts.push({
        kind: 'warning',
        message: t('shell.toast.openedWithWarnings', { count: warnings.length }),
      });
      return;
    }
    toasts.push({
      kind: 'success',
      message: t('shell.toast.opened', { name: opened.project.name }),
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TitleBar
        projectName={current?.name ?? null}
        projectDirty={current?.dirty ?? false}
        onOpenPalette={() => {
          setPalette(true);
        }}
      />

      <main className="flex min-h-0 flex-1 flex-col">
        {route.name === 'editor' ? (
          <Workspace projectId={route.projectId} />
        ) : (
          <HomeScreen
            onNewProject={() => {
              setDialog('new');
            }}
            onOpenProject={() => {
              setDialog('open');
            }}
          />
        )}
      </main>

      <StatusBar health={health} project={current} version={version} />

      <CommandPalette
        open={palette}
        commands={all}
        onClose={() => {
          setPalette(false);
        }}
      />

      <NewProjectDialog
        open={dialog === 'new'}
        onSubmit={(name) => {
          void createProject(name);
        }}
        onClose={() => {
          setDialog(null);
        }}
      />

      <OpenProjectDialog
        open={dialog === 'open'}
        onSubmit={(path) => {
          void openFile(path);
        }}
        onClose={() => {
          setDialog(null);
        }}
      />
    </div>
  );
}
