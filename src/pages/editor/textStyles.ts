/**
 * Book typography system.
 *
 * Every style is a plain data record stored on the book, so the editor, the preview,
 * the export engine and (later) the print pipeline all read the same definitions.
 * Changing a style can be pushed to every piece of matching content in the book.
 */
import type * as React from 'react';
import type { Book, BookTextStyle, BookPage } from '@/types/domain';

const base = (
  name: string,
  label: string,
  appliesTo: BookTextStyle['appliesTo'],
  patch: Partial<BookTextStyle>,
): BookTextStyle => ({
  id: `style_${name}`,
  name,
  label,
  appliesTo,
  fontFamily: 'Source Serif 4',
  fontSize: 12,
  fontWeight: 400,
  lineHeight: 1.55,
  letterSpacing: 0,
  textTransform: 'none',
  align: 'left',
  color: '#111827',
  ...patch,
});

export const DEFAULT_TEXT_STYLES: BookTextStyle[] = [
  base('title', 'Title', 'title', { fontFamily: 'Playfair Display', fontSize: 34, fontWeight: 700, lineHeight: 1.15, align: 'center', spaceAfter: 0.8, pageBreakBefore: true }),
  base('subtitle', 'Subtitle', 'title', { fontFamily: 'Playfair Display', fontSize: 19, fontWeight: 400, lineHeight: 1.3, align: 'center', color: '#4b5563', spaceAfter: 1.2 }),
  base('chapter-title', 'Chapter title', 'heading', { fontFamily: 'Playfair Display', fontSize: 26, fontWeight: 700, lineHeight: 1.2, spaceBefore: 0, spaceAfter: 1.1, keepWithNext: true, pageBreakBefore: true }),
  base('section-heading', 'Section heading', 'heading', { fontFamily: 'Inter', fontSize: 15, fontWeight: 600, lineHeight: 1.3, letterSpacing: 0.02, spaceBefore: 1.4, spaceAfter: 0.5, keepWithNext: true }),
  base('heading-1', 'Heading 1', 'heading', { fontFamily: 'Inter', fontSize: 22, fontWeight: 700, lineHeight: 1.25, spaceBefore: 1.2, spaceAfter: 0.5, keepWithNext: true }),
  base('heading-2', 'Heading 2', 'heading', { fontFamily: 'Inter', fontSize: 17, fontWeight: 600, lineHeight: 1.3, spaceBefore: 1.1, spaceAfter: 0.45, keepWithNext: true }),
  base('heading-3', 'Heading 3', 'heading', { fontFamily: 'Inter', fontSize: 14, fontWeight: 600, lineHeight: 1.35, spaceBefore: 1, spaceAfter: 0.4, keepWithNext: true }),
  base('body', 'Body', 'paragraph', { fontSize: 12, lineHeight: 1.55, spaceAfter: 0.6 }),
  base('body-first', 'Body — first paragraph', 'paragraph', { fontSize: 12, lineHeight: 1.55, spaceAfter: 0.6 }),
  base('quote', 'Quote', 'quote', { fontFamily: 'Source Serif 4', fontSize: 13, italic: true, lineHeight: 1.5, color: '#374151', spaceBefore: 0.8, spaceAfter: 0.8 }),
  base('caption', 'Caption', 'caption', { fontFamily: 'Inter', fontSize: 9.5, lineHeight: 1.4, color: '#6b7280', align: 'left', spaceAfter: 0.6 }),
  base('footnote', 'Footnote', 'paragraph', { fontFamily: 'Source Serif 4', fontSize: 9, lineHeight: 1.35, color: '#374151', spaceAfter: 0.3 }),
  base('header', 'Header', 'any', { fontFamily: 'Inter', fontSize: 9, letterSpacing: 0.08, textTransform: 'uppercase', color: '#6b7280' }),
  base('footer', 'Footer', 'any', { fontFamily: 'Inter', fontSize: 9, color: '#6b7280' }),
  base('drop-cap', 'Drop cap', 'paragraph', { fontFamily: 'Playfair Display', fontSize: 42, fontWeight: 700, lineHeight: 0.82, spaceAfter: 0.2 }),
];

/** Styles whose definitions should follow the book's chosen fonts until edited. */
export function initialiseTextStyles(book: Pick<Book, 'fonts' | 'textStyles'>): BookTextStyle[] {
  if (book.textStyles?.length) return book.textStyles;
  return DEFAULT_TEXT_STYLES.map((style) => {
    const heading = style.appliesTo === 'heading' || style.appliesTo === 'title';
    return { ...style, fontFamily: style.fontFamily === 'Inter' ? 'Inter' : heading ? book.fonts.heading : book.fonts.body };
  });
}

export function findStyle(styles: BookTextStyle[], name: string | undefined): BookTextStyle | undefined {
  if (!name) return undefined;
  return styles.find((style) => style.name === name);
}

export function styleToCss(style: BookTextStyle): React.CSSProperties {
  return {
    fontFamily: style.fontFamily,
    fontSize: `${style.fontSize}pt`,
    fontWeight: style.fontWeight,
    fontStyle: style.italic ? 'italic' : undefined,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing ? `${style.letterSpacing}em` : undefined,
    textTransform: style.textTransform,
    textAlign: style.align,
    color: style.color,
    marginBottom: style.spaceAfter ? `${style.spaceAfter}em` : undefined,
    marginTop: style.spaceBefore ? `${style.spaceBefore}em` : undefined,
    breakInside: style.keepWithNext ? 'avoid' : undefined,
    breakAfter: style.keepWithNext ? 'avoid' : undefined,
  };
}

const HEADING_TAGS = ['h2', 'h3', 'h4'];

/**
 * Push an edited style onto matching content.
 *
 * Works on both flow HTML (tags + inline styles) and on canvas text elements that
 * reference the style by name.
 */
export function applyStyleToContent(
  book: Book,
  style: BookTextStyle,
): { pages: BookPage[]; changed: number } {
  let changed = 0;

  const decorate = (tag: string) => {
    const attrs: string[] = [
      `data-style="${style.name}"`,
      `style="font-family:${style.fontFamily};font-size:${style.fontSize}pt;font-weight:${style.fontWeight};line-height:${style.lineHeight};text-align:${style.align};color:${style.color};${style.letterSpacing ? `letter-spacing:${style.letterSpacing}em;` : ''}${style.textTransform !== 'none' ? `text-transform:${style.textTransform};` : ''}${style.italic ? 'font-style:italic;' : ''}${style.spaceBefore ? `margin-top:${style.spaceBefore}em;` : ''}${style.spaceAfter ? `margin-bottom:${style.spaceAfter}em;` : ''}"`,
    ];
    return `<${tag} ${attrs.join(' ')}>`;
  };

  const pages = book.pages.map((page) => {
    let content = page.content;

    if (content && (page.layout === 'flow' || page.layout === 'title')) {
      // Restyle by existing data-style first, then by semantic tag for that style's family.
      for (const tag of ['h1', ...HEADING_TAGS, 'p', 'blockquote', 'figcaption']) {
        const pattern = new RegExp(`<${tag}([^>]*data-style="${style.name}"[^>]*)>`, 'g');
        if (pattern.test(content)) {
          changed += 1;
          content = content.replace(pattern, () => decorate(tag));
        }
      }

      const tagForStyle =
        style.appliesTo === 'title' ? 'h1'
          : style.appliesTo === 'heading' ? (style.name === 'heading-1' ? 'h2' : 'h3')
            : style.appliesTo === 'quote' ? 'blockquote'
              : style.appliesTo === 'caption' ? 'figcaption'
                : undefined;

      if (tagForStyle && !content.includes(`data-style="${style.name}"`)) {
        const pattern = new RegExp(`<${tagForStyle}(?![^>]*data-style=)([^>]*)>`, 'g');
        const matches = content.match(pattern);
        if (matches?.length) changed += matches.length;
        content = content.replace(pattern, () => decorate(tagForStyle));
      }
    }

    // Canvas text boxes that follow this style by name.
    let elementsChanged = false;
    const elements = page.elements.map((element) => {
      if (element.style?.styleName !== style.name) return element;
      elementsChanged = true;
      changed += 1;
      return {
        ...element,
        style: {
          ...element.style,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize * (96 / 72), // pt -> px for on-canvas sizing
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          textTransform: style.textTransform,
          align: style.align,
          color: style.color,
          italic: style.italic,
        },
      };
    });

    return content !== page.content || elementsChanged ? { ...page, content, elements } : page;
  });

  return { pages, changed };
}

/** Guess which style a block of HTML belongs to, for the "paragraph style" dropdown. */
export function detectStyleName(html: string | undefined, styles: BookTextStyle[]): string {
  if (!html) return 'body';
  const explicit = /data-style="([^"]+)"/.exec(html);
  if (explicit && styles.some((style) => style.name === explicit[1])) return explicit[1];
  if (/<h1/i.test(html)) return 'title';
  if (/<h2/i.test(html)) return 'heading-1';
  if (/<h3/i.test(html)) return 'heading-2';
  if (/<blockquote/i.test(html)) return 'quote';
  if (/<figcaption/i.test(html)) return 'caption';
  return 'body';
}

export const TEXT_EFFECT_PRESETS = [
  { id: 'none', label: 'None' },
  { id: 'soft', label: 'Soft shadow', shadow: '0 1px 2px rgb(15 23 42 / 0.25)' },
  { id: 'lift', label: 'Lifted', shadow: '0 6px 18px -6px rgb(15 23 42 / 0.45)' },
  { id: 'glow', label: 'Glow', shadow: '0 0 18px rgb(56 189 248 / 0.55)' },
  { id: 'outline', label: 'Outline', shadow: '0 1px 0 #fff, 0 -1px 0 #fff, 1px 0 0 #fff, -1px 0 0 #fff' },
] as const;
