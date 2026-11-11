// @vitest-environment jsdom
/** The transport: the playhead's six moves, against the two stores it composes.
 *
 *  Everything here is about the two ends of the timeline, because that is what a
 *  component doing its own arithmetic gets wrong:
 *
 *  * **The last frame is `duration − 1`.** A 300-frame project has no frame 300,
 *    and an edit applied there would apply to nothing.
 *  * **Stepping onto the end stops playback.** Arriving is not the same as
 *    playing off the end of the project.
 *  * **Zero is a floor, not a wrap.** Stepping back at frame 0 stays at 0.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import { createPlaybackStore, PlaybackStoreContext } from '../../stores/playback';
import { createTimelineStore, TimelineStoreContext } from '../../stores/timeline';
import type { ApiClient } from '../../core/api/client';
import type { TimelineResponse, TimelineSummary } from '../../core/api/contract';
import { ok } from '../../core/result';
import { useTransport } from './useTransport';

const THIRTY = { num: 30, den: 1 };

function edit(over: Partial<TimelineSummary> = {}): TimelineSummary {
  return {
    timebase: { num: 30, den: 1, fps: 30 },
    tracks: [],
    track_count: 0,
    clip_count: 0,
    duration_frames: 300,
    ...over,
  };
}

function clientWith(durationFrames: number): ApiClient {
  const timeline: TimelineResponse = {
    project_id: 'p1',
    timeline: edit({ duration_frames: durationFrames }),
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
  return {
    run: () => Promise.resolve(ok(timeline)),
    url: () => '',
  } as unknown as ApiClient;
}

async function harness(durationFrames = 300) {
  const client = clientWith(durationFrames);
  const playback = createPlaybackStore();
  const timeline = createTimelineStore(client);

  const wrapper = ({ children }: { readonly children: ReactNode }): React.JSX.Element => (
    <PlaybackStoreContext.Provider value={playback}>
      <TimelineStoreContext.Provider value={timeline}>{children}</TimelineStoreContext.Provider>
    </PlaybackStoreContext.Provider>
  );

  const view = renderHook(() => useTransport(THIRTY), { wrapper });
  await act(async () => {
    await timeline.getState().load('p1');
  });
  return { view, playback, timeline };
}

describe('clamping to the project', () => {
  it('knows how long the project is, and which frame is the last', async () => {
    const { view } = await harness(300);
    expect(view.result.current.durationFrames).toBe(300);
    expect(view.result.current.lastFrame).toBe(299);
  });

  it('will not put the playhead past the last frame', async () => {
    const { view } = await harness(300);
    act(() => {
      view.result.current.seek(9_000);
    });
    expect(view.result.current.frame).toBe(299);
  });

  it('will not put the playhead before the first', async () => {
    const { view } = await harness(300);
    act(() => {
      view.result.current.seek(-40);
    });
    expect(view.result.current.frame).toBe(0);
  });

  it('has no last frame in an empty project, and says so with zero', async () => {
    const { view } = await harness(0);
    expect(view.result.current.lastFrame).toBe(0);
    expect(view.result.current.durationFrames).toBe(0);
  });
});

describe('stepping', () => {
  it('moves a whole frame at a time', async () => {
    const { view } = await harness();
    act(() => {
      view.result.current.step(1);
      view.result.current.step(1);
    });
    expect(view.result.current.frame).toBe(2);
  });

  it('stops at the start rather than wrapping to the end', async () => {
    const { view } = await harness();
    act(() => {
      view.result.current.step(-5);
    });
    expect(view.result.current.frame).toBe(0);
  });

  it('stops playback when it steps onto the last frame', async () => {
    const { view } = await harness();
    act(() => {
      view.result.current.seek(298);
      view.result.current.play();
    });
    expect(view.result.current.playing).toBe(true);

    act(() => {
      view.result.current.step(1);
    });

    expect(view.result.current.frame).toBe(299);
    expect(view.result.current.playing).toBe(false);
  });
});

describe('playing', () => {
  it('plays, pauses and toggles', async () => {
    const { view } = await harness();
    act(() => {
      view.result.current.play();
    });
    expect(view.result.current.playing).toBe(true);
    act(() => {
      view.result.current.togglePlay();
    });
    expect(view.result.current.playing).toBe(false);
    act(() => {
      view.result.current.togglePlay();
    });
    expect(view.result.current.playing).toBe(true);
    act(() => {
      view.result.current.pause();
    });
    expect(view.result.current.playing).toBe(false);
  });

  it('goes to the start and to the last frame', async () => {
    const { view } = await harness();
    act(() => {
      view.result.current.toEnd();
    });
    expect(view.result.current.frame).toBe(299);
    act(() => {
      view.result.current.toStart();
    });
    expect(view.result.current.frame).toBe(0);
  });
});

describe('the zoom', () => {
  it('is fit by default, and holds a number when one is set', async () => {
    const { view } = await harness();
    expect(view.result.current.zoom).toBe('fit');
    act(() => {
      view.result.current.setZoom(2);
    });
    expect(view.result.current.zoom).toBe(2);
  });
});
