/** The preview's frame: one request, one picture, and the ones it replaced.
 *
 *  A preview is a **stream of pictures, not a resource**, and that single fact
 *  is what this hook is for. Everything difficult about it follows:
 *
 *  * **A frame request is cancellable and supersedable.** Scrubbing asks for
 *    frame 40, 60, 90, 120 in a quarter of a second. Answering them in order is
 *    not possible, and showing them in the order they arrive would be a preview
 *    that plays backwards for a moment. Each request therefore carries a
 *    sequence number, and **an answer that is older than what is on screen is
 *    thrown away** — the last request wins because it is the one the user is
 *    actually looking at.
 *  * **The panel's size is in device pixels.** A 960-CSS-pixel panel on a 2×
 *    screen is 1920 device pixels, and asking for 960 would be asking the
 *    service to upscale — which it will not do, so the picture would be soft
 *    for a reason nobody wrote down.
 *  * **A failure keeps the last picture.** A frame that failed is not a blank
 *    frame: what is on screen is the last thing the user saw, and replacing it
 *    with nothing because one decode failed would be a preview that flickers
 *    to black on a slow project.
 *  * **The picture is on screen until it is replaced.** `stale` is the promise
 *    the pane uses to say so: the frame being shown is not the frame asked for,
 *    because the answer has not arrived yet.
 *
 *  Object URLs are created and revoked here and nowhere else: a blob held
 *  without being revoked is the whole panel's memory, leaked one frame at a
 *  time.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useApi } from '../../core/api/context';
import type { ApiProblem } from '../../core/api/problem';
import { parsePreviewGeometry, type PreviewGeometry } from './geometry';

export type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PreviewFrameRequest {
  readonly projectId: string;
  /** The timeline frame to draw. */
  readonly frame: number;
  /** The panel's size, in **device** pixels. `0` for either means the panel has
   *  not been measured yet, and no request is sent: asking for a 0-wide frame
   *  is asking the service to reject it. */
  readonly width: number;
  readonly height: number;
  /** `fit` is 1 — the service fits the project into the panel — and a number
   *  asks for that much more detail, which is what zooming in means. */
  readonly zoom: number;
}

export interface PreviewFrameView {
  /** The picture, as a URL an `<img>` can show. `null` before the first answer. */
  readonly url: string | null;
  /** How the service scaled and placed it. `null` when it did not say. */
  readonly geometry: PreviewGeometry | null;
  readonly status: PreviewStatus;
  readonly error: ApiProblem | null;
  /** Whether the picture on screen is a frame other than the one asked for —
   *  either an older frame, or none. The pane dims while this is true. */
  readonly stale: boolean;
  /** Ask again for the frame already asked for. */
  readonly reload: () => void;
}

interface Shown {
  readonly url: string;
  readonly frame: number;
  readonly geometry: PreviewGeometry | null;
}

export function usePreviewFrame(request: PreviewFrameRequest): PreviewFrameView {
  const client = useApi();
  const { projectId, frame, width, height, zoom } = request;

  const [shown, setShown] = useState<Shown | null>(null);
  const [status, setStatus] = useState<PreviewStatus>('idle');
  const [error, setError] = useState<ApiProblem | null>(null);
  const [nonce, setNonce] = useState(0);

  // Which request the answer belongs to. A counter rather than a comparison of
  // the frame number: the same frame asked for twice (a reload) must still
  // supersede the answer already in flight.
  const sequence = useRef(0);
  const held = useRef<string | null>(null);

  const release = useCallback(() => {
    if (held.current !== null) {
      URL.revokeObjectURL(held.current);
      held.current = null;
    }
  }, []);

  useEffect(() => {
    // Nothing to draw into yet: the pane has not been measured, so there is no
    // viewport to send. Waiting is not an error and must not read as one.
    if (width <= 0 || height <= 0) return;

    const mine = ++sequence.current;
    const controller = new AbortController();
    setStatus('loading');

    void client
      .runBlob('previewFrame', {
        params: { project_id: projectId },
        query: { frame, width, height, zoom },
        signal: controller.signal,
      })
      .then((result) => {
        if (mine !== sequence.current) return; // superseded while in flight
        if (!result.ok) {
          // The last picture stays: a failed decode is not a black screen.
          setStatus('error');
          setError(result.error);
          return;
        }
        const url = URL.createObjectURL(result.value.blob);
        release();
        held.current = url;
        setShown({ url, frame, geometry: parsePreviewGeometry(result.value.headers) });
        setStatus('ready');
        setError(null);
      });

    return () => {
      controller.abort();
    };
  }, [client, frame, height, projectId, release, width, zoom, nonce]);

  // The last frame's URL is ours to revoke: an object URL outlives the document
  // that made it until somebody does.
  useEffect(() => release, [release]);

  return {
    url: shown?.url ?? null,
    geometry: shown?.geometry ?? null,
    status,
    error,
    stale: shown === null || shown.frame !== frame,
    reload: useCallback(() => {
      setNonce((value) => value + 1);
    }, []),
  };
}
