/** The timeline: the pane the whole editor is arranged around.
 *
 *  What it owns is the **view of the edit** and nothing else: the zoom, the
 *  scroll, which clips are selected, and the drag in progress. The edit itself
 *  lives in the service, is read through the timeline store, and is changed by
 *  commands — a pane that held its own copy of the edit would need a merge
 *  algorithm, and a merge algorithm is where editors go to die.
 *
 *  Five decisions are the shape of it:
 *
 *  * **A drag is view state until it is dropped.** The moving clip is drawn from
 *    `drag`, and one command is posted on release. Nothing is written
 *    optimistically, so there is nothing to reconcile: a refused drop is a clip
 *    that returns to where it was, because that is the only place it was.
 *  * **Snapping is the window's.** Its threshold is measured in pixels and the
 *    service does not know the zoom, so the window decides where a drag *means*
 *    and the service decides whether it is allowed.
 *  * **One coordinate system.** The gutter is drawn over the content rather
 *    than beside it, so a row is one number everything agrees on; a pane that
 *    laid the heads out in a second column would have two ideas of where row
 *    three is.
 *  * **Only what is on screen is rendered.** A feature-length edit holds
 *    thousands of clips, and a lane that laid them all out would spend its first
 *    second doing nothing the user can see.
 *  * **One transform per axis.** The content is moved by two translations, not
 *    by a position per clip: a scroll then costs the browser one composited
 *    layer instead of a layout pass over the whole edit.
 *
 *  Errors are shown where they happened. A refused edit is not a dialog: it is
 *  the service's own sentence, in the status line beside the scrollbar, and the
 *  clip stays where it was.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ClipSummary, TrackSummary } from '../../../core/api/contract';
import { type I18n, useI18n } from '../../../core/i18n/context';
import { formatTimecode } from '../../../core/timecode/timecode';
import {
  useCommandsInFlight,
  useIsClipSelected,
  useLastCommand,
  useRefusal,
  useTimebase,
  useTimelineSelection,
  useTimelineStore,
  useTimelineStoreApi,
} from '../../../stores/timeline';
import { IconButton } from '../../../ui/IconButton';
import { Panel } from '../../../ui/Panel';
import { Switch } from '../../../ui/Switch';
import { Tooltip } from '../../../ui/Tooltip';
import { useTransportContext } from '../../preview/transport-context';
import { TimelineClip } from './TimelineClip';
import { TimelineRuler } from './TimelineRuler';
import { TimelineScrollbar } from './TimelineScrollbar';
import {
  GUTTER_WIDTH,
  RULER_HEIGHT,
  ROW_HEIGHT,
  TRACK_HEIGHT,
  contentOffsetX,
  contentWidth,
  contentX,
  frameToX,
  maxScrollFrames,
  trackTop,
  visibleRange,
  type TimelineLayout,
} from './layout';
import { chooseTickInterval, rulerTicks } from './ruler';
import {
  useTimelineGestures,
  type TimelineDrag,
  type TimelineGestures,
} from './useTimelineGestures';
import { useTimelineViewport } from './useTimelineViewport';

export interface TimelinePanelProps {
  /** Shown instead of "the edit is empty" while the first read is in flight —
   *  "empty" and "not yet asked" are different sentences. */
  readonly loading?: boolean;
  readonly className?: string;
}

export function TimelinePanel({
  loading = false,
  className,
}: TimelinePanelProps): React.JSX.Element {
  const { t } = useI18n();
  const timebase = useTimebase();
  const store = useTimelineStoreApi();
  const tracks = useTimelineStore((state) => state.timeline?.tracks ?? NO_TRACKS);
  const selection = useTimelineSelection();
  const refusal = useRefusal();
  const lastCommand = useLastCommand();
  const inFlight = useCommandsInFlight();

  // The window's transport, not a second clock: this pane follows the playhead
  // and does not keep one of its own.
  const transport = useTransportContext();
  const viewport = useTimelineViewport({ trackCount: tracks.length });
  const { layout } = viewport;

  const [snapEnabled, setSnapEnabled] = useState(true);
  const [follow, setFollow] = useState(true);

  const ticks = useMemo(() => {
    const { firstFrame, lastFrame } = visibleRange(layout);
    return rulerTicks(firstFrame, lastFrame, chooseTickInterval(layout.pxPerFrame, timebase));
  }, [layout, timebase]);

  // Following the playhead is an effect and not part of the seek: a seek that
  // scrolled would be a seek that moved the edit under the user's hands.
  //
  // It also fires *only when the playhead moves* — or when following is switched
  // on — and never because the pane re-rendered for some other reason. That
  // distinction is the whole difference between following and fighting: an
  // effect that ran on every render would put the viewport back where the
  // playhead is on every scroll, and a user who scrolled away to look at
  // something else would be dragged straight back to it.
  const followed = useRef({ frame: transport.frame, follow });
  useEffect(() => {
    const previous = followed.current;
    followed.current = { frame: transport.frame, follow };
    if (!follow) return;
    const switchedOn = !previous.follow;
    const moved = transport.frame !== previous.frame;
    if (moved || switchedOn) viewport.revealFrame(transport.frame);
  }, [follow, transport.frame, viewport]);

  const onMove = useCallback(
    (request: { clipId: string; toStartFrame: number; toTrackId?: string; gesture: string }) => {
      void store.getState().move(request);
    },
    [store],
  );

  const onTrim = useCallback(
    (request: { clipId: string; edge: 'start' | 'end'; toFrame: number; gesture: string }) => {
      void store.getState().trim(request);
    },
    [store],
  );

  const onSelect = useCallback(
    (clipId: string, additive: boolean) => {
      store.getState().select(clipId, additive ? 'toggle' : 'replace');
    },
    [store],
  );

  const onPress = useCallback(
    (clipId: string, additive: boolean) => {
      // Selecting on the press, and only when it is not already selected: a
      // press on a selected clip is the beginning of a drag of the whole
      // selection, and re-selecting it here would drop the others.
      if (selection.ids.has(clipId)) return;
      store.getState().select(clipId, additive ? 'add' : 'replace');
    },
    [selection, store],
  );

  const onClearSelection = useCallback(() => {
    store.getState().clearSelection();
  }, [store]);

  const gestures = useTimelineGestures({
    layout,
    tracks,
    scrollTop: viewport.scrollTop,
    snapEnabled,
    playhead: transport.frame,
    seek: transport.seek,
    onMove,
    onTrim,
    onSelect,
    onPress,
    onClearSelection,
  });

  // The surface is measured by the viewport's ref *and* kept for the wheel:
  // one element, two reasons to hold it, and a ref callback that does both — a
  // second ref on the same element would silently win by being applied last.
  const surface = useRef<HTMLDivElement | null>(null);
  const { ref: measureSurface } = viewport;
  const setSurface = useCallback(
    (element: HTMLDivElement | null) => {
      surface.current = element;
      measureSurface(element);
    },
    [measureSurface],
  );

  // The wheel is bound by hand with `{ passive: false }`, because a wheel over
  // the timeline is never a request to scroll the page, and React's own wheel
  // listener is passive: without `preventDefault` a zoom gesture bounces the
  // whole window.
  const latest = useRef({ layout, viewport });
  latest.current = { layout, viewport };
  useEffect(() => {
    const element = surface.current;
    if (element === null) return;
    function onWheel(event: WheelEvent): void {
      event.preventDefault();
      const { layout: at, viewport: view } = latest.current;
      const x = event.clientX - (element?.getBoundingClientRect().left ?? 0);
      if (event.ctrlKey || event.metaKey) {
        // Anchored on the pointer: a zoom that re-centred the edit would have
        // the user hunting for the frame they were cutting.
        const anchor = at.scrollFrames + x / at.pxPerFrame;
        if (event.deltaY < 0) view.zoomIn(anchor);
        else view.zoomOut(anchor);
        return;
      }
      if (event.shiftKey) {
        view.scrollByPixels(event.deltaY);
        return;
      }
      // A trackpad's horizontal wheel and a mouse's vertical one both mean the
      // same thing here: move in time.
      const horizontal = event.deltaX !== 0 ? event.deltaX : event.deltaY;
      view.scrollByFrames(horizontal / at.pxPerFrame);
    }
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', onWheel);
    };
  }, []);

  const empty = tracks.length === 0;

  return (
    <Panel
      title={t('timeline.heading')}
      headingLevel={2}
      scroll={false}
      className={className}
      actions={
        <div className="flex items-center gap-2">
          <Switch
            checked={snapEnabled}
            onCheckedChange={setSnapEnabled}
            label={t('timeline.snap')}
            hint={t('timeline.snapHint')}
          />
          <Switch
            checked={follow}
            onCheckedChange={setFollow}
            label={t('timeline.follow')}
            hint={t('timeline.followHint')}
          />
          <Tooltip content={t('timeline.zoomOut')}>
            <IconButton
              icon="minus"
              label={t('timeline.zoomOut')}
              size="sm"
              disabled={!viewport.canZoomOut}
              onClick={() => {
                viewport.zoomOut(transport.frame);
              }}
            />
          </Tooltip>
          <Tooltip content={t('timeline.zoomIn')}>
            <IconButton
              icon="plus"
              label={t('timeline.zoomIn')}
              size="sm"
              disabled={!viewport.canZoomIn}
              onClick={() => {
                viewport.zoomIn(transport.frame);
              }}
            />
          </Tooltip>
          <Tooltip content={t('timeline.zoomFit')}>
            <IconButton
              icon="film"
              label={t('timeline.zoomFit')}
              size="sm"
              onClick={viewport.fit}
            />
          </Tooltip>
        </div>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-1">
        <div className="relative min-h-0 flex-1">
          <div
            ref={setSurface}
            data-testid="timeline-surface"
            className="absolute inset-0 touch-none overflow-hidden"
            onPointerMove={gestures.onPointerMove}
            onPointerUp={gestures.onPointerUp}
            onPointerCancel={gestures.onPointerCancel}
          >
            <TimelineRuler
              layout={layout}
              ticks={ticks}
              timebase={timebase}
              onPointerDown={gestures.onRulerPointerDown}
            />

            {/* The lanes: clipped below the ruler and moved by two translations.
                The layer is lifted by the ruler's height so that everything
                inside it is drawn in **content** coordinates — the same numbers
                `rowAt` and `hitTest` answer with. */}
            <div
              className="absolute inset-x-0 bottom-0 overflow-hidden"
              style={{ top: RULER_HEIGHT }}
            >
              <div
                data-testid="timeline-lanes"
                className="absolute left-0"
                style={{
                  top: -RULER_HEIGHT,
                  width: contentWidth(layout),
                  transform: `translate(${contentOffsetX(layout)}px, ${-viewport.scrollTop}px)`,
                }}
              >
                {tracks.map((track, index) => (
                  <TrackLane
                    key={track.track_id}
                    track={track}
                    index={index}
                    layout={layout}
                    timebase={timebase}
                    drag={gestures.drag}
                    gestures={gestures}
                  />
                ))}
              </div>
            </div>

            <Playhead
              layout={layout}
              frame={transport.frame}
              timebase={timebase}
              label={t('timeline.playhead')}
            />

            {gestures.snapFrame === null ? null : (
              <div
                data-testid="timeline-snap-guide"
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 w-px bg-warning"
                style={{ left: frameToX(layout, gestures.snapFrame) }}
              />
            )}

            {/* The gutter, last and therefore on top: content that scrolls
                under it is hidden by it, and a row is one number. */}
            <div
              className="absolute inset-y-0 left-0 z-10 border-r border-line bg-surface-1"
              style={{ width: GUTTER_WIDTH }}
            >
              <div className="border-b border-line" style={{ height: RULER_HEIGHT }} />
              <div
                className="absolute inset-x-0 bottom-0 overflow-hidden"
                style={{ top: RULER_HEIGHT }}
              >
                <div style={{ transform: `translateY(${-viewport.scrollTop}px)` }}>
                  {tracks.map((track, index) => (
                    <TrackHead
                      key={track.track_id}
                      track={track}
                      index={index}
                      clipLabel={t('timeline.clipCount', { count: track.clip_count })}
                      lockedLabel={t('timeline.locked')}
                    />
                  ))}
                </div>
              </div>
            </div>

            {empty ? (
              <p
                data-testid="timeline-empty"
                className="pointer-events-none absolute inset-x-0 px-4 text-center text-xs text-ink-faint"
                style={{ top: RULER_HEIGHT + 20 }}
              >
                {loading ? t('timeline.loading') : t('timeline.empty')}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2 px-1">
          <TimelineScrollbar
            scrollFrames={layout.scrollFrames}
            maxScrollFrames={maxScrollFrames(layout)}
            visibleFrames={Math.max(1, layout.width / layout.pxPerFrame)}
            onChange={viewport.scrollToFrame}
            label={t('timeline.scroll')}
            className="flex-1"
          />
          <span
            className="shrink-0 font-mono text-[10px] tabular-nums text-ink-faint"
            data-testid="timeline-status"
          >
            {statusText({
              t,
              refusal,
              lastCommand,
              inFlight,
              selectionCount: selection.count,
              frame: transport.frame,
              timebase,
            })}
          </span>
        </div>
      </div>
    </Panel>
  );
}

// -- the parts ---------------------------------------------------------------

const NO_TRACKS: readonly TrackSummary[] = [];

function Playhead({
  layout,
  frame,
  timebase,
  label,
}: {
  readonly layout: TimelineLayout;
  readonly frame: number;
  readonly timebase: Parameters<typeof formatTimecode>[1];
  readonly label: string;
}): React.JSX.Element {
  return (
    <div
      data-testid="timeline-playhead"
      aria-label={label}
      className="pointer-events-none absolute inset-y-0 z-20 w-px bg-accent"
      style={{ left: frameToX(layout, frame) }}
    >
      <span className="absolute -left-[3px] top-0 h-[7px] w-[7px] rounded-[1px] bg-accent" />
      <span className="sr-only">{formatTimecode(frame, timebase)}</span>
    </div>
  );
}

function TrackHead({
  track,
  index,
  clipLabel,
  lockedLabel,
}: {
  readonly track: TrackSummary;
  readonly index: number;
  readonly clipLabel: string;
  readonly lockedLabel: string;
}): React.JSX.Element {
  return (
    <div
      className="absolute inset-x-0 flex flex-col justify-center gap-0.5 border-b border-line px-2"
      style={{ top: index * ROW_HEIGHT, height: TRACK_HEIGHT }}
    >
      <span className="truncate text-[11px] font-medium leading-none">
        {track.name === '' ? `V${index + 1}` : track.name}
      </span>
      <span className="truncate font-mono text-[10px] leading-none text-ink-faint">
        {track.locked ? lockedLabel : clipLabel}
      </span>
    </div>
  );
}

function TrackLane({
  track,
  index,
  layout,
  timebase,
  drag,
  gestures,
}: {
  readonly track: TrackSummary;
  readonly index: number;
  readonly layout: TimelineLayout;
  readonly timebase: Parameters<typeof formatTimecode>[1];
  readonly drag: TimelineDrag | null;
  readonly gestures: TimelineGestures;
}): React.JSX.Element {
  const { firstFrame, lastFrame } = visibleRange(layout);

  // Only what is on screen: a feature-length edit holds thousands of clips, and
  // a lane that laid them all out would spend its first second doing nothing
  // the user can see.
  const shown = track.clips.filter(
    (clip) => clip.end_frame >= firstFrame && clip.start_frame <= lastFrame,
  );

  return (
    <div
      data-testid="timeline-lane"
      data-track-id={track.track_id}
      className="absolute left-0 border-b border-line bg-surface-2/30"
      style={{ top: trackTop(index), height: ROW_HEIGHT, width: contentWidth(layout) }}
      onPointerDown={(event) => {
        // A press on the lane and not on a clip: there is nothing to select, so
        // the selection goes away. Anything a clip handled never gets here —
        // the clip's own handler is on the clip.
        if (event.target === event.currentTarget) gestures.onEmptyPointerDown(event);
      }}
    >
      {shown.map((clip) => (
        <ClipInLane
          key={clip.clip_id}
          clip={clip}
          index={index}
          layout={layout}
          timebase={timebase}
          drag={drag}
          locked={track.locked}
          gestures={gestures}
        />
      ))}
    </div>
  );
}

function ClipInLane({
  clip,
  index,
  layout,
  timebase,
  drag,
  locked,
  gestures,
}: {
  readonly clip: ClipSummary;
  readonly index: number;
  readonly layout: TimelineLayout;
  readonly timebase: Parameters<typeof formatTimecode>[1];
  readonly drag: TimelineDrag | null;
  readonly locked: boolean;
  readonly gestures: TimelineGestures;
}): React.JSX.Element {
  const { t } = useI18n();
  const selected = useIsClipSelected(clip.clip_id);

  // Where it is drawn: its own place in the edit, unless this is the clip being
  // dragged — in which case it is drawn where the drag has got to. The edit has
  // not changed; only the drawing has.
  const moving =
    drag !== null && drag.kind === 'move' && drag.clip.clip_id === clip.clip_id ? drag : null;
  const trimming =
    drag !== null && drag.kind === 'trim' && drag.clip.clip_id === clip.clip_id ? drag : null;

  const startFrame = moving?.startFrame ?? clip.start_frame;
  const row = moving?.trackIndex ?? index;

  // A trim redraws the clip too, or the user would be trimming a rectangle that
  // has not moved: the end they are dragging follows their hand, and the other
  // one stays put.
  const firstFrame = trimming?.edge === 'start' ? trimming.toFrame : startFrame;
  const lastFrame = trimming?.edge === 'end' ? trimming.toFrame : startFrame + clip.duration_frames;
  const width = Math.max((lastFrame - firstFrame) * layout.pxPerFrame, 2);

  const label = t('timeline.clipLabel', {
    name: clip.name,
    start: formatTimecode(firstFrame, timebase),
    end: formatTimecode(lastFrame, timebase),
  });

  return (
    <TimelineClip
      clip={clip}
      rect={{ x: contentX(layout, firstFrame), y: trackTop(row), width, height: TRACK_HEIGHT }}
      label={label}
      selected={selected}
      dragging={moving !== null || trimming !== null}
      locked={locked}
      timebase={timebase}
      onPointerDown={(event) => {
        gestures.onClipPointerDown(event, clip, index);
      }}
      onTrimStart={(event) => {
        gestures.onEdgePointerDown(event, clip, 'start');
      }}
      onTrimEnd={(event) => {
        gestures.onEdgePointerDown(event, clip, 'end');
      }}
    />
  );
}

/** The status line: one sentence about the last thing that happened.
 *
 *  A refusal outranks everything, because an edit that was refused is the thing
 *  the user is waiting to hear about; a landed edit outranks the selection,
 *  because it is more recent. Every branch that has the service's own words uses
 *  them: a window that re-worded a refusal is a window that guessed why.
 */
function statusText({
  t,
  refusal,
  lastCommand,
  inFlight,
  selectionCount,
  frame,
  timebase,
}: {
  readonly t: I18n['t'];
  readonly refusal: ReturnType<typeof useRefusal>;
  readonly lastCommand: ReturnType<typeof useLastCommand>;
  readonly inFlight: number;
  readonly selectionCount: number;
  readonly frame: number;
  readonly timebase: Parameters<typeof formatTimecode>[1];
}): string {
  if (refusal !== null) return t('timeline.refused', { detail: refusal.detail });
  if (inFlight > 0) return t('timeline.editing');
  if (lastCommand !== null) return lastCommand.summary;
  if (selectionCount > 0) return t('timeline.selected', { count: selectionCount });
  return formatTimecode(frame, timebase);
}
