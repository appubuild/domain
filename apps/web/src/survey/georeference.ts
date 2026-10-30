/** Validates a north-up WGS84 rectangle for a temporary image overlay. */
export function parseOverlayBounds(values: { west: string; east: string; south: string; north: string }): [[number, number], [number, number], [number, number], [number, number]] {
  const parts = [values.west, values.east, values.south, values.north];
  if (parts.some(part => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(part.trim()))) throw new Error('Invalid bounds');
  const [west, east, south, north] = parts.map(Number);
  if (![west, east, south, north].every(Number.isFinite) || west < -180 || east > 180 || west >= east || east - west > 180 || south < -85.05112878 || north > 85.05112878 || south >= north) throw new Error('Invalid bounds');
  return [[west, north], [east, north], [east, south], [west, south]];
}
