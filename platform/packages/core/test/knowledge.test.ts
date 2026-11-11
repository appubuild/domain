import { describe, expect, it } from 'vitest';
import { deflateRawSync, deflateSync, inflateSync, inflateRawSync } from 'node:zlib';
import { chunkText, detectFormat, extractText } from '../src/knowledge/extract.js';
import { extractDocx, extractXlsx, readZip } from '../src/knowledge/extract.js';

const inflate = { inflate: (d: Uint8Array) => new Uint8Array(inflateSync(d)), inflateRaw: (d: Uint8Array) => new Uint8Array(inflateRawSync(d)) };
const enc = new TextEncoder();

describe('document extraction', () => {
  it('detects supported formats', () => {
    expect(detectFormat('a.PDF')).toBe('pdf');
    expect(detectFormat('b.docx')).toBe('docx');
    expect(detectFormat('c.xlsx')).toBe('xlsx');
    expect(detectFormat('d.md')).toBe('markdown');
    expect(detectFormat('e.exe')).toBe('unsupported');
  });

  it('extracts plain text, markdown, csv and html', () => {
    expect(extractText('a.txt', enc.encode('hello world'), inflate).text).toBe('hello world');
    expect(extractText('a.md', enc.encode('# Title\n\nBody'), inflate).format).toBe('markdown');
    expect(extractText('a.csv', enc.encode('a,b\n1,2'), inflate).text).toBe('a,b\n1,2');
    const html = extractText('a.html', enc.encode('<h1>Hi</h1><p>There</p>'), inflate);
    expect(html.text).toBe('Hi\nThere');
  });

  it('reports unsupported types honestly', () => {
    const r = extractText('a.exe', new Uint8Array([1, 2, 3]), inflate);
    expect(r.format).toBe('unsupported');
    expect(r.warning).toMatch(/Unsupported file type/);
  });

  it('extracts text from a real generated PDF content stream', () => {
    // Minimal PDF with one Flate-compressed content stream and two text ops.
    const content = 'BT /F1 12 Tf 72 720 Td (Hello from AURA report.) Tj 0 -14 Td (Second line here.) Tj ET';
    const compressed = new Uint8Array(deflateSync(Buffer.from(content, 'latin1')));
    const head = enc.encode('%PDF-1.4\n1 0 obj << /Type /Page /Length ' + compressed.length + ' >>\n');
    const streamStart = enc.encode('stream\n');
    const streamEnd = enc.encode('\nendstream\nendobj\n%%EOF');
    const bytes = new Uint8Array(head.length + streamStart.length + compressed.length + streamEnd.length);
    bytes.set(head, 0);
    bytes.set(streamStart, head.length);
    bytes.set(compressed, head.length + streamStart.length);
    bytes.set(streamEnd, head.length + streamStart.length + compressed.length);
    const r = extractText('report.pdf', bytes, inflate);
    expect(r.format).toBe('pdf');
    expect(r.text).toContain('Hello from AURA report.');
    expect(r.text).toContain('Second line here.');
  });

  it('says so when a PDF contains no extractable text', () => {
    const bytes = enc.encode('%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF');
    const r = extractText('scan.pdf', bytes, inflate);
    expect(r.warning).toMatch(/scanned|no extractable text/i);
    expect(r.text).toBe('');
  });

  it('reads a zip archive and DOCX XML', () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t>docx</w:t></w:r></w:p></w:body></w:document>';
    const zip = makeZip({ 'word/document.xml': xml });
    const entries = readZip(zip, inflate);
    expect([...entries.keys()]).toEqual(['word/document.xml']);
    expect(extractDocx(zip, inflate)).toContain('Hello docx');
  });

  it('reads an XLSX sheet with shared strings', () => {
    const zip = makeZip({
      'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><t>Alfa</t></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row><c><v>42</v></c></row></sheetData></worksheet>',
    });
    const text = extractXlsx(zip, inflate);
    expect(text).toContain('Name\tAlfa');
    expect(text).toContain('42');
  });

  it('chunks long text with overlap and no tiny fragments', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ${'lorem ipsum '.repeat(20)}`).join('\n\n');
    const chunks = chunkText(text, { maxChars: 600, overlap: 80 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(600);
      expect(c.length).toBeGreaterThan(20);
    }
  });
});

function makeZip(files: Record<string, string>): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const deflateRaw = (data: Uint8Array) => new Uint8Array(deflateRawSync(Buffer.from(data)));
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(content);
    const comp = deflateRaw(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(8, 8, true);
    dv.setUint32(18, comp.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    chunks.push(local, comp);
    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, comp.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);
    central.push(cen);
    offset += local.length + comp.length;
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, Object.keys(files).length, true);
  ev.setUint16(10, Object.keys(files).length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const all = [...chunks, ...central, eocd];
  const total = all.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
