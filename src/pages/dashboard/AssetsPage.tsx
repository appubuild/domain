import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Check, Download, FileImage, Filter, Folder, HardDrive, Heart, Image as ImageIcon, Info, LayoutGrid, List, Loader2, Search, Sparkles, Trash2, Upload, Wand2,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Separator } from '@/components/ui/primitives';
import { Modal, DropdownMenu, type MenuItemDef } from '@/components/ui/overlays';
import { DataTable, EmptyState, Pagination, StatCard, UsageMeter, type Column } from '@/components/ui/data';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/overlays';
import { useAssets } from '@/hooks/queries';
import { aiService, assetService, storageService, userService } from '@/services';
import { useAuth } from '@/providers/AuthProvider';
import { formatNumber, timeAgo } from '@/lib/format';
import { cn, formatBytes, uid } from '@/lib/utils';
import type { Asset, AssetKind } from '@/types/domain';

const KIND_LABELS: Record<AssetKind, string> = {
  upload: 'Upload',
  image: 'Image',
  'ai-image': 'AI image',
  cover: 'Cover',
  illustration: 'Illustration',
  background: 'Background',
  logo: 'Logo',
  icon: 'Icon',
};

const AI_STYLES = ['Editorial illustration', 'Watercolour wash', 'Bold graphic', 'Vintage engraving', 'Soft gradient', 'Paper collage'];

export default function AssetsPage() {
  const { user, entitlements } = useAuth();
  const { success, error, warning } = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: assets, isLoading } = useAssets(user?.id);
  const [query, setQuery] = React.useState('');
  const [folder, setFolder] = React.useState('All');
  const [kind, setKind] = React.useState<'all' | AssetKind>('all');
  const [favouritesOnly, setFavouritesOnly] = React.useState(false);
  const [layout, setLayout] = React.useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = React.useState<string[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [detail, setDetail] = React.useState<Asset | null>(null);
  const [aiOpen, setAiOpen] = React.useState(false);
  const [aiPrompt, setAiPrompt] = React.useState('');
  const [aiStyle, setAiStyle] = React.useState(AI_STYLES[0]);
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiResult, setAiResult] = React.useState<{ url: string; credits: number } | null>(null);
  const [page, setPage] = React.useState(1);
  const perPage = 18;
  const inputRef = React.useRef<HTMLInputElement>(null);

  const folders = React.useMemo(() => Array.from(new Set((assets ?? []).map((asset) => asset.folder))).sort(), [assets]);
  const storage = user ? userService.storageSummary(user.id) : undefined;

  const rows = React.useMemo(() => {
    return (assets ?? []).filter((asset) => {
      if (folder !== 'All' && asset.folder !== folder) return false;
      if (kind !== 'all' && asset.kind !== kind) return false;
      if (favouritesOnly && !asset.favorite) return false;
      if (query && !`${asset.name} ${asset.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [assets, folder, kind, favouritesOnly, query]);

  const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
  const visible = rows.slice((page - 1) * perPage, page * perPage);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['assets'] });
    qc.invalidateQueries({ queryKey: ['library'] });
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || !user || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const tooLarge = file.size > 25 * 1024 * 1024;
        if (tooLarge) {
          warning(`${file.name} is over 25 MB`, 'Large files are compressed in the real storage provider.');
        }
        const asset = await storageService.uploadFile(user.id, file, folder === 'All' ? 'Uploads' : folder, file.type.startsWith('image/') ? 'image' : 'upload');
        assetService.create({
          ...asset,
          tags: file.type.startsWith('image/') ? ['uploaded'] : [],
        });
      }
      refresh();
      success(`${files.length} file${files.length === 1 ? '' : 's'} uploaded`);
    } catch (e) {
      error('Upload failed', (e as Error).message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const createPlaceholder = (label: string, kind: AssetKind) => {
    if (!user) return;
    const url = storageService.generatedPlaceholder(label);
    assetService.create({
      id: uid('asset'),
      ownerId: user.id,
      name: label,
      kind,
      url,
      mimeType: 'image/svg+xml',
      sizeBytes: 24_000,
      width: 800,
      height: 1000,
      folder: 'Generated',
      tags: ['placeholder'],
      createdAt: new Date().toISOString(),
      favorite: false,
      storageKey: `users/${user.id}/assets/generated/${uid('obj')}.svg`,
    });
    refresh();
    success(`${label} created`);
  };

  const bulkDelete = async () => {
    const ok = await confirm({
      title: `Delete ${selected.length} asset${selected.length === 1 ? '' : 's'}?`,
      description: 'Anything using these images in a book will show a missing-image placeholder.',
      confirmLabel: 'Delete assets',
      destructive: true,
    });
    if (!ok) return;
    selected.forEach((id) => assetService.remove(id));
    setSelected([]);
    refresh();
    success('Assets deleted');
  };

  const generateImage = async () => {
    if (!user || !aiPrompt.trim()) return;
    if (!entitlements.canUseAiImages()) {
      warning('AI images are a Pro feature', 'Upgrade to generate illustrations.');
      return;
    }
    setAiBusy(true);
    setAiResult(null);
    try {
      const result = await aiService.generateImage({ prompt: aiPrompt, style: aiStyle, userId: user.id, aspect: 'portrait' });
      const asset = await storageService.putDataUrl(user.id, {
        dataUrl: result.url,
        name: aiPrompt.slice(0, 40),
        folder: 'AI Images',
        kind: 'ai-image',
        width: result.width,
        height: result.height,
        sizeBytes: 480_000,
      });
      assetService.create({ ...asset, tags: ['ai', aiStyle.toLowerCase()] });
      setAiResult({ url: result.url, credits: result.credits });
      refresh();
      success('Image generated', `${result.credits} credits used`);
    } catch (e) {
      error('Generation failed', (e as Error).message);
    } finally {
      setAiBusy(false);
    }
  };

  const columns: Column<Asset & { id: string }>[] = [
    {
      key: 'name',
      header: 'Asset',
      render: (row) => (
        <div className="flex min-w-0 items-center gap-3">
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded border bg-muted">
            <img src={row.url} alt="" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{row.name}</p>
            <p className="truncate text-xs text-muted-foreground">{row.folder} · {row.width}×{row.height}</p>
          </div>
        </div>
      ),
    },
    { key: 'kind', header: 'Kind', width: '120px', render: (row) => <Badge variant={row.kind === 'ai-image' ? 'accent' : 'secondary'}>{KIND_LABELS[row.kind]}</Badge> },
    { key: 'size', header: 'Size', width: '100px', align: 'right', render: (row) => formatBytes(row.sizeBytes) },
    { key: 'tags', header: 'Tags', render: (row) => row.tags.length ? row.tags.map((tag) => <Badge key={tag} variant="outline" className="mr-1 text-2xs">{tag}</Badge>) : <span className="text-xs text-muted-foreground">—</span> },
    { key: 'created', header: 'Added', width: '130px', render: (row) => <span className="text-xs text-muted-foreground">{timeAgo(row.createdAt)}</span> },
    {
      key: 'actions',
      header: '',
      width: '110px',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="xs" onClick={() => assetService.update(row.id, { favorite: !row.favorite })} aria-label="Toggle favourite">
            <Heart className={cn('h-3 w-3', row.favorite && 'fill-rose-500 text-rose-500')} />
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setDetail(row)}>Details</Button>
        </div>
      ),
    },
  ];

  const bulkMenu: MenuItemDef[] = [
    { id: 'fav', label: 'Mark as favourite', onSelect: () => { selected.forEach((id) => assetService.update(id, { favorite: true })); setSelected([]); refresh(); success('Marked as favourite'); } },
    { id: 'folder', label: 'Move to folder…', onSelect: () => { const name = window.prompt('Folder name', 'Library'); if (!name) return; selected.forEach((id) => assetService.update(id, { folder: name })); setSelected([]); refresh(); success('Assets moved'); } },
    { id: 'delete', label: 'Delete selected', destructive: true, onSelect: bulkDelete },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Asset library</h1>
          <p className="text-sm text-muted-foreground">Every image, illustration and AI asset, ready to drop into your pages.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={inputRef} type="file" multiple accept="image/*,.pdf,.docx" className="hidden" onChange={(event) => handleFiles(event.target.files)} aria-label="Upload files" />
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload
          </Button>
          <Button size="sm" onClick={() => setAiOpen(true)}>
            <Sparkles className="h-4 w-4" /> Generate with AI
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Assets" value={formatNumber((assets ?? []).length)} hint={`${folders.length} folders`} icon={<ImageIcon className="h-4 w-4" />} />
        <StatCard label="AI generated" value={formatNumber((assets ?? []).filter((asset) => asset.kind === 'ai-image').length)} hint={`${entitlements.usage.aiImages.used} image credits used`} icon={<Wand2 className="h-4 w-4" />} />
        <StatCard label="Favourites" value={formatNumber((assets ?? []).filter((asset) => asset.favorite).length)} hint="Quick access in the editor" icon={<Heart className="h-4 w-4" />} />
        <StatCard label="Storage used" value={storage ? formatBytes(storage.used, 1) : '—'} hint={storage?.label ?? ''} icon={<HardDrive className="h-4 w-4" />} onClick={() => navigate('/dashboard/subscription')} />
      </div>

      {storage && (
        <Card>
          <CardContent className="p-4">
            <UsageMeter label={`Storage · ${storage.objects.length} objects`} used={storage.used} limit={storage.limit} format={(value) => formatBytes(value, 1)} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">All assets</CardTitle>
            <CardDescription>{rows.length} shown of {assets?.length ?? 0}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search names and tags" className="h-9 w-[210px] pl-8" aria-label="Search assets" />
            </div>
            <select value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setPage(1); }} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Filter by kind">
              <option value="all">All kinds</option>
              {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <Button variant={favouritesOnly ? 'secondary' : 'outline'} size="sm" onClick={() => setFavouritesOnly((value) => !value)}>
              <Heart className={cn('h-4 w-4', favouritesOnly && 'fill-current')} /> Favourites
            </Button>
            <div className="flex items-center gap-0.5 rounded-lg border p-0.5">
              <Button variant={layout === 'grid' ? 'secondary' : 'ghost'} size="xs" onClick={() => setLayout('grid')} aria-label="Grid"><LayoutGrid className="h-3.5 w-3.5" /></Button>
              <Button variant={layout === 'list' ? 'secondary' : 'ghost'} size="xs" onClick={() => setLayout('list')} aria-label="List"><List className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={folder === 'All' ? 'secondary' : 'ghost'} size="xs" onClick={() => { setFolder('All'); setPage(1); }}>
              <Folder className="h-3 w-3" /> All
            </Button>
            {folders.map((name) => (
              <Button key={name} variant={folder === name ? 'secondary' : 'ghost'} size="xs" onClick={() => { setFolder(name); setPage(1); }}>
                {name} <span className="ml-1 text-muted-foreground">{(assets ?? []).filter((asset) => asset.folder === name).length}</span>
              </Button>
            ))}
            <Button variant="ghost" size="xs" onClick={() => createPlaceholder('New placeholder', 'placeholder' as AssetKind)}>
              <Info className="h-3 w-3" /> Add placeholder
            </Button>
            {selected.length > 0 && (
              <>
                <Separator orientation="vertical" className="h-6" />
                <span className="text-xs text-muted-foreground">{selected.length} selected</span>
                <DropdownMenu trigger={<Button variant="outline" size="xs">Bulk actions</Button>} items={bulkMenu} />
                <Button variant="ghost" size="xs" onClick={() => setSelected([])}>Clear</Button>
              </>
            )}
          </div>

          {isLoading && <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">{Array.from({ length: 12 }).map((_, index) => <div key={index} className="h-40 animate-pulse rounded-lg bg-muted" />)}</div>}

          {!isLoading && rows.length === 0 && (
            <EmptyState
              icon={<FileImage className="h-5 w-5" />}
              title={assets?.length ? 'No assets match' : 'No assets yet'}
              description={assets?.length ? 'Try another folder, kind or search term.' : 'Upload images from your computer, generate illustrations with AI, or drag assets in from a book.'}
              actions={
                <>
                  <Button size="sm" onClick={() => inputRef.current?.click()}><Upload className="h-4 w-4" /> Upload files</Button>
                  <Button variant="outline" size="sm" onClick={() => setAiOpen(true)}><Sparkles className="h-4 w-4" /> Generate with AI</Button>
                </>
              }
            />
          )}

          {!isLoading && rows.length > 0 && layout === 'grid' && (
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {visible.map((asset) => {
                const isSelected = selected.includes(asset.id);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => setDetail(asset)}
                    className={cn('group overflow-hidden rounded-lg border text-left transition-all', isSelected ? 'ring-2 ring-primary' : 'hover:border-primary/50')}
                  >
                    <div className="relative aspect-square overflow-hidden bg-muted">
                      <img src={asset.url} alt={asset.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                      <span
                        role="checkbox"
                        aria-checked={isSelected}
                        tabIndex={-1}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelected((current) => isSelected ? current.filter((id) => id !== asset.id) : [...current, asset.id]);
                        }}
                        className={cn('absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded border bg-background/90', isSelected && 'bg-primary text-primary-foreground')}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </span>
                      {asset.kind === 'ai-image' && <Badge variant="accent" className="absolute right-2 top-2 text-2xs"><Sparkles className="h-2.5 w-2.5" /> AI</Badge>}
                    </div>
                    <div className="p-2">
                      <p className="truncate text-xs font-medium">{asset.name}</p>
                      <p className="text-2xs text-muted-foreground">{KIND_LABELS[asset.kind]} · {formatBytes(asset.sizeBytes)}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {!isLoading && rows.length > 0 && layout === 'list' && (
            <DataTable
              columns={columns}
              rows={rows.map((asset) => ({ ...asset, id: asset.id }))}
              rowKey={(row) => row.id}
              selectable
              selectedKeys={selected}
              onSelectionChange={setSelected}
              onRowClick={(row) => setDetail(row)}
              dense
            />
          )}

          {rows.length > perPage && <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Storage objects</CardTitle>
          <CardDescription>Files the storage service has recorded — exports, covers and uploads, ready for Cloudflare R2 in Phase 3.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(storage?.objects ?? []).slice(0, 6).map((object) => (
            <div key={object.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
              <div className="min-w-0">
                <p className="truncate font-medium">{object.label}</p>
                <p className="truncate text-muted-foreground">{object.bucket}/{object.key}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{object.kind}</Badge>
                <span className="text-muted-foreground">{formatBytes(object.sizeBytes)}</span>
              </div>
            </div>
          ))}
          {(storage?.objects ?? []).length === 0 && <p className="text-sm text-muted-foreground">No storage objects yet — exports and AI images will appear here.</p>}
          {(storage?.objects ?? []).length > 6 && (
            <p className="text-xs text-muted-foreground">+ {(storage?.objects.length ?? 0) - 6} more objects · {formatBytes(storageService.totalBytes(user?.id), 1)} tracked in total.</p>
          )}
        </CardContent>
      </Card>

      <Modal
        open={Boolean(detail)}
        onOpenChange={(open) => !open && setDetail(null)}
        title={detail?.name ?? 'Asset'}
        description={detail ? `${KIND_LABELS[detail.kind]} · ${detail.folder} · ${detail.width}×${detail.height} px` : undefined}
        size="lg"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                if (!detail) return;
                assetService.update(detail.id, { favorite: !detail.favorite });
                setDetail({ ...detail, favorite: !detail.favorite });
                refresh();
              }}
            >
              <Heart className={cn('h-4 w-4', detail?.favorite && 'fill-rose-500 text-rose-500')} /> {detail?.favorite ? 'Unfavourite' : 'Favourite'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (detail) success('Asset URL copied', 'Paste it into an image element or cover field.');
              }}
            >
              Copy URL
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (!detail) return;
                const link = document.createElement('a');
                link.href = detail.url;
                link.download = `${detail.name}.png`;
                link.click();
              }}
            >
              <Download className="h-4 w-4" /> Download
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!detail) return;
                const ok = await confirm({ title: `Delete ${detail.name}?`, description: 'Any page using this asset will show a missing-image placeholder.', confirmLabel: 'Delete', destructive: true });
                if (!ok) return;
                assetService.remove(detail.id);
                setDetail(null);
                refresh();
                success('Asset deleted');
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </>
        }
      >
        {detail && (
          <div className="space-y-4">
            <div className="flex justify-center rounded-lg bg-muted/40 p-4">
              <img src={detail.url} alt={detail.name} className="max-h-[320px] rounded object-contain" />
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <Detail label="Kind" value={KIND_LABELS[detail.kind]} />
              <Detail label="Folder" value={detail.folder} />
              <Detail label="Dimensions" value={`${detail.width} × ${detail.height} px`} />
              <Detail label="File size" value={formatBytes(detail.sizeBytes)} />
              <Detail label="MIME type" value={detail.mimeType} />
              <Detail label="Added" value={timeAgo(detail.createdAt)} />
              <Detail label="Storage key" value={detail.storageKey} />
              <Detail label="Tags" value={detail.tags.length ? detail.tags.join(', ') : 'None'} />
            </dl>
            <Separator />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => { if (detail) { assetService.update(detail.id, { tags: [...detail.tags, 'library'] }); setDetail({ ...detail, tags: [...detail.tags, 'library'] }); refresh(); success('Tag added'); } }}>
                Add “library” tag
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate('/dashboard/books')}>
                <Filter className="h-4 w-4" /> Use in a book
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={aiOpen}
        onOpenChange={setAiOpen}
        title="Generate an illustration"
        description="Describe the image you need. Higher-resolution generations cost more credits."
        footer={
          <>
            <Button variant="outline" onClick={() => { setAiOpen(false); setAiResult(null); }}>Close</Button>
            <Button onClick={generateImage} disabled={aiBusy || aiPrompt.trim().length < 6}>
              {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Generate ({aiService.creditCost('outline')} credits)
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="ai-prompt">Prompt</label>
            <textarea
              id="ai-prompt"
              value={aiPrompt}
              onChange={(event) => setAiPrompt(event.target.value)}
              rows={3}
              placeholder="A lighthouse on a stormy cliff, muted teal and sand palette, textured gouache"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="ai-style">Style</label>
            <select id="ai-style" value={aiStyle} onChange={(event) => setAiStyle(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
              {AI_STYLES.map((style) => <option key={style} value={style}>{style}</option>)}
            </select>
          </div>
          {aiResult && (
            <div className="space-y-2">
              <img src={aiResult.url} alt="Generated illustration" className="mx-auto max-h-[280px] rounded-lg object-contain" />
              <p className="text-center text-xs text-muted-foreground">Saved to your AI Images folder · {aiResult.credits} credits used</p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {entitlements.usage.aiImages.used} of {entitlements.usage.aiImages.limit} image credits used this period.
          </p>
        </div>
      </Modal>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{value}</dd>
    </div>
  );
}
