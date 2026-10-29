import { describe, it, expect } from 'vitest';
import { convertArea, convertLength, measureGeometry } from '../../../../packages/survey-engine/src';
import type { Polygon } from 'geojson';
const polygon = (coordinates: number[][]): Polygon => ({ type: 'Polygon', coordinates: [coordinates] });
describe('survey measurement', () => {
  it('measures a known one-degree equatorial square on a sphere', () => {
    const result = measureGeometry(polygon([[0,0],[1,0],[1,1],[0,1],[0,0]]));
    expect(result.valid).toBe(true);
    if (result.valid) { expect(result.areaSquareMeters).toBeCloseTo(12363718145, -5); expect(result.lengthMeters).toBeCloseTo(444763, -2); }
  });
  it('rejects incomplete, duplicate and self-intersecting polygons', () => {
    expect(measureGeometry(polygon([[0,0],[1,0],[1,1]]))).toEqual({ valid: false, reason: 'incomplete' });
    expect(measureGeometry(polygon([[0,0],[1,0],[1,1],[1,0],[0,0]]))).toEqual({ valid: false, reason: 'duplicate' });
    expect(measureGeometry(polygon([[0,0],[1,1],[1,0],[0,1],[0,0]]))).toEqual({ valid: false, reason: 'selfIntersection' });
  });
  it('rejects invalid coordinates, unsupported holes and antimeridian crossings', () => {
    expect(measureGeometry({ type: 'Point', coordinates: [181, 0] })).toEqual({ valid: false, reason: 'coordinates' });
    expect(measureGeometry({ type: 'LineString', coordinates: [[179, 0], [-179, 0]] })).toEqual({ valid: false, reason: 'antimeridian' });
    expect(measureGeometry({ type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]], [[0,0],[0,0],[0,0],[0,0]]] })).toEqual({ valid: false, reason: 'unsupported' });
  });
  it('reports each geographic edge and their sum matches the perimeter', () => {
    const result = measureGeometry(polygon([[0,0],[1,0],[1,1],[0,1],[0,0]]));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.edgeLengthsMeters).toHaveLength(4);
      expect(result.edgeLengthsMeters[0]).toBeCloseTo(111195.08, 1);
      expect(result.edgeLengthsMeters.reduce((a, b) => a + b, 0)).toBeCloseTo(result.lengthMeters!, 6);
    }
  });
  it('calculates short and high-latitude lines as spherical distances', () => {
    const short = measureGeometry({ type: 'LineString', coordinates: [[90, 23], [90.000001, 23]] });
    const high = measureGeometry({ type: 'LineString', coordinates: [[0, 80], [1, 80]] });
    expect(short.valid && short.lengthMeters).toBeCloseTo(0.102, 2);
    expect(high.valid && high.lengthMeters).toBeCloseTo(19308.6, 0);
  });
  it('converts standard units without intermediate rounding', () => {
    expect(convertArea(4046.8564224, 'acre')).toBeCloseTo(1, 10);
    expect(convertArea(4046.8564224, 'decimal')).toBeCloseTo(100, 10);
    expect(convertArea(0.09290304, 'ft2')).toBeCloseTo(1, 10);
    expect(convertLength(0.3048, 'ft')).toBeCloseTo(1, 10);
  });
});
