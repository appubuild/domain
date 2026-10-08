import type { Book, BookCanvasPrefs, BookPage, PageElement } from '@/types/domain';
import { DEFAULT_TEXT_STYLES } from '@/pages/editor/textStyles';

/**
 * Schema migration for data that was persisted before a field existed.
 *
 * The mock database is saved to localStorage, so a book written by an older build
 * simply has no `canvas`, `footnotes` or `textStyles` key. Reading `book.canvas.x`
 * then throws and the whole editor screen fails. Migration runs once, at hydrate
 * time, in the data layer — screens keep the simple contract "a Book always has a
 * canvas", and nothing in the UI needs defensive `?.` sprinkled through it.
 *
 * Rules:
 *  - only fill what is missing; never overwrite a value the author already set;
 *  - never touch ids, ordering or content;
 *  - return a count so the caller can log/verify without guessing.
 */

export const DEFAULT_CANVAS_PREFS: BookCanvasPrefs = {
  snapToGrid: false,
  gridSize: 1,
  snapToObjects: true,
  showGuides: true,
  showRulers: true,
  showSafeArea: false,
  showBleed: false,
  showCentreGuide: true,
  showBaselineGrid: false,
  virtualizeAfter: 40,
  collapsedSections: [],
};

export function canvasPrefs(book: Pick<Book, 'canvas'> | undefined): BookCanvasPrefs {
  return { ...DEFAULT_CANVAS_PREFS, ...(book?.canvas ?? {}) };
}

function migratePage(page: BookPage): { page: BookPage; changed: boolean } {
  let changed = false;
  const next: BookPage = { ...page };
  if (!Array.isArray(next.elements)) {
    next.elements = [];
    changed = true;
  } else {
    const elements = next.elements.map((element) => {
      if (!element || typeof element !== 'object') {
        changed = true;
        return { id: `el_${Math.random().toString(36).slice(2, 9)}`, type: 'text', name: 'Recovered element', x: 10, y: 10, w: 30, h: 10, rotation: 0, visible: true, locked: false } as PageElement;
      }
      if (typeof element.visible !== 'boolean' || typeof element.locked !== 'boolean') {
        changed = true;
        return { ...element, visible: element.visible ?? true, locked: element.locked ?? false };
      }
      return element;
    });
    if (changed) next.elements = elements;
  }
  if (typeof next.wordCount !== 'number') {
    next.wordCount = 0;
    changed = true;
  }
  return { page: next, changed };
}

export function migrateBook(book: Book): { book: Book; changed: boolean } {
  let changed = false;
  const next: Book = { ...book };

  if (!next.canvas || typeof next.canvas !== 'object') {
    next.canvas = { ...DEFAULT_CANVAS_PREFS };
    changed = true;
  } else {
    const canvas = canvasPrefs(next);
    if (Object.keys(canvas).length !== Object.keys(next.canvas).length) {
      next.canvas = canvas;
      changed = true;
    }
  }

  if (!Array.isArray(next.footnotes)) {
    next.footnotes = [];
    changed = true;
  }

  if (!Array.isArray(next.textStyles) || next.textStyles.length === 0) {
    // Styles follow the book's fonts until the author edits them.
    next.textStyles = DEFAULT_TEXT_STYLES.map((style) => ({
      ...style,
      fontFamily: style.fontFamily === 'Inter' ? 'Inter' : style.appliesTo === 'heading' || style.appliesTo === 'title' ? next.fonts?.heading ?? style.fontFamily : next.fonts?.body ?? style.fontFamily,
    }));
    changed = true;
  }

  if (!next.theme || typeof next.theme !== 'object') {
    changed = true;
    next.theme = {
      palette: 'ink',
      accentColor: '#6366f1',
      headingFont: next.fonts?.heading ?? 'Playfair Display',
      bodyFont: next.fonts?.body ?? 'Source Serif 4',
      headingScale: 1.25,
      dropCaps: true,
      chapterStartsRecto: true,
      paragraphIndent: 0.25,
      paragraphSpacing: 0,
      lineHeight: 1.55,
      widowControl: true,
      orphanControl: true,
    } as Book['theme'];
  } else if (next.theme.widowControl === undefined || next.theme.orphanControl === undefined) {
    next.theme = { ...next.theme, widowControl: next.theme.widowControl ?? true, orphanControl: next.theme.orphanControl ?? true };
    changed = true;
  }

  if (!next.cover || typeof next.cover !== 'object') {
    changed = true;
    next.cover = {
      style: 'classic',
      backgroundColor: '#111827',
      gradient: '',
      imageUrl: '',
      titleFont: next.fonts?.heading ?? 'Playfair Display',
      subtitleFont: next.fonts?.body ?? 'Source Serif 4',
      authorFont: next.fonts?.body ?? 'Source Serif 4',
      titleColor: '#ffffff',
      subtitleColor: '#e5e7eb',
      authorColor: '#e5e7eb',
      titleSize: 34,
      layout: 'classic',
      spineText: next.title ?? '',
      backText: next.description ?? '',
      showBarcode: true,
      barcodeIsbn: '',
      tagline: '',
      elements: [],
    } as Book['cover'];
  }

  if (Array.isArray(next.pages)) {
    let pagesChanged = false;
    const pages = next.pages.map((page) => {
      const result = migratePage(page);
      pagesChanged = pagesChanged || result.changed;
      return result.page;
    });
    if (pagesChanged) {
      next.pages = pages;
      changed = true;
    }
  } else {
    next.pages = [];
    changed = true;
  }

  if (!Array.isArray(next.sections)) {
    next.sections = [];
    changed = true;
  }

  return { book: next, changed };
}

/** Migrate a whole database payload in place-safe fashion. */
export function migrateDatabase(database: { books?: Book[] } & Record<string, unknown>): { database: typeof database; migratedBooks: number } {
  if (!Array.isArray(database.books)) return { database, migratedBooks: 0 };
  let migratedBooks = 0;
  const books = database.books.map((book) => {
    const result = migrateBook(book);
    if (result.changed) migratedBooks += 1;
    return result.book;
  });
  return { database: { ...database, books }, migratedBooks };
}
