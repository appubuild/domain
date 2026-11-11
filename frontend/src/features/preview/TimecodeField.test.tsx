// @vitest-environment jsdom
/** The timecode field.
 *
 *  What is pinned is the part every editor gets wrong: **a timecode that does
 *  not exist is refused, not snapped**. At 29.97 the counter skips
 *  `00:01:00;00`, and a field that quietly moved the playhead to the nearest
 *  real frame would be a field that goes somewhere the user did not ask for.
 *
 *  Alongside it: the field follows the playhead while you are not typing, and
 *  leaves your text alone while you are.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { TimecodeField } from './TimecodeField';

const PAL = { num: 25, den: 1 };
const NTSC = { num: 30_000, den: 1_001 };

function renderField(frame: number, timebase = PAL): { seeks: number[] } {
  const seeks: number[] = [];
  render(
    <TimecodeField
      label="Playhead"
      frame={frame}
      timebase={timebase}
      hint="Timecode"
      invalidMessage="That is not a timecode at this frame rate."
      onSeek={(next) => {
        seeks.push(next);
      }}
    />,
  );
  return { seeks };
}

function field(): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>('Playhead');
}

describe('showing the playhead', () => {
  it('writes the frame it was given', () => {
    renderField(0);
    expect(field().value).toBe('00:00:00:00');
  });

  it('follows the playhead when it moves', () => {
    const { rerender } = render(
      <TimecodeField
        label="Playhead"
        frame={0}
        timebase={PAL}
        invalidMessage="no"
        onSeek={() => {}}
      />,
    );
    rerender(
      <TimecodeField
        label="Playhead"
        frame={1500}
        timebase={PAL}
        invalidMessage="no"
        onSeek={() => {}}
      />,
    );
    expect(screen.getByLabelText<HTMLInputElement>('Playhead').value).toBe('00:01:00:00');
  });
});

describe('going to a frame', () => {
  it('commits on Enter', async () => {
    const user = userEvent.setup();
    const { seeks } = renderField(0);

    await user.clear(field());
    await user.type(field(), '00:00:10:00');
    await user.keyboard('{Enter}');

    expect(seeks).toEqual([250]);
  });

  it('commits when the field is left', async () => {
    const user = userEvent.setup();
    const { seeks } = renderField(0);

    await user.clear(field());
    await user.type(field(), '00:00:01:00');
    await user.tab();

    expect(seeks).toEqual([25]);
  });

  it('does not move the playhead on every keystroke', async () => {
    const user = userEvent.setup();
    const { seeks } = renderField(0);

    await user.clear(field());
    await user.type(field(), '00:00:1');

    expect(seeks).toEqual([]);
  });

  it('rewrites what it is showing in its own hand once committed', async () => {
    const user = userEvent.setup();
    renderField(0);
    await user.clear(field());
    await user.type(field(), '0:0:1:0');
    await user.keyboard('{Enter}');
    expect(field().value).toBe('00:00:01:00');
  });
});

describe('refusing what does not exist', () => {
  it('refuses a frame number the counter never shows, and keeps the text', async () => {
    const user = userEvent.setup();
    const { seeks } = renderField(0, NTSC);

    await user.clear(field());
    await user.type(field(), '00:01:00;00');
    await user.keyboard('{Enter}');

    expect(await screen.findByText('That is not a timecode at this frame rate.')).toBeTruthy();
    // Kept as typed: throwing the text away over one wrong digit means
    // retyping all twelve.
    expect(field().value).toBe('00:01:00;00');
    expect(seeks).toEqual([]);
  });

  it('accepts the frame next to the one that does not exist', async () => {
    const user = userEvent.setup();
    const { seeks } = renderField(0, NTSC);

    await user.clear(field());
    await user.type(field(), '00:01:00;02');
    await user.keyboard('{Enter}');

    expect(seeks).toEqual([1800]);
    expect(screen.queryByText('That is not a timecode at this frame rate.')).toBeNull();
  });

  it('refuses a part that is out of range', async () => {
    const user = userEvent.setup();
    const { seeks } = renderField(0);

    await user.clear(field());
    await user.type(field(), '00:00:99:00');
    await user.keyboard('{Enter}');

    expect(await screen.findByText('That is not a timecode at this frame rate.')).toBeTruthy();
    expect(seeks).toEqual([]);
  });

  it('abandons on Escape, and puts back the frame on screen', async () => {
    const user = userEvent.setup();
    const { seeks } = renderField(125);

    await user.clear(field());
    await user.type(field(), '00:09:00:00');
    await user.keyboard('{Escape}');

    expect(field().value).toBe('00:00:05:00');
    expect(seeks).toEqual([]);
  });
});
