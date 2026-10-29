import { expect, it } from 'vitest';
import { referenceImageDimensions } from './reference-image';
const png = (w: number, h: number) => {
  const result = new Uint8Array(24); result.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
  const view = new DataView(result.buffer); view.setUint32(16, w); view.setUint32(20, h); return result;
};
const jpeg = (w: number, h: number) => new Uint8Array([0xff,0xd8,0xff,0xe0,0,4,0,0,0xff,0xc0,0,8,8,h >> 8,h & 255,w >> 8,w & 255,3]);
it('checks image signatures and sizes before decoding PNG and JPEG', () => {
  expect(referenceImageDimensions(png(256, 256), 'image/png')).toEqual({ width: 256, height: 256 });
  expect(referenceImageDimensions(jpeg(300, 200), 'image/jpeg')).toEqual({ width: 300, height: 200 });
  expect(() => referenceImageDimensions(png(20000, 20000), 'image/png')).toThrow();
  expect(() => referenceImageDimensions(jpeg(4001, 4001), 'image/jpeg')).toThrow();
  expect(() => referenceImageDimensions(png(100, 100), 'image/jpeg')).toThrow();
  expect(() => referenceImageDimensions(new Uint8Array([0xff,0xd8,0xff,0xe0,0xff,0xff]), 'image/jpeg')).toThrow();
});
