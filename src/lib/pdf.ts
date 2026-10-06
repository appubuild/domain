/**
 * Minimal PDF writer (PDF 1.4, standard base-14 fonts, WinAnsi encoding).
 *
 * Phase 1 uses this to produce real, searchable, printable PDFs from the book
 * document model — including trim-size pages, mirror margins, running heads,
 * page numbers, chapter breaks and crop marks for print profiles.
 */

type FontName = 'Roman' | 'Bold' | 'Italic' | 'BoldItalic' | 'Mono';

const FONT_RESOURCE: Record<FontName, { base: string; metrics: string }> = {
  Roman: { base: 'Times-Roman', metrics: 'F1' },
  Bold: { base: 'Times-Bold', metrics: 'F2' },
  Italic: { base: 'Times-Italic', metrics: 'F3' },
  BoldItalic: { base: 'Times-BoldItalic', metrics: 'F4' },
  Mono: { base: 'Courier', metrics: 'F5' },
};

/** Approximate advance widths (1/1000 em) for Times-like text. Good enough for layout. */
const WIDTHS: Record<string, number> = { ' ': 250, '!': 333, '"': 408, '#': 500, $: 500, '%': 833, '&': 778, "'": 180, '(': 333, ')': 333, '*': 500, '+': 564, ',': 250, '-': 333, '.': 250, '/': 278, ':': 278, ';': 278, '<': 564, '=': 564, '>': 564, '?': 444, '@': 921, '[': 333, '\\': 278, ']': 333, '^': 469, _: 500, '`': 333, '{': 480, '|': 200, '}': 480, '~': 541 };
const UPPER = 722;
const LOWER = 500;

function charWidth(char: string): number {
  if (WIDTHS[char] !== undefined) return WIDTHS[char];
  if (char >= 'A' && char <= 'Z') return UPPER;
  if (char >= 'a' && char <= 'z') return LOWER;
  if (char >= '0' && char <= '9') return 500;
  return LOWER;
}

export function textWidth(text: string, size: number, font: FontName = 'Roman') {
  const factor = font === 'Bold' || font === 'BoldItalic' ? 1.04 : 1;
  let total = 0;
  for (const char of text) total += charWidth(char);
  return (total / 1000) * size * factor;
}

function escapeText(text: string) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export interface PdfTextOptions {
  size?: number;
  font?: FontName;
  color?: [number, number, number];
  align?: 'left' | 'center' | 'right' | 'justify';
  lineHeight?: number;
  indent?: number;
  spaceAfter?: number;
  letterSpacing?: number;
}

export interface PdfPageMeta {
  /** Full media box size including bleed. */
  mediaWidth: number;
  mediaHeight: number;
  /** Trim box offset from media edges (bleed). */
  trimOffsetX: number;
  trimOffsetY: number;
  /** Margin box in points, relative to the trim box. */
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  /** Optional running head / footer content. */
  headerLeft?: string;
  headerRight?: string;
  footerCenter?: string;
  /** Crop marks for print profiles. */
  cropMarks?: boolean;
}

export class PdfDocument {
  private pages: string[] = [];
  private current: string[] = [];
  private readonly meta: PdfPageMeta;
  private y = 0;
  private pageNumber = 0;

  constructor(meta: PdfPageMeta) {
    this.meta = meta;
    this.newPage();
  }

  get contentWidth() {
    const { mediaWidth, trimOffsetX, marginLeft, marginRight } = this.meta;
    return mediaWidth - trimOffsetX * 2 - marginLeft - marginRight;
  }

  get currentPageNumber() {
    return this.pageNumber;
  }

  newPage() {
    if (this.current.length) this.pages.push(this.current.join('\n'));
    this.current = [];
    this.pageNumber += 1;
    const { marginTop, marginBottom, trimOffsetY, mediaHeight, mediaWidth, headerLeft, headerRight, footerCenter, cropMarks } = this.meta;
    this.y = mediaHeight - trimOffsetY - marginTop;
    if (cropMarks) this.drawCropMarks();
    if (headerLeft) this.text(headerLeft, { size: 8, font: 'Italic', color: [0.35, 0.35, 0.35] }, 'header-left');
    if (headerRight) {
      const width = textWidth(headerRight, 8, 'Italic');
      this.write(this.meta.mediaWidth - this.meta.trimOffsetX - this.meta.marginRight - width, mediaHeight - trimOffsetY - marginTop + 14, headerRight, { size: 8, font: 'Italic', color: [0.35, 0.35, 0.35] });
    }
    if (footerCenter) {
      const width = textWidth(footerCenter, 9, 'Roman');
      const x = this.meta.trimOffsetX + (this.meta.mediaWidth - this.meta.trimOffsetX * 2) / 2 - width / 2;
      this.write(x, trimOffsetY + marginBottom / 2, footerCenter, { size: 9, font: 'Roman', color: [0.25, 0.25, 0.25] });
    }
    void marginBottom;
  }

  private drawCropMarks() {
    const { trimOffsetX, trimOffsetY, mediaWidth, mediaHeight } = this.meta;
    const mark = 18;
    const line = (x1: number, y1: number, x2: number, y2: number) => {
      this.current.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
    };
    this.current.push('0 0 0 RG 0.5 w');
    line(trimOffsetX, mediaHeight - trimOffsetY + 3, trimOffsetX, mediaHeight - trimOffsetY + 3 + mark);
    line(mediaWidth - trimOffsetX, mediaHeight - trimOffsetY + 3, mediaWidth - trimOffsetX, mediaHeight - trimOffsetY + 3 + mark);
    line(trimOffsetX, trimOffsetY - 3, trimOffsetX, trimOffsetY - 3 - mark);
    line(mediaWidth - trimOffsetX, trimOffsetY - 3, mediaWidth - trimOffsetX, trimOffsetY - 3 - mark);
    line(trimOffsetX - 3, mediaHeight - trimOffsetY, trimOffsetX - 3 - mark, mediaHeight - trimOffsetY);
    line(mediaWidth - trimOffsetX + 3, mediaHeight - trimOffsetY, mediaWidth - trimOffsetX + 3 + mark, mediaHeight - trimOffsetY);
    line(trimOffsetX - 3, trimOffsetY, trimOffsetX - 3 - mark, trimOffsetY);
    line(mediaWidth - trimOffsetX + 3, trimOffsetY, mediaWidth - trimOffsetX + 3 + mark, trimOffsetY);
  }

  private write(x: number, y: number, text: string, options: PdfTextOptions = {}) {
    const { size = 11, font = 'Roman', color = [0, 0, 0] } = options;
    const resource = FONT_RESOURCE[font].metrics;
    this.current.push(
      `BT /${resource} ${size} Tf ${color[0]} ${color[1]} ${color[2]} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapeText(text)}) Tj ET`,
    );
  }

  private text(text: string, options: PdfTextOptions, position: 'header-left' | 'body' = 'body') {
    if (position === 'header-left') {
      this.write(this.meta.trimOffsetX + this.meta.marginLeft, this.meta.mediaHeight - this.meta.trimOffsetY - this.meta.marginTop + 14, text, options);
    }
  }

  /** Writes a wrapped block of text, creating pages as required. */
  paragraph(text: string, options: PdfTextOptions = {}) {
    const { size = 11, font = 'Roman', lineHeight = 1.5, align = 'left', indent = 0, spaceAfter = 0, letterSpacing = 0 } = options;
    const width = this.contentWidth - indent;
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length) {
      this.y -= size * lineHeight + spaceAfter;
      return;
    }
    const lines: string[] = [];
    let line = '';
    const effectiveWidth = (value: string) => textWidth(value, size, font) + letterSpacing * value.length;
    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (effectiveWidth(candidate) > width && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    });
    if (line) lines.push(line);

    const left = this.meta.trimOffsetX + this.meta.marginLeft + indent;
    lines.forEach((lineText, index) => {
      if (this.y - size * lineHeight < this.meta.trimOffsetY + this.meta.marginBottom) {
        this.newPage();
      }
      const lineWidth = effectiveWidth(lineText);
      let x = left;
      if (align === 'center') x = left + (width - lineWidth) / 2;
      else if (align === 'right') x = left + (width - lineWidth);
      this.write(x, this.y - size, lineText, { size, font, color: options.color ?? [0.08, 0.08, 0.1], letterSpacing });
      void index;
      this.y -= size * lineHeight;
    });
    this.y -= spaceAfter;
  }

  spacer(points: number) {
    this.y -= points;
  }

  /** Reserves vertical space, adding a page when the remaining space is short. */
  ensureSpace(points: number) {
    if (this.y - points < this.meta.trimOffsetY + this.meta.marginBottom) this.newPage();
  }

  build(): Blob {
    if (this.current.length) this.pages.push(this.current.join('\n'));
    const objects: string[] = [];
    const pageCount = this.pages.length;
    // 1: catalog, 2: pages, 3: font Roman, 4: Bold, 5: Italic, 6: BoldItalic, 7: Mono
    const firstPageObject = 8;
    const pageRefs = Array.from({ length: pageCount }, (_, i) => `${firstPageObject + i * 2} 0 R`).join(' ');

    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = `<< /Type /Pages /Kids [${pageRefs}] /Count ${pageCount} >>`;
    (Object.keys(FONT_RESOURCE) as FontName[]).forEach((font, index) => {
      objects[3 + index] = `<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_RESOURCE[font].base} /Encoding /WinAnsiEncoding >>`;
    });

    this.pages.forEach((content, index) => {
      const pageObj = firstPageObject + index * 2;
      const contentObj = pageObj + 1;
      const { mediaWidth, mediaHeight, trimOffsetX, trimOffsetY, cropMarks } = this.meta;
      const trimBox = `[${trimOffsetX} ${trimOffsetY} ${mediaWidth - trimOffsetX} ${mediaHeight - trimOffsetY}]`;
      objects[pageObj] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${mediaWidth.toFixed(2)} ${mediaHeight.toFixed(2)}] ${
        cropMarks ? `/TrimBox ${trimBox} /BleedBox [0 0 ${mediaWidth.toFixed(2)} ${mediaHeight.toFixed(2)}] ` : ''
      }/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R /F5 7 0 R >> >> /Contents ${contentObj} 0 R >>`;
      objects[contentObj] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    });

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    for (let i = 1; i < objects.length; i += 1) {
      if (!objects[i]) continue;
      offsets[i] = pdf.length;
      pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefOffset = pdf.length;
    const maxObject = objects.length;
    pdf += `xref\n0 ${maxObject}\n0000000000 65535 f \n`;
    for (let i = 1; i < maxObject; i += 1) {
      const offset = offsets[i] ?? 0;
      pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${maxObject} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return new Blob([pdf], { type: 'application/pdf' });
  }
}

export const INCH = 72;
