/** The media bin: everything imported into this project.
 *
 *  Virtualised, because a bin is the one list in an editor that grows without
 *  limit — four hundred clips from a shoot is a normal Tuesday, and four
 *  hundred rows in the DOM is a panel that stutters when you scroll it.
 *
 *  What it says about a file is what the service decided: its name, its kind,
 *  how long it is, and whether the path still resolves. That last one is the
 *  reason this panel exists in the form it does — a bin that showed twelve
 *  thumbnails when two of the files have been moved is a bin that lets someone
 *  start an edit they cannot finish.
 */

import { useState } from 'react';

import { useI18n } from '../../core/i18n/context';
import { cx } from '../../ui/cx';
import { useToastQueue } from '../../ui/toast-context';
import { Button } from '../../ui/Button';
import { Panel } from '../../ui/Panel';
import { TextField } from '../../ui/TextField';
import { VirtualList } from '../../ui/VirtualList';
import { formatDuration } from './duration';
import { useMedia } from './useMedia';

const ROW_HEIGHT = 44;

export interface MediaBinProps {
  readonly projectId: string;
}

export function MediaBin({ projectId }: MediaBinProps): React.JSX.Element {
  const { t } = useI18n();
  const view = useMedia(projectId);
  const toasts = useToastQueue();
  const [path, setPath] = useState('');

  async function importPath(): Promise<void> {
    const trimmed = path.trim();
    if (trimmed === '') return;
    const result = await view.importPaths([trimmed]);
    if (result.ok) {
      const { assets, duplicates, failures } = result.value;
      if (failures.length > 0) {
        // Danger, not success: something the user asked for did not happen, and
        // a green tick over a failed import is the worst kind of lie.
        toasts.push({
          kind: 'danger',
          message: t('media.toast.importFailed', { path: failures[0]?.path ?? trimmed }),
        });
        return;
      }
      if (duplicates.length > 0) {
        toasts.push({ kind: 'warning', message: t('media.toast.duplicate', { name: trimmed }) });
        return;
      }
      toasts.push({
        kind: 'success',
        message: t('media.toast.imported', { count: assets.length }),
      });
    } else {
      toasts.push({ kind: 'danger', message: t('media.toast.importFailed', { path: trimmed }) });
    }
    setPath('');
  }

  return (
    <Panel
      title={t('media.heading')}
      className="h-full"
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            view.refresh();
          }}
        >
          {t('media.refresh')}
        </Button>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-3">
        <form
          className="flex items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void importPath();
          }}
        >
          {/* A path, typed, because there is no file dialog yet: the native one
              is the desktop shell's to show (stage 11) and a browser's file
              input hands back a `File` rather than a path the service can
              probe. */}
          <TextField
            className="flex-1 font-mono"
            label={t('media.pathLabel')}
            labelHidden
            placeholder={t('media.pathPlaceholder')}
            value={path}
            onValueChange={setPath}
          />
          <Button
            type="submit"
            variant="solid"
            loading={view.importing}
            disabled={path.trim() === ''}
          >
            {t('media.import')}
          </Button>
        </form>

        {view.error ? (
          <p className="text-sm text-danger" role="alert">
            {view.error.code}
          </p>
        ) : null}

        {view.status === 'loading' && view.assets.length === 0 ? (
          <p className="text-sm text-ink-faint" role="status">
            {t('media.loading')}
          </p>
        ) : null}

        {view.status !== 'loading' && view.assets.length === 0 && view.error === null ? (
          <p className="text-sm text-ink-faint" role="status">
            {t('media.empty')}
          </p>
        ) : null}

        {view.assets.length === 0 ? null : (
          <VirtualList
            label={t('media.heading')}
            count={view.assets.length}
            itemSize={ROW_HEIGHT}
            overscan={3}
            className="min-h-0 flex-1"
          >
            {(index) => {
              const asset = view.assets[index];
              if (asset === undefined) return null;
              const selected = asset.asset_id === view.selectedId;
              return (
                // A button, so the row is reachable and activatable without the
                // list owning a roving tabindex: the bin is virtualised, so the
                // only rows in the tab order are the ones on screen. `aria-pressed`
                // is what says which one the inspector is describing.
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    view.select(selected ? null : asset.asset_id);
                  }}
                  className={cx(
                    'flex h-full w-full items-center gap-3 rounded-control px-2 text-left',
                    'transition-colors duration-[var(--duration-fast)] ease-out',
                    selected ? 'bg-surface-2' : 'hover:bg-surface-2/60',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{asset.name}</span>
                    <span className="block truncate font-mono text-xs text-ink-faint">
                      {asset.path}
                    </span>
                  </span>
                  {/* Not a red row: a file that moved is a thing to fix, and a
                      bin painted red is a bin you cannot read. */}
                  {asset.linked ? null : (
                    <span className="shrink-0 text-xs text-warning">{t('media.missing')}</span>
                  )}
                  <span className="shrink-0 font-mono text-xs text-ink-dim">
                    {formatDuration(asset.duration_seconds)}
                  </span>
                  <span className="shrink-0 text-xs uppercase text-ink-faint">{asset.kind}</span>
                </button>
              );
            }}
          </VirtualList>
        )}

        {view.missing > 0 ? (
          <p className="text-xs text-ink-faint">
            {t('media.missingCount', { count: view.missing })}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
