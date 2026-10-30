import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { z } from 'zod';
import { measureGeometry } from '../../survey-engine/src';

const position = z.tuple([z.number().finite(), z.number().finite()]);
const geometry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: position }).strict(),
  z.object({ type: z.literal('LineString'), coordinates: z.array(position).min(2).max(2000) }).strict(),
  z.object({ type: z.literal('Polygon'), coordinates: z.tuple([z.array(position).min(4).max(2001)]) }).strict(),
]);
const feature = z.object({
  type: z.literal('Feature'), id: z.string().uuid(), geometry,
  properties: z.object({ mode: z.enum(['point', 'linestring', 'polygon', 'rectangle']) }).strict(),
}).strict().superRefine((f, ctx) => {
  const expected = f.geometry.type === 'Point' ? ['point'] : f.geometry.type === 'LineString' ? ['linestring'] : ['polygon', 'rectangle'];
  if (!expected.includes(f.properties.mode) || !measureGeometry(f.geometry).valid) ctx.addIssue({ code: 'custom', message: 'Invalid geometry or drawing mode' });
});
export const projectSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().uuid(), name: z.string().min(1).max(120).refine(value => value === value.trim(), 'Project name must not have leading or trailing whitespace'),
  createdAt: z.string().datetime(), crs: z.literal('OGC:CRS84'),
  areaUnit: z.enum(['m2', 'ft2', 'acre', 'hectare', 'decimal']), lengthUnit: z.enum(['m', 'ft']),
  features: z.array(feature).min(1).max(100),
}).strict().superRefine((p, ctx) => {
  if (new Set(p.features.map(f => f.id)).size !== p.features.length) ctx.addIssue({ code: 'custom', message: 'Duplicate feature IDs' });
});
export type LocalProject = z.infer<typeof projectSchema>;
/** The selected list entry no longer describes the stored copy. */
export class StaleProjectError extends Error {}
export interface ProjectRepository {
  list(): Promise<LocalProject[]>;
  listReadable(): Promise<{ projects: LocalProject[]; invalidCount: number }>;
  listUnreadable(): Promise<unknown[]>;
  get(id: string): Promise<LocalProject | undefined>;
  getIfUnchanged(expected: LocalProject): Promise<LocalProject>;
  countExisting(ids: readonly string[]): Promise<number>;
  add(project: LocalProject): Promise<void>;
  addIfUnchanged(expected: LocalProject, project: LocalProject): Promise<void>;
  delete(expected: LocalProject): Promise<void>;
  rename(expected: LocalProject, newName: string): Promise<LocalProject>;
  restore(projects: LocalProject[]): Promise<void>;
  close(): void;
}
interface ProjectDB extends DBSchema { projects: { key: string; value: LocalProject } }

/** Each write is atomic; add never replaces an existing project. */
export async function openProjectRepository(name = 'land-expert-projects'): Promise<ProjectRepository> {
  const db: IDBPDatabase<ProjectDB> = await openDB<ProjectDB>(name, 1, {
    upgrade(database) { database.createObjectStore('projects', { keyPath: 'id' }); },
    blocking() { db.close(); },
  });
  return {
    async list() { const rows: unknown[] = await db.getAll('projects'); return rows.map(row => projectSchema.parse(row)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },
    async listReadable() {
      // Corrupt records are retained; callers must never treat this as a complete backup.
      const rows: unknown[] = await db.getAll('projects');
      const projects: LocalProject[] = [];
      let invalidCount = 0;
      for (const row of rows) {
        const result = projectSchema.safeParse(row);
        if (result.success) projects.push(result.data);
        else invalidCount++;
      }
      projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { projects, invalidCount };
    },
    async listUnreadable() {
      const rows: unknown[] = await db.getAll('projects');
      return rows.filter(row => !projectSchema.safeParse(row).success);
    },
    async get(id) { const row: unknown = await db.get('projects', id); return row === undefined ? undefined : projectSchema.parse(row); },
    async getIfUnchanged(expected) {
      const snapshot = projectSchema.parse(expected);
      const raw: unknown = await db.get('projects', snapshot.id);
      if (raw === undefined) throw new StaleProjectError('Project was removed');
      const result = projectSchema.safeParse(raw);
      if (!result.success || JSON.stringify(result.data) !== JSON.stringify(snapshot)) throw new StaleProjectError('Project changed');
      return result.data;
    },
    async countExisting(ids) {
      if (!ids.length) return 0;
      // Queue all key reads in one readonly transaction for a consistent snapshot.
      const tx = db.transaction('projects', 'readonly');
      const checks = [...new Set(ids)].map(id => tx.store.getKey(id));
      const [keys] = await Promise.all([Promise.all(checks), tx.done]);
      return keys.filter(key => key !== undefined).length;
    },
    async add(project) { const parsed = projectSchema.parse(project); await db.add('projects', parsed); },
    async addIfUnchanged(expected, project) {
      const snapshot = projectSchema.parse(expected);
      const copy = projectSchema.parse(project);
      const tx = db.transaction('projects', 'readwrite');
      try {
        const raw = await tx.store.get(snapshot.id);
        if (!raw || JSON.stringify(projectSchema.parse(raw)) !== JSON.stringify(snapshot)) throw new Error('Project changed or was removed in another session');
        await tx.store.add(copy); await tx.done;
      } catch (error) { try { tx.abort(); } catch { /* Transaction may already be closed. */ } await tx.done.catch(() => {}); throw error; }
    },
    async delete(expected) {
      // The record the user confirmed must still match the stored record. Read and
      // delete in one transaction so another tab cannot change it between steps.
      const snapshot = projectSchema.parse(expected);
      const tx = db.transaction('projects', 'readwrite');
      try {
        const raw = await tx.store.get(snapshot.id);
        if (!raw || JSON.stringify(projectSchema.parse(raw)) !== JSON.stringify(snapshot)) throw new Error('Project changed or was removed in another session');
        await tx.store.delete(snapshot.id); await tx.done;
      } catch (error) { try { tx.abort(); } catch { /* Transaction may already be closed. */ } await tx.done.catch(() => {}); throw error; }
    },
    async rename(expected, newName) {
      const snapshot = projectSchema.parse(expected);
      const tx = db.transaction('projects', 'readwrite');
      try {
        const raw = await tx.store.get(snapshot.id);
        if (!raw) throw new Error('Project not found');
        const project = projectSchema.parse(raw);
        if (JSON.stringify(project) !== JSON.stringify(snapshot)) throw new Error('Project changed in another session');
        const updated = projectSchema.parse({ ...project, name: newName.trim() });
        await tx.store.put(updated); await tx.done; return updated;
      } catch (error) { try { tx.abort(); } catch { /* Transaction may already be closed. */ } await tx.done.catch(() => {}); throw error; }
    },
    async restore(projects) {
      const parsed = projects.map(project => projectSchema.parse(project));
      if (new Set(parsed.map(project => project.id)).size !== parsed.length) throw new Error('Duplicate project IDs');
      const tx = db.transaction('projects', 'readwrite');
      // Queue all writes in one transaction. A duplicate or failed write aborts the entire restore.
      try { await Promise.all([...parsed.map(project => tx.store.add(project)), tx.done]); }
      catch (error) { try { tx.abort(); } catch { /* The transaction may already be aborted. */ } await tx.done.catch(() => {}); throw error; }
    },
    close() { db.close(); },
  };
}
