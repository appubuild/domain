/** The home screen: where a session starts.
 *
 *  One screen, three things on it: what is already open, how to make a new
 *  project, and how to open one that exists. That is the whole of what a
 *  project manager is before there are templates, recent files or a cloud —
 *  and those, when they arrive, are cards above the same list rather than a
 *  second screen.
 *
 *  What it owns is the layout. The list is `ProjectList`; opening a file is the
 *  shell's dialog, because two screens with their own file dialog would be two
 *  dialogs to keep in step; and going into a project is the router's, because a
 *  window that can be deep-linked to a project is a window whose address means
 *  something.
 */

import { useRouter } from '../../app/router-context';
import { useI18n } from '../../core/i18n/context';
import { Button } from '../../ui/Button';
import { cx, type ClassValue } from '../../ui/cx';
import { ProjectList } from '../projects/ProjectList';

export interface HomeScreenProps {
  /** Ask the shell to show its open dialog. */
  readonly onOpenProject: () => void;
  /** Ask the shell to show its new-project dialog. */
  readonly onNewProject: () => void;
  readonly className?: ClassValue;
}

export function HomeScreen({
  onOpenProject,
  onNewProject,
  className,
}: HomeScreenProps): React.JSX.Element {
  const { t } = useI18n();
  const { navigate } = useRouter();

  return (
    <div className={cx('flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6', className)}>
      <div className="mx-auto flex w-full max-w-2xl items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">{t('home.heading')}</h1>
          <p className="mt-1 text-sm text-ink-dim">{t('home.subtitle')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button onClick={onNewProject} icon="plus">
            {t('home.newProject')}
          </Button>
          <Button variant="ghost" onClick={onOpenProject} icon="folder">
            {t('home.openProject')}
          </Button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl">
        <ProjectList
          onOpen={(projectId) => {
            navigate({ name: 'editor', projectId });
          }}
        />
      </div>
    </div>
  );
}
