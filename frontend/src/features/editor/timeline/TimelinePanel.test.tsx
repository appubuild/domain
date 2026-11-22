// @vitest-environment jsdom
/** The timeline panel, against a client double and a measured surface.
 *
 *  What is pinned here is the contract between a drag and an edit, which is the
 *  part of a timeline that is easy to get wrong and impossible to see in a
 *  screenshot:
 *
 *  * **One drag is one command, posted once, on release.** A timeline that
 *    posted a move per pointer event would put a hundred entries in the history
 *    for one gesture, and a hundred round trips on the wire.
 *  * **A click is not a drag.** Three pixels of tremble is not an edit: a clip
 *    that moved a frame because the user's hand shook is the complaint editors
 *    get most.
 *  * **A drag is drawn where the pointer is, before the service has agreed.**
 *    The edit is not written optimistically — the drawing is, and the clip
 *    returns to where it was if the service says no.
 *  * **A refusal is the service's sentence, shown where it happened**, and the
 *    edit it refused is not in the history.
 *
 *  jsdom has no layout, so the surface is measured by stubbing
 *  `getBoundingClientRect`: at 800 pixels wide and a frame a pixel, a clip's left
 *  edge is `GUTTER_WIDTH + frame`, which is the arithmetic every test below is
 *  written in.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { ApiClient } from '../../../core/api/client';
import { ApiContext } from '../../../core/api/context';
import type {
  ApplyCommandBody,
  ClipSummary,
  CommandResponse,
  TimelineResponse,
  TimelineSummary,
  TrackSummary,
} from '../../../core/api/contract';
import { I18nProvider } from '../../../core/i18n/I18nProvider';
import { err, ok } from '../../../core/result';
import { createPlaybackStore, PlaybackStoreContext } from '../../../stores/playback';
import { createTimelineStore, TimelineStoreContext } from '../../../stores/timeline';
import { TransportProvider } from '../../preview/TransportProvider';
import { GUTTER_WIDTH, RULER_HEIGHT, ROW_HEIGHT } from './layout';
import { TimelinePanel } from './TimelinePanel';

const WIDTH = 800;

function clip(clipId: string, start: number, duration: number): ClipSummary {
  return {
    clip_id: clipId,
    asset_id: 'a1',
    kind: 'video',
    name: clipId,
    start_frame: start,
    end_frame: start + duration,
    duration_frames: duration,
    in_frame: 0,
    out_frame: duration,
    speed: 1,
    speed_rational: '1/1',
    frame_interpolation: 'nearest',
    enabled: true,
  };
}

function track(trackId: string, clips: readonly ClipSummary[]): TrackSummary {
  return {
    track_id: trackId,
    kind: 'video',
    name: trackId,
    index: 0,
    muted: false,
    locked: false,
    hidden: false,
    clip_count: clips.length,
    duration_frames: clips.reduce((longest, item) => Math.max(longest, item.end_frame), 0),
    clips: [...clips],
  };
}

function edit(over: Partial<TimelineSummary> = {}): TimelineSummary {
  return {
    timebase: { num: 30, den: 1, fps: 30 },
    tracks: [track('v1', [clip('c1', 100, 60), clip('c2', 200, 60)])],
    track_count: 1,
    clip_count: 2,
    duration_frames: 600,
    ...over,
  };
}

function timelineResponse(timeline: TimelineSummary = edit()): TimelineResponse {
  return {
    project_id: 'p1',
    timeline,
    history: {
      can_undo: false,
      can_redo: false,
      undo_label: '',
      redo_label: '',
      undo_depth: 0,
      redo_depth: 0,
      recent: [],
    },
    journal_sequence: 1,
    pending_commands: 0,
    dirty: false,
  };
}

interface Recorder {
  readonly client: ApiClient;
  readonly commands: () => ApplyCommandBody[];
}

/** A client that answers the read from `timeline` and records every command. */
function clientFor(timeline: TimelineSummary = edit()): Recorder {
  const commands: ApplyCommandBody[] = [];
  const api = {
    run: (id: string, init?: { body?: unknown }) => {
      if (id === 'getTimeline') return Promise.resolve(ok(timelineResponse(timeline)));
      if (id === 'applyCommand') {
        commands.push(init?.body as ApplyCommandBody);
        return Promise.resolve(
          ok({
            project_id: 'p1',
            command_id: 'cmd-1',
            name: 'move-clip',
            summary: 'moved one clip',
            affected: ['c1'],
            invalidate: [],
            rerender: true,
            history: {
              can_undo: true,
              can_redo: false,
              undo_label: 'Undo move clip',
              redo_label: '',
              undo_depth: 1,
              redo_depth: 0,
              recent: [],
            },
            journal_sequence: 2,
            pending_commands: 1,
            dirty: true,
            marks_dirty: true,
          } satisfies CommandResponse),
        );
      }
      return Promise.resolve(err({ kind: 'api', status: 500, code: 'NS-TEST-0000', detail: '' }));
    },
    url: () => '',
  } as unknown as ApiClient;
  return { client: api, commands: () => commands };
}

/** Give the surface a size: without one there is no viewport and nothing is
 *  drawn, which is the behaviour a real pane relies on to ask for nothing. */
function measure(width = WIDTH, height = 420): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  });
}

interface Harness {
  readonly commands: () => ApplyCommandBody[];
  readonly playback: ReturnType<typeof createPlaybackStore>;
  readonly timeline: ReturnType<typeof createTimelineStore>;
}

async function renderPanel(
  timeline: TimelineSummary = edit(),
  refusal?: { code: string; detail: string },
): Promise<Harness> {
  measure();
  const recorder = clientFor(timeline);
  const api = recorder.client;
  if (refusal !== undefined) {
    // The service refuses: a 409 on the command, in the shape the transport
    // hands to the store.
    (
      api as {
        run: (id: string, init?: { body?: unknown }) => unknown;
      }
    ).run = (id: string, init?: { body?: unknown }) => {
      if (id === 'getTimeline') return Promise.resolve(ok(timelineResponse(timeline)));
      if (id === 'applyCommand') {
        recorder.commands().push(init?.body as ApplyCommandBody);
        return Promise.resolve(err({ kind: 'api', status: 409, ...refusal }));
      }
      return Promise.resolve(err({ kind: 'api', status: 500, code: 'NS-TEST-0000', detail: '' }));
    };
  }

  const playback = createPlaybackStore();
  const timelineStore = createTimelineStore(api);

  function Wrapper({ children }: { readonly children: ReactNode }): React.JSX.Element {
    return (
      <I18nProvider>
        <ApiContext.Provider value={api}>
          <TimelineStoreContext.Provider value={timelineStore}>
            <PlaybackStoreContext.Provider value={playback}>
              <TransportProvider>{children}</TransportProvider>
            </PlaybackStoreContext.Provider>
          </TimelineStoreContext.Provider>
        </ApiContext.Provider>
      </I18nProvider>
    );
  }

  render(<TimelinePanel />, { wrapper: Wrapper });
  // In the window it is the workspace that says which project the slice
  // describes; a pane tested alone has to say it itself.
  act(() => {
    void timelineStore.getState().load('p1');
  });
  // Waited for, and not assumed: a pane whose edit has not arrived yet is a
  // pane whose duration is zero, and every number below is measured against a
  // zoom that a zero-length edit fits at the widest rung of the ladder.
  await waitFor(() => {
    expect(timelineStore.getState().status).toBe('ready');
  });
  return { commands: recorder.commands, playback, timeline: timelineStore };
}

function clipBlock(clipId: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-clip-id="${clipId}"]`);
  if (element === null) throw new Error(`no clip ${clipId} on the timeline`);
  return element;
}

function surface(): HTMLElement {
  return screen.getByTestId('timeline-surface');
}

/** A frame, as the pixel a pointer would be at. */
function at(frame: number): number {
  return GUTTER_WIDTH + frame;
}

function rowCentre(index: number): number {
  return RULER_HEIGHT + index * ROW_HEIGHT + 20;
}

function drag(
  element: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(surface(), { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(surface(), { pointerId: 1, clientX: to.x, clientY: to.y });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('drawing the edit', () => {
  it('draws a clip where the edit says it is', async () => {
    await renderPanel();

    await waitFor(() => {
      expect(clipBlock('c1')).toBeTruthy();
    });
    // At one pixel a frame and no scroll, frame 100 is GUTTER_WIDTH + 100.
    expect(clipBlock('c1').style.left).toBe(`${at(100)}px`);
    expect(clipBlock('c1').style.width).toBe('60px');
  });

  it('says when there is nothing to draw', async () => {
    await renderPanel(edit({ tracks: [], track_count: 0, clip_count: 0 }));

    expect(await screen.findByTestId('timeline-empty')).toBeTruthy();
    expect(screen.getByTestId('timeline-empty').textContent).toContain('empty');
  });

  it('names a clip for a reader, with where it is', async () => {
    await renderPanel();

    await waitFor(() => {
      expect(clipBlock('c1')).toBeTruthy();
    });
    const label = clipBlock('c1').getAttribute('aria-label') ?? '';
    expect(label).toContain('c1');
    expect(label).toContain('00:00:03:10');
  });

  it('puts the playhead where the transport says it is', async () => {
    const { playback } = await renderPanel();

    act(() => {
      playback.getState().seek(150);
    });

    await waitFor(() => {
      expect(screen.getByTestId('timeline-playhead').style.left).toBe(`${at(150)}px`);
    });
  });
});

describe('a drag', () => {
  it('is one command, posted on release, and not one per pointer event', async () => {
    const { commands } = await renderPanel();
    await waitFor(() => {
      expect(clipBlock('c1')).toBeTruthy();
    });

    const element = clipBlock('c1');
    fireEvent.pointerDown(element, {
      button: 0,
      pointerId: 1,
      clientX: at(100),
      clientY: rowCentre(0),
    });
    for (const frame of [110, 120, 130, 140]) {
      fireEvent.pointerMove(surface(), { pointerId: 1, clientX: at(frame), clientY: rowCentre(0) });
    }
    expect(commands()).toHaveLength(0);

    fireEvent.pointerUp(surface(), { pointerId: 1, clientX: at(140), clientY: rowCentre(0) });

    const sent = commands();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'move-clip', clip_id: 'c1', to_start_frame: 140 });
  });

  it('moves by how far the pointer went, not to where it is', async () => {
    // Grabbed ten frames in, dropped forty frames along: the clip moves forty,
    // not fifty. A drag that teleported the clip's start to the pointer is a
    // drag that moved it by its own length whenever it was grabbed near its end.
    const { commands } = await renderPanel();
    await waitFor(() => {
      expect(clipBlock('c1')).toBeTruthy();
    });

    drag(clipBlock('c1'), { x: at(110), y: rowCentre(0) }, { x: at(150), y: rowCentre(0) });

    expect(commands()[0]).toMatchObject({ to_start_frame: 140 });
  });

  it('carries one gesture id, so the whole drag undoes as one', async () => {
    const { commands } = await renderPanel();
    await waitFor(() => {
      expect(clipBlock('c1')).toBeTruthy();
    });

    drag(clipBlock('c1'), { x: at(100), y: rowCentre(0) }, { x: at(140), y: rowCentre(0) });

    const gesture = (commands()[0] as { gesture?: string }).gesture ?? '';
    expect(gesture.length).toBeGreaterThan(0);
  });

  it('is drawn where the pointer is, before the service has agreed', async () => {
    const { commands } = await renderPanel();
    await waitFor(() => {
      expect(clipBlock('c1')).toBeTruthy();
    });

    fireEvent.pointerDown(clipBlock('c1'), {
      button: 0,
      pointerId: 1,
      clientX: at(100),
      clientY: rowCentre(0),
    });
    fireEvent.pointerMove(surface(), { pointerId: 1, clientX: at(140), clientY: rowCentre(0) });

    // The drawing has moved; the edit has not been asked to.
    expect(clipBlock('c1').style.left).toBe(`${at(140)}px`);
    expect(clipBlock('c1').getAttribute('data-dragging')).toBe('true');
    expect(commands()).toHaveLength(0);

    fireEvent.pointerUp(surface(), { pointerId: 1, clientX: at(140), clientY: rowCentre(0) });
  });

  it('snaps to a neighbour, and says where it snapped', async () => {
    const { commands } = await renderPanel();
    await waitFor(() => {
      expect(clipBlock('c1')).toBeTruthy();
    });

    fireEvent.pointerDown(clipBlock('c1'), {
      button: 0,
      pointerId: 1,
      clientX: at(100),
      clientY: rowCentre(0),
    });
    // Three frames short of the next clip's start, which is inside the snap
    // window at one pixel a frame.
    fireEvent.pointerMove(surface(), { pointerId: 1, clientX: at(197), clientY: rowCentre(0) });

    expect(clipBlock('c1').style.left).toBe(`${at(200)}px`);
    expect(screen.getByTestId('timeline-snap-guide').style.left).toBe(`${at(200)}px`);

    fireEvent.pointerUp(surface(), { pointerId: 1, clientX: at(197), clientY: rowCentre(0) });
    expect(commands()[0]).toMatchObject({ to_start_frame: 200 });
  });

  it('does not snap when snapping is off', async () => {
    const { commands } = await renderPanel();
    await waitFor(() => {
      expect(clipBlock('c1')).toBeTruthy();
    });

    act(() => {
      fireEvent.click(screen.getByLabelText('Snap'));
    });

    drag(clipBlock('c1'), { x: at(100), y: rowCentre(0) }, { x: at(197), y: rowCentre(0) });

    expect(commands()[0]).toMatchObject({ to_start_frame: 197 });
  });

  it('does not snap a clip to itself', async () => {
    // Its own edges are not targets: a clip that snapped to where it already was
    // could not be moved by less than its own length.
    const { commands } = await renderPanel();
    await waitFor(() => {
      expect(clipBlock('c1')).toBeTruthy();
    });

    drag(clipBlock('c1'), { x: at(100), y: rowCentre(0) }, { x: at(104), y: rowCentre(0) });

    expect(commands()[0]).toMatchObject({ to_start_frame: 104 });
  });

  it('names the track it was dropped on, and only when it changed', async () => {
    const { commands } = await renderPanel(
      edit({ tracks: [track('v1', [clip('c1', 100, 60)]), track('v2', [])] }),
    );
    await waitFor(() => {
      expect(clipBlock('c1')).toBeTruthy();
    });

    fireEvent.pointerDown(clipBlock('c1'), {
      button: 0,
      pointerId: 1,
      clientX: at(100),
      clientY: rowCentre(0),
    });
    fireEvent.pointerMove(surface(), { pointerId: 1, clientX: at(140), clientY: rowCentre(1) });
    fireEvent.pointerUp(surface(), { pointerId: 1, clientX: at(140), clientY: rowCentre(1) });

    expect(commands()[0]).toMatchObject({ to_start_frame: 140, to_track_id: 'v2' });
  });
});

describe('a click', () => {
  it('selects and does not edit', async () => {
    const { commands, timeline } = await renderPanel();
    await waitFor(() => {
      expect(clipBlock('c1')).toBeTruthy();
    });

    fireEvent.pointerDown(clipBlock('c1'), {
      button: 0,
      pointerId: 1,
      clientX: at(110),
      clientY: rowCentre(0),
    });
    fireEvent.pointerUp(surface(), { pointerId: 1, clientX: at(110), clientY: rowCentre(0) });

    expect(commands()).toHaveLength(0);
    expect([...timeline.getState().selectedClipIds]).toEqual(['c1']);
    expect(clipBlock('c1').getAttribute('aria-pressed')).toBe('true');
  });

  it('selects on the press, so the Delete that follows it has a subject', async () => {
    // A user who grabs a clip to drag it has already decided they are working on
    // it: a selection that arrived only after they let go would be too late for
    // the key they press next.
    const { commands, timeline } = await renderPanel();
    await waitFor(() => {
      expect(clipBlock('c1')).toBeTruthy();
    });

    fireEvent.pointerDown(clipBlock('c2'), {
      button: 0,
      pointerId: 1,
      clientX: at(210),
      clientY: rowCentre(0),
    });
    fireEvent.pointerMove(surface(), { pointerId: 1, clientX: at(260), clientY: rowCentre(0) });
    fireEvent.pointerUp(surface(), { pointerId: 1, clientX: at(260), clientY: rowCentre(0) });

    expect([...timeline.getState().selectedClipIds]).toEqual(['c2']);
    expect(commands()).toHaveLength(1);
  });

  it('keeps the whole selection when one of it is dragged', async () => {
    const { timeline } = await renderPanel();
    await waitFor(() => {
      expect(clipBlock('c1')).toBeTruthy();
    });
    act(() => {
      timeline.getState().selectMany(['c1', 'c2']);
    });

    fireEvent.pointerDown(clipBlock('c1'), {
      button: 0,
      pointerId: 1,
      clientX: at(110),
      clientY: rowCentre(0),
    });

    expect([...timeline.getState().selectedClipIds].sort()).toEqual(['c1', 'c2']);
  });

  it('survives three pixels of tremble', async () => {
    // A hand is not a mouse and a trackpad is not a table: a press that moved
    // two pixels is a press, not a one-frame edit.
    const { commands } = await renderPanel();
    await waitFor(() => {
      expect(clipBlock('c1')).toBeTruthy();
    });

    drag(clipBlock('c1'), { x: at(110), y: rowCentre(0) }, { x: at(112), y: rowCentre(0) });

    expect(commands()).toHaveLength(0);
  });

  it('takes the selection away when the press was on nothing', async () => {
    const { timeline } = await renderPanel();
    await waitFor(() => {
      expect(clipBlock('c1')).toBeTruthy();
    });
    act(() => {
      timeline.getState().select('c1');
    });

    const lane = screen.getAllByTestId('timeline-lane')[0] as HTMLElement;
    fireEvent.pointerDown(lane, {
      button: 0,
      pointerId: 1,
      clientX: at(500),
      clientY: rowCentre(0),
    });
    fireEvent.pointerUp(surface(), { pointerId: 1, clientX: at(500), clientY: rowCentre(0) });

    expect(timeline.getState().selectedClipIds.size).toBe(0);
  });
});

describe('trimming', () => {
  it('moves the end the pointer grabbed, and not the other one', async () => {
    const { commands } = await renderPanel();
    await waitFor(() => {
      expect(clipBlock('c1')).toBeTruthy();
    });

    const end = clipBlock('c1').querySelector<HTMLElement>('[data-clip-edge="end"]');
    expect(end).not.toBeNull();
    drag(end as HTMLElement, { x: at(160), y: rowCentre(0) }, { x: at(130), y: rowCentre(0) });

    expect(commands()[0]).toMatchObject({
      type: 'trim-clip',
      clip_id: 'c1',
      edge: 'end',
      to_frame: 130,
    });
  });

  it('trims the start, and redraws the clip as it goes', async () => {
    const { commands } = await renderPanel();
    await waitFor(() => {
      expect(clipBlock('c1')).toBeTruthy();
    });

    const start = clipBlock('c1').querySelector<HTMLElement>('[data-clip-edge="start"]');
    fireEvent.pointerDown(start as HTMLElement, {
      button: 0,
      pointerId: 1,
      clientX: at(100),
      clientY: rowCentre(0),
    });
    fireEvent.pointerMove(surface(), { pointerId: 1, clientX: at(120), clientY: rowCentre(0) });

    // The start has moved to 120 and the end has not: the rectangle is 40 wide.
    expect(clipBlock('c1').style.left).toBe(`${at(120)}px`);
    expect(clipBlock('c1').style.width).toBe('40px');

    fireEvent.pointerUp(surface(), { pointerId: 1, clientX: at(120), clientY: rowCentre(0) });
    expect(commands()[0]).toMatchObject({ edge: 'start', to_frame: 120 });
  });
});

describe('scrubbing', () => {
  it('puts the playhead where the ruler was pressed', async () => {
    const { playback } = await renderPanel();

    const ruler = screen.getByTestId('timeline-ruler');
    fireEvent.pointerDown(ruler, { button: 0, pointerId: 1, clientX: at(240), clientY: 4 });

    expect(playback.getState().frame).toBe(240);
  });

  it('keeps scrubbing while the pointer moves', async () => {
    const { playback } = await renderPanel();

    const ruler = screen.getByTestId('timeline-ruler');
    fireEvent.pointerDown(ruler, { button: 0, pointerId: 1, clientX: at(240), clientY: 4 });
    fireEvent.pointerMove(surface(), { pointerId: 1, clientX: at(300), clientY: 4 });
    fireEvent.pointerUp(surface(), { pointerId: 1, clientX: at(300), clientY: 4 });

    expect(playback.getState().frame).toBe(300);
  });
});

describe('the zoom', () => {
  it('makes the content wider than the viewport, which is what the scrollbar is for', async () => {
    await renderPanel();
    const bar = screen.getByTestId('timeline-scrollbar');
    // Fitted: the whole edit is on screen, so there is nothing to scroll.
    expect(bar.getAttribute('aria-valuemax')).toBe('0');

    act(() => {
      fireEvent.click(screen.getByLabelText('Zoom in'));
    });

    expect(
      Number(screen.getByTestId('timeline-scrollbar').getAttribute('aria-valuemax')),
    ).toBeGreaterThan(0);
  });

  it('makes the edit smaller when it goes out, and stops at the bottom rung', async () => {
    await renderPanel();
    await waitFor(() => {
      expect(clipBlock('c1')).toBeTruthy();
    });
    const fitted = clipBlock('c1').style.width;

    act(() => {
      fireEvent.click(screen.getByLabelText('Zoom out'));
    });

    // Half the pixels per frame is half the clip: zooming out must not move the
    // edit, only shrink how much of it a pixel is worth.
    const drawn = Number.parseFloat(clipBlock('c1').style.width);
    expect(drawn).toBeLessThan(Number.parseFloat(fitted));
    // The clip starts where it started: 100 frames in, at whatever a frame is
    // worth now. Zooming changes the scale, not the edit.
    expect(clipBlock('c1').style.left).toBe(`${GUTTER_WIDTH + 100 * (drawn / 60)}px`);

    // And it walks the ladder down to the bottom rather than off the end.
    for (let i = 0; i < 40; i += 1) {
      const button = screen.getByLabelText('Zoom out');
      if (button.getAttribute('disabled') !== null) break;
      act(() => {
        fireEvent.click(button);
      });
    }
    expect(screen.getByLabelText('Zoom out').getAttribute('disabled')).not.toBeNull();
  });

  it('scrolls in time when the wheel turns', async () => {
    await renderPanel();
    // Two separate gestures: two clicks in one batch would both be handled by
    // the same render, and the second would compute its step from a zoom the
    // first had not applied yet.
    act(() => {
      fireEvent.click(screen.getByLabelText('Zoom in'));
    });
    act(() => {
      fireEvent.click(screen.getByLabelText('Zoom in'));
    });

    const before = screen.getByTestId('timeline-scrollbar').getAttribute('aria-valuenow');
    act(() => {
      fireEvent.wheel(surface(), { deltaY: 100 });
    });
    expect(before).toBe('0');

    expect(screen.getByTestId('timeline-scrollbar').getAttribute('aria-valuenow')).not.toBe(before);
  });

  it('is not dragged back by a playhead the user scrolled away from', async () => {
    // Following is not fighting: an editor that snapped the viewport back to the
    // playhead on every scroll is an editor you cannot scroll.
    const { playback } = await renderPanel();
    await waitFor(() => {
      expect(clipBlock('c1')).toBeTruthy();
    });
    // Zoomed in first: fitted, the whole edit is on screen and there is nothing
    // to scroll, so nothing to be dragged back from.
    for (let i = 0; i < 3; i += 1) {
      act(() => {
        fireEvent.click(screen.getByLabelText('Zoom in'));
      });
    }
    act(() => {
      playback.getState().seek(300);
    });
    await waitFor(() => {
      expect(screen.getByTestId('timeline-scrollbar').getAttribute('aria-valuenow')).not.toBe('0');
    });

    const scrolled = screen.getByTestId('timeline-scrollbar').getAttribute('aria-valuenow');
    act(() => {
      fireEvent.wheel(surface(), { deltaY: 200 });
    });

    expect(screen.getByTestId('timeline-scrollbar').getAttribute('aria-valuenow')).not.toBe(
      scrolled,
    );
  });

  it('zooms instead of scrolling when the wheel is held with ctrl', async () => {
    await renderPanel();
    const before = screen.getByTestId('timeline-scrollbar').getAttribute('aria-valuemax');

    act(() => {
      fireEvent.wheel(surface(), { deltaY: -100, ctrlKey: true });
    });

    expect(screen.getByTestId('timeline-scrollbar').getAttribute('aria-valuemax')).not.toBe(before);
  });
});

describe('when the service refuses', () => {
  it('says the service’s own sentence, and keeps the edit it drew', async () => {
    await renderPanel(edit(), {
      code: 'NS-COMMAND-4104',
      detail: 'clip c1 would overlap c2',
    });
    await waitFor(() => {
      expect(clipBlock('c1')).toBeTruthy();
    });

    drag(clipBlock('c1'), { x: at(100), y: rowCentre(0) }, { x: at(140), y: rowCentre(0) });

    await waitFor(() => {
      expect(screen.getByTestId('timeline-status').textContent).toContain(
        'clip c1 would overlap c2',
      );
    });
    // The clip is back where the edit says it is, because it never went
    // anywhere: the drag was a drawing, not an edit.
    await waitFor(() => {
      expect(clipBlock('c1').style.left).toBe(`${at(100)}px`);
    });
  });
});
