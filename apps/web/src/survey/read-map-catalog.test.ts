// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { loadMapCatalog, readMapCatalog } from './read-map-catalog';

afterEach(() => vi.unstubAllGlobals());

it('reads bounded UTF-8 public catalog configuration', async () => {
  expect(await readMapCatalog(new Response('{"version":1,"allowCommunityOsm":true,"providers":[]}'))).toEqual({ version: 1, allowCommunityOsm: true, providers: [] });
  await expect(readMapCatalog(new Response('x'.repeat(32769)))).rejects.toThrow('too large');
  await expect(readMapCatalog(new Response(new Uint8Array([0xff])))).rejects.toThrow();
  await expect(readMapCatalog(new Response('missing', { status: 404 }))).rejects.toThrow();
});

it('uses same-origin session credentials to read deployment-protected preview config', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{"version":1,"allowCommunityOsm":true,"providers":[]}'));
  vi.stubGlobal('fetch', fetchMock);
  const controller = new AbortController();

  await expect(loadMapCatalog('/app/', controller.signal)).resolves.toMatchObject({ allowCommunityOsm: true });
  expect(fetchMock).toHaveBeenCalledWith('/app/map-catalog.json', {
    signal: controller.signal,
    credentials: 'same-origin',
    cache: 'no-cache',
  });
});
