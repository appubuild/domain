import { htmlToText } from '../skills/builtin.js';

/**
 * Document text extraction with zero third-party dependencies.
 * PDF: FlateDecode streams + text operators (covers the majority of text PDFs; scanned
 *      image PDFs are reported as needing OCR rather than returning garbage).
 * DOCX/XLSX: minimal ZIP reader + XML text extraction.
 * The `inflate`/`inflateRaw` functions are injected so this module stays platform-neutral.
 */
export type Inflate = { inflate(data: Uint8Array): Uint8Array; inflateRaw(data: Uint8Array): Uint8Array };

export type ExtractionResult = {
  text: string;
  format: 'text' | 'markdown' | 'csv' | 'json' | 'html' | 'pdf' | 'docx' | 'xlsx' | 'unsupported';
  pages?: number;
  warning?: string;
};

const TEXT_EXT = /\.(txt|log|md|markdown|json|csv|tsv|yml|yaml|xml|html?|css|js|ts|tsx|jsx|py|rs|go|java|c|cpp|h|sh|sql|toml|ini)$/i;

export function detectFormat(fileName: string): ExtractionResult['format'] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) return 'csv';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (TEXT_EXT.test(lower)) return 'text';
  return 'unsupported';
}

export function extractText(fileName: string, bytes: Uint8Array, inflate: Inflate | null): ExtractionResult {
  const format = detectFormat(fileName);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  switch (format) {
    case 'text':
    case 'markdown':
    case 'csv':
    case 'json':
      return { text: normalize(decoder.decode(bytes)), format };
    case 'html':
      return { text: normalize(htmlToText(decoder.decode(bytes))), format };
    case 'pdf': {
      if (!inflate) return { text: '', format, warning: 'PDF extraction requires the node runtime (zlib).' };
      const res = extractPdfText(bytes, inflate);
      return { text: normalize(res.text), format, pages: res.pages, warning: res.warning };
    }
    case 'docx': {
      if (!inflate) return { text: '', format, warning: 'DOCX extraction requires the node runtime (zlib).' };
      return { text: normalize(extractDocx(bytes, inflate)), format };
    }
    case 'xlsx': {
      if (!inflate) return { text: '', format, warning: 'XLSX extraction requires the node runtime (zlib).' };
      return { text: normalize(extractXlsx(bytes, inflate)), format };
    }
    default:
      return { text: '', format: 'unsupported', warning: 'Unsupported file type. Supported: txt, md, csv, json, html, pdf, docx, xlsx.' };
  }
}

function bytesToLatin1(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

function latin1Bytes(raw: string, start: number, end: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, end - start));
  for (let i = 0; i < out.length; i++) out[i] = raw.charCodeAt(start + i) & 0xff;
  return out;
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ------------------------------------------------------------------- PDF */

export function extractPdfText(bytes: Uint8Array, inflate: Inflate): { text: string; pages: number; warning?: string } {
  // Decode byte-for-byte. (`TextDecoder('latin1')` is windows-1252 in Node, which
  // rewrites 0x80–0x9F and would corrupt binary streams.)
  const raw = bytesToLatin1(bytes);
  const streamRe = /stream\r?\n/g;
  const chunks: string[] = [];
  let pages = 0;
  let decodedStreams = 0;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(raw)) !== null) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end === -1) break;
    const dictStart = raw.lastIndexOf('<<', m.index);
    const dict = dictStart >= 0 ? raw.slice(dictStart, m.index) : '';
    // Many producers omit /Filter and the trailer dictionary (e.g. minimal PDFs);
    // in that case attempt inflation rather than discarding the stream.
    const explicitlyNotFlate = /\/Filter/.test(dict) && !/\/FlateDecode/.test(dict);
    if (explicitlyNotFlate) continue;
    // Decode as latin1 bytes so a binary stream can never be mangled by UTF-8.
    const slice = latin1Bytes(raw, start, end);
    let inflated: Uint8Array;
    try {
      inflated = inflate.inflate(slice);
      decodedStreams++;
    } catch {
      continue;
    }
    const content = bytesToLatin1(inflated);
    const text = pdfContentToText(content);
    if (text.trim()) chunks.push(text);
  }
  pages = (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length || chunks.length;
  if (chunks.length === 0) {
    return {
      text: '',
      pages,
      warning: decodedStreams === 0
        ? 'No decodable text streams found. This PDF may be scanned/image-only and needs OCR.'
        : 'PDF decoded but contained no extractable text operators (possibly vector/image-only pages).',
    };
  }
  return { text: chunks.join('\n\n'), pages };
}

function pdfContentToText(content: string): string {
  const lines: string[] = [];
  // TJ arrays: [(text) -120 (text)] TJ   and   Tj single strings
  const showRe = /\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:[^)\\]|\\.)*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = showRe.exec(content)) !== null) {
    const arrayBody = m[1];
    if (arrayBody !== undefined) {
      const parts: string[] = [];
      const strRe = /\(((?:[^)\\]|\\.)*)\)/g;
      let s: RegExpExecArray | null;
      while ((s = strRe.exec(arrayBody)) !== null) parts.push(unescapePdfString(s[1] ?? ''));
      lines.push(parts.join(''));
    } else if (m[2] !== undefined) {
      lines.push(unescapePdfString(m[2]));
    }
    if (lines.length > 40_000) break;
  }
  return lines.join(' ').replace(/\s+/g, ' ').replace(/([.!?])\s/g, '$1\n');
}

function unescapePdfString(s: string): string {
  return s
    .replace(/\\([nrtbf()\\])/g, (_all, c: string) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' } as Record<string, string>)[c] ?? c)
    .replace(/\\([0-7]{1,3})/g, (_all, oct: string) => String.fromCharCode(parseInt(oct, 8)));
}

/* ------------------------------------------------------------ ZIP (docx/xlsx) */

type ZipEntry = { name: string; data: Uint8Array };

export function readZip(bytes: Uint8Array, inflate: Inflate): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Find End Of Central Directory (scan backwards up to 64KB).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65536); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('Not a ZIP archive (no end-of-central-directory record).');
  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    // Local header: name+extra lengths can differ from central dir.
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    try {
      out.set(name, method === 0 ? compressed : inflate.inflateRaw(compressed));
    } catch {
      /* skip corrupt entry */
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function extractDocx(bytes: Uint8Array, inflate: Inflate): string {
  const zip = readZip(bytes, inflate);
  const doc = zip.get('word/document.xml');
  if (!doc) throw new Error('DOCX missing word/document.xml');
  const xml = new TextDecoder().decode(doc);
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function extractXlsx(bytes: Uint8Array, inflate: Inflate): string {
  const zip = readZip(bytes, inflate);
  const shared = zip.get('xl/sharedStrings.xml');
  const strings: string[] = [];
  if (shared) {
    const xml = new TextDecoder().decode(shared);
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      strings.push((m[1] ?? '').replace(/<[^>]+>/g, '').trim());
    }
  }
  const sheetNames = [...zip.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort();
  const out: string[] = [];
  for (const name of sheetNames) {
    const sheet = zip.get(name);
    if (!sheet) continue;
    const xml = new TextDecoder().decode(sheet);
    out.push(`## ${name.replace('xl/worksheets/', '').replace('.xml', '')}`);
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of (row[1] ?? '').matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = c[1] ?? '';
        const body = c[2] ?? '';
        const type = attrs.match(/\bt="([^"]+)"/)?.[1];
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? body.match(/<is><t[^>]*>([\s\S]*?)<\/t><\/is>/)?.[1] ?? '';
        cells.push(type === 's' ? (strings[Number(v)] ?? '') : v);
      }
      if (cells.some((c) => c !== '')) out.push(cells.join('\t'));
    }
  }
  return out.join('\n');
}

export function chunkText(text: string, opts: { maxChars?: number; overlap?: number } = {}): string[] {
  const maxChars = opts.maxChars ?? 1400;
  const overlap = opts.overlap ?? 180;
  if (!text.trim()) return [];
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    if ((current + '\n\n' + p).length <= maxChars) {
      current = current ? `${current}\n\n${p}` : p;
      continue;
    }
    if (current) chunks.push(current.trim());
    if (p.length <= maxChars) {
      current = p;
    } else {
      let start = 0;
      while (start < p.length) {
        chunks.push(p.slice(start, start + maxChars).trim());
        start += maxChars - overlap;
      }
      current = '';
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 20);
}
