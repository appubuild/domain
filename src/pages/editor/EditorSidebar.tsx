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
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/providers/AuthProvider';
import { aiService, assetService, bookService, storageService } from '@/services';
import { PAGE_PALETTES } from '@/data/constants';
import { formatNumber } from '@/lib/format';
import { cn, formatBytes, uid } from '@/lib/utils';
import { AiPanel } from './AiPanel';
import { ASSET_CATEGORIES, ELEMENT_LIBRARY, assetKindsFor, type AssetCategoryId, type LibraryEntry } from './libraries';
import { freeImageService, type FreeImageProviderId, type FreeImageResult } from '@/services/freeImageService';
import { PageThumbnail } from './PageThumbnail';
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
  onInsertPage: (pageId: string, position: 'before' | 'after', layout?: BookPage['layout']) => void;
  onMovePage: (pageId: string, direction: 'up' | 'down') => void;
  onAddSection: (title: string, kind: SectionKind) => BookSection | undefined;
  onDuplicatePage: (pageId: string) => void;
  onDuplicateSection: (sectionId: string) => void;
  onMoveSection: (sectionId: string, direction: 'up' | 'down') => void;
  collapsedSections: string[];
  onToggleSectionCollapsed: (sectionId: string) => void;
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

function PagesPanel({
  book, activePage, onSelectPage, onPatchPage, onAddPage, onInsertPage, onDuplicatePage, onRemovePage,
  onReorderPages, onMovePage, onMovePageToSection,
}: Props) {
  const { success } = useToast();
  const confirm = useConfirm();
  const [query, setQuery] = React.useState('');
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);
  const [renameId, setRenameId] = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState('');
  const [showAll, setShowAll] = React.useState(false);

  const filtered = book.pages.filter((page) => !query || (page.title || '').toLowerCase().includes(query.toLowerCase()));
  const sectionTitle = (sectionId: string) => book.sections.find((section) => section.id === sectionId)?.title ?? 'Section';
  // Long books: only the window around the active page renders until the author asks for all.
  const virtualise = !showAll && !query && book.pages.length > (book.canvas.virtualizeAfter || 40);
  const activeIndex = book.pages.findIndex((page) => page.id === activePage?.id);
  const windowStart = virtualise ? Math.max(0, Math.min(activeIndex - 12, book.pages.length - 40)) : 0;
  const visible = virtualise ? filtered.slice(windowStart, windowStart + 40) : filtered;
  const items = visible.map((page) => ({ page, index: book.pages.findIndex((entry) => entry.id === page.id) }));

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

  const commitRename = (pageId: string) => {
    const title = renameDraft.trim();
    if (title) onPatchPage(pageId, { title });
    setRenameId(null);
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
            { id: 'flow', label: 'Text page (end of chapter)', onSelect: () => onAddPage(activePage?.sectionId ?? book.sections[0]?.id ?? '', 'flow') },
            { id: 'canvas', label: 'Design page', onSelect: () => onAddPage(activePage?.sectionId ?? book.sections[0]?.id ?? '', 'canvas') },
            { id: 'title', label: 'Title page', onSelect: () => onAddPage(activePage?.sectionId ?? book.sections[0]?.id ?? '', 'title') },
            { id: 'blank', label: 'Blank page', onSelect: () => onAddPage(activePage?.sectionId ?? book.sections[0]?.id ?? '', 'blank') },
            { id: 'blank-insert', label: 'Blank page after this one', onSelect: () => activePage && onInsertPage(activePage.id, 'after', 'blank') },
          ] as MenuItemDef[]}
        />
      </div>
      <p className="text-2xs text-muted-foreground">
        Drag to reorder · click to open · {formatNumber(book.wordCount)} words · {book.pages.length} pages
      </p>
      {virtualise && (
        <p className="rounded bg-muted px-2 py-1 text-2xs text-muted-foreground">
          Showing pages {windowStart + 1}–{Math.min(book.pages.length, windowStart + 40)} of {book.pages.length} for speed.{' '}
          <button type="button" className="underline" onClick={() => setShowAll(true)}>Render all</button>
        </p>
      )}
      <div className="space-y-1.5">
        {items.map(({ page, index }) => {
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
                <div className="flex flex-col items-center gap-0.5">
                  <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground" />
                  <PageThumbnail book={book} page={page} width={40} />
                </div>
                <div className="min-w-0 flex-1">
                  {renameId === page.id ? (
                    <Input
                      autoFocus
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onBlur={() => commitRename(page.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitRename(page.id);
                        if (event.key === 'Escape') setRenameId(null);
                      }}
                      className="h-6 text-xs"
                      aria-label={`Rename page ${index + 1}`}
                    />
                  ) : (
                    <button type="button" onClick={() => onSelectPage(page.id)} onDoubleClick={() => { setRenameId(page.id); setRenameDraft(page.title); }} className="w-full text-left">
                      <p className="flex items-center gap-1.5 truncate text-xs font-medium">
                        <span className="text-muted-foreground">{index + 1}.</span> {page.title || 'Untitled page'}
                        {page.locked && <Lock className="h-3 w-3 text-muted-foreground" />}
                      </p>
                      <p className="truncate text-2xs text-muted-foreground">
                        {page.layout} · {page.wordCount ? `${formatNumber(page.wordCount)} words` : 'empty'} · {sectionTitle(page.sectionId)}
                        {page.startOnRecto ? ' · recto' : ''}
                      </p>
                    </button>
                  )}
                </div>
                <Popover
                  align="end"
                  trigger={<Button variant="ghost" size="xs" aria-label={`Page actions for ${page.title}`}><ChevronDown className="h-3 w-3" /></Button>}
                  className="w-56 p-1"
                >
                  <div className="space-y-0.5">
                    <MenuButton label="Rename" onClick={() => { setRenameId(page.id); setRenameDraft(page.title); }} />
                    <MenuButton label="Insert page before" onClick={() => onInsertPage(page.id, 'before', 'flow')} />
                    <MenuButton label="Insert page after" onClick={() => onInsertPage(page.id, 'after', 'flow')} />
                    <MenuButton label="Insert blank page after" onClick={() => onInsertPage(page.id, 'after', 'blank')} />
                    <MenuButton label="Duplicate page" onClick={() => onDuplicatePage(page.id)} />
                    <MenuButton label="Move page up" onClick={() => onMovePage(page.id, 'up')} />
                    <MenuButton label="Move page down" onClick={() => onMovePage(page.id, 'down')} />
                    <MenuButton label={page.locked ? 'Unlock page' : 'Lock page'} onClick={() => onPatchPage(page.id, { locked: !page.locked })} />
                    <MenuButton label={page.startOnRecto ? 'Allow left-hand start' : 'Start on right (recto)'} onClick={() => onPatchPage(page.id, { startOnRecto: !page.startOnRecto })} />
                    <MenuButton label={page.keepTogether ? 'Allow breaking' : 'Keep paragraphs together'} onClick={() => onPatchPage(page.id, { keepTogether: !page.keepTogether })} />
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
                    <MenuButton label="Delete page" destructive onClick={async () => { const ok = await confirm({ title: `Delete “${page.title || 'this page'}”?`, description: 'The page is removed from the book immediately.', destructive: true, confirmLabel: 'Delete page' }); if (ok) onRemovePage(page.id); }} />
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

function ChaptersPanel({
  book, activePage, onPatchSection, onAddSection, onAddPage, onRemoveSection, onReorderSections, onSplitSection, onSelectPage,
  onDuplicateSection, onMoveSection, collapsedSections, onToggleSectionCollapsed,
}: Props) {
  const { success } = useToast();
  const confirm = useConfirm();
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');

  const collapsed = new Set(collapsedSections);
  const toggle = (id: string) => onToggleSectionCollapsed(id);

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

  const sections = [...book.sections]
    .sort((a, b) => a.order - b.order)
    .filter((section) => !query || section.title.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a chapter" className="h-8 pl-7 text-xs" aria-label="Find a chapter" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-2xs text-muted-foreground">{book.sections.length} sections · drag to reorder</p>
        <DropdownMenu
          trigger={<Button size="xs" variant="outline"><Plus className="h-3 w-3" /> Chapter</Button>}
          items={SECTION_KINDS.map((kind) => ({
            id: kind,
            label: kind.replace('-', ' ').replace(/^\w/, (letter) => letter.toUpperCase()),
            onSelect: () => {
              const section = onAddSection(kind === 'chapter' ? 'Untitled chapter' : kind.replace('-', ' ').replace(/^\w/, (letter) => letter.toUpperCase()), kind);
              if (section && collapsed.has(section.id)) onToggleSectionCollapsed(section.id);
            },
          })) as MenuItemDef[]}
        />
      </div>
      <div className="space-y-2">
        {sections.map((section, order) => {
          const open = !collapsed.has(section.id);
          const pages = section.pageIds.map((pageId) => book.pages.find((entry) => entry.id === pageId)).filter(Boolean) as BookPage[];
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
                <button type="button" onClick={() => toggle(section.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${section.title}`}>
                  {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{section.title}</span>
                    <span className="block truncate text-2xs text-muted-foreground">{section.kind.replace('-', ' ')} · {section.pageIds.length} pages · {formatNumber(section.wordCount)} words</span>
                  </span>
                </button>
                <Popover
                  align="end"
                  trigger={<Button variant="ghost" size="xs" aria-label={`Chapter actions for ${section.title}`}><ChevronDown className="h-3 w-3" /></Button>}
                  className="w-52 p-1"
                >
                  <div className="space-y-0.5">
                    <MenuButton label="Show pages" onClick={() => { if (collapsed.has(section.id)) toggle(section.id); }} />
                    <MenuButton label="Hide pages" onClick={() => { if (!collapsed.has(section.id)) toggle(section.id); }} />
                    <MenuButton label="Duplicate chapter" onClick={() => onDuplicateSection(section.id)} />
                    <MenuButton label="Move chapter up" onClick={() => onMoveSection(section.id, 'up')} />
                    <MenuButton label="Move chapter down" onClick={() => onMoveSection(section.id, 'down')} />
                    <MenuButton label="Add page to chapter" onClick={() => onAddPage(section.id, 'flow')} />
                    <MenuButton
                      label={section.kind === 'chapter' ? 'Make a part' : 'Make a chapter'}
                      onClick={() => onPatchSection(section.id, { kind: section.kind === 'chapter' ? 'part' : 'chapter' })}
                    />
                    <MenuButton
                      label="Delete chapter"
                      destructive
                      onClick={async () => {
                        const ok = await confirm({ title: `Delete “${section.title}”?`, description: `${section.pageIds.length} pages will be removed with it.`, destructive: true, confirmLabel: 'Delete section' });
                        if (ok) onRemoveSection(section.id);
                      }}
                    />
                  </div>
                </Popover>
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
                  <div className="flex gap-1">
                    <Button size="xs" variant="outline" onClick={() => onAddSection(`${section.title} continued`, section.kind)}>
                      <Plus className="h-3 w-3" /> Sub-chapter
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => onMoveSection(section.id, 'up')} disabled={order === 0} aria-label="Move up">↑</Button>
                    <Button size="xs" variant="ghost" onClick={() => onMoveSection(section.id, 'down')} disabled={order === book.sections.length - 1} aria-label="Move down">↓</Button>
                  </div>
                  <div className="space-y-0.5 pt-1">
                    {pages.map((page) => (
                      <button
                        key={page.id}
                        type="button"
                        draggable
                        onDragStart={() => setDragId(page.id)}
                        onClick={() => onSelectPage(page.id)}
                        className={cn('flex w-full items-center gap-1.5 truncate rounded px-1.5 py-1 text-left text-2xs hover:bg-muted', page.id === activePage?.id && 'bg-primary/10 text-primary')}
                      >
                        <FileText className="h-3 w-3 shrink-0 opacity-60" />
                        <span className="truncate">{page.title || 'Untitled'}</span>
                      </button>
                    ))}
                    {pages.length === 0 && <p className="px-1 text-2xs text-muted-foreground">No pages — add one from the Pages panel.</p>}
                  </div>
                  <div className="flex flex-wrap gap-1 pt-1">
                    <Button size="xs" variant="ghost" onClick={() => onPatchSection(section.id, { status: section.status === 'complete' ? 'drafting' : 'complete' })}>
                      {section.status === 'complete' ? 'Reopen' : 'Mark complete'}
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => { if (activePage) onSplitSection(activePage.id); }} disabled={!section.pageIds.includes(activePage?.id ?? '')}>
                      Split at current page
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
  const [query, setQuery] = React.useState('');
  const [groupId, setGroupId] = React.useState(ELEMENT_LIBRARY[0].id);

  if (!activePage) {
    return <EmptyState icon={<Square className="h-5 w-5" />} title="No page selected" description="Pick a page in the Pages panel to add elements." />;
  }

  const searching = query.trim().length > 0;
  const matches = searching
    ? ELEMENT_LIBRARY.flatMap((group) => group.entries.filter((entry) => entry.label.toLowerCase().includes(query.trim().toLowerCase())).map((entry) => ({ group, entry })))
    : [];
  const group = ELEMENT_LIBRARY.find((entry) => entry.id === groupId) ?? ELEMENT_LIBRARY[0];

  const insert = (entry: LibraryEntry) => {
    if (!canUseAdvancedEditor) {
      onRequestUpgrade('advanced');
      return;
    }
    onAddElement(entry.build(activePage));
    success(`${entry.label} added`, 'Switch to Design mode to move, resize and style it.');
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search elements" className="h-8 pl-7 text-xs" aria-label="Search elements" />
      </div>
      {!searching && (
        <div className="flex flex-wrap gap-1">
          {ELEMENT_LIBRARY.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setGroupId(entry.id)}
              className={cn('rounded-full border px-2 py-0.5 text-2xs transition-colors', entry.id === group.id ? 'border-primary bg-primary/10 text-primary' : 'hover:border-primary/40')}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
      {!searching && <p className="text-2xs text-muted-foreground">{group.description}</p>}
      <div className="grid grid-cols-2 gap-1.5">
        {(searching ? matches.map((hit) => hit.entry) : group.entries).map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => insert(entry)}
            title={entry.hint ?? `Insert ${entry.label}`}
            className="flex flex-col items-start gap-1 rounded border p-2 text-left text-2xs transition-colors hover:border-primary hover:bg-primary/5"
          >
            <span className="flex h-8 w-full items-center justify-center rounded bg-muted">
              {entry.type === 'shape' ? <Square className="h-4 w-4" /> : entry.type === 'line' || entry.type === 'divider' ? <Minus className="h-4 w-4" /> : entry.type === 'pageNumber' ? <Hash className="h-4 w-4" /> : entry.type === 'quote' ? <Quote className="h-4 w-4" /> : entry.type === 'image' ? <ImageIcon className="h-4 w-4" /> : <Type className="h-4 w-4" />}
            </span>
            <span className="line-clamp-2">{entry.label}</span>
          </button>
        ))}
      </div>
      {searching && matches.length === 0 && <p className="text-xs text-muted-foreground">Nothing matches “{query}”.</p>}
      <p className="text-2xs text-muted-foreground">Inserted items are real objects: select them on the page to move, resize, restyle or lock them.</p>
    </div>
  );
}

/* --------------------------------------------------------- element factory */

function createElement(type: ElementType, page: BookPage): PageElement {
  const base: PageElement = {
    id: uid('el'),
    type,
    name: type === 'pageNumber' ? 'Page number' : `New ${type}`,
    x: 18,
    y: 22,
    w: 32,
    h: 20,
    rotation: 0,
    visible: true,
    locked: false,
    z: 5,
  };
  if (type === 'shape') return { ...base, shape: { kind: 'rect', fill: '#e2e8f0', stroke: 'transparent', strokeWidth: 0, radius: 8 } };
  if (type === 'line' || type === 'divider') return { ...base, w: 44, h: 3, divider: { style: 'solid', color: '#111827', thickness: 1 } };
  if (type === 'table') {
    return {
      ...base,
      w: 60,
      h: 30,
      table: {
        rows: 3,
        cols: 3,
        cells: [
          ['Header', 'Header', 'Header'],
          ['', '', ''],
          ['', '', ''],
        ],
        headerRow: true,
        borderColor: '#cbd5e1',
      },
    };
  }
  if (type === 'image') {
    return { ...base, w: 40, h: 30, image: { src: '', fit: 'cover', radius: 4, opacity: 1, filters: { grayscale: 0, sepia: 0, blur: 0, brightness: 100, contrast: 100 } } };
  }
  if (type === 'pageNumber') return { ...base, x: 44, y: 92, w: 12, h: 4 };
  return { ...base, text: `<p>${page.title || 'New text block'}</p>`, style: { fontSize: 16, lineHeight: 1.5 } };
}

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
  const qc = useQueryClient();
  const { success, warning, info } = useToast();
  const [category, setCategory] = React.useState<AssetCategoryId>('uploads');
  const [query, setQuery] = React.useState('');
  const [aiOpen, setAiOpen] = React.useState(false);
  const [prompt, setPrompt] = React.useState('A lantern-lit doorway, muted palette, textured gouache');
  const [busy, setBusy] = React.useState(false);
  const confirm = useConfirm();
  const [providers, setProviders] = React.useState<FreeImageProviderId[]>(['unsplash', 'pexels', 'pixabay']);
  const [orientation, setOrientation] = React.useState<'any' | 'portrait' | 'landscape' | 'square'>('any');
  const [freeQuery, setFreeQuery] = React.useState('harbour');
  const [freeResults, setFreeResults] = React.useState<FreeImageResult[] | null>(null);
  const [freeNotice, setFreeNotice] = React.useState('');
  const [freeBusy, setFreeBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const kinds = assetKindsFor(category);
  // Own uploads + the admin-managed global library, both read through the service layer.
  const library = React.useMemo(() => (category === 'free' ? [] : assetService.library('all')), [category]);
  const merged = category === 'uploads'
    ? (assets ?? [])
    : [...(assets ?? []).filter((asset) => (kinds.length ? kinds.includes(asset.kind) : true)), ...library.filter((asset) => (kinds.length ? kinds.includes(asset.kind) : true))];
  const filtered = merged
    .filter((asset) => !query || asset.name.toLowerCase().includes(query.toLowerCase()) || asset.tags.some((tag) => tag.includes(query.toLowerCase())))
    .filter((asset, index, list) => list.findIndex((entry) => entry.id === asset.id) === index);

  const insert = (url: string, name: string, credit?: { provider: string; author?: string }) => {
    if (!activePage) return;
    if (!canUseAdvancedEditor) {
      onRequestUpgrade('advanced');
      return;
    }
    const element = createElement('image', activePage);
    onAddElement({
      ...element,
      name,
      image: { ...element.image!, src: url, credit, fit: 'cover', radius: 4, opacity: 1, filters: { grayscale: 0, sepia: 0, blur: 0, brightness: 100, contrast: 100 } },
      wrap: 'square',
    });
    success('Image placed on the page', 'Set its text wrap in the image toolbar.');
  };

  const upload = async (file: File) => {
    if (!user) return;
    setBusy(true);
    try {
      const asset = await storageService.uploadFile(user.id, file, 'Editor uploads', file.type.startsWith('image/') ? 'image' : 'upload');
      await qc.invalidateQueries({ queryKey: ['assets'] });
      insert(asset.url, asset.name);
      success('Uploaded and placed', `${asset.name} · ${formatBytes(asset.sizeBytes)}`);
    } catch (error) {
      warning('Upload failed', error instanceof Error ? error.message : 'The file could not be stored.');
    } finally {
      setBusy(false);
    }
  };

  const runFreeSearch = async () => {
    setFreeBusy(true);
    try {
      const result = await freeImageService.search({ query: freeQuery, provider: providers.length === 1 ? providers[0] : 'all', orientation });
      setFreeResults(result.results);
      setFreeNotice(result.notice);
    } finally {
      setFreeBusy(false);
    }
  };

  const current = ASSET_CATEGORIES.find((entry) => entry.id === category)!;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search assets" className="h-8 pl-7 text-xs" aria-label="Search assets" />
      </div>
      <div className="flex flex-wrap gap-1">
        {ASSET_CATEGORIES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setCategory(entry.id)}
            className={cn('rounded-full border px-2 py-0.5 text-2xs transition-colors', entry.id === category ? 'border-primary bg-primary/10 text-primary' : 'hover:border-primary/40')}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <p className="text-2xs text-muted-foreground">{current.description}</p>

      {(category === 'uploads' || category === 'images' || category === 'illustrations' || category === 'icons' || category === 'shapes' || category === 'backgrounds' || category === 'frames' || category === 'stickers' || category === 'logos') && (
        <>
          <div className="flex gap-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,image/svg+xml,video/*,audio/*,.pdf,.doc,.docx,.epub"
              className="hidden"
              onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }}
            />
            <Button size="xs" variant="outline" className="flex-1" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Plus className="h-3 w-3" /> {busy ? 'Uploading…' : 'Upload'}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setAiOpen(true)}><Wand2 className="h-3 w-3" /> AI</Button>
          </div>
          {isLoading && <div className="grid grid-cols-3 gap-1.5">{Array.from({ length: 9 }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded bg-muted" />)}</div>}
          <div className="grid grid-cols-3 gap-1.5">
            {filtered.slice(0, 30).map((asset) => (
              <div key={asset.id} className="group relative aspect-square overflow-hidden rounded border">
                <button type="button" onClick={() => insert(asset.url, asset.name)} title={`${asset.name} · ${asset.mimeType} · ${formatBytes(asset.sizeBytes)}`} className="h-full w-full">
                  {asset.mimeType.startsWith('video') || asset.mimeType.startsWith('audio') || asset.kind === 'upload' && !asset.mimeType.startsWith('image') ? (
                    <span className="flex h-full w-full items-center justify-center bg-muted text-[8px] uppercase text-muted-foreground">
                      {asset.mimeType.split('/')[1]?.slice(0, 4) ?? 'file'}
                    </span>
                  ) : (
                    <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" loading="lazy" />
                  )}
                </button>
                {asset.kind === 'ai-image' && <span className="absolute right-0.5 top-0.5 rounded bg-primary px-1 text-[8px] text-primary-foreground">AI</span>}
                {asset.ownerId === 'user_admin' && <span className="absolute right-0.5 top-0.5 rounded bg-foreground/70 px-1 text-[8px] text-background">Library</span>}
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/60 px-1 py-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="truncate text-[8px] text-white">{asset.name}</span>
                  <button
                    type="button"
                    aria-label={`Delete ${asset.name}`}
                    className="rounded p-0.5 text-white hover:bg-white/20"
                    onClick={async () => {
                      const ok = await confirm({ title: `Delete “${asset.name}”?`, description: 'The file is removed from your library. Pages that already use it keep the image.', destructive: true, confirmLabel: 'Delete asset' });
                      if (!ok) return;
                      await assetService.remove(asset.id);
                      await qc.invalidateQueries({ queryKey: ['assets'] });
                      info('Asset deleted');
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {!isLoading && filtered.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {category === 'uploads' ? 'No uploads yet — drop in an image, SVG, illustration, video, audio or document. Uploads stay in your gallery for every book.' : 'Nothing in this category yet.'}
            </p>
          )}
          {filtered.length > 0 && (
            <p className="text-2xs text-muted-foreground">
              {filtered.length} file{filtered.length === 1 ? '' : 's'} · {formatBytes(filtered.reduce((total, asset) => total + asset.sizeBytes, 0), 1)} · uploads are kept after insertion
            </p>
          )}
        </>
      )}

      {category === 'ai' && (
        <>
          <Button size="xs" variant="outline" className="w-full" onClick={() => setAiOpen(true)}><Wand2 className="h-3 w-3" /> Generate an illustration</Button>
          <div className="grid grid-cols-3 gap-1.5">
            {(assets ?? []).filter((asset) => asset.kind === 'ai-image').map((asset) => (
              <button key={asset.id} type="button" onClick={() => insert(asset.url, asset.name)} className="aspect-square overflow-hidden rounded border hover:border-primary">
                <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
          <p className="text-2xs text-muted-foreground">{entitlements.usage.aiImages.used} of {entitlements.usage.aiImages.limit} image credits used this month.</p>
        </>
      )}

      {category === 'covers' && (
        <div className="grid grid-cols-2 gap-1.5">
          {(assets ?? []).filter((asset) => asset.kind === 'cover').map((asset) => (
            <button key={asset.id} type="button" onClick={() => insert(asset.url, asset.name)} className="aspect-[2/3] overflow-hidden rounded border hover:border-primary">
              <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
          {(assets ?? []).filter((asset) => asset.kind === 'cover').length === 0 && <p className="text-xs text-muted-foreground">No covers stored yet — design one in the Cover tab.</p>}
        </div>
      )}

      {category === 'free' && (
        <>
          <div className="space-y-1.5">
            <Input value={freeQuery} onChange={(event) => setFreeQuery(event.target.value)} placeholder="Search free images (e.g. harbour)" className="h-8 text-xs" aria-label="Search free images" />
            <div className="flex flex-wrap gap-1">
              {freeImageService.providers().map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  title={`${provider.licence}${provider.enabled ? '' : ' — not enabled yet'}`}
                  aria-pressed={providers.includes(provider.id)}
                  onClick={() => setProviders((current) => (current.includes(provider.id) ? current.filter((id) => id !== provider.id) : [...current, provider.id]))}
                  className={cn('rounded-full border px-2 py-0.5 text-2xs', providers.includes(provider.id) ? 'border-primary bg-primary/10 text-primary' : 'hover:border-primary/40', !provider.enabled && 'opacity-50')}
                >
                  {provider.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <select value={orientation} onChange={(event) => setOrientation(event.target.value as typeof orientation)} className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs" aria-label="Image orientation">
                <option value="any">Any shape</option>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
                <option value="square">Square</option>
              </select>
              <Button size="xs" onClick={runFreeSearch} disabled={freeBusy || providers.length === 0}>{freeBusy ? 'Searching…' : 'Search'}</Button>
            </div>
          </div>
          {freeNotice && <p className="rounded bg-muted px-2 py-1 text-2xs text-muted-foreground">{freeNotice}</p>}
          <div className="grid grid-cols-3 gap-1.5">
            {(freeResults ?? []).slice(0, 24).map((result) => (
              <div key={result.id} className="group relative aspect-square overflow-hidden rounded border">
                <img src={result.thumbnailUrl} alt={result.title} className="h-full w-full object-cover" loading="lazy" />
                <button
                  type="button"
                  onClick={() => insert(result.url, result.title, { provider: result.provider, author: result.author })}
                  className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5 text-[8px] text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  Add to Book
                </button>
                <span className="absolute left-0.5 top-0.5 rounded bg-black/60 px-1 text-[8px] uppercase text-white">{result.provider}</span>
              </div>
            ))}
          </div>
          {freeResults && freeResults.length === 0 && <p className="text-xs text-muted-foreground">No results on the enabled sources. Try another word or enable more providers.</p>}
          <p className="text-2xs text-muted-foreground">Approved sources only. Keys live on the server proxy; attribution is stored with each image for exports.</p>
        </>
      )}

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
                  await qc.invalidateQueries({ queryKey: ['assets'] });
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
