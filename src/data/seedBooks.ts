import type { Book, ID, LibraryItem, Order, Review, WishlistItem } from '@/types/domain';
import { buildBook, type ChapterBlueprint } from './bookFactory';
import { chapterBodies, backMatter, genericChapter } from './prose';

const daysAgo = (days: number, hourOffset = 9) =>
  new Date(Date.now() - days * 86400000 + hourOffset * 3600 * 1000).toISOString();

const chapter = (title: string, subtitle: string, summary: string, body: string[]): ChapterBlueprint => ({
  title,
  subtitle,
  summary,
  body,
});

interface MarketBookSeed {
  id: string;
  ownerId: string;
  authorName: string;
  title: string;
  subtitle: string;
  description: string;
  shortDescription: string;
  kind: Book['kind'];
  categoryIds: string[];
  tags: string[];
  trimSizeId: string;
  paletteId: string;
  headingFont: string;
  bodyFont: string;
  price: number;
  chapters: ChapterBlueprint[];
  createdDaysAgo: number;
  publishedDaysAgo: number;
  sales: number;
  views: number;
  favorites: number;
  rating: number;
  reviewCount: number;
  featured?: boolean;
  staffPick?: boolean;
  trending?: boolean;
  discountPercent?: number;
  freePreviewPages?: number;
  status?: Book['status'];
  visibility?: Book['visibility'];
  seedForArt: string;
}

const marketSeeds: MarketBookSeed[] = [
  {
    id: 'mbook_harbour',
    ownerId: 'user_demo',
    authorName: 'Maya Chen',
    title: 'Harbour of Small Lights',
    subtitle: 'A novel of the Ellsworth coast',
    description:
      'Six winters after the harbour froze and the lighthouse went dark, Mara Ellsworth returns to a town that has learned to keep its promises quietly. What she finds on the keeper\'s shelf — still burning — will send her out into a fog that has been waiting six years to answer a question nobody thought to ask.',
    shortDescription: 'A novel about returning, and about the light a town keeps on for you.',
    kind: 'fiction',
    categoryIds: ['cat_literary', 'cat_fiction'],
    tags: ['literary', 'coastal', 'dual-timeline', 'debut'],
    trimSizeId: '5.5x8.5',
    paletteId: 'ocean',
    headingFont: 'Playfair Display',
    bodyFont: 'Source Serif 4',
    price: 9.99,
    chapters: [
      chapter('The Harbour at Low Tide', 'Chapter One', 'Mara returns to Ellsworth and finds the lantern still burning.', chapterBodies.lantern.slice(0, 2)),
      chapter('What the Fog Kept', 'Chapter Two', 'A boat that should not exist, and a question the fog has been saving.', chapterBodies.lantern.slice(2)),
      chapter('The Ledger', 'Chapter Three', 'A boy on the seawall, and the first honest question Mara asks.', chapterBodies.cartographer.slice(0, 1)),
    ],
    createdDaysAgo: 300,
    publishedDaysAgo: 214,
    sales: 1842,
    views: 41280,
    favorites: 3120,
    rating: 4.5,
    reviewCount: 186,
    featured: true,
    staffPick: true,
    trending: true,
    seedForArt: 'harbour',
  },
  {
    id: 'mbook_saltstone',
    ownerId: 'user_harriet',
    authorName: 'Harriet Lindqvist',
    title: 'Salt & Stone',
    subtitle: 'Six techniques, seventy recipes, no wasted evenings',
    description:
      'A cookbook for people with twenty minutes and a real appetite. Harriet Lindqvist teaches six techniques and then refuses, politely, to teach anything else — every recipe in the book is one of those six wearing a different coat.',
    shortDescription: 'Six techniques and seventy recipes from a working test kitchen.',
    kind: 'cookbook',
    categoryIds: ['cat_cookbook', 'cat_guide'],
    tags: ['recipes', 'weeknight', 'vegetarian'],
    trimSizeId: '8x10',
    paletteId: 'ember',
    headingFont: 'Bitter',
    bodyFont: 'Source Serif 4',
    price: 16.99,
    chapters: [
      chapter('The Case for Cooking Three Things Well', 'Technique One', 'Why this book teaches six techniques and nothing else.', chapterBodies.saltandstone.slice(0, 2)),
      chapter('Salt, Fat, and the Wrong Kind of Patience', 'Technique Two', 'The two adjustments you can always make, and the one you cannot undo.', chapterBodies.saltandstone.slice(2)),
      chapter('The Twenty-Minute Braise', 'Technique Three', 'Geometry, not time, is what makes a braise work.', [chapterBodies.saltandstone[3], chapterBodies.saltandstone[4]]),
    ],
    createdDaysAgo: 260,
    publishedDaysAgo: 180,
    sales: 2410,
    views: 52840,
    favorites: 4410,
    rating: 4.9,
    reviewCount: 274,
    featured: true,
    staffPick: true,
    seedForArt: 'saltstone',
  },
  {
    id: 'mbook_quietcode',
    ownerId: 'user_daniel',
    authorName: 'Daniel Osei',
    title: 'The Quiet Code',
    subtitle: 'Software architecture as an attention budget',
    description:
      'Every engineering organisation has one genuinely finite resource, and it is not money or compute. It is attention. This book is a practical guide to spending it on structures that keep earning.',
    shortDescription: 'Practical software architecture for teams who have to maintain what they build.',
    kind: 'nonfiction',
    categoryIds: ['cat_business', 'cat_guide', 'cat_education'],
    tags: ['engineering', 'leadership', 'productivity'],
    trimSizeId: '6x9',
    paletteId: 'mint',
    headingFont: 'Inter',
    bodyFont: 'Inter',
    price: 24.0,
    chapters: [
      chapter('Attention Is the Only Budget', 'Chapter One', 'Why architecture is the discipline of spending attention well.', chapterBodies.quietcode.slice(0, 2)),
      chapter('Boundaries Before Abstractions', 'Chapter Two', 'The shared library nobody understands, and how to avoid building one.', chapterBodies.quietcode.slice(0, 2)),
      chapter('The Cost of a Fast Path', 'Chapter Three', 'Keep one fast path. Know its name. Schedule its funeral.', chapterBodies.quietcode.slice(2)),
    ],
    createdDaysAgo: 210,
    publishedDaysAgo: 150,
    sales: 1120,
    views: 24180,
    favorites: 1980,
    rating: 4.7,
    reviewCount: 122,
    featured: true,
    trending: true,
    seedForArt: 'quietcode',
  },
  {
    id: 'mbook_slowmornings',
    ownerId: 'user_gracet',
    authorName: 'Grace Tan',
    title: 'Slow Mornings',
    subtitle: 'A short book about protected attention',
    description:
      'The most useful hour of your day contains nothing that anyone else would recognise as useful. Slow Mornings is a deliberately short book with deliberately long worksheets, because insight without practice evaporates.',
    shortDescription: 'Deliberately short. Deliberately practical. One hour at a time.',
    kind: 'nonfiction',
    categoryIds: ['cat_selfhelp', 'cat_journal'],
    tags: ['habits', 'mindfulness', 'self-care'],
    trimSizeId: '5.5x8.5',
    paletteId: 'sand',
    headingFont: 'Nunito Sans',
    bodyFont: 'Nunito Sans',
    price: 8.5,
    chapters: [
      chapter('Before the First Notification', 'Chapter One', 'The hour that looks like nothing and changes everything.', chapterBodies.slowmornings.slice(0, 2)),
      chapter('The Two-Minute Ledger', 'Chapter Two', 'Context switching costs orientation, not time.', chapterBodies.slowmornings.slice(2)),
      chapter('Protecting the Hour', 'Chapter Three', 'What to tell the people who will ask you to give it back.', [genericChapter(3, 'Boundaries that hold')]),
    ],
    createdDaysAgo: 150,
    publishedDaysAgo: 96,
    sales: 3240,
    views: 61200,
    favorites: 5240,
    rating: 4.8,
    reviewCount: 318,
    featured: true,
    staffPick: true,
    trending: true,
    discountPercent: 15,
    seedForArt: 'slowmornings',
  },
  {
    id: 'mbook_paperfox',
    ownerId: 'user_priya',
    authorName: 'Priya Raman',
    title: 'Paper Fox and the Morning News',
    subtitle: 'A picture book for ages 4–8',
    description:
      'When the wind delivers a newspaper to Fox\'s feet, Fox becomes the first reporter in the whole of Bramblewick — which is a very grand thing to be when the only other animal who can read is a hedgehog named Mrs Appleby.',
    shortDescription: 'The first reporter in Bramblewick. He is a fox. It goes fine.',
    kind: 'children',
    categoryIds: ['cat_children', 'cat_picture'],
    tags: ['picture-book', 'animals', 'bedtime', 'friendship'],
    trimSizeId: 'landscape-11x8.5',
    paletteId: 'sunset',
    headingFont: 'Poppins',
    bodyFont: 'Nunito Sans',
    price: 6.99,
    chapters: [
      chapter('Fox Finds a Newspaper', 'One', 'The wind delivers news, and Fox puts it on.', chapterBodies.paperfox.slice(0, 3)),
      chapter('The Very Important Question', 'Two', 'Where does the canal go when nobody is looking at it?', chapterBodies.paperfox.slice(3)),
    ],
    createdDaysAgo: 190,
    publishedDaysAgo: 120,
    sales: 2140,
    views: 33900,
    favorites: 3610,
    rating: 4.9,
    reviewCount: 164,
    featured: true,
    seedForArt: 'paperfox',
  },
  {
    id: 'mbook_ledger_small',
    ownerId: 'user_elenav',
    authorName: 'Elena Vasquez',
    title: 'The Ledger of Small Things',
    subtitle: 'A novel',
    description:
      'Three generations of a harbour family keep a ledger of everything they have ever owed each other. When the youngest inherits it, she discovers the entries stop making sense in 1974 — the year the road came through.',
    shortDescription: 'A family ledger, a harbour, and an entry that should not exist.',
    kind: 'fiction',
    categoryIds: ['cat_literary', 'cat_fiction'],
    tags: ['literary', 'small-town', 'dual-timeline'],
    trimSizeId: '5.5x8.5',
    paletteId: 'plum',
    headingFont: 'Playfair Display',
    bodyFont: 'Crimson Pro',
    price: 11.99,
    chapters: [
      chapter('A Map of Small Disappearances', 'Part One', 'The ledger arrives in a suitcase with no note.', chapterBodies.cartographer.slice(0, 2)),
      chapter('The Problem With Accurate Maps', 'Part Two', 'What an account leaves out is where the lying happens.', chapterBodies.cartographer.slice(0, 2)),
      chapter('Grid Correction', 'Part Three', 'Bending the whole account so that most of it can stay true.', chapterBodies.cartographer.slice(2)),
    ],
    createdDaysAgo: 320,
    publishedDaysAgo: 260,
    sales: 4210,
    views: 98400,
    favorites: 8420,
    rating: 4.6,
    reviewCount: 412,
    featured: true,
    trending: true,
    seedForArt: 'ledgersmall',
  },
  {
    id: 'mbook_audit_trail',
    ownerId: 'user_annika',
    authorName: 'Annika Solveig',
    title: 'The Audit Trail',
    subtitle: 'A Nordic crime novel',
    description:
      'A forensic accountant is asked to reconcile four million kroner that appear, in the ledger, to have been spent on nothing at all. The reconciliation leads her to the one colleague who has never once been late.',
    shortDescription: 'Crime with a spreadsheet. Everyone is auditable eventually.',
    kind: 'fiction',
    categoryIds: ['cat_thriller', 'cat_mystery'],
    tags: ['detective', 'locked-room', 'medical'],
    trimSizeId: '6x9',
    paletteId: 'midnight',
    headingFont: 'Inter',
    bodyFont: 'Libre Baskerville',
    price: 12.99,
    chapters: [
      chapter('Reconciliation', 'Chapter One', 'Four million kroner, spent on nothing at all.', [genericChapter(1, 'Reconciliation')]),
      chapter('The Late Arrival', 'Chapter Two', 'A colleague who has never once been late.', [genericChapter(2, 'The Late Arrival')]),
      chapter('Auditable', 'Chapter Three', 'Everyone is, eventually.', [genericChapter(3, 'Auditable')]),
    ],
    createdDaysAgo: 240,
    publishedDaysAgo: 190,
    sales: 2980,
    views: 71600,
    favorites: 4120,
    rating: 4.7,
    reviewCount: 236,
    trending: true,
    seedForArt: 'audittrail',
  },
  {
    id: 'mbook_fourteen_ways',
    ownerId: 'user_theo',
    authorName: 'Theo Marchetti',
    title: 'Fourteen Ways to Miss a Train',
    subtitle: 'Book One of the Slow Departure',
    description:
      'Magic in the city of Verrani charges interest. Every spell borrowed against the future must be repaid, and the repayment schedule is written in the timetable of a railway that does not appear on any map.',
    shortDescription: 'Epic fantasy with a repayment schedule and no map.',
    kind: 'fiction',
    categoryIds: ['cat_fantasy', 'cat_fiction'],
    tags: ['magic-school', 'series-starter', 'time-travel'],
    trimSizeId: '6.14x9.21',
    paletteId: 'lavender',
    headingFont: 'Bitter',
    bodyFont: 'Crimson Pro',
    price: 7.99,
    chapters: [
      chapter('The Shunter', 'Chapter One', 'A timetable that does not appear on any map.', [genericChapter(1, 'The Shunter')]),
      chapter('Interest Accrues', 'Chapter Two', 'Every spell borrowed against the future must be repaid.', [genericChapter(2, 'Interest Accrues')]),
    ],
    createdDaysAgo: 130,
    publishedDaysAgo: 74,
    sales: 640,
    views: 18400,
    favorites: 1120,
    rating: 4.3,
    reviewCount: 58,
    seedForArt: 'fourteenways',
  },
  {
    id: 'mbook_marginal_gains',
    ownerId: 'user_marcus',
    authorName: 'Marcus Bell',
    title: 'Marginal Gains for People Who Ship',
    subtitle: 'Decisions when the information is late',
    description:
      'A short, blunt book about making good decisions in the last forty per cent of a project, when the deadline is fixed, the information is incomplete, and everybody is tired.',
    shortDescription: 'Decision-making for the last forty per cent.',
    kind: 'nonfiction',
    categoryIds: ['cat_business', 'cat_guide'],
    tags: ['leadership', 'productivity', 'career'],
    trimSizeId: '6x9',
    paletteId: 'charcoal',
    headingFont: 'Inter',
    bodyFont: 'Inter',
    price: 19.5,
    chapters: [
      chapter('Late Information', 'Chapter One', 'Deciding well when the facts arrive after the deadline.', [genericChapter(1, 'Late Information')]),
      chapter('The Reversible Decision', 'Chapter Two', 'Sort your decisions by cost of reversal, not importance.', [genericChapter(2, 'The Reversible Decision')]),
    ],
    createdDaysAgo: 170,
    publishedDaysAgo: 110,
    sales: 890,
    views: 21300,
    favorites: 1440,
    rating: 4.5,
    reviewCount: 74,
    seedForArt: 'marginalgains',
  },
  {
    id: 'mbook_first_days_memoir',
    ownerId: 'user_elenav',
    authorName: 'Elena Vasquez',
    title: 'First Days',
    subtitle: 'A memoir in eleven kitchens',
    description:
      'A memoir about learning to write in the gaps — between shifts, on trains, in eleven kitchens with progressively worse chairs.',
    shortDescription: 'A memoir in eleven kitchens.',
    kind: 'biography',
    categoryIds: ['cat_biography', 'cat_selfhelp'],
    tags: ['literary', 'debut'],
    trimSizeId: '5.25x8',
    paletteId: 'sand',
    headingFont: 'Playfair Display',
    bodyFont: 'Crimson Pro',
    price: 10.99,
    chapters: [
      chapter('The Room on Tuesday', 'One', 'The day nothing happened, which was the whole story.', chapterBodies.firstdays.slice(0, 3)),
      chapter('Small Rooms, Short Chapters', 'Two', 'A chapter you can hold is a chapter you can finish.', chapterBodies.firstdays.slice(3)),
    ],
    createdDaysAgo: 200,
    publishedDaysAgo: 140,
    sales: 1560,
    views: 29800,
    favorites: 2410,
    rating: 4.6,
    reviewCount: 96,
    seedForArt: 'firstdays',
  },
  {
    id: 'mbook_night_planner',
    ownerId: 'user_sara',
    authorName: 'Sara Delgado',
    title: 'The Undated Year',
    subtitle: 'A planner that survives February',
    description:
      'An undated planner for people whose years do not start in January. Monthly spreads, weekly spreads, habit trackers and twelve monthly reviews — with no guilt printed anywhere.',
    shortDescription: 'Undated monthly and weekly planner with habit tracking.',
    kind: 'planner',
    categoryIds: ['cat_planner', 'cat_journal'],
    tags: ['bullet-journal', 'undated', 'goal-setting'],
    trimSizeId: '8.5x11',
    paletteId: 'forest',
    headingFont: 'Inter',
    bodyFont: 'Inter',
    price: 14.0,
    chapters: [
      chapter('How to Use This Planner', 'Start here', 'There is no wrong month to start.', [genericChapter(1, 'Setting up the year')]),
      chapter('Monthly Review', 'Each month', 'Four questions and a page you can keep.', [genericChapter(2, 'The monthly review')]),
    ],
    createdDaysAgo: 120,
    publishedDaysAgo: 62,
    sales: 2480,
    views: 44200,
    favorites: 3810,
    rating: 4.5,
    reviewCount: 142,
    seedForArt: 'undatedyear',
  },
  {
    id: 'mbook_fermentation',
    ownerId: 'user_harriet',
    authorName: 'Harriet Lindqvist',
    title: 'Fermentation for Impatient People',
    subtitle: 'Four days, not four months',
    description:
      'Every ferment in this book is ready before your patience runs out. A practical, slightly opinionated guide to quick kimchi, four-day sourdough and vinegar that behaves.',
    shortDescription: 'Quick kimchi, four-day sourdough, and vinegar that behaves.',
    kind: 'cookbook',
    categoryIds: ['cat_cookbook', 'cat_guide'],
    tags: ['fermentation', 'baking', 'recipes'],
    trimSizeId: '7x10',
    paletteId: 'forest',
    headingFont: 'Bitter',
    bodyFont: 'Source Serif 4',
    price: 13.99,
    chapters: [
      chapter('Four Days Is Enough', 'Chapter One', 'Why most fermentation advice is written by people with more patience than you.', [genericChapter(1, 'Four days is enough')]),
      chapter('Vinegar That Behaves', 'Chapter Two', 'A quick vinegar you can trust with salad.', [genericChapter(2, 'Vinegar that behaves')]),
    ],
    createdDaysAgo: 90,
    publishedDaysAgo: 40,
    sales: 720,
    views: 16800,
    favorites: 1240,
    rating: 4.7,
    reviewCount: 46,
    seedForArt: 'fermentation',
  },
  {
    id: 'mbook_free_field_notes',
    ownerId: 'user_daniel',
    authorName: 'Daniel Osei',
    title: 'Field Notes: Incident Reviews That Work',
    subtitle: 'A free companion to The Quiet Code',
    description:
      'A short, free handbook on running incident reviews that produce change rather than shame. Written for on-call engineers and the managers who schedule them.',
    shortDescription: 'Free handbook on blameless incident reviews that change behaviour.',
    kind: 'guide',
    categoryIds: ['cat_business', 'cat_education'],
    tags: ['engineering', 'career', 'study-guide'],
    trimSizeId: '5x8',
    paletteId: 'ink',
    headingFont: 'Inter',
    bodyFont: 'Inter',
    price: 0,
    chapters: [
      chapter('The Review Nobody Reads', 'One', 'Why incident documents get written and then ignored.', [genericChapter(1, 'The review nobody reads')]),
      chapter('Three Questions', 'Two', 'A structure small enough to survive a bad week.', [genericChapter(2, 'Three questions')]),
    ],
    createdDaysAgo: 60,
    publishedDaysAgo: 30,
    sales: 0,
    views: 41200,
    favorites: 2900,
    rating: 4.8,
    reviewCount: 210,
    staffPick: true,
    seedForArt: 'fieldnotes',
  },
  {
    id: 'mbook_grumbles_guide',
    ownerId: 'user_gracet',
    authorName: 'Grace Tan',
    title: 'The Grumble Guide',
    subtitle: 'A workbook for people who are fine, mostly',
    description:
      'Forty worksheets for naming the thing that is actually bothering you at work, at home and at 3 a.m. Deliberately structured. Mildly funny. Occasionally uncomfortable.',
    shortDescription: 'Forty worksheets for naming the actual problem.',
    kind: 'workbook',
    categoryIds: ['cat_workbook', 'cat_selfhelp'],
    tags: ['goal-setting', 'self-care', 'study-guide'],
    trimSizeId: '8.5x11',
    paletteId: 'lavender',
    headingFont: 'Inter',
    bodyFont: 'Inter',
    price: 11.0,
    chapters: [
      chapter('Name It Precisely', 'Module One', 'Vague problems cannot be solved, only endured.', [genericChapter(1, 'Name it precisely')]),
      chapter('The Two-Column Page', 'Module Two', 'What you control, and what you are merely furious about.', [genericChapter(2, 'The two-column page')]),
    ],
    createdDaysAgo: 100,
    publishedDaysAgo: 55,
    sales: 1120,
    views: 27400,
    favorites: 2180,
    rating: 4.4,
    reviewCount: 82,
    seedForArt: 'grumbleguide',
  },
];

function seedToBook(seed: MarketBookSeed): Book {
  const created = daysAgo(seed.createdDaysAgo, 10);
  const published = daysAgo(seed.publishedDaysAgo, 14);
  const book = buildBook({
    id: seed.id,
    ownerId: seed.ownerId,
    authorName: seed.authorName,
    title: seed.title,
    subtitle: seed.subtitle,
    description: seed.description,
    shortDescription: seed.shortDescription,
    kind: seed.kind,
    categoryIds: seed.categoryIds,
    tags: seed.tags,
    language: 'en',
    trimSizeId: seed.trimSizeId,
    paletteId: seed.paletteId,
    headingFont: seed.headingFont,
    bodyFont: seed.bodyFont,
    chapters: seed.chapters,
    frontMatter: {
      includeToc: true,
      copyright: backMatter.copyright(seed.title, seed.authorName, new Date(created).getFullYear()),
      dedication: seed.kind === 'fiction' ? 'For everyone who kept a light on.' : undefined,
    },
    includeBackMatter: true,
    createdAt: created,
    updatedAt: daysAgo(Math.max(1, Math.round(seed.publishedDaysAgo / 3)), 16),
    status: seed.status ?? 'published',
    visibility: seed.visibility ?? 'marketplace',
    price: seed.price,
    freePreviewPages: seed.freePreviewPages ?? Math.max(6, Math.round(seed.chapters.length * 2)),
    paperStock: seed.kind === 'children' || seed.kind === 'cookbook' ? 'color' : 'cream',
  });

  book.publishedAt = published;
  book.updatedAt = daysAgo(Math.max(1, Math.round(seed.publishedDaysAgo / 4)), 16);
  book.marketplace = {
    ...book.marketplace,
    listed: true,
    price: seed.price,
    discountPercent: seed.discountPercent ?? 0,
    featured: Boolean(seed.featured),
    staffPick: Boolean(seed.staffPick),
    trending: Boolean(seed.trending),
    sales: seed.sales,
    views: seed.views,
    downloads: Math.round(seed.sales * 0.86),
    favorites: seed.favorites,
    rating: seed.rating,
    reviewCount: seed.reviewCount,
    conversionRate: Number(((seed.sales / seed.views) * 100).toFixed(2)),
    commissionRate: 0.15,
    submittedAt: daysAgo(seed.publishedDaysAgo + 6, 11),
    approvedAt: daysAgo(seed.publishedDaysAgo + 1, 11),
    popularityScore: Math.round(seed.sales * 0.6 + seed.views / 40 + seed.rating * 120),
    coverArtSeed: seed.seedForArt.length * 137 + seed.sales % 977,
  };
  return book;
}

export const seedMarketBooks: Book[] = marketSeeds.map(seedToBook);

/** Books owned by the demo account, including non-marketplace states. */
export function buildDemoBooks(): Book[] {
  const harbour = seedMarketBooks.find((book) => book.id === 'mbook_harbour') as Book;

  const cartridge = buildBook({
    id: 'book_cartographers',
    ownerId: 'user_demo',
    authorName: 'Maya Chen',
    title: "The Cartographer's Apprentice",
    subtitle: 'A novel in progress',
    description: 'A second novel, currently at the awkward stage where the middle exists and refuses to explain itself.',
    shortDescription: 'Work in progress.',
    kind: 'fiction',
    categoryIds: ['cat_literary'],
    tags: ['literary', 'dual-timeline'],
    language: 'en',
    trimSizeId: '5.5x8.5',
    paletteId: 'plum',
    headingFont: 'Playfair Display',
    bodyFont: 'Crimson Pro',
    chapters: [
      chapter('A Map of Small Disappearances', 'Chapter One', 'A street that no longer exists, drawn badly and correctly.', chapterBodies.cartographer.slice(0, 2)),
      chapter('The Problem With Accurate Maps', 'Chapter Two', 'Every map is an argument about what can be left out.', chapterBodies.cartographer.slice(2, 4)),
      chapter('Draft — unnamed', 'Chapter Three', 'Notes only. The middle section resists.', ['<h2>Chapter Three</h2><p>Notes: the apprentice arrives in the wrong town, deliberately. Needs a scene with the surveyor before the flood.</p><p>Possible opening image — the theodolite left running in the rain.</p>']),
    ],
    frontMatter: { includeToc: true, dedication: 'For my grandmother, who remembered the grocer.' },
    includeBackMatter: false,
    createdAt: daysAgo(96, 8),
    updatedAt: daysAgo(2, 19),
    status: 'draft',
    visibility: 'private',
  });

  const harbourNotes = buildBook({
    id: 'book_true_stories',
    ownerId: 'user_demo',
    authorName: 'Maya Chen',
    title: 'True Stories from Ellsworth',
    subtitle: 'Notes and fragments',
    description: 'Background material, interviews and fragments that did not make it into Harbour of Small Lights.',
    shortDescription: 'Research notes and cut fragments.',
    kind: 'nonfiction',
    categoryIds: ['cat_literary'],
    tags: ['coastal', 'literary'],
    language: 'en',
    trimSizeId: '6x9',
    paletteId: 'ink',
    headingFont: 'Inter',
    bodyFont: 'Source Serif 4',
    chapters: [chapter('Interviews', 'Notes', 'Recorded at the harbour café, 2024.', [genericChapter(1, 'Interviews and transcripts')])],
    frontMatter: { includeToc: false },
    includeBackMatter: false,
    createdAt: daysAgo(150, 12),
    updatedAt: daysAgo(28, 11),
    status: 'archived',
    visibility: 'private',
  });
  harbourNotes.archivedAt = daysAgo(20, 9);

  const discarded = buildBook({
    id: 'book_lantern_first',
    ownerId: 'user_demo',
    authorName: 'Maya Chen',
    title: 'The Lantern Room (first draft — abandoned)',
    subtitle: '',
    description: 'The first, wrong version of Harbour of Small Lights. Kept for reference.',
    shortDescription: 'Abandoned first draft.',
    kind: 'fiction',
    categoryIds: ['cat_literary'],
    tags: ['literary'],
    language: 'en',
    trimSizeId: '5.5x8.5',
    paletteId: 'charcoal',
    headingFont: 'Playfair Display',
    bodyFont: 'Source Serif 4',
    chapters: [chapter('Wrong Opening', 'Chapter One', 'Starts in the wrong decade, with the wrong narrator.', [genericChapter(1, 'Wrong opening')])],
    frontMatter: { includeToc: false },
    includeBackMatter: false,
    createdAt: daysAgo(400, 9),
    updatedAt: daysAgo(70, 9),
    status: 'trashed',
    visibility: 'private',
  });
  discarded.trashedAt = daysAgo(3, 15);

  const readyBook = buildBook({
    id: 'book_keeper_ledger',
    ownerId: 'user_demo',
    authorName: 'Maya Chen',
    title: 'The Keeper & The Ledger',
    subtitle: 'A novella',
    description:
      'A companion novella to Harbour of Small Lights, following the boy on the seawall from the other side of the fog. Formatted, preflighted and ready to publish.',
    shortDescription: 'A companion novella, ready for release.',
    kind: 'fiction',
    categoryIds: ['cat_literary', 'cat_fiction'],
    tags: ['literary', 'coastal', 'series-starter'],
    language: 'en',
    trimSizeId: '5x8',
    paletteId: 'midnight',
    headingFont: 'Playfair Display',
    bodyFont: 'Source Serif 4',
    chapters: [
      chapter('The Boy on the Seawall', 'Chapter One', 'He had been waiting six years to be asked a question.', chapterBodies.lantern.slice(3)),
      chapter('What the Bell Was For', 'Chapter Two', 'A bell out past the harbour wall, ringing for the first time.', [genericChapter(2, 'What the bell was for')]),
      chapter('The Second Question', 'Chapter Three', 'The one Mara does not ask, and the fog answers anyway.', [genericChapter(3, 'The second question')]),
    ],
    frontMatter: {
      includeToc: true,
      copyright: backMatter.copyright('The Keeper & The Ledger', 'Maya Chen', 2026),
      dedication: 'For the ones who keep the light on without being asked.',
    },
    includeBackMatter: true,
    createdAt: daysAgo(58, 9),
    updatedAt: daysAgo(4, 20),
    status: 'ready',
    visibility: 'private',
    price: 4.99,
  });

  return [harbour, cartridge, readyBook, harbourNotes, discarded];
}

/* --------------------------------------------------------------- reviews */

const reviewTexts = [
  { title: 'Stayed with me for weeks', body: 'I finished this on a train and then sat in the station for twenty minutes because I was not ready to do anything else. The fog chapters are extraordinary.' },
  { title: 'Exactly what it says it is', body: 'No filler, no padding. I used three of the techniques the same week and two of them are now permanent.' },
  { title: 'Beautifully structured', body: 'What I appreciated most was the honesty about what the method cannot do. Most books in this space pretend otherwise.' },
  { title: 'A quiet, excellent book', body: 'Not flashy, not preachy. It just keeps its promises and gets out of the way.' },
  { title: 'Third read, still finding things', body: 'I have annotated a different chapter every time. The section on trade-offs alone is worth the price.' },
  { title: 'Good, occasionally repetitive', body: 'The middle third repeats an idea it already made cleanly in chapter four, but the ending more than recovers it.' },
  { title: 'My whole team read this', body: 'We bought seven copies and argued about chapter six in a meeting, which is the highest compliment I can give a book about work.' },
  { title: 'Bought for my daughter, kept it myself', body: 'The illustrations are lovely and the ending made me laugh out loud on the sofa.' },
  { title: 'Practical and specific', body: 'Plenty of books describe the problem well. This one tells you what to do on Monday morning.' },
  { title: 'A genuine page-turner', body: 'I read it in two sittings, which is unusual for me with non-fiction. The case studies carry the argument.' },
  { title: 'Layout is beautiful too', body: 'Worth noting that the typesetting is lovely — the worksheets have actual space to write in, which is rarer than it should be.' },
  { title: 'Wanted more', body: 'Good book, but I was hoping for a deeper section on the second half of the process. Still recommended.' },
];

const readers = [
  ['user_emma', 'Emma Hartley'], ['user_noah', 'Noah Bergquist'], ['user_liam', 'Liam Novak'], ['user_yuki', 'Yuki Tanaka'],
  ['user_amara', 'Amara Okonkwo'], ['user_tomas', 'Tomás Ferreira'], ['user_ines', 'Inés Moreau'], ['user_kenji', 'Kenji Sato'],
  ['user_sofia', 'Sofia Lindgren'], ['user_ahmed', 'Ahmed Farouk'], ['user_clara', 'Clara Bouchard'], ['user_raj', 'Raj Malhotra'],
  ['user_nora', 'Nora Wahlberg'], ['user_pedro', 'Pedro Alvarez'], ['user_hana', 'Hana Kim'], ['user_demo', 'Maya Chen'],
];

export function buildReviews(): Review[] {
  const reviews: Review[] = [];
  const marketBooks = seedMarketBooks;
  let index = 0;

  marketBooks.forEach((book, bookIndex) => {
    const count = Math.min(9, 3 + (book.marketplace.reviewCount % 7));
    for (let i = 0; i < count; i += 1) {
      const reader = readers[(bookIndex * 3 + i) % readers.length];
      const text = reviewTexts[(bookIndex + i) % reviewTexts.length];
      const rating = Math.max(3, Math.min(5, Math.round(book.marketplace.rating + ((i % 3 === 0 ? 1 : i % 4 === 0 ? -1 : 0)))));
      index += 1;
      const hidden = book.id === 'mbook_fourteen_ways' && i === 1;
      const pending = book.id === 'mbook_fermentation' && i === 0;
      reviews.push({
        id: `rev_${book.id}_${i}`,
        bookId: book.id,
        userId: reader[0],
        userName: reader[1],
        userAvatar: '',
        rating,
        title: text.title,
        body: text.body,
        status: hidden ? 'hidden' : pending ? 'pending' : 'published',
        helpful: (i * 7 + bookIndex * 3) % 34,
        flagged: hidden,
        createdAt: daysAgo(Math.max(2, 40 - i * 4 - bookIndex), 12 + i),
        verifiedPurchase: i % 5 !== 3,
        adminNote: hidden ? 'Hidden pending investigation of promotional link.' : undefined,
      });
    }
  });

  // One review authored by the demo user, so review editing flows have real data.
  reviews.push({
    id: 'rev_demo_own',
    bookId: 'mbook_quietcode',
    userId: 'user_demo',
    userName: 'Maya Chen',
    userAvatar: '',
    rating: 5,
    title: 'Read it twice before writing mine',
    body: 'The chapter on boundaries is the clearest explanation of that idea I have read. I borrowed it, with attribution, in a talk to a room of writers who all nodded.',
    status: 'published',
    helpful: 18,
    flagged: false,
    createdAt: daysAgo(14, 18),
    verifiedPurchase: true,
  });

  return reviews;
}

/* ---------------------------------------------------------------- orders */

export function buildOrders(): Order[] {
  const orders: Order[] = [];
  const booksWithSales = seedMarketBooks.filter((book) => book.marketplace.sales > 0);
  const buyerPool = readers.filter(([id]) => id !== 'user_demo');
  let counter = 0;

  booksWithSales.forEach((book, bookIndex) => {
    const orderCount = Math.min(14, 4 + ((book.marketplace.sales / 200) | 0) % 10);
    for (let i = 0; i < orderCount; i += 1) {
      counter += 1;
      const buyer = buyerPool[(bookIndex * 5 + i) % buyerPool.length];
      const daysBack = 3 + ((bookIndex * 7 + i * 3) % 160);
      const amount = book.marketplace.discountPercent
        ? Number((book.marketplace.price * (1 - book.marketplace.discountPercent / 100)).toFixed(2))
        : book.marketplace.price;
      const authorEarnings = Number((amount * (1 - book.marketplace.commissionRate)).toFixed(2));
      const refunded = i === 6 && bookIndex % 5 === 0;
      orders.push({
        id: `order_${book.id}_${i}`,
        number: `SC-${(41880 + counter).toString()}`,
        buyerId: buyer[0],
        buyerName: buyer[1],
        bookId: book.id,
        bookTitle: book.title,
        authorId: book.ownerId,
        authorName: book.authorName,
        amount,
        currency: 'USD',
        platformFee: Number((amount - authorEarnings).toFixed(2)),
        authorEarnings,
        status: refunded ? 'refunded' : i === 13 ? 'pending' : 'completed',
        method: (['card', 'paypal', 'apple-pay', 'credits'] as const)[i % 4],
        createdAt: daysAgo(daysBack, 8 + (i % 12)),
        country: ['US', 'GB', 'DE', 'IN', 'BR', 'JP', 'SE', 'NG', 'MX', 'FR'][(bookIndex + i) % 10],
        refundReason: refunded ? 'Reader requested a refund within the 14-day window.' : undefined,
      });
    }
  });

  return orders.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/* ------------------------------------------------------- wishlist/library */

export function buildWishlist(): WishlistItem[] {
  const ids = ['mbook_saltstone', 'mbook_quietcode', 'mbook_audit_trail', 'mbook_ledger_small', 'mbook_slowmornings', 'mbook_night_planner'];
  return ids.map((bookId, index) => ({
    id: `wish_${index + 1}`,
    userId: 'user_demo',
    bookId,
    addedAt: daysAgo(4 + index * 3, 13),
  }));
}

export function buildLibrary(): LibraryItem[] {
  const items: { bookId: ID; days: number; progress: number; source: LibraryItem['source'] }[] = [
    { bookId: 'mbook_first_days_memoir', days: 96, progress: 100, source: 'purchase' },
    { bookId: 'mbook_fermentation', days: 34, progress: 42, source: 'purchase' },
    { bookId: 'mbook_paperfox', days: 21, progress: 78, source: 'purchase' },
    { bookId: 'mbook_free_field_notes', days: 18, progress: 12, source: 'free' },
    { bookId: 'mbook_slowmornings', days: 9, progress: 5, source: 'purchase' },
  ];
  return items.map((item, index) => ({
    id: `lib_${index + 1}`,
    userId: 'user_demo',
    bookId: item.bookId,
    orderId: `order_${item.bookId}_0`,
    acquiredAt: daysAgo(item.days, 15),
    progress: item.progress,
    lastReadAt: daysAgo(Math.max(1, Math.round(item.days / 3)), 20),
    bookmarkedPages: item.progress > 40 ? [1, 2] : [],
    downloaded: index % 2 === 0,
    source: item.source,
    readingMode: 'page',
    fontSize: 18,
    readerTheme: 'light',
  }));
}

export { marketSeeds, readers };
export const marketBookIds = seedMarketBooks.map((book) => book.id);
export const demoOwnedBookIds = ['mbook_harbour', 'book_cartographers', 'book_keeper_ledger', 'book_true_stories', 'book_lantern_first'];
