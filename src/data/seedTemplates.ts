import type { SectionKind, Template } from '@/types/domain';
import { TRIM_SIZES } from './constants';

const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

interface TemplateSeedInput {
  id: string;
  name: string;
  categoryId: string;
  description: string;
  style: string;
  kind: Template['kind'];
  trimSizeId: string;
  pageCount: number;
  premium?: boolean;
  featured?: boolean;
  uses: number;
  rating: number;
  palette: string;
  accentColor: string;
  headingFont: string;
  bodyFont: string;
  tags: string[];
  structure: [SectionKind, string, number][];
  seed: number;
}

const seeds: TemplateSeedInput[] = [
  {
    id: 'tpl_harbour_novel', name: 'Harbour Novel', categoryId: 'cat_literary', description: 'A quiet literary novel layout with drop caps, generous margins and chapter openers that start on the right-hand page.', style: 'Literary', kind: 'fiction', trimSizeId: '5.5x8.5', pageCount: 284, featured: true, uses: 4820, rating: 4.8, palette: 'ocean', accentColor: '#0284c7', headingFont: 'Playfair Display', bodyFont: 'Source Serif 4', tags: ['literary', 'coastal', 'series-starter'], structure: [['front-matter', 'Front matter set', 4], ['chapter', 'Chapter openers ×24', 24], ['back-matter', 'Author & acknowledgements', 3]], seed: 11,
  },
  {
    id: 'tpl_midnight_thriller', name: 'Midnight Thriller', categoryId: 'cat_thriller', description: 'High-contrast chapter headings, tight leading and a cold open title page built for pacing.', style: 'Bold', kind: 'fiction', trimSizeId: '6x9', pageCount: 342, featured: true, uses: 3960, rating: 4.7, palette: 'midnight', accentColor: '#6366f1', headingFont: 'Inter', bodyFont: 'Libre Baskerville', tags: ['detective', 'locked-room'], structure: [['front-matter', 'Cold open + front matter', 5], ['chapter', 'Chapter openers ×36', 36], ['back-matter', 'Author note', 2]], seed: 23,
  },
  {
    id: 'tpl_hearth_romance', name: 'Hearth & Harbour Romance', categoryId: 'cat_romance', description: 'Warm serif headings, soft rules and a decorative chapter opener with an ornament divider.', style: 'Warm', kind: 'fiction', trimSizeId: '5.25x8', pageCount: 268, uses: 5120, rating: 4.9, palette: 'rose', accentColor: '#be123c', headingFont: 'Playfair Display', bodyFont: 'Lora', tags: ['small-town', 'found-family'], structure: [['front-matter', 'Content notes + front matter', 5], ['chapter', 'Chapter openers ×22', 22], ['back-matter', 'Series page', 2]], seed: 37,
  },
  {
    id: 'tpl_arcane_fantasy', name: 'Arcane Realm', categoryId: 'cat_fantasy', description: 'Map plate pages, part openers and a full ornament set for epic fantasy.', style: 'Ornate', kind: 'fiction', trimSizeId: '6.14x9.21', pageCount: 468, premium: true, featured: true, uses: 2840, rating: 4.8, palette: 'plum', accentColor: '#4338ca', headingFont: 'Bitter', bodyFont: 'Crimson Pro', tags: ['magic-school', 'series-starter', 'hardcover-ready'], structure: [['front-matter', 'Map + dramatis personae', 6], ['part', 'Part openers ×4', 4], ['chapter', 'Chapter openers ×42', 42], ['back-matter', 'Glossary & pronunciation', 6]], seed: 41,
  },
  {
    id: 'tpl_orbit_scifi', name: 'Orbit Station', categoryId: 'cat_scifi', description: 'Technical monospace accents, section dividers and a diagram-friendly grid.', style: 'Technical', kind: 'fiction', trimSizeId: '6x9', pageCount: 356, premium: true, uses: 1980, rating: 4.6, palette: 'mint', accentColor: '#14b8a6', headingFont: 'JetBrains Mono', bodyFont: 'Inter', tags: ['space-opera', 'first-contact'], structure: [['front-matter', 'Ship manifest + front matter', 5], ['chapter', 'Chapter openers ×30', 30], ['back-matter', 'Technical appendix', 8]], seed: 53,
  },
  {
    id: 'tpl_ship_it_business', name: 'Ship It — Business Playbook', categoryId: 'cat_business', description: 'Heavy-weight headings, callout boxes, framework diagrams and end-of-chapter action lists.', style: 'Corporate', kind: 'nonfiction', trimSizeId: '6x9', pageCount: 224, featured: true, uses: 6340, rating: 4.7, palette: 'ocean', accentColor: '#0369a1', headingFont: 'Inter', bodyFont: 'Inter', tags: ['leadership', 'productivity'], structure: [['front-matter', 'Foreword + contents', 5], ['chapter', 'Chapter openers ×12', 12], ['section', 'Frameworks & worksheets', 24], ['back-matter', 'Templates & resources', 6]], seed: 61,
  },
  {
    id: 'tpl_quiet_mornings', name: 'Quiet Mornings', categoryId: 'cat_selfhelp', description: 'Airy self-help layout with pull-quotes, reflection prompts and a soft two-colour palette.', style: 'Minimal', kind: 'nonfiction', trimSizeId: '5.5x8.5', pageCount: 186, uses: 7420, rating: 4.8, palette: 'sand', accentColor: '#b45309', headingFont: 'Nunito Sans', bodyFont: 'Nunito Sans', tags: ['habits', 'mindfulness', 'self-care'], structure: [['front-matter', 'Front matter', 4], ['chapter', 'Chapter openers ×10', 10], ['section', 'Reflection prompts', 20], ['back-matter', 'Further reading', 2]], seed: 71,
  },
  {
    id: 'tpl_first_days_memoir', name: 'First Days — Memoir', categoryId: 'cat_biography', description: 'Editorial memoir layout with wide margins, epigraph pages and photo plates.', style: 'Editorial', kind: 'biography', trimSizeId: '5.5x8.5', pageCount: 298, uses: 2140, rating: 4.6, palette: 'ink', accentColor: '#1f2937', headingFont: 'Playfair Display', bodyFont: 'Crimson Pro', tags: ['literary', 'debut'], structure: [['front-matter', 'Epigraph + front matter', 5], ['chapter', 'Chapter openers ×18', 18], ['section', 'Photo plate spreads ×4', 4], ['back-matter', 'Acknowledgements', 3]], seed: 83,
  },
  {
    id: 'tpl_paper_fox_picture', name: 'Paper Fox Picture Book', categoryId: 'cat_children', description: 'Landscape spreads with image wells, very large type and read-aloud rhythm guides.', style: 'Playful', kind: 'children', trimSizeId: 'landscape-11x8.5', pageCount: 32, featured: true, uses: 4120, rating: 4.9, palette: 'sunset', accentColor: '#ea580c', headingFont: 'Poppins', bodyFont: 'Nunito Sans', tags: ['picture-book', 'animals', 'bedtime'], structure: [['front-matter', 'Title & dedication spread', 2], ['chapter', 'Story spreads ×14', 28], ['back-matter', 'About the illustrator', 2]], seed: 97,
  },
  {
    id: 'tpl_little_atlas_nonfiction', name: 'Little Atlas — Non-fiction Kids', categoryId: 'cat_children', description: 'Illustrated non-fiction for ages 7–10 with fact boxes, timelines and glossary panels.', style: 'Illustrated', kind: 'children', trimSizeId: '8.5x11', pageCount: 64, uses: 2680, rating: 4.7, palette: 'forest', accentColor: '#0f766e', headingFont: 'Poppins', bodyFont: 'Nunito Sans', tags: ['picture-book', 'study-guide'], structure: [['front-matter', 'How to use this book', 3], ['chapter', 'Chapters ×8 with fact boxes', 48], ['back-matter', 'Glossary & index', 6]], seed: 103,
  },
  {
    id: 'tpl_salt_stone', name: 'Salt & Stone Cookbook', categoryId: 'cat_cookbook', description: 'Full-bleed photo pages, technique sidebars and ingredient-table styling.', style: 'Photo-led', kind: 'cookbook', trimSizeId: '8x10', pageCount: 248, premium: true, featured: true, uses: 3240, rating: 4.9, palette: 'ember', accentColor: '#ea580c', headingFont: 'Bitter', bodyFont: 'Source Serif 4', tags: ['recipes', 'baking', 'vegetarian'], structure: [['front-matter', 'Contents + pantry', 6], ['chapter', 'Technique chapters ×6', 60], ['section', 'Recipe pages ×70', 70], ['back-matter', 'Conversions & index', 8]], seed: 109,
  },
  {
    id: 'tpl_ledger_workbook', name: 'The Ledger Workbook', categoryId: 'cat_workbook', description: 'Structured workbook with numbered exercises, writing lines and progress trackers.', style: 'Structured', kind: 'workbook', trimSizeId: '8.5x11', pageCount: 142, uses: 5860, rating: 4.7, palette: 'lavender', accentColor: '#7c3aed', headingFont: 'Inter', bodyFont: 'Inter', tags: ['goal-setting', 'study-guide'], structure: [['front-matter', 'How to use this workbook', 3], ['chapter', 'Modules ×10', 80], ['section', 'Worksheets ×40', 40], ['back-matter', 'Answer key', 6]], seed: 127,
  },
  {
    id: 'tpl_night_planner', name: 'Night Shift Planner', categoryId: 'cat_planner', description: 'Undated monthly and weekly planner with habit trackers and notes spreads.', style: 'Functional', kind: 'planner', trimSizeId: '8.5x11', pageCount: 186, uses: 9240, rating: 4.8, palette: 'midnight', accentColor: '#6366f1', headingFont: 'Inter', bodyFont: 'Inter', tags: ['bullet-journal', 'undated'], structure: [['front-matter', 'Year at a glance', 4], ['section', 'Monthly spreads ×12', 24], ['section', 'Weekly spreads ×52', 104], ['back-matter', 'Notes & index', 12]], seed: 131,
  },
  {
    id: 'tpl_gratitude_journal', name: 'Slow Gratitude Journal', categoryId: 'cat_journal', description: 'Soft-lined gratitude journal with morning and evening prompts and a monthly review spread.', style: 'Soft', kind: 'journal', trimSizeId: '5.5x8.5', pageCount: 148, uses: 7680, rating: 4.6, palette: 'forest', accentColor: '#0f766e', headingFont: 'Lora', bodyFont: 'Lora', tags: ['gratitude', 'self-care'], structure: [['front-matter', 'How to keep this journal', 3], ['section', 'Daily spreads ×90', 90], ['section', 'Monthly reviews ×12', 12], ['back-matter', 'Notes', 6]], seed: 139,
  },
  {
    id: 'tpl_mindful_coloring', name: 'Mindful Linework Coloring', categoryId: 'cat_coloring', description: 'Full-page line art wells with generous bleed margins for marker bleed-through.', style: 'Line art', kind: 'workbook', trimSizeId: '8.5x11', pageCount: 100, uses: 6480, rating: 4.5, palette: 'charcoal', accentColor: '#3f3f46', headingFont: 'Poppins', bodyFont: 'Poppins', tags: ['large-print', 'low-content'], structure: [['front-matter', 'Colour test page', 2], ['section', 'Line-art plates ×48', 96], ['back-matter', 'Credit page', 1]], seed: 149,
  },
  {
    id: 'tpl_activity_quest', name: 'Puzzle Quest Activity Book', categoryId: 'cat_activity', description: 'Mazes, word searches, dot-to-dot and spot-the-difference templates with answer pages.', style: 'Playful', kind: 'workbook', trimSizeId: '8.5x11', pageCount: 112, uses: 3910, rating: 4.6, palette: 'forest', accentColor: '#65a30d', headingFont: 'Poppins', bodyFont: 'Nunito Sans', tags: ['low-content', 'picture-book'], structure: [['front-matter', 'Welcome page', 2], ['section', 'Activity pages ×50', 100], ['back-matter', 'Answer pages', 8]], seed: 151,
  },
  {
    id: 'tpl_studio_textbook', name: 'Studio Textbook', categoryId: 'cat_textbook', description: 'Dense academic layout with learning objectives, worked examples and end-of-chapter problems.', style: 'Academic', kind: 'textbook', trimSizeId: '8.5x11', pageCount: 412, premium: true, uses: 1720, rating: 4.5, palette: 'plum', accentColor: '#1d4ed8', headingFont: 'Bitter', bodyFont: 'Source Serif 4', tags: ['study-guide', 'exam-prep', 'classroom'], structure: [['front-matter', 'Preface + syllabus map', 6], ['chapter', 'Chapters ×14', 280], ['section', 'Lab & problem sets', 96], ['back-matter', 'Appendices & index', 20]], seed: 163,
  },
  {
    id: 'tpl_field_guide', name: 'Field Guide', categoryId: 'cat_guide', description: 'Two-column reference guide with spot illustrations, key facts and a rapid-lookup index.', style: 'Reference', kind: 'nonfiction', trimSizeId: '5x8', pageCount: 198, uses: 2460, rating: 4.7, palette: 'mint', accentColor: '#0d9488', headingFont: 'Inter', bodyFont: 'Source Serif 4', tags: ['study-guide', 'large-print'], structure: [['front-matter', 'How to use this guide', 4], ['section', 'Reference entries ×60', 168], ['back-matter', 'Rapid index', 10]], seed: 173,
  },
  {
    id: 'tpl_verse_collection', name: 'Verse Collection', categoryId: 'cat_literary', description: 'Poetry layout with hanging indents, wide gutters and centring rules that respect line breaks.', style: 'Poetic', kind: 'poetry', trimSizeId: '5.5x8.5', pageCount: 96, uses: 1880, rating: 4.8, palette: 'ink', accentColor: '#7c3aed', headingFont: 'Playfair Display', bodyFont: 'Crimson Pro', tags: ['literary', 'debut'], structure: [['front-matter', 'Contents by section', 4], ['section', 'Sections ×4', 60], ['section', 'Poems ×40', 30], ['back-matter', 'Notes', 2]], seed: 179,
  },
  {
    id: 'tpl_recipe_flash', name: 'Weeknight Flash Recipe Cards', categoryId: 'cat_cookbook', description: 'One-recipe-per-page cards designed for 20-minute cooking and big type at arm\'s length.', style: 'Practical', kind: 'cookbook', trimSizeId: '7x10', pageCount: 132, uses: 4180, rating: 4.6, palette: 'sunset', accentColor: '#ea580c', headingFont: 'Poppins', bodyFont: 'Inter', tags: ['weeknight', 'recipes'], structure: [['front-matter', 'Pantry & equipment', 4], ['section', 'Recipe cards ×70', 70], ['back-matter', 'Swap table & index', 6]], seed: 181,
  },
  {
    id: 'tpl_hardcover_celebrity', name: 'Signature Hardcover Memoir', categoryId: 'cat_biography', description: 'Premium case-laminate interior with wide gutter, photo inserts and foil-ready cover geometry.', style: 'Premium', kind: 'biography', trimSizeId: '6.14x9.21', pageCount: 322, premium: true, uses: 1420, rating: 4.8, palette: 'charcoal', accentColor: '#a1a1aa', headingFont: 'Playfair Display', bodyFont: 'Libre Baskerville', tags: ['hardcover-ready', 'debut'], structure: [['front-matter', 'Half title + front matter', 6], ['chapter', 'Chapter openers ×20', 20], ['section', 'Plate sections ×3', 24], ['back-matter', 'Acknowledgements', 4]], seed: 191,
  },
  {
    id: 'tpl_blank_6x9', name: 'Blank 6 × 9 Manuscript', categoryId: 'cat_fiction', description: 'Just the essentials: correct trim size, standard margins and a clean chapter skeleton.', style: 'Neutral', kind: 'fiction', trimSizeId: '6x9', pageCount: 12, uses: 12840, rating: 4.9, palette: 'ink', accentColor: '#6366f1', headingFont: 'Playfair Display', bodyFont: 'Source Serif 4', tags: ['series-starter'], structure: [['front-matter', 'Front matter', 3], ['chapter', 'Chapter 1–3 skeleton', 3], ['back-matter', 'Back matter', 2]], seed: 197,
  },
];

export const seedTemplates: Template[] = seeds.map((seed, index) => {
  const trimSize = TRIM_SIZES.find((size) => size.id === seed.trimSizeId) ?? TRIM_SIZES[4];
  return {
    id: seed.id,
    name: seed.name,
    slug: seed.id.replace('tpl_', '').replace(/_/g, '-'),
    description: seed.description,
    categoryId: seed.categoryId,
    style: seed.style,
    kind: seed.kind,
    trimSize,
    pageCount: seed.pageCount,
    language: 'en',
    premium: seed.premium ?? index % 4 === 2,
    featured: seed.featured ?? false,
    published: true,
    uses: seed.uses,
    rating: seed.rating,
    coverArtSeed: seed.seed,
    palette: seed.palette,
    accentColor: seed.accentColor,
    headingFont: seed.headingFont,
    bodyFont: seed.bodyFont,
    tags: seed.tags,
    structure: seed.structure.map(([kind, title, pages]) => ({ kind, title, pages })),
    tagsLine: seed.tags.join(' · '),
    createdAt: daysAgo(30 + index * 9),
  };
});
