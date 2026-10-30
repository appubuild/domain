// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { buildReportDefinition } from '../../../../packages/reports/src/report';
import type { LocalProject } from '../../../../packages/storage/src/projects';

const sample: LocalProject = { schemaVersion: 1, id: '2f5311ed-b419-4ce6-a0ec-5fd74f98c26d', name: 'জমি Field', createdAt: '2026-01-01T00:00:00.000Z', crs: 'OGC:CRS84', areaUnit: 'decimal', lengthUnit: 'm', features: [{ type: 'Feature', id: 'e3236b84-2d4c-4e6c-8dea-20ba22ffb898', geometry: { type: 'Polygon', coordinates: [[[90,23],[90.001,23],[90.001,23.001],[90,23]]] }, properties: { mode: 'polygon' } }] };
interface NodePdfMake { setFonts(fonts: object): void; setUrlAccessPolicy(fn: (url: string) => boolean): void; setLocalAccessPolicy(fn: (path: string) => boolean): void; createPdf(def: TDocumentDefinitions): { getBuffer(): Promise<Buffer> } }
const fontPath = fileURLToPath(new URL('../../../../packages/reports/assets/NotoSansBengali.ttf', import.meta.url));
const pdfmake = createRequire(import.meta.url)('pdfmake') as NodePdfMake;
pdfmake.setUrlAccessPolicy(() => false); pdfmake.setLocalAccessPolicy(path => path === fontPath);
pdfmake.setFonts({ NotoBengali: { normal: fontPath, bold: fontPath, italics: fontPath, bolditalics: fontPath } });
describe('PDF reports', () => {
  it.each(['en', 'bn'] as const)('generates a %s report with embedded font and extractable project text', async language => {
    const definition = buildReportDefinition(sample, language);
    const data = await pdfmake.createPdf(definition).getBuffer();
    expect(data.subarray(0, 5).toString()).toBe('%PDF-');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: false }).promise;
    const page = await doc.getPage(1); const contents = await page.getTextContent();
    const text = contents.items.map(item => 'str' in item ? item.str : '').join(' ');
    expect(text).toContain('Field');
    expect(text).toContain(language === 'bn' ? 'ভূমি' : 'Land survey summary');
    expect(text).toContain('2f5311ed');
    await doc.cleanup();
  });
  it('extracts Bengali shaping cases in logical Unicode order', async () => {
    const cases = [
      'ভূমি জরিপের সারসংক্ষেপ', 'প্রকল্প: জমি Field', 'ক্ষেত্রফল ও দৈর্ঘ্য',
      'নির্মাণ এবং ক্ষ্ম', 'আমার সোনার বাংলা', 'অসংখ্য ক্ষুদ্র স্থাপত্য', '২৩.৮, ৯০.৪',
    ];
    const definition: TDocumentDefinitions = {
      defaultStyle: { font: 'NotoBengali', fontSize: 16 },
      content: cases.map((text, index) => ({ text, ...(index ? { pageBreak: 'before' as const } : {}) })),
    };
    const data = await pdfmake.createPdf(definition).getBuffer();
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: false }).promise;
    try {
      expect(doc.numPages).toBe(cases.length);
      const extracted = await Promise.all(cases.map(async (_, index) => {
        const page = await doc.getPage(index + 1);
        const contents = await page.getTextContent();
        return contents.items.map(item => 'str' in item ? item.str : '').join('');
      }));
      expect(extracted).toEqual(cases);
    } finally { await doc.cleanup(); }
  });

  it('builds deterministic definitions and rejects invalid geometries', () => {
    expect(buildReportDefinition(sample, 'bn')).toEqual(buildReportDefinition(sample, 'bn'));
    expect(() => buildReportDefinition({ ...sample, features: [{ ...sample.features[0], geometry: { type: 'Point', coordinates: [400, 0] } }] }, 'en')).toThrow();
  });
  it.each([
    { coordinates: [[90, 23], [90.001, 23]] as [number, number][], width: 240, height: 0 },
    { coordinates: [[90, 23], [90, 23.001]] as [number, number][], width: 0, height: 130 },
    { coordinates: [[90, 23], [90.001, 23.001]] as [number, number][], width: 130, height: 130 },
  ])('fits a line diagram to the available space without distortion', ({ coordinates, width, height }) => {
    const project: LocalProject = { ...sample, name: 'Line', features: [{
      type: 'Feature', id: sample.features[0].id, geometry: { type: 'LineString', coordinates }, properties: { mode: 'linestring' },
    }] };
    const content = buildReportDefinition(project, 'en').content as Array<{ canvas?: Array<{ points: Array<{ x: number; y: number }> }> }>;
    const points = content.find(item => item.canvas)?.canvas?.[0].points;
    expect(points).toBeDefined();
    expect(Math.abs(points![1].x - points![0].x)).toBeCloseTo(width);
    expect(Math.abs(points![1].y - points![0].y)).toBeCloseTo(height);
  });
  it('renders a long ASCII name and mixed point and polygon in an English report', async () => {
    const longName = 'W'.repeat(120);
    const project: LocalProject = { ...sample, name: longName, features: [sample.features[0], {
      type: 'Feature', id: crypto.randomUUID(), geometry: { type: 'Point', coordinates: [90.4, 23.8] }, properties: { mode: 'point' },
    }] };
    const data = await pdfmake.createPdf(buildReportDefinition(project, 'en')).getBuffer();
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: false }).promise;
    try {
      const items = (await (await doc.getPage(1)).getTextContent()).items.map(item => 'str' in item ? item.str : '');
      const text = items.join(' ');
      expect(items.join('').replace(/\s/g, '')).toContain(longName);
      expect(text).toContain('Geometry 1: Polygon');
      expect(text).toContain('Geometry 2: Point');
      expect(text).toContain('23.8, 90.4');
    } finally { await doc.cleanup(); }
  });
  it('accepts 5,000 coordinates and rejects larger reports', () => {
    const line = (count: number) => ({
      type: 'Feature' as const, id: crypto.randomUUID(),
      geometry: { type: 'LineString' as const, coordinates: Array.from({ length: count }, (_, i): [number, number] => [90 + i / 10000, 23]) },
      properties: { mode: 'linestring' as const },
    });
    const within = { ...sample, name: 'Boundary', features: [line(2000), line(2000), line(1000)] };
    expect(() => buildReportDefinition(within, 'en')).not.toThrow();
    expect(() => buildReportDefinition({ ...within, features: [within.features[0], within.features[1], line(1001)] }, 'en')).toThrow('5000-coordinate limit');
  });

  it('renders a maximum-size English report and extracts all 5,000 coordinates', async () => {
    const makeLine = (n: number, latitude: number) => ({
      type: 'Feature' as const, id: crypto.randomUUID(),
      geometry: { type: 'LineString' as const, coordinates: Array.from({ length: n }, (_, i): [number, number] => [90 + i / 10000, latitude]) },
      properties: { mode: 'linestring' as const },
    });
    const project = { ...sample, name: 'Maximum report', features: [makeLine(2000, 23), makeLine(2000, 24), makeLine(1000, 25)] };
    const bytes = await pdfmake.createPdf(buildReportDefinition(project, 'en')).getBuffer();
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
    try {
      expect(doc.numPages).toBeGreaterThan(1);
      const extracted: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const contents = await page.getTextContent();
        extracted.push(...contents.items.map(item => 'str' in item ? item.str : ''));
        page.cleanup();
      }
      const text = extracted.join(' ');
      expect(text).toContain('Maximum report');
      expect(text).toContain('spherical estimates');
      const found = [...text.matchAll(/\b(23|24|25), (90(?:\.\d+)?)(?![\d.])/g)].map(m => `${m[1]}, ${m[2]}`);
      const expected = project.features.flatMap(feature => feature.geometry.coordinates.map(([lon, lat]) => `${lat}, ${Number(lon.toFixed(6))}`));
      expect(found).toEqual(expected);
    } finally { await doc.cleanup(); }
  }, 120000);

  it('preserves every coordinate and the disclaimer across a multi-page English report', async () => {
    const coordinates = Array.from({ length: 150 }, (_, i): [number, number] => [90 + i / 1000, 23]);
    const project: LocalProject = { ...sample, name: 'Long survey', features: [{
      type: 'Feature', id: 'e3236b84-2d4c-4e6c-8dea-20ba22ffb898',
      geometry: { type: 'LineString', coordinates }, properties: { mode: 'linestring' },
    }] };
    const bytes = await pdfmake.createPdf(buildReportDefinition(project, 'en')).getBuffer();
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
    try {
      expect(doc.numPages).toBeGreaterThan(1);
      const extracted: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const contents = await (await doc.getPage(i)).getTextContent();
        extracted.push(...contents.items.map(item => 'str' in item ? item.str : ''));
      }
      const text = extracted.join(' ');
      expect(text).toContain('spherical estimates');
      expect(text).toContain('Long survey');
      expect(text).toContain('coordinates to at most six decimal places');
      for (const [longitude, latitude] of coordinates) {
        const coordinate = `${latitude}, ${Number(longitude.toFixed(6))}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        expect(text).toMatch(new RegExp(`${coordinate}(?![0-9.])`));
      }
    } finally { await doc.cleanup(); }
  });

});
