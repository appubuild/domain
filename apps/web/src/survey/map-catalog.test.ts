import { describe, expect, it } from 'vitest';
import { parseMapCatalog } from '../../../../packages/map-catalog/src';
const provider = { id: 'example', name: 'Example map', tileUrl: 'https://tiles.example.com/{z}/{x}/{y}.png', tileSize: 256, maxZoom: 19, attribution: 'Example data', attributionUrl: 'https://example.com/terms' };
const config = (providers: unknown[]) => ({ version: 1, allowCommunityOsm: false, providers });
describe('public map catalog configuration', () => {
  it('accepts valid public raster providers and an empty catalog', () => {
    expect(parseMapCatalog(config([provider])).providers[0]).toEqual(provider);
    expect(parseMapCatalog(config([])).providers).toEqual([]);
  });
  it.each([
    'http://tiles.example.com/{z}/{x}/{y}.png', 'https://user:pass@example.com/{z}/{x}/{y}.png',
    'https://tiles.example.com/{z}/{x}/{y}.png?key=secret', 'https://localhost/{z}/{x}/{y}',
    'https://192.168.1.1/{z}/{x}/{y}', 'https://localhost./{z}/{x}/{y}',
    'https://router.local./{z}/{x}/{y}', 'https://0x7f000001/{z}/{x}/{y}', 'https://tiles.example.com/{z}/{x}.png',
    'https://{z}.example.com/{x}/{y}', 'https://tiles.example.com/{z}/{x}/{y}/{extra}',
  ])('rejects unsafe or unsupported tile template %s', tileUrl => {
    expect(() => parseMapCatalog(config([{ ...provider, tileUrl }]))).toThrow();
  });
  it('rejects reserved and duplicate ids, invalid links, unsupported versions and extra fields', () => {
    expect(() => parseMapCatalog(config([{ ...provider, id: 'osm' }]))).toThrow();
    expect(() => parseMapCatalog(config([provider, provider]))).toThrow();
    expect(() => parseMapCatalog(config([{ ...provider, attributionUrl: 'javascript:alert(1)' }]))).toThrow();
    expect(() => parseMapCatalog({ ...config([]), version: 2 })).toThrow();
    expect(() => parseMapCatalog({ ...config([]), token: 'secret' })).toThrow();
  });
});
