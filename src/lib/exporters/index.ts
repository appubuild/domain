/**
 * Export engine.
 *
 * Every exporter reads the internal Book Document Model and writes its own
 * output. Nothing about the editor is coupled to a single format: PDF, print
 * PDF, EPUB 2/3, DOCX, HTML and plain text are separate builders behind one
 * interface, so a real rendering service can replace them individually.
 */
import type { Book, BookPage, BookSection, ExportFormat, PublishingProfileId } from '@/types/domain';
import { stripHtml } from '@/lib/utils';
import { PdfDocument, INCH, textWidth } from '@/lib/pdf';
import { createZip } from '@/lib/zip';

export interface ExportOptions {
  includeToc: boolean;
  includeCover: boolean;
  highResImages: boolean;
  embedFonts: boolean;
  cropMarks: boolean;
  profileId: PublishingProfileId;
}

export const defaultExportOptions: ExportOptions = {
  includeToc: true,
  includeCover: true,
  highResImages: true,
  embedFonts: true,
  cropMarks: false,
  profileId: 'digital-pdf',
};

export interface ExportResult {
  blob: Blob;
  fileName: string;
  mimeType: string;
  pages: number;
  sizeBytes: number;
  notes: string[];
}

/* ------------------------------------------------------------- helpers */

export function orderedSections(book: Book): BookSection[] {
  return [...book.sections].sort((a, b) => a.order - b.order);
}

export function sectionPages(book: Book, sectionId: string): BookPage[] {
  const section = book.sections.find((entry) => entry.id === sectionId);
  if (!section) return [];
  return section.pageIds
    .map((pageId) => book.pages.find((page) => page.id === pageId))
    .filter(Boolean) as BookPage[];
}

export function tocEntries(book: Book, depth = 2) {
  const entries: { title: string; level: number; pageNumber: number }[] = [];
  let counter = 1;
  let firstChapterSeen = false;
  orderedSections(book).forEach((section) => {
    if (section.kind === 'cover') return;
    const pages = sectionPages(book, section.id);
    const startNumber = firstChapterSeen ? counter : 1;
    if (section.kind === 'chapter' || section.kind === 'part') firstChapterSeen = true;
    entries.push({
      title: section.title,
      level: section.kind === 'part' ? 0 : 1,
      pageNumber: startNumber,
    });
    counter += pages.length;
  });
  // Pull in level-2 headings for deeper tables of contents.
  if (depth > 1) {
    orderedSections(book)
      .filter((section) => section.kind === 'chapter')
      .forEach((section) => {
        sectionPages(book, section.id).forEach((page) => {
          const headings = Array.from(page.content.matchAll(/<h2[^>]*>(.*?)<\/h2>/gi)).map((match) => stripHtml(match[1]));
          headings.forEach((heading) => {
            entries.push({ title: heading, level: 2, pageNumber: entries.find((entry) => entry.title === section.title)?.pageNumber ?? 1 });
          });
        });
      });
  }
  return entries;
}

interface Block {
  type: 'h1' | 'h2' | 'h3' | 'p' | 'quote' | 'li' | 'hr' | 'caption';
  text: string;
}

/** Parses stored rich-text HTML into simple block records for renderers. */
export function htmlToBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  const pattern = /<(h1|h2|h3|p|blockquote|li|hr|figcaption)[^>]*>([\s\S]*?)<\/\1>|<hr\s*\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const tag = match[1]?.toLowerCase();
    if (!tag) {
      blocks.push({ type: 'hr', text: '' });
      continue;
    }
    const text = decodeEntities(stripHtml(match[2] ?? ''));
    if (!text && tag !== 'p') continue;
    const type = (tag === 'blockquote' ? 'quote' : tag) as Block['type'];
    blocks.push({ type, text });
  }
  if (!blocks.length) {
    const text = decodeEntities(stripHtml(html));
    if (text) blocks.push({ type: 'p', text });
  }
  return blocks;
}

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&nbsp;/g, ' ');
}

export function bookPlainText(book: Book): string {
  const lines: string[] = [];
  lines.push(book.title.toUpperCase());
  if (book.subtitle) lines.push(book.subtitle);
  lines.push(`by ${book.authorName}`, '');
  orderedSections(book).forEach((section) => {
    if (section.kind === 'cover') return;
    lines.push('', '—'.repeat(40), section.title.toUpperCase(), '');
    sectionPages(book, section.id).forEach((page) => {
      htmlToBlocks(page.content).forEach((block) => {
        if (block.type === 'hr') lines.push('* * *');
        else lines.push(block.text, '');
      });
    });
  });
  return lines.join('\n');
}

/* ----------------------------------------------------------------- html */

export function buildHtml(book: Book, options: ExportOptions): string {
  const chapters = orderedSections(book)
    .filter((section) => section.kind !== 'cover')
    .map((section) => {
      const body = sectionPages(book, section.id)
        .map((page) => `<section class="page">${sanitize(page.content)}</section>`)
        .join('\n');
      return `<section class="chapter" id="s-${section.id}"><h1 class="chapter-title">${escapeHtml(section.title)}</h1>\n${body}</section>`;
    })
    .join('\n');

  const toc = options.includeToc
    ? `<nav class="toc"><h2>${escapeHtml(book.toc.title)}</h2><ol>${tocEntries(book, book.toc.depth)
        .filter((entry) => entry.level === 1)
        .map((entry) => `<li><a href="#s-${findSectionId(book, entry.title) ?? ''}">${escapeHtml(entry.title)}</a></li>`)
        .join('')}</ol></nav>`
    : '';

  return `<!doctype html>
<html lang="${book.metadata.language}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(book.title)}${book.subtitle ? ` — ${escapeHtml(book.subtitle)}` : ''}</title>
<meta name="author" content="${escapeHtml(book.authorName)}" />
<meta name="description" content="${escapeHtml(book.shortDescription || book.description.slice(0, 160))}" />
<meta property="og:title" content="${escapeHtml(book.title)}" />
<meta property="og:type" content="book" />
<meta name="book:isbn" content="${escapeHtml(book.metadata.isbn)}" />
<style>
  :root { --measure: ${book.trimSize.widthIn}in; --accent: ${book.theme.accentColor}; }
  body { font-family: "${book.fonts.body}", Georgia, serif; line-height: ${book.theme.lineHeight}; color: #111; background: #f6f5f2; margin: 0; }
  .book { max-width: calc(var(--measure) + 4rem); margin: 0 auto; padding: 3rem 2rem 6rem; background: #fff; }
  h1, h2, h3 { font-family: "${book.fonts.heading}", Georgia, serif; line-height: 1.2; }
  .chapter-title { font-size: 1.9rem; margin: 4rem 0 1.5rem; border-bottom: 2px solid var(--accent); padding-bottom: .4rem; }
  .chapter:first-of-type .chapter-title { margin-top: 0; }
  .page { margin-bottom: 1rem; }
  blockquote { border-left: 3px solid var(--accent); margin: 1.25rem 0; padding-left: 1rem; font-style: italic; color: #444; }
  .toc { background: #faf9f7; border: 1px solid #e6e3dd; padding: 1.25rem 1.5rem; border-radius: 8px; margin-bottom: 2.5rem; }
  .toc ol { margin: 0; padding-left: 1.2rem; }
  figcaption, caption { font-style: italic; color: #555; font-size: .9rem; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #ddd; padding: .4rem .6rem; }
  hr { border: none; border-top: 1px solid #ddd; margin: 1.5rem 0; }
  @media print { body { background: #fff; } .book { padding: 0; } }
</style>
</head>
<body>
<main class="book">
${options.includeCover ? `<header class="cover"><h1>${escapeHtml(book.title)}</h1>${book.subtitle ? `<p class="subtitle">${escapeHtml(book.subtitle)}</p>` : ''}<p class="author">${escapeHtml(book.authorName)}</p></header>` : ''}
${toc}
${chapters}
</main>
</body>
</html>`;
}

function findSectionId(book: Book, title: string) {
  return book.sections.find((section) => section.title === title)?.id;
}

function sanitize(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/javascript:/gi, '');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------------ pdf */

export function buildPdf(book: Book, options: ExportOptions): ExportResult {
  const isPrint = options.profileId === 'paperback' || options.profileId === 'kdp-print' || options.profileId === 'hardcover' || options.profileId === 'press-ready';
  const bleed = isPrint && book.bleed > 0 ? book.bleed : isPrint && ['paperback', 'hardcover', 'press-ready', 'kdp-print'].includes(options.profileId) ? 0.125 : 0;
  const trimWidth = book.trimSize.widthIn * INCH;
  const trimHeight = book.trimSize.heightIn * INCH;
  const mediaWidth = trimWidth + bleed * 2 * INCH;
  const mediaHeight = trimHeight + bleed * 2 * INCH;
  const notes: string[] = [];

  const headerLeft = book.headerFooter.headerEnabled ? resolvePlaceholder(book.headerFooter.headerLeft, book) : undefined;
  const footerCenter = book.headerFooter.footerEnabled
    ? book.headerFooter.footerCenter.replace('{page}', '{{page}}')
    : undefined;

  const doc = new PdfDocument({
    mediaWidth,
    mediaHeight,
    trimOffsetX: bleed * INCH,
    trimOffsetY: bleed * INCH,
    marginTop: book.margins.top * INCH,
    marginBottom: book.margins.bottom * INCH,
    marginLeft: book.margins.left * INCH,
    marginRight: book.margins.right * INCH,
    headerLeft,
    headerRight: undefined,
    footerCenter: undefined,
    cropMarks: options.cropMarks,
  });

  let pageNumber = 0;
  const startedAt = Date.now();

  orderedSections(book).forEach((section) => {
    if (section.kind === 'cover' && !options.includeCover) return;
    if (section.kind !== 'cover') {
      doc.ensureSpace(140);
      doc.spacer(24);
      doc.paragraph(section.title, { size: section.kind === 'chapter' ? 22 : 18, font: 'Bold', spaceAfter: 8, lineHeight: 1.25 });
      if (section.subtitle) doc.paragraph(section.subtitle, { size: 11, font: 'Italic', color: [0.35, 0.3, 0.5], spaceAfter: 14 });
      else doc.spacer(6);
    }
    sectionPages(book, section.id).forEach((page) => {
      pageNumber += 1;
      htmlToBlocks(page.content).forEach((block, blockIndex) => {
        switch (block.type) {
          case 'h1':
            doc.ensureSpace(60);
            doc.paragraph(block.text, { size: 19, font: 'Bold', spaceAfter: 8, lineHeight: 1.25 });
            break;
          case 'h2':
            doc.ensureSpace(48);
            doc.spacer(8);
            doc.paragraph(block.text, { size: 15, font: 'Bold', spaceAfter: 6, lineHeight: 1.3, color: [0.18, 0.16, 0.28] });
            break;
          case 'h3':
            doc.ensureSpace(40);
            doc.paragraph(block.text, { size: 12.5, font: 'Bold', spaceAfter: 4 });
            break;
          case 'quote':
            doc.ensureSpace(40);
            doc.spacer(4);
            doc.paragraph(`“${block.text}”`, { size: 10.5, font: 'Italic', indent: 24, spaceAfter: 10, color: [0.3, 0.3, 0.34] });
            break;
          case 'li':
            doc.paragraph(`•  ${block.text}`, { size: 11, indent: 14, spaceAfter: 2 });
            break;
          case 'caption':
            doc.paragraph(block.text, { size: 9, font: 'Italic', align: 'center', spaceAfter: 8, color: [0.4, 0.4, 0.44] });
            break;
          case 'hr':
            doc.spacer(8);
            doc.paragraph('* * *', { size: 11, align: 'center', spaceAfter: 8, color: [0.45, 0.45, 0.5] });
            break;
          default:
            doc.paragraph(
              blockIndex === 0 && book.theme.dropCaps && section.kind === 'chapter'
                ? block.text
                : block.text,
              { size: book.fonts.baseSize, lineHeight: book.theme.lineHeight, indent: book.theme.paragraphIndent * INCH, spaceAfter: 2 },
            );
        }
      });
      if (book.numbering.position !== 'none' && !(book.numbering.hideOnFirstPage && pageNumber === 1)) {
        const label = formatPageNumber(pageNumber + book.numbering.startAt - 1, book.numbering.style);
        if (label) {
          const width = textWidth(label, 9);
          const x = bleed * INCH + (mediaWidth - bleed * INCH * 2) / 2 - width / 2;
          const y = bleed * INCH + (book.margins.bottom * INCH) / 2;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (doc as unknown as { write: (x: number, y: number, text: string, o?: object) => void }).write(x, y, label, {
            size: 9,
            font: 'Roman',
            color: [0.25, 0.25, 0.28],
          });
        }
      }
      doc.ensureSpace(20);
    });
  });

  void footerCenter;
  void pageNumber;
  const blob = doc.build();
  notes.push(
    isPrint
      ? `Print interior rendered at ${book.trimSize.label} with ${bleed}in bleed and ${options.cropMarks ? 'crop marks' : 'no crop marks'}.`
      : 'Digital PDF rendered at trim size with embedded standard fonts.',
  );
  notes.push(`Rendered in ${Date.now() - startedAt}ms from the book document model.`);

  return {
    blob,
    fileName: `${slugifyFileName(book.title)}${isPrint ? `-interior-${book.trimSize.id.replace('.', '_')}` : ''}.pdf`,
    mimeType: 'application/pdf',
    pages: pageNumber,
    sizeBytes: blob.size,
    notes,
  };
}

function formatPageNumber(value: number, style: Book['numbering']['style']) {
  switch (style) {
    case 'roman-lower':
      return toRoman(value).toLowerCase();
    case 'roman-upper':
      return toRoman(value);
    case 'none':
      return '';
    default:
      return String(value);
  }
}

export function toRoman(value: number): string {
  if (value <= 0) return '';
  const pairs: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let remaining = value;
  let output = '';
  pairs.forEach(([number, symbol]) => {
    while (remaining >= number) {
      output += symbol;
      remaining -= number;
    }
  });
  return output;
}

function resolvePlaceholder(template: string, book: Book) {
  return template
    .replace('{title}', book.title)
    .replace('{author}', book.authorName)
    .replace('{page}', '')
    .trim();
}

/* ----------------------------------------------------------------- epub */

export function buildEpub(book: Book, version: 2 | 3): ExportResult {
  const uidValue = `urn:isbn:${book.metadata.isbn.replace(/[^0-9X]/gi, '') || book.id}`;
  const chapters = orderedSections(book).filter((section) => section.kind !== 'cover');
  const notes: string[] = [];

  const chapterFiles = chapters.map((section, index) => {
    const body = sectionPages(book, section.id)
      .map((page) => sanitize(page.content))
      .join('\n');
    const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${book.metadata.language}" lang="${book.metadata.language}">
<head><meta charset="utf-8" /><title>${escapeHtml(section.title)}</title>
<link rel="stylesheet" type="text/css" href="styles.css" />
</head>
<body>
<section epub:type="chapter" xmlns:epub="http://www.idpf.org/2007/ops">
<h1 class="chapter-title">${escapeHtml(section.title)}</h1>
${body}
</section>
</body>
</html>`;
    return { id: `chapter-${index + 1}`, section, file: `OEBPS/chapter-${index + 1}.xhtml`, xhtml };
  });

  const navItems = chapterFiles
    .map((entry) => `      <li><a href="${entry.file.replace('OEBPS/', '')}">${escapeHtml(entry.section.title)}</a></li>`)
    .join('\n');

  const navDoc = version === 3
    ? `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${book.metadata.language}">
<head><meta charset="utf-8" /><title>${escapeHtml(book.toc.title)}</title><link rel="stylesheet" type="text/css" href="styles.css" /></head>
<body>
<nav epub:type="toc" id="toc"><h1>${escapeHtml(book.toc.title)}</h1>
  <ol>
${navItems}
  </ol>
</nav>
</body>
</html>`
    : `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="utf-8" /><title>${escapeHtml(book.toc.title)}</title></head>
<body><nav epub:type="toc" id="toc"><ol>${navItems}</ol></nav></body>
</html>`;

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${version === 3 ? '3.0' : '2.0'}" unique-identifier="bookid" xml:lang="${book.metadata.language}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="bookid">${escapeHtml(uidValue)}</dc:identifier>
    <dc:title>${escapeHtml(book.title)}</dc:title>
    ${book.subtitle ? `<dc:title id="subtitle">${escapeHtml(book.subtitle)}</dc:title>` : ''}
    <dc:creator id="author">${escapeHtml(book.authorName)}</dc:creator>
    <dc:language>${book.metadata.language}</dc:language>
    <dc:publisher>${escapeHtml(book.metadata.publisher)}</dc:publisher>
    <dc:date>${book.metadata.publishDate}</dc:date>
    <dc:description>${escapeHtml(book.shortDescription || book.description.slice(0, 300))}</dc:description>
    <dc:rights>${escapeHtml(book.metadata.rights)}</dc:rights>
    ${book.metadata.keywords.map((keyword) => `<dc:subject>${escapeHtml(keyword)}</dc:subject>`).join('\n    ')}
    ${version === 3 ? '<meta property="dcterms:modified">' + new Date().toISOString().replace(/\.\d+Z$/, 'Z') + '</meta>' : ''}
    ${book.metadata.aiDisclosure ? '<meta property="schema:accessibilityFeature">artificial-intelligence-assistance</meta>' : ''}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
    <item id="css" href="styles.css" media-type="text/css" />
${chapterFiles.map((entry) => `    <item id="${entry.id}" href="${entry.file.replace('OEBPS/', '')}" media-type="application/xhtml+xml" />`).join('\n')}
  </manifest>
  <spine toc="ncx">
${chapterFiles.map((entry) => `    <itemref idref="${entry.id}" />`).join('\n')}
  </spine>
</package>`;

  const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeHtml(uidValue)}" />
    <meta name="dtb:depth" content="1" />
    <meta name="dtb:totalPageCount" content="0" />
    <meta name="dtb:maxPageNumber" content="0" />
  </head>
  <docTitle><text>${escapeHtml(book.title)}</text></docTitle>
  <navMap>
${chapterFiles
  .map(
    (entry, index) => `    <navPoint id="navpoint-${index + 1}" playOrder="${index + 1}"><navLabel><text>${escapeHtml(
      entry.section.title,
    )}</text></navLabel><content src="${entry.file.replace('OEBPS/', '')}" /></navPoint>`,
  )
  .join('\n')}
  </navMap>
</ncx>`;

  const styles = `body { font-family: "${book.fonts.body}", Georgia, serif; line-height: ${book.theme.lineHeight}; margin: 5%; }
h1, h2, h3 { font-family: "${book.fonts.heading}", Georgia, serif; line-height: 1.2; }
.chapter-title { margin: 1.6em 0 1em; border-bottom: 2px solid ${book.theme.accentColor}; padding-bottom: .3em; }
blockquote { border-left: 3px solid ${book.theme.accentColor}; margin-left: 0; padding-left: 1em; font-style: italic; }
p { margin: 0 0 .8em; text-indent: ${book.theme.paragraphIndent > 0 ? '1em' : '0'}; }
img { max-width: 100%; }
`;

  const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles>
</container>`;

  const archive = createZip([
    { name: 'mimetype', content: 'application/epub+zip', storedFirst: true },
    { name: 'META-INF/container.xml', content: container },
    { name: 'OEBPS/content.opf', content: opf },
    { name: 'OEBPS/nav.xhtml', content: navDoc },
    { name: 'OEBPS/toc.ncx', content: ncx },
    { name: 'OEBPS/styles.css', content: styles },
    ...chapterFiles.map((entry) => ({ name: entry.file, content: entry.xhtml })),
  ]);

  notes.push(`Reflowable EPUB ${version === 3 ? '3' : '2'} generated with semantic navigation and NCX.`);
  notes.push(`${chapterFiles.length} spine documents, metadata block and linear reading order.`);
  if (book.pages.some((page) => page.elements.length > 10)) {
    notes.push('Pages with heavy fixed-position design elements are simplified for reflowable output.');
  }

  return {
    blob: archive,
    fileName: `${slugifyFileName(book.title)}.epub`,
    mimeType: 'application/epub+zip',
    pages: book.pageCount,
    sizeBytes: archive.size,
    notes,
  };
}

/* ----------------------------------------------------------------- docx */

export function buildDocx(book: Book, options: ExportOptions): ExportResult {
  const body = orderedSections(book)
    .filter((section) => section.kind !== 'cover')
    .map((section) => {
      const heading = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(section.title)}</w:t></w:r></w:p>`;
      const content = sectionPages(book, section.id)
        .flatMap((page) => htmlToBlocks(page.content))
        .map((block) => blockToDocxParagraph(block))
        .join('\n');
      return `${heading}\n${content}\n<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
    })
    .join('\n');

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(book.title)}</w:t></w:r></w:p>
    ${book.subtitle ? `<w:p><w:r><w:t xml:space="preserve">${escapeXml(book.subtitle)}</w:t></w:r></w:p>` : ''}
    <w:p><w:r><w:t xml:space="preserve">by ${escapeXml(book.authorName)}</w:t></w:r></w:p>
    ${options.includeToc ? `<w:p><w:pStyle w:val="Heading1"/></w:p><w:sdt><w:sdtContent><w:p><w:r><w:t>Table of contents</w:t></w:r></w:p>${tocEntries(book, 1)
        .filter((entry) => entry.level === 1)
        .map((entry) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(entry.title)}</w:t></w:r></w:p>`)
        .join('')}</w:sdtContent></w:sdt>` : ''}
    ${body}
    <w:sectPr>
      <w:pgSz w:w="${Math.round(book.trimSize.widthIn * 1440)}" w:h="${Math.round(book.trimSize.heightIn * 1440)}"/>
      <w:pgMar w:top="${Math.round(book.margins.top * 1440)}" w:right="${Math.round(book.margins.right * 1440)}" w:bottom="${Math.round(
        book.margins.bottom * 1440,
      )}" w:left="${Math.round(book.margins.left * 1440)}" w:header="720" w:footer="720" w:gutter="${Math.round(book.gutter * 1440)}"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="${escapeXml(
    book.fonts.body,
  )}" w:hAnsi="${escapeXml(book.fonts.body)}"/><w:sz w:val="${Math.round(book.fonts.baseSize * 2)}"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="64"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style>
</w:styles>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const archive = createZip([
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rels },
    { name: 'word/document.xml', content: document },
    { name: 'word/styles.xml', content: styles },
    { name: 'word/_rels/document.xml.rels', content: docRels },
  ]);

  return {
    blob: archive,
    fileName: `${slugifyFileName(book.title)}-manuscript.docx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pages: book.pageCount,
    sizeBytes: archive.size,
    notes: ['Word document generated from the book document model with heading styles preserved.'],
  };
}

function blockToDocxParagraph(block: { type: string; text: string }) {
  const style = block.type === 'h1' ? 'Heading1' : block.type === 'h2' ? 'Heading2' : block.type === 'quote' ? 'Quote' : null;
  const bold = block.type === 'h3' ? '<w:b/>' : '';
  return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r>${
    bold ? `<w:rPr>${bold}</w:rPr>` : ''
  }<w:t xml:space="preserve">${escapeXml(block.text || (block.type === 'hr' ? '* * *' : ''))}</w:t></w:r></w:p>`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function slugifyFileName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

/* ------------------------------------------------------------ dispatcher */

export function renderExport(book: Book, format: ExportFormat, options: ExportOptions): ExportResult {
  switch (format) {
    case 'pdf':
      return buildPdf(book, { ...options, profileId: options.profileId ?? 'digital-pdf' });
    case 'print-pdf':
      return buildPdf(book, { ...options, profileId: options.profileId === 'digital-pdf' ? 'paperback' : options.profileId, cropMarks: options.cropMarks });
    case 'epub':
      return buildEpub(book, 2);
    case 'epub3':
      return buildEpub(book, 3);
    case 'docx':
      return buildDocx(book, options);
    case 'html': {
      const html = buildHtml(book, options);
      const blob = new Blob([html], { type: 'text/html' });
      return { blob, fileName: `${slugifyFileName(book.title)}.html`, mimeType: 'text/html', pages: book.pageCount, sizeBytes: blob.size, notes: ['Single-file HTML with linked table of contents.'] };
    }
    case 'txt': {
      const text = bookPlainText(book);
      const blob = new Blob([text], { type: 'text/plain' });
      return { blob, fileName: `${slugifyFileName(book.title)}.txt`, mimeType: 'text/plain', pages: book.pageCount, sizeBytes: blob.size, notes: ['Plain-text manuscript with chapter headings.'] };
    }
    default: {
      const text = bookPlainText(book);
      const blob = new Blob([text], { type: 'text/plain' });
      return { blob, fileName: `${slugifyFileName(book.title)}.txt`, mimeType: 'text/plain', pages: book.pageCount, sizeBytes: blob.size, notes: [] };
    }
  }
}
