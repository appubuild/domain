/** `core/api/client.ts` — the transport, against a fake `fetch`.
 *
 * What is being pinned is the promise the client makes to every caller above
 * it: **it never throws, and it never loses the code.** A 404 from the service
 * and a laptop that went to sleep are both `Err`, and the difference between
 * them is in the problem rather than in whether the caller remembered to write
 * a `try`. The second half is the contract coupling: if a route changes its
 * path or drops a parameter, the call below stops compiling.
 */

import { describe, expect, it } from 'vitest';
import { createApiClient, DEFAULT_TIMEOUT_MS } from './client';
import type { ApiClientOptions } from './client';
import type { ApiProblem } from './problem';
import type { Result } from '../result';

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

type Responder = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

function fakeFetch(responder: Responder): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: requestUrl(input), init });
    return responder(requestUrl(input), init);
  };
  return { fetch: impl, calls };
}

/** What the platform would have asked for, as a string. */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function problem(status: number, code: string): Response {
  return new Response(
    JSON.stringify({
      code,
      title: 'No project with that id is open here',
      detail: 'the project was closed',
      status,
      domain: 'project',
      retryable: false,
      severity: 'error',
      type: 'about:blank',
    }),
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

/** A fetch that never answers until the signal does — how a hung service looks.
 *
 *  It rejects immediately on a signal that is *already* aborted, which is what
 *  the platform's `fetch` does and what a double that ignored it would hide.
 */
function neverAnswers(): Responder {
  return (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      const abort = (): void => {
        reject(new DOMException('the request was aborted', 'AbortError'));
      };
      if (init?.signal?.aborted) {
        abort();
        return;
      }
      init?.signal?.addEventListener('abort', abort, { once: true });
    });
}

function clientWith(responder: Responder, options: Omit<ApiClientOptions, 'fetch'> = {}) {
  const fake = fakeFetch(responder);
  return { client: createApiClient({ ...options, fetch: fake.fetch }), calls: fake.calls };
}

/** Two helpers, so a test reads as what it means instead of as a narrowing
 *  exercise: `value` unwraps a success and names the failure if it was not one.
 */
function value<T>(result: Result<T, ApiProblem>): T {
  if (!result.ok) throw new Error(`expected a success, got ${result.error.code}`);
  return result.value;
}

function failure(result: Result<unknown, ApiProblem>): ApiProblem {
  if (result.ok) throw new Error('expected a failure, got a success');
  return result.error;
}

function headersOf(call: Call | undefined): Headers {
  return new Headers(call?.init?.headers);
}

describe('asking', () => {
  it('sends the token, accepts JSON, and asks for the right path', async () => {
    const { client, calls } = clientWith(() => json(200, { version: '0.1.0' }), {
      token: 'session-token',
    });

    const result = await client.run('systemInfo');

    expect(value(result)).toEqual({ version: '0.1.0' });
    expect(calls[0]?.url).toBe('/api/v1/system/info');
    expect(headersOf(calls[0]).get('authorization')).toBe('Bearer session-token');
    expect(headersOf(calls[0]).get('accept')).toBe('application/json');
  });

  it('substitutes a path parameter, and refuses to ask without one', async () => {
    const { client, calls } = clientWith(() => json(200, {}));

    await client.run('getProject', { params: { project_id: 'p1' } });
    expect(calls[0]?.url).toBe('/api/v1/projects/p1');

    const refused = await client.run('getProject');
    expect(failure(refused).kind).toBe('contract');
    expect(failure(refused).code).toBe('transport/missing-path-param');
    expect(calls).toHaveLength(1);
  });

  it('encodes a path parameter rather than trusting it', async () => {
    const { client, calls } = clientWith(() => json(200, {}));
    await client.run('getProject', { params: { project_id: 'a b/c' } });
    expect(calls[0]?.url).toBe('/api/v1/projects/a%20b%2Fc');
  });

  it('serialises the query it was given and nothing it was not', async () => {
    const { client, calls } = clientWith(() => new Response(new Blob(['x']), { status: 200 }));

    await client.run('previewFrame', {
      params: { project_id: 'p1' },
      query: { frame: 12, width: 640, height: 360 },
    });

    const url = new URL(calls[0]?.url ?? '', 'http://session');
    expect(url.pathname).toBe('/api/v1/projects/p1/preview/frame');
    expect(url.searchParams.get('frame')).toBe('12');
    expect(url.searchParams.get('width')).toBe('640');
    expect(url.searchParams.get('zoom')).toBeNull();
  });

  it('sends a body as JSON, and no content type without one', async () => {
    const { client, calls } = clientWith(() => json(201, { project: { project_id: 'p1' } }));

    await client.run('createProject', { body: { name: 'Demo' } });

    expect(calls[0]?.init?.method).toBe('POST');
    expect(headersOf(calls[0]).get('content-type')).toBe('application/json');
    expect(calls[0]?.init?.body).toBe('{"name":"Demo"}');
  });

  it('reads the token per request, because a shell hands it over after boot', async () => {
    const secret: { value?: string } = {};
    const { client, calls } = clientWith(() => json(200, {}), { token: () => secret.value });

    await client.run('systemInfo');
    secret.value = 'late-token';
    await client.run('systemInfo');

    expect(headersOf(calls[0]).has('authorization')).toBe(false);
    expect(headersOf(calls[1]).get('authorization')).toBe('Bearer late-token');
  });
});

describe('failing', () => {
  it('keeps the code the service sent, which is the localisation key', async () => {
    const { client } = clientWith(() => problem(404, 'NS-PROJECT-4041'));

    const result = await client.run('getProject', { params: { project_id: 'gone' } });
    const failed = failure(result);

    expect(failed.kind).toBe('api');
    expect(failed.status).toBe(404);
    expect(failed.code).toBe('NS-PROJECT-4041');
    expect(failed.title).toBe('No project with that id is open here');
  });

  it('says what happened even when the body is not a problem document', async () => {
    const { client } = clientWith(() => new Response('upstream exploded', { status: 502 }));

    const failed = failure(await client.run('systemInfo'));

    expect(failed.code).toBe('http/502');
    expect(failed.status).toBe(502);
  });

  it('answers a service that is not there as a problem, not an exception', async () => {
    const { client } = clientWith(() => {
      throw new TypeError('fetch failed');
    });

    const failed = failure(await client.run('systemInfo'));

    expect(failed.kind).toBe('transport');
    expect(failed.status).toBe(0);
    expect(failed.code).toBe('transport/unreachable');
    expect(failed.detail).toContain('fetch failed');
  });

  it('distinguishes a deadline it set from a cancellation the caller asked for', async () => {
    const timedOut = clientWith(neverAnswers(), { timeoutMs: 5 });
    const timeout = failure(await timedOut.client.run('systemInfo'));
    expect(timeout.kind).toBe('timeout');
    expect(timeout.code).toBe('transport/timeout');

    const controller = new AbortController();
    const cancelled = clientWith(neverAnswers(), { timeoutMs: 0 });
    const pending = cancelled.client.run('systemInfo', { signal: controller.signal });
    controller.abort();
    const aborted = failure(await pending);
    expect(aborted.kind).toBe('aborted');
    expect(aborted.code).toBe('transport/aborted');
  });

  it('gives up at once on a signal that was already cancelled', async () => {
    const { client, calls } = clientWith(neverAnswers());
    const controller = new AbortController();
    controller.abort();

    const result = await client.run('systemInfo', { signal: controller.signal });

    expect(failure(result).kind).toBe('aborted');
    // A cancelled request is still *sent* — the service may already have it.
    expect(calls).toHaveLength(1);
  });

  it('refuses bytes that are not the document it asked for', async () => {
    const { client } = clientWith(
      () =>
        new Response('not json at all', { status: 200, headers: { 'content-type': 'text/html' } }),
    );

    const failed = failure(await client.run('systemInfo'));

    expect(failed.kind).toBe('decode');
    expect(failed.code).toBe('transport/decode');
    expect(failed.detail).toContain('text/html');
  });

  it('has a deadline by default, because one day the service will be busy', async () => {
    const { client, calls } = clientWith(() => json(200, {}));
    await client.run('systemInfo');
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe('reading bytes that are not documents', () => {
  it('asks for a picture and answers with one', async () => {
    const { client, calls } = clientWith(
      () =>
        new Response(new Blob(['jpeg']), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        }),
    );

    const result = await client.run('previewFrame', { params: { project_id: 'p1' } });

    expect(value(result)).toBeInstanceOf(Blob);
    expect(headersOf(calls[0]).get('accept')).toBe('image/*');
  });

  it('keeps the headers that came with the picture, because half the answer is in them', async () => {
    const { client } = clientWith(
      () =>
        new Response(new Blob(['jpeg']), {
          status: 200,
          headers: {
            'content-type': 'image/jpeg',
            'X-Nova-Preview-Scale': '0.500000',
            'X-Nova-Preview-Size': '960x540',
          },
        }),
    );

    const result = await client.runBlob('previewFrame', { params: { project_id: 'p1' } });

    const answered = value(result);
    expect(answered.blob).toBeInstanceOf(Blob);
    expect(answered.headers.get('x-nova-preview-scale')).toBe('0.500000');
  });

  it('reports a failure on a picture the same way it reports one on a document', async () => {
    const { client } = clientWith(() => problem(404, 'NS-PROJECT-4040'));

    const result = await client.runBlob('previewFrame', { params: { project_id: 'gone' } });

    expect(failure(result).code).toBe('NS-PROJECT-4040');
  });

  it('answers a 204 with nothing, and says so in the type', async () => {
    const { client } = clientWith(() => new Response(null, { status: 204 }));

    const result = await client.run('cancelJob', { params: { job_id: 'j1' } });

    expect(result.ok).toBe(true);
    expect(value(result)).toBeUndefined();
  });
});

describe('building a url without asking for it', () => {
  it('answers in the same shape the request would have used', () => {
    const { client } = clientWith(() => json(200, {}));
    expect(client.url('ensureMedia', { params: { project_id: 'p1' } })).toBe(
      '/api/v1/projects/p1/media/ensure',
    );
  });
});
