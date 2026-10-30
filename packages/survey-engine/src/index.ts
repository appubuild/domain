import area from '@turf/area';
import length from '@turf/length';
import kinks from '@turf/kinks';
import distance from '@turf/distance';
import type { LineString, Point, Polygon, Position } from 'geojson';

export type SurveyGeometry = Point | LineString | Polygon;
export type GeometryError = 'coordinates' | 'incomplete' | 'duplicate' | 'selfIntersection' | 'antimeridian' | 'unsupported';
export type Measurement = { valid: false; reason: GeometryError } | { valid: true; areaSquareMeters: number | null; lengthMeters: number | null; coordinates: Position[]; edgeLengthsMeters: number[] };
const validPosition = (p: Position) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] >= -180 && p[0] <= 180 && p[1] >= -90 && p[1] <= 90;
const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];
const edgeLengths = (points: Position[]) => points.slice(1).map((point, index) => distance(points[index], point, { units: 'kilometers' }) * 1000);
const crossesAntimeridian = (points: Position[]) => points.some((p, i) => i > 0 && Math.abs(p[0] - points[i - 1][0]) > 180);

/** Spherical WGS84 longitude/latitude measurements. Reject uncertain geometries rather than return misleading values. */
export function measureGeometry(geometry: SurveyGeometry): Measurement {
  if (geometry.type === 'Point') return validPosition(geometry.coordinates) ? { valid: true, areaSquareMeters: null, lengthMeters: null, coordinates: [geometry.coordinates], edgeLengthsMeters: [] } : { valid: false, reason: 'coordinates' };
  if (geometry.type === 'LineString') {
    const points = geometry.coordinates;
    if (points.length < 2) return { valid: false, reason: 'incomplete' };
    if (!points.every(validPosition)) return { valid: false, reason: 'coordinates' };
    if (points.some((p, i) => i > 0 && same(p, points[i - 1]))) return { valid: false, reason: 'duplicate' };
    if (crossesAntimeridian(points)) return { valid: false, reason: 'antimeridian' };
    return { valid: true, areaSquareMeters: null, lengthMeters: length({ type: 'Feature', properties: {}, geometry }, { units: 'kilometers' }) * 1000, coordinates: points, edgeLengthsMeters: edgeLengths(points) };
  }
  if (geometry.type !== 'Polygon' || geometry.coordinates.length !== 1) return { valid: false, reason: 'unsupported' };
  const ring = geometry.coordinates[0];
  if (ring.length < 4 || !same(ring[0], ring[ring.length - 1])) return { valid: false, reason: 'incomplete' };
  if (!ring.every(validPosition)) return { valid: false, reason: 'coordinates' };
  const vertices = ring.slice(0, -1);
  if (new Set(vertices.map(p => `${p[0]},${p[1]}`)).size !== vertices.length) return { valid: false, reason: 'duplicate' };
  if (crossesAntimeridian(ring)) return { valid: false, reason: 'antimeridian' };
  if (kinks(geometry).features.length > 0) return { valid: false, reason: 'selfIntersection' };
  const areaSquareMeters = area(geometry);
  if (!Number.isFinite(areaSquareMeters) || areaSquareMeters <= 0) return { valid: false, reason: 'incomplete' };
  return { valid: true, areaSquareMeters, lengthMeters: length({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ring } }, { units: 'kilometers' }) * 1000, coordinates: vertices, edgeLengthsMeters: edgeLengths(ring) };
}
export type AreaUnit = 'm2' | 'ft2' | 'acre' | 'hectare' | 'decimal';
export type LengthUnit = 'm' | 'ft';
const areaFactors: Record<AreaUnit, number> = { m2: 1, ft2: 1 / 0.09290304, acre: 1 / 4046.8564224, hectare: 1 / 10000, decimal: 100 / 4046.8564224 };
export function convertArea(squareMeters: number, unit: AreaUnit): number { return squareMeters * areaFactors[unit]; }
export function convertLength(meters: number, unit: LengthUnit): number { return unit === 'ft' ? meters / 0.3048 : meters; }
