import type {
  Book,
  BookPage,
  BookSection,
  Collaborator,
  Comment,
  CreateBookInput,
  ID,
  MemoryEntry,
  VersionEntry,
} from '@/types/domain';
import { countWords, delay, slugify, uid } from '@/lib/utils';
import { getDatabase, mutateDatabase } from '@/store/db';
import { bookRepo, type BookListFilters } from '@/repositories';
import { buildBook, duplicateBook, flowPage, titlePage, trimSizeById } from '@/data/bookFactory';
import { PAPER_THICKNESS } from '@/data/constants';
import { coverArtUrl, patternUrl } from '@/lib/coverArt';
import { genericChapter } from '@/data/prose';
import { assets as seedAssetUrls } from './seedUrlHelpers';

export interface ImportResult {
  book: Book;
  detected: {
    fileName: string;
    format: 'docx' | 'html' | 'epub' | 'txt' | 'unknown';
    sizeBytes: number;
    chapters: number;
    words: number;
    images: number;
    parsed: boolean;
  };
}

export const bookService = {
  list(filters: BookListFilters): Book[] {
    return bookRepo.list(filters);
  },
  get(id: ID | undefined): Book | undefined {
    return bookRepo.find(id);
  },
  async getAsync(id: ID): Promise<Book> {
    await delay(140);
    const book = bookRepo.find(id);
    if (!book) throw new Error('That book could not be found. It may have been deleted.');
    return book;
  },
  counts(userId: ID) {
    const books = bookRepo.list({ ownerId: userId, status: 'all' });
    return {
      all: books.filter((book) => book.status !== 'trashed').length,
      drafts: books.filter((book) => book.status === 'draft' || book.status === 'in_review').length,
      published: books.filter((book) => book.status === 'published').length,
      private: books.filter((book) => book.status !== 'trashed' && book.visibility === 'private').length,
      archived: books.filter((book) => book.status === 'archived').length,
      trash: books.filter((book) => book.status === 'trashed').length,
      totalWords: books.filter((book) => book.status !== 'trashed').reduce((total, book) => total + book.wordCount, 0),
      totalPages: books.filter((book) => book.status !== 'trashed').reduce((total, book) => total + book.pageCount, 0),
    };
  },
  async create(input: CreateBookInput, ownerId: ID, ownerName: string): Promise<Book> {
    await delay(420);
    const chapters =
      input.source === 'ai' && input.aiBrief
        ? input.aiBrief.outline.map((entry) => ({
            title: entry.title,
            subtitle: '',
            summary: entry.summary,
            body: [genericChapter(1, entry.title), genericChapter(2, `${entry.title} — second movement`)],
          }))
        : [
            { title: 'Chapter 1', subtitle: '', summary: '', body: ['<h2>Chapter 1</h2><p></p>'] },
            { title: 'Chapter 2', subtitle: '', summary: '', body: ['<h2>Chapter 2</h2><p></p>'] },
          ];

    const book = buildBook({
      id: uid('book'),
      ownerId,
      authorName: input.author || ownerName,
      title: input.title,
      subtitle: input.subtitle ?? '',
      description: input.description ?? '',
      shortDescription: (input.description ?? '').slice(0, 180),
      kind: input.kind,
      categoryIds: [],
      tags: [],
      language: input.language,
      trimSizeId: input.trimSizeId,
      paletteId: input.palette,
      headingFont: input.headingFont,
      bodyFont: input.bodyFont,
      chapters,
      frontMatter: { includeToc: true },
      includeBackMatter: input.source !== 'blank',
      status: 'draft',
      visibility: 'private',
      templateId: input.templateId,
      paperStock: input.kind === 'children' || input.kind === 'cookbook' ? 'color' : 'cream',
    });

    book.margins = { ...book.margins, ...input.margins };
    book.gutter = input.gutter;
    book.bleed = input.bleed;
    book.orientation = input.orientation;
    book.trimSize = trimSizeById(input.trimSizeId);
    book.facingPages = input.orientation === 'portrait';
    book.cover = { ...book.cover, imageUrl: coverArtUrl({ seed: book.id, paletteId: input.palette, title: input.title, author: input.author || ownerName }) };

    bookRepo.create(book);
    return book;
  },
  async createFromTemplate(templateId: ID, ownerId: ID, ownerName: string, title?: string): Promise<{ book: Book; createdPages: number }> {
    await delay(500);
    const db = getDatabase();
    const template = db.templates.find((entry) => entry.id === templateId);
    if (!template) throw new Error('That template is no longer available.');
    const templateData = db.templates.find((entry) => entry.id === templateId) as typeof template;

    const chapterCount = Math.max(3, Math.min(12, templateData.structure.find((entry) => entry.kind === 'chapter')?.pages ?? 6));
    const chapters = Array.from({ length: chapterCount }).map((_, index) => ({
      title: `Chapter ${index + 1}`,
      subtitle: '',
      summary: '',
      body: [genericChapter(index + 1, `Working title ${index + 1}`)],
    }));

    const book = buildBook({
      id: uid('book'),
      ownerId,
      authorName: ownerName,
      title: title || `${template.name} project`,
      subtitle: '',
      description: template.description,
      shortDescription: template.description.slice(0, 160),
      kind: template.kind,
      categoryIds: [template.categoryId],
      tags: template.tags,
      language: template.language,
      trimSizeId: template.trimSize.id,
      paletteId: template.palette,
      headingFont: template.headingFont,
      bodyFont: template.bodyFont,
      chapters,
      frontMatter: { includeToc: true },
      includeBackMatter: true,
      templateId: template.id,
      status: 'draft',
    });

    book.theme.accentColor = template.accentColor;
    bookRepo.create(book);
    return { book, createdPages: book.pageCount };
  },
  async importDocument(file: File, ownerId: ID, ownerName: string, title?: string): Promise<ImportResult> {
    const extension = (file.name.split('.').pop() ?? '').toLowerCase();
    const format: ImportResult['detected']['format'] =
      extension === 'docx' ? 'docx' : extension === 'html' || extension === 'htm' ? 'html' : extension === 'epub' ? 'epub' : extension === 'txt' || extension === 'md' ? 'txt' : 'unknown';

    let parsedChapters: { title: string; body: string[] }[] = [];
    let parsed = false;

    if (format === 'txt' || format === 'html') {
      try {
        const text = await file.text();
        const plain = format === 'html' ? text.replace(/<[^>]+>/g, '\n') : text;
        const lines = plain.split(/\r?\n/).map((line) => line.trim());
        const chapterStarts: number[] = [];
        lines.forEach((line, index) => {
          if (/^(chapter|part|section)\s+([0-9]+|[ivxlc]+)/i.test(line) || /^#{1,2}\s+/.test(line)) chapterStarts.push(index);
        });
        if (chapterStarts.length >= 2) {
          chapterStarts.forEach((start, index) => {
            const end = chapterStarts[index + 1] ?? lines.length;
            const title = lines[start].replace(/^#+\s*/, '').slice(0, 80);
            const paragraphs = lines.slice(start + 1, end).filter((line) => line.length > 1);
            const body: string[] = [];
            for (let i = 0; i < paragraphs.length; i += 6) {
              body.push(`<p>${paragraphs.slice(i, i + 6).join(' ')}</p>`);
            }
            parsedChapters.push({ title, body: body.length ? body : ['<p></p>'] });
          });
          parsed = true;
        }
      } catch {
        parsed = false;
      }
    }

    await delay(900);

    if (!parsedChapters.length) {
      const simulatedCount = format === 'epub' ? 9 : format === 'docx' ? 7 : 5;
      parsedChapters = Array.from({ length: simulatedCount }).map((_, index) => ({
        title: `Imported chapter ${index + 1}`,
        body: [genericChapter(index + 1, `Imported section ${index + 1}`)],
      }));
    }

    const book = buildBook({
      id: uid('book'),
      ownerId,
      authorName: ownerName,
      title: title || file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
      subtitle: '',
      description: `Imported from ${file.name}. Review the chapter structure and typography before publishing.`,
      shortDescription: `Imported from ${file.name}`,
      kind: 'fiction',
      categoryIds: [],
      tags: ['imported'],
      language: 'en',
      trimSizeId: '6x9',
      paletteId: 'ink',
      headingFont: 'Playfair Display',
      bodyFont: 'Source Serif 4',
      chapters: parsedChapters.map((chapter) => ({ title: chapter.title, subtitle: '', summary: '', body: chapter.body })),
      frontMatter: { includeToc: true },
      includeBackMatter: false,
      status: 'draft',
      visibility: 'private',
    });
    bookRepo.create(book);

    return {
      book,
      detected: {
        fileName: file.name,
        format,
        sizeBytes: file.size,
        chapters: parsedChapters.length,
        words: book.wordCount,
        images: parsed ? 0 : Math.max(1, Math.round(parsedChapters.length / 2)),
        parsed,
      },
    };
  },
  duplicate(id: ID, ownerId: ID, title?: string): Book {
    const source = bookRepo.find(id);
    if (!source) throw new Error('That book could not be found.');
    const clone = duplicateBook(source, ownerId, title || `${source.title} (copy)`);
    bookRepo.create(clone);
    return clone;
  },
  async trash(id: ID): Promise<Book | undefined> {
    await delay(220);
    return bookRepo.update(id, { status: 'trashed', trashedAt: new Date().toISOString(), archivedAt: undefined });
  },
  async restore(id: ID): Promise<Book | undefined> {
    await delay(220);
    const book = bookRepo.find(id);
    if (!book) return undefined;
    const nextStatus = book.publishedAt ? 'published' : 'draft';
    return bookRepo.update(id, { status: nextStatus, trashedAt: undefined, archivedAt: undefined });
  },
  async archive(id: ID): Promise<Book | undefined> {
    await delay(200);
    return bookRepo.update(id, { status: 'archived', archivedAt: new Date().toISOString() });
  },
  async unarchive(id: ID): Promise<Book | undefined> {
    await delay(200);
    return bookRepo.update(id, { status: 'draft', archivedAt: undefined });
  },
  async remove(id: ID): Promise<void> {
    await delay(320);
    bookRepo.remove(id);
  },
  async rename(id: ID, title: string, subtitle?: string): Promise<Book | undefined> {
    await delay(220);
    return bookRepo.update(id, { title, ...(subtitle !== undefined ? { subtitle } : {}) });
  },
  update(id: ID, patch: Partial<Book>): Book | undefined {
    return bookRepo.update(id, patch);
  },
  toggleStar(id: ID): Book | undefined {
    const book = bookRepo.find(id);
    if (!book) return undefined;
    return bookRepo.update(id, { starred: !book.starred });
  },
  async setVisibility(id: ID, visibility: Book['visibility']): Promise<Book | undefined> {
    await delay(260);
    const book = bookRepo.find(id);
    if (!book) return undefined;
    return bookRepo.update(id, {
      visibility,
      marketplace: { ...book.marketplace, listed: visibility === 'marketplace' },
    });
  },
  touch(id: ID) {
    bookRepo.update(id, { lastOpenedAt: new Date().toISOString() });
  },
  // ------------------------------------------------------------------ pages
  updatePage(bookId: ID, pageId: ID, patch: Partial<BookPage>) {
    return bookRepo.updatePage(bookId, pageId, patch);
  },
  addPage(bookId: ID, sectionId: ID, options: { title?: string; layout?: BookPage['layout']; index?: number } = {}) {
    const page = flowPage(sectionId, options.title ?? 'Untitled page', options.layout === 'title' ? '' : '<p></p>', {
      layout: options.layout ?? 'flow',
    });
    return { book: bookRepo.addPage(bookId, sectionId, page, options.index), page };
  },
  addChapter(bookId: ID, title: string): { book: Book | undefined; section?: BookSection } {
    const book = bookRepo.find(bookId);
    if (!book) return { book: undefined };
    const section: BookSection = {
      id: uid('sec'),
      bookId,
      kind: 'chapter',
      title,
      subtitle: '',
      order: book.sections.length,
      pageIds: [],
      wordCount: 0,
      status: 'empty',
    };
    const updated = bookRepo.addSection(bookId, section);
    const titlePg = titlePage(section.id, title, '', book.theme.palette);
    const contentPg = flowPage(section.id, `${title} content`, `<h2>${title}</h2><p></p>`);
    bookRepo.addPage(bookId, section.id, titlePg);
    const final = bookRepo.addPage(bookId, section.id, contentPg);
    return { book: final ?? updated, section };
  },
  removePage(bookId: ID, pageId: ID) {
    return bookRepo.removePage(bookId, pageId);
  },
  duplicatePage(bookId: ID, pageId: ID) {
    const book = bookRepo.find(bookId);
    const page = book?.pages.find((entry) => entry.id === pageId);
    if (!book || !page) return undefined;
    const index = book.pages.findIndex((entry) => entry.id === pageId);
    const clone: BookPage = {
      ...JSON.parse(JSON.stringify(page)),
      id: uid('pg'),
      title: `${page.title} copy`,
      elements: page.elements.map((element) => ({ ...element, id: uid('el') })),
      updatedAt: new Date().toISOString(),
    };
    return bookRepo.addPage(bookId, page.sectionId, clone, index + 1);
  },
  reorderPages(bookId: ID, orderedIds: ID[]) {
    return bookRepo.reorderPages(bookId, orderedIds);
  },
  movePageToSection(bookId: ID, pageId: ID, sectionId: ID) {
    return bookRepo.updatePage(bookId, pageId, { sectionId });
  },
  updateSection(bookId: ID, sectionId: ID, patch: Partial<BookSection>) {
    return bookRepo.updateSection(bookId, sectionId, patch);
  },
  removeSection(bookId: ID, sectionId: ID) {
    return bookRepo.removeSection(bookId, sectionId);
  },
  reorderSections(bookId: ID, orderedIds: ID[]) {
    return bookRepo.reorderSections(bookId, orderedIds);
  },
  splitSectionAtPage(bookId: ID, pageId: ID, title: string) {
    const book = bookRepo.find(bookId);
    if (!book) return undefined;
    const page = book.pages.find((entry) => entry.id === pageId);
    if (!page) return undefined;
    const sourceSection = book.sections.find((section) => section.id === page.sectionId);
    if (!sourceSection) return undefined;
    const pageIndex = sourceSection.pageIds.indexOf(pageId);
    const moving = sourceSection.pageIds.slice(pageIndex);
    const section: BookSection = {
      id: uid('sec'),
      bookId,
      kind: 'chapter',
      title,
      order: sourceSection.order + 1,
      pageIds: moving,
      wordCount: 0,
      status: 'drafting',
    };
    bookRepo.addSection(bookId, section);
    moving.forEach((id) => bookRepo.updatePage(bookId, id, { sectionId: section.id }));
    return bookService.get(bookId);
  },
  // ------------------------------------------------------------------- toc
  generateToc(bookId: ID): { book: Book | undefined; entries: { title: string; page: number }[] } {
    const book = bookRepo.find(bookId);
    if (!book) return { book: undefined, entries: [] };
    const entries = book.sections
      .filter((section) => section.kind === 'chapter' || section.kind === 'part')
      .map((section, index) => ({ title: section.title, page: index * 2 + 1 }));
    const tocSection = book.sections.find((section) => section.kind === 'front-matter');
    const tocPage = book.pages.find((page) => page.title === 'Table of Contents');
    const html = `<h2>${book.toc.title}</h2><ul class="toc-list">${entries
      .map((entry) => `<li><span>${entry.title}</span><span class="leader"></span><span>${entry.page}</span></li>`)
      .join('')}</ul>`;
    if (tocPage) {
      bookRepo.updatePage(bookId, tocPage.id, { content: html });
    } else if (tocSection) {
      bookRepo.addPage(bookId, tocSection.id, flowPage(tocSection.id, 'Table of Contents', html));
    }
    return { book: bookService.get(bookId), entries };
  },
  // ------------------------------------------------------------- utilities
  wordCount(bookId: ID) {
    const book = bookRepo.find(bookId);
    return book?.pages.reduce((total, page) => total + countWords(page.content), 0) ?? 0;
  },
  spineWidth(bookId: ID) {
    const book = bookRepo.find(bookId);
    if (!book) return { widthIn: 0, pages: 0, paper: 'cream' as const };
    const thickness = PAPER_THICKNESS[book.paperStock] ?? PAPER_THICKNESS.cream;
    const pages = book.pageCount;
    return { widthIn: Number((pages * thickness).toFixed(3)), pages, paper: book.paperStock };
  },
  pageLabel(bookId: ID, index: number) {
    const book = bookRepo.find(bookId);
    if (!book) return String(index + 1);
    if (book.numbering.style === 'none') return '';
    if (book.numbering.style === 'roman-lower' || book.numbering.style === 'roman-upper') {
      return book.numbering.style === 'roman-lower' ? toRomanLower(index + 1) : toRomanLower(index + 1).toUpperCase();
    }
    return String(index + book.numbering.startAt);
  },
  // ----------------------------------------------------------- comments etc
  comments(bookId: ID): Comment[] {
    return bookRepo.comments(bookId);
  },
  async addComment(bookId: ID, user: { id: ID; name: string; avatarUrl: string }, body: string, target: { pageId?: ID; sectionId?: ID } = {}): Promise<Comment> {
    await delay(260);
    const comment: Comment = {
      id: uid('cmt'),
      bookId,
      userId: user.id,
      userName: user.name,
      userAvatar: user.avatarUrl,
      body,
      mentions: Array.from(body.matchAll(/@([a-z0-9.]+)/gi)).map((match) => match[1]),
      resolved: false,
      createdAt: new Date().toISOString(),
      replies: [],
      ...target,
    };
    bookRepo.addComment(comment);
    return comment;
  },
  resolveComment(id: ID, resolved = true) {
    return bookRepo.updateComment(id, { resolved });
  },
  replyToComment(id: ID, user: { id: ID; name: string }, body: string) {
    const comment = bookRepo.comments('').find((entry) => entry.id === id) ?? getDatabase().comments.find((entry) => entry.id === id);
    if (!comment) return undefined;
    return bookRepo.updateComment(id, {
      replies: [...comment.replies, { id: uid('rep'), userId: user.id, userName: user.name, body, createdAt: new Date().toISOString() }],
    });
  },
  removeComment(id: ID) {
    bookRepo.removeComment(id);
  },
  collaborators(bookId: ID): Collaborator[] {
    return bookRepo.collaborators(bookId);
  },
  async inviteCollaborator(bookId: ID, params: { email: string; role: Collaborator['role'] }): Promise<Collaborator> {
    await delay(400);
    const db = getDatabase();
    const existing = db.users.find((user) => user.email.toLowerCase() === params.email.toLowerCase());
    const collaborator: Collaborator = {
      id: uid('col'),
      bookId,
      userId: existing?.id ?? uid('user'),
      name: existing?.name ?? params.email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
      email: params.email,
      avatarUrl: existing?.avatarUrl ?? '',
      role: params.role,
      invitedAt: new Date().toISOString(),
      status: existing ? 'active' : 'pending',
    };
    bookRepo.addCollaborator(collaborator);
    return collaborator;
  },
  updateCollaborator(id: ID, patch: Partial<Collaborator>) {
    return bookRepo.updateCollaborator(id, patch);
  },
  removeCollaborator(id: ID) {
    bookRepo.removeCollaborator(id);
  },
  notes(bookId: ID) {
    return bookRepo.notes(bookId);
  },
  addNote(bookId: ID, title: string, body: string, color = 'amber') {
    return bookRepo.addNote({ id: uid('note'), bookId, title, body, color, createdAt: new Date().toISOString() });
  },
  removeNote(id: ID) {
    bookRepo.removeNote(id);
  },
  memory(bookId: ID): MemoryEntry[] {
    return bookRepo.memory(bookId);
  },
  addMemory(bookId: ID, entry: Pick<MemoryEntry, 'type' | 'name' | 'detail' | 'tags'>) {
    const memory: MemoryEntry = { id: uid('mem'), bookId, updatedAt: new Date().toISOString(), ...entry };
    return bookRepo.addMemory(memory);
  },
  updateMemory(id: ID, patch: Partial<MemoryEntry>) {
    return bookRepo.updateMemory(id, patch);
  },
  removeMemory(id: ID) {
    bookRepo.removeMemory(id);
  },
  versions(bookId: ID): VersionEntry[] {
    return bookRepo.versions(bookId);
  },
  createVersion(bookId: ID, user: { id: ID; name: string }, label: string, detail: string) {
    const book = bookRepo.find(bookId);
    if (!book) return undefined;
    const version: VersionEntry = {
      id: uid('ver'),
      bookId,
      userId: user.id,
      userName: user.name,
      label,
      detail,
      createdAt: new Date().toISOString(),
      kind: 'manual',
      snapshot: {
        title: book.title,
        pageCount: book.pageCount,
        wordCount: book.wordCount,
        sections: JSON.parse(JSON.stringify(book.sections)),
        pages: JSON.parse(JSON.stringify(book.pages)),
        cover: JSON.parse(JSON.stringify(book.cover)),
      },
    };
    return bookRepo.addVersion(version);
  },
  restoreVersion(versionId: ID) {
    const version = bookRepo.findVersion(versionId);
    if (!version) return undefined;
    return bookRepo.update(version.bookId, {
      sections: JSON.parse(JSON.stringify(version.snapshot.sections)),
      pages: JSON.parse(JSON.stringify(version.snapshot.pages)),
      cover: JSON.parse(JSON.stringify(version.snapshot.cover)),
      title: version.snapshot.title,
      wordCount: version.snapshot.wordCount,
      pageCount: version.snapshot.pageCount,
      updatedAt: new Date().toISOString(),
    });
  },
  updateCover(bookId: ID, patch: Partial<Book['cover']>) {
    const book = bookRepo.find(bookId);
    if (!book) return undefined;
    return bookRepo.update(bookId, { cover: { ...book.cover, ...patch } });
  },
  async generateCoverArt(bookId: ID, paletteId: string, styleIndex: number) {
    const book = bookRepo.find(bookId);
    if (!book) return undefined;
    await delay(500);
    const url = coverArtUrl({ seed: `${book.id}-${styleIndex}-${Date.now()}`, paletteId, title: book.title, author: book.authorName });
    return bookRepo.update(bookId, {
      cover: { ...book.cover, imageUrl: url, style: `style-${styleIndex}` },
    });
  },
  texture(pattern: string, color: string) {
    return patternUrl(pattern, color);
  },
  async applyThemeToAllPages(bookId: ID, paletteId: string) {
    await delay(300);
    const book = bookRepo.find(bookId);
    if (!book) return undefined;
    return bookRepo.update(bookId, { theme: { ...book.theme, palette: paletteId } });
  },
  seedAssetUrl(index: number) {
    return seedAssetUrls[index % seedAssetUrls.length];
  },
  mutate<T>(fn: (db: ReturnType<typeof getDatabase>) => T) {
    return mutateDatabase(fn);
  },
  slug: slugify,
};

function toRomanLower(value: number) {
  const pairs: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let remaining = value;
  let output = '';
  pairs.forEach(([number, symbol]) => {
    while (remaining >= number) {
      output += symbol;
      remaining -= number;
    }
  });
  return output;
}
