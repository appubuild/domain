import { describe, expect, it, vi } from 'vitest';
import { readUtf8File } from './read-utf8-file';

describe('strict transfer file decoding', () => {
  it('preserves valid multilingual text, including a real replacement character', async () => {
    const content = 'জমি Field �';
    expect(await readUtf8File(new File([content], 'valid.json'), 128)).toBe(content);
  });
  it('rejects malformed UTF-8 rather than replacing bytes', async () => {
    const bytes = new Uint8Array([0x61, 0xc3, 0x28, 0x62]);
    await expect(readUtf8File(new File([bytes], 'invalid.json'), 128)).rejects.toThrow();
  });
  it('checks file size before reading and propagates read failures', async () => {
    const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer');
    try {
      await expect(readUtf8File(new File(['12345'], 'oversize'), 4)).rejects.toThrow('size limit');
      expect(read).not.toHaveBeenCalled();
      read.mockImplementation(() => { throw new Error('read failed'); });
      await expect(readUtf8File(new File(['123'], 'blocked'), 4)).rejects.toThrow('read failed');
    } finally { read.mockRestore(); }
  });
});
