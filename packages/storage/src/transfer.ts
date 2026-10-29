import { z } from 'zod';
import { projectSchema, type LocalProject } from './projects';

/** Backups are intentionally bounded before parsing and before writing. */
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
export const MAX_BACKUP_PROJECTS = 100;
const backupSchema = z.object({
  format: z.literal('land-expert-backup'), version: z.literal(1),
  projects: z.array(projectSchema).min(1).max(MAX_BACKUP_PROJECTS),
}).strict().superRefine((backup, ctx) => {
  if (new Set(backup.projects.map(p => p.id)).size !== backup.projects.length) ctx.addIssue({ code: 'custom', message: 'Duplicate project IDs' });
});
export function createBackup(projects: LocalProject[]): string {
  const backup = backupSchema.parse({ format: 'land-expert-backup', version: 1, projects });
  const json = JSON.stringify(backup);
  if (new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) throw new Error('Backup exceeds size limit');
  return json;
}
export function parseBackup(text: string): LocalProject[] {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('Backup exceeds size limit');
  return backupSchema.parse(JSON.parse(text)).projects;
}
/** RFC 7946 geometry uses longitude/latitude; no nonstandard CRS member is emitted. */
export function exportGeoJSON(project: LocalProject): string {
  const validated = projectSchema.parse(project);
  return JSON.stringify({ type: 'FeatureCollection', features: validated.features.map(f => ({ type: 'Feature', id: f.id, geometry: f.geometry, properties: { mode: f.properties.mode, projectId: validated.id, projectName: validated.name } })) });
}

/** Import is deliberately limited to RFC 7946 WGS84, 2D, single-ring geometries. */
const importGeometry = z.object({
  type: z.enum(['Point', 'LineString', 'Polygon']), coordinates: z.unknown(),
}).passthrough();
const importFeature = z.object({
  type: z.literal('Feature'), geometry: importGeometry,
  properties: z.record(z.string(), z.unknown()).nullable(),
}).passthrough();
const importCollection = z.object({
  type: z.literal('FeatureCollection'), features: z.array(importFeature).min(1).max(100),
}).passthrough();
export const MAX_GEOJSON_BYTES = 10 * 1024 * 1024;
export function importGeoJSON(text: string, name: string, areaUnit: LocalProject['areaUnit'], lengthUnit: LocalProject['lengthUnit']): LocalProject {
  if (new TextEncoder().encode(text).byteLength > MAX_GEOJSON_BYTES) throw new Error('GeoJSON exceeds size limit');
  const data = importCollection.parse(JSON.parse(text));
  // Legacy GeoJSON CRS declarations and transformations are unsupported; never assume their coordinates are WGS84.
  if (Object.hasOwn(data, 'crs') || data.features.some(f => Object.hasOwn(f, 'crs') || Object.hasOwn(f.geometry, 'crs'))) throw new Error('Explicit CRS is not supported');
  return projectSchema.parse({
    schemaVersion: 1, id: crypto.randomUUID(), name: name.trim(), createdAt: new Date().toISOString(), crs: 'OGC:CRS84', areaUnit, lengthUnit,
    features: data.features.map(f => ({
      type: 'Feature', id: crypto.randomUUID(),
      geometry: { type: f.geometry.type, coordinates: f.geometry.coordinates },
      properties: { mode: f.geometry.type === 'Point' ? 'point' : f.geometry.type === 'LineString' ? 'linestring' : 'polygon' },
    })),
  });
}
