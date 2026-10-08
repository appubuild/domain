import { coverArtUrl } from '@/lib/coverArt';
import type { AssetKind } from '@/types/domain';

/**
 * Admin-managed asset library (mock data).
 *
 * These are the assets Scriptora itself ships: illustrations, backgrounds, frames,
 * icons, stickers and imprint marks. They behave exactly like a user's own uploads
 * (same `Asset` shape, same insert path), so when an admin publishes or retires one,
 * nothing in the editor changes — the service just returns a different list.
 *
 * Phase 2 swaps this constant for an admin API; `assetService.library()` is the only
 * thing the UI talks to.
 */

export interface LibraryAssetSeed {
  id: string;
  name: string;
  kind: AssetKind;
  folder: string;
  tags: string[];
  /** Generated art keeps the demo working offline; a real deployment swaps in CDN URLs. */
  url: string;
  width: number;
  height: number;
  mimeType: string;
}

const art = (seed: string, paletteId: string) => coverArtUrl({ seed, paletteId });

export const LIBRARY_ASSETS: LibraryAssetSeed[] = [
  // illustrations
  { id: 'lib_il_1', name: 'Harbour at dawn', kind: 'illustration', folder: 'Illustrations', tags: ['harbour', 'sea', 'dawn', 'travel'], url: art('lib-harbour', 'ocean'), width: 1200, height: 1600, mimeType: 'image/svg+xml' },
  { id: 'lib_il_2', name: 'Cartographer’s desk', kind: 'illustration', folder: 'Illustrations', tags: ['map', 'desk', 'antique', 'history'], url: art('lib-desk', 'sand'), width: 1200, height: 800, mimeType: 'image/svg+xml' },
  { id: 'lib_il_3', name: 'Lantern doorway', kind: 'illustration', folder: 'Illustrations', tags: ['lantern', 'night', 'warm', 'story'], url: art('lib-lantern', 'ember'), width: 1000, height: 1400, mimeType: 'image/svg+xml' },
  { id: 'lib_il_4', name: 'Wildflower meadow', kind: 'illustration', folder: 'Illustrations', tags: ['flowers', 'meadow', 'nature', 'summer'], url: art('lib-meadow', 'forest'), width: 1400, height: 1000, mimeType: 'image/svg+xml' },
  { id: 'lib_il_5', name: 'Slow morning table', kind: 'illustration', folder: 'Illustrations', tags: ['coffee', 'morning', 'calm', 'notebook'], url: art('lib-morning', 'rose'), width: 1200, height: 1200, mimeType: 'image/svg+xml' },
  { id: 'lib_il_6', name: 'Library shelves', kind: 'illustration', folder: 'Illustrations', tags: ['library', 'books', 'reading', 'warm'], url: art('lib-library', 'lavender'), width: 1200, height: 1600, mimeType: 'image/svg+xml' },

  // backgrounds
  { id: 'lib_bg_1', name: 'Paper — cream', kind: 'background', folder: 'Backgrounds', tags: ['paper', 'cream', 'texture', 'warm'], url: art('lib-paper-cream', 'sand'), width: 1600, height: 1000, mimeType: 'image/svg+xml' },
  { id: 'lib_bg_2', name: 'Ink wash', kind: 'background', folder: 'Backgrounds', tags: ['ink', 'wash', 'blue', 'texture'], url: art('lib-ink-wash', 'ocean'), width: 1600, height: 1000, mimeType: 'image/svg+xml' },
  { id: 'lib_bg_3', name: 'Dusk gradient', kind: 'background', folder: 'Backgrounds', tags: ['gradient', 'dusk', 'purple', 'cover'], url: art('lib-dusk', 'midnight'), width: 1600, height: 1000, mimeType: 'image/svg+xml' },
  { id: 'lib_bg_4', name: 'Botanical green', kind: 'background', folder: 'Backgrounds', tags: ['green', 'botanical', 'nature', 'calm'], url: art('lib-botanical', 'forest'), width: 1600, height: 1000, mimeType: 'image/svg+xml' },

  // frames
  { id: 'lib_fr_1', name: 'Classic rule frame', kind: 'icon', folder: 'Frames', tags: ['frame', 'border', 'classic', 'print'], url: art('lib-frame-classic', 'sand'), width: 1000, height: 1400, mimeType: 'image/svg+xml' },
  { id: 'lib_fr_2', name: 'Ornamental frame', kind: 'icon', folder: 'Frames', tags: ['frame', 'ornament', 'decorative'], url: art('lib-frame-ornament', 'ember'), width: 1000, height: 1400, mimeType: 'image/svg+xml' },
  { id: 'lib_fr_3', name: 'Soft round frame', kind: 'icon', folder: 'Frames', tags: ['frame', 'round', 'soft', 'portrait'], url: art('lib-frame-round', 'rose'), width: 1000, height: 1000, mimeType: 'image/svg+xml' },

  // icons
  { id: 'lib_ic_1', name: 'Quill mark', kind: 'icon', folder: 'Icons', tags: ['quill', 'writing', 'line', 'icon'], url: art('lib-icon-quill', 'lavender'), width: 400, height: 400, mimeType: 'image/svg+xml' },
  { id: 'lib_ic_2', name: 'Compass mark', kind: 'icon', folder: 'Icons', tags: ['compass', 'travel', 'line', 'icon'], url: art('lib-icon-compass', 'ocean'), width: 400, height: 400, mimeType: 'image/svg+xml' },
  { id: 'lib_ic_3', name: 'Cup mark', kind: 'icon', folder: 'Icons', tags: ['cup', 'recipe', 'line', 'icon'], url: art('lib-icon-cup', 'sand'), width: 400, height: 400, mimeType: 'image/svg+xml' },
  { id: 'lib_ic_4', name: 'Leaf mark', kind: 'icon', folder: 'Icons', tags: ['leaf', 'nature', 'line', 'icon'], url: art('lib-icon-leaf', 'forest'), width: 400, height: 400, mimeType: 'image/svg+xml' },

  // stickers
  { id: 'lib_st_1', name: 'Chapter ornament', kind: 'illustration', folder: 'Stickers', tags: ['ornament', 'chapter', 'flourish', 'divider'], url: art('lib-sticker-ornament', 'sand'), width: 800, height: 300, mimeType: 'image/svg+xml' },
  { id: 'lib_st_2', name: 'Scene separator', kind: 'illustration', folder: 'Stickers', tags: ['separator', 'scene', 'dinkus'], url: art('lib-sticker-separator', 'sand'), width: 800, height: 200, mimeType: 'image/svg+xml' },
  { id: 'lib_st_3', name: 'Star cluster', kind: 'illustration', folder: 'Stickers', tags: ['stars', 'fun', 'magic'], url: art('lib-sticker-stars', 'midnight'), width: 600, height: 600, mimeType: 'image/svg+xml' },

  // logos / imprint marks
  { id: 'lib_lg_1', name: 'Imprint mark — round', kind: 'logo', folder: 'Logos', tags: ['logo', 'imprint', 'publisher', 'round'], url: art('lib-logo-round', 'midnight'), width: 500, height: 500, mimeType: 'image/svg+xml' },
  { id: 'lib_lg_2', name: 'Imprint mark — banner', kind: 'logo', folder: 'Logos', tags: ['logo', 'imprint', 'publisher', 'banner'], url: art('lib-logo-banner', 'midnight'), width: 900, height: 300, mimeType: 'image/svg+xml' },
  { id: 'lib_lg_3', name: 'Press wordmark', kind: 'logo', folder: 'Logos', tags: ['logo', 'wordmark', 'press'], url: art('lib-logo-wordmark', 'ember'), width: 900, height: 300, mimeType: 'image/svg+xml' },
];

/** Fresh-user friendly: the library is always available, even with no uploads. */
export function libraryAssetsFor(kind: AssetKind | 'all'): LibraryAssetSeed[] {
  return kind === 'all' ? LIBRARY_ASSETS : LIBRARY_ASSETS.filter((asset) => asset.kind === kind);
}

/** Categories the admin library can fill, mapped to the panel category ids. */
export const LIBRARY_FOR_CATEGORY: Record<string, AssetKind[]> = {
  images: ['image'],
  illustrations: ['illustration'],
  icons: ['icon'],
  backgrounds: ['background'],
  frames: ['icon'],
  stickers: ['illustration'],
  logos: ['logo'],
};
