/** The projects open in this session, and the two things you can do with one.
 *
 *  Deliberately not a file menu yet: **open** needs a native file dialog, which
 *  is the desktop shell's to show, and **save** needs a path the user chose. Both
 *  arrive with the shell (stage 6) and both land here rather than in a new
 *  panel. What is here is what the service can answer without one: what is open,
 *  create, and close.
 *
 *  This is also the first panel built out of the design system rather than out
 *  of `className` strings, which is the point of building `ui/` before the
 *  panels: the raw markup it replaces was a heading, a border and four buttons,
 *  and every one of those four had its own padding, radius and hover state.
 *
 *  `role="status"` on the empty and loading lines, and `role="alert"` on the
 *  failure: a screen reader announces the second, and a screen that silently
 *  stayed empty is the failure this panel exists to prevent.
 */

import { useState } from 'react';

import { useI18n } from '../../core/i18n/context';
import type { ProjectSummary } from '../../core/api/contract';
import { Button } from '../../ui/Button';
import { Panel } from '../../ui/Panel';
import { TextField } from '../../ui/TextField';
import { useProjects } from './useProjects';

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
    <Panel
      title={t('projects.heading')}
      className="w-[32rem]"
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            view.refresh();
          }}
        >
          {t('projects.refresh')}
        </Button>
      }
    >
      {view.error ? (
        <p className="text-sm text-danger" role="alert">
          {view.error.code}
        </p>
      ) : null}

      {view.loading && view.projects.length === 0 ? (
        <p className="text-sm text-ink-faint" role="status">
          {t('projects.loading')}
        </p>
      ) : null}

      {!view.loading && view.projects.length === 0 ? (
        <p className="text-sm text-ink-faint" role="status">
          {t('projects.empty')}
        </p>
      ) : null}

      <ul className="divide-y divide-line">
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
        className="mt-6 flex items-start gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void createOne();
        }}
      >
        {/* The label is hidden because the placeholder says the same thing to a
            sighted user — but it is a label, so the field is still named, and a
            screen reader still says what this box is for. */}
        <TextField
          className="flex-1"
          label={t('projects.newLabel')}
          labelHidden
          placeholder={t('projects.newPlaceholder')}
          value={name}
          onValueChange={setName}
        />
        <Button
          type="submit"
          variant="solid"
          // `busy` rather than `loading`: the spinner belongs to a command that
          // has started, and this one has not while the field is empty.
          disabled={busy || name.trim() === ''}
        >
          {t('projects.create')}
        </Button>
      </form>
    </Panel>
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
        className="min-w-0 flex-1 rounded-control text-left"
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
      <Button
        variant="ghost"
        size="sm"
        onClick={onClose}
        // The visible word is "Close" in a list of rows; the accessible name
        // says which one. `aria-label` wins, and the row keeps reading cleanly.
        aria-label={t('projects.closeNamed', { name: project.name })}
      >
        {t('projects.close')}
      </Button>
    </li>
  );
}
