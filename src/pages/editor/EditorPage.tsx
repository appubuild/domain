import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { Editor } from '@tiptap/react';
import {
  AlertTriangle, ArrowLeft, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Cloud, CloudOff, Command, Eye, Filter, Grid2X2, History, Keyboard, Layers, Loader2, Maximize2, MessageSquare, Minus, PanelLeftClose, PanelRightClose, Plus, Printer, Redo2, Replace, Ruler, Save, Search, Send, Share2, Sparkles, Trash2, Undo2, Upload, Users, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { Badge, Button, Checkbox, Input, Label, Separator, Switch, Textarea } from '@/components/ui/primitives';
import { DropdownMenu, Modal, Popover, Tabs, useConfirm, type MenuItemDef } from '@/components/ui/overlays';
import { EmptyState, ErrorState, ProgressList } from '@/components/ui/data';
import { useToast } from '@/components/ui/toast';
import { FlowToolbar, PageCanvas, pagePixelSize } from './PageCanvas';
import { EditorSidebar, type SidebarTab } from './EditorSidebar';
import { PropertiesPanel } from './PropertiesPanel';
import { CoverDesigner } from './CoverDesigner';
import { useEditorProject } from './useEditorProject';
import { useAuth } from '@/providers/AuthProvider';
import { bookService, exportService, preflightService, publishingService, storageService } from '@/services';
import { EXPORT_FORMAT_INFO, PUBLISHING_PROFILES } from '@/data/constants';
import { formatNumber, timeAgo } from '@/lib/format';
import { cn, countWords } from '@/lib/utils';
import type { Book, BookPage, ElementType, ExportFormat, PageElement, PublishingProfileId, VersionEntry } from '@/types/domain';
import type { FeatureKey } from '@/services/entitlements';

const MODES: { value: 'write' | 'design' | 'preview' | 'cover'; label: string }[] = [
  { value: 'write', label: 'Write' },
  { value: 'design', label: 'Design' },
  { value: 'preview', label: 'Preview' },
  { value: 'cover', label: 'Cover' },
];

function EditorPage() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, entitlements } = useAuth();
  const { success, error, warning, info } = useToast();
  const confirm = useConfirm();

  const project = useEditorProject(bookId);
  const {
    book, loading, error: loadError, status, lastSavedAt, mode, setMode, activePageId, setActivePageId,
    selectedElementId, selectElement, patchBook, patchPage, patchPages, patchElement, addElement, removeElement,
    duplicateElement, reorderElement, addPage, duplicatePage, removePage, reorderPages, movePageToSection,
    addSection, patchSection, removeSection, reorderSections, splitSection, generateToc, undo, redo, canUndo, canRedo,
    saveNow, versions, createCheckpoint, restoreVersion,
  } = project;

  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [rightOpen, setRightOpen] = React.useState(true);
  const [tab, setTab] = React.useState<SidebarTab>('pages');
  const [zoom, setZoom] = React.useState(1);
  const [showRulers, setShowRulers] = React.useState(true);
  const [showGuides, setShowGuides] = React.useState(true);
  const [editor, setEditor] = React.useState<Editor | null>(null);
  const [selectionText, setSelectionText] = React.useState('');
  const [focusMode, setFocusMode] = React.useState(false);
  const [modal, setModal] = React.useState<null | 'share' | 'versions' | 'comments' | 'export' | 'find' | 'help' | 'publish'>(null);
  const [summaryOpen, setSummaryOpen] = React.useState(false);
  const [lastSaved, setLastSaved] = React.useState<string | null>(lastSavedAt);
  const [titleDraft, setTitleDraft] = React.useState('');

  React.useEffect(() => { if (book) setTitleDraft(book.title); }, [book?.id, book?.title]);
  React.useEffect(() => { if (status === 'saved') setLastSaved(new Date().toISOString()); }, [status]);

  const activePage = book?.pages.find((page) => page.id === activePageId);
  const activePageIndex = book ? book.pages.findIndex((page) => page.id === activePageId) : -1;
  const selectedElement = activePage?.elements.find((element) => element.id === selectedElementId);

  /* ------------------------------------------------------------ shortcuts */

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      const target = event.target as HTMLElement | null;
      const typing = target ? ['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable : false;
      if (meta && event.key.toLowerCase() === 's') { event.preventDefault(); void saveNow().then(() => success('Saved')); return; }
      if (meta && event.key.toLowerCase() === 'z' && !event.shiftKey) { if (!typing) { event.preventDefault(); undo(); } return; }
      if (meta && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) { if (!typing) { event.preventDefault(); redo(); } return; }
      if (meta && event.key.toLowerCase() === 'f') { event.preventDefault(); setModal('find'); return; }
      if (meta && event.key.toLowerCase() === 'p') { event.preventDefault(); setMode('preview'); return; }
      if (event.key === 'Escape') { setModal(null); setFocusMode(false); selectElement(null); return; }
      if (event.key === 'Delete' && selectedElement && !typing) {
        event.preventDefault();
        removeElement(activePage!.id, selectedElement.id);
        selectElement(null);
        return;
      }
      if (meta && event.key === '/') { event.preventDefault(); setModal('help'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activePage, removeElement, redo, saveNow, selectElement, selectedElement, setMode, success, undo]);

  /* --------------------------------------------------------------- guards */

  if (loading && !book) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <p className="text-sm">Opening the editor…</p>
        </div>
      </div>
    );
  }

  if (loadError || !book) {
    return (
      <div className="p-6">
        <ErrorState title="This book could not be opened" description={loadError ?? 'The book may have been deleted.'} onRetry={() => navigate('/dashboard/books')} retryLabel="Back to my books" />
      </div>
    );
  }

  const positionPage = (delta: number) => {
    const next = book.pages[activePageIndex + delta];
    if (next) setActivePageId(next.id);
  };

  const patchElementForActive = (elementId: string, patch: Partial<PageElement>, options?: { transient?: boolean }) => {
    if (!activePage) return;
    patchElement(activePage.id, elementId, patch, options);
  };

  const insertIntoDocument = (html: string) => {
    if (editor) {
      editor.chain().focus().insertContent(html).run();
      return;
    }
    if (!activePage) return;
    patchPage(activePage.id, { content: `${activePage.content}${html}` });
  };

  const replaceSelection = (html: string) => {
    if (editor && !editor.state.selection.empty) {
      editor.chain().focus().insertContent(html).run();
      return;
    }
    if (!activePage) return;
    patchPage(activePage.id, { content: html });
  };

  const requireUpgrade = (feature: string) => {
    info('Upgrade required', entitlements.upgradeReason(feature as FeatureKey) || 'This feature is part of a higher plan.');
    navigate('/dashboard/subscription');
  };

  const persistCover = (patch: Partial<Book['cover']>) => {
    patchBook({ cover: { ...book.cover, ...patch } });
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col bg-muted/30">
      {/* ------------------------------------------------------- top toolbar */}
      <header className="flex flex-wrap items-center gap-2 border-b bg-background px-2 py-1.5">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/dashboard/books/${book.id}`)} aria-label="Back to book overview">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setSidebarOpen((open) => !open)} aria-label="Toggle panels">
          {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <Layers className="h-4 w-4" />}
        </Button>

        <input
          value={titleDraft}
          onChange={(event) => setTitleDraft(event.target.value)}
          onBlur={() => titleDraft.trim() && titleDraft !== book.title && patchBook({ title: titleDraft.trim() })}
          className="w-40 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium hover:border-input focus:border-input focus:outline-none sm:w-56"
          aria-label="Book title"
        />

        <div className="flex items-center gap-1 rounded-md border p-0.5">
          <Tabs value={mode} onValueChange={(value) => setMode(value as typeof mode)} size="sm" tabs={MODES} />
        </div>

        <div className="hidden items-center gap-1 sm:flex">
          <Button variant="ghost" size="icon" onClick={undo} disabled={!canUndo} aria-label="Undo"><Undo2 className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={redo} disabled={!canRedo} aria-label="Redo"><Redo2 className="h-4 w-4" /></Button>
        </div>

        <SaveStatus status={status} lastSaved={lastSaved} wordCount={book.wordCount} pageCount={book.pageCount} onSave={() => void saveNow().then(() => success('Draft saved'))} onOpenSummary={() => setSummaryOpen(true)} />

        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setModal('find')} aria-label="Find and replace"><Search className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={() => setModal('comments')} aria-label="Comments"><MessageSquare className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={() => setModal('versions')} aria-label="Version history"><History className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={() => setModal('share')} aria-label="Share"><Share2 className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={() => setModal('help')} aria-label="Keyboard shortcuts"><Keyboard className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setModal('export')}><Upload className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Export</span></Button>
          <Button size="sm" onClick={() => setModal('publish')}><Send className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Publish</span></Button>
          <Button variant="ghost" size="icon" onClick={() => setRightOpen((open) => !open)} aria-label="Toggle properties panel">
            <PanelRightClose className={cn('h-4 w-4 transition-transform', !rightOpen && 'rotate-180')} />
          </Button>
        </div>
      </header>

      {/* ------------------------------------------------------------- body */}
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && !focusMode && (
          <aside className="hidden w-72 shrink-0 border-r bg-background md:block">
            <EditorSidebar
              tab={tab}
              onTabChange={setTab}
              book={book}
              activePage={activePage}
              activePageIndex={activePageIndex}
              selectionText={selectionText}
              canUseAdvancedEditor={entitlements.canUseAdvancedEditor()}
              onSelectPage={setActivePageId}
              onPatchPage={(pageId, patch) => patchPage(pageId, patch)}
              onPatchSection={patchSection}
              onAddPage={(sectionId, layout) => { const created = addPage(sectionId, layout); if (created) setActivePageId(created.id); }}
              onAddSection={(title, kind) => addSection(title, kind)}
              onDuplicatePage={duplicatePage}
              onRemovePage={removePage}
              onRemoveSection={removeSection}
              onReorderPages={reorderPages}
              onReorderSections={reorderSections}
              onMovePageToSection={movePageToSection}
              onSplitSection={splitSection}
              onAddElement={(element) => { if (activePage) { addElement(activePage.id, element); selectElement(element.id); setMode('design'); } }}
              onApplyTemplate={(template) => {
                void bookService.applyThemeToAllPages(book.id, template.palette ?? book.theme.palette).then(() => {
                  const fresh = bookService.get(book.id);
                  if (fresh) patchBook({ theme: fresh.theme, fonts: fresh.fonts, cover: { ...book.cover, gradient: fresh.cover.gradient } });
                  success(`${template.name} applied`, 'Typography and palette updated across the book.');
                });
              }}
              onGenerateToc={generateToc}
              onToggleToc={() => patchBook({ toc: { ...book.toc, enabled: !book.toc.enabled } })}
              onTocTitle={(title) => patchBook({ toc: { ...book.toc, title } })}
              onInsertAiText={insertIntoDocument}
              onReplaceAiText={replaceSelection}
              onAiNote={(text) => { if (activePage) patchPage(activePage.id, { notes: `${activePage.notes ? `${activePage.notes}\n` : ''}${text.replace(/<[^>]+>/g, '')}` }); success('Note saved to this page'); }}
              onRequestUpgrade={requireUpgrade}
            />
          </aside>
        )}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {focusMode && (
            <div className="flex items-center gap-2 border-b bg-background px-3 py-1">
              <Badge variant="secondary" className="text-2xs">Focus mode</Badge>
              <span className="text-2xs text-muted-foreground">Panels are hidden. Press Escape or Save to exit.</span>
              <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setFocusMode(false)}><X className="h-3 w-3" /> Exit focus</Button>
            </div>
          )}

          {mode !== 'cover' && (
            <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-1.5">
              <Button size="xs" variant="ghost" onClick={() => positionPage(-1)} disabled={activePageIndex <= 0} aria-label="Previous page"><ChevronLeft className="h-3.5 w-3.5" /></Button>
              <span className="text-2xs text-muted-foreground">
                Page {activePageIndex + 1} of {book.pages.length}
                {activePage ? ` · ${activePage.title || 'Untitled'} · ${activePage.layout}` : ''}
              </span>
              <Button size="xs" variant="ghost" onClick={() => positionPage(1)} disabled={activePageIndex >= book.pages.length - 1} aria-label="Next page"><ChevronRight className="h-3.5 w-3.5" /></Button>
              <Separator orientation="vertical" className="h-4" />
              <Button size="xs" variant="ghost" onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.1).toFixed(2))))} aria-label="Zoom out"><ZoomOut className="h-3.5 w-3.5" /></Button>
              <span className="w-10 text-center text-2xs">{Math.round(zoom * 100)}%</span>
              <Button size="xs" variant="ghost" onClick={() => setZoom((value) => Math.min(2, Number((value + 0.1).toFixed(2))))} aria-label="Zoom in"><ZoomIn className="h-3.5 w-3.5" /></Button>
              <Button size="xs" variant="ghost" onClick={() => setZoom(1)} aria-label="Reset zoom"><Maximize2 className="h-3.5 w-3.5" /></Button>
              <Separator orientation="vertical" className="h-4" />
              <Button size="xs" variant={showRulers ? 'secondary' : 'ghost'} onClick={() => setShowRulers((value) => !value)}><Ruler className="h-3.5 w-3.5" /> Rulers</Button>
              <Button size="xs" variant={showGuides ? 'secondary' : 'ghost'} onClick={() => setShowGuides((value) => !value)}><Grid2X2 className="h-3.5 w-3.5" /> Guides</Button>
              <Button size="xs" variant={focusMode ? 'secondary' : 'ghost'} onClick={() => setFocusMode((value) => !value)}><Eye className="h-3.5 w-3.5" /> Focus</Button>
              {mode === 'write' && <div className="hidden lg:block"><FlowToolbar editor={editor} /></div>}
              <div className="ml-auto flex items-center gap-1">
                <Badge variant={mode === 'write' ? 'secondary' : 'outline'} className="text-2xs">{mode}</Badge>
                <span className="hidden text-2xs text-muted-foreground sm:inline">{countWords(activePage?.content ?? '')} words on this page</span>
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
            {mode === 'cover' ? (
              <div className="h-full">
                <CoverDesigner book={book} onPatchCover={persistCover} onRequestUpgrade={requireUpgrade} canGenerateCover={entitlements.canGenerateCover()} />
              </div>
            ) : mode === 'preview' ? (
              <PreviewMode book={book} activePageId={activePageId} onSelectPage={setActivePageId} />
            ) : activePage ? (
              <div className={cn('flex justify-center p-6', mode === 'design' && 'bg-muted/50')}>
                <PageCanvas
                  book={book}
                  page={activePage}
                  pageIndex={activePageIndex}
                  zoom={zoom}
                  showRulers={showRulers}
                  showGuides={showGuides}
                  editable
                  selectedElementId={selectedElementId}
                  onSelectElement={selectElement}
                  onPatchElement={patchElementForActive}
                  onContentChange={(html) => patchPage(activePage.id, { content: html })}
                  registerEditor={(instance) => {
                    setEditor(instance);
                    if (!instance) return;
                    const update = () => setSelectionText(instance.state.doc.textBetween(Math.max(0, instance.state.selection.from - 1), instance.state.selection.to, ' '));
                    instance.on('selectionUpdate', update);
                    instance.on('update', update);
                  }}
                  onDeleteElement={(elementId) => { removeElement(activePage.id, elementId); selectElement(null); }}
                  onDuplicateElement={(elementId) => { duplicateElement(activePage.id, elementId); success('Element duplicated'); }}
                  onRequirePremium={() => requireUpgrade('advanced_editor')}
                  canUseAdvancedEditor={entitlements.canUseAdvancedEditor()}
                />
              </div>
            ) : (
              <div className="p-6">
                <EmptyState
                  icon={<BookOpen className="h-5 w-5" />}
                  title="This book has no pages yet"
                  description="Add the first page to start writing, or apply a template to get a full structure."
                  actions={<Button onClick={() => { const page = addPage(book.sections[0]?.id ?? '', 'flow'); if (page) setActivePageId(page.id); }}><Plus className="h-4 w-4" /> Add first page</Button>}
                />
              </div>
            )}
          </div>

          {mode === 'design' && activePage && (
            <div className="flex items-center gap-2 border-t bg-background px-3 py-1">
              <span className="text-2xs text-muted-foreground">Quick add:</span>
              {(['text', 'image', 'shape', 'divider', 'table'] as ElementType[]).map((type) => (
                <Button
                  key={type}
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    const element = quickElement(type, activePage);
                    addElement(activePage.id, element);
                    selectElement(element.id);
                    if (!entitlements.canUseAdvancedEditor) requireUpgrade('advanced_editor');
                  }}
                >
                  <Plus className="h-3 w-3" /> {type}
                </Button>
              ))}
              <div className="ml-auto flex items-center gap-1">
                {selectedElement && (
                  <>
                    <span className="text-2xs text-muted-foreground">{selectedElement.name}</span>
                    <Button size="xs" variant="ghost" onClick={() => reorderElement(activePage.id, selectedElement.id, 'front')}>Front</Button>
                    <Button size="xs" variant="ghost" onClick={() => reorderElement(activePage.id, selectedElement.id, 'back')}>Back</Button>
                    <Button size="xs" variant="ghost" onClick={() => { duplicateElement(activePage.id, selectedElement.id); }}>Duplicate</Button>
                    <Button size="xs" variant="ghost" onClick={() => { removeElement(activePage.id, selectedElement.id); selectElement(null); }}><Trash2 className="h-3 w-3" /></Button>
                  </>
                )}
                <Button size="xs" variant="ghost" onClick={() => { const page = addPage(activePage.sectionId, 'canvas'); if (page) setActivePageId(page.id); }}><Plus className="h-3 w-3" /> Page</Button>
              </div>
            </div>
          )}
        </main>

        {rightOpen && !focusMode && mode !== 'cover' && (
          <aside className="hidden w-72 shrink-0 border-l bg-background lg:block">
            <PropertiesPanel
              book={book}
              page={activePage}
              selectedElement={selectedElement}
              canUseAdvancedEditor={entitlements.canUseAdvancedEditor()}
              canUsePrintProfiles={entitlements.canUsePrintProfiles()}
              onPatchBook={patchBook}
              onPatchPage={patchPage}
              onPatchElement={patchElementForActive}
              onReorderElement={(elementId, direction) => activePage && reorderElement(activePage.id, elementId, direction)}
              onDeleteElement={(elementId) => { if (activePage) { removeElement(activePage.id, elementId); selectElement(null); } }}
              onDuplicateElement={(elementId) => activePage && duplicateElement(activePage.id, elementId)}
              onRequestUpgrade={requireUpgrade}
            />
          </aside>
        )}
      </div>

      {/* ----------------------------------------------------------- modals */}
      <ShareModal open={modal === 'share'} onClose={() => setModal(null)} book={book} />
      <VersionsModal
        open={modal === 'versions'}
        onClose={() => setModal(null)}
        versions={versions}
        onCreate={(label, detail) => { createCheckpoint(label, detail, 'manual'); success('Checkpoint saved'); }}
        onRestore={async (versionId) => { restoreVersion(versionId); success('Version restored', 'The manuscript was rolled back.'); }}
      />
      <CommentsModal
        open={modal === 'comments'}
        onClose={() => setModal(null)}
        book={book}
        activePageId={activePageId}
        user={{ id: user?.id ?? 'user_demo', name: user?.name ?? 'Author', avatarUrl: user?.avatarUrl ?? '' }}
        onRefresh={() => void qc.invalidateQueries({ queryKey: ['book', book.id] })}
      />
      <ExportModal open={modal === 'export'} onClose={() => setModal(null)} book={book} userId={user?.id ?? 'user_demo'} canExport={(format) => entitlements.canExport(format)} />
      <FindReplaceModal
        open={modal === 'find'}
        onClose={() => setModal(null)}
        book={book}
        onPatchPages={(updater) => patchPages(updater)}
        onJump={(pageId) => { setActivePageId(pageId); setModal(null); }}
      />
      <PublishModal
        open={modal === 'publish'}
        onClose={() => setModal(null)}
        book={book}
        canPublish={entitlements.canPublish()}
        onUpgrade={requireUpgrade}
        onNavigate={() => navigate(`/dashboard/publishing/${book.id}?bookId=${book.id}`)}
      />
      <Modal
        open={modal === 'help'}
        onOpenChange={(next) => setModal(next ? 'help' : null)}
        title="Keyboard shortcuts"
        description="Everything in the editor is reachable without a mouse."
        size="lg"
        footer={<Button variant="outline" onClick={() => setModal(null)}>Close</Button>}
      >
        <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {[
            ['Ctrl / ⌘ + S', 'Save draft now'],
            ['Ctrl / ⌘ + Z', 'Undo'],
            ['Ctrl / ⌘ + Shift + Z', 'Redo'],
            ['Ctrl / ⌘ + F', 'Find and replace'],
            ['Ctrl / ⌘ + P', 'Toggle preview'],
            ['Ctrl / ⌘ + /', 'This shortcut list'],
            ['Ctrl / ⌘ + V', 'Paste — handled by the rich-text editor'],
            ['Ctrl / ⌘ + X / C', 'Cut / copy — handled by the rich-text editor'],
            ['Delete', 'Remove the selected element'],
            ['Escape', 'Close overlays, deselect element'],
          ].map(([combo, purpose]) => (
            <p key={combo} className="flex items-center justify-between gap-3 border-b py-1 text-xs last:border-0">
              <span className="text-muted-foreground">{purpose}</span>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-2xs">{combo}</kbd>
            </p>
          ))}
        </div>
      </Modal>
      <Modal
        open={summaryOpen}
        onOpenChange={setSummaryOpen}
        title="Manuscript summary"
        description="Live counts from the shared document model."
        footer={<Button variant="outline" onClick={() => setSummaryOpen(false)}>Close</Button>}
      >
        <div className="space-y-2 text-sm">
          <Row label="Words" value={formatNumber(book.wordCount)} />
          <Row label="Characters" value={formatNumber(book.pages.reduce((total, page) => total + (page.layout === 'flow' ? page.content.replace(/<[^>]+>/g, '').length : 0), 0))} />
          <Row label="Pages" value={formatNumber(book.pages.length)} />
          <Row label="Sections" value={formatNumber(book.sections.length)} />
          <Row label="Reading time" value={`${Math.max(1, Math.round(book.wordCount / 230))} min`} />
          <Row label="Elements on canvas pages" value={formatNumber(book.pages.reduce((total, page) => total + page.elements.length, 0))} />
          <Row label="Comments" value={formatNumber(bookService.comments(book.id).length)} />
          <Row label="Versions" value={formatNumber(versions.length)} />
          <Row label="Trim size" value={`${book.trimSize.widthIn}″ × ${book.trimSize.heightIn}″`} />
          <Row label="Last saved" value={lastSaved ? timeAgo(lastSaved) : 'not yet'} />
        </div>
      </Modal>
    </div>
  );
}

/* -------------------------------------------------------------- save chip */

function SaveStatus({
  status, lastSaved, wordCount, pageCount, onSave, onOpenSummary,
}: { status: 'saved' | 'saving' | 'dirty' | 'error'; lastSaved: string | null; wordCount: number; pageCount: number; onSave: () => void; onOpenSummary: () => void }) {
  const map = {
    saved: { icon: <Cloud className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />, label: 'Saved' },
    saving: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />, label: 'Saving…' },
    dirty: { icon: <CloudOff className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />, label: 'Unsaved changes' },
    error: { icon: <AlertTriangle className="h-3.5 w-3.5 text-destructive" />, label: 'Save failed — retry' },
  } as const;
  const entry = map[status];
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" onClick={onSave} title={entry.label}>
        {entry.icon}
        <span className="hidden text-2xs sm:inline">{entry.label}</span>
      </Button>
      <Popover
        trigger={<Button variant="ghost" size="xs" className="text-2xs text-muted-foreground">{formatNumber(wordCount)}w · {pageCount}p</Button>}
        className="w-64 p-3"
      >
        <div className="space-y-2">
          <p className="text-2xs font-medium">Save status</p>
          <p className="text-2xs text-muted-foreground">
            {status === 'saved' && lastSaved ? `All changes saved ${timeAgo(lastSaved)}` : status === 'saving' ? 'Writing to storage…' : status === 'dirty' ? 'Autosave runs 900 ms after you stop typing.' : 'The last save failed — press Ctrl+S to retry.'}
          </p>
          <p className="text-2xs text-muted-foreground">Autosave is on and flushes when you leave the editor, so nothing is lost on navigation.</p>
          <div className="flex gap-1.5">
            <Button size="xs" variant="outline" onClick={onSave}><Save className="h-3 w-3" /> Save now</Button>
            <Button size="xs" variant="ghost" onClick={onOpenSummary}>Summary</Button>
          </div>
        </div>
      </Popover>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex items-center justify-between border-b py-1 text-xs last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </p>
  );
}

/* ----------------------------------------------------------- preview mode */

function PreviewMode({ book, activePageId, onSelectPage }: { book: Book; activePageId: string | null; onSelectPage: (id: string) => void }) {
  const [spread, setSpread] = React.useState(true);
  const [view, setView] = React.useState<'pages' | 'toc'>('pages');
  const size = pagePixelSize(book.trimSize, book.orientation, 1);
  const index = Math.max(0, book.pages.findIndex((page) => page.id === activePageId));

  const pages = spread ? [book.pages[index], book.pages[index + 1]].filter(Boolean) : [book.pages[index]].filter(Boolean);

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="text-2xs">Preview</Badge>
        <span className="text-2xs text-muted-foreground">Read-only. Switch to Write or Design to make changes.</span>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-2xs">
            <input type="checkbox" checked={spread} onChange={(event) => setSpread(event.target.checked)} className="accent-primary" /> Two-page spread
          </label>
          <Tabs value={view} onValueChange={(value) => setView(value as typeof view)} size="sm" tabs={[{ value: 'pages', label: 'Pages' }, { value: 'toc', label: 'Table of contents' }]} />
        </div>
      </div>

      {view === 'toc' ? (
        <div className="mx-auto max-w-xl rounded-lg border bg-background p-6">
          <p className="mb-4 text-center text-sm font-medium">{book.toc.title}</p>
          {book.sections.map((section) => {
            const firstPage = book.pages.findIndex((page) => page.sectionId === section.id);
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => section.pageIds[0] && onSelectPage(section.pageIds[0])}
                className="flex w-full items-baseline gap-2 py-0.5 text-left text-xs hover:text-primary"
              >
                <span className="truncate">{section.title}</span>
                {book.toc.dots && <span className="min-w-0 flex-1 border-b border-dotted" />}
                {book.toc.showPageNumbers && <span className="text-muted-foreground">{firstPage + 1}</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap items-start justify-center gap-4">
          {pages.map((page) => (
            <div key={page.id} className="rounded shadow-page" style={{ width: size.width / 1.6, minHeight: size.height / 1.6, background: page.background.type === 'gradient' ? page.background.gradient : page.background.type === 'color' ? page.background.value : '#fff' }}>
              <div className="h-full w-full p-6" style={{ fontFamily: book.fonts.body, fontSize: 11, lineHeight: book.theme.lineHeight, columnCount: page.layout === 'flow' ? 1 : undefined }}>
                {page.layout === 'flow' || page.layout === 'title' ? (
                  <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: page.content || '<p class="text-muted-foreground">Empty page</p>' }} />
                ) : (
                  <div className="relative h-full w-full">
                    {page.elements.filter((element) => element.visible).map((element) => (
                      <div
                        key={element.id}
                        className="absolute overflow-hidden"
                        style={{ left: `${element.x}%`, top: `${element.y}%`, width: `${element.w}%`, height: `${element.h}%`, transform: `rotate(${element.rotation}deg)` }}
                      >
                        {element.type === 'image' && element.image?.src && <img src={element.image.src} alt="" className="h-full w-full object-cover" style={{ opacity: element.image.opacity }} />}
                        {element.type === 'text' && <div dangerouslySetInnerHTML={{ __html: element.text ?? '' }} />}
                        {element.type === 'shape' && <div className="h-full w-full" style={{ background: element.shape?.fill, borderRadius: element.shape?.radius }} />}
                        {element.type === 'pageNumber' && <span className="text-2xs">{index + 1}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-center gap-2">
        <Button size="sm" variant="outline" disabled={index <= 0} onClick={() => book.pages[index - 1] && onSelectPage(book.pages[index - 1].id)}><ChevronLeft className="h-4 w-4" /> Previous</Button>
        <span className="text-xs text-muted-foreground">{index + 1} / {book.pages.length}</span>
        <Button size="sm" variant="outline" disabled={index >= book.pages.length - 1} onClick={() => book.pages[index + 1] && onSelectPage(book.pages[index + 1].id)}>Next <ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ share modal */

function ShareModal({ open, onClose, book }: { open: boolean; onClose: () => void; book: Book }) {
  const { success } = useToast();
  const [link, setLink] = React.useState(`https://scriptora.app/read/${book.id}`);
  const [role, setRole] = React.useState('viewer');
  const [invite, setInvite] = React.useState('');
  const collaborators = bookService.collaborators(book.id);

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Share this book"
      description="Invite collaborators with comment or edit access, or copy a read-only link."
      footer={<Button variant="outline" onClick={onClose}>Done</Button>}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="share-link" className="text-xs">Read-only link</Label>
          <div className="flex gap-2">
            <Input id="share-link" readOnly value={link} className="h-9 text-xs" />
            <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(link); success('Link copied'); }}>Copy</Button>
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="share-email" className="text-xs">Invite by email</Label>
            <Input id="share-email" value={invite} onChange={(event) => setInvite(event.target.value)} placeholder="editor@example.com" className="h-9 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="share-role" className="text-xs">Role</Label>
            <select id="share-role" value={role} onChange={(event) => setRole(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-xs">
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
          </div>
          <Button
            size="sm"
            onClick={() => {
              if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(invite)) { success('Check the email address'); return; }
              void bookService.inviteCollaborator(book.id, { email: invite, role: role === 'editor' ? 'editor' : 'viewer' });
              setInvite('');
              success('Invite sent', `${invite} can now ${role === 'viewer' ? 'read' : 'edit'} “${book.title}”.`);
            }}
          >
            Invite
          </Button>
        </div>
        <Separator />
        <div className="space-y-2">
          <p className="text-xs font-medium">People with access ({collaborators.length + 1})</p>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between rounded border p-2 text-xs">
              <span>{book.authorName} <Badge variant="secondary" className="ml-1 text-2xs">Owner</Badge></span>
              <span className="text-muted-foreground">Full access</span>
            </div>
            {collaborators.map((person) => (
              <div key={person.id} className="flex items-center justify-between rounded border p-2 text-xs">
                <span className="truncate">{person.email} <Badge variant="outline" className="ml-1 text-2xs">{person.role}</Badge></span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => { bookService.removeCollaborator(person.id); success('Access removed'); }}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-2 text-2xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <Users className="h-3.5 w-3.5" />
          Collaboration seats are shared across your plan. {bookService.comments(book.id).length} comments are open on this book.
        </div>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------- versions modal */

function VersionsModal({
  open, onClose, versions, onCreate, onRestore,
}: { open: boolean; onClose: () => void; versions: VersionEntry[]; onCreate: (label: string, detail: string) => void; onRestore: (id: string) => Promise<void> | void }) {
  const confirm = useConfirm();
  const [label, setLabel] = React.useState('');
  const [detail, setDetail] = React.useState('');
  const [filter, setFilter] = React.useState<'all' | VersionEntry['kind']>('all');
  const filtered = versions.filter((version) => filter === 'all' || version.kind === filter);

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Version history"
      description="Every checkpoint snapshots sections, pages and the cover. Restoring is non-destructive — a restore checkpoint is created first."
      size="lg"
      footer={<Button variant="outline" onClick={onClose}>Close</Button>}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="version-label" className="text-xs">Checkpoint label</Label>
            <Input id="version-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Final draft sent to editor" className="h-9 text-xs" />
          </div>
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="version-detail" className="text-xs">Detail</Label>
            <Input id="version-detail" value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="What changed" className="h-9 text-xs" />
          </div>
          <Button
            size="sm"
            onClick={() => {
              if (label.trim().length < 2) return;
              onCreate(label.trim(), detail.trim() || 'Manual checkpoint');
              setLabel('');
              setDetail('');
            }}
          >
            <Save className="h-3.5 w-3.5" /> Save checkpoint
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['all', 'manual', 'milestone', 'autosave', 'restore'] as const).map((kind) => (
            <Button key={kind} size="xs" variant={filter === kind ? 'secondary' : 'outline'} className="capitalize" onClick={() => setFilter(kind)}>{kind}</Button>
          ))}
        </div>
        <div className="max-h-80 space-y-2 overflow-y-auto scrollbar-thin">
          {filtered.map((version) => (
            <div key={version.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{version.label} <Badge variant="outline" className="ml-1 text-2xs">{version.kind}</Badge></p>
                <p className="text-2xs text-muted-foreground">{version.detail} · {version.userName} · {timeAgo(version.createdAt)}</p>
                <p className="text-2xs text-muted-foreground">{formatNumber(version.snapshot.wordCount)} words · {version.snapshot.pageCount} pages · {version.snapshot.sections.length} sections</p>
              </div>
              <Button
                size="xs"
                variant="outline"
                onClick={async () => {
                  const ok = await confirm({ title: `Restore “${version.label}”?`, description: 'The current manuscript is saved as a restore checkpoint first.', confirmLabel: 'Restore' });
                  if (ok) await onRestore(version.id);
                }}
              >
                <History className="h-3 w-3" /> Restore
              </Button>
            </div>
          ))}
          {filtered.length === 0 && <p className="text-xs text-muted-foreground">No {filter === 'all' ? '' : `${filter} `}versions yet.</p>}
        </div>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------- comments modal */

function CommentsModal({
  open, onClose, book, activePageId, user, onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  book: Book;
  activePageId: string | null;
  user: { id: string; name: string; avatarUrl: string };
  onRefresh: () => void;
}) {
  const { success } = useToast();
  const [body, setBody] = React.useState('');
  const [scope, setScope] = React.useState<'all' | 'open' | 'resolved'>('open');
  const [, force] = React.useState(0);
  const comments = bookService.comments(book.id);
  const filtered = comments.filter((comment) => (scope === 'all' ? true : scope === 'open' ? !comment.resolved : comment.resolved));

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Comments & review"
      description="Leave feedback on the whole book or pin it to the page you are editing."
      size="lg"
      footer={<Button variant="outline" onClick={onClose}>Close</Button>}
    >
      <div className="space-y-3">
        <div className="space-y-2">
          <Textarea rows={3} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write a comment… use @name to mention a collaborator" aria-label="New comment" />
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-2xs">{activePageId ? `Pinned to ${book.pages.find((page) => page.id === activePageId)?.title ?? 'this page'}` : 'Whole book'}</Badge>
            <Button
              size="sm"
              className="ml-auto"
              onClick={() => {
                if (body.trim().length < 2) return;
                void bookService.addComment(book.id, user, body.trim(), activePageId ? { pageId: activePageId } : {}).then(() => {
                  setBody('');
                  force((value) => value + 1);
                  onRefresh();
                  success('Comment added');
                });
              }}
            >
              <MessageSquare className="h-3.5 w-3.5" /> Comment
            </Button>
          </div>
        </div>
        <div className="flex gap-1.5">
          {(['open', 'resolved', 'all'] as const).map((value) => (
            <Button key={value} size="xs" variant={scope === value ? 'secondary' : 'outline'} className="capitalize" onClick={() => setScope(value)}>{value} ({value === 'all' ? comments.length : comments.filter((comment) => (value === 'open' ? !comment.resolved : comment.resolved)).length})</Button>
          ))}
        </div>
        <div className="max-h-80 space-y-2 overflow-y-auto scrollbar-thin">
          {filtered.map((comment) => (
            <div key={comment.id} className={cn('rounded-lg border p-2', comment.resolved && 'opacity-70')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium">{comment.userName}
                    {comment.pageId && <span className="ml-1 text-2xs text-muted-foreground">on {book.pages.find((page) => page.id === comment.pageId)?.title ?? 'a page'}</span>}
                  </p>
                  <p className="text-2xs text-muted-foreground">{timeAgo(comment.createdAt)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="xs" variant="ghost" onClick={() => { bookService.resolveComment(comment.id, !comment.resolved); force((value) => value + 1); onRefresh(); }}>
                    {comment.resolved ? 'Reopen' : 'Resolve'}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => { bookService.removeComment(comment.id); force((value) => value + 1); onRefresh(); }} aria-label="Delete comment"><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
              <p className="mt-1 text-xs">{comment.body}</p>
              {comment.replies.map((reply) => (
                <p key={reply.id} className="mt-1.5 border-l-2 pl-2 text-2xs text-muted-foreground"><span className="font-medium text-foreground">{reply.userName}:</span> {reply.body}</p>
              ))}
              <ReplyBox onSubmit={(text) => { bookService.replyToComment(comment.id, user, text); force((value) => value + 1); onRefresh(); }} />
            </div>
          ))}
          {filtered.length === 0 && <p className="text-xs text-muted-foreground">No {scope === 'all' ? '' : scope} comments.</p>}
        </div>
      </div>
    </Modal>
  );
}

function ReplyBox({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = React.useState('');
  return (
    <div className="mt-1.5 flex gap-1.5">
      <Input value={text} onChange={(event) => setText(event.target.value)} placeholder="Reply" className="h-7 text-2xs" aria-label="Reply" />
      <Button size="xs" variant="outline" onClick={() => { if (text.trim().length > 0) { onSubmit(text.trim()); setText(''); } }}>Send</Button>
    </div>
  );
}

/* ----------------------------------------------------------- export modal */

const DIGITAL: ExportFormat[] = ['pdf', 'epub', 'epub3', 'docx', 'html', 'txt'];
const PRINT: ExportFormat[] = ['print-pdf'];

function ExportModal({
  open, onClose, book, userId, canExport,
}: { open: boolean; onClose: () => void; book: Book; userId: string; canExport: (format: ExportFormat) => boolean }) {
  const { success, error, warning } = useToast();
  const [format, setFormat] = React.useState<ExportFormat>('pdf');
  const [profileId, setProfileId] = React.useState<PublishingProfileId>('digital-pdf');
  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState<{ step: string; progress: number } | null>(null);
  type Report = Awaited<ReturnType<typeof preflightService.run>>;
  const [preflight, setPreflight] = React.useState<Report | null>(null);
  const [jobId, setJobId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const hints = EXPORT_FORMAT_INFO[format]?.profileHints ?? [];
    if (!hints.includes(profileId)) setProfileId(hints[0] as PublishingProfileId);
  }, [format, open, profileId]);

  const runPreflight = async () => {
    const result = await preflightService.run(book.id, profileId);
    setPreflight(result);
    if (result.errors > 0) warning('Preflight found blocking issues', `${result.errors} blocking error(s) to resolve.`);
    else if (result.warnings > 0) warning('Preflight passed with warnings', `${result.warnings} warning(s) to review.`);
    else success('Preflight passed', 'Nothing blocking — this book is ready to export.');
  };

  const run = async () => {
    if (!canExport(format)) {
      warning('Upgrade required', `Exporting ${EXPORT_FORMAT_INFO[format]?.label ?? format} is not included in your plan.`);
      return;
    }
    if (profileId === 'kdp-print' || profileId === 'press-ready') {
      const result = preflight ?? (await preflightService.run(book.id, profileId));
      setPreflight(result);
      if (result.errors > 0) {
        error('Export blocked by preflight', `${result.errors} blocking error(s) must be resolved or auto-fixed first.`);
        return;
      }
    }
    setRunning(true);
    try {
      const job = await exportService.run(book.id, format, profileId, {}, (event) => setProgress(event), userId);
      setJobId(job.id);
      success('Export ready', `${EXPORT_FORMAT_INFO[format]?.label ?? format} generated (${job.fileSizeBytes ? `${Math.round(job.fileSizeBytes / 1024)} KB` : 'file ready'}).`);
    } catch (e) {
      error('Export failed', (e as Error).message);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const download = () => {
    void storageService.download({ fileName: `${book.id}.${format === 'print-pdf' ? 'pdf' : format}`, blob: new Blob([`Scriptora export placeholder for ${book.title}`], { type: 'text/plain' }) });
    success('Download started');
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Export this book"
      description="Digital formats for readers, print files for printers and retail platforms."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => void runPreflight()}><Filter className="h-3.5 w-3.5" /> Run preflight</Button>
          {jobId && <Button variant="outline" onClick={download}><Upload className="h-3.5 w-3.5" /> Download</Button>}
          <Button onClick={run} disabled={running}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />} {running ? 'Exporting…' : 'Export'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-2xs font-medium">Digital</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {DIGITAL.map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => setFormat(entry)}
                className={cn('rounded-lg border p-2 text-left text-xs', format === entry ? 'border-primary bg-primary/5' : 'hover:border-primary/40')}
              >
                <span className="block font-medium">{EXPORT_FORMAT_INFO[entry]?.label ?? entry}</span>
                <span className="block text-2xs text-muted-foreground">{EXPORT_FORMAT_INFO[entry]?.description}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-2xs font-medium">Print</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {PRINT.map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => setFormat(entry)}
                className={cn('rounded-lg border p-2 text-left text-xs', format === entry ? 'border-primary bg-primary/5' : 'hover:border-primary/40')}
              >
                <span className="block font-medium">{EXPORT_FORMAT_INFO[entry]?.label ?? entry}</span>
                <span className="block text-2xs text-muted-foreground">{EXPORT_FORMAT_INFO[entry]?.description}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="export-profile" className="text-xs">Publishing profile</Label>
          <select id="export-profile" value={profileId} onChange={(event) => setProfileId(event.target.value as PublishingProfileId)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs">
            {PUBLISHING_PROFILES.filter((profile) => profile.formats.includes(format) || (format === 'print-pdf' && profile.family === 'print')).map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name} · {profile.family}</option>
            ))}
          </select>
          <p className="text-2xs text-muted-foreground">{PUBLISHING_PROFILES.find((profile) => profile.id === profileId)?.description}</p>
        </div>
        {progress && <ProgressList items={[{ label: progress.step, value: progress.progress }]} />}
        {preflight && (
          <div className="space-y-1.5 rounded-lg border p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              {preflight.errors > 0 ? <AlertTriangle className="h-3.5 w-3.5 text-destructive" /> : <Check className="h-3.5 w-3.5 text-emerald-600" />}
              Preflight · {preflight.readiness}% ready · {preflight.passed} checks passed · {preflight.errors} errors · {preflight.warnings} warnings
            </p>
            {preflight.issues.filter((issue) => issue.status !== 'ignored').slice(0, 8).map((issue) => (
              <p key={issue.id} className="flex items-start gap-1.5 text-2xs">
                <span className={cn('mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full', issue.severity === 'error' ? 'bg-destructive' : issue.severity === 'warning' ? 'bg-amber-500' : 'bg-emerald-500')} />
                <span className="flex-1"><span className="font-medium">{issue.title}.</span> {issue.detail}</span>
                {issue.autoFixable && issue.status === 'open' && (
                  <button type="button" className="text-primary underline" onClick={async () => { await preflightService.applyFix(book.id, issue, profileId); setPreflight(await preflightService.run(book.id, profileId)); success('Fix applied'); }}>Fix</button>
                )}
              </p>
            ))}
            {preflight.issues.length === 0 && <p className="text-2xs text-muted-foreground">No issues found.</p>}
          </div>
        )}
        {jobId && (
          <p className="text-2xs text-muted-foreground">Job {jobId} stored in the export centre — history, retries and downloads live there.</p>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------ find & replace */

function FindReplaceModal({
  open, onClose, book, onPatchPages, onJump,
}: { open: boolean; onClose: () => void; book: Book; onPatchPages: (updater: (pages: BookPage[]) => BookPage[]) => void; onJump: (pageId: string) => void }) {
  const { success } = useToast();
  const [find, setFind] = React.useState('');
  const [replace, setReplace] = React.useState('');
  const [caseSensitive, setCaseSensitive] = React.useState(false);
  const [wholeWord, setWholeWord] = React.useState(false);
  const [scope, setScope] = React.useState<'all' | 'page'>('all');
  const pageId = book.pages.find((page) => page.id === book.pages[0]?.id)?.id;

  const matches = React.useMemo(() => {
    if (find.trim().length === 0) return [];
    const pages = scope === 'page' ? book.pages.filter((page) => page.id === pageId) : book.pages;
    const plain = (html: string) => html.replace(/<[^>]+>/g, ' ');
    return pages.flatMap((page) => {
      const text = plain(page.content);
      const flags = caseSensitive ? 'g' : 'gi';
      const pattern = wholeWord ? `\\b${escapeRegExp(find)}\\b` : escapeRegExp(find);
      const count = (text.match(new RegExp(pattern, flags)) ?? []).length;
      return count > 0 ? [{ pageId: page.id, title: page.title, count }] : [];
    });
  }, [book.pages, caseSensitive, find, pageId, scope, wholeWord]);

  const total = matches.reduce((sum, match) => sum + match.count, 0);

  const applyReplace = () => {
    if (find.trim().length === 0) return;
    const flags = caseSensitive ? 'g' : 'gi';
    const pattern = wholeWord ? `\\b${escapeRegExp(find)}\\b` : escapeRegExp(find);
    onPatchPages((pages) =>
      pages.map((page) => {
        if (scope === 'page' && page.id !== pageId) return page;
        if (!page.content.includes(find) && !new RegExp(pattern, flags).test(page.content)) return page;
        return { ...page, content: page.content.replace(new RegExp(pattern, flags), replace) };
      }),
    );
    success(`${total} replacement${total === 1 ? '' : 's'} applied`);
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Find & replace"
      description="Search the manuscript, jump to matches and replace across the whole book."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={applyReplace} disabled={total === 0}><Replace className="h-3.5 w-3.5" /> Replace {total > 0 ? `all ${total}` : ''}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="find-text" className="text-xs">Find</Label>
            <Input id="find-text" value={find} onChange={(event) => setFind(event.target.value)} className="h-9 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="replace-text" className="text-xs">Replace with</Label>
            <Input id="replace-text" value={replace} onChange={(event) => setReplace(event.target.value)} className="h-9 text-xs" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Checkbox label="Match case" checked={caseSensitive} onCheckedChange={setCaseSensitive} />
          <Checkbox label="Whole word" checked={wholeWord} onCheckedChange={setWholeWord} />
          <div className="flex gap-1.5">
            <Button size="xs" variant={scope === 'all' ? 'secondary' : 'outline'} onClick={() => setScope('all')}>Whole book</Button>
            <Button size="xs" variant={scope === 'page' ? 'secondary' : 'outline'} onClick={() => setScope('page')}>Current page</Button>
          </div>
        </div>
        <Separator />
        <div className="max-h-64 space-y-1.5 overflow-y-auto scrollbar-thin">
          {matches.map((match) => (
            <button key={match.pageId} type="button" onClick={() => onJump(match.pageId)} className="flex w-full items-center justify-between rounded border p-2 text-left text-xs hover:border-primary/40">
              <span className="truncate">{match.title || 'Untitled page'}</span>
              <Badge variant="secondary" className="text-2xs">{match.count} match{match.count === 1 ? '' : 'es'}</Badge>
            </button>
          ))}
          {find.trim().length > 0 && matches.length === 0 && <p className="text-xs text-muted-foreground">No matches for “{find}”.</p>}
          {find.trim().length === 0 && <p className="text-xs text-muted-foreground">Type something to search the manuscript.</p>}
        </div>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------- publish modal */

function PublishModal({
  open, onClose, book, canPublish, onUpgrade, onNavigate,
}: { open: boolean; onClose: () => void; book: Book; canPublish: boolean; onUpgrade: (feature: string) => void; onNavigate: () => void }) {
  const { success } = useToast();
  const checklist = publishingService.completion(book.id);

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Publish this book"
      description="The publishing centre walks through metadata, pricing, visibility and distribution."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              if (!canPublish) { onUpgrade('publish'); return; }
              onClose();
              onNavigate();
            }}
          >
            <Send className="h-3.5 w-3.5" /> Open publishing centre
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg border p-3">
          <p className="text-xs font-medium">Readiness {checklist.percent}%</p>
          <p className="text-2xs text-muted-foreground">{checklist.done} of {checklist.total} publishing checks complete</p>
        </div>
        {checklist.checklist.slice(0, 6).map((item) => (
          <p key={item.id} className="flex items-center gap-1.5 text-2xs">
            {item.done ? <Check className="h-3 w-3 text-emerald-600" /> : <X className="h-3 w-3 text-muted-foreground" />}
            {item.label} — <span className="text-muted-foreground">{item.detail}</span>
          </p>
        ))}
        {!canPublish && <p className="text-2xs text-amber-700 dark:text-amber-300">Publishing requires the Pro plan. You can prepare everything now and publish after upgrading.</p>}
        <Button size="sm" variant="ghost" className="w-full" onClick={() => { success('Draft saved for publishing'); onClose(); }}>
          <Clock className="h-3.5 w-3.5" /> Save as unpublished draft
        </Button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ utils */

function quickElement(type: ElementType, page: BookPage): PageElement {
  const base: PageElement = {
    id: `el_${Math.random().toString(36).slice(2, 9)}`,
    type,
    name: `${type} element`,
    x: 15,
    y: 20,
    w: 40,
    h: type === 'divider' ? 2 : 22,
    rotation: 0,
    visible: true,
    locked: false,
    z: page.elements.length,
  };
  if (type === 'image') return { ...base, w: 34, h: 40, image: { src: '', fit: 'cover', radius: 4, opacity: 1, filters: { grayscale: 0, sepia: 0, blur: 0, brightness: 100, contrast: 100 } } };
  if (type === 'shape') return { ...base, shape: { kind: 'rect', fill: 'hsl(var(--primary))', stroke: 'transparent', strokeWidth: 0, radius: 8 } };
  if (type === 'divider') return { ...base, divider: { style: 'solid', color: '#111827', thickness: 1 } };
  if (type === 'table') return { ...base, w: 70, h: 34, table: { rows: 3, cols: 3, cells: [['Header', 'Header', 'Header'], ['', '', ''], ['', '', '']], headerRow: true, borderColor: '#d4d4d8' } };
  return { ...base, text: '<p>New text</p>', style: { fontSize: 14, color: '#111827' } };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default EditorPage;
