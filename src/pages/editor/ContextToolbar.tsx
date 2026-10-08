/**
 * Contextual toolbars.
 *
 * Instead of one overcrowded strip, the editor shows the toolbar that matches what is
 * selected: text (typography), image (image editing), shape/table (object), page
 * (page settings) or nothing (document toolbar). Every control performs a real
 * command on the shared document model — there are no decorative buttons.
 */
import * as React from 'react';
import type { Editor } from '@tiptap/react';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Baseline, Bold, CaseSensitive,
  ChevronDown, Columns2, Eraser, FlipHorizontal, FlipVertical, Heading1, Heading2,
  Highlighter, Image as ImageIcon, Indent, Italic, Link2, Link2Off, List, ListChecks,
  ListOrdered, Lock, Merge, Minus, MoveDown, MoveUp, Palette, Pilcrow, Plus, Quote, Redo2,
  Rows3, Scissors, ScissorsLineDashed, Sigma, SquareSplitHorizontal, Strikethrough, Subscript, Superscript,
  Table as TableIcon, Trash2, Type, Underline as UnderlineIcon, Undo2, Unlock, Wand2,
} from 'lucide-react';
import { Badge, Button, Input, Label, Separator, Slider, Switch } from '@/components/ui/primitives';
import { DropdownMenu, Popover, type MenuItemDef } from '@/components/ui/overlays';
import { cn } from '@/lib/utils';
import { FONTS } from '@/data/constants';
import { paletteById } from '@/lib/coverArt';
import type { Book, BookPage, BookTextStyle, ElementType, PageElement } from '@/types/domain';
import { TEXT_EFFECT_PRESETS, applyStyleToContent, detectStyleName, findStyle } from './textStyles';
import { WRAP_OPTIONS } from './flow';

/* ------------------------------------------------------------------ helpers */

export const TEXT_COLORS = [
  '#111827', '#374151', '#6b7280', '#9ca3af', '#ffffff',
  '#7f1d1d', '#b91c1c', '#c2410c', '#b45309', '#a16207',
  '#166534', '#0f766e', '#0e7490', '#1d4ed8', '#4338ca',
  '#6d28d9', '#a21caf', '#be185d', '#e11d48', '#0b1220',
];

export const HIGHLIGHTS = ['#fef08a', '#fde68a', '#fdba74', '#fecaca', '#e9d5ff', '#bfdbfe', '#bbf7d0', '#e5e7eb'];

export function TextColorControl({
  value,
  onChange,
  recent,
  themeColors,
  label,
  allowClear = true,
}: {
  value?: string;
  onChange: (color: string | undefined) => void;
  recent?: string[];
  themeColors?: string[];
  label: string;
  allowClear?: boolean;
}) {
  const [custom, setCustom] = React.useState(value ?? '#111827');
  const swatch = (title: string, colors: string[]) => (
    <div className="space-y-1">
      <p className="text-2xs font-medium text-muted-foreground">{title}</p>
      <div className="grid grid-cols-10 gap-1">
        {colors.map((color) => (
          <button
            key={`${title}-${color}`}
            type="button"
            title={color}
            aria-label={`${label}: ${color}`}
            onClick={() => onChange(color)}
            className={cn('h-4 w-4 rounded border transition-transform hover:scale-110', value === color && 'ring-2 ring-primary ring-offset-1')}
            style={{ background: color }}
          />
        ))}
      </div>
    </div>
  );
  return (
    <Popover
      trigger={
        <Button size="xs" variant="ghost" className="gap-1" aria-label={label}>
          <Palette className="h-3.5 w-3.5" />
          <span className="h-3 w-3 rounded-sm border" style={{ background: value ?? 'transparent' }} />
        </Button>
      }
    >
      <div className="w-56 space-y-3 p-1">
        <p className="text-2xs font-semibold">{label}</p>
        {swatch('Document colours', TEXT_COLORS.slice(0, 10))}
        {swatch('More colours', TEXT_COLORS.slice(10))}
        {recent?.length ? swatch('Recent', recent.slice(0, 10)) : null}
        {themeColors?.length ? swatch('Theme', themeColors.slice(0, 5)) : null}
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={custom}
            onChange={(event) => {
              setCustom(event.target.value);
              onChange(event.target.value);
            }}
            className="h-7 w-10 rounded border"
            aria-label={`${label} picker`}
          />
          <Input value={value ?? ''} onChange={(event) => onChange(event.target.value)} className="h-7 text-2xs" placeholder="#111827" />
        </div>
        {allowClear && <Button size="xs" variant="outline" className="w-full" onClick={() => onChange(undefined)}>Clear</Button>}
      </div>
    </Popover>
  );
}

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      size="xs"
      variant={active ? 'secondary' : 'ghost'}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className="px-1.5"
    >
      {children}
    </Button>
  );
}

const fontSizeOptions = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64];

/* ------------------------------------------------------------ text toolbar */

function TextToolbar({
  editor,
  book,
  page,
  onPatchPage,
  onBookChange,
  onPatchBook,
  recentColors,
  pushRecentColor,
  themeColors,
  onPageBreak,
}: {
  editor: Editor | null;
  book: Book;
  page: BookPage;
  onPatchPage: (patch: Partial<BookPage>) => void;
  onBookChange: (book: Book, message: string) => void;
  onPatchBook: (patch: Partial<Book>, message?: string) => void;
  recentColors: string[];
  pushRecentColor: (color: string) => void;
  themeColors: string[];
  onPageBreak?: () => void;
}) {
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [linkValue, setLinkValue] = React.useState('');
  const [customSize, setCustomSize] = React.useState('');
  const [paragraphSpacing, setParagraphSpacing] = React.useState(book.theme.paragraphSpacing ?? 0.6);
  const [lineHeight, setLineHeight] = React.useState(book.theme.lineHeight);
  const [letterSpacing, setLetterSpacing] = React.useState(0);
  const [indent, setIndent] = React.useState(book.theme.firstLineIndent ?? book.theme.paragraphIndent ?? 0);

  if (!editor) {
    return <p className="px-3 py-1.5 text-2xs text-muted-foreground">Open a text page to use the typography toolbar.</p>;
  }

  const activeStyleName = detectStyleName(editor.getHTML(), book.textStyles);
  const textColor = editor.getAttributes('textStyle').color as string | undefined;
  const highlightColor = editor.getAttributes('highlight').color as string | undefined;
  const currentFont = (editor.getAttributes('textStyle').fontFamily as string | undefined) ?? book.fonts.body;
  const currentSize = (editor.getAttributes('textStyle').fontSize as string | undefined) ?? `${book.fonts.baseSize}pt`;
  const currentWeight = (editor.getAttributes('textStyle').fontWeight as string | undefined) ?? '400';
  const currentCase = (editor.getAttributes('textStyle').textTransform as string | undefined) ?? 'none';
  const currentSpacing = (editor.getAttributes('textStyle').letterSpacing as string | undefined) ?? '0em';

  const applyTextStyle = (patch: Record<string, string | undefined>) => {
    const chain = editor.chain().focus();
    Object.entries(patch).forEach(([key, value]) => {
      if (value === undefined) chain.unsetMark('textStyle');
      else chain.setMark('textStyle', { [key]: value });
    });
    chain.run();
  };

  const styleItems: MenuItemDef[] = book.textStyles.map((style: BookTextStyle) => ({
    id: style.name,
    label: style.label,
    shortcut: style.appliesTo === 'heading' ? 'Heading' : undefined,
    onSelect: () => {
      // Apply the named style to the current block using the style's own attributes,
      // falling back to a matching tag when the block is plain.
      const tag = style.appliesTo === 'title' ? 'h1'
        : style.appliesTo === 'heading' ? (style.name === 'heading-1' ? 'h2' : 'h3')
          : style.appliesTo === 'quote' ? 'blockquote'
            : undefined;
      if (tag) editor.chain().focus().setNode(tag).run();
      else editor.chain().focus().setParagraph().run();
      applyTextStyle({
        fontFamily: style.fontFamily,
        fontSize: `${style.fontSize}pt`,
        fontWeight: String(style.fontWeight),
        lineHeight: String(style.lineHeight),
        textTransform: style.textTransform,
        letterSpacing: `${style.letterSpacing}em`,
        color: style.color,
        styleName: style.name,
      });
    },
  }));

  const updateStyle = (patch: Partial<BookTextStyle>, applyGlobally: boolean) => {
    const next = book.textStyles.map((style) => (style.name === activeStyleName ? { ...style, ...patch } : style));
    let updated: Book = { ...book, textStyles: next };
    let message = 'Style updated for this selection';
    if (applyGlobally) {
      const style = next.find((entry) => entry.name === activeStyleName);
      if (style) {
        const result = applyStyleToContent(updated, style);
        updated = { ...updated, pages: result.pages };
        message = `Style applied to ${result.changed} match${result.changed === 1 ? '' : 'es'}`;
      }
    }
    onBookChange(updated, message);
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      <ToolButton label="Undo (Ctrl+Z)" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Redo (Ctrl+Shift+Z)" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 className="h-3.5 w-3.5" /></ToolButton>
      <Separator orientation="vertical" className="mx-1 h-4" />

      {/* paragraph / named style */}
      <DropdownMenu
        trigger={
          <Button size="xs" variant="outline" className="gap-1">
            <Pilcrow className="h-3.5 w-3.5" />
            {findStyle(book.textStyles, activeStyleName)?.label ?? 'Body'}
            <ChevronDown className="h-3 w-3" />
          </Button>
        }
        items={styleItems}
      />

      <DropdownMenu
        trigger={<Button size="xs" variant="ghost" className="gap-1" title="Font family"><Type className="h-3.5 w-3.5" /><ChevronDown className="h-3 w-3" /></Button>}
        items={[...FONTS.headings, ...FONTS.body].map((font) => ({
          id: font,
          label: font,
          onSelect: () => applyTextStyle({ fontFamily: font }),
        }))}
      />

      <DropdownMenu
        trigger={<Button size="xs" variant="ghost" title="Font size" className="gap-1">{currentSize.replace('pt', '')}<ChevronDown className="h-3 w-3" /></Button>}
        items={fontSizeOptions.map((size) => ({
          id: String(size),
          label: `${size} pt`,
          onSelect: () => applyTextStyle({ fontSize: `${size}pt` }),
        }))}
      />
      <Input
        value={customSize}
        onChange={(event) => setCustomSize(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && customSize) {
            applyTextStyle({ fontSize: `${Number(customSize)}pt` });
            setCustomSize('');
          }
        }}
        placeholder="pt"
        aria-label="Custom font size in points"
        className="h-7 w-14 text-2xs"
      />

      <DropdownMenu
        trigger={<Button size="xs" variant="ghost" title="Font weight" className="gap-1">{currentWeight}<ChevronDown className="h-3 w-3" /></Button>}
        items={[
          { id: '300', label: 'Light 300', onSelect: () => applyTextStyle({ fontWeight: '300' }) },
          { id: '400', label: 'Regular 400', onSelect: () => applyTextStyle({ fontWeight: '400' }) },
          { id: '500', label: 'Medium 500', onSelect: () => applyTextStyle({ fontWeight: '500' }) },
          { id: '600', label: 'Semibold 600', onSelect: () => applyTextStyle({ fontWeight: '600' }) },
          { id: '700', label: 'Bold 700', onSelect: () => applyTextStyle({ fontWeight: '700' }) },
          { id: '800', label: 'Extrabold 800', onSelect: () => applyTextStyle({ fontWeight: '800' }) },
        ]}
      />

      <Separator orientation="vertical" className="mx-1 h-4" />
      <ToolButton label="Bold (Ctrl+B)" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Italic (Ctrl+I)" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Underline (Ctrl+U)" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Superscript" active={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()}><Superscript className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Subscript" active={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()}><Subscript className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Code" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}><Sigma className="h-3.5 w-3.5" /></ToolButton>

      <TextColorControl label="Text colour" value={textColor} recent={recentColors} themeColors={themeColors} onChange={(color) => { if (color) pushRecentColor(color); applyTextStyle({ color }); }} />
      <Popover
        trigger={<Button size="xs" variant="ghost" title="Highlight" aria-label="Highlight"><Highlighter className="h-3.5 w-3.5" /></Button>}
      >
        <div className="w-48 space-y-2 p-1">
          <p className="text-2xs font-semibold">Highlight</p>
          <div className="grid grid-cols-8 gap-1">
            {HIGHLIGHTS.map((color) => (
              <button key={color} type="button" aria-label={`Highlight ${color}`} onClick={() => { pushRecentColor(color); editor.chain().focus().setHighlight({ color }).run(); }} className={cn('h-4 w-4 rounded border', highlightColor === color && 'ring-2 ring-primary')} style={{ background: color }} />
            ))}
          </div>
          <Button size="xs" variant="outline" className="w-full" onClick={() => editor.chain().focus().unsetHighlight().run()}>Remove highlight</Button>
        </div>
      </Popover>

      <Separator orientation="vertical" className="mx-1 h-4" />
      <ToolButton label="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}><AlignLeft className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Align centre" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}><AlignCenter className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}><AlignRight className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Justify" active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()}><AlignJustify className="h-3.5 w-3.5" /></ToolButton>

      <TextDirectionControl editor={editor} />

      <ToolButton label="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Checklist" active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Heading 1" active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Horizontal rule / scene break" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Drop cap on this paragraph" active={editor.isActive('paragraph') && /drop-cap/.test(editor.getHTML())} onClick={() => editor.chain().focus().toggleDropCap().run()}><CaseSensitive className="h-3.5 w-3.5" /></ToolButton>

      <Separator orientation="vertical" className="mx-1 h-4" />
      <Popover
        trigger={<Button size="xs" variant="ghost" title="Paragraph spacing and indents" aria-label="Paragraph spacing and indents"><Rows3 className="h-3.5 w-3.5" /></Button>}
      >
        <div className="w-60 space-y-3 p-1">
          <p className="text-2xs font-semibold">Paragraph &amp; spacing</p>
          <div className="space-y-1">
            <Label className="text-2xs">Line height — {lineHeight.toFixed(2)}</Label>
            <Slider value={lineHeight} min={0.9} max={2.4} step={0.01} onChange={(value) => { setLineHeight(value); onPatchBook({ theme: { ...book.theme, lineHeight: value } }, `Line height ${value.toFixed(2)}`); }} />
          </div>
          <div className="space-y-1">
            <Label className="text-2xs">Paragraph spacing — {paragraphSpacing.toFixed(2)}em</Label>
            <Slider value={paragraphSpacing} min={0} max={2} step={0.05} onChange={(value) => { setParagraphSpacing(value); onPatchBook({ theme: { ...book.theme, paragraphSpacing: value } }, `Paragraph spacing ${value.toFixed(2)}em`); }} />
          </div>
          <div className="space-y-1">
            <Label className="text-2xs">First-line indent — {indent.toFixed(2)}em</Label>
            <Slider value={indent} min={0} max={3} step={0.05} onChange={(value) => { setIndent(value); onPatchBook({ theme: { ...book.theme, firstLineIndent: value, paragraphIndent: value } }, `First-line indent ${value.toFixed(2)}em`); }} />
          </div>
          <div className="space-y-1">
            <Label className="text-2xs">Letter spacing — {currentSpacing}</Label>
            <Slider value={parseFloat(currentSpacing) || 0} min={-0.05} max={0.3} step={0.005} onChange={(value) => applyTextStyle({ letterSpacing: `${value.toFixed(3)}em` })} />
          </div>
          <div className="flex gap-1">
            <Button size="xs" variant="outline" className="flex-1" onClick={() => editor.chain().focus().indent().run()}><Indent className="h-3 w-3" /> Indent</Button>
            <Button size="xs" variant="outline" className="flex-1" onClick={() => editor.chain().focus().outdent().run()}><Indent className="h-3 w-3 -scale-x-100" /> Outdent</Button>
          </div>
        </div>
      </Popover>

      <DropdownMenu
        trigger={<Button size="xs" variant="ghost" title="Text case" aria-label="Text case"><CaseSensitive className="h-3.5 w-3.5" /></Button>}
        items={[
          { id: 'none', label: 'Normal', onSelect: () => applyTextStyle({ textTransform: 'none' }) },
          { id: 'upper', label: 'UPPERCASE', onSelect: () => applyTextStyle({ textTransform: 'uppercase' }) },
          { id: 'lower', label: 'lowercase', onSelect: () => applyTextStyle({ textTransform: 'lowercase' }) },
          { id: 'title', label: 'Capitalise Each Word', onSelect: () => applyTextStyle({ textTransform: 'capitalize' }) },
          { id: 'smallcaps', label: 'Small caps', onSelect: () => editor.chain().focus().toggleSmallCaps().run() },
        ]}
      />

      <Popover
        trigger={<Button size="xs" variant="ghost" title="Text effects" aria-label="Text effects"><Baseline className="h-3.5 w-3.5" /></Button>}
      >
        <div className="w-56 space-y-2 p-1">
          <p className="text-2xs font-semibold">Text effects</p>
          <div className="grid grid-cols-2 gap-1">
            {TEXT_EFFECT_PRESETS.map((preset) => (
              <Button key={preset.id} size="xs" variant="outline" onClick={() => applyTextStyle({ textShadow: 'shadow' in preset ? preset.shadow : undefined })}>
                {preset.label}
              </Button>
            ))}
          </div>
          <p className="text-2xs text-muted-foreground">Effects are stored on the text run and travel into exports.</p>
        </div>
      </Popover>

      <Popover
        trigger={
          <Button size="xs" variant="ghost" title="Hyperlink" aria-label="Hyperlink"><Link2 className="h-3.5 w-3.5" /></Button>
        }
      >
        <div className="w-60 space-y-2 p-1">
          <p className="text-2xs font-semibold">Link</p>
          <Input value={linkValue} onChange={(event) => setLinkValue(event.target.value)} placeholder="https://example.com" className="h-7 text-2xs" aria-label="Link target" />
          <div className="flex gap-1">
            <Button size="xs" className="flex-1" onClick={() => { const href = linkValue.trim(); if (!href) return; editor.chain().focus().extendMarkRange('link').setLink({ href }).run(); setLinkOpen(false); }}>Apply</Button>
            <Button size="xs" variant="outline" onClick={() => editor.chain().focus().unsetLink().run()}><Link2Off className="h-3 w-3" /> Remove</Button>
          </div>
        </div>
      </Popover>

      <ToolButton label="Clear formatting" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}><Eraser className="h-3.5 w-3.5" /></ToolButton>
      {onPageBreak && <ToolButton label="Insert page break" onClick={onPageBreak}><ScissorsLineDashed className="h-3.5 w-3.5" /></ToolButton>}

      <Separator orientation="vertical" className="mx-1 h-4" />
      <DropdownMenu
        trigger={<Button size="xs" variant="ghost" className="gap-1" title="Apply style to all matching content"><Wand2 className="h-3.5 w-3.5" /><ChevronDown className="h-3 w-3" /></Button>}
        items={[
          { id: 'here', label: 'Update style for this selection', onSelect: () => updateStyle({ fontSize: parseFloat(currentSize) || book.fonts.baseSize, fontFamily: currentFont, fontWeight: Number(currentWeight), color: textColor ?? '#111827' }, false) },
          { id: 'global', label: 'Apply to every matching paragraph in the book', onSelect: () => updateStyle({ fontSize: parseFloat(currentSize) || book.fonts.baseSize, fontFamily: currentFont, fontWeight: Number(currentWeight), color: textColor ?? '#111827' }, true) },
        ]}
      />
      <Badge variant="outline" className="text-2xs">{page.wordCount} words</Badge>
    </div>
  );
}

function TextDirectionControl({ editor }: { editor: Editor }) {
  const direction = (editor.getAttributes('paragraph').dir as 'ltr' | 'rtl' | undefined) ?? 'ltr';
  return (
    <Button
      size="xs"
      variant="ghost"
      title={`Text direction: ${direction.toUpperCase()}`}
      aria-label="Toggle text direction"
      onClick={() => editor.chain().focus().setTextDirection(direction === 'ltr' ? 'rtl' : 'ltr').run()}
    >
      <Columns2 className="h-3.5 w-3.5" /> {direction.toUpperCase()}
    </Button>
  );
}

/* ----------------------------------------------------------- image toolbar */

function ImageToolbar({
  element,
  onPatch,
  onDuplicate,
  onDelete,
  onReplace,
  onReorder,
  onToggleLock,
}: {
  element: PageElement;
  onPatch: (patch: Partial<PageElement>, options?: { transient?: boolean }) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onReplace: () => void;
  onReorder: (direction: 'up' | 'down' | 'front' | 'back') => void;
  onToggleLock: () => void;
}) {
  const image = element.image ?? {};
  const filters = image.filters ?? { grayscale: 0, sepia: 0, blur: 0, brightness: 100, contrast: 100 };
  const patchImage = (patch: Record<string, unknown>) => onPatch({ image: { ...image, ...patch } as PageElement['image'] });
  const patchFilters = (patch: Partial<typeof filters>) => patchImage({ filters: { ...filters, ...patch } });

  const crop = image.crop ?? { x: 0, y: 0, scale: 1 };

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge variant="secondary" className="text-2xs">Image · {element.name}</Badge>
      <ToolButton label="Replace image" onClick={onReplace}><ImageIcon className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Duplicate (Ctrl+D)" onClick={onDuplicate}><MoveUp className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label={element.locked ? 'Unlock object' : 'Lock object'} active={element.locked} onClick={onToggleLock}>
        {element.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
      </ToolButton>
      <ToolButton label="Send to back" onClick={() => onReorder('back')}><MoveDown className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Bring to front" onClick={() => onReorder('front')}><MoveUp className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Delete (Del)" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></ToolButton>
      <Separator orientation="vertical" className="mx-1 h-4" />

      <DropdownMenu
        trigger={<Button size="xs" variant="outline" className="gap-1">Wrap: {WRAP_OPTIONS.find((option) => option.value === (element.wrap ?? 'square'))?.label}<ChevronDown className="h-3 w-3" /></Button>}
        items={WRAP_OPTIONS.map((option) => ({
          id: option.value,
          label: `${option.label} — ${option.hint}`,
          onSelect: () => onPatch({ wrap: option.value }),
        }))}
      />

      <Popover trigger={<Button size="xs" variant="ghost" title="Crop" aria-label="Crop"><Scissors className="h-3.5 w-3.5" /></Button>}>
        <div className="w-56 space-y-2 p-1">
          <p className="text-2xs font-semibold">Crop &amp; zoom</p>
          {(['x', 'y', 'scale'] as const).map((axis) => (
            <div key={axis} className="space-y-1">
              <Label className="text-2xs">{axis === 'scale' ? 'Zoom' : `Offset ${axis.toUpperCase()}`}</Label>
              <Slider
                value={axis === 'scale' ? crop.scale : crop[axis] ?? 0}
                min={axis === 'scale' ? 1 : -50}
                max={axis === 'scale' ? 3 : 50}
                step={axis === 'scale' ? 0.01 : 1}
                onChange={(value) => patchImage({ crop: { ...crop, [axis]: value } })}
              />
            </div>
          ))}
          <div className="flex gap-1">
            <Button size="xs" variant="outline" className="flex-1" onClick={() => patchImage({ crop: { x: 0, y: 0, scale: 1 } })}>Reset crop</Button>
          </div>
        </div>
      </Popover>

      <Popover trigger={<Button size="xs" variant="ghost" title="Adjust" aria-label="Adjust"><Baseline className="h-3.5 w-3.5" /></Button>}>
        <div className="w-60 space-y-2 p-1">
          <p className="text-2xs font-semibold">Adjust</p>
          {([
            ['brightness', 0, 200, '%'],
            ['contrast', 0, 200, '%'],
            ['saturation', 0, 200, '%'],
            ['blur', 0, 12, 'px'],
            ['grayscale', 0, 100, '%'],
            ['sepia', 0, 100, '%'],
          ] as const).map(([key, min, max, unit]) => (
            <div key={key} className="space-y-1">
              <Label className="text-2xs capitalize">{key} — {key === 'saturation' ? (image.saturation ?? 100) : (filters as Record<string, number>)[key] ?? (key === 'brightness' || key === 'contrast' ? 100 : 0)}{unit}</Label>
              <Slider
                value={key === 'saturation' ? (image.saturation ?? 100) : (filters as Record<string, number>)[key] ?? (key === 'brightness' || key === 'contrast' ? 100 : 0)}
                min={min}
                max={max}
                step={1}
                onChange={(value) => (key === 'saturation' ? patchImage({ saturation: value }) : patchFilters({ [key]: value }))}
              />
            </div>
          ))}
          <Button size="xs" variant="outline" className="w-full" onClick={() => { patchFilters({ grayscale: 0, sepia: 0, blur: 0, brightness: 100, contrast: 100 }); patchImage({ saturation: 100 }); }}>
            <Wand2 className="h-3 w-3" /> Reset adjustments
          </Button>
        </div>
      </Popover>

      <Popover trigger={<Button size="xs" variant="ghost" title="Border and radius" aria-label="Border and radius"><SquareSplitHorizontal className="h-3.5 w-3.5" /></Button>}>
        <div className="w-56 space-y-2 p-1">
          <p className="text-2xs font-semibold">Frame</p>
          <div className="space-y-1">
            <Label className="text-2xs">Radius — {image.radius ?? 0}px</Label>
            <Slider value={image.radius ?? 0} min={0} max={64} step={1} onChange={(value) => patchImage({ radius: value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-2xs">Border — {image.borderWidth ?? 0}px</Label>
            <Slider value={image.borderWidth ?? 0} min={0} max={16} step={1} onChange={(value) => patchImage({ borderWidth: value })} />
          </div>
          <TextColorControl label="Border colour" value={image.borderColor ?? '#111827'} onChange={(color) => patchImage({ borderColor: color ?? '#111827' })} />
          <div className="flex items-center justify-between">
            <Label className="text-2xs">Drop shadow</Label>
            <Switch checked={Boolean(image.shadow)} onCheckedChange={(checked) => patchImage({ shadow: checked })} />
          </div>
          <div className="space-y-1">
            <Label className="text-2xs">Opacity — {Math.round((image.opacity ?? 1) * 100)}%</Label>
            <Slider value={(image.opacity ?? 1) * 100} min={5} max={100} step={1} onChange={(value) => patchImage({ opacity: value / 100 })} />
          </div>
          <div className="flex gap-1">
            <Button size="xs" variant="outline" className="flex-1" onClick={() => patchImage({ flipH: !image.flipH })}><FlipHorizontal className="h-3 w-3" /> Flip H</Button>
            <Button size="xs" variant="outline" className="flex-1" onClick={() => patchImage({ flipV: !image.flipV })}><FlipVertical className="h-3 w-3" /> Flip V</Button>
          </div>
        </div>
      </Popover>

      <DropdownMenu
        trigger={<Button size="xs" variant="ghost" title="Fit" aria-label="Image fit"><ChevronDown className="h-3 w-3" /></Button>}
        items={[
          { id: 'cover', label: 'Fill frame (cover)', onSelect: () => patchImage({ fit: 'cover' }) },
          { id: 'contain', label: 'Fit inside (contain)', onSelect: () => patchImage({ fit: 'contain' }) },
          { id: 'fill', label: 'Stretch (fill)', onSelect: () => patchImage({ fit: 'fill' }) },
        ]}
      />
    </div>
  );
}

/* ---------------------------------------------------------- object toolbar */

function ObjectToolbar({
  element,
  onPatch,
  onDuplicate,
  onDelete,
  onReorder,
  onToggleLock,
  onAlign,
  onDistribute,
}: {
  element: PageElement;
  onPatch: (patch: Partial<PageElement>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onReorder: (direction: 'up' | 'down' | 'front' | 'back') => void;
  onToggleLock: () => void;
  onAlign: (alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  onDistribute: (axis: 'horizontal' | 'vertical') => void;
}) {
  const style = element.style ?? {};
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge variant="secondary" className="text-2xs">{element.type} · {element.name}</Badge>
      <ToolButton label="Duplicate" onClick={onDuplicate}><MoveUp className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label={element.locked ? 'Unlock' : 'Lock'} active={element.locked} onClick={onToggleLock}>{element.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}</ToolButton>
      <ToolButton label="Send backward" onClick={() => onReorder('down')}><MoveDown className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Bring forward" onClick={() => onReorder('up')}><MoveUp className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Delete" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></ToolButton>
      <Separator orientation="vertical" className="mx-1 h-4" />
      {([
        ['left', 'Align left'],
        ['center', 'Align centre'],
        ['right', 'Align right'],
        ['top', 'Align top'],
        ['middle', 'Align middle'],
        ['bottom', 'Align bottom'],
      ] as const).map(([key, label]) => (
        <ToolButton key={key} label={label} onClick={() => onAlign(key)}>
          <span className="text-2xs font-semibold uppercase">{key.slice(0, 2)}</span>
        </ToolButton>
      ))}
      <ToolButton label="Distribute horizontally" onClick={() => onDistribute('horizontal')}><Columns2 className="h-3.5 w-3.5" /></ToolButton>
      <ToolButton label="Distribute vertically" onClick={() => onDistribute('vertical')}><Rows3 className="h-3.5 w-3.5" /></ToolButton>
      <Separator orientation="vertical" className="mx-1 h-4" />
      <TextColorControl label="Shape colour" value={style.color} onChange={(color) => onPatch({ style: { ...style, color } })} />
      <Popover trigger={<Button size="xs" variant="ghost" title="Opacity" aria-label="Opacity"><Baseline className="h-3.5 w-3.5" /></Button>}>
        <div className="w-48 space-y-2 p-1">
          <Label className="text-2xs">Opacity — {Math.round((style.opacity ?? 1) * 100)}%</Label>
          <Slider value={(style.opacity ?? 1) * 100} min={5} max={100} step={1} onChange={(value) => onPatch({ style: { ...style, opacity: value / 100 } })} />
        </div>
      </Popover>
    </div>
  );
}

/* ------------------------------------------------------------ table toolbar */

function TableToolbar({
  element,
  onPatch,
  onDelete,
}: {
  element: PageElement;
  onPatch: (patch: Partial<PageElement>) => void;
  onDelete: () => void;
}) {
  const table = element.table ?? { rows: 3, cols: 3, cells: [], headerRow: true, borderColor: '#d4d4d8' };
  const ensureCells = (rows: number, cols: number, cells: string[][]) => {
    const next = Array.from({ length: rows }, (_, row) =>
      Array.from({ length: cols }, (_, col) => cells[row]?.[col] ?? ''),
    );
    return next;
  };
  const setSize = (rows: number, cols: number) => onPatch({ table: { ...table, rows, cols, cells: ensureCells(rows, cols, table.cells) } });
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge variant="secondary" className="text-2xs"><TableIcon className="mr-1 inline h-3 w-3" />{table.rows}×{table.cols} table</Badge>
      <ToolButton label="Add row" onClick={() => setSize(table.rows + 1, table.cols)}><Plus className="h-3.5 w-3.5" /> Row</ToolButton>
      <ToolButton label="Remove row" onClick={() => setSize(Math.max(1, table.rows - 1), table.cols)}><Minus className="h-3.5 w-3.5" /> Row</ToolButton>
      <ToolButton label="Add column" onClick={() => setSize(table.rows, table.cols + 1)}><Plus className="h-3.5 w-3.5" /> Col</ToolButton>
      <ToolButton label="Remove column" onClick={() => setSize(table.rows, Math.max(1, table.cols - 1))}><Minus className="h-3.5 w-3.5" /> Col</ToolButton>
      <ToolButton label="Merge cells" onClick={() => onPatch({ table: { ...table, merged: [...(table.merged ?? []), '0,0'], cells: table.cells } })}><Merge className="h-3.5 w-3.5" /></ToolButton>
      <span className="flex items-center gap-1">
        <Label className="text-2xs">Header row</Label>
        <Switch checked={table.headerRow} onCheckedChange={(checked) => onPatch({ table: { ...table, headerRow: checked } })} />
      </span>
      <TextColorControl label="Border colour" value={table.borderColor} onChange={(color) => onPatch({ table: { ...table, borderColor: color ?? '#d4d4d8' } })} />
      <Input
        value={table.caption ?? ''}
        onChange={(event) => onPatch({ table: { ...table, caption: event.target.value } })}
        placeholder="Table caption"
        aria-label="Table caption"
        className="h-7 w-40 text-2xs"
      />
      <ToolButton label="Delete table" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></ToolButton>
    </div>
  );
}

/* ------------------------------------------------------------------ switch */

export interface ContextToolbarProps {
  mode: 'write' | 'design' | 'preview' | 'cover';
  editor: Editor | null;
  book: Book;
  page?: BookPage;
  selectedElements: PageElement[];
  clipboardCount: number;
  onPatchPage: (patch: Partial<BookPage>) => void;
  onPatchElement: (elementId: string, patch: Partial<PageElement>, options?: { transient?: boolean }) => void;
  onBookChange: (book: Book, message: string) => void;
  onPatchBook: (patch: Partial<Book>, message?: string) => void;
  onDuplicateElement: (elementId: string) => void;
  onDeleteElement: (elementId: string) => void;
  onReorderElement: (elementId: string, direction: 'up' | 'down' | 'front' | 'back') => void;
  onReplaceElement: (elementId: string) => void;
  onAlign: (alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  onDistribute: (axis: 'horizontal' | 'vertical') => void;
  recentColors: string[];
  pushRecentColor: (color: string) => void;
  /** Split the page at the cursor so the rest flows onto a new page. */
  onPageBreak?: () => void;
  /** Insert a blank page after this one. */
  onInsertBlankPage?: () => void;
}

export function ContextToolbar(props: ContextToolbarProps) {
  const { mode, editor, page, selectedElements, book } = props;
  const primary = selectedElements[0];
  const themeColors = React.useMemo(() => {
    const palette = paletteById(book.theme.palette);
    return [palette.colors[0], palette.colors[1], palette.colors[2], palette.accent, book.theme.accentColor];
  }, [book.theme.palette, book.theme.accentColor]);

  if (mode === 'preview') {
    return <p className="px-3 py-1.5 text-2xs text-muted-foreground">Preview follows the same document model as the editor — switch to Write or Design to edit.</p>;
  }

  if (selectedElements.length > 1) {
    return (
      <div className="flex items-center gap-2 px-1">
        <Badge variant="secondary" className="text-2xs">{selectedElements.length} objects selected</Badge>
        {(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map((key) => (
          <Button key={key} size="xs" variant="ghost" onClick={() => props.onAlign(key)} className="uppercase">{key.slice(0, 2)}</Button>
        ))}
        <Button size="xs" variant="ghost" onClick={() => props.onDistribute('horizontal')}><Columns2 className="h-3.5 w-3.5" /> Distribute H</Button>
        <Button size="xs" variant="ghost" onClick={() => props.onDistribute('vertical')}><Rows3 className="h-3.5 w-3.5" /> Distribute V</Button>
        {props.clipboardCount > 0 && <span className="text-2xs text-muted-foreground">{props.clipboardCount} on the clipboard</span>}
      </div>
    );
  }

  if (primary?.type === 'image') {
    return (
      <ImageToolbar
        element={primary}
        onPatch={(patch, options) => props.onPatchElement(primary.id, patch, options)}
        onDuplicate={() => props.onDuplicateElement(primary.id)}
        onDelete={() => props.onDeleteElement(primary.id)}
        onReplace={() => props.onReplaceElement(primary.id)}
        onReorder={(direction) => props.onReorderElement(primary.id, direction)}
        onToggleLock={() => props.onPatchElement(primary.id, { locked: !primary.locked })}
      />
    );
  }

  if (primary?.type === 'table') {
    return <TableToolbar element={primary} onPatch={(patch) => props.onPatchElement(primary.id, patch)} onDelete={() => props.onDeleteElement(primary.id)} />;
  }

  if (primary) {
    return (
      <ObjectToolbar
        element={primary}
        onPatch={(patch) => props.onPatchElement(primary.id, patch)}
        onDuplicate={() => props.onDuplicateElement(primary.id)}
        onDelete={() => props.onDeleteElement(primary.id)}
        onReorder={(direction) => props.onReorderElement(primary.id, direction)}
        onToggleLock={() => props.onPatchElement(primary.id, { locked: !primary.locked })}
        onAlign={props.onAlign}
        onDistribute={props.onDistribute}
      />
    );
  }

  if (!page) return <p className="px-3 py-1.5 text-2xs text-muted-foreground">No page selected.</p>;

  // Nothing selected: in Write mode the typography toolbar edits the caret's block;
  // in Design mode we show page settings instead.
  if (mode === 'write' && (page.layout === 'flow' || page.layout === 'title')) {
    return (
      <TextToolbar
        editor={editor}
        book={book}
        page={page}
        onPatchPage={props.onPatchPage}
        onBookChange={props.onBookChange}
        onPatchBook={props.onPatchBook}
        recentColors={props.recentColors}
        pushRecentColor={props.pushRecentColor}
        themeColors={themeColors}
        onPageBreak={props.onPageBreak}
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge variant="secondary" className="text-2xs">{mode === 'design' ? 'Page settings' : 'Document'}</Badge>
      <span className="flex items-center gap-1 text-2xs">
        <Label className="text-2xs">Layout</Label>
        <DropdownMenu
          trigger={<Button size="xs" variant="ghost" className="gap-1">{page.layout}<ChevronDown className="h-3 w-3" /></Button>}
          items={[
            { id: 'flow', label: 'Flow — long-form text that paginates', onSelect: () => props.onPatchPage({ layout: 'flow' }) },
            { id: 'title', label: 'Title page', onSelect: () => props.onPatchPage({ layout: 'title' }) },
            { id: 'blank', label: 'Blank — fully free design', onSelect: () => props.onPatchPage({ layout: 'blank' }) },
            { id: 'canvas', label: 'Canvas — free design with text box', onSelect: () => props.onPatchPage({ layout: 'canvas' }) },
          ]}
        />
      </span>
      <span className="flex items-center gap-1 text-2xs">
        <Label className="text-2xs">Numbering</Label>
        <DropdownMenu
          trigger={<Button size="xs" variant="ghost" className="gap-1">{page.numbering}<ChevronDown className="h-3 w-3" /></Button>}
          items={[
            { id: 'inherit', label: 'Inherit from book', onSelect: () => props.onPatchPage({ numbering: 'inherit' }) },
            { id: 'none', label: 'Hide number', onSelect: () => props.onPatchPage({ numbering: 'none' }) },
            { id: 'arabic', label: '1, 2, 3', onSelect: () => props.onPatchPage({ numbering: 'arabic' }) },
            { id: 'roman-lower', label: 'i, ii, iii', onSelect: () => props.onPatchPage({ numbering: 'roman-lower' }) },
            { id: 'roman-upper', label: 'I, II, III', onSelect: () => props.onPatchPage({ numbering: 'roman-upper' }) },
          ]}
        />
      </span>
      <span className="flex items-center gap-1">
        <Label className="text-2xs">Break before</Label>
        <Switch checked={Boolean(page.breakBefore)} onCheckedChange={(checked) => props.onPatchPage({ breakBefore: checked })} />
      </span>
      <span className="flex items-center gap-1">
        <Label className="text-2xs">Start on right page</Label>
        <Switch checked={Boolean(page.startOnRecto)} onCheckedChange={(checked) => props.onPatchPage({ startOnRecto: checked })} />
      </span>
      <span className="flex items-center gap-1">
        <Label className="text-2xs">Keep on one page</Label>
        <Switch checked={Boolean(page.keepTogether)} onCheckedChange={(checked) => props.onPatchPage({ keepTogether: checked })} />
      </span>
      <span className="flex items-center gap-1">
        <Label className="text-2xs">Page lock</Label>
        <Switch checked={page.locked} onCheckedChange={(checked) => props.onPatchPage({ locked: checked })} />
      </span>
      <span className="text-2xs text-muted-foreground">Trim {book.trimSize.label} · {book.orientation}</span>
    </div>
  );
}

export const OBJECT_TYPES: ElementType[] = ['text', 'image', 'shape', 'line', 'divider', 'icon', 'table', 'quote', 'decoration', 'barcode', 'pageNumber'];
