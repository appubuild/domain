/** The geometry that arrives beside a frame.
 *
 *  These headers are the only part of a preview frame a client *reads* rather
 *  than blits, so what is pinned is that nothing is invented when they are not
 *  there: a proxy that kept the body and dropped the headers must give a panel
 *  that draws, not a panel that throws.
 */

import { describe, expect, it } from 'vitest';

import { gapCount, parsePreviewGeometry } from './geometry';

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

const FULL: Record<string, string> = {
  'X-Nova-Preview-Scale': '0.500000',
  'X-Nova-Preview-Offset': '0,60',
  'X-Nova-Preview-Size': '960x540',
  'X-Nova-Preview-Gaps': 'asset-1, asset-2',
};

describe('a frame that came with its geometry', () => {
  it('reads the scale, the offset, the size and the gaps', () => {
    const geometry = parsePreviewGeometry(headers(FULL));

    expect(geometry).toEqual({
      scale: 0.5,
      offset: { x: 0, y: 60 },
      width: 960,
      height: 540,
      gaps: ['asset-1', 'asset-2'],
    });
  });

  it('says how many assets it was drawn without', () => {
    expect(gapCount(parsePreviewGeometry(headers(FULL)))).toBe(2);
    expect(gapCount(parsePreviewGeometry(headers({ 'X-Nova-Preview-Scale': '1' })))).toBe(0);
    expect(gapCount(null)).toBe(0);
  });

  it('reads a frame with nothing missing', () => {
    const geometry = parsePreviewGeometry(
      headers({ 'X-Nova-Preview-Size': '1920x1080', 'X-Nova-Preview-Gaps': '' }),
    );
    expect(geometry?.gaps).toEqual([]);
  });
});

describe('a frame whose headers are not all there', () => {
  it('says nothing when the service said nothing about geometry', () => {
    // A proxy between the window and the service may keep the body and drop the
    // headers. Refusing to draw would be broken by a piece of network
    // equipment; the panel letterboxes from the picture instead.
    expect(parsePreviewGeometry(headers({ 'content-type': 'image/jpeg' }))).toBeNull();
  });

  it('defaults the parts that are missing rather than refusing the frame', () => {
    const geometry = parsePreviewGeometry(headers({ 'X-Nova-Preview-Size': '800x600' }));

    expect(geometry?.scale).toBe(1);
    expect(geometry?.offset).toEqual({ x: 0, y: 0 });
    expect(geometry?.width).toBe(800);
  });

  it('says a size it was not told as zero, which is not a size a frame has', () => {
    const geometry = parsePreviewGeometry(headers({ 'X-Nova-Preview-Scale': '0.25' }));
    expect(geometry?.width).toBe(0);
    expect(geometry?.height).toBe(0);
  });

  it('defaults a header that is not a number rather than throwing', () => {
    // One header written by a different version of the service is not a reason
    // for a panel to fail to draw.
    const geometry = parsePreviewGeometry(
      headers({ 'X-Nova-Preview-Scale': 'half', 'X-Nova-Preview-Offset': '12' }),
    );
    expect(geometry?.scale).toBe(1);
    expect(geometry?.offset).toEqual({ x: 12, y: 0 });
  });
});
