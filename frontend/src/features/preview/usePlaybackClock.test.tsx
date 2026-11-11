// @vitest-environment jsdom
/** The playback clock.
 *
 *  What is pinned is that the playhead is **measured in frames against a wall
 *  clock** and not counted by a timer that ticks once per frame. A timer at
 *  `1000 / fps` milliseconds is wrong by a frame every few seconds at 30, and by
 *  a frame a second at 29.97 — and the whole reason a rate is a fraction is that
 *  those fractions add up to a shipped project that is late.
 *
 *  The second thing is the end: a clock that ran past the last frame would be
 *  putting the playhead on a frame that does not exist.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePlaybackClock } from './usePlaybackClock';

const THIRTY = { num: 30, den: 1 };
const NTSC = { num: 30_000, den: 1_001 };

function harness(over: Partial<Parameters<typeof usePlaybackClock>[0]> = {}) {
  const frames: number[] = [];
  let ended = 0;
  const view = renderHook(() => {
    usePlaybackClock({
      playing: true,
      timebase: THIRTY,
      fromFrame: 0,
      durationFrames: 300,
      rate: 1,
      loop: false,
      onFrame: (frame) => {
        frames.push(frame);
      },
      onEnded: () => {
        ended += 1;
      },
      ...over,
    });
  });
  return { frames, ended: () => ended, view };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a clock that is running', () => {
  it('does not move while the transport is paused', async () => {
    const { frames } = harness({ playing: false });
    await act(async () => {
      // One animation frame: `advanceTimersToNextFrame` runs the callbacks
      // queued for the next frame, which is the whole loop being tested.
      vi.advanceTimersToNextFrame();
      await Promise.resolve();
    });
    expect(frames).toEqual([]);
  });

  it('puts the playhead where the wall clock says it is', async () => {
    let now = 0;
    const { frames } = harness({ now: () => now });

    await act(async () => {
      // One animation frame: `advanceTimersToNextFrame` runs the callbacks
      // queued for the next frame, which is the whole loop being tested.
      vi.advanceTimersToNextFrame();
      await Promise.resolve();
    });
    now = 1_000;
    await act(async () => {
      // One animation frame: `advanceTimersToNextFrame` runs the callbacks
      // queued for the next frame, which is the whole loop being tested.
      vi.advanceTimersToNextFrame();
      await Promise.resolve();
    });

    // One second at 30fps is frame 30 — not frame 29, which is what a timer
    // that ticked every 33ms would have counted.
    expect(frames.at(-1)).toBe(30);
  });

  it('counts from the frame playback started on, not from zero', async () => {
    let now = 0;
    const { frames } = harness({ fromFrame: 120, now: () => now });

    now = 1_000;
    await act(async () => {
      // One animation frame: `advanceTimersToNextFrame` runs the callbacks
      // queued for the next frame, which is the whole loop being tested.
      vi.advanceTimersToNextFrame();
      await Promise.resolve();
    });

    expect(frames.at(-1)).toBe(150);
  });

  it('runs at the rate it was given', async () => {
    let now = 0;
    const { frames } = harness({ rate: 2, now: () => now });

    now = 1_000;
    await act(async () => {
      // One animation frame: `advanceTimersToNextFrame` runs the callbacks
      // queued for the next frame, which is the whole loop being tested.
      vi.advanceTimersToNextFrame();
      await Promise.resolve();
    });

    expect(frames.at(-1)).toBe(60);
  });

  it('measures a fractional rate with the fraction, not with a rounded 29.97', async () => {
    let now = 0;
    const { frames } = harness({ timebase: NTSC, durationFrames: 100_000, now: () => now });

    now = 10_000;
    await act(async () => {
      // One animation frame: `advanceTimersToNextFrame` runs the callbacks
      // queued for the next frame, which is the whole loop being tested.
      vi.advanceTimersToNextFrame();
      await Promise.resolve();
    });

    // Ten seconds at 30000/1001 is 299.7 frames. Rounded to 29.97 it would have
    // been 299.7 too — but at an hour the two are 3.6 seconds apart, which is
    // the drift this module exists to prevent.
    expect(frames.at(-1)).toBe(299);
  });
});

describe('arriving at the end', () => {
  it('stops on the last frame and says it has arrived', async () => {
    let now = 0;
    const { frames, ended } = harness({ durationFrames: 300, now: () => now });

    now = 60_000;
    await act(async () => {
      // One animation frame: `advanceTimersToNextFrame` runs the callbacks
      // queued for the next frame, which is the whole loop being tested.
      vi.advanceTimersToNextFrame();
      await Promise.resolve();
    });

    expect(frames.at(-1)).toBe(299);
    expect(ended()).toBe(1);
  });

  it('does not say it has arrived twice', async () => {
    let now = 0;
    const { ended } = harness({ durationFrames: 300, now: () => now });

    now = 60_000;
    await act(async () => {
      // One animation frame: `advanceTimersToNextFrame` runs the callbacks
      // queued for the next frame, which is the whole loop being tested.
      vi.advanceTimersToNextFrame();
      await Promise.resolve();
    });
    await act(async () => {
      // One animation frame: `advanceTimersToNextFrame` runs the callbacks
      // queued for the next frame, which is the whole loop being tested.
      vi.advanceTimersToNextFrame();
      await Promise.resolve();
    });

    expect(ended()).toBe(1);
  });

  it('goes back to the start instead, when looping', async () => {
    let now = 0;
    const { frames, ended } = harness({ durationFrames: 300, loop: true, now: () => now });

    now = 10_000; // 300 frames, exactly one lap
    await act(async () => {
      // One animation frame: `advanceTimersToNextFrame` runs the callbacks
      // queued for the next frame, which is the whole loop being tested.
      vi.advanceTimersToNextFrame();
      await Promise.resolve();
    });

    expect(frames.at(-1)).toBe(0);
    expect(ended()).toBe(0);
  });

  it('stops asking for frames once it has arrived', async () => {
    let now = 0;
    const { frames } = harness({ durationFrames: 300, now: () => now });

    now = 60_000;
    await act(async () => {
      // One animation frame: `advanceTimersToNextFrame` runs the callbacks
      // queued for the next frame, which is the whole loop being tested.
      vi.advanceTimersToNextFrame();
      await Promise.resolve();
    });
    const count = frames.length;
    await act(async () => {
      // One animation frame: `advanceTimersToNextFrame` runs the callbacks
      // queued for the next frame, which is the whole loop being tested.
      vi.advanceTimersToNextFrame();
      await Promise.resolve();
    });

    expect(frames.length).toBe(count);
  });
});
