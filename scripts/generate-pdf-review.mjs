// Research-only: produce representative reports using the actual report definition.
// Usage: node scripts/generate-pdf-review.mjs /tmp/land-pdf-review
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';

const destination = process.argv[2];
if (!destination) throw new Error('Provide an output directory outside the repository');
const output = path.resolve(destination);
await mkdir(output, { recursive: true });
const bundled = await build({ entryPoints: ['packages/reports/src/report.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const modulePath = path.join(output, 'report-bundle.cjs');
await writeFile(modulePath, bundled.outputFiles[0].contents);
const require = createRequire(import.meta.url);
const { buildReportDefinition } = require(modulePath);
const pdfmake = require('pdfmake');
const font = path.resolve('packages/reports/assets/NotoSansBengali.ttf');
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy(file => file === font);
pdfmake.setFonts({ NotoBengali: { normal: font, bold: font, italics: font, bolditalics: font } });
const project = {
  schemaVersion: 1, id: '2f5311ed-b419-4ce6-a0ec-5fd74f98c26d', name: 'জমি Field',
  createdAt: '2026-01-01T00:00:00.000Z', crs: 'OGC:CRS84', areaUnit: 'decimal', lengthUnit: 'm',
  features: [{ type: 'Feature', id: 'e3236b84-2d4c-4e6c-8dea-20ba22ffb898',
    geometry: { type: 'LineString', coordinates: Array.from({ length: 150 }, (_, i) => [90 + i / 1000, 23]) }, properties: { mode: 'linestring' } }],
};
for (const language of ['en', 'bn']) {
  const reportProject = language === 'en' ? { ...project, name: 'Field copy' } : project;
  const bytes = await pdfmake.createPdf(buildReportDefinition(reportProject, language)).getBuffer();
  const target = path.join(output, `${language}.pdf`);
  await writeFile(target, bytes);
  console.log(`${target}: ${bytes.length} bytes`);
}
