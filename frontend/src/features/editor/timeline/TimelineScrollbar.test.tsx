// @vitest-environment jsdom
/** The timeline's scrollbar, against a measured track.

 *  What is pinned here is the difference between a scrollbar that *draws* the
 *  scroll and one that *is* the scroll:
 *
 *  * **The thumb is the size of the view.** A thumb of a fixed width is a
 *    decoration; this one is `visibleFrames / total`, which is how a user knows
 *    how much of the edit they are looking at — and the reason it has a floor,
 *    because a project a thousand times longer than its viewport is still a
 *    thumb a hand has to be able to take hold of.
 *  * **A press on the track jumps; a press on the thumb does not.** Jumping
 *    before a drag would move the thumb out from under a pointer that has not
 *    gone anywhere yet.
 *  * **A drag is measured from where it began**, not from where the pointer is:
 *    grabbing the thumb at its edge must not teleport it to the pointer.
 *  * **Nothing escapes either end**, by drag or by key.
 *  * **The keys work.** A control that looks like a scrollbar and cannot be
 *    driven from a keyboard is a control only some users have.
 *
 *  jsdom has no layout, so the track is measured by stubbing
 *  `getBoundingClientRect`: 400 pixels wide, starting at 0. A press at
 *  `clientX: 100` is therefore a quarter of the way along, which is the
 *  arithmetic every test below is written in.
 *
 *  jsdom implements no pointer capture either, and these tests deliberately do
 *  not stub it: the component asks for capture only if it is there, and a drag
 *  that needed it would be a drag that broke in a real browser the day capture
 *  was denied.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TimelineScrollbar } from './TimelineScrollbar';

const TRACK_WIDTH = 400;

/** Give the track a size: without one there is nothing to map a pixel onto,
 *  which is why the component leaves the scroll alone rather than dividing by
 *  zero and jumping to the end. */
function measure(width = TRACK_WIDTH): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: 8,
    width,
    height: 8,
    toJSON: () => ({}),
  });
}

/** One scrollbar with `content` frames of travel, drawn 400 pixels wide. */
function bar(over: Partial<Parameters<typeof TimelineScrollbar>[0]> = {}) {
  measure();
  const onChange = vi.fn();
  const view = render(
    <TimelineScrollbar
      scrollFrames={0}
      maxScrollFrames={900}
      visibleFrames={100}
      onChange={onChange}
      label="Scroll the timeline"
      {...over}
    />,
  );
  return { onChange, view };
}

function track(): HTMLElement {
  return screen.getByTestId('timeline-scrollbar');
}

function thumb(): HTMLElement {
  return screen.getByTestId('timeline-scrollbar-thumb');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the thumb', () => {
  it('is the size of the view, not a constant', () => {
    // 100 visible of 1000 total. A thumb that did not shrink as the edit grew
    // would be lying about how much of it is off screen.
    bar();
    expect(thumb().style.width).toBe('10%');
  });

  it('has a floor, so a very long edit is still a thumb a hand can grab', () => {
    // One frame visible in a hundred thousand: 0.001% of the track, which is
    // not a thing anyone can take hold of.
    bar({ visibleFrames: 1, maxScrollFrames: 99_999 });
    expect(thumb().style.width).toBe('8%');
  });

  it('fills the track when the whole edit already fits', () => {
    bar({ maxScrollFrames: 0 });
    expect(thumb().style.width).toBe('100%');
    expect(thumb().style.left).toBe('0%');
  });

  it('sits where the viewport is', () => {
    // Half way through the travel: half of the room the thumb has to move in,
    // which is the whole point of the `100 - width` term — a thumb placed at a
    // bare 50% would overhang the end of its own track.
    bar({ scrollFrames: 450 });
    expect(thumb().style.left).toBe('45%');
  });

  it('pins to the start when nothing is scrolled', () => {
    bar({ scrollFrames: 0 });
    expect(thumb().style.left).toBe('0%');
  });

  it('pins to the end when everything is scrolled', () => {
    bar({ scrollFrames: 900 });
    expect(thumb().style.left).toBe('90%');
  });
});

describe('a press', () => {
  it('jumps to where the track was pressed', () => {
    const { onChange } = bar();
    fireEvent.pointerDown(track(), { pointerId: 1, clientX: 100 });
    expect(onChange).toHaveBeenCalledWith(225);
  });

  it('clamps a press that lands beyond the track', () => {
    const { onChange } = bar();
    fireEvent.pointerDown(track(), { pointerId: 1, clientX: TRACK_WIDTH + 80 });
    expect(onChange).toHaveBeenCalledWith(900);
  });

  it('does not jump when the thumb itself was pressed', () => {
    const { onChange } = bar({ scrollFrames: 450 });
    fireEvent.pointerDown(thumb(), { pointerId: 1, clientX: 200 });
    // The thumb is half way along; jumping to the pointer would be a jump to
    // frame 450, which is where the thumb already is — for every other grab
    // point it is a jump of up to half the track before the drag begins.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does nothing at all when there is nothing to scroll', () => {
    const { onChange } = bar({ maxScrollFrames: 0 });
    fireEvent.pointerDown(track(), { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(track(), { pointerId: 1, clientX: 300 });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('a drag', () => {
  it('is measured from where it began, not from where the pointer is', () => {
    const { onChange } = bar({ scrollFrames: 100 });
    fireEvent.pointerDown(thumb(), { pointerId: 1, clientX: 40 });
    fireEvent.pointerMove(track(), { pointerId: 1, clientX: 40 + TRACK_WIDTH / 4 });
    // A quarter of the track is a quarter of the travel: 225 frames on from
    // where the drag started, not to frame 225.
    expect(onChange).toHaveBeenCalledWith(325);
  });

  it('will not go past the end', () => {
    const { onChange } = bar({ scrollFrames: 800 });
    fireEvent.pointerDown(thumb(), { pointerId: 1, clientX: 360 });
    fireEvent.pointerMove(track(), { pointerId: 1, clientX: 360 + TRACK_WIDTH * 3 });
    expect(onChange).toHaveBeenCalledWith(900);
  });

  it('will not go before the beginning', () => {
    const { onChange } = bar({ scrollFrames: 100 });
    fireEvent.pointerDown(thumb(), { pointerId: 1, clientX: 40 });
    fireEvent.pointerMove(track(), { pointerId: 1, clientX: -TRACK_WIDTH * 3 });
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('ignores a move from a pointer that is not the one dragging', () => {
    const { onChange } = bar({ scrollFrames: 100 });
    fireEvent.pointerDown(thumb(), { pointerId: 1, clientX: 40 });
    fireEvent.pointerMove(track(), { pointerId: 2, clientX: 300 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('forgets the drag when the pointer is released', () => {
    const { onChange } = bar({ scrollFrames: 100 });
    fireEvent.pointerDown(thumb(), { pointerId: 1, clientX: 40 });
    fireEvent.pointerUp(track(), { pointerId: 1, clientX: 40 });
    fireEvent.pointerMove(track(), { pointerId: 1, clientX: 300 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('forgets the drag when the pointer is cancelled', () => {
    const { onChange } = bar({ scrollFrames: 100 });
    fireEvent.pointerDown(thumb(), { pointerId: 1, clientX: 40 });
    fireEvent.pointerCancel(track(), { pointerId: 1, clientX: 40 });
    fireEvent.pointerMove(track(), { pointerId: 1, clientX: 300 });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('the keys', () => {
  it('steps with the arrow keys', () => {
    const { onChange } = bar({ scrollFrames: 0 });
    // A twentieth of the travel: twenty presses to cross the edit, which is a
    // step a user can count on rather than one they have to discover.
    fireEvent.keyDown(track(), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith(45);
  });

  it('takes a bigger step with shift held', () => {
    const { onChange } = bar({ scrollFrames: 0 });
    fireEvent.keyDown(track(), { key: 'ArrowRight', shiftKey: true });
    expect(onChange).toHaveBeenCalledWith(225);
  });

  it('reads a vertical arrow as the same axis it is', () => {
    const { onChange } = bar({ scrollFrames: 300 });
    fireEvent.keyDown(track(), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith(255);
  });

  it('stops at the beginning', () => {
    const { onChange } = bar({ scrollFrames: 10 });
    fireEvent.keyDown(track(), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('stops at the end', () => {
    const { onChange } = bar({ scrollFrames: 890 });
    fireEvent.keyDown(track(), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith(900);
  });

  it('goes to the ends with Home and End', () => {
    const { onChange } = bar({ scrollFrames: 450 });
    fireEvent.keyDown(track(), { key: 'Home' });
    fireEvent.keyDown(track(), { key: 'End' });
    expect(onChange.mock.calls).toEqual([[0], [900]]);
  });
});

describe('assistive technology', () => {
  it('says it is a horizontal scrollbar, and where it is', () => {
    bar({ scrollFrames: 300, maxScrollFrames: 900 });
    const element = track();
    expect(element.getAttribute('role')).toBe('scrollbar');
    expect(element.getAttribute('aria-orientation')).toBe('horizontal');
    expect(element.getAttribute('aria-label')).toBe('Scroll the timeline');
    expect(element.getAttribute('aria-valuemin')).toBe('0');
    expect(element.getAttribute('aria-valuemax')).toBe('900');
    expect(element.getAttribute('aria-valuenow')).toBe('300');
  });

  it('rounds what it reports, because a frame is not a fraction', () => {
    bar({ scrollFrames: 300.6 });
    expect(track().getAttribute('aria-valuenow')).toBe('301');
  });

  it('cannot be focused when there is nothing to scroll', () => {
    bar({ maxScrollFrames: 0 });
    expect(track().getAttribute('tabindex')).toBe('-1');
  });
});
