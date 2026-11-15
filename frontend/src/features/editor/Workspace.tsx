/** The editor: the panes that exist today, docked.
 *
 *  Four panes, and each one is there because something is behind it: the
 *  **preview** draws the frame the service composites, the **media bin** lists
 *  what has been imported, the **inspector** describes whichever row is
 *  selected, and the **settings** name what the project renders to. Panes
 *  arrive as they are built — the timeline with stage 7, captions with stage 9
 *  — and each one is a line in the registry below and a `leaf` in the tree. The
 *  dock does the rest.
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
 *  * **The edit commands.** `S` splits at the playhead, `Delete` lifts what is
 *    selected, `Ctrl+Z` undoes. They are here for the same reason, and for one
 *    more: an edit is a command posted through the timeline slice, and a pane
 *    that registered its own would be a second place the keys were bound — the
 *    palette would show one, the keyboard would run the other.
 */

import { useEffect, useMemo, useState } from 'react';

import type { Command } from '../../app/commands';
import { type I18n, useI18n } from '../../core/i18n/context';
import { useRegisterCommands } from '../../app/useCommands';
import type { ClipSpec, ClipSummary, MediaAssetSummary, TrackKind } from '../../core/api/contract';
import { secondsToFrames, type Timebase } from '../../core/timecode/timebase';
import { useMediaStoreApi, type MediaStore } from '../../stores/media';
import { usePlaybackStoreApi, type PlaybackStore } from '../../stores/playback';
import { useSettingsStoreApi } from '../../stores/settings';
import { useTimelineStoreApi, type TimelineState, type TimelineStore } from '../../stores/timeline';
import { Dock } from '../../ui/Dock';
import { type DockNode, leaf, split } from '../../ui/dock';
import { Inspector } from '../inspector/Inspector';
import { MediaBin } from '../media/MediaBin';
import { PreviewPane } from '../preview/PreviewPane';
import { useTransportContext } from '../preview/transport-context';
import { SettingsPanel } from '../settings/SettingsPanel';
import { TimelinePanel } from './timeline/TimelinePanel';

export interface WorkspaceProps {
  readonly projectId: string;
}

/** Which panes exist, and what they are called. The dock only knows ids. */
type PaneId = 'preview' | 'timeline' | 'media' | 'inspector' | 'settings';

export function Workspace({ projectId }: WorkspaceProps): React.JSX.Element {
  const { t } = useI18n();
  const media = useMediaStoreApi();
  const timeline = useTimelineStoreApi();
  const playback = usePlaybackStoreApi();
  const settings = useSettingsStoreApi();

  const [layout, setLayout] = useState<DockNode>(() =>
    // Preview above the timeline, the three property surfaces stacked on the
    // right: the picture is what an editor watches, the timeline is what it
    // works in, and a bin, an inspector and a settings panel are things it looks
    // things up in. The timeline is under the picture rather than beside it
    // because an edit is read left to right, and a timeline that was a third of
    // the window wide would be a timeline you cannot see a cut in.
    split(
      'row',
      [
        split('column', [leaf('preview'), leaf('timeline')], [0.62, 0.38]),
        split('column', [leaf('media'), leaf('inspector'), leaf('settings')], [0.4, 0.3, 0.3]),
      ],
      [0.72, 0.28],
    ),
  );

  const labels = useMemo<Record<PaneId, string>>(
    () => ({
      preview: t('preview.heading'),
      timeline: t('timeline.heading'),
      media: t('media.heading'),
      inspector: t('inspector.heading'),
      settings: t('settings.heading'),
    }),
    [t],
  );

  // The panes read stores; this is where the stores are told whose project they
  // are describing. Both are idempotent for the project already held.
  useEffect(() => {
    void media.getState().load(projectId);
    void timeline.getState().load(projectId);
    void settings.getState().load(projectId);
  }, [media, projectId, settings, timeline]);

  // Leaving the editor stops the transport: a playhead that kept moving in a
  // project nobody is looking at would keep asking the service for frames.
  useEffect(
    () => () => {
      playback.getState().pause();
    },
    [playback],
  );

  // The window's transport — the one the provider started, and not a second
  // clock of this screen's own.
  const transport = useTransportContext();

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
      ...editCommands({ t, timeline, playback, media }),
    ],
    [t, transport, timeline, playback, media],
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
          case 'timeline':
            return <TimelinePanel />;
          case 'media':
            return <MediaBin projectId={projectId} />;
          case 'inspector':
            return <Inspector projectId={projectId} />;
          case 'settings':
            return <SettingsPanel projectId={projectId} />;
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

/** The edits a keyboard makes.
 *
 *  Splitting, lifting, undoing and selecting are here rather than in the
 *  timeline pane for the same reason the transport's are: a key belongs to the
 *  window, and a pane that bound its own would be a second place the keyboard
 *  was wired — the palette would show one binding and the pane would run
 *  another.
 *
 *  Each one reads the slice at the moment it is pressed, and posts a command.
 *  Nothing here decides whether an edit is allowed: the service says, and the
 *  timeline shows what it said.
 */
function editCommands({
  t,
  timeline,
  playback,
  media,
}: {
  readonly t: I18n['t'];
  readonly timeline: TimelineStore;
  readonly playback: PlaybackStore;
  readonly media: MediaStore;
}): readonly Command[] {
  const state = (): TimelineState => timeline.getState();

  /** The clip the playhead is inside of, preferring the ones that are selected.
   *
   *  `start < at < end` and not `start <= at <= end`: cutting on a clip's own
   *  edge makes a second clip of zero frames, which is not a clip.
   */
  function underPlayhead(): ClipSummary | null {
    const at = playback.getState().frame;
    const tracks = state().timeline?.tracks ?? [];
    const clips = tracks.flatMap((track) => track.clips);
    const selected = state().selectedClipIds;
    return (
      clips.find(
        (clip) => selected.has(clip.clip_id) && clip.start_frame < at && at < clip.end_frame,
      ) ??
      clips.find((clip) => clip.start_frame < at && at < clip.end_frame) ??
      null
    );
  }

  return [
    {
      id: 'timeline.insert',
      title: t('timeline.commandInsert'),
      hint: t('timeline.commandInsertHint'),
      icon: 'plus',
      run: () => {
        const assetId = media.getState().selectedId;
        if (assetId === null) return;
        const asset = media.getState().assets.find((item) => item.asset_id === assetId);
        if (asset === undefined) return;
        appendAsset({ timeline, asset });
      },
    },
    {
      id: 'timeline.split',
      title: t('timeline.commandSplit'),
      hint: t('timeline.commandSplitHint'),
      shortcut: 'S',
      icon: 'scissors',
      run: () => {
        const clip = underPlayhead();
        if (clip === null) return;
        void state().split({ clipId: clip.clip_id, atFrame: playback.getState().frame });
      },
    },
    {
      id: 'timeline.lift',
      title: t('timeline.commandLift'),
      hint: t('timeline.commandLiftHint'),
      shortcut: 'Delete',
      icon: 'trash',
      run: () => {
        // Lifted one at a time and not as one command: there is no
        // `lift-clips`, and inventing one so a keypress could be a single undo
        // entry would be a command the journal has to know about forever.
        for (const clipId of state().selectedClipIds) void state().lift(clipId);
      },
    },
    {
      id: 'timeline.selectAll',
      title: t('timeline.commandSelectAll'),
      shortcut: 'Ctrl+A',
      run: () => {
        const tracks = state().timeline?.tracks ?? [];
        state().selectMany(tracks.flatMap((track) => track.clips.map((clip) => clip.clip_id)));
      },
    },
    {
      id: 'edit.undo',
      title: t('timeline.commandUndo'),
      hint: t('timeline.commandUndoHint'),
      shortcut: 'Ctrl+Z',
      icon: 'undo',
      run: () => {
        void state().undo();
      },
    },
    {
      id: 'edit.redo',
      title: t('timeline.commandRedo'),
      hint: t('timeline.commandRedoHint'),
      shortcut: 'Ctrl+Shift+Z',
      icon: 'redo',
      run: () => {
        void state().redo();
      },
    },
  ];
}

/** Put an asset on the timeline: at the end of its first video track.
 *
 *  The command that does it is `replace-track-clips`, which is what the union
 *  offers — there is no `insert-clip`, and there is a reason: the only way to
 *  describe "this track now holds these clips" is to name them all, and an
 *  insert that named only the new one would leave the service to guess what
 *  happened to the rest. So the track is read, one clip is appended, and the
 *  whole track is written back. One command, one undo.
 *
 *  The track is created when it is not there yet, which is why an empty
 *  timeline can accept a clip without anyone having made a track first.
 */
function appendAsset({
  timeline,
  asset,
}: {
  readonly timeline: TimelineStore;
  readonly asset: MediaAssetSummary;
}): void {
  const state = timeline.getState();
  const tracks = state.timeline?.tracks ?? [];
  const timebase: Timebase = state.timeline?.timebase ?? { num: 30, den: 1 };
  const kind: TrackKind = asset.kind === 'audio' ? 'audio' : 'video';

  const track = tracks.find((item) => item.kind === kind && !item.locked) ?? null;
  const existing: ClipSpec[] = (track?.clips ?? []).map((clip) => ({
    asset_id: clip.asset_id,
    clip_id: clip.clip_id,
    name: clip.name,
    kind: clip.kind,
    start_frame: clip.start_frame,
    in_frame: clip.in_frame,
    source_frames: clip.out_frame - clip.in_frame,
    enabled: clip.enabled,
  }));

  // Appended, not placed: an asset arrives at the end of the edit, and where it
  // goes after that is a drag — which is what the timeline is for.
  const startFrame = (track?.clips ?? []).reduce((end, clip) => Math.max(end, clip.end_frame), 0);
  const seconds = asset.duration_seconds;
  const sourceFrames = seconds > 0 ? secondsToFrames(seconds, timebase) : 0;

  void state.replaceTrackClips({
    trackId: track?.track_id ?? (kind === 'audio' ? 'a1' : 'v1'),
    kind,
    create: true,
    clips: [
      ...existing,
      {
        asset_id: asset.asset_id,
        name: asset.name,
        kind: asset.kind === 'audio' ? 'audio' : 'video',
        start_frame: startFrame,
        ...(sourceFrames > 0 ? { source_frames: sourceFrames } : {}),
      },
    ],
  });
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
