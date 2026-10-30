import type { LocalProject } from '../../storage/src/projects';
import { buildReportDefinition, type ReportLanguage } from './report';
import fontUrl from '../assets/NotoSansBengali.ttf?url';

/** Lazy-load the PDF engine and the locally bundled licensed font. */
export async function downloadProjectReport(project: LocalProject, language: ReportLanguage): Promise<void> {
  if (language !== 'en' || !/^[\x20-\x7E]+$/.test(project.name)) throw new Error('PDF supports English ASCII project names only until Bengali text extraction is fixed');
  // Validate and enforce the coordinate cap before loading the PDF engine or font.
  const definition = buildReportDefinition(project, language);
  const [{ default: pdfmake }, response] = await Promise.all([import('pdfmake/build/pdfmake'), fetch(fontUrl)]);
  if (!response.ok) throw new Error('Report font unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  pdfmake.addVirtualFileSystem({ 'NotoSansBengali.ttf': btoa(binary) });
  pdfmake.addFonts({ NotoBengali: { normal: 'NotoSansBengali.ttf', bold: 'NotoSansBengali.ttf', italics: 'NotoSansBengali.ttf', bolditalics: 'NotoSansBengali.ttf' } });
  // pdfmake 0.3 returns a Promise from download; its published 0.2 type declarations are callback-based.
  const pdf = pdfmake.createPdf(definition);
  await Promise.resolve(pdf.download(`land-expert-${project.id}-${language}.pdf`));
}
