import type { GeoJSONStoreFeatures } from 'terra-draw';
import { projectSchema, type LocalProject } from '../../../../packages/storage/src/projects';
import type { AreaUnit, LengthUnit } from '../../../../packages/survey-engine/src';

/** Copy only canonical geometry, ID and mode; never persist Terra Draw handles or editor properties. */
export function createProject(name: string, features: GeoJSONStoreFeatures[], areaUnit: AreaUnit, lengthUnit: LengthUnit): LocalProject {
  return projectSchema.parse({ schemaVersion: 1, id: crypto.randomUUID(), name: name.trim(), createdAt: new Date().toISOString(), crs: 'OGC:CRS84', areaUnit, lengthUnit, features: features.map(f => ({ type: 'Feature', id: f.id, geometry: f.geometry, properties: { mode: f.properties.mode } })) });
}

/** Duplicate without sharing IDs; original data remains untouched. */
export function duplicateProject(source: LocalProject, name: string): LocalProject {
  return projectSchema.parse({ ...source, id: crypto.randomUUID(), name: name.trim(), createdAt: new Date().toISOString(), features: source.features.map(f => ({ ...f, id: crypto.randomUUID() })) });
}
