import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { bookService } from '@/services';
import { countWords, uid } from '@/lib/utils';
import { flowPage, titlePage } from '@/data/bookFactory';
import { flowContextFor, pageTextColumn, planSpill, splitAtBlock } from './flow';
import type { Book, BookPage, BookSection, Footnote, ID, PageElement, SectionKind, VersionEntry } from '@/types/domain';

export type SaveStatus = 'saved' | 'saving' | 'dirty' | 'error';
export type EditorMode = 'write' | 'design' | 'preview' | 'cover';

export interface EditorProject {
  book: Book | undefined;
  loading: boolean;
  error: string | null;
  status: SaveStatus;
  lastSavedAt: string | null;
  dirty: boolean;
  mode: EditorMode;
  setMode: (mode: EditorMode) => void;
  activePageId: ID | null;
  setActivePageId: (id: ID | null) => void;
  selectedElementId: ID | null;
  selectElement: (id: ID | null) => void;
  /** Shared-state mutations — every mode reads from the same book object. */
  patchBook: (patch: Partial<Book>, options?: { history?: boolean }) => void;
  patchPage: (pageId: ID, patch: Partial<BookPage>, options?: { history?: boolean }) => void;
  patchPages: (updater: (pages: BookPage[]) => BookPage[], options?: { history?: boolean }) => void;
  patchElement: (pageId: ID, elementId: ID, patch: Partial<PageElement>, options?: { history?: boolean; transient?: boolean }) => void;
  addElement: (pageId: ID, element: PageElement) => ID;
  removeElement: (pageId: ID, elementId: ID) => void;
  duplicateElement: (pageId: ID, elementId: ID) => void;
  reorderElement: (pageId: ID, elementId: ID, direction: 'up' | 'down' | 'front' | 'back') => void;
  addPage: (sectionId: ID, layout?: BookPage['layout']) => BookPage | undefined;
  /** Insert a page directly before / after another page, in the same section. */
  insertPage: (pageId: ID, position: 'before' | 'after', layout?: BookPage['layout']) => BookPage | undefined;
  duplicatePage: (pageId: ID) => void;
  removePage: (pageId: ID) => void;
  reorderPages: (orderedIds: ID[]) => void;
  movePage: (pageId: ID, direction: 'up' | 'down') => void;
  movePageToSection: (pageId: ID, sectionId: ID) => void;
  /** Split a flow page in two at a content block index (page-break control + auto flow). */
  splitPageContent: (pageId: ID, blockIndex: number, options?: { keepTogether?: boolean }) => void;
  /** Paginate the page's own content with the flow engine and spill the remainder on. */
  autoFlowPage: (pageId: ID) => void;
  addSection: (title: string, kind?: SectionKind) => BookSection | undefined;
  patchSection: (sectionId: ID, patch: Partial<BookSection>) => void;
  duplicateSection: (sectionId: ID) => void;
  moveSection: (sectionId: ID, direction: 'up' | 'down') => void;
  /** Section whose pages are currently collapsed in the chapter panel. */
  collapsedSections: ID[];
  toggleSectionCollapsed: (sectionId: ID) => void;
  removeSection: (sectionId: ID) => void;
  reorderSections: (orderedIds: ID[]) => void;
  splitSection: (pageId: ID) => void;
  generateToc: () => { title: string; page: number }[];
  /** Footnotes/endnotes, numbered sequentially on every mutation. */
  addFootnote: (pageId: ID, text: string, kind?: 'footnote' | 'endnote') => ID | undefined;
  patchFootnote: (footnoteId: ID, patch: Partial<Footnote>) => void;
  removeFootnote: (footnoteId: ID) => void;
  footnotesForPage: (pageId: ID) => Footnote[];
  applyThemeToAllPages: (paletteId: string) => Promise<void>;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  saveNow: () => Promise<void>;
  versions: VersionEntry[];
  createCheckpoint: (label: string, detail: string, kind?: VersionEntry['kind']) => void;
  restoreVersion: (versionId: ID) => void;
}

const HISTORY_LIMIT = 60;

function recompute(book: Book): Book {
  const pages = book.pages;
  const wordCount = pages.reduce((total, page) => total + (page.layout === 'flow' ? countWords(page.content) : 0), 0);
  const sections = book.sections.map((section) => ({
    ...section,
    wordCount: section.pageIds.reduce((total, pageId) => {
      const page = pages.find((entry) => entry.id === pageId);
      return total + (page ? (page.layout === 'flow' ? countWords(page.content) : 0) : 0);
    }, 0),
  }));
  return { ...book, pages, sections, wordCount, pageCount: pages.length };
}

/** Loads a book into editor state with debounced autosave, undo/redo and version checkpoints. */
export function useEditorProject(bookId: string | undefined): EditorProject {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [project, setProject] = React.useState<Book | undefined>(() => (bookId ? bookService.get(bookId) : undefined));
  const [loading, setLoading] = React.useState(!project);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<SaveStatus>('saved');
  const [lastSavedAt, setLastSavedAt] = React.useState<string | null>(null);
  const [mode, setModeState] = React.useState<EditorMode>('write');
  const [activePageId, setActivePageIdState] = React.useState<ID | null>(null);
  const [selectedElementId, setSelectedElementId] = React.useState<ID | null>(null);
  const [versions, setVersions] = React.useState<VersionEntry[]>(() => (bookId ? bookService.versions(bookId) : []));

  const projectRef = React.useRef(project);
  projectRef.current = project;
  const past = React.useRef<Book[]>([]);
  const future = React.useRef<Book[]>([]);
  const lastHistoryPush = React.useRef(0);
  const saveTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const dirtyRef = React.useRef(false);
  const [historyTick, setHistoryTick] = React.useState(0);

  React.useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    setLoading(true);
    bookService
      .getAsync(bookId)
      .then((book) => {
        if (cancelled) return;
        bookService.touch(book.id);
        setProject(book);
        setActivePageIdState((current) => current ?? book.pages[0]?.id ?? null);
        setVersions(bookService.versions(book.id));
        setLoading(false);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  /** Persists the current draft through the service layer. */
  const persist = React.useCallback(async (book: Book) => {
    if (!bookId) return;
    setStatus('saving');
    try {
      await new Promise((resolve) => setTimeout(resolve, 260));
      bookService.update(book.id, {
        title: book.title,
        subtitle: book.subtitle,
        description: book.description,
        shortDescription: book.shortDescription,
        authorName: book.authorName,
        language: book.language,
        categoryIds: book.categoryIds,
        tags: book.tags,
        trimSize: book.trimSize,
        orientation: book.orientation,
        margins: book.margins,
        gutter: book.gutter,
        bleed: book.bleed,
        safeArea: book.safeArea,
        facingPages: book.facingPages,
        theme: book.theme,
        fonts: book.fonts,
        numbering: book.numbering,
        headerFooter: book.headerFooter,
        toc: book.toc,
        metadata: book.metadata,
        cover: book.cover,
        sections: book.sections,
        pages: book.pages,
        marketplace: book.marketplace,
        paperStock: book.paperStock,
        wordCount: book.wordCount,
        pageCount: book.pageCount,
      });
      dirtyRef.current = false;
      setStatus('saved');
      setLastSavedAt(new Date().toISOString());
      qc.invalidateQueries({ queryKey: ['book', bookId] });
      qc.invalidateQueries({ queryKey: ['books'] });
    } catch (e) {
      setStatus('error');
      throw e;
    }
  }, [bookId, qc]);

  /** Central mutation entry point: updates draft state, tracks history and schedules a save. */
  const commit = React.useCallback((updater: (book: Book) => Book, options: { history?: boolean; transient?: boolean } = {}) => {
    const current = projectRef.current;
    if (!current) return;
    const next = recompute(updater(current));
    if (next === current) return;
    const now = Date.now();
    if (options.history !== false && (options.transient === false || now - lastHistoryPush.current > 550)) {
      past.current = [...past.current.slice(-HISTORY_LIMIT), current];
      future.current = [];
      lastHistoryPush.current = now;
      setHistoryTick((tick) => tick + 1);
    }
    projectRef.current = next;
    setProject(next);
    dirtyRef.current = true;
    setStatus('dirty');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const draft = projectRef.current;
      if (draft && dirtyRef.current) void persist(draft);
    }, 900);
  }, [persist]);

  const saveNow = React.useCallback(async () => {
    const draft = projectRef.current;
    if (!draft) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await persist(draft);
  }, [persist]);

  // Flush pending edits when the editor unmounts so navigation never loses work.
  React.useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const draft = projectRef.current;
    if (draft && dirtyRef.current) {
      try {
        bookService.update(draft.id, {
          sections: draft.sections,
          pages: draft.pages,
          cover: draft.cover,
          theme: draft.theme,
          fonts: draft.fonts,
          margins: draft.margins,
          numbering: draft.numbering,
          headerFooter: draft.headerFooter,
          toc: draft.toc,
          trimSize: draft.trimSize,
          title: draft.title,
          subtitle: draft.subtitle,
          description: draft.description,
          metadata: draft.metadata,
          marketplace: draft.marketplace,
          wordCount: draft.wordCount,
          pageCount: draft.pageCount,
        });
      } catch {
        // keep silent — the debounced save already ran
      }
    }
  }, []);

  const pageById = React.useCallback((id: ID | null) => projectRef.current?.pages.find((page) => page.id === id), []);

  const projectApi = React.useMemo<EditorProject>(() => {
    const patchBook = (patch: Partial<Book>, options?: { history?: boolean }) =>
      commit((book) => ({ ...book, ...patch }), options);

    const patchPages = (updater: (pages: BookPage[]) => BookPage[], options?: { history?: boolean }) =>
      commit((book) => ({ ...book, pages: updater(book.pages) }), options);

    const patchPage = (pageId: ID, patch: Partial<BookPage>, options?: { history?: boolean }) =>
      commit(
        (book) => ({
          ...book,
          pages: book.pages.map((page) =>
            page.id === pageId
              ? {
                  ...page,
                  ...patch,
                  wordCount: patch.content !== undefined ? countWords(patch.content) : patch.wordCount ?? page.wordCount,
                  updatedAt: new Date().toISOString(),
                }
              : page,
          ),
        }),
        options,
      );

    const patchElement = (pageId: ID, elementId: ID, patch: Partial<PageElement>, options?: { history?: boolean; transient?: boolean }) =>
      commit(
        (book) => ({
          ...book,
          pages: book.pages.map((page) =>
            page.id === pageId
              ? { ...page, elements: page.elements.map((element) => (element.id === elementId ? { ...element, ...patch } : element)), updatedAt: new Date().toISOString() }
              : page,
          ),
        }),
        { history: options?.history, transient: options?.transient },
      );

    const addElement = (pageId: ID, element: PageElement) => {
      patchPages((pages) => pages.map((page) => (page.id === pageId ? { ...page, elements: [...page.elements, element] } : page)));
      setSelectedElementId(element.id);
      return element.id;
    };

    const removeElement = (pageId: ID, elementId: ID) => {
      patchPages((pages) => pages.map((page) => (page.id === pageId ? { ...page, elements: page.elements.filter((element) => element.id !== elementId) } : page)));
      setSelectedElementId((current) => (current === elementId ? null : current));
    };

    const duplicateElement = (pageId: ID, elementId: ID) => {
      const page = pageById(pageId);
      const element = page?.elements.find((entry) => entry.id === elementId);
      if (!element) return;
      const copy: PageElement = {
        ...element,
        id: uid('el'),
        name: `${element.name} copy`,
        x: Math.min(88, element.x + 4),
        y: Math.min(88, element.y + 4),
      };
      patchPages((pages) => pages.map((entry) => (entry.id === pageId ? { ...entry, elements: [...entry.elements, copy] } : entry)));
      setSelectedElementId(copy.id);
    };

    const reorderElement = (pageId: ID, elementId: ID, direction: 'up' | 'down' | 'front' | 'back') => {
      patchPages((pages) =>
        pages.map((page) => {
          if (page.id !== pageId) return page;
          const elements = [...page.elements].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
          const index = elements.findIndex((element) => element.id === elementId);
          if (index === -1) return page;
          if (direction === 'up' && index < elements.length - 1) {
            [elements[index], elements[index + 1]] = [elements[index + 1], elements[index]];
          } else if (direction === 'down' && index > 0) {
            [elements[index], elements[index - 1]] = [elements[index - 1], elements[index]];
          } else if (direction === 'front') {
            elements.push(elements.splice(index, 1)[0]);
          } else if (direction === 'back') {
            elements.unshift(elements.splice(index, 1)[0]);
          }
          return { ...page, elements: elements.map((element, order) => ({ ...element, z: order })) };
        }),
      );
    };

    const addPage = (sectionId: ID, layout: BookPage['layout'] = 'flow') => {
      const book = projectRef.current;
      const section = book?.sections.find((entry) => entry.id === sectionId);
      if (!book || !section) return undefined;
      const created = layout === 'flow'
        ? flowPage(sectionId, `New ${section.kind === 'chapter' ? 'chapter page' : 'page'}`, '', { atomic: false })
        : { ...flowPage(sectionId, 'New design page', '', { atomic: true }), layout };
      commit((current) => ({
        ...current,
        pages: [...current.pages, created],
        sections: current.sections.map((entry) => (entry.id === sectionId ? { ...entry, pageIds: [...entry.pageIds, created.id] } : entry)),
      }));
      setActivePageIdState(created.id);
      return created;
    };

    const duplicatePage = (pageId: ID) => {
      const page = pageById(pageId);
      if (!page) return;
      const copy: BookPage = { ...page, id: uid('pg'), title: `${page.title} copy`, elements: page.elements.map((element) => ({ ...element, id: uid('el') })), updatedAt: new Date().toISOString() };
      commit((book) => {
        const index = book.pages.findIndex((entry) => entry.id === pageId);
        const pages = [...book.pages];
        pages.splice(index + 1, 0, copy);
        return {
          ...book,
          pages,
          sections: book.sections.map((section) => {
            if (section.id !== page.sectionId) return section;
            const pageIds = [...section.pageIds];
            const at = pageIds.indexOf(pageId);
            pageIds.splice(at + 1, 0, copy.id);
            return { ...section, pageIds };
          }),
        };
      });
      setActivePageIdState(copy.id);
    };

    const insertPage = (pageId: ID, position: 'before' | 'after', layout: BookPage['layout'] = 'flow') => {
      const book = projectRef.current;
      const anchor = book?.pages.find((page) => page.id === pageId);
      if (!book || !anchor) return undefined;
      const page: BookPage = layout === 'title'
        ? titlePage(anchor.sectionId, anchor.title || 'Untitled section', 'Untitled section', book.theme.palette)
        : flowPage(anchor.sectionId, anchor.title ?? 'Untitled section', '');
      page.title = anchor.title ?? page.title;
      commit((current) => {
        const pages = [...current.pages];
        const at = pages.findIndex((entry) => entry.id === pageId);
        pages.splice(position === 'before' ? at : at + 1, 0, page);
        return {
          ...current,
          pages,
          sections: current.sections.map((section) => {
            if (section.id !== anchor.sectionId) return section;
            const pageIds = [...section.pageIds];
            const index = pageIds.indexOf(pageId);
            pageIds.splice(position === 'before' ? index : index + 1, 0, page.id);
            return { ...section, pageIds };
          }),
        };
      });
      setActivePageIdState(page.id);
      return page;
    };

    const movePage = (pageId: ID, direction: 'up' | 'down') => {
      commit((book) => {
        const pages = [...book.pages];
        const index = pages.findIndex((page) => page.id === pageId);
        const target = direction === 'up' ? index - 1 : index + 1;
        if (index < 0 || target < 0 || target >= pages.length) return book;
        [pages[index], pages[target]] = [pages[target], pages[index]];
        return { ...book, pages, sections: book.sections.map((section) => ({ ...section, pageIds: section.pageIds.slice().sort((a, b) => pages.findIndex((p) => p.id === a) - pages.findIndex((p) => p.id === b)) })) };
      });
    };

    const splitPageContent = (pageId: ID, blockIndex: number, options?: { keepTogether?: boolean }) => {
      const page = pageById(pageId);
      if (!page) return;
      const { head, tail } = splitAtBlock(page.content ?? '', blockIndex);
      if (!tail.trim()) return;
      const anchorTitle = page.title;
      const nextPage: BookPage = {
        ...flowPage(page.sectionId, anchorTitle, tail),
        breakBefore: false,
        continuationOf: options?.keepTogether ? page.id : (page.continuationOf ?? page.id),
        keepTogether: options?.keepTogether,
      };
      commit((book) => {
        const pages = [...book.pages];
        const at = pages.findIndex((entry) => entry.id === pageId);
        const updated: BookPage = {
          ...pages[at],
          content: head,
          wordCount: countWords(head),
          updatedAt: new Date().toISOString(),
          keepTogether: options?.keepTogether ?? pages[at].keepTogether,
        };
        pages[at] = updated;
        pages.splice(at + 1, 0, nextPage);
        return {
          ...book,
          pages,
          sections: book.sections.map((section) => {
            if (section.id !== page.sectionId) return section;
            const pageIds = [...section.pageIds];
            pageIds.splice(pageIds.indexOf(pageId) + 1, 0, nextPage.id);
            return { ...section, pageIds };
          }),
        };
      });
      setActivePageIdState(nextPage.id);
    };

    const autoFlowPage = (pageId: ID) => {
      const book = projectRef.current;
      const page = pageById(pageId);
      if (!book || !page) return;
      const column = pageTextColumn(book);
      const spill = planSpill(page.content ?? '', { availableHeight: column.heightPx, context: flowContextFor(book, page) });
      // No layout engine (tests / SSR) or nothing overflows: never invent a split.
      if (spill.unmeasurable || !spill.tail.trim()) return;
      const { head, tail } = spill;
      const nextPage: BookPage = { ...flowPage(page.sectionId, page.title, tail), continuationOf: page.continuationOf ?? page.id };
      commit((current) => {
        const pages = [...current.pages];
        const at = pages.findIndex((entry) => entry.id === pageId);
        pages[at] = { ...pages[at], content: head, wordCount: countWords(head), updatedAt: new Date().toISOString() };
        pages.splice(at + 1, 0, nextPage);
        return {
          ...current,
          pages,
          sections: current.sections.map((section) => {
            if (section.id !== page.sectionId) return section;
            const pageIds = [...section.pageIds];
            pageIds.splice(pageIds.indexOf(pageId) + 1, 0, nextPage.id);
            return { ...section, pageIds };
          }),
        };
      });
      setActivePageIdState(nextPage.id);
    };

    const removePage = (pageId: ID) => {
      commit((book) => ({
        ...book,
        pages: book.pages.filter((page) => page.id !== pageId),
        sections: book.sections.map((section) => ({ ...section, pageIds: section.pageIds.filter((id) => id !== pageId) })),
      }));
      setActivePageIdState((current) => {
        if (current !== pageId) return current;
        const pages = projectRef.current?.pages ?? [];
        const index = pages.findIndex((page) => page.id === pageId);
        return pages[index + 1]?.id ?? pages[index - 1]?.id ?? null;
      });
    };

    const reorderPages = (orderedIds: ID[]) => {
      commit((book) => {
        const map = new Map(book.pages.map((page) => [page.id, page]));
        const pages = orderedIds.map((id) => map.get(id)).filter(Boolean) as BookPage[];
        return {
          ...book,
          pages: [...pages, ...book.pages.filter((page) => !orderedIds.includes(page.id))],
          sections: book.sections.map((section) => ({ ...section, pageIds: section.pageIds.slice().sort((a, b) => orderedIds.indexOf(a) - orderedIds.indexOf(b)) })),
        };
      });
    };

    const movePageToSection = (pageId: ID, sectionId: ID) => {
      commit((book) => ({
        ...book,
        pages: book.pages.map((page) => (page.id === pageId ? { ...page, sectionId } : page)),
        sections: book.sections.map((section) => ({
          ...section,
          pageIds: section.id === sectionId
            ? [...section.pageIds.filter((id) => id !== pageId), pageId]
            : section.pageIds.filter((id) => id !== pageId),
        })),
      }));
    };

    const addSection = (title: string, kind: SectionKind = 'chapter') => {
      const book = projectRef.current;
      if (!book) return undefined;
      const section: BookSection = {
        id: uid('sec'),
        bookId: book.id,
        kind,
        title: title || 'Untitled chapter',
        order: book.sections.length,
        pageIds: [],
        wordCount: 0,
        status: 'empty',
      };
      const first = kind === 'chapter' ? titlePage(section.id, section.title, `Chapter ${book.sections.filter((entry) => entry.kind === 'chapter').length + 1}`, book.theme.palette) : flowPage(section.id, section.title, '');
      section.pageIds = [first.id];
      commit((current) => ({ ...current, sections: [...current.sections, section], pages: [...current.pages, first] }));
      setActivePageIdState(first.id);
      return section;
    };

    const patchSection = (sectionId: ID, patch: Partial<BookSection>) =>
      commit((book) => ({ ...book, sections: book.sections.map((section) => (section.id === sectionId ? { ...section, ...patch } : section)) }));

    const duplicateSection = (sectionId: ID) => {
      const book = projectRef.current;
      const section = book?.sections.find((entry) => entry.id === sectionId);
      if (!book || !section) return;
      const copyId = uid('sec');
      const pages = book.pages.filter((page) => page.sectionId === sectionId);
      const cloned: BookPage[] = pages.map((page) => ({ ...page, id: uid('page'), sectionId: copyId, elements: page.elements.map((element) => ({ ...element, id: uid('el') })) }));
      const copy: BookSection = { ...section, id: copyId, title: `${section.title} copy`, pageIds: cloned.map((page) => page.id), wordCount: cloned.reduce((total, page) => total + page.wordCount, 0) };
      commit((current) => {
        const sections = [...current.sections];
        const at = sections.findIndex((entry) => entry.id === sectionId);
        sections.splice(at + 1, 0, copy);
        const allPages = [...current.pages];
        const lastPageIndex = allPages.map((page) => page.sectionId).lastIndexOf(sectionId);
        allPages.splice(lastPageIndex + 1, 0, ...cloned);
        return { ...current, sections: sections.map((entry, index) => ({ ...entry, order: index })), pages: allPages };
      });
      if (cloned[0]) setActivePageIdState(cloned[0].id);
    };

    const moveSection = (sectionId: ID, direction: 'up' | 'down') => {
      commit((book) => {
        const sections = [...book.sections].sort((a, b) => a.order - b.order);
        const index = sections.findIndex((entry) => entry.id === sectionId);
        const target = direction === 'up' ? index - 1 : index + 1;
        if (index < 0 || target < 0 || target >= sections.length) return book;
        [sections[index], sections[target]] = [sections[target], sections[index]];
        const ordered = sections.map((entry, order) => ({ ...entry, order }));
        const pageOrder = ordered.flatMap((entry) => entry.pageIds);
        const pages = [...book.pages].sort((a, b) => pageOrder.indexOf(a.id) - pageOrder.indexOf(b.id));
        return { ...book, sections: ordered, pages };
      });
    };

    const toggleSectionCollapsed = (sectionId: ID) => {
      const canvas = projectRef.current?.canvas;
      if (!canvas) return;
      const current = canvas.collapsedSections ?? [];
      patchBook({ canvas: { ...canvas, collapsedSections: current.includes(sectionId) ? current.filter((id) => id !== sectionId) : [...current, sectionId] } });
    };

    const removeSection = (sectionId: ID) => {
      const section = projectRef.current?.sections.find((entry) => entry.id === sectionId);
      if (!section) return;
      commit((book) => ({
        ...book,
        sections: book.sections.filter((entry) => entry.id !== sectionId),
        pages: book.pages.filter((page) => !section.pageIds.includes(page.id)),
      }));
      setActivePageIdState((current) => (current && section.pageIds.includes(current) ? projectRef.current?.pages[0]?.id ?? null : current));
    };

    const reorderSections = (orderedIds: ID[]) =>
      commit((book) => ({
        ...book,
        sections: orderedIds
          .map((id, index) => {
            const section = book.sections.find((entry) => entry.id === id);
            return section ? { ...section, order: index } : undefined;
          })
          .filter(Boolean) as BookSection[],
      }));

    const splitSection = (pageId: ID) => {
      const book = projectRef.current;
      const page = book?.pages.find((entry) => entry.id === pageId);
      if (!book || !page) return;
      const section = book.sections.find((entry) => entry.id === page.sectionId);
      if (!section) return;
      const index = section.pageIds.indexOf(pageId);
      const head = section.pageIds.slice(0, index + 1);
      const tail = section.pageIds.slice(index + 1);
      const created: BookSection = {
        id: uid('sec'),
        bookId: book.id,
        kind: 'section',
        title: `${section.title} · part 2`,
        order: section.order + 0.5,
        pageIds: tail,
        wordCount: 0,
        status: 'drafting',
      };
      commit((current) => ({
        ...current,
        sections: [...current.sections.map((entry) => (entry.id === section.id ? { ...entry, pageIds: head } : entry)), created]
          .sort((a, b) => a.order - b.order)
          .map((entry, order) => ({ ...entry, order })),
        pages: current.pages.map((entry) => (tail.includes(entry.id) ? { ...entry, sectionId: created.id } : entry)),
      }));
    };

    const renumberFootnotes = (footnotes: Footnote[], pages: BookPage[]): Footnote[] => {
      const pageOrder = new Map(pages.map((page, index) => [page.id, index]));
      return [...footnotes]
        .sort((a, b) => (pageOrder.get(a.pageId) ?? 0) - (pageOrder.get(b.pageId) ?? 0) || a.number - b.number)
        .map((footnote, index) => ({ ...footnote, number: index + 1 }));
    };

    const addFootnote = (pageId: ID, text: string, kind: 'footnote' | 'endnote' = 'footnote') => {
      const book = projectRef.current;
      if (!book) return undefined;
      const footnote: Footnote = { id: uid('note'), bookId: book.id, pageId, number: (book.footnotes?.length ?? 0) + 1, text, kind, createdAt: new Date().toISOString() };
      commit((current) => ({ ...current, footnotes: renumberFootnotes([...(current.footnotes ?? []), footnote], current.pages) }));
      return footnote.id;
    };

    const patchFootnote = (footnoteId: ID, patch: Partial<Footnote>) =>
      commit((book) => ({ ...book, footnotes: (book.footnotes ?? []).map((footnote) => (footnote.id === footnoteId ? { ...footnote, ...patch } : footnote)) }));

    const removeFootnote = (footnoteId: ID) =>
      commit((book) => ({ ...book, footnotes: renumberFootnotes((book.footnotes ?? []).filter((footnote) => footnote.id !== footnoteId), book.pages) }));

    const footnotesForPage = (pageId: ID) => (projectRef.current?.footnotes ?? []).filter((footnote) => footnote.pageId === pageId).sort((a, b) => a.number - b.number);

    const generateToc = () => {
      const book = projectRef.current;
      if (!book) return [];
      const entries = book.sections
        .filter((section) => section.kind === 'chapter' || section.kind === 'part')
        .map((section) => {
          const firstPageId = section.pageIds[0];
          const pageIndex = book.pages.findIndex((page) => page.id === firstPageId);
          return { title: section.title, page: pageIndex + 1 };
        });
      const tocSection = book.sections.find((section) => section.kind === 'front-matter' && section.title.toLowerCase().includes('contents'));
      const content = `<h2>${book.toc.title || 'Table of Contents'}</h2><ul class="toc-list">${entries
        .map((entry) => `<li><span>${entry.title}</span><span>${book.toc.showPageNumbers ? entry.page : ''}</span></li>`)
        .join('')}</ul>`;
      if (tocSection) {
        const existing = book.pages.find((page) => tocSection.pageIds.includes(page.id) && page.title === 'Table of Contents');
        if (existing) {
          patchPage(existing.id, { content });
        } else {
          const page = flowPage(tocSection.id, 'Table of Contents', content);
          commit((current) => ({
            ...current,
            pages: [...current.pages, page],
            sections: current.sections.map((section) => (section.id === tocSection.id ? { ...section, pageIds: [page.id, ...section.pageIds] } : section)),
            toc: { ...current.toc, enabled: true },
          }));
        }
      } else {
        const section: BookSection = {
          id: uid('sec'),
          bookId: book.id,
          kind: 'front-matter',
          title: 'Table of Contents',
          order: 1,
          pageIds: [],
          wordCount: 0,
          status: 'complete',
        };
        const page = flowPage(section.id, 'Table of Contents', content);
        section.pageIds = [page.id];
        commit((current) => ({ ...current, sections: [...current.sections, section], pages: [...current.pages, page], toc: { ...current.toc, enabled: true } }));
      }
      return entries;
    };

    const applyThemeToAllPages = async (paletteId: string) => {
      const book = projectRef.current;
      if (!book) return;
      const updated = await bookService.applyThemeToAllPages(book.id, paletteId);
      if (updated) commit((current) => ({ ...current, theme: updated.theme, pages: updated.pages }), { history: true });
    };

    const undo = () => {
      const previous = past.current[past.current.length - 1];
      const current = projectRef.current;
      if (!previous || !current) return;
      past.current = past.current.slice(0, -1);
      future.current = [current, ...future.current].slice(0, HISTORY_LIMIT);
      projectRef.current = previous;
      setProject(previous);
      dirtyRef.current = true;
      setStatus('dirty');
      setHistoryTick((tick) => tick + 1);
    };

    const redo = () => {
      const next = future.current[0];
      const current = projectRef.current;
      if (!next || !current) return;
      future.current = future.current.slice(1);
      past.current = [...past.current, current].slice(-HISTORY_LIMIT);
      projectRef.current = next;
      setProject(next);
      dirtyRef.current = true;
      setStatus('dirty');
      setHistoryTick((tick) => tick + 1);
    };

    const createCheckpoint = (label: string, detail: string, kind: VersionEntry['kind'] = 'manual') => {
      const book = projectRef.current;
      if (!book) return;
      bookService.createVersion(book.id, { id: book.ownerId, name: book.authorName }, label, detail);
      setVersions(bookService.versions(book.id));
    };

    const restoreVersion = (versionId: ID) => {
      const restored = bookService.restoreVersion(versionId);
      if (restored) {
        commit(() => restored, { history: true });
        setVersions(bookService.versions(restored.id));
        setActivePageIdState(restored.pages[0]?.id ?? null);
      }
      qc.invalidateQueries({ queryKey: ['versions', bookId] });
    };

    return {
      book: project,
      loading,
      error,
      status,
      lastSavedAt,
      dirty: status === 'dirty' || status === 'saving',
      mode,
      setMode: (next) => {
        setModeState(next);
        setSelectedElementId(null);
      },
      activePageId,
      setActivePageId: setActivePageIdState,
      selectedElementId,
      selectElement: setSelectedElementId,
      patchBook,
      patchPage,
      patchPages,
      patchElement,
      addElement,
      removeElement,
      duplicateElement,
      reorderElement,
      addPage,
      insertPage,
      duplicatePage,
      removePage,
      reorderPages,
      movePage,
      movePageToSection,
      splitPageContent,
      autoFlowPage,
      addSection,
      patchSection,
      duplicateSection,
      moveSection,
      collapsedSections: project?.canvas.collapsedSections ?? [],
      toggleSectionCollapsed,
      removeSection,
      reorderSections,
      splitSection,
      generateToc,
      addFootnote,
      patchFootnote,
      removeFootnote,
      footnotesForPage,
      applyThemeToAllPages,
      undo,
      redo,
      canUndo: past.current.length > 0,
      canRedo: future.current.length > 0,
      saveNow,
      versions,
      createCheckpoint,
      restoreVersion,
    };
    // historyTick keeps canUndo/canRedo fresh after mutations outside React's state flow
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, loading, error, status, lastSavedAt, mode, activePageId, selectedElementId, versions, commit, saveNow, pageById, qc, bookId, historyTick]);

  void navigate;

  return projectApi;
}
