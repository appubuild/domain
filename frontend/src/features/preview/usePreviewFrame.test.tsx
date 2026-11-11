// @vitest-environment jsdom
/** The preview's frame loop, against a client double.
 *
 *  A preview is a stream of pictures and not a resource, and every test here is
 *  about one way that goes wrong:
 *
 *  * **An answer that arrives late is thrown away.** Scrub from frame 10 to 400
 *    and the frame-10 answer is still in flight. Drawing it when it lands is a
 *    preview that jumps backwards.
 *  * **A failed frame keeps the last picture.** A decode that failed is not a
 *    black screen, and a panel that blanked on one bad frame would strobe.
 *  * **Nothing is asked for until the panel has been measured.** A 0 × 0 request
 *    is a request the service is entitled to reject.
 *  * **Object URLs are revoked.** One leaked per frame at 30 frames a second is
 *    the panel's memory gone in an hour.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import type { ApiClient } from '../../core/api/client';
import { ApiContext } from '../../core/api/context';
import type { ApiProblem } from '../../core/api/problem';
import { err, ok } from '../../core/result';
import { usePreviewFrame, type PreviewFrameRequest } from './usePreviewFrame';

interface Answer {
  readonly body?: string;
  readonly headers?: Record<string, string>;
  readonly error?: ApiProblem;
  /** Held until the test releases it, for the ones that arrive late. */
  readonly hold?: boolean;
}

function problem(code: string): ApiProblem {
  return { kind: 'api', status: 500, code, detail: code };
}

interface Harness {
  readonly client: ApiClient;
  readonly asked: Array<Record<string, string>>;
  readonly release: () => void;
}

function fakeClient(script: readonly Answer[]): Harness {
  const asked: Array<Record<string, string>> = [];
  const gates: Array<(value: never) => void> = [];
  let index = 0;

  const client = {
    runBlob: (_id: string, request?: { query?: Record<string, string | number> }) => {
      const query = request?.query ?? {};
      asked.push(
        Object.fromEntries(Object.entries(query).map(([key, value]) => [key, String(value)])),
      );
      const answer = script[Math.min(index, script.length - 1)] ?? { body: 'jpeg' };
      index += 1;
      if (answer.hold === true) {
        return new Promise((resolve) => {
          gates.push(resolve);
        });
      }
      if (answer.error !== undefined) return Promise.resolve(err(answer.error));
      // The platform's `Response` is the honest double here: it is what parses
      // the headers, and a hand-written `Headers`-shaped object would be a test
      // of the test.
      return Promise.resolve(
        ok({
          blob: new Blob([answer.body ?? 'jpeg'], { type: 'image/jpeg' }),
          headers: new Headers({
            'content-type': 'image/jpeg',
            ...(answer.headers ?? { 'X-Nova-Preview-Size': '960x540' }),
          }),
          status: 200,
        }),
      );
    },
  } as unknown as ApiClient;

  return {
    client,
    asked,
    release: () => {
      for (const gate of gates.splice(0)) {
        gate(undefined as never);
      }
    },
  };
}

function wrapper(client: ApiClient) {
  return function Wrapper({ children }: { readonly children: ReactNode }): React.JSX.Element {
    return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
  };
}

const UNMEASURED: PreviewFrameRequest = {
  projectId: 'p1',
  frame: 0,
  width: 0,
  height: 0,
  zoom: 1,
};

function measured(frame: number, over: Partial<PreviewFrameRequest> = {}): PreviewFrameRequest {
  return { projectId: 'p1', frame, width: 960, height: 540, zoom: 1, ...over };
}

function live(): number {
  const count = (globalThis as { __objectUrls?: () => number }).__objectUrls;
  return count === undefined ? -1 : count();
}

describe('asking for a frame', () => {
  it('asks for nothing until the panel has been measured', () => {
    const { client, asked } = fakeClient([{ body: 'jpeg' }]);
    const { result } = renderHook(() => usePreviewFrame(UNMEASURED), { wrapper: wrapper(client) });

    expect(asked).toHaveLength(0);
    expect(result.current.status).toBe('idle');
    expect(result.current.url).toBeNull();
  });

  it('asks for the frame, at the size it can fill', async () => {
    const { client, asked } = fakeClient([{ body: 'jpeg' }]);
    renderHook(() => usePreviewFrame(measured(42)), { wrapper: wrapper(client) });

    await waitFor(() => {
      expect(asked).toHaveLength(1);
    });
    expect(asked[0]?.frame).toBe('42');
    expect(asked[0]?.width).toBe('960');
  });

  it('shows what came back, with the geometry that came with it', async () => {
    const { client } = fakeClient([
      {
        body: 'a-frame',
        headers: { 'X-Nova-Preview-Scale': '0.5', 'X-Nova-Preview-Size': '960x540' },
      },
    ]);
    const { result } = renderHook(() => usePreviewFrame(measured(0)), { wrapper: wrapper(client) });

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.url?.startsWith('blob:')).toBe(true);
    expect(result.current.geometry?.scale).toBe(0.5);
    expect(result.current.stale).toBe(false);
  });
});

describe('scrubbing', () => {
  it('says the picture on screen is behind while the new one is coming', async () => {
    const { client } = fakeClient([{ body: 'frame-0' }, { body: 'frame-90', hold: true }]);
    const { result, rerender } = renderHook(
      ({ frame }: { frame: number }) => usePreviewFrame(measured(frame)),
      {
        wrapper: wrapper(client),
        initialProps: { frame: 0 },
      },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    rerender({ frame: 90 });

    // The old picture is still the one being shown — that is the point — and
    // `stale` is how the pane says it is not the frame that was asked for.
    await waitFor(() => {
      expect(result.current.stale).toBe(true);
    });
    expect(result.current.url).not.toBeNull();
  });

  it('throws away an answer that arrives after a newer one was asked for', async () => {
    // Frame 10's answer is held; frame 400 is asked for and answered; then
    // frame 10's answer is released. Drawing it would be a preview that jumps
    // backwards in the middle of a scrub.
    const { client, release, asked } = fakeClient([
      { body: 'frame-10', hold: true },
      { body: 'frame-400', headers: { 'X-Nova-Preview-Size': '960x540' } },
      { body: 'frame-10' },
    ]);
    const { result, rerender } = renderHook(
      ({ frame }: { frame: number }) => usePreviewFrame(measured(frame)),
      {
        wrapper: wrapper(client),
        initialProps: { frame: 10 },
      },
    );

    rerender({ frame: 400 });
    await waitFor(() => {
      expect(asked.length).toBeGreaterThanOrEqual(2);
    });
    await waitFor(() => {
      expect(result.current.stale).toBe(false);
    });

    const urlOf400 = result.current.url;
    await act(async () => {
      release();
      await Promise.resolve();
    });

    expect(result.current.url).toBe(urlOf400);
    expect(result.current.stale).toBe(false);
  });
});

describe('failing', () => {
  it('keeps the last picture and says what went wrong', async () => {
    const { client } = fakeClient([{ body: 'good' }, { error: problem('NS-RENDER-5030') }]);
    const { result, rerender } = renderHook(
      ({ frame }: { frame: number }) => usePreviewFrame(measured(frame)),
      {
        wrapper: wrapper(client),
        initialProps: { frame: 0 },
      },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    const kept = result.current.url;

    rerender({ frame: 1 });
    await waitFor(() => {
      expect(result.current.error?.code).toBe('NS-RENDER-5030');
    });

    expect(result.current.url).toBe(kept);
  });
});

describe('holding on to what it made', () => {
  it('revokes the picture it replaces, rather than leaking one per frame', async () => {
    const { client } = fakeClient([{ body: 'one' }, { body: 'two' }, { body: 'three' }]);
    const { result, rerender, unmount } = renderHook(
      ({ frame }: { frame: number }) => usePreviewFrame(measured(frame)),
      { wrapper: wrapper(client), initialProps: { frame: 0 } },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    rerender({ frame: 1 });
    await waitFor(() => {
      expect(result.current.stale).toBe(false);
    });

    // Exactly one picture is alive: the one on screen. A second would be the
    // leak that makes a preview panel the thing that exhausts the machine.
    expect(live()).toBe(1);

    unmount();
    expect(live()).toBe(0);
  });
});
