import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, apiDelete, apiGet, apiPost } from '@/lib/api';

type FetchArgs = [input: string, init?: RequestInit];

function mockFetch(response: { ok: boolean; status: number; body: unknown }) {
  // Typed spy so assertions can read the captured (input, init) pair without casts.
  const spy = vi.fn<(...args: FetchArgs) => Promise<Response>>(async () =>
    new Response(typeof response.body === 'string' ? response.body : JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('api client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('prefixes /api and parses JSON', async () => {
    const spy = mockFetch({ ok: true, status: 200, body: { hello: 'world' } });
    const data = await apiGet<{ hello: string }>('/health');
    expect(data.hello).toBe('world');
    expect(spy.mock.calls[0]?.[0]).toBe('/api/health');
  });

  it('sends JSON bodies with the right content type', async () => {
    const spy = mockFetch({ ok: true, status: 201, body: { id: 'x' } });
    await apiPost('/characters', { name: 'Aria' });
    const init = spy.mock.calls[0]?.[1];
    expect(init).toBeDefined();
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ name: 'Aria' }));
    expect((init?.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('surfaces the server error message and status', async () => {
    mockFetch({ ok: false, status: 409, body: { error: 'A character named "Aria" already exists.' } });
    await expect(apiPost('/characters', {})).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      message: 'A character named "Aria" already exists.',
    });
  });

  it('flags confirmation-required responses (428)', async () => {
    mockFetch({ ok: false, status: 428, body: { error: 'Approval required' } });
    try {
      await api('/tasks/1/step', { method: 'POST' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).needsConfirmation).toBe(true);
    }
  });

  it('falls back to a status message for non-JSON error bodies', async () => {
    mockFetch({ ok: false, status: 502, body: '<html>bad gateway</html>' });
    await expect(apiGet('/broken')).rejects.toThrow('Request failed (502)');
  });

  it('omits the body for GET and DELETE', async () => {
    const spy = mockFetch({ ok: true, status: 200, body: { ok: true } });
    await apiDelete('/memory/abc');
    const init = spy.mock.calls[0]?.[1];
    expect(init).toBeDefined();
    expect(init?.body).toBeUndefined();
    expect(init?.method).toBe('DELETE');
  });
});
