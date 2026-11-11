/** The geometry that travels beside a preview frame.
 *
 *  A preview frame is a JPEG, and the four things the panel needs to know about
 *  it — how far it was scaled, where it sits, how big it came out, and which
 *  assets could not be decoded — are sent as **headers**, not as JSON wrapped
 *  around base64 (`api.md` §13, ADR on the render surface). So reading a frame
 *  is two steps: the bytes become a picture, and the headers become this.
 *
 *  Every number here is **informational**: the panel draws the picture it was
 *  given and uses these to place it, to letterbox it, and to say what is
 *  missing. It never recalculates the scale, because the scale is the service's
 *  answer to "how big can you make this without inventing pixels" — a second
 *  opinion computed in the client would be a second opinion that disagrees on
 *  a rotated clip.
 */

/** How a frame came back from the service. */
export interface PreviewGeometry {
  /** The scale the compositor applied: `0.5` means the picture is half the
   *  project's own size. Never above 1 — the service does not upscale. */
  readonly scale: number;
  /** Where the picture's top-left corner sits inside the frame the service
   *  drew, in project pixels. Non-zero when the sequence is letterboxed. */
  readonly offset: { readonly x: number; readonly y: number };
  /** The picture's size in device pixels, as delivered. `0` when the service
   *  did not say — which is not the same as "it is nothing wide". */
  readonly width: number;
  readonly height: number;
  /** Assets on the timeline that could not be decoded, by id. The frame was
   *  drawn without them, and the panel says so rather than staying quiet: a
   *  preview that silently omitted a clip is a preview that lies about the
   *  edit. */
  readonly gaps: readonly string[];
}

const SCALE = 'x-nova-preview-scale';
const OFFSET = 'x-nova-preview-offset';
const SIZE = 'x-nova-preview-size';
const GAPS = 'x-nova-preview-gaps';

/** The geometry in a frame's headers, or `null` when there are none.
 *
 *  `null` is a real answer and not an error: a proxy between the window and the
 *  service may keep the body and drop the headers, and a panel that refused to
 *  draw in that case would be broken by a piece of network equipment. What the
 *  panel loses is the letterboxing, which it can do from the picture's own
 *  aspect ratio.
 *
 *  A *part* that is missing is defaulted rather than refused, and `0` is how a
 *  size says "unknown" — because `0 × 0` is not a size a frame ever has. */
export function parsePreviewGeometry(headers: Headers): PreviewGeometry | null {
  const scale = headers.get(SCALE);
  const offset = headers.get(OFFSET);
  const size = headers.get(SIZE);
  if (scale === null && offset === null && size === null) return null;

  return {
    scale: numberOr(scale, 1),
    offset: parseOffset(offset),
    ...parseSize(size),
    gaps: parseGaps(headers.get(GAPS)),
  };
}

/** How many assets a frame was drawn without. */
export function gapCount(geometry: PreviewGeometry | null): number {
  return geometry?.gaps.length ?? 0;
}

function parseOffset(text: string | null): { x: number; y: number } {
  const [x, y] = (text ?? '').split(',');
  return { x: numberOr(x, 0), y: numberOr(y, 0) };
}

function parseSize(text: string | null): { width: number; height: number } {
  const [width, height] = (text ?? '').split('x');
  return { width: numberOr(width, 0), height: numberOr(height, 0) };
}

function parseGaps(text: string | null): readonly string[] {
  if (text === null || text.trim() === '') return [];
  return text
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
}

/** A header that is a number, or a default when it is not one.
 *
 *  A malformed header is defaulted rather than thrown: half a frame's worth of
 *  geometry is still better than a panel that failed to draw because one header
 *  was written by a different version of the service. */
function numberOr(text: string | null | undefined, fallback: number): number {
  if (text === null || text === undefined) return fallback;
  const value = Number(text);
  return Number.isFinite(value) ? value : fallback;
}
