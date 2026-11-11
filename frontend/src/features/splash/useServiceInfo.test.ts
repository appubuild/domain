// @vitest-environment jsdom
/** `useServiceInfo` — the one question the window asks before it has anything.
 *
 *  What is worth pinning is the cancellation: a component that outlives its
 *  request must not set state on a tree that is gone. React warns about it and
 *  then somebody "fixes" the warning by swallowing it, which is how a real leak
 *  becomes invisible. So the signal the hook was given is the thing asserted on,
 *  and not React's console.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ApiClient } from '../../core/api/client';
import type { ApiProblem } from '../../core/api/problem';
import { err, ok } from '../../core/result';
import { useServiceInfo } from './useServiceInfo';

const INFO = {
  version: '0.1.0',
  project_format_version: 3,
  data_dir: '/tmp',
  host: '127.0.0.1',
  port: 1,
  pid: 1,
  platform: 'test',
  python: '3.11',
  implementation: 'CPython',
  frozen: false,
};

function clientWith(answer: unknown): ApiClient {
  // Cast through `unknown`: a double for a two-method interface is not the
  // interface, and this one has to answer with whatever the test hands it.
  return { run: () => Promise.resolve(answer), url: () => '' } as unknown as ApiClient;
}

/** A client that hands back the signal it was given and never resolves. */
function clientThatWaits(seen: { signal: AbortSignal | undefined }): ApiClient {
  return {
    run: (_id: string, request?: { signal?: AbortSignal }) => {
      seen.signal = request?.signal;
      return new Promise<never>(() => {});
    },
    runBlob: () => new Promise<never>(() => {}),
    url: () => '',
  };
}

describe('useServiceInfo', () => {
  it('starts connecting, and says so before anything has happened', async () => {
    const { result } = renderHook(() => useServiceInfo(clientWith(ok(INFO))));

    expect(result.current.kind).toBe('connecting');
    await waitFor(() => {
      expect(result.current.kind).toBe('ready');
    });
  });

  it('a resolved answer is a ready state carrying the service', async () => {
    const { result } = renderHook(() => useServiceInfo(clientWith(ok(INFO))));
    await waitFor(() => {
      expect(result.current.kind).toBe('ready');
    });
    expect(result.current.kind === 'ready' && result.current.info.version).toBe('0.1.0');
  });

  it('a failure becomes a state the screen can name', async () => {
    const problem: ApiProblem = {
      kind: 'transport',
      status: 0,
      code: 'transport/unreachable',
      detail: 'fetch failed',
    };
    const { result } = renderHook(() => useServiceInfo(clientWith(err(problem))));

    await waitFor(() => {
      expect(result.current.kind).toBe('unreachable');
    });
    expect(result.current.kind === 'unreachable' && result.current.problem.code).toBe(
      'transport/unreachable',
    );
  });

  it('cancels the request when the component goes away', () => {
    const seen: { signal: AbortSignal | undefined } = { signal: undefined };
    const { unmount } = renderHook(() => useServiceInfo(clientThatWaits(seen)));

    expect(seen.signal).toBeDefined();
    expect(seen.signal?.aborted).toBe(false);
    unmount();
    // The service is let off the hook, and the promise that never resolves can
    // no longer touch a tree that has been thrown away.
    expect(seen.signal?.aborted).toBe(true);
  });
});
