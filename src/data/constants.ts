import type { PublishingProfile, TrimSize } from '@/types/domain';

export const TRIM_SIZES: TrimSize[] = [
  { id: '5x8', label: '5 × 8 in', widthIn: 5, heightIn: 8 },
  { id: '5.06x7.81', label: '5.06 × 7.81 in', widthIn: 5.06, heightIn: 7.81 },
  { id: '5.25x8', label: '5.25 × 8 in', widthIn: 5.25, heightIn: 8 },
  { id: '5.5x8.5', label: '5.5 × 8.5 in', widthIn: 5.5, heightIn: 8.5 },
  { id: '6x9', label: '6 × 9 in', widthIn: 6, heightIn: 9 },
  { id: '6.14x9.21', label: '6.14 × 9.21 in', widthIn: 6.14, heightIn: 9.21 },
  { id: '7x10', label: '7 × 10 in', widthIn: 7, heightIn: 10 },
  { id: '8x10', label: '8 × 10 in', widthIn: 8, heightIn: 10 },
  { id: '8.5x11', label: '8.5 × 11 in', widthIn: 8.5, heightIn: 11 },
  { id: 'a4', label: 'A4 · 8.27 × 11.69 in', widthIn: 8.27, heightIn: 11.69 },
  { id: 'square-8.5', label: 'Square · 8.5 × 8.5 in', widthIn: 8.5, heightIn: 8.5 },
  { id: 'landscape-11x8.5', label: 'Landscape · 11 × 8.5 in', widthIn: 11, heightIn: 8.5 },
];

export const FONTS = {
  headings: [
    'Playfair Display',
    'Source Serif 4',
    'Inter',
    'Georgia',
    'Merriweather',
    'Bitter',
    'Crimson Pro',
    'Libre Baskerville',
    'Poppins',
  ],
  body: [
    'Source Serif 4',
    'Inter',
    'Georgia',
    'Crimson Pro',
    'Libre Baskerville',
    'Lora',
    'Nunito Sans',
    'Bitter',
    'JetBrains Mono',
  ],
  sizes: [9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72],
  weights: [300, 400, 500, 600, 700, 800, 900],
};

export const PAGE_PALETTES: { id: string; name: string; accent: string; paper: string }[] = [
  { id: 'midnight', name: 'Midnight', accent: '#6366f1', paper: '#0b1220' },
  { id: 'ember', name: 'Ember', accent: '#ea580c', paper: '#1c0f0a' },
  { id: 'lavender', name: 'Lavender', accent: '#7c3aed', paper: '#f5f3ff' },
  { id: 'forest', name: 'Forest', accent: '#0f766e', paper: '#ecfdf5' },
  { id: 'rose', name: 'Rose', accent: '#be123c', paper: '#fff1f2' },
  { id: 'sand', name: 'Sand', accent: '#b45309', paper: '#fefce8' },
  { id: 'ocean', name: 'Ocean', accent: '#0284c7', paper: '#f0f9ff' },
  { id: 'ink', name: 'Ink', accent: '#1f2937', paper: '#f5f3ef' },
];

export const PUBLISHING_PROFILES: PublishingProfile[] = [
  {
    id: 'digital-pdf',
    name: 'Digital PDF',
    family: 'digital',
    description: 'Screen-optimised PDF for direct download and sharing. No bleed, embedded fonts, hyperlinked TOC.',
    formats: ['pdf'],
    requirements: { bleedRequired: false, minPages: 1, maxPages: 2000, minDpi: 120, allowBleed: false, fontEmbedding: true },
    platformNote: 'Best for direct sales, lead magnets and advance reader copies.',
  },
  {
    id: 'epub-reflowable',
    name: 'Reflowable Ebook (EPUB 3)',
    family: 'digital',
    description: 'Reflowable EPUB 3 with semantic navigation, metadata and cover. Text reflows to any device.',
    formats: ['epub', 'epub3'],
    requirements: { bleedRequired: false, minPages: 10, maxPages: 3000, minDpi: 160, allowBleed: false, fontEmbedding: false },
    platformNote: 'Primary format for Apple Books, Kobo and Google Play Books.',
  },
  {
    id: 'kdp-ebook',
    name: 'KDP-oriented Ebook',
    family: 'platform',
    description: 'Amazon KDP ebook profile: reflowable EPUB/PDF checks, no bleed, cover at 1600×2560, embedded fonts optional.',
    formats: ['epub3', 'pdf'],
    requirements: { bleedRequired: false, minPages: 10, maxPages: 3000, minDpi: 300, allowBleed: false, fontEmbedding: false },
    platformNote: 'Mirrors KDP ebook requirements. Amazon is one target among several — this is a publishing profile, not a hard dependency.',
  },
  {
    id: 'paperback',
    name: 'Paperback',
    family: 'print',
    description: 'Standard paperback with facing pages, mirror margins, gutter and optional bleed. Spine width calculated from page count and paper stock.',
    formats: ['print-pdf'],
    requirements: { bleedRequired: false, minPages: 24, maxPages: 828, minDpi: 300, allowBleed: true, fontEmbedding: true },
    platformNote: 'Spine width = (page count ÷ 2) × paper thickness. Cream 0.0025 in, white 0.002252 in.',
  },
  {
    id: 'kdp-print',
    name: 'KDP-oriented Print',
    family: 'platform',
    description: 'Amazon KDP print profile: full trim-size library, inside margin minimums by page count, bleed or no-bleed, 300 DPI images.',
    formats: ['print-pdf'],
    requirements: {
      bleedRequired: false,
      minPages: 24,
      maxPages: 828,
      minDpi: 300,
      allowBleed: true,
      fontEmbedding: true,
      trimSizes: ['5x8', '5.06x7.81', '5.25x8', '5.5x8.5', '6x9', '6.14x9.21', '7x10', '8x10', '8.5x11'],
    },
    platformNote: 'Applies KDP interior margin minimums (0.375 in for books under 150 pages, 0.5–0.75 in above).',
  },
  {
    id: 'hardcover',
    name: 'Hardcover Case Laminate',
    family: 'print',
    description: 'Case-laminate hardcover with wider gutter allowance and wrap-around cover geometry.',
    formats: ['print-pdf'],
    requirements: { bleedRequired: true, minPages: 75, maxPages: 550, minDpi: 300, allowBleed: true, fontEmbedding: true },
    platformNote: 'Requires wrap and hinge calculations on the cover spread. Preview only in Phase 1.',
  },
  {
    id: 'press-ready',
    name: 'Offset Press Ready',
    family: 'print',
    description: 'Offset-ready export with CMYK intent notes, crop marks and 0.125 in bleed on all four sides.',
    formats: ['print-pdf', 'pdf'],
    requirements: { bleedRequired: true, minPages: 32, maxPages: 1200, minDpi: 300, allowBleed: true, fontEmbedding: true },
    platformNote: 'For traditional printers. Requires preflight sign-off before submission.',
  },
];

export const EXPORT_FORMAT_INFO: Record<
  string,
  { label: string; family: 'digital' | 'print'; description: string; profileHints: string[]; icon: string }
> = {
  pdf: {
    label: 'PDF',
    family: 'digital',
    description: 'Fixed-layout PDF sized to your trim size.',
    profileHints: ['digital-pdf', 'press-ready'],
    icon: 'file-text',
  },
  'print-pdf': {
    label: 'Print PDF',
    family: 'print',
    description: 'Print interior with mirror margins, gutter and crop marks.',
    profileHints: ['paperback', 'kdp-print', 'hardcover', 'press-ready'],
    icon: 'printer',
  },
  epub: {
    label: 'EPUB',
    family: 'digital',
    description: 'Reflowable EPUB 2 container for wide compatibility.',
    profileHints: ['epub-reflowable'],
    icon: 'book-open',
  },
  epub3: {
    label: 'EPUB 3',
    family: 'digital',
    description: 'EPUB 3 with semantic nav, metadata and cover.',
    profileHints: ['epub-reflowable', 'kdp-ebook'],
    icon: 'book',
  },
  docx: {
    label: 'DOCX',
    family: 'digital',
    description: 'Editable Word document for editors and proofreaders.',
    profileHints: ['digital-pdf'],
    icon: 'file-type',
  },
  html: {
    label: 'HTML',
    family: 'digital',
    description: 'Single-file HTML with linked chapters.',
    profileHints: ['digital-pdf'],
    icon: 'code',
  },
  txt: {
    label: 'Plain text',
    family: 'digital',
    description: 'Unformatted manuscript text — useful for backups.',
    profileHints: ['digital-pdf'],
    icon: 'file',
  },
};

export const PAPER_THICKNESS: Record<string, number> = {
  white: 0.002252,
  cream: 0.0025,
  color: 0.002347,
};

export const BOOK_KINDS = [
  'fiction',
  'nonfiction',
  'children',
  'workbook',
  'journal',
  'planner',
  'cookbook',
  'textbook',
  'biography',
  'poetry',
] as const;

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'ja', label: 'Japanese' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ar', label: 'Arabic' },
];

export const AI_TONES = [
  'Warm and literary',
  'Clear and practical',
  'Suspenseful',
  'Playful',
  'Academic',
  'Conversational',
  'Inspirational',
  'Dark and atmospheric',
];

export const AI_STYLES = [
  'Literary fiction',
  'Commercial fiction',
  'Practical non-fiction',
  'Narrative non-fiction',
  'Children\'s picture book',
  'Technical guide',
  'Memoir',
  'Journalism',
];
