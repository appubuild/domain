/** The editor: the panes that exist today, docked.
 *
 *  One pane today, and that is the honest answer rather than a compromise — a
 *  workspace with a "Preview" pane that draws nothing and a "Timeline" pane that
 *  says "coming soon" would be three panes of which two are furniture. Panes
 *  arrive as they are built: the preview and the inspector in slice 6, the
 *  timeline with stage 7, captions with stage 9. Each one is a line in the
 *  registry below and a `leaf` in the tree, and the dock does the rest.
 *
 *  The layout is **state, held here**, and it is the shell's to persist (the
 *  settings store, slice 6). What this component decides is which pane ids are
 *  real: an id the registry does not know is a programming error and says so,
 *  because today the tree is written by us and not by the user.
 */

import { useMemo, useState } from 'react';

import { useI18n } from '../../core/i18n/context';
import { Dock } from '../../ui/Dock';
import { type DockNode, leaf } from '../../ui/dock';
import { MediaBin } from '../media/MediaBin';

export interface WorkspaceProps {
  readonly projectId: string;
}

export function Workspace({ projectId }: WorkspaceProps): React.JSX.Element {
  const { t } = useI18n();
  const [layout, setLayout] = useState<DockNode>(() => leaf('media'));
  const labels = useMemo(() => ({ media: t('media.heading') }), [t]);

  return (
    <Dock
      layout={layout}
      labels={labels}
      onLayoutChange={setLayout}
      className="p-2"
      render={(id) => {
        switch (id) {
          case 'media':
            return <MediaBin projectId={projectId} />;
          default:
            // Thrown rather than rendered as an empty panel: the ids are ours,
            // so an unknown one is a bug, and a bug that draws a blank pane is
            // a bug nobody reports. Storage-driven panes arrive with plugins
            // (stage 10), and with them the validation that makes this a
            // fallback instead.
            throw new Error(`no pane registered for "${id}"`);
        }
      }}
    />
  );
}
