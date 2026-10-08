import * as React from 'react';
import {
  Plus,
  AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDown, ArrowUp, Bold, ChevronDown, ChevronUp, Copy, Eye, EyeOff, Italic, Layers, Lock, MoveDown, MoveUp, Printer, Trash2, Type, Unlock,
} from 'lucide-react';
import { Badge, Button, Checkbox, Input, Label, Select, Separator, Slider, Switch, Textarea } from '@/components/ui/primitives';
import { Tabs } from '@/components/ui/overlays';
import { FONTS, LANGUAGES, PAGE_PALETTES, PAPER_THICKNESS, TRIM_SIZES } from '@/data/constants';
import { bookService } from '@/services';
import { DEFAULT_TEXT_STYLES, initialiseTextStyles } from './textStyles';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import type { Book, BookPage, BookTextStyle, ElementType, Footnote, PageElement, TrimSize } from '@/types/domain';

interface Props {
  book: Book;
  page: BookPage | undefined;
  selectedElement: PageElement | undefined;
  canUseAdvancedEditor: boolean;
  canUsePrintProfiles: boolean;
  onPatchBook: (patch: Partial<Book>) => void;
  onPatchPage: (pageId: string, patch: Partial<BookPage>) => void;
  onPatchElement: (elementId: string, patch: Partial<PageElement>) => void;
  onReorderElement: (elementId: string, direction: 'up' | 'down' | 'front' | 'back') => void;
  onDeleteElement: (elementId: string) => void;
  onDuplicateElement: (elementId: string) => void;
  onRequestUpgrade: (feature: string) => void;
  onApplyStyle?: (style: BookTextStyle) => void;
  onAddFootnote?: (pageId: string, text: string, kind?: 'footnote' | 'endnote') => void;
  onPatchFootnote?: (footnoteId: string, patch: Partial<Footnote>) => void;
  onRemoveFootnote?: (footnoteId: string) => void;
  footnotesForPage?: (pageId: string) => Footnote[];
  onSelectElement?: (elementId: string | null) => void;
  onGroupElements?: (elementIds: string[]) => void;
  onUngroupElements?: (groupId: string) => void;
}

export function PropertiesPanel({
  book,
  page,
  selectedElement,
  canUseAdvancedEditor,
  canUsePrintProfiles,
  onPatchBook,
  onPatchPage,
  onPatchElement,
  onReorderElement,
  onDeleteElement,
  onDuplicateElement,
  onRequestUpgrade,
  onApplyStyle,
  onAddFootnote,
  onPatchFootnote,
  onRemoveFootnote,
  footnotesForPage,
  onSelectElement,
  onGroupElements,
  onUngroupElements,
}: Props) {
  const [tab, setTab] = React.useState<'page' | 'element' | 'book' | 'print'>('page');
  const [customTrim, setCustomTrim] = React.useState({ widthIn: book.trimSize.widthIn, heightIn: book.trimSize.heightIn, label: 'Custom' });

  React.useEffect(() => {
    if (selectedElement) setTab('element');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElement?.id]);

  const spine = bookService.spineWidth(book.id);
  const groupElements = onGroupElements ?? (() => undefined);
  const applyStyle = onApplyStyle ?? (() => undefined);
  const ungroupElements = onUngroupElements ?? (() => undefined);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b p-2">
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as typeof tab)}
          size="sm"
          tabs={[
            { value: 'page', label: 'Page' },
            { value: 'element', label: 'Element' },
            { value: 'book', label: 'Book' },
            { value: 'print', label: 'Print' },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin p-3">
        {tab === 'element' && (selectedElement && page ? (
          <ElementProperties
            element={selectedElement}
            page={page}
            canUseAdvancedEditor={canUseAdvancedEditor}
            onPatch={(patch) => onPatchElement(selectedElement.id, patch)}
            onReorder={(direction) => onReorderElement(selectedElement.id, direction)}
            onDelete={() => onDeleteElement(selectedElement.id)}
            onDuplicate={() => onDuplicateElement(selectedElement.id)}
            onRequestUpgrade={onRequestUpgrade}
          />
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Nothing selected. Click an element on a design page, or switch back to the Page tab for page-level styling.</p>
            {page && page.elements.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-2xs font-medium">Elements on this page</p>
                {page.elements.map((element) => (
                  <div key={element.id} className="flex items-center justify-between rounded border px-2 py-1 text-2xs">
                    <span className="truncate">{element.name}</span>
                    <Badge variant="outline" className="text-2xs">{element.type}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {tab === 'page' && (page ? (
          <PageProperties book={book} page={page} onPatchBook={onPatchBook} onPatchPage={(patch) => onPatchPage(page.id, patch)} />
        ) : (
          <p className="text-xs text-muted-foreground">No page selected.</p>
        ))}

        {tab === 'book' && <BookProperties book={book} onPatchBook={onPatchBook} onApplyStyle={applyStyle} onPatchPage={onPatchPage} />}

        {tab === 'print' && (
          <PrintProperties
            book={book}
            spineWidth={spine.widthIn}
            paperThickness={PAPER_THICKNESS[book.paperStock]}
            pages={spine.pages}
            canUsePrintProfiles={canUsePrintProfiles}
            customTrim={customTrim}
            setCustomTrim={setCustomTrim}
            onPatchBook={onPatchBook}
            onRequestUpgrade={onRequestUpgrade}
          />
        )}

        {page && page.elements.length > 0 && tab !== 'element' && (
          <>
            <Separator />
            <LayersList
              page={page}
              selectedElementId={selectedElement?.id ?? null}
              onReorder={onReorderElement}
              onPatchElement={(elementId, patch) => onPatchElement(elementId, patch)}
              onSelectElement={(elementId) => { onSelectElement?.(elementId); if (elementId) setTab('element'); }}
              onGroup={groupElements}
              onUngroup={ungroupElements}
            />
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- element tab */

function ElementProperties({
  element,
  page,
  canUseAdvancedEditor,
  onPatch,
  onReorder,
  onDelete,
  onDuplicate,
  onRequestUpgrade,
}: {
  element: PageElement;
  page: BookPage;
  canUseAdvancedEditor: boolean;
  onPatch: (patch: Partial<PageElement>) => void;
  onReorder: (direction: 'up' | 'down' | 'front' | 'back') => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onRequestUpgrade: (feature: string) => void;
}) {
  const style = element.style ?? {};
  const patchStyle = (patch: Partial<NonNullable<PageElement['style']>>) => onPatch({ style: { ...style, ...patch } });
  const gate = () => {
    if (!canUseAdvancedEditor) {
      onRequestUpgrade('advanced');
      return false;
    }
    return true;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{element.name}</p>
          <p className="text-2xs text-muted-foreground">{element.type} · z {element.z ?? 0}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="xs" onClick={() => onPatch({ locked: !element.locked })} aria-label="Toggle lock">
            {element.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => onPatch({ visible: !element.visible })} aria-label="Toggle visibility">
            {element.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Name" value={element.name} onChange={(value) => onPatch({ name: value })} text />
        <NumberField label="Rotation °" value={element.rotation} onChange={(value) => onPatch({ rotation: value })} />
        <NumberField label="X %" value={element.x} onChange={(value) => onPatch({ x: value })} />
        <NumberField label="Y %" value={element.y} onChange={(value) => onPatch({ y: value })} />
        <NumberField label="Width %" value={element.w} onChange={(value) => onPatch({ w: value })} />
        <NumberField label="Height %" value={element.h} onChange={(value) => onPatch({ h: value })} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Button size="xs" variant="outline" onClick={() => onReorder('front')}>Bring to front</Button>
        <Button size="xs" variant="outline" onClick={() => onReorder('back')}>Send to back</Button>
        <Button size="xs" variant="outline" onClick={() => onReorder('up')}>Up</Button>
        <Button size="xs" variant="outline" onClick={() => onReorder('down')}>Down</Button>
      </div>

      {(element.type === 'text' || element.type === 'quote' || element.type === 'pageNumber') && (
        <>
          <Separator />
          <p className="text-2xs font-medium">Typography</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2 space-y-1">
              <Label htmlFor="el-font" className="text-2xs">Font</Label>
              <Select
                id="el-font"
                value={style.fontFamily ?? FONTS.body[0]}
                onChange={(event) => patchStyle({ fontFamily: event.target.value })}
                className="h-8 text-xs"
              >
                <optgroup label="Headings">
                  {FONTS.headings.map((font) => <option key={font} value={font}>{font}</option>)}
                </optgroup>
                <optgroup label="Body">
                  {FONTS.body.map((font) => <option key={font} value={font}>{font}</option>)}
                </optgroup>
              </Select>
            </div>
            <NumberField label="Size px" value={style.fontSize ?? 14} onChange={(value) => patchStyle({ fontSize: value })} />
            <div className="space-y-1">
              <Label htmlFor="el-weight" className="text-2xs">Weight</Label>
              <Select id="el-weight" value={String(style.fontWeight ?? 400)} onChange={(event) => patchStyle({ fontWeight: Number(event.target.value) })} className="h-8 text-xs">
                {FONTS.weights.map((weight) => <option key={weight} value={weight}>{weight}</option>)}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="el-colour" className="text-2xs">Colour</Label>
              <input id="el-colour" type="color" value={style.color ?? '#111827'} onChange={(event) => patchStyle({ color: event.target.value })} className="h-8 w-full rounded border" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="el-transform" className="text-2xs">Transform</Label>
              <Select id="el-transform" value={style.textTransform ?? 'none'} onChange={(event) => patchStyle({ textTransform: event.target.value as NonNullable<typeof style.textTransform> })} className="h-8 text-xs">
                {['none', 'uppercase', 'lowercase', 'capitalize'].map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {([
              ['bold', <Bold key="b" className="h-3.5 w-3.5" />, () => patchStyle({ fontWeight: (style.fontWeight ?? 400) >= 600 ? 400 : 700 })],
              ['italic', <Italic key="i" className="h-3.5 w-3.5" />, () => patchStyle({ italic: !style.italic })],
              ['underline', <Type key="u" className="h-3.5 w-3.5" />, () => patchStyle({ underline: !style.underline })],
              ['left', <AlignLeft key="l" className="h-3.5 w-3.5" />, () => patchStyle({ align: 'left' })],
              ['center', <AlignCenter key="c" className="h-3.5 w-3.5" />, () => patchStyle({ align: 'center' })],
              ['right', <AlignRight key="r" className="h-3.5 w-3.5" />, () => patchStyle({ align: 'right' })],
              ['justify', <AlignJustify key="j" className="h-3.5 w-3.5" />, () => patchStyle({ align: 'justify' })],
              ['strike', <span key="s" className="text-xs line-through">S</span>, () => patchStyle({ strikethrough: !style.strikethrough })],
            ] as const).map(([id, icon, run]) => (
              <button key={id} type="button" onClick={() => gate() && run()} aria-label={id} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                {icon}
              </button>
            ))}
          </div>
          <Slider label="Line height" value={style.lineHeight ?? 1.5} min={1} max={2.4} step={0.05} onChange={(value) => patchStyle({ lineHeight: value })} format={(value) => value.toFixed(2)} />
          <Slider label="Letter spacing" value={style.letterSpacing ?? 0} min={-2} max={8} step={0.5} onChange={(value) => patchStyle({ letterSpacing: value })} format={(value) => `${value}px`} />
          <Slider label="Opacity" value={style.opacity ?? 1} min={0.1} max={1} step={0.05} onChange={(value) => patchStyle({ opacity: value })} format={(value) => `${Math.round(value * 100)}%`} />
          <div className="space-y-1">
            <Label htmlFor="el-columns" className="text-2xs">Columns</Label>
            <Select id="el-columns" value={String(style.columns ?? 1)} onChange={(event) => patchStyle({ columns: Number(event.target.value) })} className="h-8 text-xs">
              {[1, 2, 3].map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
          </div>
          <Separator />
          <div className="space-y-1">
            <Label htmlFor="el-text" className="text-2xs">Content (HTML allowed)</Label>
            <Textarea id="el-text" rows={4} value={element.text ?? ''} onChange={(event) => onPatch({ text: event.target.value })} className="text-xs" />
          </div>
        </>
      )}

      {element.type === 'image' && (
        <>
          <Separator />
          <p className="text-2xs font-medium">Image</p>
          <div className="space-y-1">
            <Label htmlFor="el-src" className="text-2xs">Source URL</Label>
            <Input id="el-src" value={element.image?.src ?? ''} onChange={(event) => onPatch({ image: { ...element.image, src: event.target.value } })} className="h-8 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="el-fit" className="text-2xs">Fit</Label>
              <Select id="el-fit" value={element.image?.fit ?? 'cover'} onChange={(event) => onPatch({ image: { ...element.image, fit: event.target.value as 'cover' | 'contain' | 'fill' } })} className="h-8 text-xs">
                {['cover', 'contain', 'fill'].map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            </div>
            <NumberField label="Radius px" value={element.image?.radius ?? 0} onChange={(value) => onPatch({ image: { ...element.image, radius: value } })} />
            <NumberField label="Border px" value={element.image?.borderWidth ?? 0} onChange={(value) => onPatch({ image: { ...element.image, borderWidth: value } })} />
            <div className="space-y-1">
              <Label htmlFor="el-border" className="text-2xs">Border colour</Label>
              <input id="el-border" type="color" value={element.image?.borderColor ?? '#111827'} onChange={(event) => onPatch({ image: { ...element.image, borderColor: event.target.value } })} className="h-8 w-full rounded border" />
            </div>
          </div>
          <label className="flex items-center justify-between text-xs">
            <span>Drop shadow</span>
            <Switch checked={Boolean(element.image?.shadow)} onCheckedChange={(checked) => onPatch({ image: { ...element.image, shadow: checked } })} />
          </label>
          <Slider label="Opacity" value={element.image?.opacity ?? 1} min={0.1} max={1} step={0.05} onChange={(value) => onPatch({ image: { ...element.image, opacity: value } })} format={(value) => `${Math.round(value * 100)}%`} />
          <div className="space-y-2">
            {([
              ['grayscale', 'Grayscale'],
              ['sepia', 'Sepia'],
              ['blur', 'Blur'],
              ['brightness', 'Brightness'],
              ['contrast', 'Contrast'],
            ] as const).map(([key, label]) => (
              <Slider
                key={key}
                label={label}
                value={element.image?.filters?.[key] ?? (key === 'brightness' || key === 'contrast' ? 100 : 0)}
                min={0}
                max={key === 'brightness' || key === 'contrast' ? 200 : 100}
                onChange={(value) => onPatch({ image: { ...element.image, filters: { ...(element.image?.filters ?? { grayscale: 0, sepia: 0, blur: 0, brightness: 100, contrast: 100 }), [key]: value } } })}
              />
            ))}
          </div>
        </>
      )}

      {element.type === 'shape' && (
        <>
          <Separator />
          <p className="text-2xs font-medium">Shape</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2 space-y-1">
              <Label htmlFor="shape-kind" className="text-2xs">Kind</Label>
              <Select id="shape-kind" value={element.shape?.kind ?? 'rect'} onChange={(event) => onPatch({ shape: { ...element.shape, kind: event.target.value as NonNullable<PageElement['shape']>['kind'] } })} className="h-8 text-xs">
                {['rect', 'ellipse', 'triangle', 'line', 'star', 'arrow'].map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="shape-fill" className="text-2xs">Fill</Label>
              <input id="shape-fill" type="color" value={toHex(element.shape?.fill)} onChange={(event) => onPatch({ shape: { ...element.shape, fill: event.target.value } })} className="h-8 w-full rounded border" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="shape-stroke" className="text-2xs">Stroke</Label>
              <input id="shape-stroke" type="color" value={toHex(element.shape?.stroke)} onChange={(event) => onPatch({ shape: { ...element.shape, stroke: event.target.value } })} className="h-8 w-full rounded border" />
            </div>
            <NumberField label="Stroke px" value={element.shape?.strokeWidth ?? 0} onChange={(value) => onPatch({ shape: { ...element.shape, strokeWidth: value } })} />
            <NumberField label="Radius px" value={element.shape?.radius ?? 0} onChange={(value) => onPatch({ shape: { ...element.shape, radius: value } })} />
          </div>
        </>
      )}

      {(element.type === 'divider' || element.type === 'line') && (
        <>
          <Separator />
          <p className="text-2xs font-medium">Divider</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="div-style" className="text-2xs">Style</Label>
              <Select id="div-style" value={element.divider?.style ?? 'solid'} onChange={(event) => onPatch({ divider: { ...element.divider, style: event.target.value as NonNullable<PageElement['divider']>['style'], color: element.divider?.color ?? '#111827', thickness: element.divider?.thickness ?? 1 } })} className="h-8 text-xs">
                {['solid', 'dashed', 'dotted', 'double', 'ornament'].map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            </div>
            <NumberField label="Thickness" value={element.divider?.thickness ?? 1} onChange={(value) => onPatch({ divider: { ...element.divider, thickness: value, style: element.divider?.style ?? 'solid', color: element.divider?.color ?? '#111827' } })} />
            <div className="col-span-2 space-y-1">
              <Label htmlFor="div-colour" className="text-2xs">Colour</Label>
              <input id="div-colour" type="color" value={toHex(element.divider?.color)} onChange={(event) => onPatch({ divider: { ...element.divider, color: event.target.value, style: element.divider?.style ?? 'solid', thickness: element.divider?.thickness ?? 1 } })} className="h-8 w-full rounded border" />
            </div>
          </div>
        </>
      )}

      {element.type === 'table' && element.table && (
        <>
          <Separator />
          <p className="text-2xs font-medium">Table</p>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Rows" value={element.table.rows} onChange={(value) => resizeTable(element, Math.max(1, Math.min(12, value)), element.table!.cols, onPatch)} />
            <NumberField label="Columns" value={element.table.cols} onChange={(value) => resizeTable(element, element.table!.rows, Math.max(1, Math.min(8, value)), onPatch)} />
          </div>
          <label className="flex items-center justify-between text-xs">
            <span>Header row</span>
            <Switch checked={element.table.headerRow} onCheckedChange={(checked) => onPatch({ table: { ...element.table!, headerRow: checked } })} />
          </label>
          <div className="space-y-1">
            <Label htmlFor="table-border" className="text-2xs">Border colour</Label>
            <input id="table-border" type="color" value={toHex(element.table.borderColor)} onChange={(event) => onPatch({ table: { ...element.table!, borderColor: event.target.value } })} className="h-8 w-full rounded border" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-2xs">Cells</Label>
            <div className="space-y-1">
              {Array.from({ length: element.table.rows }).map((_, row) => (
                <div key={row} className="flex gap-1">
                  {Array.from({ length: element.table!.cols }).map((__, col) => (
                    <Input
                      key={col}
                      value={element.table!.cells?.[row]?.[col] ?? ''}
                      onChange={(event) => {
                        const cells = Array.from({ length: element.table!.rows }).map((___, r) =>
                          Array.from({ length: element.table!.cols }).map((____, c) => element.table!.cells?.[r]?.[c] ?? ''),
                        );
                        cells[row][col] = event.target.value;
                        onPatch({ table: { ...element.table!, cells } });
                      }}
                      className="h-7 text-2xs"
                      aria-label={`Cell ${row + 1},${col + 1}`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {element.type === 'icon' && (
        <>
          <Separator />
          <div className="space-y-1">
            <Label htmlFor="icon-glyph" className="text-2xs">Glyph</Label>
            <Input id="icon-glyph" value={element.icon ?? '❖'} onChange={(event) => onPatch({ icon: event.target.value })} className="h-8 text-xs" />
          </div>
          <div className="flex flex-wrap gap-1">
            {['❖', '✦', '✧', '❧', '❦', '◆', '●', '▲', '★', '∞'].map((glyph) => (
              <button key={glyph} type="button" onClick={() => onPatch({ icon: glyph })} className="rounded border px-2 py-1 text-sm hover:border-primary/50">{glyph}</button>
            ))}
          </div>
        </>
      )}

      {element.type === 'barcode' && (
        <>
          <Separator />
          <div className="space-y-1">
            <Label htmlFor="barcode-text" className="text-2xs">ISBN</Label>
            <Input id="barcode-text" value={element.text ?? ''} onChange={(event) => onPatch({ text: event.target.value })} className="h-8 text-xs" />
          </div>
        </>
      )}

      <Separator />
      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" className="flex-1" onClick={onDuplicate}><Copy className="h-3.5 w-3.5" /> Duplicate</Button>
        <Button size="sm" variant="destructive" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- page tab */

function PageProperties({
  book, page, onPatchBook, onPatchPage, onAddFootnote, onPatchFootnote, onRemoveFootnote, footnotesForPage,
}: {
  book: Book;
  page: BookPage;
  onPatchBook: (patch: Partial<Book>) => void;
  onPatchPage: (patch: Partial<BookPage>) => void;
  onAddFootnote?: (pageId: string, text: string, kind?: 'footnote' | 'endnote') => void;
  onPatchFootnote?: (footnoteId: string, patch: Partial<Footnote>) => void;
  onRemoveFootnote?: (footnoteId: string) => void;
  footnotesForPage?: (pageId: string) => Footnote[];
}) {
  const [title, setTitle] = React.useState(page.title);
  const [noteDraft, setNoteDraft] = React.useState('');
  const notes = footnotesForPage?.(page.id) ?? (book.footnotes ?? []).filter((footnote) => footnote.pageId === page.id).sort((a, b) => a.number - b.number);
  React.useEffect(() => setTitle(page.title), [page.id, page.title]);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="page-title" className="text-2xs">Page title</Label>
        <Input
          id="page-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => onPatchPage({ title })}
          className="h-8 text-xs"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="page-layout" className="text-2xs">Layout</Label>
        <Select id="page-layout" value={page.layout} onChange={(event) => onPatchPage({ layout: event.target.value as BookPage['layout'] })} className="h-8 text-xs">
          <option value="flow">Text (flowing)</option>
          <option value="title">Title page</option>
          <option value="canvas">Design canvas</option>
          <option value="blank">Blank</option>
        </Select>
      </div>

      <label className="flex items-center justify-between text-xs">
        <span>Fixed page (no reflow)</span>
        <Switch checked={page.atomic} onCheckedChange={(checked) => onPatchPage({ atomic: checked })} />
      </label>
      <label className="flex items-center justify-between text-xs">
        <span>Lock page</span>
        <Switch checked={page.locked} onCheckedChange={(checked) => onPatchPage({ locked: checked })} />
      </label>

      <Separator />
      <p className="text-2xs font-medium">Background</p>
      <div className="space-y-2">
        <Select
          value={page.background.type}
          onChange={(event) => onPatchPage({ background: { ...page.background, type: event.target.value as typeof page.background.type } })}
          className="h-8 text-xs"
          aria-label="Background type"
        >
          {['none', 'color', 'gradient', 'image', 'pattern'].map((value) => <option key={value} value={value}>{value}</option>)}
        </Select>
        {page.background.type === 'color' && (
          <input type="color" value={page.background.value || '#ffffff'} onChange={(event) => onPatchPage({ background: { ...page.background, value: event.target.value } })} className="h-8 w-full rounded border" aria-label="Background colour" />
        )}
        {page.background.type === 'gradient' && (
          <div className="space-y-2">
            <input
              type="text"
              value={page.background.gradient ?? 'linear-gradient(135deg,#f8fafc,#e0e7ff)'}
              onChange={(event) => onPatchPage({ background: { ...page.background, gradient: event.target.value, value: event.target.value } })}
              className="h-8 w-full rounded border border-input bg-background px-2 text-2xs"
              aria-label="Gradient CSS"
            />
            <div className="flex flex-wrap gap-1">
              {[
                'linear-gradient(135deg,#f8fafc,#e0e7ff)',
                'linear-gradient(135deg,#fef3c7,#fde68a)',
                'linear-gradient(160deg,#0f172a,#1e293b)',
                'radial-gradient(circle at 30% 20%,#ede9fe,#f8fafc)',
              ].map((gradient) => (
                <button key={gradient} type="button" onClick={() => onPatchPage({ background: { ...page.background, gradient, value: gradient } })} className="h-7 w-10 rounded border" style={{ background: gradient }} aria-label={gradient} />
              ))}
            </div>
          </div>
        )}
        {page.background.type === 'image' && (
          <Input value={page.background.imageUrl ?? ''} onChange={(event) => onPatchPage({ background: { ...page.background, imageUrl: event.target.value } })} placeholder="Image URL" className="h-8 text-xs" aria-label="Background image URL" />
        )}
        {page.background.type === 'pattern' && (
          <div className="space-y-1">
            <Select
              value={page.background.value}
              onChange={(event) => onPatchPage({ background: { ...page.background, pattern: bookService.texture(event.target.value, book.theme.accentColor), value: event.target.value } })}
              className="h-8 text-xs"
              aria-label="Pattern"
            >
              {['dots', 'grid', 'diagonal', 'lines'].map((pattern) => <option key={pattern} value={pattern}>{pattern}</option>)}
            </Select>
            <p className="text-2xs text-muted-foreground">Patterns are rendered as tiling SVG data URLs by the service layer.</p>
          </div>
        )}
      </div>

      <Separator />
      <p className="text-2xs font-medium">Numbering</p>
      <Select value={page.numbering} onChange={(event) => onPatchPage({ numbering: event.target.value as BookPage['numbering'] })} className="h-8 text-xs" aria-label="Page numbering">
        <option value="inherit">Inherit from book</option>
        <option value="arabic">Arabic (1, 2, 3)</option>
        <option value="roman-lower">Roman lower (i, ii)</option>
        <option value="roman-upper">Roman upper (I, II)</option>
        <option value="none">No number</option>
      </Select>
      <Slider label="Start number" value={book.numbering.startAt} min={0} max={20} onChange={(value) => onPatchBook({ numbering: { ...book.numbering, startAt: value } })} />
      <Select value={book.numbering.position} onChange={(event) => onPatchBook({ numbering: { ...book.numbering, position: event.target.value as Book['numbering']['position'] } })} className="h-8 text-xs" aria-label="Number position">
        {['bottom-center', 'bottom-outer', 'bottom-inner', 'top-center', 'top-outer', 'none'].map((value) => <option key={value} value={value}>{value}</option>)}
      </Select>
      <label className="flex items-center justify-between text-xs">
        <span>Hide on first page</span>
        <Switch checked={book.numbering.hideOnFirstPage} onCheckedChange={(checked) => onPatchBook({ numbering: { ...book.numbering, hideOnFirstPage: checked } })} />
      </label>
      <label className="flex items-center justify-between text-xs">
        <span>Restart per section</span>
        <Switch checked={book.numbering.sectionBased} onCheckedChange={(checked) => onPatchBook({ numbering: { ...book.numbering, sectionBased: checked } })} />
      </label>

      <Separator />
      <div className="space-y-2">
        <p className="text-2xs font-medium">Footnotes & endnotes ({notes.length})</p>
        {notes.map((footnote) => (
          <div key={footnote.id} className="space-y-1 rounded border p-2">
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="text-2xs">{footnote.number}</Badge>
              <Select
                value={footnote.kind}
                onChange={(event) => onPatchFootnote?.(footnote.id, { kind: event.target.value as Footnote['kind'] })}
                className="h-7 flex-1 text-2xs"
                aria-label={`Note ${footnote.number} type`}
              >
                <option value="footnote">Footnote</option>
                <option value="endnote">Endnote</option>
              </Select>
              <Button size="xs" variant="ghost" aria-label={`Delete note ${footnote.number}`} onClick={() => onRemoveFootnote?.(footnote.id)}><Trash2 className="h-3 w-3" /></Button>
            </div>
            <Textarea
              rows={2}
              value={footnote.text}
              onChange={(event) => onPatchFootnote?.(footnote.id, { text: event.target.value })}
              className="text-xs"
              aria-label={`Note ${footnote.number} text`}
            />
          </div>
        ))}
        <Textarea
          rows={2}
          value={noteDraft}
          onChange={(event) => setNoteDraft(event.target.value)}
          placeholder="Add a footnote for this page…"
          className="text-xs"
          aria-label="New footnote text"
        />
        <Button
          size="xs"
          variant="outline"
          className="w-full"
          disabled={!noteDraft.trim()}
          onClick={() => { onAddFootnote?.(page.id, noteDraft.trim(), 'footnote'); setNoteDraft(''); }}
        >
          <Plus className="h-3 w-3" /> Insert footnote
        </Button>
        <p className="text-2xs text-muted-foreground">Numbering is automatic and sequential. Print keeps notes in the footer; reflowable EPUB moves them to endnotes.</p>
      </div>

      <Separator />
      <div className="space-y-1">
        <Label htmlFor="page-notes" className="text-2xs">Notes</Label>
        <Textarea id="page-notes" rows={3} value={page.notes} onChange={(event) => onPatchPage({ notes: event.target.value })} className="text-xs" placeholder="Private notes for this page" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ text styles */

function TextStyleEditor({
  book,
  onPatchBook,
  onApplyStyle,
}: {
  book: Book;
  onPatchBook: (patch: Partial<Book>) => void;
  onApplyStyle: (style: BookTextStyle) => void;
}) {
  const styles = initialiseTextStyles(book);
  const [openId, setOpenId] = React.useState<string | null>(null);

  const update = (id: string, patch: Partial<BookTextStyle>) => {
    onPatchBook({ textStyles: styles.map((style) => (style.id === id ? { ...style, ...patch } : style)) });
  };

  return (
    <div className="space-y-2">
      <p className="text-2xs font-medium">Typography styles</p>
      <p className="text-2xs text-muted-foreground">Edit a style once, then push it through the manuscript with “Update all matching content”.</p>
      {styles.map((style) => {
        const open = openId === style.id;
        return (
          <div key={style.id} className="rounded border">
            <button type="button" onClick={() => setOpenId(open ? null : style.id)} className="flex w-full items-center gap-2 px-2 py-1.5 text-left" aria-expanded={open}>
              <span className="min-w-0 flex-1 truncate text-xs font-medium" style={{ fontFamily: style.fontFamily, fontWeight: style.fontWeight, textTransform: style.textTransform }}>
                {style.label}
              </span>
              <span className="text-2xs text-muted-foreground">{style.fontSize}pt · {style.appliesTo}</span>
              {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            {open && (
              <div className="space-y-2 border-t p-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`${style.id}-font`} className="text-2xs">Font</Label>
                    <Select id={`${style.id}-font`} value={style.fontFamily} onChange={(event) => update(style.id, { fontFamily: event.target.value })} className="h-7 text-2xs">
                      {Array.from(new Set([...FONTS.headings, ...FONTS.body, 'Inter', 'Source Serif 4'])).map((font) => <option key={font} value={font}>{font}</option>)}
                    </Select>
                  </div>
                  <NumberField label="Size (pt)" value={style.fontSize} onChange={(value) => update(style.id, { fontSize: Number(value) })} />
                  <NumberField label="Weight" value={style.fontWeight} onChange={(value) => update(style.id, { fontWeight: Number(value) })} />
                  <NumberField label="Line height" value={style.lineHeight} onChange={(value) => update(style.id, { lineHeight: Number(value) })} />
                  <NumberField label="Letter spacing (em)" value={style.letterSpacing} onChange={(value) => update(style.id, { letterSpacing: Number(value) })} />
                  <NumberField label="Space after (em)" value={style.spaceAfter ?? 0} onChange={(value) => update(style.id, { spaceAfter: Number(value) })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`${style.id}-align`} className="text-2xs">Align</Label>
                    <Select id={`${style.id}-align`} value={style.align} onChange={(event) => update(style.id, { align: event.target.value as BookTextStyle['align'] })} className="h-7 text-2xs">
                      {(['left', 'center', 'right', 'justify'] as const).map((value) => <option key={value} value={value}>{value}</option>)}
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`${style.id}-case`} className="text-2xs">Text case</Label>
                    <Select id={`${style.id}-case`} value={style.textTransform} onChange={(event) => update(style.id, { textTransform: event.target.value as BookTextStyle['textTransform'] })} className="h-7 text-2xs">
                      {(['none', 'uppercase', 'lowercase', 'capitalize'] as const).map((value) => <option key={value} value={value}>{value}</option>)}
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`${style.id}-colour`} className="text-2xs">Colour</Label>
                    <input id={`${style.id}-colour`} type="color" value={toHex(style.color)} onChange={(event) => update(style.id, { color: event.target.value })} className="h-7 w-full rounded border" aria-label={`${style.label} colour`} />
                  </div>
                  <div className="flex items-end gap-2 pb-1">
                    <Checkbox label="Italic" checked={Boolean(style.italic)} onChange={(event) => update(style.id, { italic: (event.target as HTMLInputElement).checked })} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Checkbox label="Keep with next" checked={Boolean(style.keepWithNext)} onChange={(event) => update(style.id, { keepWithNext: (event.target as HTMLInputElement).checked })} />
                  <Checkbox label="Start on new page" checked={Boolean(style.pageBreakBefore)} onChange={(event) => update(style.id, { pageBreakBefore: (event.target as HTMLInputElement).checked })} />
                </div>
                <div className="flex gap-1.5">
                  <Button size="xs" variant="outline" className="flex-1" onClick={() => onApplyStyle(style)}>Update all matching content</Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      const fallback = DEFAULT_TEXT_STYLES.find((entry) => entry.name === style.name);
                      if (fallback) update(style.id, { ...fallback, id: style.id });
                    }}
                  >
                    Reset
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- book tab */

function BookProperties({ book, onPatchBook, onApplyStyle, onPatchPage }: { book: Book; onPatchBook: (patch: Partial<Book>) => void; onApplyStyle: (style: BookTextStyle) => void; onPatchPage: (pageId: string, patch: Partial<BookPage>) => void }) {
  const [meta, setMeta] = React.useState(book.metadata);
  React.useEffect(() => setMeta(book.metadata), [book.metadata]);

  return (
    <div className="space-y-4">
      <TextStyleEditor book={book} onPatchBook={onPatchBook} onApplyStyle={onApplyStyle} />
      <Separator />
      <p className="text-2xs font-medium">Book details</p>
      <div className="space-y-1">
        <Label htmlFor="book-title" className="text-2xs">Title</Label>
        <Input id="book-title" value={book.title} onChange={(event) => onPatchBook({ title: event.target.value })} className="h-8 text-xs" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="book-subtitle" className="text-2xs">Subtitle</Label>
        <Input id="book-subtitle" value={book.subtitle} onChange={(event) => onPatchBook({ subtitle: event.target.value })} className="h-8 text-xs" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="book-author" className="text-2xs">Author name</Label>
        <Input id="book-author" value={book.authorName} onChange={(event) => onPatchBook({ authorName: event.target.value })} className="h-8 text-xs" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="book-language" className="text-2xs">Language</Label>
        <Select id="book-language" value={book.language} onChange={(event) => onPatchBook({ language: event.target.value })} className="h-8 text-xs">
          {LANGUAGES.map((entry) => <option key={entry.code} value={entry.code}>{entry.label}</option>)}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="book-description" className="text-2xs">Description</Label>
        <Textarea id="book-description" rows={4} value={book.description} onChange={(event) => onPatchBook({ description: event.target.value })} className="text-xs" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="book-keywords" className="text-2xs">Keywords (comma separated)</Label>
        <Input
          id="book-keywords"
          value={book.metadata.keywords.join(', ')}
          onChange={(event) => onPatchBook({ metadata: { ...book.metadata, keywords: event.target.value.split(',').map((entry) => entry.trim()).filter(Boolean) } })}
          className="h-8 text-xs"
        />
      </div>

      <Separator />
      <p className="text-2xs font-medium">Trim &amp; layout</p>
      <Select value={book.trimSize.id} onChange={(event) => {
        const trim = TRIM_SIZES.find((entry) => entry.id === event.target.value);
        if (trim) onPatchBook({ trimSize: trim });
      }} className="h-8 text-xs" aria-label="Trim size">
        {TRIM_SIZES.map((trim) => <option key={trim.id} value={trim.id}>{trim.label} · {trim.widthIn}″ × {trim.heightIn}″</option>)}
      </Select>
      <div className="flex gap-2">
        {(['portrait', 'landscape'] as const).map((orientation) => (
          <Button
            key={orientation}
            size="xs"
            variant={book.orientation === orientation ? 'secondary' : 'outline'}
            className="flex-1 capitalize"
            onClick={() => onPatchBook({ orientation })}
          >
            {orientation}
          </Button>
        ))}
      </div>
      <label className="flex items-center justify-between text-xs">
        <span>Facing pages</span>
        <Switch checked={book.facingPages} onCheckedChange={(checked) => onPatchBook({ facingPages: checked })} />
      </label>

      <div className="grid grid-cols-2 gap-2">
        {(['top', 'bottom', 'left', 'right'] as const).map((edge) => (
          <div key={edge} className="space-y-1">
            <Label htmlFor={`margin-${edge}`} className="text-2xs capitalize">{edge} margin ″</Label>
            <Input
              id={`margin-${edge}`}
              type="number"
              step={0.05}
              value={book.margins[edge]}
              onChange={(event) => onPatchBook({ margins: { ...book.margins, [edge]: Number(event.target.value) } })}
              className="h-8 text-xs"
            />
          </div>
        ))}
      </div>
      <label className="flex items-center justify-between text-xs">
        <span>Mirror margins</span>
        <Switch checked={book.margins.mirror} onCheckedChange={(checked) => onPatchBook({ margins: { ...book.margins, mirror: checked } })} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="gutter" className="text-2xs">Gutter ″</Label>
          <Input id="gutter" type="number" step={0.05} value={book.gutter} onChange={(event) => onPatchBook({ gutter: Number(event.target.value) })} className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="bleed" className="text-2xs">Bleed ″</Label>
          <Input id="bleed" type="number" step={0.05} value={book.bleed} onChange={(event) => onPatchBook({ bleed: Number(event.target.value) })} className="h-8 text-xs" />
        </div>
      </div>

      <Separator />
      <p className="text-2xs font-medium">Typography</p>
      <div className="space-y-1">
        <Label htmlFor="book-heading-font" className="text-2xs">Heading font</Label>
        <Select id="book-heading-font" value={book.fonts.heading} onChange={(event) => onPatchBook({ fonts: { ...book.fonts, heading: event.target.value }, theme: { ...book.theme, headingFont: event.target.value } })} className="h-8 text-xs">
          {FONTS.headings.map((font) => <option key={font} value={font}>{font}</option>)}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="book-body-font" className="text-2xs">Body font</Label>
        <Select id="book-body-font" value={book.fonts.body} onChange={(event) => onPatchBook({ fonts: { ...book.fonts, body: event.target.value }, theme: { ...book.theme, bodyFont: event.target.value } })} className="h-8 text-xs">
          {FONTS.body.map((font) => <option key={font} value={font}>{font}</option>)}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="book-mono-font" className="text-2xs">Mono font</Label>
        <Select id="book-mono-font" value={book.fonts.mono} onChange={(event) => onPatchBook({ fonts: { ...book.fonts, mono: event.target.value } })} className="h-8 text-xs">
          {FONTS.body.map((font) => <option key={font} value={font}>{font}</option>)}
        </Select>
      </div>
      <Slider label="Base size" value={book.fonts.baseSize} min={9} max={20} onChange={(value) => onPatchBook({ fonts: { ...book.fonts, baseSize: value } })} format={(value) => `${value}pt`} />
      <Slider label="Line height" value={book.theme.lineHeight} min={1.1} max={2.2} step={0.05} onChange={(value) => onPatchBook({ theme: { ...book.theme, lineHeight: value } })} format={(value) => value.toFixed(2)} />
      <Slider label="Paragraph indent" value={book.theme.paragraphIndent} min={0} max={3} step={0.25} onChange={(value) => onPatchBook({ theme: { ...book.theme, paragraphIndent: value } })} format={(value) => `${value}em`} />
      <Slider label="Paragraph spacing" value={book.theme.paragraphSpacing} min={0} max={2} step={0.1} onChange={(value) => onPatchBook({ theme: { ...book.theme, paragraphSpacing: value } })} format={(value) => `${value}em`} />
      <Slider label="Heading scale" value={book.theme.headingScale} min={1} max={2.4} step={0.05} onChange={(value) => onPatchBook({ theme: { ...book.theme, headingScale: value } })} format={(value) => `${value.toFixed(2)}×`} />
      <label className="flex items-center justify-between text-xs">
        <span>Drop caps on chapter openers</span>
        <Switch checked={book.theme.dropCaps} onCheckedChange={(checked) => onPatchBook({ theme: { ...book.theme, dropCaps: checked } })} />
      </label>
      <label className="flex items-center justify-between text-xs">
        <span>Chapters start recto (right-hand page)</span>
        <Switch checked={book.theme.chapterStartsRecto} onCheckedChange={(checked) => onPatchBook({ theme: { ...book.theme, chapterStartsRecto: checked } })} />
      </label>

      <div className="space-y-1">
        <Label className="text-2xs">Palette</Label>
        <div className="grid grid-cols-4 gap-1.5">
          {PAGE_PALETTES.map((palette) => (
            <button
              key={palette.id}
              type="button"
              onClick={() => onPatchBook({ theme: { ...book.theme, palette: palette.id, accentColor: palette.accent }, cover: { ...book.cover } })}
              className={cn('h-8 rounded border-2', book.theme.palette === palette.id ? 'border-foreground' : 'border-transparent')}
              style={{ background: `linear-gradient(135deg, ${palette.accent} 0%, ${palette.accent} 50%, ${palette.paper} 50%, ${palette.paper} 100%)` }}
              title={palette.name}
              aria-label={palette.name}
            />
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="accent-colour" className="text-2xs">Accent colour</Label>
        <input id="accent-colour" type="color" value={toHex(book.theme.accentColor)} onChange={(event) => onPatchBook({ theme: { ...book.theme, accentColor: event.target.value } })} className="h-8 w-full rounded border" />
      </div>

      <Separator />
      <p className="text-2xs font-medium">TOC</p>
      <label className="flex items-center justify-between text-xs">
        <span>Include table of contents</span>
        <Switch checked={book.toc.enabled} onCheckedChange={(checked) => onPatchBook({ toc: { ...book.toc, enabled: checked } })} />
      </label>
      <Input value={book.toc.title} onChange={(event) => onPatchBook({ toc: { ...book.toc, title: event.target.value } })} className="h-8 text-xs" aria-label="TOC title" />
      <div className="grid grid-cols-2 gap-2">
        <Select value={String(book.toc.depth)} onChange={(event) => onPatchBook({ toc: { ...book.toc, depth: Number(event.target.value) as 1 | 2 | 3 } })} className="h-8 text-xs" aria-label="TOC depth">
          {[1, 2, 3].map((depth) => <option key={depth} value={depth}>Depth {depth}</option>)}
        </Select>
        <Select value={book.toc.placement} onChange={(event) => onPatchBook({ toc: { ...book.toc, placement: event.target.value as 'front' | 'back' } })} className="h-8 text-xs" aria-label="TOC placement">
          <option value="front">Front matter</option>
          <option value="back">Back matter</option>
        </Select>
      </div>
      <label className="flex items-center justify-between text-xs">
        <span>Leader dots</span>
        <Switch checked={book.toc.dots} onCheckedChange={(checked) => onPatchBook({ toc: { ...book.toc, dots: checked } })} />
      </label>
      <label className="flex items-center justify-between text-xs">
        <span>Show page numbers</span>
        <Switch checked={book.toc.showPageNumbers} onCheckedChange={(checked) => onPatchBook({ toc: { ...book.toc, showPageNumbers: checked } })} />
      </label>

      <Separator />
      <p className="text-2xs font-medium">Header &amp; footer</p>
      <label className="flex items-center justify-between text-xs">
        <span>Header</span>
        <Switch checked={book.headerFooter.headerEnabled} onCheckedChange={(checked) => onPatchBook({ headerFooter: { ...book.headerFooter, headerEnabled: checked } })} />
      </label>
      {book.headerFooter.headerEnabled && (
        <div className="grid grid-cols-3 gap-1">
          {(['headerLeft', 'headerCenter', 'headerRight'] as const).map((key) => (
            <Input
              key={key}
              value={book.headerFooter[key]}
              onChange={(event) => onPatchBook({ headerFooter: { ...book.headerFooter, [key]: event.target.value } })}
              className="h-7 text-2xs"
              placeholder={key.replace('header', '').toLowerCase()}
              aria-label={key}
            />
          ))}
        </div>
      )}
      <label className="flex items-center justify-between text-xs">
        <span>Footer</span>
        <Switch checked={book.headerFooter.footerEnabled} onCheckedChange={(checked) => onPatchBook({ headerFooter: { ...book.headerFooter, footerEnabled: checked } })} />
      </label>
      {book.headerFooter.footerEnabled && (
        <div className="grid grid-cols-3 gap-1">
          {(['footerLeft', 'footerCenter', 'footerRight'] as const).map((key) => (
            <Input
              key={key}
              value={book.headerFooter[key]}
              onChange={(event) => onPatchBook({ headerFooter: { ...book.headerFooter, [key]: event.target.value } })}
              className="h-7 text-2xs"
              placeholder={key.replace('footer', '').toLowerCase()}
              aria-label={key}
            />
          ))}
        </div>
      )}
      <label className="flex items-center justify-between text-xs">
        <span>Different first page</span>
        <Switch checked={book.headerFooter.differentFirstPage} onCheckedChange={(checked) => onPatchBook({ headerFooter: { ...book.headerFooter, differentFirstPage: checked } })} />
      </label>
      {book.headerFooter.differentFirstPage && (
        <Input
          value={book.headerFooter.firstPageFooter}
          onChange={(event) => onPatchBook({ headerFooter: { ...book.headerFooter, firstPageFooter: event.target.value } })}
          className="h-7 text-2xs"
          placeholder="First-page footer text"
          aria-label="First page footer"
        />
      )}

      <Separator />
      <p className="text-2xs font-medium">Metadata</p>
      <div className="grid grid-cols-2 gap-2">
        <Input value={meta.isbn} onChange={(event) => setMeta({ ...meta, isbn: event.target.value })} onBlur={() => onPatchBook({ metadata: meta })} className="h-8 text-2xs" placeholder="ISBN" aria-label="ISBN" />
        <Input value={meta.publisher} onChange={(event) => setMeta({ ...meta, publisher: event.target.value })} onBlur={() => onPatchBook({ metadata: meta })} className="h-8 text-2xs" placeholder="Publisher" aria-label="Publisher" />
        <Input value={meta.edition ?? ''} onChange={(event) => setMeta({ ...meta, edition: event.target.value })} onBlur={() => onPatchBook({ metadata: meta })} className="h-8 text-2xs" placeholder="Edition" aria-label="Edition" />
        <Input value={meta.language ?? book.language} onChange={(event) => setMeta({ ...meta, language: event.target.value })} onBlur={() => onPatchBook({ metadata: meta })} className="h-8 text-2xs" placeholder="Language code" aria-label="Metadata language" />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- print tab */

function PrintProperties({
  book,
  spineWidth,
  paperThickness,
  pages,
  canUsePrintProfiles,
  customTrim,
  setCustomTrim,
  onPatchBook,
  onRequestUpgrade,
}: {
  book: Book;
  spineWidth: number;
  paperThickness: number;
  pages: number;
  canUsePrintProfiles: boolean;
  customTrim: { widthIn: number; heightIn: number; label: string };
  setCustomTrim: React.Dispatch<React.SetStateAction<{ widthIn: number; heightIn: number; label: string }>>;
  onPatchBook: (patch: Partial<Book>) => void;
  onRequestUpgrade: (feature: string) => void;
}) {
  return (
    <div className="space-y-4">
      {!canUsePrintProfiles && (
        <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-2 text-2xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          Print profiles are available on Pro. You can still preview print settings here.
          <Button variant="outline" size="xs" className="mt-1.5 w-full" onClick={() => onRequestUpgrade('print')}>Compare plans</Button>
        </div>
      )}
      <p className="text-2xs font-medium">Print profile</p>
      <div className="space-y-1 rounded-lg border p-2 text-2xs">
        <p className="flex justify-between"><span className="text-muted-foreground">Trim size</span><span>{book.trimSize.widthIn}″ × {book.trimSize.heightIn}″</span></p>
        <p className="flex justify-between"><span className="text-muted-foreground">Pages</span><span>{formatNumber(pages)}</span></p>
        <p className="flex justify-between"><span className="text-muted-foreground">Paper</span><span>{paperThickness}″ thick</span></p>
        <p className="flex justify-between font-medium"><span>Spine width</span><span>{spineWidth.toFixed(3)}″</span></p>
        <p className="flex justify-between"><span className="text-muted-foreground">Cover size</span><span>{(book.trimSize.widthIn * 2 + spineWidth + 0.25).toFixed(2)}″ × {(book.trimSize.heightIn + 0.25).toFixed(2)}″</span></p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="paper-stock" className="text-2xs">Paper stock</Label>
        <Select id="paper-stock" value={book.paperStock} onChange={(event) => onPatchBook({ paperStock: event.target.value as Book['paperStock'] })} className="h-8 text-xs">
          {(['white', 'cream', 'color'] as const).map((stock) => <option key={stock} value={stock}>{stock} · {PAPER_THICKNESS[stock]}″</option>)}
        </Select>
      </div>

      <Separator />
      <p className="text-2xs font-medium">Custom trim size</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="custom-width" className="text-2xs">Width ″</Label>
          <Input id="custom-width" type="number" step={0.05} value={customTrim.widthIn} onChange={(event) => setCustomTrim((current) => ({ ...current, widthIn: Number(event.target.value) }))} className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="custom-height" className="text-2xs">Height ″</Label>
          <Input id="custom-height" type="number" step={0.05} value={customTrim.heightIn} onChange={(event) => setCustomTrim((current) => ({ ...current, heightIn: Number(event.target.value) }))} className="h-8 text-xs" />
        </div>
      </div>
      <Button
        size="xs"
        variant="outline"
        className="w-full"
        onClick={() => {
          const trim: TrimSize = { id: 'custom', label: `Custom ${customTrim.widthIn}″ × ${customTrim.heightIn}″`, widthIn: customTrim.widthIn, heightIn: customTrim.heightIn, custom: true };
          onPatchBook({ trimSize: trim });
        }}
      >
        Apply custom size
      </Button>

      <Separator />
      <p className="text-2xs font-medium">Bleed &amp; safety</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="print-bleed" className="text-2xs">Bleed ″</Label>
          <Input id="print-bleed" type="number" step={0.0625} value={book.bleed} onChange={(event) => onPatchBook({ bleed: Number(event.target.value) })} className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="print-safe" className="text-2xs">Safe area ″</Label>
          <Input id="print-safe" type="number" step={0.0625} value={book.safeArea} onChange={(event) => onPatchBook({ safeArea: Number(event.target.value) })} className="h-8 text-xs" />
        </div>
      </div>
      <label className="flex items-center justify-between text-xs">
        <span>Facing pages (two-page spreads)</span>
        <Switch checked={book.facingPages} onCheckedChange={(checked) => onPatchBook({ facingPages: checked })} />
      </label>
      <div className="rounded-lg bg-muted/50 p-2 text-2xs text-muted-foreground">
        <Printer className="mr-1 inline h-3 w-3" />
        Crop marks, bleed and mirror margins are applied by the print PDF exporter, and validated in the preflight check.
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(['paperback', 'kdp-print', 'hardcover', 'press-ready'] as const).map((profile) => (
          <Badge key={profile} variant="outline" className="text-2xs">{profile}</Badge>
        ))}
      </div>
      <Checkbox label="Always run preflight before print export" description="Blocks export when blocking errors exist." checked readOnly />
    </div>
  );
}

/* ------------------------------------------------------------------ layers */

const LAYER_GROUPS: { key: string; label: string; types: ElementType[] }[] = [
  { key: 'background', label: 'Background', types: [] },
  { key: 'image', label: 'Image', types: ['image', 'icon'] },
  { key: 'text', label: 'Text', types: ['text', 'quote'] },
  { key: 'shape', label: 'Shape', types: ['shape', 'line', 'divider'] },
  { key: 'table', label: 'Table', types: ['table'] },
  { key: 'decoration', label: 'Decoration', types: ['decoration', 'pageNumber', 'barcode'] },
];

function layerGroupFor(type: ElementType) {
  return LAYER_GROUPS.find((group) => group.types.includes(type))?.key ?? 'decoration';
}

function LayersList({
  page,
  selectedElementId,
  onReorder,
  onPatchElement,
  onSelectElement,
  onGroup,
  onUngroup,
}: {
  page: BookPage;
  selectedElementId: string | null;
  onReorder: (elementId: string, direction: 'up' | 'down' | 'front' | 'back') => void;
  onPatchElement: (elementId: string, patch: Partial<PageElement>) => void;
  onSelectElement: (elementId: string | null) => void;
  onGroup: (elementIds: string[]) => void;
  onUngroup: (groupId: string) => void;
}) {
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [checked, setChecked] = React.useState<string[]>([]);
  const [dragId, setDragId] = React.useState<string | null>(null);

  const sorted = [...page.elements].sort((a, b) => (b.z ?? 0) - (a.z ?? 0));
  const groups = LAYER_GROUPS.map((group) => ({ ...group, items: sorted.filter((element) => layerGroupFor(element.type) === group.key) }));

  const commitRename = (elementId: string) => {
    if (draft.trim()) onPatchElement(elementId, { name: draft.trim() });
    setRenaming(null);
  };

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    // Reorder by rewriting z values so the drop really changes the stacking.
    const order = sorted.map((element) => element.id);
    const from = order.indexOf(dragId);
    const to = order.indexOf(targetId);
    order.splice(to, 0, order.splice(from, 1)[0]);
    const total = order.length;
    order.forEach((id, index) => onPatchElement(id, { z: total - index }));
    setDragId(null);
  };

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-2xs font-medium"><Layers className="h-3 w-3" /> Layers ({sorted.length})</p>
      <div className="flex gap-1">
        <Button size="xs" variant="outline" className="flex-1" disabled={checked.length < 2} onClick={() => { onGroup(checked); setChecked([]); }}>
          Group
        </Button>
        <Button
          size="xs"
          variant="outline"
          className="flex-1"
          disabled={!checked.some((id) => page.elements.find((element) => element.id === id)?.groupId)}
          onClick={() => {
            const groupId = page.elements.find((element) => element.id === checked[0])?.groupId;
            if (groupId) onUngroup(groupId);
            setChecked([]);
          }}
        >
          Ungroup
        </Button>
      </div>
      {groups.map((group) => (
        <div key={group.key} className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {group.label} {group.key === 'background' ? '(page background)' : `(${group.items.length})`}
          </p>
          {group.key === 'background' && (
            <div className="rounded border px-1.5 py-1 text-2xs text-muted-foreground">
              {page.background?.type === 'none' ? 'None' : `${page.background?.type}: ${page.background?.value ?? ''}`}
            </div>
          )}
          {group.items.map((element) => {
            const selected = element.id === selectedElementId;
            return (
              <div
                key={element.id}
                draggable
                onDragStart={() => setDragId(element.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => handleDrop(element.id)}
                className={cn('flex items-center gap-1 rounded border px-1.5 py-1 text-2xs', selected ? 'border-primary bg-primary/5' : 'hover:border-primary/40')}
              >
                <input
                  type="checkbox"
                  checked={checked.includes(element.id)}
                  onChange={(event) => setChecked((current) => (event.target.checked ? [...current, element.id] : current.filter((id) => id !== element.id)))}
                  aria-label={`Select ${element.name} in layers`}
                  className="h-3 w-3"
                />
                {renaming === element.id ? (
                  <Input
                    autoFocus
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => commitRename(element.id)}
                    onKeyDown={(event) => { if (event.key === 'Enter') commitRename(element.id); if (event.key === 'Escape') setRenaming(null); }}
                    className="h-5 flex-1 text-2xs"
                    aria-label={`Rename ${element.name}`}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelectElement(element.id)}
                    onDoubleClick={() => { setRenaming(element.id); setDraft(element.name); }}
                    className="min-w-0 flex-1 truncate text-left"
                    title={`${element.name} · ${element.type} · z ${element.z ?? 0}`}
                  >
                    {element.name}
                    <span className="ml-1 text-muted-foreground">{element.type}</span>
                    {element.groupId && <span className="ml-1 text-primary">group</span>}
                    {element.wrap && element.wrap !== 'none' && <span className="ml-1 text-muted-foreground">{element.wrap}</span>}
                  </button>
                )}
                <button type="button" onClick={() => onPatchElement(element.id, { locked: !element.locked })} aria-label={element.locked ? `Unlock ${element.name}` : `Lock ${element.name}`} className="rounded p-0.5 hover:bg-muted">
                  {element.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                </button>
                <button type="button" onClick={() => onPatchElement(element.id, { visible: !element.visible })} aria-label={element.visible ? `Hide ${element.name}` : `Show ${element.name}`} className="rounded p-0.5 hover:bg-muted">
                  {element.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                </button>
                <button type="button" onClick={() => onReorder(element.id, 'up')} aria-label="Bring forward" className="rounded p-0.5 hover:bg-muted"><ArrowUp className="h-3 w-3" /></button>
                <button type="button" onClick={() => onReorder(element.id, 'down')} aria-label="Send backward" className="rounded p-0.5 hover:bg-muted"><ArrowDown className="h-3 w-3" /></button>
              </div>
            );
          })}
        </div>
      ))}
      <div className="flex gap-1">
        <Button size="xs" variant="ghost" className="flex-1" disabled={!selectedElementId} onClick={() => selectedElementId && onReorder(selectedElementId, 'front')}><MoveUp className="h-3 w-3" /> Bring to front</Button>
        <Button size="xs" variant="ghost" className="flex-1" disabled={!selectedElementId} onClick={() => selectedElementId && onReorder(selectedElementId, 'back')}><MoveDown className="h-3 w-3" /> Send to back</Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- bits */

function NumberField({ label, value, onChange, text }: { label: string; value: number | string; onChange: (value: never) => void; text?: boolean }) {
  const id = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-2xs">{label}</Label>
      <Input
        id={id}
        type={text ? 'text' : 'number'}
        step={text ? undefined : 0.5}
        value={value}
        onChange={(event) => onChange((text ? event.target.value : Number(event.target.value)) as never)}
        className="h-8 text-xs"
      />
    </div>
  );
}

function resizeTable(element: PageElement, rows: number, cols: number, onPatch: (patch: Partial<PageElement>) => void) {
  const table = element.table!;
  const cells = Array.from({ length: rows }).map((_, r) => Array.from({ length: cols }).map((__, c) => table.cells?.[r]?.[c] ?? ''));
  onPatch({ table: { ...table, rows, cols, cells } });
}

function toHex(colour: string | undefined, fallback = '#111827') {
  if (!colour) return fallback;
  if (colour.startsWith('#')) return colour;
  return fallback;
}
