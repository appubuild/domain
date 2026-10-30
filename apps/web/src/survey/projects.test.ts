import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { openProjectRepository, projectSchema, type ProjectRepository } from '../../../../packages/storage/src/projects';
import { createProject, duplicateProject } from './project-adapter';
import { createBackup, parseBackup, exportGeoJSON, importGeoJSON, MAX_BACKUP_BYTES, MAX_GEOJSON_BYTES } from '../../../../packages/storage/src/transfer';
import type { GeoJSONStoreFeatures } from 'terra-draw';
const shape: GeoJSONStoreFeatures = { type: 'Feature', id: 'e3236b84-2d4c-4e6c-8dea-20ba22ffb898', geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] }, properties: { mode: 'polygon', selected: true } };
let repo: ProjectRepository | undefined;
afterEach(() => { repo?.close(); repo = undefined; });
describe('local project repository', () => {
  it('saves and reopens validated geometry while excluding editor-only state', async () => {
    const name = crypto.randomUUID(); repo = await openProjectRepository(name);
    const project = createProject('  Field  ', [shape], 'acre', 'ft');
    await repo.add(project); repo.close(); repo = await openProjectRepository(name);
    const loaded = await repo.get(project.id);
    expect(loaded).toEqual(project); expect(loaded?.name).toBe('Field');
    expect(loaded?.features[0].properties).toEqual({ mode: 'polygon' });
    expect(await repo.list()).toHaveLength(1);
  });
  it('does not overwrite existing data when a duplicate ID or invalid geometry is saved', async () => {
    repo = await openProjectRepository(crypto.randomUUID());
    const original = createProject('Original', [shape], 'm2', 'm'); await repo.add(original);
    await expect(repo.add({ ...original, name: 'Overwrite' })).rejects.toThrow();
    expect((await repo.get(original.id))?.name).toBe('Original');
    expect(() => projectSchema.parse({ ...original, id: crypto.randomUUID(), features: [{ ...original.features[0], geometry: { type: 'Polygon', coordinates: [[[0,0],[1,1],[1,0],[0,1],[0,0]]] } }] })).toThrow();
    expect(await repo.list()).toHaveLength(1);
  });
  it('deletes only the requested project', async () => {
    repo = await openProjectRepository(crypto.randomUUID());
    const a = createProject('A', [shape], 'm2', 'm'); const b = createProject('B', [shape], 'm2', 'm');
    await repo.add(a); await repo.add(b); await repo.delete(a);
    expect(await repo.get(a.id)).toBeUndefined(); expect(await repo.get(b.id)).toEqual(b);
  });
  it('rejects noncanonical stored and backup names rather than silently altering them', async () => {
    const dbName = crypto.randomUUID();
    repo = await openProjectRepository(dbName);
    const db = await openDB(dbName, 1);
    try {
      const original = createProject('Field', [shape], 'm2', 'm');
      const raw = { ...original, name: ' Field ' };
      await db.add('projects', raw);
      expect(await repo.listReadable()).toEqual({ projects: [], invalidCount: 1 });
      expect(await repo.listUnreadable()).toEqual([raw]);
      expect(await db.get('projects', original.id)).toEqual(raw);
      const text = JSON.stringify({ format: 'land-expert-backup', version: 1, projects: [raw] });
      expect(() => parseBackup(text)).toThrow();
      expect(() => createBackup([raw])).toThrow();
      expect(await db.get('projects', original.id)).toEqual(raw);
      expect(duplicateProject(original, '  Copy  ').name).toBe('Copy');
      const imported = importGeoJSON(exportGeoJSON(original), '  Imported  ', 'm2', 'm');
      expect(imported.name).toBe('Imported');
      await repo.add(imported);
      expect((await repo.rename(imported, '  Renamed  ')).name).toBe('Renamed');
    } finally { db.close(); }
  });

  it('round trips a backup and exports interoperable GeoJSON', async () => {
    repo = await openProjectRepository(crypto.randomUUID());
    const a = createProject('জমি', [shape], 'acre', 'ft');
    const copy = parseBackup(createBackup([a]));
    await repo.restore(copy);
    expect(await repo.get(a.id)).toEqual(a);
    const geojson = JSON.parse(exportGeoJSON(a));
    expect(geojson.type).toBe('FeatureCollection');
    expect(geojson.features[0].geometry).toEqual(a.features[0].geometry);
    expect(geojson.features[0].properties.projectName).toBe('জমি');
    expect(geojson.crs).toBeUndefined();
  });
  it('rolls back the entire restore when any ID already exists', async () => {
    repo = await openProjectRepository(crypto.randomUUID());
    const old = createProject('Existing', [shape], 'm2', 'm');
    const fresh = createProject('Fresh', [shape], 'm2', 'm');
    await repo.add(old);
    await expect(repo.restore([fresh, { ...old, name: 'Overwrite' }])).rejects.toThrow();
    expect(await repo.get(fresh.id)).toBeUndefined();
    expect((await repo.get(old.id))?.name).toBe('Existing');
  });
  it('rejects invalid, duplicated and oversized backups before writing', () => {
    const a = createProject('A', [shape], 'm2', 'm');
    expect(() => createBackup([a, a])).toThrow();
    expect(() => parseBackup('{not json')).toThrow();
    expect(() => parseBackup('x'.repeat(MAX_BACKUP_BYTES + 1))).toThrow();
    expect(() => parseBackup(JSON.stringify({ format: 'land-expert-backup', version: 2, projects: [a] }))).toThrow();
  });

  it('imports exported GeoJSON as a new validated project without editor properties', async () => {
    repo = await openProjectRepository(crypto.randomUUID());
    const source = createProject('Original', [shape], 'acre', 'ft');
    const imported = importGeoJSON(exportGeoJSON(source), 'Imported', 'm2', 'm');
    expect(imported.id).not.toBe(source.id);
    expect(imported.features[0].id).not.toBe(source.features[0].id);
    expect(imported.features[0].geometry).toEqual(source.features[0].geometry);
    expect(imported.features[0].properties).toEqual({ mode: 'polygon' });
    await repo.add(source); await repo.add(imported);
    expect(await repo.list()).toHaveLength(2);
  });
  it('rejects invalid, legacy CRS, unsupported, 3D and oversized GeoJSON', () => {
    const original = createProject('Original', [shape], 'm2', 'm');
    const good = JSON.parse(exportGeoJSON(original));
    expect(() => importGeoJSON(JSON.stringify({ ...good, crs: { type: 'name', properties: { name: 'EPSG:3857' } } }), 'A', 'm2', 'm')).toThrow();
    expect(() => importGeoJSON(JSON.stringify({ ...good, features: [{ ...good.features[0], geometry: { type: 'MultiPoint', coordinates: [[1, 2]] } }] }), 'A', 'm2', 'm')).toThrow();
    expect(() => importGeoJSON(JSON.stringify({ ...good, features: [{ ...good.features[0], geometry: { type: 'Point', coordinates: [90, 23, 4] } }] }), 'A', 'm2', 'm')).toThrow();
    expect(() => importGeoJSON(JSON.stringify({ ...good, features: [{ ...good.features[0], geometry: { type: 'Polygon', coordinates: [[[0,0],[1,1],[1,0],[0,1],[0,0]]] } }] }), 'A', 'm2', 'm')).toThrow();
    expect(() => importGeoJSON('{broken', 'A', 'm2', 'm')).toThrow();
    expect(() => importGeoJSON('x'.repeat(MAX_GEOJSON_BYTES + 1), 'A', 'm2', 'm')).toThrow();
  });

  it('renames without overwriting a change from another session and duplicates with fresh IDs', async () => {
    repo = await openProjectRepository(crypto.randomUUID());
    const source = createProject('Original', [shape], 'm2', 'm'); await repo.add(source);
    const renamed = await repo.rename(source, 'Renamed');
    await expect(repo.rename(source, 'Stale change')).rejects.toThrow();
    expect((await repo.get(source.id))?.name).toBe('Renamed');
    const duplicate = duplicateProject(renamed, 'Copy');
    expect(duplicate.id).not.toBe(source.id); expect(duplicate.features[0].id).not.toBe(source.features[0].id);
    expect(duplicate.features[0].geometry).toEqual(source.features[0].geometry);
    await repo.add(duplicate); expect(await repo.list()).toHaveLength(2);
  });

  it('rejects a stale rename when a replacement has the same name but different geometry', async () => {
    const dbName = crypto.randomUUID();
    repo = await openProjectRepository(dbName);
    const other = await openProjectRepository(dbName);
    try {
      const original = createProject('Shared', [shape], 'm2', 'm');
      await repo.add(original);
      const stale = await repo.get(original.id);
      const replacement = projectSchema.parse({ ...original, features: [{ ...original.features[0], geometry: { type: 'Point', coordinates: [90.5, 23.9] }, properties: { mode: 'point' } }] });
      await other.delete(original);
      await other.restore([replacement]);
      await expect(repo.rename(stale!, 'Wrong name')).rejects.toThrow('changed in another session');
      expect(await repo.get(original.id)).toEqual(replacement);
      const renamed = await repo.rename(replacement, 'Updated name');
      expect(renamed).toEqual({ ...replacement, name: 'Updated name' });
      expect(await other.get(original.id)).toEqual(renamed);
    } finally { other.close(); }
  });

  it('atomically duplicates only an unchanged source and never overwrites a project', async () => {
    const dbName = crypto.randomUUID();
    repo = await openProjectRepository(dbName);
    const other = await openProjectRepository(dbName);
    try {
      const source = createProject('Source', [shape], 'm2', 'm');
      await repo.add(source);
      const firstCopy = duplicateProject(source, 'Copy');
      await repo.addIfUnchanged(source, firstCopy);
      expect(await other.get(firstCopy.id)).toEqual(firstCopy);
      await expect(repo.addIfUnchanged(source, { ...firstCopy, name: 'Overwrite' })).rejects.toThrow();
      expect(await other.get(firstCopy.id)).toEqual(firstCopy);
      const renamed = await other.rename(source, 'New source name');
      const staleCopy = duplicateProject(source, 'Stale copy');
      await expect(repo.addIfUnchanged(source, staleCopy)).rejects.toThrow('changed or was removed');
      expect(await repo.get(staleCopy.id)).toBeUndefined();
      expect(await repo.get(source.id)).toEqual(renamed);
      await other.delete(renamed);
      const replacement = projectSchema.parse({ ...renamed, features: [{ ...renamed.features[0], geometry: { type: 'Point', coordinates: [90.5, 23.9] }, properties: { mode: 'point' } }] });
      await other.restore([replacement]);
      const wrongGeometryCopy = duplicateProject(renamed, 'Wrong geometry');
      await expect(repo.addIfUnchanged(renamed, wrongGeometryCopy)).rejects.toThrow('changed or was removed');
      expect(await repo.get(wrongGeometryCopy.id)).toBeUndefined();
      expect(await repo.get(source.id)).toEqual(replacement);
      await other.delete(replacement);
      const missingCopy = duplicateProject(renamed, 'Missing source');
      await expect(repo.addIfUnchanged(renamed, missingCopy)).rejects.toThrow('changed or was removed');
      expect(await repo.get(missingCopy.id)).toBeUndefined();
      expect(await repo.list()).toEqual([firstCopy]);
    } finally { other.close(); }
  });

  it('reads only a matching snapshot and rejects changed, unreadable, or removed copies', async () => {
    const dbName = crypto.randomUUID();
    repo = await openProjectRepository(dbName);
    const other = await openProjectRepository(dbName);
    const db = await openDB(dbName, 1);
    try {
      const source = createProject('Field', [shape], 'm2', 'm');
      await repo.add(source);
      expect(await repo.getIfUnchanged(source)).toEqual(source);
      const renamed = await other.rename(source, 'New name');
      await expect(repo.getIfUnchanged(source)).rejects.toThrow('Project changed');
      expect(await repo.getIfUnchanged(renamed)).toEqual(renamed);
      const raw = { id: source.id, schemaVersion: 2, name: 'Unreadable' };
      await db.put('projects', raw);
      await expect(repo.getIfUnchanged(renamed)).rejects.toThrow('Project changed');
      expect(await db.get('projects', source.id)).toEqual(raw);
      await db.delete('projects', source.id);
      await expect(repo.getIfUnchanged(renamed)).rejects.toThrow('Project was removed');
    } finally { db.close(); other.close(); }
  });

  it('rejects a stale delete across two connections and preserves the newer copy', async () => {
    const dbName = crypto.randomUUID();
    repo = await openProjectRepository(dbName);
    const other = await openProjectRepository(dbName);
    try {
      const original = createProject('Original', [shape], 'm2', 'm');
      await repo.add(original);
      const stale = await repo.get(original.id);
      const updated = await other.rename(original, 'Renamed elsewhere');
      await expect(repo.delete(stale!)).rejects.toThrow('changed or was removed');
      expect(await repo.get(original.id)).toEqual(updated);
      await repo.delete(updated);
      expect(await other.get(original.id)).toBeUndefined();
    } finally { other.close(); }
  });

  it('can back up individual copies when the collection exceeds the all-copy count limit', () => {
    const projects = Array.from({ length: 101 }, (_, index) => createProject(`Field ${index}`, [shape], 'm2', 'm'));
    expect(() => createBackup(projects)).toThrow();
    expect(parseBackup(createBackup([projects[100]]))).toEqual([projects[100]]);
  });

  it('previews existing IDs without writing and restore still detects later conflicts', async () => {
    const name = crypto.randomUUID(); repo = await openProjectRepository(name);
    const other = await openProjectRepository(name);
    try {
      const existing = createProject('Existing', [shape], 'm2', 'm');
      const fresh = createProject('Fresh', [shape], 'm2', 'm');
      await repo.add(existing);
      expect(await repo.countExisting([existing.id, fresh.id, existing.id])).toBe(1);
      expect(await repo.countExisting([fresh.id])).toBe(0);
      expect(await repo.countExisting([])).toBe(0);
      await other.add(fresh);
      expect(await repo.countExisting([existing.id, fresh.id])).toBe(2);
      await expect(repo.restore([fresh])).rejects.toThrow();
      expect(await repo.list()).toHaveLength(2);
      expect(await repo.get(fresh.id)).toEqual(fresh);
    } finally { other.close(); }
  });

  it('isolates unreadable records without deleting them or allowing incomplete all-copy backups', async () => {
    const dbName = crypto.randomUUID(); repo = await openProjectRepository(dbName);
    const readable = createProject('Readable', [shape], 'm2', 'm');
    await repo.add(readable);
    const raw = await openDB(dbName, 1);
    const unreadable = { id: crypto.randomUUID(), schemaVersion: 2, name: 'Future data' };
    try {
      await raw.add('projects', unreadable);
      expect(await repo.listReadable()).toEqual({ projects: [readable], invalidCount: 1 });
      expect(await repo.listUnreadable()).toEqual([unreadable]);
      await expect(repo.list()).rejects.toThrow();
      expect(await raw.get('projects', unreadable.id)).toEqual(unreadable);
      const additional = createProject('Recovered', [shape], 'm2', 'm');
      await repo.restore([additional]);
      const result = await repo.listReadable();
      expect(result.invalidCount).toBe(1);
      expect(result.projects.map(project => project.id)).toEqual(expect.arrayContaining([readable.id, additional.id]));
      expect(await raw.get('projects', unreadable.id)).toEqual(unreadable);
    } finally { raw.close(); }
  });

});
