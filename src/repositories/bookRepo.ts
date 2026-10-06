import type {
  Book,
  BookPage,
  BookSection,
  Collaborator,
  Comment,
  ID,
  MemoryEntry,
  VersionEntry,
} from '@/types/domain';
import { getDatabase, mutateDatabase } from '@/store/db';
import { recalculateBook } from '@/data/bookFactory';
import { countWords, uid } from '@/lib/utils';

export interface BookListFilters {
  ownerId?: ID;
  status?: Book['status'] | 'all';
  visibility?: Book['visibility'] | 'all';
  kind?: Book['kind'] | 'all';
  query?: string;
  categoryIds?: ID[];
  sort?: 'recent' | 'created' | 'title' | 'words' | 'pages';
  starredOnly?: boolean;
}

export const bookRepo = {
  all(): Book[] {
    return getDatabase().books;
  },
  find(id: ID | undefined): Book | undefined {
    if (!id) return undefined;
    return getDatabase().books.find((book) => book.id === id);
  },
  list(filters: BookListFilters = {}): Book[] {
    const db = getDatabase();
    let books = db.books.slice();

    if (filters.ownerId) books = books.filter((book) => book.ownerId === filters.ownerId);
    if (filters.status && filters.status !== 'all') {
      if (filters.status === 'draft') books = books.filter((book) => book.status === 'draft' || book.status === 'in_review');
      else books = books.filter((book) => book.status === filters.status);
    }
    if (filters.visibility && filters.visibility !== 'all') books = books.filter((book) => book.visibility === filters.visibility);
    if (filters.kind && filters.kind !== 'all') books = books.filter((book) => book.kind === filters.kind);
    if (filters.starredOnly) books = books.filter((book) => book.starred);
    if (filters.categoryIds?.length) books = books.filter((book) => book.categoryIds.some((id) => filters.categoryIds?.includes(id)));
    if (filters.query) {
      const query = filters.query.toLowerCase();
      books = books.filter(
        (book) =>
          book.title.toLowerCase().includes(query) ||
          book.subtitle.toLowerCase().includes(query) ||
          book.authorName.toLowerCase().includes(query) ||
          book.tags.some((tag) => tag.includes(query)),
      );
    }

    switch (filters.sort) {
      case 'created':
        books.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        break;
      case 'title':
        books.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'words':
        books.sort((a, b) => b.wordCount - a.wordCount);
        break;
      case 'pages':
        books.sort((a, b) => b.pageCount - a.pageCount);
        break;
      default:
        books.sort((a, b) => ((a.updatedAt ?? '') < (b.updatedAt ?? '') ? 1 : -1));
    }
    return books;
  },
  create(book: Book): Book {
    return mutateDatabase((db) => {
      db.books = [book, ...db.books];
      return book;
    });
  },
  update(id: ID, patch: Partial<Book>): Book | undefined {
    return mutateDatabase((db) => {
      const index = db.books.findIndex((book) => book.id === id);
      if (index === -1) return undefined;
      db.books[index] = { ...db.books[index], ...patch, updatedAt: new Date().toISOString() };
      return db.books[index];
    });
  },
  /** Recalculate derived counts and persist a page-level change. */
  updatePage(bookId: ID, pageId: ID, patch: Partial<BookPage>): Book | undefined {
    return mutateDatabase((db) => {
      const book = db.books.find((entry) => entry.id === bookId);
      if (!book) return undefined;
      const pageIndex = book.pages.findIndex((page) => page.id === pageId);
      if (pageIndex === -1) return undefined;
      const next = { ...book.pages[pageIndex], ...patch, updatedAt: new Date().toISOString() };
      if (patch.content !== undefined) next.wordCount = countWords(patch.content);
      book.pages[pageIndex] = next;
      recalculateBook(book);
      book.updatedAt = new Date().toISOString();
      return book;
    });
  },
  addPage(bookId: ID, sectionId: ID, page: BookPage, index?: number): Book | undefined {
    return mutateDatabase((db) => {
      const book = db.books.find((entry) => entry.id === bookId);
      if (!book) return undefined;
      const section = book.sections.find((entry) => entry.id === sectionId);
      if (!section) return undefined;
      const pages = [...book.pages];
      const anchor = section.pageIds[index ?? section.pageIds.length];
      const insertAt = anchor ? pages.findIndex((entry) => entry.id === anchor) : pages.length;
      if (insertAt === -1) pages.push(page);
      else pages.splice(insertAt, 0, page);
      book.pages = pages;
      recalculateBook(book);
      return book;
    });
  },
  removePage(bookId: ID, pageId: ID): Book | undefined {
    return mutateDatabase((db) => {
      const book = db.books.find((entry) => entry.id === bookId);
      if (!book) return undefined;
      book.pages = book.pages.filter((page) => page.id !== pageId);
      recalculateBook(book);
      return book;
    });
  },
  reorderPages(bookId: ID, orderedPageIds: ID[]): Book | undefined {
    return mutateDatabase((db) => {
      const book = db.books.find((entry) => entry.id === bookId);
      if (!book) return undefined;
      const lookup = new Map(book.pages.map((page) => [page.id, page]));
      const next = orderedPageIds.map((id) => lookup.get(id)).filter(Boolean) as BookPage[];
      book.pages.forEach((page) => {
        if (!orderedPageIds.includes(page.id)) next.push(page);
      });
      book.pages = next;
      recalculateBook(book);
      return book;
    });
  },
  addSection(bookId: ID, section: BookSection): Book | undefined {
    return mutateDatabase((db) => {
      const book = db.books.find((entry) => entry.id === bookId);
      if (!book) return undefined;
      book.sections = [...book.sections, { ...section, order: book.sections.length }];
      recalculateBook(book);
      return book;
    });
  },
  updateSection(bookId: ID, sectionId: ID, patch: Partial<BookSection>): Book | undefined {
    return mutateDatabase((db) => {
      const book = db.books.find((entry) => entry.id === bookId);
      if (!book) return undefined;
      const index = book.sections.findIndex((entry) => entry.id === sectionId);
      if (index === -1) return undefined;
      book.sections[index] = { ...book.sections[index], ...patch };
      recalculateBook(book);
      return book;
    });
  },
  removeSection(bookId: ID, sectionId: ID): Book | undefined {
    return mutateDatabase((db) => {
      const book = db.books.find((entry) => entry.id === bookId);
      if (!book) return undefined;
      book.sections = book.sections.filter((section) => section.id !== sectionId);
      book.pages = book.pages.filter((page) => page.sectionId !== sectionId);
      recalculateBook(book);
      return book;
    });
  },
  reorderSections(bookId: ID, orderedIds: ID[]): Book | undefined {
    return mutateDatabase((db) => {
      const book = db.books.find((entry) => entry.id === bookId);
      if (!book) return undefined;
      const lookup = new Map(book.sections.map((section) => [section.id, section]));
      const ordered = orderedIds.map((id) => lookup.get(id)).filter(Boolean) as BookSection[];
      book.sections.forEach((section) => {
        if (!orderedIds.includes(section.id)) ordered.push(section);
      });
      book.sections = ordered.map((section, index) => ({ ...section, order: index }));
      recalculateBook(book);
      return book;
    });
  },
  remove(id: ID) {
    return mutateDatabase((db) => {
      db.books = db.books.filter((book) => book.id !== id);
      db.versions = db.versions.filter((version) => version.bookId !== id);
      db.comments = db.comments.filter((comment) => comment.bookId !== id);
      db.collaborators = db.collaborators.filter((collaborator) => collaborator.bookId !== id);
      db.notes = db.notes.filter((note) => note.bookId !== id);
      db.exports = db.exports.filter((job) => job.bookId !== id);
    });
  },
  // ------------------------------------------------------------- versions
  versions(bookId: ID): VersionEntry[] {
    return getDatabase()
      .versions.filter((version) => version.bookId === bookId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  addVersion(version: VersionEntry) {
    return mutateDatabase((db) => {
      db.versions = [version, ...db.versions];
      return version;
    });
  },
  findVersion(id: ID) {
    return getDatabase().versions.find((version) => version.id === id);
  },
  // ------------------------------------------------------------- comments
  comments(bookId: ID): Comment[] {
    return getDatabase()
      .comments.filter((comment) => comment.bookId === bookId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  addComment(comment: Comment) {
    return mutateDatabase((db) => {
      db.comments = [comment, ...db.comments];
      return comment;
    });
  },
  updateComment(id: ID, patch: Partial<Comment>) {
    return mutateDatabase((db) => {
      const index = db.comments.findIndex((comment) => comment.id === id);
      if (index === -1) return undefined;
      db.comments[index] = { ...db.comments[index], ...patch };
      return db.comments[index];
    });
  },
  removeComment(id: ID) {
    return mutateDatabase((db) => {
      db.comments = db.comments.filter((comment) => comment.id !== id);
    });
  },
  // -------------------------------------------------------- collaborators
  collaborators(bookId: ID): Collaborator[] {
    return getDatabase().collaborators.filter((collaborator) => collaborator.bookId === bookId);
  },
  collaboratorsForUser(userId: ID): Collaborator[] {
    return getDatabase().collaborators.filter((collaborator) => collaborator.userId === userId);
  },
  addCollaborator(collaborator: Collaborator) {
    return mutateDatabase((db) => {
      db.collaborators = [...db.collaborators, collaborator];
      return collaborator;
    });
  },
  updateCollaborator(id: ID, patch: Partial<Collaborator>) {
    return mutateDatabase((db) => {
      const index = db.collaborators.findIndex((collaborator) => collaborator.id === id);
      if (index === -1) return undefined;
      db.collaborators[index] = { ...db.collaborators[index], ...patch };
      return db.collaborators[index];
    });
  },
  removeCollaborator(id: ID) {
    return mutateDatabase((db) => {
      db.collaborators = db.collaborators.filter((collaborator) => collaborator.id !== id);
    });
  },
  // --------------------------------------------------------------- notes
  notes(bookId: ID) {
    return getDatabase().notes.filter((note) => note.bookId === bookId);
  },
  addNote(note: { id: ID; bookId: ID; title: string; body: string; color: string; createdAt: string; sectionId?: ID }) {
    return mutateDatabase((db) => {
      db.notes = [note, ...db.notes];
      return note;
    });
  },
  removeNote(id: ID) {
    return mutateDatabase((db) => {
      db.notes = db.notes.filter((note) => note.id !== id);
    });
  },
  // ---------------------------------------------------------- book memory
  memory(bookId: ID): MemoryEntry[] {
    return getDatabase().memory.filter((entry) => entry.bookId === bookId);
  },
  addMemory(entry: MemoryEntry) {
    return mutateDatabase((db) => {
      db.memory = [entry, ...db.memory];
      return entry;
    });
  },
  updateMemory(id: ID, patch: Partial<MemoryEntry>) {
    return mutateDatabase((db) => {
      const index = db.memory.findIndex((entry) => entry.id === id);
      if (index === -1) return undefined;
      db.memory[index] = { ...db.memory[index], ...patch };
      return db.memory[index];
    });
  },
  removeMemory(id: ID) {
    return mutateDatabase((db) => {
      db.memory = db.memory.filter((entry) => entry.id !== id);
    });
  },
  emptyPage(bookId: ID, sectionId: ID, title = 'Untitled page'): BookPage {
    const now = new Date().toISOString();
    return {
      id: uid('pg'),
      sectionId,
      title,
      layout: 'flow',
      content: '<p></p>',
      elements: [],
      background: { type: 'none', value: '#ffffff' },
      numbering: 'inherit',
      locked: false,
      notes: '',
      wordCount: 0,
      updatedAt: now,
      atomic: false,
    };
  },
};
