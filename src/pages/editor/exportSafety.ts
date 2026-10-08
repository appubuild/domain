import type { Book, BookPage } from '@/types/domain';
import { flowContextFor, inspectPage, measureFlow, pageTextColumn } from './flow';

/**
 * Export safety — one pass over the real document model that both the editor and
 * the exporter share. Nothing here is a duplicate of the preflight service: the
 * preflight validates files, metadata, fonts and profiles, while this validates
 * the *layout* the reader will see (overflow, safe area, missing art, empty pages).
 */

export type SafetyLevel = 'error' | 'warning' | 'info';

export interface SafetyIssue {
  id: string;
  level: SafetyLevel;
  title: string;
  detail: string;
  pageId?: string;
  pageNumber?: number;
}

export interface SafetyReport {
  issues: SafetyIssue[];
  errors: number;
  warnings: number;
  /** True when the environment could not measure text (tests, SSR). */
  unmeasurable: boolean;
  checkedPages: number;
}

export function auditBook(book: Book): SafetyReport {
  const issues: SafetyIssue[] = [];
  let unmeasurable = false;
  const column = pageTextColumn(book);

  book.pages.forEach((page, index) => {
    const pageNumber = index + 1;

    // Text overflow — measured with the same engine the editor uses.
    if (page.layout === 'flow' || page.layout === 'title') {
      const metrics = inspectPage(book, page);
      if (metrics.unmeasurable) unmeasurable = true;
      if (metrics.overflow) {
        issues.push({
          id: `overflow-${page.id}`,
          level: 'error',
          title: `Text overflows page ${pageNumber}`,
          detail: `Content is ${Math.round(metrics.overflowRatio * 100)}% taller than the text column. Use “Continue on a new page” in the editor, or shorten the page.`,
          pageId: page.id,
          pageNumber,
        });
      }
    }

    // Objects outside the safe area.
    page.elements
      .filter((element) => element.visible && element.type !== 'pageNumber')
      .forEach((element) => {
        const outside = element.x < -1 || element.y < -1 || element.x + element.w > 101 || element.y + element.h > 101;
        if (outside) {
          issues.push({
            id: `outside-${element.id}`,
            level: 'warning',
            title: `“${element.name}” sits outside the safe area`,
            detail: `On page ${pageNumber} the object extends past the trim. Print may clip it; the bleed area tolerates a small overhang.`,
            pageId: page.id,
            pageNumber,
          });
        }
        if (element.type === 'image' && !element.image?.src) {
          issues.push({
            id: `missing-${element.id}`,
            level: 'warning',
            title: `Missing image on page ${pageNumber}`,
            detail: `“${element.name}” has no image file attached, so it will export as an empty frame.`,
            pageId: page.id,
            pageNumber,
          });
        }
      });

    // Empty pages: fine in the middle of blank-page inserts, a warning otherwise.
    const empty = (page.layout === 'flow' || page.layout === 'title') && !(page.content ?? '').replace(/<[^>]+>/g, '').trim() && page.elements.length === 0;
    if (empty && index !== 0 && index !== book.pages.length - 1) {
      issues.push({
        id: `empty-${page.id}`,
        level: 'info',
        title: `Page ${pageNumber} is empty`,
        detail: 'Blank pages are legitimate between chapters. Remove it if it was accidental.',
        pageId: page.id,
        pageNumber,
      });
    }
  });

  // Footnotes pointing at removed pages would print unattached.
  (book.footnotes ?? []).forEach((footnote) => {
    if (!book.pages.some((page) => page.id === footnote.pageId)) {
      issues.push({
        id: `note-${footnote.id}`,
        level: 'warning',
        title: `Note ${footnote.number} lost its page`,
        detail: 'The note survived a page deletion, so it would not appear in the book. Delete it or attach it to a page again.',
      });
    }
  });

  // Images without any text wrap set can silently cover prose.
  book.pages.forEach((page, index) => {
    page.elements.filter((element) => element.visible && element.type === 'image' && (element.wrap ?? 'square') === 'none').forEach((element) => {
      const overlaps = page.content ? true : false;
      if (overlaps) {
        issues.push({
          id: `wrap-${element.id}`,
          level: 'info',
          title: `“${element.name}” does not wrap text`,
          detail: `Page ${index + 1} has both prose and a no-wrap image. That is intentional for full-bleed art, but check the two do not collide.`,
          pageId: page.id,
          pageNumber: index + 1,
        });
      }
    });
  });

  // Spine sanity for print.
  const spineIn = (book.pageCount || book.pages.length) * 0.0025;
  if (Number(book.cover?.spineWidthOverride ?? 0) > 0 && Math.abs(Number(book.cover.spineWidthOverride) - spineIn) > 0.12) {
    issues.push({
      id: 'spine-override',
      level: 'info',
      title: 'Spine width is manually overridden',
      detail: `The printed spine for ${book.pageCount || book.pages.length} pages would be about ${spineIn.toFixed(3)}″; the override is ${Number(book.cover.spineWidthOverride).toFixed(3)}″.`,
    });
  }

  return {
    issues,
    errors: issues.filter((issue) => issue.level === 'error').length,
    warnings: issues.filter((issue) => issue.level === 'warning').length,
    unmeasurable,
    checkedPages: book.pages.length,
  };
}

/** Height of a page's text column, exposed so callers can reason about capacity. */
export function capacityFor(book: Book, page: BookPage) {
  const column = pageTextColumn(book);
  const context = flowContextFor(book, page);
  return { column, context, used: measureFlow(page.content ?? '', context) };
}
