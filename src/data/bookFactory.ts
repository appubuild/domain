import type {
  Book,
  BookKind,
  BookPage,
  BookSection,
  BookStatus,
  BookVisibility,
  CoverDesign,
  ID,
  PageElement,
  TrimSize,
} from '@/types/domain';
import { coverArtUrl, paletteById } from '@/lib/coverArt';
import { countWords, uid } from '@/lib/utils';
import { TRIM_SIZES, PAGE_PALETTES } from './constants';
import { backMatter } from './prose';

export function trimSizeById(id: string): TrimSize {
  return TRIM_SIZES.find((size) => size.id === id) ?? TRIM_SIZES[4];
}

export function makeElement(partial: Partial<PageElement> & { type: PageElement['type'] }): PageElement {
  return {
    id: uid('el'),
    name: partial.name ?? partial.type,
    x: 60,
    y: 60,
    w: 240,
    h: 80,
    rotation: 0,
    visible: true,
    locked: false,
    ...partial,
  } as PageElement;
}

export function textElement(
  text: string,
  opts: Partial<PageElement> & { style?: PageElement['style'] } = {},
): PageElement {
  return makeElement({
    type: 'text',
    name: opts.name ?? 'Text',
    text,
    w: 320,
    h: 60,
    ...opts,
    style: {
      fontFamily: 'Source Serif 4',
      fontSize: 16,
      fontWeight: 400,
      italic: false,
      underline: false,
      strikethrough: false,
      color: '#111827',
      align: 'left',
      lineHeight: 1.5,
      letterSpacing: 0,
      textTransform: 'none',
      opacity: 1,
      ...opts.style,
    },
  });
}

export function makeCoverPage(book: Partial<Book> & { title: string; authorName: string }): BookPage {
  const palette = paletteById(book.theme?.palette ?? 'midnight');
  const elements: PageElement[] = [
    makeElement({
      type: 'shape',
      name: 'Cover background',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      shape: { kind: 'rect', fill: palette.colors[0], stroke: 'transparent', strokeWidth: 0, radius: 0 },
    }),
    makeElement({
      type: 'shape',
      name: 'Accent rule',
      x: 12,
      y: 58,
      w: 26,
      h: 1,
      shape: { kind: 'rect', fill: palette.colors[2], stroke: 'transparent', strokeWidth: 0, radius: 0 },
    }),
    textElement(book.title, {
      name: 'Cover title',
      x: 12,
      y: 40,
      w: 76,
      h: 16,
      style: {
        fontFamily: book.theme?.headingFont ?? 'Playfair Display',
        fontSize: 34,
        fontWeight: 700,
        color: palette.ink,
        lineHeight: 1.15,
        align: 'left',
        italic: false,
        underline: false,
        strikethrough: false,
        letterSpacing: -0.4,
        textTransform: 'none',
        opacity: 1,
      },
    }),
    textElement(book.authorName.toUpperCase(), {
      name: 'Cover author',
      x: 12,
      y: 86,
      w: 60,
      h: 8,
      style: {
        fontFamily: 'Inter',
        fontSize: 11,
        fontWeight: 600,
        color: palette.ink,
        letterSpacing: 3,
        align: 'left',
        italic: false,
        underline: false,
        strikethrough: false,
        lineHeight: 1.4,
        textTransform: 'uppercase',
        opacity: 0.92,
      },
    }),
  ];

  return {
    id: uid('pg'),
    sectionId: '',
    title: 'Cover',
    layout: 'title',
    content: '',
    elements,
    background: { type: 'color', value: palette.colors[0] },
    numbering: 'none',
    locked: false,
    notes: '',
    wordCount: 0,
    updatedAt: new Date().toISOString(),
    atomic: true,
  };
}

export function flowPage(sectionId: ID, title: string, content: string, opts: Partial<BookPage> = {}): BookPage {
  return {
    id: uid('pg'),
    sectionId,
    title,
    layout: 'flow',
    content,
    elements: [],
    background: { type: 'none', value: '#ffffff' },
    numbering: 'inherit',
    locked: false,
    notes: '',
    wordCount: countWords(content),
    updatedAt: new Date().toISOString(),
    atomic: false,
    ...opts,
  };
}

export function titlePage(sectionId: ID, title: string, subtitle: string, paletteId = 'ink'): BookPage {
  const palette = paletteById(paletteId);
  return {
    id: uid('pg'),
    sectionId,
    title: `${title} title page`,
    layout: 'title',
    content: '',
    elements: [
      textElement(`<p>${title}</p>`, {
        name: 'Chapter title',
        x: 14,
        y: 40,
        w: 72,
        h: 14,
        style: {
          fontFamily: 'Playfair Display',
          fontSize: 30,
          fontWeight: 700,
          color: '#111827',
          align: 'left',
          lineHeight: 1.2,
        },
      }),
      subtitle
        ? textElement(`<p>${subtitle}</p>`, {
            name: 'Chapter subtitle',
            x: 14,
            y: 52,
            w: 72,
            h: 8,
            style: { fontFamily: 'Inter', fontSize: 12, fontWeight: 400, color: palette.accent, align: 'left', letterSpacing: 1.5, lineHeight: 1.5 },
          })
        : makeElement({ type: 'divider', name: 'Empty', x: 14, y: 52, w: 20, h: 1, visible: false, divider: { style: 'solid', color: palette.accent, thickness: 1 } }),
    ],
    background: { type: 'none', value: '#ffffff' },
    numbering: 'inherit',
    locked: false,
    notes: '',
    wordCount: 0,
    updatedAt: new Date().toISOString(),
    atomic: true,
  };
}

export interface ChapterBlueprint {
  title: string;
  subtitle?: string;
  summary?: string;
  body: string[];
}

export interface BookBlueprint {
  id: ID;
  ownerId: ID;
  authorName: string;
  title: string;
  subtitle: string;
  description: string;
  shortDescription: string;
  kind: BookKind;
  categoryIds: string[];
  tags: string[];
  language: string;
  trimSizeId: string;
  paletteId: string;
  headingFont: string;
  bodyFont: string;
  chapters: ChapterBlueprint[];
  frontMatter?: {
    dedication?: string;
    copyright?: string;
    includeToc?: boolean;
  };
  includeBackMatter?: boolean;
  createdAt?: string;
  updatedAt?: string;
  status?: BookStatus;
  visibility?: BookVisibility;
  price?: number;
  freePreviewPages?: number;
  paperStock?: 'white' | 'cream' | 'color';
  templateId?: string;
  themeId?: string;
}

export function buildBook(blueprint: BookBlueprint): Book {
  const palette = paletteById(blueprint.paletteId);
  const now = blueprint.createdAt ?? new Date().toISOString();
  const trimSize = trimSizeById(blueprint.trimSizeId);

  const bookShell: Partial<Book> & { title: string; authorName: string } = {
    title: blueprint.title,
    authorName: blueprint.authorName,
    theme: { palette: blueprint.paletteId, headingFont: blueprint.headingFont } as Book['theme'],
  };

  const coverPage = makeCoverPage(bookShell);

  const coverSection: BookSection = {
    id: uid('sec'),
    bookId: blueprint.id,
    kind: 'cover',
    title: 'Cover',
    order: 0,
    pageIds: [coverPage.id],
    wordCount: 0,
    status: 'complete',
  };
  coverPage.sectionId = coverSection.id;

  const frontPages: BookPage[] = [];
  if (blueprint.frontMatter?.copyright !== undefined) {
    frontPages.push(flowPage(coverSection.id, 'Copyright', blueprint.frontMatter.copyright));
  }
  if (blueprint.frontMatter?.dedication) {
    frontPages.push(flowPage(coverSection.id, 'Dedication', backMatter.dedication(blueprint.frontMatter.dedication)));
  }
  if (blueprint.frontMatter?.includeToc !== false) {
    frontPages.push(
      flowPage(
        coverSection.id,
        'Table of Contents',
        '<h2>Table of Contents</h2><p class="toc-placeholder">Auto-generated from your chapter structure at export time. Open the Book Structure panel to regenerate.</p>',
        { layout: 'flow' },
      ),
    );
  }

  const frontSection: BookSection = {
    id: uid('sec'),
    bookId: blueprint.id,
    kind: 'front-matter',
    title: 'Front Matter',
    order: 1,
    pageIds: frontPages.map((page) => page.id),
    wordCount: frontPages.reduce((total, page) => total + page.wordCount, 0),
    status: frontPages.length ? 'complete' : 'empty',
  };
  frontPages.forEach((page) => {
    page.sectionId = frontSection.id;
  });

  const chapterSections: BookSection[] = [];
  const chapterPages: BookPage[] = [];

  blueprint.chapters.forEach((chapter, index) => {
    const section: BookSection = {
      id: uid('sec'),
      bookId: blueprint.id,
      kind: 'chapter',
      title: chapter.title,
      subtitle: chapter.subtitle,
      summary: chapter.summary,
      order: index + 2,
      pageIds: [],
      numberingStarts: index === 0 ? 1 : null,
      wordCount: 0,
      status: 'drafting',
    };
    const pages: BookPage[] = [
      titlePage(section.id, chapter.title, chapter.subtitle ?? `Chapter ${index + 1}`, blueprint.paletteId),
      ...chapter.body.map((body, bodyIndex) =>
        flowPage(section.id, `${chapter.title}${bodyIndex ? ` · part ${bodyIndex + 1}` : ''}`, body),
      ),
    ];
    section.pageIds = pages.map((page) => page.id);
    section.wordCount = pages.reduce((total, page) => total + page.wordCount, 0);
    chapterSections.push(section);
    chapterPages.push(...pages);
  });

  const backPages: BookPage[] = [];
  if (blueprint.includeBackMatter !== false) {
    backPages.push(
      flowPage(
        coverSection.id,
        'About the Author',
        backMatter.aboutAuthor(
          blueprint.authorName,
          `${blueprint.authorName} writes ${blueprint.kind === 'fiction' ? 'fiction' : 'practical non-fiction'} from a small studio with far too many notebooks in it.`,
          `Connect with the author and follow new releases from the Scriptora author profile.`,
        ),
      ),
      flowPage(coverSection.id, 'Acknowledgements', backMatter.acknowledgements()),
    );
  }

  const backSection: BookSection = {
    id: uid('sec'),
    bookId: blueprint.id,
    kind: 'back-matter',
    title: 'Back Matter',
    order: blueprint.chapters.length + 2,
    pageIds: backPages.map((page) => page.id),
    wordCount: backPages.reduce((total, page) => total + page.wordCount, 0),
    status: backPages.length ? 'complete' : 'empty',
  };
  backPages.forEach((page) => {
    page.sectionId = backSection.id;
  });

  const sections = [coverSection, frontSection, ...chapterSections, backSection];
  const pages = [coverPage, ...frontPages, ...chapterPages, ...backPages];

  // Re-number order values so they always match array order.
  sections.forEach((section, index) => {
    section.order = index;
  });

  const wordCount = pages.reduce((total, page) => total + page.wordCount, 0);

  const cover: CoverDesign = {
    style: palette.id,
    backgroundColor: palette.colors[0],
    gradient: `linear-gradient(160deg, ${palette.colors[0]} 0%, ${palette.colors[1]} 100%)`,
    imageUrl: coverArtUrl({
      seed: blueprint.id,
      paletteId: blueprint.paletteId,
      title: blueprint.title,
      author: blueprint.authorName,
    }),
    titleFont: blueprint.headingFont,
    subtitleFont: blueprint.bodyFont,
    authorFont: 'Inter',
    titleColor: palette.ink,
    subtitleColor: palette.ink,
    authorColor: palette.ink,
    titleSize: 46,
    layout: 'classic',
    spineText: `${blueprint.title} · ${blueprint.authorName}`,
    backText: blueprint.shortDescription || blueprint.description.slice(0, 240),
    showBarcode: true,
    barcodeIsbn: '978-1-9842-1180-4',
    tagline: blueprint.subtitle,
    elements: [],
  };

  const book: Book = {
    id: blueprint.id,
    ownerId: blueprint.ownerId,
    authorName: blueprint.authorName,
    title: blueprint.title,
    subtitle: blueprint.subtitle,
    description: blueprint.description,
    shortDescription: blueprint.shortDescription,
    kind: blueprint.kind,
    categoryIds: blueprint.categoryIds,
    tags: blueprint.tags,
    language: blueprint.language,
    status: blueprint.status ?? 'draft',
    visibility: blueprint.visibility ?? 'private',
    trimSize,
    orientation: 'portrait',
    margins: { top: 0.75, right: 0.6, bottom: 0.75, left: 0.6, mirror: true },
    gutter: 0.2,
    bleed: 0,
    safeArea: 0.25,
    facingPages: true,
    theme: {
      palette: blueprint.paletteId,
      accentColor: palette.accent,
      headingFont: blueprint.headingFont,
      bodyFont: blueprint.bodyFont,
      headingScale: 1.25,
      dropCaps: true,
      chapterStartsRecto: true,
      paragraphIndent: 0.25,
      paragraphSpacing: 0,
      lineHeight: 1.55,
    },
    fonts: { heading: blueprint.headingFont, body: blueprint.bodyFont, mono: 'JetBrains Mono', baseSize: 11.5 },
    numbering: {
      style: 'arabic',
      startAt: 1,
      hideOnFirstPage: true,
      sectionBased: false,
      position: 'bottom-center',
    },
    headerFooter: {
      headerEnabled: false,
      headerLeft: '{title}',
      headerCenter: '',
      headerRight: '{author}',
      footerEnabled: true,
      footerLeft: '',
      footerCenter: '{page}',
      footerRight: '',
      differentFirstPage: true,
      firstPageFooter: '',
    },
    toc: { enabled: true, title: 'Table of Contents', depth: 1, dots: true, showPageNumbers: true, placement: 'front' },
    metadata: {
      isbn: '978-1-9842-1180-4',
      publisher: 'Bramble & Ash Press',
      edition: 'First edition',
      publishDate: now.slice(0, 10),
      copyright: `© ${new Date(now).getFullYear()} ${blueprint.authorName}`,
      language: blueprint.language,
      keywords: blueprint.tags,
      bisac: ['FIC000000'],
      ageRange: blueprint.kind === 'children' ? '4-8' : 'Adult',
      series: '',
      seriesNumber: null,
      imprint: 'Bramble & Ash',
      rights: 'World rights',
      aiDisclosure: false,
    },
    cover,
    sections,
    pages,
    marketplace: {
      listed: blueprint.visibility === 'marketplace',
      price: blueprint.price ?? 9.99,
      currency: 'USD',
      discountPercent: 0,
      featured: false,
      staffPick: false,
      trending: false,
      freePreviewPages: blueprint.freePreviewPages ?? 12,
      sales: 0,
      views: 0,
      downloads: 0,
      favorites: 0,
      rating: 0,
      reviewCount: 0,
      conversionRate: 0,
      commissionRate: 0.15,
      categories: blueprint.categoryIds,
      tags: blueprint.tags,
      popularityScore: 0,
      coverArtSeed: Math.abs(blueprint.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % 9999,
    },
    wordCount,
    pageCount: pages.length,
    createdAt: now,
    updatedAt: blueprint.updatedAt ?? now,
    lastOpenedAt: now,
    templateId: blueprint.templateId,
    paperStock: blueprint.paperStock ?? 'cream',
    starred: false,
  };

  if (blueprint.status === 'published') {
    book.publishedAt = now;
  }

  return book;
}

/** Deep clone helper that re-issues every identifier so duplicates are independent. */
export function duplicateBook(source: Book, ownerId: ID, title: string): Book {
  const idMap = new Map<ID, ID>();
  const clone: Book = JSON.parse(JSON.stringify(source));
  clone.id = uid('book');
  clone.ownerId = ownerId;
  clone.title = title;
  clone.status = 'draft';
  clone.visibility = 'private';
  clone.publishedAt = undefined;
  clone.archivedAt = undefined;
  clone.trashedAt = undefined;
  clone.createdAt = new Date().toISOString();
  clone.updatedAt = new Date().toISOString();
  clone.starred = false;
  clone.marketplace = {
    ...clone.marketplace,
    listed: false,
    sales: 0,
    views: 0,
    downloads: 0,
    favorites: 0,
    rating: 0,
    reviewCount: 0,
    featured: false,
    staffPick: false,
    trending: false,
    submittedAt: undefined,
    approvedAt: undefined,
  };
  clone.wordCount = clone.pages.reduce((total, page) => total + page.wordCount, 0);

  clone.sections = clone.sections.map((section) => {
    const newId = uid('sec');
    idMap.set(section.id, newId);
    return { ...section, id: newId, bookId: clone.id };
  });
  clone.pages = clone.pages.map((page) => ({
    ...page,
    id: uid('pg'),
    sectionId: idMap.get(page.sectionId) ?? page.sectionId,
    elements: page.elements.map((element) => ({ ...element, id: uid('el') })),
    updatedAt: new Date().toISOString(),
  }));
  clone.sections = clone.sections.map((section) => ({
    ...section,
    pageIds: clone.pages.filter((page) => page.sectionId === section.id).map((page) => page.id),
  }));
  return clone;
}

export function recalculateBook(book: Book): Book {
  book.wordCount = book.pages.reduce((total, page) => total + page.wordCount, 0);
  book.pageCount = book.pages.length;
  book.sections = [...book.sections]
    .sort((a, b) => a.order - b.order)
    .map((section, index) => {
      const pages = book.pages.filter((page) => page.sectionId === section.id);
      return {
        ...section,
        order: index,
        pageIds: pages.map((page) => page.id),
        wordCount: pages.reduce((total, page) => total + page.wordCount, 0),
        status: pages.length === 0 ? 'empty' : pages.every((page) => page.wordCount > 40) ? 'complete' : 'drafting',
      };
    });
  book.pages = [...book.sections].flatMap((section) =>
    book.pages.filter((page) => page.sectionId === section.id),
  );
  return book;
}

export function emptyBookShell(
  ownerId: ID,
  authorName: string,
  overrides: Partial<Book> & { title: string },
): Book {
  return buildBook({
    id: uid('book'),
    ownerId,
    authorName,
    title: overrides.title,
    subtitle: overrides.subtitle ?? '',
    description: overrides.description ?? '',
    shortDescription: overrides.shortDescription ?? '',
    kind: overrides.kind ?? 'fiction',
    categoryIds: overrides.categoryIds ?? [],
    tags: overrides.tags ?? [],
    language: overrides.language ?? 'en',
    trimSizeId: overrides.trimSize?.id ?? '6x9',
    paletteId: overrides.theme?.palette ?? 'ink',
    headingFont: overrides.fonts?.heading ?? 'Playfair Display',
    bodyFont: overrides.fonts?.body ?? 'Source Serif 4',
    chapters: [{ title: 'Chapter 1', body: ['<p></p>'] }],
    frontMatter: { includeToc: true },
    includeBackMatter: false,
  });
}

export { PAGE_PALETTES };
