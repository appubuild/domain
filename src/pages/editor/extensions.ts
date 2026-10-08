/**
 * Custom Tiptap extensions for book typography.
 *
 * Standard marks and nodes come from the official @tiptap packages (superscript,
 * subscript, task lists, tables). The extensions here add the book-specific controls
 * the toolbar exposes: text direction, paragraph indent/outdent, drop caps and small
 * caps — all of them storing real attributes on the document so preview and export see
 * exactly the same thing.
 */
import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export { default as Subscript } from '@tiptap/extension-subscript';
export { default as Superscript } from '@tiptap/extension-superscript';
export { default as TaskList } from '@tiptap/extension-task-list';
export { default as TaskItem } from '@tiptap/extension-task-item';
export { default as Table } from '@tiptap/extension-table';
export { default as TableRow } from '@tiptap/extension-table-row';
export { default as TableCell } from '@tiptap/extension-table-cell';
export { default as TableHeader } from '@tiptap/extension-table-header';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bookTypography: {
      setTextDirection: (direction: 'ltr' | 'rtl') => ReturnType;
      indent: () => ReturnType;
      outdent: () => ReturnType;
      toggleDropCap: () => ReturnType;
      toggleSmallCaps: () => ReturnType;
      setParagraphSpacing: (spacing: number) => ReturnType;
      keepWithNext: (keep: boolean) => ReturnType;
    };
  }
}

/** Writing direction on paragraphs and headings (Arabic, Hebrew, bilingual books). */
export const TextDirection = Extension.create({
  name: 'textDirection',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'blockquote'],
        attributes: {
          dir: {
            default: 'ltr',
            parseHTML: (element) => element.getAttribute('dir') ?? 'ltr',
            renderHTML: (attributes) => (attributes.dir && attributes.dir !== 'ltr' ? { dir: attributes.dir as string } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setTextDirection:
        (direction) =>
        ({ commands }) =>
          ['paragraph', 'heading', 'blockquote'].some((type) => commands.updateAttributes(type, { dir: direction })),
    };
  },
});

/** First-line / block indent, stored as a real attribute so exports keep it. */
export const Indent = Extension.create({
  name: 'bookIndent',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'blockquote'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => Number(element.getAttribute('data-indent') ?? 0),
            renderHTML: (attributes) =>
              attributes.indent ? { 'data-indent': String(attributes.indent), style: `margin-left:${Number(attributes.indent) * 1.5}rem` } : {},
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      indent:
        () =>
        ({ editor, commands }) => {
          const current = Number(editor.getAttributes('paragraph').indent ?? 0);
          return ['paragraph', 'heading'].some((type) => commands.updateAttributes(type, { indent: Math.min(6, current + 1) }));
        },
      outdent:
        () =>
        ({ editor, commands }) => {
          const current = Number(editor.getAttributes('paragraph').indent ?? 0);
          return ['paragraph', 'heading'].some((type) => commands.updateAttributes(type, { indent: Math.max(0, current - 1) }));
        },
    };
  },
});

/** Drop cap: the paragraph's first letter is set large by CSS, flagged in the document. */
export const DropCap = Extension.create({
  name: 'dropCap',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          dropCap: {
            default: false,
            parseHTML: (element) => element.hasAttribute('data-drop-cap'),
            renderHTML: (attributes) => (attributes.dropCap ? { 'data-drop-cap': 'true' } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      toggleDropCap:
        () =>
        ({ editor, commands }) => {
          const current = Boolean(editor.getAttributes('paragraph').dropCap);
          return commands.updateAttributes('paragraph', { dropCap: !current });
        },
    };
  },
});

/** Small caps for chapter headings and running heads. */
export const SmallCaps = Extension.create({
  name: 'smallCaps',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          smallCaps: {
            default: false,
            parseHTML: (element) => element.hasAttribute('data-small-caps'),
            renderHTML: (attributes) => (attributes.smallCaps ? { 'data-small-caps': 'true', style: 'font-variant:small-caps' } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      toggleSmallCaps:
        () =>
        ({ editor, commands }) => {
          const current = Boolean(editor.getAttributes('paragraph').smallCaps);
          return commands.updateAttributes('paragraph', { smallCaps: !current });
        },
    };
  },
});

/** Paragraph spacing + keep-with-next, the two typesetting controls authors ask for most. */
export const BlockSpacing = Extension.create({
  name: 'blockSpacing',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'blockquote'],
        attributes: {
          spacingAfter: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-spacing-after'),
            renderHTML: (attributes) =>
              attributes.spacingAfter ? { 'data-spacing-after': String(attributes.spacingAfter), style: `margin-bottom:${attributes.spacingAfter}em` } : {},
          },
          keepWithNext: {
            default: false,
            parseHTML: (element) => element.hasAttribute('data-keep-with-next'),
            renderHTML: (attributes) => (attributes.keepWithNext ? { 'data-keep-with-next': 'true', style: 'break-after:avoid' } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setParagraphSpacing:
        (spacing: number) =>
        ({ commands }) =>
          commands.updateAttributes('paragraph', { spacingAfter: spacing }),
      keepWithNext:
        (keep: boolean) =>
        ({ commands }) =>
          commands.updateAttributes('paragraph', { keepWithNext: keep }),
    };
  },
});

/** Every custom extension, ready to spread into the editor's extension list. */
export const bookTypographyExtensions = [TextDirection, Indent, DropCap, SmallCaps, BlockSpacing];

/** Helper used by the outline/TOC builder: is this node a heading-like block? */
export function isHeadingNode(node: ProseMirrorNode) {
  return node.type.name === 'heading';
}
