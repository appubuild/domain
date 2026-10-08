import type { ElementType, PageElement } from '@/types/domain';
import { uid } from '@/lib/utils';

/**
 * Content libraries for the editor canvas.
 *
 * Everything here is data, not UI: the sidebar renders it, the service layer can
 * replace it with admin-managed or provider results, and each entry knows how to
 * build the real element it inserts. No entry is decorative — if it appears in a
 * library it can be placed, moved, restyled and exported.
 */

export interface LibraryEntry {
  id: string;
  label: string;
  /** Short hint shown as a tooltip. */
  hint?: string;
  type: ElementType;
  /** SVG path/shape drawn as a preview and used for icons/ornaments. */
  preview?: string;
  build: (page: { id: string }) => PageElement;
}

export interface LibraryGroup {
  id: string;
  label: string;
  description: string;
  entries: LibraryEntry[];
}

const base = (type: ElementType, name: string, overrides: Partial<PageElement> = {}): PageElement => ({
  id: uid('el'),
  type,
  name,
  x: 12,
  y: 16,
  w: 26,
  h: 18,
  rotation: 0,
  visible: true,
  locked: false,
  z: 5,
  ...overrides,
});

const shape = (name: string, fill: string, radius: number | undefined, extra: Partial<PageElement> = {}) =>
  base('shape', name, { shape: { kind: radius === undefined ? 'rect' : 'rect', fill, stroke: 'transparent', strokeWidth: 0, radius: radius ?? 0 }, ...extra });

const line = (name: string, thickness: number, colour = '#111827', style: 'solid' | 'dashed' | 'dotted' | 'double' = 'solid') =>
  base('line', name, { w: 40, h: 2, divider: { style, color: colour, thickness } });

/* ------------------------------------------------------------------ groups */

export const ELEMENT_LIBRARY: LibraryGroup[] = [
  {
    id: 'shapes',
    label: 'Basic shapes',
    description: 'Rectangles, ellipses, triangles and stars for panels and backgrounds.',
    entries: [
      { id: 'rect', label: 'Rectangle', type: 'shape', build: () => shape('Rectangle', '#e2e8f0', 0) },
      { id: 'rounded', label: 'Rounded box', type: 'shape', build: () => shape('Rounded box', '#dbeafe', 12) },
      { id: 'circle', label: 'Ellipse', type: 'shape', build: () => shape('Ellipse', '#fde68a', 999) },
      { id: 'triangle', label: 'Triangle', type: 'shape', build: () => shape('Triangle', '#fca5a5', undefined) },
      { id: 'star', label: 'Star', type: 'shape', build: () => shape('Star', '#fcd34d', undefined) },
      { id: 'blob', label: 'Organic blob', type: 'shape', build: () => shape('Organic blob', '#bbf7d0', 999) },
    ],
  },
  {
    id: 'lines',
    label: 'Lines & arrows',
    description: 'Rules, arrows and connectors that stay crisp in print.',
    entries: [
      { id: 'rule', label: 'Thin rule', type: 'line', build: () => line('Thin rule', 1) },
      { id: 'rule-thick', label: 'Thick rule', type: 'line', build: () => line('Thick rule', 4) },
      { id: 'rule-dashed', label: 'Dashed rule', type: 'line', build: () => line('Dashed rule', 1, '#111827', 'dashed') },
      { id: 'arrow', label: 'Arrow', type: 'line', build: () => base('line', 'Arrow', { w: 30, h: 2, divider: { style: 'solid', color: '#111827', thickness: 1 }, shape: { kind: 'rect', fill: 'transparent', stroke: '#111827', strokeWidth: 1, radius: 0 } }) },
      { id: 'connector', label: 'Connector', type: 'line', build: () => line('Connector', 1, '#64748b', 'dotted') },
    ],
  },
  {
    id: 'frames',
    label: 'Frames',
    description: 'Page and photo frames with the border geometry books expect.',
    entries: [
      { id: 'frame-thin', label: 'Thin frame', type: 'decoration', build: () => base('decoration', 'Thin frame', { w: 60, h: 70, shape: { kind: 'rect', fill: 'transparent', stroke: '#111827', strokeWidth: 1, radius: 0 } }) },
      { id: 'frame-double', label: 'Double frame', type: 'decoration', build: () => base('decoration', 'Double frame', { w: 60, h: 70, shape: { kind: 'rect', fill: 'transparent', stroke: '#111827', strokeWidth: 2, radius: 2 } }) },
      { id: 'frame-round', label: 'Round frame', type: 'decoration', build: () => base('decoration', 'Round frame', { w: 40, h: 40, shape: { kind: 'rect', fill: 'transparent', stroke: '#b45309', strokeWidth: 2, radius: 999 } }) },
      { id: 'frame-corner', label: 'Corner ornament', type: 'decoration', build: () => base('decoration', 'Corner ornament', { w: 18, h: 18, icon: 'corner' }) },
    ],
  },
  {
    id: 'dividers',
    label: 'Dividers & ornaments',
    description: 'Scene separators, chapter ornaments and typographic flourishes.',
    entries: [
      { id: 'ornament-star', label: 'Ornament ✦ ✦ ✦', type: 'divider', build: () => base('divider', 'Ornament', { w: 30, h: 3, divider: { style: 'ornament', color: '#111827', thickness: 1 } }) },
      { id: 'sep-scene', label: 'Scene separator', type: 'divider', build: () => base('divider', 'Scene separator', { w: 24, h: 3, divider: { style: 'ornament', color: '#6b7280', thickness: 1 } }) },
      { id: 'flourish', label: 'Flourish rule', type: 'divider', build: () => base('divider', 'Flourish', { w: 36, h: 3, divider: { style: 'double', color: '#111827', thickness: 1 } }) },
      { id: 'chapter-ornament', label: 'Chapter ornament', type: 'decoration', build: () => base('decoration', 'Chapter ornament', { w: 20, h: 8, text: '<p style="text-align:center;letter-spacing:.4em">✦ ✦ ✦</p>' }) },
      { id: 'drop-cap-box', label: 'Drop cap block', type: 'text', build: () => base('text', 'Drop cap block', { w: 46, h: 22, text: '<p><span style="float:left;font-size:3.2em;line-height:.85;padding-right:.08em">O</span>nce upon a time the page opened like a door.</p>' }) },
    ],
  },
  {
    id: 'book',
    label: 'Book elements',
    description: 'The blocks a typesetter reaches for: pull quotes, notes, captions and front/back matter.',
    entries: [
      { id: 'pull-quote', label: 'Pull quote', type: 'quote', build: () => base('quote', 'Pull quote', { w: 56, h: 20, text: '<blockquote>“A sentence worth setting larger than the rest.”</blockquote>' }) },
      { id: 'footnote-rule', label: 'Footnote rule', type: 'divider', build: () => base('divider', 'Footnote rule', { y: 82, w: 22, h: 2, divider: { style: 'solid', color: '#111827', thickness: 1 } }) },
      { id: 'footnote-block', label: 'Footnote block', type: 'text', build: () => base('text', 'Footnote block', { y: 84, w: 60, h: 10, text: '<p style="font-size:.78em;line-height:1.3">1. Notes set in the footer, ready for print or EPUB.</p>' }) },
      { id: 'caption', label: 'Image caption', type: 'text', build: () => base('text', 'Image caption', { y: 74, w: 50, h: 8, text: '<p style="text-align:center;font-size:.8em;font-style:italic">Figure 1 — caption text.</p>' }) },
      { id: 'running-head', label: 'Running header', type: 'text', build: () => base('text', 'Running header', { y: 3, w: 70, h: 5, text: '<p style="text-align:center;font-size:.72em;letter-spacing:.14em;text-transform:uppercase">{{chapter}}</p>' }) },
      { id: 'page-number', label: 'Page number', type: 'pageNumber', build: () => base('pageNumber', 'Page number', { y: 93, x: 44, w: 12, h: 4 }) },
      { id: 'copyright', label: 'Copyright block', type: 'text', build: () => base('text', 'Copyright block', { x: 10, y: 66, w: 80, h: 22, text: '<p style="font-size:.78em;text-align:center">Copyright © {{year}} {{author}}<br/>All rights reserved.<br/>ISBN 000-0-000000-00-0</p>' }) },
      { id: 'dedication', label: 'Dedication', type: 'text', build: () => base('text', 'Dedication', { x: 18, y: 36, w: 64, h: 18, text: '<p style="text-align:center;font-style:italic">For everyone who kept the light on.</p>' }) },
      { id: 'epigraph', label: 'Epigraph', type: 'text', build: () => base('text', 'Epigraph', { x: 16, y: 30, w: 68, h: 24, text: '<blockquote style="text-align:center">“Every book is a message in a bottle.”<br/>— Anonymous</blockquote>' }) },
      { id: 'author-bio', label: 'Author bio', type: 'text', build: () => base('text', 'Author bio', { x: 12, y: 30, w: 76, h: 30, text: '<h3>About the author</h3><p>Two or three sentences of biography, set in the back matter.</p>' }) },
      { id: 'callout', label: 'Callout box', type: 'text', build: () => base('text', 'Callout', { w: 56, h: 20, text: '<p><strong>Note</strong> — a highlighted aside.</p>', style: { background: '#fef3c7', borderWidth: 1, borderColor: '#f59e0b', borderRadius: 6, padding: 0.8 } }) },
      { id: 'recipe', label: 'Recipe block', type: 'text', build: () => base('text', 'Recipe', { w: 56, h: 30, text: '<h3>Recipe</h3><p><strong>Serves</strong> 4 · <strong>Time</strong> 30 min</p><ul><li>Ingredient one</li><li>Ingredient two</li></ul>' }) },
      { id: 'worksheet', label: 'Worksheet block', type: 'text', build: () => base('text', 'Worksheet', { w: 62, h: 30, text: '<p><strong>Try it:</strong></p><p>1. …<br/>2. …<br/>3. …</p>', style: { borderWidth: 1, borderColor: '#94a3b8', borderRadius: 6, padding: 0.8 } }) },
      { id: 'quote-block', label: 'Quote block', type: 'quote', build: () => base('quote', 'Quote block', { w: 60, h: 18, text: '<blockquote>A quotation block with an attribution.<footer>— Source</footer></blockquote>' }) },
    ],
  },
  {
    id: 'tables',
    label: 'Tables',
    description: 'Data tables that stay inside the page, with headers and captions.',
    entries: [
      { id: 'table-2x2', label: 'Table 2 × 2', type: 'table', build: () => base('table', 'Table 2 × 2', { w: 50, h: 20, table: { rows: 2, cols: 2, headerRow: true, borderColor: '#cbd5e1', cells: [['Column', 'Column'], ['', '']] } }) },
      { id: 'table-3x3', label: 'Table 3 × 3', type: 'table', build: () => base('table', 'Table 3 × 3', { w: 56, h: 26, table: { rows: 3, cols: 3, headerRow: true, borderColor: '#cbd5e1', cells: [['Column', 'Column', 'Column'], ['', '', ''], ['', '', '']] } }) },
      { id: 'table-data', label: 'Data table 5 × 4', type: 'table', build: () => base('table', 'Data table', { w: 60, h: 34, table: { rows: 5, cols: 4, headerRow: true, borderColor: '#94a3b8', cells: [['Item', 'Qty', 'Unit', 'Total'], ['', '', '', ''], ['', '', '', ''], ['', '', '', ''], ['', '', '', '']] } }) },
      { id: 'table-caption', label: 'Table with caption', type: 'table', build: () => base('table', 'Table with caption', { w: 56, h: 30, table: { rows: 3, cols: 3, headerRow: true, borderColor: '#cbd5e1', caption: 'Table 1 — caption text', cells: [['Column', 'Column', 'Column'], ['', '', ''], ['', '', '']] } }) },
    ],
  },
  {
    id: 'badges',
    label: 'Badges & labels',
    description: 'Badges, labels, callouts and speech bubbles.',
    entries: [
      { id: 'badge', label: 'Badge', type: 'text', build: () => base('text', 'Badge', { w: 18, h: 6, text: '<p style="text-align:center;font-size:.7em;letter-spacing:.12em;text-transform:uppercase">New</p>', style: { background: '#111827', color: '#ffffff', borderRadius: 999, padding: 0.3 } }) },
      { id: 'label', label: 'Label', type: 'text', build: () => base('text', 'Label', { w: 22, h: 7, text: '<p style="text-align:center">Label</p>', style: { background: '#e2e8f0', borderRadius: 4, padding: 0.4 } }) },
      { id: 'speech', label: 'Speech bubble', type: 'decoration', build: () => base('decoration', 'Speech bubble', { w: 30, h: 18, shape: { kind: 'rect', fill: '#ffffff', stroke: '#111827', strokeWidth: 1, radius: 14 } }) },
      { id: 'callout-arrow', label: 'Callout arrow', type: 'decoration', build: () => base('decoration', 'Callout arrow', { w: 14, h: 12, icon: 'arrow' }) },
    ],
  },
  {
    id: 'patterns',
    label: 'Patterns & backgrounds',
    description: 'Repeatable patterns for chapter openers and section breaks.',
    entries: [
      { id: 'dots', label: 'Dots', type: 'decoration', build: () => base('decoration', 'Dots pattern', { w: 40, h: 30, shape: { kind: 'rect', fill: 'transparent', stroke: '#cbd5e1', strokeWidth: 1, radius: 0 } }) },
      { id: 'stripes', label: 'Stripes', type: 'decoration', build: () => base('decoration', 'Stripes', { w: 40, h: 12, shape: { kind: 'rect', fill: '#f1f5f9', stroke: 'transparent', strokeWidth: 0, radius: 0 } }) },
      { id: 'wash', label: 'Colour wash', type: 'shape', build: () => shape('Colour wash', '#eef2ff', 0, { w: 60, h: 40 }) },
      { id: 'gradient-band', label: 'Gradient band', type: 'shape', build: () => shape('Gradient band', 'linear-gradient(90deg,#fde68a,#fca5a5)', 0, { w: 70, h: 8 }) },
    ],
  },
];

/* --------------------------------------------------------------- built-ins */

/** Everything for one group, ready to render. */
export function libraryGroup(id: string): LibraryGroup | undefined {
  return ELEMENT_LIBRARY.find((group) => group.id === id);
}

/** Lookup used by tests and by the palette search box. */
export function findLibraryEntry(entryId: string): LibraryEntry | undefined {
  for (const group of ELEMENT_LIBRARY) {
    const hit = group.entries.find((entry) => entry.id === entryId);
    if (hit) return hit;
  }
  return undefined;
}

/* ------------------------------------------------------------ asset library */

export type AssetCategoryId =
  | 'uploads' | 'images' | 'illustrations' | 'icons' | 'shapes' | 'backgrounds'
  | 'frames' | 'stickers' | 'ai' | 'covers' | 'logos' | 'free';

export interface AssetCategory {
  id: AssetCategoryId;
  label: string;
  /** Where the content comes from. Keeps the UI honest about mock vs real data. */
  source: 'library' | 'uploads' | 'ai' | 'provider' | 'covers';
  description: string;
}

export const ASSET_CATEGORIES: AssetCategory[] = [
  { id: 'uploads', label: 'My uploads', source: 'library', description: 'Your own files, re-usable in every book.' },
  { id: 'images', label: 'Images', source: 'library', description: 'Stock and curated photography.' },
  { id: 'illustrations', label: 'Illustrations', source: 'library', description: 'Editorial and picture-book illustration.' },
  { id: 'icons', label: 'Icons', source: 'library', description: 'Line and solid icons sized for print.' },
  { id: 'shapes', label: 'Shapes', source: 'library', description: 'Geometry you can recolour.' },
  { id: 'backgrounds', label: 'Backgrounds', source: 'library', description: 'Textures and washes for pages and covers.' },
  { id: 'frames', label: 'Frames', source: 'library', description: 'Border and frame treatments.' },
  { id: 'stickers', label: 'Stickers', source: 'library', description: 'Drawn flourishes and fun marks.' },
  { id: 'ai', label: 'AI generated', source: 'ai', description: 'Images you created with the AI tools.' },
  { id: 'covers', label: 'Covers', source: 'covers', description: 'Cover art from this book and its versions.' },
  { id: 'logos', label: 'Logos', source: 'library', description: 'Imprint and publisher marks.' },
  { id: 'free', label: 'Free images', source: 'provider', description: 'Approved free-image sources: Unsplash, Pixabay, Pexels.' },
];

/** Category kinds map onto the asset kinds stored by the repository. */
export function assetKindsFor(category: AssetCategoryId): string[] {
  switch (category) {
    case 'uploads': return ['upload'];
    case 'ai': return ['ai-image'];
    case 'covers': return ['cover'];
    case 'illustrations': return ['illustration'];
    case 'backgrounds': return ['background'];
    case 'logos': return ['logo'];
    case 'icons': return ['icon'];
    case 'images': return ['image'];
    default: return [];
  }
}
