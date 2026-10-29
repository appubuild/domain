import { z } from 'zod';

/** Public, administrator-controlled configuration. It must never contain credentials. */
const plainText = z.string().min(1).max(100).refine(s => s.trim() === s && !/[\u0000-\u001f\u007f]/.test(s));
const secureUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/\.+$/, '');
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash &&
      host.includes('.') && !/^\d+(?:\.\d+){3}$/.test(host) && host !== 'localhost' && !host.endsWith('.local') && !host.endsWith('.localhost');
  } catch { return false; }
};
const template = z.string().max(1024).refine(value => {
  if (!['{z}', '{x}', '{y}'].every(token => value.split(token).length === 2)) return false;
  const substituted = value.replace('{z}', '0').replace('{x}', '0').replace('{y}', '0');
  if (/[{}]/.test(substituted) || !secureUrl(substituted)) return false;
  // Variables belong in the path, never the hostname or authentication fields.
  const start = value.indexOf('/', 'https://'.length);
  return start !== -1 && ['{z}', '{x}', '{y}'].every(token => value.indexOf(token) > start);
}, 'Invalid public HTTPS tile template');
const provider = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/).refine(id => id !== 'grid' && id !== 'osm'),
  name: plainText, tileUrl: template, tileSize: z.union([z.literal(256), z.literal(512)]),
  maxZoom: z.number().int().min(0).max(22), attribution: plainText,
  attributionUrl: z.string().max(1024).refine(secureUrl, 'Attribution must be a public HTTPS URL'),
}).strict();
const schema = z.object({
  version: z.literal(1), allowCommunityOsm: z.boolean(), providers: z.array(provider).max(10),
}).strict().superRefine((data, ctx) => {
  if (new Set(data.providers.map(p => p.id)).size !== data.providers.length) ctx.addIssue({ code: 'custom', message: 'Duplicate provider IDs' });
});
export type MapProvider = z.infer<typeof provider>;
export type MapCatalogConfig = z.infer<typeof schema>;
export const osmProvider: MapProvider = {
  id: 'osm', name: 'OpenStreetMap', tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', tileSize: 256, maxZoom: 19,
  attribution: '© OpenStreetMap contributors', attributionUrl: 'https://www.openstreetmap.org/copyright',
};
export function parseMapCatalog(value: unknown): MapCatalogConfig { return schema.parse(value); }
