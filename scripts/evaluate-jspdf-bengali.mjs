// Research-only extraction probe; jspdf-fontkit is not a production dependency.
import { readFile } from 'node:fs/promises';
import jsPDF from 'jspdf-fontkit';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const cases = ['ভূমি জরিপের সারসংক্ষেপ', 'প্রকল্প: জমি Field', 'ক্ষেত্রফল ও দৈর্ঘ্য', 'নির্মাণ এবং ক্ষ্ম', 'আমার সোনার বাংলা', 'অসংখ্য ক্ষুদ্র স্থাপত্য', '২৩.৮, ৯০.৪'];
const font = await readFile(new URL('../packages/reports/assets/NotoSansBengali.ttf', import.meta.url));
const pdf = new jsPDF();
pdf.addFileToVFS('NotoSansBengali.ttf', font.toString('base64'));
pdf.addFont('NotoSansBengali.ttf', 'NotoBengali', 'normal');
pdf.setFont('NotoBengali'); pdf.setFontSize(16);
cases.forEach((text, index) => pdf.text(text, 15, 20 + index * 15));
const document = await getDocument({ data: new Uint8Array(pdf.output('arraybuffer')), useSystemFonts: false }).promise;
try {
  const items = (await (await document.getPage(1)).getTextContent()).items;
  const text = items.map(item => 'str' in item ? item.str : '').join('');
  const results = cases.map(expected => ({ expected, exact: text.includes(expected) }));
  console.log(JSON.stringify({ extractedText: text, results }, null, 2));
  if (results.some(result => !result.exact)) process.exitCode = 1;
} finally { await document.cleanup(); }
