import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { LocalProject } from '../../storage/src/projects';
import { projectSchema } from '../../storage/src/projects';
import { convertArea, convertLength, measureGeometry } from '../../survey-engine/src';

export type ReportLanguage = 'en' | 'bn';
const labels = {
  en: { title: 'Land survey summary', project: 'Project', id: 'Project ID', date: 'Saved on (UTC)', reference: 'Coordinate reference: WGS84 longitude / latitude', summary: 'Project totals', totalArea: 'Polygon area total', totalPerimeter: 'Polygon perimeter total', totalLength: 'Line length total', rounding: 'Measurements are rounded to at most three decimal places; coordinates to at most six decimal places.', plot: 'Geometry', area: 'Area', perimeter: 'Perimeter', length: 'Length', coordinates: 'Coordinates (latitude, longitude)', diagram: 'Boundary diagram - schematic, not to scale', disclaimer: 'Measurements are spherical estimates, not cadastral or legal survey results. Verify the source coordinates and consult a qualified professional.', point: 'Point', line: 'Line', polygon: 'Polygon', areaUnits: { m2: 'sq m', ft2: 'sq ft', acre: 'acres', hectare: 'hectares', decimal: 'decimal' }, lengthUnits: { m: 'm', ft: 'ft' } },
  bn: { title: 'ভূমি জরিপের সারসংক্ষেপ', project: 'প্রকল্প', id: 'প্রকল্প আইডি', date: 'সংরক্ষণের তারিখ (UTC)', reference: 'স্থানাঙ্ক: WGS84 দ্রাঘিমাংশ / অক্ষাংশ', summary: 'প্রকল্পের মোট', totalArea: 'বহুভুজের মোট ক্ষেত্রফল', totalPerimeter: 'বহুভুজের মোট পরিসীমা', totalLength: 'রেখার মোট দৈর্ঘ্য', rounding: 'পরিমাপ সর্বোচ্চ তিন এবং স্থানাঙ্ক সর্বোচ্চ ছয় দশমিক ঘরে দেখানো হয়েছে।', plot: 'আকৃতি', area: 'ক্ষেত্রফল', perimeter: 'পরিসীমা', length: 'দৈর্ঘ্য', coordinates: 'স্থানাঙ্ক (অক্ষাংশ, দ্রাঘিমাংশ)', diagram: 'সীমানার চিত্র - স্কেল অনুযায়ী নয়', disclaimer: 'পরিমাপ গোলকীয় আনুমানিক হিসাব; এটি ক্যাডাস্ট্রাল বা আইনি জরিপ নয়। উৎসের স্থানাঙ্ক যাচাই করুন এবং যোগ্য পেশাজীবীর পরামর্শ নিন।', point: 'বিন্দু', line: 'রেখা', polygon: 'বহুভুজ', areaUnits: { m2: 'বর্গমিটার', ft2: 'বর্গফুট', acre: 'একর', hectare: 'হেক্টর', decimal: 'শতক' }, lengthUnits: { m: 'মিটার', ft: 'ফুট' } },
} as const;

/** Builds a reproducible report definition from saved data; no map imagery or implied survey accuracy. */
export function buildReportDefinition(input: LocalProject, language: ReportLanguage): TDocumentDefinitions {
  const project = projectSchema.parse(input);
  const l = labels[language];
  const fmt = new Intl.NumberFormat(language === 'bn' ? 'bn-BD' : 'en-US', { maximumFractionDigits: 3 });
  const coord = new Intl.NumberFormat(language === 'bn' ? 'bn-BD' : 'en-US', { maximumFractionDigits: 6, useGrouping: false });
  const measurements = project.features.map(feature => measureGeometry(feature.geometry));
  if (measurements.some(measure => !measure.valid)) throw new Error('Invalid report geometry');
  const coordinateCount = measurements.reduce((sum, result) => sum + (result.valid ? result.coordinates.length : 0), 0);
  if (coordinateCount > 5000) throw new Error('Report exceeds the 5000-coordinate limit');
  const totals = project.features.reduce((sum, feature, i) => {
    const result = measurements[i];
    if (result.valid) {
      if (feature.geometry.type === 'Polygon') { sum.area += result.areaSquareMeters ?? 0; sum.perimeter += result.lengthMeters ?? 0; }
      else if (feature.geometry.type === 'LineString') sum.line += result.lengthMeters ?? 0;
    }
    return sum;
  }, { area: 0, perimeter: 0, line: 0 });
  const content: Content[] = [
    { text: l.title, fontSize: 19, bold: true, margin: [0, 0, 0, 12] },
    { text: `${l.project}: ${project.name}`, fontSize: 13, margin: [0, 0, 0, 5] },
    { text: `${l.id}: ${project.id}`, fontSize: 9 },
    { text: `${l.date}: ${project.createdAt}`, fontSize: 9, margin: [0, 3, 0, 3] },
    { text: l.reference, fontSize: 9 },
    { text: l.disclaimer, fontSize: 10, color: '#7a4a18', margin: [0, 12, 0, 12] },
    { text: l.summary, fontSize: 13, bold: true, margin: [0, 0, 0, 5] },
    { text: `${l.totalArea}: ${fmt.format(convertArea(totals.area, project.areaUnit))} ${l.areaUnits[project.areaUnit]}` },
    { text: `${l.totalPerimeter}: ${fmt.format(convertLength(totals.perimeter, project.lengthUnit))} ${l.lengthUnits[project.lengthUnit]}` },
    { text: `${l.totalLength}: ${fmt.format(convertLength(totals.line, project.lengthUnit))} ${l.lengthUnits[project.lengthUnit]}` },
    { text: l.rounding, fontSize: 9, margin: [0, 5, 0, 0] },
  ];
  project.features.forEach((feature, index) => {
    const measure = measurements[index];
    if (!measure.valid) throw new Error('Invalid report geometry');
    const kind = feature.geometry.type === 'Point' ? l.point : feature.geometry.type === 'LineString' ? l.line : l.polygon;
    content.push({ text: `${l.plot} ${fmt.format(index + 1)}: ${kind}`, fontSize: 13, bold: true, margin: [0, 10, 0, 5] });
    if (measure.areaSquareMeters !== null) content.push({ text: `${l.area}: ${fmt.format(convertArea(measure.areaSquareMeters, project.areaUnit))} ${l.areaUnits[project.areaUnit]}` });
    if (measure.lengthMeters !== null) content.push({ text: `${feature.geometry.type === 'Polygon' ? l.perimeter : l.length}: ${fmt.format(convertLength(measure.lengthMeters, project.lengthUnit))} ${l.lengthUnits[project.lengthUnit]}` });
    if (measure.coordinates.length > 1) {
      const coords = measure.coordinates; const minX = Math.min(...coords.map(p => p[0])); const maxX = Math.max(...coords.map(p => p[0]));
      const minY = Math.min(...coords.map(p => p[1])); const maxY = Math.max(...coords.map(p => p[1]));
      // Normalize before scaling so straight horizontal/vertical lines fill the
      // available space and tiny coordinate spans cannot overflow the scale.
      const dx = maxX - minX; const dy = maxY - minY; const span = Math.max(dx, dy);
      const nx = span ? dx / span : 0; const ny = span ? dy / span : 0;
      const scale = Math.min(nx ? 240 / nx : Infinity, ny ? 130 / ny : Infinity);
      const points = coords.map(p => ({
        x: 10 + (span ? (p[0] - minX) / span * scale : 0),
        y: 10 + (span ? (maxY - p[1]) / span * scale : 0),
      }));
      content.push({ text: l.diagram, fontSize: 9, color: '#58685f', margin: [0, 10, 0, 4] });
      content.push({ canvas: [{ type: 'polyline', points, closePath: feature.geometry.type === 'Polygon', lineColor: '#2d6647', lineWidth: 1.5 }] });
    }
    content.push({ text: l.coordinates, fontSize: 10, bold: true, margin: [0, 10, 0, 4] });
    content.push({ ul: measure.coordinates.map(p => `${coord.format(p[1])}, ${coord.format(p[0])}`), fontSize: 9 });
  });
  return { pageSize: 'A4', pageMargins: [44, 44, 44, 44], defaultStyle: { font: 'NotoBengali', fontSize: 10 }, content, info: { title: l.title, subject: project.name, creator: 'Land Expert' } };
}
