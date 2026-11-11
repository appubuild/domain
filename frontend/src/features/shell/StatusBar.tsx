/** The status bar: is the editor there, and is the work safe?
 *
 *  Two questions, and they are the only two a status bar in an editor has any
 *  business answering:
 *
 *  * **Is the service still talking to us?** A dropped event is not an error the
 *    user can act on, but a stream that has been reconnecting for a minute is,
 *    and showing the number of events the bus dropped is showing the truth
 *    rather than a green dot.
 *  * **Would a crash cost anything?** `dirty` and `pending_commands` are the
 *    project's own answer to that, and they are the reason this bar exists: a
 *    user who thinks their work is saved is one power cut away from losing it.
 *
 *  Both live in `role="status"` regions, because both change while the user is
 *  looking somewhere else — a status bar that updates silently is a status bar
 *  for people who happen to be reading it at the moment it changed.
 *
 *  The health is a **prop** and not a hook: this component is the one place in
 *  the window that is pure presentation of state somebody else owns, which is
 *  what makes it renderable in a test with no socket behind it.
 */

import type { ProjectSummary } from '../../core/api/contract';
import type { StreamHealth, StreamStatus } from '../../core/events/bridge';
import type { AppMessageKey } from '../../core/i18n/bundles';
import { useI18n } from '../../core/i18n/context';

const DOT: Record<StreamStatus, string> = {
  idle: 'bg-ink-faint',
  connecting: 'bg-info',
  live: 'bg-success',
  reconnecting: 'bg-warning',
};

const LABEL: Record<StreamStatus, AppMessageKey> = {
  idle: 'shell.status.idle',
  connecting: 'shell.status.connecting',
  live: 'shell.status.live',
  reconnecting: 'shell.status.reconnecting',
};

export interface StatusBarProps {
  readonly health: StreamHealth;
  /** The project the window is showing, or `null`. */
  readonly project: ProjectSummary | null;
  /** What the service says it is, when it has said. */
  readonly version?: string | null | undefined;
}

export function StatusBar({ health, project, version }: StatusBarProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-surface-1 px-3 text-xs text-ink-dim">
      <span className="flex items-center gap-1.5" role="status">
        <span className={`size-1.5 rounded-full ${DOT[health.status]}`} aria-hidden="true" />
        {t(LABEL[health.status])}
      </span>

      {health.dropped > 0 ? (
        <span role="status">{t('shell.status.dropped', { count: health.dropped })}</span>
      ) : null}

      <span className="ml-auto flex items-center gap-3">
        {project === null ? (
          t('shell.titleBar.noProject')
        ) : (
          <span role="status">
            {project.name}
            {project.dirty ? t('shell.status.unsavedSuffix') : ''}
            {project.dirty && project.pending_commands > 0
              ? t('shell.status.pending', { count: project.pending_commands })
              : ''}
          </span>
        )}
        {version === null || version === undefined ? null : (
          <span className="font-mono text-ink-faint">{version}</span>
        )}
      </span>
    </footer>
  );
}
