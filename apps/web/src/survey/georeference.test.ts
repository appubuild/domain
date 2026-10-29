import { expect, it } from 'vitest';
import { parseOverlayBounds } from './georeference';
it('builds correctly ordered WGS84 corner coordinates', () => {
  expect(parseOverlayBounds({ west: '90.1', east: '90.9', south: '23.1', north: '23.9' })).toEqual([[90.1,23.9],[90.9,23.9],[90.9,23.1],[90.1,23.1]]);
});
it.each([
  { west: '', east: '90', south: '23', north: '24' },
  { west: '91', east: '90', south: '23', north: '24' },
  { west: '90', east: '91', south: '24', north: '23' },
  { west: '-179', east: '179', south: '23', north: '24' },
  { west: '90', east: '91', south: '23', north: '86' },
  { west: 'Infinity', east: '91', south: '23', north: '24' },
  { west: '90e1', east: '91', south: '23', north: '24' },
])('rejects unsupported or invalid bounds', bounds => { expect(() => parseOverlayBounds(bounds)).toThrow(); });
