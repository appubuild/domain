// Research-only probe. See docs/architecture/local-projects.md for optional dependencies.
// It intentionally exits non-zero if PDF.js does not extract the exact text.
import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { drawBanglaText, loadBanglaFont } from 'bangla-pdf';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const cases = [
  'ভূমি জরিপের সারসংক্ষেপ',
  'প্রকল্প: জমি Field',
  'ক্ষেত্রফল ও দৈর্ঘ্য',
  'নির্মাণ এবং ক্ষ্ম',
  'আমার সোনার বাংলা',
  'অসংখ্য ক্ষুদ্র স্থাপত্য',
  '২৩.৮, ৯০.৪',
];
const fontBytes = await readFile(new URL('../packages/reports/assets/NotoSansBengali.ttf', import.meta.url));
const font = await loadBanglaFont(fontBytes);
const generated = await PDFDocument.create();
const page = generated.addPage();
cases.forEach((text, index) => drawBanglaText(page, text, { font, x: 40, y: 760 - index * 35, size: 16 }));
const bytes = await generated.save();
// Optional output for independent renderer/extractor inspection.
if (process.argv[2]) await writeFile(process.argv[2], bytes);
const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
try {
  const items = (await (await pdf.getPage(1)).getTextContent()).items;
  const text = items.map(item => 'str' in item ? item.str : '').join('');
  const results = cases.map(expected => ({ expected, exact: text.includes(expected) }));
  console.log(JSON.stringify({ extractedText: text, results }, null, 2));
  if (results.some(result => !result.exact)) process.exitCode = 1;
} finally {
  await pdf.cleanup();
}
