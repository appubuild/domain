/** The projects open in this session, and the two things you can do with one.
 *
 *  Deliberately not a file menu yet: **open** needs a native file dialog, which
 *  is the desktop shell's to show, and **save** needs a path the user chose. Both
 *  arrive with the shell (stage 6) and both land here rather than in a new
 *  panel. What is here is what the service can answer without one: what is open,
 *  create, and close.
 *
 *  `role="status"` on the empty and loading lines, and `role="alert"` on the
 *  failure: a screen reader announces the second, and a screen that silently
 *  stayed empty is the failure this panel exists to prevent.
 */

import { useState } from 'react';

import { useI18n } from '../../core/i18n/context';
import { useProjects } from './useProjects';
import type { ProjectSummary } from '../../core/api/contract';

export function ProjectList(): React.JSX.Element {
  const { t } = useI18n();
  const view = useProjects();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function createOne(): Promise<void> {
    const trimmed = name.trim();
    if (trimmed === '' || busy) return;
    setBusy(true);
    try {
      await view.create(trimmed);
      setName('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="w-[32rem] rounded-panel border border-line bg-surface-1 p-6">
      <header className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-ink-dim">
          {t('projects.heading')}
        </h2>
        <button
          type="button"
          className="text-xs text-accent hover:text-ink"
          onClick={() => {
            view.refresh();
          }}
        >
          {t('projects.refresh')}
        </button>
      </header>

      {view.error ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {view.error.code}
        </p>
      ) : null}

      {view.loading && view.projects.length === 0 ? (
        <p className="mt-4 text-sm text-ink-faint" role="status">
          {t('projects.loading')}
        </p>
      ) : null}

      {!view.loading && view.projects.length === 0 ? (
        <p className="mt-4 text-sm text-ink-faint" role="status">
          {t('projects.empty')}
        </p>
      ) : null}

      <ul className="mt-3 divide-y divide-line">
        {view.projects.map((project) => (
          <Row
            key={project.project_id}
            project={project}
            current={project.project_id === view.currentId}
            onSelect={() => {
              view.select(project.project_id);
            }}
            onClose={() => {
              void view.close(project.project_id);
            }}
          />
        ))}
      </ul>

      <form
        className="mt-6 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void createOne();
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-panel border border-line bg-surface-0 px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
          placeholder={t('projects.newPlaceholder')}
          aria-label={t('projects.newLabel')}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <button
          type="submit"
          disabled={busy || name.trim() === ''}
          className="rounded-panel bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          {t('projects.create')}
        </button>
      </form>
    </section>
  );
}

function Row({
  project,
  current,
  onSelect,
  onClose,
}: {
  readonly project: ProjectSummary;
  readonly current: boolean;
  readonly onSelect: () => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <li className="flex items-center gap-3 py-2">
      <button
        type="button"
        onClick={onSelect}
        aria-current={current ? 'true' : undefined}
        className="min-w-0 flex-1 text-left"
      >
        <span className={`block truncate text-sm ${current ? 'text-ink' : 'text-ink-dim'}`}>
          {project.name}
        </span>
        <span className="block truncate font-mono text-xs text-ink-faint">
          {project.path ?? t('projects.neverSaved')}
          {project.dirty ? t('projects.unsavedSuffix') : ''}
          {t('projects.clips', { count: project.clip_count })}
        </span>
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('projects.closeNamed', { name: project.name })}
        className="text-xs text-ink-faint hover:text-danger"
      >
        {t('projects.close')}
      </button>
    </li>
  );
}
