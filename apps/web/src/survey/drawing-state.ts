import type { GeoJSONStoreFeatures } from 'terra-draw';

/** Terra Draw creates temporary guide features as well as unfinished geometries. */
export function classifySnapshot(snapshot: GeoJSONStoreFeatures[]) {
  const modes = ['point', 'linestring', 'polygon', 'rectangle'];
  const isGuide = (f: GeoJSONStoreFeatures) => Boolean(f.properties.selectionPoint || f.properties.midPoint || f.properties.coordinatePoint || f.properties.closingPoint || f.properties.snappingPoint);
  const actual = snapshot.filter(f => modes.includes(String(f.properties.mode)) && !isGuide(f));
  return { complete: actual.filter(f => !f.properties.currentlyDrawing), inProgress: actual.some(f => Boolean(f.properties.currentlyDrawing)) };
}
