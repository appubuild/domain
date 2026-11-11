/** The playback slice.
 *
 *  What is pinned is the part a UI cannot be trusted with: that the playhead is
 *  **always a whole frame**, and that it never goes below zero. A playhead at
 *  12.4 is not a frame, and a playhead at −1 is not a project — and both are one
 *  careless subtraction away in a component that does its own arithmetic.
 */

import { describe, expect, it } from 'vitest';

import { createPlaybackStore } from './playback';

describe('where the playhead is', () => {
  it('starts at the first frame, stopped', () => {
    const store = createPlaybackStore();
    expect(store.getState().frame).toBe(0);
    expect(store.getState().playing).toBe(false);
  });

  it('is always a whole frame', () => {
    const store = createPlaybackStore();
    store.getState().seek(12.7);
    expect(store.getState().frame).toBe(12);
  });

  it('never goes below zero, however far back it is asked to go', () => {
    const store = createPlaybackStore();
    store.getState().seek(-500);
    expect(store.getState().frame).toBe(0);
  });

  it('treats a number that is not a number as the first frame', () => {
    const store = createPlaybackStore();
    store.getState().seek(30);
    store.getState().seek(Number.NaN);
    expect(store.getState().frame).toBe(0);
  });

  it('steps by whole frames', () => {
    const store = createPlaybackStore();
    store.getState().step(10);
    store.getState().step(-3);
    expect(store.getState().frame).toBe(7);
  });

  it('does not move when the step is a no-op, so a tick does not re-render', () => {
    const store = createPlaybackStore();
    const before = store.getState();
    store.getState().seek(0);
    // Same contents, same object: zustand replaces the state only on a write,
    // and a write per tick with nothing to write is a render per tick.
    expect(store.getState()).toBe(before);
  });
});

describe('what transport is doing', () => {
  it('plays, pauses and toggles', () => {
    const store = createPlaybackStore();
    store.getState().play();
    expect(store.getState().playing).toBe(true);
    store.getState().toggle();
    expect(store.getState().playing).toBe(false);
    store.getState().toggle();
    expect(store.getState().playing).toBe(true);
  });

  it('stop means back to the start and not playing, as it has since 1963', () => {
    const store = createPlaybackStore();
    store.getState().seek(400);
    store.getState().play();
    store.getState().stop();
    expect(store.getState().frame).toBe(0);
    expect(store.getState().playing).toBe(false);
  });

  it('refuses a rate that is not forward', () => {
    const store = createPlaybackStore();
    store.getState().setRate(0);
    expect(store.getState().rate).toBe(1);
    store.getState().setRate(2);
    expect(store.getState().rate).toBe(2);
  });

  it('remembers the rate, the loop and the zoom', () => {
    const store = createPlaybackStore();
    store.getState().setRate(0.5);
    store.getState().setLoop(true);
    store.getState().setZoom(2);
    expect(store.getState().rate).toBe(0.5);
    expect(store.getState().loop).toBe(true);
    expect(store.getState().zoom).toBe(2);
  });
});
