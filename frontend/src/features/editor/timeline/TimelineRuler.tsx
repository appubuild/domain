/** The ruler: where the frames are, and how long the edit is.
 *
 *  Drawn from `ruler.ts`, which decides *which* frames get a tick; this decides
 *  where a tick goes and what it says. The split matters: the ladder is pure and
 *  tested without a DOM, and the drawing is one pass over two arrays.
 *
 *  Two things a ruler is for, and they are not the same thing:
 *
 *  * **Reading a position.** The ticks are labelled in timecode, at the
 *    project's rate, aligned to frame zero so a label means the same thing
 *    wherever the viewport is.
 *  * **Moving to one.** A press scrubs, and a press-and-drag keeps scrubbing:
 *    the ruler is the largest seek target on screen, and a ruler you could only
 *    click would be a ruler you had to aim at.
 *
 *  The strip is one transformed layer rather than a tick per component: a scroll
 *  then moves one element instead of asking the browser to lay out two hundred
 *  of them.
 */

import { memo, useMemo } from 'react';

import type { Timebase } from '../../../core/timecode/timebase';
import { RULER_HEIGHT, contentOffsetX, contentX, type TimelineLayout } from './layout';
import { tickLabel, type RulerTicks } from './ruler';

export interface TimelineRulerProps {
  readonly layout: TimelineLayout;
  readonly ticks: RulerTicks;
  readonly timebase: Timebase;
  readonly onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}

function TimelineRulerImpl({
  layout,
  ticks,
  timebase,
  onPointerDown,
}: TimelineRulerProps): React.JSX.Element {
  // Only the ticks that can be seen: a three-hour project at one-frame ticks is
  // six and a half million of them, and the strip would be the slowest thing in
  // the window while drawing nine labels.
  const drawn = useMemo(() => {
    const left = layout.scrollFrames;
    const right = layout.scrollFrames + Math.max(0, layout.width) / layout.pxPerFrame;
    return {
      major: ticks.major.filter((frame) => frame >= left && frame <= right),
      minor: ticks.minor.filter((frame) => frame >= left && frame <= right),
    };
  }, [layout.scrollFrames, layout.width, layout.pxPerFrame, ticks]);

  return (
    <div
      data-testid="timeline-ruler"
      aria-hidden="true"
      className="absolute inset-x-0 top-0 cursor-ew-resize border-b border-line bg-surface-1"
      style={{ height: RULER_HEIGHT }}
      onPointerDown={onPointerDown}
    >
      <div
        className="absolute inset-y-0 left-0"
        style={{ transform: `translateX(${contentOffsetX(layout)}px)` }}
      >
        {drawn.minor.map((frame) => (
          <span
            key={`m${frame}`}
            className="absolute bottom-0 w-px bg-line"
            style={{ left: contentX(layout, frame), height: 6 }}
          />
        ))}
        {drawn.major.map((frame) => (
          <span
            key={frame}
            className="absolute inset-y-0"
            style={{ left: contentX(layout, frame) }}
          >
            <span className="absolute bottom-0 w-px bg-ink-faint" style={{ height: 12 }} />
            {/* Offset by two pixels so the label sits beside its tick rather
                than on top of it: a label centred on the line it names is a
                label that hides the line. */}
            <span className="absolute top-0 whitespace-nowrap pl-[3px] font-mono text-[10px] leading-[13px] tabular-nums text-ink-dim">
              {tickLabel(frame, timebase)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export const TimelineRuler = memo(TimelineRulerImpl);
