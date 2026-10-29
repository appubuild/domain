import { describe, expect, it } from 'vitest';
import type { GeoJSONStoreFeatures } from 'terra-draw';
import { classifySnapshot } from './drawing-state';

function point(mode: string, extra: Record<string, boolean> = {}): GeoJSONStoreFeatures {
  return { type: 'Feature', id: 'id', geometry: { type: 'Point', coordinates: [90, 23] }, properties: { mode, ...extra } };
}
describe('drawing snapshot classification', () => {
  it('retains completed geometries but excludes editor handles', () => {
    const completed = point('point');
    const result = classifySnapshot([completed, point('polygon', { selectionPoint: true }), point('polygon', { midPoint: true }), point('polygon', { coordinatePoint: true }), point('polygon', { closingPoint: true }), point('polygon', { snappingPoint: true })]);
    expect(result.complete).toEqual([completed]);
    expect(result.inProgress).toBe(false);
  });
  it('recognizes unfinished work without treating handles as unfinished features', () => {
    expect(classifySnapshot([point('polygon', { currentlyDrawing: true })])).toEqual({ complete: [], inProgress: true });
    expect(classifySnapshot([point('polygon', { closingPoint: true, currentlyDrawing: true })])).toEqual({ complete: [], inProgress: false });
  });
});
