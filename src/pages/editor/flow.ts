/**
 * Book flow engine — pagination, overflow detection and text wrapping.
 *
 * The editor, the preview and the export pipeline all use this module, so what the
 * author sees on the canvas is what gets printed. It works on the same HTML that
 * ProseMirror produces (a flat list of block elements) plus the page's absolutely
 * positioned elements, which are rendered as floats when their wrap mode says so.
 *
 * Measurement is done in a real browser through a hidden mirror of the flow column.
 * When no layout engine is available (jsdom, SSR) every function degrades to a
 * "cannot measure" result instead of inventing page breaks.
 */
import type { Book, BookPage, ElementWrap, PageElement } from '@/types/domain';

export interface FlowMetrics {
  /** Height the content needs, in CSS pixels. */
  contentHeight: number;
  /** Height available inside the text column. */
  availableHeight: number;
  /** 0 when it fits, otherwise the fraction of a page that overflows. */
  overflowRatio: number;
  overflow: boolean;
  /** True when the browser could not measure (jsdom, headless without layout). */
  unmeasurable: boolean;
}

export interface PaginateResult {
  /** HTML chunks, one per page. */
  chunks: string[];
  metrics: FlowMetrics;
  unmeasurable: boolean;
}

const BLOCK_TAGS = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'BLOCKQUOTE', 'FIGURE', 'TABLE', 'HR', 'DIV', 'PRE'];

/** Wrap modes that let text flow beside an image. */
export const WRAPPING_MODES: ElementWrap[] = ['around', 'square', 'tight'];
/** Wrap modes where the image sits above/below the text instead of beside it. */
export const STACKING_MODES: ElementWrap[] = ['top-bottom'];

export const WRAP_OPTIONS: { value: ElementWrap; label: string; hint: string }[] = [
  { value: 'around', label: 'Wrap around', hint: 'Text flows beside the image on the open side' },
  { value: 'square', label: 'Square wrap', hint: 'Rectangular exclusion zone; text hugs the box' },
  { value: 'tight', label: 'Tight wrap', hint: 'Text hugs the image shape where the browser supports it' },
  { value: 'top-bottom', label: 'Top and bottom', hint: 'Image takes a full-width band; text above and below' },
  { value: 'behind', label: 'Behind text', hint: 'Image sits under the text, no flow effect' },
  { value: 'front', label: 'In front of text', hint: 'Image floats above the text' },
  { value: 'none', label: 'No wrap', hint: 'Text ignores the image completely' },
];

export const DEFAULT_WRAP: ElementWrap = 'square';

export function isWrapping(wrap: ElementWrap | undefined) {
  return WRAPPING_MODES.includes(wrap ?? DEFAULT_WRAP);
}

export function isStacking(wrap: ElementWrap | undefined) {
  return STACKING_MODES.includes(wrap ?? DEFAULT_WRAP);
}

function parser() {
  if (typeof window === 'undefined') return null;
  return new window.DOMParser();
}

/** Split flow HTML into top-level blocks so pagination can move them as units. */
export function splitBlocks(html: string): string[] {
  const dom = parser();
  if (!dom) return html ? [html] : [];
  const doc = dom.parseFromString(`<div id="flow-root">${html || ''}</div>`, 'text/html');
  const root = doc.getElementById('flow-root');
  if (!root) return html ? [html] : [];
  const blocks: string[] = [];
  root.childNodes.forEach((node) => {
    if (node.nodeType === 3) {
      const text = node.textContent?.trim();
      if (text) blocks.push(`<p>${text}</p>`);
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (element.tagName === 'HR') blocks.push('<hr />');
    else if (BLOCK_TAGS.includes(element.tagName)) blocks.push(element.outerHTML);
    else blocks.push(element.outerHTML);
  });
  return blocks;
}

/* -------------------------------------------------------------- measurement */

let measurer: HTMLDivElement | null = null;

function ensureMeasurer(): HTMLDivElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (measurer && document.body.contains(measurer)) return measurer;
  measurer = document.createElement('div');
  measurer.setAttribute('data-flow-measurer', 'true');
  measurer.setAttribute('aria-hidden', 'true');
  measurer.style.cssText = [
    'position:absolute',
    'left:-10000px',
    'top:0',
    'visibility:hidden',
    'pointer-events:none',
    'z-index:-1',
    'contain:layout style',
  ].join(';');
  document.body.appendChild(measurer);
  return measurer;
}

export interface FlowContext {
  widthPx: number;
  /** Font family / size / line-height of the body copy. */
  bodyStyle: Partial<CSSStyleDeclaration> & { fontSize?: string; fontFamily?: string; lineHeight?: string };
  /** Absolute-positioned elements that participate in wrapping. */
  floats?: { element: PageElement; boxPx: { width: number; height: number } }[];
}

function floatMarkup(floats: FlowContext['floats']): string {
  if (!floats?.length) return '';
  return floats
    .map(({ element, boxPx }) => {
      const wrap = element.wrap ?? DEFAULT_WRAP;
      if (!isWrapping(wrap)) return '';
      const side = element.x + element.w / 2 < 50 ? 'left' : 'right';
      const offset = Math.max(0, Math.min(90, element.y));
      const shape = wrap === 'tight' ? 'shape-outside:inset(0 round 6px);shape-margin:0.35em;' : '';
      const radius = wrap === 'square' ? 'border-radius:4px;' : '';
      const stack = isStacking(wrap) ? 'float:none;display:block;margin:0.6em auto;' : '';
      return `<div data-float="${element.id}" style="float:${side};width:${boxPx.width}px;height:${boxPx.height}px;margin:${offset > 2 ? '0 0 ' : '0 0 '}0.6em ${side === 'left' ? '0.7em' : '0'};margin-${side === 'left' ? 'right' : 'left'}:0.7em;${shape}${radius}${stack}"></div>`;
    })
    .join('');
}

/** Measure the rendered height of a chunk of flow HTML inside the real text column. */
export function measureFlow(chunkHtml: string, context: FlowContext): number {
  const host = ensureMeasurer();
  if (!host) return 0;
  host.style.width = `${context.widthPx}px`;
  host.style.fontFamily = String(context.bodyStyle.fontFamily ?? 'serif');
  host.style.fontSize = String(context.bodyStyle.fontSize ?? '12pt');
  host.style.lineHeight = String(context.bodyStyle.lineHeight ?? 1.5);
  host.innerHTML = `${floatMarkup(context.floats)}<div class="ProseMirror" style="all:unset;display:block">${chunkHtml}</div>`;
  const height = host.getBoundingClientRect().height || host.scrollHeight || 0;
  host.innerHTML = '';
  return height;
}

/* -------------------------------------------------------------- pagination */

export interface PaginateOptions {
  availableHeight: number;
  context: FlowContext;
  /** Allow splitting a single over-long paragraph mid-sentence. */
  allowParagraphSplit?: boolean;
  /** Keep at least this many lines of a split paragraph on a page (widows). */
  minLines?: number;
}

/**
 * Break flow content into pages.
 *
 * Blocks are moved as units. A block that cannot fit is pushed to the next page; a
 * block taller than a whole page is split mid-sentence so text is never clipped or
 * lost. Returns the original content as one chunk when the environment cannot measure.
 */
export function paginateFlow(html: string, options: PaginateOptions): PaginateResult {
  const { availableHeight, context } = options;
  const blocks = splitBlocks(html);
  const initialMetrics: FlowMetrics = {
    contentHeight: 0,
    availableHeight,
    overflowRatio: 0,
    overflow: false,
    unmeasurable: false,
  };
  if (!blocks.length || availableHeight <= 0) {
    return { chunks: [html], metrics: initialMetrics, unmeasurable: false };
  }

  const probe = measureFlow('<p>x</p>', context);
  const total = measureFlow(blocks.join(''), context);
  if (!probe || !total) {
    // No layout engine — never invent page breaks.
    return { chunks: [html], metrics: { ...initialMetrics, unmeasurable: true }, unmeasurable: true };
  }

  const metrics: FlowMetrics = {
    contentHeight: total,
    availableHeight,
    overflowRatio: total > availableHeight ? (total - availableHeight) / availableHeight : 0,
    overflow: total > availableHeight * 1.005,
    unmeasurable: false,
  };

  if (!metrics.overflow || metrics.unmeasurable) {
    return { chunks: [html], metrics, unmeasurable: false };
  }

  const chunks: string[] = [];
  let current: string[] = [];
  let used = 0;

  const flush = () => {
    if (current.length) {
      chunks.push(current.join(''));
      current = [];
      used = 0;
    }
  };

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const height = measureFlow(block, context);
    const isHeadingish = /^<(h[1-6]|blockquote)/i.test(block);
    const nextHeight = index + 1 < blocks.length ? measureFlow(blocks[index + 1], context) : 0;

    const fits = used + height <= availableHeight;
    // Typesetting: a heading must not be the last line on a page.
    const headingWouldStrand = isHeadingish && used + height + Math.min(nextHeight, availableHeight * 0.25) > availableHeight;

    if (fits && !headingWouldStrand) {
      current.push(block);
      used += height;
      continue;
    }

    if (!fits && height > availableHeight) {
      // Block alone is taller than a page: split it by words.
      const split = splitOversizedBlock(block, availableHeight - used, context, options);
      split.forEach((piece, pieceIndex) => {
        if (pieceIndex > 0) flush();
        current.push(piece);
        used += measureFlow(piece, context);
        if (pieceIndex < split.length - 1) flush();
      });
      continue;
    }

    flush();
    current.push(block);
    used = height;
  }

  flush();
  return { chunks: chunks.length ? chunks : [html], metrics, unmeasurable: false };
}

/** Split one over-long block (usually a paragraph) into page-sized pieces. */
export function splitOversizedBlock(
  block: string,
  availableHeight: number,
  context: FlowContext,
  options: PaginateOptions = { availableHeight: 0, context },
): string[] {
  const dom = parser();
  if (!dom || availableHeight <= 0) return [block];
  const doc = dom.parseFromString(block, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return [block];
  const tag = root.tagName.toLowerCase();
  const text = root.textContent ?? '';
  if (text.split(/\s+/).length < 12) return [block];

  const words = text.split(/(\s+)/);
  const build = (slice: string) => `<${tag}>${slice}</${tag}>`;
  const pieces: string[] = [];
  let remaining = words.slice();

  while (remaining.length) {
    const full = build(remaining.join(''));
    if (measureFlow(full, context) <= availableHeight) {
      pieces.push(full);
      break;
    }
    // Binary search the largest prefix that fits.
    let low = 1;
    let high = remaining.length;
    let best = 0;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (measureFlow(build(remaining.slice(0, mid).join('')), context) <= availableHeight) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const minWords = Math.max(4, options.minLines ?? 2) * 4;
    if (best < minWords) best = Math.min(remaining.length, minWords);
    pieces.push(build(remaining.slice(0, best).join('').trim()));
    remaining = remaining.slice(best);
  }

  return pieces.length ? pieces : [block];
}

/* -------------------------------------------------------------- page helpers */

export function pageTextColumn(book: Book): { widthPx: number; heightPx: number } {
  const dpi = 96;
  const widthIn = book.trimSize.widthIn;
  const heightIn = book.trimSize.heightIn;
  const widthPx = Math.max(24, (widthIn - book.margins.left - book.margins.right - 2) * dpi);
  const heightPx = Math.max(24, (heightIn - book.margins.top - book.margins.bottom) * dpi);
  return { widthPx, heightPx };
}

export function flowContextFor(book: Book, page: BookPage): FlowContext {
  const column = pageTextColumn(book);
  return {
    widthPx: column.widthPx,
    bodyStyle: {
      fontFamily: book.fonts.body,
      fontSize: `${book.fonts.baseSize}pt`,
      lineHeight: String(book.theme.lineHeight),
    },
    floats: page.elements
      .filter((element) => element.visible && (element.type === 'image' || element.type === 'shape' || (element.type === 'icon')))
      .map((element) => ({
        element,
        boxPx: {
          width: (element.w / 100) * column.widthPx,
          height: (element.h / 100) * column.heightPx,
        },
      })),
  };
}

/** Live overflow check used by the canvas warning badge. */
export function inspectPage(book: Book, page: BookPage): FlowMetrics {
  const context = flowContextFor(book, page);
  const column = pageTextColumn(book);
  if (page.layout !== 'flow' && page.layout !== 'title') {
    return { contentHeight: 0, availableHeight: column.heightPx, overflowRatio: 0, overflow: false, unmeasurable: false };
  }
  const total = measureFlow(page.content || '', context);
  if (!total) {
    return { contentHeight: 0, availableHeight: column.heightPx, overflowRatio: 0, overflow: false, unmeasurable: true };
  }
  return {
    contentHeight: total,
    availableHeight: column.heightPx,
    overflowRatio: total > column.heightPx ? (total - column.heightPx) / column.heightPx : 0,
    overflow: total > column.heightPx * 1.005,
    unmeasurable: false,
  };
}

/** HTML to show when the user asks for "flow overflow to the next page". */
export function planAutoFlow(book: Book, page: BookPage): string[] {
  const context = flowContextFor(book, page);
  const column = pageTextColumn(book);
  const result = paginateFlow(page.content || '', { availableHeight: column.heightPx, context });
  return result.chunks;
}

/* --------------------------------------------------- editor-facing helpers */

/**
 * Split flow HTML at a top-level block index (drag/insert a page break).
 * Everything before the index stays, everything after becomes the next page.
 */
export function splitAtBlock(html: string, blockIndex: number): { head: string; tail: string } {
  const blocks = splitBlocks(html);
  if (!blocks.length) return { head: html, tail: '' };
  const at = Math.max(0, Math.min(blocks.length, Math.round(blockIndex)));
  return { head: blocks.slice(0, at).join(''), tail: blocks.slice(at).join('') };
}

/** How many top-level blocks the page content has (used by the break UI). */
export function blockCount(html: string): number {
  return splitBlocks(html).length;
}

/**
 * Decide how to spill an overflowing page: returns the head (keeps the page) and
 * the tail (moves to the next page). `unmeasurable` means no layout engine was
 * available, so the caller must ask the user instead of guessing.
 */
export function planSpill(
  html: string,
  options: { availableHeight: number; context: FlowContext },
): { head: string; tail: string; unmeasurable: boolean; overflowRatio: number; chunks: number } {
  const chunks = paginateFlow(html, options);
  if (chunks.unmeasurable) {
    return { head: html, tail: '', unmeasurable: true, overflowRatio: 0, chunks: 1 };
  }
  if (!chunks.metrics.overflow || chunks.chunks.length < 2) {
    return { head: html, tail: '', unmeasurable: false, overflowRatio: chunks.metrics.overflowRatio, chunks: chunks.chunks.length };
  }
  return {
    head: chunks.chunks[0],
    tail: chunks.chunks.slice(1).join(''),
    unmeasurable: false,
    overflowRatio: chunks.metrics.overflowRatio,
    chunks: chunks.chunks.length,
  };
}
