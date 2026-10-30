/** Reject oversized images before asking the browser's decoder to allocate pixels. */
export function referenceImageDimensions(bytes: Uint8Array, mime: string): { width: number; height: number } {
  let width = 0; let height = 0;
  if (mime === 'image/png' && bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n) &&
      bytes[8] === 0 && bytes[9] === 0 && bytes[10] === 0 && bytes[11] === 13 && String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (mime === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const sof = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
    let index = 2;
    while (index < bytes.length) {
      if (bytes[index++] !== 0xff) break;
      while (index < bytes.length && bytes[index] === 0xff) index++;
      const marker = bytes[index++];
      if (marker === 0xda || marker === 0xd9 || marker === undefined) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (index + 2 > bytes.length) break;
      const length = bytes[index] * 256 + bytes[index + 1];
      if (length < 2 || index + length > bytes.length) break;
      if (sof.has(marker)) {
        if (length < 8) break;
        height = bytes[index + 3] * 256 + bytes[index + 4];
        width = bytes[index + 5] * 256 + bytes[index + 6];
        break;
      }
      index += length;
    }
  }
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16_000_000) throw new Error('Invalid or oversized image');
  return { width, height };
}
