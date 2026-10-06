import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown, ChevronRight, FileImage, FileText, GripVertical, Hash, Image as ImageIcon, Layers, LayoutTemplate, ListOrdered, Lock, Minus, Palette, Plus, Quote, Rows3, Search, Sparkles, Square, Star, Table as TableIcon, Trash2, Type, Wand2,
} from 'lucide-react';
import { Badge, Button, Input, Separator } from '@/components/ui/primitives';
import { DropdownMenu, Modal, Popover, type MenuItemDef } from '@/components/ui/overlays';
import { EmptyState } from '@/components/ui/data';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/overlays';
import { useAssets, useTemplates } from '@/hooks/queries';
import { useAuth } from '@/providers/AuthProvider';
import { aiService, bookService } from '@/services';
import { PAGE_PALETTES } from '@/data/constants';
import { formatNumber } from '@/lib/format';
import { cn, formatBytes, uid } from '@/lib/utils';
import { AiPanel } from './AiPanel';
import type { Book, BookPage, BookSection, ElementType, PageElement, SectionKind, Template } from '@/types/domain';

export type SidebarTab = 'pages' | 'chapters' | 'elements' | 'templates' | 'assets' | 'ai' | 'structure';

const SECTION_KINDS: SectionKind[] = ['front-matter', 'part', 'chapter', 'section', 'back-matter', 'cover', 'back-cover'];

interface Props {
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  book: Book;
  activePage: BookPage | undefined;
  activePageIndex: number;
  selectionText: string;
  canUseAdvancedEditor: boolean;
  onSelectPage: (pageId: string) => void;
  onPatchPage: (pageId: string, patch: Partial<BookPage>) => void;
  onPatchSection: (sectionId: string, patch: Partial<BookSection>) => void;
  onAddPage: (sectionId: string, layout?: BookPage['layout']) => void;
  onAddSection: (title: string, kind: SectionKind) => BookSection | undefined;
  onDuplicatePage: (pageId: string) => void;
  onRemovePage: (pageId: string) => void;
  onRemoveSection: (sectionId: string) => void;
  onReorderPages: (orderedIds: string[]) => void;
  onReorderSections: (orderedIds: string[]) => void;
  onMovePageToSection: (pageId: string, sectionId: string) => void;
  onSplitSection: (pageId: string) => void;
  onAddElement: (element: PageElement) => void;
  onApplyTemplate: (template: Template) => void;
  onGenerateToc: () => { title: string; page: number }[];
  onToggleToc: () => void;
  onTocTitle: (title: string) => void;
  onInsertAiText: (text: string) => void;
  onReplaceAiText: (text: string) => void;
  onAiNote: (text: string) => void;
  onRequestUpgrade: (feature: string) => void;
}

export function EditorSidebar(props: Props) {
  const { tab, onTabChange, book } = props;
  const tabs: { value: SidebarTab; label: string; icon: React.ReactNode; count?: number }[] = [
    { value: 'pages', label: 'Pages', icon: <FileText className="h-4 w-4" />, count: book.pages.length },
    { value: 'chapters', label: 'Chapters', icon: <Rows3 className="h-4 w-4" />, count: book.sections.length },
    { value: 'elements', label: 'Elements', icon: <Square className="h-4 w-4" /> },
    { value: 'templates', label: 'Templates', icon: <LayoutTemplate className="h-4 w-4" /> },
    { value: 'assets', label: 'Assets', icon: <ImageIcon className="h-4 w-4" /> },
    { value: 'ai', label: 'AI', icon: <Sparkles className="h-4 w-4" /> },
    { value: 'structure', label: 'Structure', icon: <Layers className="h-4 w-4" /> },
  ];

  return (
    <div className="flex h-full min-h-0">
      <nav aria-label="Editor panels" className="flex w-14 shrink-0 flex-col items-center gap-1 border-r bg-muted/30 py-3">
        {tabs.map((entry) => (
          <button
            key={entry.value}
            type="button"
            onClick={() => onTabChange(entry.value)}
            title={entry.label}
            aria-label={entry.label}
            aria-current={tab === entry.value ? 'true' : undefined}
            className={cn(
              'relative flex h-10 w-10 flex-col items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              tab === entry.value && 'bg-primary/10 text-primary',
            )}
          >
            {entry.icon}
            <span className="mt-0.5 text-[9px] leading-none">{entry.label}</span>
            {entry.count !== undefined && entry.count > 0 && (
              <span className="absolute right-0.5 top-0.5 rounded-full bg-primary px-1 text-[9px] text-primary-foreground">{entry.count}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-3">
        {tab === 'pages' && <PagesPanel {...props} />}
        {tab === 'chapters' && <ChaptersPanel {...props} />}
        {tab === 'elements' && <ElementsPanel {...props} />}
        {tab === 'templates' && <TemplatesPanel {...props} />}
        {tab === 'assets' && <AssetsPanel {...props} />}
        {tab === 'ai' && (
          <AiPanel
            book={book}
            activePageContent={props.activePage?.content ?? ''}
            selectionText={props.selectionText}
            onInsert={props.onInsertAiText}
            onReplace={props.onReplaceAiText}
            onInsertNote={props.onAiNote}
            onChapterCreated={() => onTabChange('chapters')}
          />
        )}
        {tab === 'structure' && <StructurePanel {...props} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pages */

function PagesPanel({ book, activePage, onSelectPage, onPatchPage, onAddPage, onDuplicatePage, onRemovePage, onReorderPages, onMovePageToSection }: Props) {
  const { success } = useToast();
  const confirm = useConfirm();
  const [query, setQuery] = React.useState('');
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);

  const filtered = book.pages.filter((page) => !query || page.title.toLowerCase().includes(query.toLowerCase()));
  const sectionTitle = (sectionId: string) => book.sections.find((section) => section.id === sectionId)?.title ?? 'Section';

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = book.pages.map((page) => page.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    onReorderPages(ids);
    success('Page reordered');
    setDragId(null);
    setOverId(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a page" className="h-8 pl-7 text-xs" aria-label="Find a page" />
        </div>
        <DropdownMenu
          trigger={<Button size="xs" variant="outline"><Plus className="h-3 w-3" /> Add</Button>}
          items={[
            { id: 'flow', label: 'Text page', onSelect: () => onAddPage(activePage?.sectionId ?? book.sections[0]?.id ?? '', 'flow') },
            { id: 'canvas', label: 'Design page', onSelect: () => onAddPage(activePage?.sectionId ?? book.sections[0]?.id ?? '', 'canvas') },
            { id: 'title', label: 'Title page', onSelect: () => onAddPage(activePage?.sectionId ?? book.sections[0]?.id ?? '', 'title') },
            { id: 'blank', label: 'Blank page', onSelect: () => onAddPage(activePage?.sectionId ?? book.sections[0]?.id ?? '', 'blank') },
          ] as MenuItemDef[]}
        />
      </div>
      <p className="text-2xs text-muted-foreground">Drag to reorder · click to open · {formatNumber(book.wordCount)} words total</p>
      <div className="space-y-1.5">
        {filtered.map((page) => {
          const index = book.pages.findIndex((entry) => entry.id === page.id);
          const active = page.id === activePage?.id;
          return (
            <div
              key={page.id}
              draggable
              onDragStart={() => setDragId(page.id)}
              onDragOver={(event) => { event.preventDefault(); setOverId(page.id); }}
              onDragLeave={() => setOverId((current) => (current === page.id ? null : current))}
              onDrop={() => handleDrop(page.id)}
              className={cn(
                'group rounded-lg border p-2 transition-colors',
                active ? 'border-primary bg-primary/5' : 'hover:border-primary/40',
                overId === page.id && 'border-primary border-dashed',
              )}
            >
              <div className="flex items-start gap-2">
                <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground" />
                <button type="button" onClick={() => onSelectPage(page.id)} className="min-w-0 flex-1 text-left">
                  <p className="flex items-center gap-1.5 truncate text-xs font-medium">
                    <span className="text-muted-foreground">{index + 1}.</span> {page.title || 'Untitled page'}
                    {page.locked && <Lock className="h-3 w-3 text-muted-foreground" />}
                  </p>
                  <p className="truncate text-2xs text-muted-foreground">
                    {page.layout} · {page.wordCount ? `${formatNumber(page.wordCount)} words` : 'empty'} · {sectionTitle(page.sectionId)}
                  </p>
                </button>
                <Popover
                  align="end"
                  trigger={<Button variant="ghost" size="xs" aria-label={`Page actions for ${page.title}`}><ChevronDown className="h-3 w-3" /></Button>}
                  className="w-52 p-1"
                >
                  <div className="space-y-0.5">
                    <MenuButton label="Duplicate page" onClick={() => onDuplicatePage(page.id)} />
                    <MenuButton label="Insert page after" onClick={() => onAddPage(page.sectionId)} />
                    <MenuButton label={page.locked ? 'Unlock page' : 'Lock page'} onClick={() => onPatchPage(page.id, { locked: !page.locked })} />
                    <MenuButton
                      label="Move to section…"
                      onClick={() => {
                        const next = window.prompt(`Move “${page.title}” to which section?\n${book.sections.map((section, position) => `${position + 1}. ${section.title}`).join('\n')}`);
                        const index = Number(next) - 1;
                        const section = book.sections[index];
                        if (section) onMovePageToSection(page.id, section.id);
                      }}
                    />
                    <MenuButton
                      label="Set numbering…"
                      onClick={() => {
                        const next = window.prompt('Numbering: arabic, roman-lower, roman-upper, inherit or none', page.numbering);
                        if (next) onPatchPage(page.id, { numbering: next as BookPage['numbering'] });
                      }}
                    />
                    <MenuButton label="Delete page" destructive onClick={async () => { const ok = await confirm({ title: `Delete “${page.title}”?`, description: 'The page is removed from the book immediately.', destructive: true, confirmLabel: 'Delete page' }); if (ok) onRemovePage(page.id); }} />
                  </div>
                </Popover>
              </div>
              {page.notes && <p className="mt-1 line-clamp-2 rounded bg-amber-50 px-1.5 py-1 text-2xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{page.notes}</p>}
            </div>
          );
        })}
        {filtered.length === 0 && <p className="text-xs text-muted-foreground">No pages match “{query}”.</p>}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- chapters */

function ChaptersPanel({ book, activePage, onPatchSection, onAddSection, onRemoveSection, onReorderSections, onSplitSection, onSelectPage }: Props) {
  const { success } = useToast();
  const confirm = useConfirm();
  const [expanded, setExpanded] = React.useState<string[]>(book.sections.map((section) => section.id));
  const [dragId, setDragId] = React.useState<string | null>(null);

  const toggle = (id: string) => setExpanded((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = book.sections.map((section) => section.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    onReorderSections(ids);
    success('Structure reordered');
    setDragId(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-2xs text-muted-foreground">{book.sections.length} sections · drag to reorder</p>
        <DropdownMenu
          trigger={<Button size="xs" variant="outline"><Plus className="h-3 w-3" /> Chapter</Button>}
          items={SECTION_KINDS.map((kind) => ({
            id: kind,
            label: kind.replace('-', ' ').replace(/^\w/, (letter) => letter.toUpperCase()),
            onSelect: () => {
              const section = onAddSection(kind === 'chapter' ? 'Untitled chapter' : kind.replace('-', ' ').replace(/^\w/, (letter) => letter.toUpperCase()), kind);
              if (section) setExpanded((current) => [...current, section.id]);
            },
          })) as MenuItemDef[]}
        />
      </div>
      <div className="space-y-2">
        {book.sections.map((section) => {
          const open = expanded.includes(section.id);
          return (
            <div
              key={section.id}
              draggable
              onDragStart={() => setDragId(section.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => handleDrop(section.id)}
              className="rounded-lg border"
            >
              <div className="flex items-center gap-1 p-2">
                <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground" />
                <button type="button" onClick={() => toggle(section.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" aria-expanded={open}>
                  {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{section.title}</span>
                    <span className="block truncate text-2xs text-muted-foreground">{section.kind.replace('-', ' ')} · {section.pageIds.length} pages · {formatNumber(section.wordCount)} words</span>
                  </span>
                </button>
                <Badge variant={section.status === 'complete' ? 'success' : section.status === 'drafting' ? 'warning' : 'outline'} className="text-2xs">{section.status}</Badge>
              </div>
              {open && (
                <div className="space-y-1 border-t p-2">
                  <Input
                    value={section.title}
                    onChange={(event) => onPatchSection(section.id, { title: event.target.value })}
                    className="h-7 text-xs"
                    aria-label={`Rename ${section.title}`}
                  />
                  {section.pageIds.map((pageId) => {
                    const page = book.pages.find((entry) => entry.id === pageId);
                    if (!page) return null;
                    return (
                      <button
                        key={pageId}
                        type="button"
                        onClick={() => onSelectPage(pageId)}
                        className={cn('w-full truncate rounded px-1.5 py-1 text-left text-2xs hover:bg-muted', page.id === activePage?.id && 'bg-primary/10 text-primary')}
                      >
                        {page.title || 'Untitled'}
                      </button>
                    );
                  })}
                  <div className="flex flex-wrap gap-1 pt-1">
                    <Button size="xs" variant="ghost" onClick={() => onPatchSection(section.id, { status: section.status === 'complete' ? 'drafting' : 'complete' })}>
                      {section.status === 'complete' ? 'Reopen' : 'Mark complete'}
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => { if (activePage) onSplitSection(activePage.id); }} disabled={!section.pageIds.includes(activePage?.id ?? '')}>
                      Split at current page
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={async () => {
                        const ok = await confirm({ title: `Delete “${section.title}”?`, description: `${section.pageIds.length} pages will be removed with it.`, destructive: true, confirmLabel: 'Delete section' });
                        if (ok) onRemoveSection(section.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- elements */

function ElementsPanel({ activePage, onAddElement, canUseAdvancedEditor, onRequestUpgrade }: Props) {
  const { success } = useToast();
  if (!activePage) {
    return <EmptyState icon={<Square className="h-5 w-5" />} title="No page selected" description="Pick a page in the Pages panel to add elements." />;
  }
  const isDesign = activePage.layout === 'canvas' || activePage.layout === 'blank';

  const elements: { type: ElementType; label: string; icon: React.ReactNode; hint: string; design?: boolean }[] = [
    { type: 'text', label: 'Text block', icon: <Type className="h-4 w-4" />, hint: 'Headings, body copy, captions' },
    { type: 'image', label: 'Image', icon: <ImageIcon className="h-4 w-4" />, hint: 'From your asset library', design: true },
    { type: 'shape', label: 'Shape', icon: <Square className="h-4 w-4" />, hint: 'Rectangles, ellipses, stars', design: true },
    { type: 'divider', label: 'Divider', icon: <Minus className="h-4 w-4" />, hint: 'Rules and ornaments', design: true },
    { type: 'quote', label: 'Pull quote', icon: <Quote className="h-4 w-4" />, hint: 'Emphasised quotation', design: true },
    { type: 'table', label: 'Table', icon: <TableIcon className="h-4 w-4" />, hint: '3×3 grid, fully editable', design: true },
    { type: 'icon', label: 'Icon', icon: <Star className="h-4 w-4" />, hint: 'Decorative glyph', design: true },
    { type: 'decoration', label: 'Decoration', icon: <Sparkles className="h-4 w-4" />, hint: 'Placeholder accent', design: true },
    { type: 'pageNumber', label: 'Page number', icon: <Hash className="h-4 w-4" />, hint: 'Auto-updating folio', design: true },
    { type: 'barcode', label: 'Barcode', icon: <FileImage className="h-4 w-4" />, hint: 'ISBN barcode block', design: true },
  ];

  const add = (type: ElementType) => {
    if (!isDesign) {
      success('Switch to Design mode', 'Canvas elements live on design pages — text pages use the rich-text editor.');
      return;
    }
    if (!canUseAdvancedEditor) {
      onRequestUpgrade('advanced');
      return;
    }
    onAddElement(createElement(type, activePage));
    success(`${type} element added`);
  };

  return (
    <div className="space-y-3">
      <p className="text-2xs text-muted-foreground">
        {isDesign ? 'Elements are positioned freely on design pages.' : 'This is a text page — switch the page layout to Design to place free elements.'}
      </p>
      <div className="space-y-1.5">
        {elements.map((entry) => (
          <button
            key={entry.type}
            type="button"
            onClick={() => add(entry.type)}
            className="flex w-full items-center gap-2.5 rounded-lg border p-2 text-left transition-colors hover:border-primary/40"
          >
            <span className="rounded-md bg-muted p-1.5 text-muted-foreground">{entry.icon}</span>
            <span className="min-w-0">
              <span className="block text-xs font-medium">{entry.label}</span>
              <span className="block truncate text-2xs text-muted-foreground">{entry.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function createElement(type: ElementType, page: BookPage): PageElement {
  const base: PageElement = {
    id: uid('el'),
    type,
    name: `${type} element`,
    x: 12,
    y: 12,
    w: type === 'divider' ? 40 : type === 'text' || type === 'quote' ? 60 : 30,
    h: type === 'divider' ? 2 : type === 'text' || type === 'quote' ? 14 : 30,
    rotation: 0,
    visible: true,
    locked: false,
    z: page.elements.length,
  };
  switch (type) {
    case 'text':
      return { ...base, text: '<p>New text block</p>', style: { fontFamily: 'Inter', fontSize: 14, color: '#111827', align: 'left', lineHeight: 1.5 } };
    case 'quote':
      return { ...base, text: '<p>“A line worth pulling out.”</p>', style: { fontFamily: 'Playfair Display', fontSize: 20, italic: true, color: '#111827', align: 'center', lineHeight: 1.4 } };
    case 'image':
      return { ...base, image: { src: '', fit: 'cover', radius: 4, opacity: 1, filters: { grayscale: 0, sepia: 0, blur: 0, brightness: 100, contrast: 100 } } };
    case 'shape':
      return { ...base, shape: { kind: 'rect', fill: 'hsl(var(--primary))', stroke: 'transparent', strokeWidth: 0, radius: 8 } };
    case 'divider':
      return { ...base, divider: { style: 'ornament', color: '#111827', thickness: 1 } };
    case 'table':
      return { ...base, w: 70, h: 30, table: { rows: 3, cols: 3, cells: [['Header', 'Header', 'Header'], ['', '', ''], ['', '', '']], headerRow: true, borderColor: '#d4d4d8' }, style: { fontSize: 11, color: '#111827' } };
    case 'icon':
      return { ...base, w: 12, h: 12, icon: '❖', style: { color: 'hsl(var(--primary))', fontSize: 42 } };
    case 'pageNumber':
      return { ...base, w: 10, h: 4, y: 92, x: 45, text: '#', style: { fontSize: 11, align: 'center', color: '#111827' } };
    case 'barcode':
      return { ...base, w: 24, h: 12, text: '978-1-2345-678-9' };
    default:
      return { ...base, w: 16, h: 16 };
  }
}

/* -------------------------------------------------------------- templates */

function TemplatesPanel({ book, onApplyTemplate }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = React.useState('');
  const { data: templates, isLoading } = useTemplates({ query: query || undefined, published: true, sort: 'popular' });

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search templates" className="h-8 pl-7 text-xs" aria-label="Search templates" />
      </div>
      <p className="text-2xs text-muted-foreground">Applying a template restyles this book’s palette and typography — your writing is never overwritten.</p>
      {isLoading && <div className="space-y-2">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-lg bg-muted" />)}</div>}
      <div className="space-y-2">
        {(templates ?? []).slice(0, 10).map((template) => (
          <div key={template.id} className="rounded-lg border p-2">
            <div className="flex items-start gap-2">
              <div className="h-12 w-9 shrink-0 overflow-hidden rounded" style={{ background: template.accentColor }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{template.name}</p>
                <p className="truncate text-2xs text-muted-foreground">{template.style} · {template.pageCount} pages</p>
                <div className="mt-1 flex gap-1">
                  <Button size="xs" variant="outline" onClick={() => onApplyTemplate(template)}>Apply</Button>
                  <Button size="xs" variant="ghost" onClick={() => navigate('/templates')}>View</Button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <Button size="xs" variant="outline" className="w-full" onClick={() => navigate('/dashboard/templates')}>
        <LayoutTemplate className="h-3 w-3" /> Browse all templates
      </Button>
      <Separator />
      <div>
        <p className="mb-2 text-2xs font-medium">Book palettes</p>
        <div className="grid grid-cols-4 gap-1.5">
          {PAGE_PALETTES.map((palette) => (
            <button
              key={palette.id}
              type="button"
              title={`${palette.name} (current: ${book.theme.palette})`}
              onClick={() => void bookService.applyThemeToAllPages(book.id, palette.id)}
              className={cn('h-8 rounded-md border-2 transition-transform hover:scale-105', book.theme.palette === palette.id ? 'border-foreground' : 'border-transparent')}
              style={{ background: `linear-gradient(135deg, ${palette.accent} 0%, ${palette.accent} 50%, ${palette.paper} 50%, ${palette.paper} 100%)` }}
              aria-label={palette.name}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- assets */

function AssetsPanel({ activePage, onAddElement, canUseAdvancedEditor, onRequestUpgrade }: Props) {
  const { user, entitlements } = useAuth();
  const { data: assets, isLoading } = useAssets(user?.id);
  const { success, warning } = useToast();
  const [query, setQuery] = React.useState('');
  const [aiOpen, setAiOpen] = React.useState(false);
  const [prompt, setPrompt] = React.useState('A lantern-lit doorway, muted palette, textured gouache');
  const [busy, setBusy] = React.useState(false);

  const filtered = (assets ?? []).filter((asset) => !query || asset.name.toLowerCase().includes(query.toLowerCase()));

  const insert = (url: string, name: string) => {
    if (!activePage) return;
    if (!canUseAdvancedEditor) {
      onRequestUpgrade('advanced');
      return;
    }
    onAddElement({
      ...createElement('image', activePage),
      name,
      image: { src: url, fit: 'cover', radius: 4, opacity: 1, filters: { grayscale: 0, sepia: 0, blur: 0, brightness: 100, contrast: 100 } },
    });
    success('Image placed on the page');
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search assets" className="h-8 pl-7 text-xs" aria-label="Search assets" />
      </div>
      <Button size="xs" variant="outline" className="w-full" onClick={() => setAiOpen(true)}>
        <Wand2 className="h-3 w-3" /> Generate an illustration
      </Button>
      {isLoading && <div className="grid grid-cols-3 gap-1.5">{Array.from({ length: 9 }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded bg-muted" />)}</div>}
      <div className="grid grid-cols-3 gap-1.5">
        {filtered.slice(0, 24).map((asset) => (
          <button
            key={asset.id}
            type="button"
            onClick={() => insert(asset.url, asset.name)}
            title={`${asset.name} · ${formatBytes(asset.sizeBytes)}`}
            className="group relative aspect-square overflow-hidden rounded border transition-colors hover:border-primary"
          >
            <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" />
            {asset.kind === 'ai-image' && <span className="absolute right-0.5 top-0.5 rounded bg-primary px-1 text-[8px] text-primary-foreground">AI</span>}
          </button>
        ))}
      </div>
      {!isLoading && filtered.length === 0 && <p className="text-xs text-muted-foreground">No assets yet — upload in the asset library or generate one.</p>}

      <Modal
        open={aiOpen}
        onOpenChange={setAiOpen}
        title="Generate an illustration"
        description="Images are saved to your asset library and placed on the current page."
        footer={
          <>
            <Button variant="outline" onClick={() => setAiOpen(false)}>Cancel</Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (!user) return;
                if (!entitlements.canUseAiImages()) {
                  warning('AI images require Pro', entitlements.upgradeReason('ai'));
                  return;
                }
                setBusy(true);
                try {
                  const result = await aiService.generateImage({ prompt, style: 'Editorial illustration', userId: user.id, aspect: 'portrait' });
                  insert(result.url, prompt.slice(0, 32));
                  setAiOpen(false);
                  success('Illustration generated', `${result.credits} credits used`);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Generating…' : 'Generate'}
            </Button>
          </>
        }
      >
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" aria-label="Image prompt" />
        <p className="mt-2 text-xs text-muted-foreground">{entitlements.usage.aiImages.used} of {entitlements.usage.aiImages.limit} image credits used.</p>
      </Modal>
    </div>
  );
}

/* -------------------------------------------------------------- structure */

function StructurePanel({ book, onGenerateToc, onToggleToc, onTocTitle, onRequestUpgrade }: Props & { onToggleToc: () => void; onTocTitle: (title: string) => void }) {
  const { success } = useToast();
  const [tocPreview, setTocPreview] = React.useState<{ title: string; page: number }[] | null>(null);

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-2xs font-medium">Book blocks</p>
        <div className="space-y-1">
          {book.sections.map((section) => (
            <div key={section.id} className="flex items-center justify-between rounded border px-2 py-1 text-2xs">
              <span className="truncate">{section.title}</span>
              <Badge variant="outline" className="text-2xs">{section.kind.replace('-', ' ')}</Badge>
            </div>
          ))}
        </div>
      </div>

      <Separator />
      <div className="space-y-2">
        <p className="text-2xs font-medium">Table of contents</p>
        <label className="flex items-center justify-between text-2xs">
          <span className="text-muted-foreground">Include TOC</span>
          <input type="checkbox" checked={book.toc.enabled} onChange={() => onToggleToc()} className="accent-primary" />
        </label>
        <Input value={book.toc.title} onChange={(event) => onTocTitle(event.target.value)} className="h-7 text-2xs" aria-label="TOC title" />
        <Button
          size="xs"
          variant="outline"
          className="w-full"
          onClick={() => {
            setTocPreview(onGenerateToc());
          }}
        >
          <ListOrdered className="h-3 w-3" /> Generate TOC
        </Button>
        {tocPreview && (
          <div className="rounded border p-2 text-2xs">
            <p className="font-medium">{book.toc.title}</p>
            {tocPreview.map((entry) => (
              <p key={entry.title} className="flex justify-between text-muted-foreground">
                <span className="truncate">{entry.title}</span>
                <span>{entry.page}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      <Separator />
      <div className="space-y-2">
        <p className="text-2xs font-medium">Auto page numbering</p>
        <p className="text-2xs text-muted-foreground">Style: {book.numbering.style} · starts at {book.numbering.startAt} · {book.numbering.position}</p>
        <p className="text-2xs text-muted-foreground">{book.numbering.sectionBased ? 'Restarts per section' : 'Continuous through the book'} {book.numbering.hideOnFirstPage ? '· hidden on first page' : ''}</p>
      </div>

      <Separator />
      <div className="space-y-2">
        <p className="text-2xs font-medium">Header &amp; footer</p>
        <p className="text-2xs text-muted-foreground">
          Header: {book.headerFooter.headerEnabled ? `${book.headerFooter.headerLeft || '—'} / ${book.headerFooter.headerCenter || '—'} / ${book.headerFooter.headerRight || '—'}` : 'off'}
        </p>
        <p className="text-2xs text-muted-foreground">
          Footer: {book.headerFooter.footerEnabled ? `${book.headerFooter.footerLeft || '—'} / ${book.headerFooter.footerCenter || '—'} / ${book.headerFooter.footerRight || '—'}` : 'off'}
        </p>
        <Button size="xs" variant="ghost" onClick={() => onRequestUpgrade('print')}>Edit in the properties panel</Button>
      </div>

      <Separator />
      <div className="space-y-2">
        <p className="text-2xs font-medium">Print settings</p>
        <p className="text-2xs text-muted-foreground">{book.trimSize.label} · {book.orientation} · bleed {book.bleed}" · gutter {book.gutter}"</p>
        <p className="text-2xs text-muted-foreground">Paper: {book.paperStock} · spine {bookService.spineWidth(book.id).widthIn.toFixed(3)}"</p>
      </div>

      <Separator />
      <Button size="xs" variant="outline" className="w-full" onClick={() => success('Structure synced', 'Page numbering and TOC settings applied to exports.')}>
        <Palette className="h-3 w-3" /> Re-sync structure
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ bits */

function MenuButton({ label, onClick, destructive }: { label: string; onClick: () => void; destructive?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted',
        destructive && 'text-destructive hover:bg-destructive/10',
      )}
    >
      {label}
    </button>
  );
}
