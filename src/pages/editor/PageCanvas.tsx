import * as React from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import { AlertTriangle, AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Bookmark, GripVertical, Heading1, Heading2, Highlighter, Image as ImageIcon, Italic, Link2, List, ListOrdered, Lock, Minus, Quote, Redo2, RotateCw, Sparkles, Strikethrough, Trash2, Type, Underline as UnderlineIcon, Undo2, Unlock } from 'lucide-react';
import { Badge, Button, Separator } from '@/components/ui/primitives';
import { DropdownMenu, type MenuItemDef } from '@/components/ui/overlays';
import { cn } from '@/lib/utils';
import {
  Subscript,
  Superscript,
  Table,
  TableCell,
  TableHeader,
  TableRow,
  TaskItem,
  TaskList,
  bookTypographyExtensions,
} from './extensions';
import { canvasPrefs } from '@/data/migrations';
import type { Book, BookPage, ElementWrap, PageElement, TrimSize } from '@/types/domain';

/* ------------------------------------------------------------------ shared */

export function pagePixelSize(trim: TrimSize, orientation: Book['orientation'], zoom: number) {
  const width = orientation === 'landscape' ? trim.heightIn : trim.widthIn;
  const height = orientation === 'landscape' ? trim.widthIn : trim.heightIn;
  return { width: width * 96 * zoom, height: height * 96 * zoom, ratio: height / width };
}

export function elementStyle(element: PageElement): React.CSSProperties {
  const style = element.style ?? {};
  return {
    position: 'absolute',
    left: `${element.x}%`,
    top: `${element.y}%`,
    width: `${element.w}%`,
    height: `${element.h}%`,
    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
    opacity: style.opacity ?? 1,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize ? `${style.fontSize}px` : undefined,
    fontWeight: style.fontWeight,
    fontStyle: style.italic ? 'italic' : undefined,
    textDecoration: [style.underline ? 'underline' : '', style.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ') || undefined,
    color: style.color,
    textAlign: style.align,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing ? `${style.letterSpacing}px` : undefined,
    textTransform: style.textTransform,
    columnCount: style.columns && style.columns > 1 ? style.columns : undefined,
    columnGap: style.columns && style.columns > 1 ? '1.5em' : undefined,
    textShadow: style.shadow,
    background: style.background,
    border: style.borderWidth ? `${style.borderWidth}px solid ${style.borderColor ?? '#d4d4d8'}` : undefined,
    borderRadius: style.borderRadius ? `${style.borderRadius}px` : undefined,
    padding: style.padding ? `${style.padding}em` : undefined,
    direction: style.direction,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: style.verticalAlign === 'middle' ? 'center' : style.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start',
  };
}

/** CSS filter string for an image element, including flip transforms. */
export function imageFilterStyle(image: NonNullable<PageElement['image']>): React.CSSProperties {
  const filters = image.filters ?? { grayscale: 0, sepia: 0, blur: 0, brightness: 100, contrast: 100 };
  const parts = [
    filters.grayscale ? `grayscale(${filters.grayscale}%)` : '',
    filters.sepia ? `sepia(${filters.sepia}%)` : '',
    filters.blur ? `blur(${filters.blur}px)` : '',
    filters.brightness !== 100 ? `brightness(${filters.brightness}%)` : '',
    filters.contrast !== 100 ? `contrast(${filters.contrast}%)` : '',
    image.saturation && image.saturation !== 100 ? `saturate(${image.saturation}%)` : '',
  ].filter(Boolean);
  const transforms = [
    image.flipH ? 'scaleX(-1)' : '',
    image.flipV ? 'scaleY(-1)' : '',
    image.crop?.scale && image.crop.scale !== 1 ? `scale(${image.crop.scale})` : '',
  ].filter(Boolean);
  return {
    filter: parts.length ? parts.join(' ') : undefined,
    transform: transforms.length ? transforms.join(' ') : undefined,
    objectPosition: image.crop ? `${50 + (image.crop.x ?? 0)}% ${50 + (image.crop.y ?? 0)}%` : undefined,
  };
}

/** Elements that take part in text flow on a flow page. */
export function wrappingElements(page: BookPage): PageElement[] {
  return page.elements.filter(
    (element) => element.visible && (element.type === 'image' || element.type === 'shape' || element.type === 'decoration') && (element.wrap ?? 'square') !== 'none',
  );
}

export function floatSide(element: PageElement): 'left' | 'right' {
  return element.x + element.w / 2 < 50 ? 'left' : 'right';
}

export function isFloating(element: PageElement) {
  const wrap = element.wrap ?? 'square';
  return wrap === 'around' || wrap === 'square' || wrap === 'tight';
}

export function isStacked(element: PageElement) {
  return (element.wrap ?? 'square') === 'top-bottom';
}

export function isBehindText(element: PageElement) {
  return (element.wrap ?? 'square') === 'behind';
}

export interface TableCellBinding {
  activeCell: { elementId: string; row: number; col: number } | null;
  onSelectCell: (elementId: string, row: number, col: number) => void;
  onEditCell: (elementId: string, row: number, col: number, value: string) => void;
  editable: boolean;
  pageHeightIn: number;
}

const TableCellContext = React.createContext<TableCellBinding>({
  activeCell: null,
  onSelectCell: () => undefined,
  onEditCell: () => undefined,
  editable: false,
  pageHeightIn: 8,
});

function ElementRenderer({ element }: { element: PageElement }) {
  const { activeCell, onSelectCell, onEditCell, editable, pageHeightIn } = React.useContext(TableCellContext);
  if (!element.visible) return null;
  const base = elementStyle(element);
  switch (element.type) {
    case 'text':
    case 'quote':
      return (
        <div
          style={{ ...base, borderLeft: element.type === 'quote' ? '3px solid hsl(var(--primary))' : undefined, paddingLeft: element.type === 'quote' ? '0.75em' : undefined }}
          className={cn('overflow-hidden', element.type === 'quote' && 'italic text-muted-foreground')}
          dangerouslySetInnerHTML={{ __html: element.text ?? '' }}
        />
      );
    case 'image':
      return (
        <div style={base} className="overflow-hidden">
          {element.image?.src ? (
            <img
              src={element.image.src}
              alt={element.name}
              style={{
                width: '100%',
                height: '100%',
                objectFit: element.image.fit ?? 'cover',
                borderRadius: element.image.radius ? `${element.image.radius}px` : undefined,
                border: element.image.borderWidth ? `${element.image.borderWidth}px solid ${element.image.borderColor ?? '#111'}` : undefined,
                boxShadow: element.image.shadow ? '0 12px 30px -12px rgb(15 23 42 / 0.45)' : undefined,
                opacity: element.image.opacity ?? 1,
                clipPath: element.image.crop
                  ? `inset(${Math.max(0, element.image.crop.y ?? 0)}% ${Math.max(0, 50 - (element.image.crop.x ?? 0))}% ${Math.max(0, 50 - (element.image.crop.y ?? 0))}% ${Math.max(0, element.image.crop.x ?? 0)}%)`
                  : undefined,
                ...imageFilterStyle(element.image),
              }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded border border-dashed bg-muted/40 text-2xs text-muted-foreground">Image</div>
          )}
        </div>
      );
    case 'shape': {
      const shape = element.shape ?? {};
      const common: React.CSSProperties = {
        ...base,
        background: shape.kind === 'line' ? undefined : shape.fill ?? 'hsl(var(--primary))',
        border: shape.strokeWidth ? `${shape.strokeWidth}px solid ${shape.stroke ?? 'transparent'}` : undefined,
        borderRadius: shape.kind === 'ellipse' ? '9999px' : shape.radius ? `${shape.radius}px` : undefined,
      };
      if (shape.kind === 'triangle') {
        return <div style={{ ...base, width: 0, height: 0, borderLeft: '50% solid transparent' }} className="bg-transparent" />;
      }
      if (shape.kind === 'star') {
        return (
          <div style={base} className="flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-full w-full"><path fill={shape.fill ?? 'hsl(var(--primary))'} d="M12 2.5l2.9 6.2 6.8.8-5 4.6 1.3 6.7L12 17.6 6 20.8l1.3-6.7-5-4.6 6.8-.8z" /></svg>
          </div>
        );
      }
      if (shape.kind === 'arrow') {
        return (
          <div style={{ ...base, background: shape.fill ?? 'hsl(var(--primary))', clipPath: 'polygon(0 35%, 70% 35%, 70% 0, 100% 50%, 70% 100%, 70% 65%, 0 65%)' }} />
        );
      }
      if (shape.kind === 'line') {
        return <div style={{ ...base, height: `${Math.max(1, shape.strokeWidth ?? 2)}px`, background: shape.stroke ?? 'hsl(var(--foreground))' }} />;
      }
      return <div style={common} />;
    }
    case 'line':
    case 'divider': {
      const divider = element.divider ?? { style: 'solid' as const, color: 'hsl(var(--border))', thickness: 1 };
      return (
        <div style={{ ...base, display: 'flex', alignItems: 'center' }}>
          {divider.style === 'ornament' ? (
            <span style={{ color: divider.color, width: '100%', textAlign: 'center', letterSpacing: '0.6em' }}>❦</span>
          ) : (
            <span
              style={{
                display: 'block',
                width: '100%',
                borderTop: `${Math.max(1, divider.thickness)}px ${divider.style === 'double' ? 'double' : divider.style} ${divider.color}`,
              }}
            />
          )}
        </div>
      );
    }
    case 'icon':
      return (
        <div style={{ ...base, display: 'flex', alignItems: 'center', justifyContent: 'center', color: element.style?.color ?? 'hsl(var(--primary))' }}>
          <span style={{ fontSize: element.style?.fontSize ?? 42 }}>{element.icon ?? '❖'}</span>
        </div>
      );
    case 'table': {
      const table = element.table ?? { rows: 3, cols: 3, cells: [], headerRow: true, borderColor: 'hsl(var(--border))' };
      const absorbed = new Set(table.merged ?? []);
      const activeKey = activeCell && activeCell.elementId === element.id ? `${activeCell.row},${activeCell.col}` : null;
      const cellStyle = (row: number, col: number) => table.cellStyles?.[`${row},${col}`];
      // Tables must stay inside the page: shrink the type until the grid fits the box.
      const linePx = (element.style?.fontSize ?? 12) * 1.35;
      const needed = table.rows * (linePx + 8);
      const boxPx = (element.h / 100) * (pageHeightIn * 96);
      const fitScale = needed > boxPx && needed > 0 ? Math.max(0.55, boxPx / needed) : 1;
      const fontSize = (element.style?.fontSize ?? 12) * fitScale;

      return (
        <div style={{ ...base, overflow: 'hidden' }} data-table-element={element.id}>
          <table style={{ width: '100%', height: '100%', borderCollapse: 'collapse', fontSize, tableLayout: 'fixed' }}>
            <tbody>
              {Array.from({ length: table.rows }).map((_, row) => (
                <tr key={row}>
                  {Array.from({ length: table.cols }).map((__, col) => {
                    const key = `${row},${col}`;
                    if (absorbed.has(key)) return null;
                    const span = table.spans?.[key];
                    const isHeader = table.headerRow && row === 0;
                    const style = cellStyle(row, col);
                    const align: React.CSSProperties['textAlign'] = table.align?.[key] ?? (table.headerRow && row === 0 ? 'left' : 'left');
                    return (
                      <td
                        key={col}
                        rowSpan={span?.rowSpan}
                        colSpan={span?.colSpan}
                        data-cell={key}
                        contentEditable={editable && !element.locked}
                        suppressContentEditableWarning
                        onFocus={() => onSelectCell?.(element.id, row, col)}
                        onClick={(event) => { event.stopPropagation(); onSelectCell?.(element.id, row, col); }}
                        onBlur={(event) => onEditCell?.(element.id, row, col, event.currentTarget.textContent ?? '')}
                        style={{
                          border: `1px solid ${table.borderColor}`,
                          padding: '4px 6px',
                          background: table.fills?.[key] ?? (isHeader ? 'hsl(var(--muted))' : undefined),
                          fontWeight: style?.bold ? 700 : isHeader ? 600 : undefined,
                          fontStyle: style?.italic ? 'italic' : undefined,
                          fontSize: style?.fontSize ? style.fontSize * fitScale : undefined,
                          textAlign: align,
                          verticalAlign: 'top',
                          outline: activeKey === key ? '2px solid hsl(var(--primary))' : undefined,
                          outlineOffset: -2,
                          cursor: editable && !element.locked ? 'text' : undefined,
                        }}
                      >
                        {table.cells?.[row]?.[col] ?? ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {table.caption && (
            <p style={{ margin: '4px 0 0', fontSize: Math.max(7, fontSize * 0.8), color: '#6b7280', textAlign: 'center' }}>{table.caption}</p>
          )}
        </div>
      );
    }
    case 'barcode':
      return (
        <div style={{ ...base, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
          <div className="flex h-full w-full items-end justify-center gap-[1px] bg-white p-1">
            {Array.from({ length: 42 }).map((_, index) => (
              <span key={index} style={{ width: (index * 7) % 3 === 0 ? 3 : 1, height: `${70 + ((index * 13) % 30)}%`, background: '#111' }} />
            ))}
          </div>
          <span style={{ fontSize: 7, letterSpacing: 1 }}>{element.text ?? '978-1-2345-678-9'}</span>
        </div>
      );
    case 'pageNumber':
      return (
        <div style={{ ...base, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: element.style?.fontSize ?? 10 }}>
          {element.text ?? '#'}
        </div>
      );
    case 'decoration':
    default:
      return (
        <div style={{ ...base, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--muted-foreground))' }}>
          <Sparkles className="h-4 w-4" />
        </div>
      );
  }
}

/* ------------------------------------------------------- flow text editor */

function FlowEditor({
  page,
  onContentChange,
  registerEditor,
}: {
  page: BookPage;
  onContentChange: (html: string) => void;
  registerEditor: (editor: Editor | null) => void;
}) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        Underline,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Link.configure({ openOnClick: false, autolink: true }),
        Image,
        Highlight.configure({ multicolor: true }),
        TextStyle,
        Color,
        Subscript,
        Superscript,
        TaskList,
        TaskItem.configure({ nested: true }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        ...bookTypographyExtensions,
        Placeholder.configure({ placeholder: 'Start writing…' }),
        CharacterCount,
      ],
      content: page.content || '<p></p>',
      editorProps: {
        attributes: {
          class: 'ProseMirror focus:outline-none',
          style: 'font-size: 15px; min-height: 100%;',
        },
      },
      onUpdate: ({ editor: instance }) => onContentChange(instance.getHTML()),
    },
    [page.id],
  );

  React.useEffect(() => {
    registerEditor(editor ?? null);
    return () => registerEditor(null);
  }, [editor, registerEditor]);

  return <EditorContent editor={editor} />;
}

export function FlowToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;
  const buttons: { id: string; label: string; icon: React.ReactNode; active?: boolean; run: () => void }[] = [
    { id: 'bold', label: 'Bold (Ctrl+B)', icon: <Bold className="h-3.5 w-3.5" />, active: editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
    { id: 'italic', label: 'Italic (Ctrl+I)', icon: <Italic className="h-3.5 w-3.5" />, active: editor.isActive('italic'), run: () => editor.chain().focus().toggleItalic().run() },
    { id: 'underline', label: 'Underline', icon: <UnderlineIcon className="h-3.5 w-3.5" />, active: editor.isActive('underline'), run: () => editor.chain().focus().toggleUnderline().run() },
    { id: 'strike', label: 'Strikethrough', icon: <Strikethrough className="h-3.5 w-3.5" />, active: editor.isActive('strike'), run: () => editor.chain().focus().toggleStrike().run() },
    { id: 'h1', label: 'Heading 1', icon: <Heading1 className="h-3.5 w-3.5" />, active: editor.isActive('heading', { level: 1 }), run: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { id: 'h2', label: 'Heading 2', icon: <Heading2 className="h-3.5 w-3.5" />, active: editor.isActive('heading', { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { id: 'ul', label: 'Bullet list', icon: <List className="h-3.5 w-3.5" />, active: editor.isActive('bulletList'), run: () => editor.chain().focus().toggleBulletList().run() },
    { id: 'ol', label: 'Numbered list', icon: <ListOrdered className="h-3.5 w-3.5" />, active: editor.isActive('orderedList'), run: () => editor.chain().focus().toggleOrderedList().run() },
    { id: 'quote', label: 'Block quote', icon: <Quote className="h-3.5 w-3.5" />, active: editor.isActive('blockquote'), run: () => editor.chain().focus().toggleBlockquote().run() },
    { id: 'highlight', label: 'Highlight', icon: <Highlighter className="h-3.5 w-3.5" />, active: editor.isActive('highlight'), run: () => editor.chain().focus().toggleHighlight().run() },
    { id: 'left', label: 'Align left', icon: <AlignLeft className="h-3.5 w-3.5" />, active: editor.isActive({ textAlign: 'left' }), run: () => editor.chain().focus().setTextAlign('left').run() },
    { id: 'center', label: 'Align centre', icon: <AlignCenter className="h-3.5 w-3.5" />, active: editor.isActive({ textAlign: 'center' }), run: () => editor.chain().focus().setTextAlign('center').run() },
    { id: 'right', label: 'Align right', icon: <AlignRight className="h-3.5 w-3.5" />, active: editor.isActive({ textAlign: 'right' }), run: () => editor.chain().focus().setTextAlign('right').run() },
    { id: 'justify', label: 'Justify', icon: <AlignJustify className="h-3.5 w-3.5" />, active: editor.isActive({ textAlign: 'justify' }), run: () => editor.chain().focus().setTextAlign('justify').run() },
    { id: 'hr', label: 'Scene break', icon: <Minus className="h-3.5 w-3.5" />, run: () => editor.chain().focus().setHorizontalRule().run() },
  ];
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      {buttons.map((button) => (
        <button
          key={button.id}
          type="button"
          title={button.label}
          aria-label={button.label}
          aria-pressed={button.active ?? false}
          onClick={button.run}
          className={cn(
            'rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            button.active && 'bg-primary/10 text-primary',
          )}
        >
          {button.icon}
        </button>
      ))}
      <Separator orientation="vertical" className="mx-1 h-5" />
      <button
        type="button"
        title="Link"
        aria-label="Insert link"
        onClick={() => {
          const url = window.prompt('Link URL', 'https://');
          if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
        }}
        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Link2 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Insert image"
        aria-label="Insert image"
        onClick={() => {
          const url = window.prompt('Image URL', 'https://');
          if (url) editor.chain().focus().setImage({ src: url }).run();
        }}
        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ImageIcon className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Insert page break"
        aria-label="Insert page break"
        onClick={() => editor.chain().focus().insertContent('<p class="page-break"></p>').run()}
        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Type className="h-3.5 w-3.5" />
      </button>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <button
        type="button"
        title="Undo"
        aria-label="Undo"
        disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
      >
        <Undo2 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Redo"
        aria-label="Redo"
        disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
      >
        <Redo2 className="h-3.5 w-3.5" />
      </button>
      <span className="ml-auto text-2xs text-muted-foreground">{editor.storage.characterCount?.characters?.().toLocaleString?.() ?? 0} characters</span>
    </div>
  );
}

/* ------------------------------------------------------------- page canvas */

interface CanvasProps {
  book: Book;
  page: BookPage;
  pageIndex: number;
  zoom: number;
  showRulers: boolean;
  showGuides: boolean;
  editable: boolean;
  selectedElementId: string | null;
  onSelectElement: (id: string | null, additive?: boolean) => void;
  onPatchElement: (elementId: string, patch: Partial<PageElement>, options?: { transient?: boolean }) => void;
  onContentChange: (html: string) => void;
  registerEditor: (editor: Editor | null) => void;
  onDeleteElement: (elementId: string) => void;
  onDuplicateElement: (elementId: string) => void;
  onRequirePremium: () => void;
  canUseAdvancedEditor: boolean;
  /** Live overflow measurement for this page (from the flow engine). */
  overflow?: { overflow: boolean; overflowRatio: number; unmeasurable: boolean };
  onAutoFlow: () => void;
  canAutoFlow?: boolean;
  /** True while the editor is in Design mode (objects become manipulable on any page). */
  designMode?: boolean;
  /** Currently focused table cell, shared with the table toolbar. */
  activeCell?: { elementId: string; row: number; col: number } | null;
  onSelectCell?: (elementId: string, row: number, col: number) => void;
  onEditCell?: (elementId: string, row: number, col: number, value: string) => void;
}

export function PageCanvas({
  book,
  page,
  pageIndex,
  zoom,
  showRulers,
  showGuides,
  editable,
  selectedElementId,
  onSelectElement,
  onPatchElement,
  onContentChange,
  registerEditor,
  onDeleteElement,
  onDuplicateElement,
  onRequirePremium,
  canUseAdvancedEditor,
  overflow,
  onAutoFlow,
  canAutoFlow = false,
  designMode = false,
  activeCell = null,
  onSelectCell,
  onEditCell,
}: CanvasProps) {
  const surfaceRef = React.useRef<HTMLDivElement>(null);
  const flowEditorRef = React.useRef<Editor | null>(null);
  const handleRegisterEditor = React.useCallback(
    (instance: Editor | null) => {
      flowEditorRef.current = instance;
      registerEditor(instance);
    },
    [registerEditor],
  );
  /** Clicking any empty part of the page drops the caret into the text, so writing never "does nothing". */
  const focusEditorEnd = React.useCallback(() => {
    const instance = flowEditorRef.current;
    if (!instance) return;
    if (!instance.isEditable) return;
    instance.chain().focus('end').run();
  }, []);
  const [drag, setDrag] = React.useState<{
    id: string;
    mode: 'move' | 'resize' | 'rotate';
    handle?: 'nw' | 'ne' | 'sw' | 'se';
    startX: number;
    startY: number;
    origin: { x: number; y: number; w: number; h: number; rotation: number };
  } | null>(null);
  const [guides, setGuides] = React.useState<{ x?: number; y?: number }>({});

  // `zoom` is a multiplier (1 === 100%), matching EditorPage's state. The page is
  // laid out at its natural pixel size and scaled once, so text scales with the page
  // instead of the page shrinking to a few pixels (which made the canvas look empty).
  const natural = pagePixelSize(book.trimSize, book.orientation, 1);
  const size = pagePixelSize(book.trimSize, book.orientation, zoom);
  const prefs = canvasPrefs(book);
  const pageWidthIn = book.orientation === 'landscape' ? book.trimSize.heightIn : book.trimSize.widthIn;
  const pageHeightIn = book.orientation === 'landscape' ? book.trimSize.widthIn : book.trimSize.heightIn;
  const palette = book.theme.palette;
  const margin = book.margins;
  const isCanvasLayout = page.layout === 'canvas' || page.layout === 'blank';
  // The interactive object layer is on for canvas pages and for every page while the
  // author is in Design mode, so objects on flow pages can be selected and moved too.
  const isDesign = isCanvasLayout || designMode;
  const showCanvasChrome = isCanvasLayout;
  const numbering = page.numbering === 'inherit' ? book.numbering.style : page.numbering;
  const pageNumberLabel = numbering === 'none' ? '' : numbering === 'roman-lower' || numbering === 'roman-upper'
    ? toRoman(pageIndex + 1, numbering === 'roman-upper')
    : String(pageIndex + book.numbering.startAt);

  const background = React.useMemo<React.CSSProperties>(() => {
    const bg = page.background;
    if (!bg || bg.type === 'none') return {};
    if (bg.type === 'color') return { background: bg.value };
    if (bg.type === 'gradient') return { backgroundImage: bg.gradient ?? bg.value };
    if (bg.type === 'image') return { backgroundImage: `url(${bg.imageUrl ?? ''})`, backgroundSize: 'cover', backgroundPosition: 'center' };
    if (bg.type === 'pattern') return { backgroundImage: `url(${bg.pattern ?? ''})`, backgroundRepeat: 'repeat' };
    return {};
  }, [page.background]);

  const pointerDown = (event: React.PointerEvent, element: PageElement, mode: 'move' | 'resize' | 'rotate', handle?: 'nw' | 'ne' | 'sw' | 'se') => {
    if (!editable) return;
    if (element.locked) return;
    if (!canUseAdvancedEditor) {
      onRequirePremium();
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    onSelectElement(element.id);
    if (element.groupId) {
      // Selecting any member of a group selects the group, so move/align act on all of it.
      page.elements.filter((entry) => entry.groupId === element.groupId && entry.id !== element.id).forEach((sibling) => onSelectElement(sibling.id, true));
    }
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    setDrag({
      id: element.id,
      mode,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: element.x, y: element.y, w: element.w, h: element.h, rotation: element.rotation },
    });
  };

  React.useEffect(() => {
    if (!drag) return undefined;
    const element = page.elements.find((entry) => entry.id === drag.id);
    if (!element) return undefined;
    const surface = surfaceRef.current;
    if (!surface) return undefined;
    const bounds = surface.getBoundingClientRect();

    const onMove = (event: PointerEvent) => {
      const dxPct = ((event.clientX - drag.startX) / bounds.width) * 100;
      const dyPct = ((event.clientY - drag.startY) / bounds.height) * 100;
      if (drag.mode === 'move') {
        let x = Math.round((drag.origin.x + dxPct) * 10) / 10;
        let y = Math.round((drag.origin.y + dyPct) * 10) / 10;
        const nextGuides: { x?: number; y?: number } = {};
        if (showGuides) {
          const centreX = 50 - drag.origin.w / 2;
          if (Math.abs(x - centreX) < 1.2) { x = centreX; nextGuides.x = 50; }
          if (Math.abs(y - 50) < 1.2) { y = 50; nextGuides.y = 50; }
          if (Math.abs(x - 6) < 1) { x = 6; nextGuides.x = 6; }
          if (Math.abs(x - (94 - drag.origin.w)) < 1) { x = 94 - drag.origin.w; nextGuides.x = 94; }
        }
        // Snap to the grid (page-relative percentages) — the value the toggle promises.
        if (prefs.snapToGrid) {
          const step = Math.max(0.5, prefs.gridSize);
          x = Math.round(x / step) * step;
          y = Math.round(y / step) * step;
        }
        // Snap to other objects: match edges and centres within a small tolerance.
        if (prefs.snapToObjects) {
          const others = page.elements.filter((entry) => entry.id !== element.id).filter((entry) => entry.type !== 'pageNumber');
          others.forEach((other) => {
            const pairsX: [number, number][] = [[x, other.x], [x + drag.origin.w, other.x + other.w], [x + drag.origin.w / 2, other.x + other.w / 2]];
            pairsX.forEach(([a, b]) => { if (Math.abs(a - b) < 1) { x = Math.round((x + (b - a)) * 10) / 10; nextGuides.x = b; } });
            const pairsY: [number, number][] = [[y, other.y], [y + drag.origin.h, other.y + other.h], [y + drag.origin.h / 2, other.y + other.h / 2]];
            pairsY.forEach(([a, b]) => { if (Math.abs(a - b) < 1) { y = Math.round((y + (b - a)) * 10) / 10; nextGuides.y = b; } });
          });
        }
        setGuides(nextGuides);
        const clampedX = clamp(x, -20, 110);
        const clampedY = clamp(y, -20, 110);
        onPatchElement(element.id, { x: clampedX, y: clampedY }, { transient: true });
        // Objects sharing a group travel together, exactly like a design tool.
        if (element.groupId) {
          const dx = clampedX - drag.origin.x;
          const dy = clampedY - drag.origin.y;
          page.elements.filter((entry) => entry.groupId === element.groupId && entry.id !== element.id).forEach((sibling) => {
            onPatchElement(sibling.id, { x: round(sibling.x + dx), y: round(sibling.y + dy) }, { transient: true });
          });
        }
      } else if (drag.mode === 'resize' && drag.handle) {
        const min = 3;
        let w = drag.origin.w;
        let h = drag.origin.h;
        let x = drag.origin.x;
        let y = drag.origin.y;
        if (drag.handle.includes('e')) w = Math.max(min, drag.origin.w + dxPct);
        if (drag.handle.includes('s')) h = Math.max(min, drag.origin.h + dyPct);
        if (drag.handle.includes('w')) {
          const nextW = Math.max(min, drag.origin.w - dxPct);
          x = drag.origin.x + (drag.origin.w - nextW);
          w = nextW;
        }
        if (drag.handle.includes('n')) {
          const nextH = Math.max(min, drag.origin.h - dyPct);
          y = drag.origin.y + (drag.origin.h - nextH);
          h = nextH;
        }
        onPatchElement(element.id, { x: round(x), y: round(y), w: round(w), h: round(h) }, { transient: true });
      } else if (drag.mode === 'rotate') {
        const rotation = Math.round((drag.origin.rotation + dxPct * 2.5) * 10) / 10;
        onPatchElement(element.id, { rotation: rotation % 360 }, { transient: true });
      }
    };
    const onUp = () => {
      setGuides({});
      setDrag(null);
      // A final non-transient write closes the history entry for the gesture.
      const latest = page.elements.find((entry) => entry.id === drag.id);
      if (latest) onPatchElement(latest.id, {}, { transient: false });
      if (latest?.groupId) {
        page.elements.filter((entry) => entry.groupId === latest.groupId && entry.id !== latest.id).forEach((sibling) => onPatchElement(sibling.id, {}, { transient: false }));
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, page.elements, onPatchElement, showGuides]);

  const elementMenu: MenuItemDef[] = selectedElementId
    ? [
        { id: 'duplicate', label: 'Duplicate element', shortcut: '⌘D', onSelect: () => onDuplicateElement(selectedElementId) },
        { id: 'delete', label: 'Delete element', shortcut: 'Del', destructive: true, onSelect: () => onDeleteElement(selectedElementId) },
      ]
    : [];

  const tableBinding = React.useMemo<TableCellBinding>(
    () => ({
      activeCell,
      onSelectCell: onSelectCell ?? (() => undefined),
      onEditCell: onEditCell ?? (() => undefined),
      editable,
      pageHeightIn,
    }),
    [activeCell, onSelectCell, onEditCell, editable, pageHeightIn],
  );

  return (
    <div className="flex flex-col items-center gap-2">
      {showRulers && (
        <div className="flex w-full max-w-[900px] items-end gap-2 px-1 text-2xs text-muted-foreground">
          <div className="h-4 w-6 ruler" />
          <div className="flex-1 ruler h-4" aria-hidden />
          <span className="w-20 text-right">{book.trimSize.label}</span>
        </div>
      )}
      <div className="relative" style={{ width: size.width, height: size.height }}>
        {showRulers && (
          <div className="absolute -left-6 top-0 h-full w-4 ruler" aria-hidden />
        )}
        <div
          ref={surfaceRef}
          onClick={() => { onSelectElement(null); if (editable) focusEditorEnd(); }}
          className={cn('page-card relative overflow-hidden shadow-page', showGuides && editable && 'grid-lines')}
          style={{
            width: natural.width,
            height: natural.height,
            transform: zoom === 1 ? undefined : `scale(${zoom})`,
            transformOrigin: 'top left',
            ...background,
          }}
          data-page-id={page.id}
          role="region"
          aria-label={`Page ${pageIndex + 1}`}
        >
          {/* guide stack: bleed, margins, safe area, centre */}
          {prefs.showBleed && (
            <div
              className="pointer-events-none absolute border border-dashed border-rose-400/60"
              style={{
                inset: `${-(book.bleed / pageHeightIn) * 100}%`,
              }}
              aria-hidden
            />
          )}
          {(editable || prefs.showGuides) && (showGuides || prefs.showGuides) && (
            <div
              className="pointer-events-none absolute border border-dashed border-primary/30"
              style={{
                top: `${(margin.top / pageHeightIn) * 100}%`,
                bottom: `${(margin.bottom / pageHeightIn) * 100}%`,
                left: `${(margin.left / pageWidthIn) * 100}%`,
                right: `${(margin.right / pageWidthIn) * 100}%`,
              }}
              aria-label="Margin guide"
            />
          )}
          {prefs.showSafeArea && (
            <div
              className="pointer-events-none absolute border border-dotted border-emerald-500/50"
              style={{
                top: `${((margin.top + book.safeArea) / pageHeightIn) * 100}%`,
                bottom: `${((margin.bottom + book.safeArea) / pageHeightIn) * 100}%`,
                left: `${((margin.left + book.safeArea) / pageWidthIn) * 100}%`,
                right: `${((margin.right + book.safeArea) / pageWidthIn) * 100}%`,
              }}
              aria-label="Safe area guide"
            />
          )}
          {prefs.showCentreGuide && (
            <div className="pointer-events-none absolute left-1/2 top-0 h-full w-px bg-sky-400/40" aria-hidden />
          )}
          {prefs.showBaselineGrid && (
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage: `repeating-linear-gradient(to bottom, hsl(var(--primary) / 0.12) 0 1px, transparent 1px ${Math.round(pageHeightIn * 96 * (book.theme.lineHeight / book.fonts.baseSize) * 0.24)}px)`,
              }}
              aria-hidden
            />
          )}
          {overflow?.overflow && (
            <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-left gap-1 bg-amber-500/95 px-2 py-0.5 text-2xs font-medium text-amber-950">
              <AlertTriangle className="h-3 w-3" />
              Text overflows this page by {Math.round(overflow.overflowRatio * 100)}%
              {canAutoFlow && (
                <Button size="xs" variant="outline" className="ml-1 h-5 border-amber-900/40 px-1.5 text-2xs" onClick={(event) => { event.stopPropagation(); onAutoFlow(); }}>
                  Continue on a new page
                </Button>
              )}
            </div>
          )}
          {guides.x !== undefined && <div className="pointer-events-none absolute top-0 h-full w-px bg-primary" style={{ left: `${guides.x}%` }} />}
          {guides.y !== undefined && <div className="pointer-events-none absolute left-0 h-px w-full bg-primary" style={{ top: `${guides.y}%` }} />}

          {page.layout === 'flow' || page.layout === 'title' ? (
            <div
              className="h-full w-full"
              style={{
                paddingTop: `${(margin.top / (book.orientation === 'landscape' ? book.trimSize.widthIn : book.trimSize.heightIn)) * 100}%`,
                paddingBottom: `${(margin.bottom / (book.orientation === 'landscape' ? book.trimSize.widthIn : book.trimSize.heightIn)) * 100}%`,
                paddingLeft: `${(margin.left / (book.orientation === 'landscape' ? book.trimSize.heightIn : book.trimSize.widthIn)) * 100}%`,
                paddingRight: `${(margin.right / (book.orientation === 'landscape' ? book.trimSize.heightIn : book.trimSize.widthIn)) * 100}%`,
                fontFamily: book.fonts.body,
                fontSize: book.fonts.baseSize,
                lineHeight: book.theme.lineHeight,
                color: '#111827',
              }}
            >
              {/* Images that wrap: real floats inside the text column, so the browser
                  reflows the prose around them and the pagination engine measures the
                  same layout the reader will see. */}
              {wrappingElements(page).filter((element) => !isStacked(element)).map((element) => {
                const side = floatSide(element);
                const floatStyle: React.CSSProperties & Record<string, string | number> = {
                  float: side,
                  width: `${element.w}%`,
                  height: `${Math.round((element.h / 100) * pageHeightIn * 96)}px`,
                  margin: side === 'left' ? '0 0.75em 0.75em 0' : '0 0 0.75em 0.75em',
                  marginTop: `${Math.max(0, element.y - 6)}%`,
                  opacity: editable ? 0 : Number(element.image?.opacity ?? 1),
                };
                if ((element.wrap ?? 'square') === 'tight') {
                  floatStyle.shapeOutside = 'inset(0 round 8px)';
                  floatStyle.shapeMargin = '0.35em';
                }
                return (
                  <TableCellContext.Provider key={`float-${element.id}`} value={tableBinding}>
                    <div data-float-anchor={element.id} className="pointer-events-none" style={floatStyle} aria-hidden={editable}>
                      {!editable && <ElementRenderer element={{ ...element, x: 0, y: 0, w: 100, h: 100, rotation: 0 }} />}
                    </div>
                  </TableCellContext.Provider>
                );
              })}
              <div className="relative z-10 h-full w-full" style={editable ? undefined : { position: 'relative' }}>
                {editable && !designMode ? (
                  <FlowEditor page={page} onContentChange={onContentChange} registerEditor={handleRegisterEditor} />
                ) : (
                  <div className="ProseMirror" dangerouslySetInnerHTML={{ __html: page.content || '<p class="text-muted-foreground italic">This page is empty.</p>' }} />
                )}
              </div>
              {/* Absolutely placed art that does not float: behind or in front of the text. */}
              {page.elements.filter((element) => element.visible && !wrappingElements(page).some((wrapEl) => wrapEl.id === element.id) && element.type !== 'pageNumber').map((element) => (
                <TableCellContext.Provider key={element.id} value={tableBinding}>
                  <ElementRenderer element={{ ...element, z: isBehindText(element) || (element.wrap ?? 'square') === 'none' ? -1 : 5 }} />
                </TableCellContext.Provider>
              ))}
            </div>
          ) : null}

          {isDesign && (
            <div className="absolute inset-0">
              {page.content && page.layout === 'blank' && (
                <div className="pointer-events-none absolute inset-x-0 top-0 p-4 text-2xs text-muted-foreground">{page.content.replace(/<[^>]+>/g, ' ').slice(0, 120)}</div>
              )}
              {[...page.elements].sort((a, b) => (a.z ?? 0) - (b.z ?? 0)).map((element) => {
                const selected = element.id === selectedElementId;
                return (
                  <div
                    key={element.id}
                    onPointerDown={(event) => pointerDown(event, element, 'move')}
                    onClick={(event) => { event.stopPropagation(); onSelectElement(element.id); }}
                    className={cn('group', editable && !element.locked && 'cursor-move')}
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: 'none',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: `${element.x}%`,
                        top: `${element.y}%`,
                        width: `${element.w}%`,
                        height: `${element.h}%`,
                        transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
                        outline: selected ? '1.5px solid hsl(var(--primary))' : undefined,
                        outlineOffset: 2,
                        pointerEvents: editable ? 'auto' : 'none',
                      }}
                    >
                      {!(designMode && page.layout !== 'canvas' && page.layout !== 'blank' && wrappingElements(page).some((entry) => entry.id === element.id && !isStacked(entry))) && (
                        <TableCellContext.Provider value={tableBinding}>
                          <ElementRenderer element={element} />
                        </TableCellContext.Provider>
                      )}
                      {selected && editable && canUseAdvancedEditor && (
                        <>
                          {(['nw', 'ne', 'sw', 'se'] as const).map((handle) => (
                            <span
                              key={handle}
                              onPointerDown={(event) => pointerDown(event, element, 'resize', handle)}
                              className={cn(
                                'absolute h-2.5 w-2.5 rounded-sm border border-primary bg-background',
                                handle === 'nw' && '-left-1.5 -top-1.5 cursor-nwse-resize',
                                handle === 'ne' && '-right-1.5 -top-1.5 cursor-nesw-resize',
                                handle === 'sw' && '-bottom-1.5 -left-1.5 cursor-nesw-resize',
                                handle === 'se' && '-bottom-1.5 -right-1.5 cursor-nwse-resize',
                              )}
                            />
                          ))}
                          <span
                            onPointerDown={(event) => pointerDown(event, element, 'rotate')}
                            className="absolute -top-7 left-1/2 -translate-x-1/2 cursor-grab rounded-full border border-primary bg-background p-1"
                            title="Rotate"
                          >
                            <RotateCw className="h-3 w-3 text-primary" />
                          </span>
                          <span className="absolute -bottom-7 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-2xs shadow-soft">
                            <span className="font-mono">{Math.round(element.x)},{Math.round(element.y)} · {Math.round(element.w)}×{Math.round(element.h)}</span>
                          </span>
                        </>
                      )}
                      {element.locked && (
                        <span className="absolute right-1 top-1 rounded bg-background/90 p-0.5"><Lock className="h-3 w-3 text-muted-foreground" /></span>
                      )}
                    </div>
                  </div>
                );
              })}
              {page.elements.length === 0 && editable && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="rounded-lg border border-dashed bg-background/70 px-4 py-2 text-center text-xs text-muted-foreground">
                    {isCanvasLayout ? 'Design page — add text, images and shapes from the Elements panel' : 'No objects yet — add one from the Elements panel, then drag it anywhere on the page.'}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* header / footer */}
          {book.headerFooter.headerEnabled && (
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-6 pt-2 text-2xs uppercase tracking-widest text-muted-foreground" style={{ fontFamily: book.fonts.heading }}>
              <span>{book.headerFooter.headerLeft}</span>
              <span>{book.headerFooter.headerCenter}</span>
              <span>{book.headerFooter.headerRight}</span>
            </div>
          )}
          {book.headerFooter.footerEnabled && !(book.headerFooter.differentFirstPage && pageIndex === 0) && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between px-6 pb-2 text-2xs text-muted-foreground" style={{ fontFamily: book.fonts.body }}>
              <span>{book.headerFooter.footerLeft}</span>
              <span>{book.headerFooter.footerCenter}</span>
              <span>{book.headerFooter.footerRight}</span>
            </div>
          )}

          {/* page number */}
          {pageNumberLabel && book.numbering.position !== 'none' && (
            <div
              className="pointer-events-none absolute text-2xs text-muted-foreground"
              style={{
                fontFamily: book.fonts.body,
                bottom: book.numbering.position.startsWith('bottom') ? '1.2%' : undefined,
                top: book.numbering.position.startsWith('top') ? '1.2%' : undefined,
                left: book.numbering.position.endsWith('center') ? '50%' : book.numbering.position.endsWith('inner') ? (pageIndex % 2 === 0 ? '8%' : undefined) : undefined,
                right: book.numbering.position.endsWith('outer') ? '6%' : book.numbering.position.endsWith('inner') ? (pageIndex % 2 === 1 ? '8%' : undefined) : undefined,
                transform: book.numbering.position.endsWith('center') ? 'translateX(-50%)' : undefined,
              }}
            >
              {pageNumberLabel}
            </div>
          )}

          {page.notes && (
            <div className="pointer-events-none absolute bottom-1 left-1 flex items-center gap-1 rounded bg-amber-100/90 px-1.5 py-0.5 text-2xs text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
              <Bookmark className="h-2.5 w-2.5" /> note
            </div>
          )}

          <div className="pointer-events-none absolute right-1 top-1 flex items-center gap-1">
            <Badge variant="outline" className={cn('text-2xs', page.layout === 'flow' ? 'bg-background/80' : 'bg-background/80')}>{page.layout}</Badge>
            {page.locked && <Badge variant="secondary" className="text-2xs">locked</Badge>}
          </div>

          {/* element quick actions */}
          {selectedElementId && editable && canUseAdvancedEditor && isDesign && (
            <div className="absolute -bottom-11 left-1/2 -translate-x-1/2">
              <DropdownMenu
                trigger={<Button variant="outline" size="xs"><GripVertical className="h-3 w-3" /> Element</Button>}
                items={
                  [
                    ...elementMenu,
                    { id: 'lock', divider: true, label: '' },
                    {
                      id: 'toggle-lock',
                      label: page.elements.find((element) => element.id === selectedElementId)?.locked ? 'Unlock element' : 'Lock element',
                      onSelect: () => onPatchElement(selectedElementId, { locked: !page.elements.find((element) => element.id === selectedElementId)?.locked }),
                    },
                  ] as MenuItemDef[]
                }
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function toRoman(value: number, upper: boolean) {
  const map: [number, string][] = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ];
  let remaining = value;
  let output = '';
  map.forEach(([amount, numeral]) => {
    while (remaining >= amount) {
      output += numeral;
      remaining -= amount;
    }
  });
  return upper ? output.toUpperCase() : output;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
