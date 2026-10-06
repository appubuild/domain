import type { Asset } from '@/types/domain';
import { coverArtUrl, patternUrl, palettes } from '@/lib/coverArt';

const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

interface AssetSeed {
  id: string;
  name: string;
  kind: Asset['kind'];
  folder: string;
  tags: string[];
  days: number;
  sizeMb: number;
  width: number;
  height: number;
  seedHint: string;
  palette: string;
  urlKind: 'cover' | 'pattern' | 'gradient' | 'photo';
}

const seeds: AssetSeed[] = [
  { id: 'asset_1', name: 'Ellsworth jetty, low tide', kind: 'upload', folder: 'Research', tags: ['coastal', 'reference'], days: 90, sizeMb: 2.8, width: 3024, height: 4032, seedHint: 'jetty', palette: 'ocean', urlKind: 'photo' },
  { id: 'asset_2', name: 'Harbour wall at dusk', kind: 'upload', folder: 'Research', tags: ['coastal', 'reference'], days: 88, sizeMb: 3.4, width: 4032, height: 3024, seedHint: 'harbourwall', palette: 'midnight', urlKind: 'photo' },
  { id: 'asset_3', name: 'Fog study 01', kind: 'ai-image', folder: 'Illustrations', tags: ['fog', 'atmosphere', 'ai'], days: 12, sizeMb: 1.9, width: 2048, height: 2048, seedHint: 'fogstudy1', palette: 'charcoal', urlKind: 'gradient' },
  { id: 'asset_4', name: 'Fog study 02 — vertical', kind: 'ai-image', folder: 'Illustrations', tags: ['fog', 'atmosphere', 'ai'], days: 12, sizeMb: 2.1, width: 1600, height: 2400, seedHint: 'fogstudy2', palette: 'charcoal', urlKind: 'gradient' },
  { id: 'asset_5', name: 'Lantern detail', kind: 'upload', folder: 'Illustrations', tags: ['lantern', 'object'], days: 60, sizeMb: 1.2, width: 1800, height: 1800, seedHint: 'lantern', palette: 'ember', urlKind: 'photo' },
  { id: 'asset_6', name: 'Harbour of Small Lights — cover', kind: 'cover', folder: 'Covers', tags: ['cover', 'final'], days: 214, sizeMb: 4.2, width: 1650, height: 2550, seedHint: 'harbour-cover', palette: 'ocean', urlKind: 'cover' },
  { id: 'asset_7', name: 'Harbour — cover concept A', kind: 'ai-image', folder: 'Covers', tags: ['cover', 'concept', 'ai'], days: 216, sizeMb: 2.9, width: 1600, height: 2400, seedHint: 'harbour-cover-b', palette: 'plum', urlKind: 'gradient' },
  { id: 'asset_8', name: 'Harbour — cover concept B', kind: 'ai-image', folder: 'Covers', tags: ['cover', 'concept', 'ai'], days: 216, sizeMb: 3.1, width: 1600, height: 2400, seedHint: 'harbour-cover-c', palette: 'rose', urlKind: 'gradient' },
  { id: 'asset_9', name: 'Paper texture (cream)', kind: 'background', folder: 'Backgrounds', tags: ['texture', 'paper'], days: 140, sizeMb: 0.8, width: 1200, height: 1200, seedHint: 'paper-cream', palette: 'sand', urlKind: 'pattern' },
  { id: 'asset_10', name: 'Dot grid (print safe)', kind: 'background', folder: 'Backgrounds', tags: ['pattern', 'grid'], days: 140, sizeMb: 0.2, width: 800, height: 800, seedHint: 'dots', palette: 'ink', urlKind: 'pattern' },
  { id: 'asset_11', name: 'Wave divider ornament', kind: 'illustration', folder: 'Ornaments', tags: ['ornament', 'divider'], days: 120, sizeMb: 0.3, width: 1400, height: 400, seedHint: 'wave-ornament', palette: 'ocean', urlKind: 'pattern' },
  { id: 'asset_12', name: 'Contour lines ornament', kind: 'illustration', folder: 'Ornaments', tags: ['ornament', 'map'], days: 96, sizeMb: 0.4, width: 1400, height: 400, seedHint: 'contour', palette: 'forest', urlKind: 'pattern' },
  { id: 'asset_13', name: 'Bramble & Ash imprint logo', kind: 'logo', folder: 'Brand', tags: ['logo', 'imprint'], days: 300, sizeMb: 0.1, width: 800, height: 800, seedHint: 'imprint-logo', palette: 'ink', urlKind: 'gradient' },
  { id: 'asset_14', name: 'Seagull silhouette', kind: 'illustration', folder: 'Ornaments', tags: ['icon', 'bird'], days: 70, sizeMb: 0.1, width: 600, height: 600, seedHint: 'seagull', palette: 'charcoal', urlKind: 'gradient' },
  { id: 'asset_15', name: 'Tide table scan', kind: 'upload', folder: 'Research', tags: ['tide', 'reference', '1974'], days: 92, sizeMb: 1.4, width: 2400, height: 3200, seedHint: 'tidetable', palette: 'sand', urlKind: 'photo' },
  { id: 'asset_16', name: 'Chapter opener rule', kind: 'illustration', folder: 'Ornaments', tags: ['rule', 'chapter'], days: 130, sizeMb: 0.05, width: 1600, height: 200, seedHint: 'rule', palette: 'ink', urlKind: 'pattern' },
];

function assetUrl(seed: AssetSeed) {
  if (seed.urlKind === 'cover') {
    return coverArtUrl({ seed: seed.seedHint, paletteId: seed.palette, style: 'sunrise', title: 'Harbour of Small Lights', author: 'Maya Chen' });
  }
  if (seed.urlKind === 'pattern') {
    const patternKind = seed.seedHint.length % 2 ? 'lines' : 'dots';
  return patternUrl(patternKind, palettes.find((entry) => entry.id === seed.palette)?.colors[2] ?? '#7c3aed');
  }
  return coverArtUrl({ seed: seed.seedHint, paletteId: seed.palette, style: seed.urlKind === 'photo' ? 'mountain' : 'aurora' });
}

export const seedAssets: Asset[] = seeds.map((seed) => ({
  id: seed.id,
  ownerId: 'user_demo',
  name: seed.name,
  kind: seed.kind,
  url: assetUrl(seed),
  mimeType: seed.urlKind === 'photo' ? 'image/jpeg' : 'image/png',
  sizeBytes: seed.sizeMb * 1024 * 1024,
  width: seed.width,
  height: seed.height,
  folder: seed.folder,
  tags: seed.tags,
  createdAt: daysAgo(seed.days),
  favorite: seed.id === 'asset_1' || seed.id === 'asset_6',
  storageKey: `users/user_demo/assets/${seed.seedHint}.${seed.urlKind === 'photo' ? 'jpg' : 'png'}`,
  bookId: seed.tags.includes('cover') ? 'mbook_harbour' : undefined,
}));
