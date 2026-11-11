/** The editor: the panes that exist today, docked.
 *
 *  Three panes, and each one is there because something is behind it: the
 *  **preview** draws the frame the service composites, the **media bin** lists
 *  what has been imported, and the **inspector** describes whichever row is
 *  selected. Panes arrive as they are built — the timeline with stage 7,
 *  captions with stage 9 — and each one is a line in the registry below and a
 *  `leaf` in the tree. The dock does the rest.
 *
 *  What this component owns:
 *
 *  * **The layout**, as state. It is the shell's to persist (the settings store,
 *    when there is one); here it is held so a splitter drag survives a render.
 *  * **Which pane ids are real.** An id the registry does not know is a
 *    programming error and says so, because today the tree is written by us and
 *    not by the user.
 *  * **Loading the project it was handed.** The panes read stores; something has
 *    to tell the stores which project they are describing, and it is the screen
 *    that knows.
 *  * **The transport commands.** Space plays; the arrows step a frame. They are
 *    registered here and not in the shell because they mean something only while
 *    a project is being edited, and a global `Space` on the home screen would
 *    scroll instead.
 */

import { useEffect, useMemo, useState } from 'react';

import { useI18n } from '../../core/i18n/context';
import type { Command } from '../../app/commands';
import { useRegisterCommands } from '../../app/useCommands';
import { useMediaStoreApi } from '../../stores/media';
import { usePlaybackStoreApi } from '../../stores/playback';
import { useTimebase, useTimelineStoreApi } from '../../stores/timeline';
import { Dock } from '../../ui/Dock';
import { type DockNode, leaf, split } from '../../ui/dock';
import { Inspector } from '../inspector/Inspector';
import { MediaBin } from '../media/MediaBin';
import { PreviewPane } from '../preview/PreviewPane';
import { useTransport } from '../preview/useTransport';

export interface WorkspaceProps {
  readonly projectId: string;
}

/** Which panes exist, and what they are called. The dock only knows ids. */
type PaneId = 'preview' | 'media' | 'inspector';

export function Workspace({ projectId }: WorkspaceProps): React.JSX.Element {
  const { t } = useI18n();
  const media = useMediaStoreApi();
  const timeline = useTimelineStoreApi();
  const playback = usePlaybackStoreApi();
  const timebase = useTimebase();

  const [layout, setLayout] = useState<DockNode>(() =>
    // Preview wide, the two lists stacked on the right: the picture is the thing
    // an editor looks at, and a bin and an inspector are things it looks things
    // up in.
    split(
      'row',
      [leaf('preview'), split('column', [leaf('media'), leaf('inspector')])],
      [0.7, 0.3],
    ),
  );

  const labels = useMemo<Record<PaneId, string>>(
    () => ({
      preview: t('preview.heading'),
      media: t('media.heading'),
      inspector: t('inspector.heading'),
    }),
    [t],
  );

  // The panes read stores; this is where the stores are told whose project they
  // are describing. Both are idempotent for the project already held.
  useEffect(() => {
    void media.getState().load(projectId);
    void timeline.getState().load(projectId);
  }, [media, projectId, timeline]);

  // Leaving the editor stops the transport: a playhead that kept moving in a
  // project nobody is looking at would keep asking the service for frames.
  useEffect(
    () => () => {
      playback.getState().pause();
    },
    [playback],
  );

  const transport = useTransport(timebase);

  const commands = useMemo<readonly Command[]>(
    () => [
      {
        id: 'playback.toggle',
        title: transport.playing ? t('preview.pause') : t('preview.play'),
        hint: t('preview.playHint'),
        shortcut: 'Space',
        icon: transport.playing ? 'pause' : 'play',
        run: transport.togglePlay,
      },
      {
        id: 'playback.stepBack',
        title: t('preview.stepBack'),
        shortcut: 'Left',
        icon: 'chevron-left',
        run: () => {
          transport.step(-1);
        },
      },
      {
        id: 'playback.stepForward',
        title: t('preview.stepForward'),
        shortcut: 'Right',
        icon: 'chevron-right',
        run: () => {
          transport.step(1);
        },
      },
      {
        id: 'playback.toStart',
        title: t('preview.toStart'),
        shortcut: 'Home',
        icon: 'chevron-first',
        run: transport.toStart,
      },
      {
        id: 'playback.toEnd',
        title: t('preview.toEnd'),
        shortcut: 'End',
        icon: 'chevron-last',
        run: transport.toEnd,
      },
      {
        id: 'playback.zoomIn',
        title: t('preview.zoomIn'),
        shortcut: 'Ctrl+Equal',
        run: () => {
          transport.setZoom(nextZoom(transport.zoom, 1));
        },
      },
      {
        id: 'playback.zoomOut',
        title: t('preview.zoomOut'),
        shortcut: 'Ctrl+Minus',
        run: () => {
          transport.setZoom(nextZoom(transport.zoom, -1));
        },
      },
    ],
    [t, transport],
  );
  useRegisterCommands(commands);

  return (
    <Dock
      layout={layout}
      labels={labels}
      onLayoutChange={setLayout}
      className="p-2"
      render={(id) => {
        switch (id) {
          case 'preview':
            return <PreviewPane projectId={projectId} />;
          case 'media':
            return <MediaBin projectId={projectId} />;
          case 'inspector':
            return <Inspector projectId={projectId} />;
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

const ZOOM_STEPS: readonly number[] = [0.25, 0.5, 1, 2, 4];

/** One step along the zoom ladder, staying on it.
 *
 *  Zoom is a ladder and not a multiplier, because `1.37 ×` is not a thing a
 *  user can ask for again: the numbers have to be the ones the menu shows, or
 *  Ctrl+= and the menu would disagree about where the user is. */
function nextZoom(current: number | 'fit', direction: 1 | -1): number | 'fit' {
  const from = current === 'fit' ? 1 : current;
  const index = ZOOM_STEPS.indexOf(from);
  if (index === -1) {
    // Not on the ladder (a zoom from a saved layout): step to the nearest rung
    // in the direction asked for rather than snapping, which would move it
    // backwards when the user asked for forwards.
    const above = ZOOM_STEPS.findIndex((step) => step > from);
    const target = direction === 1 ? above : above - 1;
    return ZOOM_STEPS[Math.min(Math.max(target, 0), ZOOM_STEPS.length - 1)] ?? from;
  }
  const next = ZOOM_STEPS[Math.min(Math.max(index + direction, 0), ZOOM_STEPS.length - 1)];
  return next ?? from;
}
