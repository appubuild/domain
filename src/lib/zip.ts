/**
 * Minimal ZIP writer (STORE method, no compression).
 *
 * Used by the Phase 1 export engine to produce genuinely valid EPUB and DOCX
 * archives in the browser. Real publishing pipelines will move to a server-side
 * renderer; the archive format below is standards-compliant for both.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Path inside the archive, using forward slashes. */
  name: string;
  content: string | Uint8Array;
  /** When true the entry is flagged as the uncompressed mimetype entry (EPUB). */
  storedFirst?: boolean;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function dosDateTime(date = new Date()) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() / 2)) & 0xffff;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, day };
}

export function createZip(entries: ZipEntry[]): Blob {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const { time, day } = dosDateTime();

  entries.forEach((entry) => {
    const data = typeof entry.content === 'string' ? utf8(entry.content) : entry.content;
    const nameBytes = utf8(entry.name);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true); // version needed
    view.setUint16(6, 0, true); // flags
    view.setUint16(8, 0, true); // method: store
    view.setUint16(10, time, true);
    view.setUint16(12, day, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    chunks.push(local, data);
    if (entry.storedFirst) offset = 0;

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cview = new DataView(centralHeader.buffer);
    cview.setUint32(0, 0x02014b50, true);
    cview.setUint16(4, 20, true);
    cview.setUint16(6, 20, true);
    cview.setUint16(8, 0, true);
    cview.setUint16(10, 0, true);
    cview.setUint16(12, time, true);
    cview.setUint16(14, day, true);
    cview.setUint32(16, crc, true);
    cview.setUint32(20, data.length, true);
    cview.setUint32(24, data.length, true);
    cview.setUint16(28, nameBytes.length, true);
    cview.setUint16(30, 0, true);
    cview.setUint16(32, 0, true);
    cview.setUint16(34, 0, true);
    cview.setUint16(36, 0, true);
    cview.setUint32(38, 0, true);
    cview.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    central.push(centralHeader);

    offset += local.length + data.length;
  });

  const centralSize = central.reduce((total, chunk) => total + chunk.length, 0);
  const end = new Uint8Array(22);
  const eview = new DataView(end.buffer);
  eview.setUint32(0, 0x06054b50, true);
  eview.setUint16(8, entries.length, true);
  eview.setUint16(10, entries.length, true);
  eview.setUint32(12, centralSize, true);
  eview.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, end] as BlobPart[], { type: 'application/zip' });
}
