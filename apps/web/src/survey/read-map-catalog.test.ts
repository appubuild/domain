// @vitest-environment node
import { expect, it } from 'vitest';
import { readMapCatalog } from './read-map-catalog';
it('reads bounded UTF-8 public catalog configuration', async () => {
  expect(await readMapCatalog(new Response('{"version":1,"allowCommunityOsm":true,"providers":[]}'))).toEqual({ version: 1, allowCommunityOsm: true, providers: [] });
  await expect(readMapCatalog(new Response('x'.repeat(32769)))).rejects.toThrow('too large');
  await expect(readMapCatalog(new Response(new Uint8Array([0xff])))).rejects.toThrow();
  await expect(readMapCatalog(new Response('missing', { status: 404 }))).rejects.toThrow();
});
